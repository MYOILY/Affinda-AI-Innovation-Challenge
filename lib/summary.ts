import { Plan } from "./types";

const first = (name: string) => name.split(" ")[0];

/** Deterministic plain-English summary of a plan. Used as the fallback when no AI key is set. */
export function summarisePlan(plan: Plan): string {
  const covers = plan.moves.filter((m) => m.kind === "cover");
  const backfills = plan.moves.filter((m) => m.kind === "backfill");
  if (!covers.length) return "Nobody free to cover. Needs your call.";
  // One sentence per post: a plan can cover more than one zone (e.g. Medical and a heat relief at Gate B).
  const zones = [...new Set(covers.map((m) => m.toZone))];
  let s = zones
    .map((zone) => {
      const here = covers.filter((m) => m.toZone === zone);
      const names = here.map((m) => `${first(m.name)} (${m.source === "onsite" ? `posted at ${m.fromZone}, ${m.etaMin - 2} min` : "idle at hub"})`);
      return `${names.join(" and ")} cover${here.length === 1 ? "s" : ""} ${zone}.`;
    })
    .join(" ");
  if (backfills.length) s += ` Idle ${backfills.length === 1 ? "volunteer refills" : "volunteers refill"} the vacated post${backfills.length === 1 ? "" : "s"}.`;
  if (plan.open.length) s += ` ${plan.open.length} slot${plan.open.length === 1 ? "" : "s"} still open.`;
  return s;
}
