# Usability Review Panel — Investor & Edge-Case Personas
## Research Page + Earnings Modal Redesign (spec 2026-08-03)

**Materials reviewed:**
- Spec: `docs/superpowers/specs/2026-08-03-research-calendar-redesign-design.md`
- Approved mockups: `.superpowers/brainstorm/345223-1785804114/content/01–11`

**Panel:** 6 personas, moderated. Each judged the design AS SPECIFIED (not aspirationally).
**Verdict tally: 2 YES · 4 MAYBE · 0 NO.**

---

## Persona 1 — Long-term fundamental investor
*"I live in Financials, Estimates, and Ownership. I open a name and read it for 20 minutes."*

**(a) 60-second first reaction.** The left-rail architecture (§5.1) is exactly the Koyfin
shape I already trust — Financials/Estimates/Ownership as first-class rail sections instead
of thin tabs is the right call. Heat-shaded quarterly grids on a real token ladder (§5.3
Financials) plus **click-any-row → inline trend chart** is the single best idea on the page
for me: that's how I actually interrogate a metric. The Estimates section leading with
revisions momentum instead of a static consensus number matches how professionals read
estimates. The unified ownership endpoint (modal and page finally reading the same data,
§5.3 Ownership) tells me someone cared about consistency.

**(b) The single moment of confusion.** The Financials click-row trend is spec'd as
"**8q/5y**" (§5.3). Eight quarters is two years — that's a trading lookback, not an
investing one. And the spec never states the *grid's* own depth or an annual row count.
When I click "Revenue" on a compounder I want 10 years of annuals; stockanalysis.com gives
me that free. Also: I read §5.3 Financials three times looking for the **cash-flow
statement** — it lists quarterly/annual grids, balance-sheet and profitability StatTiles,
but FCF/OCF is never named. For my persona that's not an omission, it's a hole. Secondary
confusion: what does the heat actually encode — growth *level* or growth *acceleration*?
Screen 10 says "YoY acceleration grids"; the spec §5.3 just says "HeatGrids on the
tokenized tier ladder." Dark green on a decelerating-but-still-growing quarter would
mislead me; the encoding must be named on the surface.

