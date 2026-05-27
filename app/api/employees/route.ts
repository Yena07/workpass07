import { NextRequest, NextResponse } from "next/server";
import {
  getEmployees,
  addEmployee,
  computeWorkDates,
  sanitizeEmployee,
} from "@/lib/server-store";

export async function GET() {
  const employees = await getEmployees();
  return NextResponse.json(employees.map(sanitizeEmployee));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, position, employmentType, startDate, endDate, weekdays, hourlyWage, weeklyHours, pin } = body;

    if (!name || !position || !startDate || !weekdays?.length || !hourlyWage || !pin) {
      return NextResponse.json({ error: "필수 항목이 누락되었습니다" }, { status: 400 });
    }
    if (String(pin).length !== 4 || isNaN(Number(pin))) {
      return NextResponse.json({ error: "PIN은 4자리 숫자여야 합니다" }, { status: 400 });
    }

    const specificDates = computeWorkDates(startDate, endDate || "", weekdays);
    const employee = await addEmployee({
      name: String(name).trim(),
      position: String(position).trim(),
      employmentType: String(employmentType || "단기/시간제"),
      startDate,
      endDate: endDate || "",
      weekdays,
      specificDates,
      hourlyWage: Number(hourlyWage),
      weeklyHours: Number(weeklyHours || 0),
      pin: String(pin),
    });

    return NextResponse.json(sanitizeEmployee(employee), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
