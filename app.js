// Web de RSI Upgrade Helper: recibe los datos que lee el marcador en RSI, construye el modelo de cuenta
// y lo muestra. Todo se guarda solo en este navegador (localStorage); no hay servidor.

import { applyReservations, buildAccount } from './lib/account.js';
import {
  budgetPlan,
  buildGraph,
  buybackPriceQueue,
  payment,
  planUpgrade,
  reachableTargets,
  resolveBuybackPrices,
  upgradeOptionsFrom,
} from './lib/chain.js';
import { meltAdvice, meltSelectionTotals } from './lib/melt.js';
import { buybackCsv, ccusCsv, logCsv, shipsCsv } from './lib/csv.js';
import { money, taxPercent } from './lib/format.js';
import { enrichLog, summarizeLog, TYPE_LABELS } from './lib/log.js';
import { diffStore, evaluateGoals } from './lib/watch.js';

const $ = (id) => document.getElementById(id);

// Todo lo que guardamos.
let state = {
  catalog: null,
  storeTargets: null,
  prevStoreTargets: null, // foto anterior, para detectar Warbonds nuevos
  pledges: null,
  buyback: null,
  savedAt: null,
  log: null,
  logSavedAt: null,
  skuPrices: {}, // precios exactos de ediciones del buy-back { skuId: céntimos }
  goals: [], // [{ fromId, toId, lastTotalWithTax, savedAt }]
  goalAlerts: [], // resultado de la última comprobación de objetivos
  reserved: { ccuPledgeIds: [], shipPledgeIds: [] }, // lo que la calculadora no debe usar
  storeCreditCents: null, // crédito de tienda leído de /account/billing
  meltSelection: [], // pledges marcados en «Canjear» para simular
};
let meltRows = [];
let creditTouched = false; // el usuario ha escrito su propio crédito
let account = null;
let usable = null; // { ccus, ships } tras quitar las reservas
let graph = null;
let lastPlan = null; // última ruta calculada (para «Guardar como objetivo»)

// Guardado local (solo en este navegador). Envuelto en try/catch: en modo privado puede fallar.
const STORAGE_KEY = 'rsi-upgrade-helper-state';
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    setStatus(`No se pudo guardar en el navegador (${e.name}). Los datos se perderán al cerrar.`, 'err');
  }
}
const taxRate = () => state.catalog?.app?.pricing?.taxRate ?? 0;

// ---------- Pequeñas utilidades de interfaz (sin innerHTML: los textos vienen de la web) ----------
function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}

function setStatus(text, kind = '') {
  $('status').textContent = text;
  $('status').className = `out ${kind}`;
}

const tag = (text, kind) => el('span', { className: `tag ${kind}` }, text);

// columns: [{ title, num?, cell: (row) => texto | Node }]
function table(columns, rows) {
  return el(
    'div',
    { className: 'table-wrap' },
    el(
      'table',
      {},
      el('thead', {}, el('tr', {}, columns.map((c) => el('th', { className: c.num ? 'num' : '' }, c.title)))),
      el('tbody', {}, rows.map((r) => el('tr', {}, columns.map((c) => el('td', { className: c.num ? 'num' : '' }, c.cell(r)))))),
    ),
  );
}

function card(label, value, detail) {
  return el(
    'div',
    { className: 'card' },
    el('div', { className: 'label' }, label),
    el('div', { className: 'value' }, value),
    detail && el('div', { className: 'detail' }, detail),
  );
}

const shipName = (id) => graph?.ships.get(id)?.name ?? state.catalog?.ships.find((s) => s.id === id)?.name?.trim() ?? `#${id}`;

// ---------- Pestañas ----------
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---------- Datos que llegan del marcador (bookmarklet) ----------
const RSI_ORIGIN = 'https://robertsspaceindustries.com';
const APP_URL = new URL('./', location.href).href;

// Construye el marcador: carga collector.js desde ESTA web dentro de la página de RSI.
function setupBookmarklet() {
  const code =
    "javascript:(function(){if(location.hostname!=='robertsspaceindustries.com'){alert('Abre robertsspaceindustries.com con tu sesi\u00f3n iniciada y pulsa el marcador all\u00ed.');return;}" +
    `window.__RSI_HELPER_APP='${APP_URL}';var s=document.createElement('script');s.src='${APP_URL}collector.js?t='+Date.now();document.body.appendChild(s);})();`;
  $('bookmarklet').href = code;
  $('bookmarklet').addEventListener('click', (e) => {
    e.preventDefault();
    alert('Arrastra este botón a tu barra de marcadores y púlsalo estando en robertsspaceindustries.com.');
  });
  $('bookmarklet-code').value = code;
}

