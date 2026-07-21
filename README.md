# Trajectory — Net Worth Projection Simulator

A single-page, dependency-free web app for making financial decisions by
**seeing them**. Model your net worth year by year, then run an A/B comparison
to answer questions like *"what does maxing my 401k actually do to my number
in 30 years?"* or *"what's the lifetime cost of this bigger house?"*

Open `index.html` in any browser — no build step, no server, no internet.

## What it models

- **Per-asset projection** — 401k/retirement, brokerage/stocks, real-estate
  equity, and cash/other each grow at their own rate you set.
- **Cash flow → savings** — gross salary (with annual raises) and expenses
  (which track inflation) produce a take-home figure; whatever is left flows
  into your post-tax brokerage automatically. A shortfall is drawn back out of
  savings.
- **Computed taxes** — no more guessing an effective rate. From filing status,
  state (working and retirement can differ), and kids under 17, the app
  estimates federal progressive brackets + standard deduction, FICA, a flat
  effective state rate, and the Child Tax Credit. Bracket thresholds are indexed
  to your inflation input so brackets don't "creep" in nominal projections.
- **Tax-aware retirement drawdown** — the brokerage is tracked as tax lots
  (initial holdings assume 60% basis / 40% unrealized gain; every year's savings
  adds a new lot). Withdrawals sell **newest lots first**, paying federal LTCG
  (stacked on ordinary income, incl. NIIT) plus **your retirement state's**
  capital-gains rate — retiring in Texas vs. California visibly changes the
  outcome. Order: brokerage → cash → seasoned Roth principal → 401k.
- **Roth conversion ladder** — before 59½, retirement years convert 401k → Roth
  up to the top of the 12% bracket (tax paid from the converted amount);
  conversions become accessible after 5 years, avoiding the 10% penalty. Draws
  that must hit the 401k early anyway pay the penalty, and the read-out shows
  both. Social Security (inflation-adjusted, at your chosen start age) offsets
  retirement spending.
- **Catastrophic events** — job-loss entries: out of work starting year X for a
  duration (¼-year steps), then returning at a % of your old salary (lost
  leverage). Stress-test any plan with one or several.
- **The 401k decision** — route pre-tax dollars into the 401k instead of the
  brokerage, with employer match up to a % of salary. Pre-tax + match is the
  headline "decision" the compare view is built for.
- **When you stop working** — two ways to set retirement:
  - **Pick a year** — choose the year you stop, in **quarter-year (0.25) steps**,
    shown as an age. The transition year is prorated: income, contributions, and
    expenses reflect the fraction of that year actually worked.
  - **Reach a $ target** — enter a target net worth and the app finds the
    *earliest year* your projection reaches it — your financial-independence
    year. If the target isn't reached within the horizon, it says so.

  Either way, salary and 401k contributions then stop, spending switches to a
  retirement level (% of today's expenses), and the model draws *down* your
  assets — brokerage, then cash, then 401k — to cover it. The read-out tells you
  whether the money lasts or runs dry, and the chart marks the year with a 🏁 line.
- **Side income** — a side gig / freelancing / rental stream with its own start
  year and growth rate. Put it on one scenario and bigger raises on the other to
  compare **career growth vs. a side gig** head-to-head.
- **Inflation** — toggle between **nominal** dollars and **real** (today's)
  dollars everywhere. The read-out shows how much inflation quietly erodes.
- **One-time decisions** — a list of "in year N, add/take $X to/from bucket Y"
  events: a windfall, a home purchase, a college bill, moving cash into stocks.
- **A vs B scenarios** — edit two full scenarios, copy one onto the other, then
  change a single input and watch the two paths (and the gap between them) on
  the chart. Ships pre-loaded with A = no 401k vs B = maxed 401k.
- **Saved library** — a **Saved** tab (in the left panel) stores named scenarios
  in your browser (`localStorage`), so they survive reloads. Save the scenario
  you're editing, then load any saved one into slot A or B to compare. Each card
  shows a summary and its projected end net worth; rename and delete supported.

## What you get

- Net-worth-over-time line chart comparing A and B, with hover crosshair + the
  running dollar difference.
- Stacked-area composition chart showing what your net worth is *made of* over
  time (and how the mix diversifies as investments compound).
- Stat tiles: final number each scenario, the delta, the year you cross \$1M, and
  how much came from compounding vs. contributions.
- A plain-English **read-out** that flags things automatically: employer match
  left on the table, the year spending outpaces income, inflation erosion, over
  the 401k contribution limit, etc.
- A full year-by-year table and light/dark themes.

## Modeling notes & simplifications

This is a planning tool, not a guarantee. It uses **smooth average returns** (no
year-to-year market volatility) and treats real estate as pure equity
appreciation (no mortgage amortization). Tax simplifications: state income tax
is a flat effective-rate approximation (real states have brackets/credits);
2025 federal tables indexed by your inflation input; side income skips
self-employment tax; Social Security benefits are treated as untaxed; Roth
conversion taxes are paid from the converted amount; Washington's LTCG excise
is applied flat. Contribution and expense growth are applied annually at
year-end. See the disclaimer in-app.

## Ideas for future inputs

Mortgage & debt schedules, Roth vs. Traditional tax treatment, Social Security,
early-withdrawal penalties, and Monte-Carlo return ranges (p10/p50/p90 bands)
are the natural next additions — the engine in `app.js` (`project()`) is
structured to grow into them.
