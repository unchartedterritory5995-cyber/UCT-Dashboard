---
id: PRD-D5-REFERENCE-CORP-ACTIONS
title: D5 — Reference Data & Corporate Actions — Product Requirements Document
role: Phase 3 deliverable — PRD for the D5 system block (product-architecture.md §5-D, lines 628-638). Docs only; nothing in this document authorizes code.
phase: 3
group: product-strategy
category: prd
status: SPEC ONLY — NOT BUILT, NOT AUTHORIZED. The gate packet's approval block is EMPTY.
date: 2026-09-12
measured_against: origin/master @ ffa8102c7
scope: >
  Specification, not implementation, of D5 — a canonical corporate-actions table (splits,
  dividends, symbol changes, delistings, mergers) that the rest of the platform can join
  against, plus the reference data that goes with it, plus adjustment stored as a labelled
  policy. Composes on D2's address grammar and S3's typed identity-event contract; invents
  neither. Does NOT specify S3 (Entity Master, shipped 2026-09-02), D1 (Provider Abstraction,
  shipped), D2 (Canonical Data Model, CP1+CP2 shipped 2026-09-12) or S7 (Alerts, in build) —
  each is named only where D5 is its direct dependency.
confidence: >
  🟢 on every statement about what the application code does today — each was produced this
  pass by a script over prose-stripped source, and the file and line are named so the claim is
  quotable. 🟢 on every count in Appendix A, which came from `ast` over 2,872 Python modules,
  not from a comment and not from another document. 🟡 wherever this document composes two
  accepted artifacts into one requirement, or proposes a shape. 🔴 on nothing proposed without
  a measurement behind it.
evidence_ceiling: >
  ⛔ FIVE THINGS ARE NOT MEASURED AND EVERY ONE OF THEM IS NAMED WHERE IT BITES, NOT ONLY HERE.
  (1) **No production read of any kind.** No Railway variable was read, no pod was reached, no
  production database was queried. So `BARS_SPLIT_REPAIR_ENABLED`'s LIVE value is UNKNOWN to
  this pass — `data-architecture.md:566` and `product-architecture.md:638` both assert it is
  `0` on web, the code default is `1` (`bars_split_repair.py:76`), and this document resolves
  the disagreement in neither direction (§6.2.1).
  (2) **`entity_master.db`'s row counts are UNKNOWN** — whether the seed has ever run in
  production, and how many entities carry `lifecycle_state='delisted'`, is a pod query this
  session did not have (§7.4).
  (3) **`breadth_dividends.db`'s contents are UNKNOWN.** Its own module header states row and
  ticker counts; per this programme's standing rule those are NOT restated here (§6.1 row 4).
  (4) **The JavaScript half of the repo was NOT prose-stripped.** The `ast` stripper is
  Python-only, so every count in Appendix A is a count over `api/**`, `tools/**`, `scripts/**`
  and `tests/**`. A corporate-action concept living only in `app/src/**` would be invisible to
  this census, and the census says so rather than implying coverage it does not have.
  (5) **`measured_against` was NOT verified by git.** The task states this worktree is
  `origin/master @ ffa8102c7` plus today's work; no git command was run this pass to confirm
  it, and the SHA is recorded as given, not as measured.
sources: >
  Application source read this pass, prose-stripped and cited by line —
  `api/services/bars_sanitize.py`, `api/services/bars_split_repair.py`,
  `api/services/bars_sqlite.py`, `api/services/bar_provenance.py`,
  `api/services/breadth_dividends.py`, `api/services/screener/dividend_join.py`,
  `api/services/dividends_calendar.py`, `api/services/polygon_extras.py`,
  `api/services/massive.py`, `api/services/audit.py`, `api/services/delisted_registry.py`,
  `api/services/entity_master/{schema,store,api,reconciliation}.py`,
  `api/services/research/entity_resolution.py`, `api/services/canonical/address_book.py`,
  `api/data/canonical_address_book.json`, `api/services/alert_taxonomy/event_proximity.py`,
  `api/routers/{delisted,ticker_search,entity_master_admin}.py`, `api/main.py`,
  `scripts/entity_master_seed.py`, `tools/{flow_worker_watch_coverage,massive_guard_census}.py`,
  `api/data/delisted_tickers{,_bulk}.json`, `docs/feature_flags.json` ·
  program artifacts — `product-architecture.md` (D5 block, boundary matrix),
  `data-architecture.md` (§7, §5), `ARCHITECTURAL_DECISION_REGISTER.md` (DEC-08, DEC-14, DEC-15),
  `canonical-data-model-prd.md` (§6, §8), `canonical-data-model-spec.md` (§1, §3),
  `d2-canonical-data-model-pre-implementation-gate.md`, `entity-master-prd.md` (§9.5, §9.5.1),
  `entity-master-spec.md` (§4.3, §10.2)
provisional_markers: >
  DEC-08 (corporate-actions/portfolio-risk build timing — "defer confirmed"; this PRD designs
  the adjustment POLICY and the reference EVENT SHAPE that DEC-08 explicitly keeps, and does
  not design the M&A event calendar DEC-08 explicitly defers) · OI-03(a)/(b) (bears on §9's
  licensing column only — Massive corporate actions is the one row whose external-publication
  right is `LA`, and D5 stores the class rather than deciding the posture)
---

# D5 — Reference Data & Corporate Actions — PRD

## 0. How to read this document

**Three sentences first, because they change what the rest of it is.**

1. **Corporate actions are already handled in this codebase, in at least nine places, by five
   different providers, with no shared name for any of it.** D5's job is to give that one
   authority and one label — §6 is the census, measured this pass, and it is the longest
   section on purpose.
2. **S3 (Entity Master) already owns symbol changes and delistings, and it already declares
   the typed contract D5 must produce.** §7 says exactly what S3 owns so that nothing here can
   be read as proposing a second authority over it. ⛔ **A D5 that re-implemented entity
   aliasing would be a rewrite proposal, and this programme rejects those.**
3. **Nothing here is authorized.** The gate packet is unsigned and its approval block is empty.

⛔ **DO NOT READ THIS AS A REWRITE PROPOSAL.** §10's migration posture is additive-only. The
single most likely way to lose D5 is to start by moving one of the four working adjustment
mechanisms before there is anything to name the divergence with.

---

## 1. The required traceability chain

| artifact | what it fixes for D5 | status |
|---|---|---|
| `product-architecture.md:628-638` — the D5 system block | D5 exists; owns "splits, dividends, delistings, symbol changes as canonical events" + "**adjustment stored as a labelled policy** with a detected → confirmed → applied pipeline"; **must NOT own** the M&A event calendar | accepted |
| `product-architecture.md:766` — boundary matrix row **D5 Reference** | D5 calls **S3, D1, D2** and nothing else (`●` on exactly those three) | accepted, and §5.3 of this PRD is that row restated as a requirement |
| `data-architecture.md:497-582` §7 Corporate Actions | the three-state pipeline; the label at the point of display; the raw-and-adjusted parallel views; the §7.5 deferral of everything past splits/dividends | accepted |
| `ARCHITECTURAL_DECISION_REGISTER.md:119-126` DEC-08 | *"defer confirmed"* — adjustment-as-policy now, the M&A **event calendar** deferred | accepted; §11 keeps both halves |
| `ARCHITECTURAL_DECISION_REGISTER.md:242-250` DEC-15 | S3's interim reconciliation job, *"retire the day D5 ships"* | RECOMMENDED, REVERSIBLE, **still in force — and §8 replaces its expiry condition** |
| `entity-master-spec.md:289-306` §4.3 | the typed **D5 → S3 input contract**, already written, already implemented | SHIPPED — §7.2 |
| `entity-master-prd.md:684-694` §9.5.1 | the explicit authorization for the interim job, and its three conditions | accepted |
| `canonical-data-model-spec.md` §1.1 | the address grammar D5 must compose on, never a second one | CP1+CP2 SHIPPED 2026-09-12 |
| `d2-canonical-data-model-pre-implementation-gate.md:38-63` CP2 | `bars_sqlite` is in the book; `api/services/canonical/address_book.py` is its ONE product reader | SHIPPED |

