---
id: B-DESK-02
title: TradingView as the desk uses it
role: B-DESK-02 — desk-tool benchmark author
wave: 1b
group: B
category: competitor
scope: TradingView, as embedded/linked from the UCT ecosystem — not the standalone product (see B-TV-01)
confidence: 🟡 medium overall, ceiling named per section
evidence_ceiling: No account-level UCT telemetry (click logs, TradingView referral counts) and no owner interview were available; the internal audits (D-13/D-14) establish WHERE TradingView appears in code but not HOW OFTEN or in what sequence a trader actually uses it. Public TradingView docs establish what the mechanics COULD support, not what the desk DOES with them.
sources: 5 primary (D-14 ecosystem cartography + 4 official TradingView pages fetched this session); 2 secondary (B-TV-01 sibling dossier, reused with citation, not re-fetched); D-13 as a negative/comparative source
uct_relevance: high
status: draft
date: 2026-09-02
---

# B-DESK-02 — TradingView as the desk uses it

**Scope discipline.** This is not a TradingView product benchmark — that is B-TV-01
(`03-competitive-research/tradingview/dossier.md`), read in full and not duplicated here.
This report reconstructs the **desk's loop**: what UCT's own code touches TradingView for
today, what that implies about the desk's and a member's actual workflow, and what UCT's own
charting stack already replaces. Per contract, the internal claims below are cited to D-13
(`05-product-strategy/proprietary-asset-inventory-raw.md`) and D-14
(`01-existing-system/ecosystem-cartography.md`) only — **no application code was read** for
this report. Where I reuse a TradingView-mechanics fact already fetched and quoted by B-TV-01
rather than re-fetching it myself, I cite it explicitly as "**via B-TV-01**" so the evidence
chain is honest about who actually made the HTTP request.

---

## 1. What the codebase actually does with TradingView today

**OBSERVATION.** Across the four repositories D-14 mapped, TradingView appears in exactly
one role: **a link and an embed, never a data source.** D-14's own external-dependency table
states it plainly: *"Link + embed only, never a data source. `tradingview.com/chart/?symbol=`,
`/widgetembed/?frame`"* — referenced from `morning-wire` and from the dashboard's
**TickerPopup** and **DrillModal** surfaces. The same table classifies this as a **"Link"**
dependency, distinct from the **"Dependency"** classification given to Finviz, Yahoo Finance,
EarningsWhispers, X/Twitter, Substack, Whop and Discord in the same table — those feed data
into the pipeline; TradingView does not. Separately, D-14's provider-host list for
`morning-wire` includes `www.tradingview.com` among the hosts it reaches, alongside
`elite.finviz.com`, `finnhub.io`, `financialmodelingprep.com`, confirming the newsletter
pipeline itself constructs TradingView links (not just the live dashboard).

**EVIDENCE.** D-14 §7 table row "TradingView" (ecosystem-cartography.md:840): *"Link + embed
only, never a data source... `morning-wire`, dashboard TickerPopup / DrillModal... **Link** —
and a direct competitor for the charting surface TERMINAL-NEXT would ship."* D-14 §7
INTERPRETATION (ecosystem-cartography.md:851-859): *"TradingView is the true competitive
benchmark: the product links to it and embeds it, meaning members currently leave the surface
to use it."* D-14 §1.4 host list (ecosystem-cartography.md:247) includes `www.tradingview.com`.

**INTERPRETATION.** The desk-facing product made a deliberate, narrow bet on TradingView: use
it as free/cheap embeddable chrome for two specific interaction points (a quick-look popup and
a breadth drill-down), and as an escape hatch link, while building UCT's own proprietary
charting, indicator and signal stack in-house (§3 below). This is a "link out, don't build a
second charting engine for every timeframe" decision, not an integration.

**RELEVANCE TO UCT.** For Terminal-Next, this narrows the real question from "should we
compete with TradingView" to "should we stop linking members to a competitor's surface for
the two moments (quick popup zoom, breadth drill-down) where we currently do."

**CONFIDENCE.** 🟢 — D-14 is a direct, dated, CONFIRMED-by-reading audit of the four
repositories' code references. **Ceiling:** D-14 states which files reference TradingView, not
how often the resulting links are clicked — no analytics on outbound TradingView clicks were
available to either audit.

