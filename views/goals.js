// Vista «Objetivos»: varias naves objetivo a la vez, repartiendo tus upgrades para que no se pisen.
import { $, el } from '../ui.js';
import { money } from '../lib/format.js';
import { cheapestPath, payment, reachableTargets } from '../lib/chain.js';
import { MAX_GOALS, planMultiple, sharedConflicts } from '../lib/multi.js';

export function initGoals(ctx) {
  const goals = () => ctx.state().multiGoals;

  function shipOptions(ships, selected) {
    return ships.map((s) => el('option', { value: s.id, selected: String(s.id) === String(selected) }, `${s.name} (${money(s.msrp)})`));
  }

  function renderList() {
    const g = ctx.graph();
    const box = $('multi-list');
    if (!g) {
      box.replaceChildren(el('p', { className: 'empty' }, 'Aún no hay datos. Ve a «Conectar».'));
      $('multi-add').disabled = true;
      $('multi-calc').disabled = true;
      return;
    }
    const byValue = (a, b) => a.msrp - b.msrp || a.name.localeCompare(b.name);
    const ownedIds = new Set((ctx.usable()?.ships ?? []).map((s) => s.shipId));
    const all = [...g.ships.values()].sort(byValue);
    const mine = all.filter((s) => ownedIds.has(s.id));
    const targets = reachableTargets(g, { useBuyback: true }).sort(byValue);

    box.replaceChildren(
      ...goals().map((goal, i) => {
        const from = el('select', { 'aria-label': 'Tengo' }, el('optgroup', { label: 'Mis naves' }, shipOptions(mine, goal.fromId)), el('optgroup', { label: 'Todas' }, shipOptions(all.filter((s) => !ownedIds.has(s.id)), goal.fromId)));
        const to = el('select', { 'aria-label': 'Quiero' }, shipOptions(targets, goal.toId));
        from.value = String(goal.fromId);
        to.value = String(goal.toId);
        const rm = el('button', { className: 'link', title: 'Quitar objetivo', 'aria-label': `Quitar objetivo ${i + 1}` }, '✕');
        const update = () => {
          goal.fromId = Number(from.value);
          goal.toId = Number(to.value);
          ctx.save();
        };
        from.addEventListener('change', update);
        to.addEventListener('change', update);
        rm.addEventListener('click', () => {
          goals().splice(i, 1);
          ctx.save();
          render();
        });
        return el('div', { className: 'goal-row' }, el('div', {}, el('label', {}, `Objetivo ${i + 1}: tengo`), from), el('div', {}, el('label', {}, 'Quiero'), to), rm);
      }),
      goals().length ? null : el('p', { className: 'empty' }, 'Añade al menos un objetivo.'),
    );
    $('multi-add').disabled = goals().length >= MAX_GOALS;
    $('multi-calc').disabled = goals().length === 0;
  }

  function addGoal() {
    const g = ctx.graph();
    if (!g || goals().length >= MAX_GOALS) return;
    // Propone una nave de origen y un destino que aún no estén en la lista.
    const usedFrom = new Set(goals().map((x) => x.fromId));
    const usedTo = new Set(goals().map((x) => x.toId));
    const ships = (ctx.usable()?.ships ?? []).filter((s) => s.shipId != null);
    const mine = ships.find((s) => !usedFrom.has(s.shipId)) ?? ships[0];
    const targets = reachableTargets(g, { useBuyback: true }).sort((a, b) => b.msrp - a.msrp);
    const target = targets.find((t) => !usedTo.has(t.id) && t.id !== mine?.shipId) ?? targets[0];
    if (!mine || !target) return;
    goals().push({ fromId: mine.shipId, toId: target.id });
    ctx.save();
    render();
  }

  function calculate() {
    const g = ctx.graph();
    const out = $('multi-out');
    const list = goals().filter((x) => x.fromId !== x.toId);
    const opts = { taxRate: ctx.taxRate(), useOwned: true, useBuyback: true };
    let r;
    try {
      r = planMultiple(g, list, opts);
    } catch (e) {
      out.replaceChildren(el('p', { className: 'out err' }, e.message));
      return;
    }
    const money0 = { creditCents: ctx.availableCredit(), creditBuybacks: ctx.creditBuybacks() };
    const conflicts = sharedConflicts(g, list, opts);
    const alone = list.map((x) => cheapestPath(g, x.fromId, x.toId, opts));
    const aloneTotal = alone.reduce((a, p) => a + (p?.totalWithTax ?? 0), 0);
    const names = (i) => `${ctx.shipName(list[i].fromId)} → ${ctx.shipName(list[i].toId)}`;

    out.replaceChildren(
      el(
        'div',
        { className: 'panel' },
        el('h3', { className: 'panel-title' }, 'Resultado'),
        el('div', { className: 'route best', style: 'margin:0' }, el('h4', {}, 'Coste total de todos los objetivos'), el('div', { className: 'big' }, money(r.totalWithTax))),
        r.unreachable ? el('p', { className: 'out err' }, `${r.unreachable} objetivo(s) sin ruta posible con lo que hay hoy a la venta.`) : null,
        conflicts.length
          ? el('p', { className: 'out' }, `${conflicts.length} upgrade(s) tuyo(s) servían a varios objetivos a la vez. Los he repartido para que cada uno se use una sola vez` + (aloneTotal && aloneTotal < r.totalWithTax ? `; calculados por separado saldrían ${money(aloneTotal)}, pero no se podrían hacer los dos.` : '.'))
          : el('p', { className: 'hint' }, 'Tus upgrades no se pisan entre estos objetivos.'),
        el('p', { className: 'hint' }, `Orden recomendado: ${r.order.map((i, n) => `${n + 1}) ${names(i)}`).join(' · ')}`),
        el('p', { className: 'hint' }, `Crédito considerado: ${money(money0.creditCents)}.`),
      ),
      ...r.plans.map((p, i) =>
        p.route
          ? ctx.routeBox(`Objetivo ${i + 1}: ${names(i)}`, p.route, { best: true, pay: payment(p.route, money0) })
          : el('div', { className: 'route' }, el('h4', {}, `Objetivo ${i + 1}: ${names(i)}`), el('p', { className: 'err' }, 'Sin ruta posible.')),
      ),
    );
  }

  $('multi-add').addEventListener('click', addGoal);
  $('multi-calc').addEventListener('click', calculate);

  function render() {
    renderList();
    if (!ctx.graph()) $('multi-out').replaceChildren();
  }
  return { render };
}
