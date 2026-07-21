/* ============================================================
   Trajectory — net worth projection simulator
   No dependencies. Pure client-side.
   ============================================================ */

const ASSETS = [
  { key: 'retire',     label: '401k / retirement', varc: '--c-retire' },
  { key: 'roth',       label: 'Roth IRA',           varc: '--c-roth' },
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
    salary: 110000, salaryGrowth: 3, expenses: 60000,
    // taxes (computed)
    filingStatus: 'single', dependents: 0, stateWork: 'CA', stateRetire: 'CA',
    // 401k + Roth IRA
    contrib401k: 0, matchCap: 4, rothIRA: 0,
    // side income
    side_amount: 0, side_start: 1, side_growth: 5,
    // retirement / stop working
    stopWork: false, retireMode: 'year', stopYear: 25, retireTarget: 2000000, retireSpendPct: 80,
    rothLadder: true, ssMonthly: 0, ssStartAge: 67,
    // economy
    inflation: 3,
    // one-time events & setbacks
    events: [],
    setbacks: [],
  };
}

const FIELD_IDS = [
  'years','currentAge','a_stocks','a_retire','a_re','a_other',
  'g_stocks','g_retire','g_re','g_other',
  'salary','salaryGrowth','expenses','dependents','contrib401k','matchCap','rothIRA',
  'side_amount','side_start','side_growth','stopYear','retireTarget','retireSpendPct',
  'ssMonthly','ssStartAge','inflation',
];
const SELECT_IDS = ['filingStatus','stateWork','stateRetire'];

// merge a (possibly older) saved scenario onto current defaults
function migrateScenario(sc) {
  const d = defaultScenario();
  const out = Object.assign(d, sc || {});
  out.events = Array.isArray(out.events) ? out.events : [];
  out.setbacks = Array.isArray(out.setbacks) ? out.setbacks : [];
  return out;
}

const state = {
  active: 'A',
  compare: true,
  basis: 'nominal',           // 'nominal' | 'real'
  A: defaultScenario(),
  B: defaultScenario(),
};

/* ============================================================
   TAX ENGINE (approximate — 2025 tables, bracket thresholds
   indexed to the scenario's inflation so brackets don't "creep")
   ============================================================ */
// [upperBound, rate] pairs; Infinity-terminated
const FED = {
  single: { std: 15000, br: [[11925,.10],[48475,.12],[103350,.22],[197300,.24],[250525,.32],[626350,.35],[Infinity,.37]],
            ltcg: [[48350,0],[533400,.15],[Infinity,.20]], niit: 200000, addlMed: 200000, ctcPhase: 200000 },
  mfj:    { std: 30000, br: [[23850,.10],[96950,.12],[206700,.22],[394600,.24],[501050,.32],[751600,.35],[Infinity,.37]],
            ltcg: [[96700,0],[600050,.15],[Infinity,.20]], niit: 250000, addlMed: 250000, ctcPhase: 400000 },
};
const SS_WAGE_BASE = 176100;
const CTC_PER_KID = 2000;

// Flat *effective* state income-tax approximations (real states have brackets,
// deductions, credits — this is a planning estimate, labeled as such in the UI).
// cg = long-term capital-gains rate where it differs from the income rate.
const STATES = {
  AK:{n:'Alaska',r:0}, AL:{n:'Alabama',r:5}, AR:{n:'Arkansas',r:3.9}, AZ:{n:'Arizona',r:2.5},
  CA:{n:'California',r:8}, CO:{n:'Colorado',r:4.4}, CT:{n:'Connecticut',r:5.5}, DC:{n:'D.C.',r:7},
  DE:{n:'Delaware',r:5.5}, FL:{n:'Florida',r:0}, GA:{n:'Georgia',r:5.2}, HI:{n:'Hawaii',r:7.9},
  IA:{n:'Iowa',r:3.8}, ID:{n:'Idaho',r:5.3}, IL:{n:'Illinois',r:4.95}, IN:{n:'Indiana',r:3},
  KS:{n:'Kansas',r:5.2}, KY:{n:'Kentucky',r:4}, LA:{n:'Louisiana',r:3}, MA:{n:'Massachusetts',r:5},
  MD:{n:'Maryland',r:4.75}, ME:{n:'Maine',r:6.8}, MI:{n:'Michigan',r:4.25}, MN:{n:'Minnesota',r:7.5},
  MO:{n:'Missouri',r:4.7}, MS:{n:'Mississippi',r:4.4}, MT:{n:'Montana',r:5.9}, NC:{n:'North Carolina',r:4.25},
  ND:{n:'North Dakota',r:2.5}, NE:{n:'Nebraska',r:5.2}, NH:{n:'New Hampshire',r:0}, NJ:{n:'New Jersey',r:6},
  NM:{n:'New Mexico',r:4.9}, NV:{n:'Nevada',r:0}, NY:{n:'New York',r:6}, OH:{n:'Ohio',r:3.1},
  OK:{n:'Oklahoma',r:4.75}, OR:{n:'Oregon',r:8.75}, PA:{n:'Pennsylvania',r:3.07}, RI:{n:'Rhode Island',r:5.5},
  SC:{n:'South Carolina',r:6.2,cg:3.4}, SD:{n:'South Dakota',r:0}, TN:{n:'Tennessee',r:0}, TX:{n:'Texas',r:0},
  UT:{n:'Utah',r:4.55}, VA:{n:'Virginia',r:5.75}, VT:{n:'Vermont',r:6.6}, WA:{n:'Washington',r:0,cg:7},
  WI:{n:'Wisconsin',r:5.3}, WV:{n:'West Virginia',r:4.8}, WY:{n:'Wyoming',r:0},
};
function stateIncomeRate(code) { const s = STATES[code]; return s ? s.r / 100 : 0; }
function stateCGRate(code) { const s = STATES[code]; return s ? (s.cg != null ? s.cg : s.r) / 100 : 0; }

