/* ============================================================
   Trajectory — net worth projection simulator
   No dependencies. Pure client-side.
   ============================================================ */

const ASSETS = [
  { key: 'retire',     label: '401k / retirement', varc: '--c-retire' },
  { key: 'stocks',     label: 'Brokerage / stocks', varc: '--c-stocks' },
  { key: 'realestate', label: 'Real estate',        varc: '--c-realestate' },
  { key: 'other',      label: 'Cash & other',       varc: '--c-other' },
];

/* ---------- default input model for one scenario ---------- */
function defaultScenario() {
  return {
    years: 30,
    currentAge: null,
    // starting balances
    a_stocks: 40000, a_retire: 60000, a_re: 120000, a_other: 20000,
    // growth rates (%)
    g_stocks: 7, g_retire: 7, g_re: 4, g_other: 1,
    // cash flow
    salary: 110000, salaryGrowth: 3, expenses: 60000, taxRate: 24,
    // 401k
    contrib401k: 0, matchCap: 4,
    // economy
    inflation: 3,
    // one-time events
    events: [],
  };
}

const FIELD_IDS = [
  'years','currentAge','a_stocks','a_retire','a_re','a_other',
  'g_stocks','g_retire','g_re','g_other',
  'salary','salaryGrowth','expenses','taxRate','contrib401k','matchCap','inflation',
];

const state = {
  active: 'A',
  compare: true,
  basis: 'nominal',           // 'nominal' | 'real'
  A: defaultScenario(),
  B: defaultScenario(),
};

/* ============================================================
   PROJECTION ENGINE
   ============================================================ */
function project(s) {
  const yrs = clampInt(s.years, 1, 50);
  const inflR = pct(s.inflation);
  const gr = {
    stocks: pct(s.g_stocks), retire: pct(s.g_retire),
    realestate: pct(s.g_re), other: pct(s.g_other),
  };

  let bal = {
    stocks: num(s.a_stocks), retire: num(s.a_retire),
    realestate: num(s.a_re), other: num(s.a_other),
  };
  let salary = num(s.salary);
  let expenses = num(s.expenses);
  let contrib = num(s.contrib401k);
  const taxR = pct(s.taxRate);
  const matchCapR = pct(s.matchCap);
  const salG = pct(s.salaryGrowth);

  // index events by year for quick lookup
  const evByYear = {};
  (s.events || []).forEach(e => {
    const y = clampInt(e.year, 0, yrs);
    (evByYear[y] = evByYear[y] || []).push(e);
  });

  const rows = [];
  let firstNegSavingsYear = null;
  let firstMillionYear = null;

  for (let t = 0; t <= yrs; t++) {
    // --- cash flow for THIS year (year 0 = today, no flow applied yet) ---
    const taxableIncome = Math.max(0, salary - contrib);
    const takeHome = taxableIncome * (1 - taxR);
    const employerMatch = Math.min(contrib, salary * matchCapR);
    const brokerageSavings = takeHome - expenses; // may be negative

    if (t > 0 && brokerageSavings < 0 && firstNegSavingsYear === null) {
      firstNegSavingsYear = t;
    }

    // record the START-of-year snapshot as year t
    const total = bal.stocks + bal.retire + bal.realestate + bal.other;
    const realFactor = Math.pow(1 + inflR, t);
    rows.push({
      year: t,
      age: s.currentAge != null ? Number(s.currentAge) + t : null,
      stocks: bal.stocks, retire: bal.retire,
      realestate: bal.realestate, other: bal.other,
      total,
      realFactor,
      salary, expenses,
      contrib, employerMatch, brokerageSavings,
    });

    if (firstMillionYear === null && total >= 1e6) firstMillionYear = t;
    if (t === yrs) break;

    // --- advance one year ---
    // 1) growth on existing balances
    bal.stocks     *= (1 + gr.stocks);
    bal.retire     *= (1 + gr.retire);
    bal.realestate *= (1 + gr.realestate);
    bal.other      *= (1 + gr.other);

    // 2) contributions added at year end
    bal.retire += contrib + employerMatch;
    if (brokerageSavings >= 0) {
      bal.stocks += brokerageSavings;
    } else {
      // shortfall drawn from brokerage, then cash/other
      let need = -brokerageSavings;
      const fromStocks = Math.min(bal.stocks, need);
      bal.stocks -= fromStocks; need -= fromStocks;
      bal.other = Math.max(0, bal.other - need);
    }

    // 3) one-time events applied at the END of year t (affect year t+1 snapshot)
    (evByYear[t + 1] || []).forEach(e => applyEvent(bal, e));

    // 4) grow salary & expenses for next year
    salary *= (1 + salG);
    expenses *= (1 + inflR);        // expenses track inflation
    contrib *= (1 + salG);          // contribution grows with pay (bounded by salary later)
    if (contrib > salary) contrib = salary;
  }

  return {
    rows,
    final: rows[rows.length - 1],
    firstNegSavingsYear,
    firstMillionYear,
    inflR,
  };
}

