"""Per-column universe distribution — p5/p25/p50/p75/p95 over ``screener_rows``,
with the coverage that produced them travelling beside every number.

⛔⛔ THESE ARE DESCRIPTIVE. THEY ARE NEVER A RECOMMENDATION, AND THE NEXT READER
WILL ASSUME OTHERWISE, SO READ THIS PARAGRAPH BEFORE TOUCHING ANYTHING BELOW.

`filters._open_range` ships 81 of our 147 controls with no presets at all, on a
rule that is right and stays right: *a threshold nobody at the firm publishes
must not ship wearing the firm's name.* A preset is an EDITORIAL CLAIM — "P/E:
Cheap (under 15)" asserts that this firm considers 15 cheap.

A measured percentile asserts nothing of the kind. `p50(price) = 24.71` is a
fact about the rows we hold tonight, in the same family as the DISTINCT sector
list `filters._distinct_options` already reads off the artifact. It is citable
by construction because we measured it, which is exactly what E-8's grounding
rule asks for and exactly what a blank box does not give a member.

So this module measures the data and fills NO editorial gap:

  * ⛔ `presets_deferred` STAYS TRUE on every control that carries one. A band
    is not a preset, does not become one, and must never be rendered as one.
  * ⛔ A band carries NO `label`, `op`, `min`, `max` or `value` key — the five
    keys a preset carries. That is structural, not stylistic: a payload that
    cannot be shaped like a preset cannot be mistaken for one by a panel, a
    future refactor, or a reader in a hurry.
    `tests/test_screener_distribution.py` rails it.
  * The member-facing word is "typical range", never "recommended", "good",
    "reasonable" or "ideal". `BASIS_NOTE` below is the ONE string that says so
    and the surface should render it rather than write its own.

⭐ WHY THE COVERAGE IS NOT OPTIONAL. A percentile over a column that is 95%
NULL is a lie the shape of a fact: it describes whoever answered, presented as
if it described the universe. So every entry carries `non_null` and `universe`
whether a band was emitted or not, and a band is REFUSED below two stated
floors — see `MIN_NON_NULL` and `MIN_COVERAGE`. A refusal says which floor it
hit; it never silently omits the column, because "we hold nothing here" is a
fact a member is entitled to (the `CoverageLine` idiom: a gap in what we hold
is not a quiet market).

⭐ WHY IT IS CACHED THE WAY IT IS. Measured on a 3,714-row snapshot (this box,
2026-08-23): the one-pass compute over 102 numeric columns costs ~55 ms, and the
freshness fingerprint that decides whether to reuse it costs ~2 ms. `meta()` is
on the request path, so 55 ms per call is not payable and 2 ms is. The cache key
IS the fingerprint (db path + row count + newest `built_at` + newest
`snapshot_date`), so a nightly rebuild invalidates it by construction — there is
no hook to forget to call and no TTL window during which the panel quotes last
night's universe over tonight's rows. The TTL is a backstop, not the mechanism.
"""
import math
import sqlite3
from contextlib import closing

from api.services.cache import TTLCache

#: The five points. Nearest-rank over the sorted non-null values, so every
#: number returned is a value some symbol actually has — an interpolated
#: percentile would print a price no stock trades at, which is a worse thing to
#: show under the word "typical" than a slightly coarser rank.
#: ⚠️ This is THIS module's convention for numeric columns. It is deliberately
#: not "the same statistic" as `snapshot_db.describe_rows`'s representative
#: snapshot DATE — different quantity, different column, no shared authority.
PERCENTILES = (5, 25, 50, 75, 95)

#: 🔴 FLOOR ONE — a band needs enough values to BE a distribution.
#: At n = 100 the p5 and p95 each sit on the fifth value in from an end. Below
#: that the tails are one or two symbols and "typical range" is describing a
#: handful of names. This is the floor that stops "a band over three rows".
MIN_NON_NULL = 100

#: 🔴 FLOOR TWO — a STRICT MAJORITY of the universe must have answered.
#: Not a tuned number: below one half, the median of the answered rows is simply
#: not the median of the universe, and no caption repairs that. Provider-gated
#: columns are the case that matters — `dp_notional_1d` is non-null on the 13%
#: of names that printed a dark-pool block, and the "typical" block size among
#: names that had one says nothing about the universe a member is screening.
#: Measured on this box's snapshot: 42 of 102 numeric range columns clear it,
#: 55 are refused (50 of those hold no data at all) and the rest fall between.
MIN_COVERAGE = 0.50

