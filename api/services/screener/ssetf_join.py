"""Single-stock-ETF join — the leveraged-retail crowding read, from the
`single_stock_etfs.db::etfs` table read BACKWARDS.

`context_joins.read_etf_flags` already opens this store every night and runs
`SELECT etf_ticker FROM etfs` — it asks *"is this ticker itself a leveraged
ETF?"* and answers the `is_leveraged` column. This module asks the opposite
question of the same table: **how hard is the leveraged-retail complex leaning
on this name?** It groups by `underlying`, so its subject is the OPERATING
COMPANY a fund tracks, never the fund. The two readers share a store and
share no column; see "What this module deliberately does not answer" below.

ONE bulk read per build (the `pattern_join` shape: read once, group in
Python). The table is small — a few hundred rows against a ~3,700-name target
list — so a per-ticker query would be ~3,700 scans to save reading a few
hundred rows, and passing the whole target list as SQL placeholders would be
worse than reading the table. The read is unfiltered and the grouping happens
here.

⛔⛔ **THIS READER EMITS A MEASURED ZERO, AND THAT IS A DELIBERATE DEPARTURE
FROM THE HOUSE HONEST-NONE RULE. READ THIS BEFORE COPYING IT.**

Every other reader in this package omits a key it cannot answer, because
absence of a row means *we did not look* or *we could not tell*. Here it does
not. `etfs` is a **census**: each nightly rebuild parses the whole-market
Finviz export, identifies every fund it can attach to a single underlying, and
swaps the table atomically. A ticker missing from the `underlying` column of a
freshly-written table is not an unanswered question — it is the census
answering *no single-stock ETF tracks this name*, which is the true state of
roughly 94% of the universe (measured 2026-08-23: 228 of 3,742 `cap_universe`
tickers appear as an `underlying`). Omitting the key there would make the
column NULL on 94% of rows and unfilterable — a member could never ask for
*names with no leveraged complex*, and `ssetf_count >= 1` would be the only
answerable question about a fact we measured completely.

**But an inference from silence is only as current as the enumeration**, and
that asymmetry is the entire freshness contract below:

* A **positive** count is an OBSERVATION. `TSLA` had ten tracking ETFs when
  the census was written; if the census is a week old that is a week-old
  observation, degraded but still a thing someone saw.
* A **zero** is an INFERENCE FROM SILENCE. It only holds while the
  enumeration is current. Off a stale table it is not a degraded measurement,
  it is a claim about today made from a census that stopped looking.

So this reader has exactly one behavioural switch, and the zeros are what it
protects:

* **Census current** (newest `updated_at` within `_STALE_DAYS`, table at or
  above `_MIN_ROWS`) — full census mode. Every target gets `ssetf_count` and
  `ssetf_has_inverse`; uncovered names get a real, measured `0`.
* **Census stale, or its age unknowable** — POSITIVE-ONLY mode. Tickers WITH
  a family still get their columns (a stale observation, counted as
  `stale:Nd`); every uncovered ticker is ABSENT from the output entirely, so
  its columns read NULL. The reader stops claiming absences it can no longer
  support. This is not belt-and-braces: measured on this dev box 2026-08-23
  the store's newest `updated_at` was **2026-08-04, nineteen days old**, with
  `meta.last_status = "fetch_empty"` — the nightly had been failing silently
  the whole time while the table sat there looking populated. Without this
  switch today's build would have shipped ~3,500 confident nineteen-day-old
  zeros. (⚠️ The 2026-08-23 discovery census recorded this store as "Fresh
  2026-08-21". It was reading the file's mtime; the ROWS said 08-04. Read
  `MAX(updated_at)`, never a sidecar.)
* **Table short** (below `_MIN_ROWS`) — `{}`. A handful of rows is a broken
  rebuild, not a market with a handful of single-stock ETFs, and the write
  itself is then suspect (unlike staleness, where the write was good and
  merely old). Mirrors `opt_flow`'s `_MIN_TICKERS` refusal.
* **Store missing / table missing / read raises** — `{}` + counted, like
  every reader here.

Freshness is read from `MAX(updated_at)` **in the `etfs` table itself** — the
artifact — never from `meta.last_success_at`. The meta key is a sidecar the
rebuild stamps, and a health check that reads a counter instead of the thing
it describes is how a total failure reports green.

**`ssetf_max_factor` keeps the honest-None rule even in census mode**, and the
distinction is worth stating because it is the seam where the two rules meet:
`ssetf_count` is a COUNT OF AN EMPTY SET, which is legitimately zero;
`ssetf_max_factor` is a MAXIMUM OVER AN EMPTY SET, which is undefined. A `0.0`
there would sort below every 1.0x fund and read as "tracked by an unleveraged
ETF", a fact about a fund that does not exist. Same for `ssetf_adv_usd`, which
is additionally omitted for any family where even ONE row's `avg_dollar_vol`
is unusable — a sum over partial data understates crowding silently, and
understating is the direction that hides risk.

**Factor is a MAGNITUDE, not a signed multiplier** (store-verified: an inverse
fund is `direction='short'` with a positive `factor`, e.g. a -2x is
`('short', 2.0)`), so `ssetf_max_factor` is the largest absolute leverage in
the family regardless of side, and the side lives in `ssetf_has_inverse`.

**What this module deliberately does not answer**, because another module owns
it and a second authority over one value is this repo's most repeated defect:

* `is_leveraged` — `context_joins.read_etf_flags` owns it, off `etf_ticker`
  membership in this same table. This module never reads `etf_ticker`.
* `is_etf` — `context_joins.read_etf_flags` owns it, off `industry_map`.
* Anything about a fund's own price, name or listing. This module's subject is
  the underlying; the fund side is not its business.

Failure contract: a dead/short/unreadable store returns `{}` (all four columns
not-computable on every row) plus a `_note(failures, "ssetf_join", ...)`
census entry. Degradations — staleness, malformed rows, families dropped for
partial dollar-volume — are SERVED and COUNTED, never swallowed: an uncounted
degradation is indistinguishable from an empty answer. Nothing here raises
into the build.

⚠️ Every column below is written as a DICT LITERAL / literal subscript-assign
keyed by the exact snapshot column name, never a dynamically-built mapping —
the scalar-population rail derives writers by AST over those two shapes and a
runtime-built mapping is an invisible collector (`context_joins`' module
docstring states the rule).
"""
from __future__ import annotations

