import { addCall, classifyRules, mergeAi, nearestFirstAider, openIncidents, Incident } from "../lib/incident";
import { loadVolunteers, loadWorld } from "../lib/data";
import { advance, DEMO_START_MIN } from "../lib/clock";
import { RADIO_CALLS } from "../lib/radio-calls";

const cases: [string, string, string | null, string][] = [
  ["Main Stage to base, a guy's unconscious near the front barrier, need medics, over.", "CRITICAL", "Main Stage", "Medical"],
  ["Lawn stage, someone collapsed by the barrier", "CRITICAL", "Lawn Stage", "Medical"],
  ["Gate A queue is backing up and people are pushing", "HIGH", "Gate A", "Crowd"],
  ["We've got a lost little girl at the Food Court, about five", "HIGH", "Food Court", "Lost child"],
  ["Two blokes fighting behind the Bar Zone", "HIGH", "Bar Zone", "Security"],
  ["Marcus on Gate B has gone dizzy, needs to sit down, over.", "MEDIUM", "Gate B", "Heat"],
  ["Spill near the Riverbank path, slippery", "MEDIUM", "Riverbank", "Fire / hazard"],
  ["Gate A is out of water", "LOW", "Gate A", "Facility"],
  ["Water queue is huge, about forty deep", "LOW", "Water Station", "Facility"],
  ["Radio check, all good at Info Hub", "LOW", "Info Hub", "Routine"],
  ["Smoke coming from the Food Court stall", "CRITICAL", "Food Court", "Fire / hazard"],
  ["Main Stage again, that person down by the barrier is not responding, over.", "CRITICAL", "Main Stage", "Medical"],
  ["Man down at Gate A", "CRITICAL", "Gate A", "Medical"],
  ["Someone's passed out near the bar", "CRITICAL", "Bar Zone", "Medical"],
  ["She's not breathing, Riverbank, hurry", "CRITICAL", "Riverbank", "Medical"],
  ["We're going down to the Lawn Stage to grab lunch", "LOW", "Lawn Stage", "Routine"],
  // The two recorded walkie calls used in the demo
  ...RADIO_CALLS.map((c): [string, string, string | null, string] =>
    c.id === "heat" ? [c.transcript, "HIGH", "Main Stage", "Medical"] : [c.transcript, "CRITICAL", null, "Security"],
  ),
  ["Medics to the Medical Tent please, a volunteer's cramping", "MEDIUM", "Medical Tent", "Heat"],
  ["Unit two, someone's climbing the fence by the car park", "HIGH", null, "Security"],
];
let bad = 0;
for (const [t, u, z, c] of cases) {
  const r = classifyRules(t);
  const ok = r.urgency === u && r.zone === z && r.category === c;
  if (!ok) bad++;
  console.log(ok ? "ok  " : "FAIL", r.urgency.padEnd(8), (r.zone ?? "-").padEnd(14), r.category.padEnd(14), "|", r.action);
  if (!ok) console.log("     expected", u, z, c);
}

// The intruder call names an off-map place; Mo should see where
const intruder = classifyRules(RADIO_CALLS[1].transcript);
console.log("\nintruder summary:", intruder.summary);
if (!/Warehouse B/.test(intruder.summary)) bad++;

// A model can never lower urgency
const crit = classifyRules(cases[0][0]);
const lowered = mergeAi(crit, { urgency: "LOW", category: "Routine", summary: "all fine", action: "Nothing" }, ["Main Stage"]);
console.log("\nAI tries to downgrade CRITICAL ->", lowered.urgency, lowered.category, lowered.urgency === "CRITICAL" ? "(blocked, good)" : "FAIL");
if (lowered.urgency !== "CRITICAL") bad++;
const raised = mergeAi(classifyRules("Radio check"), { urgency: "HIGH", category: "Security", zone: "Gate A", summary: "Man climbing fence at Gate A", action: "Send security to Gate A" }, ["Gate A"]);
console.log("AI raises LOW ->", raised.urgency, raised.category, raised.zone);

// Duplicate merging
let log: Incident[] = [];
const a = addCall(log, classifyRules(cases[0][0]), { text: "a", at: 845, via: "typed" }); log = a.log;
const b = addCall(log, classifyRules("Main Stage, person down near the barrier, not breathing"), { text: "b", at: 847, via: "voice" }); log = b.log;
const c2 = addCall(log, classifyRules("Lawn Stage, someone collapsed"), { text: "c", at: 848, via: "typed" }); log = c2.log;
console.log("\nmerged:", a.merged, b.merged, c2.merged, "| incidents:", log.length, "| calls on first:", log.find((i) => i.zone === "Main Stage")!.calls.length);
if (log.length !== 2 || !b.merged || c2.merged) bad++;

// Demo pile-up: six overlapping scraps, four incidents, two of them merged
const CHAOS = [
  "Gate A to base, the queue is backing up and people are pushing, over.",
  "Food Court, we've got a lost little girl, pink hat, about five, over.",
  "Yeah Gate A again, they're crushing at the front, stop the entry, over.",
  "Lawn Stage to base, someone collapsed by the barrier, need a medic NOW, over.",
  "Bar to base, two blokes fighting behind the bar, over.",
  "Lawn Stage again, she's not responding, send medics, over.",
];
let chaos: Incident[] = [];
const chaosAdds = CHAOS.map((t, i) => {
  const r = addCall(chaos, classifyRules(t), { text: t, at: 845 + i, via: "typed" as const });
  chaos = r.log;
  return r;
});
const gate = chaos.find((i) => i.zone === "Gate A");
const lawn = chaos.find((i) => i.zone === "Lawn Stage");
console.log(
  "\npile-up:",
  chaos.length,
  "incidents |",
  chaos.map((i) => `${i.urgency} ${i.category} ${i.zone} x${i.calls.length}`).join(" · "),
);
if (chaos.length !== 4 || gate?.calls.length !== 2 || lawn?.calls.length !== 2 || gate?.urgency !== "CRITICAL" || lawn?.urgency !== "CRITICAL") {
  bad++;
  console.log("pile-up FAIL");
}
if (!chaosAdds[2].merged || !chaosAdds[5].merged || chaosAdds[1].merged || chaosAdds[4].merged) {
  bad++;
  console.log("pile-up merge flags FAIL");
}
console.log("open:", openIncidents(log).map((i) => `${i.urgency} ${i.zone}`).join(", "));

// Link to the roster
const world = loadWorld();
const vols = advance(world, loadVolunteers(), DEMO_START_MIN).vols;
console.log("\nNearest first-aider to Main Stage:", nearestFirstAider(world, vols, "Main Stage"));
console.log("Nearest first-aider to Gate A:", nearestFirstAider(world, vols, "Gate A"));
if (!nearestFirstAider(world, vols, "Main Stage")) bad++;
console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
