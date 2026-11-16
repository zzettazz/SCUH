import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLogEntry, summarizeLog, yearOf } from '../lib/log.js';

// Textos con el mismo formato que el Hangar log real (usuario y pedidos inventados).
const e = (date, text, pledgeName = 'X') => ({ date, pledgeName, pledgeId: '1', text });

test('classifyLogEntry reconoce cada tipo y su importe', () => {
  const cases = [
    ['Created by piloto - order #ABC123, value: $25.00 USD', 'purchase', 2500],
    ['Claimed as a gift by piloto, value: $370.00 USD', 'giftReceived', 37000],
    ['Gifted to amigo@example.com value: $1,250.00 USD', 'giftSent', 125000],
    ['Reclaimed by piloto for $45.00 USD', 'reclaim', 4500],
    ['Created by piloto - Buy-Back order #XYZ', 'buyback', null],
    ['Buy-back by piloto - order #XYZ', 'buybackSource', null],
    ['Consumed by piloto on pledge #50033708, value: $10.00 USD', 'ccuConsumed', 1000],
    ['Upgrade applied: #73501719 Upgrade - M2 Hercules to C2 Hercules Standard Edition', 'upgradeApplied', null],
    ['FIX - Upgrade applied: #38007208 Upgrade - Merchantman to ...', 'fix', null],
    ['Name Reservation: (S-ANVIL-CARRACK/NOMBRE) on item ...', 'name', null],
    ['Reward!', 'other', null],
    ['Star Citizen Team', 'other', null],
  ];
  for (const [text, type, valueCents] of cases) {
    assert.deepEqual(classifyLogEntry(text), { type, valueCents }, text);
  }
});

test('yearOf saca el año de la fecha del log', () => {
  assert.equal(yearOf('Oct 20 2026, 11:16 pm'), 2026);
  assert.equal(yearOf('sin fecha'), null);
});

test('summarizeLog suma por año', () => {
  const s = summarizeLog([
    e('Apr 29 2026, 10:59 pm', 'Created by p - order #A, value: $25.00 USD'),
    e('Jan 02 2026, 10:00 am', 'Created by p - order #B, value: $10.00 USD'),
    e('Dec 03 2024, 1:00 pm', 'Reclaimed by p for $45.00 USD'),
    e('Dec 03 2024, 1:00 pm', 'Gifted to q value: $5.00 USD'),
    e('Dec 03 2024, 1:00 pm', 'Upgrade applied: #1 Upgrade - A to B Standard Edition'),
    e('Dec 03 2024, 1:00 pm', 'FIX - Upgrade applied: #1 Upgrade - A to B Standard Edition'),
  ]);
  assert.deepEqual(
    s.rows.map((r) => [r.year, r.purchases, r.purchasesCents, r.reclaimsCents, r.giftsSent, r.upgradesApplied]),
    [
      [2026, 2, 3500, 0, 0, 0],
      [2024, 0, 0, 4500, 1, 1], // la línea FIX no cuenta como otro upgrade
    ],
  );
  assert.equal(s.total.purchasesCents, 3500);
  assert.equal(s.total.upgradesApplied, 1);
});
