// Calculadora de cadenas de upgrades (lógica pura, sin navegador).
//
// Idea: un mapa de metro.
//   - Cada nave es una estación.
//   - Cada upgrade posible es un tramo entre dos estaciones, con un precio.
//   - Buscamos la ruta más barata de tu nave a la nave que quieres (algoritmo de Dijkstra).
//
// Reglas de RSI comprobadas con su API:
//   - Precio de un upgrade = precio de la edición destino − valor (msrp) de tu nave actual.
//   - Una edición solo es destino válido si su precio es MAYOR que el valor de tu nave.
//   - Después de un upgrade, tu nave vale el msrp de la nave nueva (no lo que pagaste).
//   - El precio final lleva impuestos: RSI redondea cada upgrade por separado.
//   - Los Warbond solo se pagan con dinero; los Standard admiten crédito de tienda.
//   - Un upgrade que ya tienes en el hangar cuesta 0.

export function editionKind(title) {
  return /warbond/i.test(title ?? '') ? 'Warbond' : 'Standard';
}

// Precio con impuestos de un importe en céntimos. taxRate viene como 2100 = 21 %.
export function withTax(cents, taxRate = 0) {
  return Math.round(cents * (1 + taxRate / 10000));
}

/**
 * Prepara el "mapa".
 * @param catalog       respuesta de initShipUpgrade (ships con id, name, msrp)
 * @param storeTargets  respuesta de filterShips sin nave de origen: [{ id, skus: [{ id, title, price, available }] }]
 * @param ownedCcus     CCUs del hangar ya emparejados: [{ fromId, toId, pledgeId? }]
 * @param buybackCcus   CCUs del buy-back con precio resuelto (ver resolveBuybackPrices):
 *                      [{ fromId, toId, price, priceExact, edition, title }]
 */
export function buildGraph({ catalog, storeTargets = [], ownedCcus = [], buybackCcus = [] }) {
  const ships = new Map((catalog?.ships ?? []).map((s) => [s.id, { ...s, name: String(s.name).trim() }]));

  // Ediciones que se pueden comprar como destino de un upgrade.
  const targetSkus = [];
  for (const t of storeTargets) {
    if (!ships.has(t.id)) continue;
    for (const sku of t.skus ?? []) {
      if (sku.available === false || sku.price == null) continue;
      targetSkus.push({ toId: t.id, skuId: sku.id, title: sku.title, price: sku.price, kind: editionKind(sku.title) });
    }
  }

  // CCUs propios agrupados por nave de origen.
  const owned = new Map();
  for (const c of ownedCcus) {
    if (c.fromId == null || c.toId == null || !ships.has(c.fromId) || !ships.has(c.toId)) continue;
    if (!owned.has(c.fromId)) owned.set(c.fromId, []);
    owned.get(c.fromId).push(c);
  }

  // CCUs del buy-back agrupados por nave de origen (solo sirven desde esa nave concreta).
  const buyback = new Map();
  for (const b of buybackCcus) {
    if (b.price == null || !ships.has(b.fromId) || !ships.has(b.toId)) continue;
    if (!buyback.has(b.fromId)) buyback.set(b.fromId, []);
    buyback.get(b.fromId).push(b);
  }

  return { ships, targetSkus, owned, buyback };
}

/**
 * Precio de la edición destino de cada CCU del buy-back. Comprobado con RSI: al recomprar se paga
 * (precio de la edición − msrp de la nave de origen) × impuesto, y se CONSERVA el precio Warbond.
 *   1. Precio consultado a RSI (skuPrices[toSkuId])            → exacto
 *   2. La edición aparece en el catálogo                        → exacto
 *   3. Edición Standard que no aparece → msrp de la nave destino → estimado
 *   4. Warbond que no aparece                                   → desconocido (hay que consultarlo)
 */
export function resolveBuybackPrices(buybackCcus = [], catalog, skuPrices = {}) {
  const skuPrice = new Map();
  const msrp = new Map();
  for (const s of catalog?.ships ?? []) {
    msrp.set(s.id, s.msrp);
    for (const k of s.skus ?? []) if (k.price != null) skuPrice.set(k.id, k.price);
  }
  return buybackCcus.map((b) => {
    if (b.toSkuId != null && skuPrices[b.toSkuId] != null) return { ...b, price: skuPrices[b.toSkuId], priceExact: true };
    if (b.toSkuId != null && skuPrice.has(b.toSkuId)) return { ...b, price: skuPrice.get(b.toSkuId), priceExact: true };
    if (b.edition !== 'Warbond' && msrp.has(b.toId)) return { ...b, price: msrp.get(b.toId), priceExact: false };
    return { ...b, price: null, priceExact: false };
  });
}

// Ediciones del buy-back cuyo precio exacto falta: una consulta por edición distinta.
export function buybackPriceQueue(resolved = []) {
  const seen = new Set();
  const queue = [];
  for (const b of resolved) {
    if (b.priceExact || b.toSkuId == null || b.pledgeId == null || seen.has(b.toSkuId)) continue;
    seen.add(b.toSkuId);
    queue.push({ fromId: b.fromId, toId: b.toId, toSkuId: b.toSkuId, pledgeId: b.pledgeId });
  }
  return queue;
}

