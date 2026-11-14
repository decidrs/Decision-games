import "server-only";
import { cookies } from "next/headers";
import PocketBase from "pocketbase";
import { config } from "./config";

const COOKIE = "games_session";

/** Sign a player in against PocketBase and keep the token in an http-only cookie. */
export async function signIn(email: string, password: string): Promise<void> {
  const pb = new PocketBase(config.pocketbaseUrl);
  await pb.collection("users").authWithPassword(email, password);
  cookies().set(COOKIE, pb.authStore.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 14 });
}

export function signOut(): void {
  cookies().delete(COOKIE);
}

/** The signed-in player's id, verified by refreshing the token with PocketBase, or null. */
export async function currentPlayer(): Promise<{ id: string; playerRef: string } | null> {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  const pb = new PocketBase(config.pocketbaseUrl);
  pb.authStore.save(token, null);
  try {
    const res = await pb.collection("users").authRefresh();
    return { id: res.record.id, playerRef: res.record.player_ref as string };
  } catch {
    return null;
  }
}