// Comprueba que lo recibido tiene la forma esperada.
function validPayload(p) {
  return p && p.source === 'rsi-upgrade-helper' && p.version === 1 && Array.isArray(p.pledges) && p.catalog?.ships;
}

function importPayload(p) {
  if (state.storeTargets && p.storeTargets) state.prevStoreTargets = state.storeTargets; // para avisos de Warbonds
  state.catalog = p.catalog ?? state.catalog;
  state.storeTargets = p.storeTargets ?? state.storeTargets;
  state.pledges = p.pledges;
  state.buyback = p.buyback ?? state.buyback;
  if (p.storeCreditCents != null) state.storeCreditCents = p.storeCreditCents;
  state.skuPrices = { ...state.skuPrices, ...(p.skuPrices ?? {}) };
  if (p.log) {
    state.log = p.log;
    state.logSavedAt = p.collectedAt;
  }
  state.savedAt = p.collectedAt ?? Date.now();
  creditTouched = false;
  render();
  checkGoals();
  save();
  render();
  showTab('summary');
}

window.addEventListener('message', (e) => {
  if (e.origin !== RSI_ORIGIN || e.data?.type !== 'rsi-helper-data') return;
  const p = e.data.payload;
  if (!validPayload(p)) return;
  // El marcador reintenta el envío hasta recibir confirmación: no importamos dos veces lo mismo.
  if (state.savedAt !== p.collectedAt) importPayload(p);
  e.source?.postMessage({ type: 'rsi-helper-ack' }, RSI_ORIGIN);
  if (location.hash === '#import') history.replaceState(null, '', location.pathname + location.search);
});

// Importar el archivo descargado desde el panel de RSI (si el navegador bloqueó la ventana).
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const p = JSON.parse(await file.text());
    if (!validPayload(p)) throw new Error('El archivo no parece de RSI Upgrade Helper.');
    importPayload(p);
    $('import-status').textContent = '✔ Datos importados.';
    $('import-status').className = 'out ok';
  } catch (err) {
    $('import-status').textContent = `✖ ${err.message}`;
    $('import-status').className = 'out err';
  }
});

$('btn-refresh').addEventListener('click', () => showTab('connect'));

$('btn-clear').addEventListener('click', () => {
  if (!confirm('¿Borrar todos tus datos guardados en este navegador (hangar, objetivos, reservas…)?')) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* sin almacenamiento */
  }
  location.reload();
});

// Compara cada objetivo con su último precio y guarda el aviso; luego actualiza el precio de referencia.
function checkGoals() {
  if (!graph || !state.goals.length) {
    state.goalAlerts = [];
    return;
  }
  const evaluated = evaluateGoals(state.goals, graph, { taxRate: taxRate(), useBuyback: true });
  state.goalAlerts = evaluated.filter((g) => g.cheaper || g.pricier || g.unreachable);
  state.goals = evaluated.map((g) => ({
    fromId: g.fromId,
    toId: g.toId,
    savedAt: g.savedAt,
    lastTotalWithTax: g.now ?? g.lastTotalWithTax,
  }));
}

// ---------- Pintar todo ----------
function render() {
  if (!state.savedAt) return;
  account = buildAccount(state);
  usable = applyReservations(account, state.reserved);
  const resolvedBb = resolveBuybackPrices(account.buyback.ccus, state.catalog, state.skuPrices);
  graph = state.catalog
    ? buildGraph({ catalog: state.catalog, storeTargets: state.storeTargets ?? [], ownedCcus: usable.ccus, buybackCcus: resolvedBb })
    : null;
  setStatus(`✔ Datos del ${new Date(state.savedAt).toLocaleString('es-ES')}`, 'ok');
  renderSummary();
  renderShips();
  renderCcus();
  renderBuyback();
  renderPriceSelector();
  renderMelt();
  renderCalculator(resolvedBb);
  renderReservations();
  renderGoals();
  if (state.log) renderLog();
  else $('log-status').textContent = 'Aún no has traído el historial: pulsa el marcador en RSI y marca «Incluir historial».';
}