function applyEvent(bal, e) {
  const amt = num(e.amount);
  if (!amt) return;
  const bucket = e.bucket || 'stocks';
  const sign = e.type === 'withdraw' ? -1 : 1;
  const key = bucket === 're' ? 'realestate' : bucket;
  if (bal[key] == null) return;
  bal[key] = Math.max(0, bal[key] + sign * amt);
}

/* value of a row respecting nominal/real basis */
function basisVal(v, realFactor) {
  return state.basis === 'real' ? v / realFactor : v;
}

/* ============================================================
   NUMBER HELPERS
   ============================================================ */
function num(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }
function pct(v) { return num(v) / 100; }
function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(num(v)))); }

function fmtMoney(v) {
  const neg = v < 0; v = Math.abs(v);
  let out;
  if (v >= 1e9) out = '$' + (v / 1e9).toFixed(2) + 'B';
  else if (v >= 1e6) out = '$' + (v / 1e6).toFixed(2) + 'M';
  else if (v >= 1e3) out = '$' + (v / 1e3).toFixed(1) + 'K';
  else out = '$' + Math.round(v).toLocaleString();
  return (neg ? '−' : '') + out;
}
function fmtFull(v) {
  const neg = v < 0;
  return (neg ? '−' : '') + '$' + Math.round(Math.abs(v)).toLocaleString();
}
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* ============================================================
   BIND / READ INPUTS
   ============================================================ */
function scn() { return state[state.active]; }

function loadFormFromState() {
  const s = scn();
  FIELD_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const key = mapId(id);
    el.value = s[key] == null ? '' : s[key];
  });
  document.getElementById('years-out').textContent = s.years;
  renderEvents();
  // toolbar state
  document.querySelectorAll('.stab').forEach(b =>
    b.classList.toggle('active', b.dataset.scn === state.active));
  const hint = document.getElementById('scenario-hint');
  hint.innerHTML = `Editing <strong>Scenario ${state.active}</strong>. ` +
    (state.active === 'A'
      ? 'Duplicate it to B, then change one thing (a raise, a new 401k, a home purchase) to see the impact.'
      : 'This is your "what if" line. Tweak an input and watch the gap against A.');
  document.getElementById('compo-scn').textContent = 'Scenario ' + state.active;
}

// maps DOM id -> state key (they mostly match)
function mapId(id) {
  const m = { 'a_re': 'a_re' }; // identity; kept for clarity/extension
  return m[id] || id;
}

function readFormIntoState() {
  const s = scn();
  FIELD_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const key = mapId(id);
    if (id === 'currentAge') {
      s[key] = el.value === '' ? null : num(el.value);
    } else {
      s[key] = el.value === '' ? 0 : num(el.value);
    }
  });
  s.years = clampInt(s.years, 1, 50);
}

