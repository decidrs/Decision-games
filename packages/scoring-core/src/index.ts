/**
 * Scoring library for Outlier (The Daily Call), scoring version dc-1.
 *
 * The single implementation of the dc-1 rules, used by the app, batch jobs and the
 * validator alike. Pure functions of logged events only: no I/O, no learned components.
 * Spec: "The Daily Call: scoring spec v0.1 and week 1 plan", section 2.
 *
 * Shares and probabilities are fractions in [0, 1]; points are on the 0 to 100 scale
 * players see (range points can go below zero by design).
 */

export const SCORING_VERSION = "dc-1" as const;

/** Allowed range for a stated probability. */
export const P_MIN = 0.01;
export const P_MAX = 0.99;

/** Nominal miss rate of a range call: 0.2 for an 80% range. */
export const RANGE_ALPHA = 0.2;

/** Probability-call thresholds, drawn uniformly and independently of the prompt. */
export const THRESHOLDS = [0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65] as const;

/** A reference crowd smaller than this voids the prompt for that player. */
export const MIN_REFERENCE_CROWD = 30;

/** Crew weight cap, applied only once this many crews are active on the prompt. */
export const CREW_WEIGHT_CAP = 0.1;
export const CREW_CAP_MIN_ACTIVE_CREWS = 15;

/** Bloc-voting detection. */
export const BLOC_SAME_WAY_SHARE = 0.9;
/**
 * Smallest crew the bloc checks apply to. Not in spec v0.1, which gives no minimum:
 * without one, any crew of two or three friends who agree would be flagged by chance.
 * Raised for Daniel's ruling.
 */
export const BLOC_MIN_CREW_SIZE = 8;

/** What a skipped call scores as. */
export const SKIP_PROBABILITY = 0.5;
export const SKIP_RANGE: Readonly<[number, number]> = [0, 1];

export class ScoringInputError extends Error {}

function assertFraction(name: string, v: number): void {
  if (!Number.isFinite(v) || v < 0 || v > 1) {
    throw new ScoringInputError(`${name} must be a fraction in [0, 1], got ${v}`);
  }
}

/** Quadratic (Brier) points for a probability call. */
export function probabilityPoints(p: number, outcome: boolean): number {
  if (!Number.isFinite(p) || p < P_MIN || p > P_MAX) {
    throw new ScoringInputError(`p must be in [${P_MIN}, ${P_MAX}], got ${p}`);
  }
  const o = outcome ? 1 : 0;
  return 100 * (1 - (p - o) ** 2);
}

/** Interval score (Gneiting and Raftery 2007), in percentage points. */
export function intervalScore(lower: number, upper: number, x: number, alpha: number = RANGE_ALPHA): number {
  assertFraction("lower", lower);
  assertFraction("upper", upper);
  assertFraction("x", x);
  if (lower > upper) throw new ScoringInputError(`lower ${lower} is above upper ${upper}`);
  const below = Math.max(lower - x, 0);
  const above = Math.max(x - upper, 0);
  return 100 * (upper - lower + (2 / alpha) * below + (2 / alpha) * above);
}

/** Range-call points: 100 minus the interval score. Deliberately not floored at zero. */
export function rangePoints(lower: number, upper: number, x: number): number {
  return 100 - intervalScore(lower, upper, x);
}

/** Outcome of a probability call: did the realised share pass the threshold? */
export function thresholdPassed(share: number, threshold: number): boolean {
  assertFraction("share", share);
  return share > threshold;
}

/** Draw a threshold from a uniform random number u in [0, 1). The serving version records the result. */
export function drawThreshold(u: number): number {
  if (!(u >= 0 && u < 1)) throw new ScoringInputError(`u must be in [0, 1), got ${u}`);
  const t = THRESHOLDS[Math.floor(u * THRESHOLDS.length)];
  if (t === undefined) throw new ScoringInputError("threshold draw out of range");
  return t;
}

export interface Vote {
  playerId: string;
  /** The host group the player joined through, or null for a player with no crew. */
  crewId: string | null;
  yes: boolean;
  /** First exposure, research-consenting, not practice, account passes quality checks. */
  qualifying: boolean;
}

export type ReferenceCrowd =
  | { status: "resolved"; n: number; share: number; capped: boolean; excludedCrews: string[] }
  | { status: "void"; n: number; reason: "below_minimum_crowd" };

function groupKey(v: Vote): string {
  return v.crewId ?? `solo:${v.playerId}`;
}

/**
 * Cap each group's weight at `cap`, redistributing the excess to uncapped groups in
 * proportion to their size (water-filling). Weights sum to one.
 */
export function cappedWeights(sizes: number[], cap: number): number[] {
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total === 0) return sizes.map(() => 0);
  if (cap * sizes.length < 1) throw new ScoringInputError("cap too small for the number of groups");
  const w = sizes.map((s) => s / total);
  const fixed = new Array<boolean>(w.length).fill(false);
  for (let iter = 0; iter < w.length; iter++) {
    let excess = 0;
    let freeMass = 0;
    for (let i = 0; i < w.length; i++) {
      if (!fixed[i] && w[i]! > cap) {
        excess += w[i]! - cap;
        w[i] = cap;
        fixed[i] = true;
      }
    }
    if (excess === 0) break;
    for (let i = 0; i < w.length; i++) if (!fixed[i]) freeMass += w[i]!;
    for (let i = 0; i < w.length; i++) if (!fixed[i]) w[i] = w[i]! + (excess * w[i]!) / freeMass;
  }
  return w;
}

/**
 * The share a player is scored against: qualifying votes on the prompt, minus the player's
 * own vote, their crew's votes and any flagged crew, with the crew cap when enough crews
 * are active.
 */
