// Tests de la calculadora de cadenas. Ejecutar con:  npm test
// Precios en céntimos y sin impuestos, como los da RSI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGraph,
  buybackPriceQueue,
  cheapestPath,
  directUpgrade,
  planUpgrade,
  reachableTargets,
  resolveBuybackPrices,
  withTax,
} from '../lib/chain.js';

// Mapa de ejemplo:
//   A  vale 110 $
//   B  vale 150 $, pero hoy hay Warbond a 140 $
//   C  vale 330 $
//   D  vale 145 $ (más que el Warbond de B)
//   X  vale 500 $ pero ya no se vende (no es destino de upgrade)
const catalog = {
  ships: [
    { id: 1, name: 'A', msrp: 11000 },
    { id: 2, name: 'B', msrp: 15000 },
    { id: 3, name: 'C', msrp: 33000 },
    { id: 4, name: 'D', msrp: 14500 },
    { id: 5, name: 'X', msrp: 50000 },
  ],
};
const storeTargets = [
  {
    id: 2,
    skus: [
      { id: 21, title: 'Warbond Edition', price: 14000, available: true },
      { id: 22, title: 'Standard Edition', price: 15000, available: true },
    ],
  },
  { id: 3, skus: [{ id: 31, title: 'Standard Edition', price: 33000, available: true }] },
  { id: 4, skus: [{ id: 41, title: 'Standard Edition', price: 14500, available: true }] },
];

test('withTax redondea como RSI (21 %)', () => {
  assert.equal(withTax(1500, 2100), 1815); // Freelancer → 350r, comprobado en RSI
  assert.equal(withTax(0, 2100), 0);
});

test('el upgrade directo cuesta destino − valor de tu nave', () => {
  const g = buildGraph({ catalog, storeTargets });
  const d = directUpgrade(g, 1, 3);
  assert.equal(d.total, 22000); // 330 − 110
  assert.equal(d.steps.length, 1);
});

test('la cadena con Warbond sale más barata que el directo', () => {
  const g = buildGraph({ catalog, storeTargets });
  const plan = planUpgrade(g, 1, 3, { taxRate: 2100 });
  // A → B (Warbond 140 − 110 = 30)  +  B → C (330 − 150 = 180)  = 210 $
  assert.deepEqual(
    plan.best.steps.map((s) => [s.fromName, s.toName, s.kind, s.cost]),
    [
      ['A', 'B', 'Warbond', 3000],
      ['B', 'C', 'Standard', 18000],
    ],
  );
  assert.equal(plan.best.total, 21000);
  assert.equal(plan.best.totalWithTax, 3630 + 21780); // cada paso con IVA redondeado por separado
  assert.equal(plan.best.cashOnlyWithTax, 3630); // el Warbond solo con dinero
  assert.equal(plan.direct.totalWithTax, 26620);
  assert.equal(plan.savingWithTax, 26620 - 25410);
});

test('sin Warbond, a igual precio gana la ruta con menos pasos', () => {
  const g = buildGraph({ catalog, storeTargets });
  // Sin Warbond: A→B→C = 40 + 180 = 220, igual que el directo A→C = 220 → debe elegir 1 paso.
  const p = cheapestPath(g, 1, 3, { allowWarbond: false });
  assert.equal(p.total, 22000);
  assert.equal(p.steps.length, 1);
  const plan = planUpgrade(g, 1, 3);
  assert.equal(plan.creditOnly.total, 22000, 'se muestra porque es distinta de la mejor');
});

test('un Warbond más barato que tu nave no es un destino válido', () => {
  const g = buildGraph({ catalog, storeTargets });
  // D vale 145 $; el Warbond de B (140 $) no vale → solo el Standard de 150 $ (5 $ de upgrade)
  const p = cheapestPath(g, 4, 2);
  assert.deepEqual(
    p.steps.map((s) => [s.kind, s.cost]),
    [['Standard', 500]],
  );
});

