---
id: B-DESK-01
title: thinkorswim / Schwab — desk tool benchmark
role: B-DESK-01
wave: 1b
group: B
category: competitor
scope: thinkorswim (desktop, web, mobile) and the Schwab brokerage platform
confidence: 🟡 medium on public platform capability; 🔴 on actual desk usage
evidence_ceiling: The four internal repos this program can read contain ZERO references to thinkorswim, and Schwab's own site blocks WebFetch (bot-protection "unable to authorize" pages), so this report is built from browser-navigated official documentation plus one independent professional review. No internal artifact records whether, or how, the desk actually uses thinkorswim.
sources: 11 primary (official Schwab/thinkorswim pages and Learning Center manual pages); 3 secondary (schwab-py third-party API wrapper docs, StockBrokers.com review, Google SERP snippets for pages that could not be loaded directly)
uct_relevance: high
status: draft
date: 2026-09-02
---

# thinkorswim / Schwab — desk tool benchmark

## 0. THE INTERNAL EVIDENCE CEILING — read this before anything below

### OBSERVATION
D-14 (`01-existing-system/ecosystem-cartography.md`, §7) ran a code search for `thinkorswim`,
`toslc`, and `tos_` across all four PC repositories (`uct-intelligence`, the Discord bot
`uct_intelligence`, `morning-wire`, `uct-sunday-scan`) and found **zero hits**. Its verdict,
quoted verbatim: *"No reference in any of the four repos... Neither [a dependency nor a link].
If it is a desk tool, it is used by hand."* D-13 (`05-product-strategy/proprietary-asset-inventory-raw.md`,
§7) separately notes that a Schwab API integration DOES exist at UCT, but it is the **partner-owned
live options flow pipeline** (`schwab_router.py`, `live_massive_router.py`,
`massive_ws_worker.py`, `massive_processor.py`) — a market-data/broker-API feed for the Options
Flow product surface, not the desk's manual charting or trading tool. My contract forbids reading
those files, and even if read they would answer "how does UCT ingest Schwab data," not "does the
trader open thinkorswim."

### EVIDENCE
`01-existing-system/ecosystem-cartography.md` §7 (internal, dated 2026-09-02) — table row:
"thinkorswim | No reference in any of the four repos (searched thinkorswim, toslc, tos_) | —
| Neither. If it is a desk tool, it is used by hand." `05-product-strategy/proprietary-asset-inventory-raw.md`
§7 lists the partner-owned Schwab modules without further description.

### INTERPRETATION
Every claim in this report about "what the desk uses it for" or "which workflows it owns" is
**necessarily downstream of the shared contract's stated default** (thinkorswim/Schwab as
"broker + charting") rather than of anything measured. I cannot independently confirm session
frequency, which sub-tools get opened, or how deep the usage goes. What follows is therefore:
(a) verified public-platform capability, and (b) hypotheses about fit against UCT's *known*
workflows (from D-13/D-14), explicitly flagged as such.

### RELEVANCE TO UCT
Any Terminal-Next absorb/integrate/leave-external call for thinkorswim specifically cannot be
finalized from this report alone.

### CONFIDENCE
🟢 that the repos contain no reference. 🔴 on actual desk usage. **EVIDENCE CEILING:** only the
owner can settle this — no log, transcript, or code artifact in scope records a thinkorswim
session.

### RECOMMENDATION
Get a direct owner confirmation (or a short screen-recording of a live session) before treating
any absorb/integrate/leave-external verdict below as more than a hypothesis.

### OPEN QUESTION
D-14's own open question, unresolved: *"Does the owner use thinkorswim (or another broker
platform) at the desk in a way no repo records?"*

---

## 1–2. What thinkorswim is, and the workflows each tool inside it owns

### OBSERVATION
thinkorswim is not one platform but three, per Schwab's own framing: **thinkorswim desktop**
(the flagship, full-feature, Windows/Mac download), **thinkorswim web** ("essential tools from
desktop... packaged into an intuitive online trading interface," no download, described as
"tabless" streamlined single-screen), and **thinkorswim mobile** (iOS/Android, "desktop trading
power that fits in your pocket"). All three are free with a funded Schwab brokerage account (no
account minimum). Trading execution still runs on infrastructure Schwab labels **"powered by
Ameritrade"** — a visible trace of the 2020 TD Ameritrade acquisition that thinkorswim survived.

