import { describe, expect, it } from "vitest";
import {
  SCORING_VERSION,
  THRESHOLDS,
  ScoringInputError,
  callPoints,
  cappedWeights,
  drawThreshold,
  flagBlocCrews,
  intervalScore,
  probabilityPoints,
  qualificationFailures,
  rangePoints,
  referenceCrowd,
  revealedShare,
  type CrewDayVote,
  type Vote,
} from "../src/index";

// Golden values produced by daily_call_sim.py (the simulation used for spec v0.1), 12 Nov 2026.
const GOLDEN_P: Array<[number, boolean, number]> = [
  [0.7, true, 91.0],
  [0.7, false, 51.0],
  [0.5, true, 75.0],
  [0.01, true, 1.99],
  [0.99, false, 1.99],
  [0.63, true, 86.31],
];
const GOLDEN_R: Array<[number, number, number, number]> = [
  [0.4, 0.6, 0.5, 80.0],
  [0.4, 0.6, 0.3, -20.0],
  [0.4, 0.6, 0.75, -70.0],
  [0, 1, 0.2, 0.0],
  [0.55, 0.55, 0.55, 100.0],
  [0.1, 0.2, 0.9, -610.0],
  [0.32, 0.47, 0.512, 43.0],
];

describe("dc-1 points match the simulation to 0.01", () => {
  it("is version dc-1", () => expect(SCORING_VERSION).toBe("dc-1"));
  it.each(GOLDEN_P)("probability %s outcome %s -> %s", (p, o, want) => {
    expect(probabilityPoints(p, o)).toBeCloseTo(want, 2);
  });
  it.each(GOLDEN_R)("range [%s, %s] truth %s -> %s", (l, u, x, want) => {
    expect(rangePoints(l, u, x)).toBeCloseTo(want, 2);
  });
});

describe("input validation", () => {
  it("rejects probabilities outside 1% to 99%", () => {
    expect(() => probabilityPoints(0, true)).toThrow(ScoringInputError);
    expect(() => probabilityPoints(1, true)).toThrow(ScoringInputError);
  });
  it("rejects inverted ranges", () => expect(() => intervalScore(0.6, 0.4, 0.5)).toThrow(ScoringInputError));
  it("does not floor range points at zero", () => expect(rangePoints(0.1, 0.2, 0.9)).toBeLessThan(0));
});

describe("properness: honest reporting maximises expected points", () => {
  it("probability call: expected points peak at the true probability", () => {
    for (const q of [0.1, 0.3, 0.5, 0.72, 0.9]) {
      const exp = (p: number) => q * probabilityPoints(p, true) + (1 - q) * probabilityPoints(p, false);
      const grid = Array.from({ length: 99 }, (_, i) => (i + 1) / 100);
      const best = grid.reduce((a, b) => (exp(b) > exp(a) ? b : a));
      expect(best).toBeCloseTo(q, 2);
    }
  });
  it("range call: expected points peak at the 10th and 90th percentiles", () => {
    // Discrete belief over the share: uniform on 0.30..0.70 in steps of 0.01 (41 points).
    const support = Array.from({ length: 41 }, (_, i) => 0.3 + i / 100);
    const exp = (l: number, u: number) => support.reduce((a, x) => a + rangePoints(l, u, x), 0) / support.length;
    let best = { l: 0, u: 0, v: -Infinity };
    for (let l = 0.25; l <= 0.5; l += 0.01) for (let u = 0.5; u <= 0.75; u += 0.01) {
      const v = exp(l, u);
      if (v > best.v) best = { l, u, v };
    }
    expect(best.l).toBeGreaterThanOrEqual(0.33);
    expect(best.l).toBeLessThanOrEqual(0.35);
    expect(best.u).toBeGreaterThanOrEqual(0.65);
    expect(best.u).toBeLessThanOrEqual(0.67);
  });
});

describe("thresholds", () => {
  it("draws only the seven allowed values, evenly", () => {
    const seen = new Map<number, number>();
    for (let i = 0; i < 7000; i++) {
      const t = drawThreshold(i / 7000);
      seen.set(t, (seen.get(t) ?? 0) + 1);
    }
    expect([...seen.keys()].sort()).toEqual([...THRESHOLDS]);
    for (const c of seen.values()) expect(c).toBe(1000);
  });
});

function crowd(spec: Array<[crew: string | null, yes: number, no: number]>): Vote[] {
  const votes: Vote[] = [];
  let id = 0;
  for (const [crewId, yes, no] of spec) {
    for (let i = 0; i < yes; i++) votes.push({ playerId: `p${id++}`, crewId, yes: true, qualifying: true });
    for (let i = 0; i < no; i++) votes.push({ playerId: `p${id++}`, crewId, yes: false, qualifying: true });
  }
  return votes;
}

