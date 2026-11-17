// Vista «Naves»: buscador, fichas y comparador de hasta 3 naves.
import { $, el, tag, table } from '../ui.js';
import { money } from '../lib/format.js';
import { planUpgrade } from '../lib/chain.js';
import { compareShips, distinct, filterShips, SIZE_ORDER } from '../lib/ships.js';

const PAGE = 48;
const MAX_COMPARE = 3;

const crewText = (s) => (s.minCrew == null ? '—' : s.minCrew === s.maxCrew ? String(s.minCrew) : `${s.minCrew}–${s.maxCrew}`);
const num = (v, unit = '') => (v == null ? '—' : `${v.toLocaleString('es-ES')}${unit}`);

const SORTS = {
  name: (a, b) => a.name.localeCompare(b.name),
  'price-asc': (a, b) => a.msrp - b.msrp || a.name.localeCompare(b.name),
  'price-desc': (a, b) => b.msrp - a.msrp || a.name.localeCompare(b.name),
  cargo: (a, b) => (b.cargo ?? -1) - (a.cargo ?? -1) || a.name.localeCompare(b.name),
  crew: (a, b) => (b.maxCrew ?? -1) - (a.maxCrew ?? -1) || a.name.localeCompare(b.name),
};

export function initDb(ctx) {
  const selected = []; // ids a comparar
  let shown = PAGE;
  let filled = false;

  function fillFilters(ships) {
    const size = $('db-size');
    const focus = $('db-focus');
    const sizes = distinct(ships, 'size').sort((a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b));
    size.replaceChildren(el('option', { value: '' }, 'Todos los tamaños'), ...sizes.map((s) => el('option', { value: s }, s)));
    // Los roles vienen compuestos («Medium Freight / Exploration»): usamos la primera palabra clave de cada parte.
    const roles = [...new Set(ships.flatMap((s) => String(s.focus ?? '').split(/[\/,]/).map((x) => x.trim()).filter(Boolean)))].sort((a, b) => a.localeCompare(b));
    focus.replaceChildren(el('option', { value: '' }, 'Todos los roles'), ...roles.map((r) => el('option', { value: r }, r)));
    filled = true;
  }

  function currentList() {
    const ships = ctx.joined();
    const list = filterShips(ships, {
      q: $('db-q').value,
      size: $('db-size').value,
      focus: $('db-focus').value,
      owned: $('db-owned').checked,
      onSale: $('db-sale').checked,
    });
    return list.sort(SORTS[$('db-sort').value] ?? SORTS.name);
  }

  function shipCard(s) {
    const picked = selected.includes(s.id);
    const cmp = el('input', { type: 'checkbox', checked: picked, disabled: !picked && selected.length >= MAX_COMPARE, title: `Comparar (máximo ${MAX_COMPARE})` });
    cmp.addEventListener('change', () => {
      if (cmp.checked) selected.push(s.id);
      else selected.splice(selected.indexOf(s.id), 1);
      render();
    });
    const open = el('button', { className: 'secondary' }, 'Ficha');
    open.addEventListener('click', () => openDialog(s));
    return el(
      'article',
      { className: `ship-card${s.owned ? ' mine' : ''}` },
      el('h4', {}, s.name),
      el('div', { className: 'maker' }, [s.manufacturer, s.focus].filter(Boolean).join(' · ') || '—'),
      el('div', { className: 'price' }, money(s.msrp)),
      el('div', { className: 'specs' }, el('span', {}, s.size), el('span', {}, `Tripulación ${crewText(s)}`), el('span', {}, `Carga ${num(s.cargo, ' SCU')}`)),
      el(
        'div',
        {},
        s.owned ? tag('la tienes', 'ok') : null,
        s.onSale ? tag('a la venta', 'info') : tag('no se vende', 'warn'),
        s.status === 'Concepto' ? tag('concepto', 'warn') : null,
      ),
      el('div', { className: 'card-actions' }, open, el('label', { className: 'check', style: 'margin:0' }, cmp, 'Comparar')),
    );
  }

  function renderCompare() {
    const box = $('db-compare');
    if (!selected.length) return box.replaceChildren();
    const byId = new Map(ctx.joined().map((s) => [s.id, s]));
    const ships = selected.map((id) => byId.get(id)).filter(Boolean);
    const clear = el('button', { className: 'secondary' }, 'Limpiar comparación');
    clear.addEventListener('click', () => {
      selected.length = 0;
      render();
    });
    const rows = compareShips(ships);
    const t = table(
      [{ title: '', cell: (r) => r.label }, ...ships.map((s, i) => ({ title: s.name, cell: (r) => {
        const v = r.values[i];
        const text = r.key === 'msrp' ? money(v) : typeof v === 'number' ? num(v) : v ?? '—';
        return el('span', { className: r.best.includes(i) ? 'best' : '' }, text);
      } }))],
      rows,
    );
    box.replaceChildren(el('div', { className: 'panel cmp-tray' }, el('h3', { className: 'panel-title' }, `Comparando ${ships.length} nave(s)`), ships.length < 2 ? el('p', { className: 'hint' }, 'Marca otra nave para comparar.') : t, clear));
    // Resaltado del mejor valor
    box.querySelectorAll('span.best').forEach((s) => s.parentElement.classList.add('best'));
  }

  function openDialog(s) {
    const dlg = $('ship-dialog');
    const g = ctx.graph();
    const mine = (ctx.usable()?.ships ?? []).filter((x) => x.shipId != null && x.shipId !== s.id);
    let routes = [];
    if (g && g.ships.has(s.id)) {
      routes = mine
        .map((x) => ({ from: x, plan: planUpgrade(g, x.shipId, s.id, { taxRate: ctx.taxRate(), useBuyback: true }) }))
        .filter((r) => r.plan.best)
        .sort((a, b) => a.plan.best.totalWithTax - b.plan.best.totalWithTax)
        .slice(0, 6);
    }
    const spec = (label, value) => el('div', {}, el('small', {}, label), value);
    const close = el('button', { className: 'secondary' }, 'Cerrar');
    close.addEventListener('click', () => dlg.close());
    const toCalc = el('button', {}, 'Calcular en la calculadora');
    toCalc.addEventListener('click', () => {
      const to = $('calc-to');
      if ([...to.options].some((o) => o.value === String(s.id))) to.value = String(s.id);
      dlg.close();
      ctx.go('calc');
    });
    dlg.setAttribute('aria-labelledby', 'ship-dialog-title');
    dlg.replaceChildren(
      el('h3', { id: 'ship-dialog-title' }, s.name),
      el('div', { className: 'maker hint' }, [s.manufacturer, s.focus, s.status].filter(Boolean).join(' · ')),
      el('p', { className: 'desc' }, s.description || 'Sin descripción.'),
      el(
        'div',
        { className: 'spec-grid' },
        spec('Precio', money(s.msrp)),
        spec('Tamaño', s.size),
        spec('Tripulación', crewText(s)),
        spec('Carga', num(s.cargo, ' SCU')),
        spec('Eslora', num(s.length, ' m')),
        spec('Manga', num(s.beam, ' m')),
        spec('Altura', num(s.height, ' m')),
        spec('Masa', num(s.mass, ' kg')),
        spec('Velocidad SCM', num(s.scm, ' m/s')),
      ),
      routes.length
        ? el('div', {}, el('h3', { className: 'panel-title' }, 'Cómo llegar desde tus naves'), table(
            [
              { title: 'Desde', cell: (r) => r.from.name },
              { title: 'Pasos', num: true, cell: (r) => String(r.plan.best.steps.length) },
              { title: 'Precio', num: true, cell: (r) => money(r.plan.best.totalWithTax) },
            ],
            routes,
          ))
        : el('p', { className: 'hint' }, ctx.graph() ? 'No hay ninguna ruta desde tus naves (o ya la tienes).' : 'Conecta tu cuenta para ver cómo llegar desde tus naves.'),
      el('div', { className: 'buttons' }, toCalc, close),
    );
    dlg.showModal();
  }

  function render() {
    const ships = ctx.joined();
    if (!ships.length) {
      $('db-grid').replaceChildren(el('p', { className: 'empty' }, 'Aún no hay datos. Ve a «Conectar».'));
      $('db-count').textContent = '';
      $('db-more').hidden = true;
      return;
    }
    if (!filled) fillFilters(ships);
    const list = currentList();
    $('db-count').textContent = `${list.length} naves${ctx.state().specs && Object.keys(ctx.state().specs).length ? '' : ' · sin fichas de tripulación y carga: vuelve a pulsar el marcador en RSI para traerlas'}`;
    $('db-grid').replaceChildren(...list.slice(0, shown).map(shipCard));
    $('db-more').hidden = list.length <= shown;
    renderCompare();
  }

  const refilter = () => {
    shown = PAGE;
    render();
  };
  ['db-q', 'db-size', 'db-focus', 'db-sort', 'db-owned', 'db-sale'].forEach((id) => $(id).addEventListener(id === 'db-q' ? 'input' : 'change', refilter));
  $('db-more').addEventListener('click', () => {
    shown += PAGE;
    render();
  });

  return { render };
}
