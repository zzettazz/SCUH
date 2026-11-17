// Gráficos de evolución del hangar a partir del historial (Hangar log).
import { $, chart, el, legend, table } from '../ui.js';
import { money } from '../lib/format.js';
import { timeline, topMonths } from '../lib/stats.js';

const MONTH_NAMES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const label = (key) => {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${String(y).slice(2)}`;
};

export function initEvolution(ctx) {
  function render() {
    const box = $('log-charts');
    const log = ctx.state().log;
    if (!log?.length) return box.replaceChildren();
    const t = timeline(log);
    if (!t.months.length) return box.replaceChildren();

    const labels = t.months.map((m) => label(m.key));
    const cum = [
      { name: 'Compras acumuladas', color: '#2fa4ff', kind: 'line', values: t.months.map((m) => m.cumPurchasesCents) },
      { name: 'Neto acumulado (compras − canjes)', color: '#3fd07a', kind: 'line', values: t.months.map((m) => m.cumNetCents) },
    ];
    const monthly = [
      { name: 'Compras del mes', color: '#2fa4ff', kind: 'bar', values: t.months.map((m) => m.purchasesCents) },
      { name: 'Canjes del mes', color: '#f0b23a', kind: 'bar', values: t.months.map((m) => -m.reclaimsCents) },
    ];
    const top = topMonths(t.months, 5);

    box.replaceChildren(
      el(
        'div',
        { className: 'panel' },
        el('h3', { className: 'panel-title' }, 'Evolución acumulada'),
        el('p', { className: 'hint' }, '«Compras» incluye lo pagado con crédito de tienda (dinero reciclado de canjes): no es lo que has gastado de tu bolsillo. Por eso se muestra también el neto.'),
        legend(cum),
        chart({ labels, series: cum, format: (v) => money(v), label: 'Evolución acumulada de compras y neto' }),
      ),
      el(
        'div',
        { className: 'panel' },
        el('h3', { className: 'panel-title' }, 'Movimientos por mes'),
        legend(monthly),
        chart({ labels, series: monthly, format: (v) => money(v), height: 200, label: 'Compras y canjes por mes' }),
      ),
      top.length
        ? el(
            'div',
            { className: 'panel' },
            el('h3', { className: 'panel-title' }, 'Meses con más compras'),
            table(
              [
                { title: 'Mes', cell: (m) => label(m.key) },
                { title: 'Compras', num: true, cell: (m) => money(m.purchasesCents) },
                { title: 'Upgrades aplicados', num: true, cell: (m) => String(m.upgrades) },
              ],
              top,
            ),
          )
        : null,
    );
  }
  return { render };
}
