import { Volunteer } from "./types";

/** Minutes in direct sun since the last break at which the monitor sends a radio reminder. */
export const HEAT_LIMIT_MIN = 150;
/** Minutes at which someone shows as "getting close" on the watchlist. */
export const HEAT_WARN_MIN = 120;

export function fmtDuration(min: number): string {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

/** How a radio operator would say it: "2 hours 30 minutes", "2 hours". */
export function spokenDuration(min: number): string {
  const m = Math.round(min / 5) * 5;
  const h = Math.floor(m / 60);
  const r = m % 60;
  const hours = h ? `${h} hour${h === 1 ? "" : "s"}` : "";
  const mins = r ? `${r} minutes` : "";
  return [hours, mins].filter(Boolean).join(" ") || "a while";
}

export type SunLevel = "ok" | "warn" | "over";

export interface SunRow {
  volunteer: Volunteer;
  minutes: number;
  /** Minutes until the limit at the current rate of exposure. 0 if already past it. */
  minutesLeft: number;
  level: SunLevel;
}

/** Everyone working a post, ranked by how long they have been in the sun. */
export function sunWatch(vols: Volunteer[]): SunRow[] {
  return vols
    // Someone reminded and waiting on Mo's sign-off stays on the list until relief is approved.
    .filter((v) => v.onSite && v.sunMin > 0 && (v.status === "on_shift" || v.status === "en_route" || (v.status === "heat_out" && v.heatReminded)))
    .map((v) => ({
      volunteer: v,
      minutes: Math.round(v.sunMin),
      minutesLeft: Math.max(0, Math.round(HEAT_LIMIT_MIN - v.sunMin)),
      level: (v.sunMin >= HEAT_LIMIT_MIN ? "over" : v.sunMin >= HEAT_WARN_MIN ? "warn" : "ok") as SunLevel,
    }))
    .sort((a, b) => b.minutes - a.minutes);
}

export type RadioKind = "reminder" | "relieved";

export interface RadioFacts {
  kind: RadioKind;
  firstName: string;
  zone: string;
  sunMin: number;
  tempC: number;
}

/**
 * The announcement as Mina, the AI assistant, would say it into a volunteer's earpiece: a friendly
 * opener with their name, one fact, one instruction. Short, because nobody retains a long message.
 */
export function radioScript(f: RadioFacts): string {
  if (f.kind === "relieved") {
    return `Hey ${f.firstName}, this is Mina. You are relieved. Walk to the Break Area, rest for twenty minutes and drink some water.`;
  }
  return `Hey ${f.firstName}, this is Mina. You have been in the sun for ${spokenDuration(f.sunMin)}. Remember to drink some water and take any shade you can.`;
}
