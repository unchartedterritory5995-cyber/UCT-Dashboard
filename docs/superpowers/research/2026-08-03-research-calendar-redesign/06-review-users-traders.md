# Usability Review Panel — 6 Active-Trader Personas
## Earnings Modal + Research Page Redesign

**Materials reviewed:** Design spec `docs/superpowers/specs/2026-08-03-research-calendar-redesign-design.md` + approved mockups 01–11 (`.superpowers/brainstorm/345223-1785804114/content/`).
**Method:** Each persona walked the modal Setup section (spec §4.3.1, mockups 04/05/05b/06), then the full modal (§4.2–4.4) and research page (§5) as their workflow demanded. Judged the design **as specified** — no invented features except where a persona's core need is genuinely unmet.

---

## Persona 1 — "Dex" · Momentum day trader
*Pre-market triage: 40 tickers in 20 minutes, keyboard-first, two coffees deep by 7:15 AM.*

**(a) 60-second first reaction — Setup section.**
"Banner first: ticker, AMC/BMO with confirmed badge, countdown, live price, a grade chip. That's my whole triage line in one glance — better than EarningsWhispers' calendar rows. Setup canvas: implied-vs-realized pairs I can read in two seconds (hollow tall + solid short = rich, skip the debit spread), the dollar break-even strip gives me the two levels to write down, and the reaction bars with the gold implied bracket tell me instantly whether tonight's pricing is bigger than anything this name has actually done. Thirty seconds per ticker is achievable *if* arrow-key stepping is as fast as promised (§7 'reuses mounted shell, no remount flash' — hold them to that). Key-stats strip is filler for me; avg vol is the only one I read."

**(b) The moment they'd get confused or misled.**
Cold-cache mornings. The verdict grade needs four inputs — beat streak, 30d revisions, RS rank, IV premium (§4.2) — and IV comes off a Massive chain fetch on a 15-min cache + serve-stale (§6). At 6:35 AM I'm the *first* person to open most of these 40 names, so serve-stale has nothing to serve. Does the grade chip skeleton for 4–8 seconds on every fresh ticker? During the exact 20-minute window this product exists for? The spec defines SkeletonBlock for sections (§4.4) but never says what the *banner verdict* does while inputs are still loading — and a grade that silently renders from 3 of 4 inputs without saying so is worse than a skeleton.

**(c) What they'd praise.**
- Arrow-key ← → through the day's reporters, in the same order/filter my calendar view had (§4.4) — this is the single feature that makes 40-in-20 real.
- Post-report banner flip is pure data, no LLM (§4.2) — I don't have to wait for an AI paragraph to know beat/miss.
- Pinned footer with flag-to-watchlist (§4.4) — triage output is a watchlist; the action lives where my eyes already are.
- One loading idiom, retry links, never a blank canvas (§4.4) — the current modal punishes fast clicking.