#: Backstop only — the fingerprint below is what actually keeps a band fresh.
#: Six hours over a snapshot that rebuilds nightly means a band is never quoted
#: from a vintage the fingerprint has already retired.
CACHE_TTL_SECONDS = 6 * 3600

#: ⭐ A DEDICATED INSTANCE, WITH ITS OWN STATED BOUND. `api.services.cache.cache`
#: is the shared 1,000-entry LRU that bars payloads churn ~60 keys at a time
#: through; a key evicted from it costs a 55 ms recompute on a request. This
#: cache's working set is a known quantity — one entry per snapshot vintage —
#: which is exactly the case `TTLCache.__init__` documents an explicit bound for.
_CACHE = TTLCache(max_size=4)

#: The refusal reasons, named so a surface can say WHICH floor it hit rather
#: than rendering an unexplained blank.
REFUSED_NO_DATA = "no_data"                    # not one non-null value
REFUSED_NOT_NUMERIC = "not_numeric"            # values present, none numeric
REFUSED_BINARY = "binary"                      # only 0/1 observed — a flag
REFUSED_MIN_NON_NULL = "below_min_non_null"
REFUSED_COVERAGE = "below_coverage_floor"

#: ⛔ THE ONE MEMBER-FACING SENTENCE, so a surface renders it instead of
#: inventing a caption. Every word is load-bearing: it names what was measured,
#: names the population, and says what it is NOT.
BASIS_LABEL = "Typical range"
BASIS_NOTE = (
    "Measured across our own snapshot — the 5th, 25th, 50th, 75th and 95th "
    "percentile of the symbols that carry a value for this field. It describes "
    "what the data looks like. It is not a threshold this firm recommends."
)

#: Columns that describe the BUILD rather than a symbol. A p50 of `built_at` is
#: an epoch second; it is a number and it is not a distribution of anything a
#: member screens on. (`snapshot_date`/`bars_asof` are TEXT and never reach the
#: numeric gate at all, so only this one needs naming.)
_NOT_A_MEASUREMENT = {"built_at"}


def _numeric_columns(conn) -> list:
    """Numeric columns the LIVE table actually has, in `COLUMNS` order.

    ⛔ READ OFF THE ARTIFACT (`PRAGMA table_info`), never off a typed list and
    never off `snapshot_db._TEXT`/`_INT`. A pod whose `screener_rows` predates a
    wave is missing columns until `init_db()` ALTERs them in — measured on this
    box, seven of the registry's range columns were absent from the table
    entirely. Asking the schema is the only way to be right on both boxes.

    Intersected with `snapshot_db.COLUMNS` so a stray column left by an old
    migration cannot leak into a member-facing payload.
    """
    from api.services.screener import snapshot_db

    declared = {}
    for row in conn.execute("PRAGMA table_info(screener_rows)"):
        declared[row[1]] = (row[2] or "").upper()
    # Walking `COLUMNS` (not the PRAGMA) is the intersection: a column the
    # registry does not know about is never asked for.
    return [c for c in snapshot_db.COLUMNS
            if c not in _NOT_A_MEASUREMENT
            and declared.get(c) in ("INTEGER", "REAL")]


def _usable(value):
    """`True` for a value a percentile may be taken over.

    ⚠️ SQLite is dynamically typed: a REAL-declared column can hold text. That
    is not hypothetical here — `accdis` held letter grades in a REAL-declared
    column since v1 (`snapshot_db._TEXT`'s own comment says so), and sorting a
    mixed list of `str` and `float` raises in Python 3. A non-numeric value is
    counted as one we cannot use, and a column with values but none usable is
    refused as `not_numeric` rather than reported as empty — "there is nothing
    here" and "what is here is not a number" are different facts.
    """
    if value is None or isinstance(value, bool):
        return False
    if not isinstance(value, (int, float)):
        return False
    return math.isfinite(value)


def _nearest_rank(sorted_values, pct):
    """The value at the nearest rank for `pct`, 1-based, clamped.

    `ceil(pct/100 * n)` is the classic nearest-rank definition: over 1…100 it
    returns exactly `pct`, and it can only ever return a value present in the
    list.
    """
    n = len(sorted_values)
    idx = math.ceil((pct / 100.0) * n) - 1
    return sorted_values[min(max(idx, 0), n - 1)]


