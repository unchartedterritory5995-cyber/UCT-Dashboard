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
