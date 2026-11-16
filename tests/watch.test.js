import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../lib/chain.js';
import { diffStore, evaluateGoals } from '../lib/watch.js';

const before = [
  { id: 2, skus: [{ id: 22, title: 'Standard Edition', price: 15000 }] },
  { id: 3, skus: [{ id: 31, title: 'Standard Edition', price: 33000 }, { id: 32, title: 'Warbond Edition', price: 30000 }] },
];
const after = [
  { id: 2, skus: [{ id: 21, title: 'Warbond Edition', price: 14000 }, { id: 22, title: 'Standard Edition', price: 15000 }] },
  { id: 3, skus: [{ id: 31, title: 'Standard Edition', price: 32000 }] },
];

test('diffStore detecta Warbonds nuevos, retirados y cambios de precio', () => {
  const d = diffStore(before, after);
  assert.deepEqual(d.newWarbonds.map((s) => s.skuId), [21]);
  assert.deepEqual(d.goneWarbonds.map((s) => s.skuId), [32]);
  assert.deepEqual(d.priceChanges.map((s) => [s.skuId, s.before, s.price]), [[31, 33000, 32000]]);
});

test('diffStore sin foto anterior no avisa de nada', () => {
  assert.deepEqual(diffStore(null, after), { newWarbonds: [], goneWarbonds: [], priceChanges: [] });
});

test('evaluateGoals marca un objetivo que se ha abaratado', () => {
  const catalog = { ships: [{ id: 1, name: 'A', msrp: 11000 }, { id: 2, name: 'B', msrp: 15000 }, { id: 3, name: 'C', msrp: 33000 }] };
  const graph = buildGraph({ catalog, storeTargets: after });
  // Hoy: A → B Warbond (30) + B → C (320 − 150 = 170) = 200 $
  const [g] = evaluateGoals([{ fromId: 1, toId: 3, lastTotalWithTax: 22000 }], graph);
  assert.equal(g.now, 20000);
  assert.equal(g.cheaper, true);
  assert.equal(g.pricier, false);
});
