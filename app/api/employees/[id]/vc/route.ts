import { NextRequest, NextResponse } from "next/server";
import { getEmployee, updateEmployee } from "@/lib/server-store";

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const employee = await getEmployee(id);
  if (!employee) return NextResponse.json({ error: "직원을 찾을 수 없습니다" }, { status: 404 });
  if (!employee.vc) return NextResponse.json({ error: "아직 VC가 발급되지 않았습니다" }, { status: 404 });
  return NextResponse.json(employee.vc);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const vc = await req.json();
    if (!vc || !vc.type?.includes("VerifiableCredential")) {
      return NextResponse.json({ error: "올바른 VC 형식이 아닙니다" }, { status: 400 });
    }
    const updated = await updateEmployee(id, { vc });
    if (!updated) return NextResponse.json({ error: "직원을 찾을 수 없습니다" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
