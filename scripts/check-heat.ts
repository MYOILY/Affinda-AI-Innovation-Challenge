import { loadVolunteers, loadWorld } from "../lib/data";
import { advance, DEMO_START_MIN, fmtClock } from "../lib/clock";
import { fmtDuration, HEAT_LIMIT_MIN, radioScript, sunWatch } from "../lib/heat";

const world = loadWorld();
let vols = advance(world, loadVolunteers(), DEMO_START_MIN).vols;
console.log("Limit:", HEAT_LIMIT_MIN, "min. Watchlist at", fmtClock(DEMO_START_MIN));
sunWatch(vols).slice(0, 5).forEach((r) => console.log("  ", r.volunteer.name.padEnd(18), r.volunteer.currentZone.padEnd(14), fmtDuration(r.minutes), r.level, `limit in ${r.minutesLeft}m`));

let t = DEMO_START_MIN;
const events: string[] = [];
while (t < DEMO_START_MIN + 40) {
  t += 1;
  const r = advance(world, vols, t, 1);
  vols = r.vols;
  r.flagged.forEach((v) => events.push(`${fmtClock(t)} NO-SHOW ${v.name}`));
  r.overheated.forEach((v) => events.push(`${fmtClock(t)} HEAT   ${v.name} (${v.currentZone}) sun ${fmtDuration(v.sunMin)}`));
}
console.log("\nEvents over 40 minutes:\n  " + events.join("\n  "));
const m = vols.find((v) => v.name === "Marcus Murphy")!;
console.log("\nScript:", radioScript({ kind: "reminder", firstName: m.firstName, zone: m.satZone, sunMin: HEAT_LIMIT_MIN, tempC: 38 }));
console.log("Script:", radioScript({ kind: "relieved", firstName: m.firstName, zone: m.satZone, sunMin: 0, tempC: 38 }));
