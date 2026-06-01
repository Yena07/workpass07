import { NextRequest, NextResponse } from "next/server";
import { getEmployee, updateEmployee, deleteEmployee, sanitizeEmployee } from "@/lib/server-store";

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const employee = await getEmployee(id);
  if (!employee) return NextResponse.json({ error: "직원을 찾을 수 없습니다" }, { status: 404 });
  return NextResponse.json(sanitizeEmployee(employee));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json();
    const employee = await getEmployee(id);
    if (!employee) return NextResponse.json({ error: "직원을 찾을 수 없습니다" }, { status: 404 });

    // 고용 레코드 자체 식별/소유 필드는 변경 불가
    delete body.id;
    delete body.workerId;
    delete body.attendance;

    const updated = await updateEmployee(id, body);
    if (!updated) return NextResponse.json({ error: "업데이트 실패" }, { status: 500 });
    return NextResponse.json(sanitizeEmployee(updated));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const success = await deleteEmployee(id);
  if (!success) return NextResponse.json({ error: "직원을 찾을 수 없습니다" }, { status: 404 });
  return NextResponse.json({ success: true });
}
