/**
 * Incident handling: a transcribed radio call becomes one structured incident with an urgency,
 * a place and a recommended action. Pure, no I/O. The rules here are also the floor for the AI:
 * a model can word things better or add context, but it can never rate a call below what these
 * rules say.
 */
import { zoneOf } from "./report";
import { IDLE_RESPONSE_MIN, walkMinutes } from "./roster";
import { Volunteer, World } from "./types";

export type Urgency = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type Category = "Medical" | "Heat" | "Crowd" | "Security" | "Lost child" | "Fire / hazard" | "Facility" | "Routine";

export const URGENCIES: Urgency[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
export const CATEGORIES: Category[] = ["Medical", "Heat", "Crowd", "Security", "Lost child", "Fire / hazard", "Facility", "Routine"];
export const urgencyRank = (u: Urgency) => URGENCIES.length - URGENCIES.indexOf(u);

export interface Classification {
  urgency: Urgency;
  category: Category;
  /** Where it is happening. null when the call did not say. */
  zone: string | null;
  summary: string;
  action: string;
  source: "ai" | "rules";
}

interface Rule {
  re: RegExp;
  category: Category;
  urgency: Urgency;
  summary: (z: string) => string;
  action: (z: string) => string;
}

const RULES: Rule[] = [
  {
    // Someone climbing in with a tool that doubles as a weapon is not a "log only" call.
    re: /\b(crowbar|machete|bolt ?cutters?|tyre iron|baseball bat)\b/i,
    category: "Security",
    urgency: "CRITICAL",
    summary: (z) => `Intruder with a tool or weapon at ${z}`,
    action: (z) => `Call police on 000 and send security to ${z}. Volunteers keep people clear, nobody approaches.`,
  },
  {
    // A patron with heat illness needs a medic's eyes, unlike a tired volunteer who needs a break.
    re: /\b(heat ?(exhaustion|stroke)|sunstroke)\b/i,
    category: "Medical",
    urgency: "HIGH",
    summary: (z) => `Heat exhaustion at ${z}`,
    action: (z) => `Send a first-aider to ${z} with water and shade.`,
  },
  {
    re: /\b(unconscious|unresponsive|(not|isn'?t|aren'?t|no longer) (responding|breathing|moving|waking)|no response|stopped breathing|seizure|fitting|cardiac|heart attack|collaps\w+|passed out|out cold|(man|woman|person|guy|girl|someone|patron|kid|child)( is| has)?( gone)? down|gone down|bleeding (heavily|badly)|code red|choking|anaphyla\w+)\b/i,
    category: "Medical",
    urgency: "CRITICAL",
    summary: (z) => `Person down at ${z}`,
    action: (z) => `Send medics to ${z} now. Call 000 if they do not respond.`,
  },
  {
    re: /\b(fire|smoke|burning|explosion|gas leak)\b/i,
    category: "Fire / hazard",
    urgency: "CRITICAL",
    summary: (z) => `Fire or smoke at ${z}`,
    action: (z) => `Clear the area around ${z} and call 000.`,
  },
  {
    re: /\b(weapon|knife|gun|armed)\b/i,
    category: "Security",
    urgency: "CRITICAL",
    summary: (z) => `Weapon reported at ${z}`,
    action: (z) => `Keep people back from ${z}. Call police on 000.`,
  },
  {
    re: /\b(crush(ed|ing)?|stampede|surge|trampled)\b/i,
    category: "Crowd",
    urgency: "CRITICAL",
    summary: (z) => `Crowd crush risk at ${z}`,
    action: (z) => `Stop entry to ${z} and send stewards to open space.`,
  },
  {
    re: /\b(lost (kid|child|boy|girl|toddler|little)|missing (kid|child)|separated from (his|her|their) (mum|mom|dad|parents?))\b/i,
    category: "Lost child",
    urgency: "HIGH",
    summary: (z) => `Lost child near ${z}`,
    action: () => `Keep the child with a steward and take them to Lost Children Point.`,
  },
  {
    re: /\b(fight\w*|brawl|assault\w*|intruder|unauthori[sz]ed|trespass\w*|(climb\w*|jump\w*) (over )?(the |a )?(perimeter |boundary )?fence|over the fence|break(ing)?[- ]?in|breach\w*|aggressive|threaten\w*|harass\w*|theft|stolen|spiked|spiking)\b/i,
    category: "Security",
    urgency: "HIGH",
    summary: (z) => `Security issue at ${z}`,
    action: (z) => `Send security to ${z}. Stewards keep people clear.`,
  },
  {
    re: /\b(pushing|overcrowd\w*|too many people|packed|blocking (the )?(exit|gate|path)|queue (is )?(backing|backed|blocked)|crowd (is )?(building|getting))\b/i,
    category: "Crowd",
    urgency: "HIGH",
    summary: (z) => `Crowd building at ${z}`,
    action: (z) => `Send 2 stewards to ${z} and open an extra lane.`,
  },
  {
    re: /\b(injur\w+|sprain\w*|broken (arm|leg|ankle|wrist)|bleeding|vomit\w*|allerg\w+|asthma|bee sting|fainted|needs? (a )?medic)\b/i,
    category: "Medical",
    urgency: "HIGH",
    summary: (z) => `Person needs first aid at ${z}`,
    action: (z) => `Send a first-aider to ${z}.`,
  },
  {
    re: /\b(heat|dizzy|faint(ing)?|overheat\w*|sunstroke|exhaust\w+|cramp\w*|woozy|pale|wobbl\w+)\b/i,
    category: "Heat",
    urgency: "MEDIUM",
    summary: (z) => `Heat illness at ${z}`,
    action: (z) => `Get them into shade with water. A medic checks them at ${z}.`,
  },
  {
    re: /\b(spill|slippery|leak\w*|power (out|cut)|blackout|trip hazard|cable|fallen|sharp|glass|blocked)\b/i,
    category: "Fire / hazard",
    urgency: "MEDIUM",
    summary: (z) => `Hazard at ${z}`,
    action: (z) => `Cordon off the spot at ${z} and send a steward.`,
  },
  {
    re: /\b(out of|run(ning)? (low|out)|ran out|empty|toilets?|bins?|ice|cups|restock|long (queue|line)|queue)\b/i,
    category: "Facility",
    urgency: "LOW",
    summary: (z) => `Supplies or queue issue at ${z}`,
    action: (z) => `Log it and ask a runner to restock ${z}.`,
  },
];

/** A named place that is not one of the festival zones, in the caller's own words. */
export function spotOf(text: string): string | null {
  // Most specific first: "warehouse B" beats "perimeter fence".
  for (const re of [/\bwarehouse ([a-z0-9])\b/i, /\bloading bays?\b/i, /\bback ?stage\b/i, /\bcar ?park\b/i, /\bservice (?:gate|road)\b/i, /\b(?:perimeter|back) fence\b/i]) {
    const m = re.exec(text);
    if (!m) continue;
    const s = m[1] ? `warehouse ${m[1].toUpperCase()}` : m[0].toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return null;
}

/** Reads a call with rules only. Always available, always the safety floor. */
export function classifyRules(text: string): Classification {
  const zone = zoneOf(text);
  // The most serious matching rule wins; for equal urgency, the earlier (more specific) rule.
  let best: Rule | null = null;
  for (const r of RULES) if (r.re.test(text) && (!best || urgencyRank(r.urgency) > urgencyRank(best.urgency))) best = r;
  // Off-map places (back-of-house, perimeter) still help Mo find the spot even when no zone matches.
  const z = zone ?? spotOf(text) ?? "site";
  if (!best) {
    return { urgency: "LOW", category: "Routine", zone, summary: "Routine radio check", action: "Log only. No action needed.", source: "rules" };
  }
  return { urgency: best.urgency, category: best.category, zone, summary: best.summary(z), action: best.action(z), source: "rules" };
}

/**
 * Combine a model's reading with the rules. The model may improve the wording and the place, but
 * the urgency can only go up from the rules, never down. A missed CRITICAL is the worst failure.
 */
export function mergeAi(rules: Classification, ai: Partial<Classification> | null, zones: string[]): Classification {
  if (!ai) return rules;
  const urgency = ai.urgency && URGENCIES.includes(ai.urgency) && urgencyRank(ai.urgency) > urgencyRank(rules.urgency) ? ai.urgency : rules.urgency;
  const category = ai.category && CATEGORIES.includes(ai.category) && urgency === ai.urgency ? ai.category : rules.category;
  const zone = ai.zone && zones.includes(ai.zone) ? ai.zone : rules.zone;
  const ok = (s: unknown, max: number): s is string => typeof s === "string" && s.trim().length > 0 && s.length <= max;
  return {
    urgency,
    category,
    zone,
    summary: ok(ai.summary, 90) ? ai.summary.trim() : rules.summary,
    action: ok(ai.action, 140) ? ai.action.trim() : rules.action,
    source: "ai",
  };
}

// ---------------------------------------------------------------- the incident log

export interface Incident extends Classification {
  id: string;
  /** Minutes after midnight when it was first reported. */
  at: number;
  /** Every call about it, newest last. More than one means duplicates were merged. */
  calls: { text: string; at: number; via: "typed" | "voice" | "audio" }[];
  status: "open" | "handled";
  handledNote?: string;
}

/** Two calls about the same kind of thing in the same place, close together, are one incident. */
export const MERGE_WINDOW_MIN = 15;

export function addCall(
  log: Incident[],
  c: Classification,
  call: { text: string; at: number; via: "typed" | "voice" | "audio" },
): { log: Incident[]; incident: Incident; merged: boolean } {
  const dup = log.find((i) => i.status === "open" && i.category === c.category && i.zone === c.zone && c.category !== "Routine" && call.at - i.at <= MERGE_WINDOW_MIN);
  if (dup) {
    const raised = urgencyRank(c.urgency) > urgencyRank(dup.urgency);
    const merged: Incident = {
      ...dup,
      urgency: raised ? c.urgency : dup.urgency,
      summary: raised ? c.summary : dup.summary,
      action: raised ? c.action : dup.action,
      calls: [...dup.calls, call],
    };
    return { log: log.map((i) => (i.id === dup.id ? merged : i)), incident: merged, merged: true };
  }
  const incident: Incident = { ...c, id: `I${log.length + 1}-${call.at}`, at: call.at, calls: [call], status: "open" };
  return { log: [incident, ...log], incident, merged: false };
}

export const openIncidents = (log: Incident[]) =>
  log
    .filter((i) => i.status === "open" && i.urgency !== "LOW")
    .sort((a, b) => urgencyRank(b.urgency) - urgencyRank(a.urgency) || b.at - a.at);

// ---------------------------------------------------------------- link to the roster

export interface Responder {
  volunteerId: string;
  name: string;
  firstName: string;
  etaMin: number;
}

/**
 * Nearest idle, first-aid-certified volunteer already on site. Only idle people are offered:
 * pulling someone off a post would just open a new gap, and the Medical Tent keeps its own team.
 */
export function nearestFirstAider(world: World, vols: Volunteer[], zone: string | null): Responder | null {
  if (!zone) return null;
  const idle = vols.filter((v) => v.onSite && v.status === "standby" && v.certs.includes("first_aid"));
  const ranked = idle
    .map((v) => ({ v, eta: IDLE_RESPONSE_MIN + walkMinutes(world, v.currentZone, zone) }))
    .sort((a, b) => a.eta - b.eta);
  const top = ranked[0];
  return top ? { volunteerId: top.v.id, name: top.v.name, firstName: top.v.firstName, etaMin: top.eta } : null;
}

export const needsFirstAider = (i: Incident) => i.category === "Medical" || i.category === "Heat";

export function responderMessage(r: Responder, i: Incident): string {
  return `Hi ${r.firstName}, this is Sharon. ${i.summary}. Can you go now and help until medics arrive? ~${r.etaMin} min. Reply Y/N.`;
}
