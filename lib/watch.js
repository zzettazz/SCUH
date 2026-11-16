// Avisos: qué ha cambiado en la tienda desde la última actualización y cómo van tus objetivos.
// Lógica pura, probada en tests/watch.test.js.

import { editionKind, planUpgrade } from './chain.js';

// Lista plana de ediciones a la venta: [{ toId, skuId, title, price, kind }]
function flatten(targets = []) {
  return targets.flatMap((t) =>
    (t.skus ?? [])
      .filter((s) => s.available !== false && s.price != null)
      .map((s) => ({ toId: t.id, skuId: s.id, title: s.title, price: s.price, kind: editionKind(s.title) })),
  );
}

/**
 * Compara dos fotos de los upgrades a la venta.
 * @returns { newWarbonds, goneWarbonds, priceChanges }  (priceChanges: misma edición, otro precio)
 */
export function diffStore(prevTargets, currTargets) {
  if (!prevTargets) return { newWarbonds: [], goneWarbonds: [], priceChanges: [] };
  const prev = new Map(flatten(prevTargets).map((s) => [s.skuId, s]));
  const curr = new Map(flatten(currTargets).map((s) => [s.skuId, s]));
  const newWarbonds = [...curr.values()].filter((s) => s.kind === 'Warbond' && !prev.has(s.skuId));
  const goneWarbonds = [...prev.values()].filter((s) => s.kind === 'Warbond' && !curr.has(s.skuId));
  const priceChanges = [...curr.values()]
    .filter((s) => prev.has(s.skuId) && prev.get(s.skuId).price !== s.price)
    .map((s) => ({ ...s, before: prev.get(s.skuId).price }));
  return { newWarbonds, goneWarbonds, priceChanges };
}

/**
 * Recalcula cada objetivo { fromId, toId, lastTotalWithTax } con el mapa actual.
 * Devuelve el objetivo con el precio de ahora y si ha bajado o subido.
 */
export function evaluateGoals(goals = [], graph, { taxRate = 0, useOwned = true, useBuyback = true } = {}) {
  return goals.map((g) => {
    const plan = planUpgrade(graph, g.fromId, g.toId, { taxRate, useOwned, useBuyback });
    const now = plan.best?.totalWithTax ?? null;
    const before = g.lastTotalWithTax ?? null;
    return {
      ...g,
      now,
      before,
      cheaper: now != null && before != null && now < before,
      pricier: now != null && before != null && now > before,
      unreachable: now == null,
    };
  });
}
