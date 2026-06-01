import { NextRequest, NextResponse } from "next/server";
import { authenticateWorker, getEmploymentsByWorker, sanitizeWorker } from "@/lib/server-store";

// 직원 계정 로그인 — 계정 정보 + 연결된 모든 고용 레코드 반환
export async function POST(req: NextRequest) {
  try {
    const { id, pin } = await req.json();
    const worker = await authenticateWorker(String(id), String(pin));
    if (!worker) {
      return NextResponse.json({ error: "ID 또는 PIN이 올바르지 않습니다" }, { status: 403 });
    }
    const employments = await getEmploymentsByWorker(worker.id);
    return NextResponse.json({ worker: sanitizeWorker(worker), employments });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