⛔ **ONE INHERITED CLAIM CANNOT BE CONFIRMED BY THIS PASS AND IS FLAGGED RATHER THAN REPEATED.**
`data-architecture.md:566` and `product-architecture.md:638` both state `BARS_SPLIT_REPAIR_ENABLED`
is **off on web**. The code reads `os.environ.get("BARS_SPLIT_REPAIR_ENABLED", "1") != "0"`
(`bars_split_repair.py:76`) — default ON. No Railway read happened this pass. ⭐ **The two
statements are not in conflict about the code; they are a claim about a live variable, and a
claim about a live variable that nobody has read this week is exactly the shape
`feedback_check_railway_vars_first` exists for.** §6.2.1 states what turns on the answer.

---

## 2. Who this system is for

D5 has **no member-facing surface of its own** — like D2, and for the same reason: a system
with no screen is the one most likely to be argued into having one.

| audience | what they get |
|---|---|
| **S3 (Entity Master)** | the ongoing identity-event feed its own PRD §9.5 says it does not have. Today S3's only two producers are the interim reconciliation job and an admin hand lever (`entity-master-spec.md:305-306`) |
| **the bars lane** | ONE authority over "was there a split, and on what date, at what ratio" — replacing three independent readers of three different endpoints (§6.1) |
| **S8 (Provenance & Freshness)** | the adjustment-basis LABEL to render. Today `bar_provenance` records `source`, `validated_at`, `verified_at` and **nothing about adjustment** (`bar_provenance.py:16-24`) |
| **S7 (Alerts)** | `event-proximity` already declares `DIVIDEND = "dividend"` in `EVENT_KINDS` (`event_proximity.py:75-76`) and refuses to fire on it (`:185`). D5 is what makes that kind populatable without a schema change |
| **D2** | a store to classify, and five to seven new metric declarations whose store is a corporate-actions ledger rather than a screener row |
| **the desk** | the answer to *"why did the chart jump"* — `data-architecture.md:517` names that exact ticket |

⛔ **NOT FOR: a member.** D5 never renders. The label it produces is rendered by S8; the
sentence a member reads is S10's. If a D5 requirement starts describing pixels it has become
somebody else's.

---

## 3. The problem, stated as one measurement

> **Five providers answer the question "was there a corporate action", four mechanisms rescale
> a price because of one, and not one row anywhere in this repo records which basis it is on.**

Every clause of that sentence is a count in §6, produced by a script, with the method in
Appendix A.

### 3.1 Why each half is a cost, not an aesthetic

**The five answers can disagree and nothing would notice.** `bars_sanitize` asks FMP,
`breadth_dividends` and `polygon_extras` ask Massive, `dividends_calendar` asks yfinance. They
do not compare, they do not share a cache, and three of them are quarantined out of the Massive
guard census with the same reason string (§6.1). ⭐ **This is the `pct_above_50ma` finding one
layer down** — D2 §3.1 measured a metric with two names; D5 measures a FACT with five sources.

**The unlabelled basis is worse, because it is silent.** `data-architecture.md:512-518` already
names the consequence: *"any current UCT chart that 'looks' dividend-adjusted is either not
actually adjusted for dividends, or is silently relying on a fallback path whose own
dividend-adjustment behavior was never independently verified."* Measured this pass, that
sentence is if anything understated — there are **four** live rescaling mechanisms on **three**
different bases and **zero** columns anywhere that say which one produced a number (§6.2).

### 3.2 ⛔ What the problem is NOT

- **Not "the split heal is wrong".** `bars_split_repair` is a careful, well-argued module whose
  own docstring (`bars_split_repair.py:18-49`) makes the heal-on-write case on three measured
  grounds and keeps exactly one implementation of the split judgement. D5 does not replace it.
- **Not a missing feed.** Massive's `/v3/reference/{splits,dividends}` are already called from
  product code today (§6.1 rows 2, 3, 4). `data-architecture.md:568-570` says these endpoints
  *"could plausibly serve symbol-change events but have never been enumerated"* — **the first
  two have not merely been enumerated, they are wired.**
- **Not an M&A calendar.** DEC-08 defers that and §11 keeps it deferred.
- **Not S3's job.** §7.

---

## 4. Primary workflows

### UC-1 — A split lands and every lane agrees within one session

**Today:** the serve path detects an unadjusted boundary and rescales the RESPONSE
(`bars_sanitize.py:587-598`), then hands the ticker to `bars_split_repair` to rewrite the ROWS.
Measured this pass: **38 product modules under `api/` import `bars_sqlite` and never import
`bars_sanitize`** (Appendix A.4) — they read whatever the store currently holds. The serve-path
heal is scheduled, bounded and correct; the guarantee that every lane sees one basis is a
RACE, not an invariant.

**With D5:** the corporate action is a confirmed row before any price is touched, and the
repair reads it instead of inferring it from a price discontinuity.

⛔ **THE INFERENCE IS THE PART D5 REPLACES, NOT THE REPAIR.** `bars_sanitize.unadjusted_splits`
detects a boundary whose observed close ratio matches a declared factor within `_SPLIT_TOL`
(`bars_sanitize.py:153`). That is a measurement of PRICE standing in for a measurement of an
EVENT — and it has already fired wrongly at production scale (`bars_sanitize.py:568-585`
records EGBN and BF-A being served at 1.0993× and 3.3475× off byte-identical clean rows).

### UC-2 — A member asks which basis a number is on, and there is an answer

**Today** there is no field to read. `ohlcv` is `(ticker, tf, ts, o, h, l, c, v)`
(`bars_sqlite.py:138-144`); `bar_provenance` is `(ticker, tf, bar_time, source, validated_at,
verified_at)` (`bar_provenance.py:16-24`). **With D5** the served payload carries
`"split-adjusted, 2026-09-02"` or `"as reported"` — `data-architecture.md:550` names the exact
strings, and S8 renders them.

### UC-3 — A ticker changes symbol and one authority records it

**Today** S3 can record it: `apply_event("renamed", …)` exists, is validated, closes the old
alias and opens the new one (`entity_master/api.py:285-297`, `:334-338`). Measured: **zero
product callers**. The only producers S3 has are the interim job — which is structurally
forbidden from proposing a rename (`entity_master/reconciliation.py:24-42`) — and an admin
route. **With D5** the corporate-action signal that distinguishes a rename from an unrelated
delist-plus-list is supplied, and S3's existing event is emitted with `source='d5'`.

### UC-4 — A delisting is one fact, not two

**Today** `/api/ticker-search` merges TWO delisting authorities in one response:
`ticker_search_index` (S3-backed, `ticker_search.py:152`) and the static
`delisted_registry` (`ticker_search.py:187-196`). **With D5** the registry is a SEED, S3 is the
authority, and the merge is one lookup.

### UC-5 — A dividend has one ex-date across the product

**Today** the ex-date exists in three shapes: `breadth_dividends.db::dividends(ticker, ex_date,
cash)` written from Massive by ex-date sweep (`breadth_dividends.py:60`, `:121-122`);
`dividends_calendar`'s forward `{sym, type, date, amount}` from yfinance
(`dividends_calendar.py:82-87`); and `polygon_extras.get_upcoming_dividends`' nine-field row
from Massive (`polygon_extras.py:213-222`). **With D5** one row, addressed, and each consumer
projects what it needs.

### UC-6 — S7's `event-proximity` fires on a dividend without a schema change