// progressive tax over [upper, rate] brackets, thresholds scaled by `scale`
function bracketTax(taxable, brackets, scale) {
  let tax = 0, prev = 0;
  for (const [up, rate] of brackets) {
    const cap = up * scale;
    if (taxable <= prev) break;
    tax += (Math.min(taxable, cap) - prev) * rate;
    prev = cap;
  }
  return tax;
}
// marginal fed LTCG rate for gains stacked on top of ordinary taxable income
function fedLTCGTax(gain, ordTaxable, status, scale) {
  const f = FED[status];
  let tax = 0, prev = 0;
  const lo = Math.max(0, ordTaxable), hi = lo + Math.max(0, gain);
  for (const [up, rate] of f.ltcg) {
    const cap = up * scale;
    const a = Math.max(lo, prev), b = Math.min(hi, cap);
    if (b > a) tax += (b - a) * rate;
    prev = cap;
    if (cap >= hi) break;
  }
  return tax;
}

// Full working-year tax: returns { tax, takeHome, effRate }
function workingYearTax(wages, otherOrdIncome, pretax401k, s, scale) {
  const status = s.filingStatus === 'mfj' ? 'mfj' : 'single';
  const f = FED[status];
  const gross = wages + otherOrdIncome;
  const agi = Math.max(0, gross - pretax401k);
  const taxable = Math.max(0, agi - f.std * scale);
  let fed = bracketTax(taxable, f.br, scale);
  // child tax credit w/ simple phaseout (5% above threshold)
  const kids = clampInt(s.dependents || 0, 0, 10);
  if (kids > 0) {
    let ctc = kids * CTC_PER_KID;
    const over = Math.max(0, agi - f.ctcPhase * scale);
    ctc = Math.max(0, ctc - Math.ceil(over / 1000) * 50);
    fed = Math.max(0, fed - ctc);
  }
  // FICA on wages only
  const ss = Math.min(wages, SS_WAGE_BASE * scale) * 0.062;
  const medicare = wages * 0.0145 + Math.max(0, wages - f.addlMed * scale) * 0.009;
  // state (flat effective approximation on AGI less a nominal exemption)
  const st = Math.max(0, agi - 5000 * scale) * stateIncomeRate(s.stateWork);
  const tax = fed + ss + medicare + st;
  return { tax, takeHome: gross - pretax401k - tax, effRate: gross > 0 ? tax / gross : 0 };
}

// Tax on ordinary income in retirement (401k withdrawals, Roth conversions)
function retirementOrdTax(amount, alreadyOrd, s, scale) {
  const status = s.filingStatus === 'mfj' ? 'mfj' : 'single';
  const f = FED[status];
  const stdLeft = f.std * scale;
  const t0 = Math.max(0, alreadyOrd - stdLeft);
  const t1 = Math.max(0, alreadyOrd + amount - stdLeft);
  const fed = bracketTax(t1, f.br, scale) - bracketTax(t0, f.br, scale);
  const st = amount * stateIncomeRate(s.stateRetire);
  return fed + st;
}

/* ============================================================
   PROJECTION ENGINE
   ============================================================ */
// Resolve the year earning stops. In "target" mode we find the earliest year
// the (always-working) accumulation trajectory reaches the target net worth.
// Returns a finite year, or null if the target isn't reached within the horizon.
function resolveStopYear(s) {
  if (!s.stopWork) return Infinity;
  if ((s.retireMode || 'year') === 'target') {
    const target = num(s.retireTarget);
    if (target <= 0) return Infinity;
    const accum = project(s, { overrideStopYear: Infinity }); // never-stop trajectory
    const rows = accum.rows;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].total >= target) {
        if (i === 0) return 0;
        // interpolate within [i-1, i] then round to the nearest quarter-year
        const prev = rows[i - 1].total, cur = rows[i].total;
        const f = cur > prev ? (target - prev) / (cur - prev) : 0;
        return Math.round(((i - 1) + Math.max(0, Math.min(1, f))) * 4) / 4;
      }
    }
    return null; // not reached in horizon
  }
  return clampNum(s.stopYear, 0, s.years);
}

const DEFAULT_BASIS_FRAC = 0.6;   // assume 40% of today's brokerage value is unrealized gain
const AGE_ASSUMED = 35;            // used for 401k/SS rules when age isn't provided

