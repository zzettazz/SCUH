// Tests del modelo de cuenta. Ejecutar con:  npm test   (o  node --test tests/)
// Los datos imitan el formato real que devuelve RSI (ids inventados).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAccount, makeShipIndex, normalizeName, parseUpgradeName } from '../lib/account.js';

const catalog = {
  ships: [
    { id: 1, name: 'Orion', msrp: 57500 },
    { id: 2, name: 'Hull E', msrp: 90000 },
    { id: 3, name: 'Mercury', msrp: 26000 },
    { id: 4, name: 'Guardian MX', msrp: 27500 },
    { id: 5, name: 'Eclipse', msrp: 30000 },
    { id: 6, name: 'Starfarer Gemini', msrp: 34000 },
    { id: 7, name: 'Valkyrie', msrp: 37500 },
    { id: 8, name: 'Scorpius', msrp: 24000 },
    { id: 9, name: 'Apollo Triage', msrp: 25000 },
    { id: 10, name: 'F7C Hornet Mk II', msrp: 17500 },
    { id: 11, name: 'Fury', msrp: 5500 },
  ],
};

// Crea un pledge con el mismo formato que produce content.js
function pledge(over) {
  return {
    id: String(Math.random()),
    name: '',
    valueCents: 0,
    date: 'May 28, 2025',
    items: [],
    ships: [],
    insurance: null,
    isUpgrade: false,
    upgrade: null,
    canGift: false,
    canExchange: false,
    canApplyUpgrade: false,
    ...over,
  };
}
const ship = (shipName, valueCents, over = {}) =>
  pledge({ name: `Standalone Ship - ${shipName}`, ships: [shipName], insurance: 'LTI', valueCents, canExchange: true, ...over });
const ccu = (name, from, to, valueCents) =>
  pledge({ name, valueCents, isUpgrade: true, canApplyUpgrade: true, canGift: true, upgrade: { type: 'R', from: [from], to } });

test('normalizeName ignora mayúsculas, espacios y comillas', () => {
  assert.equal(normalizeName('  Valkyrie  '), 'valkyrie');
  assert.equal(normalizeName('Karna “Brimstone”  Rifle'), 'karna brimstone rifle');
});

test('el índice encuentra naves por alias', () => {
  const idx = makeShipIndex(catalog.ships);
  assert.equal(idx.find('Mercury Star Runner')?.id, 3);
  assert.equal(idx.find('Valkyrie ')?.id, 7);
  assert.equal(idx.find('Nave Inventada'), null);
});

test('parseUpgradeName separa origen y destino', () => {
  assert.deepEqual(parseUpgradeName('Upgrade - Orion To Hull E Warbond Edition'), { from: 'Orion', to: 'Hull E' });
  assert.deepEqual(parseUpgradeName('Upgrade - Freelancer DUR to Ballista  Standard Edition'), {
    from: 'Freelancer DUR',
    to: 'Ballista',
  });
});

