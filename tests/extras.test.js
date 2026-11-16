// Tests de las utilidades nuevas: fichas, objetivos múltiples, evolución, flota y euros.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../lib/chain.js';
import { compareShips, filterShips, joinShips, sizeLabel, slimShipMatrix } from '../lib/ships.js';
import { planMultiple, sharedConflicts } from '../lib/multi.js';
import { monthKey, timeline, topMonths } from '../lib/stats.js';
import { decodeShare, encodeShare, fleetOf, fleetTotals, groupBy } from '../lib/fleet.js';
import { formatEuro, parseRate, toEuroCents } from '../lib/fx.js';

// ---------- Fichas ----------
const matrix = [
  { id: 217, name: 'Perseus ', size: 'Large', type: 'Combat', focus: 'Heavy Gunship', production_status: 'flight-ready', min_crew: 6, max_crew: 6, cargocapacity: 96, length: 100, scm_speed: 150, manufacturer: { name: 'Roberts Space Industries', code: 'RSI' }, description: 'x'.repeat(900) },
  { id: 7, name: 'Aurora', size: 'small', production_status: 'in-concept', min_crew: 1, max_crew: 1, cargocapacity: 0, length: 20, scm_speed: 190 },
  { id: null, name: 'sin id' },
];

test('slimShipMatrix reduce y normaliza', () => {
  const s = slimShipMatrix(matrix);
  assert.deepEqual(Object.keys(s), ['7', '217']);
  assert.equal(s[217].name, 'Perseus');
  assert.equal(s[217].size, 'Grande');
  assert.equal(s[217].status, 'En vuelo');
  assert.equal(s[217].description.length, 600);
  assert.equal(s[7].size, 'Pequeña');
  assert.equal(s[7].status, 'Concepto');
  assert.equal(sizeLabel('snub'), 'Snub');
  assert.equal(sizeLabel(null), '—');
});

const catalog = [
  { id: 217, name: 'Perseus', msrp: 80000, owned: false, skus: [{ available: true }] },
  { id: 7, name: 'Aurora', msrp: 2500, owned: true, skus: [] },
];
test('joinShips y filterShips', () => {
  const ships = joinShips(catalog, slimShipMatrix(matrix));
  assert.equal(ships[0].cargo, 96);
  assert.equal(ships[0].onSale, true);
  assert.equal(ships[1].onSale, false);
  assert.deepEqual(filterShips(ships, { q: 'gunshíp' }).map((s) => s.name), ['Perseus']);
  assert.deepEqual(filterShips(ships, { size: 'Pequeña' }).map((s) => s.name), ['Aurora']);
  assert.deepEqual(filterShips(ships, { owned: true }).map((s) => s.name), ['Aurora']);
  assert.deepEqual(filterShips(ships, { maxPriceCents: 5000 }).map((s) => s.name), ['Aurora']);
});

test('compareShips marca el mejor valor de cada fila', () => {
  const ships = joinShips(catalog, slimShipMatrix(matrix));
  const rows = Object.fromEntries(compareShips(ships).map((r) => [r.key, r]));
  assert.deepEqual(rows.msrp.best, [1], 'más barata = mejor');
  assert.deepEqual(rows.cargo.best, [0], 'más carga = mejor');
  assert.deepEqual(rows.maxCrew.best, [0]);
  assert.deepEqual(rows.size.best, [], 'sin criterio');
  // Si empatan no se marca ninguna
  assert.deepEqual(compareShips([ships[0], { ...ships[0] }]).find((r) => r.key === 'cargo').best, []);
});

// ---------- Objetivos múltiples ----------
// A(110) → B(150) → C(330) y A2(110) → B → D(500): ambos quieren el mismo CCU tuyo A→B.
const cat = { ships: [{ id: 1, name: 'A', msrp: 11000 }, { id: 2, name: 'B', msrp: 15000 }, { id: 3, name: 'C', msrp: 33000 }, { id: 4, name: 'D', msrp: 50000 }, { id: 5, name: 'A2', msrp: 11000 }] };
const store = [
  { id: 2, skus: [{ id: 22, title: 'Standard Edition', price: 15000, available: true }] },
  { id: 3, skus: [{ id: 31, title: 'Standard Edition', price: 33000, available: true }] },
  { id: 4, skus: [{ id: 41, title: 'Standard Edition', price: 50000, available: true }] },
];
test('planMultiple no usa dos veces el mismo CCU', () => {
  const g = buildGraph({ catalog: cat, storeTargets: store, ownedCcus: [{ fromId: 1, toId: 2, pledgeId: 'mio' }] });
  const goals = [{ fromId: 1, toId: 3 }, { fromId: 5, toId: 4 }]; // A → C y A2 → D
  const r = planMultiple(g, goals, { taxRate: 0 });
  const usedMine = r.plans.flatMap((p) => p.route.steps).filter((s) => s.kind === 'Tuyo');
  assert.ok(usedMine.length <= 1, 'el CCU solo se gasta una vez');
  assert.equal(r.unreachable, 0);
  assert.equal(sharedConflicts(g, goals).length, 0, 'A2 no puede usar el CCU que sale de A... (otra nave de origen)');
  assert.equal(r.plans.length, 2);
});

