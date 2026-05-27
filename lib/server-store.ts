/**
 * 서버 전용 저장소 — Upstash Redis
 * employees 배열을 단일 Redis 키에 JSON으로 저장
 * API Route에서만 import
 */
import { Redis } from "@upstash/redis";
import { randomUUID } from "crypto";

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface AttendanceRecord {
  date: string;
  checkInTime: string;
  checkOutTime?: string;
}

export interface Employee {
  id: string;
  name: string;
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
  workerDid?: string;
  pin: string;
  status: "active" | "terminated";
  terminatedAt?: string;
  createdAt: string;
}

// ── Redis 클라이언트 ───────────────────────────────────────────────────────────

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const KEY = "workpass:employees";

// ── 저장소 함수 (모두 async) ───────────────────────────────────────────────────

export async function getEmployees(): Promise<Employee[]> {
  try {
    const data = await redis.get<Employee[]>(KEY);
    return data ?? [];
  } catch {
    return [];
  }
}

export async function saveEmployees(employees: Employee[]): Promise<void> {
  await redis.set(KEY, employees);
}

export async function getEmployee(id: string): Promise<Employee | undefined> {
  return (await getEmployees()).find((e) => e.id === id);
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
  checkOutTime: string
): Promise<Employee | null> {
  const employees = await getEmployees();
  const idx = employees.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const attendance = employees[idx].attendance.map((a) =>
    a.date === date ? { ...a, checkOutTime } : a
  );
  employees[idx] = { ...employees[idx], attendance };
  await saveEmployees(employees);
  return employees[idx];
}

export async function deleteEmployee(id: string): Promise<boolean> {
  const employees = await getEmployees();
  const idx = employees.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  employees.splice(idx, 1);
  await saveEmployees(employees);
  return true;
}

// ── 순수 함수 (변경 없음) ───────────────────────────────────────────────────────

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

export function sanitizeEmployee(employee: Employee) {
  const { pin, ...safe } = employee;
  return safe;
}