function renderSummary() {
  const t = account.totals;
  const alerts = [];

  // Objetivos que han cambiado de precio en la última actualización
  for (const g of state.goalAlerts ?? []) {
    const name = `${shipName(g.fromId)} → ${shipName(g.toId)}`;
    if (g.cheaper) alerts.push(['good', `¡Objetivo más barato! ${name}: ahora ${money(g.now)} (antes ${money(g.before)}).`]);
    else if (g.pricier) alerts.push(['warn', `Objetivo más caro: ${name}: ahora ${money(g.now)} (antes ${money(g.before)}).`]);
    else if (g.unreachable) alerts.push(['warn', `Objetivo sin ruta: ${name}. Ya no hay forma de llegar con lo que se vende.`]);
  }

  // Cambios en la tienda desde la actualización anterior
  const diff = diffStore(state.prevStoreTargets, state.storeTargets);
  for (const s of diff.newWarbonds) alerts.push(['good', `Nuevo Warbond a la venta: ${shipName(s.toId)} por ${money(s.price)} (sin impuestos).`]);
  for (const s of diff.goneWarbonds) alerts.push(['info', `Ya no está a la venta el Warbond de ${shipName(s.toId)}.`]);
  for (const s of diff.priceChanges) alerts.push(['info', `${shipName(s.toId)} (${s.title}): ${money(s.before)} → ${money(s.price)}.`]);

  for (const c of account.ccus.filter((c) => c.copies > 1)) {
    alerts.push(['warn', `Upgrade repetido: ${c.fromName} → ${c.toName} (tienes ${c.copies})`]);
  }
  const orphans = account.ccus.filter((c) => c.orphan);
  if (orphans.length) {
    alerts.push([
      'info',
      `${orphans.length} upgrades sin nave de origen (ni otro upgrade que lleve a ella): ` +
        orphans.map((c) => `${c.fromName} → ${c.toName}`).join(', '),
    ]);
  }
  for (const c of account.ccus.filter((c) => c.haveTargetShip)) {
    alerts.push(['info', `Ya tienes la nave destino de ${c.fromName} → ${c.toName}.`]);
  }
  const unique = [...new Map(alerts.map((a) => [a[1], a])).values()];

  $('summary-out').replaceChildren(
    el(
      'div',
      { className: 'cards' },
      card('Valor del hangar', money(t.valueCents), `${t.pledges} pledges`),
      card('Naves', t.ships, `${t.shipsLTI} con LTI · ${money(t.shipsValueCents)}`),
      card('Upgrades sin aplicar', t.ccus, money(t.ccusValueCents)),
      card('Buy-back', t.buybackShips + t.buybackCcus + t.buybackOther, `${t.buybackShips} naves · ${t.buybackCcus} upgrades`),
    ),
    el('h3', {}, `Avisos (${unique.length})`),
    unique.length
      ? el('ul', { className: 'alerts' }, unique.map(([kind, text]) => el('li', { className: kind }, text)))
      : el('p', { className: 'empty' }, 'Nada que revisar.'),
    !state.prevStoreTargets
      ? el('p', { className: 'hint' }, 'Los avisos de Warbonds nuevos aparecerán a partir de la próxima actualización.')
      : null,
    account.unmatched.length
      ? el('p', { className: 'hint' }, `Nombres que no encuentro en el catálogo (naves que ya no se venden o módulos): ${account.unmatched.join(', ')}`)
      : null,
  );
}

function renderShips() {
  const rows = [...account.ships].sort((a, b) => (b.valueCents ?? 0) - (a.valueCents ?? 0));
  $('tab-ships').replaceChildren(
    el('p', { className: 'hint' }, 'Valor = lo que te devolvería RSI en crédito si canjearas el pledge.'),
    table(
      [
        { title: 'Nave', cell: (s) => s.name },
        { title: 'Seguro', cell: (s) => s.insurance ?? '—' },
        { title: 'Valor', num: true, cell: (s) => money(s.valueCents) },
        { title: '', cell: (s) => (s.canGift ? tag('regalable', 'info') : '') },
      ],
      rows,
    ),
  );
}

