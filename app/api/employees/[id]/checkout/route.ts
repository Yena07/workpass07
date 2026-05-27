import { NextRequest, NextResponse } from "next/server";
import { getEmployee, recordCheckOut } from "@/lib/server-store";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { pin } = await req.json();
    const employee = await getEmployee(id);
    if (!employee) return NextResponse.json({ error: "직원을 찾을 수 없습니다" }, { status: 404 });
    if (employee.pin !== String(pin)) return NextResponse.json({ error: "PIN이 올바르지 않습니다" }, { status: 403 });

    const today = new Date().toISOString().split("T")[0];
    const todayRecord = employee.attendance.find((a) => a.date === today);
    if (!todayRecord) return NextResponse.json({ error: "오늘 출근 체크가 되어있지 않습니다" }, { status: 400 });
    if (todayRecord.checkOutTime) {
      return NextResponse.json({ error: `이미 퇴근 체크되었습니다 (${todayRecord.checkOutTime})` }, { status: 409 });
    }

    const checkOutTime = new Date().toLocaleTimeString("ko-KR", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });

    const updated = await recordCheckOut(id, today, checkOutTime);
    return NextResponse.json({
      success: true,
      date: today,
      checkInTime: todayRecord.checkInTime,
      checkOutTime,
      totalAttendance: updated?.attendance.length ?? 0,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