describe("reference crowd", () => {
  it("leaves out the player's own crew, so a crew bloc cannot move its members' truth", () => {
    const honest = crowd([["A", 10, 10], ["B", 15, 15], [null, 10, 10]]);
    const bloc = crowd([["A", 20, 0], ["B", 15, 15], [null, 10, 10]]);
    const me = { playerId: "zz", crewId: "A" };
    const a = referenceCrowd(honest, me);
    const b = referenceCrowd(bloc, me);
    expect(a.status).toBe("resolved");
    if (a.status === "resolved" && b.status === "resolved") expect(b.share).toBe(a.share);
  });
  it("leaves out the player's own vote", () => {
    const votes = crowd([[null, 20, 20]]);
    const me = votes[0]!;
    const r = referenceCrowd(votes, { playerId: me.playerId, crewId: null });
    expect(r.status === "resolved" && r.n).toBe(39);
  });
  it("voids below 30 reference votes", () => {
    const r = referenceCrowd(crowd([["A", 10, 10], [null, 14, 15]]), { playerId: "x", crewId: "A" });
    expect(r).toEqual({ status: "void", n: 29, reason: "below_minimum_crowd" });
  });
  it("ignores non-qualifying votes", () => {
    const votes = crowd([[null, 20, 20]]).map((v, i) => ({ ...v, qualifying: i % 2 === 0 }));
    const r = referenceCrowd(votes, { playerId: "x", crewId: null });
    expect(r.status).toBe("void");
  });
  it("drops flagged crews", () => {
    const votes = crowd([["A", 30, 0], ["B", 20, 20]]);
    const r = referenceCrowd(votes, { playerId: "x", crewId: null }, new Set(["A"]));
    expect(r.status === "resolved" && r.share).toBe(0.5);
  });
  it("applies no cap with fewer than 15 crews", () => {
    const r = referenceCrowd(crowd([["A", 60, 0], ["B", 20, 20]]), { playerId: "x", crewId: null });
    expect(r.status === "resolved" && r.capped).toBe(false);
    expect(r.status === "resolved" && r.share).toBeCloseTo(0.8, 10);
  });
  it("caps any crew at 10% once 15 crews are active", () => {
    const spec: Array<[string, number, number]> = [["BIG", 100, 0]];
    for (let c = 0; c < 15; c++) spec.push([`c${c}`, 2, 2]);
    const r = referenceCrowd(crowd(spec), { playerId: "x", crewId: null });
    expect(r.status === "resolved" && r.capped).toBe(true);
    // BIG weighs 10%, all yes; the rest weigh 90% at 50% yes.
    expect(r.status === "resolved" && r.share).toBeCloseTo(0.1 + 0.9 * 0.5, 10);
  });
  it("capped weights sum to one and respect the cap", () => {
    const w = cappedWeights([50, 30, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], 0.1);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    for (const x of w) expect(x).toBeLessThanOrEqual(0.1 + 1e-12);
  });
  it("reveal card shows the plain share of all qualifying votes", () => {
    expect(revealedShare(crowd([["A", 3, 1]]))).toBe(0.75);
  });
});

describe("bloc detection", () => {
  const day = (crewId: string, members: number, pattern: (m: number, p: number) => boolean): CrewDayVote[] => {
    const out: CrewDayVote[] = [];
    for (let m = 0; m < members; m++) for (let p = 0; p < 5; p++)
      out.push({ playerId: `${crewId}-${m}`, crewId, promptId: `q${p}`, yes: pattern(m, p) });
    return out;
  };
  it("flags a crew voting as one", () => {
    expect(flagBlocCrews(day("A", 10, () => true))).toEqual(new Set(["A"]));
  });
  it("flags identical vote strings even when they vary across prompts", () => {
    expect(flagBlocCrews(day("A", 10, (_m, p) => p % 2 === 0))).toEqual(new Set(["A"]));
  });
  it("does not flag a crew that splits on some prompts", () => {
    expect(flagBlocCrews(day("A", 10, (m, p) => (p === 0 ? m < 5 : true))).size).toBe(0);
  });
  it("does not apply to crews under the minimum size", () => {
    expect(flagBlocCrews(day("A", 4, () => true)).size).toBe(0);
  });
});

describe("calls and skips", () => {
  it("scores a skipped probability call as 50%", () => {
    expect(callPoints({ kind: "probability", p: null, threshold: 0.5 }, 0.7)).toEqual({ points: 75, skipped: true });
  });
  it("scores a skipped range call as 0 to 100", () => {
    expect(callPoints({ kind: "range", lower: null, upper: null }, 0.4)).toEqual({ points: 0, skipped: true });
  });
  it("scores probability outcomes on strictly above the threshold", () => {
    expect(callPoints({ kind: "probability", p: 0.8, threshold: 0.5 }, 0.5).points).toBeCloseTo(36, 10);
  });
});

describe("qualifying", () => {
  const ok = {
    researchConsentActive: true, declared18Plus: true, lockedBeforeCrowdInfo: true, firstExposure: true,
    practice: false, provenanceComplete: true, accountPassesQuality: true, promptResolved: true,
    dayHadSkips: false, crewFlagged: false,
  };
  it("passes a clean record", () => expect(qualificationFailures(ok)).toEqual([]));
  it("names each failure", () => {
    expect(qualificationFailures({ ...ok, researchConsentActive: false, dayHadSkips: true })).toEqual([
      "no_research_consent",
      "day_had_skips",
    ]);
  });
});
