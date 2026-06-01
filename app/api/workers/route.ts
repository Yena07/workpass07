import { NextRequest, NextResponse } from "next/server";
import { addWorker, sanitizeWorker } from "@/lib/server-store";

// 직원 계정 회원가입
export async function POST(req: NextRequest) {
  try {
    const { id, name, pin } = await req.json();

    if (!id || !name || !pin) {
      return NextResponse.json({ error: "ID, 이름, PIN은 필수입니다" }, { status: 400 });
    }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(String(id))) {
      return NextResponse.json({ error: "ID는 영문/숫자/_ 3~20자여야 합니다" }, { status: 400 });
    }
    if (String(pin).length !== 4 || isNaN(Number(pin))) {
      return NextResponse.json({ error: "PIN은 4자리 숫자여야 합니다" }, { status: 400 });
    }

    const worker = await addWorker({
      id: String(id).trim(),
      name: String(name).trim(),
      pin: String(pin),
    });
    return NextResponse.json(sanitizeWorker(worker), { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("이미 사용 중인 ID") ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
