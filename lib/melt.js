// «Qué canjear»: para cada pledge canjeable, cuánto crédito te da y cuánto pierdes.
// Lógica pura, probada en tests/melt.test.js.
//
// Ideas clave:
//   - Al canjear recibes el valor del pledge en crédito de tienda.
//   - Un CCU que pagaste barato (Warbond o precios antiguos) hoy costaría más: esa diferencia es lo que pierdes.
//   - Si la nave destino ya no vale más que la de origen, el CCU no se puede aplicar: canjearlo no pierde nada.
//   - Una nave con upgrades aplicados: en el buy-back solo recuperas el pledge original, no la nave actual.

import { normalizeName } from './account.js';

export const LEVELS = { bajo: 0, medio: 1, alto: 2 };
const GAME = /Star Citizen Digital Download|Squadron 42 Digital Download/i;

function kindOf(p) {
  if (p.isUpgrade) return /warbond/i.test(p.name) ? 'CCU Warbond' : 'CCU Standard';
  if (p.ships?.length) return 'Nave';
  if (/^Paints - /i.test(p.name)) return 'Pintura';
  if (/Subscribers Store/i.test(p.name)) return 'Suscriptor';
  return 'Otro';
}

/**
 * @param pledges   pledges crudos (de content.js)
 * @param account   resultado de buildAccount
 * @param catalog   catálogo (para el msrp actual de las naves)
 * @param reserved  { ccuPledgeIds, shipPledgeIds }
 * @param creditBuybacksLeft  recompras con crédito que quedan
 */
export function meltAdvice({ pledges = [], account, catalog, reserved = {}, creditBuybacksLeft = null }) {
  const msrp = new Map((catalog?.ships ?? []).map((s) => [s.id, s.msrp]));
  const ccuByPledge = new Map((account?.ccus ?? []).map((c) => [c.pledgeId, c]));
  const reservedIds = new Set([...(reserved.ccuPledgeIds ?? []), ...(reserved.shipPledgeIds ?? [])]);
  const seenCcu = new Set(); // para distinguir la primera copia de las repetidas

  const rows = [];
  for (const p of pledges) {
    if (!p.canExchange || !(p.valueCents > 0)) continue;
    const row = { pledgeId: p.id, name: p.name, kind: kindOf(p), creditCents: p.valueCents, lossCents: null, rebuyCents: null, reasons: [] };
    let level = 'bajo';
    const raise = (l) => {
      if (LEVELS[l] > LEVELS[level]) level = l;
    };

    const c = ccuByPledge.get(p.id);
    if (c) {
      const from = msrp.get(c.fromId);
      const to = msrp.get(c.toId);
      const key = `${c.fromId ?? c.fromName}>${c.toId ?? c.toName}`;
      const extraCopy = seenCcu.has(key);
      seenCcu.add(key);
      if (from != null && to != null && to <= from) {
        row.lossCents = 0;
        row.reasons.push(`Ya no se puede aplicar: ${c.toName} no vale más que ${c.fromName}.`);
      } else if (from != null && to != null) {
        row.rebuyCents = to - from;
        row.lossCents = Math.max(0, row.rebuyCents - p.valueCents);
        if (extraCopy) row.reasons.push('Copia repetida: te queda otra igual.');
        if (row.lossCents > 0) {
          row.reasons.push(`Volver a comprarlo hoy costaría ${row.rebuyCents / 100} $ sin impuestos.`);
          raise(extraCopy || row.lossCents < 2000 ? 'medio' : 'alto');
        }
      } else {
        row.reasons.push('No encuentro sus naves en el catálogo: revísalo a mano.');
        raise('medio');
      }
    } else if (p.ships?.length) {
      raise('alto');
      const shipName = p.ships.join(' + ');
      if (!p.ships.some((s) => normalizeName(p.name).includes(normalizeName(s)))) {
        row.reasons.push(`Lleva upgrades aplicados: en el buy-back recuperarías «${p.name}», no la ${shipName}.`);
      }
      if (p.insurance === 'LTI') {
        row.reasons.push(
          `Tiene LTI: se conserva si lo recompras` +
            (creditBuybacksLeft != null ? `, pero solo te quedan ${creditBuybacksLeft} recompras con crédito.` : '.'),
        );
      }
    } else if (row.kind === 'Pintura' || row.kind === 'Suscriptor') {
      row.reasons.push('Solo estético.');
    } else {
      row.reasons.push('Objeto sin nave.');
    }

    if ((p.items ?? []).some((i) => GAME.test(i.title))) {
      raise('alto');
      row.reasons.push('Incluye el juego (Star Citizen o Squadron 42).');
    }
    if (reservedIds.has(p.id)) {
      raise('alto');
      row.reasons.unshift('Lo tienes reservado en la calculadora.');
    }

    row.level = level;
    rows.push(row);
  }

  rows.sort(
    (a, b) =>
      LEVELS[a.level] - LEVELS[b.level] || (a.lossCents ?? 0) - (b.lossCents ?? 0) || b.creditCents - a.creditCents,
  );
  return rows;
}

// Suma lo marcado para canjear.
export function meltSelectionTotals(rows, selectedIds = []) {
  const sel = new Set(selectedIds);
  const chosen = rows.filter((r) => sel.has(r.pledgeId));
  return {
    count: chosen.length,
    creditCents: chosen.reduce((a, r) => a + r.creditCents, 0),
    lossCents: chosen.reduce((a, r) => a + (r.lossCents ?? 0), 0),
  };
}
