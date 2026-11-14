/**
 * The shared spine for every game: player accounts, research consent and the append-only event store.
 *
 * Server-side only. It talks to the games' own PocketBase with a service superuser whose credentials
 * live in the host's environment, never in the browser (MVP Lab Baseline). Every write goes through
 * here so that the consent state stamped on each event is the ledger's, not the client's.
 */
import PocketBase from "pocketbase";
import { randomBytes } from "node:crypto";

export const SPINE_VERSION = "spine-1" as const;

export type Surface = "web" | "ios" | "android" | "server";

export class SpineError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export interface ConsentState {
  research: boolean;
  wordingVersion: string | null;
  /** Last sequence number in the player's consent ledger (0 if none). */
  seq: number;
}

export interface EventInput {
  type: string;
  payload?: Record<string, unknown>;
  game?: string;
  itemVersion?: string;
  scoringVersion?: string;
  servingVersion?: string;
  surface: Surface;
  clientTs?: string;
}

export interface StoredEvent extends EventInput {
  id: string;
  player: string;
  consentResearch: boolean;
  consentWordingVersion: string | null;
  created: string;
}

/** Pseudonymous player reference: random, carries no personal data. */
export function newPlayerRef(): string {
  return "pl_" + randomBytes(9).toString("base64url");
}

/** Derive consent state from the ledger rows, in sequence order. Pure, so it can rebuild anywhere. */
export function deriveConsent(rows: ReadonlyArray<{ action: string; wording_version: string; seq: number }>): ConsentState {
  const sorted = [...rows].sort((a, b) => a.seq - b.seq);
  let state: ConsentState = { research: false, wordingVersion: null, seq: 0 };
  for (const r of sorted) {
    state = r.action === "grant"
      ? { research: true, wordingVersion: r.wording_version, seq: r.seq }
      : { research: false, wordingVersion: r.wording_version, seq: r.seq };
  }
  return state;
}

export class Spine {
  private constructor(private pb: PocketBase) {}

  static async connect(url: string, superuserEmail: string, superuserPassword: string): Promise<Spine> {
    const pb = new PocketBase(url);
    pb.autoCancellation(false);
    await pb.collection("_superusers").authWithPassword(superuserEmail, superuserPassword);
    return new Spine(pb);
  }

  /**
   * Create a player account. Refuses without an 18+ declaration. An invite code, if given,
   * puts the player in that host's crew. The declaration and crew join are recorded as events.
   */
  async signUp(input: { email: string; password: string; declared18Plus: boolean; inviteCode?: string; surface: Surface }) {
    if (input.declared18Plus !== true) throw new SpineError("age_declaration_required", "Players must declare they are 18 or over");
    let crewId: string | null = null;
    if (input.inviteCode) {
      const code = input.inviteCode.trim().toUpperCase();
      const crew = await this.pb.collection("crews").getFirstListItem(this.pb.filter("code = {:code}", { code })).catch(() => null);
      if (!crew) throw new SpineError("invite_code_unknown", "That invite code is not recognised");
      crewId = crew.id;
    }
    const user = await this.pb.collection("users").create({
      email: input.email,
      password: input.password,
      passwordConfirm: input.password,
      player_ref: newPlayerRef(),
      crew: crewId ?? "",
      emailVisibility: false,
    });
    await this.appendEvent(user.id, { type: "account.age_declared", payload: { declared18Plus: true }, surface: input.surface });
    if (crewId) await this.appendEvent(user.id, { type: "account.crew_joined", payload: { crew: crewId }, surface: input.surface });
    return { playerId: user.id as string, playerRef: user.player_ref as string, crewId };
  }

  async createCrew(code: string, label: string): Promise<string> {
    const rec = await this.pb.collection("crews").create({ code: code.toUpperCase(), label });
    return rec.id;
  }

  async consentState(playerId: string): Promise<ConsentState> {
    const rows = await this.pb.collection("consent_events").getFullList({ filter: this.pb.filter("player = {:p}", { p: playerId }), sort: "seq" });
    return deriveConsent(rows as unknown as Array<{ action: string; wording_version: string; seq: number }>);
  }

  private async recordConsent(playerId: string, action: "grant" | "withdraw", wordingVersion: string, surface: Surface) {
    if (!wordingVersion) throw new SpineError("wording_version_required", "Consent must carry its wording version");
    const current = await this.consentState(playerId);
    // seq is unique per player in the database, so two racing writes cannot both land.
    await this.pb.collection("consent_events").create({
      player: playerId, action, purpose: "research", wording_version: wordingVersion, surface: surface === "server" ? "web" : surface, seq: current.seq + 1,
    });
    await this.appendEvent(playerId, { type: `consent.research_${action}`, payload: { wordingVersion }, surface });
    return this.consentState(playerId);
  }

  /** Research consent is separate from play: a player can play without it, but their records never qualify. */
  grantResearchConsent(playerId: string, wordingVersion: string, surface: Surface) {
    return this.recordConsent(playerId, "grant", wordingVersion, surface);
  }

  withdrawResearchConsent(playerId: string, wordingVersion: string, surface: Surface) {
    return this.recordConsent(playerId, "withdraw", wordingVersion, surface);
  }

  /** Append one event, stamped with the consent state at that moment. Events are never changed or deleted. */
  async appendEvent(playerId: string, e: EventInput): Promise<StoredEvent> {
    const consent = await this.consentState(playerId);
    const rec = await this.pb.collection("events").create({
      player: playerId,
      type: e.type,
      payload: e.payload ?? {},
      game: e.game ?? "",
      item_version: e.itemVersion ?? "",
      scoring_version: e.scoringVersion ?? "",
      serving_version: e.servingVersion ?? "",
      surface: e.surface,
      consent_research: consent.research,
      consent_wording_version: consent.wordingVersion ?? "",
      client_ts: e.clientTs ?? "",
    });
    return toStored(rec);
  }

  async eventsFor(playerId: string): Promise<StoredEvent[]> {
    const rows = await this.pb.collection("events").getFullList({ filter: this.pb.filter("player = {:p}", { p: playerId }), sort: "created,id" });
    return rows.map(toStored);
  }

  /**
   * Records available for research: only players whose consent is active NOW. A withdrawal removes
   * every one of that player's records from every export, including those made while consent was active.
   */
  async researchExport(): Promise<StoredEvent[]> {
    const ledger = await this.pb.collection("consent_events").getFullList({ sort: "player,seq" });
    const byPlayer = new Map<string, Array<{ action: string; wording_version: string; seq: number }>>();
    for (const r of ledger) byPlayer.set(r.player, [...(byPlayer.get(r.player) ?? []), r as unknown as { action: string; wording_version: string; seq: number }]);
    const active = [...byPlayer.entries()].filter(([, rows]) => deriveConsent(rows).research).map(([p]) => p);
    if (active.length === 0) return [];
    const out: StoredEvent[] = [];
    for (const p of active) out.push(...(await this.eventsFor(p)).filter((e) => e.consentResearch));
    return out;
  }
}

function toStored(rec: Record<string, any>): StoredEvent {
  return {
    id: rec.id,
    player: rec.player,
    type: rec.type,
    payload: rec.payload ?? {},
    game: rec.game || undefined,
    itemVersion: rec.item_version || undefined,
    scoringVersion: rec.scoring_version || undefined,
    servingVersion: rec.serving_version || undefined,
    surface: rec.surface,
    clientTs: rec.client_ts || undefined,
    consentResearch: !!rec.consent_research,
    consentWordingVersion: rec.consent_wording_version || null,
    created: rec.created,
  };
}
