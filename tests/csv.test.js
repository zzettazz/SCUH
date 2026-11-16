import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amount, csvCell, logCsv, shipsCsv, toCsv } from '../lib/csv.js';

test('csvCell escapa ; comillas y saltos de línea', () => {
  assert.equal(csvCell('Hull E'), 'Hull E');
  assert.equal(csvCell('a;b'), '"a;b"');
  assert.equal(csvCell('Parallax "Piconalia"'), '"Parallax ""Piconalia"""');
  assert.equal(csvCell(null), '');
});

test('amount usa coma decimal para Excel en español', () => {
  assert.equal(amount(2500), '25,00');
  assert.equal(amount(13725), '137,25');
  assert.equal(amount(null), '');
});

test('toCsv: BOM, cabecera y filas separadas por ;', () => {
  const csv = toCsv([{ title: 'A', value: (r) => r.a }, { title: 'B', value: (r) => r.b }], [{ a: 1, b: 'x;y' }]);
  assert.ok(csv.startsWith('﻿'));
  assert.equal(csv.slice(1), 'A;B\r\n1;"x;y"\r\n');
});

test('shipsCsv y logCsv generan una fila por elemento', () => {
  const account = {
    ships: [{ name: 'Carrack', pledgeName: 'Standalone Ship - Spartan', pledgeId: '1', insurance: 'LTI', valueCents: 25000, date: 'x', canGift: false, canExchange: true }],
  };
  const lines = shipsCsv(account).trim().split('\r\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[1], 'Carrack;Standalone Ship - Spartan;1;LTI;250,00;x;no;sí');

  const log = logCsv([{ date: 'Apr 29 2026, 10:59 pm', pledgeName: 'P', pledgeId: '9', text: 'Reclaimed by p for $45.00 USD' }]);
  assert.match(log, /Canje a crédito;P;9;45,00/);
});