`event_proximity.py:75-76` already declares `DIVIDEND = "dividend"` inside `EVENT_KINDS`, and
`:185` refuses to fire on it. ⭐ **That is the F-S7-2 discipline the D2 spec §1.2 item 3 names —
pin the wider shape, populate the narrow one — and D5 is the thing that populates it.** No
schema widening; one feed.

---

## 5. System boundary

### 5.1 Responsibility

D5 owns **the corporate-action EVENT and the adjustment POLICY LABEL**. It owns no price, no
bar, no identity row, no calendar surface and no render.

### 5.2 Inputs and outputs

| | |
|---|---|
| **inputs** | Massive `/v3/reference/{splits,dividends,tickers}` through D1; FMP `stable/splits` through D1; the static `delisted_tickers*.json` as a SEED, never a feed |
| **outputs** | confirmed corporate-action rows; **typed identity-change events to S3** in S3's own already-declared shapes (`entity-master-spec.md:289-306`); **adjustment-policy labels** on addressed series for S8 to render; D2 metric declarations for the ledger's own columns |

### 5.3 Dependencies — exactly three, and the matrix already says so

`product-architecture.md:766` gives D5 a `●` against **S3, D1 and D2** and a `✗` against every
other system. This PRD adds nothing to that row. ⛔ **A D5 that called a vendor directly would
be D1; a D5 that wrote a price would be the bars layer; a D5 that resolved a ticker would be
S3.**

### 5.4 Must NOT own

- **The M&A / spin-off / rights / buyback event calendar** — DEC-08 defers it,
  `product-architecture.md:636` names it, and §6.4 measures that the repo contains no structured
  handling of any of the four.
- **Entity identity.** §7.
- **The bars store.** `bars.db`'s newest-bar-wins invariant predates D5 and is untouched.
- **The breadth collector's dividend-adjusted history.** `product-architecture.md:636` calls it
  "its own project"; §6.2 measures why (the collector runs in a different repo).
- **Presentation** (S10) or **freshness mapping** (S8) or **sessions** (S11).

---

## 6. ⭐ THE CENSUS — WHAT EXISTS TODAY, MEASURED

> **Method, in one sentence:** every Python file was parsed with `ast`, every string-literal
> `Expr` statement blanked, the tree re-emitted with `ast.unparse` (which drops comments by
> construction), and tokens counted only from identifier-bearing nodes and string constants of
> the STRIPPED tree. Controls, both required to hold: `unadjusted_splits` still present in
> `bars_sanitize.py` after stripping (**true**), and `MNST` / `SpaceX` — which appear ONLY in
> that file's module docstring — absent after stripping (**true**, and `MNST` is present in the
> raw file, so the negative control is not vacuous). **2,881 Python files parsed, 0 unparsable.**
> Full method and totals: Appendix A.

### 6.1 THE FACT READERS — five providers answer one question

| # | module | provider · endpoint | fact | consumers (non-test, measured) | D5 verdict |
|---|---|---|---|---|---|
| 1 | `bars_sanitize._fetch_meta` (`:262`, `:265`) | **FMP** `/stable/profile` + `/stable/splits` | split list + IPO date | `bars_fetch`, `barspack`, `bars_split_repair`, `main` (4) | **JOIN** — D5 supplies the split list; the detector and the heal stay |
| 2 | `polygon_extras.get_splits` (`:231`, `:252`) | **Massive** `/v3/reference/splits` | recent + upcoming splits | `voice_tool_impls` (1) | **REPLACE the read** — D5 owns this endpoint; the voice tool reads D5 |
| 3 | `polygon_extras.get_upcoming_dividends` (`:184`, `:204`) | **Massive** `/v3/reference/dividends` | forward dividends | `voice_tool_impls` (1) | **REPLACE the read** — same |
| 4 | `breadth_dividends.refresh` (`:60`, `:121-122`) | **Massive** `/v3/reference/dividends` | paid dividends by ex-date, market-wide | `main`, `breadth_monitor` router, `breadth_live`, `screener/dividend_join` (4) | **JOIN** — one ledger, this store becomes a projection |
| 5 | `dividends_calendar._one` (`:171-189`) | **yfinance** `.calendar` / `.dividends` / `.splits` | forward dividend + forward splits | `routers/calendar` (1) | **REPLACE the read** — `data-architecture.md:1035` already calls moving this off yfinance "a named, cheap first move" |
| 6 | `massive.get_split_tickers` (`:1557`) | **Massive** `/v3/reference/splits` | the set of split tickers in a window | **ZERO** | ⚰️ **LEAVE ALONE / DELETE** — §6.5 |
| 7 | `massive.list_reference_tickers` (`:1526`) | **Massive** `/v3/reference/tickers` | the `active` flag = the delisting signal | `bars_api_main`, `barspack`, `bars_prewarm`, `breadth_pit_calibrate`, `entity_master/reconciliation`, `ticker_search_index` (6) | **LEAVE ALONE** — this is S3's input, not D5's (§7.3) |
| 8 | `delisted_registry` (`:27-32`) | **static JSON**, three files | delisting metadata | `bars` router, `delisted` router, `ticker_search` router, `engine`, `theme_index`, `theme_performance`, `entity_master_seed` (7) | **JOIN as a SEED** — §7.5 |

⛔ **THREE OF THE FIVE MASSIVE READERS ARE QUARANTINED, EACH WITH THE SAME REASON STRING.**
`tools/massive_guard_census.py:57-72` carries `api/services/polygon_extras.py`,
`api/services/breadth_dividends.py` and `api/services/audit.py`, each with *"not part of this
build's approved narrow slice"*, and `tests/test_massive_guard_census.py:31-49` pins the set
exactly. ⭐ **So the D1 census already knows these three are outstanding debt and already
refuses to let them be forgotten. D5's first checkpoint should be shaped by that instrument,
not beside it.**

### 6.2 THE ADJUSTMENT APPLIERS — four live mechanisms, three bases, zero labels

