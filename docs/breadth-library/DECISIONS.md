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

### BL-008 · `TICKER_SHAPE` (the formula lane) stays refused — OPEN QUESTION

`sym:NASDAQ:A50:close` is unambiguous because `sym:` **delimits** the symbol. A
bare formula ticker has no delimiter, and there `NASDAQ:A50` (an identity we mint)
and `NASDAQ:AAPL` (a venue prefix on a third-party instrument) are
**indistinguishable by shape**.

The existing refusal exists because a venue-prefixed symbol saves and then charts
as all-NaN, and the roster gate that would catch it (`scan_definition.
assert_scannable`) covers **scans only** — its own comment says "charting against
any symbol still works on the Formula tab".

**Needs an owner decision:** a distinct marker for breadth identities, or an
accepted reliance on the roster. Until then the formula lane is unchanged.
Recorded in `namespacedSymbol.test.js`.
