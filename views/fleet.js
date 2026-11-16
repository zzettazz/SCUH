// Vista «Mi flota»: tu flota por rol, tamaño o fabricante, y formas de compartirla sin datos privados.
import { $, card, download, el } from '../ui.js';
import { decodeShare, encodeShare, fleetOf, fleetTotals, groupBy } from '../lib/fleet.js';
import { SIZE_ORDER } from '../lib/ships.js';

const GROUPINGS = {
  size: { label: 'Tamaño', key: (s) => s.size },
  focus: { label: 'Rol', key: (s) => String(s.focus ?? '').split(/[\/,]/)[0].trim() },
  manufacturer: { label: 'Fabricante', key: (s) => s.manufacturer },
};

export function initFleet(ctx) {
  let by = 'size';

  const groups = (fleet) => {
    const g = groupBy(fleet, GROUPINGS[by].key);
    if (by === 'size') g.sort((a, b) => SIZE_ORDER.indexOf(a.key) - SIZE_ORDER.indexOf(b.key));
    return g;
  };

  // Agrupa nombres repetidos: «Perseus ×2».
  const chips = (ships) => {
    const count = new Map();
    for (const s of ships) count.set(s.name, (count.get(s.name) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, n]) => el('span', { className: 'chip' }, n > 1 ? `${name} ×${n}` : name));
  };

  function drawImage(fleet, title) {
    const W = 1200;
    const pad = 48;
    const font = (px, bold) => `${bold ? '700 ' : ''}${px}px Orbitron, "Segoe UI", system-ui, sans-serif`;
    const probe = document.createElement('canvas').getContext('2d');
    const rows = groups(fleet).map((g) => {
      probe.font = font(18);
      const words = chips(g.ships).map((c) => c.textContent);
      const lines = [];
      let line = '';
      for (const w of words) {
        const next = line ? `${line}   ·   ${w}` : w;
        if (probe.measureText(next).width > W - pad * 2) {
          lines.push(line);
          line = w;
        } else line = next;
      }
      if (line) lines.push(line);
      return { key: g.key, n: g.ships.length, lines };
    });
    const H = 190 + rows.reduce((a, r) => a + 46 + r.lines.length * 28, 0) + 60;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0a1b30');
    bg.addColorStop(1, '#04070d');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#2fa4ff';
    g.lineWidth = 2;
    g.strokeRect(16, 16, W - 32, H - 32);
    g.fillStyle = '#00d4ff';
    g.font = font(14, true);
    g.fillText('FLOTA · STAR CITIZEN', pad, 66);
    g.fillStyle = '#ffffff';
    g.font = font(34, true);
    g.fillText(title.toUpperCase(), pad, 112);
    const t = fleetTotals(fleet);
    g.fillStyle = '#7f92a6';
    g.font = font(16);
    g.fillText(`${t.ships} naves · carga ${t.cargo.toLocaleString('es-ES')} SCU · tripulación máx. ${t.maxCrew}`, pad, 146);
    let y = 196;
    for (const r of rows) {
      g.fillStyle = '#00d4ff';
      g.font = font(15, true);
      g.fillText(`${r.key.toUpperCase()}  (${r.n})`, pad, y);
      g.fillStyle = '#dbe7f3';
      g.font = font(18);
      r.lines.forEach((l, i) => g.fillText(l, pad, y + 30 + i * 28));
      y += 46 + r.lines.length * 28;
    }
    g.fillStyle = '#4b5b6c';
    g.font = font(12);
    g.fillText('Fan site no oficial · Star Citizen® es marca de Cloud Imperium Rights LLC', pad, H - 30);
    return c;
  }

  function shareControls(fleet, title) {
    const url = `${location.origin}${location.pathname}#/fleet?s=${encodeShare(fleet)}`;
    const input = el('input', { type: 'text', value: url, readOnly: true, 'aria-label': 'Enlace para compartir' });
    input.addEventListener('focus', () => input.select());
    const copy = el('button', {}, 'Copiar enlace');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(url);
        copy.textContent = '✔ Copiado';
      } catch {
        input.select();
        copy.textContent = 'Selecciona y copia';
      }
      setTimeout(() => (copy.textContent = 'Copiar enlace'), 2000);
    });
    const img = el('button', { className: 'secondary' }, 'Descargar imagen');
    img.addEventListener('click', () => drawImage(fleet, title).toBlob((b) => b && download('mi-flota.png', b), 'image/png'));
    return el(
      'div',
      { className: 'panel' },
      el('h3', { className: 'panel-title' }, 'Compartir sin datos privados'),
      el('p', { className: 'hint' }, 'El enlace solo lleva el nombre, rol, tamaño, tripulación y carga de cada nave. Ni precios, ni pedidos, ni tu usuario.'),
      el('div', { className: 'share-box' }, input, copy, img),
    );
  }

  function view(fleet, { title, shared }) {
    const t = fleetTotals(fleet);
    const select = el('select', { 'aria-label': 'Agrupar por', style: 'width:auto' }, Object.entries(GROUPINGS).map(([k, v]) => el('option', { value: k, selected: k === by }, `Agrupar por ${v.label.toLowerCase()}`)));
    select.addEventListener('change', () => {
      by = select.value;
      render();
    });
    $('fleet-out').replaceChildren(
      el(
        'div',
        { className: 'cards' },
        card('Naves', t.ships),
        card('Carga total', `${t.cargo.toLocaleString('es-ES')} SCU`),
        card('Tripulación', `${t.minCrew}–${t.maxCrew}`, 'mínima – máxima si las usaras todas'),
        shared ? null : card('Con LTI', t.lti, `de ${t.ships}`),
      ),
      el('div', { className: 'buttons' }, select),
      ...groups(fleet).map((g) => el('div', { className: 'group' }, el('h4', {}, el('span', {}, g.key), el('span', {}, `${g.ships.length}`)), el('div', { className: 'chips' }, chips(g.ships)))),
      shared ? null : shareControls(fleet, title),
    );
  }

  function render() {
    const code = ctx.route().params.get('s');
    const sharedFleet = code ? decodeShare(code) : null;
    $('fleet-banner').replaceChildren();

    if (code && !sharedFleet) {
      $('fleet-title').textContent = 'Flota compartida';
      $('fleet-banner').replaceChildren(el('div', { className: 'banner' }, 'El enlace de la flota no es válido o está incompleto.'));
      $('fleet-out').replaceChildren();
      return;
    }
    if (sharedFleet) {
      $('fleet-title').textContent = 'Flota compartida';
      const back = el('a', { href: '#/fleet' }, 'Ver mi flota');
      $('fleet-banner').replaceChildren(el('div', { className: 'banner' }, `Estás viendo la flota que alguien ha compartido contigo (${sharedFleet.length} naves). `, back));
      view(sharedFleet, { title: 'Flota compartida', shared: true });
      return;
    }

    $('fleet-title').textContent = 'Mi flota';
    const account = ctx.account();
    if (!account) return $('fleet-out').replaceChildren(el('p', { className: 'empty' }, 'Aún no hay datos. Ve a «Conectar».'));
    const fleet = fleetOf(account.ships, ctx.joined());
    view(fleet, { title: 'Mi flota', shared: false });
  }

  return { render };
}
