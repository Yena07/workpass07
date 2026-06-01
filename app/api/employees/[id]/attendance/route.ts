import { NextRequest, NextResponse } from "next/server";
import { getEmployee, getWorker, updateEmployee } from "@/lib/server-store";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { pin, substitute } = await req.json();
    const employee = await getEmployee(id);
    if (!employee) return NextResponse.json({ error: "직원을 찾을 수 없습니다" }, { status: 404 });
    const worker = await getWorker(employee.workerId);
    if (!worker || worker.pin !== String(pin)) return NextResponse.json({ error: "PIN이 올바르지 않습니다" }, { status: 403 });

    const today = new Date().toISOString().split("T")[0];

    const isScheduled = employee.specificDates.includes(today);
    if (!isScheduled && !substitute) {
      return NextResponse.json(
        { error: `오늘(${today})은 근무일이 아닙니다. 대타 근무라면 '대타 출근'으로 체크하세요` },
        { status: 400 }
      );
    }
    if (employee.attendance.some((a) => a.date === today)) {
      const existing = employee.attendance.find((a) => a.date === today)!;
      return NextResponse.json({ error: `이미 출근 체크되었습니다 (${existing.checkInTime})` }, { status: 409 });
    }

    const now = Date.now();
    const checkInTime = new Date().toLocaleTimeString("ko-KR", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const isSubstitute = !isScheduled;

    const updated = await updateEmployee(id, {
      attendance: [...employee.attendance, { date: today, checkInTime, checkInAt: now, isSubstitute }],
    });

    return NextResponse.json({
      success: true,
      date: today,
      checkInTime,
      isSubstitute,
      totalAttendance: updated?.attendance.length ?? 0,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const employee = await getEmployee(id);
  if (!employee) return NextResponse.json({ error: "직원을 찾을 수 없습니다" }, { status: 404 });
  return NextResponse.json(employee.attendance);
}