**RECOMMENDATION.** Treat "Link + embed only" as the baseline TERMINAL-NEXT must beat before
removing either embed point — replacing an iframe with UCT's own chart is a like-for-like
swap only if the replacement covers the same timeframes.

**OPEN QUESTION.** What fraction of TickerPopup/DrillModal opens actually reach the
TradingView tab/link versus staying on the Finviz-image tabs or UCT's own `StockChart`
surfaces elsewhere in the product? Not answerable from D-13/D-14; would need frontend
analytics.

---

## 2. The desk's charting loop, reconstructed

**OBSERVATION.** D-13/D-14 do not describe a trader's session narrative directly (neither
report interviewed the owner or captured a session recording), so this loop is
**reconstructed** from where the two embed points sit in the product, cross-referenced against
the desk's other daily artifacts.

Two structurally different embed contexts exist, per D-14 §7:

1. **The quick-look context (TickerPopup).** A ticker click anywhere a `TickerPopup` is wired
   opens a small modal. D-14 groups this with DrillModal as one of the two live TradingView
   embed points.
2. **The drill-down context (Breadth DrillModal).** Clicking a breadth cell or a heatmap tile
   opens a modal whose job, per the rest of the ecosystem map, is diagnostic — "which names are
   behind this count."

Layered onto this: the **morning-wire pipeline itself constructs TradingView links**
(`www.tradingview.com` is a host it reaches, per D-14 §1.4), meaning a trader reading the
pre-market brief — the desk's actual start-of-day artifact, per D-14 §1.4's characterization of
`morning-wire` as "the busiest integration surface in the ecosystem" — can already click through
to TradingView from the newsletter itself, before ever opening the dashboard.

**The reconstructed loop:** brief lands (06:35 CT / 07:35 ET per D-14 §2.4) → trader reads
picks/candidates in the wire, several of which link to TradingView → trader opens the dashboard
for breadth/screener/candidates → a ticker click anywhere opens TickerPopup, which offers
TradingView among its tabs → a breadth-driven "who's behind this number" question opens
DrillModal, which also offers a TradingView tab. **What the loop conspicuously does NOT show,
per D-14's own dependency table, is TradingView anywhere in the scanning/screening step** — the
three Finviz-driven scans (PULLBACK_MA, REMOUNT, GAPPER_NEWS) that produce the wire's candidate
list are Finviz's job, not TradingView's (§5 below).

**EVIDENCE.** D-14 §7 (ecosystem-cartography.md:833-861); D-14 §1.4 host list and
INTERPRETATION (ecosystem-cartography.md:216-268); D-14 §2.4 confirming the 06:35 CT /
07:35 ET wire trigger (ecosystem-cartography.md:412).

**INTERPRETATION.** TradingView sits at the **narrative and inspection** edges of the desk's
day (read the brief, look something up, drill a breadth cell) — never at the **generation**
edge (the scan that finds the names in the first place). That asymmetry is the single most
load-bearing fact for the absorb/leave-external question in §7: the generation step is already
100% UCT/Finviz, so nothing there is "at risk" of TradingView dependency; the inspection step is
where UCT currently defers.

**RELEVANCE TO UCT.** If Terminal-Next's charting surface is judged only against the
inspection moments (quick popup, drill-down), it is competing on a narrow, already-partially-
won front. If it is judged against the desk's full loop including multi-timeframe technical
work, Pine-based screening, or alert management, D-13/D-14 provide no evidence UCT's product
currently does any of that inside the dashboard — that work, if it happens, happens off-product.

**CONFIDENCE.** 🟡 — the embed points and the wire's host list are 🟢 CONFIRMED; the
session-level narrative connecting them into a "loop" is inference, not observation (no click
telemetry, no owner interview).

**RECOMMENDATION.** Before designing a Terminal-Next charting surface, get one artifact this
report could not produce: an owner or desk-trader account of a real morning's click sequence.
D-13/D-14 can show where the doors are; only a session account shows which ones actually get
walked through, in what order, and how often.

**OPEN QUESTION.** Does the desk (as distinct from members) keep a TradingView tab open in
parallel all session, or only visit it transactionally from a UCT surface? D-13/D-14 cannot
distinguish "desk habit" from "code capability."

---

## 3. What UCT's own chart pane already replaces — and what it does not

**OBSERVATION.** D-13's "Indicator / formula engine" and "UCT Signature indicators" sections
describe a proprietary, in-house analog to the part of TradingView that a Pine-heavy trader
would otherwise reach for:

- A **closed formula grammar**, generated into `docs/formulas/GRAMMAR.md` from
  `closedTable.json` (manifest version 2), described as closed *"so one saved formula can sweep
  thousands of symbols on a schedule"* — i.e., built for batch/screener execution, not
  per-chart interactive plotting.
- `nativeRegistry.js` ships **15 indicators, 14 of them as engine definitions**, plus a
  `conceptVocabulary.json` backing an "English → formula" door (an internal analog to
  TradingView's AI Screener door, see §8).
- **UCT Signature indicators** (`api/services/signature/`) — `flow_breakout`, `gex_walls`,
  `darkpool_levels`, `confluence`, `sweep`, plus a generic `rsLine` tenant — accrue firings in
  an **append-only ledger** (`signature_signals`, keyed on `(indicator, version, sym, tf,
  bar_time, direction)`, `first_seen_at` immutable). D-13 calls this *"the only place in the
  product where an indicator's historical firings accrete under an immutable key."*

Separately, D-13's "Options Flow, Dark Pool, GEX" section (item 7) records a **public,
no-auth flow scoreboard** with LOCKED honesty rules — losers never excluded, contract-price
gains only — which is a claim TradingView (a data-agnostic charting layer, not a signal
publisher with its own track record) structurally cannot make about itself.

**What is NOT in D-13/D-14 evidence:** neither report describes a UCT surface offering
multi-timeframe interactive technical charting (the thing TickerPopup's 5min/30min/1hr
TradingView tabs and DrillModal's TradingView tab currently supply), nor a UCT equivalent of
Pine Script as a **user-authored, portable, chartable-and-screenable-and-alertable** object
(TradingView's own strongest documented workflow, per B-TV-01 §E route 2 — **via B-TV-01**).
D-14 lists a `morning-wire/parity/` directory as present but explicitly **not opened** in that
audit (ecosystem-cartography.md:993) — the contract's framing that "UCT maintains Pine parity"
is therefore corroborated only by the directory's existence, not its contents, under this
report's no-code-reading constraint.

**EVIDENCE.** D-13 §6 "Indicator / formula engine" and "UCT Signature indicators"
(proprietary-asset-inventory-raw.md:556-600); D-13 §7 "Options Flow, Dark Pool, GEX"
(proprietary-asset-inventory-raw.md:604-656); D-14 GAPS listing `morning-wire/parity/` as
unopened (ecosystem-cartography.md:993).

**INTERPRETATION.** UCT's own stack replaces the **batch/systematic** half of what a Pine-heavy
trader wants (a formula that sweeps thousands of symbols on a schedule, with an immutable
firing ledger — something TradingView's per-chart Pine execution model does not natively give
you outside Pine Screener, which is itself capped at "up to 3,500 symbols," per B-TV-01 §E —
**via B-TV-01**) and does not yet replace the **interactive/exploratory** half (open any symbol,
any timeframe, draw on it, eyeball it) that TickerPopup and DrillModal still defer to
TradingView for.

**RELEVANCE TO UCT.** This is the clearest asymmetry in the whole benchmark: UCT is
*ahead* of TradingView on auditable, accretive, systematic signal tracking (the Signature
ledger, the flow scoreboard's honesty rules) and *behind* on interactive multi-timeframe
charting — and the two embed points that still exist (TickerPopup, DrillModal) are placed
exactly where the *behind* half is needed, not the *ahead* half.

**CONFIDENCE.** 🟢 on the inventory of what D-13 documents existing; 🔴 on completeness of "what
UCT does NOT have," because absence-of-evidence in a proprietary-asset inventory is not proof
of absence in the product — D-13's own confidence line for this section is 🟢 on module
inventories, 🔴 on production row counts.

**RECOMMENDATION.** Before building new interactive-charting surface to displace the
TickerPopup/DrillModal TradingView tabs, confirm via the owner or a fresh code-reading role
whether `app/src/components/StockChart.jsx`'s existing Lightweight-Charts engine (referenced
only indirectly here, since this report may not read code) already covers 5min/30min/1hr — if
it does elsewhere in the product, the TradingView tabs in these two modals may be a legacy
choice rather than a genuine capability gap.

**OPEN QUESTION.** Does `morning-wire/parity/` implement a Pine-Script-equivalent execution
environment, a Pine *transpiler*, or a hand-ported subset of specific Pine indicators used at
the desk? The name and directory presence are D-14-confirmed; the contents are an explicit
GAP in that audit and were out of scope for this report.

---

## 4. What a member likely uses TradingView for

**OBSERVATION.** D-13/D-14 describe *code paths*, not *member intent*, so this section is
explicitly inferential. Members reach TradingView through the same two doors the desk does
(TickerPopup, DrillModal) plus whatever the morning-wire newsletter links to, since the wire is
mass-distributed (D-14 §1.4 frames morning-wire as pushing to `/api/push` and reaching every
subscriber, not a desk-only artifact).

**INTERPRETATION.** A member's TradingView usage is almost certainly narrower than a desk
trader's: a member has no evidence-based reason (per D-13/D-14) to author Pine, run the Pine
Screener, or maintain a TradingView watchlist tied to a broker — those are B-TV-01's
"active retail trader" and "prosumer" personas (§B of that dossier — **via B-TV-01**), and
nothing in D-13/D-14 shows UCT actively cultivating that behavior. The most defensible reading
is that a member's TradingView visits are **the same inspection-moment visits the desk makes**
(pop a chart, check a timeframe UCT doesn't natively show) rather than a parallel, independent
TradingView workflow.

**RELEVANCE TO UCT.** If member TradingView usage is confined to the same two inspection doors,
then a Terminal-Next charting upgrade that closes those two doors closes the *entire* member-
facing TradingView surface at once — there is no evidence of a third door.

**CONFIDENCE.** 🔴 — this is inference from the absence of any other TradingView reference in
either internal audit, not a positive observation of member behavior. No usage analytics,
support-ticket corpus, or member survey was in scope for either D-13, D-14, or this report.

**RECOMMENDATION.** A support-ticket or feedback-widget keyword sweep for "TradingView" would
convert this from inference to evidence cheaply — `FeedbackWidget` submissions are already a
DB table per the ecosystem the audits describe.

**OPEN QUESTION.** Do any members actually pay for their own TradingView subscription
independent of UCT, and if so, for which of B-TV-01's four personas (§B)? Not answerable from
these three sources.

---

## 5. Screeners: TradingView is not in this loop at all

**OBSERVATION.** D-14 §7 states the scanner's three screens (PULLBACK_MA, REMOUNT,
GAPPER_NEWS) are **Finviz** queries, run from `uct-intelligence/scripts/scanner_candidates.py`,
and classifies Finviz Elite as the desk's one **hard operational dependency** among external
tools — with an observed failure event cited (`logs/scanner_2026-08-31.log`: *"PULLBACK_MA —
no results from Finviz"* ×3 → `SCAN HEALTH FAILED`). TradingView's own screener products
(Stock Screener, Pine Screener, AI Screener — per B-TV-01 §D and §E, **via B-TV-01**) have zero
D-13/D-14 code references anywhere in the four repositories.

**EVIDENCE.** D-14 §7 (ecosystem-cartography.md:839, 848-849).

**INTERPRETATION.** This is the sharpest negative finding in this report: whatever a desk
trader might use TradingView's screener stack for personally, the firm's *production* scan
pipeline does not touch it at all, and Finviz — not TradingView — is the systematic-discovery
dependency that actually matters operationally.

**RELEVANCE TO UCT.** A "TradingView Pine Screener replaces our scanner" absorb/build decision
is not live — the scanner is already Finviz-plus-proprietary-scoring (D-13's 7-criteria candle
score 0-110, `_detect_wedge_flag`), and D-14 frames Finviz, not TradingView, as the benchmark
slot worth defending or replacing.

**CONFIDENCE.** 🟢 — D-14 explicitly searched for and reported zero TradingView references in
the screening code path, with a positive Finviz finding as contrast.

**RECOMMENDATION.** None needed for TERMINAL-NEXT's screener design specifically with respect
to TradingView — see the sibling `finviz.md` (B-DESK-03) contract for that benchmark.

**OPEN QUESTION.** None outstanding from this angle.

---

## 6. Alerts: TradingView's webhook mechanism vs UCT's own alert stack

**OBSERVATION.** D-13/D-14 record no code reference to TradingView alerts anywhere in the four
repositories — UCT's alerting is entirely home-grown (D-13 does not detail
`watchlist_alert_service` internals since this report may not read code, but D-14's own
provider-dependency table lists Discord — not TradingView — as the alert-delivery channel
throughout the ecosystem). Independently, TradingView's own webhook mechanism (fetched this
session, official docs) works as follows: *"A TradingView webhook notifies your external app
when an alert is triggered... we can automatically send data via an HTTP POST request to a URL
you provide."* JSON payloads are auto-detected by content; **2-factor authentication is
mandatory** for webhook alerts; only ports 80/443 are accepted; a receiving server has a
**3-second** timeout to respond.

**EVIDENCE.** TradingView, "About webhooks,"
https://www.tradingview.com/support/solutions/43000529348-about-webhooks/, official help
center, fetched 2026-09-02 — **verified** (fetched directly this session). D-14's absence of
any TradingView-alert code reference — negative evidence from a CONFIRMED-by-reading audit
(ecosystem-cartography.md, full document).

**INTERPRETATION.** The mechanism exists for a desk trader to point a TradingView alert
directly at a UCT-owned endpoint (or the same Discord webhook UCT already alerts through per
D-14), which would let a trader author a TradingView/Pine-based condition and have it land in
the same channel as UCT's native alerts — without any product work on UCT's side beyond
accepting the POST. Nothing in D-13/D-14 shows this bridge exists today.

**RELEVANCE TO UCT.** This is a genuinely low-cost "leave-external-but-bridge" option: rather
than rebuilding TradingView-grade alert conditions natively, UCT could document a pattern for
piping a desk trader's TradingView alerts into the same Discord/UCT alert surface members
already watch — turning a competitor surface into an upstream sensor instead of a destination.

**CONFIDENCE.** 🟢 on the webhook mechanism itself (official docs, fetched directly). 🔴 on
whether the desk uses TradingView alerts at all today — no evidence either way in D-13/D-14.

**RECOMMENDATION (hypothesis).** *A documented "point your TradingView alert webhook at this
UCT endpoint" bridge may capture the alerting workflow's value without building alert-condition
authoring natively — worth a cheap owner conversation before any build decision.*

**OPEN QUESTION.** Does the desk currently run any TradingView alerts at all? Zero evidence
either way from D-13/D-14; this is a direct owner question.

---

## 7. Switching-cost inventory

**OBSERVATION**, assembled from what D-13/D-14 make measurable plus one honest set of
unknowns:

| Switching-cost dimension | What D-13/D-14 show | Verdict |
|---|---|---|
| **Data** | None — D-14 explicitly classifies TradingView as never a data source for UCT. Nothing to migrate. | **No cost.** |
| **Habits / muscle memory** | Not measurable from these sources — no click telemetry, no session recordings, no owner interview in scope. B-TV-01 documents TradingView's type-to-search and modifier+cursor idioms as genuinely fast (**via B-TV-01**, §C, §J) — if desk traders have internalized those, that habit cost is real but **unquantified here**. | **Unknown, plausibly real.** |
| **Integrations** | Zero code-level integration found (no API keys, no webhook consumption, no Pine push) — D-14's provider-dependency table (§6.2) does not list TradingView among the 23 cost-bearing/dependency rows at all. | **No cost.** |
| **Broker linkage** | TradingView's own broker order-routing (28+ brokers per B-TV-01 §D, **via B-TV-01**) has zero D-13/D-14 reference — UCT's own broker linkage runs through SnapTrade for Journal 2.0's sync, a wholly separate system not connected to TradingView in any way these audits found. | **No cost.** |
| **Content/publishing lock-in** | None visible — D-13/D-14 show no UCT-authored Pine scripts published to TradingView's library (the `parity/` directory's contents are unread, so this cannot be ruled out entirely, see §3's open question). | **Likely no cost, unconfirmed.** |

**INTERPRETATION.** On every dimension D-13/D-14 can actually measure, switching cost is
**structurally near-zero** — because there is nothing to switch: no data pipeline, no API
integration, no broker link, no content published outward. The only place real switching cost
could hide is exactly the place these two audits could not see: an individual desk trader's
personal habits and any TradingView account state (saved layouts, personal watchlists, Pine
scripts) that lives entirely inside TradingView's own account system, invisible to any UCT
repository.

**RELEVANCE TO UCT.** This inverts the usual "hard to leave a data provider" story: leaving
TradingView costs UCT-the-product almost nothing structurally. The real cost, if any, is
**human** — a desk trader's practiced workflow — and that cost is invisible to code-only
research by construction.

**CONFIDENCE.** 🟢 on the code-measurable dimensions (data/integration/broker — all
CONFIRMED-absent by D-14's dependency table). 🔴 on habits — genuinely NOT DETERMINED, named
explicitly rather than guessed at.

**RECOMMENDATION.** Do not let a near-zero *structural* switching cost read as a near-zero
*human* switching cost. The cheapest way to close this gap is the same owner conversation named
in §2's recommendation.

**OPEN QUESTION.** Same as §2 and §4 — unresolved without an owner/desk account.

---

## 8. Absorb / integrate / leave-external — verdicts per workflow

Each verdict is a hypothesis with its supporting D-13/D-14 or TradingView-doc evidence, per the
contract's required framing.

1. **Quick-look chart popup (TickerPopup's 5min/30min/1hr TradingView tabs).**
   *Hypothesis: ABSORB is plausible if UCT's own chart engine already renders these
   timeframes elsewhere in the product* (D-13 does not confirm or deny this for TickerPopup
   specifically — code-reading is out of scope for this report). Evidence: D-14 §7 places this
   embed at the inspection edge, not the generation edge (§2 above), which is the cheapest kind
   of TradingView dependency to replace since no data pipeline change is implied. 🟡.

2. **Breadth drill-down chart tab (DrillModal's default "TradingView" tab).**
   *Hypothesis: ABSORB, lower urgency than #1* — this is a diagnostic "who's behind this
   number" surface, not a primary analysis surface; a simpler embedded chart (or the two Finviz
   PNG tabs already present alongside it, per this program's CLAUDE.md context) may already be
   "good enough" for the diagnostic job. D-13/D-14 provide no usage split between DrillModal's
   three tabs to confirm which one carries the diagnostic weight. 🔴 — pure hypothesis.

3. **Systematic screening (Finviz scans → candidates).**
   *Hypothesis: LEAVE-EXTERNAL-AS-IS, but the external dependency is Finviz, not TradingView* —
   this workflow does not touch TradingView at all today (§5). No action needed with respect to
   TradingView specifically. 🟢, since this is a negative/absence finding D-14 confirms
   directly.

4. **User-authored systematic signals (Pine-equivalent).**
   *Hypothesis: INTEGRATE — UCT already owns the batch-execution half (closed formula grammar,
   Signature ledger, per D-13 §6) that Pine Script does not natively provide outside its 3,500-
   symbol-capped Screener (per B-TV-01 §E, **via B-TV-01**); the gap is authoring ergonomics
   and portability across surfaces (chart + scan + alert from one definition), which is exactly
   what B-TV-01's "Best idea #6" (user scripts as first-class objects) targets. This report adds
   the internal half: UCT's own closed grammar is architecturally closer to Pine Screener's
   batch model than to Pine's per-chart interactive model, so the natural absorption path is
   "extend the closed grammar's authoring UX," not "embed Pine."* 🟡 — grounded in D-13's
   architecture description, speculative on the authoring-UX gap since no UCT authoring UI was
   read.

5. **Alert conditions (Pine-based technical alerts → webhook).**
   *Hypothesis: BRIDGE, not absorb or leave-external as a binary* — per §6, the mechanism to
   pipe a TradingView alert into UCT's existing Discord alert channel exists today at zero
   TradingView-side cost; whether it's worth documenting depends entirely on whether desk
   traders use TradingView alerts at all, which is an **OPEN QUESTION** this report cannot
   close. 🔴 pending that owner answer.

**CONFIDENCE (section-level).** 🟡 average — verdicts #3 and #5's mechanism are 🟢-grounded;
#1, #2 and #4 are architecturally grounded but usage-blind, which the contract's evidence
standard requires flagging rather than smoothing over.

---

## 9. TradingView's AI/automation features and the calculus

**OBSERVATION.** Per B-TV-01 §I (**via B-TV-01**, not re-verified this session), TradingView
ships exactly one user-facing AI feature: the **AI Screener** (public beta, announced
2026-08-17, Stock Screener only), which converts a natural-language prompt into a finished,
*inspectable* screen configuration with a filter-by-filter Explanation panel, rather than a
generated prose answer. D-13 §6 independently documents UCT's own analog on the *charting*
side — `conceptVocabulary.json` backing an "English → formula door" for the closed grammar —
though D-13 does not describe whether that door produces an inspectable, editable
configuration the way TradingView's Explanation panel does, or a black-box result.

**EVIDENCE.** D-13 §6 (proprietary-asset-inventory-raw.md:556-561). TradingView AI Screener
facts reused from B-TV-01 §I, itself sourced to
https://www.tradingview.com/blog/en/ai-screener-60101/ (official blog, 2026-08-17,
fetched by B-TV-01 2026-09-02) — **via B-TV-01, not independently re-fetched this session.**

**INTERPRETATION.** TradingView's AI Screener does not change the absorb/leave calculus for
*charting* — it is a screener feature, and TradingView is already absent from UCT's screening
pipeline (§5). Its actual relevance to this report is as a **design pattern**: TradingView
converged, from the opposite direction, on the same "make AI output inspectable as structure,
not prose" doctrine D-13/D-14 independently document UCT already practicing elsewhere (the COT
narrative grounding gate, `CoverageLine`'s four-count receipt — referenced in this program's
other internal reports, not re-cited here since they fall outside D-13/D-14's scope for this
contract).

**RELEVANCE TO UCT.** If UCT's own `conceptVocabulary.json` English-to-formula door is or
becomes member/desk-facing, TradingView's Explanation-panel pattern (show the filters, not a
paragraph) is a directly transferable UX target — this is corroboration from two independent
directions (UCT's existing doctrine, TradingView's shipped feature), not a new idea.

**CONFIDENCE.** 🟡 — D-13's side is 🟢 (module presence confirmed); TradingView's side is
inherited from B-TV-01's own 🟡 rating on that section (the feature's actual behavior was never
run in a logged-in session — **via B-TV-01**).

**RECOMMENDATION.** No new build implied. Worth one line in Terminal-Next's design doctrine:
*any natural-language-to-scan/formula door should render as an editable, inspectable
configuration, never as prose* — already true of UCT's grounding-gate doctrine elsewhere, and
now independently corroborated by a competitor.

**OPEN QUESTION.** Does `conceptVocabulary.json`'s English→formula door currently render an
inspectable/editable result, or a black-box one? Not answerable without reading the frontend
that consumes it — out of scope for this report.

---

## 10. Pricing/tier facts

**OBSERVATION.** UCT's own code shows zero TradingView subscription cost — D-14's provider-cost
table (§6.2, "cost-bearing?" column) does not list TradingView among the 23 rows at all,
consistent with §1's finding that no API key or paid integration exists. Any TradingView
subscription cost in this ecosystem is therefore **personal to whichever individual (desk
trader or member) pays for their own account** — not a line item in UCT's infrastructure
spend.

For reference (facts already fetched and verified by B-TV-01 §L, reused here rather than
re-fetched — **via B-TV-01**, https://www.tradingview.com/pricing/, official pricing page,
2026-09-02): the public consumer ladder runs Basic ($0) → Essential ($12.95/mo) → Plus
($29.95/mo) → Premium ($59.95/mo) → Ultimate ($199.95/mo), metered by chart count, indicator
count, alert quotas and history depth rather than gated by feature; **only Ultimate is sold to
professional users** per TradingView's own pricing copy. Real-time market-data entitlements are
priced separately per exchange ($3–$50/mo non-professional, $25–$50+/mo professional, per
exchange).

**EVIDENCE.** D-14 §6.2 (ecosystem-cartography.md:760-796, no TradingView row). Pricing figures
via B-TV-01 §L, sourced to the official pricing page, fetched 2026-09-02.

**INTERPRETATION.** If any desk trader is on TradingView Premium or Ultimate specifically for
professional-tier features (16 charts, 50 indicators, deeper alert quotas, tick data), that is
an individually-borne cost with zero visibility to UCT's own infrastructure accounting — a real
but currently invisible cost D-13/D-14 cannot surface because it lives outside any UCT-owned
system.

**RELEVANCE TO UCT.** If Terminal-Next aims to make a desk trader's personal TradingView
subscription unnecessary, the relevant tier to beat is whichever one the desk actually pays
for — and that fact is not recoverable from D-13/D-14 or this report; it requires the owner.

**CONFIDENCE.** 🟢 on "UCT bears zero TradingView cost structurally" (D-14's dependency table is
exhaustive and dated). 🔴 on any individual's personal subscription tier/cost.

**RECOMMENDATION.** None beyond the recurring one: ask the owner which tier(s), if any, desk
traders currently pay for personally.

**OPEN QUESTION.** Same as above.

---

## GAPS

**Search channel used.** Per the preamble's search budget: **WebFetch on known URLs only**, no
browser tab opened this session (unnecessary — the sibling B-TV-01 dossier already exhausted
the highest-value browser-search discovery work for TradingView's own site, and this report's
job was internal reconstruction plus a handful of targeted mechanics checks). Four WebFetch
calls made this session: TradingView Advanced Chart Widget docs (low yield — the page is
marketing chrome with no feature-comparison content), the Advanced Chart Widget product page
(same low yield), Pine Script publishing docs (high yield — private/public/invite-only model),
and the webhooks help article (high yield — POST mechanism, 2FA requirement, timeout).

**Budget not reached — specific gaps:**

1. **No owner or desk-trader interview.** Every "reconstructed loop" section (§2, §4, §6, §7)
   names this as its ceiling explicitly. This is the single highest-value follow-up for the
   whole report — a five-minute account of one real morning's click sequence would upgrade §2,
   §4, §6 and §7 from 🟡/🔴 to 🟢 simultaneously.
2. **`morning-wire/parity/` contents unread.** D-14 confirms the directory exists and was
   explicitly not opened in that audit; this report inherited that gap rather than closing it
   (closing it would mean reading code, out of scope for this role). This is the one place a
   genuine Pine-parity implementation detail could be hiding.
3. **No click/analytics data on TickerPopup/DrillModal's TradingView tabs.** §1 and §3's open
   questions both depend on this.
4. **No support-ticket or feedback-widget keyword sweep for "TradingView."** Named as the
   cheapest way to convert §4's inference into evidence; not run (would require reading
   `auth.db`'s feedback table, out of scope — internal reports only, per contract).
5. **The widget-embed feature-parity question (does the free `/widgetembed/` iframe UCT links
   to include Pine/alerts/saved layouts) was not resolved by direct fetch** — both widget pages
   fetched this session were marketing chrome with no explicit feature-exclusion statement.
   §3's claim that it is "the free/anonymous widget, not an authenticated session" is
   INTERPRETATION from D-14's framing ("never a data source," "Link + embed only") plus general
   knowledge of TradingView's public embed product, not a directly quoted TradingView statement
   — flagged accordingly in-line.

---

## SOURCES

1. D-14 — Ecosystem cartography — repositories, scheduled jobs, Railway topology, external
   surfaces. `01-existing-system/ecosystem-cartography.md`. Internal audit, CONFIRMED-by-reading
   throughout, dated 2026-09-02. Tier: internal primary. Sections cited: §1.4, §2.4, §6.2, §7,
   GAPS.
2. D-13 — Proprietary asset inventory (raw). `05-product-strategy/proprietary-asset-inventory-raw.md`.
   Internal audit, dated 2026-09-02. Tier: internal primary. Sections cited: §6 (Themes/
   Screener/Catalysts/Breadth/COT/Indicators), §7 (Options Flow/Dark Pool/GEX).
3. B-TV-01 — TradingView benchmark dossier. `03-competitive-research/tradingview/dossier.md`.
   Sibling internal report, dated 2026-09-02, itself sourced to 48 primary TradingView pages.
   Tier: internal secondary (reused with explicit "via B-TV-01" attribution wherever its
   already-fetched facts are cited here rather than independently re-verified).
4. TradingView, "About webhooks" —
   https://www.tradingview.com/support/solutions/43000529348-about-webhooks/. Official help
   center. Tier 1. Fetched directly 2026-09-02. **Verified.**
5. TradingView, Pine Script publishing docs —
   https://www.tradingview.com/pine-script-docs/writing/publishing/. Official documentation.
   Tier 1. Fetched directly 2026-09-02. **Verified.**
6. TradingView, Advanced Real-Time Chart widget docs —
   https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/. Official
   documentation. Tier 1. Fetched directly 2026-09-02. **Verified presence/framing only** — low
   evidentiary yield, see GAPS item 5.
7. TradingView, Advanced Chart widget product page —
   https://www.tradingview.com/widget/advanced-chart/. Official product page. Tier 3. Fetched
   directly 2026-09-02. **Verified presence/framing only** — same low-yield caveat.
