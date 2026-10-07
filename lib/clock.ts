import { HEAT_LIMIT_MIN } from "./heat";
import { Volunteer, World } from "./types";

/** Minutes after midnight. The demo opens at 2:05pm, five minutes into the 2pm shift. */
export const DEMO_START_MIN = 14 * 60 + 5;
/** The rule: not checked in this long after shift start, the agent acts without being asked. */
export const LATE_RULE_MIN = 10;

export function fmtClock(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}${h >= 12 ? "pm" : "am"}`;
}

export interface Late {
  volunteer: Volunteer;
  minutesLate: number;
}

/** People who should be here by now but have not checked in. */
export function pendingLate(vols: Volunteer[], clockMin: number): Late[] {
  return vols
    .filter((v) => v.status === "expected" && v.expectedStartMin !== null && clockMin > v.expectedStartMin)
    .map((v) => ({ volunteer: v, minutesLate: clockMin - (v.expectedStartMin as number) }))
    .sort((a, b) => b.minutesLate - a.minutesLate);
}

export interface Advance {
  vols: Volunteer[];
  /** Missed check-ins that just hit the late rule. */
  flagged: Volunteer[];
  /** People who just crossed the sun limit and have not been reminded yet. */
  overheated: Volunteer[];
}

/**
 * Move the clock forward by `dt` minutes to `clockMin`.
 *  - People check in when their check-in time passes.
 *  - Anyone still missing LATE_RULE_MIN minutes after shift start is flagged as a no-show.
 *  - Everyone working a post builds up sun time at their zone's exposure rate. Crossing
 *    HEAT_LIMIT_MIN flags them once, so the monitor sends one reminder, not a stream.
 */
export function advance(world: World, vols: Volunteer[], clockMin: number, dt = 0): Advance {
  const flagged: Volunteer[] = [];
  const overheated: Volunteer[] = [];
  const factor = new Map(world.zones.map((z) => [z.zone, z.sunFactor]));

  const next = vols.map((v) => {
    if (v.status === "expected" && v.expectedStartMin !== null) {
      if (v.checkInMin !== null && v.checkInMin <= clockMin) {
        const since = Math.max(0, clockMin - v.checkInMin);
        return {
          ...v,
          status: "on_shift" as const,
          currentZone: v.satZone,
          onSite: true,
          minutesOnShift: clockMin - v.expectedStartMin,
          minutesSinceBreak: since,
          sunMin: since * (factor.get(v.satZone) ?? 0),
        };
      }
      if (clockMin - v.expectedStartMin >= LATE_RULE_MIN) {
        const out = { ...v, status: "no_show" as const, currentZone: "Unknown" };
        flagged.push(out);
        return out;
      }
      return v;
    }

    if (dt > 0 && v.status === "on_shift") {
      let cur: Volunteer = {
        ...v,
        minutesOnShift: v.minutesOnShift + dt,
        minutesSinceBreak: (v.minutesSinceBreak ?? 0) + dt,
        sunMin: v.sunMin + dt * (factor.get(v.currentZone) ?? 0),
      };
      if (cur.sunMin >= HEAT_LIMIT_MIN && !cur.heatReminded) {
        cur = { ...cur, heatReminded: true };
        overheated.push(cur);
      }
      return cur;
    }
    return v;
  });
  return { vols: next, flagged, overheated };
}