test('los upgrades que ya tienes cuentan como gratis', () => {
  const g = buildGraph({ catalog, storeTargets, ownedCcus: [{ fromId: 1, toId: 2, pledgeId: 'p1' }] });
  const plan = planUpgrade(g, 1, 3);
  assert.deepEqual(
    plan.best.steps.map((s) => [s.kind, s.cost]),
    [
      ['Tuyo', 0],
      ['Standard', 18000],
    ],
  );
  assert.equal(plan.best.toBuy, 1);
  // Y se pueden ignorar si el usuario quiere
  const sinMios = planUpgrade(g, 1, 3, { useOwned: false });
  assert.equal(sinMios.best.total, 21000);
});

test('una nave que no se vende solo es alcanzable con un CCU propio', () => {
  const g = buildGraph({ catalog, storeTargets });
  assert.equal(cheapestPath(g, 1, 5), null);
  assert.ok(!reachableTargets(g).some((s) => s.id === 5));

  const g2 = buildGraph({ catalog, storeTargets, ownedCcus: [{ fromId: 3, toId: 5 }] });
  const p = cheapestPath(g2, 1, 5);
  assert.equal(p.steps.at(-1).kind, 'Tuyo');
  assert.ok(reachableTargets(g2).some((s) => s.id === 5));
});

test('origen = destino o naves desconocidas → null', () => {
  const g = buildGraph({ catalog, storeTargets });
  assert.equal(cheapestPath(g, 1, 1), null);
  assert.equal(cheapestPath(g, 1, 999), null);
});

// ---------- CCUs del buy-back ----------
// Caso real comprobado en RSI: Terrapin (220 $) → Starlancer MAX Warbond (225 $), que hoy no se vende:
// RSI cobra (225 − 220) × 1,21 = 6,05 $.
test('resolveBuybackPrices: exacto, del catálogo, estimado o desconocido', () => {
  const cat = {
    ships: [
      { id: 1, name: 'A', msrp: 11000, skus: [] },
      { id: 2, name: 'B', msrp: 15000, skus: [{ id: 22, title: 'Standard Edition', price: 15000 }] },
      { id: 6, name: 'Starlancer MAX', msrp: 25000, skus: [] },
    ],
  };
  const bb = [
    { fromId: 1, toId: 6, toSkuId: 17496, pledgeId: 'p1', edition: 'Warbond' },
    { fromId: 1, toId: 2, toSkuId: 22, pledgeId: 'p2', edition: 'Standard' },
    { fromId: 1, toId: 6, toSkuId: 999, pledgeId: 'p3', edition: 'Standard' },
    { fromId: 1, toId: 6, toSkuId: 17496, pledgeId: 'p4', edition: 'Warbond' },
  ];
  const sinConsultar = resolveBuybackPrices(bb, cat);
  assert.deepEqual(
    sinConsultar.map((b) => [b.price, b.priceExact]),
    [
      [null, false], // Warbond fuera del catálogo: desconocido
      [15000, true], // en el catálogo
      [25000, false], // Standard fuera del catálogo: msrp estimado
      [null, false],
    ],
  );
  // Solo hay que preguntar una vez por cada edición distinta que falte
  assert.deepEqual(buybackPriceQueue(sinConsultar).map((q) => q.toSkuId), [17496, 999]);

  const consultado = resolveBuybackPrices(bb, cat, { 17496: 22500 });
  assert.deepEqual([consultado[0].price, consultado[0].priceExact], [22500, true]);
});

