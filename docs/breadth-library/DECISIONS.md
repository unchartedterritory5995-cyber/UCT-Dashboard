# UCT Breadth Library — DECISIONS

One entry per ruling that later code must not quietly reverse. Evidence lives with
the entry; the running state is in [`RESUME.md`](RESUME.md).

---

### BL-001 · Breadth identity is `universe` + `metric`, and the symbol is a rendering

The pair is carried and stored. The rendered symbol (`NASDAQ:A50`) is **derived**
and is never parsed to recover the pair.

**Why it matters in code.** `breadth_symbols.LEGACY_SYMBOL_BY_METRIC` is an
explicit table, not a rule, because **no rule produces `UCTA50`, `UCTNH20` and
`UCTAAII` from their metric keys**. A system that derived UCT's symbols would have
had to rename them to stay consistent. A system that records them can be
systematic everywhere else for free.

⛔ Consequence: a metric UCT never published has **no** UCT symbol (`symbol_for
("uct", "net_new_high_low") is None`). Minting `UCTNHL` would be a public naming
decision nobody has made.

---

### BL-002 · NASDAQ and NYSE start 2011-01-01, and this is not fixable by trying harder

**Measured 2026-09-14.** The provider carries no Nasdaq exchange attribution before
2011:

| `?date=` | MSFT | INTC | AAPL | CSCO | AMGN | GE | JNJ | XOM |
|---|---|---|---|---|---|---|---|---|
| 2010-07-01 | – | – | – | – | – | XNYS | XNYS | XNYS |
| **2011-01-03** | **XNAS** | **XNAS** | **XNAS** | **XNAS** | **XNAS** | XNYS | XNYS | XNYS |

Corroborated three ways: delisted CS/ADRC records show a **0.0 % Nasdaq share for
every year 2004-2010** (26.8 % in 2016, 60-80 % after); a 210-name point-in-time
sample of the 2008 universe returned **zero** Nasdaq attributions, including in a
control cohort the modern list calls 39 % Nasdaq; and at 2010-03-10 the attributed
NASDAQ and NYSE A50 come out at 80.29 % and 80.27 % — identical, where real
exchange breadth diverges (2015: 55.2 vs 41.8).

**The failure mode is absorption, not omission.** An unattributed Nasdaq listing
falls through to `XNYS`, so a pre-2011 "NYSE" series would not be NYSE.

**Impact split.** Percentages move ≤0.8 pp; **counts move ≈ +22 % NASDAQ / −12 %
NYSE**. Net New High-Low is a count.

⛔ No extrapolation, no proxy, no back-filled split to make four universes share a
start date. `breadth_universes.sweepable_range` **refuses** rather than clamps,
because a clamping version lets a downward backfill loop look finished while making
no progress.

---

### BL-003 · Historical eligibility publishes its own rule and does not pretend to have market cap

```
traded on D in grouped-daily          # survivorship-free by construction
∧ reference type ∈ {CS, ADRC}
∧ NOT delisted before D
∧ primary_exchange ∈ venue_set[universe]
∧ raw close on D ≥ $2.00
∧ trailing 20-day median(close × volume) ≥ $1,000,000
```

No market-cap term. We have no historical shares-outstanding, and the $300M proxy
is what dragged the earlier PIT calibration to Jaccard 0.76. These are **new
universes with their own reproducible semantics**, not an attempt to reproduce UCT.

⚠️ The price floor reads the **raw** frame (the price people actually paid); the
moving averages and 52-week extremes read the **adjusted** matrix (one split basis,
or the average is arithmetic over two different instruments).

---

### BL-004 · Historical existence comes from the tape; reference data may only remove

Grouped-daily returns every ticker that printed that session. Reference metadata
**classifies** those observations and may never add one.

That ordering *is* the no-look-ahead guarantee: a 2020 IPO cannot appear in a 2010
frame because it is not in the 2010 frame — structural, rather than a date
comparison that could be wrong. It also makes `list_date`'s absence harmless
(measured: 0 % of resolved names carry one in the list endpoint).

⛔ `bars.db` is not an alternative source. On 2008-03-10 it held 2,073 names of
which **two** were delisted (0.1 %), against 7,993 in the grouped-daily frame whose
eligible set is **44.9 % dead today**.

---

### BL-005 · One metric engine. The universe reaches it only as a member set

`sweep_history(universe=…)` swaps the FRAME. Everything after that line is
identical — same `recompute_from_frame`, same `compute_metrics`, same
`derive_live_row`, same store.

`compute_metrics` masks on `have = ~isnan(px)` and fills `px` only from `prices`,
so handing it one date's eligible members restricts **every** metric it computes to
that universe with no branch in the metric engine. Three universes over one matrix
is three member sets, not three frames.

⛔ There is no `sweep_us`, and there must never be one: four algorithms that are
supposed to agree are four chances to disagree.

---

### BL-006 · The storage widening is a key change, never a reinterpretation

`(date, metric)` → `(universe, date, metric)`. SQLite cannot alter a primary key,
so the migration rebuilds the table — but it **copies columns and invents
nothing**, and a checksum over every tuple is byte-identical at production scale
(173,937 rows, 0.80s).

Without the widened key, a US row and the UCT row for one date and metric are the
same row: the existing `ON CONFLICT … DO UPDATE` would pick a winner and write one
universe's number under the other's name — no error, right shape, plausible value.
The R2 merge carries `universe` in both the join and the conflict target for
exactly the same reason.

⚠️ `stats()` stays **UCT-scoped by default** so `/ohlc/status` and
`backfill_tick`'s `first` are unchanged; the cross-universe view rides beside it as
`by_universe`. A total would silently move `first` the day a 2008 US row lands.

---

### BL-007 · Net New High-Low has one definition, and signed presentation is generic

`_net_new_high_low` is a function called from **both** derivation paths, because a
live value and a sealed value computed by two inline subtractions would be two
definitions wearing one name — visible as a candle that changes shape after the
close. `None` when either side is missing.

Sign colouring became an **instance** capability (`presentation.resolveSignColors`
→ `presentedPlot` stamps `colorMode/colorUp/colorDown`). No renderer, binder or
pool change: `colorMode: 'sign'` already worked end to end, but only a *definition*
could ask for it.

⛔ No High-Low pane, and no ticker in the render path. A series is signed because
its values cross zero — `breadth_metrics.DOMAIN_SIGNED` — never because of a symbol
string.

---

### BL-008 · RESOLVED — namespaced identity, granted by the REGISTRY

**Owner decision (Phase 5).** Keep the namespaced identity: `US:A50`,
`NASDAQ:A50`, `NYSE:A50`, `US:NETHL`. Existing UCT symbols stay exactly as they
are. The binding qualifier:

> **SYNTAX DOES NOT GRANT SEMANTIC IDENTITY.** `NASDAQ:A50` is a Breadth Library
> symbol because the registry explicitly contains that identity. `NASDAQ:AAPL` must
> not become one merely because it has the same colon-bearing shape.

#### Why the obvious fix was the wrong one

The reverted `TICKER_SHAPE` widening **stays reverted**. A shape test cannot tell
`NASDAQ:A50` from `NASDAQ:AAPL` — they are the same shape — so no amount of care in
a regular expression could have separated them. A registry separates them without
trying, because one was minted and the other never was.

#### The two layers, kept apart

| layer | question | answer |
|---|---|---|
| **source grammar** (`sourceRef.js`) | can this string CARRY a colon symbol? | shape-based, and correctly so — `sym:NASDAQ:A50:close` → symbol `NASDAQ:A50`, field `close`, split on the LAST colon |
| **symbol validity** (`breadth_symbols.resolve`) | does `NASDAQ:A50` EXIST? | a dict lookup against minted identities |

Conflating them is how `FOO:BAR` becomes chartable. Nothing in `breadth_symbols`
splits a string on `":"` to decide what it means.

#### Consequences in code

- `resolve()` is the membership authority; `is_breadth_symbol` consults `SYMBOLS`
  first and unconditionally, so **no flag, no catalogue edit and no registry
  failure can take a shipped UCT symbol off the air**.
- `library_aliases()` is an explicit TABLE: `UCT:A50` → `UCTA50`, one direction.
  The shipped symbol stays canonical; nothing is renamed or migrated.
- `published_universe_ids()` keeps the library **dark**. The catalogue always
  describes all four universes (discovery metadata); this decides which a member
  can reach, and it is UCT alone unless `BREADTH_LIBRARY_UNIVERSES` says otherwise.

---