function ccuStatus(c) {
  const tags = [];
  if (c.haveFromShip) tags.push(tag('tienes la nave', 'ok'));
  if (c.chainable) tags.push(tag('encadenable', 'info'));
  if (c.orphan) tags.push(tag('sin nave', 'warn'));
  if (c.copies > 1) tags.push(tag(`×${c.copies}`, 'warn'));
  return el('span', {}, tags);
}

function renderCcus() {
  const rows = [...account.ccus].sort((a, b) => a.fromName.localeCompare(b.fromName));
  $('tab-ccus').replaceChildren(
    el('p', { className: 'hint' }, '«Encadenable»: no tienes la nave de origen, pero otro upgrade tuyo termina en ella.'),
    table(
      [
        { title: 'De → A', cell: (c) => `${c.fromName} → ${c.toName}` },
        { title: 'Edición', cell: (c) => c.edition ?? '—' },
        { title: 'Valor', num: true, cell: (c) => money(c.valueCents) },
        { title: 'Estado', cell: ccuStatus },
      ],
      rows,
    ),
  );
}

function renderBuyback() {
  const bb = account.buyback;
  $('tab-buyback').replaceChildren(
    bb.creditBuybacksLeft != null
      ? el('p', { className: 'hint' }, `Te quedan ${bb.creditBuybacksLeft} recompras con crédito de tienda; el resto, con dinero.`)
      : null,
    el('h3', {}, `Naves (${bb.ships.length})`),
    table(
      [
        { title: 'Nave', cell: (b) => b.name },
        { title: 'Pledge', cell: (b) => b.title },
        { title: 'Canjeado', cell: (b) => b.reclaimDate },
      ],
      bb.ships,
    ),
    el('h3', {}, `Upgrades (${bb.ccus.length})`),
    table(
      [
        { title: 'De → A', cell: (c) => `${c.fromName} → ${c.toName}` },
        { title: 'Edición', cell: (c) => c.edition ?? '—' },
        { title: 'Canjeado', cell: (c) => c.reclaimDate },
      ],
      bb.ccus,
    ),
    el('h3', {}, `Otros (${bb.other.length})`),
    el('p', { className: 'hint' }, 'Pinturas, equipo y paquetes sin nave reconocible.'),
  );
}

// ---------- Calculadora ----------
function renderCalculator(resolvedBb) {
  if (!graph || !state.storeTargets) return;
  const byValue = (a, b) => a.msrp - b.msrp || a.name.localeCompare(b.name);
  const option = (s) => el('option', { value: s.id }, `${s.name} (${money(s.msrp)})`);
  const all = [...graph.ships.values()];
  // «Mis naves» = naves no reservadas.
  const ownedIds = new Set(usable.ships.map((s) => s.shipId).filter((id) => id != null));

  const from = $('calc-from');
  const prevFrom = from.value;
  from.replaceChildren(
    el('optgroup', { label: 'Mis naves (no reservadas)' }, all.filter((s) => ownedIds.has(s.id)).sort(byValue).map(option)),
    el('optgroup', { label: 'Todas (nave nueva)' }, all.filter((s) => !ownedIds.has(s.id)).sort(byValue).map(option)),
  );
  if (prevFrom) from.value = prevFrom;
  fillTargets();

  // Estado de los precios del buy-back
  const exact = resolvedBb.filter((b) => b.priceExact).length;
  const estimated = resolvedBb.filter((b) => !b.priceExact && b.price != null).length;
  const unknown = resolvedBb.filter((b) => b.price == null).length;
  const queue = buybackPriceQueue(resolvedBb);
  $('bb-prices-status').textContent =
    `Upgrades del buy-back: ${exact} con precio exacto, ${estimated} estimados (≈), ${unknown} sin precio` +
    (queue.length ? ` · ${queue.length} ediciones sin consultar: vuelve a pulsar el marcador para actualizarlas.` : '.');


  from.disabled = $('calc-to').disabled = $('btn-calc').disabled = false;
}

function fillTargets() {
  if (!graph) return;
  const byValue = (a, b) => a.msrp - b.msrp || a.name.localeCompare(b.name);
  const to = $('calc-to');
  const prevTo = to.value;
  to.replaceChildren(
    ...reachableTargets(graph, { useBuyback: $('calc-buyback').checked })
      .sort(byValue)
      .map((s) => el('option', { value: s.id }, `${s.name} (${money(s.msrp)})`)),
  );
  if (prevTo) to.value = prevTo;
}
$('calc-buyback').addEventListener('change', fillTargets);