def _band(values, universe):
    """One column's entry. Coverage ALWAYS; percentiles only when both floors
    clear. Never both a `refused` key and a percentile key."""
    seen_non_null, usable = values
    n = len(usable)
    base = {"non_null": n, "universe": universe}

    if n == 0:
        base["refused"] = (REFUSED_NOT_NUMERIC if seen_non_null
                           else REFUSED_NO_DATA)
        return base
    if n < MIN_NON_NULL:
        base["refused"] = REFUSED_MIN_NON_NULL
        return base
    if universe <= 0 or (n / universe) < MIN_COVERAGE:
        base["refused"] = REFUSED_COVERAGE
        return base
    # A flag stored 0/1 has no distribution worth printing. Derived from the
    # VALUES, not from a list of flag columns — a typed list would be a second
    # authority over which columns are flags and would go stale on the next one.
    distinct = set(usable)
    if distinct <= {0, 1}:
        base["refused"] = REFUSED_BINARY
        return base

    usable.sort()
    for pct in PERCENTILES:
        base[f"p{pct}"] = _nearest_rank(usable, pct)
    return base


def compute(conn) -> dict:
    """`{"basis": {...}, "columns": {column: band}}` — ONE pass, no cache.

    ⭐ ONE table scan for every column, not one query per column. Measured on
    3,714 rows × 102 columns: ~55 ms this way, ~218 ms as one ordered scan per
    column, ~774 ms as five `LIMIT 1 OFFSET n` probes per column. The last of
    those is the shape a reader reaches for first, and it is 14× the cost.
    """
    from api.services.screener import snapshot_db

    columns = _numeric_columns(conn)
    universe = conn.execute("SELECT COUNT(*) FROM screener_rows").fetchone()[0]
    provenance = snapshot_db.describe_rows(conn)

    seen = [0] * len(columns)
    buckets = [[] for _ in columns]
    if columns:
        select = ", ".join(f'"{c}"' for c in columns)
        for row in conn.execute(f"SELECT {select} FROM screener_rows"):
            for i, value in enumerate(row):
                if value is None:
                    continue
                seen[i] += 1
                if _usable(value):
                    buckets[i].append(value)

    return {
        "basis": {
            "label": BASIS_LABEL,
            "note": BASIS_NOTE,
            "percentiles": list(PERCENTILES),
            "min_non_null": MIN_NON_NULL,
            "coverage_floor": MIN_COVERAGE,
            "universe": universe,
            # The representative row's date, from the ONE authority on that
            # question — never `MAX(snapshot_date)`, which on this box once
            # labelled 3,583 month-old rows "today".
            "snapshot_date": provenance.get("snapshot_date"),
            "mixed_snapshot": provenance.get("mixed"),
            # ⛔ Stated in the payload, not only in this file: whatever renders
            # a band is entitled to know the firm is not recommending it.
            "descriptive_only": True,
        },
        "columns": {c: _band((seen[i], buckets[i]), universe)
                    for i, c in enumerate(columns)},
    }


def _fingerprint(conn, path) -> str:
    """What makes one cached compute reusable. ~2 ms measured.

    The DB PATH is in the key on purpose: a per-test sandbox and production are
    different files that can trivially agree on row count and timestamps, and a
    cache that confuses them would hand one snapshot's bands to the other.
    """
    row = conn.execute(
        "SELECT COUNT(*), MAX(built_at), MAX(snapshot_date) FROM screener_rows"
    ).fetchone()
    return f"v1|{path}|{row[0]}|{row[1]}|{row[2]}"


def distributions() -> dict:
    """The cached `{"basis", "columns"}` blob. NEVER raises.

    An unreadable snapshot costs the panel its bands, never the whole `meta()`
    payload — the same honest-absence contract `_distinct_options` and
    `_my_scans_entry` already hold in `filters.py`.
    """
    from api.services.screener import snapshot_db

    try:
        path = snapshot_db.get_db_path()
        with closing(snapshot_db.connect()) as conn:
            key = _fingerprint(conn, path)
            hit = _CACHE.get(key)
            if hit is not None:
                return hit
            out = compute(conn)
        _CACHE.set(key, out, CACHE_TTL_SECONDS)
        return out
    except (sqlite3.Error, OSError, ValueError, TypeError, KeyError):
        return {"basis": None, "columns": {}}


def invalidate() -> None:
    """Drop every cached vintage. For tests and for an operator who has just
    rewritten the snapshot out of band."""
    _CACHE.clear()