### BL-009 · A PIT universe is its own store, and borrows nothing from UCT

Two merges that a plausible implementation would have made, and both are refused:

- **The collector snapshot.** `breadth_monitor` holds what the 4:15pm collector
  measured **over the UCT universe**. Splicing it into a US series joins two
  populations into one line, so `_build_breadth_series` reads it only for UCT.
- **The live candle.** `breadth_live` measures that same universe, so appending its
  intraday value to a US chart paints one universe's number on another's series. A
  PIT universe ends at its last sealed day, which is honest: it has no live feed.

Both have rails that spy on the CALL rather than on the output, because an output
check passes for the wrong reason whenever the fixture happens to be empty.

---

### BL-010 · Presentation is metadata, and the library holds its own cache

`presentationFor()` maps `presentation: 'histogram'` + `domain: 'signed'` to an
instance presentation, stamped at creation. The renderer never learns that Net New
High-Low is special — `if (sym === 'US:NETHL')` in rendering code is the thing this
prevents.

Breadth also took its own `TTLCache` instance (`max_size=512`), for the reason
`live_prices` already has one: a sealed series is a large value held for hours, and
the shared 1,000-entry singleton is hammered by bars and news keys. **Isolation
only** — no routing change, no bars-api move, no CDN change; those are the owner's.

---

### BL-011 · A result says WHICH HALF LEADS; a view never branches on `kind`

**The problem.** A compact discovery list has one strong line and one quiet one, and
which half is which depends on what the thing IS. For a security `QQQ` is the thing
and "Invesco QQQ Trust" is the gloss. For a breadth measure the thing is
"% of Stocks Above 50-Day MA" and `NASDAQ` is the gloss — `NASDAQ:A50` is an
ADDRESS.

`SourceField` leads with `shortName`. For breadth, `shortName` is the UNIVERSE
badge, deliberately: it becomes the instance's `display.name`, so four A50 series in
one pane read `UCT 63.2 · US 54.9 · NASDAQ 51.8 · NYSE 57.4` beneath a metric stated
once. That is the right answer **in a pane legend** and the wrong one **in a search
list**, where it produced

    NASDAQ · % of Stocks Above 50-Day MA

⭐ **Ranking had been right since Phase 5 and the list still read address-first.**
Every unit suite passed — they assert the ranking and the row shape, and the row
shape was correct. The browser proof is what found it.

**The decision.** The RESULT states its own reading order: `lead` and `sub`, with
`lead` defaulting to `shortName || id` and `sub` to the long name when it says
something new — i.e. **exactly the previous behaviour for every other kind** — and
only `breadthResults` overrides them (`lead: name`, `sub: universeLabel || sym`).
`shortName` is untouched, so the pane legend is unchanged.

⛔ **Not a `kind` branch in the view.** `RESULT_KINDS`' own header says nothing at
runtime may branch on `kind`; a view doing `if (kind === 'breadth')` to decide
typography is the same mistake in a different file, and it would have to be repeated
in every surface that ever lists a result. One producer, one rule, every view free.

The same inversion is applied to `symbolLibraryRow` — headline metric, subtitle
`NASDAQ · NASDAQ:A50`, chip still `Breadth` — even though that projection has no
mounted consumer yet, so the dialog is right on the day it lands rather than wrong
on the day it lands.

---

### BL-012 · PORTABILITY IS NOT PRODUCIBILITY — three metrics the PIT sweep must not write

**Found by measurement, not by reading.** A 5-session offline control over
2015-03-09..13 wrote **40 of the 42** metrics `applies_to` allowed for `us`. The two
that wrote nothing, and the one that wrote the wrong thing, are all PORTABLE — the
catalogue's existing column was answering a different question.

| metric | what happens | why |
|---|---|---|
| `atr_ext_7` (XR) | nothing written | needs intraday high/low for the ATR. `breadth_live.NOT_LIVE` already says so, and the sweep runs through that same live engine |
| `adv_decline_cum` (AD) | nothing written | a cumulative line needs a SEED; `derive_live_row` takes it from `recent[0]`, empty at the start of every chunk, so the first row is None and every row inherits it. It could not simply be seeded either: the grind walks BACKWARD, so each chunk would start its own accumulation and the line would step at every boundary |
| `mcclellan_osc` (MC) | ⚰️ **plausible values, and they are wrong** | `build_levels` runs over the WHOLE MATRIX — correct for every other level, because a member's 50-day average is the same number whoever else is in the frame. `mcc_ema19` / `mcc_ema39` are the ONLY levels that are not per-ticker: they are EMAs of the whole market's net advances, while today's `net = adv - dec` IS universe-restricted |

**The McClellan evidence, one sweep, three universes, 2015-03-09:**

| universe | universe_count | net advancers | McClellan |
|---|---|---|---|
| US | 2,936 | +507 | −232.9 |
| NASDAQ | 1,195 | +268 | −244.8 |
| NYSE | 1,712 | +243 | −246.1 |

Populations differing by 2.5× produce oscillators **1.3 points apart**, and all three
read deeply negative on a day every one of them advanced broadly. Both tells say the
same thing: the history is not theirs.

**Decision.** `breadth_metrics.PIT_UNPRODUCIBLE` is a second gate inside
`applies_to`: a metric must clear **portability** (does the measurement mean the same
thing over another population?) **and producibility** (can the sweep that builds that
population actually make it?). `applies_to` is the one function `library_rows` and the
sweep's `_applies` both read, so a metric excluded here can neither be stored nor
offered — the two can not drift apart.

⚠️ **UCT is unaffected at every entry.** It is measured by the collector, not by this
sweep, and `applies_to` returns True for it unconditionally. `UCTXR` keeps working.

⛔ **This had to be caught before the grind, not after.** A grind would have written
~12,600 sessions × 3 universes of wrong McClellan values, and nothing downstream
would have looked odd.

**Reversible on purpose.** A ratio-adjusted McClellan — `(adv−dec)/(adv+dec)` EMA'd
per universe — is the real fix and is a product decision, not a defect repair. The
frame now carries o/h/l, so `atr_ext_7` is buildable. `adv_decline_cum` needs a
forward-only accumulation pass. Each is a removal from this set when it lands.

---

### BL-013 · The publication gate is per-UNIVERSE and that is not yet enough

Auditing the full chain from `published_universe_ids()` outward found that flipping
`BREADTH_LIBRARY_UNIVERSES=us` today would publish a universe **incoherently**:

| surface | reads | publishes `US:A50`? |
|---|---|---|
| `resolve` / `is_breadth_symbol` | registry + published set | ✅ |
| `/api/bars`, `/api/bars-history` | `is_breadth_symbol` → `build_breadth_bars` | ✅ |
| `_should_proxy` (stays on the web pod) | the same authority | ✅ |
| `/api/breadth-symbols` → `library` block | `library_catalog` | ✅ |
| source picker (`useSymbolDiscovery`) | that `library` block | ✅ |
| **`/api/ticker-search`** | `breadth_symbols.search()` → `list_breadth_symbols()` | ❌ **hard-wired to the 44 shipped `SYMBOLS`** |
| **`/api/breadth-symbols` → `symbols` array** | `list_breadth_symbols()` | ❌ **same** |

The second row is the serious one. The client builds `useBreadthSymbols`' `map` from
`symbols`, and `symbolFamily()` answers `'security'` for anything absent from it — so
a published `US:A50` would be classified as an ordinary security and
`ohlcCapabilityOf` would ALLOW it as a candle source, over a close-to-close synthetic
body. `breadthRecord()` would also return null, so the pane readout would lose its
name.

**Decision: ONE canonical publication gate.** `list_breadth_symbols()` must project
the PUBLISHED set (`SYMBOLS` first and unconditionally, then registry rows for every
other published universe), so `symbols`, `/api/ticker-search`, `library`, `/api/bars`
and the client's family classification all turn on together. It is byte-identical
today, because UCT alone is published.

⚠️ Blast radius to design for, not assume: `symbols_by_group()` seeds the prebuilt
watchlists, and this repo has already lost prebuilt lists once to a synthetic-symbol
interaction. Not implemented in the audit phase for that reason.

---

### BL-014 · Published ≠ produced: the catalogue needs a METRIC gate too

`published_universe_ids()` decides which POPULATIONS a member can reach. Nothing
decides which MEASUREMENTS. That matters because the grind's cost is dominated by the
frame, not by the metric count — `compute_metrics` computes the whole row whatever is
stored — so the cheapest correct plan is:

> **grind once at the full producible set (39 per PIT universe); publish a focused V1
> (18 metrics).**

Promoting a metric to V1.1 then costs a flag flip, not another 3-hour grind and
another ~10,000 provider fetches. That requires a metric publication set beside the
universe one — specified here, deliberately NOT built during the audit.

---

### BL-015 · ONE publication gate — implemented, and the three collections named

BL-013 said the gate was incoherent. This is what was built.

**The one predicate.** `breadth_symbols.is_published(universe, metric)`. A row is
public only when all six hold: registered universe, registered metric, applicable,
producible, inside the active publication set, universe enabled. `applies_to` folds
applicable+producible (BL-012), so it reads as four clauses.

**The one projection.** `published_symbol_rows()`. Every public surface derives from
it — `resolve`, `is_breadth_symbol`, `list_breadth_symbols`, `library_catalog`,
`library_search`, `/api/breadth-symbols`, `/api/ticker-search`, `/api/bars`.

⛔⛔ **THREE COLLECTIONS, THREE NAMES, NOT INTERCHANGEABLE:**

| | means | who reads it |
|---|---|---|
| `legacy_symbol_rows()` | the 44 SHIPPED UCT symbols | prebuilt watchlists, Discord |
| `library_rows()` | every REGISTERED identity | discovery metadata |
| `published_symbol_rows()` | what a member may REACH | every public surface |

The blast-radius rule made concrete: `symbols_by_group()` stays legacy-only, because
`watchlist_prebuilt._breadth_lists()` builds the member-facing "UCT Breadth" prebuilt
lists from it. Publishing a universe must not push 54 identities into a list a member
already holds. A rail drives the real `_breadth_lists()` at `BREADTH_LIBRARY_UNIVERSES=*`
and asserts no colon reaches it.

**Dark-default parity is a byte claim, not a hope.** With no flags,
`published_symbol_rows() == legacy_symbol_rows()` — same 44 rows, same order, same
keys, and legacy rows still carry no `universe` key.

---

### BL-016 · V1 as metadata: five levels, and UCT is never gated by a publication set

`breadth_metrics` now separates five questions that were being conflated:

| level | answered by |
|---|---|
| REGISTERED | `metric in METRICS` |
| APPLICABLE | `is_applicable()` — portability |
| PRODUCIBLE | `is_producible()` — BL-012 |
| STORED | `breadth_symbols.availability()` |
| PUBLISHED | `is_published_metric()` |

A V1.1 metric is registered + applicable + producible + **stored** and deliberately
**not published**. That is the whole point: **grind once at the full producible set
(39 per PIT universe), publish a focused V1 (18)**, and promote later with a flag flip
instead of a second 3-hour grind and ~10,000 provider fetches.

⛔ **UCT is not gated by a publication set.** `UCTHS` is not in V1 and stays on the
air. The V1 list governs what the NEW universes expose; it is not a re-litigation of
44 symbols shipped a year ago.

`BREADTH_LIBRARY_METRICS` selects the set (default `v1`, `*` opens everything). A
typo'd value falls back to the default rather than publishing nothing or everything —
the same rule `published_universe_ids` uses, for the same reason.

**The accepted invariant, railed:** 18 metrics · 70 identities · 16 UCT + 54 new. UCT
gives 16 rather than 18 because an IDENTITY needs a SYMBOL and `net_new_high_low` /
`universe_count` have no UCT spelling. ⚠️ That is not the same number as the live
catalogue, which is 44 while dark and 62 with US published — two different questions,
both correct.

---

### BL-017 · The daily forward seal — orchestration, not a second engine

`universe_backfill_plan` only ever walks BACKWARD to the floor. Nothing advanced the
right edge, so a published PIT series would have frozen on whatever day the grind
ended, with nothing anywhere saying so.

⛔⛔ **`forward_seal_tick` ORCHESTRATES; `sweep_history` does the work.** The daily
value therefore comes from the same eligibility (`eligible_on`), the same computation
(`compute_metrics` via `recompute_from_frame`), the same applicability filter and the
same writer as every historical row beside it. A separate "daily" path is how a series
grows a seam at the date the backfill stopped.

**Proven, not asserted.** An end-to-end rail seals a date through the real pipeline on
the durable frame cache, then recomputes that same date the historical way into a
fresh store and compares: the values are identical.

| decision | why |
|---|---|
| calendar = `bars_fetch._NYSE_HOLIDAYS_YYYYMMDD` | the repo's ONE closure table; a second copy diverges in the year nobody updates it |
| `through` defaults to **yesterday** | today's grouped-daily frame is not settled; sealing it would seal a partial session as final |
| **one** `sweep_history` call for the whole gap | it builds a ~560-day frame; per-date calls would rebuild it per session |
| catch-up bounded at **10 sessions** | a wider gap is an outage, not a late tick — it reports `gapped` and leaves recovery to the historical tool rather than becoming an accidental grind on the web pod |
| an empty store is `blocked`, not a one-day gap | with no rows there is no "latest sealed session"; inventing one would start the grind |
| a refused chunk is recorded and the dates are LEFT | `build_frame` refuses a window with a missing RAW frame; the seal carries that through verbatim — no partial write, no fabricated zero, no green log |
| fewer sessions than planned reports `partial` | the planner used the calendar, the frame used what the provider published; a difference means one of them is wrong |

`sweep_history` now carries `missing_raw` through its refusal, so a caller gets dates
rather than prose to parse.

**Scheduling is CONVERGENCE, not an appointment.** Every 30 minutes the job asks "are
there settled PIT sessions that should now be sealed?" and fills the bounded gap.
Correctness lives in the planner reading the store, not in firing at 16:1x ET — a
missed tick, a restart or a deploy during the close simply means the next run finds
two sessions pending. Inert while dark: it iterates PUBLISHED PIT universes, and the
default published set contains no PIT universe at all.

---

### BL-018 · Warming: the participation family, and nothing else

The rail that pinned `warm_breadth` as UCT-only asked for a deliberate update. This is
it: a published PIT universe is warmed for the **participation family only** — 7
series each, hard ceiling 24 — and the other eleven V1 metrics stay lazy.

⚰️ The bound is this loop's own history. Warming the whole V1 catalogue across three
universes would be 54 cold builds per pass on the single web pod, which is the shape
of the churn that starved it once already. Every PIT warm is failure-isolated per
symbol: one that throws cannot stop UCT's pass and cannot reach serving, because
`build_breadth_bars` already answers a cold miss by building inline. **Warming is an
optimisation, and an optimisation that can break serving is not one.**

`warm_symbols_for_pit()` DERIVES its list from published × V1 × the warm families, so
publishing a universe or changing the V1 set is followed automatically.

---

### BL-019 · Health, from what already existed

`library_health()` joins `breadth_daily_ohlc.stats`, `_FORWARD_SEAL_STATE`,
`availability()` and the publication set, and adds the one thing none of them could
answer alone: whether the sessions the CALENDAR expects are actually present.

⛔ **Never on the serve path.** The gap probe uses a new bounded `dates_since()` whose
`WHERE` prefix matches the leading columns of `idx_bdo_source_date`, so it is an index
range scan over a ~30-session window rather than the full-history DISTINCT that
`distinct_dates_by_scan` does. Memoised for a minute, reached only through
`GET /api/breadth-monitor/library-health`, and a rail reads `build_breadth_bars`'
source to assert it does not call it.

⚠️ **A dark universe is never reported unhealthy.** It has no rows because nobody has
published it, which is the correct shipped state; claiming otherwise would make the
signal useless on the day it matters. `healthy` is only asserted for a PUBLISHED
universe.

---

### BL-020 · "Registered breadth but DARK" stays a SECURITY to the client — deferred, with the reason

**The question (owner §17):** can the canonical family architecture represent
*registered breadth, not currently published* as **unavailable breadth** rather than as
an ordinary security, without widening colon symbols, without making `NASDAQ:AAPL`
breadth, without a ticker-prefix special case, without breaking rollback, and **without
exposing the identity publicly**?

**Answer: NO — and the last constraint is the one that decides it.**

`symbolFamily()` knows exactly what the payload told it, and nothing else. For the
client to call a dark `US:A50` "breadth", the server would have to name it in the
payload — which IS exposing the identity. There is no third source of truth available:

- a SHAPE test (`contains ':'`) makes `FOO:BAR` breadth — the widening BL-008 reverted;
- a PREFIX test (`US:`) is the ticker special case the same decision banned;
- a second endpoint listing dark identities is the same disclosure wearing a different URL.

