import { NextRequest, NextResponse } from "next/server";
import {
  authenticateWorker,
  updateWorker,
  setWorkerDidOnEmployments,
  getEmploymentsByWorker,
  sanitizeWorker,
} from "@/lib/server-store";

// 직원 DID 등록/변경 — PIN 인증 필요. 연결된 고용 레코드에도 전파.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { pin, did } = await req.json();
    const worker = await authenticateWorker(id, String(pin));
    if (!worker) {
      return NextResponse.json({ error: "PIN이 올바르지 않습니다" }, { status: 403 });
    }
    if (!did) {
      return NextResponse.json({ error: "did가 필요합니다" }, { status: 400 });
    }
    const updated = await updateWorker(id, { did: String(did) });
    await setWorkerDidOnEmployments(id, String(did));
    const employments = await getEmploymentsByWorker(id);
    return NextResponse.json({ worker: sanitizeWorker(updated!), employments });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
