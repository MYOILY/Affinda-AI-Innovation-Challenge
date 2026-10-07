import { Option, solve, Variable } from "./csp";
import { fmtDuration, RELIEF_MIN, RELIEF_SOON_MIN } from "./heat";
import {
  Candidate,
  Move,
  Notification,
  NOW_SHIFT,
  OpenSeat,
  Plan,
  Requirement,
  Seat,
  Shift,
  SHIFT_START,
  SHIFTS,
  Strategy,
  Volunteer,
  World,
} from "./types";

/** Roles where a person must never be pulled off post to cover something else. */
const SAFETY_CRITICAL_ROLES = new Set(["First Aid", "Lost Children"]);
const MAX_BLOCK_SHIFTS = 2; // 8 hours max in the heat
export const IDLE_RESPONSE_MIN = 3; // time to read the text and say yes, for someone idle at the hub
const HANDOVER_MIN = 2;

const ROLE_NOUN: Record<string, string> = {
  "First Aid": "first-aider",
  "Water Station": "water volunteer",
  "Crowd Steward": "crowd steward",
  "Gate Entry": "gate steward",
  "Info Desk": "info desk volunteer",
  "Lost Children": "Lost Children Point volunteer",
  "Food Court Support": "food court volunteer",
  "Bar Support": "bar volunteer",
  "Stage Crew": "stage crew",
};

const idx = (s: Shift) => SHIFTS.indexOf(s);

// ---------------------------------------------------------------- geometry

export function walkMinutes(world: World, a: string, b: string): number {
  const za = world.zones.find((z) => z.zone === a);
  const zb = world.zones.find((z) => z.zone === b);
  if (!za || !zb) return 10;
  const d = Math.hypot(za.x - zb.x, za.y - zb.y);
  return Math.max(1, Math.round(d / 80));
}

// ---------------------------------------------------------------- eligibility

function roleRule(world: World, role: string) {
  const r = world.requirements.find((x) => x.role === role);
  return { cert: r?.requiredCert ?? null, minAge: r?.minAge ?? 18 };
}

export function isEligible(world: World, v: Volunteer, role: string): boolean {
  const { cert, minAge } = roleRule(world, role);
  if (v.age < minAge) return false;
  if (cert && !v.certs.includes(cert)) return false;
  return true;
}

// ---------------------------------------------------------------- coverage

function coversShift(v: Volunteer, shift: Shift): boolean {
  if (v.status === "no_show" || v.status === "finished") return false;
  // Resting in the heat only takes someone out of the current shift, not the evening.
  if (v.status === "heat_out" && shift === NOW_SHIFT) return false;
  return v.satShifts.includes(shift);
}

export interface CoverageRow {
  zone: string;
  role: string;
  need: number;
  have: number;
}

/** Coverage for a single shift (default: the shift happening right now). */
export function coverageNow(world: World, vols: Volunteer[], shift: Shift = NOW_SHIFT): CoverageRow[] {
  return world.requirements
    .filter((r) => r.shift === shift)
    .map((r) => ({
      zone: r.zone,
      role: r.role,
      need: r.headcount,
      have: vols.filter((v) => v.satZone === r.zone && v.satRole === r.role && coversShift(v, shift)).length,
    }));
}

function missingFor(world: World, vols: Volunteer[], req: Requirement) {
  const have = vols.filter((v) => v.satZone === req.zone && v.satRole === req.role && coversShift(v, req.shift)).length;
  return Math.max(0, req.headcount - have);
}