**So the honest position is that the family label is wrong and the BEHAVIOUR is right**,
and the behaviour is what a member experiences. Measured, not assumed:

| state | what happens |
|---|---|
| dark identity, discovery | absent from `library`, from `symbols`, from search |
| dark identity, `/api/bars` | empty series — `resolve()` returns None |
| dark identity, `ohlcCapabilityOf` | **`NO_BARS`** — refused, because there are no bars to draw |
| a chart saved before a rollback | source survives the round-trip; the series renders unavailable |
| `AAPL`, `NASDAQ:AAPL`, `FOO:BAR`, `UCTT` | security, unchanged |

⚠️ The family gates run BEFORE the bar gates in `ohlcCapabilityOf`, so a dark identity
misses the semantic refusal (`FAMILY_NOT_OHLC`) and lands on the structural one
(`NO_BARS`). **Different reason string, same refusal.** The only way to reach the
`ok: true` branch is to hold bars for a dark identity, and the server does not serve
any.

**Deferred, not forgotten.** If a future payload gains a legitimate reason to carry
"identities this deploy knows but does not publish" — a member-facing "coming soon"
surface, say — this becomes a two-line change and the label follows. Until then,
exposing the catalogue to fix a cosmetic refusal string would trade a real product
constraint for a wording improvement.

Railed in `breadthPublication.test.jsx` under `§17`, so the reasoning cannot quietly
rot into "nobody checked".

---

### BL-021 · CHUNK BOUNDARIES CORRUPT TWO V1 METRICS — the US data gate's blocker

The provider path passed. `sweep_history` did not. Two defects live at the boundary of
every sweep CALL, so they were invisible to every single-window control run so far and
only appeared when a resume produced a different artifact from an uninterrupted run.

Both are **pre-existing**, both are in the canonical path the grind AND the forward seal
share, and neither touches UCT (whose rows come from the collector).

#### Defect A — the warm-up rows are measured over the WHOLE MARKET

`sweep_history` seeds a 15-session `recent` buffer before `from_date` so the rolling
metrics are not cold. It computes those warm rows with
`members=members_of.get(ds)` — and `members_of` is the PIT frame's `eligible` map,
which has entries **only for the sweep dates**. A warm-up date therefore passes
`members=None`, which `recompute_from_frame` documents as *"every priced ticker"*.

Measured 2015-06-05 window:

| date | kind | members passed | universe_count |
|---|---|---|---|
| 2015-06-03 | WARM | `None (ALL)` | **7,835** |
| 2015-06-04 | WARM | `None (ALL)` | **7,805** |
| 2015-06-05 | swept | 3,073 | **3,073** |
| 2015-06-08 | swept | 3,071 | **3,071** |

…and the counts the ratios are built from move with it: `up_4pct` 349 (warm, whole
market) vs 114 (swept, US).

⭐ **The stored CLOSES are wrong, not just the bodies.** Replaying the same window with
the warm rows correctly restricted to their own date's US member set:

| date | R5 stored | R5 correct | err | R10 stored | R10 correct | err |
|---|---|---|---|---|---|---|
| 2015-06-05 | 1.47 | 2.08 | **29.3 %** | 1.13 | 1.49 | **24.2 %** |
| 2015-06-08 | 1.58 | 1.87 | 15.5 % | 1.12 | 1.39 | 19.4 % |
| 2015-06-09 | 1.18 | 1.24 | 4.8 % | 1.26 | 1.48 | 14.9 % |
| 2015-06-10 | 1.06 | 1.25 | 15.2 % | 1.28 | 1.56 | 17.9 % |
| 2015-06-11 | 1.43 | 1.43 | 0.0 % | 1.33 | 1.58 | 15.8 % |
| … | | | | | | |
| 2015-06-18 | 1.46 | 1.46 | 0.0 % | 1.45 | 1.45 | 0.0 % |

**R5 wrong for the first 4 stored sessions of a chunk; R10 for the first 9.**

⛔ **ONLY those two V1 metrics are affected** — every other V1 metric is byte-identical
under both runs. They are the only V1 members derived from the `recent` buffer rather
than from the row itself. `hi_ratio` / `lo_ratio` look similar and are safe: they are
computed from `nh`/`nl`/`universe_count` **on the same row**.

#### Defect B — the first stored bar of every sweep call is a doji

`o = prev.get(metric, fv)` builds the close-to-close body, and `prev` is populated only
for dates at or after `from_date`. The first stored date of every CALL therefore has no
predecessor in that run and takes `o = c`.

    2015-06-05 pct_above_5sma   uninterrupted (38.8, 49.3, 38.8, 49.3)
                                resumed       (49.3, 49.3, 49.3, 49.3)

The CLOSE is always right; the open/high/low are not. 35 metrics on the boundary date.

#### Blast radius — and why the FORWARD SEAL is the serious half

| | grind (365-day chunks, ~13 for US) | forward seal (one tick per session) |
|---|---|---|
| Defect A · R5 | ~52 of 4,860 sessions (1.1 %) | ⛔ **every sealed day** |
| Defect A · R10 | ~117 of 4,860 (2.4 %) | ⛔ **every sealed day** |
| Defect B · doji | ~13 bars of 4,860 (0.3 %) | ⛔ **every sealed candle** |

A daily seal starts a fresh `recent` and a fresh `prev` every tick, so **100 % of the
live portion of `US:R5`, `US:R10` and of every sealed candle body would be wrong** —
permanently, and invisibly, because the numbers look entirely plausible.

#### Why this is NOT fixed here

⛔ **Neither fix has one obvious safe answer**, which is the bar for a control phase.

*Defect A* — the honest fix is to build eligibility for the warm-up sessions too. The
code deliberately does not: *"building eligibility for 560 extra sessions would double
the frame's cost to refine numbers nobody reads"* — which was true when the warm rows
were only a buffer and false now that two published metrics read them. The alternatives
(restrict only the ~15 warm sessions the buffer actually uses; or refuse to store R5/R10
for the first N sessions of a chunk; or carry `recent` across calls) are a real
cost/correctness trade-off, not a typo.

*Defect B* — seeding `prev` from the STORE's last row before `from_date` is small, but
it must land and be re-validated together with A.

Both are production-path changes to the function the grind depends on. They deserve
their own authorization and their own re-run of this control.

#### What the gate DID prove

The provider path itself is sound: auth works, RAW frames are real and differ from
adjusted where it matters, the eligibility contract holds, membership is plausible,
delisted names participate at 41.7 % / 44.9 %, determinism and idempotency pass, the
missing-RAW refusal works and heals, cache reuse works, and 704 requests produced zero
failures. **A50 at 2015-03-10 = 47.20, against a 47.23 reference.** None of that is in
doubt; the arithmetic at chunk boundaries is.

---

### BL-022 · BL-021 RESOLVED — the smallest correct state, and why it was small

**The invariant, now enforced:** `VALUE(metric, universe, D)` depends on canonical
historical inputs and nothing else — not chunk size, not sweep start, not a restart, not
a resume boundary, not a forward-seal tick.

#### The audit that chose the design

`ratio_5day` and `ratio_10day` are, exactly:

    sum(up_4pct_today over the last 5 / 10 rows) / sum(down_4pct_today over the same)

…read off `derive_live_row`'s `recent` buffer. So the **minimum canonical state** a
chunk boundary must carry is two scalars per session for the previous 4 (R5) or 9 (R10)
sessions. Nothing else. No frames, no reference map, no membership — *after* those
primitives exist.

Three designs were on the table:

| design | verdict |
|---|---|
| **give the warm sessions their own member set** | ⭐ CHOSEN |
| read the prior primitives from the durable store | ⛔ wrong direction — the grind walks BACKWARD, so at the start of chunk *N+1* the store holds dates *after* it, never before. It would fix the forward seal and leave the grind broken |
| carry `recent` across calls in memory | ⛔ dies with the process; makes resume correctness depend on not restarting, which is the defect wearing a hat |

⛔ **THE COST OBJECTION WAS ABOUT THE WRONG NUMBER.** The old comment read: *"building
eligibility for 560 extra sessions would double the frame's cost to refine numbers
nobody reads."* Two clauses true, one false — R5 and R10 are stored, are in V1, and ARE
those numbers. And it was never 560 sessions: the 560-day span is the frame's
**per-ticker** warm-up (200-day averages, 52-week extremes), which is the same number
whoever else is in the universe and needs no membership at all. The rolling metrics need
`WARM_SESSIONS` — **fifteen**.