| # | mechanism | what it changes | basis it produces | where |
|---|---|---|---|---|
| **A** | Massive aggregates `?adjusted=true` | the fetched bars | **split-adjusted** (the vendor's own docs mention no dividend adjustment — `data-architecture.md:503-506`) | `bars_fetch.py` ×8, `massive.py` ×4, `audit.py`, `routers/live_prices.py`, `watchlist_prebuilt_refresh.py`, `oi_morning.py`, 2 tools |
| **B** | `bars_sanitize._apply_split_adjust` | the SERVED response only | split-adjusted-to-latest | `bars_sanitize.py:480`, entered from `:587-598` |
| **C** | `bars_split_repair.repair_ticker` → `bars_sqlite.put_bars` | the STORED ROWS | split-adjusted-to-latest | `bars_split_repair.py:177` |
| **D** | `breadth_dividends.adjust` | an in-memory breadth frame, nothing else | **split + dividend** | `breadth_dividends.py:257` |
| **E** | yfinance `auto_adjust` | whatever that call returns | `False` at every product call site measured (`index_bars.py:123`,`:165`; `bars_fetch.py:1649`; `earnings_enrichment.py:118`,`:203`,`:493`) — **but `auto_adjust=True` in the breadth collector, which lives in a DIFFERENT REPO** (`breadth_dividends.py:4-6` states this; it is why mechanism D exists) | — |

⛔⛔ **AND THERE IS NOWHERE TO WRITE THE ANSWER DOWN.** Measured, both DDLs read this pass:

```
ohlcv          (ticker, tf, ts, o, h, l, c, v)                       bars_sqlite.py:138-144
bar_provenance (ticker, tf, bar_time, source, validated_at, verified_at)  bar_provenance.py:16-24
```

**Neither carries an adjustment field.** ⭐ **That is the whole of D5's product argument in one
observation: four mechanisms can each move a price for a corporate-action reason, and the
system has no column, no key and no label that says which one did.**

#### 6.2.1 ⚠️ The one live-configuration question this pass could not settle

Mechanism **B** and mechanism **C** share one switch. `bars_sanitize.py:587` reads
`_bsr.enabled()` before rescaling, and `bars_split_repair.py:76` is
`os.environ.get("BARS_SPLIT_REPAIR_ENABLED", "1") != "0"`. The comment above that call site
(`bars_sanitize.py:568-585`) records that the switch previously gated only the STORE WRITE while
the identical detection kept rescaling every response — *"a kill switch that leaves the faulty
computation running and only declines to save its output is not a kill switch."*

⛔ **So the value of that variable in production decides whether the serve path is rescaling
member-visible prices right now, and this pass did not read it.** It is also invisible to
`docs/feature_flags.json`: measured, that ledger holds **127 flags** and **zero** whose name
contains `SPLIT`, `DIVID`, `SANITIZE`, `ENTITY`, `DELIST` or `RECONCIL` — correctly, because
its own `_readme` scopes it to *"every feature GATE that is OFF unless something turns it on"*
and this one defaults ON. ⭐ **A default-ON kill switch is outside the one instrument that
exists to tell "off" from "off on purpose", and D5's own flags must not repeat that.**

### 6.3 THE DELISTING AUTHORITIES — two, and one endpoint merges them

| authority | shape | seeded from | consumers |
|---|---|---|---|
| `delisted_registry` | three static JSON files merged in load order (`delisted_registry.py:96-104`); measured in-repo: `delisted_tickers.json` = **6** entries (all 6 carry a `reason`), `delisted_tickers_bulk.json` = **6,177** entries (**0** carry a `reason`); the third is a runtime `/data` overlay and is not in the repo | Massive `active=false` enumeration + hand curation | 7 non-test modules (§6.1 row 8) |
| **S3** `entities.lifecycle_state` | `'active' | 'delisted' | 'renamed_successor_exists'` (`entity_master/schema.py:46`) | `scripts/entity_master_seed.py:329-390`, which reads `delisted_registry.all_entries()` | 5 non-test modules |

⛔ **THEY ARE NOT INDEPENDENT AT SEED TIME AND THEY DIVERGE AFTERWARDS.** The seed script
composes each registry row into `new_entity` → `alias_retired` → `delisted`
(`entity_master_seed.py:325-390`), so S3 starts as a superset. But
`entity_master/reconciliation.py:33-39` states — and
`test_reconciliation_never_imports_delisted_registry` pins — that the interim job **never reads
the registry**, deliberately, to be structurally immune to its staleness. So from the first
reconciliation run onward the two answers can differ and nothing compares them.

⭐ **`/api/ticker-search` renders both in one list** (`ticker_search.py:152` for the S3-backed
index, `:187-196` for the registry rows, tagged `"type": "delisted"`). A member sees one
dropdown; behind it are two authorities.

### 6.4 MERGERS, SPIN-OFFS, RIGHTS ISSUES, BUYBACKS — a measured absence

A probe over prose-stripped product code for `merger`, `acquisition`, `takeover`, `spinoff`,
`spin_off`, `spin-off`, `rights issue`, `buyback` returned **20 files**, and **every single hit
is one of three things**: an LLM prompt string (`catalyst/curator.py`, `catalyst/hunter.py`,
`catalyst/synthesize.py`, `news_catalysts/service.py`), a news-classification keyword or regex
(`news/filters.py:` `\bacquir(?:e|es|ed|ing|ition)\b|\bmerger\b|\bto\s+buy\b|\btakeover\b`,
`news_aggregator.py`, `news/sentiment.py`, `sec_news.py`), or a label inside a financial-
statement or detector explanation (`financial_statements.py`, `insider.py`,
`pattern_engine/**`).

> ⛔ **There is no table, no event type, no feed and no consumer for a merger, spin-off, rights
> issue or buyback anywhere in this repository.** `spinoff` / `spin_off` / `spin-off` returned
> **0 occurrences in any file, product or test.**

**The control that makes this an absence claim rather than an unrun scan:** the identical probe
for `delist` over the identical population returned **28 product files with 139 occurrences**,
including real structured handling (`delisted_registry.py`, `entity_master/api.py:280-284`,
`routers/delisted.py`). ⭐ **The instrument can see a present corporate-action concept; it saw
none of these four.**

⚰️ **AND THE ONE PLACE A MERGER IS RECORDED IS A PROSE STRING ON SIX ROWS.**
`api/data/delisted_tickers.json` — 6 entries, all 6 with a `reason`, the first being
`"Acquired by Verizon; renamed Altaba"` for `YHOO`. That single string carries **an acquisition
AND a rename**, the successor (`AABA`) exists as a separate row in the bulk file, and S3's
`entity_relations` table — which declares exactly the right shape,
`CHECK (kind IN ('successor', 'predecessor', 'share_class'))`
(`entity_master/schema.py:95`) — has **zero product writers** (§7.3).

### 6.5 BUILT, TESTED, AND WIRED TO NOTHING — two corporate-action modules

Measured by AST over import statements, with controls (`bars_sqlite` → 106 importers;
`no_such_module_xyz` → 0):

| module | importers | note |
|---|---|---|
| `api/services/massive.py::get_split_tickers` (`:1557`) | **0, anywhere in the repo** — the only occurrence of the name is its own `def` | Its docstring describes exactly the job D5 needs: *"Lets a return computation tell a REAL split … from the provider's PHANTOM adjustment."* Nothing calls it |
| `api/services/screener/dividend_join.py` | **0 product importers**; the only importer in the repo is `tests/test_screener_dividend_join.py:102` | 12 corporate-action tokens; a full four-way refusal taxonomy; a measured argument about forward-blindness (`dividend_join.py:28-45`) |

⭐ **This is `lesson_built_tested_green_and_unreachable` twice, inside D5's own subject area, and
it is the strongest argument for CP1 being a CENSUS.** Both modules are good code. Neither is
reachable. Nothing in the repo reports that, and both were found by a script this pass rather
than by anyone noticing.

### 6.6 WHAT RUNS ON A SCHEDULE TODAY

| job id | where | what |
|---|---|---|
| `bars_split_repair_sweep` | `api/main.py:2197-2202`, hour/minute **derived** from `scan_evaluator.market_open_et` minus `_SPLIT_SWEEP_LEAD_BEFORE_OPEN`, daily incl. weekends | universe split back-adjustment |
| `breadth_dividends_refresh` | `api/main.py:5578` | the market-wide ex-date sweep |
| **(none)** | — | ⛔ **S3's interim reconciliation job has NO scheduler entry.** `entity_master` appears in `api/main.py` exactly twice — the admin-router import (`:100`) and its `include_router` (`:7950`) — and `reconciliation.py:44-52` says the omission is deliberate |

⛔⛔ **THAT LAST ROW CHANGES WHAT DEC-15 MEANS.** `entity-master-spec.md:651-655` describes the
job as *"registered in `api/main.py`'s existing APScheduler instance"*. It is not. The
implementation's own header states why and calls it an activation decision. **So DEC-15's
"retire the day D5 ships" is an expiry condition on an exception that has never run** — and §8
is written against that fact rather than against the document.

---

## 7. ⛔⛔ WHAT S3 ALREADY OWNS — D5 MUST NOT PROPOSE A SECOND AUTHORITY OVER ANY OF IT

> **This is the single most important section in the document. Everything below was read from
> source this pass. A D5 proposal that duplicates any row of it is a rewrite proposal and
> should be refused at the gate.**

### 7.1 S3 owns IDENTITY. Full stop.

| S3 owns | where | D5's relationship |
|---|---|---|
| the permanent internal entity id (`ent_<ULID>`) | `entity_master/schema.py:39` | **D5 never mints one.** Every D5 event names an existing `entity_id` or asks S3 to create one via `new_entity` |
| the dated alias list — `entity_aliases(entity_id, alias, valid_from, valid_to, source)` | `schema.py:52-63` | **D5 never writes this table.** It emits `alias_added` / `alias_retired` / `renamed` and S3 writes |
| `lifecycle_state ∈ active | delisted | renamed_successor_exists` and `lifecycle_since` | `schema.py:46-47` | **D5 never sets it.** It emits `delisted` and S3 sets it (`api.py:332-333`) |
| the vendor-symbol mapping per vendor per date | `schema.py:65-76` | **D5 never writes it.** `upsert_vendor_symbol` is S3's own provider-data helper (`api.py:351-360`) |
| FIGI | `schema.py:78-85` | untouched |
| entity relations — `successor` / `predecessor` / `share_class`, CHECK-constrained | `schema.py:87-98` | **D5 emits `relation_added`; S3 writes.** ⭐ This is where a merger's successor link belongs and it already exists |
| the write gate — `apply_event(event_type, payload, dedup_key, source)`, the **only** way those tables are ever written, idempotent on `dedup_key`, collision-rejecting with a named reason recorded on the event row | `api.py:186-231` | **This is D5's entire write surface into identity** |
| the six valid event types | `api.py:180-182`: `new_entity, alias_added, alias_retired, delisted, renamed, relation_added` | **D5 adds none.** Every corporate action D5 detects maps onto one of these six |

### 7.2 ⭐ S3 ALREADY DECLARED THE D5 CONTRACT, AND IT IS IMPLEMENTED

`entity-master-spec.md:289-306` is titled *"Event payload shapes (the **D5 → S3 input
contract**, PRD §4 UC-6)"* and lists six payloads. All six are implemented and validated in
`entity_master/api.py:233-310`. The spec's own closing line: *"Until D5 exists, the
reconciliation job (§10.2) and the admin manual-event route (§2.3) are the only two producers."*