const KIND_TAG = {
  Tuyo: ['ya lo tienes', 'ok'],
  Warbond: ['Warbond', 'warn'],
  Standard: ['Standard', 'info'],
  'Buy-back': ['buy-back', 'warn'],
};

function routeBox(title, route, { best = false, cash = false, note = '', pay = null } = {}) {
  return el(
    'div',
    { className: `route${best ? ' best' : ''}${cash ? ' cash' : ''}` },
    el('h4', {}, title),
    el('div', { className: 'big' }, `${route.estimated ? '≈ ' : ''}${money(route.totalWithTax)}`),
    pay
      ? el(
          'div',
          { className: 'detail pay' },
          `Con tu crédito: ${money(pay.cashCents)} de tu bolsillo + ${money(pay.creditUsedCents)} de crédito.`,
        )
      : null,
    el(
      'div',
      { className: 'detail' },
      `${money(route.total)} sin impuestos · con IVA ${taxPercent(taxRate())} · ${route.steps.length} paso(s), ${route.toBuy} por comprar`,
    ),
    route.cashOnlyWithTax > 0
      ? el('div', { className: 'detail' }, `De ello, ${money(route.cashOnlyWithTax)} en Warbond de la tienda: solo con dinero.`)
      : null,
    route.buybackSteps > 0
      ? el(
          'div',
          { className: 'detail' },
          `Incluye ${route.buybackSteps} recompra(s) del buy-back: con crédito solo te quedan ${account.buyback.creditBuybacksLeft ?? '?'}; el resto, con dinero.`,
        )
      : null,
    route.estimated ? el('div', { className: 'detail' }, '≈ Algún precio del buy-back es estimado: consulta los precios exactos.') : null,
    note ? el('div', { className: 'detail' }, note) : null,
    table(
      [
        { title: '#', cell: (s) => String(route.steps.indexOf(s) + 1) },
        { title: 'De → A', cell: (s) => `${s.fromName} → ${s.toName}` },
        {
          title: 'Tipo',
          cell: (s) => {
            const [label, kind] = KIND_TAG[s.kind] ?? [s.kind, 'info'];
            return el('span', {}, tag(label, kind), s.kind === 'Buy-back' && s.edition ? tag(s.edition, 'info') : null);
          },
        },
        { title: 'Precio', num: true, cell: (s) => `${s.estimated ? '≈ ' : ''}${money(s.costWithTax)}` },
      ],
      route.steps,
    ),
  );
}

function calcOptions() {
  return { taxRate: taxRate(), useOwned: $('calc-owned').checked, useBuyback: $('calc-buyback').checked };
}

$('btn-calc').addEventListener('click', () => {
  const out = $('calc-out');
  const fromId = Number($('calc-from').value);
  const toId = Number($('calc-to').value);
  const from = graph.ships.get(fromId);
  const to = graph.ships.get(toId);
  lastPlan = null;
  $('btn-goal').disabled = true;

  if (fromId === toId) {
    out.replaceChildren(el('p', { className: 'out err' }, 'Elige dos naves distintas.'));
    return;
  }
  if (to.msrp <= from.msrp) {
    out.replaceChildren(
      el('p', { className: 'out err' }, `No se puede: ${to.name} (${money(to.msrp)}) no vale más que ${from.name} (${money(from.msrp)}). RSI no permite bajar de nave.`),
    );
    return;
  }

  const opts = calcOptions();
  const plan = planUpgrade(graph, fromId, toId, opts);
  if (!plan.best) {
    out.replaceChildren(el('p', { className: 'out err' }, `No encuentro ninguna forma de llegar a ${to.name}.`));
    return;
  }
  lastPlan = { fromId, toId, plan };
  $('btn-goal').disabled = false;

  // Presupuesto: crédito escrito + lo marcado en «Canjear»
  const credit = availableCredit();
  const money0 = { creditCents: credit, creditBuybacks: account.buyback.creditBuybacksLeft ?? 0 };
  const bp = budgetPlan(graph, fromId, toId, { ...opts, ...money0 });
  const sig = (r) => r.steps.map((s) => `${s.fromId}>${s.toId}:${s.kind}`).join('|');
  const cashBetter = bp.best && sig(bp.best.route) !== sig(plan.best) && bp.best.cashCents < payment(plan.best, money0).cashCents;

  const sameAsDirect = plan.direct && plan.best.steps.length === 1 && plan.best.total === plan.direct.total;
  out.replaceChildren(
    el('p', { className: 'out' }, `Crédito considerado: ${money(credit)}.`),
    plan.savingWithTax > 0
      ? el('p', { className: 'out saving' }, `Ahorras ${money(plan.savingWithTax)} frente al upgrade directo.`)
      : el('p', { className: 'out' }, sameAsDirect ? 'Lo más barato es el upgrade directo.' : ''),
    routeBox('Ruta más barata', plan.best, { best: true, pay: payment(plan.best, money0) }),
    cashBetter
      ? routeBox('Menos dinero de tu bolsillo', bp.best.route, {
          cash: true,
          pay: bp.best,
          note: `Cuesta ${money(bp.best.route.totalWithTax - plan.best.totalWithTax)} más en total, pero aprovecha mejor tu crédito.`,
        })
      : null,
    plan.creditOnly && (!cashBetter || sig(plan.creditOnly) !== sig(bp.best.route))
      ? routeBox('Ruta solo con Standard de la tienda', plan.creditOnly, { note: 'Se puede pagar entera con crédito.', pay: payment(plan.creditOnly, money0) })
      : null,
    plan.direct && !sameAsDirect ? routeBox('Upgrade directo', plan.direct, { pay: payment(plan.direct, money0) }) : null,
  );
});

