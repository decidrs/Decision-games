import "server-only";
import { Spine } from "@games/spine";
import { config } from "./config";

let spinePromise: Promise<Spine> | null = null;

/** Server-side spine client. The service credentials live only in the host's environment (GC-9). */
export function spine(): Promise<Spine> {
  if (!spinePromise) {
    const email = process.env.POCKETBASE_SERVICE_EMAIL;
    const password = process.env.POCKETBASE_SERVICE_PASSWORD;
    if (!email || !password) throw new Error("POCKETBASE_SERVICE_EMAIL and POCKETBASE_SERVICE_PASSWORD must be set");
    spinePromise = Spine.connect(config.pocketbaseUrl, email, password).catch((e) => { spinePromise = null; throw e; });
  }
  return spinePromise;
}
