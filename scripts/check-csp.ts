import { Option, solve, Variable } from "../lib/csp";

// Compare the solver to exhaustive enumeration on random small problems.
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
let bad = 0;
const TRIALS = 500;
for (let t = 0; t < TRIALS; t++) {
  const people = Array.from({ length: 2 + Math.floor(rnd() * 5) }, (_, i) => `p${i}`);
  const vars: Variable<null>[] = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, v) => {
    const options: Option<null>[] = [{ cost: 500, uses: [], payload: null }]; // leave open
    for (const p of people) {
      if (rnd() < 0.7) {
        const uses = rnd() < 0.3 ? [p, people[Math.floor(rnd() * people.length)]] : [p]; // some options use two people
        options.push({ cost: Math.floor(rnd() * 100), uses: [...new Set(uses)], payload: null });
      }
    }
    return { id: `v${v}`, options };
  });
  // brute force
  let best = Infinity;
  const go = (k: number, used: Set<string>, cost: number) => {
    if (k === vars.length) { best = Math.min(best, cost); return; }
    for (const o of vars[k].options) {
      if (o.uses.some((u) => used.has(u))) continue;
      const n = new Set(used); o.uses.forEach((u) => n.add(u));
      go(k + 1, n, cost + o.cost);
    }
  };
  go(0, new Set(), 0);
  const sol = solve(vars);
  const clash = new Set<string>();
  let dup = false;
  sol.choice.forEach((o) => o.uses.forEach((u) => { if (clash.has(u)) dup = true; clash.add(u); }));
  if (sol.cost !== best || dup || !sol.complete) { bad++; console.log("MISMATCH", { best, got: sol.cost, dup }); }
}
console.log(`${TRIALS - bad}/${TRIALS} random problems: solver cost == brute-force optimum, no volunteer double-booked`);