// Crédito para los cálculos: lo escrito en «Presupuesto» + lo marcado en «Canjear» (si está activado).
function availableCredit() {
  const typed = Math.round((parseFloat($('calc-credit').value) || 0) * 100);
  const extra = $('calc-melt').checked ? meltSelectionTotals(meltRows, state.meltSelection).creditCents : 0;
  return Math.max(0, typed) + extra;
}
$('calc-credit').addEventListener('input', () => (creditTouched = true));

// ---------- Qué canjear ----------
function renderMelt() {
  meltRows = meltAdvice({
    pledges: state.pledges ?? [],
    account,
    catalog: state.catalog,
    reserved: state.reserved,
    creditBuybacksLeft: account.buyback.creditBuybacksLeft,
  });
  // Quitamos de la selección lo que ya no existe (p. ej. si ya lo canjeaste).
  const ids = new Set(meltRows.map((r) => r.pledgeId));
  state.meltSelection = state.meltSelection.filter((id) => ids.has(id));

  if (state.storeCreditCents != null) {
    $('melt-credit').textContent = `Crédito de tienda que ya tienes: ${money(state.storeCreditCents)}`;
    if (!creditTouched) $('calc-credit').value = (state.storeCreditCents / 100).toFixed(2);
  }
  updateMeltTotals();

  const LEVEL_TAG = { bajo: ['riesgo bajo', 'ok'], medio: ['riesgo medio', 'warn'], alto: ['riesgo alto', 'warn'] };
  const sel = new Set(state.meltSelection);
  $('melt-out').replaceChildren(
    table(
      [
        {
          title: '',
          cell: (r) => {
            const input = el('input', { type: 'checkbox', checked: sel.has(r.pledgeId), title: 'Simular canje' });
            input.addEventListener('change', async () => {
              const s = new Set(state.meltSelection);
              if (input.checked) s.add(r.pledgeId);
              else s.delete(r.pledgeId);
              state.meltSelection = [...s];
              await save();
              updateMeltTotals();
            });
            return input;
          },
        },
        {
          title: 'Pledge',
          cell: (r) => el('span', {}, r.name, el('div', { className: 'reasons' }, r.reasons.join(' '))),
        },
        { title: 'Crédito', num: true, cell: (r) => money(r.creditCents) },
        { title: 'Pierdes', num: true, cell: (r) => (r.lossCents != null ? money(r.lossCents) : '—') },
        { title: '', cell: (r) => tag(...LEVEL_TAG[r.level]) },
      ],
      meltRows,
    ),
  );
}

function updateMeltTotals() {
  const t = meltSelectionTotals(meltRows, state.meltSelection);
  $('melt-total').textContent = t.count
    ? `Marcado: ${t.count} pledge(s) → +${money(t.creditCents)} de crédito, pierdes ${money(t.lossCents)} en descuentos.`
    : 'Marca pledges para simular cuánto crédito conseguirías.';
  $('calc-melt-label').textContent = `Sumar lo marcado en «Canjear» (+${money(t.creditCents)})`;
}



