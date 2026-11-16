// Visor de flota y enlace para compartir. Lógica pura, probada en tests/extras.test.js.

/** Une tus naves del hangar con sus fichas. */
export function fleetOf(accountShips = [], joined = []) {
  const byId = new Map(joined.map((s) => [s.id, s]));
  return accountShips.map((s) => ({ ...(byId.get(s.shipId) ?? {}), id: s.shipId, name: s.name, insurance: s.insurance ?? null }));
}

export function groupBy(fleet, keyFn) {
  const map = new Map();
  for (const s of fleet) {
    const k = keyFn(s) || '—';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(s);
  }
  return [...map.entries()].map(([key, ships]) => ({ key, ships })).sort((a, b) => b.ships.length - a.ships.length || a.key.localeCompare(b.key));
}

const sum = (arr, f) => arr.reduce((a, s) => a + (f(s) ?? 0), 0);

export function fleetTotals(fleet) {
  return {
    ships: fleet.length,
    minCrew: sum(fleet, (s) => s.minCrew),
    maxCrew: sum(fleet, (s) => s.maxCrew),
    cargo: sum(fleet, (s) => s.cargo),
    lti: fleet.filter((s) => s.insurance === 'LTI').length,
  };
}

// ---------- Compartir: la flota viaja dentro del enlace ----------
// Un visitante no tiene tus datos, así que el enlace lleva nombre, rol, tamaño, tripulación y carga de cada nave.
// Nada más: ni precios, ni pedidos, ni seguro, ni tu usuario.
const MAX_SHIPS = 300;

// Base64 «seguro para URL» y compatible con acentos (se pasa por UTF-8).
const toB64 = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};
const fromB64 = (s) => {
  const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

export function encodeShare(fleet = []) {
  const rows = fleet.slice(0, MAX_SHIPS).map((s) => [s.name ?? '', s.focus ?? '', s.size ?? '', s.minCrew ?? 0, s.maxCrew ?? 0, s.cargo ?? 0]);
  return `v2.${toB64(JSON.stringify(rows))}`;
}

const str = (v) => (typeof v === 'string' ? v.slice(0, 60) : '');
const int = (v) => (Number.isFinite(v) && v >= 0 && v < 100000 ? Math.round(v) : 0);

/** Devuelve las naves (ya validadas y recortadas) o null si el enlace no es válido. */
export function decodeShare(code) {
  try {
    const m = String(code ?? '').match(/^v2\.([A-Za-z0-9_-]*)$/);
    if (!m) return null;
    const rows = JSON.parse(fromB64(m[1]));
    if (!Array.isArray(rows) || rows.length > MAX_SHIPS) return null;
    return rows.map((r) => ({
      name: str(r?.[0]),
      focus: str(r?.[1]) || null,
      size: str(r?.[2]) || null,
      minCrew: int(r?.[3]),
      maxCrew: int(r?.[4]),
      cargo: int(r?.[5]),
      insurance: null,
    }));
  } catch {
    return null;
  }
}
