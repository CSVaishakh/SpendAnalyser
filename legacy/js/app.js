/* Spend Analyser — dashboard UI. Depends on SpendParser (parser.js) and Chart.js. */
(function () {
  'use strict';
  const P = window.SpendParser;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const DAY = 86400000;

  // ---------- State ----------
  const state = {
    raw: [], files: [], all: [], view: [],
    from: null, to: null, search: '',
    rules: loadJSON('spend.rules', []),
    tab: 'overview',
    entDir: 'out', entCat: '', entSort: { key: null, dir: -1 },
    txDir: 'all', txCat: '', txChan: '', txSort: { key: 'date', dir: -1 }, txPage: 0,
    drawerEntity: null,
  };
  const charts = {};

  function loadJSON(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }

  // ---------- Formatting ----------
  const fmtINR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  const fmtINR2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtCompact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
  const inr = n => fmtINR.format(Math.round(n));
  const inr2 = n => fmtINR2.format(n);
  const inrC = n => (n < 0 ? '−₹' : '₹') + fmtCompact.format(Math.abs(n));
  const fmtDate = d => d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const monthLabel = k => { const [y, m] = k.split('-'); return new Date(+y, +m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }); };
  const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);

  function monthsBetween(a, b) {
    const out = [];
    let d = new Date(a.getFullYear(), a.getMonth(), 1);
    while (d <= b) { out.push(monthKey(d)); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
    return out;
  }

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600);
  }

  // ---------- Theme ----------
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  const themeSaved = loadJSON('spend.theme', null);
  if (themeSaved) document.documentElement.dataset.theme = themeSaved;
  $('#themeBtn').onclick = () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    saveJSON('spend.theme', document.documentElement.dataset.theme);
    if (state.all.length) render();
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => state.all.length && render());

  // ---------- Loading ----------
  async function loadFiles(fileList) {
    const errs = [];
    for (const f of fileList) {
      try {
        const text = await f.text();
        addStatement(text, f.name);
      } catch (e) { errs.push(e.message); }
    }
    if (errs.length) { $('#loadError').textContent = errs.join(' '); toast(errs[0]); }
    finishLoad();
  }

  function addStatement(text, name) {
    const res = P.parseStatement(text, name);
    if (!res.txns.length) throw new Error(`No transactions found in ${name}.`);
    state.raw.push(...res.txns);
    state.files.push({ name, count: res.txns.length, skipped: res.skipped });
  }

  function finishLoad() {
    if (!state.raw.length) return;
    // Sort by date; within a day keep statement order (balances depend on it).
    state.raw = P.dedupe(state.raw.map((t, i) => ({ ...t, _o: i })))
      .sort((a, b) => a.date - b.date || a._o - b._o);
    $('#empty').hidden = true; $('#dash').hidden = false; $('#clearBtn').hidden = false;
    state.from = null; state.to = null;
    setPreset('all');
    recompute();
  }

  ['#fileInput', '#fileInput2'].forEach(id => $(id).addEventListener('change', e => { loadFiles(e.target.files); e.target.value = ''; }));
  const dz = $('#dropZone');
  ['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); if (ev === 'drop' || e.target === dz) dz.classList.remove('over'); }));
  document.addEventListener('drop', e => { if (e.dataTransfer?.files?.length) loadFiles(e.dataTransfer.files); });

  $('#sampleBtn').onclick = async () => {
    try {
      const r = await fetch('sample/sample_statement.csv');
      if (!r.ok) throw new Error();
      addStatement(await r.text(), 'sample_statement.csv');
      finishLoad();
    } catch (e) {
      $('#loadError').textContent = 'Browsers block loading the sample from a file:// page. Drag sample/sample_statement.csv in, or serve the folder (python3 -m http.server).';
    }
  };

  $('#clearBtn').onclick = () => {
    state.raw = []; state.files = []; state.all = []; state.view = [];
    Object.values(charts).forEach(c => c.destroy());
    $('#dash').hidden = true; $('#empty').hidden = false; $('#clearBtn').hidden = true;
    $('#loadError').textContent = '';
  };

  // ---------- Pipeline ----------
  function recompute() {
    state.all = P.enrich(state.raw, state.rules);
    const cats = [...new Set(state.all.map(t => t.category))].sort();
    const chans = [...new Set(state.all.map(t => t.channel))].sort();
    fillSelect('#entCat', cats, 'All categories', state.entCat);
    fillSelect('#txCat', cats, 'All categories', state.txCat);
    fillSelect('#txChan', chans, 'All channels', state.txChan);
    $('#categoryNames').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
    $('#entityNames').innerHTML = [...new Set(state.all.map(t => t.entity))].sort().map(c => `<option value="${esc(c)}">`).join('');
    const first = state.all[0].date, last = state.all[state.all.length - 1].date;
    $('#fromDate').min = $('#toDate').min = isoDate(first);
    $('#fromDate').max = $('#toDate').max = isoDate(last);
    $('#fileInfo').textContent = `${state.files.map(f => `${f.name} (${f.count})`).join(' · ')} — ${state.all.length} transactions, ${fmtDate(first)} to ${fmtDate(last)}`;
    render();
  }

  function fillSelect(sel, items, allLabel, cur) {
    $(sel).innerHTML = `<option value="">${allLabel}</option>` + items.map(i => `<option${i === cur ? ' selected' : ''}>${esc(i)}</option>`).join('');
  }

  function applyFilters() {
    const q = state.search.toLowerCase();
    const to = state.to ? new Date(+state.to + DAY - 1) : null;
    state.view = state.all.filter(t =>
      (!state.from || t.date >= state.from) && (!to || t.date <= to) &&
      (!q || t.entity.toLowerCase().includes(q) || t.particulars.toLowerCase().includes(q) || t.category.toLowerCase().includes(q) || t.channel.toLowerCase().includes(q)));
  }

  function render() {
    applyFilters();
    renderKPIs();
    if (state.tab === 'overview') renderOverview();
    if (state.tab === 'payees') renderEntities();
    if (state.tab === 'txns') renderTxns();
    if (state.tab === 'rules') renderRules();
    if (state.drawerEntity) openEntity(state.drawerEntity, true);
  }

  // ---------- Filters ----------
  function setPreset(range) {
    $$('#presets button').forEach(b => b.classList.toggle('on', b.dataset.range === range));
    if (!state.raw.length) return;
    const last = state.raw[state.raw.length - 1].date;
    if (range === 'all') { state.from = null; state.to = null; }
    else {
      const m = parseInt(range, 10);
      state.from = new Date(last.getFullYear(), last.getMonth() - m, last.getDate() + 1);
      state.to = last;
    }
    $('#fromDate').value = state.from ? isoDate(state.from) : '';
    $('#toDate').value = state.to ? isoDate(state.to) : '';
  }
  $$('#presets button').forEach(b => b.onclick = () => { setPreset(b.dataset.range); state.txPage = 0; render(); });
  const parseInput = v => { if (!v) return null; const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); };
  $('#fromDate').onchange = e => { state.from = parseInput(e.target.value); setPresetOff(); render(); };
  $('#toDate').onchange = e => { state.to = parseInput(e.target.value); setPresetOff(); render(); };
  function setPresetOff() { $$('#presets button').forEach(b => b.classList.remove('on')); state.txPage = 0; }
  let searchT;
  $('#search').oninput = e => { clearTimeout(searchT); searchT = setTimeout(() => { state.search = e.target.value.trim(); state.txPage = 0; render(); }, 180); };

  $$('.tabs button').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
  function switchTab(tab) {
    state.tab = tab;
    $$('.tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === tab));
    $$('.tab').forEach(x => (x.hidden = x.id !== 'tab-' + tab));
    render();
  }

  // ---------- KPIs ----------
  function renderKPIs() {
    const v = state.view;
    const tin = sum(v, t => t.deposit), tout = sum(v, t => t.withdrawal), net = tin - tout;
    const withBal = v.filter(t => t.balance != null);
    const opening = withBal.length ? withBal[0].balance - withBal[0].deposit + withBal[0].withdrawal : null;
    const closing = withBal.length ? withBal[withBal.length - 1].balance : null;
    const months = v.length ? Math.max(1, (v[v.length - 1].date - v[0].date) / (DAY * 30.44)) : 1;
    const payees = new Set(v.filter(t => t.withdrawal > 0).map(t => t.entity)).size;
    const savingsRate = tin ? net / tin : null;
    const tiles = [
      { label: 'Money in', value: inr(tin), sub: `${v.filter(t => t.deposit > 0).length} credits`, sw: 'in' },
      { label: 'Money out', value: inr(tout), sub: `${v.filter(t => t.withdrawal > 0).length} debits`, sw: 'out' },
      { label: 'Net cashflow', value: (net >= 0 ? '+' : '−') + inr(Math.abs(net)), cls: net >= 0 ? 'pos' : 'neg',
        sub: savingsRate != null ? `${(savingsRate * 100).toFixed(1)}% of inflow ${net >= 0 ? 'saved' : 'overspent'}` : '' },
      { label: 'Closing balance', value: closing != null ? inr(closing) : '—', sub: opening != null ? `Opening ${inr(opening)}` : '', hero: true },
      { label: 'Avg monthly spend', value: inr(tout / months), sub: `over ${months.toFixed(1)} months` },
      { label: 'Payees', value: payees.toLocaleString('en-IN'), sub: `${v.length} transactions` },
    ];
    $('#kpis').innerHTML = tiles.map(k => `<div class="kpi${k.hero ? ' hero' : ''}">
      <div class="label">${k.sw ? `<i class="sw ${k.sw}"></i>` : ''}${k.label}</div>
      <div class="value ${k.cls || ''}">${k.value}</div><div class="sub">${k.sub}</div></div>`).join('');
  }

  // ---------- Chart helpers ----------
  function baseOpts(extra = {}) {
    const grid = css('--grid'), muted = css('--muted');
    return {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: css('--surface'), titleColor: css('--ink'), bodyColor: css('--ink-2'),
          borderColor: css('--axis'), borderWidth: 1, padding: 10, cornerRadius: 8, boxPadding: 4,
          usePointStyle: true, titleFont: { weight: '600' },
          callbacks: { label: c => ` ${c.dataset.label ? c.dataset.label + ': ' : ''}${inr(c.parsed[c.chart.options.indexAxis === 'y' ? 'x' : 'y'])}` },
        },
      },
      scales: {
        x: { grid: { color: grid, drawTicks: false }, border: { display: false }, ticks: { color: muted, padding: 6 } },
        y: { grid: { color: grid, drawTicks: false }, border: { display: false }, ticks: { color: muted, padding: 6 } },
      },
      ...extra,
    };
  }
  function draw(id, config) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(document.getElementById(id), config);
    return charts[id];
  }
  const barStyle = { borderRadius: 4, borderSkipped: 'start', maxBarThickness: 24 };

  function hbar(id, wrapId, labels, values, color, onClick, extraTip) {
    $(wrapId).style.height = Math.max(120, labels.length * 30 + 30) + 'px';
    const o = baseOpts({ indexAxis: 'y' });
    o.scales.x.ticks.callback = v => inrC(v);
    o.scales.y.grid.display = false;
    o.scales.y.ticks.color = css('--ink-2');
    o.scales.y.ticks.callback = function (v) { const l = this.getLabelForValue(v); return l.length > 24 ? l.slice(0, 23) + '…' : l; };
    if (extraTip) o.plugins.tooltip.callbacks.afterLabel = extraTip;
    if (onClick) {
      o.onClick = (e, els) => els.length && onClick(labels[els[0].index]);
      o.onHover = (e, els) => (e.native.target.style.cursor = els.length ? 'pointer' : 'default');
    }
    draw(id, { type: 'bar', data: { labels, datasets: [{ data: values, backgroundColor: color, ...barStyle, barPercentage: .8, categoryPercentage: .9 }] }, options: o });
  }

  function groupBy(arr, keyFn) {
    const m = new Map();
    for (const x of arr) { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
    return m;
  }

  // ---------- Overview ----------
  function renderOverview() {
    const v = state.view, cIn = css('--in'), cOut = css('--out');
    if (!v.length) { Object.values(charts).forEach(c => c.destroy()); $('#bigTable').innerHTML = '<tr><td class="muted">No transactions in this range.</td></tr>'; return; }

    // Monthly in/out
    const months = monthsBetween(v[0].date, v[v.length - 1].date);
    const byM = groupBy(v, t => monthKey(t.date));
    const mIn = months.map(m => sum(byM.get(m) || [], t => t.deposit));
    const mOut = months.map(m => sum(byM.get(m) || [], t => t.withdrawal));
    const o = baseOpts({ interaction: { mode: 'index', intersect: false } });
    o.scales.x.grid.display = false;
    o.scales.y.ticks.callback = v => inrC(v);
    o.plugins.tooltip.callbacks.footer = items => { const n = items[0].chart.data.datasets[0].data[items[0].dataIndex] - items[0].chart.data.datasets[1].data[items[0].dataIndex]; return `Net: ${n >= 0 ? '+' : '−'}${inr(Math.abs(n))}`; };
    o.plugins.tooltip.footerColor = css('--ink');
    draw('cMonthly', { type: 'bar', data: { labels: months.map(monthLabel), datasets: [
      { label: 'Money in', data: mIn, backgroundColor: cIn, ...barStyle, barPercentage: .82, categoryPercentage: .6 },
      { label: 'Money out', data: mOut, backgroundColor: cOut, ...barStyle, barPercentage: .82, categoryPercentage: .6 },
    ] }, options: o });

    // Balance — last balance per day
    const days = new Map();
    let running = null;
    for (const t of v) {
      if (t.balance != null) running = t.balance; else if (running != null) running += t.amount;
      if (running != null) days.set(isoDate(t.date), running);
    }
    const bl = [...days.keys()], bv = [...days.values()];
    const ob = baseOpts({ interaction: { mode: 'index', intersect: false } });
    ob.scales.x.grid.display = false;
    ob.scales.x.ticks.maxTicksLimit = 8; ob.scales.x.ticks.maxRotation = 0;
    ob.scales.x.ticks.callback = function (val) { return parseInput(this.getLabelForValue(val)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
    ob.scales.y.ticks.callback = v => inrC(v);
    ob.plugins.tooltip.callbacks.title = items => fmtDate(parseInput(items[0].label));
    ob.plugins.tooltip.callbacks.label = c => ` Balance: ${inr2(c.parsed.y)}`;
    draw('cBalance', { type: 'line', data: { labels: bl, datasets: [{
      data: bv, borderColor: cIn, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 2,
      pointHoverBorderColor: css('--surface'), pointHoverBackgroundColor: cIn, fill: true,
      backgroundColor: hexA(cIn, .10), tension: 0, borderJoinStyle: 'round', borderCapStyle: 'round',
    }] }, options: ob });

    // Top payees (outflow)
    const out = v.filter(t => t.withdrawal > 0), totalOut = sum(out, t => t.withdrawal);
    const ents = [...groupBy(out, t => t.entity)].map(([k, a]) => [k, sum(a, t => t.withdrawal), a.length]).sort((a, b) => b[1] - a[1]).slice(0, 12);
    hbar('cPayees', '#topPayeesWrap', ents.map(e => e[0]), ents.map(e => e[1]), cOut, openEntity,
      c => `${ents[c.dataIndex][2]} payments · ${(ents[c.dataIndex][1] / totalOut * 100).toFixed(1)}% of outflow`);

    // Category
    const cats = [...groupBy(out, t => t.category)].map(([k, a]) => [k, sum(a, t => t.withdrawal), a.length]).sort((a, b) => b[1] - a[1]);
    hbar('cCategory', '#catWrap', cats.map(c => c[0]), cats.map(c => c[1]), cOut,
      cat => { state.txCat = cat; state.txDir = 'out'; syncSeg('#txDir', 'out'); switchTab('txns'); },
      c => `${cats[c.dataIndex][2]} payments · ${(cats[c.dataIndex][1] / totalOut * 100).toFixed(1)}%`);

    // Channel
    const ch = [...groupBy(out, t => t.channel)].map(([k, a]) => [k, sum(a, t => t.withdrawal), a.length]).sort((a, b) => b[1] - a[1]);
    hbar('cChannel', '#chanWrap', ch.map(c => c[0]), ch.map(c => c[1]), cOut,
      chan => { state.txChan = chan; state.txDir = 'out'; syncSeg('#txDir', 'out'); switchTab('txns'); },
      c => `${ch[c.dataIndex][2]} payments`);

    // Weekday (Mon-first)
    const wd = [0, 0, 0, 0, 0, 0, 0];
    for (const t of out) wd[(t.date.getDay() + 6) % 7] += t.withdrawal;
    const ow = baseOpts();
    ow.scales.x.grid.display = false;
    ow.scales.y.ticks.callback = v => inrC(v);
    draw('cWeekday', { type: 'bar', data: { labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], datasets: [{ data: wd, backgroundColor: cOut, ...barStyle }] }, options: ow });

    // Largest payments
    const big = [...out].sort((a, b) => b.withdrawal - a.withdrawal).slice(0, 10);
    $('#bigTable').innerHTML = `<thead><tr><th>Date</th><th>Payee</th><th>Category</th><th>Narration</th><th class="num">Amount</th></tr></thead><tbody>` +
      big.map(t => `<tr class="click" data-ent="${esc(t.entity)}"><td>${fmtDate(t.date)}</td><td class="ent">${esc(t.entity)}</td><td><span class="tag">${esc(t.category)}</span></td><td class="narr">${esc(t.particulars)}</td><td class="num">${inr2(t.withdrawal)}</td></tr>`).join('') + '</tbody>';
  }

  function hexA(hex, a) {
    const n = parseInt(hex.replace('#', ''), 16);
    return `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${a})`;
  }
  function syncSeg(sel, val) { $$(sel + ' button').forEach(b => b.classList.toggle('on', b.dataset.dir === val)); }

  document.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-ent]');
    if (tr && !e.target.closest('.drawer')) openEntity(tr.dataset.ent);
  });

  // ---------- Entities ----------
  function aggregateEntities(v) {
    const totalOut = sum(v, t => t.withdrawal), totalIn = sum(v, t => t.deposit);
    return [...groupBy(v, t => t.entity)].map(([name, a]) => {
      const outs = a.filter(t => t.withdrawal > 0), ins = a.filter(t => t.deposit > 0);
      const catCount = {};
      a.forEach(t => (catCount[t.category] = (catCount[t.category] || 0) + 1));
      const out = sum(outs, t => t.withdrawal), inn = sum(ins, t => t.deposit);
      return {
        name, txns: a, out, in: inn, net: inn - out,
        nOut: outs.length, nIn: ins.length,
        avgOut: outs.length ? out / outs.length : 0,
        category: Object.entries(catCount).sort((x, y) => y[1] - x[1])[0][0],
        channels: [...new Set(a.map(t => t.channel))].join(', '),
        months: new Set(a.map(t => monthKey(t.date))).size,
        first: a[0].date, last: a[a.length - 1].date,
        lastOut: outs.length ? outs[outs.length - 1].date : null,
        shareOut: totalOut ? out / totalOut : 0, shareIn: totalIn ? inn / totalIn : 0,
      };
    });
  }

  const ENT_COLS = [
    { key: 'name', label: 'Payee / entity', td: e => `<td class="ent">${esc(e.name)}</td>` },
    { key: 'category', label: 'Category', td: e => `<td><span class="tag">${esc(e.category)}</span></td>` },
    { key: 'out', label: 'Paid out', num: true, td: e => `<td class="num">${e.out ? inr2(e.out) : '—'}</td>` },
    { key: 'nOut', label: 'Payments', num: true, td: e => `<td class="num">${e.nOut || '—'}</td>` },
    { key: 'avgOut', label: 'Avg payment', num: true, td: e => `<td class="num">${e.avgOut ? inr(e.avgOut) : '—'}</td>` },
    { key: 'in', label: 'Received', num: true, td: e => `<td class="num">${e.in ? inr2(e.in) : '—'}</td>` },
    { key: 'net', label: 'Net', num: true, td: e => `<td class="num ${e.net >= 0 ? 'pos' : ''}">${e.net >= 0 ? '+' : '−'}${inr(Math.abs(e.net))}</td>` },
    { key: 'months', label: 'Months active', num: true, td: e => `<td class="num">${e.months}</td>` },
    { key: 'last', label: 'Last seen', td: e => `<td>${fmtDate(e.last)}</td>` },
    { key: 'share', label: 'Share', num: true, td: e => { const s = state.entDir === 'in' ? e.shareIn : e.shareOut; return `<td class="num"><div class="share">${(s * 100).toFixed(1)}%<span class="meter"><i style="width:${Math.min(100, s / maxShare * 100)}%"></i></span></div></td>`; } },
  ];
  let maxShare = 1;

  function entityRows() {
    let rows = aggregateEntities(state.view);
    if (state.entDir === 'out') rows = rows.filter(e => e.out > 0);
    if (state.entDir === 'in') rows = rows.filter(e => e.in > 0);
    if (state.entCat) rows = rows.filter(e => e.category === state.entCat);
    const s = state.entSort;
    const key = s.key || (state.entDir === 'in' ? 'in' : state.entDir === 'out' ? 'out' : 'total');
    const val = e => key === 'total' ? e.in + e.out : key === 'share' ? (state.entDir === 'in' ? e.shareIn : e.shareOut) : e[key];
    rows.sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * s.dir; });
    return rows;
  }

  function renderEntities() {
    const rows = entityRows();
    maxShare = Math.max(0.0001, ...rows.map(e => state.entDir === 'in' ? e.shareIn : e.shareOut));
    $('#entCount').textContent = `${rows.length} entities`;
    $('#entTable').innerHTML = `<thead><tr>${ENT_COLS.map(c => `<th data-key="${c.key}" class="${c.num ? 'num' : ''}">${c.label}${state.entSort.key === c.key ? `<span class="sort-ind">${state.entSort.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(e => `<tr class="click" data-ent="${esc(e.name)}">${ENT_COLS.map(c => c.td(e)).join('')}</tr>`).join('') || '<tr><td colspan="10" class="muted">No entities match.</td></tr>'}</tbody>`;
    $$('#entTable th').forEach(th => th.onclick = () => {
      const k = th.dataset.key;
      state.entSort = { key: k, dir: state.entSort.key === k ? -state.entSort.dir : (k === 'name' || k === 'category' ? 1 : -1) };
      renderEntities();
    });
  }
  $$('#entDir button').forEach(b => b.onclick = () => { state.entDir = b.dataset.dir; state.entSort = { key: null, dir: -1 }; syncSeg('#entDir', b.dataset.dir); renderEntities(); });
  $('#entCat').onchange = e => { state.entCat = e.target.value; renderEntities(); };
  $('#entExport').onclick = () => downloadCSV('payees.csv',
    ['Entity', 'Category', 'Paid out', 'Payments', 'Avg payment', 'Received', 'Credits', 'Net', 'Months active', 'First', 'Last', 'Channels'],
    entityRows().map(e => [e.name, e.category, e.out.toFixed(2), e.nOut, e.avgOut.toFixed(2), e.in.toFixed(2), e.nIn, e.net.toFixed(2), e.months, isoDate(e.first), isoDate(e.last), e.channels]));

  // ---------- Entity drawer ----------
  function openEntity(name, refresh) {
    const all = state.view.filter(t => t.entity === name);
    if (!all.length) { if (refresh) closeDrawer(); return; }
    state.drawerEntity = name;
    const e = aggregateEntities(state.view).find(x => x.name === name);
    const outs = all.filter(t => t.withdrawal > 0);
    const gaps = [];
    for (let i = 1; i < outs.length; i++) gaps.push((outs[i].date - outs[i - 1].date) / DAY);
    gaps.sort((a, b) => a - b);
    const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
    const largest = outs.reduce((m, t) => Math.max(m, t.withdrawal), 0);

    $('#dTitle').textContent = name;
    $('#dCat').textContent = `${e.category} · ${e.channels}`;
    const k = [
      ['Total paid', e.out ? inr2(e.out) : '—'], ['Payments', e.nOut || '—'], ['Avg payment', e.avgOut ? inr2(e.avgOut) : '—'],
      ['Total received', e.in ? inr2(e.in) : '—'], ['Net', `${e.net >= 0 ? '+' : '−'}${inr2(Math.abs(e.net))}`], ['Largest payment', largest ? inr2(largest) : '—'],
      ['First seen', fmtDate(e.first)], ['Last seen', fmtDate(e.last)],
      ['Typical gap', median != null ? (median < 1 ? 'Same day' : `${Math.round(median)} days`) : '—'],
    ];
    $('#dKpis').innerHTML = k.map(([l, v]) => `<div><span>${l}</span><b>${v}</b></div>`).join('');

    const v = state.view;
    const months = monthsBetween(v[0].date, v[v.length - 1].date);
    const byM = groupBy(all, t => monthKey(t.date));
    const o = baseOpts({ interaction: { mode: 'index', intersect: false } });
    o.scales.x.grid.display = false;
    o.scales.y.ticks.callback = x => inrC(x);
    const ds = [{ label: 'Paid', data: months.map(m => sum(byM.get(m) || [], t => t.withdrawal)), backgroundColor: css('--out'), ...barStyle, barPercentage: .82, categoryPercentage: .6 }];
    if (e.in) ds.push({ label: 'Received', data: months.map(m => sum(byM.get(m) || [], t => t.deposit)), backgroundColor: css('--in'), ...barStyle, barPercentage: .82, categoryPercentage: .6 });
    $('#drawer .legend').style.display = e.in ? '' : 'none';

    $('#dName').value = name;
    $('#dCategory').value = e.category;

    const variants = {};
    all.forEach(t => { const n = t.particulars.replace(/\d{5,}/g, '…').replace(/X{3,}\d*/gi, '…'); variants[n] = (variants[n] || 0) + 1; });
    $('#dVariants').innerHTML = Object.entries(variants).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, c]) => `<li><b>${c}×</b>${esc(n)}</li>`).join('');

    $('#dTable').innerHTML = `<thead><tr><th>Date</th><th>Channel</th><th class="num">Paid</th><th class="num">Received</th><th class="num">Balance</th></tr></thead><tbody>` +
      [...all].reverse().map(t => `<tr title="${esc(t.particulars)}"><td>${fmtDate(t.date)}</td><td>${esc(t.channel)}</td><td class="num">${t.withdrawal ? inr2(t.withdrawal) : ''}</td><td class="num">${t.deposit ? inr2(t.deposit) : ''}</td><td class="num">${t.balance != null ? inr2(t.balance) : ''}</td></tr>`).join('') + '</tbody>';

    $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false'); $('#scrim').hidden = false;
    draw('cEntity', { type: 'bar', data: { labels: months.map(monthLabel), datasets: ds }, options: o });
    if (!refresh) $('#dClose').focus();
  }
  function closeDrawer() {
    state.drawerEntity = null;
    $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); $('#scrim').hidden = true;
  }
  $('#dClose').onclick = closeDrawer;
  $('#scrim').onclick = closeDrawer;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.drawerEntity) closeDrawer(); });

  $('#dSave').onclick = () => {
    const cur = state.drawerEntity, newName = $('#dName').value.trim(), newCat = $('#dCategory').value.trim();
    if (!cur || !newName) return;
    // One exact-match rule per detected name currently grouped under this entity (covers earlier merges too).
    const autos = [...new Set(state.all.filter(t => t.entity === cur).map(t => t.autoEntity))];
    const escRe = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    for (const a of autos) {
      const match = `/^${escRe(a)}$/`;
      state.rules = state.rules.filter(r => r.match !== match);
      state.rules.unshift({ match, entity: newName, category: newCat });
    }
    saveJSON('spend.rules', state.rules);
    state.drawerEntity = newName;
    recompute();
    toast(newName === cur ? `Updated ${newName}` : `Renamed “${cur}” to “${newName}”`);
  };

  // ---------- Transactions ----------
  const PAGE = 100;
  const TX_COLS = [
    { key: 'date', label: 'Date' }, { key: 'entity', label: 'Payee / entity' }, { key: 'category', label: 'Category' },
    { key: 'channel', label: 'Channel' }, { key: 'particulars', label: 'Narration' },
    { key: 'withdrawal', label: 'Withdrawal', num: true }, { key: 'deposit', label: 'Deposit', num: true }, { key: 'balance', label: 'Balance', num: true },
  ];
  function txRows() {
    let r = state.view;
    if (state.txDir === 'out') r = r.filter(t => t.withdrawal > 0);
    if (state.txDir === 'in') r = r.filter(t => t.deposit > 0);
    if (state.txCat) r = r.filter(t => t.category === state.txCat);
    if (state.txChan) r = r.filter(t => t.channel === state.txChan);
    const { key, dir } = state.txSort;
    return [...r].sort((a, b) => {
      const x = a[key], y = b[key];
      const c = x instanceof Date ? x - y || a.id - b.id : typeof x === 'string' ? x.localeCompare(y) : (x ?? 0) - (y ?? 0);
      return c * dir;
    });
  }
  function renderTxns() {
    $('#txCat').value = state.txCat; $('#txChan').value = state.txChan;
    const rows = txRows(), pages = Math.max(1, Math.ceil(rows.length / PAGE));
    state.txPage = Math.min(state.txPage, pages - 1);
    const page = rows.slice(state.txPage * PAGE, (state.txPage + 1) * PAGE);
    $('#txCount').textContent = `${rows.length} transactions · out ${inr(sum(rows, t => t.withdrawal))} · in ${inr(sum(rows, t => t.deposit))}`;
    $('#txTable').innerHTML = `<thead><tr>${TX_COLS.map(c => `<th data-key="${c.key}" class="${c.num ? 'num' : ''}">${c.label}${state.txSort.key === c.key ? `<span class="sort-ind">${state.txSort.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`).join('')}</tr></thead><tbody>` +
      (page.map(t => `<tr class="click" data-ent="${esc(t.entity)}"><td>${fmtDate(t.date)}</td><td class="ent">${esc(t.entity)}</td><td><span class="tag">${esc(t.category)}</span></td><td>${esc(t.channel)}</td><td class="narr">${esc(t.particulars)}</td><td class="num">${t.withdrawal ? inr2(t.withdrawal) : ''}</td><td class="num">${t.deposit ? inr2(t.deposit) : ''}</td><td class="num">${t.balance != null ? inr2(t.balance) : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">No transactions match.</td></tr>') + '</tbody>';
    $$('#txTable th').forEach(th => th.onclick = () => {
      const k = th.dataset.key;
      state.txSort = { key: k, dir: state.txSort.key === k ? -state.txSort.dir : (['entity', 'category', 'channel', 'particulars'].includes(k) ? 1 : -1) };
      renderTxns();
    });
    $('#txPager').innerHTML = pages > 1 ? `<button class="btn btn-sm" data-p="-1" ${state.txPage === 0 ? 'disabled' : ''}>Previous</button><span>Page ${state.txPage + 1} of ${pages}</span><button class="btn btn-sm" data-p="1" ${state.txPage >= pages - 1 ? 'disabled' : ''}>Next</button>` : '';
    $$('#txPager button').forEach(b => b.onclick = () => { state.txPage += +b.dataset.p; renderTxns(); $('#tab-txns').scrollIntoView({ behavior: 'smooth' }); });
  }
  $$('#txDir button').forEach(b => b.onclick = () => { state.txDir = b.dataset.dir; state.txPage = 0; syncSeg('#txDir', b.dataset.dir); renderTxns(); });
  $('#txCat').onchange = e => { state.txCat = e.target.value; state.txPage = 0; renderTxns(); };
  $('#txChan').onchange = e => { state.txChan = e.target.value; state.txPage = 0; renderTxns(); };
  $('#txExport').onclick = () => downloadCSV('transactions.csv',
    ['Date', 'Entity', 'Category', 'Channel', 'Particulars', 'Tran Type', 'Cheque Details', 'Withdrawal', 'Deposit', 'Balance'],
    txRows().map(t => [isoDate(t.date), t.entity, t.category, t.channel, t.particulars, t.tranType, t.cheque, t.withdrawal || '', t.deposit || '', t.balance ?? '']));

  function downloadCSV(name, header, rows) {
    const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const blob = new Blob(['﻿' + [header, ...rows].map(r => r.map(q).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Rules ----------
  function renderRules() {
    const cats = [...new Set(state.all.map(t => t.category))].sort();
    $('#rulesTable').innerHTML = `<thead><tr><th>Match (text or /regex/)</th><th>Set payee to</th><th>Set category to</th><th></th></tr></thead><tbody>` +
      (state.rules.map((r, i) => `<tr data-i="${i}">
        <td><input data-f="match" value="${esc(r.match)}" placeholder="e.g. swiggy or /^LANDLORD/"></td>
        <td><input data-f="entity" value="${esc(r.entity)}" list="entityNames" placeholder="(unchanged)"></td>
        <td><input data-f="category" value="${esc(r.category)}" list="categoryNames" placeholder="(unchanged)"></td>
        <td><button class="btn btn-icon btn-sm" data-del="${i}" aria-label="Delete rule">✕</button></td></tr>`).join('') ||
        '<tr><td colspan="4" class="muted">No rules yet. Rename a payee from its detail panel, or add one here.</td></tr>') + '</tbody>';
    $$('#rulesTable input').forEach(inp => inp.onchange = () => {
      state.rules[+inp.closest('tr').dataset.i][inp.dataset.f] = inp.value.trim();
      saveJSON('spend.rules', state.rules); recompute();
    });
    $$('#rulesTable [data-del]').forEach(b => b.onclick = () => { state.rules.splice(+b.dataset.del, 1); saveJSON('spend.rules', state.rules); recompute(); });
    $('#categoryNames').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
  }
  $('#addRule').onclick = () => { state.rules.push({ match: '', entity: '', category: '' }); renderRules(); $$('#rulesTable input[data-f="match"]').pop()?.focus(); };
  $('#exportRules').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state.rules.filter(r => r.match), null, 2)], { type: 'application/json' }));
    a.download = 'spend-rules.json'; a.click();
  };
  $('#importRules').onchange = async e => {
    try {
      const r = JSON.parse(await e.target.files[0].text());
      if (!Array.isArray(r)) throw new Error();
      state.rules = r.filter(x => x && typeof x.match === 'string').map(x => ({ match: x.match, entity: x.entity || '', category: x.category || '' }));
      saveJSON('spend.rules', state.rules); recompute(); toast(`Imported ${state.rules.length} rules`);
    } catch (err) { toast('That file is not a rules export.'); }
    e.target.value = '';
  };
})();