// ---------- Reservas ----------
function renderReservations() {
  const r = state.reserved;
  const ccuSet = new Set(r.ccuPledgeIds);
  const shipSet = new Set(r.shipPledgeIds);
  const total = r.ccuPledgeIds.length + r.shipPledgeIds.length;
  $('reserve-summary').textContent = total ? `Reservas (${total})` : 'Reservas';

  const toggle = (list, id, on) => {
    const s = new Set(state.reserved[list]);
    if (on) s.add(id);
    else s.delete(id);
    state.reserved = { ...state.reserved, [list]: [...s] };
  };
  const check = (list, id, checked, text) => {
    const input = el('input', { type: 'checkbox', checked });
    input.addEventListener('change', async () => {
      toggle(list, id, input.checked);
      await save();
      render(); // recalcula el mapa y las listas con las reservas nuevas
    });
    return el('label', { className: 'check' }, input, text);
  };

  const ccus = [...account.ccus].sort((a, b) => a.fromName.localeCompare(b.fromName));
  const ships = [...account.ships].sort((a, b) => a.name.localeCompare(b.name));
  $('reserve-out').replaceChildren(
    el('h3', {}, 'Upgrades del hangar'),
    ...ccus.map((c) =>
      check('ccuPledgeIds', c.pledgeId, ccuSet.has(c.pledgeId), `${c.fromName} → ${c.toName} (${c.edition ?? '—'}, ${money(c.valueCents)})`),
    ),
    el('h3', {}, 'Naves'),
    ...ships.map((s) => check('shipPledgeIds', s.pledgeId, shipSet.has(s.pledgeId), `${s.name} (${s.insurance ?? 'sin seguro'})`)),
  );
}

// ---------- Objetivos ----------
$('btn-goal').addEventListener('click', async () => {
  if (!lastPlan) return;
  const { fromId, toId, plan } = lastPlan;
  state.goals = state.goals.filter((g) => !(g.fromId === fromId && g.toId === toId));
  state.goals.push({ fromId, toId, lastTotalWithTax: plan.best.totalWithTax, savedAt: Date.now() });
  await save();
  renderGoals();
});

function renderGoals() {
  const box = $('goals-out');
  if (!state.goals.length || !graph) return;
  const evaluated = evaluateGoals(state.goals, graph, { taxRate: taxRate(), useBuyback: true });
  box.replaceChildren(
    el('p', { className: 'hint' }, 'Se revisan cada vez que traes datos nuevos con el marcador: si bajan de precio, te aviso en el Resumen.'),
    table(
      [
        { title: 'Objetivo', cell: (g) => `${shipName(g.fromId)} → ${shipName(g.toId)}` },
        { title: 'Ahora', num: true, cell: (g) => (g.now != null ? money(g.now) : 'sin ruta') },
        {
          title: '',
          cell: (g) => {
            const b = el('button', { className: 'link', title: 'Quitar objetivo' }, '✕');
            b.addEventListener('click', async () => {
              state.goals = state.goals.filter((x) => !(x.fromId === g.fromId && x.toId === g.toId));
              await save();
              if (!state.goals.length) box.replaceChildren(el('p', { className: 'empty' }, 'Sin objetivos.'));
              else renderGoals();
            });
            return b;
          },
        },
      ],
      evaluated,
    ),
  );
}

// ---------- Historial ----------
// Se lee con el marcador marcando «Incluir historial».

function renderLog() {
  const s = summarizeLog(state.log);
  $('log-status').textContent = `✔ ${state.log.length} movimientos · leído ${new Date(state.logSavedAt).toLocaleString('es-ES')}`;
  $('log-summary').replaceChildren(
    el(
      'p',
      { className: 'hint' },
      '«Compras» incluye lo pagado con crédito de tienda (dinero reciclado de canjes): no es lo que has gastado de tu bolsillo.',
    ),
    table(
      [
        { title: 'Año', cell: (r) => String(r.year) },
        { title: 'Compras', num: true, cell: (r) => `${money(r.purchasesCents)} (${r.purchases})` },
        { title: 'Canjes', num: true, cell: (r) => `${money(r.reclaimsCents)} (${r.reclaims})` },
        { title: 'Regalos ↓/↑', num: true, cell: (r) => `${r.giftsReceived}/${r.giftsSent}` },
        { title: 'Upgr.', num: true, cell: (r) => String(r.upgradesApplied) },
      ],
      [...s.rows, s.total],
    ),
  );
  $('log-filter').disabled = false;
  renderLogList();
}

