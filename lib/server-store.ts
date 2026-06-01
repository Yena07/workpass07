/**
 * 서버 전용 저장소 — Upstash Redis
 * 두 개의 단일 키에 JSON 배열로 저장
 *   - workpass:workers   : 직원 계정 (직원이 직접 생성, 사장이 못 건드림)
 *   - workpass:employees : 고용 레코드 (사장이 직원 ID를 연결해서 생성)
 * API Route에서만 import
 */
import { Redis } from "@upstash/redis";
import { randomUUID } from "crypto";

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface AttendanceRecord {
  date: string;
  checkInTime: string;     // 표시용 시각 문자열
  checkOutTime?: string;   // 표시용 시각 문자열
  checkInAt?: number;      // epoch ms (실근무시간 계산용)
  checkOutAt?: number;     // epoch ms
  workedMinutes?: number;  // 실제 근무 분 (퇴근 시 확정)
  isSubstitute?: boolean;  // 대타 근무 여부
}

// 직원 계정 — 직원이 직접 생성·관리. 고용 레코드와 독립적.
export interface Worker {
  id: string;        // 로그인 ID (직원이 정한 고유 아이디)
  name: string;
  pin: string;       // 4자리 PIN
  did?: string;      // 직원이 등록한 DID (계정에 1개)
  createdAt: string;
}

// 고용 레코드 — 사장이 직원 계정(workerId)을 연결해서 생성
export interface Employee {
  id: string;
  workerId: string;     // 연결된 직원 계정 ID
  name: string;         // 표시용 (계정에서 복사)
  workerDid?: string;   // 표시·VC발급용 (계정에서 복사)
  position: string;
  employmentType: string;
  startDate: string;
  endDate: string;
  weekdays: string[];
  specificDates: string[];
  hourlyWage: number;
  weeklyHours: number;
  attendance: AttendanceRecord[];
  vc?: object;
  status: "active" | "terminated";
  terminatedAt?: string;
  createdAt: string;
}

// ── Redis 클라이언트 ───────────────────────────────────────────────────────────

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const WORKERS_KEY = "workpass:workers";
const EMPLOYEES_KEY = "workpass:employees";

// ── 직원 계정 (Worker) ─────────────────────────────────────────────────────────

export async function getWorkers(): Promise<Worker[]> {
  try {
    const data = await redis.get<Worker[]>(WORKERS_KEY);
    return data ?? [];
  } catch {
    return [];
  }
}

export async function saveWorkers(workers: Worker[]): Promise<void> {
  await redis.set(WORKERS_KEY, workers);
}

export async function getWorker(id: string): Promise<Worker | undefined> {
  return (await getWorkers()).find((w) => w.id === id);
}

export async function addWorker(
  data: Omit<Worker, "createdAt">
): Promise<Worker> {
  const workers = await getWorkers();
  if (workers.some((w) => w.id === data.id)) {
    throw new Error("이미 사용 중인 ID입니다");
  }
  const worker: Worker = { ...data, createdAt: new Date().toISOString() };
  workers.push(worker);
  await saveWorkers(workers);
  return worker;
}

export async function authenticateWorker(
  id: string,
  pin: string
): Promise<Worker | null> {
  const worker = await getWorker(id);
  if (!worker || worker.pin !== String(pin)) return null;
  return worker;
}

export async function updateWorker(
  id: string,
  updates: Partial<Worker>
): Promise<Worker | null> {
  const workers = await getWorkers();
  const idx = workers.findIndex((w) => w.id === id);
  if (idx === -1) return null;
  workers[idx] = { ...workers[idx], ...updates };
  await saveWorkers(workers);
  return workers[idx];
}

export function sanitizeWorker(worker: Worker) {
  const { pin, ...safe } = worker;
  void pin;
  return safe;
}

// ── 고용 레코드 (Employee) ───────────────────────────────────────────────────────

export async function getEmployees(): Promise<Employee[]> {
  try {
    const data = await redis.get<Employee[]>(EMPLOYEES_KEY);
    return data ?? [];
  } catch {
    return [];
  }
}

export async function saveEmployees(employees: Employee[]): Promise<void> {
  await redis.set(EMPLOYEES_KEY, employees);
}

export async function getEmployee(id: string): Promise<Employee | undefined> {
  return (await getEmployees()).find((e) => e.id === id);
}

export async function getEmploymentsByWorker(
  workerId: string
): Promise<Employee[]> {
  return (await getEmployees()).filter((e) => e.workerId === workerId);
}

export async function addEmployee(
  data: Omit<Employee, "id" | "attendance" | "createdAt" | "status">
): Promise<Employee> {
  const employees = await getEmployees();
  const employee: Employee = {
    ...data,
    id: randomUUID(),
    attendance: [],
    status: "active",
    createdAt: new Date().toISOString(),
  };
  employees.push(employee);
  await saveEmployees(employees);
  return employee;
}

export async function updateEmployee(
  id: string,
  updates: Partial<Employee>
): Promise<Employee | null> {
  const employees = await getEmployees();
  const idx = employees.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  employees[idx] = { ...employees[idx], ...updates };
  await saveEmployees(employees);
  return employees[idx];
}

export async function recordCheckOut(
  id: string,
  date: string,
  fields: { checkOutTime: string; checkOutAt: number; workedMinutes?: number }
): Promise<Employee | null> {
  const employees = await getEmployees();
  const idx = employees.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const attendance = employees[idx].attendance.map((a) =>
    a.date === date ? { ...a, ...fields } : a
  );
  employees[idx] = { ...employees[idx], attendance };
  await saveEmployees(employees);
  return employees[idx];
}

// 직원이 DID를 등록/변경하면 연결된 모든 고용 레코드에 전파
export async function setWorkerDidOnEmployments(
  workerId: string,
  did: string
): Promise<void> {
  const employees = await getEmployees();
  let changed = false;
  for (const e of employees) {
    if (e.workerId === workerId && e.workerDid !== did) {
      e.workerDid = did;
      changed = true;
    }
  }
  if (changed) await saveEmployees(employees);
}

export async function deleteEmployee(id: string): Promise<boolean> {
  const employees = await getEmployees();
  const idx = employees.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  employees.splice(idx, 1);
  await saveEmployees(employees);
  return true;
}

// ── 순수 함수 ───────────────────────────────────────────────────────────────────

export function computeWorkDates(
  startDate: string,
  endDate: string,
  weekdays: string[]
): string[] {
  const WEEKDAY_INDEX: Record<string, number> = {
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  };
  const targetDays = weekdays
    .map((d) => WEEKDAY_INDEX[d])
    .filter((d) => d !== undefined);

  function parseLocalDate(s: string) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function formatLocalDate(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  const dates: string[] = [];
  const start = parseLocalDate(startDate);
  const end = endDate
    ? parseLocalDate(endDate)
    : new Date(start.getFullYear() + 1, start.getMonth(), start.getDate());
  const current = new Date(start);

  while (current <= end) {
    if (targetDays.includes(current.getDay())) {
      dates.push(formatLocalDate(current));
    }
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

// 고용 레코드엔 비밀 필드가 없으므로 그대로 반환 (호환성 유지용)
export function sanitizeEmployee(employee: Employee) {
  return employee;
}
