/**
 * A small constraint-satisfaction / optimisation solver.
 *
 *   Variables    one per open seat to fill
 *   Domain       every legal way to fill it (including "leave it open", at a heavy cost)
 *   Constraint   all-different: one person can only do one job, so any two chosen options
 *                must not use the same volunteer
 *   Objective    lowest total cost
 *
 * Search is depth-first backtracking with most-constrained-variable ordering and
 * branch-and-bound pruning, so when it finishes the answer is provably the cheapest.
 */

export interface Option<T> {
  cost: number;
  /** Volunteer ids this option consumes. Two options sharing an id conflict. */
  uses: string[];
  payload: T;
}

export interface Variable<T> {
  id: string;
  options: Option<T>[];
}

export interface Solution<T> {
  choice: Option<T>[];
  cost: number;
  nodes: number;
  pruned: number;
  complete: boolean;
  space: number;
}

export function solve<T>(variables: Variable<T>[], maxNodes = 300_000): Solution<T> {
  // Cheapest-first inside each domain finds good solutions early, which tightens the bound.
  const vars = variables.map((v) => ({ ...v, options: [...v.options].sort((a, b) => a.cost - b.cost) }));
  const order = vars.map((_, i) => i).sort((a, b) => vars[a].options.length - vars[b].options.length);
  const minCost = vars.map((v) => (v.options.length ? v.options[0].cost : 0));
  // Suffix sums of the best possible cost for the variables still to place (an admissible bound).
  const suffix: number[] = new Array(order.length + 1).fill(0);
  for (let k = order.length - 1; k >= 0; k--) suffix[k] = suffix[k + 1] + minCost[order[k]];

  const used = new Set<string>();
  const current: (Option<T> | undefined)[] = new Array(vars.length).fill(undefined);
  let best: (Option<T> | undefined)[] = [];
  let bestCost = Infinity;
  let nodes = 0;
  let pruned = 0;
  let complete = true;

  const dfs = (k: number, cost: number) => {
    if (nodes >= maxNodes) {
      complete = false;
      return;
    }
    nodes++;
    if (k === order.length) {
      if (cost < bestCost) {
        bestCost = cost;
        best = [...current];
      }
      return;
    }
    if (cost + suffix[k] >= bestCost) {
      pruned++;
      return;
    }
    const vi = order[k];
    for (const opt of vars[vi].options) {
      if (cost + opt.cost + suffix[k + 1] >= bestCost) {
        pruned++;
        continue; // options are sorted, but later ones can only be worse
      }
      if (opt.uses.some((id) => used.has(id))) continue;
      opt.uses.forEach((id) => used.add(id));
      current[vi] = opt;
      dfs(k + 1, cost + opt.cost);
      current[vi] = undefined;
      opt.uses.forEach((id) => used.delete(id));
    }
  };

  dfs(0, 0);

  const space = vars.reduce((n, v) => n * Math.max(1, v.options.length), 1);
  return {
    choice: best.length ? (best as Option<T>[]) : [],
    cost: bestCost === Infinity ? 0 : bestCost,
    nodes,
    pruned,
    complete,
    space,
  };
}