Per the official thinkManual (Learning Center, `toslc.thinkorswim.com`), the desktop platform's
named workflows map directly onto the contract's list:

- **Analyze tab** — seven subtabs: *Add Simulated Trades* (build a hypothetical position from
  the option chain), *Risk Profile* (P/L-vs-underlying-price graph with two curves — at
  expiration and today, using implied vol; shows probability of profit at each price slice),
  *Probability Analysis* (projected price range at a chosen probability, default one standard
  deviation/68.27%), *Economic Data*, **thinkBack** (option back-testing against ~a decade of
  stored historical option chains — enter a hypothetical trade on a past date and see what it
  would have done), *Fundamentals*, *Earnings* (8 quarters of pre/post-earnings mini price charts
  + implied/historical vol + ATM straddle pricing + EPS side by side), and an admin-enabled
  *Portfolio Uniform Stress Test* mode.
- **Scan tab / Stock Hacker** — a filter-builder scanner over stocks, options, futures, and
  forex. Filters stack into three logical groups (all-of / none-of / any-of), up to 25 filters
  per scan, one pattern filter max; filter types are stock metrics, option metrics/Greeks,
  fundamentals, **study filters** (including custom thinkScript conditions), and **classical
  chart-pattern filters** (updated hourly). Results save as a watchlist, a reusable named scan
  query, or a change-triggered alert (immediate/hourly/daily/weekly). Sibling tools on the same
  tab: Option Hacker, Spread Hacker, Spread Book, ISE Spread Book.
- **Watchlists / Alerts** — alerts fire on price, portfolio metrics, calendar/economic events,
  news, rating changes, or **study/thinkScript-based conditions**; notification channels are
  in-app sound (with custom uploaded sounds), email, SMS, and mobile push; each alert has
  submit/expire/remind/reverse-crossover lifecycle controls.