function project(s, opts = {}) {
  const yrs = clampInt(s.years, 1, 50);
  const inflR = pct(s.inflation);
  const gr = {
    stocks: pct(s.g_stocks), retire: pct(s.g_retire),
    realestate: pct(s.g_re), other: pct(s.g_other),
  };
  const age0 = s.currentAge != null ? Number(s.currentAge) : AGE_ASSUMED;
  const assumedAge = s.currentAge == null;

  // brokerage as tax lots, newest LAST (sold newest-first from the end)
  let lots = num(s.a_stocks) > 0
    ? [{ basis: num(s.a_stocks) * DEFAULT_BASIS_FRAC, value: num(s.a_stocks) }] : [];
  const lotsTotal = () => lots.reduce((a, l) => a + l.value, 0);

  let bal = { retire: num(s.a_retire), roth: 0, realestate: num(s.a_re), other: num(s.a_other) };
  let rothConversions = [];        // {year, principal} — principal accessible after 5 yrs
  let rothContribBasis = 0;        // direct Roth IRA contributions — accessible anytime
  let rothPrincipalUsed = 0;

  let salary = num(s.salary);
  let expenses = num(s.expenses);
  let contrib = num(s.contrib401k);
  let rothIRAC = num(s.rothIRA);   // annual Roth IRA contribution (limit is inflation-indexed)
  let side = num(s.side_amount);
  const matchCapR = pct(s.matchCap);
  const salG = pct(s.salaryGrowth);
  const sideG = pct(s.side_growth);
  const sideStart = clampInt(s.side_start, 0, yrs);
  const status = s.filingStatus === 'mfj' ? 'mfj' : 'single';
  const ssAnnual0 = num(s.ssMonthly) * 12;
  const ssStartAge = clampNum(s.ssStartAge || 67, 50, 75);

  // Determine the stop-working year (may be overridden by resolveStopYear to
  // avoid recursion when computing the target-mode accumulation trajectory).
  const targetMode = !!s.stopWork && (s.retireMode || 'year') === 'target';
  const rawStop = opts.overrideStopYear !== undefined ? opts.overrideStopYear : resolveStopYear(s);
  const targetReached = !(targetMode && rawStop === null);
  const stopYear = (rawStop === null || rawStop === undefined) ? Infinity : rawStop;
  const stopWorkActive = !!s.stopWork && isFinite(stopYear) && stopYear <= yrs;
  const retireSpend = pct(s.retireSpendPct);   // fraction of pre-retirement expenses
  const useLadder = s.rothLadder !== false;

  // setbacks: fraction of each year lost to a job gap + salary haircut at gap end
  const setbacks = (s.setbacks || []).map(sb => ({
    year: clampNum(sb.year, 0, yrs),
    dur: clampNum(sb.dur, 0.25, 10),
    recovery: clampNum(sb.recovery == null ? 100 : sb.recovery, 0, 200),
  })).sort((a, b) => a.year - b.year);
  const lossFrac = (t) => {
    let lost = 0;
    for (const sb of setbacks) {
      lost += Math.max(0, Math.min(t + 1, sb.year + sb.dur) - Math.max(t, sb.year));
    }
    return Math.min(1, lost);
  };

  // index events by year for quick lookup
  const evByYear = {};
  (s.events || []).forEach(e => {
    const y = clampInt(e.year, 0, yrs);
    (evByYear[y] = evByYear[y] || []).push(e);
  });

  const rows = [];
  let firstNegSavingsYear = null;
  let firstMillionYear = null;
  let depletionYear = null;        // year liquid assets can't cover spending
  let lifetimeTax = 0, ladderConverted = 0, penaltyPaid = 0, cgTaxPaid = 0;

  // --- tax-aware withdrawal for one year's shortfall; returns unmet need ---
  function withdraw(need, ordIncomeYr, t, scale) {
    const age = age0 + t;
    let ordSoFar = ordIncomeYr;
    // 1) sell brokerage lots, newest first, paying LTCG tax (fed stacked + state)
    while (need > 1e-6 && lots.length) {
      const lot = lots[lots.length - 1];
      const gainFrac = lot.value > 0 ? Math.max(0, 1 - lot.basis / lot.value) : 0;
      const f = FED[status];
      const stdLeft = Math.max(0, f.std * scale - ordSoFar);
      const ordTaxable = Math.max(0, ordSoFar - f.std * scale);
      // marginal fed LTCG rate for this lot's gains stacked on ordinary income
      const probe = Math.max(1, lot.value * gainFrac);
      let fedRate = fedLTCGTax(probe, ordTaxable, status, scale) / probe;
      // NIIT 3.8% once MAGI exceeds the threshold (approximate, on the gain)
      if (ordSoFar + probe > f.niit * scale) fedRate += 0.038;
      const rate = Math.min(0.55, fedRate + stateCGRate(s.stateRetire));
      const netFrac = 1 - gainFrac * rate;      // net cash per gross $ sold
      const grossNeeded = need / Math.max(0.45, netFrac);
      const sell = Math.min(lot.value, grossNeeded);
      const gain = sell * gainFrac;
      const tax = gain * rate;
      cgTaxPaid += tax; lifetimeTax += tax;
      need -= (sell - tax);
      lot.basis *= (1 - sell / lot.value);
      lot.value -= sell;
      if (lot.value <= 1) lots.pop();
      void stdLeft;
    }
    if (need <= 1e-6) return 0;
    // 2) cash & other — no tax
    const fromOther = Math.min(bal.other, need);
    bal.other -= fromOther; need -= fromOther;
    if (need <= 1e-6) return 0;
    // 3) Roth: direct contributions anytime + seasoned conversion principal
    //    before 59½; the whole balance after
    let rothAccess;
    if (age >= 59.5) rothAccess = bal.roth;
    else rothAccess = Math.max(0, rothContribBasis + rothConversions
      .filter(c => t - c.year >= 5).reduce((a, c) => a + c.principal, 0) - rothPrincipalUsed);
    const fromRoth = Math.min(bal.roth, rothAccess, need);
    bal.roth -= fromRoth; need -= fromRoth;
    if (age < 59.5) rothPrincipalUsed += fromRoth;
    if (need <= 1e-6) return 0;
    // 4) 401k — ordinary income tax (+10% penalty before 59½)
    while (need > 1e-6 && bal.retire > 1) {
      const chunk = Math.min(bal.retire, need * 1.6);   // gross estimate incl. tax
      const tax = retirementOrdTax(chunk, ordSoFar, s, scale);
      const pen = age < 59.5 ? chunk * 0.10 : 0;
      const net = chunk - tax - pen;
      if (net <= 0) break;
      bal.retire -= chunk;
      ordSoFar += chunk;
      lifetimeTax += tax + pen; penaltyPaid += pen;
      need -= net;
    }
    return Math.max(0, need);
  }

  for (let t = 0; t <= yrs; t++) {
    const scale = Math.pow(1 + inflR, t);     // brackets & deductions indexed to inflation
    const age = age0 + t;
    // fraction of the year worked: retirement cut × job-loss gaps
    const retireFrac = Math.max(0, Math.min(1, stopYear - t));
    const earnFrac = retireFrac * (1 - lossFrac(t));
    const sideOn = side > 0 && t >= sideStart && earnFrac > 0;

    // --- cash flow for year t ---
    const salThis  = salary * earnFrac;
    const sideThis = sideOn ? side * earnFrac : 0;
    const contribThis = contrib * earnFrac;
    const employerMatch = Math.min(contribThis, salThis * matchCapR);
    const wtax = workingYearTax(salThis, sideThis, contribThis, s, scale);
    // Social Security (inflation-adjusted) once the start age is reached
    const ssThis = (ssAnnual0 > 0 && age >= ssStartAge) ? ssAnnual0 * scale : 0;
    // expenses: working level while working/job-hunting; retirement level after
    const expThis = expenses * retireFrac + expenses * retireSpend * (1 - retireFrac);
    // Roth IRA contribution (post-tax, needs earned income) funded from take-home
    const rothCThis = earnFrac > 0 ? rothIRAC * earnFrac : 0;
    const cashIn = wtax.takeHome + ssThis;
    const brokerageSavings = cashIn - expThis - rothCThis;   // negative => draw down
    let taxesThis = wtax.tax;

    if (t > 0 && retireFrac >= 1 && lossFrac(t) === 0 && brokerageSavings < 0 && firstNegSavingsYear === null) {
      firstNegSavingsYear = t;
    }

    // record the START-of-year snapshot as year t
    const stocksNow = lotsTotal();
    const total = stocksNow + bal.retire + bal.roth + bal.realestate + bal.other;
    rows.push({
      year: t,
      age: s.currentAge != null ? age : null,
      stocks: stocksNow, retire: bal.retire, roth: bal.roth,
      realestate: bal.realestate, other: bal.other,
      total,
      realFactor: scale,
      salary: salThis, sideIncome: sideThis, ss: ssThis, expenses: expThis,
      contrib: contribThis, employerMatch, rothContrib: rothCThis, brokerageSavings,
      working: earnFrac > 0, taxes: taxesThis, effRate: wtax.effRate,
    });

    if (firstMillionYear === null && total >= 1e6) firstMillionYear = t;
    if (t === yrs) break;

    // --- advance one year ---
    // 1) growth
    lots.forEach(l => { l.value *= (1 + gr.stocks); });
    bal.retire     *= (1 + gr.retire);
    bal.roth       *= (1 + gr.retire);
    bal.realestate *= (1 + gr.realestate);
    bal.other      *= (1 + gr.other);

    // 2) contributions / drawdown
    bal.retire += contribThis + employerMatch;
    if (rothCThis > 0) { bal.roth += rothCThis; rothContribBasis += rothCThis; }
    if (brokerageSavings >= 0) {
      if (brokerageSavings > 0) lots.push({ basis: brokerageSavings, value: brokerageSavings });
    } else {
      const unmet = withdraw(-brokerageSavings, Math.max(0, salThis + sideThis - contribThis), t, scale);
      if (unmet > 1 && depletionYear === null) depletionYear = t + 1;
    }

    // 3) Roth conversion ladder: in retirement before 59½, convert 401k → Roth
    //    up to the top of the 12% bracket (tax paid out of the converted amount)
    if (useLadder && retireFrac < 1 && age < 59.5 && bal.retire > 1) {
      const f = FED[status];
      const ordYr = Math.max(0, salThis + sideThis - contribThis);
      const headroom = (f.std + f.br[1][0]) * scale - ordYr;
      if (headroom > 0) {
        const conv = Math.min(bal.retire, headroom);
        const ctax = retirementOrdTax(conv, ordYr, s, scale);
        bal.retire -= conv;
        bal.roth += conv - ctax;
        rothConversions.push({ year: t + 1, principal: conv - ctax });
        ladderConverted += conv;
        lifetimeTax += ctax;
      }
    }

    // 4) one-time events at END of year t
    (evByYear[t + 1] || []).forEach(e => applyEvent(bal, lots, e));

    // 5) salary haircut when a job-loss gap ends within (t, t+1]
    for (const sb of setbacks) {
      const end = sb.year + sb.dur;
      if (end > t && end <= t + 1) salary *= sb.recovery / 100;
    }

    // 6) grow the drivers
    salary *= (1 + salG);
    expenses *= (1 + inflR);
    side *= (1 + sideG);
    contrib *= (1 + salG);
    rothIRAC *= (1 + inflR);       // IRS limit is inflation-indexed
    if (contrib > salary) contrib = salary;
  }

  // net worth at the (possibly fractional) stop-working moment, interpolated
  let atStop = null;
  if (stopWorkActive) {
    const lo = Math.floor(stopYear);
    const frac = stopYear - lo;
    const loRow = rows[lo];
    if (loRow) {
      const hiRow = rows[Math.min(lo + 1, yrs)] || loRow;
      atStop = loRow.total + frac * (hiRow.total - loRow.total);
    }
  }

  // after-tax final value: subtract the embedded tax on unrealized brokerage
  // gains (fed 15% + retirement state CG) and on the remaining pre-tax 401k
  // (assume patient low-bracket withdrawals: ~12% fed + state income rate).
  const endLots = lots.reduce((a, l) => ({ value: a.value + l.value, basis: a.basis + l.basis }), { value: 0, basis: 0 });
  const finalRow = rows[rows.length - 1];
  const embeddedCG = Math.max(0, endLots.value - endLots.basis) * (0.15 + stateCGRate(s.stateRetire));
  const embedded401k = finalRow.retire * (0.12 + stateIncomeRate(s.stateRetire));
  const finalAfterTax = finalRow.total - embeddedCG - embedded401k;

  return {
    rows,
    final: finalRow,
    finalAfterTax,
    firstNegSavingsYear,
    firstMillionYear,
    depletionYear,
    stopWork: stopWorkActive,
    stopYear: isFinite(stopYear) ? stopYear : null,
    targetMode,
    targetReached,
    targetValue: num(s.retireTarget),
    atStop,
    lifetimeTax, ladderConverted, penaltyPaid, cgTaxPaid,
    assumedAge,
    inflR,
  };
}

