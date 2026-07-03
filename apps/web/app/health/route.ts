import { NextResponse } from "next/server";

// rota pública de health-check (Caddy/k8s consultam)
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json({ status: "ok" });
}
