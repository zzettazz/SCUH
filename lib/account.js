// Lógica pura (no usa el navegador): convierte los datos crudos de RSI en un "modelo de cuenta"
// fácil de consultar. Al no depender de Chrome, se puede probar con `node --test`.

// RSI no usa siempre el mismo nombre para una nave. Clave: nombre del hangar → nombre del catálogo.
// (Todo en minúsculas y normalizado; ver normalizeName.)
export const ALIASES = {
  'mercury star runner': 'mercury',
  '600i exploration module': '600i explorer',
  '600i touring module': '600i touring',
};

export function normalizeName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[“”"’']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Índice del catálogo para buscar naves por id o por nombre.
export function makeShipIndex(catalogShips = []) {
  const byId = new Map();
  const byName = new Map();
  for (const s of catalogShips) {
    byId.set(s.id, s);
    byName.set(normalizeName(s.name), s);
  }
  return {
    byId,
    find(name) {
      const n = normalizeName(name);
      if (!n) return null;
      return byName.get(n) ?? byName.get(ALIASES[n]) ?? null;
    },
  };
}

// "Upgrade - Orion To Hull E Warbond Edition" → { from: 'Orion', to: 'Hull E' }
export function parseUpgradeName(text) {
  const clean = String(text ?? '')
    .replace(/^Upgrade - /i, '')
    .replace(/\s+(Warbond|Standard)\s+Edition$/i, '')
    .trim();
  const parts = clean.split(/\s+to\s+/i);
  return { from: (parts[0] ?? '').trim(), to: parts.slice(1).join(' to ').trim() };
}

export function editionOf(name) {
  if (/warbond/i.test(name)) return 'Warbond';
  if (/standard/i.test(name)) return 'Standard';
  return null;
}

export function buildAccount({ pledges = [], buyback = null, catalog = null } = {}) {
  const index = makeShipIndex(catalog?.ships ?? []);
  const unmatched = new Set();
  const match = (name) => {
    const s = index.find(name);
    if (!s && name) unmatched.add(name.trim());
    return s;
  };

  // ---------- Naves del hangar ----------
  const ships = [];
  for (const p of pledges) {
    for (const shipName of p.ships ?? []) {
      const s = match(shipName);
      ships.push({
        pledgeId: p.id,
        pledgeName: p.name,
        name: s?.name?.trim() ?? shipName,
        shipId: s?.id ?? null,
        msrp: s?.msrp ?? null,
        insurance: p.insurance,
        valueCents: p.valueCents,
        date: p.date,
        canGift: p.canGift,
        canExchange: p.canExchange,
      });
    }
  }

  // ---------- Upgrades (CCUs) sin aplicar ----------
  const ccus = [];
  for (const p of pledges) {
    if (!p.isUpgrade || !p.canApplyUpgrade) continue;
    const fallback = parseUpgradeName(p.items?.[0]?.title ?? p.name);
    const fromName = p.upgrade?.from?.[0] ?? fallback.from;
    // target_items puede incluir módulos, seguros o reservas de nombre:
    // nos quedamos con el primero que sea una nave del catálogo.
    const toCandidates = p.upgrade?.to?.length ? p.upgrade.to : [fallback.to];
    const toShip = toCandidates.map((n) => index.find(n)).find(Boolean) ?? null;
    if (!toShip) unmatched.add(toCandidates[0]);
    const fromShip = match(fromName);
    ccus.push({
      pledgeId: p.id,
      pledgeName: p.name,
      fromName: fromShip?.name?.trim() ?? fromName,
      toName: toShip?.name?.trim() ?? toCandidates[0],
      fromId: fromShip?.id ?? null,
      toId: toShip?.id ?? null,
      edition: editionOf(p.name),
      valueCents: p.valueCents,
      date: p.date,
      canGift: p.canGift,
      extras: toCandidates.filter((n) => n !== (toShip?.name ?? toCandidates[0])),
    });
  }

  // ---------- Estado de cada CCU ----------
  const key = (id, name) => (id != null ? `#${id}` : normalizeName(name));
  const ownedShips = new Set(ships.map((s) => key(s.shipId, s.name)));
  const ccuTargets = new Set(ccus.map((c) => key(c.toId, c.toName)));
  const repeats = new Map();
  for (const c of ccus) {
    const k = `${key(c.fromId, c.fromName)}>${key(c.toId, c.toName)}`;
    repeats.set(k, (repeats.get(k) ?? 0) + 1);
  }
  for (const c of ccus) {
    const fromKey = key(c.fromId, c.fromName);
    c.haveFromShip = ownedShips.has(fromKey); // tienes una nave a la que aplicarlo
    c.chainable = !c.haveFromShip && ccuTargets.has(fromKey); // otro CCU tuyo acaba en su nave de origen
    c.orphan = !c.haveFromShip && !c.chainable; // ni la nave ni otro CCU que lleve a ella
    c.haveTargetShip = ownedShips.has(key(c.toId, c.toName));
    c.copies = repeats.get(`${fromKey}>${key(c.toId, c.toName)}`);
  }

  // ---------- Buy-back ----------
  const bb = { ships: [], ccus: [], other: [], creditBuybacksLeft: buyback?.creditBuybacksLeft ?? null };
  for (const b of buyback?.items ?? []) {
    if (b.isUpgrade) {
      const from = index.byId.get(b.fromShipId);
      const to = index.byId.get(b.toShipId);
      const fallback = parseUpgradeName(b.title);
      bb.ccus.push({
        title: b.title,
        reclaimDate: b.reclaimDate,
        pledgeId: b.pledgeId ?? null,
        toSkuId: b.toSkuId ?? null,
        fromId: b.fromShipId,
        toId: b.toShipId,
        fromName: from?.name?.trim() ?? fallback.from,
        toName: to?.name?.trim() ?? fallback.to,
        edition: editionOf(b.title),
      });
      continue;
    }
    const s = b.mainItem ? index.find(b.mainItem) : null;
    if (s) {
      bb.ships.push({ title: b.title, reclaimDate: b.reclaimDate, name: s.name.trim(), shipId: s.id, msrp: s.msrp, contained: b.contained });
    } else {
      bb.other.push({ title: b.title, reclaimDate: b.reclaimDate, contained: b.contained });
    }
  }

  // ---------- Totales ----------
  const sum = (arr) => arr.reduce((a, x) => a + (x.valueCents ?? 0), 0);
  const totals = {
    pledges: pledges.length,
    valueCents: sum(pledges),
    ships: ships.length,
    shipsLTI: ships.filter((s) => s.insurance === 'LTI').length,
    shipsValueCents: sum(ships),
    ccus: ccus.length,
    ccusValueCents: sum(ccus),
    ccusRepeated: ccus.filter((c) => c.copies > 1).length,
    ccusOrphan: ccus.filter((c) => c.orphan).length,
    buybackShips: bb.ships.length,
    buybackCcus: bb.ccus.length,
    buybackOther: bb.other.length,
  };

  return { ships, ccus, buyback: bb, unmatched: [...unmatched].sort(), totals };
}

/**
 * Reservas: CCUs y naves que el usuario no quiere usar en la calculadora.
 * @param reserved { ccuPledgeIds: string[], shipPledgeIds: string[] }
 * @returns { ccus, ships } — los CCUs utilizables y las naves que pueden ser punto de partida.
 * Nota: cualquier nave puede recibir un CCU (se aplica desde el propio CCU si tienes la nave de origen),
 * aunque su pledge no muestre el botón «Upgrades».
 */
export function applyReservations(account, reserved = {}) {
  const ccuIds = new Set(reserved.ccuPledgeIds ?? []);
  const shipIds = new Set(reserved.shipPledgeIds ?? []);
  return {
    ccus: (account?.ccus ?? []).filter((c) => !ccuIds.has(c.pledgeId)),
    ships: (account?.ships ?? []).filter((s) => !shipIds.has(s.pledgeId)),
  };
}
