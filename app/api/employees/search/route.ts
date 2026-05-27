import { NextRequest, NextResponse } from "next/server";
import { getEmployees, sanitizeEmployee } from "@/lib/server-store";

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "name 파라미터가 필요합니다" }, { status: 400 });
  }
  const employees = await getEmployees();
  const matched = employees.filter((e) => e.name.includes(name.trim()));
  return NextResponse.json(matched.map(sanitizeEmployee));
}
