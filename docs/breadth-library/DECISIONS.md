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
