import { Volunteer } from "./types";

/** Sharon sends a radio reminder (drink water, find shade) each time someone has had this long in the sun. */
export const REMIND_EVERY_MIN = 90;
/** From here Sharon recommends relieving the volunteer. A person approves it, nothing moves on its own. */
export const RELIEF_MIN = 150;
/** Shown as "getting close" on the watchlist. */
export const RELIEF_SOON_MIN = RELIEF_MIN - 30;

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

export type SunLevel = "ok" | "soon" | "relief";

export interface SunRow {
  volunteer: Volunteer;
  minutes: number;
  /** Minutes until relief is recommended at the current rate. 0 if already past it. */
  minutesLeft: number;
  level: SunLevel;
}

/** Everyone working a post, ranked by how long they have been in the sun. */
export function sunWatch(vols: Volunteer[]): SunRow[] {
  return vols
    // Someone flagged for relief and waiting on Mo's sign-off stays on the list until it is approved.
    .filter((v) => v.onSite && v.sunMin > 0 && (v.status === "on_shift" || v.status === "en_route" || (v.status === "heat_out" && v.reliefDue)))
    .map((v) => ({
      volunteer: v,
      minutes: Math.round(v.sunMin),
      minutesLeft: Math.max(0, Math.round(RELIEF_MIN - v.sunMin)),
      level: (v.sunMin >= RELIEF_MIN ? "relief" : v.sunMin >= RELIEF_SOON_MIN ? "soon" : "ok") as SunLevel,
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
 * The announcement as Sharon, the AI assistant, would say it into a volunteer's earpiece: a friendly
 * opener with their name, one fact, one instruction. Short, because nobody retains a long message.
 */
export function radioScript(f: RadioFacts): string {
  if (f.kind === "relieved") {
    return `Hey ${f.firstName}, this is Sharon. You are relieved. Walk to the Break Area, rest for twenty minutes and drink some water.`;
  }
  return `Hey ${f.firstName}, this is Sharon. You have been in the sun for ${spokenDuration(f.sunMin)}. Remember to drink some water and take any shade you can.`;
}