export function referenceCrowd(
  votes: readonly Vote[],
  player: { playerId: string; crewId: string | null },
  flaggedCrews: ReadonlySet<string> = new Set(),
): ReferenceCrowd {
  const kept = votes.filter(
    (v) =>
      v.qualifying &&
      v.playerId !== player.playerId &&
      (player.crewId === null || v.crewId !== player.crewId) &&
      (v.crewId === null || !flaggedCrews.has(v.crewId)),
  );
  const n = kept.length;
  if (n < MIN_REFERENCE_CROWD) return { status: "void", n, reason: "below_minimum_crowd" };

  const groups = new Map<string, { size: number; yes: number }>();
  for (const v of kept) {
    const g = groups.get(groupKey(v)) ?? { size: 0, yes: 0 };
    g.size += 1;
    if (v.yes) g.yes += 1;
    groups.set(groupKey(v), g);
  }
  const activeCrews = [...groups.keys()].filter((k) => !k.startsWith("solo:")).length;
  const list = [...groups.values()];
  const capped = activeCrews >= CREW_CAP_MIN_ACTIVE_CREWS;
  const weights = capped ? cappedWeights(list.map((g) => g.size), CREW_WEIGHT_CAP) : list.map((g) => g.size / n);
  const share = list.reduce((acc, g, i) => acc + weights[i]! * (g.yes / g.size), 0);
  return { status: "resolved", n, share, capped, excludedCrews: [...flaggedCrews] };
}

/** The plain share shown on the reveal card: all qualifying votes. */
export function revealedShare(votes: readonly Vote[]): number | null {
  const q = votes.filter((v) => v.qualifying);
  if (q.length === 0) return null;
  return q.filter((v) => v.yes).length / q.length;
}

export interface CrewDayVote {
  playerId: string;
  crewId: string;
  promptId: string;
  yes: boolean;
}

/**
 * Crews to exclude from reference crowds and flag for review, for one day.
 * Rule A: on every prompt that day, 90% or more of the crew voted the same way.
 * Rule B: every member who answered all prompts gave an identical vote string.
 * Applies only to crews of BLOC_MIN_CREW_SIZE or more voters that day.
 */
export function flagBlocCrews(dayVotes: readonly CrewDayVote[]): Set<string> {
  const prompts = [...new Set(dayVotes.map((v) => v.promptId))].sort();
  const byCrew = new Map<string, CrewDayVote[]>();
  for (const v of dayVotes) byCrew.set(v.crewId, [...(byCrew.get(v.crewId) ?? []), v]);
  const flagged = new Set<string>();
  for (const [crewId, vs] of byCrew) {
    const members = [...new Set(vs.map((v) => v.playerId))];
    if (members.length < BLOC_MIN_CREW_SIZE || prompts.length === 0) continue;
    const ruleA = prompts.every((p) => {
      const pv = vs.filter((v) => v.promptId === p);
      if (pv.length === 0) return false;
      const yes = pv.filter((v) => v.yes).length;
      return Math.max(yes, pv.length - yes) / pv.length >= BLOC_SAME_WAY_SHARE;
    });
    const strings = members
      .map((m) => prompts.map((p) => vs.find((v) => v.playerId === m && v.promptId === p)))
      .filter((row) => row.every((v) => v !== undefined))
      .map((row) => row.map((v) => (v!.yes ? "1" : "0")).join(""));
    const ruleB = strings.length >= BLOC_MIN_CREW_SIZE && new Set(strings).size === 1;
    if (ruleA || ruleB) flagged.add(crewId);
  }
  return flagged;
}

export type Call =
  | { kind: "probability"; p: number | null; threshold: number }
  | { kind: "range"; lower: number | null; upper: number | null };

/** Points for one call against a resolved reference share. A null answer is a skip. */
export function callPoints(call: Call, referenceShare: number): { points: number; skipped: boolean } {
  if (call.kind === "probability") {
    const skipped = call.p === null;
    const p = call.p ?? SKIP_PROBABILITY;
    return { points: probabilityPoints(p, thresholdPassed(referenceShare, call.threshold)), skipped };
  }
  const skipped = call.lower === null || call.upper === null;
  const [l, u] = skipped ? SKIP_RANGE : [call.lower!, call.upper!];
  return { points: rangePoints(l, u, referenceShare), skipped };
}

export interface QualifyingInput {
  researchConsentActive: boolean;
  declared18Plus: boolean;
  lockedBeforeCrowdInfo: boolean;
  firstExposure: boolean;
  practice: boolean;
  provenanceComplete: boolean;
  accountPassesQuality: boolean;
  promptResolved: boolean;
  dayHadSkips: boolean;
  crewFlagged: boolean;
}

/** Plan v0.4 section 2 conditions plus the three Daily Call conditions. Returns the failed reasons. */
export function qualificationFailures(q: QualifyingInput): string[] {
  const fails: string[] = [];
  if (!q.researchConsentActive) fails.push("no_research_consent");
  if (!q.declared18Plus) fails.push("no_age_declaration");
  if (!q.lockedBeforeCrowdInfo) fails.push("not_locked_before_crowd_info");
  if (!q.firstExposure) fails.push("not_first_exposure");
  if (q.practice) fails.push("practice_mode");
  if (!q.provenanceComplete) fails.push("provenance_incomplete");
  if (!q.accountPassesQuality) fails.push("account_quality");
  if (!q.promptResolved) fails.push("prompt_void");
  if (q.dayHadSkips) fails.push("day_had_skips");
  if (q.crewFlagged) fails.push("crew_flagged");
  return fails;
}
