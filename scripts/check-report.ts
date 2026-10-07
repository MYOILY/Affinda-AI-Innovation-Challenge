import { loadVolunteers } from "../lib/data";
import { parseReport } from "../lib/report";

const vols = loadVolunteers();
const roster = vols
  .filter((v) => (v.status === "on_shift" || v.status === "on_break" || v.status === "expected") && v.satShifts.includes("S2"))
  .map((v) => ({ id: v.id, name: v.name, firstName: v.firstName, zone: v.satZone, role: v.satRole }));
const name = (id: string) => vols.find((v) => v.id === id)!.name;

const tests = [
  "Medical to base, Finn and Uma haven't turned up. We're two down, over.",
  "Marcus on Gate B has gone dizzy, needs to sit down, over",
  "Finn Nguyen didn't show and Marcus at gate b is overheating",
  "Water queue is huge, about forty deep",
  "Someone from medical hasn't shown",
  "Hana's not here",
  "We will need more ice at water",
];
for (const t of tests) {
  const r = parseReport(t, roster);
  console.log(`\n"${t}"`);
  console.log("  events:", r.events.map((e) => `${e.kind}:${name(e.volunteerId)}`));
  console.log("  ambiguous:", r.ambiguous.map((a) => `${a.word}=>${a.options.map((o) => o.name + "@" + o.zone).join("/")}`));
  console.log("  unclear:", r.unclear);
}
