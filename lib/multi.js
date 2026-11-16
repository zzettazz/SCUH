// Varios objetivos a la vez: reparte tus CCUs para que no se pisen.
// Lógica pura, probada en tests/multi.test.js.
//
// Problema: un CCU (o una recompra) solo se puede gastar una vez. Si dos objetivos quieren el mismo,
// el orden importa. Probamos todos los órdenes posibles (hasta 6 objetivos) y nos quedamos con el más barato.

import { cheapestPath } from './chain.js';

export const MAX_GOALS = 6;

function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((p) => [x, ...p]));
}

// Copia del mapa con los recursos propios aún libres (se van quitando al usarlos).
function cloneResources(graph) {
  const copy = (m) => new Map([...(m ?? new Map())].map(([k, v]) => [k, [...v]]));
  return { owned: copy(graph.owned), buyback: copy(graph.buyback) };
}

function consume(res, route) {
  for (const s of route.steps) {
    if (!s.pledgeId) continue;
    const map = s.kind === 'Tuyo' ? res.owned : s.kind === 'Buy-back' ? res.buyback : null;
    const list = map?.get(s.fromId);
    if (!list) continue;
    const i = list.findIndex((c) => c.pledgeId === s.pledgeId);
    if (i >= 0) list.splice(i, 1);
  }
}

/**
 * @param goals [{ fromId, toId, label? }]
 * @returns { order, plans: [{ goal, route|null }], totalWithTax, unreachable }  (plans en el orden original)
 */
export function planMultiple(graph, goals, { taxRate = 0, useOwned = true, useBuyback = false } = {}) {
  if (goals.length === 0) return { order: [], plans: [], totalWithTax: 0, unreachable: 0 };
  if (goals.length > MAX_GOALS) throw new Error(`Máximo ${MAX_GOALS} objetivos a la vez.`);

  let best = null;
  for (const order of permutations(goals.map((_, i) => i))) {
    const res = cloneResources(graph);
    const plans = new Array(goals.length);
    let total = 0;
    let unreachable = 0;
    for (const i of order) {
      const g = { ...graph, owned: res.owned, buyback: res.buyback };
      const route = cheapestPath(g, goals[i].fromId, goals[i].toId, { taxRate, useOwned, useBuyback });
      plans[i] = { goal: goals[i], route };
      if (route) {
        total += route.totalWithTax;
        consume(res, route);
      } else unreachable++;
    }
    const candidate = { order, plans, totalWithTax: total, unreachable };
    if (!best || unreachable < best.unreachable || (unreachable === best.unreachable && total < best.totalWithTax)) best = candidate;
  }
  return best;
}

/** Lo que se ahorra frente a calcular cada objetivo por separado sin compartir recursos. */
export function sharedConflicts(graph, goals, opts = {}) {
  const alone = goals.map((g) => cheapestPath(graph, g.fromId, g.toId, opts));
  const used = new Map();
  alone.forEach((r, i) => {
    for (const s of r?.steps ?? []) {
      if (s.pledgeId) used.set(s.pledgeId, [...(used.get(s.pledgeId) ?? []), i]);
    }
  });
  return [...used.entries()].filter(([, idx]) => idx.length > 1).map(([pledgeId, idx]) => ({ pledgeId, goals: idx }));
}