/* ---------- events UI ---------- */
function renderEvents() {
  const wrap = document.getElementById('events-list');
  const s = scn();
  wrap.innerHTML = '';
  s.events.forEach((e, i) => {
    const row = document.createElement('div');
    row.className = 'event';
    row.innerHTML = `
      <div class="field"><label>Year</label>
        <input type="number" min="1" max="${s.years}" value="${e.year}" data-i="${i}" data-k="year"></div>
      <div class="field"><label>Type</label>
        <select data-i="${i}" data-k="type">
          <option value="add" ${e.type==='add'?'selected':''}>Add to</option>
          <option value="withdraw" ${e.type==='withdraw'?'selected':''}>Take from</option>
        </select></div>
      <div class="field"><label>Bucket</label>
        <select data-i="${i}" data-k="bucket">
          <option value="stocks" ${e.bucket==='stocks'?'selected':''}>Brokerage</option>
          <option value="retire" ${e.bucket==='retire'?'selected':''}>401k</option>
          <option value="re" ${e.bucket==='re'?'selected':''}>Real estate</option>
          <option value="other" ${e.bucket==='other'?'selected':''}>Cash/other</option>
        </select></div>
      <button class="del" title="Remove" data-del="${i}">×</button>
      <div class="field" style="grid-column: 1 / -1"><label>Amount ($)</label>
        <input type="number" min="0" step="1000" value="${e.amount}" data-i="${i}" data-k="amount"></div>
    `;
    wrap.appendChild(row);
  });
}

/* ============================================================
   RENDER — top-level
   ============================================================ */
let cache = { A: null, B: null };

function recompute() {
  readFormIntoState();
  cache.A = project(state.A);
  cache.B = project(state.B);
  renderDerived();
  renderStats();
  renderTotalChart();
  renderCompoChart();
  renderInsights();
  renderTable();
}

function renderDerived() {
  const s = scn();
  const taxable = Math.max(0, num(s.salary) - num(s.contrib401k));
  const takeHome = taxable * (1 - pct(s.taxRate));
  const save = takeHome - num(s.expenses);
  const match = Math.min(num(s.contrib401k), num(s.salary) * pct(s.matchCap));
  const cd = document.getElementById('cashflow-derived');
  cd.innerHTML = `Take-home ≈ <b>${fmtFull(takeHome)}</b> · after expenses, ` +
    `<b class="${save<0?'neg':''}">${fmtFull(save)}/yr</b> ` +
    (save < 0 ? 'shortfall (drawn from savings)' : 'flows to brokerage');
  const kd = document.getElementById('k401-derived');
  kd.innerHTML = num(s.contrib401k) > 0
    ? `Employer adds <b>${fmtFull(match)}/yr</b> · total into 401k ≈ <b>${fmtFull(num(s.contrib401k)+match)}/yr</b>`
    : `No 401k contribution set. Employer match only applies when you contribute.`;
}

function renderStats() {
  const strip = document.getElementById('stat-strip');
  const A = cache.A.final, B = cache.B.final;
  const aVal = basisVal(A.total, A.realFactor);
  const bVal = basisVal(B.total, B.realFactor);
  const yrs = state.A.years;

  const startA = basisVal(cache.A.rows[0].total, 1);
  const growthMult = startA > 0 ? aVal / startA : 0;

  const items = [];
  items.push(statTile('Scenario A · year ' + yrs, fmtMoney(aVal), 'a',
    (state.A.currentAge != null ? 'Age ' + (Number(state.A.currentAge) + yrs) + ' · ' : '') +
    state.basis + ' dollars'));

  if (state.compare) {
    const diff = bVal - aVal;
    const pctDiff = aVal !== 0 ? (diff / Math.abs(aVal) * 100) : 0;
    items.push(statTile('Scenario B · year ' + yrs, fmtMoney(bVal), 'b',
      deltaSpan(diff, pctDiff) + ' vs A'));
  } else {
    items.push(statTile('Started with', fmtMoney(startA), '',
      'grew ' + growthMult.toFixed(1) + '× over ' + yrs + ' yr'));
  }

  // millionaire year (scenario A)
  const mA = cache.A.firstMillionYear;
  items.push(statTile('$1M crossed', mA != null ? 'Year ' + mA : '—',
    '', mA != null
      ? (state.A.currentAge != null ? 'at age ' + (Number(state.A.currentAge)+mA) : 'nominal net worth')
      : 'not within horizon'));

  // total contributed vs growth (A)
  const contribTotal = sumContribs(cache.A);
  const startNom = cache.A.rows[0].total;
  const gains = A.total - startNom - contribTotal;
  items.push(statTile('Investment growth', fmtMoney(gains), '',
    'earned by compounding (nominal)'));

  strip.innerHTML = items.join('');
}

