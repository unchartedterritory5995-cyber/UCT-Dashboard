---
id: F-05
title: Best-of-Breed Matrix — for each terminal capability, who does it best, and the mechanism that makes it best
role: Gate-9 deliverable — MASTER_CHECKLIST item 10 ("Best-of-Breed Matrix"). Distinct from item 9 (the Cross-Product Capability Matrix, `capability-matrix.md`, NOT STARTED) and from `05-product-strategy/capability-infrastructure-matrix.md` (Phase 2, ACCEPTED, UCT-to-UCT-infrastructure). This file ranks; item 9 cross-tabs; the infrastructure matrix maps.
wave: 2
group: F
category: product-strategy
inputs: 03-competitive-research/ — 13 `dossier.md` files (Bloomberg, Gödel Terminal, TradingView, Unusual Whales, Koyfin, Benzinga Pro, AlphaSense, FactSet, SpotGamma, Fiscal.ai [filed as `finchat/`], LSEG Workspace, Quartr, adjacent-notes) + 9 Bloomberg leaf files (01–09, incl. `09-multi-asset-analytics.md`) + 3 Gödel leaf files + 4 `desk-tools/` notes (thinkorswim, Finviz, Market Chameleon, TradingView-as-used) + `benchmark-universe.md` (B-VAL-01) · 05-product-strategy/capability-infrastructure-matrix.md (the row spine) · 05-product-strategy/product-architecture.md (§1.3's five terminal-grade properties and their named witnesses) · 01-existing-system/capability-ledger.md (F-03a, 178 rows) · 00-program-control/GOVERNING_PRINCIPLES.md §13 · MASTER_CHECKLIST.md
scope: For each capability row in the existing capability taxonomy, names ONE best-in-class product, the specific mechanism that earns it, the runner-up and why it loses, what UCT has today, and an evidence grade. Adds three declared extension rows (§3.6). Does NOT re-derive the taxonomy, does not decide what UCT builds, does not score or sequence anything, and does not rank any product overall.
confidence: 🟡 overall — 🟢 wherever a verdict rests on a named mechanism quoted at VERIFIED tier in a dossier's own words (most of §3.1–§3.6's mechanism cells) · 🟡 wherever the verdict composes two dossiers or weighs a mechanism against a ceiling · 🔴 on every latency, density, performance and lived-UX comparison in this file without exception (see §2.5), and on the four data-platform rows whose internals are not externally observable (§4.7)
evidence_ceiling: "No product in the benchmark universe was observed running by any leaf in this programme. No latency, density, keystroke or session figure anywhere in the inputs was MEASURED — every one is vendor-claimed, contractual-SLA, or practitioner-reported. Twelve of the fifteen products were never logged into; the three with public free tiers were read logged-out. Bloomberg, FactSet, LSEG, AlphaSense, Quartr and S&P Capital IQ Pro publish no price. This file therefore ranks MECHANISMS, which the inputs establish well, and refuses to rank EXECUTION, which they do not establish at all. It inherits unchanged every ceiling of its thirteen dossiers, nine Bloomberg leaves, four desk-tool notes, `benchmark-universe.md`, `capability-ledger.md` (F-03a) and `capability-infrastructure-matrix.md`. Two further ceilings are this file's own: (1) the research budget was deliberately unequal across products and is quoted as such in §2.4, and the correction for it is a stated rule, not a measurement; (2) the 'what UCT has today' column is as-of `capability-ledger.md` (2026-09-02) plus the four IMPLEMENTATION RECORDS in `product-architecture.md` dated 2026-09-03/04 — anything shipped after those is not in this file."
status: draft
date: 2026-09-25
---

# Best-of-Breed Matrix

## 0. How to read this file

**The taxonomy is not mine.** Every row in §3.1–§3.5 is one of the systems
`capability-infrastructure-matrix.md` §0 names in its five-tier row list. I counted that list
rather than trusting its prose: 33 lines in that file match the row-cell pattern `^| **<ID>`
(14 applications A1–A14 · 1 evaluate-only E1 · 4 edge S1/S2/S10/S12 · 8 platform-core S3–S9 + S11
· 5 data-platform D1–D5 · 1 intelligence I1), which agrees with that file's own §0 count.
**Three extension rows (X1–X3) are declared, with reasons, in §3.6** and are proposals to that
file, not edits to it.

⛔ **The capability ledger's letters are NOT this taxonomy's letters.** `capability-ledger.md`
uses A for market data (A1–A13), D for fundamentals (D1–D12), E for the calendar (E1–E17) and
I for watchlists (I1–I6) — colliding with the matrix's A-applications, D-data-platform, E1 and
I1. Ledger rows are written here as **`ledger F1`**; taxonomy rows as **A10**. Do not cross-map
by letter.

**Markers.** ⛔ hard constraint or refusal · ⚠️ caveat · ⭐ the insight worth carrying ·
⚰️ a correction of something previously believed · **✖ not offered** (the dossier states or
enumerates the absence, and the enumeration is named) · **◻ not established** (the research
could not reach it — a ceiling, a 🔴, or a GAPS item) · **⌀ no incumbent** (the capability is
unoccupied across the whole universe) · **⊘ out of scope** for UCT by GOVERNING_PRINCIPLES §13.

⛔ **✖ and ◻ are never collapsed into one cell.** An absence is evidence only where the
instrument could have seen a presence, and the inputs are explicit about which is which:
Gödel's absences are enumerated against a 48-command index; SpotGamma's against a complete
help-centre category index; Benzinga's against a 119-article sitemap inventory; AlphaSense's
across "a complete help centre, a complete product nav and 16 months of release notes" — those
are ✖. A missing keyboard grammar in five products is ◻: "absence of documentation is not proof
of absence" (AlphaSense dossier §H).

---

## 1. Headline — the three judgements that matter

**H1. Bloomberg's decisive win is the addressing model, not the data — and the addressing model
is the cheapest thing in this entire benchmark set to copy.**

Bloomberg wins more rows here than any other product, but read *which* rows: S2 (command/search),
S4 (context bus), A12 (lists), D2 (a field is an address), X3 (onboarding). All five are
**grammar**, not content. Its data rows are 🟡 with the vendor's own numbers disagreeing across
its own collateral (Bloomberg dossier R17: "Cite the document and date, not the number"), its
price is 🔴 ("Bloomberg publishes no price", R20), its performance is 🔴 on every number (§K),
and two of its three moats are *absences* — no bulk export, no published download limit, no
published consensus recipe (§A, "Two of the moats are absences").
⭐ The transferable half is one sentence five Bloomberg leaves reached independently without
seeing each other's files: **saved things become names, and names are addresses** — a chart
titled "Graph 53" *is* the function `G53`; a saved news search *is* `NI BUFFBALL`; a saved screen
*is* `=BEQS("name")` (§A, "Three convergences"). That costs engineering, not licence fees.

**H2. On three of the rows UCT most needs, the best mechanism in the world costs under $120 a
month, and not one of the three winners is a big name.**

The best alert/filter **authoring** language belongs to **Unusual Whales** at $50/month list — a
small readable `where` grammar over five typed subjects with field-to-field comparison
(`volume > open_int`), a machine-readable grammar endpoint beside it, and an AI builder that
*compiles to* the text rather than replacing it (UW dossier §H). Bloomberg cannot contest it on
this evidence: `ALRT`'s condition grammar is 🔴 because its documentation page is CAPTCHA-walled
(Bloomberg Q6).
The best **AI-trust** design belongs to **TradingView** at $12.95/month — the AI Screener emits
*an editable configuration* with a filter-by-filter Explanation panel, so "the artefact *is* the
citation" and a wrong answer is disagreed with one filter at a time (TV dossier §I).
The best member-facing **feature-status** mechanism belongs to **Gödel Terminal** at $118/month,
a self-declared public beta: BETA pills at the point of use on the docs index, plus a two-column
"In Gödel today / Working on" strip a prospect reads before paying (Gödel dossier §M idea 5).
⭐ Price is uncorrelated with mechanism quality across this set. The correlation is with *whether
the vendor had to explain itself to a self-serve buyer*.

**H3. Two rows have no incumbent at all, they are the same row twice, and they are the only rows
where UCT can be first rather than behind.**

(a) **A decisive, grounded, sourced verdict.** Every benchmarked product with a grounded AI layer
refuses, in writing, to say what to do. LSEG publishes its refusal template — *"if you ask,
'Should I buy Tesla?', AI Search will not give a yes or no answer"* (§I.4). FactSet disclaims that
responses "do not constitute advice, rating, projection, or opinion" (§I). Quartr "never renders
a view… no score, no rating anywhere" (§I). TradingView emits configuration, not opinion.
SpotGamma abstains from AI entirely and pays a named human to write twice a day (§I). Bloomberg
cannot, at 350,000 seats, without becoming an advice business.
(b) **The per-ticker history join** — what the wire said, what the setup did, what the book did,
what flow did, what the member said. No benchmarked product has it, several concede they
structurally cannot (SpotGamma "never sees a fill"; Quartr has no price context at all), and
`product-architecture.md` §1.1 already records that "every benchmark dossier concedes it cannot
have this".
⭐ These are one row, because a verdict without the record is an opinion and the record without a
verdict is a spreadsheet. ⚠️ And the honesty tax on (a): UCT's own exam for it reads 12/50 with
Rungs 3–5 at zero (`ledger K4`).

---

## 2. Method — stated before any verdict, so it can be discounted

### 2.1 The six criteria, weighted, declared

| Criterion | What it asks | Weight, and why |
|---|---|---|
| **Mechanism specificity** | Is there a *named*, quotable design decision, not an adjective? | **Highest.** A product that cannot be described mechanically cannot win a row here, however good it may be. This is also the budget control (§2.4). |
| **Workflow fit** | Does it serve a discretionary US-equities-and-options swing desk plus retail-plus members? | **High.** GOVERNING_PRINCIPLES §13: "US equities primary; options active; indices/ETFs context; futures positioning as a research rail; no FX, fixed income, or crypto in V1. No execution or order management." A capability serving only institutional FX or muni desks is ⊘, not a loss. |
| **Depth** | How far does the capability go once you are inside it? | High, but capped by evidence: depth claims are 🟡 almost everywhere, because nobody saw the product run. |
| **Defensibility / transferability** | Could a small team adopt the mechanism, and does adopting it buy the mechanism or only its shape? | High. Bloomberg's chat network scores zero here (N4: "cloning the network without the network"); its colour-as-a-type-system scores maximum. |
| **Freshness / latency** | How fast does the thing arrive? | **Deliberately near-zero.** See §2.5. Only *contractual* freshness statements (Quartr's percentile SLAs, Fiscal.ai's "3–7 minutes after earnings") count at all, because they are falsifiable by a customer. |
| **Price-to-capability** | What does the best version cost, and does that make matching it sane? | Medium for ranking, high for §5. Never used to *win* a row — cheap-and-good is a finding, not a criterion. |

### 2.2 The desk's own tools are weighted up — with one ⚠️ that matters

GOVERNING_PRINCIPLES §13 names the desk's tools: "thinkorswim/Schwab, TradingView, Finviz,
Discord, Substack, YouTube." A mechanism the owner already uses daily beats an equally good
mechanism nobody in this building has touched.

⚠️ **But the weighting itself is mostly 🔴, and the notes say so.** The thinkorswim note searched
all four repos for `thinkorswim`/`toslc`/`tos_` and found **zero hits** — "If it is a desk tool,
it is used by hand" (thinkorswim §0); its `confidence` line reads "🔴 on actual desk usage".
Finviz is the one exception and it is 🟢: three named screener queries every morning through
`finviz_client.py`, with an observed failure (`PULLBACK_MA — no results from Finviz` ×3 →
`SCAN HEALTH FAILED`, 2026-08-31). Market Chameleon is a **provisional slot** the universe file
invented, pending OI-19, possibly to be swapped for OptionStrat (market-chameleon, Slot status).
So: Finviz's desk weight is earned; thinkorswim's and Market Chameleon's are *stated defaults*,
and where a verdict leans on them I say so in the row.

### 2.3 Absence discipline

Restated because it decides eight cells: **✖** requires a named enumeration (a command index, a
category index, a sitemap inventory, a release-note corpus). **◻** covers everything else. Where
a dossier grades its own absence, I carry its grade — Koyfin's missing market-internals regime is
🟡-inferred ("from the full help taxonomy, which does list every functional area"), Benzinga's is
🟢-established ("measured against a complete article inventory"), and those two are not the same
claim.