function applyEvent(bal, lots, e) {
  const amt = num(e.amount);
  if (!amt) return;
  const bucket = e.bucket || 'stocks';
  const sign = e.type === 'withdraw' ? -1 : 1;
  if (bucket === 'stocks') {
    if (sign > 0) { lots.push({ basis: amt, value: amt }); return; }
    let need = amt;                 // event withdrawals: newest-first, untaxed (user-directed move)
    while (need > 0 && lots.length) {
      const lot = lots[lots.length - 1];
      const take = Math.min(lot.value, need);
      lot.basis *= (1 - take / lot.value);
      lot.value -= take; need -= take;
      if (lot.value <= 1) lots.pop();
    }
    return;
  }
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
function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, num(v))); }
// format a possibly-fractional year: 25 -> "25", 25.25 -> "25.25", 25.5 -> "25.5"
function fmtYear(v) {
  const r = Math.round(num(v) * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r);
}

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
  SELECT_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el && s[id] != null) el.value = s[id];
  });
  document.getElementById('years-out').textContent = s.years;
  document.getElementById('stopWork').checked = !!s.stopWork;
  document.getElementById('rothLadder').checked = s.rothLadder !== false;
  document.getElementById('retire-fields').hidden = !s.stopWork;
  // retirement trigger mode (year vs money target)
  const mode = s.retireMode || 'year';
  document.querySelectorAll('#retire-mode .segm').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
  document.getElementById('mode-year').hidden = mode !== 'year';
  document.getElementById('mode-target').hidden = mode !== 'target';
  renderEvents();
  renderSetbacks();
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
  SELECT_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) s[id] = el.value;
  });
  s.stopWork = document.getElementById('stopWork').checked;
  s.rothLadder = document.getElementById('rothLadder').checked;
  const activeMode = document.querySelector('#retire-mode .segm.active');
  s.retireMode = activeMode ? activeMode.dataset.mode : 'year';
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