function sumContribs(res) {
  let total = 0;
  for (let i = 0; i < res.rows.length - 1; i++) {
    const r = res.rows[i];
    total += r.contrib + r.employerMatch + Math.max(0, r.brokerageSavings);
  }
  return total;
}

function statTile(lab, val, cls, sub) {
  return `<div class="stat"><div class="lab">${lab}</div>` +
    `<div class="val ${cls}">${val}</div>` +
    `<div class="sub">${sub}</div></div>`;
}
function deltaSpan(diff, pctDiff) {
  const up = diff >= 0;
  const arrow = up ? '▲' : '▼';
  return `<span class="delta ${up?'up':'down'}">${arrow} ${fmtMoney(Math.abs(diff))} ` +
    `(${up?'+':'−'}${Math.abs(pctDiff).toFixed(0)}%)</span>`;
}

/* ============================================================
   CHART: total net worth (A vs B lines)
   ============================================================ */
const CH = { padL: 58, padR: 18, padT: 14, padB: 28 };

function chartDims(svg) {
  const rect = svg.getBoundingClientRect();
  const w = rect.width || 700, h = rect.height || 300;
  return {
    w, h,
    x0: CH.padL, x1: w - CH.padR,
    y0: h - CH.padB, y1: CH.padT,
    iw: w - CH.padL - CH.padR,
    ih: h - CH.padT - CH.padB,
  };
}