test('la calculadora usa CCUs del buy-back solo desde su nave de origen', () => {
  const cat = {
    ships: [
      { id: 1, name: 'Terrapin', msrp: 22000 },
      { id: 6, name: 'Starlancer MAX', msrp: 25000 },
      { id: 7, name: 'Otra', msrp: 20000 },
    ],
  };
  const buybackCcus = [{ fromId: 1, toId: 6, price: 22500, priceExact: true, edition: 'Warbond', pledgeId: 'p1' }];
  const g = buildGraph({ catalog: cat, storeTargets: [], buybackCcus });

  // Sin buy-back no se puede llegar (la Starlancer MAX no se vende)
  assert.equal(cheapestPath(g, 1, 6), null);

  const plan = planUpgrade(g, 1, 6, { taxRate: 2100, useBuyback: true });
  assert.deepEqual(
    plan.best.steps.map((s) => [s.kind, s.edition, s.cost, s.costWithTax]),
    [['Buy-back', 'Warbond', 500, 605]],
  );
  assert.equal(plan.best.buybackSteps, 1);
  assert.equal(plan.best.estimated, false);
  assert.ok(reachableTargets(g, { useBuyback: true }).some((s) => s.id === 6));

  // Desde otra nave no sirve: ese CCU es de Terrapin
  assert.equal(cheapestPath(g, 7, 6, { useBuyback: true }), null);
});

// ---------- Presupuesto ----------
// Mapa de arriba: A (110) → C (330).
//   Ruta 1: A → B Warbond (30) + B → C Standard (180) = 210 → 30 de dinero seguro + 180 que admiten crédito
//   Ruta 2: A → C Standard directo (220) → todo admite crédito
test('payment separa dinero y crédito', async () => {
  const { payment } = await import('../lib/chain.js');
  const g = buildGraph({ catalog, storeTargets });
  const r1 = cheapestPath(g, 1, 3);
  assert.deepEqual(payment(r1, { creditCents: 0 }), { cashCents: 21000, creditUsedCents: 0 });
  assert.deepEqual(payment(r1, { creditCents: 5000 }), { cashCents: 16000, creditUsedCents: 5000 });
  assert.deepEqual(payment(r1, { creditCents: 99999 }), { cashCents: 3000, creditUsedCents: 18000 });
});

test('budgetPlan elige la ruta con menos dinero de tu bolsillo según el crédito', async () => {
  const { budgetPlan } = await import('../lib/chain.js');
  const g = buildGraph({ catalog, storeTargets });
  const kinds = (bp) => bp.best.route.steps.map((s) => s.kind).join('+');
  // Sin crédito: la ruta con Warbond (210) pide menos dinero que la directa (220)
  assert.equal(kinds(budgetPlan(g, 1, 3, { creditCents: 0 })), 'Warbond+Standard');
  // Con 200 $ de crédito: Warbond = 30 de dinero; directa = 20 → gana la directa
  const bp = budgetPlan(g, 1, 3, { creditCents: 20000 });
  assert.equal(kinds(bp), 'Standard');
  assert.equal(bp.best.cashCents, 2000);
  assert.ok(bp.candidates.length >= 2);
});

test('payment: recompras con crédito solo mientras queden', async () => {
  const { payment } = await import('../lib/chain.js');
  const route = { steps: [
    { kind: 'Buy-back', costWithTax: 1000 },
    { kind: 'Buy-back', costWithTax: 2000 },
    { kind: 'Tuyo', costWithTax: 0 },
  ] };
  assert.deepEqual(payment(route, { creditCents: 99999, creditBuybacks: 1 }), { cashCents: 2000, creditUsedCents: 1000 });
});

test('upgradeOptionsFrom calcula los precios como RSI', async () => {
  const { upgradeOptionsFrom } = await import('../lib/chain.js');
  const g = buildGraph({ catalog, storeTargets });
  // Desde A (110 $): B Warbond 140 → 30 × 1,21 = 36,30; B Standard 150 → 48,40; D 145 → 42,35; C 330 → 266,20
  assert.deepEqual(
    upgradeOptionsFrom(g, 1, 2100).map((o) => [o.toName, o.kind, o.upgradeWithTax]),
    [
      ['B', 'Warbond', 3630],
      ['D', 'Standard', 4235],
      ['B', 'Standard', 4840],
      ['C', 'Standard', 26620],
    ],
  );
  // Desde D (145 $) el Warbond de B (140 $) no aparece
  assert.ok(!upgradeOptionsFrom(g, 4).some((o) => o.kind === 'Warbond'));
});
