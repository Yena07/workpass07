import { NextRequest, NextResponse } from "next/server";
import {
  getEmployees,
  getWorker,
  addEmployee,
  computeWorkDates,
  sanitizeEmployee,
} from "@/lib/server-store";

export async function GET() {
  const employees = await getEmployees();
  return NextResponse.json(employees.map(sanitizeEmployee));
}

// 사장이 직원 계정(workerId)을 연결해 고용 레코드 생성
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workerId, position, employmentType, startDate, endDate, weekdays, hourlyWage, weeklyHours } = body;

    if (!workerId || !position || !startDate || !weekdays?.length || !hourlyWage) {
      return NextResponse.json({ error: "필수 항목이 누락되었습니다" }, { status: 400 });
    }

    const worker = await getWorker(String(workerId).trim());
    if (!worker) {
      return NextResponse.json({ error: "존재하지 않는 직원 ID입니다" }, { status: 404 });
    }

    const specificDates = computeWorkDates(startDate, endDate || "", weekdays);
    const employee = await addEmployee({
      workerId: worker.id,
      name: worker.name,
      workerDid: worker.did,
      position: String(position).trim(),
      employmentType: String(employmentType || "단기/시간제"),
      startDate,
      endDate: endDate || "",
      weekdays,
      specificDates,
      hourlyWage: Number(hourlyWage),
      weeklyHours: Number(weeklyHours || 0),
    });

    return NextResponse.json(sanitizeEmployee(employee), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
