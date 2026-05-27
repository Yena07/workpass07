import { NextRequest, NextResponse } from "next/server";
import { getEmployee } from "@/lib/server-store";

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const employee = await getEmployee(id);
  if (!employee) return NextResponse.json({ error: "직원을 찾을 수 없습니다" }, { status: 404 });
  return NextResponse.json({ pin: employee.pin, name: employee.name });
}