/* ---------- setbacks UI (job loss + salary haircut) ---------- */
function renderSetbacks() {
  const wrap = document.getElementById('setbacks-list');
  const s = scn();
  wrap.innerHTML = '';
  (s.setbacks || []).forEach((sb, i) => {
    const row = document.createElement('div');
    row.className = 'event';
    row.innerHTML = `
      <div class="field"><label>Starts yr</label>
        <input type="number" min="0" max="${s.years}" step="0.25" value="${sb.year}" data-sk="${i}" data-skk="year"></div>
      <div class="field"><label>Out for (yrs)</label>
        <input type="number" min="0.25" max="10" step="0.25" value="${sb.dur}" data-sk="${i}" data-skk="dur"></div>
      <div class="field"><label>New salary %</label>
        <input type="number" min="0" max="200" step="5" value="${sb.recovery}" data-sk="${i}" data-skk="recovery"></div>
      <button class="del" title="Remove" data-skdel="${i}">×</button>
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
  const wt = workingYearTax(num(s.salary), num(s.side_amount), num(s.contrib401k), s, 1);
  const takeHome = wt.takeHome;
  const save = takeHome - num(s.expenses);
  const match = Math.min(num(s.contrib401k), num(s.salary) * pct(s.matchCap));
  const cd = document.getElementById('cashflow-derived');
  cd.innerHTML = `Take-home ≈ <b>${fmtFull(takeHome)}</b> · after expenses, ` +
    `<b class="${save<0?'neg':''}">${fmtFull(save)}/yr</b> ` +
    (save < 0 ? 'shortfall (drawn from savings)' : 'flows to brokerage');

  // computed tax panel
  const td = document.getElementById('tax-derived');
  const stW = STATES[s.stateWork] || { n: s.stateWork };
  const stR = STATES[s.stateRetire] || { n: s.stateRetire };
  const cgR = (stateCGRate(s.stateRetire) * 100).toFixed(1);
  td.innerHTML = `Year-1 taxes ≈ <b>${fmtFull(wt.tax)}</b> — effective rate <b>${(wt.effRate*100).toFixed(1)}%</b> ` +
    `(federal + FICA + ${escapeHTML(stW.n)}). In retirement, stock sales are taxed at ` +
    `federal LTCG + <b>${cgR}%</b> ${escapeHTML(stR.n)}. Estimates, not tax advice.`;
  const kd = document.getElementById('k401-derived');
  const parts = [];
  parts.push(num(s.contrib401k) > 0
    ? `Employer adds <b>${fmtFull(match)}/yr</b> · total into 401k ≈ <b>${fmtFull(num(s.contrib401k)+match)}/yr</b>.`
    : `No 401k contribution set. Employer match only applies when you contribute.`);
  if (num(s.rothIRA) > 0) {
    parts.push(`Roth IRA gets <b>${fmtFull(num(s.rothIRA))}/yr</b> — contributions stay withdrawable anytime (a bridge fund for early retirement).`);
  }
  kd.innerHTML = parts.join(' ');

  const sd = document.getElementById('side-derived');
  if (num(s.side_amount) > 0) {
    const res0 = cache[state.active];
    const stopY = (res0 && res0.stopWork) ? res0.stopYear : (s.stopWork ? clampNum(s.stopYear,0,s.years) : s.years);
    const lastYr = s.stopWork ? Math.min(s.years, stopY) : s.years;
    const start = clampInt(s.side_start,0,s.years);
    const endVal = num(s.side_amount) * Math.pow(1+pct(s.side_growth), Math.max(0, lastYr-start));
    sd.innerHTML = `Adds <b>${fmtFull(num(s.side_amount))}/yr</b> from year ${start} (taxed, then flows to savings)` +
      (s.stopWork ? `, until you stop working in year ${fmtYear(lastYr)}` : '') +
      `. Reaches <b>${fmtFull(endVal)}/yr</b> by then.`;
  } else {
    sd.innerHTML = `No side income. Try it on Scenario B against bigger raises on A.`;
  }

  const rd = document.getElementById('retire-derived');
  if (s.stopWork) {
    const res = cache[state.active] || project(s);
    const spend = `Spending then becomes <b>${fmtFull(num(s.expenses)*pct(s.retireSpendPct))}/yr</b> (today's terms), drawn from savings.`;
    const ageOf = y => s.currentAge != null ? ' (age ' + fmtYear(Number(s.currentAge) + y) + ')' : '';
    if (res.targetMode) {
      if (!res.targetReached) {
        rd.innerHTML = `You don't reach <b>${fmtFull(res.targetValue)}</b> within ${s.years} years. ` +
          `Save more, lower the target, or extend the horizon.`;
      } else if (res.stopYear === 0) {
        rd.innerHTML = `You already have <b>${fmtFull(res.targetValue)}</b> — you could stop working now. ` + spend;
      } else {
        rd.innerHTML = `You'd hit <b>${fmtFull(res.targetValue)}</b> in <b>year ${fmtYear(res.stopYear)}${ageOf(res.stopYear)}</b> — ` +
          `the earliest you could stop working. ` + spend;
      }
    } else {
      rd.innerHTML = `You stop earning after <b>year ${fmtYear(res.stopYear)}${ageOf(res.stopYear)}</b>. ` + spend;
    }
  }
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
    total += r.contrib + r.employerMatch + (r.rothContrib || 0) + Math.max(0, r.brokerageSavings);
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

  // retirement markers (vertical dashed line at each scenario's stop-work year)
  const marks = [['A', cache.A, cA]];
  if (state.compare) marks.push(['B', cache.B, cB]);
  let markRow = 0;
  marks.forEach(([name, res, col]) => {
    if (!res.stopWork || res.stopYear >= yrs || res.stopYear <= 0) return;
    const mx = X(res.stopYear);
    // keep the label inside the plot: anchor to the edge when the line is near one
    const anchor = mx > d.x1 - 52 ? 'end' : (mx < d.x0 + 52 ? 'start' : 'middle');
    const ly = d.y1 + 10 + markRow * 13;   // stagger A/B so labels don't overlap
    markRow++;
    svgEl += `<line x1="${mx}" y1="${d.y1}" x2="${mx}" y2="${d.y0}" stroke="${col}" stroke-width="1.25" stroke-dasharray="4 3" opacity="0.7"/>`;
    svgEl += `<text x="${mx}" y="${ly}" text-anchor="${anchor}" font-size="10.5" fill="${col}" font-weight="600">🏁 ${name} stops · yr ${fmtYear(res.stopYear)}</text>`;
  });

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
      roth: basisVal(r.roth || 0, f),
      stocks: basisVal(r.stocks, f),
      realestate: basisVal(r.realestate, f),
      other: basisVal(r.other, f),
    };
  });
  let maxV = Math.max(...stacks.map(s => s.retire+s.roth+s.stocks+s.realestate+s.other));
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
    const total = s.retire+s.roth+s.stocks+s.realestate+s.other;
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

  // retirement feasibility (per scenario that models it)
  [['A', A, state.A], ['B', B, state.B]].forEach(([name, res, sc]) => {
    if (!state.compare && name !== state.active) return;
    if (!sc.stopWork) return;

    // target mode but the goal isn't reached within the horizon
    if (res.targetMode && !res.targetReached) {
      out.push(ins('warn','🎯',`<b>Scenario ${name}:</b> you never reach your <b>${fmtMoney(res.targetValue)}</b> target within ${yrs} years, so you couldn't stop working on this path. Save more, lower the target, or extend the horizon.`));
      return;
    }
    if (!res.stopWork) return;

    const sy = res.stopYear;
    const stopAge = sc.currentAge != null ? Number(sc.currentAge) + sy : null;
    const ageTxt = stopAge != null ? ` (age ${fmtYear(stopAge)})` : '';
    const targetTxt = res.targetMode ? `, hitting your <b>${fmtMoney(res.targetValue)}</b> target,` : '';
    if (res.depletionYear != null && res.depletionYear <= yrs) {
      const depAge = sc.currentAge != null ? Number(sc.currentAge) + res.depletionYear : null;
      out.push(ins('warn','⛔',`<b>Scenario ${name}:</b> you stop working year ${fmtYear(sy)}${ageTxt}${targetTxt} but savings run dry by <b>year ${res.depletionYear}${depAge!=null?` (age ${depAge})`:''}</b> — expenses outlast your money. Work longer, spend less in retirement, or raise the target.`));
    } else {
      const endReal = basisVal(res.final.total, res.final.realFactor);
      out.push(ins('good','✅',`<b>Scenario ${name}:</b> you could stop working <b>year ${fmtYear(sy)}</b>${ageTxt}${targetTxt} and your money lasts the full projection — ending around <b>${fmtMoney(endReal)}</b> (${state.basis}). The nest egg keeps covering you.`));
    }
    // Roth ladder / penalty outcomes (now actually modeled)
    if (res.ladderConverted > 0) {
      out.push(ins('good','🪜',`<b>Scenario ${name}:</b> the Roth conversion ladder moves <b>${fmtMoney(res.ladderConverted)}</b> out of the 401k at low bracket rates before 59½, avoiding the 10% early-withdrawal penalty.`));
    }
    if (res.penaltyPaid > 100) {
      out.push(ins('warn','📋',`<b>Scenario ${name}:</b> pays <b>${fmtMoney(res.penaltyPaid)}</b> in 10% early-withdrawal penalties on pre-59½ 401k draws${sc.rothLadder === false ? ' — try enabling the Roth ladder' : ' (the ladder couldn’t season fast enough)'}.`));
    }
    if (res.cgTaxPaid > 100) {
      out.push(ins('warn','🧾',`<b>Scenario ${name}:</b> selling stock (newest lots first) to fund retirement costs <b>${fmtMoney(res.cgTaxPaid)}</b> in capital-gains tax in ${escapeHTML((STATES[sc.stateRetire]||{}).n || sc.stateRetire)}. Lifetime taxes: <b>${fmtMoney(res.lifetimeTax)}</b>.`));
    }
  });

  // age assumption notice
  if ((state.A.stopWork || state.B.stopWork) && cache.A.assumedAge) {
    out.push(ins('warn','🎂',`No current age set — 401k access (59½) and Social Security rules assume age <b>${AGE_ASSUMED}</b> today. Enter your age for accurate timing.`));
  }

  // after-tax truth: embedded taxes on unrealized gains + pre-tax 401k
  {
    const atA = basisVal(A.finalAfterTax, fa.realFactor);
    if (state.compare) {
      const atB = basisVal(B.finalAfterTax, fb.realFactor);
      out.push(ins('good','⚖',`<b>After embedded taxes</b> (unrealized gains + pre-tax 401k, eventually owed): A ≈ <b>${fmtMoney(atA)}</b>, B ≈ <b>${fmtMoney(atB)}</b> — the fairer basis for comparing Roth vs. brokerage vs. 401k strategies.`));
    } else {
      out.push(ins('good','⚖',`<b>After embedded taxes</b>, your final number is worth ≈ <b>${fmtMoney(atA)}</b> — unrealized gains and the pre-tax 401k still owe tax when eventually tapped.`));
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
  // Roth IRA limit + income phase-out awareness
  const IRA_LIMIT = (s.currentAge != null && Number(s.currentAge) >= 50) ? 8000 : 7000;
  if (num(s.rothIRA) > IRA_LIMIT) {
    out.push(ins('warn','📋',`Your Roth IRA contribution (${fmtFull(num(s.rothIRA))}) exceeds the ~${fmtFull(IRA_LIMIT)} annual limit${IRA_LIMIT===7000?' (under 50)':''}. Treat the excess as illustrative.`));
  }
  if (num(s.rothIRA) > 0) {
    const magi = num(s.salary) + num(s.side_amount);
    const phaseout = s.filingStatus === 'mfj' ? 236000 : 150000;
    if (magi > phaseout) {
      out.push(ins('warn','🚪',`Your income (~${fmtMoney(magi)}) is above the direct Roth IRA limit (~${fmtMoney(phaseout)} ${s.filingStatus==='mfj'?'MFJ':'single'}) — this plan assumes you contribute via a <b>backdoor Roth</b> (legal and common, but requires no pre-tax IRA balances to avoid pro-rata tax).`));
    }
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
    '<th>401k</th><th>Roth</th><th>Brokerage</th><th>Real estate</th><th>Cash/other</th>' +
    '<th>Total</th><th>Taxes</th><th>Saved that yr</th></tr></thead><tbody>';
  res.rows.forEach(r => {
    const f = r.realFactor;
    const yl = r.year + (r.age!=null ? ' / ' + r.age : '');
    h += `<tr><td>${yl}</td>` +
      `<td>${fmtFull(basisVal(r.retire,f))}</td>` +
      `<td>${fmtFull(basisVal(r.roth||0,f))}</td>` +
      `<td>${fmtFull(basisVal(r.stocks,f))}</td>` +
      `<td>${fmtFull(basisVal(r.realestate,f))}</td>` +
      `<td>${fmtFull(basisVal(r.other,f))}</td>` +
      `<td><b>${fmtFull(basisVal(r.total,f))}</b></td>` +
      `<td>${fmtFull(r.taxes||0)}</td>` +
      `<td>${fmtFull(r.contrib + r.employerMatch + (r.rothContrib||0) + Math.max(0,r.brokerageSavings))}</td></tr>`;
  });
  h += '</tbody></table>';
  wrap.innerHTML = h;
}

/* ============================================================
   SAVED SCENARIOS (localStorage-backed library)
   ============================================================ */
const STORE_KEY = 'trajectory_saved_v1';
const Saved = {
  list: [],
  mem: false,           // fall back to memory if localStorage blocked
  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      this.list = raw ? JSON.parse(raw) : [];
    } catch (e) { this.list = []; this.mem = true; }
  },
  persist() {
    if (this.mem) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.list)); }
    catch (e) { this.mem = true; }
  },
  add(name, scenario) {
    this.list.unshift({
      id: 's' + Date.now() + Math.floor(Math.random() * 1000),
      name: name,
      savedAt: Date.now(),
      scenario: JSON.parse(JSON.stringify(scenario)),
    });
    this.persist();
  },
  remove(id) { this.list = this.list.filter(x => x.id !== id); this.persist(); },
  rename(id, name) { const it = this.list.find(x => x.id === id); if (it) { it.name = name; this.persist(); } },
  get(id) { return this.list.find(x => x.id === id); },
};