function niceMax(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

function renderTotalChart() {
  const svg = document.getElementById('chart-total');
  const d = chartDims(svg);
  const A = cache.A.rows, B = cache.B.rows;
  const yrs = state.A.years;

  const seriesA = A.map(r => basisVal(r.total, r.realFactor));
  const seriesB = B.map(r => basisVal(r.total, r.realFactor));
  let maxV = Math.max(...seriesA, ...(state.compare ? seriesB : [0]));
  maxV = niceMax(maxV * 1.05);

  const X = t => d.x0 + (yrs === 0 ? 0 : (t / yrs) * d.iw);
  const Y = v => d.y0 - (v / maxV) * d.ih;

  let svgEl = '';
  // gridlines + y labels
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const v = (maxV / ticks) * i;
    const y = Y(v);
    svgEl += `<line class="grid-line" x1="${d.x0}" y1="${y}" x2="${d.x1}" y2="${y}"/>`;
    svgEl += `<text class="axis-label" x="${d.x0 - 8}" y="${y + 3}" text-anchor="end">${fmtMoney(v)}</text>`;
  }
  // x labels
  const xStep = yrs <= 10 ? 2 : yrs <= 20 ? 5 : yrs <= 40 ? 10 : 10;
  for (let t = 0; t <= yrs; t += xStep) {
    svgEl += `<text class="axis-label" x="${X(t)}" y="${d.y0 + 18}" text-anchor="middle">${t}</text>`;
  }
  svgEl += `<text class="axis-label" x="${(d.x0+d.x1)/2}" y="${d.h-2}" text-anchor="middle">years from now</text>`;
  svgEl += `<line class="axis-line" x1="${d.x0}" y1="${d.y0}" x2="${d.x1}" y2="${d.y0}"/>`;

  // area under A (wash)
  const cA = cssVar('--scn-a'), cB = cssVar('--scn-b');
  const lineA = seriesA.map((v,t) => `${X(t)},${Y(v)}`).join(' ');
  svgEl += `<polyline points="${lineA}" fill="none" stroke="${cA}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  if (state.compare) {
    const lineB = seriesB.map((v,t) => `${X(t)},${Y(v)}`).join(' ');
    svgEl += `<polyline points="${lineB}" fill="none" stroke="${cB}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    // end dots
    svgEl += endDot(X(yrs), Y(seriesB[yrs]), cB);
  }
  svgEl += endDot(X(yrs), Y(seriesA[yrs]), cA);

  // crosshair placeholder
  svgEl += `<line class="crosshair" id="xh-total" x1="0" y1="${d.y1}" x2="0" y2="${d.y0}" style="opacity:0"/>`;

  svg.innerHTML = svgEl;

  // legend
  const lg = document.getElementById('legend-total');
  lg.innerHTML =
    `<span class="lg"><span class="key" style="background:${cA}"></span>Scenario A</span>` +
    (state.compare ? `<span class="lg"><span class="key" style="background:${cB}"></span>Scenario B</span>` : '');

  const sub = document.getElementById('chart-sub');
  sub.textContent = state.compare
    ? 'Two paths compared. The gap at the right edge is the price (or payoff) of the decision.'
    : 'Your projected total net worth, ' + state.basis + ' dollars.';

  // hover
  attachHover(svg, 'tt-total', 'xh-total', d, X, yrs, (t) => {
    const rA = cache.A.rows[t], rB = cache.B.rows[t];
    const rows = [{ k:'Scenario A', c:cA, v: fmtFull(basisVal(rA.total, rA.realFactor)) }];
    if (state.compare) rows.push({ k:'Scenario B', c:cB, v: fmtFull(basisVal(rB.total, rB.realFactor)) });
    if (state.compare) {
      const diff = basisVal(rB.total,rB.realFactor) - basisVal(rA.total,rA.realFactor);
      rows.push({ total:true, k:'Difference', v: (diff>=0?'+':'−')+fmtFull(Math.abs(diff)) });
    }
    const title = 'Year ' + t + (rA.age!=null ? ' · age '+rA.age : '');
    return ttHTML(title, rows);
  });
}

function endDot(x, y, c) {
  return `<circle cx="${x}" cy="${y}" r="4.5" fill="${c}" stroke="var(--surface-1)" stroke-width="2"/>`;
}

/* ============================================================
   CHART: composition (stacked area, active scenario)
   ============================================================ */
