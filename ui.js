// Componentes de interfaz compartidos. Nunca usamos innerHTML con datos de fuera: los textos vienen de RSI
// o de enlaces compartidos y se insertan siempre como texto.

export const $ = (id) => document.getElementById(id);

// Los componentes opcionales se escriben como `cond ? el(...) : null`. Por defecto el navegador convertiría
// ese null en el texto «null»; aquí se ignoran null, undefined y false en replaceChildren y append.
for (const method of ['replaceChildren', 'append']) {
  const native = Element.prototype[method];
  Element.prototype[method] = function (...nodes) {
    return native.apply(this, nodes.flat().filter((n) => n != null && n !== false));
  };
}

export function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    // aria-*, role y data-* son atributos, no propiedades: antes se asignaban como propiedad y no tenían efecto.
    if (k.startsWith('aria-') || k.startsWith('data-') || k === 'role') e.setAttribute(k, v);
    else e[k] = v;
  }
  for (const c of children.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}

export const tag = (text, kind = 'info') => el('span', { className: `tag ${kind}` }, text);

// columns: [{ title, num?, cell: (row) => texto | Node }]
export function table(columns, rows) {
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

export function card(label, value, detail) {
  return el(
    'div',
    { className: 'card' },
    el('div', { className: 'label' }, label),
    el('div', { className: 'value' }, value),
    detail && el('div', { className: 'detail' }, detail),
  );
}

export function panel(title, ...children) {
  return el('section', { className: 'panel' }, title ? el('h3', { className: 'panel-title' }, title) : null, ...children);
}

export function download(filename, blobOrText, type = 'text/csv;charset=utf-8') {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Gráficos SVG sin librerías ----------
const NS = 'http://www.w3.org/2000/svg';
function svgEl(name, attrs = {}, ...children) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}

/**
 * Gráfico de líneas/barras. series: [{ name, color, kind: 'line'|'bar', values: number[] }]; labels: string[]
 * format(v) da el texto de los ejes y de las etiquetas. Devuelve un nodo <svg> responsive.
 */
export function chart({ labels, series, format = String, height = 220, label = 'Gráfico' }) {
  const W = 640;
  const H = height;
  const m = { l: 56, r: 12, t: 12, b: 28 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const all = series.flatMap((s) => s.values);
  const max = Math.max(1, ...all);
  const min = Math.min(0, ...all);
  const n = Math.max(1, labels.length);
  const x = (i) => m.l + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v) => m.t + ih - ((v - min) / (max - min || 1)) * ih;
  const barW = Math.max(2, Math.min(24, iw / n - 2));

  // Resumen para lectores de pantalla (los gráficos no se leen solos); la tabla de abajo sirve de alternativa con los datos.
  const last = (s) => (s.values.length ? format(s.values.at(-1)) : '—');
  const summary = `${label}. ${labels[0] ?? ''} a ${labels.at(-1) ?? ''}. ` + series.map((s) => `${s.name}: último valor ${last(s)}`).join('; ');
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': summary, preserveAspectRatio: 'xMidYMid meet' });
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4;
    svg.append(
      svgEl('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'grid' }),
      svgEl('text', { x: m.l - 6, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, document.createTextNode(format(v))),
    );
  }
  const step = Math.ceil(n / 8);
  labels.forEach((l, i) => {
    if (i % step === 0) svg.append(svgEl('text', { x: x(i), y: H - 8, class: 'axis', 'text-anchor': 'middle' }, document.createTextNode(l)));
  });
  for (const s of series) {
    if (s.kind === 'bar') {
      s.values.forEach((v, i) => {
        if (v === 0) return;
        const t = svgEl('rect', { x: x(i) - barW / 2, y: Math.min(y(v), y(0)), width: barW, height: Math.abs(y(v) - y(0)), fill: s.color, opacity: 0.85, rx: 1 });
        t.append(svgEl('title', {}, document.createTextNode(`${labels[i]} · ${s.name}: ${format(v)}`)));
        svg.append(t);
      });
    } else {
      const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      svg.append(svgEl('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
      if (n <= 40) {
        s.values.forEach((v, i) => {
          const c = svgEl('circle', { cx: x(i), cy: y(v), r: 3, fill: s.color });
          c.append(svgEl('title', {}, document.createTextNode(`${labels[i]} · ${s.name}: ${format(v)}`)));
          svg.append(c);
        });
      }
    }
  }
  return svg;
}

export function legend(series) {
  return el(
    'div',
    { className: 'legend' },
    series.map((s) => el('span', {}, el('i', { style: `background:${s.color}` }), s.name)),
  );
}