⛔⛔ **AND S3 ALREADY RESERVED D5'S NAME.** `entity_master/schema.py:107` declares
`source TEXT NOT NULL, -- 'd5' | 'reconciliation' | 'admin_manual'`.

Measured this pass over prose-stripped code, whole repo: **the token `d5` appears in exactly one
place — inside that DDL string literal in `schema.py`.** No code path anywhere passes
`source='d5'`. ⭐ **D5's join point into S3 is already built, already typed, already
idempotent, and currently has zero writers. D5 supplies the writer and nothing else.**

### 7.3 What S3 CANNOT do, and why that is D5's whole job

`entity_master/reconciliation.py:24-42`, verbatim, and it is binding:

> *"It NEVER correlates a delisting with a new listing. The two proposal lists below are
> computed completely independently … A rename looks IDENTICAL to an unrelated delisting + an
> unrelated new listing from this feed alone, and distinguishing them requires a
> corporate-action signal this job does not have — that is explicitly D5's job."*

⭐ **That paragraph is the cleanest statement of D5's product boundary anywhere in the
programme, and it was written by the engineer who declined to guess.** D5's deliverable is the
SIGNAL. ⛔ **D5 does not get to infer the correlation either** — a rename it cannot source from
a corporate-action record is not a rename it may emit.

Measured consequences of that boundary, today:
- `renamed` — **zero product callers** (only `entity_master/test_entity_master.py`).
- `relation_added` / `related_to` — **zero product callers** (only tests).
- The interim job can emit exactly two of six event types: `new_entity` and `delisted`
  (`reconciliation.py:42`).

### 7.4 ⚠️ What is UNKNOWN about S3 and matters to D5

Whether `entity_master.db` has ever been seeded in production, and how many rows it holds, was
**not measured** — it needs a pod query this session did not have. `entity_master_admin.py`
exposes `GET /status` with row counts and `last_seed_at` / `last_reconcile_at` **derived from
the event trail** (`:179`), and the router IS mounted (`api/main.py:7950`). ⭐ **One admin GET
answers it, and D5's sizing should not be signed off without it** — the gate packet says so
where it bites (§8 of the packet), not only here.

⚠️ Also relevant: `scripts/entity_master_seed.py` is a SCRIPT, outside the `api` package, which
`entity_master_admin.py:30-38` names as the reason the admin surface exposes `/reconcile` and
not `/reseed`.

### 7.5 The verdict on the delisted registry — SEED, not authority

D5 must **not** propose deleting `delisted_registry`. It holds facts S3 cannot re-derive: 6
curated `reason` strings, and 6,177 rows carrying `provider_symbol`, `first_date`, `last_date`
and `bare_live` — the reused-ticker disambiguation (`delisted_registry.py:52-59`) that keeps
Bear Stearns' `BSC` separate from today's live `BSC` ETN. ⭐ **That is a corporate-action fact
(a ticker was reused after a delisting) recorded in the only place that has ever recorded it.**
D5's job is to make S3 the authority a caller reads, with the registry as one of its inputs —
not to delete the input.

---

## 8. ⛔ DEC-15'S EXPIRY, AS A CHECKABLE CLAUSE

DEC-15 today (`ARCHITECTURAL_DECISION_REGISTER.md:250`): *"What would change it: nothing — it
self-expires the day D5 ships."*

⛔⛔ **"THE DAY D5 SHIPS" IS THE SAME DEFECT DEC-14 WAS CORRECTED FOR ON 2026-09-12, AND IT IS
WORSE HERE FOR TWO MEASURED REASONS.**

1. **D5 is not a thing that ships on a day.** It is a producer that gains event types. Under
   the current wording the interim job is retired while `renamed` still has no producer, or it
   is never retired because "D5 shipped" is arguable forever. ⭐ Both failure modes are one
   defect: a condition nobody can evaluate.
2. **⚰️ AND "RETIRE THE JOB" ALREADY DESCRIBES SOMETHING THAT IS NOT HAPPENING.** Measured §6.6:
   the interim job has **no scheduler entry at all**. An expiry condition phrased as "retire the
   running thing" cannot be evaluated against a thing that does not run — it reads satisfied and
   unsatisfied at the same time.

### 8.1 The replacement, verbatim and proposed as binding

> **DEC-15 expires for an EVENT TYPE, not for the programme, on the day all three hold for it:**
>
> 1. **a D5 producer supplies that event type** — at least one `entity_events` row exists for
>    it with `source='d5'`, written through `entity_master.api.apply_event`, and the census
>    reports no other producer for that type; and
> 2. **for the two types the interim job can also emit** (`new_entity`, `delisted`), **the D5
>    event and the interim proposal are compared on the SAME RUN**, forward-only against the
>    live reference feed for a stated window, never by replay — **four outcomes (agree ·
>    D5-only · interim-only · both-absent), never a pass rate**; and
> 3. **the interim job can no longer emit that type** — the census, reading
>    `entity_master/reconciliation.py`'s own AST rather than a hand list, reports zero code
>    paths in it able to construct that `event_type`.
>
> **The programme-level exception expires when the census reports zero event types for which
> clause 1 is false, EXCLUDING any type recorded in the census's quarantine block as
> deliberately outside D5 with a written reason.** Not when a document says D5 shipped.

**The census rail, cited by test name so this condition has an instrument rather than an
intention:**
`tests/test_corp_actions_census.py::test_every_entity_event_producer_is_registered_with_a_source`,
over `tools/corp_actions_census.py`. Both are CP1 (gate packet §4); **neither exists today, and
that is why CP1 is CP1.**

### 8.2 ⭐ The condition is EVALUABLE TODAY, and here is its current value

Measured 2026-09-12 over prose-stripped source:

| event type | clause 1 (a `source='d5'` producer) | clause 3 (interim job can emit it) | status |
|---|---|---|---|
| `new_entity` | ✗ — zero writers pass `source='d5'` | **YES** (`reconciliation.py:211`) | outstanding |
| `delisted` | ✗ | **YES** (`reconciliation.py:224`) | outstanding |
| `alias_added` | ✗ | no | outstanding, no interim producer |
| `alias_retired` | ✗ | no | outstanding, no interim producer |
| `renamed` | ✗ — and zero product callers of any kind | no, **and structurally forbidden** (`reconciliation.py:24-32`) | outstanding — **this is the one D5 exists for** |
| `relation_added` | ✗ — zero product callers of any kind | no | outstanding |

**0 of 6 satisfy clause 1. 2 of 6 have an interim producer to retire.** ⭐ **A condition whose
value cannot be computed on the day it is written is the DEC-14 defect committed again; this one
computes, and its answer is a table.**

### 8.3 ⛔ Clause 2 is not a replay, and the reason is D5's own

The S7 programme has refused replay three times (a trendline has no past; a calendar date moves;
an LLM-graded row cannot be re-synthesised) and DEC-14 clause 2 refused it a fourth time. D5
adds a fifth and it is the sharpest: **a corporate-action feed is a statement about the present
state of a reference universe.** Massive's `active` flag has no "as of last Tuesday". Asking
whether D5 and the interim job agreed about a past instant is not a question the feed can
answer — so they are run on the same tick or the comparison is not made.

---

## 9. What D5 REPLACES, JOINS, or LEAVES ALONE — the verdict table

| existing thing | authority today | D5 verdict | why |
|---|---|---|---|
| `bars_sanitize.unadjusted_splits` / `split_factor` / `scale_bar` | the ONLY split judgement in the repo, deliberately (`bars_split_repair.py:40-44`) | **JOIN** | D5 supplies the declared split list this reads; the detector, tolerance and heal stay exactly where they are |
| `bars_sanitize._fetch_meta`'s FMP call | the split list | **REPLACE the READ, keep the shape** | one `(date, ratio)` list arrives from D5's ledger instead of a per-ticker FMP fetch. `MetaUnavailable` (`:229`) survives verbatim — *"the provider did not ANSWER"* stays distinct from *"no splits"* |
| `bars_split_repair` | the store rewrite | **LEAVE ALONE** | its heal-on-write argument (`:18-49`) is measured, correct and unaffected by where the split list came from |
| `bars_sanitize._apply_listing_cutoff` (ticker reuse) | serve-time reuse cutoff | **JOIN** | the `bare_live` / `first_date` / `last_date` facts in `delisted_registry` and S3's dated aliases are the same fact; D5 reconciles them into one, the cutoff keeps applying |
| `breadth_dividends` | the ex-date payment ledger | **JOIN** | it becomes a projection of D5's dividend rows. ⚠️ Its own forward-blindness (`dividend_join.py:28-45`) is a CORRECT property of a back-adjustment store and must survive the join |
| `screener/dividend_join` | nothing — 0 importers | **LEAVE ALONE, and REPORT** | it is unreachable today; wiring it is a screener decision, not D5's |
| `dividends_calendar` (yfinance) | the calendar's forward dividends + splits | **REPLACE the READ** | `data-architecture.md:1035` already names it. ⚠️ Its `set_by_completeness` partial-TTL discipline (`:225-230`) must survive |
| `polygon_extras.get_splits` / `get_upcoming_dividends` | the voice tools' corporate actions | **REPLACE the READ** | same endpoints D5 owns; the voice tool becomes a D5 consumer and leaves the Massive quarantine |
| `massive.get_split_tickers` | nothing — 0 callers | ⚰️ **DELETE, or adopt as D5's own** | a corporate-action reader nobody calls is the shape D5 exists to prevent |
| `massive.list_reference_tickers` | S3's reconciliation input, and 5 other consumers | **LEAVE ALONE** | this is identity, not a corporate action (§7.3) |
| `delisted_registry` | the static delisting registry | **JOIN as a SEED** | §7.5 |
| **S3 — entities, aliases, lifecycle, relations, `apply_event`** | identity | ⛔ **LEAVE ALONE ENTIRELY. D5 is a PRODUCER into it and owns none of it** | §7 |
| S3's interim reconciliation job | `new_entity` + `delisted` proposals | **REPLACE, per event type, under §8.1** | never "switched off"; retired one clause at a time |
| `audit.py`'s `?adjusted=true` canonical fetch (`:295`) | the reconciliation oracle | **LEAVE ALONE, and LABEL** | it compares our store against Massive's split-adjusted series; once D5 labels the basis, the comparison can say which bases it is comparing |
| `bar_provenance` | per-bar source attribution | **JOIN** | the adjustment label is a per-series fact, not per-bar; D5 must not widen this table without measuring (§12 item 5) |

---

## 10. Migration posture — additive, never a rewrite of a working reader

> **D5 is built by ADDING a ledger and a label beside code that already works, never by
> changing what a live reader reads. Every phase must be revertible by deleting rows or files.**

### 10.1 Why additive is not just caution, measured

Three of the four adjustment mechanisms are **correct for their own caller** and would be
damaged by unification-first:

- **B (serve-time)** exists because a chart must be right on the first paint even when the
  store is not.
- **C (store rewrite)** exists because 38 modules read the store and never the serve path
  (Appendix A.4), and nine `bars_sqlite` aggregate readers never materialise a bar list at all
  (`bars_split_repair.py:29-33`).
- **D (breadth dividends)** exists because the collector — **in a different repository** — reads
  `auto_adjust=True` while `bars.db` is split-only (`breadth_dividends.py:4-6`). Unifying that
  one is a two-repo change and is explicitly outside D5 (`product-architecture.md:636`).

⭐ **The divergence is not carelessness; it is four correct local answers to a question nobody
asked globally. D5 asks it, names it, and only then moves anything.**

### 10.2 The first three consumers, named, in order

| # | consumer | why it is first | size |
|---|---|---|---|
| **1** | **the census itself** — every corporate-action read, registered, with a quarantine block for the deliberately-outside | Nothing can be sequenced until the population is enumerated by a script rather than by this document. It is also the instrument §8.1 cites by test name, and it is inert | **S** |
| **2** | **the split list** — one D5 read replacing `_fetch_meta`'s FMP call, DARK, dual-computed, serving the legacy value | The smallest live fact with exactly one detector already reading it, and the D2 CP2 dual-read pattern (`d2-…-gate.md:45-53`) applies unchanged | **M** — ⚠️ constrained by flow-worker, §10.4 |
| **3** | **`source='d5'` on `delisted` + `new_entity`** — DEC-15 clauses 1 and 2 for two event types | S3's write gate, dedup key and collision guard already exist; this is a producer, not a schema | **M** |

⛔ **WHY NOT THE ADJUSTMENT LABEL FIRST, WHEN IT IS THE MOST QUOTABLE FINDING?** Because it is
the only item in the census that is **member-visible** — `data-architecture.md:550` puts the
string on the chart — so it is a product decision about what a member is told, not a
data-modelling one. ⭐ **D5 makes the missing label nameable; the decision to render it is S8's
and the owner's.** Putting it first would make D5's first change a behaviour change, which is
the opposite of §10's posture.

### 10.3 What must be revertible, and how

| phase | revert |
|---|---|
| the census added | delete two files; no product module was edited |
| a ledger row written | delete the row; no reader changed, because the dual-read serves the legacy value |
| a reader migrated | the pre-D5 read is still present until its own migration commit; revert is one commit |
| a `source='d5'` event applied | the event row stays (it is an audit trail) and the interim producer is re-enabled; S3's `dedup_key` idempotency means a replay writes nothing twice |

### 10.4 ⚠️ FLOW-WORKER — which of these can strand, measured

`tools/flow_worker_watch_coverage.py`, run this pass with an explicit root: **154 reachable
paths, 24 watched, 133 reachable-but-unwatched.** All 154 reachable paths are under `api/`, so
`tools/**` and `tests/**` are outside flow-worker's closure **by construction**.

