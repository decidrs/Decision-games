import { NextResponse } from "next/server";
import { config } from "../../lib/config";

export const dynamic = "force-dynamic";

/** Reports app and PocketBase health for Coolify (lab pattern). */
export async function GET() {
  let pocketbase = false;
  try {
    pocketbase = (await fetch(`${config.pocketbaseUrl}/api/health`, { cache: "no-store" })).ok;
  } catch { /* down */ }
  return NextResponse.json({ app: "ok", pocketbase: pocketbase ? "ok" : "down" }, { status: pocketbase ? 200 : 503 });
}