Measured cost over a full US grind: **~195 extra raw frames on ~9,185, about 2 %.**

#### Defect B — OHLC continuity

`_seed_carry_in` carries the last warm row into `prev`, so the first stored bar of an
invocation opens at the previous session's close.

⚠️ **A genuinely first date still opens at its own close**, and that is correct rather
than a fallback: with no earlier session there is no prior close to open at. What
changed is that the DATA decides it — does a warm session exist? — instead of where the
loop began. "The first date of the series" and "the first date of this function call"
are no longer the same thing.

#### Proven on real provider data — every acceptance count zero

US 2015-03-02 … 2015-06-30, 85 sessions, 3,315 rows, computed five ways:

| | R5 mismatches | R10 | O/H/L/C |
|---|---|---|---|
| two chunks vs one sweep | **0** | **0** | **0** |
| four chunks | **0** | **0** | **0** |
| 85 one-date invocations (the forward-seal shape) | **0** | **0** | **0** |
| interrupted + resumed | **0** | **0** | **0** |

Boundary body at 2015-04-30: open **55.7** = prior close **55.7** (the old doji would
have been 43.9). Non-stateful controls unmoved: A50 at 2015-03-10 still **47.20**, NETHL
13 / −99 / −7, and `NETHL == NH − NL` with 0 violations over all 85 sessions.

⚰️ **Both bite-checks bite.** `_seed_carry_in` is a named function precisely so a rail
can disable it, and the offline fixture's eligible and whole-market populations differ
3.3× because a fixture where they coincide passes against the broken code. Restore
either old behaviour and the rails go red — verified.

---

### BL-023 · A provider failure is not a holiday

`get_grouped_daily_ohlcv` wraps everything in `except Exception: return {}` — the right
contract for a chart, the wrong one for a sweep, because it collapses three answers into
one empty dict: the market was closed, the provider rate-limited us, the request timed
out.

⭐ **The fix is at the transport.** `get_grouped_daily_frame` returns `{rows, empty}` or
raises `GroupedFrameError`. Once a failure RAISES, an empty frame genuinely means "the
provider answered and there were no rows" — and the holiday question becomes safe to
ask. The old function is untouched for its existing callers.

It reuses `_typed_get` and the existing `Massive*` vendor error family rather than
inventing an error model. Retries are **bounded (3), serial, 1/4/10 s** — a grind that
answers throttling with more concurrency is how a shared API key gets exhausted for
every other consumer on the pod. Rate-limited and transient retry; **auth and
not-configured never do**; a 404 is a CLOSURE.

⛔ **The cache cannot learn a lie.** A failure writes nothing, so a 429 can never be
cached as "this date has zero securities" for the durable tier's seven-day TTL. A
CONFIRMED closure IS durable — a `.closed` marker written only when the provider
answered successfully with no rows on a settled date. Without it every replay re-asks
about Thanksgiving 2013, and an offline replay cannot run at all.

**RAW and ADJUSTED are atomic for a session.** The adjusted half failing now refuses the
chunk exactly as the raw half does — it never did, so a dropped adjusted frame removed
the session from `dates` and the sweep simply never computed it, with `max_gap` noticing
only after twelve in a row. The refusal names the two causes apart, because "the
provider errored" and "the provider answered with nothing on a day the market traded"
are both refusals and are not the same incident.

Verified live: **33 closure markers written, 22 frames fetched, 0 failures**, and every
marker a genuine holiday. 14 offline rails cover all three states, the retry that
recovers, the retry that exhausts, the permanent failures that are never retried, the
malformed body, the poisoning case, the durable closure, and both walker refusals.

---

### BL-024 · A LOCAL token shed is not the vendor's 429 — found by running the grind

`_typed_get` raises `RateLimited` for two genuinely different refusals, and BL-023's
tri-state fetcher answered both the same way:

| refusal | `status` | right answer |
|---|---|---|
| the VENDOR said 429 | `429` | 1 / 4 / 10 s backoff |
| OUR OWN bucket shed a token (`_take_token`, 300/min) | `None` | ~0.2 s — one token |

The US grind's first chunks ran ~1.6 requests/s and then fell to **~0.05/s**: every
request past the first 300 of a minute shed a local token and slept a FULL SECOND for
one that regenerates in a fifth of that.

⚠️ **The budget was new to this path.** The old `get_grouped_daily_ohlcv` called `_get`
directly and never met `_take_token` at all, so the grind had been unthrottled.
Respecting the budget is right; sleeping the wrong interval for it was not.

⛔ **A local shed is also not an attempt.** It never reached the vendor, so it must not
consume one of the three vendor retries — otherwise a busy minute "exhausts" a request
that was never sent and a grind reports a provider outage that did not happen. Bounded
at 600 sheds anyway, because politeness must not become an infinite loop.

⭐ **No data semantics changed** — this is pacing, not arithmetic — so the 19,539 rows
the grind had already produced stayed valid and the run RESUMED rather than restarting.
That resume is now proven on real data rather than argued.

---

### BL-025 · A helper that mutates process state turns a rail into a rubber stamp

⚰️ The first §26 forward-seal check reported PASS and had tested nothing. It captured its
reference with `snap(ARTIFACT, …)`; `snap` sets `BREADTH_OHLC_DB` as a side effect, so the
truncation intended for a COPY ran against the grind artifact. The store then still ended
where it began, the seal found nothing to do, and the tail "matched" trivially. It also
silently deleted five sessions from the artifact.

**Two rules, both already this repo's:**

- a test helper must not change process-global state that its caller depends on — every
  store path in the repair script is passed explicitly;
- a rail must be able to FAIL. The rewritten §26 asserts the truncation took effect
  before it trusts anything that follows.

The recovery was itself the proof §26 wanted: with the store genuinely truncated, the
forward seal rebuilt the five sessions **identically to an independent deterministic
replay**, and the join opened at the prior close on every metric.

---

### BL-026 · DARK INTEGRATION IS BLOCKED ON THE DEPLOY — production is still pre-migration

**Measured, read-only, 2026-09-15.** The production breadth database — downloaded from
the live R2 durability path, `breadth_ohlc/latest.txt` → `snap/1789472774.tar.gz`,
uploaded by the worker at 11:46 UTC that day — carries this schema:

```
CREATE TABLE breadth_daily_ohlc (
    date TEXT NOT NULL, metric TEXT NOT NULL,
    o REAL, h REAL, l REAL, c REAL, source TEXT, updated_at TEXT,
    PRIMARY KEY (date, metric)          -- ⛔ NO `universe` COLUMN
)
```

170,545 rows, 2008-01-02 … 2026-08-07, 40 metrics, integrity ok. **The universe-keyed
migration has never been deployed.** Production runs master, and master's
`breadth_ohlc_sync._MERGE_SQL` is universe-blind:

```sql
INSERT INTO breadth_daily_ohlc(date,metric,o,h,l,c,source,updated_at)
SELECT s.date,s.metric,…
```

#### ⛔⛔ Why promoting the artifact now would CORRUPT UCT

Uploading the US snapshot to R2 would have the web pod merge it with **that** SQL. Keyed
on `(date, metric)` alone, the US row for `2015-03-10 / pct_above_50sma` and the UCT row
for the same date and metric **are the same row**. The merge would rank them, pick a
winner, and write one universe's number under the other's name — across a year-plus of
published UCT history, silently, with the same shape, the same metric key and an
entirely plausible value.

That is verbatim the failure this branch's own `_MERGE_SQL` comment was written to
prevent: *"leaving either one out is silent corruption rather than an error."* It is not
a hypothetical — it is what the deployed code would do today.

**So nothing was uploaded.** Production is untouched.

#### The ordering this establishes

> **DEPLOY FIRST, INTEGRATE SECOND.** The universe-keyed schema is a precondition for US
> rows existing at all, not a detail of how they are served.

A deploy of this branch is safe and dark on its own terms: `_ensure_init` widens the key
on boot and stamps every existing row `universe='uct'`, and `published_universe_ids()`
defaults to UCT alone, so the deploy changes no member-visible behaviour.

#### The whole integration was rehearsed instead, and it works

Against a downloaded copy of the real production database:

| step | result |
|---|---|
| universe migration on the production copy | **0.9 s**, 41.7 MB → 37.4 MB (VACUUM) |
| UCT value fingerprint across the migration | **`c7578ff9…` → `c7578ff9…` IDENTICAL** |
| `_merge_from` the audited artifact | **183,417 rows adopted in 1.2 s** |
| re-merge | **0 rows** — idempotent |
| UCT after US merge | **still `c7578ff9…`, 170,545 rows** |
| US after merge | **`76091392…`, identical to the audited artifact** |
| derived `breadth_reconstructed_daily` | rebuilt to 4,679 rows by watermark |

