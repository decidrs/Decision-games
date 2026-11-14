import { NextResponse } from "next/server";
import { signOut } from "../../../lib/session";

export async function POST(req: Request) {
  signOut();
  return NextResponse.redirect(new URL("/", req.url), 303);
}