function saveActiveScenario(name) {
  readFormIntoState();
  Saved.add(name, scn());
  renderSavedList();
  flash('Saved “' + name + '”');
}

function loadSavedInto(id, slot) {
  const item = Saved.get(id);
  if (!item) return;
  state[slot] = migrateScenario(JSON.parse(JSON.stringify(item.scenario)));
  state.active = slot;
  showView('inputs');
  loadFormFromState();
  recompute();
  flash('Loaded “' + item.name + '” into Scenario ' + slot);
}

function savedSummary(scRaw) {
  const sc = migrateScenario(JSON.parse(JSON.stringify(scRaw)));
  const res = project(sc);
  const finalV = res.final.total;                 // nominal end value
  const atStop = res.atStop;                       // net worth the year earning stops
  const stopY = res.stopYear;
  const bits = [];
  bits.push(sc.years + ' yr');
  bits.push('salary ' + fmtMoney(num(sc.salary)));
  if (num(sc.contrib401k) > 0) bits.push('401k ' + fmtMoney(num(sc.contrib401k)));
  if (num(sc.side_amount) > 0) bits.push('side ' + fmtMoney(num(sc.side_amount)));
  if (sc.stopWork && res.targetMode && !res.targetReached) bits.push('target not reached');
  else if (res.stopWork) bits.push('retires yr ' + fmtYear(stopY));
  return { finalV, atStop, stopY, meta: bits.join(' · ') };
}