function renderCompoChart() {
  const svg = document.getElementById('chart-compo');
  const d = chartDims(svg);
  const res = cache[state.active];
  const rows = res.rows;
  const yrs = state[state.active].years;

  // stacked totals per year (respect basis)
  const stacks = rows.map(r => {
    const f = r.realFactor;
    return {
      retire: basisVal(r.retire, f),
      stocks: basisVal(r.stocks, f),
      realestate: basisVal(r.realestate, f),
      other: basisVal(r.other, f),
    };
  });
  let maxV = Math.max(...stacks.map(s => s.retire+s.stocks+s.realestate+s.other));
  maxV = niceMax(maxV * 1.05);

  const X = t => d.x0 + (yrs===0?0:(t/yrs)*d.iw);
  const Y = v => d.y0 - (v/maxV)*d.ih;

  let svgEl = '';
  const ticks = 5;
  for (let i=0;i<=ticks;i++){
    const v=(maxV/ticks)*i, y=Y(v);
    svgEl += `<line class="grid-line" x1="${d.x0}" y1="${y}" x2="${d.x1}" y2="${y}"/>`;
    svgEl += `<text class="axis-label" x="${d.x0-8}" y="${y+3}" text-anchor="end">${fmtMoney(v)}</text>`;
  }
  const xStep = yrs<=10?2:yrs<=20?5:10;
  for (let t=0;t<=yrs;t+=xStep){
    svgEl += `<text class="axis-label" x="${X(t)}" y="${d.y0+18}" text-anchor="middle">${t}</text>`;
  }
  svgEl += `<line class="axis-line" x1="${d.x0}" y1="${d.y0}" x2="${d.x1}" y2="${d.y0}"/>`;

  // build stacked areas bottom->top in ASSETS order
  let base = new Array(rows.length).fill(0);
  ASSETS.forEach(a => {
    const c = cssVar(a.varc);
    const top = stacks.map((s,i) => base[i] + s[a.key]);
    // polygon: forward along top, back along base
    let pts = [];
    for (let t=0;t<top.length;t++) pts.push(`${X(t)},${Y(top[t])}`);
    for (let t=top.length-1;t>=0;t--) pts.push(`${X(t)},${Y(base[t])}`);
    svgEl += `<polygon points="${pts.join(' ')}" fill="${c}" fill-opacity="0.85" stroke="var(--surface-1)" stroke-width="0.75"/>`;
    base = top;
  });

  svgEl += `<line class="crosshair" id="xh-compo" x1="0" y1="${d.y1}" x2="0" y2="${d.y0}" style="opacity:0"/>`;
  svg.innerHTML = svgEl;

  // legend
  const lg = document.getElementById('legend-compo');
  lg.innerHTML = ASSETS.map(a =>
    `<span class="lg"><span class="key sq" style="background:${cssVar(a.varc)}"></span>${a.label}</span>`
  ).join('');

  attachHover(svg, 'tt-compo', 'xh-compo', d, X, yrs, (t) => {
    const s = stacks[t];
    const total = s.retire+s.stocks+s.realestate+s.other;
    const rows2 = ASSETS.map(a => ({ k:a.label, c:cssVar(a.varc), v:fmtFull(s[a.key]) }));
    rows2.push({ total:true, k:'Total', v:fmtFull(total) });
    return ttHTML('Year ' + t, rows2);
  });
}

/* ============================================================
   Shared hover / tooltip
   ============================================================ */
function ttHTML(title, rows) {
  let h = `<div class="tt-title">${title}</div>`;
  rows.forEach(r => {
    if (r.total) {
      h += `<div class="tt-row tt-total"><span>${r.k}</span><span class="v">${r.v}</span></div>`;
    } else {
      h += `<div class="tt-row"><span class="k"><span class="tt-key" style="background:${r.c}"></span>${r.k}</span><span class="v">${r.v}</span></div>`;
    }
  });
  return h;
}

function attachHover(svg, ttId, xhId, d, X, yrs, builder) {
  const tt = document.getElementById(ttId);
  const xh = document.getElementById(xhId);
  const wrap = svg.parentElement;

  function move(ev) {
    const rect = svg.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    let t = Math.round(((px - d.x0) / d.iw) * yrs);
    t = Math.max(0, Math.min(yrs, t));
    const xpix = X(t);
    xh.setAttribute('x1', xpix); xh.setAttribute('x2', xpix);
    xh.style.opacity = '1';
    tt.hidden = false;
    tt.innerHTML = builder(t);
    // position tooltip within wrap
    const left = (xpix / rect.width) * wrap.clientWidth;
    tt.style.left = Math.max(80, Math.min(wrap.clientWidth - 80, left)) + 'px';
    tt.style.top = Math.max(20, ev.clientY - rect.top - 12) + 'px';
  }
  function leave() { tt.hidden = true; xh.style.opacity = '0'; }
  svg.addEventListener('mousemove', move);
  svg.addEventListener('mouseleave', leave);
}

/* ============================================================
   INSIGHTS
   ============================================================ */
