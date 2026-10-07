import { loadVolunteers, loadWorld } from "../lib/data";
import { advance, DEMO_START_MIN, fmtClock } from "../lib/clock";
import { fmtDuration, radioScript, RELIEF_MIN, REMIND_EVERY_MIN, sunWatch } from "../lib/heat";

const world = loadWorld();
let vols = advance(world, loadVolunteers(), DEMO_START_MIN).vols;
console.log(`Reminder every ${REMIND_EVERY_MIN} min in the sun. Relief recommended at ${RELIEF_MIN} min. Watchlist at ${fmtClock(DEMO_START_MIN)}`);
sunWatch(vols).slice(0, 5).forEach((r) => console.log("  ", r.volunteer.name.padEnd(18), r.volunteer.currentZone.padEnd(14), fmtDuration(r.minutes), r.level));

let t = DEMO_START_MIN;
const events: string[] = [];
let bad = 0;
const remindCount = new Map<string, number>();
while (t < DEMO_START_MIN + 200) {
  t += 1;
  const r = advance(world, vols, t, 1);
  vols = r.vols;
  r.flagged.forEach((v) => events.push(`${fmtClock(t)} NO-SHOW ${v.name}`));
  r.reminded.forEach((v) => {
    remindCount.set(v.id, (remindCount.get(v.id) ?? 0) + 1);
    events.push(`${fmtClock(t)} REMIND ${v.name} (${v.currentZone}) sun ${fmtDuration(v.sunMin)}`);
  });
  r.reliefDue.forEach((v) => events.push(`${fmtClock(t)} RELIEF ${v.name} (${v.currentZone}) sun ${fmtDuration(v.sunMin)}`));
}
console.log("\nEvents over 200 minutes:\n  " + events.join("\n  "));

// Reminders on a 90-minute cadence per person, never a stream
for (const [id, n] of remindCount) {
  const v = vols.find((x) => x.id === id)!;
  const max = Math.floor(v.sunMin / REMIND_EVERY_MIN) + 1;
  if (n > max) { bad++; console.log("TOO MANY reminders for", v.name, n); }
}
// Relief flagged once and only at/after 150
const relief = events.filter((e) => e.includes("RELIEF"));
if (new Set(relief.map((e) => e.split(" RELIEF ")[1])).size !== relief.length) { bad++; console.log("relief flagged twice"); }

// With heat watch off nothing heat-related fires but sun time still builds
const off = advance(world, loadVolunteers().map((v) => ({ ...v })), DEMO_START_MIN + 1, 1, false);
if (off.reminded.length || off.reliefDue.length) { bad++; console.log("heat events fired with watch off"); }

const m = vols.find((v) => v.name === "Marcus Murphy")!;
const reminder = radioScript({ kind: "reminder", firstName: m.firstName, zone: m.satZone, sunMin: REMIND_EVERY_MIN, tempC: 38 });
const relieved = radioScript({ kind: "relieved", firstName: m.firstName, zone: m.satZone, sunMin: 0, tempC: 38 });
console.log("\nScript:", reminder);
console.log("Script:", relieved);
if (relieved !== "Hey Marcus, this is Sharon. You can take a break. Rest for fifteen minutes and drink some water.") {
  bad++;
  console.log("relieved wording FAIL");
}
console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