function renderSavedList() {
  const wrap = document.getElementById('saved-list');
  const empty = document.getElementById('saved-empty');
  const count = document.getElementById('saved-count');
  count.textContent = Saved.list.length;
  empty.hidden = Saved.list.length > 0;
  wrap.innerHTML = Saved.list.map(item => {
    const { finalV, atStop, stopY, meta } = savedSummary(item.scenario);
    const stopFig = atStop != null
      ? `<span class="sc-stop" title="Net worth when earning stops">${fmtMoney(atStop)} <span class="fl">🏁 yr ${fmtYear(stopY)}</span></span>`
      : '';
    return `<div class="saved-card" data-id="${item.id}">
      <div class="sc-top">
        <span class="sc-name">${escapeHTML(item.name)}</span>
        <div class="sc-figs">
          <span class="sc-final">${fmtMoney(finalV)} <span class="fl">end</span></span>
          ${stopFig}
        </div>
      </div>
      <div class="sc-meta">${meta} · nominal $</div>
      <div class="sc-actions">
        <button class="load-a" data-act="loadA">Load → A</button>
        <button class="load-b" data-act="loadB">Load → B</button>
        <button data-act="rename">Rename</button>
        <button class="del" data-act="del">Delete</button>
      </div>
    </div>`;
  }).join('');
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showView(which) {
  const inputs = which === 'inputs';
  document.getElementById('view-inputs').hidden = !inputs;
  document.getElementById('view-saved').hidden = inputs;
  document.getElementById('vt-inputs').classList.toggle('active', inputs);
  document.getElementById('vt-saved').classList.toggle('active', !inputs);
  if (!inputs) renderSavedList();
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
    if (e.target.id === 'stopWork') {
      document.getElementById('retire-fields').hidden = !e.target.checked;
    }
    // event rows
    if (e.target.dataset && e.target.dataset.k) {
      const i = +e.target.dataset.i, k = e.target.dataset.k;
      scn().events[i][k] = k==='year' ? clampInt(e.target.value,1,scn().years) :
        (k==='amount' ? num(e.target.value) : e.target.value);
    }
    // setback rows
    if (e.target.dataset && e.target.dataset.skk) {
      const i = +e.target.dataset.sk, k = e.target.dataset.skk;
      scn().setbacks[i][k] = num(e.target.value);
    }
    recompute();
  });

  // setback add/delete
  document.getElementById('add-setback').addEventListener('click', () => {
    scn().setbacks.push({ year: Math.min(3, scn().years), dur: 0.5, recovery: 85 });
    renderSetbacks(); recompute();
  });
  document.getElementById('setbacks-list').addEventListener('click', (e) => {
    if (e.target.dataset && e.target.dataset.skdel != null) {
      scn().setbacks.splice(+e.target.dataset.skdel, 1);
      renderSetbacks(); recompute();
    }
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

  // retirement trigger mode (year vs money target)
  document.querySelectorAll('#retire-mode .segm').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#retire-mode .segm').forEach(x => x.classList.toggle('active', x === b));
    document.getElementById('mode-year').hidden = b.dataset.mode !== 'year';
    document.getElementById('mode-target').hidden = b.dataset.mode !== 'target';
    recompute();
  }));

  // view tabs (Inputs / Saved)
  document.getElementById('vt-inputs').addEventListener('click', () => showView('inputs'));
  document.getElementById('vt-saved').addEventListener('click', () => showView('saved'));

  // save flow (inline name row)
  const saveRow = document.getElementById('save-row');
  const saveName = document.getElementById('save-name');
  document.getElementById('save-scn').addEventListener('click', () => {
    saveRow.hidden = false;
    saveName.value = 'Scenario ' + state.active + ' — ' + new Date().toLocaleDateString();
    saveName.focus(); saveName.select();
  });
  document.getElementById('save-cancel').addEventListener('click', () => { saveRow.hidden = true; });
  function doSave() {
    const name = saveName.value.trim();
    if (!name) { saveName.focus(); return; }
    saveActiveScenario(name);
    saveRow.hidden = true;
  }
  document.getElementById('save-confirm').addEventListener('click', doSave);
  saveName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doSave(); }
    if (e.key === 'Escape') { saveRow.hidden = true; }
  });

  // saved-list actions (delegated)
  document.getElementById('saved-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('.saved-card').dataset.id;
    const act = btn.dataset.act;
    if (act === 'loadA') loadSavedInto(id, 'A');
    else if (act === 'loadB') loadSavedInto(id, 'B');
    else if (act === 'del') {
      const item = Saved.get(id);
      if (confirm('Delete “' + (item ? item.name : 'this') + '”?')) { Saved.remove(id); renderSavedList(); }
    } else if (act === 'rename') {
      const item = Saved.get(id);
      const nn = prompt('Rename scenario:', item ? item.name : '');
      if (nn && nn.trim()) { Saved.rename(id, nn.trim()); renderSavedList(); }
    }
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
// populate the two state dropdowns (alphabetical by name)
(function fillStates() {
  const opts = Object.entries(STATES)
    .sort((a, b) => a[1].n.localeCompare(b[1].n))
    .map(([code, st]) => `<option value="${code}">${st.n}</option>`).join('');
  document.getElementById('stateWork').innerHTML = opts;
  document.getElementById('stateRetire').innerHTML = opts;
})();
// seed scenario B with a contrasting default so compare is meaningful out of the box
state.A = migrateScenario(state.A);
state.B = migrateScenario(defaultScenario());
state.B.contrib401k = 15000;   // B = "max the 401k" decision
Saved.load();
loadFormFromState();
wire();
renderSavedList();
recompute();
