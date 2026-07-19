# Trajectory — Net Worth Projection Simulator

A single-page, dependency-free web app for making financial decisions by
**seeing them**. Model your net worth year by year, then run an A/B comparison
to answer questions like *"what does maxing my 401k actually do to my number
in 30 years?"* or *"what's the lifetime cost of this bigger house?"*

Open `index.html` in any browser — no build step, no server, no internet.

## What it models

- **Per-asset projection** — 401k/retirement, brokerage/stocks, real-estate
  equity, and cash/other each grow at their own rate you set.
- **Cash flow → savings** — gross salary (with annual raises), an effective tax
  rate, and expenses (which track inflation) produce a take-home figure; whatever
  is left flows into your post-tax brokerage automatically. A shortfall is drawn
  back out of savings.
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
year-to-year market volatility), a single blended tax rate, and treats real
estate as pure equity appreciation (no mortgage amortization). Contribution and
expense growth are applied annually at year-end. See the disclaimer in-app.

## Ideas for future inputs

Mortgage & debt schedules, Roth vs. Traditional tax treatment, Social Security,
early-withdrawal penalties, and Monte-Carlo return ranges (p10/p50/p90 bands)
are the natural next additions — the engine in `app.js` (`project()`) is
structured to grow into them.