⚠️ **The R2 artifact roughly doubles**: 41.7 MB → 85.7 MB on disk, 8.1 MB → **16.5 MB**
compressed, and R2 retains five snapshots (~82 MB). The module header still describes
this store as "single-digit MB"; that description is now two generations stale.

⚠️ **And one-directional sync is a durability gap worth stating.** The worker uploads;
the web pod pulls; **the worker never pulls.** US history produced outside the worker
therefore has no supported route into the origin of the R2 snapshots. After a deploy the
clean options are (a) let the worker recompute US — 68 min, frames already cached — or
(b) ship the merged artifact and accept that the worker's next upload re-points
`latest.txt` at a UCT-only snapshot while the web pod keeps its merged rows. (a) is the
architecturally honest one and is now cheap.

---

### BL-027 · Storage does not imply publication — proven on real integrated data

The darkness gate was run against the staged database, which is exactly what production
would hold after a deploy plus integration: 170,545 UCT rows and 183,417 US rows.

With the publication configuration untouched (`published_universe_ids() == ['uct']`),
each of the eighteen V1 US identities has **4,703 rows sitting in the table** and is:

| surface | answer |
|---|---|
| `resolve()` | None |
| `is_breadth_symbol()` | False |
| `search()` (`/api/ticker-search`) | absent |
| `library_catalog()` | absent |
| `build_breadth_bars()` (`/api/bars`) | **0 bars** |

`/api/breadth-symbols`' `symbols` array is **byte-identical to the legacy 44**, with no
colon in it. UCT serves 400 bars for UCTA20/A50/NA/NH/HS, stays searchable, keeps its
spelling, and leaks no colon symbol into the prebuilt-watchlist projection. Dark warming
is **zero series**.

⭐ `library_health()` distinguishes the two facts exactly as it should: US reports
`state=available` with **183,417 rows** and `published=False`, `metrics_published=0`, and
the overall health stays `ok=True` — a populated, deliberately-dark universe is not a
fault.

**The flip is metadata, not a data rewrite.** Enabling US locally publishes **62 rows =
44 legacy + exactly the 18 V1 metrics**; the V1 identity model reads **70 = 16 UCT + 54
new**; `US:NETHL` keeps `histogram` / `signed` / `count` and serves real negative closes;
warming becomes the 7 participation series. Disabling returns the payload to the
byte-identical 44, `US:A50` resolves to None and serves 0 bars — **and all 183,417 US
rows are still in the table.**

⛔ And STORED still is not APPROVED: `US:MU` and `US:S2` hold 4,703 rows each and remain
unreachable even with US published, because they are not in the V1 set.

---

### BL-028 · The migration is forward-safe and BACKWARD-FATAL — the deploy is one-way

§3 of the deploy brief asked for a rolling-deploy hazard audit. It was run against real
SQLite using master's ACTUAL deployed statements and this branch's actual statements, not
a paraphrase of either.

**The collision being fixed, demonstrated:**

| schema | after writing UCT 47.2 then US 19.9 for 2015-03-10 / pct_above_50sma |
|---|---|
| new `(universe, date, metric)` | `[('uct', 47.2), ('us', 19.9)]` — two rows |
| old `(date, metric)` | `[('2015-03-10', 'pct_above_50sma', 19.9)]` — **UCT's 47.2 is gone** |

**Forward, both mixed-version directions are SAFE — and only because US is absent:**

| case | result |
|---|---|
| worker NEW uploads a migrated snapshot → web OLD merges it | ✅ the `universe` column is ignored; every row is UCT, so nothing mixes |
| worker OLD uploads an unmigrated snapshot → web NEW merges it | ✅ `susrc` falls back to the literal `'uct'`, which `_merge_from` already handles by design |

⛔⛔ **Backward, it is not safe.** Master's UPSERT names `ON CONFLICT(date, metric)`, and
after the migration no unique index matches that clause:

    OperationalError: ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint

A plain `INSERT` omitting `universe` still works — the column keeps
`NOT NULL DEFAULT 'uct'` — but every UPSERT path fails. **So old code against an
already-migrated database cannot write breadth at all**, which is the 4:15pm collector
and the intraday aggregation.

**That is reachable by accident, not only by choice.** A failed health check or a manual
Railway rollback puts old code on a pod whose volume this migration already rewrote —
and `_migrate_universe_column` `DROP`s the original table, so there is no in-place
reversal.

⛔ **And the restore path does not exist through any channel available here.** The R2
bridge is an additive gap-fill merge; it never replaces a database. Restoring a pod's
`/data/breadth_daily_ohlc.db` needs filesystem access to the Railway volume — which
means a shell on the pod or another deploy. Holding `prod_1789472774.tar.gz` gives us the
BYTES to restore; it does not give us a way to put them back.

**So the deploy is effectively one-way, and that is a decision to take deliberately
rather than discover during an incident.**

#### The designed safe sequence

⭐ **A temporary compatibility index makes the deploy reversible, and doubles as an
interlock.** While UCT is the only universe, `(date, metric)` is still unique, so:

    CREATE UNIQUE INDEX idx_bdo_compat_date_metric ON breadth_daily_ohlc(date, metric)

- old code's `ON CONFLICT(date, metric)` matches again → **a code rollback stops being
  fatal**;
- new code's `ON CONFLICT(universe, date, metric)` is unaffected;
- and the index CANNOT survive a second universe — inserting US would raise a UNIQUE
  violation. That is a feature: it makes "drop the compatibility index" an explicit,
  unmissable step of the US ingest phase rather than a note someone has to remember.

Sequence: deploy dark with the index → soak → confirm both pods on new code and a
round-trip through R2 → drop the index as step one of US ingest.

⚠️ Not implemented. §3 says to STOP before the production migration when a real
old-code/new-schema hazard exists and design the sequence first; this is that design, and
adding a production index is a change the owner should authorise on its own terms.

---

### BL-029 · The 4-5 GB grind RSS, explained — and it is a CACHE BOUND, not arithmetic

Measured rather than estimated:

| | |
|---|---|
| shared `TTLCache._MAX_SIZE` | **1,000 entries** |
| one whole-market grouped frame | 7,804 tickers · **0.56 MB on disk** · **2.9 MB as live Python objects** |
| 1,000 of them | **2.9 GB** |
| plus the numpy matrix (~12k × 635 × 8 × 2) | ~120 MB |
| observed | **4.8 GB** |

⛔ **The grind was filling the SHARED member-serving cache with whole-market frames.**
`get_grouped_daily_ohlcv` and `get_grouped_daily_frame` both `cache.set(...)` into the
singleton that also holds bars, news and snapshot keys — so a 9,810-frame grind evicts
every hot bars key and then holds 2.9 GB of frames nobody will ask for again.

⭐ **The repo already solved this shape twice.** `live_prices` has its own instance, and
BL-010 gave breadth serving its own for the same stated reason: *"an instance whose
working set is a KNOWN, DERIVABLE quantity states its own bound."* A grouped-frame cache's
working set IS known: the `WARM_SESSIONS` warm window plus the chunk's active slice —
tens of frames, not a thousand.

**The fix changes no arithmetic.** The durable disk tier already re-reads a settled frame
in ~12 ms, so a small bound costs a disk read rather than a provider call. A bound of ~40
frames holds a sweep's working set at ~116 MB.

⚠️ **And this is not only a grind concern.** Any grouped-daily call on the WEB pod today
puts 2.9 MB objects into the same 1,000-entry cache that serves `/api/bars` — the
"mutual and silent harm" BL-010 described, between a different pair.

---

### BL-030 · The supported database RESTORE path already exists — for bars

§5 asked: *given rollback snapshot X, how do we install X as the worker's canonical
breadth database?* The answer is not a new admin system; it is the idiom
`data_sync.download_snapshot()` has used for bars all along:

1. download the chosen snapshot to a temp dir;
2. `integrity_check` it and **refuse to install on failure**;
3. `shutil.move(src, /data/bars.db)` — a real file replace, not a merge;
4. invalidate every thread's SQLite connection so the new inode is seen.