| module | flow-worker RUNS it | flow-worker WATCHES it | classification |
|---|---|---|---|
| `api/services/bars_sanitize.py` | **YES** | no | ⛔ **INERT STRAND** |
| `api/services/bars_split_repair.py` | **YES** | no | ⛔ **INERT STRAND** |
| `api/services/bars_sqlite.py` | **YES** | no | ⛔ **INERT STRAND** |
| `api/services/bars_fetch.py` | **YES** | no | ⛔ **INERT STRAND** |
| `api/services/massive.py` | **YES** | no | ⛔ **INERT STRAND** |
| `api/services/delisted_registry.py` | **YES** | no | ⛔ **INERT STRAND** |
| `api/services/entity_master/{api,store,schema}.py` | **YES** | no | ⛔ **INERT STRAND** |
| `api/services/research/entity_resolution.py` | **YES** | no | ⛔ **INERT STRAND** |
| `api/services/earnings_estimates.py` (`_fmp_get`) | **YES** | no | ⛔ **INERT STRAND** |
| `api/services/bar_validation.py` | **YES** | no | ⛔ **INERT STRAND** |
| `api/services/bars_reconciliation.py` · `audit.py` · `dividends_calendar.py` · `breadth_dividends.py` · `screener/dividend_join.py` · `polygon_extras.py` · `entity_master/reconciliation.py` · `routers/delisted.py` · `routers/entity_master_admin.py` · `canonical/address_book.py` | no | no | outside the closure — safe |

⛔⛔ **WHICH CHECKPOINT EACH STRAND CONSTRAINS, since a classification nobody acts on is a
classification nobody reads:**

- **CP2 (the split list) touches `bars_sanitize.py` and therefore lands on an INERT STRAND.**
  flow-worker would keep running the OLD `_fetch_meta` while web ran the new one. That is not
  automatically fatal — flow-worker's use of the closure may never reach a chart bar — but it is
  a divergence between two running copies of one split judgement, which is the exact
  second-authority shape D5 exists to end. **CP2 must state, before it merges, whether
  flow-worker's reachability of `bars_sanitize` is live or incidental, and if live it needs a
  marker bump and an after-hours window** per `docs/runbooks/deploy-windows.md`.
- **CP3 (`source='d5'` events) touches nothing in `api/**` if the producer lives in a new
  module that flow-worker does not import — but it CALLS `entity_master/api.py`, which
  flow-worker RUNS.** Adding a producer does not change that module, so CP3 is safe as long as
  it adds no import to it.
- **CP1 touches only `tools/**` and `tests/**` and therefore strands nothing, by construction
  and not by luck** — measured above: zero non-`api/` paths in the reachable set.

---

## 11. Non-goals

1. **The M&A / spin-off / rights / buyback event calendar.** DEC-08 defers it;
   `product-architecture.md:636` names it; §6.4 measures that nothing structured exists for any
   of the four. ⭐ D5's event shape is deliberately the shape that calendar would consume, so
   the deferral stays reversible.
2. **Renaming any column, in any store.** Inherited from D2 §3.3 unchanged.
3. **Any change to `bars.db`'s newest-bar-wins invariant.**
4. **The breadth collector's dividend-adjusted history** — a two-repo change
   (`product-architecture.md:636`).
5. **Deleting `delisted_registry`** (§7.5).
6. **A point-in-time restatement model.** `data-architecture.md` §26's ceiling stands.
7. **Deciding what a member may see of a vendor's corporate-action data.** OI-03(a)/(b); D5
   stores the licensing class, S9 gates.
8. **Any member-visible change at any checkpoint** unless a specific approval line names one.

---

## 12. Acceptance criteria

D5's first increment is accepted when all of the following are **measured**, not asserted:

1. **The census is DERIVED, not typed.** A script enumerates every corporate-action provider
   read and every adjustment application from source, with comments and docstrings stripped and
   a control proving the stripper still sees real code. A rail fails **by name** when a new one
   ships unregistered.
2. **The census distinguishes three states, not two:** *outstanding* · *migrated* ·
   *deliberately outside, with a written reason*. ⛔ Without the third, DEC-15's condition can
   never reach zero — the same correction DEC-14 needed for `fmp_news.py`
   (`ARCHITECTURAL_DECISION_REGISTER.md:227-232`).
3. **DEC-15's §8.1 condition is implemented as a query** whose current value is printable, and
   §8.2's table is reproducible by running it.
4. **A NON-VACUITY CONTROL on every scan**, naming a specific expected member rather than a
   count — *"an empty result is a failed invocation until proven otherwise."*
5. **The adjustment basis is RECORDED WHERE IT IS DECIDED, or recorded as `null`, never
   defaulted.** ⭐ This is D2 CP2.4's rule inherited exactly: *"we could not compute it"* and
   *"as reported"* are different facts, and a ledger that cannot say the first one is not worth
   reading. A default of `"split-adjusted"` would make four mechanisms look like one.
6. **The first migrated reader is DARK and serves the legacy value**, with a forward-only
   comparison and four outcomes, never a rate.
7. **No `source='d5'` event is written until clause 2 of §8.1 has a comparison window behind
   it.**

⛔ **NOT acceptance criteria** (each is a reason to delay that must not be allowed to): a
complete ledger; every provider migrated; the M&A calendar; the breadth-basis reconciliation;
any member-visible change at all.

---

# APPENDIX A — THE CENSUS, METHOD AND TOTALS

> Produced this pass by `ast` over the repository at the worktree of `feat/s7-price-level`.
> ⛔ Not typed, and not copied from any comment or document.

## A.1 The stripper, and its two controls

Each file is parsed with `ast.parse`; every `ast.Expr` whose value is a string `Constant` — the
module, class and function docstrings, plus any bare string statement — is replaced with an
empty string; the tree is re-emitted with `ast.unparse`, which drops comments by construction.
Tokens are then counted **only** from `Name.id`, `Attribute.attr`, `arg.arg`, function/class
names, keyword-argument names, `alias` names and string `Constant`s of the STRIPPED tree.

| control | expectation | result |
|---|---|---|
| **positive** — a real code symbol survives | `unadjusted_splits` present in stripped `bars_sanitize.py` | **PASS** |
| **negative** — prose is actually removed | `MNST` absent from stripped `bars_sanitize.py` (it appears only in the module docstring, `:17`) | **PASS** |
| **negative, non-vacuity** — the file really did contain it | `MNST` present in the RAW file | **PASS** |
| **negative** — a second prose-only token | `SpaceX` absent from stripped `bars_sanitize.py` | **PASS** |

**Population: 2,881 Python files parsed, 0 unparsable.** For the product/test split below the
population is `api/**`, `tools/**`, `scripts/**`, `tests/**` and `conftest.py` = **2,872 files**;
a file is TEST if its basename starts `test_`, ends `_test.py`, or it sits under a `tests/`
directory.

⚠️ **`app/src/**` (JavaScript) is NOT in this census.** The stripper is Python-only. Every count
below is a count over Python.

## A.2 Token totals, PRODUCT code only (prose stripped)

`split` excludes the bare string methods `split` / `rsplit` / `splitlines` / `splitext` /
`splitdrive` when they appear as an identifier; a compound like `split_factor`,
`unadjusted_splits` or `REPAIR_TFS`-adjacent `splits` is kept.

| token | occurrences | files |
|---|---|---|
| `adjust*` | 335 | 87 |
| `split*` | 301 | 68 |
| `dividend* / divid*` | 224 | 60 |
| `delist*` | 139 | 28 |
| `ex_date / ex-dividend / exdate` | 19 | 4 |
| `symbol_change / ticker_change / renamed` | 15 | 8 |
| `corporate_action / corp_action / corporate action` | 9 | 6 |
| `successor / predecessor` | 8 | 4 |
| **`spinoff / spin_off / spin-off`** | **0** | **0** |