- **Flexible Grid** — per the Learning Center (SERP-snippet only, page not directly loadable):
  "an alternative to the default Charts Grid interface... provides all regular Charts features
  while giving you more control over cells['] [layout]" — i.e., a freeform multi-pane chart/gadget
  workspace, distinct from the standard tabbed Charts grid. **Workspaces** more broadly can pair
  a chart with live product news in the same pane.
- **thinkScript** — a built-in, object-based scripting language usable in six places: custom
  chart studies, custom back-testable **strategies** (must call `AddOrder`), custom watchlist
  columns ("Custom Quotes"), study-based alerts, thinkScript-conditioned automatic orders (Order
  Entry → Order Rules), and Stock Hacker scan filters. A no-code **Condition Wizard** covers
  simple logical conditions without writing thinkScript.
- **paperMoney** — built into all three platforms: a virtual/simulated trading environment using
  live market data and most real thinkorswim tools, for strategy testing without capital at risk.
  A 30-day "Guest Pass" lets a non-client try the platform (paperMoney implied) before opening an
  account.
- **Schwab Trader API** (public developer program, `developer.schwab.com`) — OAuth2-authenticated
  REST access for registered individual or company developers, covering account balances/
  positions/orders, quotes, price history (minute through weekly candles, no options/futures
  history), option chains (single-leg and multi-leg "strategy chains": vertical, calendar,
  straddle, strangle, butterfly, condor, diagonal, collar), placing/replacing/canceling orders,
  transaction history, market movers, and market hours. (Described from the `schwab-py` Python
  wrapper's docs, a third-party client built directly against Schwab's official endpoints —
  Schwab's own developer-portal product pages did not render readable text through the browser
  tool.)

### EVIDENCE
Official product pages: `schwab.com/trading/thinkorswim`, `/trading/thinkorswim/desktop`,
`/trading/thinkorswim/web`, `/welcome-to-schwab` (all fetched via browser 2026-09-02, tier:
official product page). Official Learning Center manual pages (tier: official help center),
fetched 2026-09-02: `toslc.thinkorswim.com/center/howToTos/thinkManual/Analyze`,
`.../Scan`, `.../Scan/Stock-Hacker`, `.../MarketWatch/Alerts`,
`toslc.thinkorswim.com/center/reference/thinkScript`. Flexible Grid: Google SERP snippet of
`toslc.thinkorswim.com/.../Charts/Flexible-Grid` (direct fetch 404'd; snippet-only, tier
downgraded to secondary for that one line). Schwab Trader API: `schwab-py.readthedocs.io/en/latest/client.html`
(tier: credible third-party technical documentation, built against and linking to official
endpoint docs) plus Google SERP corroboration from `github.com/api-evangelist/charles-schwab`
and Reddit r/Schwab practitioner threads (tier: community/practitioner, corroboration only).

### INTERPRETATION
The platform is deep and genuinely differentiated in three areas UCT's contract flagged: options
risk modeling (Analyze tab's simulated trades + risk profile + probability analysis, all built
on live/implied-vol option-chain data), historical option back-testing (thinkBack — UCT's own
lift-ledger discipline, §5 of D-13, has no options-back-test analogue today), and a genuinely
open scripting/automation surface (thinkScript reaching studies, strategies, watchlist columns,
alerts, conditional orders, AND scans from one language). Stock Hacker's three-group filter logic
and up-to-25-filter ceiling is materially more expressive than a single-clause screener.

### RELEVANCE TO UCT
**Hypothesis, not measured usage:** if the desk actually opens thinkorswim, the two workflows
most likely to be "owned" in a way UCT cannot currently replace are (a) the Analyze tab's options
risk-profile/probability graphing on a live chain, and (b) thinkBack's historical option
back-testing — neither of which UCT's implied-move/expected-move rails (D-13 §6) currently do at
the options-Greeks level. Stock Hacker's classical-pattern + Greeks + fundamentals combined
filter is broader than UCT's Finviz-driven scanner (D-14 §7), which is a single-vendor stock
screen with no options-metric filtering.

### CONFIDENCE
🟢 on platform capability (official sources, directly read). 🔴 on whether UCT's desk actually
uses any of this — see §0.

### RECOMMENDATION
Treat items (b) options risk/probability visualization and (b) options back-testing as the two
candidate absorb targets worth an owner conversation, since they are the workflows public
documentation shows thinkorswim owns most distinctively and that map onto UCT's existing options
surfaces (Options Flow, implied-move rails) rather than requiring a new product category.

### OPEN QUESTION
Which specific thinkorswim sub-tool, if any, does the owner have open during a live session —
Analyze, Scan, a saved Flexible Grid layout, or none of it?

---

## 3. What a member likely uses it for

### OBSERVATION
thinkorswim requires a funded Schwab brokerage account; it is not a standalone tool a UCT member
could use without becoming a Schwab client and moving/opening capital there. Schwab markets it
explicitly at "traders," not "investors" ("Is thinkorswim good for long-term investments?" is
one of its own FAQ entries), and independent professional reviews (StockBrokers.com, 2026)
call it *"the industry benchmark for professional-grade trading and charting"* and rank Schwab
#1 Overall / #1 Active Trading Desktop Platform for 2026, alongside noting it suits
"intermediate and advanced traders" more than beginners (WallStreetZen review, 2023, secondary
corroboration only, not independently re-verified this session).

### EVIDENCE
`schwab.com/trading/thinkorswim` FAQ list (official, tier 3, fetched 2026-09-02). StockBrokers.com
result snippets via Google SERP, 2026 (professional review, tier: professional review, snippet-level
only — full StockBrokers.com page not fetched this session). WallStreetZen snippet (practitioner/review
tier, SERP-only, dated 2023 — likely stale relative to 2026 platform state, flagged accordingly).

### INTERPRETATION
A UCT member who already has (or opens) a Schwab account and wants deeper options-risk tooling,
scripting, or back-testing than UCT's own surfaces provide has a real reason to leave UCT for
thinkorswim specifically for those workflows — this is the same "product links members out"
dynamic D-14 §7 already documents for TradingView, just without an in-product link (UCT never
links to thinkorswim; a member would have to know to go there independently).

### RELEVANCE TO UCT
Because UCT has no thinkorswim integration or outbound link (unlike TradingView, which the
product embeds/links to per D-14 §7), thinkorswim is a **silent leak**, not a visible one — a
member could be spending real session time there and UCT would have no signal of it, unlike the
TradingView click-through UCT can at least observe.

### CONFIDENCE
🟡 — the "who thinkorswim is for" framing is well-evidenced; whether UCT members specifically use
it is unmeasured (no internal telemetry on outbound member behavior was in scope).

### RECOMMENDATION
If Terminal-Next wants visibility into this leak, an onboarding/profile question ("do you also
trade on thinkorswim/Schwab?") would surface it cheaply — cheaper than instrumenting outbound
link tracking, since (per §0) there is no in-product link to instrument.

### OPEN QUESTION
Does UCT have any signal — a member survey, a support-ticket mention, a Discord comment — that
would independently corroborate members using thinkorswim, given the product itself cannot see it?

---

## 4. Switching-cost inventory

### OBSERVATION
Four switching-cost categories apply, in descending order of stickiness:
1. **Broker linkage / capital.** thinkorswim is not detachable from a Schwab brokerage account —
   using it requires capital to already be at Schwab (or opening a new account). This is the
   highest-friction switching cost of any tool in the B-DESK roster: leaving thinkorswim behind
   is a brokerage-transfer decision, not a tool-preference decision.
2. **thinkScript investment.** Any custom study, strategy, watchlist column, or scan query
   written in thinkScript is platform-locked — there is no export path implied by the
   documentation; UCT's own Pine-parity work (D-13/D-14 project references) targets TradingView's
   Pine, not thinkScript, so nothing in UCT's indicator engine currently reduces this cost.
3. **Saved layouts/data.** Flexible Grid layouts, saved Stock Hacker scan queries, and watchlists
   are all platform-native saved state (shareable within thinkorswim per the Learning Center's
   "Sharing" page, but not portable out).
4. **Keyboard/workflow muscle memory.** Not independently evidenced this session (no UI-shortcut
   documentation was fetched); inferred low-to-medium from the platform's density and thinkScript
   investment, consistent with the StockBrokers.com "professional-grade" framing implying a
   learning curve worth protecting once climbed.

### EVIDENCE
Account/pricing requirement: `schwab.com/pricing` (official, fetched 2026-09-02) — $0 account
minimum, $0 opening/maintenance fee, but the account itself is the precondition for platform
access (`schwab.com/trading/thinkorswim` FAQ: "What is the minimum deposit for thinkorswim?").
thinkScript lock-in: inferred from `toslc.thinkorswim.com/center/reference/thinkScript` describing
six platform-internal consumption points and no export/interop mechanism mentioned.

### INTERPRETATION
The broker-linkage cost dominates and is categorically different from every other desk tool in
this benchmark slot (TradingView, Finviz, Market Chameleon are all detachable subscriptions).
UCT cannot "absorb" this workflow away from Schwab without also being a brokerage — the realistic
ceiling for Terminal-Next is feature-parity on charting/scanning/options-analysis, never full
displacement, as long as the member's capital sits at Schwab.

### RELEVANCE TO UCT
Any Terminal-Next feature aimed at "replacing" thinkorswim workflows should be scoped as
"reduce time spent in thinkorswim for research/analysis," not "replace thinkorswim" — because the
order-execution and account-custody relationship is structurally out of reach.

### CONFIDENCE
🟡 — the account-linkage cost is well-evidenced; the thinkScript and muscle-memory costs are
reasoned from documentation structure, not measured against a real trader's switching behavior.

### RECOMMENDATION
Frame any Terminal-Next options-risk or back-testing feature as "fewer trips to thinkorswim for
research," not "leave Schwab" — the latter is not a decision Terminal-Next can influence.

### OPEN QUESTION
Is the desk's Schwab account the desk's *only* broker relationship, or one of several — which
determines whether "reduce thinkorswim usage" is even a meaningful goal versus "the trade
executes there regardless."

---

## 5. Absorb / integrate / leave-external verdict per workflow (hypotheses)

### OBSERVATION
Given §0's ceiling, verdicts below are hypotheses graded against what D-13/D-14 say UCT already
has, not against confirmed desk behavior.

| Workflow | Hypothesis | Basis |
|---|---|---|
| Options risk profile / probability analysis (Analyze tab) | **Integrate-worthy candidate** | UCT has implied-move/expected-move rails (D-13 §6) and Options Flow, but no live-chain risk-profile grapher; this is the clearest gap |
| Options back-testing (thinkBack) | **Integrate-worthy candidate** | UCT's base-lift ledger (D-13 §5) back-tests price *structures*, never options; thinkBack back-tests option positions against historical chains — a different asset class of claim |
| Stock scanning (Stock Hacker) | **Leave-external / low priority** | UCT's Finviz-driven scanner (D-14 §7) is a real, working, hard dependency already; Stock Hacker is broader (options Greeks, patterns) but scanning is not evidenced as a UCT-desk pain point |
| thinkScript / custom studies | **Leave-external** | UCT's own indicator grammar is closed-by-design (D-13 §6, `closedTable.json`) for schedulable-formula reasons; thinkScript's open object-based model is a different design philosophy, not a gap to fill |
| paperMoney (simulated trading) | **Low priority / leave-external** | No internal evidence UCT needs a simulated-trading feature; UCT20/Book already publishes real (not simulated) tracked performance including losses (D-13 §3) |
| Schwab Trader API (broker data) | **Already integrated, not a desk workflow** | The partner-owned `schwab_router.py` family already pulls Schwab data into Options Flow — this is infrastructure, not a "workflow the desk visits" |

### EVIDENCE
Cross-reference of this session's thinkorswim findings against D-13 §3, §5, §6 and D-14 §7
(both internal, cited above).

### INTERPRETATION
The strongest case is narrow: options risk visualization and options back-testing are the two
places thinkorswim's public feature set fills a documented UCT gap. Everything else either
duplicates something UCT already has (scanning) or conflicts with a stated UCT design decision
(open scripting vs. closed formula grammar).

### RELEVANCE TO UCT
This is the direct answer to Executive Q8-10 for this tool: **absorb the options-analytics gap,
leave the rest external** — but only as a hypothesis pending owner confirmation per §0.

### CONFIDENCE
🔴 — this table is reasoning from two documents, not from confirmed desk behavior. Treat as a
starting hypothesis for a synthesis conversation, not a finding.

### RECOMMENDATION
Validate with the owner before any of these verdicts enters a roadmap.

### OPEN QUESTION
If the desk does use thinkorswim's Analyze tab today, does it do so DAILY (making the gap
urgent) or only around specific events like earnings (making it a lower-frequency, still-real
gap)?

---

## 6. The platform's own AI/automation framing

### OBSERVATION
An official Schwab article dated **August 14, 2026** — *"Using the thinkorswim® App for AI-Like
Efficiency"* — is explicit that thinkorswim does **not** market itself as an AI product. Quoted
directly (≤40 words): *"traders can leverage [hundreds of functions] to replicate the efficiency
of artificial intelligence (AI) without multiple apps or the potential for hallucinations."* The
article then walks through existing rule-based/deterministic features as the "AI-like" substitute:
Stock Hacker, the proprietary **Sizzle Index™** (current options volume ÷ 5-day rolling average;
>1.0 flags unusual activity), Live News + "Use the News" (watchlist-building from up to 81
news categories), a **Social Sentiment** chart overlay (positive/negative social-media mention
ratio, not available for all symbols), automatic chart-**Pattern** detection/labeling (Classic,
Candlestick, Fibonacci), condition-based Alerts, and Probability Analysis. Separately, Schwab
(the brokerage, not thinkorswim specifically) announced an **AI-powered portfolio-summary
capability** in a press release dated **May 5, 2026** (found via SERP snippet only, not fetched
this session) — generating AI summaries of the 5 most-moved holdings in a client's portfolio;
this is a Schwab.com/account-level feature, not confirmed as part of thinkorswim itself.

### EVIDENCE
`schwab.com/learn/story/using-thinkorswim-app-ai-like-efficiency` (official, tier 3, fetched in
full 2026-09-02, dated Aug 14 2026 in-page). Schwab press release headline via Google SERP
snippet only, `pressroom.aboutschwab.com`, dated May 5 2026 — **not independently fetched**,
so the portfolio-AI-summary claim is secondary/unverified this session.

### INTERPRETATION
This is a genuine competitive-positioning data point: thinkorswim's own marketing explicitly
frames itself as the **non-AI, deterministic alternative** to AI trading tools, leaning on
"no hallucinations" as a selling point. That is close to the inverse of UCT's own direction
(Compass coaching layer, `ask_the_brain`, grade_ticker verdicts — all LLM-mediated). It is not
that thinkorswim lacks automation (Sizzle Index, pattern auto-detection, and thinkScript-driven
conditional orders are all real automation); it specifically avoids branding any of it as AI.

### RELEVANCE TO UCT
If Terminal-Next markets its AI-coaching layer as a differentiator, thinkorswim is evidence that
at least one major incumbent is explicitly positioning AWAY from that framing for professional
traders — worth knowing as a counter-signal, not a directive.

### CONFIDENCE
🟢 on the "thinkorswim explicitly disclaims AI framing" finding (direct primary-source quote).
🔴 on the Schwab-level AI portfolio-summary feature (headline-only, unverified, likely
schwab.com not thinkorswim).

### RECOMMENDATION
Do not assume thinkorswim is gaining LLM-based features soon — its most recent (Aug 2026) public
messaging runs the opposite direction. Re-check closer to any Terminal-Next AI-positioning
decision, since this is a fast-moving space and one August article is not a permanent stance.

### OPEN QUESTION
Was the May 2026 Schwab AI-portfolio-summary feature ever extended into thinkorswim itself, or
does it remain schwab.com/account-level only?

---

## 7. Pricing/tier facts (dated)

### OBSERVATION
As of 2026-09-02 (schwab.com/pricing, official, fetched in full):
- thinkorswim (all three platforms) is **free** with a funded Schwab brokerage account — **no
  account minimum, no opening/maintenance fee**.
- **$0** online commission on listed stocks/ETFs.
- **$0 + $0.65 per contract** on options (online); broker-assisted options carry an added **$25**
  service charge.
- Futures and futures options: **$2.25 per contract** (online and broker-assisted, same rate).
- Forex: $0 commission, cost embedded in the bid/ask spread.
- A **30-day Guest Pass** lets a non-client trial thinkorswim before opening/funding an account.
- Schwab's own site repeats the "Trading at Schwab is powered by Ameritrade" attribution on
  every thinkorswim product page — a residual brand marker from the 2020 TD Ameritrade
  acquisition, confirmed on the dedicated `welcome-to-schwab` migration page.

### EVIDENCE
`schwab.com/pricing` (official pricing page, tier 3, fetched in full 2026-09-02, all figures
quoted directly from the rendered page). `schwab.com/trading/thinkorswim` FAQ (Guest Pass, account
minimum). `schwab.com/welcome-to-schwab` (Ameritrade migration, official, fetched 2026-09-02).

### INTERPRETATION
There is no separate thinkorswim subscription fee to compare against UCT's paywall — the entire
platform is a loss-leader/retention tool bundled into commission-free brokerage, funded by
options-contract and futures-contract fees plus asset-management products (advisory tiers 0.40%
– 1.00%+ also listed on the pricing page, not itemized above as out of scope for a desk-tool
comparison).

### RELEVANCE TO UCT
thinkorswim is not a subscription competitor to UCT's paywall in the conventional sense — a
member does not choose between "pay UCT" and "pay thinkorswim," they choose between "pay UCT" and
"open a brokerage account that happens to include a free professional platform." That changes the
competitive framing from price to feature-completeness plus the broker-linkage switching cost
already covered in §4.

### CONFIDENCE
🟢 — pricing page fetched and read in full, dated same day as this report.

### RECOMMENDATION
Frame thinkorswim in any competitive-pricing synthesis as "free-with-account," not as a priced
competitor — the meaningful cost axis is the broker relationship, not a subscription fee.

### OPEN QUESTION
None beyond what's already listed above.

---

## GAPS

- **WebSearch was exhausted** (per preamble); all research used WebFetch (blocked by Schwab's
  bot protection on schwab.com and developer.schwab.com — both returned "unable to authorize" or
  HTTP 403) and then browser-navigated Google search + direct Learning Center URLs, per the
  preamble's fallback order. Every schwab.com and toslc.thinkorswim.com page cited above was
  read via the browser tool, not WebFetch.
- **developer.schwab.com's Trader API product page never rendered readable text** through the
  browser tool (client-side app, returned only nav chrome) — the API description above leans on
  `schwab-py`'s third-party wrapper docs instead of Schwab's own reference. A closer read of the
  raw endpoint schemas (rate limits specifically) was not reached.
- **Flexible Grid's dedicated Learning Center page 404'd on direct navigation** — that finding is
  SERP-snippet-only, flagged inline.
- **The May 5, 2026 Schwab AI-portfolio-summary press release was not fetched**, only its
  headline seen in a SERP snippet — not confirmed as thinkorswim-specific.
- **No internal artifact on actual desk usage** — this is the dominant gap, covered in full in §0.
- Did not check thinkorswim's dedicated mobile feature page in full (404'd on two guessed URLs;
  general mobile description came from the shared `/trading/thinkorswim` overview page instead).