function renderInsights() {
  const box = document.getElementById('insights');
  const out = [];
  const A = cache.A, B = cache.B;
  const yrs = state.A.years;
  const fa = A.final, fb = B.final;
  const aVal = basisVal(fa.total, fa.realFactor);
  const bVal = basisVal(fb.total, fb.realFactor);

  // compare headline
  if (state.compare) {
    const diff = bVal - aVal;
    if (Math.abs(diff) < aVal * 0.005) {
      out.push(ins('good','≈','Scenarios A and B land within a rounding error of each other — the change you modeled barely moves the needle over ' + yrs + ' years.'));
    } else if (diff > 0) {
      out.push(ins('good','↑',`Scenario B ends <b>${fmtMoney(Math.abs(diff))} ahead</b> of A — about <b>${(diff/aVal*100).toFixed(0)}%</b> more net worth in year ${yrs}.`));
    } else {
      out.push(ins('warn','↓',`Scenario B ends <b>${fmtMoney(Math.abs(diff))} behind</b> A. If B is the "spend more / save less" path, that gap is its lifetime cost.`));
    }
  }

  // inflation reality check
  const nominalFinal = fa.total;
  const realFinal = fa.total / fa.realFactor;
  const erosion = nominalFinal - realFinal;
  out.push(ins('warn','⏳',`Inflation erodes a lot: A's <b>${fmtMoney(nominalFinal)}</b> nominal is worth <b>${fmtMoney(realFinal)}</b> in today's dollars — flip the toggle up top to plan in real terms.`));

  // savings shortfall
  if (A.firstNegSavingsYear != null) {
    out.push(ins('warn','⚠',`In Scenario A your spending outpaces take-home pay starting <b>year ${A.firstNegSavingsYear}</b>; the model covers it by drawing down brokerage, then cash. Watch that your savings don't run dry.`));
  }

  // 401k nudge
  const s = state[state.active];
  if (num(s.contrib401k) === 0 && num(s.matchCap) > 0) {
    const freeMatch = num(s.salary) * pct(s.matchCap);
    out.push(ins('warn','🎁',`Scenario ${state.active} contributes $0 to the 401k, leaving up to <b>${fmtFull(freeMatch)}/yr</b> of employer match on the table. Try setting a contribution and compare.`));
  }

  // contribution-limit awareness (2026 employee elective ~ $24,500)
  const LIMIT = 24500;
  if (num(s.contrib401k) > LIMIT) {
    out.push(ins('warn','📋',`Your 401k contribution (${fmtFull(num(s.contrib401k))}) exceeds the 2026 employee limit of about ${fmtFull(LIMIT)}. Real plans cap this — treat amounts above it as illustrative.`));
  }

  // composition drift
  const start = A.rows[0], end = A.final;
  const startRE = start.realestate / (start.total||1);
  const endRE = end.realestate / (end.total||1);
  if (startRE > 0.4 && endRE < startRE - 0.1) {
    out.push(ins('good','⚖',`Your mix diversifies over time: real estate falls from <b>${(startRE*100).toFixed(0)}%</b> to <b>${(endRE*100).toFixed(0)}%</b> of net worth as investments compound.`));
  }

  box.innerHTML = out.join('');
}
function ins(cls, ico, html) {
  return `<div class="insight ${cls}"><span class="ico">${ico}</span><span>${html}</span></div>`;
}

/* ============================================================
   TABLE
   ============================================================ */
function renderTable() {
  const wrap = document.getElementById('table-wrap');
  if (wrap.hidden) return;
  const res = cache[state.active];
  const s = state[state.active];
  let h = '<table><thead><tr><th>Year' + (s.currentAge!=null?' / age':'') + '</th>' +
    '<th>401k</th><th>Brokerage</th><th>Real estate</th><th>Cash/other</th>' +
    '<th>Total</th><th>Saved that yr</th></tr></thead><tbody>';
  res.rows.forEach(r => {
    const f = r.realFactor;
    const yl = r.year + (r.age!=null ? ' / ' + r.age : '');
    h += `<tr><td>${yl}</td>` +
      `<td>${fmtFull(basisVal(r.retire,f))}</td>` +
      `<td>${fmtFull(basisVal(r.stocks,f))}</td>` +
      `<td>${fmtFull(basisVal(r.realestate,f))}</td>` +
      `<td>${fmtFull(basisVal(r.other,f))}</td>` +
      `<td><b>${fmtFull(basisVal(r.total,f))}</b></td>` +
      `<td>${fmtFull(r.contrib + r.employerMatch + Math.max(0,r.brokerageSavings))}</td></tr>`;
  });
  h += '</tbody></table>';
  wrap.innerHTML = h;
}