// Tramos que salen de una nave.
function edgesFrom(graph, fromId, { useOwned = true, allowWarbond = true, useBuyback = false } = {}) {
  const from = graph.ships.get(fromId);
  if (!from) return [];
  const edges = [];
  if (useOwned) {
    for (const c of graph.owned.get(fromId) ?? []) {
      edges.push({ fromId, toId: c.toId, kind: 'Tuyo', cost: 0, pledgeId: c.pledgeId ?? null });
    }
  }
  if (useBuyback) {
    for (const b of graph.buyback?.get(fromId) ?? []) {
      if (!allowWarbond && b.edition === 'Warbond') continue;
      if (b.price <= from.msrp) continue;
      edges.push({
        fromId,
        toId: b.toId,
        kind: 'Buy-back',
        edition: b.edition ?? null,
        cost: b.price - from.msrp,
        estimated: !b.priceExact,
        pledgeId: b.pledgeId ?? null,
      });
    }
  }
  for (const sku of graph.targetSkus) {
    if (sku.toId === fromId) continue;
    if (!allowWarbond && sku.kind === 'Warbond') continue;
    if (sku.price <= from.msrp) continue; // RSI no deja bajar ni quedarse igual
    edges.push({ fromId, toId: sku.toId, kind: sku.kind, cost: sku.price - from.msrp, skuId: sku.skuId });
  }
  return edges;
}

// Peso de un tramo al elegir ruta. Con warbondWeight > 1 se «encarecen» los pasos que hay que pagar
// con dinero (Warbond de la tienda y recompras), para buscar rutas que usen más crédito.
// El precio que se muestra siempre es el real.
function weightOf(e, { warbondWeight = 1 } = {}) {
  return e.kind === 'Warbond' || e.kind === 'Buy-back' ? e.cost * warbondWeight : e.cost;
}

/**
 * Ruta más barata de fromId a toId.
 * Si empatan en precio, gana la que tiene menos pasos.
 * Devuelve null si no hay forma de llegar.
 */
export function cheapestPath(graph, fromId, toId, options = {}) {
  if (fromId === toId || !graph.ships.has(fromId) || !graph.ships.has(toId)) return null;

  const best = new Map([[fromId, { cost: 0, steps: 0, prev: null, edge: null }]]);
  const done = new Set();

  // Con ~250 naves basta con buscar cada vez la estación pendiente más barata (sin estructuras complejas).
  while (true) {
    let current = null;
    for (const [id, info] of best) {
      if (done.has(id)) continue;
      if (
        current == null ||
        info.cost < best.get(current).cost ||
        (info.cost === best.get(current).cost && info.steps < best.get(current).steps)
      ) {
        current = id;
      }
    }
    if (current == null) return null; // no quedan estaciones alcanzables
    if (current === toId) break;
    done.add(current);

    const here = best.get(current);
    for (const e of edgesFrom(graph, current, options)) {
      if (done.has(e.toId)) continue;
      const cost = here.cost + weightOf(e, options);
      const steps = here.steps + 1;
      const old = best.get(e.toId);
      if (!old || cost < old.cost || (cost === old.cost && steps < old.steps)) {
        best.set(e.toId, { cost, steps, prev: current, edge: e });
      }
    }
  }

  // Reconstruimos la ruta yendo hacia atrás desde el destino.
  const steps = [];
  for (let id = toId; best.get(id).prev != null; id = best.get(id).prev) steps.unshift(best.get(id).edge);
  return describe(graph, steps, options.taxRate);
}

// La mejor opción de un solo paso (comprar el upgrade directo en la tienda).
export function directUpgrade(graph, fromId, toId, options = {}) {
  const edges = edgesFrom(graph, fromId, { ...options, useOwned: false }).filter((e) => e.toId === toId);
  if (!edges.length) return null;
  const cheapest = edges.reduce((a, b) => (b.cost < a.cost ? b : a));
  return describe(graph, [cheapest], options.taxRate);
}

function describe(graph, edges, taxRate = 0) {
  const steps = edges.map((e) => ({
    ...e,
    fromName: graph.ships.get(e.fromId).name,
    toName: graph.ships.get(e.toId).name,
    costWithTax: withTax(e.cost, taxRate),
  }));
  const sum = (arr, f) => arr.reduce((a, s) => a + f(s), 0);
  return {
    steps,
    total: sum(steps, (s) => s.cost),
    totalWithTax: sum(steps, (s) => s.costWithTax),
    // Lo que hay que pagar sí o sí con dinero (Warbond de la tienda).
    cashOnlyWithTax: sum(steps.filter((s) => s.kind === 'Warbond'), (s) => s.costWithTax),
    toBuy: steps.filter((s) => s.kind !== 'Tuyo').length,
    buybackSteps: steps.filter((s) => s.kind === 'Buy-back').length,
    estimated: steps.some((s) => s.estimated),
  };
}