test('planMultiple elige el reparto más barato', () => {
  // Dos objetivos que salen de A y llegan a C y a D: el CCU gratis A→B conviene gastarlo en el que más ahorra.
  const g = buildGraph({ catalog: cat, storeTargets: store, ownedCcus: [{ fromId: 1, toId: 2, pledgeId: 'mio' }] });
  const goals = [{ fromId: 1, toId: 3 }, { fromId: 1, toId: 4 }];
  const r = planMultiple(g, goals, { taxRate: 0 });
  const sinCompartir = goals.reduce((a, gl) => a + planMultiple(g, [gl], { taxRate: 0 }).totalWithTax, 0);
  assert.ok(r.totalWithTax >= sinCompartir, 'compartir el CCU no puede salir más barato que usarlo en ambos');
  const conCcu = r.plans.filter((p) => p.route.steps.some((s) => s.kind === 'Tuyo')).length;
  assert.equal(conCcu, 1);
  assert.equal(sharedConflicts(g, goals).length, 1);
});

test('planMultiple avisa de objetivos inalcanzables y limita el número', () => {
  const g = buildGraph({ catalog: cat, storeTargets: store });
  assert.equal(planMultiple(g, [{ fromId: 3, toId: 1 }]).unreachable, 1);
  assert.throws(() => planMultiple(g, new Array(7).fill({ fromId: 1, toId: 3 })), /Máximo/);
  assert.deepEqual(planMultiple(g, []).plans, []);
});

// ---------- Evolución ----------
test('monthKey y timeline rellenan meses vacíos y acumulan', () => {
  assert.equal(monthKey('Oct 20 2026, 11:16 pm'), '2026-10');
  assert.equal(monthKey('algo raro'), null);
  const log = [
    { date: 'Dec 03 2025, 1:00 pm', pledgeName: 'a', pledgeId: '1', text: 'Created by u - order #A, value: $50.00 USD' },
    { date: 'Feb 10 2026, 1:00 pm', pledgeName: 'b', pledgeId: '2', text: 'Reclaimed by u for $20.00 USD' },
    { date: 'Feb 11 2026, 1:00 pm', pledgeName: 'c', pledgeId: '3', text: 'Created by u - order #B, value: $30.00 USD' },
  ];
  const t = timeline(log);
  assert.deepEqual(t.months.map((m) => m.key), ['2025-12', '2026-01', '2026-02']);
  assert.deepEqual(t.months.map((m) => m.cumPurchasesCents), [5000, 5000, 8000]);
  assert.deepEqual(t.months.map((m) => m.cumNetCents), [5000, 5000, 5000 + 3000 - 2000]);
  assert.equal(topMonths(t.months, 1)[0].key, '2025-12');
  assert.deepEqual(timeline([]).months, []);
});

// ---------- Flota y compartir ----------
test('flota: agrupar, totales y enlace de compartir', () => {
  const joined = joinShips(catalog, slimShipMatrix(matrix));
  const fleet = fleetOf([{ shipId: 217, name: 'Perseus', insurance: 'LTI' }, { shipId: 7, name: 'Aurora', insurance: null }], joined);
  assert.equal(fleetTotals(fleet).cargo, 96);
  assert.equal(fleetTotals(fleet).lti, 1);
  assert.deepEqual(groupBy(fleet, (s) => s.size).map((g) => g.key).sort(), ['Grande', 'Pequeña']);

  const code = encodeShare(fleet);
  assert.match(code, /^v2\.[A-Za-z0-9_-]+$/);
  const back = decodeShare(code);
  assert.deepEqual(back.map((s) => [s.name, s.focus, s.size, s.cargo]), [['Perseus', 'Heavy Gunship', 'Grande', 96], ['Aurora', null, 'Pequeña', 0]]);
  assert.ok(!code.includes('LTI') && !JSON.stringify(back).includes('LTI'), 'no viaja el seguro');
  assert.equal(decodeShare('basura'), null);
  assert.equal(decodeShare('v2.' + btoa('no es json').replace(/=/g, '')), null);
  assert.deepEqual(decodeShare(encodeShare([])), []);
  // Acentos y caracteres raros sobreviven; un texto largo se recorta
  assert.equal(decodeShare(encodeShare([{ name: 'Ñandú «Ω» ' + 'x'.repeat(100) }]))[0].name.length, 60);
});

// ---------- Euros ----------
test('euros', () => {
  assert.equal(toEuroCents(10000, 0.92), 9200);
  assert.equal(toEuroCents(10000, 0), null);
  assert.equal(parseRate('0,92'), 0.92);
  assert.equal(parseRate('0.9'), 0.9);
  assert.equal(parseRate('abc'), null);
  assert.equal(parseRate('50'), null);
  assert.match(formatEuro(123456), /^1\.?234,56 €$/); // es-ES no agrupa los miles de 4 cifras
});