test('buildAccount: naves, CCUs y su estado', () => {
  const acc = buildAccount({
    catalog,
    pledges: [
      ship('Orion', 28000),
      ship('Mercury Star Runner', 15000),
      ccu('Upgrade - Orion to Hull E Warbond Edition', 'Orion', ['Hull E'], 2500),
      ccu('Upgrade - Mercury to Guardian MX Warbond Edition', 'Mercury Star Runner', ['Guardian MX'], 1000),
      ccu('Upgrade - Eclipse to Starfarer Gemini Warbond Edition', 'Eclipse', ['Starfarer Gemini'], 1500),
      ccu('Upgrade - Starfarer Gemini to Valkyrie Warbond Edition', 'Starfarer Gemini', ['Valkyrie '], 1000),
      ccu('Upgrade - Starfarer Gemini to Valkyrie Warbond Edition', 'Starfarer Gemini', ['Valkyrie '], 1000),
      ccu(
        'Upgrade - Scorpius to Apollo Triage Warbond Edition',
        'Scorpius',
        ['Apollo Triage', 'Apollo Tier 1 Module Right', 'Apollo Tier 1 Module Left'],
        1000,
      ),
      ccu('F7A Hornet Mk II Upgrade', 'F7C Hornet Mk II', ['F7A Hornet Mk II'], 0),
      pledge({ name: 'Luminalia 2955 Day 1' }),
    ],
  });

  assert.equal(acc.totals.pledges, 10);
  assert.equal(acc.totals.ships, 2);
  assert.equal(acc.totals.shipsLTI, 2);
  assert.equal(acc.totals.ccus, 7);
  assert.equal(acc.totals.valueCents, 28000 + 15000 + 2500 + 1000 + 1500 + 1000 + 1000 + 1000);

  // El alias empareja "Mercury Star Runner" con "Mercury" del catálogo
  assert.equal(acc.ships.find((s) => s.name === 'Mercury')?.shipId, 3);

  const byName = (from, to) => acc.ccus.filter((c) => c.fromName === from && c.toName === to);
  const [orionHullE] = byName('Orion', 'Hull E');
  assert.equal(orionHullE.haveFromShip, true);
  assert.equal(orionHullE.orphan, false);
  assert.equal(orionHullE.edition, 'Warbond');

  const [mercGuardian] = byName('Mercury', 'Guardian MX');
  assert.equal(mercGuardian.haveFromShip, true, 'el CCU de Mercury se aplica a la Mercury Star Runner');

  // Eclipse → Gemini: no tienes Eclipse ni otro CCU que lleve a ella → huérfano
  assert.equal(byName('Eclipse', 'Starfarer Gemini')[0].orphan, true);

  // Gemini → Valkyrie: no tienes Gemini, pero el CCU anterior lleva a ella → encadenable; y está repetido
  const geminiValk = byName('Starfarer Gemini', 'Valkyrie');
  assert.equal(geminiValk.length, 2);
  assert.ok(geminiValk.every((c) => c.chainable && !c.orphan && c.copies === 2));

  // Los módulos del Apollo no se confunden con la nave destino
  const [scorpApollo] = byName('Scorpius', 'Apollo Triage');
  assert.equal(scorpApollo.toId, 9);
  assert.deepEqual(scorpApollo.extras, ['Apollo Tier 1 Module Right', 'Apollo Tier 1 Module Left']);

  // F7A Hornet Mk II no está en el catálogo → aparece como no emparejada
  assert.ok(acc.unmatched.includes('F7A Hornet Mk II'));
  assert.equal(acc.totals.ccusRepeated, 2);
});

test('buildAccount: buy-back', () => {
  const acc = buildAccount({
    catalog,
    buyback: {
      creditBuybacksLeft: 2,
      items: [
        { title: 'Upgrade - Orion to Hull E Standard Edition', isUpgrade: true, fromShipId: 1, toShipId: 2, reclaimDate: 'x' },
        { title: 'Standalone Ship - Fury - ILW', isUpgrade: false, mainItem: 'Fury', contained: 'Fury and 2 items', reclaimDate: 'x' },
        { title: 'Gear - Armor', isUpgrade: false, mainItem: null, contained: '5 items', reclaimDate: 'x' },
      ],
    },
  });
  assert.equal(acc.buyback.creditBuybacksLeft, 2);
  assert.deepEqual(
    acc.buyback.ccus.map((c) => [c.fromName, c.toName, c.edition]),
    [['Orion', 'Hull E', 'Standard']],
  );
  assert.equal(acc.buyback.ships[0].shipId, 11);
  assert.equal(acc.buyback.other.length, 1);
});

test('buildAccount sin datos no falla', () => {
  const acc = buildAccount();
  assert.equal(acc.totals.pledges, 0);
  assert.deepEqual(acc.unmatched, []);
});

test('applyReservations quita solo lo reservado (cualquier nave puede recibir un CCU)', async () => {
  const { applyReservations } = await import('../lib/account.js');
  const account = {
    ccus: [
      { pledgeId: 'c1', fromName: 'Orion', toName: 'Hull E' },
      { pledgeId: 'c2', fromName: 'Starfarer Gemini', toName: 'Valkyrie' },
    ],
    ships: [
      { pledgeId: 's1', name: 'Hull D' },
      { pledgeId: 's2', name: 'Zeus Mk II CL' },
      { pledgeId: 's3', name: 'P-52 Merlin' },
    ],
  };
  const r = applyReservations(account, { ccuPledgeIds: ['c1'], shipPledgeIds: ['s1'] });
  assert.deepEqual(r.ccus.map((c) => c.pledgeId), ['c2']);
  assert.deepEqual(r.ships.map((s) => s.pledgeId), ['s2', 's3']);
  // Sin reservas: todo disponible
  assert.equal(applyReservations(account).ships.length, 3);
  assert.equal(applyReservations(account).ccus.length, 2);
});