/**
 * Todo lo que necesita la pestaña Calculadora en una llamada.
 */
export function planUpgrade(graph, fromId, toId, { taxRate = 0, useOwned = true, useBuyback = false } = {}) {
  const best = cheapestPath(graph, fromId, toId, { taxRate, useOwned, useBuyback, allowWarbond: true });
  // Solo con crédito: sin Warbond de la tienda y sin buy-back (las recompras con crédito son limitadas).
  const creditOnly = cheapestPath(graph, fromId, toId, { taxRate, useOwned, useBuyback: false, allowWarbond: false });
  const direct = directUpgrade(graph, fromId, toId, { taxRate });
  return {
    best,
    // Solo la mostramos si es distinta de la mejor (si la mejor ya no usa Warbond, es la misma).
    creditOnly: creditOnly && best && creditOnly.total !== best.total ? creditOnly : null,
    direct,
    savingWithTax: best && direct ? direct.totalWithTax - best.totalWithTax : null,
  };
}

// Naves a las que se puede llegar: las que se venden como destino + las que alcanzan tus CCUs
// (del hangar y, si se piden, del buy-back).
export function reachableTargets(graph, { useBuyback = false } = {}) {
  const ids = new Set(graph.targetSkus.map((s) => s.toId));
  for (const list of graph.owned.values()) for (const c of list) ids.add(c.toId);
  if (useBuyback) for (const list of graph.buyback?.values() ?? []) for (const b of list) ids.add(b.toId);
  return [...ids].map((id) => graph.ships.get(id)).filter(Boolean);
}

// ---------- Presupuesto: dinero de tu bolsillo frente a crédito de tienda ----------

/**
 * Cómo se pagaría una ruta con el crédito disponible.
 *   - Tus CCUs: 0.
 *   - Warbond de la tienda: siempre dinero.
 *   - Recompras del buy-back: con crédito mientras queden recompras con crédito; después, dinero.
 *   - Standard de la tienda: con crédito hasta agotarlo; el resto, dinero.
 * Importes con impuestos (costWithTax), en céntimos.
 */
export function payment(route, { creditCents = 0, creditBuybacks = 0 } = {}) {
  let cash = 0;
  let creditable = 0;
  let tokens = creditBuybacks;
  for (const s of route.steps) {
    if (s.kind === 'Tuyo') continue;
    if (s.kind === 'Warbond') cash += s.costWithTax;
    else if (s.kind === 'Buy-back') {
      if (tokens > 0) {
        tokens--;
        creditable += s.costWithTax;
      } else cash += s.costWithTax;
    } else creditable += s.costWithTax;
  }
  const creditUsed = Math.min(creditable, Math.max(0, creditCents));
  return { cashCents: cash + creditable - creditUsed, creditUsedCents: creditUsed };
}

const signature = (route) => route.steps.map((s) => `${s.fromId}>${s.toId}:${s.kind}`).join('|');

/**
 * Ruta que menos dinero de tu bolsillo necesita con el crédito que tienes.
 * Probamos varias «penalizaciones» a los pasos que se pagan con dinero (de ninguna a prohibirlos),
 * nos quedamos con las rutas distintas que salen y elegimos la que menos dinero pide
 * (si empatan, la más barata en total).
 */
export function budgetPlan(graph, fromId, toId, { taxRate = 0, useOwned = true, useBuyback = false, creditCents = 0, creditBuybacks = 0 } = {}) {
  const candidates = new Map();
  const add = (route) => {
    if (route && !candidates.has(signature(route))) {
      candidates.set(signature(route), { route, ...payment(route, { creditCents, creditBuybacks }) });
    }
  };
  for (const warbondWeight of [1, 1.25, 1.5, 2, 3, 5, 10]) {
    add(cheapestPath(graph, fromId, toId, { taxRate, useOwned, useBuyback, warbondWeight }));
  }
  add(cheapestPath(graph, fromId, toId, { taxRate, useOwned, useBuyback: false, allowWarbond: false }));

  const list = [...candidates.values()].sort(
    (a, b) => a.cashCents - b.cashCents || a.route.totalWithTax - b.route.totalWithTax,
  );
  return { best: list[0] ?? null, candidates: list };
}

// ---------- Precios: upgrades de la tienda desde una nave (sin preguntar a RSI) ----------
// Misma fórmula que usa RSI (comprobada): (precio de la edición − msrp de la nave) × impuesto.
export function upgradeOptionsFrom(graph, fromId, taxRate = 0) {
  const from = graph.ships.get(fromId);
  if (!from) return [];
  return graph.targetSkus
    .filter((s) => s.toId !== fromId && s.price > from.msrp)
    .map((s) => ({
      toId: s.toId,
      toName: graph.ships.get(s.toId).name,
      msrp: graph.ships.get(s.toId).msrp,
      title: s.title,
      kind: s.kind,
      price: s.price,
      upgradeWithTax: withTax(s.price - from.msrp, taxRate),
    }))
    .sort((a, b) => a.upgradeWithTax - b.upgradeWithTax || a.toName.localeCompare(b.toName));
}
