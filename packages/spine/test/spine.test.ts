/**
 * Integration tests against a real, throwaway PocketBase (the pinned version), with the repo's own
 * migrations and hooks. Synthetic data only. Write-and-read-back, never "did the migration apply" (GC-11).
 * Needs PB_BIN pointing at a pocketbase 0.39.7 binary (scripts/get-pocketbase.sh fetches one).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import PocketBase from "pocketbase";
import { Spine, SpineError, deriveConsent } from "../src/index";

const PB_BIN = process.env.PB_BIN ?? "";
const PB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/pb");
const PORT = 18000 + Math.floor(Math.random() * 1000);
const URL = `http://127.0.0.1:${PORT}`;
const SU = { email: "spine-test@example.invalid", password: "spine-test-password-123" };

let proc: ChildProcess;
let dataDir: string;
let spine: Spine;

beforeAll(async () => {
  if (!PB_BIN) throw new Error("Set PB_BIN to a pocketbase 0.39.7 binary");
  dataDir = mkdtempSync(join(tmpdir(), "pbtest-"));
  const common = [`--dir=${dataDir}`, `--migrationsDir=${PB_DIR}/pb_migrations`, `--hooksDir=${PB_DIR}/pb_hooks`];
  execFileSync(PB_BIN, ["migrate", "up", ...common], { stdio: "ignore" });
  execFileSync(PB_BIN, ["superuser", "upsert", SU.email, SU.password, `--dir=${dataDir}`], { stdio: "ignore" });
  proc = spawn(PB_BIN, ["serve", `--http=127.0.0.1:${PORT}`, ...common], { stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${URL}/api/health`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  spine = await Spine.connect(URL, SU.email, SU.password);
}, 30000);

afterAll(() => {
  proc?.kill();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

let n = 0;
const email = () => `player${++n}-${Date.now()}@example.invalid`;
const PW = "a-long-test-password";

describe("account", () => {
  it("refuses sign-up without an 18+ declaration", async () => {
    await expect(spine.signUp({ email: email(), password: PW, declared18Plus: false, surface: "web" }))
      .rejects.toMatchObject({ code: "age_declaration_required" });
  });

  it("creates a player with a pseudonymous ref and records the declaration as an event", async () => {
    const p = await spine.signUp({ email: email(), password: PW, declared18Plus: true, surface: "web" });
    expect(p.playerRef).toMatch(/^pl_/);
    const evs = await spine.eventsFor(p.playerId);
    expect(evs.map((e) => e.type)).toEqual(["account.age_declared"]);
  });

  it("joins a crew through an invite code and rejects unknown codes", async () => {
    await spine.createCrew("HOST-ONE", "Host one test crew");
    const p = await spine.signUp({ email: email(), password: PW, declared18Plus: true, inviteCode: "host-one", surface: "web" });
    expect(p.crewId).toBeTruthy();
    expect((await spine.eventsFor(p.playerId)).map((e) => e.type)).toContain("account.crew_joined");
    await expect(spine.signUp({ email: email(), password: PW, declared18Plus: true, inviteCode: "NOPE-1", surface: "web" }))
      .rejects.toBeInstanceOf(SpineError);
  });

  it("blocks self-registration straight to the database (GC-6)", async () => {
    const res = await fetch(`${URL}/api/collections/users/records`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email(), password: PW, passwordConfirm: PW, player_ref: "pl_selfregistered1" }),
    });
    expect(res.status).toBe(403);
  });

  it("lets a player read only their own events", async () => {
    const a = await spine.signUp({ email: email(), password: PW, declared18Plus: true, surface: "web" });
    const bEmail = email();
    await spine.signUp({ email: bEmail, password: PW, declared18Plus: true, surface: "web" });
    const asB = new PocketBase(URL);
    await asB.collection("users").authWithPassword(bEmail, PW);
    const seen = await asB.collection("events").getFullList();
    expect(seen.every((e) => e.player !== a.playerId)).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    // and cannot write events directly
    await expect(asB.collection("events").create({ player: asB.authStore.record!.id, type: "x.y", surface: "web" })).rejects.toBeTruthy();
  });
});

describe("research consent", () => {
  it("stamps each event with the consent state at the time, and withdrawal removes all records from exports", async () => {
    const p = await spine.signUp({ email: email(), password: PW, declared18Plus: true, surface: "web" });
    await spine.appendEvent(p.playerId, { type: "game.call_locked", surface: "web", game: "outlier", scoringVersion: "dc-1" });
    let s = await spine.grantResearchConsent(p.playerId, "research-consent-DRAFT-0", "web");
    expect(s).toMatchObject({ research: true, wordingVersion: "research-consent-DRAFT-0" });
    await spine.appendEvent(p.playerId, { type: "game.call_locked", surface: "web", game: "outlier", scoringVersion: "dc-1" });

    const evs = await spine.eventsFor(p.playerId);
    const calls = evs.filter((e) => e.type === "game.call_locked");
    expect(calls.map((e) => e.consentResearch)).toEqual([false, true]);
    expect(calls[1]!.consentWordingVersion).toBe("research-consent-DRAFT-0");

    let exported = await spine.researchExport();
    expect(exported.filter((e) => e.player === p.playerId && e.type === "game.call_locked")).toHaveLength(1);

    s = await spine.withdrawResearchConsent(p.playerId, "research-consent-DRAFT-0", "web");
    expect(s.research).toBe(false);
    exported = await spine.researchExport();
    expect(exported.filter((e) => e.player === p.playerId)).toHaveLength(0);
  });

  it("requires a wording version", async () => {
    const p = await spine.signUp({ email: email(), password: PW, declared18Plus: true, surface: "web" });
    await expect(spine.grantResearchConsent(p.playerId, "", "web")).rejects.toMatchObject({ code: "wording_version_required" });
  });
});

describe("append-only event store", () => {
  it("refuses changes and deletes to events and consent records, even by a superuser", async () => {
    const p = await spine.signUp({ email: email(), password: PW, declared18Plus: true, surface: "web" });
    await spine.grantResearchConsent(p.playerId, "research-consent-DRAFT-0", "web");
    const su = new PocketBase(URL);
    await su.collection("_superusers").authWithPassword(SU.email, SU.password);
    const ev = (await su.collection("events").getFullList({ filter: `player = "${p.playerId}"` }))[0]!;
    const ce = (await su.collection("consent_events").getFullList({ filter: `player = "${p.playerId}"` }))[0]!;
    await expect(su.collection("events").update(ev.id, { type: "tampered" })).rejects.toBeTruthy();
    await expect(su.collection("events").delete(ev.id)).rejects.toBeTruthy();
    await expect(su.collection("consent_events").update(ce.id, { action: "withdraw" })).rejects.toBeTruthy();
    await expect(su.collection("consent_events").delete(ce.id)).rejects.toBeTruthy();
    expect((await su.collection("events").getOne(ev.id)).type).toBe(ev.type);
  });

  it("rebuilds consent state from the ledger identically every time", async () => {
    const p = await spine.signUp({ email: email(), password: PW, declared18Plus: true, surface: "web" });
    await spine.grantResearchConsent(p.playerId, "v1", "web");
    await spine.withdrawResearchConsent(p.playerId, "v1", "web");
    await spine.grantResearchConsent(p.playerId, "v2", "web");
    const a = await spine.consentState(p.playerId);
    const b = await spine.consentState(p.playerId);
    expect(a).toEqual(b);
    expect(a).toEqual({ research: true, wordingVersion: "v2", seq: 3 });
  });
});

describe("deriveConsent (pure)", () => {
  it("orders by sequence, not by arrival", () => {
    expect(deriveConsent([
      { action: "withdraw", wording_version: "v1", seq: 2 },
      { action: "grant", wording_version: "v1", seq: 1 },
    ])).toEqual({ research: false, wordingVersion: "v1", seq: 2 });
  });
});