import contextlib
import os
import pathlib
import sqlite3
import time

# ── contract ─────────────────────────────────────────────────────────────

#: Below this many usable rows the table is a failed rebuild, not a small
#: market: the rebuild refuses to write a table that shrank past 60% of the
#: previous one (`single_stock_etfs._SHRINK_FLOOR`), so anything that survived
#: a write is a full census or nothing. This floor sits far under that refusal
#: and far over noise. Same role as `opt_flow._MIN_TICKERS`, and here it is
#: load-bearing for a second reason: it is what stops a truncated census from
#: emitting confident zeros for the names it lost.
_MIN_ROWS = 50

#: Derived from the writer's own cadence, not chosen: the rebuild cron is
#: WEEKDAYS 20:30 ET (`ssetf_nightly_rebuild`) and the snapshot build runs
#: 03:00 ET, so the largest healthy age at read time is Friday's write seen by
#: Monday's build, ~2.3 days. `4` therefore tolerates the weekend gap plus one
#: missed run; beyond it at least two consecutive nightlies have failed, and
#: the census has stopped being evidence of absence.
_STALE_DAYS = 4

_TABLE = "etfs"


def _note(failures, source, outcome) -> None:
    if failures is None:
        return
    key = outcome if isinstance(outcome, str) else type(outcome).__name__
    failures.setdefault(source, {})
    failures[source][key] = failures[source].get(key, 0) + 1


def _db_path() -> str:
    """The store's path, from the module that OWNS the store.

    Never re-derives `SSETF_DB_PATH`/`/data` here: the resolution rule has one
    owner (`single_stock_etfs._resolve_db_path`) and restating it would put a
    second authority on which file this reader is even talking about. If that
    private seam is ever renamed this raises, the read degrades to `{}` and
    the failure is COUNTED — a loud absence, not a silent wrong file.
    """
    from api.services import single_stock_etfs
    return single_stock_etfs._db_path()


def _ro_uri(path: str) -> str:
    """`file:` URI for a strictly read-only open, Windows paths included.

    `Path.as_uri()` handles the drive-letter and percent-encoding cases a
    hand-built `"file:" + path` gets wrong on this box.
    """
    return pathlib.Path(os.path.abspath(path)).as_uri() + "?mode=ro"