/** Every unfilled seat from now onwards, grouped so one person can cover back-to-back shifts. */
export function buildSeats(world: World, vols: Volunteer[]): Seat[] {
  const seats: Seat[] = [];
  const keys = new Map<string, { zone: string; role: string }>();
  for (const r of world.requirements) keys.set(`${r.zone}|${r.role}`, { zone: r.zone, role: r.role });

  for (const { zone, role } of keys.values()) {
    const miss: Partial<Record<Shift, number>> = {};
    for (const s of SHIFTS) {
      if (idx(s) < idx(NOW_SHIFT)) continue;
      const req = world.requirements.find((r) => r.zone === zone && r.role === role && r.shift === s);
      if (req) miss[s] = missingFor(world, vols, req);
    }
    const inSlot = (st: Volunteer["status"]) => vols.filter((v) => v.status === st && v.satZone === zone && v.satRole === role).map((v) => v.name);
    const because = inSlot("no_show");
    const becauseHeat = inSlot("heat_out");
    const later = SHIFTS.filter((s) => idx(s) > idx(NOW_SHIFT));
    let n = 0;
    // Seats spanning NOW and the next shift first, then leftovers.
    const nowMiss = miss[NOW_SHIFT] ?? 0;
    const nextShift = later[0];
    const nextMiss = nextShift ? miss[nextShift] ?? 0 : 0;
    const both = Math.min(nowMiss, nextMiss);
    for (let i = 0; i < both; i++) seats.push(mkSeat(zone, role, [NOW_SHIFT, nextShift], n++, because, becauseHeat));
    for (let i = 0; i < nowMiss - both; i++) seats.push(mkSeat(zone, role, [NOW_SHIFT], n++, because, becauseHeat));
    for (const s of later) {
      const m = (miss[s] ?? 0) - (s === nextShift ? both : 0);
      for (let i = 0; i < m; i++) seats.push(mkSeat(zone, role, [s], n++, because, becauseHeat));
    }
  }
  return seats.sort((a, b) => Number(b.urgent) - Number(a.urgent) || criticality(b.role) - criticality(a.role));
}

function criticality(role: string) {
  return SAFETY_CRITICAL_ROLES.has(role) ? 1 : 0;
}

function mkSeat(zone: string, role: string, shifts: Shift[], n: number, because: string[], becauseHeat: string[]): Seat {
  return { id: `${zone}|${role}|${shifts.join("+")}|${n}`, zone, role, shifts, urgent: shifts.includes(NOW_SHIFT), because, becauseHeat };
}

// ---------------------------------------------------------------- candidates

/** Which of a seat's shifts can this person actually take, without breaching the heat/length cap? */
function coverShifts(v: Volunteer, seat: Seat, source: "standby" | "onsite"): Shift[] {
  const avail = new Set<Shift>(v.availSat);
  let worked = 0;
  if (source === "onsite") {
    v.satShifts.forEach((s) => avail.add(s));
    worked = v.satShifts.filter((s) => idx(s) < idx(NOW_SHIFT)).length;
  }
  const room = MAX_BLOCK_SHIFTS - worked;
  const out: Shift[] = [];
  for (const s of seat.shifts) {
    if (!avail.has(s) || out.length >= room) break;
    // must be contiguous from the first covered shift
    if (out.length && idx(s) !== idx(out[out.length - 1]) + 1) break;
    out.push(s);
  }
  return out;
}

interface RankOpts {
  strategy: Strategy;
  used: Set<string>;
}

