import { NextRequest, NextResponse } from "next/server";
import { getEmployee } from "@/lib/server-store";

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

    const { pin: _, ...safeEmployee } = employee;
    return NextResponse.json(safeEmployee);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
