import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAccount } from '../lib/account.js';
import { meltAdvice, meltSelectionTotals } from '../lib/melt.js';

// Casos sacados de tu hangar real (precios simplificados).
const catalog = {
  ships: [
    { id: 1, name: 'Railen', msrp: 30000 },
    { id: 2, name: 'Guardian', msrp: 15000 }, // hoy vale MENOS que la Railen
    { id: 3, name: 'Starfarer Gemini', msrp: 34000 },
    { id: 4, name: 'Valkyrie', msrp: 37500 },
    { id: 5, name: 'Orion', msrp: 65000 },
    { id: 6, name: 'Hull E', msrp: 75000 },
    { id: 7, name: 'Carrack', msrp: 60000 },
    { id: 8, name: 'Zeus Mk II CL', msrp: 17500 },
  ],
};
const base = { date: 'x', items: [], ships: [], insurance: null, isUpgrade: false, upgrade: null, canGift: false, canExchange: true, canApplyUpgrade: false };
const ccu = (id, from, to, valueCents) => ({
  ...base, id, name: `Upgrade - ${from} to ${to} Warbond Edition`, valueCents, isUpgrade: true, canApplyUpgrade: true, upgrade: { from: [from], to: [to] },
});
const pledges = [
  ccu('railen', 'Railen', 'Guardian', 500),
  ccu('gem1', 'Starfarer Gemini', 'Valkyrie', 1000),
  ccu('gem2', 'Starfarer Gemini', 'Valkyrie', 1000),
  ccu('orion', 'Orion', 'Hull E', 2500),
  { ...base, id: 'paint', name: 'Paints - Polaris - Sirius Paint', valueCents: 1650 },
  { ...base, id: 'carrack', name: 'Standalone Ship - Spartan', valueCents: 25000, ships: ['Carrack'], insurance: 'LTI' },
  {
    ...base, id: 'zeus', name: 'Package - Syulen IAE Starter Pack', valueCents: 13725, ships: ['Zeus Mk II CL'], insurance: 'LTI',
    items: [{ title: 'Star Citizen Digital Download', kind: '' }],
  },
  { ...base, id: 'merlin', name: 'Referral Bonus', valueCents: 0, ships: ['P-52 Merlin'], canExchange: false },
];

const run = (reserved) => {
  const account = buildAccount({ pledges, catalog });
  return meltAdvice({ pledges, account, catalog, reserved, creditBuybacksLeft: 2 });
};
const byId = (rows) => Object.fromEntries(rows.map((r) => [r.pledgeId, r]));

test('un CCU que ya no se puede aplicar no pierde nada', () => {
  const r = byId(run()).railen;
  assert.equal(r.lossCents, 0);
  assert.equal(r.level, 'bajo');
  assert.match(r.reasons[0], /Ya no se puede aplicar/);
});

test('un CCU Warbond barato pierde la diferencia con el precio de hoy', () => {
  const rows = byId(run());
  // Valkyrie − Gemini = 35 $ hoy; pagaste 10 $ → pierdes 25 $
  assert.equal(rows.gem1.rebuyCents, 3500);
  assert.equal(rows.gem1.lossCents, 2500);
  assert.equal(rows.gem1.level, 'alto', 'primera copia, pérdida de 25 $');
  assert.equal(rows.gem2.level, 'medio', 'la copia repetida es menos grave');
  assert.ok(rows.gem2.reasons.some((x) => /Copia repetida/.test(x)));
  // Orion → Hull E: 100 $ hoy, pagaste 25 $ → pierdes 75 $
  assert.equal(rows.orion.lossCents, 7500);
});

test('naves, juego y estéticos', () => {
  const rows = byId(run());
  assert.equal(rows.paint.level, 'bajo');
  assert.equal(rows.carrack.level, 'alto');
  assert.ok(rows.carrack.reasons.some((x) => /recuperarías «Standalone Ship - Spartan», no la Carrack/.test(x)));
  assert.ok(rows.carrack.reasons.some((x) => /solo te quedan 2 recompras/.test(x)));
  assert.ok(rows.zeus.reasons.some((x) => /Incluye el juego/.test(x)));
  assert.equal(rows.merlin, undefined, 'lo que no se puede canjear no aparece');
});

test('lo reservado sube a riesgo alto y el orden va de menos a más arriesgado', () => {
  const rows = run({ ccuPledgeIds: ['railen'] });
  const railen = rows.find((r) => r.pledgeId === 'railen');
  assert.equal(railen.level, 'alto');
  assert.match(railen.reasons[0], /reservado/);
  const levels = rows.map((r) => r.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => ['bajo', 'medio', 'alto'].indexOf(a) - ['bajo', 'medio', 'alto'].indexOf(b)));
});

test('meltSelectionTotals suma crédito y pérdida', () => {
  const t = meltSelectionTotals(run(), ['railen', 'gem2', 'paint']);
  assert.deepEqual(t, { count: 3, creditCents: 500 + 1000 + 1650, lossCents: 0 + 2500 + 0 });
});