⚠️ **A COUNT IS NOT A SEVERITY.** `adjust*` is the largest row and the least interesting — 41 of
its occurrences are in `api/gex_service.py` (options-greeks "adjusted", nothing to do with
corporate actions) and ~60 more are `risk-adjusted` / `adjusted-close` naming inside pattern
detectors. `corporate_action` is the smallest row at 9 and is the one that matters: **the
concept D5 is named after has almost no vocabulary in this codebase at all.**

## A.3 The strict merger probe, and its control

Probe tokens `merger`, `acquisition`, `takeover`, `spinoff`, `spin_off`, `spin-off`,
`rights issue`, `buyback` over prose-stripped PRODUCT code: **20 files, every hit an LLM prompt
string, a news-classification keyword/regex, or a detector explanation label** (enumerated in
§6.4). **Control:** the identical probe for `delist` over the identical population returned **28
files** including real structured handling. The instrument can see a present concept.

## A.4 The two lanes

Measured by AST over import statements, `api/**` product modules only (tests excluded):

| | count |
|---|---|
| modules importing `bars_sqlite` | **42** |
| modules importing `bars_sanitize` | **4** — `api/main.py`, `bars_fetch.py`, `bars_split_repair.py`, `barspack.py` |
| **read the STORE and never the SERVE-TIME normalizer** | **38** |

Named in the 38 and load-bearing: `screener/scan_evaluator.py`, `screener/snapshot_builder.py`,
`indicator_alert_evaluator.py`, `breadth_live.py`, `ticker_returns.py`, `audit.py`,
`bars_reconciliation.py`, `worker_main.py`.

## A.5 Importer counts, with controls

| module | importers (all) | non-test |
|---|---|---|
| `bars_sqlite` *(positive control)* | 106 | 60 |
| `entity_master` | 25 | 5 |
| `entity_resolution` | 16 | 16 |
| `delisted_registry` | 12 | 7 |
| `bars_sanitize` | 11 | 5 |
| `breadth_dividends` | 5 | 4 |
| `bars_split_repair` | 3 | 2 |
| `dividends_calendar` | 3 | 1 |
| `polygon_extras` | 1 | 1 |
| **`screener/dividend_join`** | **1 (its own test)** | **0** |
| **`massive.get_split_tickers`** *(symbol, not module)* | **0 occurrences beyond its `def`** | **0** |
| `no_such_module_xyz` *(negative control)* | 0 | 0 |

## A.6 The D2 address book, as it stands after CP2

Read from `api/data/canonical_address_book.json` this pass, not restated from the gate packet:

```
metric_count 142  ·  stores {screener_rows: 137, bars_sqlite: 5}
cadences     {nightly: 137, (undeclared): 5}
grains       {date: 137, (undeclared): 5}
as_of_columns{snapshot_date: 79, bars_asof: 58, ts: 5}
yields       {num: 120, bool: 22}
```

**Corporate-action metrics currently addressable: exactly one — `dividend_yield`**, store
`screener_rows`, `cadence: nightly`, `sentence: "the dividend yield"`. ⭐ **There is no address
for a split ratio, an ex-date, a cash amount, an execution date, a delisting date or an
adjustment basis. D5 is the store that gives those five to seven names their first one.**

---

# APPENDIX B — REUSE-CLAIM TABLE, VERIFIED AGAINST THE WORKTREE BY PATH

> Every claim this PRD inherits from an earlier program artifact, re-checked this pass.
> **VERIFIED** = true as stated · **CHANGED** = the fact moved · **UNVERIFIABLE** = needs an
> access this session did not have.

| # | claim | source | checked against | verdict |
|---|---|---|---|---|
| 1 | D5 owns splits, dividends, delistings, symbol changes as canonical events + adjustment as a labelled policy | `product-architecture.md:630` | — (the charter) | **VERIFIED** as the charter |
| 2 | D5 calls S3, D1, D2 and nothing else | `product-architecture.md:766` | boundary matrix row read this pass | **VERIFIED** |
| 3 | *"no provider anywhere in the current stack"* for an M&A/spin-off/rights/buyback/ticker-change calendar | `data-architecture.md:560-562` | prose-stripped probe over 2,872 files, with a `delist` control | **VERIFIED**, and now measured rather than asserted (§6.4) |
| 4 | Massive's `/v3/reference/tickers` and adjacent reference endpoints *"have never been enumerated"* for symbol-change events | `data-architecture.md:568-570` | `polygon_extras.py:204`,`:252`; `breadth_dividends.py:60`; `massive.py:1526`,`:1569` | ⛔ **CHANGED** — `/v3/reference/{splits,dividends,tickers}` are all three **already called from product code**. What has never been enumerated is `/v3/reference/tickers` *as a symbol-change signal*; the endpoints themselves are wired |
| 5 | `BARS_SPLIT_REPAIR_ENABLED` is `0` on web | `data-architecture.md:566`, `product-architecture.md:638` | `bars_split_repair.py:76` reads default `"1"`; **no Railway read this pass** | ⚠️ **UNVERIFIABLE this pass** — §6.2.1 |
| 6 | `bars_split_repair` is *"a one-shot heal module reacting to a detected anomaly"* | `data-architecture.md:527` | `api/main.py:2175-2204` registers a DAILY universe sweep; `bars_sanitize.py:526-556` hands off per-serve | ⛔ **CHANGED** — it is a scheduled universe sweep plus a serve-path hand-off, not one-shot |
| 7 | the delisted-tickers file is *"a static JSON, not a feed"* | `data-architecture.md:562` | `delisted_registry.py:27-32` — three files, one a runtime `/data` overlay written by `add_entry(persist=True)` (`:190-216`) | **VERIFIED**, with a nuance: the overlay is runtime-writable, so it is a static seed **plus a hand lever** |
| 8 | S3's spec registers the reconciliation job in `api/main.py`'s APScheduler | `entity-master-spec.md:651-653` | `api/main.py` — `entity_master` appears only at `:100` and `:7950`; `reconciliation.py:44-52` says the omission is deliberate | ⛔ **CHANGED — the job is BUILT AND NOT SCHEDULED**, and §8 is written against that |
| 9 | the interim job never detects renames | `entity-master-spec.md:662`, DEC-15 | `reconciliation.py:24-42` + `:42` (*"exactly two event types it can ever emit"*) | **VERIFIED**, and structurally enforced |
| 10 | *"Until D5 exists, the reconciliation job and the admin manual-event route are the only two producers"* | `entity-master-spec.md:305-306` | prose-stripped scan: `source='d5'` appears only inside `schema.py`'s DDL string | **VERIFIED** |
| 11 | D2's book covers `screener_rows` (137) and `bars_sqlite` (5) | `d2-…-gate.md:29`, `:126-131` | `api/data/canonical_address_book.json` `axis_report` read this pass | **VERIFIED** — 142 total; and exactly one of them (`dividend_yield`) is corporate-action-adjacent |
| 12 | `api/services/canonical/address_book.py` is D2's one product reader | `d2-…-gate.md:127` | `address_book.py:1-13` states it in-file and names the rail | **VERIFIED** |
| 13 | S7's `event-proximity` pins `dividend` unpopulated | `alerts-monitoring` family | `event_proximity.py:75-76`, `:185` | **VERIFIED** |
| 14 | `entity_master.db` is seeded in production | not claimed by any artifact | — | ⚠️ **UNVERIFIABLE this pass** (§7.4) |
| 15 | `breadth_dividends.db` holds 434,767 rows across 45,869 tickers | `dividend_join.py:22-24` (an in-code comment) | ⛔ deliberately **NOT restated as a fact** — measure it, do not quote it | **not checked, by rule** |
