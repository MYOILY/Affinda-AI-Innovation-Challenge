import { loadVolunteers, loadWorld } from "../lib/data";
import { advance, fmtClock, pendingLate } from "../lib/clock";
import { applyPlan, coverageNow, generatePlan } from "../lib/roster";

const world = loadWorld();
let vols = loadVolunteers();
for (const t of [14 * 60 + 5, 14 * 60 + 8, 14 * 60 + 10]) {
  const r = advance(world, vols, t, 1);
  vols = r.vols;
  console.log(`\n[${fmtClock(t)}] late:`, pendingLate(vols, t).map((l) => `${l.volunteer.name} ${l.minutesLate}m`), "flagged:", r.flagged.map((v) => v.name));
}

const plan = generatePlan(world, vols, { strategy: "fast" });
console.log("\nSEATS:", plan.seats.map((s) => `${s.zone} ${s.shifts.join("+")}`));
console.log("SEARCH:", plan.search);
for (const m of plan.moves) {
  console.log(`\n${m.kind.toUpperCase()}  ${m.name}  ${m.source}  ${m.fromZone} -> ${m.toZone}  ${m.shifts.join("+")}  ${m.etaMin} min`);
  console.log("  why:", m.why.join(" | "));
  if (m.cautions.length) console.log("  caution:", m.cautions.join(" | "));
  console.log("  alts:", m.alternates.map((a) => a.name).join(", "));
}
console.log("\nOPEN:", plan.open);
const after = applyPlan(vols, plan).vols;
console.log("After approve, gaps:", coverageNow(world, after).filter((r) => r.have < r.need), "replan seats:", generatePlan(world, after, { strategy: "fast" }).seats.length);

// Brute-force check: is the CSP answer really the cheapest?
console.log("\nOptimal (complete search):", plan.search.complete);