function renderLogList() {
  const q = $('log-filter').value.trim().toLowerCase();
  const all = enrichLog(state.log ?? []);
  const matches = q ? all.filter((e) => `${e.date} ${e.pledgeName} ${e.text}`.toLowerCase().includes(q)) : all;
  const shown = matches.slice(0, 200);
  $('log-list').replaceChildren(
    el('p', { className: 'hint' }, `${matches.length} movimientos${matches.length > shown.length ? ` (se muestran ${shown.length})` : ''}`),
    table(
      [
        { title: 'Fecha', cell: (e) => e.date },
        { title: 'Tipo', cell: (e) => TYPE_LABELS[e.type] ?? e.type },
        { title: 'Pledge', cell: (e) => e.pledgeName },
        { title: 'Importe', num: true, cell: (e) => (e.valueCents != null ? money(e.valueCents) : '') },
      ],
      shown,
    ),
  );
}
$('log-filter').addEventListener('input', renderLogList);

// ---------- Exportar a CSV ----------
function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.querySelectorAll('[data-export]').forEach((b) =>
  b.addEventListener('click', () => {
    const day = new Date().toISOString().slice(0, 10);
    const kind = b.dataset.export;
    if (kind === 'historial') {
      if (!state.log) return setStatus('Trae antes el historial: marcador en RSI con «Incluir historial».', 'err');
      return download(`rsi-historial-${day}.csv`, logCsv(state.log));
    }
    if (!account) return setStatus('Trae antes tus datos (pestaña Conectar).', 'err');
    const csv = { naves: shipsCsv, upgrades: ccusCsv, buyback: buybackCsv }[kind](account);
    download(`rsi-${kind}-${day}.csv`, csv);
  }),
);

// ---------- Precios: upgrades posibles desde una nave ----------
function renderPriceSelector() {
  const cat = state.catalog;
  if (!cat) return;
  const sel = $('sel-from');
  const previous = sel.value;
  sel.replaceChildren();
  const option = (s) => el('option', { value: s.id }, `${s.name.trim()} (${money(s.msrp)})`);
  const byName = (a, b) => a.name.localeCompare(b.name);
  sel.append(
    el('optgroup', { label: 'Mis naves' }, cat.ships.filter((s) => s.owned).sort(byName).map(option)),
    el('optgroup', { label: 'Todas' }, cat.ships.filter((s) => !s.owned).sort(byName).map(option)),
  );
  if (previous) sel.value = previous;
  sel.disabled = false;
  $('btn-targets').disabled = false;
  const p = cat.app?.pricing;
  if (p) $('targets-status').textContent = `Moneda ${p.currencyCode} · impuesto ${taxPercent(p.taxRate)}`;
}

$('btn-targets').addEventListener('click', () => {
  if (!graph) return;
  const fromId = Number($('sel-from').value);
  const rows = upgradeOptionsFrom(graph, fromId, taxRate());
  $('targets-status').textContent = `${rows.length} upgrades disponibles desde ${shipName(fromId)}`;
  $('targets-out').replaceChildren(
    table(
      [
        { title: 'Nave destino', cell: (r) => r.toName },
        { title: 'Edición', cell: (r) => r.title },
        { title: 'Valor nave', num: true, cell: (r) => money(r.msrp) },
        { title: 'Upgrade', num: true, cell: (r) => money(r.upgradeWithTax) },
      ],
      rows,
    ),
  );
});

// ---------- Al abrir la web: cargar lo guardado ----------
function loadSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved) {
      state = {
        ...state,
        ...saved,
        skuPrices: saved.skuPrices ?? {},
        goals: saved.goals ?? [],
        reserved: { ccuPledgeIds: [], shipPledgeIds: [], ...(saved.reserved ?? {}) },
        meltSelection: saved.meltSelection ?? [],
      };
    }
  } catch {
    /* sin almacenamiento o datos corruptos: empezamos de cero */
  }
}

setupBookmarklet();
loadSaved();
if (state.savedAt) {
  render();
  showTab('summary');
} else {
  setStatus('Sin datos todavía', '');
  showTab('connect');
}