- Did not independently verify the StockBrokers.com or WallStreetZen review content beyond SERP
  snippets — full review pages were not fetched.

## SOURCES

1. schwab.com/trading/thinkorswim — official product page — tier: official product page —
   fetched 2026-09-02
2. schwab.com/trading/thinkorswim/desktop — official — tier: official product page — fetched
   2026-09-02
3. schwab.com/trading/thinkorswim/web — official — tier: official product page — fetched
   2026-09-02
4. schwab.com/welcome-to-schwab — official — tier: official product page — fetched 2026-09-02
5. schwab.com/pricing — official — tier: official pricing page — fetched 2026-09-02
6. toslc.thinkorswim.com/center/howToTos/thinkManual/Analyze — official Learning Center manual —
   tier: official help center — fetched 2026-09-02
7. toslc.thinkorswim.com/center/howToTos/thinkManual/Scan — official Learning Center manual —
   tier: official help center — fetched 2026-09-02
8. toslc.thinkorswim.com/center/howToTos/thinkManual/Scan/Stock-Hacker — official Learning
   Center manual — tier: official help center — fetched 2026-09-02
9. toslc.thinkorswim.com/center/howToTos/thinkManual/MarketWatch/Alerts — official Learning
   Center manual — tier: official help center — fetched 2026-09-02
10. toslc.thinkorswim.com/center/reference/thinkScript — official Learning Center reference —
    tier: official help center — fetched 2026-09-02
11. schwab.com/learn/story/using-thinkorswim-app-ai-like-efficiency — official Schwab editorial
    (dated Aug 14, 2026 in-page) — tier: official educational content — fetched 2026-09-02
12. schwab-py.readthedocs.io/en/latest/client.html — third-party API wrapper documentation,
    built against and linking to official Schwab endpoint docs — tier: credible technical
    documentation (secondary) — fetched 2026-09-02
13. Google SERP snippets (multiple queries) for: Flexible Grid page content, StockBrokers.com
    2026 review language, WallStreetZen 2023 review language, developer.schwab.com product
    listing corroboration — tier: secondary/snippet-only, not independently verified in full —
    2026-09-02
14. Internal: `01-existing-system/ecosystem-cartography.md` §7 (D-14) — dated 2026-09-02
15. Internal: `05-product-strategy/proprietary-asset-inventory-raw.md` §7 (D-13) — dated
    2026-09-02