### 2.4 ⭐ How I controlled for the uneven research budget — the trap in this deliverable

The budget was unequal **by design and by accident**, and both are documented.

*By design*, `benchmark-universe.md` Part 4 instructs it: *"The four 🔴/🟡-enterprise products
(Bloomberg, LSEG, FactSet, S&P CIQ Pro) will consume the most research hours and yield the least
verifiable evidence. Budget them at roughly half the hours of a 🟢 product and expect 🟡
dossiers."* It also assigns depth roles — **deep** (Bloomberg, Gödel, TradingView, Unusual
Whales), **standard** (Koyfin, Benzinga Pro, AlphaSense, FactSet, SpotGamma), **light**
(Fiscal.ai, LSEG, Quartr), **desk-tool** (thinkorswim, TradingView-as-used, Finviz, Market
Chameleon).

*By accident*, the shared WebSearch quota ran out mid-wave and **five dossiers plus all four desk
notes independently record it**: Bloomberg GAPS 3 ("The session-wide WebSearch budget (200/200)
was exhausted mid-wave"), TradingView §J ("WebSearch was already exhausted (200/200) when this
role started"), Gödel §P, SpotGamma GAPS, FactSet GAPS, LSEG GAPS, and Finviz GAPS ("exhausted
(per program-wide budget note)").
⚠️ **The tools the owner actually uses got the thinnest channel in the whole programme** — all
four desk notes ran after exhaustion, on WebFetch plus at most one browser tab each.

And the artefact asymmetry is measurable rather than argued. Counted by listing
`03-competitive-research/` on 2026-09-25: **Bloomberg has 1 dossier + 9 leaf files; Gödel has
1 + 3; every other product has exactly 1; the four desk tools have one flat note each.**
Bloomberg — the product with the 🔴 ceiling and no primary price anywhere — received a nine-part
deep-dive including a dedicated multi-asset deepening leaf.

⛔ **Four rules therefore bind every verdict below, and a naive matrix would have broken all
four:**

1. **A row is won by a nameable mechanism, never by dossier volume.** If I cannot state the
   mechanism in one sentence a reader could falsify, no winner is named and the row goes to §4.
2. **Bloomberg is disqualified from any row whose subject is precisely one of its own named
   ceilings.** Its §P states the shape plainly: this is "not twelve independent evidence gaps, it
   is one gap — no primary access to the live product — refracted through twelve topics",
   resolvable by exactly **three** artefacts (a Terminal seat, a recorded walkthrough, a
   practitioner interview), none of which any leaf reached. So Bloomberg does not win latency
   (§K 🔴 on every number), price-to-capability (§L 🔴), lived UX (§J 🔴 on the 2026 UI), alert
   authoring (`ALRT` grammar CAPTCHA-walled), or how a user chains screens into one regime read
   (GAPS 8a, explicitly still open after leaf 09).
3. **A light-tier dossier can win a row outright.** Quartr is `light` and wins the
   transcript-delivery half of A6 on contractual percentile SLAs; Fiscal.ai is `light` and wins
   the auditability mechanism in A3. Depth of research is not depth of product.
4. **Where the winner is the product the desk uses, I say whether that is measured (Finviz) or a
   stated default (thinkorswim).**

### 2.5 ⛔ Latency, density and performance are unrankable in this file

**No dossier in the universe contains a measured end-to-end latency, render time, keystroke count
or density figure for any product.** Bloomberg §K: "No leaf measured anything, and no source in
the corpus publishes a latency, keystroke or session metric." SpotGamma §K: 🔴, "every figure is
a vendor claim". Koyfin §K: "NOT DETERMINED… the marketing copy that comes closest is *'Sharpen
your insight in a snap'*, which is a mood, not a measurement." Benzinga §K: "I ran no timing,
took no screenshots, and never loaded the application." FactSet §K: "FactSet publishes **no**
latency, load-time, or throughput figures." LSEG §K: 🔴, "A trial with a stopwatch."

Two products are exceptions worth carrying, because they made freshness *falsifiable*:
**Quartr** publishes percentile SLAs with named windows and states its own failure rate (90% of
live events streamed and transcribed within 5 seconds of start — i.e. 10% are not, and they say
so), and **Fiscal.ai** ties its promise to an external event ("3–7 minutes after earnings"),
which §K rightly calls "self-auditing… falsifiable by the customer on any earnings day".
⭐ That is the transferable form of a speed claim.

### 2.6 Counting discipline, and two ⚰️

⛔ No count in this file is typed beside the artefact that owns it. Where a count appears, the
derivation is stated inline. The 33 taxonomy rows were counted by pattern (§0). The 30 input
`.md` files were counted by directory listing (§2.4). The 178 ledger rows are the ledger's **own**
measurement (`grep -c '^| [A-P][0-9]'`, stated in its §R with a per-group split); I did not
retype the split and a delegated re-count agreed with it.

⚰️ **My own dispatch roster was wrong, and the programme's was right.** It listed "eleven leaf
dossiers plus Bloomberg" and named ten products plus an adjacent note — **omitting Gödel
Terminal**, which holds a full dossier plus three leaves and which `MASTER_CHECKLIST` item 9
explicitly counts ("11 dossiers + Bloomberg + Gödel all accepted"). `benchmark-universe.md`
Part 2 calls the Bloomberg–Gödel pair "a designed contrast… the single most program-relevant
comparison available". A matrix built from that roster would have dropped the one product whose
entire thesis is TERMINAL-NEXT's.

⚰️ **The "$31,980/yr Bloomberg seat" number has two incompatible provenances inside this
programme.** The Bloomberg dossier §L lists it as a 2026-04 practitioner essay (`reported`);
`benchmark-universe.md`'s evidence-hygiene warning says that a "widely-repeated '$31,980/yr
Bloomberg' comparison table… traces to affiliate content, not to Bloomberg" and that such sources
"may be used to *locate* a primary source; **never to support a claim**". §5 therefore reports a
dated range and never a number.

---

## 3. The matrix

**⚠️ Column choice, and why.** A nine-column table is unreadable, and the mechanism is the whole
deliverable — compressed into a table cell it degrades into the adjective this document exists to
avoid. So each family gets **one compact five-column table** (capability · best-in-class ·
runner-up · what UCT has today · evidence) followed by **one prose note per row** carrying the
mechanism, why the runner-up loses, and the ✖/◻ split. Families are grouped by the taxonomy's own
tiers, because the tier is part of the dependency answer (`capability-infrastructure-matrix.md`
§0).

### 3.1 Market, price and positioning surfaces

| Capability | Best-in-class | Runner-up | UCT today | Evidence |
|---|---|---|---|---|
| **A1 Markets** | Bloomberg | TradingView | movers at a single ≥3% gap threshold; two-tier live-prices; futures via yfinance (`ledger A1/A6/A7`) | 🟡 — mover-lens names V, `MOV` semantics only R |
| **A2 Charts & Analytics** | TradingView | Bloomberg | `StockChart.jsx` 15,500 ln, "the single largest carried risk"; mount `ChartPane` (`ledger B1/B2`) | 🟢 — official help center, plus a competitor buying it |
| **A9 Screening & Discovery** | TradingView (expressiveness) | Finviz Elite (universe; the desk's measured dependency) | Finviz nightly universe, 157 column defs, `CoverageLine`'s four counts, `user_definitions` (`ledger G1/G2/G3`) | 🟡 — three products win three different halves |
| **A10 Options & Flow** | Unusual Whales (tape) · SpotGamma (positioning read) · thinkorswim (per-position risk) | Bloomberg `OMON`/`OSA` over BVOL/LIVE | the genuine differentiator: OPRA WS → `flow.db`, dark pool, GEX (`ledger F1–F10`) | 🟢 on inventory · 🔴 on both positioning models' methods |
| **A11 Breadth, Regime & Positioning** | SpotGamma (a *published* regime) | ⌀ nobody else competes | 40+ breadth metrics, COT 62 symbols, Exposure Rating 0–150, two regime classifiers (`ledger H1–H9`) | 🟡 — verdict rests on absences, four of them ✖ |

- **A1 Markets — Bloomberg.**
  - **Mechanism.** `MOV` answers *contribution* — "which names are driving a selected index" —
    not "what moved most"; a sorted change list cannot answer a rotation question. Around it sits
    a rack of lenses cutting one tape (`MOST`, `IMOV`, `IMAP`/`MMAP`, `LVI`, `OVI`, `HILO`,
    `WAD`, `SIA`), and clicking a row loads the security into a chosen panel in one keystroke.
  - **Why TradingView loses.** Its `/markets/` hub plus heatmaps plus Top Stories plus two
    calendars are "four separate destinations, no single composed answer" (TV §E-D).
  - **✖ / ◻ / ⊘.** ✖ Neither ships a *why*: "Bloomberg's contribution is adjacency, not insight"
    (Bloomberg §E.1). ⊘ Futures/FX/commodity breadth beyond the research rail.

- **A2 Charts & Analytics — TradingView.**
  - **Mechanism.** The chart *is* the address bar (type with the chart focused, no click and no
    chord). `Alt+Ctrl`/`⌥⌘` raises a `+` under the cursor that creates an order, alert or price
    line **at that price**, replacing a dialog with a gesture. A Pine script is one object that
    can be charted, screened on (up to 3,500 symbols), alerted on and backtested without
    reimplementation. Customisation is split into three independently saved objects — layout
    (arrangement), indicator template (analysis stack), column preset (how a table is read). And
    the server-side script ceilings are *published* (20 s / 40 s, 500 ms per bar).
  - ⭐ **The strongest corroboration is a competitor's purchase order.** Gödel builds the chrome
    and buys the chart wholesale — "everything below [the chrome] is TradingView" (Gödel §F).
  - **Why Bloomberg loses.** A seven-surface charting curriculum before a chart is yours
    (`GP`→`GPC`/`GPO`→`G`→`G##`, plus `TECH`, `TDEF`, `W`, `GRAB` — §J.2), and ◻ its 2026 UI is
    unseen.

- **A9 Screening & Discovery — TradingView, and the split is the finding.**
  - **Mechanism (expressiveness).** The Pine Screener points any plotting indicator at a
    watchlist or an index, so *the user's own logic becomes the scan*; the AI Screener returns a
    finished screen whose Explanation names every applied filter.
  - **Mechanism (authoring affordance) — Bloomberg's contribution.** `EQS` shows a live
    matching-company count *while each criterion lands*, and results carry an `As of` date,
    making a screen a query over a dated snapshot rather than a live feed.
  - **Mechanism (filter logic) — thinkorswim's contribution.** Three logical groups
    (all-of/none-of/any-of), ≤25 filters, option-metric and Greek filters, custom thinkScript
    conditions — but broker-locked: "leaving thinkorswim behind is a brokerage-transfer decision"
    (§4).
  - **Why Finviz is runner-up.** It wins universe and it is the desk's *measured* dependency
    (§2.2), not merely its stated one.
  - **✖ / ◻.** ✖ Gödel `EQS` has "no price, volume, moving-average, RS, ADR, gap, or pattern
    filter of any kind", confirmed by enumerating its documented field list. ◻ Whether
    Bloomberg's `EQS` distinguishes "no match" from "field unavailable" is NOT DETERMINED (Q10) —
    **the exact distinction UCT already ships** in `CoverageLine`'s four counts, and the one place
    in this file where the incumbent is behind by a named mechanism.

- **A10 Options & Flow — a deliberate three-way split.**
  - **Unusual Whales owns the tape.** It turns the full OPRA feed into one addressable row shape
    and then re-buckets it a dozen ways (interval, multi-leg, lit, futures, dark pool). Its best
    single presentation is dark-pool-versus-lit **as a percentage per price bucket** — "where is
    the size sitting", not "what just printed"; Periscope adds gamma/vanna/charm with
    positions-N-minutes-ago overlays at 10/20/30 minutes.
  - **SpotGamma owns the interpretation.** ⭐ The tier boundary *is the removal of a modelling
    assumption* — Total OI "predominantly assumes that options are sold by market makers",
    Synthetic OI removes it — and the assumption is documented in the free-to-read help centre,
    beside first-class negative open interest rather than a clamp to zero.
  - **thinkorswim owns per-position risk.** A Risk Profile with two curves (at expiration and
    today at implied vol) and probability of profit at each price slice, plus `thinkBack` over
    roughly a decade of stored historical option chains.
  - **Why Bloomberg loses.** `OMON`/`OSA` over the BVOL and LIVE vol engines is genuinely deep on
    surfaces and Greeks, but ✖ there is no flow, sweep, GEX or dark-pool product.
  - **✖ / 🔴.** ✖ Gödel ships "a chain and a Black-Scholes pricer" and nothing else. 🔴 Both
    positioning models are permanently unrankable against each other — SpotGamma's "multiple new
    data feeds" are deliberately undisclosed and UW's UI default (open interest vs directionalised
    volume) is unverified after an API default change on 2026-08-22 (§4.5).

- **A11 Breadth, Regime & Positioning — SpotGamma.**
  - **Mechanism.** A small **fixed, named** level vocabulary the member can carry between the
    note, the chart and the Discord (Volatility Trigger™, Zero Gamma, Call/Put Wall, Hedge Wall),
    published **with a base rate** — SPX opening above the Volatility Trigger averages 13% 5-day
    realised vol versus 18% below — and a twice-daily human note that cites the same names the
    app renders.
  - ⚠️ **Its own anti-pattern is in the same product.** "The Call Wall has held in 83% of daily
    trading sessions" is a hit rate with no sample window, no definition of "held" and no base
    rate (§N1). ⛔ Copy the vocabulary, refuse the format.
  - **Why nobody is runner-up.** ✖ TradingView has "no regime label, no breadth composite, no
    exposure recommendation" (§E-G); ✖ Benzinga is "effectively absent… 🟢 that it is absent
    (measured against a complete article inventory)"; ✖ AlphaSense — "A user can *read* about the
    regime; the product does not *compute* one"; ✖ Fiscal.ai — "ABSENT… the single clearest
    structural gap versus UCT"; ✖ Quartr absent; 🟡 Koyfin absent on market internals by taxonomy
    inference, and its macro regime "is an economist's regime, not a tape reader's"; ◻ Bloomberg
    holds every piece (`WAD`, `IMAP`, `BTMM`, `GV`) and how a user chains them into one regime
    read is a **named, still-open ceiling** after its own deepening pass (GAPS 8a).

### 3.2 Research and document surfaces

| Capability | Best-in-class | Runner-up | UCT today | Evidence |
|---|---|---|---|---|
| **A3 Fundamentals & Statements** | Bloomberg (normalisation) · Fiscal.ai (the copyable mechanism) | Koyfin | FMP `stable/*`; six independent `_fmp_get` helpers (`ledger D2`) | 🟡 — incumbent contested by its own users |
| **A4 Estimates & Analyst Actions** | Bloomberg | Koyfin | consensus only; FMP coverage .958; two Finnhub endpoints 403 (`ledger D3`) | 🟡 — recipe not public; point-in-time sold separately |
| **A5 Events & Calendar** | Bloomberg `EVTS` (staging) · Market Chameleon (the expected move) | Koyfin | `/api/calendar`, four views, nine reader classes, 130× cold/warm enrichment cliff (`ledger E1–E17`) | 🟢 on the MC mechanism · 🔴 on its numbers (Premium-gated) |
| **A6 Transcripts & Filings** | Quartr (delivery) · AlphaSense (retrieval) | Bloomberg `DS`/`EVTS` | FMP→AV→earningscall→Finnhub(403); **coverage measured n=0** (`ledger D6`, RG-15) | 🟢 — contractual SLAs and a documented operator language |
| **A7 Ownership** | Bloomberg `HDS` | Unusual Whales | five overlapping providers; Finviz the sole short-interest source; EDGAR Form 4/13F unused | 🟡 — 2019 fact sheet; `OWN`/`HDS` alias unresolved |
| **A8 News & Catalyst Intelligence** | Bloomberg (the query language) · Benzinga Pro (the delivery contract) | Gödel `N` | six-deep fallback living in control flow; catalyst engine, 8 sources → 10/5/3/2 quota (`ledger M6/K8`) | 🟢 on both mechanisms · 🔴 on every latency claim |
| **E1 People/Company Intelligence** | Bloomberg `MGMT` (thin) | ◻ | absent — "no equivalent anywhere in the ledger" | 🔴 — and see the ✖/◻ split below |

- **A3 Fundamentals & Statements — Bloomberg for the data model, Fiscal.ai for the mechanism.**
  - **Mechanism (Bloomberg).** Normalisation is a *view*, not a hidden choice — standardized
    (industry practice), adjusted (one-time items removed) and GAAP as-reported sit side by side.
    Calendarisation (`C1231`) and blended periods (`BA`/`BT`) are **named parameters**;
    point-in-time is a machine-addressable property (`AS_OF_DATE`, `FUNDAMENTAL_PUBLIC_DATE`); and
    the adjusted/as-reported toggle is a first-class data-layer parameter (`FA_ADJUSTED=Y`), not a
    screen control.
  - ⚠️ **The incumbent is contested by its own users — the sharpest counterweight in the file.**
    A 2025 vetted reviewer routes statement work to AlphaSense and Visible Alpha, `FA` "lacks
    Non-GAAP adjustments", and blank `FA` cells carry no explanation (§F Vendors, §J.2).
  - **Mechanism (Fiscal.ai) — what a small team can actually adopt.** Every figure click-through
    auditable to the source page (image, PDF *and* URL) at the exact page; standardized and
    as-reported as a visible toggle; ratio formula tooltips plus a public formula list; 20 years /
    40 quarters — for $49/month. ⭐ "Fiscal.ai's answer to 'did the model make this up' is not a
    validator, it is a link" (§I).

- **A4 Estimates & Analyst Actions — Bloomberg.**
  - **Mechanism.** `EEB` gives broker-level estimates **with the analyst and firm named**;
    `# Ests` sits beside the mean so a consensus of three is never mistaken for a consensus of
    thirty; `EEG` plots consensus **drift** against price (what is already in the price, as a
    picture); `MODL` carries consensus down to segment line items.
  - ⚠️ **Two structural limits.** BEst's construction rules are not public, and point-in-time
    consensus is a **separate product** (COFI) — so the live screens show *today's* consensus and
    "what was consensus then" is not answerable on them (§E.2, flagged as the most
    decision-relevant unknown in the earnings leaf).
  - ◻ **The comparison is incomplete.** The product a Bloomberg practitioner actually names for
    line-item consensus — Visible Alpha — is outside the benchmark universe and was never
    dossiered.

- **A5 Events & Calendar — split, and ⭐ the clearest non-obvious win in this document.**
  - **Mechanism (Bloomberg).** Earnings are staged **by time relative to the print**, not by data
    type (`EVTS` prepare → `EE`/`EEG` anticipate → `MODL` interpret → IB Forums act), and `EVTS`
    linked to a portfolio *pushes* releases at you.
  - ⭐ **But it has no expected move, and its own leaf says so:** "**Implied move:** raw materials
    only — `OMON`, `OVME`; **no dedicated earnings expected-move function found** 🔴" (§E.2).
  - **Mechanism (Market Chameleon).** It ships the thing Bloomberg does not, and ships the
    *calibration* rather than the number: "The options market **overestimated AAPL stocks earnings
    move 77% of the time in the last 13 quarters**. The predicted move… was ±3.9% on average vs an
    average of the actual earnings moves of 2.5%" — a standing per-symbol accuracy record of the
    market's own pricing, computed for every ticker with enough history, beside a table of 30-day
    IV at −5 to +5 trading days around each of the last 13 prints. ⭐ Its own note: "The
    differentiator is not 'shows an expected move' — it's the **scored historical calibration**",
    and it is "arithmetic on data UCT likely already holds".
  - ⚠️ **🔴 on the numbers.** Every strategy-backtest figure rendered as a "Premium" placeholder
    to a logged-out visitor. And ⛔ Market Chameleon "does not publish anything resembling UCT's
    six-gate rejection discipline — no visible sample-size floor, no null-model comparison, no
    stated rejection rate": borrow the entry/exit timing convention and the mid-point-price
    caveat, not the table.
  - **Why Koyfin loses.** A genuinely good calendar (90-day forward or trailing; forward showing
    consensus with highs/lows **and the number of contributing analysts**; trailing showing
    surprise versus average) with ✖ no expected move, no options positioning and no post-print
    reaction surface.

- **A6 Transcripts & Filings — split by half.**
  - **Quartr owns delivery.** Its SLAs are percentiles with named windows: live content "90%
    streamed and transcribed within 5 seconds of event start"; transcripts "available for 95% of
    events within 45 minutes after conclusion"; audio "90% of events within 20 minutes"; filings
    "90% within 15 minutes of public release"; slides "90% within 30 minutes". ⭐ A claim that
    states its own failure rate is worth more than a round number — the vendor is telling you 10%
    of live events miss the 5-second bar.
  - **And under it, one primitive behind five doors.** Chapters nested to level 3 with
    second-granularity timestamps and a stated invariant ("Chapters are always contained within
    the timestamp range of their parent"); search → the exact page; citation → the source
    side-by-side; alert → **the exact sentence, with audio playing from that moment**; slide → its
    own quarter-by-quarter history. ⭐ "The citation is a door, not a footnote."
  - ⚠️ **Disclosed only in the developer docs:** "Transcripts are only available for events
    conducted in English" — in a 65-market product.
  - **AlphaSense owns retrieval.** A real operator language (`NEAR(n)` = within n words, same
    sentence, any order; `PHRASE(n)` = in order; `TITLE()`; `in:[content]`; quotes suppress
    stemming) with **Smart Synonyms** so a boolean query need not enumerate its own vocabulary —
    which is normally what makes boolean unusable for non-librarians — and ⭐ **highlight-to-verify**:
    select text inside the generated answer and ask the system to substantiate *that specific
    claim*.
  - **Why Bloomberg loses.** `DS` over 200 million documents is broader, and its AI call summaries
    jump-link each point to the transcript excerpt — but the *door* is singular (`EVTS`, with
    `TRAN` UNVERIFIED) and its retrieval grammar is 🟡 beside two published ones.
  - ⚠️ **UCT's row is the harshest in this file:** transcript coverage was **measured n=0** in the
    one observed monitor cycle.

- **A7 Ownership — Bloomberg `HDS`.**
  - **Mechanism.** 179 countries, 500,000+ instruments, 100,000+ funds, 13F from 2006, 13D
    carrying "purpose of transaction", and US Forms 3/4/5 refreshed **hourly**.
  - ⚠️ **Caveats.** Dated (2019 fact sheet), and the `OWN`/`HDS` alias has been unresolved across
    a decade of Bloomberg's own collateral (R10) — "a four-letter namespace collides invisibly".
  - **Why Unusual Whales is runner-up.** Breadth of *cheap* disclosure — Congress, politician
    portfolios, insiders, 13F, FEC, short interest and FTDs — at retail price, which is also the
    acquisition channel it was built for.

- **A8 News & Catalyst Intelligence — split.**
  - **Bloomberg's news is a query language**, and it draws a distinction almost nobody else
    draws: a bare term matches *tags*, a quoted term matches *literal keywords*, and Bloomberg
    documents where that default fails. Around it: `N/5` proximity, `IN HEADLINES`, wildcards,
    `IN CHINESE`, `ON BTV`, `TNI` intersections, topic × source with source always second.
  - ⭐ **And the Advanced Editor shows stories-per-hour *before you save the search*** — a tuning
    judgement converted into a number at authoring time, which is the single mechanism in this
    file I would put in front of any UCT surface where a member authors a standing filter. Then
    the promotion path: a saved search becomes an `NI` code, becomes `NLRT`, and can be
    **suspended without losing its definition**.
  - **Benzinga owns the delivery contract.** `WIIM` is a dedicated news class existing to answer
    one question, rendered in a **fixed slot**, and ⭐ **absent rather than fabricated** ("Not all
    stocks have WIIMs") — "a slot that is sometimes empty is trusted; a slot that is always filled
    is not". Its importance ladder is three rungs **with published definitions**. Squawk is silent
    by default and ships a green/grey connection indicator — "Never again question if you are
    missing something on Squawk" — an availability tell on a stream whose failure mode *is*
    silence.
  - **And its Signals publish their *suppression* rules:** price spikes fire at most once per 10
    minutes per symbol; block trades only above 0.0005% of market cap (the common
    10,000-share/$200k definition explicitly rejected as too frequent); and a *New Day High/Low
    Series* signal that waits for one quiet second before sending.
  - ⚠️ **Benzinga's own 🔴s.** Its headline latency claim ("5–15 Minutes Before Mainstream
    Sources") is claimed, never measured; and its AI has **zero articles in a 119-article help
    inventory** — "a feature the support organisation has not written down is a feature the
    support organisation is not yet supporting."
  - **Why Gödel is runner-up.** Its `N` contributes the best *explain-the-filter* mechanism in the
    set: a two-layer filter model (per-window and account-wide), inline match-explanation
    snippets, and an audit Info panel enumerating every active filter — independently convergent
    with `CoverageLine`.

- **E1 People/Company Intelligence — the ✖/◻ split is the whole row.**
  - **What is established.** `MGMT` (executive and board profiles) is VERIFIED by two independent
    sources converging without citing each other.
  - **What is not.** Person-level cross-company relationship mapping — board interlocks — was
    **actively searched for and not found**, and the dossier records it as "a probable absence
    rather than a proven one" (GAPS 8d). ⛔ That is exactly the pair of claims this file refuses to
    merge.
  - **UCT.** Absent — and `capability-infrastructure-matrix.md` E1 is right that this is
    *unevidenced*, not excluded.

### 3.3 The member's own record

| Capability | Best-in-class | Runner-up | UCT today | Evidence |
|---|---|---|---|---|
| **A12 Watchlists & Lists** | Bloomberg (Monitor + `W`) | TradingView | "best keyboard model, worst reuse story"; two DnD implementations; device-local columns (`ledger I1`) | 🟡 — mechanism from ©2012/15 guides |
| **A13 Journal & Track Record** | ⌀ **no incumbent in this universe** | — | 267 modules, 47 `j2_*` tables, SnapTrade read-only mirror, holdings-as-truth, the Book *with its losses* (`ledger J1/J4/N3`) | 🟡 — see the comparison-class caveat |
| **A14 Portfolio & Risk** | Bloomberg `PORT`/MARS/MAC3/LQA | FactSet | `portfolio_heat.py` only; deferred by D8 | 🟡 — official brochure; factor counts uncorroborated |

- **A12 Watchlists & Lists — Bloomberg.**
  - ⭐ **Mechanism: copy-from-source versus link-to-source, chosen explicitly at import.**
    Bloomberg asks once whether a list is a snapshot or a subscription and never guesses; "a
    guessed default is wrong half the time and the wrongness is silent."
  - **Beside it.** `MNRS` restores up to ten previous monitor versions (version history built for
    exactly one object, because users destroy their own lists often enough to warrant it); a
    **News Heat** column bars current news activity per row; and the `W` worksheet costs nothing
    against the per-terminal download quota **until export**.
  - **Why TradingView loses.** Per-symbol text notes and a customisable Details section are good,
    but watchlist alerts are metered 0/0/2/15 across a $0–$199.95 ladder — ⛔ "a scarcity that
    reads as a defect": a user on a $29.95 plan reading "watchlist alerts: 0" cannot tell a
    business decision from a broken feature.

- **A13 Journal & Track Record — ⌀, with the caveat that keeps it honest.**
  - **The enumerated absences.** ✖ Unusual Whales: "no portfolio accounting, no trade journal, no
    broker sync, no coaching layer". ✖ SpotGamma: "Watchlist only. No positions, no P&L, no
    journal". ✖ Benzinga: "True portfolio analytics: absent. No P&L, no attribution, no risk".
    ✖ AlphaSense, ✖ Quartr, ✖ Fiscal.ai: watchlists only. Bloomberg `PORT` is institutional
    attribution, not a discretionary trader's record.
  - **An independent vendor convergence, not a threat.** Gödel's `BROK` is read-only via
    **SnapTrade — the same vendor, the same read-only posture, the same 15-broker roster and the
    same IBKR Flex-Query special case as UCT's own Journal 2.0.**
  - ⚠️ **The bound.** Trade-journal products (Tradervue, Edgewonk and their peers) are *not in the
    benchmark universe* and were never dossiered. So the honest verdict is **"unmatched among
    benchmarked products"**, ◻ not "best in the world" — recorded in GAPS.
  - **What UCT holds that nobody benchmarked holds.** A published track record with the losses in
    it (`ledger N3`, and `ledger F3`'s public scoreboard), and a lift ledger that reports lift
    rather than a hit rate under six gates (`ledger G6`).

- **A14 Portfolio & Risk — Bloomberg.**
  - **Mechanism.** VaR three ways (Monte Carlo, Historical, Parametric), *named* historical stress
    scenarios, 3,000+ factors in MAC3 — and the detail that matters for S8 as much as for A14: a
    click-through from the Tracking Error tab "to the underlying fundamental data for full risk
    data transparency".
  - **Why FactSet is close.** Breadth (10+ attribution models, four optimizers, 120+ risk models)
    and one sentence worth stealing: results "validated by FactSet — so your AI works from numbers
    that hold up in compliance reviews".
  - **UCT.** ⊘/deferred by D8 — a build-timing decision, not a gap; nothing in the inputs
    establishes it as desk-blocking.

### 3.4 Edge, chrome and platform primitives

| Capability | Best-in-class | Runner-up | UCT today | Evidence |
|---|---|---|---|---|
| **S1 Terminal Shell & Workspace** | Bloomberg Launchpad | TradingView desktop (multi-monitor) | RGL board + pop-out portal = "the multi-monitor story at zero backend cost"; no per-widget error boundary (`ledger C1/C5`) | 🟡 — ◻ whether a Bloomberg View spans displays |
| **S2 Command, Search & Navigation** | Bloomberg | Gödel Terminal | `CommandPalette.jsx` PROVISIONAL-SHIPPED 2026-09-03 ahead of OI-06; 87 raw keydown listeners; four ticker resolvers | 🟢 — the best-evidenced row in the file |
| **S10 Presentation Primitives** | Bloomberg (colour as a type system) | TradingView (one engine everywhere) | `VirtualResults`+`columnDefs` ≈ 80% of a DataGrid; 118 files define their own `fmt*` | 🟡 |
| **S12 Rollout, Cohort & Observability** | Gödel Terminal | TradingView | `user_tags` written and **read by no gate** — the ledger's only absent·absent row (`ledger P6`) | 🟡 |
| **S3 Entity Master** | ⌀ unrankable — internals not observable; **Quartr wins the published half** | FactSet (claimed, mechanism unpublished) | absent; ticker-only search (`ledger A8`) | 🔴 |
| **S4 Context Bus** | Bloomberg | Koyfin (the better design) | four colour groups, symbol-only, hydrated once per mount (`ledger C3`) | 🟢 |
| **S5 Persistence & User State** | Bloomberg | TradingView | `ledger C7` — the only `needs-extension` row; corrupt blob → empty board autosaved within 500 ms | 🟡 |
| **S6 Personalization** | LSEG Workspace | Bloomberg | three of seven evidenced moves are documentation-only | 🟡 |
| **S7 Alerts & Monitoring** | Unusual Whales (authoring) · Bloomberg (delivery + lifecycle) | TradingView · Koyfin | five-plus subsystems share one delivery function, no shared trigger model (`ledger I3`) | 🟢 authoring · 🔴 Bloomberg's `ALRT` grammar |
| **S8 Provenance & Freshness** | LSEG Workspace | Bloomberg · FactSet | `CoverageLine`'s four counts; a COT gate that **fails closed** (`ledger G2/H5`) | 🟢 — quoted at mechanism level |
| **S9 Entitlements & Licensing Gate** | Gödel `ENT` (mechanism) · TradingView (economics) | LSEG (published asymmetry) | `entitlements.py` reads a `toolkit` column the schema lacks ⇒ always `"all"` (`ledger G12/P5`) | 🟡 — Gödel's is BETA |
| **S11 Session & Market Clock** | ◻ **not established for any product** | — | absent as a system; `sessionModel.js`/`calendarTime.js` are the seeds | 🔴 |

- **S1 Terminal Shell & Workspace — Bloomberg Launchpad.**
  - ⭐ **Mechanism.** `LLP` promotes almost any function into a workspace component, **so the
    widget set is a by-product of the function set rather than a hand-curated registry.** That is
    the structural difference from UCT, whose `WIDGET_REGISTRY` is a hand-maintained 18 types
    (`ledger C2`).
  - **Around it.** A Component Browser opening on the 25 most popular components, starred by users
    and Bloomberg specialists, with a live preview; a Group Manager; and **Sample Views by asset
    class as the first-run experience — a live view you take apart, not a read-only demo** (the
    same posture as UCT's own `starter_library.py`, applied to boards instead of screens).
  - **Why TradingView is runner-up rather than winner.** It wins the multi-monitor half outright
    (native support, "synchronized workspace crosshairs" moving in tandem across displays) and
    loses the promotion half — there is no path from a page into a panel — while ◻ how a Bloomberg
    View spans displays is NOT DETERMINED.
  - ⚠️ **Read SpotGamma beside this row.** Canvas arrived in June 2026, *years after the tools*,
    and the consequences are visible in the documentation: components that cannot be grouped
    (Compass), per-component instance caps, and a per-page ticker box the workspace must
    reconcile. "Deciding symbol propagation before the surfaces is likely cheaper."

- **S2 Command, Search & Navigation — Bloomberg.**
  - **Mechanism.** One input surface accepts four kinds of thing — a mnemonic, a keyword for a
    function you cannot name, a partial security, and an English question — and disambiguates into
    one categorised list. Typing is *already* searching and `<GO>` commits. The yellow-key type
    system is **enforced** (`YA` on an index errors rather than rendering something plausible and
    wrong). `Number <GO>` gives every list row a keyboard address and Alt-Mode covers the rest.
    Help is a modifier on your current position (one press → the function's own **calculations**;
    two → a human, 24/7).
  - ⭐ **And the convergence in H1:** saved things become names.
  - **Why Gödel is runner-up and not an also-ran.** It proves the grammar is not a function of
    $30k — the same positional form at $118/month, with Bloomberg mnemonics accepted and rewritten
    so prior muscle memory transfers — **and it holds one mechanism Bloomberg does not**: the
    command string is reused as an *interchange format*, `{AAPL EQ G}` resolving identically inside
    a chat message, a changelog pill and a bug-report launcher. One grammar, addressable from
    anywhere that renders text.
  - **Why LSEG is third.** Its polymorphic bar (ticker → security page, short code → app, sentence
    → grounded answer, with the AI path *offered* by dropdown and never assumed) is the most
    learnable version in the set, and is "structurally weaker at *composition*" — there is no
    evidence you can express "this ticker, in that app, on that timeframe" in one sequence.
  - **✖ / ◻ for the rest.** ✖ TradingView has no palette and bare typing resolves only symbols
    (inferred from a complete shortcut-category list). ◻ FactSet, AlphaSense, Quartr, Fiscal.ai,
    Benzinga, SpotGamma and Koyfin's keyboard depth are all **not established** — five say so
    explicitly, and Benzinga's is the sharpest formulation: "an absence measured against a complete
    inventory… **but it remains an absence in the *docs***".

- **S10 Presentation Primitives — Bloomberg.**
  - ⭐ **Mechanism: colour as a type system** — red stops, green acts, yellow selects a sector,
    **amber marks the only editable fields on the screen**, a white outline marks what is
    clickable. A dense screen made legible by a rule instead of by whitespace, and close to free
    to adopt.
  - **Why TradingView is runner-up.** One engine everywhere — the same Supercharts renders the
    standalone chart, symbol pages, screener drill-downs and embeds, so muscle memory transfers.
    Which is what 118 local `fmt*` implementations prevent at UCT.

- **S12 Rollout, Cohort & Observability — Gödel Terminal.**
  - ⭐ **Mechanism: status at the point of use.** BETA pills on the docs index itself, and a
    two-column "In Gödel today / Working on" strip on the pricing page a prospect reads *before
    paying*. This is the member-facing analogue of UCT's own flag-ledger lesson that off-and-unset
    is indistinguishable from off-on-purpose.
  - ⚠️ **Its own anti-pattern, in the same product.** `EQS` is simultaneously the only answer to
    "does it screen?" and permanently beta-labelled — ⛔ "the label lets it stay unfinished without
    being judged as unfinished."
  - **Why TradingView is runner-up.** Published beta scope: the AI Screener's beta status, its plan
    availability and its monthly request balance are all stated.

- **S3 Entity Master — ⌀, with a published half.**
  - **Why unrankable.** No vendor publishes its entity master, so the row is structurally
    unrankable (§4.7).
  - ⭐ **What *is* published, and best: Quartr's identifier discipline.** Five families
    (`companyId`, exchange-ticker *pairs*, ISIN, zero-padded CIK, OpenFIGI
    figi/compositeFigi/shareClassFigi), with the ticker treated as **ambiguous user input** while
    `companyId`/ISIN/FIGI are machine identities, every response carrying `companyId`, and the docs
    stating plainly that a ticker query returns "all companies matching that symbol… regardless of
    exchange" unless you add `exchanges`.
  - **FactSet asserts the same thesis and publishes no mechanism** — "permanent entity and security
    identifiers", "a single master identifier", CUSIP Global Services bought for $1.925B, ◻ no
    mechanism. Bloomberg accepts CUSIP/ISIN/BBGID into one grammar.
  - **UCT.** Absent, and `cap_universe` is a membership gate, not an identity registry.

- **S4 Context Bus — Bloomberg, with Koyfin holding the better design.**
  - **Mechanism.** The loaded security is an **explicit, labelled, per-panel field with two recents
    drop-downs** (securities and functions — mirroring the what/how split), and cross-panel linkage
    is opt-in, never automatic.
  - ⚰️ **A correction this file must carry.** No source anywhere documents colour-coded component
    groups at Bloomberg — the badge is `Group-1, #A` and red appears only as a transient editing
    highlight (R2). "Bloomberg links widgets by colour" is a claim that needs its own source and
    does not have one.
  - ⭐ **Koyfin should be the model.** Seven groups whose payload is **polymorphic** — a group
    carries Single Security, Multiple Securities, *or* My Watchlists, and changing the *method* in
    one widget changes it across the group — with coverage stated honestly per widget type. That is
    exactly the generalisation `capability-infrastructure-matrix.md` S4 asks for (typed payload
    kinds beyond symbol-only).
  - ⭐ **Five products converged independently** on symbol-link groups (Bloomberg, Gödel's
    colour-linked windows, SpotGamma Canvas grouping, Koyfin, UCT's A–D): corroboration that the
    mechanism is forced by the problem, not chosen by taste.

- **S5 Persistence & User State — Bloomberg.**
  - **Mechanism — the two things UCT most visibly lacks.** **Version history on the user's own
    curation** (`MNRS`, ten-deep, built for exactly one object) and **autosave as a visible
    toggle** (TradingView's layouts ship Save, Ctrl+S, *Autosave on/off* and Make-a-copy) rather
    than an invisible 500 ms debounce.
  - ⚠️ **What Bloomberg does not do.** It restores window count, positions and zoom at logon —
    while "You cannot restore a tab after you close it", and ◻ whether *content* (the function
    running in each tab) is restored is NOT DETERMINED.
  - ⛔ **Benzinga is the negative example to avoid outright.** Workspaces "save to your internet
    browser cache… This can cause issues when you are trying to access your platform on different
    computers, or if your local storage is cleared" — documented in the same breath as the design.

- **S6 Personalization — LSEG Workspace.**
  - ⭐ **Mechanism: progressive onboarding where every question buys something.** LSEG asks role,
    asset classes, primary asset class, languages, theme and movement colours — and each has a
    visible payoff. Role and asset class **re-rank the menus** ("to make it easier for you to find
    the features… important to your workflows"). A declared *Location for Search* biases ticker
    ranking (searching `BP` with Italy selected "may give a higher priority to Banco Populaire over
    British Petroleum"). Four regional up/down colour templates ship (American, European, Asian
    1 & 2) because red/green conventions differ by region. And **interface language is chosen
    separately from content language**.
  - ⭐ None of these is a power-user feature; all of them are respect-for-the-reader features, and
    they are the cheapest personalisation in the set.

- **S7 Alerts & Monitoring — split, and the split names UCT's actual gap.**
  - **Why the split matters.** UCT already shares *delivery* (`deliver_alert_payload`) and lacks
    *authoring* — so the relevant winner is the authoring one.
  - ⭐ **Unusual Whales owns authoring.** "Every custom alert can be written as a single formula:
    `where` followed by the conditions you care about", with `k`/`m`/`b`/`%` shorthand,
    `and`/`or`/`not` with explicit grouping, scope prefixes a user can guess (`$AAPL`, `@tech`,
    `#mylist`), **one language across five typed subjects** (option trades, option contracts,
    interval flow, flow alert, multi-leg trade) so learning it once pays five times, and ⭐
    **field-to-field comparison** — `volume > open_int`, which no number of sliders can express.
    A machine-readable counterpart exists (`GET /api/alerts/query/grammar`), and the AI builder
    **emits the formula** instead of replacing it, so what the user ends up owning is inspectable
    text.
  - **Bloomberg owns delivery and lifecycle.** One alert object fans out to five channels ordered
    by intrusiveness; external email is achieved by a *single global routing rule* (`MRUL`) so
    every future alert type inherits the plumbing for free; and a saved search promotes to a
    standing alert that can be **suspended, not only deleted**. ⚠️ It is disqualified from the
    authoring half by rule 2 of §2.4.
  - **TradingView contributes the best single trigger shape.** An alert attached to a long/short
    position drawing, so "a single alert watches your entry, stop loss, and take profit".
  - **Koyfin contributes the type UCT should add first.** Documents as a peer of Price and
    Valuation (press releases, news, transcripts, filings), created from a quote box or by
    right-clicking a ticker cell, with desktop/email/mobile each individually toggleable.

- **S8 Provenance & Freshness — LSEG Workspace.**
  - **Mechanism, quoted because paraphrase weakens it.** *"For structured data… citations appear
    inline at the point of use, so every figure can be traced back to its source. **When data is
    presented in a table, each value carries its own citation.**"* Document citations open the
    source in a dedicated canvas view and *"clicking a citation will highlight the exact
    passage"*.
  - ⭐ **And a third tier no other vendor has.** Licensed third-party research is **never
    summarised** — "You are shown verbatim extracts taken directly from the underlying AMR report.
    No generative AI interpretation, rewriting, or summarisation" — always surfaced as a distinct
    source, never blended, and metered per page at display. The tier exists for contractual reasons
    and produces an unexpectedly good epistemic result: *the content the vendor does not own is
    never paraphrased by a model.*
  - ⭐ **LSEG also publishes its own citation bugs at GA** ("citations may show incomplete
    attribution and, on occasion, can be missing from responses"), which no other vendor in the set
    does.
  - **Why Bloomberg is runner-up.** Data Transparency (green = composite value, blue = source
    document, drilling to the filing) is 🟢 in the Excel add-in and R on the Terminal, and the
    principle is independently stated twice by Bloomberg in unrelated contexts — which its own leaf
    calls "the strongest evidentiary shape this dossier uses".
  - ⭐ **On one sub-property UCT is already ahead, per the incumbent's own dossier:** "UCT's own
    `cotFacts.js`/COT grounding gate is the stronger version already, **because it fails closed**"
    (Bloomberg M7).

- **S9 Entitlements & Licensing Gate — three mechanisms, each answering a different question.**
  - **Gödel `ENT` — best user-facing mechanism.** À-la-carte exchange entitlements the member
    subscribes and unsubscribes themselves, showing the **Retail versus Professional rate per
    feed**, prorated. ⚠️ BETA.
  - **TradingView — best published economics.** Professional status enforced at the **data** layer
    rather than the software layer, per exchange, with prices on the page (NASDAQ $3.00 non-pro
    versus $27.00 pro; a $9.95 US bundle professionals cannot buy at all).
  - ⭐ **LSEG — the artefact UCT should copy.** A *Desktop and Web Comparison* document "whose
    entire purpose is to tell you what you lose by choosing a surface": Excel COM add-in "Not
    available" on web, send-by-email "News only", and **2,500 streaming RICs on desktop versus
    1,000 per browser tab**. ⭐ "Being explicit about what a surface *cannot* do is a trust feature,
    not an admission."
  - ⛔ **Bloomberg is the anti-pattern and its own leaves say so.** A per-terminal download cap that
    is unpublished, unresettable, has no gauge, and fails as `#N/A Limit` — "the user finds out by
    failing". ⛔ Never ship a hard cap without a visible remaining-budget reading (M5, "the corpus's
    strongest, most-corroborated anti-pattern-as-lesson").
  - ⚠️ **And TradingView's own anti-pattern in the same row.** Do not make a member resolve
    entitlements before they can see a price tick.

- **S11 Session & Market Clock — ◻, honestly.**
  - **The finding.** **No dossier in the universe documents a session-clock primitive.** Not one
    help centre, command index or release-note corpus names `sessionState`, a half-day rule or a
    pre/RTH/post boundary as a product surface.
  - ⛔ **What that is and is not.** An absence of *evidence* across fifteen products, not a finding
    about any of them — a vendor's help centre has no reason to document an internal clock. The row
    stays ◻ and the architecture's own judgement stands unchallenged: this is "one of the cheapest
    genuinely-new systems in the whole matrix — small, well-bounded, zero licensing exposure".

### 3.5 Data platform and intelligence

| Capability | Best-in-class | Runner-up | UCT today | Evidence |
|---|---|---|---|---|
| **D1 Provider Abstraction** | TradingView (the observable half: published per-field lineage) | Fiscal.ai (publishes the seam) | absent, with one exception: `finnhub_client.py`, "the internal reference implementation to copy" | 🟡 — an ACL is invisible from outside |
| **D2 Canonical Model & Metric Address Book** | Bloomberg | Koyfin (user-minted verbs) | absent; ~55 SQLite files, 286 `CREATE TABLE` names, no single place that knows the model | 🟡 |
| **D3 Realtime Streaming** | Unusual Whales (tape breadth) | Bloomberg B-PIPE (enterprise) | Massive OPRA WS + bars push; ≈300 concurrent browsers per stream family (`ledger A2`) | 🔴 on latency for **every** product |
| **D4 Caching & Serving** | Bloomberg (the posture) | — | `serve_stale`/`cache_snapshot`/circuit breaker — "the most valuable code in `api/`", adopted at 5 sites | 🟡 |
| **D5 Reference & Corporate Actions** | Bloomberg `CACS` | TradingView (the cheap version) | B-class underutilised; dividends still route to yfinance (X-class) | 🟡 — official page, uncorroborated counts |
| **I1 Intelligence Layer** | LSEG (grounding) · TradingView (config-as-citation) · ⌀ **nobody (a decisive verdict)** | Bloomberg (span anchoring) | 154-tool registry; six-plus AI doors each with its own gate; `grade_ticker`'s structural verdict; report card 12/50 | 🟢 on the refusals · 🔴 on every accuracy claim |

- **D1 Provider Abstraction — TradingView, on the observable consequence.**
  - **Mechanism.** An adapter is invisible from outside, so the row is won on its *consequence*.
    TradingView credits **ICE Data Services** (market data), **FactSet** (reference data) and
    **Quartr** (filings) by name inside its own help centre — per-field lineage published where a
    user can read it.
  - ⭐ **Fiscal.ai goes one better and publishes the seam:** which rows are first-party, which come
    from S&P Capital IQ, how each refreshes (3–7 minutes versus 24–48 hours), and what the licence
    forbids showing you ("Due to licensing agreements with our data providers, 20yrs of financial
    data is not available in the dashboard at this moment").
  - ⚠️ **Koyfin is the counter-case, and the honest one.** "We don't allow users to get data via API
    because of restrictions from our data providers. They are in the API business. We are in the
    analytics business."

- **D2 Canonical Model & Metric Address Book — Bloomberg.**
  - **Mechanism: a field is an address.** `BDP`/`BDH`/`BDS`/`BEQS` in Excel; `FA CF` as a directly
    addressable sub-report; `FA_ADJUSTED=Y` as a data-layer parameter rather than a screen toggle;
    `AS_OF_DATE`/`FUNDAMENTAL_PUBLIC_DATE` making point-in-time a first-class machine-addressable
    property instead of an assumption; and `BQL`'s `filter(universe, expr)` as the server-side
    escape hatch expressed as the same primitive as "get me a field".
  - ⭐ **Koyfin's runner-up mechanism is the one a small team can ship this quarter.** A saved chart
    template, dashboard or FA template can be **assigned a user-minted shortcut** (`fcsp`, `DBOLL`,
    `RGM`), and chart-template codes **compose with a ticker** — "Koyfin has separated the
    *namespace* of navigation from the *vocabulary* of navigation… the user extends the verb set
    with their own saved artefacts."
  - ◻ Its shortcut-collision policy is undocumented, which is precisely the question UCT would have
    to answer.

- **D3 Realtime Streaming — Unusual Whales, and ⛔ the load-bearing negative.**
  - ⛔ **Nobody wins on speed.** No product in this universe publishes a measured end-to-end
    latency (§2.5).
  - **Mechanism (breadth).** The full OPRA feed — "all 6,000,000 option trades" — with off-lit
    prints flagged and `trf_executed_at` distinguished from `executed_at`.
  - ⭐ **Its honest posture is the transferable part.** `force_15_min_delay` exists as a **product
    control** — "the delay is a product control, presumably for redistribution licensing, not a
    data limitation."
  - ⭐ **And it sells *cadence* as a tier** (10-minute versus 1-minute SPX dealer exposure,
    $75 → $120): where a real-time computation is expensive, the cheap tier is slower rather than
    broken. That is the cleanest answer in the set to UCT's own single-process fan-out constraint.

- **D4 Caching & Serving — Bloomberg, on posture alone.**
  - ⭐ **Mechanism: name it, queue it, notify me.** `EQS`'s backtest is a **queued job that emails
    you when it finishes** — the screen is not held hostage by its heaviest feature — and `BQL`
    runs on Bloomberg's servers and fails *loudly and actionably* ("Response for px_last is too
    large. Apply `filter()` / `group()`"). Bloomberg "does not pretend the heaviest work is instant;
    it names the job and delivers out of band."
  - **No runner-up.** Caching is not externally observable anywhere else in the set.

- **D5 Reference & Corporate Actions — Bloomberg `CACS`.**
  - **Mechanism.** Located precisely — a per-security `DES` page rather than a standalone monitor —
    over "more than 50 event types across asset classes… over one million related actions added
    annually", produced by automated ingestion plus corporate-action analysts who "follow the sun".
    ⚠️ 🟡: official page, no independent corroboration of the counts.
  - ⭐ **The cheap adoptable versions are the runner-up's.** TradingView's explicit split-confirm,
    and a **labelled** raw-plus-adjusted view ("split-adjusted, 2026-09-02" / "as reported") —
    "cheaper-than-a-full-corporate-actions-engine responses".

- **I1 Intelligence Layer — three winners and an empty cell.**
  - **LSEG wins grounding** (see S8) and additionally wins the thing almost nobody does: ⭐ **it
    publishes what its AI cannot do**, in its own words — real-time data "not currently supported",
    no exact dates or custom ranges, non-deterministic answers ("answers may vary between users or
    across sessions"), "you should always verify critical figures against the cited source", and a
    published *Known issues* list at GA.
  - ⚠️ **Its own second-authority defect is instructive.** Three live LSEG documents disagree about
    its model stack (GPT-5 + Claude Opus 4.6 per the FAQ; GPT-4 + ADA2 **plus an optional Bing
    fallback** per the Explainability Note) — and an ungrounded web fallback inside a product sold
    on grounding is a material governance fact nobody has reconciled.
  - **TradingView wins config-as-citation.** The AI emits an editable configuration with an
    Explanation panel naming every applied filter and the sort and the columns — "the artefact *is*
    the citation", achieved with no citation machinery at all. ⛔ With one anti-pattern to refuse:
    "Running an AI request replaces any manually set filters" — stage beside, never over.
  - **Bloomberg wins span anchoring.** An AI call summary whose every point **jumps to the
    transcript excerpt** and links out to `MODL`/`BDVD`/`SPLC` — "the summary is an index over the
    source, never a substitute".
  - **Three further mechanisms worth carrying.** AlphaSense's **highlight-to-verify**; Fiscal.ai's
    **entitlement inheritance** ("Your assistant can only retrieve data you could retrieve yourself
    with your API key for the same tickers, periods, and features"); and AlphaSense's
    **credit-usage forecast line** that warns whether an organisation will exhaust its allocation
    early — ⭐ "notably better than a hard cap — it warns before it bites", which is the answer to
    Bloomberg's M5 anti-pattern.
  - **And the empty cell.** ⌀ No product ships a decisive grounded verdict, by policy, in writing
    (H3).
  - ⚠️ **🔴 across the board on quality.** AlphaSense's §I records "no accuracy evidence exists
    publicly for any AlphaSense AI feature" and ⛔ flags its own homepage's "Sentence-level citations
    with no hallucinations" as an unfalsifiable claim its help centre contradicts. Benzinga's AI has
    zero help-centre articles. Fiscal.ai's FinanceBench figure is unreplicated. **Nobody in this set
    has published an eval**; UCT has two report cards and a free grounding audit (`ledger K12`),
    which is a genuine, unglamorous lead.

### 3.6 Three extension rows — declared, with reasons

⛔ These are **additions to this document only**. `capability-infrastructure-matrix.md` remains the
single owner of the taxonomy; if these rows are adopted they belong in that file, added there, not
mirrored here.

| Capability | Best-in-class | Runner-up | UCT today | Evidence |
|---|---|---|---|---|
| **X1 Collaboration & Publishing** | Bloomberg IB | Unusual Whales (the trust mechanism) | The Floor (48 routes, 400-subscriber hub, **no backup rail for member posts**); definition/chart share links; the public flow scoreboard | 🟡 — "what" 🟢, "how it feels" 🔴 |
| **X2 Data Egress & Programmatic Access** | Unusual Whales | Bloomberg | no member API, no MCP server, no skill file; the ICS export token has **no TTL** | 🟢 |
| **X3 Learning & Onboarding** | Bloomberg (`FFM`) | SpotGamma (per-surface checklists) | the curriculum — "the asset most ready to become a product and least dependent on live data" (`ledger L6`) | 🟡 |

- **X1 Collaboration & Publishing — Bloomberg IB.**
  - **Why added.** The Part XIII taxonomy every dossier populates has a **Collaboration** bucket;
    all fifteen products put something in it; and no row among the 33 owns it —
    `product-architecture.md` §1.4 deliberately leaves Bloomberg's network effect as an open
    product-vision question and puts Community (M1) out of that document's scope.
  - **Mechanism.** IB's **structured data links** turn a mentioned ticker into a route back into a
    Terminal function, so the chat transports *objects* rather than text; compliance surveillance is
    in-product; and the corpus's most experienced practitioner ranks the two moats explicitly,
    saying centralised data is "much easier to replicate than the network effects".
  - ⭐ **The non-obvious runner-up mechanism is better value for UCT.** Unusual Whales marks the
    community's shared calls **to market, publicly, including −99% and −91% beside the poster's
    name** — "a stronger trust signal than a curated wins feed", and the thing that converts a chat
    room into a track record.
  - ⛔ **N4 binds.** Building an IB-shaped widget only the desk is on reproduces the form of the moat
    and none of its substance.

- **X2 Data Egress & Programmatic Access — Unusual Whales.**
  - **Why added.** Bloomberg's own capability map carries a *Data egress / API* row; three products
    sell an API as a co-equal product and one refuses one on purpose; S9 *gates* egress and D1 is
    *ingress*, so no row among the 33 owns the outbound contract.
  - **Mechanism.** 221 documented REST/WebSocket paths, an MCP server, named build recipes, a free
    one-week API trial — and ⭐ **a published `skill.md` whose load-bearing half is an endpoint
    whitelist that exists to stop an agent inventing endpoints.** "UW's most credible AI investment
    is not the chatbot — it is making the product legible to somebody else's agent."
  - **What the runners-up add.** Fiscal.ai: entitlement inheritance and a named skills catalogue
    invoked by name (`$fiscal-comp-set`). Quartr: the rigour — identifier discipline, `429` with
    reset headers, cursor pagination, and an explicit "poll `updatedAfter` with `limit=500`"
    incremental-sync recommendation.
  - **✖ with two different meanings.** ✖ SpotGamma refuses an API outright — "A public API is not
    yet available" — and ⛔ that is a *commercial* decision protecting an interpretation moat, not an
    architectural one to copy. ✖ Gödel's has been "Coming soon" across two independent public asks
    nine months apart, while a second official page says enterprise access exists "on a
    case-by-case basis" — two live pages, one question, no reconciliation.

- **X3 Learning & Onboarding — Bloomberg (`FFM`).**
  - **Why added.** Every dossier produced onboarding findings and no row owns them; TradingView's
    help centre makes discoverability a first-class product question.
  - ⭐ **Mechanism.** `FFM` — "Functions for the Market" — pegs discovery to *today's* move rather
    than to a static catalogue. It is the cheapest onboarding idea in the whole corpus and it rides
    content UCT already ships daily: one sentence in the wire naming the surface that explains
    today's move. Beside it, per-persona cheat sheets curating roughly 90 of ~30,000 functions
    ("the map, not the menu, is how the surface stays learnable") and help as a modifier on
    position.
  - ⭐ **SpotGamma's runner-up is arguably better for a small product.** A numbered "how to trade
    with this" checklist article per analytic surface — "the ritual is what converts a page into a
    habit".
  - ⚠️ **TradingView is the warning.** Its largest Chart help folder is titled **"I can't find a
    certain feature or setting" — 43 articles.** "Capability without a findability budget converts
    into support volume, not user value." ⚠️ And FactSet's tell: "A vendor that ships a *tab* for
    learning is telling you the product is not self-evident."

---

## 4. Where "best" is contested — and what would settle each

⭐ This section is more useful than the matrix, because every row above that reads as a clean
verdict is a decision I made; these are the ones the evidence genuinely will not support.

1. **Fundamentals depth versus fundamentals workflow (A3).** Bloomberg's normalisation triple is
   unmatched *as a data model*; its own power users route statement work elsewhere; Fiscal.ai
   delivers auditability the incumbent only reports having, for $49.
   **What would settle it:** the same ten line items for the same company in each product, side by
   side, including a GAAP-to-non-GAAP reconciliation and one restated period — which needs three
   seats, not more reading.
2. **Latency, anywhere.** ⛔ Unrankable by construction: not one measured figure exists in any input
   (§2.5).
   **What would settle it:** one instrumented session per product against a single known catalyst on
   a single clock. Quartr's percentile SLAs and Fiscal.ai's "3–7 minutes after earnings" are the
   only two claims already falsifiable without a seat.
3. **Screening (A9) — three products win three different halves.** Expressiveness (TradingView),
   universe and desk-dependency (Finviz), authoring affordance (Bloomberg `EQS`), filter logic
   (thinkorswim).
   **What would settle it:** express one real UCT screen — price above the 20-EMA, ADR > 4%, volume
   at an N-week low — in each, and count which can express it *at all*. The Gödel dossier already
   predicts failure for `EQS` and says "Expect failure; confirm it", which is the right shape for
   the test.
4. **AI grounding (I1, S8) — three vendors use three incompatible definitions of "grounded".** LSEG
   anchors per value in a table; Bloomberg anchors per bullet to a transcript span; TradingView
   anchors nothing because its output *is* configuration; AlphaSense anchors on demand via
   highlight-to-verify.
   **What would settle it:** ask each the same question its corpus cannot answer and record whether
   it refuses, hedges, or answers anyway — which is also Bloomberg's own open question about ASKB
   and "the only behaviour that matters for a desk that will act on the answer".
5. **The two dealer-positioning models (A10) are permanently unrankable on public evidence.**
   SpotGamma's Synthetic OI rests on "multiple new data feeds and proprietary SpotGamma algorithms",
   deliberately undisclosed — its own dossier says "No public source will close this; do not spend
   Wave 2 budget on it" — and Unusual Whales' UI default (open interest versus directionalised
   volume) is unverified after an API default change on 2026-08-22.
   **What would settle it:** nothing purchasable. Both would have to publish a method.
6. **Workspace (S1): promotion versus multi-monitor.** Bloomberg has `LLP` and ◻ no stated
   monitor-spanning behaviour; TradingView has native multi-monitor with synchronised crosshairs and
   no promotion path; LSEG is mid-migration between two desktop containers with an "Under
   development" column between them.
   **What would settle it:** a two-monitor session on each — which for Bloomberg means the seat that
   OI-08 has not produced.
7. **⛔ Four rows cannot be ranked at any research budget, because the artefact is not externally
   observable.** S3 (entity master), D1 (provider abstraction), D2's internals, D4 (caching). No
   vendor publishes a schema or an adapter. What is rankable is the *consequence* — published
   lineage, published identifier semantics, a queued-job posture — and that is what §3.5 ranks.
   ⛔ Do not read those cells as claims about anyone's internals.
8. **Gödel Terminal overall.** DEMONSTRATED is **empty by construction** for this product: no
   official video channel exists, every located video is affiliate-tagged or on the founder's
   personal channel, and `godelterminal.com` returns 403 to automated fetchers. It is nonetheless
   the closest structural analogue to TERMINAL-NEXT in the universe, and it offers a **14-day,
   no-card, self-serve trial** that no one has opened (OI-18, disposition "No trials; ceilings
   recorded").
   ⭐ **That is the cheapest unopened door in the entire programme**, and the highest-value first
   screenshot is named: open `CHANGE` and photograph the changelog, because no public release
   history exists at all.
9. **Whether thinkorswim's Analyze tab belongs in any of this.** Its capabilities are 🟢; the desk's
   use of it is 🔴 with **zero references across four repositories**. If the desk uses the Risk
   Profile daily, A10's "per-position risk" half is an urgent gap; if only around earnings, it is
   not.
   **What would settle it:** one sentence from the owner. The same question governs whether Market
   Chameleon's slot should be swapped for OptionStrat (OI-19).

---

## 5. What best-in-class costs — and where matching it is sane

**Every enterprise incumbent refuses to publish a price, and the programme refuses to launder
one.** Bloomberg publishes none (reported, with dates, never as a number: $21,000 in 2016 ·
$24,000–27,000 in 2022 · "starts at $30,000" after a 2023 hike · "$25k to $36k" from a practitioner
in 2025-11 · $31,980 in a 2026-04 essay). ⚰️ And §2.6's collision applies:
`benchmark-universe.md` traces the widely repeated "$31,980/yr" table to **affiliate content**, so
the honest form is the dated range. FactSet publishes nothing and the only defensible anchor is
*derived and caveated* — $2.3B FY2025 revenue ÷ ~240K users ≈ **~$9,600 blended annual revenue per
user, which includes feeds, APIs and CUSIP licensing and must never be quoted as a seat price**.
LSEG has **no defensible number at all** (the ~$10k–$25k/user/yr cluster is entirely excluded-tier
sources). AlphaSense publishes none; its only anchor is a third-party buyer guide reporting a
**$17,500 median contract from 38 purchases, range $9,250–$51,000** (unaudited provenance,
order-of-magnitude only). Quartr and S&P Capital IQ Pro publish none, and CIQ Pro's opacity is "by
design, not by omission".

**Where the best mechanism is cheap, the price is published.** All list monthly, read 2026-09-02,
from the vendors' own pages:

| Row | Best-in-class mechanism | Its list price |
|---|---|---|
| S7 authoring | Unusual Whales `where` grammar | **$50/mo** (Retail Basic; all three retail tiers include the full real-time tape) |
| I1 config-as-citation | TradingView AI Screener | **$12.95/mo** (Essential; the feature is on *all* paid plans) |
| A2 charts | TradingView Supercharts | **$0 → $199.95/mo** + per-exchange data $0–$548/mo |
| A11 regime | SpotGamma Alpha | **$299/mo** ($2,691/yr); Essential $99/mo |
| A5 expected-move calibration | Market Chameleon Total Access | **$99/mo** (single tier, 7-day trial) |
| A9 universe | Finviz Elite | **$39.50/mo**, or **$299.50/yr** (⚰️ the "$24.96/mo" on Finviz's own pages is the annual plan's effective monthly rate, not a cheaper tier) |
| S2 grammar · S9 entitlement UX · S12 status | Gödel Terminal | **$118/mo** (or $996/yr), **+$30/mo** FINRA surcharge |
| A6 transcript delivery | Quartr Pro | **not published**; the free mobile app keeps the core loop |
| A3 auditability | Fiscal.ai Max | **$99/mo** ($79 annual) |
| A8 delivery contract | Benzinga Pro Essential | **≈$197/mo** monthly, $166.42/mo on annual; +$27.97/mo unusual-options add-on; +$99/mo High Beta Squawk |
| A10 per-position risk | thinkorswim | **$0** with a funded Schwab account (+$0.65/contract) |

**What the arithmetic implies.** Summing the single best-in-class product per row for the rows that
serve this desk — Unusual Whales Retail Pro $75 + SpotGamma Alpha $299 + TradingView Premium $59.95
+ Finviz Elite $39.50 + Market Chameleon $99 + Fiscal.ai Max $99 + Gödel $118 — gives
**≈$789/month, ≈$9,470/year per seat**, summed from the list monthly prices in the table above (my
arithmetic over those seven rows, at list, monthly billing, before any data add-on or annual
discount; not a quote and not a recommendation). ⚠️ Gödel markets a similar construction as
">$2,000 in media subscriptions consolidated" — unsourced arithmetic on its own homepage, and I do
not repeat it as a fact.

**Three conclusions, and only the third is about price.**

1. **⛔ Matching best-in-class *data* is out of reach and should not be a goal.** Bloomberg's own
   moats are absences; its content is 2,700 journalists and 100+ fundamentals analysts; LSEG's is
   Reuters plus 10,000 sources; AlphaSense's is 1,500 broker-research providers and 300k expert
   transcripts that "a competitor cannot copy". None is purchasable at this scale, and F-09's own
   ranking already says the estate's real vendor gaps are three narrow ones (a backup screener
   universe, short-interest history, licensed futures quotes).
2. **⭐ Matching best-in-class *mechanisms* mostly costs engineering and no licence at all.** Colour
   as a type system, copy-versus-link at import, stories-per-hour at authoring time, a published
   surface-capability matrix, an endpoint whitelist, autosave as a visible toggle, a fixed level
   vocabulary, the honest empty slot, a per-surface trading checklist, `FFM`'s teach-from-today's-
   tape, publishing the cap, a forecast line instead of a hard cap — every one of those is a design
   decision with zero data spend, and a majority of them come from products costing under $120 a
   month.
3. **The price ladders themselves are the most transferable commercial finding, and three of them
   are structurally different.** Unusual Whales meters **saved configuration** (all three tiers get
   the full real-time tape; what Pro buys is the removal of a counter). TradingView meters
   **quantities** (nothing is removed, everything is counted). SpotGamma meters **the quality of the
   model** — Essential ships the assumption, Alpha removes it. ⭐ "Tier on the quality of the model,
   not the size of the dataset" is a boundary a member can understand and one that does not degrade
   the cheap tier into uselessness. ⛔ None of this is a proposal: UCT's tiering is owner-bound
   (OI-12, D5, and the `FREE_PAGES` inversion DL-010).

---

## 6. Where UCT is closest to best-in-class, and where the gap is largest

### 6.1 The five closest — with the specific mechanism that closes the remaining distance

1. **A10 Options & Flow.** Already the named moat — "options-flow/GEX depth Bloomberg and Gödel
   lack" — and the evidence agrees: ✖ Bloomberg ships no flow/sweep/GEX product, ✖ Gödel ships a
   chain and a pricer.
   **Mechanism that closes the rest:** SpotGamma's assumption label. Put "this number assumes
   dealers sold every option" in the GEX tooltip and make removing it the upgrade. That is a tooltip
   and a tier boundary, not a build.
2. **A11 Breadth, Regime & Positioning.** No benchmarked product ships a breadth composite or an
   exposure recommendation; four ✖ absences are enumerated and the fifth (Bloomberg) has a named
   open ceiling on chaining its own pieces.
   **Mechanism:** SpotGamma's fixed named vocabulary, permanently — plus ⛔ never a hit rate without
   its base rate (its own §N1 is the cautionary case, and UCT's lift ledger already does this
   correctly). ⚠️ First resolve the two-classifier problem (`ledger H6`), because a regime with two
   authorities cannot have one vocabulary.
3. **S8 Provenance & Freshness.** UCT's COT grounding gate **fails closed**, and Bloomberg's own
   dossier calls that "the stronger version".
   **Mechanism:** generalise `CoverageLine`, the COT gate and the "grounded on" chips into one
   component (the S8 build already specified), then add span anchors to the call recap so every
   generated bullet is a jump link — Bloomberg M9, "the single strongest transferable idea across
   two leaves". Both are consolidation, not new capability.
4. **A13 Journal & Track Record.** ⌀ unmatched among benchmarked products, with a published track
   record carrying its losses (`ledger N3`, `ledger F3`) that no competitor offers.
   **Mechanism:** the per-ticker history join, which is a D2 deliverable and is buildable entirely
   on data UCT already owns. ⚠️ Caveat restated: journal products were not benchmarked, so this is a
   lead in this universe, ◻ not a world ranking.
5. **A9's honesty layer.** `CoverageLine`'s four counts distinguish "no match" from "cannot
   compute"; ◻ Bloomberg's `EQS` is NOT DETERMINED on that distinction.
   **Mechanism:** keep it, make it a platform primitive (the ledger's own recommendation), and
   extend it to every result surface — then add Bloomberg's authoring-time counterpart (a live match
   count while criteria land) so a screen's strength is legible during composition and not only
   after a run.

### 6.2 The five largest gaps — with the mechanism that closes each, or the reason it cannot be closed

1. **S2 Command, Search & Navigation.** The best-evidenced row in this file, and UCT's palette
   shipped **ahead of the decision that was supposed to found it** (PROVISIONAL-SHIPPED,
   2026-09-03, noun-first by default, with OI-06 unanswered) on an estate carrying 87 raw `keydown`
   listeners and four independent ticker resolvers.
   **Mechanism:** the keyboard registry *before* more palette (frozen `code`-based declarations with
   a duplicate rail), then one resolver, then a published address space where saved things become
   names. ⛔ Closable by engineering alone — no vendor, no licence — and the two best witnesses
   (Bloomberg, Gödel) cost $118/month and $0 to read.
2. **S3 Entity Master.** Absent; "the clearest infrastructure gap the research found"; search is
   ticker-only.
   **Mechanism:** one permanent internal entity id, a dated ticker-alias list, and **OpenFIGI** as
   the free MIT-licensed external mapping — with Quartr's published discipline as the specification
   to copy (ticker as ambiguous user input; `companyId` on every response; disambiguate by
   exchange). ⛔ Cannot be bought: CUSIP's terms prohibit maintaining a master file, and no vendor
   publishes an entity master to license.
3. **A6 Transcripts & Filings.** The harshest row in the file: coverage **measured n=0** in the one
   observed monitor cycle, against Quartr's percentile SLAs and AlphaSense's operator language.
   **Mechanism, in order:** confirm RG-15 before any member-facing claim; make the S8 receipt say
   "coverage n=0" rather than render an empty panel; then EDGAR (already class-A, public domain,
   already consumed) plus span-anchored citation. ⛔ **Partly unclosable by building:** FMP
   transcript *storage* is U-class and AI-processing rights are "the sharpest AI row" in the
   licensing register — this gap is half rights, and a rights gap does not yield to engineering.
4. **X2 Data Egress & Programmatic Access.** No member API, no MCP server, no skill file; the one
   export credential that exists (ICS) has no TTL and converts a session paywall into a permanent
   bearer token.
   **Mechanism:** the cheapest high-leverage item in this document — publish a skill file **with an
   endpoint whitelist**, because the whitelist is the load-bearing half; then an MCP surface over
   the existing 154-tool registry with Fiscal.ai's entitlement-inheritance rule ("your assistant can
   only retrieve what you could retrieve yourself"). ⚠️ Gate it behind S9 first: `ledger P8` records
   ~1,150 routes with no HTTP limit, and "a terminal with programmatic clients needs per-route
   limits".
5. **A3/A4 Fundamentals & Estimates depth.** Six independent `_fmp_get` helpers, consensus only, no
   per-broker estimates, no point-in-time, no non-GAAP reconciliation — against Bloomberg's
   normalisation triple and Fiscal.ai's click-through auditability.
   **Mechanism for the half worth closing:** consolidate onto one D1 adapter (the named first ACL
   proof case) and adopt Fiscal.ai's figure-to-source-page link, which is architecture rather than a
   data purchase. ⛔ **And the reason not to close the other half:** per-broker estimates are class-G
   with no provider anywhere in the estate, and F-09 recommends DEFER/INTEGRATE(future) because
   "consensus already covers the median workflow". The honest answer is that this gap should stay
   open.

**Three gaps that cannot be closed at all, recorded so nobody plans against them.**
(a) ⛔ **Licensed futures quotes** (A1): yfinance is X-class with "no purchasable remedy", and the
strip should render an honest blank rather than an Unsuitable source.
(b) ⛔ **The Finviz single point of failure** (A9): "a Finviz no is a capability deletion, not a
swap" — and note that the desk-tool note contains **no licensing or robots posture at all**, which
is an open hole in that note rather than a clean finding; the provider register is the authority, and
it records U-class terms with `robots.txt` disallowing the exact scraped paths.
(c) ⛔ **Bloomberg's chat network** (X1): not clonable without the network, per the corpus's own most
experienced voice and anti-pattern N4.

---

## GAPS

1. **No F-05 contract file exists.** `00-program-control/contracts/` holds contracts for B-*, C-*,
   D-01…D-14, E-*, F-03a, F-03b, F-04, F-06, F-08, F-09 and G-LIGHT-D2 — counted by listing that
   directory on 2026-09-25 — and none for F-05. This document's shape follows the task dispatch plus
   the house style of the accepted dossiers, not a contract.
2. **Item 9 does not exist yet.** The Cross-Product Capability Matrix (`capability-matrix.md`) is
   NOT STARTED. A best-of-breed verdict properly sits on top of a per-product cross-tab; this file
   was written without one, so every row's *comparison set* is my reading of thirteen dossiers rather
   than a cross-tab anyone can check in one view. ⚠️ If item 9 lands and disagrees with a row here,
   item 9 wins on inventory and this file wins only on the verdict.
3. **The comparison class is incomplete in three named places, each of which would change a row.**
   (a) **Trade journals** (Tradervue, Edgewonk, TraderSync) are not in the universe — A13's ⌀ is
   therefore bounded. (b) **Visible Alpha** is named by a Bloomberg practitioner as where line-item
   consensus actually comes from and was never dossiered — A4's winner is unchallenged by the product
   a real user routes to. (c) **OptionStrat** is the named runner-up for the fourth desk-tool slot
   (OI-19) and would change A10's "per-position risk" half if the desk's missing workflow turns out
   to be structure selection rather than earnings/vol analytics.
4. **No product was observed running, by anyone, anywhere in the inputs.** Consequently: every
   latency, density, responsiveness and lived-UX comparison in this file is ◻ (§2.5), and eleven of
   the fifteen products have an explicit "one seat would settle this" line in their own §P. The
   cheapest three, named by the dossiers themselves: Gödel's 14-day no-card trial (free, OI-18), a
   Fiscal.ai Max month (~$99), a Finviz Elite month ($39.50). The most valuable single one remains a
   Bloomberg seat via a university library (OI-08).
5. **I did not re-fetch anything.** No network request was made in producing this file; no dossier
   claim was re-verified against its source URL. Where a dossier's own confidence is 🟡 or 🔴, this
   file inherits it — it cannot be better-evidenced than its inputs, and in three places (Market
   Chameleon's Premium-gated numbers, Benzinga's AI, Gödel's entire DEMONSTRATED tier) the input is
   explicitly unable to support a quality judgement.
6. **Nine of the fifteen products carry an unresolved internal contradiction in their own official
   material**, recorded across the inputs and not reconciled by me: SpotGamma's help centre states
   both $99/$299 and $9/$99; TradingView's own two indicator counts do not reconcile (400+ versus 209
   help articles) and an "Expert" tier appears in two docs and not on the pricing page; Gödel's
   `/pricing` and `/docs` disagree about API availability on the same day; LSEG publishes three
   documents that disagree about its AI model stack; Fiscal.ai publishes 22 versus 28 skills and three
   different universe counts; Benzinga values the same bundle at $199/yr and $228/yr; Bloomberg's own
   collateral carries three BI headcounts (R17); Quartr's coverage magnitude "contradicts itself, so
   no single number should be cited"; LSEG's fundamentals coverage is stated three ways on three
   pages. ⭐ Nine of fifteen is the finding: **a hand-typed count beside the artefact that owns it is
   the industry norm, not a UCT peculiarity.**
7. **The desk-weighting in §2.2 is 🔴 except for Finviz** — thinkorswim's and Market Chameleon's desk
   relevance rests on a stated default and an invented slot, and only the owner can settle either.
8. **Two capability families in the Part XIII taxonomy are handled thinly here** because UCT's scope
   excludes them: **execution/order routing** (⊘ by GOVERNING_PRINCIPLES §13 "No execution or order
   management" — TradingView's 28+ broker integrations, LSEG's embedded REDI EMS and thinkorswim's
   conditional orders are recorded nowhere in §3) and **fixed income / FX / commodities** (⊘ "no FX,
   fixed income, or crypto in V1"), where Bloomberg's and LSEG's genuine depth is simply not a contest
   UCT is in. ⚠️ Both are ⊘, not ✖ and not ◻ — if OI-05 widens the asset-class scope, both need a
   pass.
9. **Mobile is not a row and probably should be.** Bloomberg (Anywhere + the Professional app),
   TradingView, Unusual Whales, Quartr (a free app that is the whole funnel) and Benzinga all have
   mobile stories; ✖ SpotGamma "not one help-centre article addresses mobile"; UCT's is `ledger
   C8`/`N11` with four unmounted primitives and 209 stylesheets at ≤640 against 131 at ≤1024. I left
   it out because it cuts across every row rather than being one, which is a judgement that could
   reasonably be reversed.

---

## SOURCES

All inputs are internal, accepted programme artefacts read on **2026-09-25**; no network request was
made. Cited inline by dossier and section anchor.

**Competitive dossiers** (`docs/terminal-research/03-competitive-research/`, A–P scheme unless
noted) — `bloomberg/dossier.md` (sections A–Q + Reconciliations R1–R24, plus its nine leaves
`01-search-navigation` … `09-multi-asset-analytics`) · `godel/dossier.md` (Evidence-Class Spine +
Sections A–P + Reconciliation §1–2, plus leaves `01-evidence`, `02-verification`, `03-ideas`) ·
`tradingview/dossier.md` · `unusual-whales/dossier.md` · `koyfin/dossier.md` ·
`benzinga-pro/dossier.md` · `alphasense/dossier.md` · `factset/dossier.md` ·
`spotgamma/dossier.md` · `finchat/dossier.md` (**Fiscal.ai** — the directory name is the retired
brand) · `lseg-workspace/dossier.md` (sub-anchors C.1–C.5, I.1–I.4) · `quartr/dossier.md` ·
`adjacent-notes/dossier.md` (LIGHT merged note — TIKR, YCharts, S&P Capital IQ Pro; sections
A/D/L/M/N/P only, cited as §1.D/§2.L/§3.P).

**Desk-tool notes** (`03-competitive-research/desk-tools/`, OBSERVATION/EVIDENCE/INTERPRETATION
blocks per numbered section) — `thinkorswim.md` (§0–§7) · `finviz.md` · `market-chameleon.md`
(Obs 1–7) · `tradingview-desk-use.md` (§1–§10).

**Programme artefacts** — `03-competitive-research/benchmark-universe.md` (B-VAL-01, draft
2026-09-02; Part 0 corrections, Part 2 redundancy clusters, Part 4 evidence-accessibility scale and
budget implication, Part 5 recommended universe) · `05-product-strategy/capability-infrastructure-matrix.md`
(the row spine; WS-CAPINFRA) · `05-product-strategy/product-architecture.md` (§1.1–§1.4, §2.1, §4.2,
§6, and the S1/S2, S7, A8, I1 implementation records) · `01-existing-system/capability-ledger.md`
(F-03a, 178 rows, per-group split in its §R) · `00-program-control/GOVERNING_PRINCIPLES.md` §13 ·
`00-program-control/MASTER_CHECKLIST.md` items 9, 10, 15–17 ·
`00-program-control/OWNER_INPUTS_REQUESTED.md` (OI-18).

⚠️ **Two source-hygiene notes inherited and restated.** (1) Every dossier records that no page
attempted to instruct an agent, with two exceptions that were logged and not followed: Unusual Whales
serves an agent-detection shell (§O), and LSEG publishes an acceptable-use clause asking *its own
users* to avoid prompt injection (§I.4) — recorded there as a product decision worth copying. (2) The
affiliate/SEO cluster around Gödel (`godeldiscount.com`, `godelguide.com`) and the comparison-page
networks around LSEG, FactSet and Bloomberg pricing (`rfp.wiki`, Vendr, costbench) are excluded as
evidence throughout, per `benchmark-universe.md`'s own footer: they "may be used to *locate* a primary
source; **never to support a claim**."

---

## ⛔ What this document does NOT decide

1. **It does not decide what UCT builds.** Item 16 (Feature Opportunity Backlog) and item 17 (Feature
   Scoring Matrix) are the deliverables that turn a best-in-class mechanism into a candidate and a
   candidate into a ranked one. A row here naming a winner is an input to those, never an instruction.
   ⛔ "Benchmarks are sources of learning, not specifications."
2. **It does not decide priority, sequence or cost.** §6's ordering is by *distance from
   best-in-class*, which is not the same axis as value, urgency or effort. Nothing here is a roadmap,
   and §5's arithmetic is a comparison, not a budget.
3. **It does not change the capability taxonomy.** `capability-infrastructure-matrix.md` remains the
   single owner of the 33 rows. X1–X3 are proposals to that file; adopting them means adding rows
   *there*, and ⛔ maintaining them in both places would create exactly the
   second-authority-over-one-value defect the architecture's §3.1 test exists to prevent.
4. **It does not resolve any PROVISIONAL or owner-bound item.** D1 (workspace model), D2
   (command-grammar default), D5 and OI-03(a)/(b) (member-facing licensing posture), D8
   (portfolio-risk and event-calendar timing), D9 (decisiveness for two audiences), OI-05
   (asset-class scope), OI-06 (the observed desk morning), OI-08 (Bloomberg access), OI-12
   (commercial model), OI-15 (`#tsdr` member-safety), OI-17 (open-endpoint intent), OI-18 (the
   Gödel/Benzinga trials), OI-19 (structures versus single legs) and OQ-14 (canonical earnings-date
   authority) are all untouched. Several rows here *inform* them — §4.8 names what a Gödel trial
   would settle, §4.9 what one owner sentence would settle — and none decides them.
5. **It does not propose a price, a tier or a paywall for UCT.** §5 reads what other vendors charge
   and what their ladder *shapes* imply. UCT's tiering is owner-bound and currently inverted relative
   to the seed facts (DL-010: `FREE_PAGES = ['/morning-wire']` only), which is a decision for OI-12
   and not a finding of this file.
6. **It does not license any mechanism it admires.** Copying a named mechanism carries its own IP,
   trademark and terms question — SpotGamma's level names are trademarked or trademark-styled;
   Gödel's grammar is itself borrowed from Bloomberg; a `skill.md` whitelist is a pattern, not a file
   to fork. ⛔ Each adoption needs its own check, and this document performs none.
7. **It measures nothing.** No latency, no density, no keystroke count, no usage, no accuracy. Every
   performance and every quality verdict in this file is ◻ *not established* (§2.5), and ⛔ no row
   here may be cited as evidence that a product is fast, dense, accurate or pleasant.
8. **It does not rank any product overall, and refuses to.** A product is not its best row. Unusual
   Whales wins the alert language and ships a news feed a paying customer called unacceptable in the
   vendor's own public chat; Bloomberg wins five rows and publishes no price, no limit and no
   consensus recipe; Gödel wins three and ships zero AI, no technical screening, no order entry and
   no API. ⛔ Reading a column total out of §3 would be the single worst misuse of this file.
9. **It does not decide whether to buy any seat or open any trial.** §4 states what each would unlock
   and §6 what each would cost; the decision is the owner's, and the programme's standing rule that
   agents never sign up, accept terms or submit a form is unaffected.
10. **It does not supersede `product-architecture.md` §1.3.** That file already names five
    terminal-grade properties with a benchmark *witness* each (Bloomberg's loaded security, LSEG's
    per-cell citation, FactSet's source-linking invariant, Gödel's command index, Koyfin's
    dispatching rail). Where this document agrees, it is corroboration at mechanism depth; ⛔ where a
    reader thinks it disagrees, §1.3's witnesses were chosen against the architecture and this file's
    verdicts were chosen against the capability rows, and the architecture governs.