/* ============================================================
   EVENTS / WIRING
   ============================================================ */
function wire() {
  // input changes (debounced-ish via input event)
  document.getElementById('inputs').addEventListener('input', (e) => {
    if (e.target.id === 'years') {
      document.getElementById('years-out').textContent = e.target.value;
    }
    // event rows
    if (e.target.dataset && e.target.dataset.k) {
      const i = +e.target.dataset.i, k = e.target.dataset.k;
      scn().events[i][k] = k==='year' ? clampInt(e.target.value,1,scn().years) :
        (k==='amount' ? num(e.target.value) : e.target.value);
    }
    recompute();
  });

  // event delete
  document.getElementById('events-list').addEventListener('click', (e) => {
    if (e.target.dataset && e.target.dataset.del != null) {
      scn().events.splice(+e.target.dataset.del, 1);
      renderEvents(); recompute();
    }
  });
  document.getElementById('add-event').addEventListener('click', () => {
    scn().events.push({ year: Math.min(5, scn().years), type:'add', bucket:'stocks', amount: 10000 });
    renderEvents(); recompute();
  });

  // scenario tabs
  document.querySelectorAll('.stab').forEach(b => b.addEventListener('click', () => {
    readFormIntoState();
    state.active = b.dataset.scn;
    loadFormFromState();
    recompute();
  }));

  // compare toggle
  document.getElementById('compare-on').addEventListener('change', (e) => {
    state.compare = e.target.checked; recompute();
  });

  // copy scenarios
  document.getElementById('copy-a-b').addEventListener('click', () => {
    readFormIntoState();
    state.B = JSON.parse(JSON.stringify(state.A));
    if (state.active === 'B') loadFormFromState();
    recompute();
    flash('Copied A → B');
  });
  document.getElementById('copy-b-a').addEventListener('click', () => {
    readFormIntoState();
    state.A = JSON.parse(JSON.stringify(state.B));
    if (state.active === 'A') loadFormFromState();
    recompute();
    flash('Copied B → A');
  });

  // basis toggle
  document.getElementById('btn-nominal').addEventListener('click', () => setBasis('nominal'));
  document.getElementById('btn-real').addEventListener('click', () => setBasis('real'));

  // theme
  document.getElementById('btn-theme').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
    recompute(); // recolor
  });

  // reset
  document.getElementById('btn-reset').addEventListener('click', () => {
    if (!confirm('Reset both scenarios to defaults?')) return;
    state.A = defaultScenario(); state.B = defaultScenario();
    state.active = 'A';
    loadFormFromState(); recompute();
  });

  // table toggle
  document.getElementById('toggle-table').addEventListener('click', (e) => {
    const w = document.getElementById('table-wrap');
    w.hidden = !w.hidden;
    e.target.textContent = w.hidden ? 'Show table' : 'Hide table';
    renderTable();
  });

  // redraw on resize
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(recompute, 120); });
}

function setBasis(b) {
  state.basis = b;
  document.getElementById('btn-nominal').classList.toggle('active', b==='nominal');
  document.getElementById('btn-real').classList.toggle('active', b==='real');
  recompute();
}

function flash(msg) {
  let el = document.getElementById('flash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'flash';
    el.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);' +
      'background:var(--ink);color:var(--surface-1);padding:8px 16px;border-radius:20px;' +
      'font-size:13px;z-index:99;box-shadow:var(--shadow);transition:opacity .3s';
    document.body.appendChild(el);
  }
  el.textContent = msg; el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 1400);
}

/* ---------- boot ---------- */
// seed scenario B with a contrasting default so compare is meaningful out of the box
state.B = defaultScenario();
state.B.contrib401k = 15000;   // B = "max the 401k" decision
loadFormFromState();
wire();
recompute();