function rank(world: World, vols: Volunteer[], seat: Seat, opts: RankOpts, allowOnsite: boolean): Candidate[] {
  const out: Candidate[] = [];
  for (const v of vols) {
    if (opts.used.has(v.id)) continue;
    if (!isEligible(world, v, seat.role)) continue;

    // Only people already at the event: working a post, or idle at the Volunteer Hub.
    let source: "standby" | "onsite";
    if (v.status === "standby" && v.onSite) source = "standby";
    else if (v.status === "on_shift" && v.onSite && allowOnsite) source = "onsite";
    else continue;

    // People who asked not to be moved only fill in for the role they signed up for.
    if (!v.flexible && v.preferredRole !== seat.role) continue;

    if (source === "onsite") {
      if (SAFETY_CRITICAL_ROLES.has(v.satRole)) continue; // never strip a safety post
      if (v.satZone === seat.zone) continue;
    }

    const covers = coverShifts(v, seat, source);
    if (!covers.includes(seat.shifts[0])) continue;

    const eta =
      source === "standby"
        ? IDLE_RESPONSE_MIN + walkMinutes(world, "Volunteer Hub", seat.zone)
        : walkMinutes(world, v.currentZone, seat.zone) + HANDOVER_MIN;

    const why: string[] = [];
    const cautions: string[] = [];
    let score = 100;

    const cert = roleRule(world, seat.role).cert;
    if (cert) why.push(`${cert.replace("_", " ")} certified`);
    if (v.preferredRole === seat.role) {
      score += 10;
      why.push(`Asked for ${seat.role}`);
    }
    if (seat.role === "First Aid" && v.skills.includes("first_responder_experience")) {
      score += 8;
      why.push("Has first-responder experience");
    }
    if (v.skills.includes("radio_comms")) score += 3;

    if (covers.length === seat.shifts.length) {
      score += 15;
      if (seat.shifts.length > 1) why.push("Can cover the whole gap");
    } else {
      score -= 8 * (seat.shifts.length - covers.length);
      cautions.push(`Only free for ${covers.join("+")}`);
    }

    if (v.experience === "returning") score += 5;
    score -= v.pastNoShows * 8;
    score -= v.movedToday * 12;

    if (source === "onsite") {
      why.push(`Posted at ${v.satZone} as ${v.satRole.toLowerCase()}, ${eta - HANDOVER_MIN} min away`);
      const sun = Math.round(v.sunMin);
      if (sun >= RELIEF_MIN) {
        score -= 25;
        cautions.push(`${fmtDuration(sun)} in the sun already`);
      } else if (sun >= RELIEF_SOON_MIN) {
        score -= 12;
        cautions.push(`${fmtDuration(sun)} in the sun`);
      }
      if (v.minutesOnShift >= 180) {
        score -= 15;
        cautions.push("On shift 4h already");
      }
    } else {
      why.push(`Idle at the hub, ${eta - IDLE_RESPONSE_MIN} min away, not on a post`);
    }

    // Strategy: Mo picks speed or the least disruption.
    score -= eta * (opts.strategy === "fast" ? 2.5 : 0.6);
    if (source === "onsite" && opts.strategy === "steady") score -= 40;

    out.push({
      volunteerId: v.id,
      name: v.name,
      source,
      fromZone: v.currentZone,
      etaMin: eta,
      covers,
      score: Math.round(score),
      why,
      cautions,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------- messages

function whenLabel(seat: { shifts: Shift[] }) {
  return seat.shifts[0] === NOW_SHIFT ? "now" : `from ${SHIFT_START[seat.shifts[0]]}`;
}

function untilLabel(shifts: Shift[]) {
  const last = shifts[shifts.length - 1];
  return last === "S1" ? "2pm" : last === "S2" ? "6pm" : "10pm";
}

function cleanZone(z: string) {
  return z;
}

export function draftMessage(world: World, v: Volunteer, m: { kind: "cover" | "backfill"; toZone: string; role: string; fromZone: string; shifts: Shift[]; etaMin: number; source: "standby" | "onsite" }): string {
  const noun = ROLE_NOUN[m.role] ?? m.role;
  const when = whenLabel({ shifts: m.shifts });
  const base = `Hi ${v.firstName}, this is Sharon from Riverside Ops.`;
  if (m.kind === "backfill") {
    return `${base} Can you cover ${cleanZone(m.toZone)} (${noun}) ${when} until ${untilLabel(m.shifts)}? ~${m.etaMin} min away. Reply Y/N.`;
  }
  if (m.source === "onsite") {
    return `${base} ${cleanZone(m.toZone)} is short a ${noun}. Can you head there now? ~${Math.max(1, m.etaMin - HANDOVER_MIN)} min from ${m.fromZone}. Thanks, reply Y/N.`;
  }
  return `${base} We need a ${noun} at ${cleanZone(m.toZone)} ${when} until ${untilLabel(m.shifts)}. Can you be there in ~${m.etaMin} min? Reply Y/N.`;
}

// ---------------------------------------------------------------- planner

export interface PlanOpts {
  strategy: Strategy;
  /** seatId -> volunteerId chosen by Mo instead of the top suggestion. */
  overrides?: Record<string, string>;
}

const COST_BASE = 200; // candidate cost = COST_BASE - score, so lower is better
const COST_UNFILLED = 500; // a seat nobody covers is the worst outcome
const COST_POST_LEFT_SHORT = 150; // moving someone off a post and not refilling it
const COST_PER_MOVE = 15; // every extra person who has to be moved and messaged

interface Pick {
  cover?: Candidate;
  backfill?: Candidate;
  backfillSeat?: Seat;
  leavesShort?: boolean;
}

/**
 * Propose how to cover every open seat, searching only people already at the event.
 *
 * This is a constraint-satisfaction search (see csp.ts), not a greedy pick:
 *   hard constraints  certificate, age, availability, 2-shift heat cap, willing to move,
 *                     never strip a First Aid / Lost Children post, one job per person
 *   cost              travel time, fit for the role, heat/fatigue, reliability, how many
 *                     people have to move, and whether the post they leave gets refilled
 * The result is the cheapest legal combination, with stats on what was searched.
 */
export function generatePlan(world: World, vols: Volunteer[], opts: PlanOpts): Plan {
  const seats = buildSeats(world, vols);
  const byId = new Map(vols.map((v) => [v.id, v]));
  const ranking = new Map<string, Candidate[]>();
  const eligibleIds = new Set<string>();

  const variables: Variable<Pick>[] = seats.map((seat) => {
    const ranked = rank(world, vols, seat, { strategy: opts.strategy, used: new Set() }, true);
    ranking.set(seat.id, ranked);
    ranked.forEach((c) => eligibleIds.add(c.volunteerId));

    // Mo's explicit choice narrows the domain to that person, if they are still a legal option.
    const forced = opts.overrides?.[seat.id];
    const pool = forced && ranked.some((c) => c.volunteerId === forced) ? ranked.filter((c) => c.volunteerId === forced) : ranked;

    const options: Option<Pick>[] = [];
    for (const c of pool) {
      const base = COST_BASE - c.score;
      if (c.source === "standby") {
        options.push({ cost: base, uses: [c.volunteerId], payload: { cover: c } });
        continue;
      }
      // An on-site mover leaves a post behind; the post needs refilling by someone idle.
      const src = byId.get(c.volunteerId)!;
      const leaving = src.satShifts.filter((s) => idx(s) >= idx(NOW_SHIFT));
      if (!leaving.length) {
        options.push({ cost: base + COST_PER_MOVE, uses: [c.volunteerId], payload: { cover: c } });
        continue;
      }
      const backfillSeat: Seat = {
        id: `${src.satZone}|${src.satRole}|${leaving.join("+")}|bf-${src.id}`,
        zone: src.satZone,
        role: src.satRole,
        shifts: leaving,
        urgent: true,
        because: [],
        becauseHeat: [],
      };
      const refills = rank(world, vols, backfillSeat, { strategy: opts.strategy, used: new Set([c.volunteerId]) }, false).slice(0, 3);
      for (const b of refills) {
        options.push({
          cost: base + (COST_BASE - b.score) + COST_PER_MOVE,
          uses: [c.volunteerId, b.volunteerId],
          payload: { cover: c, backfill: b, backfillSeat },
        });
      }
      options.push({
        cost: base + COST_POST_LEFT_SHORT + COST_PER_MOVE,
        uses: [c.volunteerId],
        payload: { cover: c, backfillSeat, leavesShort: true },
      });
    }
    options.push({ cost: COST_UNFILLED, uses: [], payload: {} });
    return { id: seat.id, options };
  });

  const sol = solve(variables);

  const moves: Move[] = [];
  const open: OpenSeat[] = [];

  const mkMove = (seat: Seat, kind: "cover" | "backfill", c: Candidate, alternates: Candidate[], extraWhy: string[] = []): Move => {
    const v = byId.get(c.volunteerId)!;
    const m = { kind, toZone: seat.zone, role: seat.role, fromZone: c.fromZone, shifts: c.covers, etaMin: c.etaMin, source: c.source };
    return {
      id: `${seat.id}:${kind}:${c.volunteerId}`,
      seatId: seat.id,
      kind,
      volunteerId: c.volunteerId,
      name: c.name,
      source: c.source,
      fromZone: c.fromZone,
      toZone: seat.zone,
      role: seat.role,
      shifts: c.covers,
      etaMin: c.etaMin,
      why: [...c.why, ...extraWhy],
      cautions: [...c.cautions],
      alternates,
      message: draftMessage(world, v, m),
    };
  };

  seats.forEach((seat, i) => {
    const pick = sol.choice[i]?.payload;
    if (!pick?.cover) {
      const offsite = vols.filter(
        (v) => v.status === "standby" && !v.onSite && isEligible(world, v, seat.role) && v.availSat.includes(seat.shifts[0]),
      ).length;
      open.push({
        zone: seat.zone,
        role: seat.role,
        shifts: seat.shifts,
        reason: offsite ? `Nobody on site is free. ${offsite} off-site could be called.` : "Nobody on site is free",
      });
      return;
    }
    const c = pick.cover;
    const alternates = (ranking.get(seat.id) ?? []).filter((x) => x.volunteerId !== c.volunteerId).slice(0, 4);
    const uncovered = seat.shifts.filter((s) => !c.covers.includes(s));
    if (uncovered.length) open.push({ zone: seat.zone, role: seat.role, shifts: uncovered, reason: `${c.name} is not free ${uncovered.join("+")}` });

    moves.push(mkMove(seat, "cover", c, alternates));
    const src = byId.get(c.volunteerId)!;
    if (pick.backfill && pick.backfillSeat) {
      moves.push({
        ...mkMove(pick.backfillSeat, "backfill", pick.backfill, [], [`Refills ${src.satZone} after ${src.firstName} moves`]),
        refillsFor: c.volunteerId,
      });
    } else if (pick.leavesShort && pick.backfillSeat) {
      open.push({ zone: src.satZone, role: src.satRole, shifts: pick.backfillSeat.shifts, reason: `${src.firstName} moved; nobody idle to refill` });
    }
  });

  const covers = moves.filter((m) => m.kind === "cover");
  const urgent = covers.filter((m) => m.shifts.includes(NOW_SHIFT));
  const coverEtaMin = urgent.length ? Math.max(...urgent.map((m) => m.etaMin)) : 0;
  const onSitePool = vols.filter((v) => v.onSite && v.status !== "finished" && v.status !== "no_show").length;

  return {
    strategy: opts.strategy,
    seats,
    moves,
    open,
    coverEtaMin,
    search: {
      onSitePool,
      seats: seats.length,
      eligible: eligibleIds.size,
      options: Math.min(sol.space, 999_999_999),
      nodes: sol.nodes,
      pruned: sol.pruned,
      complete: sol.complete,
      bestCost: Math.round(sol.cost),
    },
    signature: seats.map((s) => s.id).join(",") + "#" + moves.map((m) => m.id).join(","),
  };
}

// ---------------------------------------------------------------- applying

export function applyPlan(vols: Volunteer[], plan: Plan): { vols: Volunteer[]; notifications: Notification[] } {
  const notifications: Notification[] = [];
  const next = vols.map((v) => {
    const m = plan.moves.find((x) => x.volunteerId === v.id);
    if (!m) return v;
    notifications.push({ volunteerId: v.id, name: v.name, phone: v.phone, message: m.message });
    return {
      ...v,
      satZone: m.toZone,
      satRole: m.role,
      satShifts: m.shifts,
      status: "en_route" as const,
      currentZone: m.toZone,
      movedToday: v.movedToday + 1,
    };
  });
  return { vols: next, notifications };
}

export function markNoShow(vols: Volunteer[], id: string): Volunteer[] {
  return vols.map((v) => (v.id === id ? { ...v, status: "no_show" as const, currentZone: "Unknown" } : v));
}

export function markHeatOut(vols: Volunteer[], id: string): Volunteer[] {
  return vols.map((v) => (v.id === id ? { ...v, status: "heat_out" as const, currentZone: "Break Area" } : v));
}

/** After a heat relief is signed off: they are resting, so the sun clock starts again. */
export function markRested(vols: Volunteer[], ids: string[]): Volunteer[] {
  return vols.map((v) => (ids.includes(v.id) ? { ...v, sunMin: 0, minutesSinceBreak: 0, remindedAtMin: 0, reliefDue: false } : v));
}
