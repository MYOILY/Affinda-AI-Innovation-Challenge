/** Turns a messy radio / voice scrap into roster events. Pure, no I/O, safe to run anywhere. */

export interface RosterRow {
  id: string;
  name: string;
  firstName: string;
  zone: string;
  role: string;
}

export type EventKind = "no_show" | "heat_out";

export interface ReportEvent {
  kind: EventKind;
  volunteerId: string;
}

export interface Ambiguity {
  kind: EventKind;
  word: string;
  options: { id: string; name: string; zone: string }[];
}

export interface ReportResult {
  source: "ai" | "rules";
  events: ReportEvent[];
  ambiguous: Ambiguity[];
  /** Report mentioned an absence or heat problem but we could not tell who. */
  unclear: boolean;
}

const ZONE_ALIASES: [string, RegExp][] = [
  ["Medical Tent", /\b(medical|med tent|first aid tent|medics?)\b/i],
  ["Water Station", /\bwater( station| point)?\b/i],
  ["Gate A", /\bgate a\b/i],
  ["Gate B", /\bgate b\b/i],
  ["Lawn Stage", /\blawn\b/i],
  ["Main Stage", /\bmain stage\b/i],
  ["Riverbank", /\briver ?bank\b/i],
  ["Food Court", /\bfood( court)?\b/i],
  ["Bar Zone", /\bbar\b/i],
  ["Info Hub", /\binfo( hub| desk)?\b/i],
  ["Lost Children Point", /\blost (kids?|child(ren)?)\b/i],
];

const HEAT = /\b(heat|dizzy|faint(ing|ed)?|overheat\w*|sunstroke|wobbl\w+|collaps\w+|unwell|exhaust\w+|cramp\w*|not (feeling )?(well|good)|needs? (a )?(break|to sit|water|shade)|feeling sick|woozy|pale)\b/i;
const ABSENT =
  /\b(no[- ]?shows?|(haven'?t|hasn'?t|didn'?t|not|never|still not|yet to)\s+(\w+\s+){0,2}(shown|show|turn(ed)?|arriv\w*|here|rock\w*|check\w*)|missing|absent|can'?t make|cancell?ed|bailed|pulled out|(is|are)\s+late|ghosted)\b/i;

/** Names that are also ordinary English words: only match when written with a capital. */
const CAPITAL_ONLY = new Set(["will", "grace", "sam", "may", "mark", "pia"]);

const zoneIn = (s: string) => ZONE_ALIASES.find(([, re]) => re.test(s))?.[0];

/**
 * The zone a transmission is about. Radio calls open with the place ("Main Stage to base..."),
 * so the earliest mention wins, and a bare "water" (as in "out of water") does not count as the
 * Water Station when a real place is named.
 */
export function zoneOf(text: string): string | null {
  const hits = ZONE_ALIASES.map(([zone, re]) => {
    const m = new RegExp(re.source, "i").exec(text);
    return m ? { zone, at: m.index, bare: zone === "Water Station" && !/station|point/i.test(m[0]) } : null;
  }).filter((h): h is { zone: string; at: number; bare: boolean } => h !== null);
  const solid = hits.filter((h) => !h.bare);
  const pool = solid.length ? solid : hits;
  return pool.sort((a, b) => a.at - b.at)[0]?.zone ?? null;
}
const kindOf = (s: string): EventKind | null => (HEAT.test(s) ? "heat_out" : ABSENT.test(s) ? "no_show" : null);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function parseReport(text: string, roster: RosterRow[]): ReportResult {
  const events: ReportEvent[] = [];
  const ambiguous: Ambiguity[] = [];
  const seen = new Set<string>();
  let anyProblem = false;
  let anyFound = false;

  const sentences = text.split(/[.;!?\n]+/).map((s) => s.trim()).filter(Boolean);
  let lastZone: string | undefined;

  for (const sentence of sentences) {
    const sentenceZone = zoneIn(sentence) ?? lastZone;
    if (zoneIn(sentence)) lastZone = zoneIn(sentence);

    // One sentence can hold two problems ("Finn didn't show and Marcus is overheating").
    // Split into clauses; a clause with no verb of its own ("Finn" in "Finn and Uma haven't...")
    // takes the problem from the clause that follows it.
    const clauses = sentence.split(/\s*(?:,|\band\b|\bbut\b)\s*/i).filter(Boolean);
    const kinds: (EventKind | null)[] = clauses.map(kindOf);
    for (let i = clauses.length - 1; i >= 0; i--) if (!kinds[i] && kinds[i + 1]) kinds[i] = kinds[i + 1];
    for (let i = 0; i < clauses.length; i++) if (!kinds[i] && kinds[i - 1]) kinds[i] = kinds[i - 1];
    if (!kinds.some(Boolean)) continue;
    anyProblem = true;

    clauses.forEach((clause, i) => {
      const kind = kinds[i];
      if (!kind) return;
      const zone = zoneIn(clause) ?? sentenceZone;
      const found = new Set<string>();

      // 1. Full names (and mask them so "Finn Nguyen" does not also match a volunteer called Nguyen).
      let masked = clause;
      for (const r of roster) {
        const re = new RegExp(escapeRe(r.name), "i");
        if (re.test(masked)) {
          found.add(r.id);
          masked = masked.replace(re, " ");
        }
      }

      // 2. First names, narrowed by zone when the report names one.
      const words = (masked.match(/[A-Za-z\u2019'-]+/g) ?? []).map((w) => w.replace(/['\u2019]s$/i, ""));
      const tried = new Set<string>();
      for (const w of words) {
        const wl = w.toLowerCase();
        if (tried.has(wl)) continue;
        tried.add(wl);
        if (CAPITAL_ONLY.has(wl) && w[0] !== w[0].toUpperCase()) continue;
        let cands = roster.filter((r) => r.firstName.toLowerCase() === wl && !found.has(r.id));
        if (!cands.length) continue;
        if (zone) {
          const inZone = cands.filter((c) => c.zone === zone);
          if (inZone.length) cands = inZone;
        }
        if (cands.length === 1) found.add(cands[0].id);
        else ambiguous.push({ kind, word: w, options: cands.slice(0, 5).map((c) => ({ id: c.id, name: c.name, zone: c.zone })) });
      }

      for (const id of found) {
        anyFound = true;
        const key = `${kind}:${id}`;
        if (!seen.has(key)) {
          seen.add(key);
          events.push({ kind, volunteerId: id });
        }
      }
    });
  }
  return { source: "rules", events, ambiguous, unclear: anyProblem && !anyFound && !ambiguous.length };
}
