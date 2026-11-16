// Exportar a CSV pensando en Excel en español:
//   - separador ";" (Excel ES usa la coma para los decimales)
//   - importes con coma decimal y sin símbolo: 25,00
//   - BOM UTF-8 al principio para que Excel lea bien los acentos

import { enrichLog, TYPE_LABELS } from './log.js';

const BOM = '﻿';

export function csvCell(value) {
  if (value == null) return '';
  const s = String(value);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns, rows) {
  const head = columns.map((c) => csvCell(c.title)).join(';');
  const body = rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(';'));
  return BOM + [head, ...body].join('\r\n') + '\r\n';
}

// Céntimos → "1234,56" (número que Excel ES entiende)
export const amount = (cents) => (cents == null ? '' : (cents / 100).toFixed(2).replace('.', ','));
const yesNo = (b) => (b ? 'sí' : 'no');

export function shipsCsv(account) {
  return toCsv(
    [
      { title: 'Nave', value: (s) => s.name },
      { title: 'Pledge', value: (s) => s.pledgeName },
      { title: 'Id pledge', value: (s) => s.pledgeId },
      { title: 'Seguro', value: (s) => s.insurance },
      { title: 'Valor (USD)', value: (s) => amount(s.valueCents) },
      { title: 'Fecha', value: (s) => s.date },
      { title: 'Regalable', value: (s) => yesNo(s.canGift) },
      { title: 'Canjeable', value: (s) => yesNo(s.canExchange) },
    ],
    account.ships,
  );
}

export function ccusCsv(account) {
  return toCsv(
    [
      { title: 'De', value: (c) => c.fromName },
      { title: 'A', value: (c) => c.toName },
      { title: 'Edición', value: (c) => c.edition },
      { title: 'Valor (USD)', value: (c) => amount(c.valueCents) },
      { title: 'Fecha', value: (c) => c.date },
      { title: 'Tienes la nave', value: (c) => yesNo(c.haveFromShip) },
      { title: 'Encadenable', value: (c) => yesNo(c.chainable) },
      { title: 'Sin nave', value: (c) => yesNo(c.orphan) },
      { title: 'Copias', value: (c) => c.copies },
      { title: 'Id pledge', value: (c) => c.pledgeId },
    ],
    account.ccus,
  );
}

export function buybackCsv(account) {
  const bb = account.buyback;
  const rows = [
    ...bb.ships.map((b) => ({ tipo: 'Nave', titulo: b.title, detalle: b.name, fecha: b.reclaimDate })),
    ...bb.ccus.map((c) => ({ tipo: 'Upgrade', titulo: c.title, detalle: `${c.fromName} → ${c.toName}`, fecha: c.reclaimDate })),
    ...bb.other.map((o) => ({ tipo: 'Otro', titulo: o.title, detalle: o.contained, fecha: o.reclaimDate })),
  ];
  return toCsv(
    [
      { title: 'Tipo', value: (r) => r.tipo },
      { title: 'Pledge', value: (r) => r.titulo },
      { title: 'Detalle', value: (r) => r.detalle },
      { title: 'Canjeado', value: (r) => r.fecha },
    ],
    rows,
  );
}

export function logCsv(entries) {
  return toCsv(
    [
      { title: 'Fecha', value: (e) => e.date },
      { title: 'Tipo', value: (e) => TYPE_LABELS[e.type] ?? e.type },
      { title: 'Pledge', value: (e) => e.pledgeName },
      { title: 'Id pledge', value: (e) => e.pledgeId },
      { title: 'Importe (USD)', value: (e) => amount(e.valueCents) },
      { title: 'Texto original', value: (e) => e.text },
    ],
    enrichLog(entries),
  );
}