⭐ **For breadth, step 4 is unnecessary** — and the reason is written down in
`breadth_ohlc_sync`'s own header: *"The store opens a fresh connection per read … so
there is no `bump_db_epoch()` / stale-inode problem to solve."* `_conn()` resolves
`_db_path()` on every call. So a breadth restore is download → integrity-check → move.

⚠️ Two pitfalls are already recorded in `data_sync` and must be inherited, not
rediscovered: do **not** delete the stale `-wal`/`-shm` sidecars (an earlier version did
and gave writers "disk I/O error" mid-transaction), and let `integrity_ok()` at boot be
the fail-safe instead.

⛔ **Not built, and not needed for the dark UCT-only deploy** — BL-028's compatibility
index is what makes a code rollback safe. It IS a precondition of US ingest, because once
the interlock is dropped a bad ingest can only be undone by replacing the file.

---

### BL-031 · Phase B — how US should reach the worker's canonical database

The worker uploads; the web pulls; **the worker never pulls.** So US history must arrive
in the worker's own store, or it never propagates.

| | **A · one-time import into the worker's DB** | **B · worker recomputes from the provider** |
|---|---|---|
| correctness | the audited artifact, byte-for-byte | must be proven equal to it all over again |
| ownership | worker canonical immediately | worker canonical immediately |
| restartability | single transaction; rerun is idempotent | already proven resumable (coverage-driven) |
| memory | **~90 MB** — an ATTACH + INSERT..SELECT | **4-5 GB today**; ~200 MB after BL-029 |
| provider | **none** | ~9,810 frames, or ~0 if the cache is hydrated — but the cache is 5.5 GB and **must not be uploaded** |
| time | **seconds** | **68 min** measured |
| parity with the gold artifact | identical by construction | identical only if nothing drifted |
| R2 propagation | the next worker snapshot carries it | same |
| rollback | replace the file (BL-030) | replace the file (BL-030) |

⭐ **A is better, and the deciding argument is not speed.** The audited artifact is the
thing 183,417 rows of evidence were gathered about — every invariant, every sentinel,
every replay. Recomputing produces a DIFFERENT object that we would then have to prove
equal to the audited one, which is strictly more work for strictly less certainty. B also
needs BL-029 fixed first, on a pod with a recorded OOM history, to avoid a 4-5 GB
resident grind on the worker.

⚠️ **B's one genuine advantage** is that it needs no channel for a 42 MB file to reach the
worker. That is the real question A has to answer, and it is the same question BL-030
answers for restore — so the two should be designed together rather than separately.

⛔ Neither is authorised yet. Both require, in order: every pod on universe-aware code ·
a working restore path · the compatibility index deliberately dropped.

---

### BL-032 · The full-suite A/B found FOUR real defects the first triage had binned as noise

The backend A/B returned **215 failures**, and the first pass through them looked for
Breadth *test files* and found one. That is the wrong question. Four of the four
defects this branch actually carried were reported by tests with no Breadth in their
name, because **the rails that judge a branch are repo-wide, not domain-local**.

| what it was | who reported it | why the first pass missed it |
|---|---|---|
| a POISONED per-symbol bars cache left behind by my own fixture | `test_breadth_daily_ohlc.py` | the *symptom* was in Breadth, the *cause* was in a different Breadth file |
| `breadth_pit_frame.py` unregistered in the corporate-action census | `test_corp_actions_census.py` | filed under "census, environmental" next to a genuinely pre-existing row |
| `BREADTH_UNIVERSE_BACKFILL_ENABLED` undeclared in the feature-flag ledger | `test_feature_flag_ledger.py` | one line in 215 |
| the schema change would **ship inert to flow-worker** | `test_flow_worker_watch_coverage.py` | one line in 215 |

⛔ **The cache one is the instructive one.** `build_breadth_bars` writes a SEALED
per-symbol series into the process-wide `_breadth_cache` and keeps it for hours. A
publication-gate case that builds `UCTA50` against an EMPTY temporary store therefore
caches an **empty series under the real symbol's key**, and the next test file to ask
for UCTA50's candles is served that emptiness instead of building its own. The fixture
cleared the two derived caches and not that one. ⭐ A fixture that cleans up only on
entry protects itself and poisons everyone after it — so it now resets **both sides**.

⚰️ **And the fourth is the one that mattered to the deploy, not to the suite.**
flow-worker RUNS `breadth_daily_ohlc`, `breadth_monitor`, `breadth_universes` and
`massive`, and watches none of them. Without a watched-file touch the schema change
reaches web and worker and **not** flow-worker — a pod left writing
`ON CONFLICT(date, metric)` against a migrated database. BL-028's compatibility index
is exactly what makes that survivable instead of fatal, which is the point: the
interlock absorbed a deployment mistake that a rail then named out loud. But *every pod
runs universe-keyed code* is a precondition of ever dropping that index, so a stranded
flow-worker would have silently blocked the next phase.

⚠️ **The honest reading of "215 failures, 2 are mine."** It was 215 failures, **four**
were mine, and the difference was not diligence — it was asking "which of these read my
diff?" instead of "which of these has my domain in its filename". The three remaining
`test_corp_actions_census.py` failures are genuinely pre-existing: they name
`api/services/wisdom/capture/families/gex.py`, which exists on `origin/master` and is
unregistered there too.

---

### BL-033 · The test was right and my first fix was wrong — and underneath it was a real six-hour black hole

⚰️ **I identified the wrong polluter, and the reason is worth writing down.** When
`test_build_breadth_bars_uses_store_for_wicks` failed in the full suite and passed
alone, I bisected by running my new Breadth test files *alongside* it and found that
`test_breadth_publication_gate.py` reproduced the failure. It did — **because I listed
it first on the command line.** In the actual suite pytest runs alphabetically, and
`test_breadth_daily_ohlc` sorts BEFORE `test_breadth_publication_gate`. My experiment
created the ordering it then discovered. The fixture fix was correct on its own merits
and it fixed nothing, which is exactly how a false positive looks from the inside.

⭐ **The real polluter is a DAEMON THREAD.** `start_breadth_warm` runs `warm_breadth()`
on a background thread that walks all 44 shipped symbols, and any test in the session
that boots the app starts it. The stack was in the log the whole time:

```
File "api/services/breadth_symbols.py", line 1031, in _loop
    warm_breadth()
```

So `breadthdaily_UCTA50` gets filled from whatever database was current when the thread
happened to run — and the test that redirects the store is then served **another
database's answer**. The series cache is keyed by SYMBOL, not by STORE.

⛔⛔ **And that exposed a production defect I introduced with BL-010.** `_refresh_series`
caches whatever it built, INCLUDING AN EMPTY SERIES, for `_SEALED_TTL` = 6 hours. An
empty build is not a sealed fact; it is a failure to read — and the web pod pulls the
breadth database from R2 at boot while the warm loop waits only **20 seconds** before
walking all 44 symbols. A slow or late pull hands it 44 empty builds.

| | before BL-010 | after BL-010 |
|---|---|---|
| where the series live | the SHARED 1,000-key cache | breadth's own 512-entry instance |
| ~156 identities in it | evicted by `/api/bars` traffic within minutes | **evicted never** |
| an empty entry | rebuilt on the next request | **held 6 h** |
| `warm_breadth`'s repair | runs, because the entry is gone | **skipped — the entry is still "fresh"** |

⚠️ **The empty entry suppressed its own repair.** That is the whole failure mode: every
breadth chart blank for up to six hours after one unlucky boot — the same incident class
as `breadth-thin-snapshot-pinning`, which this product has already paid for once.

⭐ **The dedicated cache instance is still right** — it exists so breadth cannot evict
hot `/api/bars` keys, and that reasoning is unchanged. The eviction that used to save us
was never a design; it was luck. So the fix is to stop depending on it: a real series
keeps the six-hour TTL, an empty one is retried in five minutes
(`_EMPTY_SERIES_TTL = 300`, which is ≥ the warm loop's own 90 s interval so it converges
rather than rebuilding every cycle). Bite-checked both ways: without the fix the rail
reports `21600s`, with it `300s`.

⚠️ **The lesson about the bisect is the durable one.** A cross-test pollution bisect must
preserve the ORDER the real suite uses. Re-running the suspects in a hand-written order
answers a question nobody asked.

---

### BL-034 · DARK DEPLOYED — what production actually did, measured from its own logs

Pushed `9ccb3f795` at 2026-09-16T00:52:42Z. **All four services built it**, and the one
that matters most is the one that would have been missed:

| service | previous push | this push |
|---|---|---|
| web | SUCCESS | **SUCCESS** |
| worker | SUCCESS | **SUCCESS** |
| bars-api | SUCCESS | **SUCCESS** |
| **flow-worker** | ⛔ **`SKIPPED`** | ✅ **SUCCESS** |

⭐ **flow-worker `SKIPPED` the push immediately before mine and built this one.** That is
BL-032's watch-list fix working exactly as `test_flow_worker_watch_coverage.py`
prescribed — without the `api/flow_worker_main.py` header touch, the pod that RUNS
`breadth_daily_ohlc` would have stayed on pre-migration code.

**The migration, from the pods' own logs:**

```
web    00:54:57Z  [breadth_daily_ohlc] universe migration: 174,339 rows -> universe='uct'
worker 00:56:31Z  [breadth_daily_ohlc] universe migration: 170,545 rows -> universe='uct'
```

⭐ The worker's count is **exactly** the 170,545 of the R2 snapshot the rehearsal was
built on. Web carries 3,794 more — live intraday rows accumulated since its last pull,
which is the expected difference and not a discrepancy.

**What followed on web, in order, with no breadth error on any of the four services:**

- `[startup] breadth forward seal scheduled (every 30 min, inert while dark)` — and it
  has logged **nothing** since, which is the correct output for a dark universe
- `[breadth-ohlc] boot pull: already current` — the R2 puller works against a migrated DB
- `[dashboard-warm] breadth ok` · `breadth-live ok`
- `[breadth_symbols] warm pass done: {'refreshed': 44, 'fresh': 0}` then
  `{'refreshed': 1, 'fresh': 43}` — **all 44 shipped UCT series rebuilt after the
  migration, then converged**, which is the member-visible serve path answering

**The worker is running universe-keyed code**, from its own tick:
`{'ok': True, 'universe': 'uct', ... 'rows': 0, 'status': 'done'}`.

**US darkness, on the live production API:**

```
GET /api/bars/UCTA50  -> 401 {"detail":"Not authenticated"}      (member-gated, as always)
GET /api/bars/US:A50  -> 200 {"bars":[],"no_data":true,"reason":"symbol_not_carried"}
```

⚠️ **ONE CHECK IS HONESTLY PENDING, AND IT IS NOT A TEST FAILURE.** §11's worker→R2→web
round trip cannot be demonstrated yet, because the worker uploads breadth to R2 **only
after a backfill tick that WROTE rows** — and the backfill is complete (`rows: 0`,
`status: 'done'`). So R2 still holds the pre-migration `1789472774`. Consequences, stated
rather than glossed:

- ⭐ it is **safe**: web's puller gap-fill-merges a snapshot with no `universe` column as
  the literal `'uct'`, which CASE 2 of the rolling-deploy audit proved and
  `boot pull: already current` confirms in production;
- ⭐ it is **good for rollback** — the R2 artifact IS the pre-migration rollback copy, and
  it is still exactly that;
- ⛔ but it means the **compatibility index has only INDIRECT confirmation in production**.
  `_ensure_compat_index` runs inside the same `_ensure_init` that logged the migration and
  emits a WARNING on failure; no such warning appeared on any of the four services. That
  is strong evidence, not proof. Positive proof arrives with the next worker snapshot.

⛔ **Not done, and not authorised in this session:** US ingest, dropping the compatibility
index, publishing any universe, arming `BREADTH_UNIVERSE_BACKFILL_ENABLED`.

---

### BL-035 · Phase B — the restore path, the interlock removal, and US stored dark

**The sequencing gate held.** A–D green before anything was dropped; the interlock
refused the import until it was deliberately removed, and said so by name.

#### The restore path does NOT replace the file, and that is the decision

`data_sync.download_snapshot()` installs bars.db with `shutil.move`, and its own comment
carries the scar: an earlier version also removed the stale `-wal`/`-shm` sidecars, and
writers mid-transaction got **"disk I/O error"**. It now leaves them and accepts the
opposite risk — a stale WAL beside a fresh main file reading as *"disk image is
malformed"* — caught by `integrity_ok()` at boot.

⚠️ **That trade is right for bars and wrong for breadth**, and the reason was measured
rather than inherited. `breadth_daily_ohlc._conn()` opens a NEW connection per call and
closes it — no pool, no thread-local, no epoch to bump (the deep reader says so itself:
*"rf_conn_reused is therefore always 0 today"*) — and the module's one long-lived handle,
`_PROBE`, sits behind a flag unset on every production service.

⭐ So breadth has **no stale-inode problem to solve** and nothing to gain from moving a
file, while still paying the full sidecar hazard. It replaces the CONTENT in ONE
transaction on the live inode: `BEGIN IMMEDIATE → DELETE → INSERT..SELECT → COMMIT`. The
sidecar hazard is not mitigated, it is **absent**; WAL gives readers snapshot isolation so
no torn view is possible; any failure rolls back. `test_b_the_live_inode_is_the_SAME_FILE`
pins it so nobody "simplifies" it into a move.

**Proven on the real artifact** (`1789472774`, sha256 `5518974638daef7b…`): 15/15 —
identity, pre-migration recognition, integrity, 170,545 rows, fingerprint back to
`c7578ff928440901…`, interlock reinstated, current code boots in 1 ms, `journal_mode=wal`,
both sidecars intact, a second universe blocked again, idempotent.

⭐ `reinstate_compat_index()` is the deliberate counterpart to `drop_compat_index()`. A
rollback leaving the store UCT-only but the interlock absent lands **strictly worse** than
it started — old code still cannot write, and the next stray non-UCT write is unguarded.
Teaching init to infer it would silently undo a deliberate drop on the next pod restart.

#### ⚰️ The rollback artifact had a life expectancy of two uploads

`breadth_ohlc_sync._KEEP = 5` prunes `snap/`, and the worker uploads on every wick-sweep
completion — i.e. every boot. `1789472774` was already 3rd-newest. **A rollback target
that expires on a timer nobody set is not a rollback target.** It is now copied to
`breadth_ohlc/rollback/`, a prefix the pruner does not scan, and `stage_from_r2` takes an
explicit `key` so the supported path can reach it. Verified restorable from there.

#### The one-way door, twice

| | |
|---|---|
| worker interlock dropped | **2026-09-16T02:02:50Z** |
| web interlock dropped | **2026-09-16T02:04:47Z** |

Both verified: index absent, `PRIMARY KEY (universe, date, metric)` intact, table DDL
byte-unchanged, and `ON CONFLICT(date, metric)` now **fails to prepare**
(`OperationalError: ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE
constraint`) while `ON CONFLICT(universe, date, metric)` prepares.

⛔ **Old-code write rollback is no longer valid.** The rollback path is now
*restore a known snapshot → current code initialises it*, not *revert the code*.

⚠️ **Web had to be opened too, and the design said so first.** `_merge_from` refuses a
snapshot carrying a second universe while the index stands — fail-closed at the other
door — so web could not have consumed the US snapshot silently.

#### The import

183,417 rows in **5.22 s**, RSS peak **28 MB**. BL-029's multi-GB frame cache is a GRIND
concern; an `ATTACH` + `INSERT..SELECT` is not one. UCT fingerprint
`c7578ff928440901…` identical either side, 170,545 rows. Re-import inserted **0**.

⚰️ **A dead rail, caught before it shipped.** The idiomatic NaN test `c != c` can NEVER
match in SQLite, which has no NaN — it stores one as NULL (`typeof(x)` → `'null'`). That
clause would have looked like a guard, passed every test, and checked nothing. **Infinity**
is what survives as a REAL, and the magnitude bound catches it.

#### Stored ≠ published, measured

All 18 V1 US identities: `resolve → None`, `is_published → False`, **0 bars**. 21 stored
non-V1 metrics, none published; McClellan not revived by rows existing. Payload still
byte-identical to the legacy 44. `library_health`: US `state=available`, `rows=183417`,
`published=False`, `metrics_published=0`, overall `ok=True`.

Data sanity: percentages within [0,100]; `universe_count` 2,069–4,102; `adv_decline`
signed −3,303…+3,128; `net_new_high_low` signed −1,905…+843 — and its three deepest
sessions are **2020-03-12, 03-16, 03-18**, which is the COVID crash showing up in the
numbers rather than in a comment.

Round trip with US present: snapshot `1789524296` (**14.9 MB**, up from 8.5 — BL-027
predicted the roughly-doubled artifact), web merged it in under two minutes, and web now
holds `uct 174,339 + us 183,417` with its own UCT fingerprint `6276006d94c2e13b…`
unchanged.