**(c) What they'd praise.** Click-row-to-trend (huge); `tabular-nums` everywhere (§3.2 —
finally, columns I can scan); Stock Checkup as actual-vs-threshold rows ("ROE 28.4% vs 17%
req ✓", §5.3 Ratings) — that's evidence, not a score; the crown being the *only* ratings
rendering (kills the three-renderings disease); the dead latest-report card finally wired
(§5.3 Overview).

**(d) #1 change request.** Depth parity with free competitors: annual grid ≥10y, quarterly
grid toggle 8q→20q, click-trend "max" range, and a cash-flow statement grid (or FCF row in
profitability tiles at minimum).

**(e) Verdict: MAYBE.** The interaction model beats what I pay Koyfin for, but if the data
runs out at 2 years I'll keep a stockanalysis.com tab open — and then I'll ask why I'm
paying for the prettier one.

---

## Persona 2 — Novice retail subscriber (first month)
*"I know what EPS is. Mostly."*

**(a) 60-second first reaction.** It looks genuinely expensive — the glass register reads
"I'm paying for a professional tool," which weirdly matters in month one. The banner tells
me a full sentence I can understand: "Reports tonight AMC · confirmed · call 5:00 PM ET"
and after the report it flips to "Beat $0.98 vs $0.94 · guidance raised · +4.2% AH" (§4.2)
— plain words, no jargon. The A− grade chip gives me an anchor. Then I click into Setup
(§4.3.1) and the vocabulary wall hits: "IMPLIED (HOLLOW) VS REALIZED (SOLID)",
"PREMIUM RICH — priced ±6.8%, moves ±5.1% avg", a dollar break-even slider, starred
"beat-but-sold-off" quarters. I can *see* it's meaningful. I can't read it.

**(b) The single moment of confusion — and it's dangerous, not just confusing.**
"**PREMIUM RICH**." I read that chip as "this is a premium/rich-quality stock → good."
It actually means options are *overpriced* relative to history — closer to a caution.
A verdict chip whose plain-English reading inverts its meaning is the worst kind of
failure for a novice. Same family: "hollow = implied at the time" — nothing on either
surface ever teaches me what "implied" means, and the spec has **no legend, no glossary
tooltip, no first-run coach mark anywhere** (§3.3 defines the color grammar for the team,
not for me). The verdict tooltip shows "the four inputs" (§4.2) but the inputs are
themselves jargon (RS rank? IV premium?).

**(c) What they'd praise.** The Brief section — one place where someone explains the
quarter in sentences (§4.3.3); the empty states with human copy ("No transcript yet —
typically posts within 2h of the call", §4.4); the banner flip; browser Back closing the
modal like I expect (§4.4); one consistent loading skeleton instead of five spinners.

**(d) #1 change request.** A learnability layer: (1) a one-time 3-panel coach mark on
first modal open (hollow=expected, solid=what happened, gold=our verdict); (2) a small ⓘ
on every VerdictChip and eyebrow label opening a 2-sentence plain-English tooltip
("Premium rich = options are pricing a bigger move than this stock usually makes —
options are expensive tonight"). Cheap, contained in the VerdictChip/EyebrowLabel
components (§3.4), massive comprehension payoff.

**(e) Verdict: MAYBE.** I'd stay for the Brief and the banner. Whether I stay past month
two depends on whether the Setup section ever starts speaking to me — right now it speaks
about me, to someone smarter.

---

## Persona 3 — Mobile-only commuter
*"Everything on a 390px screen, one thumb, on a train."*

**(a) 60-second first reaction.** The plan respects the phone instead of shrinking the
desktop: bottom-sheet via the existing `Sheet` component with the rail as a chip row
(§4.3 Phone), lollipop table stacking under the chart (§4.3.2), frozen-first-column
financial grids (§5.3 Financials), page rail becoming a dropdown ≤640px (§5.1). And the
mobile audit harness with zero-horizontal-overflow as a release gate (§8) means these
aren't just words. URL state is quietly the best mobile feature: `?earnings=SYM` +
pushState means Android Back closes the sheet instead of leaving the app (§4.4), and I
can share a link from the train.

**(b) The single moment of breakage — walking it end to end.** Calendar → tap NVDA →
sheet rises. Pinned banner (logo · ticker · company · sector · timing+countdown · live
price · grade chip — that's 7 elements across 390px; the spec never defines the banner's
phone collapse). Below it, a 6-chip row: **Setup · Earnings History · Brief · Analyst &
Ownership · Call · Filings**. At ~390px maybe 3.5 chips fit — "Call" and "Filings" live
off-screen behind an unhinted horizontal scroll, and "Analyst & Ownership" is a
long label. Then the Setup canvas: ImpliedVsRealized hero + dollar slider + ReactionBars
+ 4 StatTiles + key-stats strip = a long scroll *inside* a drag-to-dismiss sheet with a
pinned footer. Chrome (banner + chips + footer) eats maybe a third of my viewport, and
the spec is silent on the scroll contract: does a downward flick at the top of the canvas
scroll content or dismiss the sheet? `Sheet.jsx` is mature, but this spec stacks more
pinned chrome inside it than anything else in the app. Last gap: desktop gets **arrow
keys to step through the day's reporters** (§4.4) — my triage loop — and phone gets no
equivalent. No swipe, no prev/next. On the train that's the whole workflow.

**(c) What they'd praise.** URL/Back behavior; table-stacks-under-chart; frozen-column
grids (the right call over card-collapse for heat grids where per-cell color matters);
the audit-gated release; one Sheet idiom instead of a bespoke modal.

**(d) #1 change request.** Write the phone interaction contract into §4.3: sheet opens
~92% height with drag-dismiss owned by the banner/grabber only, canvas owns its scroll;
chip row gets an overflow affordance (fade + partial chip peeking) and short labels
("Analyst" not "Analyst & Ownership"); add prev/next reporter controls (chevrons in the
banner or horizontal swipe on it) as the touch equivalent of arrow keys.

**(e) Verdict: YES.** The bones are right and the harness gate keeps them honest. Fix the
contract details in P2/P5 and this is the best phone earnings surface I've used, period —
EarningsWhispers' app included.

---

## Persona 4 — Red-green color-blind user (deuteranopia)
*"Your green and your red are both 'darkish muted color' to me."*

**(a) 60-second first reaction.** Someone here has thought about me more than most
platforms do: the **hollow-vs-solid grammar is fully colorblind-safe** — fill state is a
shape channel, not a hue channel, and it carries the single most important distinction in
the whole design (expectation vs reality, §3.3). The lollipop chart survives perfectly:
beat/miss is encoded by the actual dot's *position* above/below the estimate dot (§4.3.2,
screen 05). ReactionBars draw negative moves *below* the zero line (screen 06) — position
again. Signed labels (+3.4 / −4.4) under each bar in the mockup. The star on
beat-but-sold-off quarters is a shape mark. This is 80% of the way to fully accessible.

**(b) Where it fails — precisely at the two money moments.**
1. **ImpliedVsRealized hero (§4.3.1a, screen 04):** solid bars encode close direction by
   green-vs-red fill ONLY. Every bar rises from the same baseline; height = |move|. I see
   eight solid bars of near-identical muted tone and cannot tell which quarters closed
   down. The hero's entire realized story is invisible to me.
2. **Beat/miss dot rows (§4.3.1b, screens 05B/06):** identical filled circles, green vs
   red, same size, same row. The one miss in "7/8" is indistinguishable.
3. **Heat grids (§3.1, §5.3):** the promoted `bgG3…bgR3` ladder's extremes (near-black
   green vs near-black crimson) and mild tints (mint .16 vs red .16) both collapse for
   me. If cells carry signed values I can read them; the spec doesn't guarantee signs.
   Minor: ConsensusBar's green/grey/red segments are rescued by order + the "37B·8H·1S"
   count label — fine.

**(c) What they'd praise.** Hollow/solid as the system's backbone; position-coded
lollipop and reaction bars; signed per-bar labels; the star mark; gold-vs-anything is
distinguishable; "green/red = realized ONLY" (§3.3) at least means color never carries
two different meanings — when I lose it, I lose one thing, not the whole taxonomy.

**(d) #1 change request.** Add one sentence to §3.3 and enforce it in the kit tests
(§8): **no green/red mark may be the sole carrier of direction.** Concretely:
ImpliedVsRealized draws down-close solid bars below the baseline (mirroring ReactionBars
— also just better dataviz); beat/miss dots get shape redundancy (miss = ring/✗, beat =
filled); HeatGrid cells always render the signed value. Three component-level changes,
all in P1 while the kit is being built with tests.

**(e) Verdict: MAYBE — YES if (d) lands.** The grammar was designed like I exist; the two
hero widgets were drawn like I don't.

---

## Persona 5 — Skeptical data purist
*"Show me the formula or don't show me the grade."*

**(a) 60-second first reaction.** This is the most honest spec I've reviewed in this
category, and I'm suspicious of how good it is. The receipts: whisper proxy explicitly
labeled "**consensus drift, never whisper**" (§6) — everyone else in this market lies
about that. PT histogram **gated on a live probe, no silent fallback rendering** (§6) —
so I'll never see a chart drawn from a 404. Post-report banner flip is "pure data, no
LLM" (§4.2). Micro-provenance as a north star (§2). "Never cache a failed fetch as a
value" (§6). Implied history labeled "since 2026-08" instead of pretending they have it
(§6). The AI is contained in one Brief section with a timestamp instead of leaking
captions everywhere (§4.3.3, screen 07's option C was rightly rejected).

**(b) The single moment of breakage — two, honestly, same root.**
1. **The A− grade's audit trail is a label, not an audit** (§4.2). Tooltip "shows the
   four inputs" — but not the weights, thresholds, or mapping. "Formula documented in
   code" is provenance for the developer, not for me. Why is 7/8 + 21↑/3↓ + RS 94 +
   rich IV an A− and not a B+? What flips it? And rich IV *lowering* the grade is a
   modeling opinion (rich premium hurts option buyers, but it also predicts bigger
   realized moves) — an opinion I'm never shown. Worse: **what happens when an input is
   missing** (no options chain on a small-cap, no RS rank on a recent IPO)? A 3-input
   grade rendered identically to a 4-input grade is quiet dishonesty in a design whose
   whole thesis is "an opinion with an audit trail."
2. **The sparse-implied cold start will read as a bug** (§6 row 2 + §4.3.1a). For up to
   8 quarters, the hero titled "IMPLIED (HOLLOW) VS REALIZED (SOLID)" renders 7–8 pairs
   with the hollow half absent. A caption ("implied history since 2026-08") explains it
   to people who read captions; visually it's a broken chart. The rich/cheap verdict
   itself is fine day-one (tonight's implied vs realized average — computable), but the
   *paired* visual promise is unkeepable for two years and the spec doesn't design the
   degraded state — it just lets it happen.

**(c) What they'd praise.** Everything in (a); deterministic grade (no LLM in the verdict
path); serve-stale + single-flight discipline; weekday-clock-injected tests (§8); the
FMP probe habit; `method` provenance footnote kept on ratings (§5.3); basis pill
`Absolute v1` → `Percentile · N` planned on the crown — versioned methodology, chef's kiss.

**(d) #1 change request.** Make the grade self-auditing at the surface: tooltip shows
each input's value AND its threshold/contribution ("Beat streak 7/8 → +2 · Revisions
21↑/3↓ → +2 · RS 94 → +1 · IV rich → −1 ⇒ A−"), plus explicit degradation: missing
input → "graded on 3 of 4" annotation, never a silent re-weight. Second: design the
sparse-implied state deliberately — below n hollow bars, collapse the hero to
realized-only bars + a "tracking implied since Aug 2026 — n/8 quarters recorded" chip,
and let hollow pairs join as they accrue.

**(e) Verdict: YES.** Conditionally — the honesty infrastructure is real and rare. The
grade is the one place the spec asks for trust instead of earning it; fix that and this
is the only tool in its bracket I wouldn't fact-check.

---

## Persona 6 — On-the-fence paying customer
*"Free stockanalysis.com + the EarningsWhispers app cover me today. Convince me."*

**(a) 60-second first reaction.** For the first time this product has things my free
stack literally cannot do: the implied-vs-realized pairing with a RICH/CHEAP verdict
(§4.3.1a) is a Market Chameleon-tier feature ($99/mo over there); the reaction bars with
tonight's implied bracket laid over 8 prints of history (§4.3.1b) answers "is tonight's
premium worth selling/paying" in one glance; revisions momentum into the print (§5.3
Estimates); an AI call recap with searchable transcript in the same surface (§4.3.5).
And it's one workflow — calendar → modal → full report — with deep links, vs my current
three-app juggle. EW's moat (timing confidence) is matched: confirmed/estimated badge +
countdown (§4.2). The honest "consensus drift" label is weaker *marketing* than EW's
whisper number, but I've been burned by whispers; I'll take it.

**(b) The single moment of doubt.** I opened (mentally) a $2B name reporting Thursday:
no options chain → Setup hero empty/degraded; no transcript for 2 hours → Call empty;
13F flow six weeks stale (§4.3.4); implied history "since 2026-08" → hollow bars absent.
Section by section the spec has styled empty states (§4.4) — good — but styled emptiness
is still emptiness, and mid/small-caps are where I actually need help (mega-caps are
covered free everywhere). The premium shell with placeholder guts is exactly what makes
people screenshot a cancellation tweet. The spec never addresses *density floor*: what
does the modal guarantee me on a name with no options, no transcript, no whisper of
institutional churn?

**(c) What they'd praise.** Implied bracket over reaction history (nothing free has it);
the grade chip as a triage anchor; one system across modal/page (feels like a product,
not a feature pile); pinned footer so "Open full report" is never buried (§4.3 vs
today's bottom-of-scroll CTAs); URL state making names shareable to my group chat.

**(d) #1 change request — the retention feature.** The setup grade exists per name
(§4.2) but only *inside* the modal, one name at a time. Put it on the calendar: a
sortable **Setup grade column / "tonight ranked" strip** across the day's reporters.
That converts the grade from a curiosity into my nightly routine — "open UCT, see
tonight's 40 reporters ranked A→F, click the three A's." That's a habit loop no free
tool has, it's ~zero new data (grades are already computed per name), and it's the
single thing that would make cancelling feel like losing a workflow instead of losing
a skin.

**(e) Verdict: MAYBE, leaning stay.** I'll stay through the redesign shipping. I convert
to a yes if the grades prove trustworthy on names I know AND the grade escapes the modal
onto the calendar. If Financials stays shallower than stockanalysis.com free (see
Persona 1), that's the counterweight.

---

# Moderator synthesis

## Patterns across the six

1. **The expectation-vs-reality grammar is the design's crown jewel AND its biggest
   dependency.** Four personas (2, 4, 5, 6) interact with hollow/solid + green/red as
   the load-bearing idea. It's brilliant where shape/position carry it (lollipop,
   reaction bars) and fragile where color alone carries it (hero bars, dots) or where
   the data can't fill it yet (implied history).
2. **Trust is earned everywhere except the grade.** The spec's provenance discipline
   (probes, drift labeling, no-LLM verdicts) impressed even the purist — which makes the
   under-specified grade formula and missing-input behavior stand out more, not less.
3. **Empty/degraded states are half-designed.** Generic empty states exist (§4.4), but
   the three *predictable* degradations — sparse implied history, no-options names,
   partial-input grades — are exactly the ones the spec doesn't choreograph, and three
   personas independently hit them.
4. **Both "money" personas (1, 6) put retention on data depth + reach, not aesthetics.**
   The glass register earns the first impression; depth (10y financials, cash flow) and
   reach (grade on the calendar) earn month six.
5. **Phone architecture is right; phone contract is unwritten.** The primitives (Sheet,
   ResponsiveTable, audit harness) de-risk it, but chip overflow, sheet-vs-canvas
   scroll, and reporter-stepping have no touch story.

## Top 5 actionable findings (ranked)

| # | Sev | Finding | Spec ref | Fix window |
|---|-----|---------|----------|-----------|
| 1 | **MAJOR** | Direction is encoded by green/red alone in the two hero widgets: ImpliedVsRealized solid bars (all rise from one baseline; close direction = hue only) and beat/miss dot rows (identical circles, hue only). Heat-grid mild tints (g1/r1) also collapse under deuteranopia. Fails a colorblind user at the exact "money moment" and weakens quick-scan for everyone. Fix: down-closes drawn below baseline, shape-coded miss dots (ring/✗), guaranteed signed values in HeatGrid cells; add "no hue-only direction" to §3.3 and assert it in the P1 kit tests. | §3.3, §4.3.1a/b, §3.1; screens 04/05b/06 | P1 (kit build) |
| 2 | **MAJOR** | Sparse implied-history cold start is undesigned: for up to 8 quarters the "IMPLIED vs REALIZED" hero renders with most hollow bars absent — reads as a rendering bug, undermining the flagship widget at launch. Design the degraded state: below a threshold, collapse to realized-only + "tracking implied since 2026-08 · n/8 recorded" chip; hollow pairs join as the nightly store accrues. | §6 (implied-at-the-time row), §4.3.1a | P2/P4 |
| 3 | **MAJOR** | No learnability layer for the design's own vocabulary: "premium rich" plain-English reads as the *opposite* of its meaning; "implied," hollow-vs-solid, and drift are never taught. No legend, glossary tooltip, or first-run affordance exists anywhere in the spec. Fix: one-time 3-panel coach mark on first modal open + ⓘ plain-English tooltips built into VerdictChip/EyebrowLabel (component-level, so it covers both surfaces automatically). | §3.3, §3.4, §4.3.1 | P1 components, P2 coach mark |
| 4 | **MAJOR** | Setup grade audit trail is insufficient for its prominence: tooltip lists 4 inputs but not weights/thresholds ("documented in code" ≠ user-visible), and behavior with missing inputs (no options chain, no RS) is undefined — a silently re-weighted grade contradicts the "opinion with an audit trail" north star and threatens the trust that retention (P6) depends on. Fix: contribution breakdown in the tooltip + explicit "graded on n of 4 inputs" degradation. | §4.2, §2 | P2 |
| 5 | **MINOR** | Retention-floor gaps voiced by both paying personas: (a) Financials depth unspecified/shallow — 8q/5y trend, no annual depth stated, no cash-flow statement — below the free stockanalysis.com bar; (b) phone contract unwritten — 6-chip rail overflow with long labels, sheet-drag vs canvas-scroll ownership, no touch equivalent of arrow-key reporter stepping. Both are cheap spec-line additions now, expensive retrofits later. | §5.3 Financials; §4.3 Phone, §4.4 | P3 / P5 |

**Also noted (below top-5 cut):** calendar-level setup-grade ranking is the panel's
clearest *retention opportunity* (P6's #1 ask — grades already computed, zero new data);
small-cap "density floor" for the modal (what's guaranteed when options/transcript/13F
are all absent); banner element collapse order on phone is undefined (7 elements at
390px); heat encoding (level vs acceleration) should be named in the grid's eyebrow
label (P1's secondary confusion).

## Verdict tally

| Persona | Verdict | Hinge |
|---|---|---|
| 1 · Fundamental investor | MAYBE | Data depth (10y annuals, cash flow) |
| 2 · Novice retail | MAYBE | Legend/glossary layer |
| 3 · Mobile-only commuter | YES | Phone contract details in P2/P5 |
| 4 · Deuteranope | MAYBE→YES | Finding #1 lands in P1 |
| 5 · Data purist | YES | Grade audit trail (conditional) |
| 6 · Churn-deciding customer | MAYBE | Grade on calendar + trust proven |

**Moderator's read:** No persona rejected the architecture — every MAYBE hinges on a
bounded, phase-assignable fix, and four of five top findings are addressable inside the
already-planned P1/P2 component work. The design's differentiators (implied-vs-realized,
the grade, the shared grammar) are also its concentration of risk: they must be
colorblind-safe, sparse-data-safe, and self-explaining, because they're what the
subscription is being judged on.
