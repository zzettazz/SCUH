// Fichas de naves: datos de la ship matrix de RSI (rol, tripulación, carga, medidas…) y comparador.
// Lógica pura, probada en tests/ships.test.js.

const SIZE_LABEL = { snub: 'Snub', small: 'Pequeña', medium: 'Mediana', large: 'Grande', capital: 'Capital', vehicle: 'Vehículo' };
export const SIZE_ORDER = ['Snub', 'Pequeña', 'Mediana', 'Grande', 'Capital', 'Vehículo', '—'];

export function sizeLabel(size) {
  return SIZE_LABEL[String(size ?? '').toLowerCase()] ?? '—';
}

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/**
 * Reduce la ship matrix (5 MB) a lo que usa la web. Entrada: array `data` de /ship-matrix/index.
 * Devuelve un objeto { [id]: ficha } con las mismas claves que el catálogo de upgrades.
 */
export function slimShipMatrix(data = []) {
  const out = {};
  for (const s of data) {
    if (s?.id == null) continue;
    out[s.id] = {
      id: s.id,
      name: String(s.name ?? '').trim(),
      manufacturer: s.manufacturer?.name ?? null,
      manufacturerCode: s.manufacturer?.code ?? null,
      focus: s.focus ?? null,
      type: s.type ?? null,
      size: sizeLabel(s.size),
      status: s.production_status === 'flight-ready' ? 'En vuelo' : s.production_status === 'in-concept' ? 'Concepto' : s.production_status ?? null,
      minCrew: num(s.min_crew),
      maxCrew: num(s.max_crew),
      cargo: num(s.cargocapacity),
      length: num(s.length),
      beam: num(s.beam),
      height: num(s.height),
      mass: num(s.mass),
      scm: num(s.scm_speed),
      afterburner: num(s.afterburner_speed),
      description: String(s.description ?? '').slice(0, 600),
      url: s.url ?? null,
    };
  }
  return out;
}

// Fichas listas para mostrar: catálogo (precio) + ship matrix (specs).
export function joinShips(catalogShips = [], specs = {}) {
  return catalogShips.map((s) => {
    const sp = specs[s.id] ?? {};
    return {
      id: s.id,
      name: String(s.name).trim(),
      msrp: s.msrp,
      owned: !!s.owned,
      onSale: (s.skus ?? []).some((k) => k.available !== false),
      manufacturer: sp.manufacturer ?? s.manufacturer?.name ?? null,
      focus: sp.focus ?? s.focus ?? null,
      type: sp.type ?? s.type ?? null,
      size: sp.size ?? '—',
      status: sp.status ?? (s.flyableStatus ? (s.flyableStatus === 'Flyable' ? 'En vuelo' : s.flyableStatus) : null),
      minCrew: sp.minCrew ?? null,
      maxCrew: sp.maxCrew ?? null,
      cargo: sp.cargo ?? null,
      length: sp.length ?? null,
      beam: sp.beam ?? null,
      height: sp.height ?? null,
      mass: sp.mass ?? null,
      scm: sp.scm ?? null,
      description: sp.description ?? '',
    };
  });
}

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function filterShips(ships, { q = '', size = '', focus = '', owned = false, onSale = false, maxPriceCents = null } = {}) {
  const needle = fold(q).trim();
  return ships.filter((s) => {
    if (needle && !fold(`${s.name} ${s.manufacturer} ${s.focus}`).includes(needle)) return false;
    if (size && s.size !== size) return false;
    if (focus && !fold(s.focus).includes(fold(focus))) return false;
    if (owned && !s.owned) return false;
    if (onSale && !s.onSale) return false;
    if (maxPriceCents != null && s.msrp > maxPriceCents) return false;
    return true;
  });
}

export const COMPARE_FIELDS = [
  { key: 'msrp', label: 'Precio', better: 'low' },
  { key: 'size', label: 'Tamaño' },
  { key: 'focus', label: 'Rol' },
  { key: 'minCrew', label: 'Tripulación mínima', better: 'low' },
  { key: 'maxCrew', label: 'Tripulación máxima', better: 'high' },
  { key: 'cargo', label: 'Carga (SCU)', better: 'high' },
  { key: 'scm', label: 'Velocidad SCM (m/s)', better: 'high' },
  { key: 'length', label: 'Eslora (m)', better: 'high' },
  { key: 'mass', label: 'Masa (kg)', better: 'high' },
  { key: 'status', label: 'Estado' },
];

/** Filas de comparación; `best` = índices de las naves con el mejor valor de esa fila (si tiene criterio). */
export function compareShips(ships) {
  return COMPARE_FIELDS.map((f) => {
    const values = ships.map((s) => s[f.key] ?? null);
    let best = [];
    if (f.better) {
      const nums = values.map((v) => (typeof v === 'number' ? v : null));
      const valid = nums.filter((v) => v != null && (f.key !== 'cargo' || v >= 0));
      if (valid.length > 1 && new Set(valid).size > 1) {
        const target = f.better === 'low' ? Math.min(...valid) : Math.max(...valid);
        best = nums.map((v, i) => (v === target ? i : -1)).filter((i) => i >= 0);
      }
    }
    return { ...f, values, best };
  });
}

// Lista de valores distintos (para los desplegables de filtros).
export function distinct(ships, key) {
  return [...new Set(ships.map((s) => s[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}
