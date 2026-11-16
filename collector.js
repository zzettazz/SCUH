// Recolector de RSI Upgrade Helper.
// Lo carga el bookmarklet DENTRO de robertsspaceindustries.com, así que lee tu cuenta con tu sesión,
// como si navegaras tú. SOLO LECTURA: no compra, aplica, canjea ni regala nada.
// Al terminar abre la web y le pasa los datos con postMessage (solo a la web de origen del script).

(() => {
  const RSI_HOST = 'robertsspaceindustries.com';
  if (location.hostname !== RSI_HOST) {
    alert('Abre robertsspaceindustries.com con tu sesión iniciada y pulsa el marcador allí.');
    return;
  }

  // Dirección de la web: la deja el bookmarklet; si no, sale de la URL de este script.
  const SRC = document.currentScript?.src;
  const APP_URL = window.__RSI_HELPER_APP || (SRC ? new URL('./', SRC).href : null);
  if (!APP_URL) {
    alert('No sé a qué web enviar los datos. Vuelve a instalar el marcador desde la web.');
    return;
  }
  const APP_ORIGIN = new URL(APP_URL).origin;

  // Si el panel ya está abierto, solo lo mostramos.
  const existing = document.getElementById('rsi-helper-panel');
  if (existing) {
    existing.style.display = 'block';
    return;
  }

  // ===================== Lectura de RSI (igual que la extensión) =====================
  const UPGRADE_GQL = '/pledge-store/api/upgrade/v2/graphql';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rsiToken = () => document.cookie.match(/(?:^|; )Rsi-Token=([^;]+)/)?.[1] ?? null;
  const csrfToken = () => document.querySelector('meta[name="csrf-token"]')?.content ?? null;
  const toCents = (s) => Math.round(parseFloat(String(s || '').replace(/,/g, '').replace(/[^0-9.]/g, '')) * 100) || 0;

  async function postJson(url, body, headers) {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return res.json();
  }

  async function fetchDoc(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return new DOMParser().parseFromString(await res.text(), 'text/html');
  }

  const resetContext = () =>
    postJson('/api/ship-upgrades/setContextToken', { fromShipId: null, toShipId: null, toSkuId: null, pledgeId: null }, { 'x-rsi-token': rsiToken() });

  let upgradeSessionReady = false;
  async function prepareUpgradeSession() {
    if (!rsiToken()) throw new Error('No encuentro tu sesión de RSI. Inicia sesión en la web.');
    await postJson('/api/account/v2/setAuthToken', {}, { 'x-rsi-token': rsiToken() });
    await resetContext();
    upgradeSessionReady = true;
  }

  async function gql(operationName, query, variables = {}) {
    if (!upgradeSessionReady) await prepareUpgradeSession();
    const csrf = csrfToken();
    if (!csrf) throw new Error('No encuentro el token CSRF en la página. Recarga la página de RSI.');
    const [r] = await postJson(UPGRADE_GQL, [{ operationName, variables, query }], { 'x-csrf-token': csrf });
    if (r.errors?.length) throw new Error(r.errors.map((e) => e.message).join('; '));
    return r.data;
  }

  const Q_CATALOG = `query initShipUpgrade {
    ships { id name msrp owned flyableStatus focus type link
      manufacturer { id name }
      skus { id title price available unlimitedStock availableStock } }
    app { isAnonymous pricing { currencyCode currencySymbol exponent taxRate isTaxInclusive } }
  }`;
  const Q_TARGETS = `query filterShips($fromId: Int, $toId: Int, $fromFilters: [FilterConstraintValues], $toFilters: [FilterConstraintValues]) {
    from(to: $toId, filters: $fromFilters) { ships { id } }
    to(from: $fromId, filters: $toFilters) { ships { id skus { id title price upgradePrice available } } }
  }`;

  // ---------- Hangar ----------
  function parsePledgesPage(doc) {
    return [...doc.querySelectorAll('ul.list-items > li')].map((li) => {
      const q = (s) => li.querySelector(s);
      const val = (s) => q(s)?.value ?? null;
      const items = [...li.querySelectorAll('.item')].map((i) => ({
        title: i.querySelector('.title')?.textContent.trim() ?? '',
        kind: i.querySelector('.kind')?.textContent.trim() ?? '',
      }));
      const actions = [...li.querySelectorAll('a.holosmallbtn, a.shadow-button, .pledge-actions a, a[class*=js-]')]
        .map((a) => a.textContent.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const name = (val('.js-pledge-name') || q('h3')?.textContent || '').trim();
      let upgrade = null;
      try {
        const raw = val('.js-upgrade-data');
        if (raw) {
          const j = JSON.parse(raw);
          upgrade = {
            type: j.upgrade_type ?? null,
            from: (j.match_items ?? []).map((x) => x.name.trim()),
            to: (j.target_items ?? []).map((x) => x.name.trim()),
          };
        }
      } catch {
        /* JSON inesperado */
      }
      return {
        id: val('.js-pledge-id'),
        name,
        valueCents: toCents(val('.js-pledge-value')),
        date: (q('.date-col')?.textContent || '').replace(/\s+/g, ' ').replace('Created:', '').trim(),
        items,
        ships: items.filter((i) => i.kind === 'Ship').map((i) => i.title),
        insurance: items.some((i) => /Lifetime Insurance/i.test(i.title))
          ? 'LTI'
          : items.find((i) => i.kind === 'Insurance')?.title ?? null,
        isUpgrade: !!upgrade || /^Upgrade - /i.test(name) || items.some((i) => /^Upgrade - /i.test(i.title)),
        upgrade,
        canGift: actions.includes('Gift'),
        canExchange: actions.includes('Exchange'),
        canApplyUpgrade: actions.includes('Apply upgrade'),
      };
    });
  }

  const pageNumbers = (doc, path) =>
    [...doc.querySelectorAll(`a[href*="${path}?page="]`)]
      .map((a) => Number(new URL(a.getAttribute('href'), location.origin).searchParams.get('page')))
      .filter(Number.isFinite);

  async function getPledges(progress) {
    const first = await fetchDoc('/account/pledges?page=1');
    if (!first.querySelector('ul.list-items') && !first.querySelector('.js-pledge-id')) {
      throw new Error('No has iniciado sesión en RSI.');
    }
    const total = Math.max(1, ...pageNumbers(first, 'pledges'));
    const pledges = parsePledgesPage(first);
    progress(`Hangar: página 1 de ${total}`);
    for (let p = 2; p <= total; p++) {
      await sleep(600);
      pledges.push(...parsePledgesPage(await fetchDoc(`/account/pledges?page=${p}`)));
      progress(`Hangar: página ${p} de ${total}`);
    }
    return pledges;
  }

  // ---------- Buy-back ----------
  function parseBuybackPage(doc) {
    return [...doc.querySelectorAll('article.pledge')].map((a) => {
      const dl = {};
      a.querySelectorAll('dl dt').forEach((dt) => {
        dl[dt.textContent.trim()] = dt.nextElementSibling?.textContent.replace(/\s+/g, ' ').trim() ?? '';
      });
      const btn = a.querySelector('.buyback-action a, .buyback-action button');
      const ds = btn?.dataset ?? {};
      const contained = dl['Contained'] ?? '';
      return {
        title: a.querySelector('h1')?.textContent.trim() ?? '',
        reclaimDate: dl['Reclaim Date'] ?? '',
        contained,
        mainItem: /^\d+ items?$/i.test(contained) ? null : contained.replace(/ and \d+ items?$/i, '').trim(),
        buybackId: btn?.getAttribute('href')?.match(/buyback\/(\d+)/)?.[1] ?? null,
        isUpgrade: btn?.classList.contains('js-open-ship-upgrades') ?? false,
        pledgeId: ds.pledgeid ?? null,
        fromShipId: ds.fromshipid ? Number(ds.fromshipid) : null,
        toShipId: ds.toshipid ? Number(ds.toshipid) : null,
        toSkuId: ds.toskuid ? Number(ds.toskuid) : null,
      };
    });
  }

  async function getBuyback(progress) {
    const url = (p) => `/account/buy-back-pledges?page=${p}&pagesize=100`;
    const first = await fetchDoc(url(1));
    const total = Math.max(1, ...pageNumbers(first, 'buy-back-pledges'));
    const items = parseBuybackPage(first);
    const tokens = first.body.textContent.match(/You have (\d+) opportunit/i)?.[1];
    progress(`Buy-back: página 1 de ${total}`);
    for (let p = 2; p <= total; p++) {
      await sleep(600);
      items.push(...parseBuybackPage(await fetchDoc(url(p))));
      progress(`Buy-back: página ${p} de ${total}`);
    }
    return { items, creditBuybacksLeft: tokens != null ? Number(tokens) : null };
  }

  // Precio exacto de las ediciones Warbond del buy-back que no salen en el catálogo.
  // Pone la herramienta de upgrades de RSI en «modo buy-back» para consultar; NO compra. Al final se restablece.
  async function getBuybackSkuPrices(catalog, buyback, progress) {
    const known = new Set();
    for (const s of catalog?.ships ?? []) for (const k of s.skus ?? []) known.add(k.id);
    const seen = new Set();
    const queue = (buyback?.items ?? []).filter(
      (b) => b.isUpgrade && b.toSkuId != null && b.pledgeId && /warbond/i.test(b.title) && !known.has(b.toSkuId) && !seen.has(b.toSkuId) && seen.add(b.toSkuId),
    );
    const prices = {};
    try {
      for (let i = 0; i < queue.length; i++) {
        const it = queue[i];
        await postJson(
          '/api/ship-upgrades/setContextToken',
          { fromShipId: it.fromShipId, toShipId: it.toShipId, toSkuId: it.toSkuId, pledgeId: Number(it.pledgeId) },
          { 'x-rsi-token': rsiToken() },
        );
        const d = await gql('filterShips', Q_TARGETS, { fromId: it.fromShipId, toId: it.toShipId, fromFilters: [], toFilters: [] });
        const sku = d.to.ships.find((s) => s.id === it.toShipId)?.skus.find((k) => k.id === it.toSkuId);
        if (sku?.price != null) prices[it.toSkuId] = sku.price;
        progress(`Precios del buy-back: ${i + 1} de ${queue.length}`);
        await sleep(600);
      }
    } finally {
      await resetContext().catch(() => {});
    }
    return prices;
  }

  // ---------- Crédito de tienda ----------
  async function getStoreCredit() {
    const doc = await fetchDoc('/account/billing');
    const line = [...doc.querySelectorAll('.credit-line')].find((d) => /store credits/i.test(d.textContent));
    const em = line?.querySelector('em')?.textContent;
    if (!em) throw new Error('No encuentro el crédito de tienda.');
    return toCents(em);
  }

  // ---------- Fichas de naves (ship matrix pública de RSI) ----------
  // Son 5 MB con todo; nos quedamos con los campos que usa la web.
  async function getShipMatrix() {
    const res = await fetch('/ship-matrix/index', { credentials: 'include' });
    if (!res.ok) throw new Error(`ship-matrix → HTTP ${res.status}`);
    const data = (await res.json())?.data;
    if (!Array.isArray(data)) throw new Error('Formato inesperado de la ship matrix.');
    const keep = ['id', 'name', 'size', 'type', 'focus', 'production_status', 'min_crew', 'max_crew', 'cargocapacity', 'length', 'beam', 'height', 'mass', 'scm_speed', 'afterburner_speed', 'url'];
    return data.map((s) => {
      const o = Object.fromEntries(keep.map((k) => [k, s[k] ?? null]));
      o.description = String(s.description ?? '').slice(0, 600);
      o.manufacturer = s.manufacturer ? { name: s.manufacturer.name, code: s.manufacturer.code } : null;
      return o;
    });
  }

  // ---------- Historial ----------
  function parseLogHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...doc.querySelectorAll('.pledge-log-entry p')].map((p) => {
      const full = p.textContent.replace(/\s+/g, ' ').trim();
      const name = p.querySelector('.important')?.textContent.replace(/\s+/g, ' ').trim() ?? '';
      const at = name ? full.indexOf(name) : -1;
      const date = (at > 0 ? full.slice(0, at) : full).replace(/\s*-\s*$/, '').trim();
      const rest = at >= 0 ? full.slice(at + name.length).trim() : '';
      const m = rest.match(/^#(\d+)\s*-\s*(.*)$/);
      return { date, pledgeName: name, pledgeId: m?.[1] ?? null, text: m?.[2] ?? rest };
    });
  }

  async function getPledgeLog(progress) {
    const page = (n) => postJson('/api/account/pledgeLog', { page: n }, { 'x-rsi-token': rsiToken() });
    const first = await page(1);
    const total = Number(first?.data?.pagecount) || 1;
    const entries = parseLogHtml(first?.data?.rendered ?? '');
    progress(`Historial: página 1 de ${total}`);
    for (let n = 2; n <= total; n++) {
      await sleep(500);
      entries.push(...parseLogHtml((await page(n))?.data?.rendered ?? ''));
      progress(`Historial: página ${n} de ${total}`);
    }
    return entries;
  }

  // ===================== Panel sobre la web de RSI =====================
  const panel = document.createElement('div');
  panel.id = 'rsi-helper-panel';
  panel.style.cssText =
    'position:fixed;top:16px;right:16px;z-index:2147483647;width:320px;max-width:calc(100vw - 32px);' +
    'background:#0f1419;color:#e6edf3;border:1px solid #4aa8ff;border-radius:10px;padding:14px;' +
    'font:13px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)';
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <strong style="font-size:14px">RSI Upgrade Helper</strong>
      <button data-x="close" style="background:none;border:0;color:#8b98a5;font-size:18px;cursor:pointer" title="Cerrar">×</button>
    </div>
    <p style="margin:0 0 8px;color:#8b98a5">Lee tu hangar, buy-back, crédito y precios de upgrades, y los envía a la web.
      Solo lectura: no compra ni canjea nada.</p>
    <label style="display:flex;gap:6px;align-items:center;margin:6px 0">
      <input type="checkbox" data-x="log"> Incluir historial (≈30 s más)
    </label>
    <button data-x="go" style="width:100%;background:#4aa8ff;color:#001;border:0;border-radius:6px;padding:8px;font-weight:700;cursor:pointer">
      Leer mi cuenta y abrir la web</button>
    <p data-x="status" style="margin:8px 0 0;white-space:pre-wrap"></p>
    <button data-x="download" style="display:none;width:100%;margin-top:8px;background:#182029;color:#e6edf3;border:1px solid #2a3542;border-radius:6px;padding:6px;cursor:pointer">
      Descargar archivo de datos</button>`;
  document.body.appendChild(panel);
  const $ = (k) => panel.querySelector(`[data-x="${k}"]`);
  const status = (text, color = '#e6edf3') => {
    $('status').textContent = text;
    $('status').style.color = color;
  };
  $('close').onclick = () => (panel.style.display = 'none');

  let payload = null;

  $('download').onclick = () => {
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rsi-datos-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  $('go').onclick = async () => {
    $('go').disabled = true;
    $('download').style.display = 'none';
    // Abrimos la web YA (al pulsar el botón), porque si esperamos el navegador puede bloquear la ventana.
    const win = window.open(`${APP_URL}#import`, 'rsi-upgrade-helper');
    const errors = [];
    const step = async (label, fn) => {
      status(`${label}…`);
      try {
        return await fn();
      } catch (e) {
        errors.push(`${label}: ${e.message}`);
        return null;
      }
    };
    try {
      if (!rsiToken()) throw new Error('No has iniciado sesión en RSI.');
      const catalog = await step('Catálogo de naves', () => gql('initShipUpgrade', Q_CATALOG));
      const storeTargets = await step('Upgrades a la venta', async () =>
        (await gql('filterShips', Q_TARGETS, { fromFilters: [], toFilters: [] })).to.ships,
      );
      const pledges = await step('Hangar', () => getPledges(status));
      if (!pledges) throw new Error(errors.at(-1));
      const buyback = await step('Buy-back', () => getBuyback(status));
      const storeCreditCents = await step('Crédito de tienda', getStoreCredit);
      const skuPrices = (await step('Precios del buy-back', () => getBuybackSkuPrices(catalog, buyback, status))) ?? {};
      const shipMatrix = await step('Fichas de naves', getShipMatrix);
      const log = $('log').checked ? await step('Historial', () => getPledgeLog(status)) : null;

      payload = {
        source: 'rsi-upgrade-helper',
        version: 1,
        collectedAt: Date.now(),
        catalog,
        storeTargets,
        pledges,
        buyback,
        storeCreditCents,
        skuPrices,
        shipMatrix,
        log,
      };
      $('download').style.display = 'block';
      if (errors.length) status(`Leído con avisos:\n${errors.join('\n')}`, '#d29922');
      await send(win);
    } catch (e) {
      status(`✖ ${e.message}`, '#f85149');
    } finally {
      $('go').disabled = false;
    }
  };

  // Enviamos los datos a la web (solo a su origen) hasta que confirme que los ha recibido.
  function send(win) {
    // Algunos navegadores bloquean leer win.closed entre orígenes distintos: lo tratamos como «no se sabe».
    const isClosed = () => {
      try {
        return !win || win.closed;
      } catch {
        return false;
      }
    };
    if (isClosed()) {
      status('El navegador bloqueó la ventana de la web. Descarga el archivo y súbelo en la web (Conectar → Importar archivo).', '#d29922');
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const started = Date.now();
      const onMsg = (e) => {
        if (e.origin === APP_ORIGIN && e.data?.type === 'rsi-helper-ack') {
          cleanup();
          status('✔ Datos enviados. Ya puedes verlos en la web.', '#3fb950');
        }
      };
      const timer = setInterval(() => {
        if (isClosed() || Date.now() - started > 60000) {
          cleanup();
          status('La web no respondió. Descarga el archivo y súbelo en la web (Conectar → Importar archivo).', '#d29922');
          return;
        }
        win.postMessage({ type: 'rsi-helper-data', payload }, APP_ORIGIN);
      }, 500);
      function cleanup() {
        clearInterval(timer);
        window.removeEventListener('message', onMsg);
        resolve();
      }
      window.addEventListener('message', onMsg);
      status('Enviando datos a la web…');
    });
  }
})();