def _connect_ro(path: str) -> sqlite3.Connection:
    """Read-only connection. `mode=ro` raises rather than creating a database
    if the file is absent, which is the answer we want: a missing store is a
    counted failure, never an empty table this reader would read as "no ETF
    tracks anything" and turn into 3,700 zeros."""
    conn = sqlite3.connect(_ro_uri(path), uri=True, timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn


def _pos_number(v):
    """A usable positive magnitude, or None. A string that happens to parse is
    accepted (SQLite is dynamically typed and this column is REAL by
    declaration only); anything else — None, bool, junk text, <= 0 — is
    malformed and must not silently become a number."""
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")) or f <= 0:
        return None
    return f


def _non_negative_number(v):
    """Like `_pos_number` but zero is legitimate (a fund really can have no
    measurable dollar volume on a given day)."""
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")) or f < 0:
        return None
    return f


def _epoch(v):
    """`updated_at` as an int epoch, or None when it cannot be read as one."""
    if v is None or isinstance(v, bool):
        return None
    try:
        i = int(v)
    except (TypeError, ValueError):
        return None
    return i if i > 0 else None


# ── the entry point ──────────────────────────────────────────────────────

def read_ssetf_fields(targets, failures=None) -> dict:
    """`{TICKER: {ssetf_count, ssetf_has_inverse, ssetf_max_factor,
    ssetf_adv_usd}}` — the leveraged-retail complex leaning on each name.

    One bulk read of `etfs`, grouped by `underlying` in Python. See the module
    docstring for the census-vs-silence rule that decides whether an uncovered
    ticker gets a measured `0` or no key at all; it is the only non-obvious
    thing in here and it is not optional.
    """
    try:
        path = _db_path()
        with contextlib.closing(_connect_ro(path)) as conn:
            rows = conn.execute(
                f"SELECT underlying, direction, factor, avg_dollar_vol, "
                f"updated_at FROM {_TABLE}"
            ).fetchall()
    except Exception as e:                                     # noqa: BLE001
        _note(failures, "ssetf_join", e)
        return {}

    if not rows:
        # An empty table and a dead store are the same answer here: this
        # reader must never read "no rows" as "nothing is tracked".
        _note(failures, "ssetf_join", "empty")
        return {}

    # ── group by underlying, counting every malformity ───────────────────
    families: dict = {}
    newest = None
    malformed_underlying = 0
    malformed_direction = 0
    malformed_factor = 0
    usable_rows = 0

    for r in rows:
        raw_u = r["underlying"]
        und = str(raw_u).strip().upper() if raw_u is not None else ""
        if not und:
            # A row with no underlying belongs to no family — it cannot be
            # counted for anybody, and dropping it silently would shrink a
            # family's count with no trace.
            malformed_underlying += 1
            continue
        usable_rows += 1

        fam = families.get(und)
        if fam is None:
            fam = families[und] = {"n": 0, "n_short": 0, "max_factor": None,
                                   "adv_total": 0.0, "adv_ok": True}
        fam["n"] += 1

        direction = str(r["direction"] or "").strip().lower()
        if direction == "short":
            fam["n_short"] += 1
        elif direction != "long":
            # The fund exists and counts toward `ssetf_count`; we just cannot
            # say which side it is, so it never votes for `has_inverse`.
            malformed_direction += 1

        factor = _pos_number(r["factor"])
        if factor is None:
            malformed_factor += 1
        elif fam["max_factor"] is None or factor > fam["max_factor"]:
            fam["max_factor"] = factor

        adv = _non_negative_number(r["avg_dollar_vol"])
        if adv is None:
            # ONE unusable row poisons the family's sum: a partial total
            # understates crowding and understating hides risk.
            fam["adv_ok"] = False
        else:
            fam["adv_total"] += adv

        ts = _epoch(r["updated_at"])
        if ts is not None and (newest is None or ts > newest):
            newest = ts

    if malformed_underlying:
        _note(failures, "ssetf_join", f"malformed_underlying:{malformed_underlying}")
    if malformed_direction:
        _note(failures, "ssetf_join", f"malformed_direction:{malformed_direction}")
    if malformed_factor:
        _note(failures, "ssetf_join", f"malformed_factor:{malformed_factor}")

    # ── the floor: a truncated census may not speak for the names it lost ─
    if usable_rows < _MIN_ROWS:
        _note(failures, "ssetf_join", f"below_floor:{usable_rows}")
        return {}

    # ── the switch: may this census's SILENCE be read as a measurement? ───
    if newest is None:
        # Nothing in the table carries a readable timestamp, so its age is
        # unknowable — and an inference from silence needs a known age.
        census_current = False
        _note(failures, "ssetf_join", "age_unknown")
    else:
        age_days = int((time.time() - newest) // 86400)
        census_current = age_days <= _STALE_DAYS
        if not census_current:
            _note(failures, "ssetf_join", f"stale:{age_days}d")

    adv_partial: set = set()   # tickers, so a duplicated target can't inflate it
    out: dict = {}
    for t in (targets or ()):
        tu = str(t or "").strip().upper()
        if not tu:
            continue
        fam = families.get(tu)

        if fam is None:
            if not census_current:
                # Positive-only mode: no key at all, so both columns read NULL
                # rather than asserting an absence off a census that has
                # stopped looking.
                continue
            # Census mode: a measured zero. The enumeration is current and it
            # does not contain this name.
            out[tu] = {"ssetf_count": 0, "ssetf_has_inverse": 0}
            continue

        # A family present in the table is a positive observation and is
        # served in both modes.
        row = {"ssetf_count": fam["n"],
               "ssetf_has_inverse": 1 if fam["n_short"] else 0}
        if fam["max_factor"] is not None:
            # Absent when every row's factor was unreadable: a maximum over an
            # empty set is undefined, never 0.0.
            row["ssetf_max_factor"] = fam["max_factor"]
        if fam["adv_ok"]:
            row["ssetf_adv_usd"] = fam["adv_total"]
        else:
            adv_partial.add(tu)
        out[tu] = row

    if adv_partial:
        _note(failures, "ssetf_join", f"adv_partial:{len(adv_partial)}")
    return out
