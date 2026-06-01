import { NextRequest, NextResponse } from "next/server";
import {
  authenticateWorker,
  getEmploymentsByWorker,
  sanitizeWorker,
} from "@/lib/server-store";

// 직원 본인이 ID + PIN으로 자신의 경력 목록을 조회 (검증자/은행 직접 조회용)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { pin } = await req.json();
    const worker = await authenticateWorker(id, String(pin));
    if (!worker) {
      return NextResponse.json({ error: "아이디 또는 PIN이 올바르지 않습니다" }, { status: 403 });
    }

    const employments = await getEmploymentsByWorker(id);
    const careers = employments.map((e) => {
      const cs = (e.vc as { credentialSubject?: Record<string, unknown> } | undefined)?.credentialSubject;
      return {
        id: e.id,
        employerName: (cs?.employerName as string) || null,
        position: e.position,
        employmentType: e.employmentType,
        startDate: e.startDate,
        endDate: e.endDate,
        hourlyWage: e.hourlyWage,
        weeklyHours: e.weeklyHours,
        attendanceCount: e.attendance.length,
        totalHours: (cs?.totalHours as number) ?? null,
        status: e.status,
        hasVC: !!e.vc,
        vc: e.vc ?? null,
      };
    });

    return NextResponse.json({ worker: sanitizeWorker(worker), careers });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