**(d) #1 change request.**
Full keyboard grammar, not just ← →: number keys or ↑↓ for rail sections, **F** to flag, **Enter** to open full report, **C** for chart. My hands never touch the mouse pre-market. (Secondary: show gap % vs prior close next to the live price in the banner during pre/post sessions — session-aware price is specified, the *delta* isn't.)

**(e) Subscribe vs EarningsWhispers?** **YES** — conditional. EW gives me timing certainty; this gives timing certainty *plus* the setup read and a flag action in one keyboard loop. Condition: the verdict chip and Setup hero must be warm-or-honest at 6:30 AM. If I stare at skeletons for the first 20 tickers, I'm back on EW by Thursday.

---

## Persona 2 — "Marisol" · Swing trader holding through earnings
*Holds 5–8 positions 2–8 weeks; twice a quarter one of them reports while she's in it. Cares: expected move vs her stop, how this name actually trades its prints.*

**(a) 60-second first reaction — Setup section.**
"This section was built for my Tuesday-night decision: hold, trim, or exit before the print. The implied-vs-realized pairs answer 'is the market bracing for something unusual,' the **dollar** break-even strip converts ±6.8% into $171.70 / $196.75 — numbers I can hold against my stop and my cost basis without a calculator — and the WORST stat tile is my honest downside anchor. The starred beat-but-sold-off quarters are the exact trap that has burned me twice: good numbers, red stock. Eight quarters of history side-by-side with beat dots means I stop keeping this in a spreadsheet."

**(b) The moment they'd get confused or misled.**
**What horizon is ±6.8%?** The implied comes from an ATM straddle mid (§6 row 1), which prices the move *through that option's expiry* — but every historical comparison in the section is **next-day** (reaction bars = "next-day move bars," §4.3.1b; realized bars colored "by close direction," §4.3.1a). If the front expiry is 8 days out, the straddle number includes a week of ordinary vol on top of the event. I will read "priced ±6.8%, moves ±5.1% avg" as *tomorrow's* expected range and size my risk off it — and be systematically wrong in the direction of over-estimating the event move. The spec never states the horizon, the expiry used, or whether the event move is isolated. One caption line fixes the confusion; the methodology choice behind it is a real decision the spec hasn't made.

**(c) What they'd praise.**
- Dollar break-even RangeSlider under the hero (§4.3.1a) — the single most position-holder-friendly widget in the whole design.
- Beat-but-sold-off stars + the "guidance is the trigger" framing (mockup 06) — reaction ≠ result is *the* swing-holder lesson, drawn instead of preached.
- Color grammar (§3.3): green/red only for realized, hollow/grey for expectations — I can trust color at a glance.
- Expected-move band + earnings markers on the research-page price chart (§5.3 Overview) — my planning view and my earnings view finally agree.

**(d) #1 change request.**
Show **post-earnings drift**, not just the next-day bar. The unified endpoint already computes gap *and* drift per quarter (§6 row 3) — the data is being built and then not rendered. Even a small gap-vs-drift split on the reaction bars (mockup 06 option C, unchosen) tells me whether this name gap-and-goes or fades by day 3 — which is the difference between "exit into the pop" and "hold the week."

**(e) Subscribe vs EarningsWhispers?** **YES.** EW tells me *when*; this tells me *how bad it can get and how this name behaves after*, in dollars, against my levels. Nothing in my current stack (EW + broker + spreadsheet) does the implied-vs-realized history at all. The horizon label is a must-fix, not a dealbreaker.

---

## Persona 3 — "Priya" · Options premium seller
*Sells iron condors and strangles into earnings on liquid names; lives on IV rank, straddle pricing, and skew. Currently pays for Market Chameleon.*

**(a) 60-second first reaction — Setup section.**
"They shipped Market Chameleon's signature — implied-vs-realized pairs across 8 quarters — and nobody else in this price bracket has it. The RICH/CHEAP chip with 'priced ±x%, moves ±y% avg' is precisely my trade thesis stated as a sentence, and the tooltip audit trail on the banner grade (§4.2, 'formula documented in code') is the right instinct: deterministic, inspectable, no LLM in my numbers. The dollar strip is my short strikes' first draft. Then I went looking for the expiry the straddle came from... and it isn't anywhere."

**(b) The moment they'd get confused or misled.**
**The RICH/CHEAP chip, exactly as I feared — no days-to-expiry, no expiry identity, no event-vol isolation.** Three compounding problems, all in §4.3.1a + §6:
1. **A straddle mid on Monday for a Thursday reporter carries 3 days of ambient vol** on top of the event move. Compared against a *next-day realized* average, the chip will read RICH early in the week on nearly every name, then drift toward honest as expiry approaches. A verdict that flips with the calendar, presented without the calendar, is a misleading verdict — and it points in the direction that makes premium *sellers* overconfident.
2. **Which expiry?** Front weekly vs next monthly changes the number materially. Unstated.
3. **The historical "implied at the time" pairs** (§6 row 2) are stored "nightly near each report date" — *which* night? T-1 close is the standard; if some quarters snapshot T-3 and others T-1, the hollow bars aren't comparable to each other, and the whole hero quietly rots. The forward-filling honesty ("implied history since 2026-08") is good; the snapshot definition is the part that decides whether I trust it.

**(c) What they'd praise.**
- In-house implied from Massive chains with IV cross-check (§6) replacing the slow yfinance straddle — fresher marks, and 15min + serve-stale is a sane cadence for this.
- The honest empty-history behavior — hollow bars appearing as data accrues instead of a fabricated backfill (§6 row 2). Rare discipline.
- "Consensus drift, never 'whisper'" labeling rule (§6 row 4) — same discipline applied to language.
- Green/red = realized only (§3.3): implied stays hollow. My eye can separate priced from delivered instantly.

**(d) #1 change request.**
Put the contract identity on the chip: **"±6.8% · Aug 8 straddle · 3 DTE"** — and pin the stored implied snapshot to T-1 close in the spec. If the team wants full credit: an event-isolated implied (strip the ambient-vol floor) makes RICH/CHEAP genuinely honest, but even without that, showing DTE lets *me* do the correction in my head. Cost: one line of text sourced from data already fetched.

**(e) Subscribe vs Market Chameleon?** **MAYBE.** As specified, this replaces my *calendar triage* layer, not my pricing layer — no skew, no term structure, no IV rank, and I accept those are out of scope for v1. But the RICH/CHEAP chip is the surface's centerpiece verdict, and a centerpiece verdict I can catch being wrong on Mondays poisons my trust in every other chip on the platform. Add DTE + snapshot definition and I'm a yes for the calendar workflow while keeping MC for structure.

---

## Persona 4 — "Tommy" · Earnings-gap gambler
*Trades the after-hours print reaction, 4:00–5:30 PM. Speed is the entire product. Currently: EarningsWhispers + Twitter + broker AH ladder.*

**(a) 60-second first reaction — Setup section.**
"Pre-scan use at 3:45 PM: arrow through tonight's reporters, read the implied bracket over the reaction history — that tells me what a 'real' move is for each name and which ones have juice (implied way above anything realized = crowded, fade candidate; implied below the typical delivered = cheap convexity). The starred beat-but-sold-off quarters are my whole strategy rendered as an icon. Banner countdown to the call is useful. Fine. But my session starts at 4:05, and that's where I have questions."

**(b) The moment they'd get confused or misled.**
**The 4:05–4:15 dead zone is unspecified, and the flip mechanics are hand-waved.** The spec defines two banner states: pre-report ("Reports tonight AMC · call 5:00 PM ET" + countdown) and post-report ("Beat $0.98 vs $0.94 · guidance raised · +4.2% AH") (§4.2). Between them is my entire trade window:
1. At 4:06 the PR is out, the stock is −9% AH, and the countdown has expired. What does the banner say? As specified: nothing new — presumably a stale "Reports tonight" next to a session-aware price that's already moving. A banner asserting the report hasn't happened while the tape screams that it has is actively misleading.
2. **How fast does the flip happen?** Actuals ride the unified earnings-history endpoint composed from FMP `stable/earnings` (§6 row 3) with "30d cache for closed quarters" — but there's no stated refetch cadence for *tonight's* quarter. FMP actuals can lag the PR by many minutes to an hour. SWR's normal polling won't cut it; nothing in §7 defines a report-night fast path.
3. **"guidance raised" — from what data?** The flip is declared "pure data, no LLM" (§4.2), but no provider row in §6 supplies a guidance-direction field. Guidance verdicts today come from the LLM call-recap pipeline. Either this line silently never renders, or it quietly isn't pure data. Unresolved either way.

**(c) What they'd praise.**
- Session-aware live price at 15s in the banner (§4.2) — the AH move itself will be honest and fresh even before the numbers land.
- The implied bracket over reaction history (§4.3.1b) — my pre-scan edge; nobody else shows "options paid for ±6.8% and this name has only delivered that twice" at a glance.
- Arrow-key stepping (§4.4) = my 3:45 PM slate scan and my 4:30 PM damage tour, both.
- Pure-data flip *concept* — when it works, it beats waiting for anyone's AI paragraph.

**(d) #1 change request.**
Specify the report-night state machine: **(i)** an interim banner state at T-0 — "**Reported — awaiting numbers · −9.2% AH**" (the AH% is computable *now* from the live price; ship it before EPS lands); **(ii)** an aggressive refetch window for tonight's reporters (e.g., 30–60s polling 4:00–6:00 PM ET, single-flight per the house serve-stale pattern); **(iii)** drop or re-source "guidance raised." The AH-move-vs-implied comparison in the banner ("moving ±9.2% vs ±6.8% priced") is the killer version — both numbers already exist in the modal.

**(e) Subscribe vs EarningsWhispers?** **MAYBE.** The pre-scan (implied bracket + reaction history + arrow keys) is better than anything EW gives me and I'd use it every afternoon. But at 4:05 PM speed is binary, and as specified this surface goes silent exactly then. Twitter + EW keep the AH seat until the flip latency is defined and proven. Fix finding (d) and I convert, because then one tab does the scan *and* the print.

---

## Persona 5 — "Gerald" · IBD/CANSLIM devotee, MarketSurge refugee
*20 years of CAN SLIM. Left MarketSurge over price but misses Composite/RS/EPS ratings and Stock Checkup. Deeply allergic to made-up-looking scores.*

**(a) 60-second first reaction — Setup section (then straight to Ratings).**
"In the modal: the '7/8 BEATS · AVG SURPRISE +4.2%' streak chips are my 'C' in CAN SLIM, and the lollipop's rising dot line shows EPS *trajectory*, not just beats — that's more honest than IBD's own table. Revisions momentum ('21↑/3↓') in the Analyst panel is the institutional-demand tell. But I notice the modal banner has no RS, no EPS rating — the grade chip folds RS in but I have to hover a tooltip to see it (§4.2). Then I opened the research page, and the RatingCrown + CheckupRow section is clearly aimed at my MarketSurge muscle memory — so it gets judged by MarketSurge rules."

**(b) The moment they'd get confused or misled.**
**A composite "98" wearing a MarketSurge costume without a MarketSurge denominator.** MarketSurge's 98 *means* 98th percentile of the whole market — 25 years of my pattern recognition is calibrated to that. This crown's number is "Absolute v1" (§5.3 Ratings), a formula score, not a ranking — and the disclosure is a small basis pill in jargon no civilian parses. Every migrating IBD user will read the ring as a percentile until the day the percentile job ships and half the numbers move — at which point the platform looks like it was wrong *before*, even though it was just labeled quietly. The mockups make it worse: screen 09 option D literally renders "96th percentile" copy, so the visual language actively invokes the percentile frame the data can't back yet.

**(c) What they'd praise.**
- **One rendering of ratings** (§5.3 Overview: crown is "the only ratings rendering on the page," header badge a compressed echo). Today's three-different-numbers disease was disqualifying; this fixes the credibility floor.
- CheckupRow **actual-vs-threshold** ("ROE 28.4% vs 17% req ✓," §5.3) — IBD Checkup shows pass/fail; showing the *margin* against the requirement is genuinely better than the thing I'm grieving.
- The `method` provenance footnote kept (§5.3) and the crown pre-built to receive the percentile basis without redesign — architectural honesty.
- Heat-shaded quarterly acceleration grids with click-row trend charts (§5.3 Financials) — that's my 'A' (annual/quarterly acceleration) made visual.

**(d) #1 change request.**
Make the basis impossible to misread: rename the pill to plain English ("**Formula score — not yet a market-wide rank**"), put the scale ("0–100, absolute") in the crown's always-visible caption, and have the tooltip state what changes when Percentile·N lands. If the number will move at cutover, tell me *now* — I'll forgive a relabel, never a silent restatement.

**(e) Subscribe vs MarketSurge?** **MAYBE — leaning yes.** At a fraction of $150/mo, with checkup transparency MarketSurge doesn't offer and earnings surfaces it's never had, I'd trial immediately. Whether I *stay* is decided by ratings honesty: fix the labeling and ship the percentile job on the stated roadmap and I'm a convert; let one number quietly mean two things and I churn loudly in the IBD forums.

---

## Persona 6 — "Viktor" · Power user, 3 monitors
*Left monitor charts, center execution, right research. Keyboard maximalist, URL-state connoisseur, chronic multi-ticker comparer.*

**(a) 60-second first reaction — Setup section.**
"Structurally right: two-pane rail instead of a 26-section scroll, pinned banner/footer, sections lazy-load with Setup prefetched (§7), AbortController on symbol switch so fast stepping doesn't ghost-render stale data — someone has actually operated software before. `?earnings=SYM` deep links (§4.4) mean the modal can live on monitor 3 as a pinned window while the chart holds monitor 1 — that's my whole layout enabled by one query param. `?section=` on the research page too (§5.1). Arrow keys step the day's reporters without remount flash. Then I mentally pressed → fifteen times and asked what the Back button does now."

**(b) The moment they'd get confused or misled.**
**The interaction-state contract is three-quarters specified, and the missing quarter is where power users live.** Specifically (§4.4):
1. **History stack vs arrow keys.** Opening pushes `?earnings=SYM` via pushState "so browser Back closes the modal." If each arrow-step *also* pushes, then after stepping 15 reporters, Back rewinds 15 tickers before closing — the stated Back contract silently breaks under the surface's own flagship interaction. Steps must replaceState (or the contract needs restating). Unspecified.
2. **Modal section isn't in the URL.** `?earnings=NVDA` always lands on Setup; I can't link a colleague to the Call section, and my pinned monitor-3 window can't restore to Filings after a refresh. The page got `?section=`; the modal didn't.
3. **Scroll state across rail switches.** "No global scroll column" means each canvas scrolls; nothing says whether Call's transcript scroll position survives a Setup round-trip. Lazy-load "on first visit" implies sections stay mounted — implies, not states. If switching resets my place 400 lines into a transcript, I feel it fifty times a day.

**(c) What they'd praise.**
- URL state everywhere, applied to all three mount points (§4.4) — this quietly makes multi-window/multi-monitor workflows possible without a "feature."
- One visual system, modal-as-page-in-miniature (§2.3) — context switching between surfaces costs nothing cognitively.
- Escape pops the same history entry it pushed (§4.4) — keyboard and browser semantics agreeing is rarer than it should be.
- Zero new dependencies + tree-shaken ECharts (§3.4, §7) — a power user's machine runs 40 tabs; bundle discipline is a feature.

**(d) #1 change request.**
**Multi-ticker compare.** Deep links let me brute-force it with two windows (and I will), but earnings week is inherently comparative — NVDA vs AMD implied, reaction history, revisions, side by side. Even v1-cheap: an "open in second pane" affordance, or `?earnings=NVDA,AMD` rendering two banners' stat rows stacked. Absent that, TradingView keeps a permanent tab for the one thing this platform won't do. (Tied fix bundle from (b): replaceState on step, `&esection=`, per-section scroll retention — those are spec sentences, not features.)

**(e) Subscribe vs the field?** **YES.** The rail architecture + URL state + keyboard stepping + one design system is a workflow product, not a widget pile — that's what I pay for. The compare gap keeps one TradingView tab alive, but this becomes monitor 3's resident app on day one.

---

# Moderator Synthesis

## Patterns across the six

1. **The chips write checks the context must cash.** Three personas independently hit the same failure class from different angles: a confident verdict token missing its denominator — RICH/CHEAP without DTE/expiry (P3), ±% without a time horizon (P2), a 98 that isn't a percentile (P5). The design's core thesis is "an opinion with an audit trail" (§2.2); in all three cases the audit trail exists but the *frame* (what the number is measured against) is the missing piece. Cheap fixes — mostly caption text and one snapshot definition — but they decide whether the verdict layer builds trust or burns it.
2. **The moments of peak value are the least specified.** Pre-market cold cache (P1), the 4:05 PM dead zone and flip latency (P4): the two daily windows this product exists for both fall between defined states. Steady-state is beautifully specified; event-time is hand-waved.
3. **Interaction-state semantics are 90% right, and the last 10% is load-bearing.** pushState-per-arrow-step breaking Back (P6, P1), modal section absent from the URL, per-section scroll retention — one paragraph of spec each.
4. **Data is computed and then not shown.** Drift is built into the unified endpoint (§6) but never rendered (P2); RS exists in the verdict formula but is tooltip-only in the modal (P5); AH%-vs-implied is derivable in the banner from two numbers already present (P4). Several "features" are actually just rendering decisions away.
5. **Unanimous praise cluster:** implied-vs-realized hero + dollar strip, beat-but-sold-off stars, one visual system/modal-as-mini-page, honest-labeling instincts (hollow bars, "consensus drift," accruing history), and the deterministic no-LLM verdict layer. Six very different traders all called out the same five things — the core bet is right.

## Top 5 actionable findings (ranked)

| # | Severity | Finding | Spec ref | Fix shape |
|---|----------|---------|----------|-----------|
| 1 | **MAJOR** | **RICH/CHEAP chip lacks expiry/DTE context and a defined implied snapshot.** Straddle-through-expiry compared against next-day realized reads systematically RICH early in the week; historical "implied at the time" has no pinned snapshot time (T-1 close vs "nightly near the date"), so hollow bars may not be mutually comparable. Misleads premium sellers and swing holders — the two personas the widget targets. | §4.3.1a, §6 rows 1–2 | Add "· Aug 8 straddle · 3 DTE" to the chip; pin implied snapshot = T-1 close in §6; state the horizon in the hero caption; (stretch) event-isolated implied. |
| 2 | **MAJOR** | **Report-night state machine undefined.** No banner state between countdown-expiry and actuals arrival (the 4:05–4:15 dead zone shows a stale "Reports tonight"); no refetch cadence for tonight's quarter (30d closed-quarter cache is specified, the live flip isn't); "guidance raised" is declared pure-data but no §6 row sources a guidance field. | §4.2, §6 row 3, §7 | Interim state "Reported — awaiting numbers · −9.2% AH" (AH% from data already in the banner); 30–60s single-flight polling window 4:00–6:00 PM ET for today's reporters; re-source or drop "guidance raised." |
| 3 | **MAJOR** | **Arrow-key stepping breaks the stated Back contract; modal section not deep-linkable; scroll retention unstated.** Back-closes-modal (§4.4) fails if each step pushes history; `?earnings=SYM` can't restore a section; transcript scroll position across rail switches is implied, not specified. | §4.4 | replaceState on arrow-step (Back always closes); add `&esection=`; one sentence: sections stay mounted, scroll retained per section per symbol. |
| 4 | **MINOR** | **"Absolute v1" basis pill will be read as a percentile by its exact target audience.** MarketSurge refugees are calibrated to 98 = 98th percentile; jargon pill + small type won't stop the misread, and numbers will visibly shift when Percentile·N lands. Credibility risk, not correctness risk. | §5.3 Ratings, §5.2 | Plain-English basis ("Formula score — not a market-wide rank"), scale in the always-visible crown caption, cutover behavior stated in the tooltip. |
| 5 | **MINOR** | **Triage-window loading honesty + built-but-hidden data.** (a) Banner verdict chip has no defined partial/loading state when the IV input is cold at 6:30 AM — either skeleton the chip or render 3-of-4 with a visible "IV pending" tick in the tooltip. (b) Drift is computed by the unified endpoint but unrendered — a gap-vs-drift affordance on ReactionBars serves the swing/gap personas at near-zero data cost. | §4.2, §4.4, §4.3.1b, §6 row 3 | Define chip loading/partial rule; add drift rendering (or explicitly defer it in §10 non-goals so the omission is a decision, not an accident). |

## Subscribe verdict tally

| Persona | Verdict | Hinge |
|---|---|---|
| 1 · Momentum day trader | **YES** | conditional on cold-cache triage speed (finding 5a) |
| 2 · Swing holder | **YES** | horizon label (finding 1) is must-fix, not dealbreaker |
| 3 · Premium seller | **MAYBE** | converts on finding 1 (DTE + snapshot); keeps MC for skew regardless |
| 4 · Gap gambler | **MAYBE** | converts on finding 2 (flip state machine + latency) |
| 5 · IBD/CANSLIM | **MAYBE (lean yes)** | trials now; stays on finding 4 + eventual percentile job |
| 6 · Power user | **YES** | day one; compare mode keeps one TradingView tab alive |

**3 YES / 3 MAYBE / 0 NO.** Every MAYBE converts on a named, cheap, specifiable fix — none requires new providers, new dependencies, or scope beyond caption text, URL params, one polling window, and one snapshot definition. The design's core bets (implied-vs-realized hero, verdict-with-audit-trail, one visual system, rail architecture) survived six adversarial walkthroughs intact; the risk is concentrated entirely in unlabeled denominators and undefined event-time states.
