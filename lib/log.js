// Historial del hangar (Hangar log): clasifica cada entrada y hace un resumen por año.
// Lógica pura, probada en tests/log.test.js.

const money = (s) => Math.round(parseFloat(String(s).replace(/,/g, '')) * 100);

// Tipos de entrada, en el orden en que se comprueban.
const RULES = [
  ['buyback', /^Created by .* - Buy-Back order/i],
  ['purchase', /^Created by .*value: \$([\d,.]+)/i],
  ['giftReceived', /^Claimed as a gift by .*value: \$([\d,.]+)/i],
  ['giftSent', /^Gifted to .*value: \$([\d,.]+)/i],
  ['reclaim', /^Reclaimed by .* for \$([\d,.]+)/i],
  ['buybackSource', /^Buy-back by /i],
  ['ccuConsumed', /^Consumed by .* on pledge #\d+, value: \$([\d,.]+)/i],
  ['fix', /^FIX - /i],
  ['upgradeApplied', /^Upgrade applied: /i],
  ['name', /^Name (?:Reservation|Release)/i],
  ['config', /^Configuration (?:added|reclaimed)/i],
];

export const TYPE_LABELS = {
  purchase: 'Compra',
  giftReceived: 'Regalo recibido',
  giftSent: 'Regalado',
  reclaim: 'Canje a crédito',
  buyback: 'Recompra (buy-back)',
  buybackSource: 'Recompra (origen)',
  ccuConsumed: 'Upgrade gastado',
  upgradeApplied: 'Upgrade aplicado',
  fix: 'Corrección de RSI',
  name: 'Nombre de nave',
  config: 'Configuración',
  other: 'Recompensa / otro',
};

export function classifyLogEntry(text) {
  for (const [type, re] of RULES) {
    const m = String(text ?? '').match(re);
    if (m) return { type, valueCents: m[1] != null ? money(m[1]) : null };
  }
  return { type: 'other', valueCents: null };
}

// "Oct 20 2026, 11:16 pm" → 2026
export function yearOf(date) {
  const m = String(date ?? '').match(/\b(\d{4}),/);
  return m ? Number(m[1]) : null;
}

export function enrichLog(entries = []) {
  return entries.map((e) => ({ ...e, ...classifyLogEntry(e.text), year: yearOf(e.date) }));
}

// Resumen por año. OJO: "compras" incluye lo pagado con crédito de tienda (dinero reciclado de canjes),
// así que NO es lo que has gastado de tu bolsillo.
export function summarizeLog(entries = []) {
  const years = new Map();
  const row = (y) => {
    if (!years.has(y)) {
      years.set(y, {
        year: y,
        purchases: 0,
        purchasesCents: 0,
        reclaims: 0,
        reclaimsCents: 0,
        giftsReceived: 0,
        giftsSent: 0,
        buybacks: 0,
        upgradesApplied: 0,
      });
    }
    return years.get(y);
  };
  for (const e of enrichLog(entries)) {
    if (e.year == null) continue;
    const r = row(e.year);
    if (e.type === 'purchase') {
      r.purchases++;
      r.purchasesCents += e.valueCents ?? 0;
    } else if (e.type === 'reclaim') {
      r.reclaims++;
      r.reclaimsCents += e.valueCents ?? 0;
    } else if (e.type === 'giftReceived') r.giftsReceived++;
    else if (e.type === 'giftSent') r.giftsSent++;
    else if (e.type === 'buyback') r.buybacks++;
    else if (e.type === 'upgradeApplied') r.upgradesApplied++;
  }
  const rows = [...years.values()].sort((a, b) => b.year - a.year);
  const total = rows.reduce(
    (t, r) => {
      for (const k of Object.keys(t)) if (k !== 'year') t[k] += r[k];
      return t;
    },
    { year: 'Total', purchases: 0, purchasesCents: 0, reclaims: 0, reclaimsCents: 0, giftsReceived: 0, giftsSent: 0, buybacks: 0, upgradesApplied: 0 },
  );
  return { rows, total };
}
