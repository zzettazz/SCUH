// Evolución de tu hangar a partir del historial (Hangar log). Lógica pura, probada en tests/stats.test.js.
//
// OJO: «compras» incluye lo pagado con crédito de tienda (dinero que viene de canjes), así que
// NO es lo que has gastado de tu bolsillo. Lo decimos en la interfaz.

import { enrichLog } from './log.js';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// "Oct 20 2026, 11:16 pm" → "2026-10"
export function monthKey(date) {
  const m = String(date ?? '').match(/^([A-Za-z]{3})\w*\s+\d{1,2}\s+(\d{4})/);
  const mo = m && MONTHS[m[1].toLowerCase()];
  return mo ? `${m[2]}-${String(mo).padStart(2, '0')}` : null;
}

/**
 * Serie mensual y acumulada.
 * @returns { months: [{ key, purchasesCents, reclaimsCents, giftsReceived, upgrades, cumPurchasesCents, cumNetCents }], first, last }
 * Los meses sin movimientos se rellenan con ceros para que el gráfico sea continuo.
 */
export function timeline(log = []) {
  const by = new Map();
  for (const e of enrichLog(log)) {
    const key = monthKey(e.date);
    if (!key) continue;
    if (!by.has(key)) by.set(key, { key, purchasesCents: 0, reclaimsCents: 0, giftsReceived: 0, upgrades: 0 });
    const r = by.get(key);
    if (e.type === 'purchase') r.purchasesCents += e.valueCents ?? 0;
    else if (e.type === 'reclaim') r.reclaimsCents += e.valueCents ?? 0;
    else if (e.type === 'giftReceived') r.giftsReceived++;
    else if (e.type === 'upgradeApplied') r.upgrades++;
  }
  if (!by.size) return { months: [], first: null, last: null };

  const keys = [...by.keys()].sort();
  const [y0, m0] = keys[0].split('-').map(Number);
  const [y1, m1] = keys.at(-1).split('-').map(Number);
  const months = [];
  let cumP = 0;
  let cumN = 0;
  for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (y++, (m = 1)) : m++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const r = by.get(key) ?? { key, purchasesCents: 0, reclaimsCents: 0, giftsReceived: 0, upgrades: 0 };
    cumP += r.purchasesCents;
    cumN += r.purchasesCents - r.reclaimsCents;
    months.push({ ...r, cumPurchasesCents: cumP, cumNetCents: cumN });
  }
  return { months, first: months[0].key, last: months.at(-1).key };
}

/** Los N meses con más compras. */
export function topMonths(months, n = 5) {
  return [...months].sort((a, b) => b.purchasesCents - a.purchasesCents).filter((m) => m.purchasesCents > 0).slice(0, n);
}
