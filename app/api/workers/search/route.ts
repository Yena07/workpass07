import { NextRequest, NextResponse } from "next/server";
import { getWorker } from "@/lib/server-store";

// 사장이 직원 ID로 계정 조회 (PIN 노출 없음)
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id 파라미터가 필요합니다" }, { status: 400 });
  }
  const worker = await getWorker(id.trim());
  if (!worker) {
    return NextResponse.json({ error: "해당 ID의 직원 계정이 없습니다" }, { status: 404 });
  }
  return NextResponse.json({ id: worker.id, name: worker.name, did: worker.did ?? null });
}
