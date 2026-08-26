"""Where a screen's answers live, and the receipt that says the screen RAN.

⭐ TWO TABLES, IN ``screener.db``, BESIDE THE ROWS THEY CERTIFY.

``scan_hits`` holds ONLY the symbols a definition matched. ``scan_coverage``
holds one receipt per evaluation: how many symbols were looked at, how many were
answered, how many were dropped and why, and when the sweep ran.

🔴 THE SECOND TABLE IS THE WHOLE POINT, AND IT EXISTS BECAUSE OF A MEASURED BUG.
``scan_volume._job`` sets ``m = {}`` when its reference build fails, so *"a
failed reference is indistinguishable from an empty market"*. At screener scale
that is a screen silently dropping 800 symbols, returning fewer hits, and looking
like a quiet market — and a trader would act on it. With the receipt there are
exactly three readings and no fourth:

    coverage(...) is None                     the sweep never ran
    coverage(...) and hits(...) == []         it ran; the market was quiet
    coverage(...) and hits(...) == [...]      it ran; here are the matches

⛔ ``scan_hits`` IS HITS-ONLY, AND THE ZERO IS NOT LOST — IT MOVES INTO THE
RECEIPT. ``registry_defs.event_columns`` is right that *"0 is 'computed, did not
happen' and is the whole point"*, so the 0 must be RECOVERABLE: a ticker inside
``scan_coverage``'s window and absent from ``scan_hits`` IS a computed 0. What a
dense table would add is not information, it is bytes — and the bytes are
measured, next door and here:

===========================================  ==============  ==================
artifact                                     bytes/row       a year at 10k defs
===========================================  ==============  ==================
``alert_shadow_fires`` (GT §3.5, the         53.0            279 GB
counter-example the design forbids
building on)
``scan_hits`` table alone                    91.1            —
``scan_hits`` + ``idx_scan_hits_ticker``     182.3           —
  … dense, one row per evaluated symbol      182.3           **1,717 GB**
  … hits-only at a 2% hit rate               182.3           **34 GB**
``scan_coverage`` (with a 41-symbol          4,194           **10.6 GB**
``dropped_json``)
===========================================  ==============  ==================

Measured 2026-08-09 on this box: 250,000 rows written to a freshly-created file,
``VACUUM``ed, differenced against the empty schema. ⚠️ EXACTLY HALF OF
``scan_hits``' cost is the secondary index, and the 71-character ``def_hash``
repeats in every row — so a hit row here is **3.4× heavier** than an
``alert_shadow_fires`` row, which makes ``prune`` MORE load-bearing than it was
there, not less.

⛔ SO ``prune`` SHIPS IN THIS FILE, NOT LATER. GT §3.5's verdict on
``alert_shadow_fires`` is *"do not build a screener history on this table's
current shape"*, and what made that table dangerous was never its width — it was
shipping without a prune and growing for a year before anybody measured it.

⭐ AND IT IS ONE FILE WITH ``screener_rows``, DELIBERATELY. E-A4 says the results
are *joined* to ``screener_rows``; a cross-database join needs ``ATTACH``, which
``snapshot_db.connect()`` does not do and which ``query.run_scan`` — one SQL
string against one connection — has nowhere to put. It is also the
``signature_coverage`` precedent exactly: ``ledger.py`` keeps its receipt in the
same FILE as the signals it certifies, *"so a receipt cannot outlive the signals
it certifies"*. A scan hit cannot outlive the screener row it joins to, for the
same reason.

⛔ ``screener_rows`` IS UNTOUCHED — its 65 columns and 8 indexes are not this
task's to move (E-A4 refuses both a per-definition widening and an EAV), and
``test_scan_store.py`` reads both sets out of ``sqlite_master`` to prove it.

⚠️ THIS MODULE CAPTURES NO DATABASE PATH AT IMPORT. Every call resolves through
``snapshot_db.get_db_path()``, which reads ``SCREENER_DB_PATH`` afresh. A
module-level ``_DB_PATH = os.environ.get(...)`` would be frozen at import, a
fixture's ``monkeypatch.setenv`` would reach nothing, and on THIS box the default
resolves to ``C:\\data\\screener.db`` — a real 1.7 MB file that is not
production and must not be a test's scratch space.
"""
from __future__ import annotations

import contextlib
import datetime
import json
import os
import time
from collections.abc import Mapping as _MappingABC
from typing import Any, Iterable, Mapping, Optional, Sequence
from zoneinfo import ZoneInfo

from api.services import ast_freshness
from api.services.screener import snapshot_db
from api.services.signature import ledger

#: ⛔ THE TIMEFRAME VOCABULARY, DERIVED FROM THE BARS STORE'S OWN KEYS.
#: ``ledger._BARS_STORE_TF_KEYS`` maps each bars-store code to the product label
#: it is shown as. This table keys on the CODE (controller resolution 6) because
#: that is what ``bars_sqlite``, ``TRAILING_PAD`` and the alert evaluator's bar
#: reads already key on; rendering the label is a DISPLAY concern.
#:
#: ⛔ AND ``ledger.ledger_timeframe`` IS NOT CALLED HERE. The ledger speaks the
#: product label and refuses the code at its door, so calling it would refuse
#: every key this store writes. The MAP is what is shared, not the door.
_TF_LABEL_BY_CODE: Mapping[str, str] = dict(ledger._BARS_STORE_TF_KEYS)
_TF_CODE_BY_LABEL: Mapping[str, str] = {v: k for k, v in _TF_LABEL_BY_CODE.items()}
_TF_CODES = frozenset(_TF_LABEL_BY_CODE)

#: The narrowest and widest ``as_of`` a YYYYMMDD encoding can carry. Anything
#: outside is a DIFFERENT encoding wearing an integer's clothes — unix seconds,
#: most likely, which ``_normalize_bar_time`` passes through verbatim because for
#: an INTRADAY signal that is the correct key. It is not the correct key here.
_AS_OF_MIN = 1000_01_01
_AS_OF_MAX = 9999_12_31

#: Which db files this process has already created the schema in. Keyed by PATH
#: rather than a bare boolean so a test that repoints ``SCREENER_DB_PATH`` at a
#: fresh temp file gets a fresh ``CREATE TABLE``, instead of inheriting a "yes,
#: done" flag that belonged to a different file.
_INITED: set = set()


# --------------------------------------------------------------------------- #
# the door: one spelling per timeframe, one encoding per session
# --------------------------------------------------------------------------- #

def _normalise_tf(tf: Any) -> str:
    """The bars-store timeframe code, or a refusal that NAMES the other spelling.

    ⛔ ONE SPELLING PER TIMEFRAME IN STORAGE. The same session written under two
    spellings is two rows, every count stays plausible, and nothing is ever red —
    the defect ``ledger._PRODUCT_TIMEFRAMES`` was added to stop on the other side
    of the same fence. Here the fence runs the other way: this store keys on the
    CODE, so the refusal has to hand a caller holding a product label the code it
    should have sent, or they will simply delete the scan.
    """
    if isinstance(tf, str) and tf in _TF_CODES:
        return tf
    if isinstance(tf, str) and tf in _TF_CODE_BY_LABEL:
        raise ValueError(
            f"tf {tf!r} is the PRODUCT LABEL; this store keys on the bars-store "
            f"code {_TF_CODE_BY_LABEL[tf]!r}. One spelling per timeframe in "
            "storage — two spellings split one session across two keys and every "
            "count still looks plausible."
        )
    raise ValueError(
        f"tf must be one of the bars-store codes {sorted(_TF_CODES)}, got {tf!r}"
    )


def _normalise_as_of(as_of: Any) -> int:
    """The session, as ONE YYYYMMDD integer, collapsed at the door.

    ⛔ THE COLLAPSE HAPPENS HERE AND NOWHERE ELSE.
    ``ledger._normalize_bar_time`` exists because the same session already
    arrives three ways in this repo — a YYYYMMDD int from ``bars_sqlite``, an ISO
    string from ``/api/bars`` and ``screener_rows.bars_asof``, and unix seconds
    intraday. Called at each call site instead of at the door, one of them gets
    missed and that one session keys itself away from every other row for the
    same day.

    ⛔ AND THE RESULT IS RANGE-CHECKED, WHICH ``_normalize_bar_time`` DELIBERATELY
    DOES NOT DO. It passes an epoch int through verbatim — correct for an
    intraday SIGNAL, wrong for a screener session, and silent either way. A
    ``1754611200`` filed beside a ``20260808`` is a second encoding of one day,
    which is the exact failure the collapse exists to prevent.
    """
    n = ledger._normalize_bar_time(as_of)
    if not (_AS_OF_MIN <= n <= _AS_OF_MAX):
        raise ValueError(
            f"as_of {as_of!r} normalises to {n}, which is not a YYYYMMDD date. "
            "This store keys a session by its DATE; an epoch timestamp is a "
            "second encoding of the same day and would never join."
        )
    year, rest = divmod(n, 10_000)
    month, day = divmod(rest, 100)
    try:
        datetime.date(year, month, day)
    except ValueError as exc:
        raise ValueError(f"as_of {as_of!r} normalises to {n}, which is not a real "
                         f"date ({exc})") from exc
    return n


def _key(def_hash: Any, tf: Any, as_of: Any) -> tuple:
    """``(def_hash, tf_code, as_of_yyyymmdd)`` — the one key all three tables' verbs share."""
    if not isinstance(def_hash, str) or not def_hash:
        raise ValueError(f"def_hash must be a non-empty str, got {def_hash!r}")
    return def_hash, _normalise_tf(tf), _normalise_as_of(as_of)


def _ensure() -> None:
    """Create the schema on first touch of THIS database file.

    Lazy, and on READS as well as writes, for ``ledger._ensure_init``'s measured
    reason: a store whose schema is only created by a flag-gated job 500s every
    reader for as long as the feature ships dark (wire/store.py, prod
    2026-07-31). E-2 ships dark by design — nothing writes this store until E-3.
    """
    path = snapshot_db.get_db_path()
    if path in _INITED:
        return
    snapshot_db.init_db()
    _INITED.add(path)


def init_db() -> None:
    """Create both tables. ⛔ DELEGATES — the DDL has ONE owner, ``snapshot_db``.

    A second ``CREATE TABLE`` for these tables in this file would be a second
    schema, and the two would drift the first time a column moved — silently,
    because ``IF NOT EXISTS`` makes the loser a no-op rather than an error.
    """
    snapshot_db.init_db()
    _INITED.add(snapshot_db.get_db_path())


# --------------------------------------------------------------------------- #
# hits
# --------------------------------------------------------------------------- #

def record_hits(def_hash: str, tf: Any, as_of: Any,
                tickers: Iterable[Any]) -> int:
    """File the symbols this definition matched on this session. Returns the count.

    ⭐ THE SET IS REPLACED, NOT UNIONED, and the key is why: ``(def_hash, tf,
    as_of)`` names ONE evaluation of ONE formula over ONE session. Re-running it
    — after a bars correction, or a retried sweep — must not leave yesterday's
    answer and today's answer superimposed, because a hit that a correction
    REMOVED would then be unremovable and ``scan_hits`` would disagree with the
    receipt written beside it. Append-only is the right shape for a LEDGER of
    events; this is a snapshot of one question's answer.

    Tickers are upper-cased and de-duplicated because ``screener_rows.ticker`` is
    stored upper-cased and is the column ``join_clause`` joins on — a lower-case
    hit would be a row that exists and never matches, which is worse than a
    missing one.
    """
    h, code, day = _key(def_hash, tf, as_of)
    seen = sorted({str(t).strip().upper() for t in (tickers or []) if str(t).strip()})
    _ensure()
    with snapshot_db._WRITE_LOCK, contextlib.closing(snapshot_db.connect()) as conn:
        conn.execute(
            "DELETE FROM scan_hits WHERE def_hash=? AND tf=? AND as_of=?",
            (h, code, day))
        if seen:
            conn.executemany(
                "INSERT INTO scan_hits (def_hash, tf, as_of, ticker) VALUES (?,?,?,?)",
                [(h, code, day, t) for t in seen])
        conn.commit()
    return len(seen)


def hits(def_hash: str, tf: Any, as_of: Any) -> list:
    """The symbols this definition matched, sorted. ``[]`` is a real answer.

    ⚠️ ``[]`` MEANS "NO MATCHES" AND SAYS NOTHING ABOUT WHETHER THE SWEEP RAN.
    That question has its own function — ``coverage`` — and keeping them apart is
    the entire design of this module.
    """
    h, code, day = _key(def_hash, tf, as_of)
    _ensure()
    with contextlib.closing(snapshot_db.connect()) as conn:
        rows = conn.execute(
            "SELECT ticker FROM scan_hits WHERE def_hash=? AND tf=? AND as_of=? "
            "ORDER BY ticker", (h, code, day)).fetchall()
    return [r["ticker"] for r in rows]


# --------------------------------------------------------------------------- #
# the receipt
# --------------------------------------------------------------------------- #

#: The five keys of a coverage result (controller resolution 5).
#:
#: 🔴 ``not_computable`` IS ITS OWN BUCKET AND THAT IS THE RESOLUTION. "We could
#: not compute it at the last confirmed bar" (a symbol with 30 bars of history
#: under a 200-bar average) and "something broke" are DIFFERENT FACTS to a
#: member, and folding them is what makes a coverage report untrustworthy.
#:
#: ⛔ ``dropped_symbols`` IS THE ONE ENUMERATION and it carries BOTH kinds, each
#: with its own ``reason``. A second list would be a sixth key nobody granted,
#: and two lists that must sum to two counts is two chances to disagree.
COVERAGE_KEYS = ("evaluated", "answered", "dropped", "not_computable",
                 "dropped_symbols")


def _validated_dropped(dropped_symbols: Any) -> list:
    """The enumeration, checked: a list of ``{ticker, reason}``, each non-empty.

    ⛔ THE REASON IS REQUIRED. *"41 symbols were dropped and here they are"* is
    only worth printing if each entry says WHY — it is the difference between a
    member learning their screen needs more history and a member concluding the
    screener is broken.
    """
    if not isinstance(dropped_symbols, (list, tuple)):
        raise ValueError(
            f"dropped_symbols is the ONE enumeration and it is a list; got "
            f"{type(dropped_symbols).__name__}")
    out = []
    for i, item in enumerate(dropped_symbols):
        if not isinstance(item, _MappingABC):
            raise ValueError(
                f"dropped_symbols[{i}] is {item!r}; each entry is an object "
                "carrying a ticker and the reason it was dropped")
        ticker = item.get("ticker")
        reason = item.get("reason")
        if not isinstance(ticker, str) or not ticker.strip():
            raise ValueError(f"dropped_symbols[{i}] carries no ticker: {item!r}")
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError(
                f"dropped_symbols[{i}] ({ticker}) carries no reason. An "
                "enumeration without reasons cannot tell 'not enough history' "
                "from 'the fetch failed', which is the split this receipt exists "
                "to record.")
        entry = dict(item)
        entry["ticker"] = ticker.strip().upper()
        out.append(entry)
    return out


def record_coverage(def_hash: str, tf: Any, as_of: Any, *,
                    evaluated: int, answered: int, dropped: int,
                    not_computable: int, dropped_symbols: Sequence[Any],
                    freshness: str = ast_freshness.UNKNOWN,
                    swept_at: Optional[float] = None) -> bool:
    """Write the receipt. ``True`` when it is the FIRST for this key.

    ⛔ THE ARITHMETIC MUST CLOSE, AND A RECEIPT THAT DOES NOT IS REFUSED RATHER
    THAN RECORDED. ``evaluated == answered + dropped + not_computable``. A receipt
    is the artifact a member is asked to trust when the hit list is short; one
    whose own numbers disagree is worse than none, because it looks like evidence.

    ``freshness`` is the ``ast_freshness`` verdict for the tree that was swept,
    validated against ``FRESHNESS_MODES`` so a second spelling of "stale" cannot
    enter storage. It defaults to ``unknown`` because THIS module never sees the
    tree — the sweep does, and it passes what the verdict said.
    """
    h, code, day = _key(def_hash, tf, as_of)
    counts = {"evaluated": evaluated, "answered": answered, "dropped": dropped,
              "not_computable": not_computable}
    for name, value in counts.items():
        if type(value) is bool or not isinstance(value, int) or value < 0:
            raise ValueError(f"{name} must be a non-negative int, got {value!r}")
    if evaluated != answered + dropped + not_computable:
        raise ValueError(
            f"the receipt does not close: evaluated={evaluated} but "
            f"answered({answered}) + dropped({dropped}) + "
            f"not_computable({not_computable}) = "
            f"{answered + dropped + not_computable}. A coverage report whose own "
            "arithmetic disagrees is evidence of nothing.")
    listed = _validated_dropped(dropped_symbols)
    if len(listed) > dropped + not_computable:
        raise ValueError(
            f"dropped_symbols enumerates {len(listed)} symbols but the counts "
            f"admit only {dropped + not_computable}. The list may be SHORTER "
            "than the counts (a cap), never longer.")
    if freshness not in ast_freshness.FRESHNESS_MODES:
        raise ValueError(
            f"freshness must be one of {ast_freshness.FRESHNESS_MODES}, got "
            f"{freshness!r}")

    payload = json.dumps(listed, separators=(",", ":"), sort_keys=True)
    stamp = float(swept_at) if swept_at is not None else time.time()
    _ensure()
    with snapshot_db._WRITE_LOCK, contextlib.closing(snapshot_db.connect()) as conn:
        prior = conn.execute(
            "SELECT 1 FROM scan_coverage WHERE def_hash=? AND tf=? AND as_of=?",
            (h, code, day)).fetchone()
        conn.execute(
            "INSERT OR REPLACE INTO scan_coverage (def_hash, tf, as_of, evaluated, "
            "answered, dropped, not_computable, dropped_json, dropped_listed, "
            "freshness, swept_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (h, code, day, evaluated, answered, dropped, not_computable,
             payload, len(listed), freshness, stamp))
        conn.commit()
    return prior is None


def coverage(def_hash: str, tf: Any, as_of: Any) -> Optional[dict]:
    """The receipt, or ``None`` when this definition was never swept here.

    🔴 ``None`` IS THE ANSWER THE WHOLE MODULE EXISTS TO BE ABLE TO GIVE. It is
    not "no hits" and it is not an error — it is "nobody looked", and a surface
    that cannot say that ends up presenting an unrun screen as a quiet market.
    """
    h, code, day = _key(def_hash, tf, as_of)
    _ensure()
    with contextlib.closing(snapshot_db.connect()) as conn:
        row = conn.execute(
            "SELECT * FROM scan_coverage WHERE def_hash=? AND tf=? AND as_of=?",
            (h, code, day)).fetchone()
    if row is None:
        return None
    out = dict(row)
    out["dropped_symbols"] = json.loads(out.pop("dropped_json"))
    return out


# --------------------------------------------------------------------------- #
# the latest-coverage primitives (Wave 4 Task 1)
# --------------------------------------------------------------------------- #

#: The sweep's timeframe, spelled ONCE for request-path consumers. It equals
#: scan_evaluator.DEFAULT_TF, restated here because the off-request-path rail
#: (tests/test_scan_evaluator_off_request_path.py) forbids importing the
#: evaluator from anything a route handler reaches; the equality is pinned by
#: tests/test_screener_wave4_store.py::test_scan_join_tf_is_the_sweeps_default_tf.
SCAN_JOIN_TF = "D"


# --------------------------------------------------------------------------- #
# the LIVE side tables — declared HERE, created by `snapshot_db` (lane W4b)
# --------------------------------------------------------------------------- #

#: ⭐ THE SHAPE HAS ONE OWNER AND IT IS THIS MODULE. `snapshot_db.init_db`
#: DERIVES the `CREATE TABLE` and the ALTER-add widening loop from these tuples
#: (its `_scan_live_schema_sql`), so a column added here reaches a pod that
#: already holds the table — the 8/25 lesson: `CREATE TABLE IF NOT EXISTS`
#: never widens, and `screener_live` sat at 0 rows for as long as nobody read it.
#:
#: ⛔ EVERY NON-KEY COLUMN IS NULLABLE OR DEFAULTED. `ALTER TABLE … ADD COLUMN`
#: on a `WITHOUT ROWID` table refuses a NOT NULL column without a default, and
#: the widening loop is the whole reason this shape exists.
LIVE_HITS_TABLE = "scan_hits_live"
LIVE_CYCLES_TABLE = "scan_live_cycles"
LIVE_HIT_COLUMNS = (
    ("def_hash", "TEXT NOT NULL"),
    ("tf", "TEXT NOT NULL"),
    ("symbol", "TEXT NOT NULL"),
    ("as_of", "INTEGER NOT NULL DEFAULT 0"),      # the TICK (unix seconds), never a session
    ("value", "REAL"),
    ("live_cols", "INTEGER NOT NULL DEFAULT 0"),
    ("src_price", "REAL"),
)
LIVE_CYCLE_COLUMNS = (
    ("cycle_started", "INTEGER NOT NULL"),         # the TICK the cycle began at
    ("tf", "TEXT NOT NULL DEFAULT 'D'"),
    ("receipt_json", "TEXT NOT NULL DEFAULT '{}'"),
    ("swept_json", "TEXT NOT NULL DEFAULT '[]'"),
)
#: The two provenance words a `hits_for` row can carry. Closed set.
LIVE_TIERS = ("nightly", "live")
#: Cycle receipts kept — 120 five-minute cycles ≈ 1.5 regular sessions.
LIVE_CYCLES_KEEP = 120
#: The demand ring's bound (symbols a member or a definition just NAMED).
DEMAND_MAX = 2000


def live_max_age_s() -> float:
    """The dead-sweeper contract for the LIVE scan overlay: a live row older than
    this is served as nightly. ⛔ Declared HERE, not read off the evaluator —
    the off-request-path rail forbids importing the evaluator from anything a
    route reaches (the `SCAN_JOIN_TF` note above). Task 3 pins
    `live_max_age_s() >= 2 * live_interval_s()` so the two stay consistent."""
    try:
        return float(os.environ.get("SCAN_LIVE_MAX_AGE_S", "") or 900.0)
    except ValueError:
        return 900.0


def latest_covered_as_of(def_hash: str, tf: Any) -> Optional[int]:
    """MAX(as_of) holding a COVERAGE row for this (def_hash, tf), else None.

    None == "nobody has ever looked" == the chip's "first sweep tonight".
    Delegates to latest_coverage_for — one query shape, one owner.
    """
    row = latest_coverage_for([def_hash], tf).get(str(def_hash or "").strip())
    return row["as_of"] if row else None


def latest_coverage_for(def_hashes: Iterable[Any], tf: Any) -> dict:
    """{def_hash: {as_of, evaluated, answered, dropped, not_computable,
    freshness}} for each hash's LATEST swept session.

    ⛔ scan_coverage ONLY, never scan_hits: a swept zero-hit session writes a
    coverage row and no hits rows, so a hits-derived latest would silently
    join an OLDER day's matches — the "quiet market" lie the three-state
    contract exists to kill. A hash with no coverage row is ABSENT from the
    result (never null-filled): absent IS the answer.

    One statement regardless of input size — meta() calls this per request on
    the one shared uvicorn loop; an N+1 here multiplies into every member's
    page load.
    """
    code = _normalise_tf(tf)
    hashes = sorted({str(h).strip() for h in (def_hashes or []) if str(h or "").strip()})
    if not hashes:
        return {}
    _ensure()
    marks = ",".join("?" for _ in hashes)
    sql = (
        "SELECT c.def_hash, c.as_of, c.evaluated, c.answered, c.dropped, "
        "c.not_computable, c.freshness FROM scan_coverage c "
        "JOIN (SELECT def_hash, MAX(as_of) AS m FROM scan_coverage "
        "      WHERE tf=? AND def_hash IN (" + marks + ") GROUP BY def_hash) x "
        "  ON x.def_hash = c.def_hash AND x.m = c.as_of "
        "WHERE c.tf=?")
    with contextlib.closing(snapshot_db.connect()) as conn:
        rows = conn.execute(sql, [code, *hashes, code]).fetchall()
    return {r["def_hash"]: {
        "as_of": r["as_of"], "evaluated": r["evaluated"],
        "answered": r["answered"], "dropped": r["dropped"],
        "not_computable": r["not_computable"], "freshness": r["freshness"],
    } for r in rows}


# --------------------------------------------------------------------------- #
# the join, and the horizon
# --------------------------------------------------------------------------- #

def recent_covered_as_ofs(def_hash: str, tf: Any, limit: int = 2) -> list:
    """The most recent SWEPT sessions for this definition, newest first.

    ⛔ scan_coverage ONLY, never scan_hits — the same rule
    `latest_coverage_for` states, and it matters more here than anywhere else
    in this module. A swept session that matched NOTHING writes a coverage row
    and zero hits rows, so a hits-derived "previous session" would skip it and
    diff tonight against some older, busier night. Every name that has been in
    the screen the whole time would then be reported as newly ENTERED, and the
    member would be alerted to a move that never happened.

    Fewer than `limit` entries is a real answer: a definition swept once has no
    previous session, and there is nothing to compare.
    """
    _ensure()
    key = _normalise_tf(tf)
    with snapshot_db.connect() as conn:
        rows = conn.execute(
            "SELECT as_of FROM scan_coverage WHERE def_hash=? AND tf=? "
            "ORDER BY as_of DESC LIMIT ?",
            (str(def_hash or "").strip(), key, int(limit))).fetchall()
    return [int(r[0]) for r in rows]


def join_clause(def_hash: str, tf: Any, as_of: Any) -> tuple:
    """``(sql_fragment, params)`` selecting the ``screener_rows`` this scan hit.

    ⛔ A FRAGMENT, NOT A WIRING. Whether a scan reaches the screener as a
    ``filters.FILTERS`` entry, as a new filter TYPE inside ``query.run_scan``, or
    as its own endpoint was E-4's decision (E4-A5, controller resolution 7).
    E-4 (Wave 4) wired it: ``query.build_where``'s scan branch and
    ``scan_results._hit_tickers`` are the two callers, both binding the
    fragment's params verbatim.

    ⛔ WHAT E-2 OWES IS THAT WHATEVER TAKES IT CANNOT BUILD SQL FROM A CLIENT
    STRING. ``filters.column_for`` and ``filters.is_valid_op`` gate every existing
    screener query for exactly that reason, and ``def_hash`` is the one value here
    a client could ever supply — so it leaves this function as a BOUND PARAMETER
    and never as text. Both other params are normalised through ``_key`` first, so
    a caller cannot smuggle a timeframe either.
    """
    h, code, day = _key(def_hash, tf, as_of)
    return (
        "EXISTS (SELECT 1 FROM scan_hits h WHERE h.ticker = screener_rows.ticker "
        "AND h.def_hash = ? AND h.tf = ? AND h.as_of = ?)",
        [h, code, day],
    )


def prune(before_as_of: Any) -> dict:
    """Drop every hit and every receipt for a session STRICTLY BEFORE the horizon.

    Returns ``{"before_as_of", "hits", "coverage"}`` — the normalised horizon and
    the rows removed from each table.

    ⛔ THIS SHIPS WITH THE TABLES, NOT AFTER THEM. ``alert_shadow_fires`` is the
    counter-example the design names: 53 bytes a row, no prune, no TTL, no cap,
    **279 GB/yr at 10,000 alerts** — and it grew for a year before anybody
    measured it. A ``scan_hits`` row costs **182 bytes** with its index (measured;
    see the module docstring), which is 3.4× worse per row, so shipping the tables
    without the prune would be the same mistake with a bigger constant.

    ⚠️ STRICTLY BEFORE, so the horizon date itself SURVIVES. A caller passing "the
    oldest session I want to keep" keeps it; an inclusive prune would quietly eat
    one extra day every time it ran, and the loss would only ever show up as a
    hit-rate that drifted.

    🔴 AND A PRUNED WINDOW IS "UNPROVEN", NEVER "ZERO". Beyond the horizon
    ``coverage`` answers ``None``, which this module's readers already treat as
    "nobody looked". ⛔ A CLAIM SURFACE MUST NOT RE-DERIVE A HIT RATE OVER THE
    SURVIVING WINDOW AND PRESENT IT AS THE WHOLE — that is E6-A2's trap reached by
    arithmetic, and it is the one thing pruning a coverage table can silently do.
    """
    horizon = _normalise_as_of(before_as_of)
    _ensure()
    with snapshot_db._WRITE_LOCK, contextlib.closing(snapshot_db.connect()) as conn:
        removed_hits = conn.execute(
            "DELETE FROM scan_hits WHERE as_of < ?", (horizon,)).rowcount
        removed_cov = conn.execute(
            "DELETE FROM scan_coverage WHERE as_of < ?", (horizon,)).rowcount
        conn.commit()
    return {"before_as_of": horizon,
            "hits": max(removed_hits, 0),
            "coverage": max(removed_cov, 0)}


# --------------------------------------------------------------------------- #
# the LIVE side tables: one writer each, and the nightly tables untouched
# --------------------------------------------------------------------------- #
#
# ⛔ NOTHING IN THIS SECTION WRITES `scan_hits`, `scan_coverage` OR
# `screener_rows`, and nothing above it writes `scan_hits_live` or
# `scan_live_cycles`. `tests/test_scan_live_sweep.py` reads that off this
# module's AST (every SQL literal under every `execute*`), so the rule is a
# measurement rather than a promise. The live sweep answers a DIFFERENT
# question (this tick, the forming bar) from the nightly one (that session,
# the closed bar); two sets answering different questions is fine — one table
# holding both under one key is the second-authority defect.

def _normalise_tick(as_of: Any) -> int:
    """The live table keys the TICK (unix seconds) — the mirror image of
    `_normalise_as_of`, which refuses an epoch. A YYYYMMDD here would file a
    whole session's answer under one second of it, and never age out."""
    n = ledger._normalize_bar_time(as_of)
    if _AS_OF_MIN <= n <= _AS_OF_MAX or n <= 0:
        raise ValueError(
            f"as_of {as_of!r} normalises to {n}, a YYYYMMDD session date; the live "
            "table keys the TICK (unix seconds) the snapshot was read at.")
    return n


def _live_key(def_hash: Any, tf: Any) -> tuple:
    if not isinstance(def_hash, str) or not def_hash:
        raise ValueError(f"def_hash must be a non-empty str, got {def_hash!r}")
    return def_hash, _normalise_tf(tf)


@contextlib.contextmanager
def _one_transaction(conn):
    """``BEGIN IMMEDIATE`` … ``COMMIT``, or ``ROLLBACK`` on the way out through an
    exception — the two statements of a live write land together or not at all.

    ⛔ EXPLICIT, NEVER THE DRIVER'S IMPLICIT BEGIN. ``snapshot_db.connect()``
    leaves the connection on the driver's legacy transaction control today, where
    the first DML opens a transaction by itself and a writer that never says
    BEGIN is atomic by accident of another module's default. Under
    ``autocommit=True`` no implicit transaction exists: the DELETE commits ALONE,
    and a crash before the INSERT reads as "the market went quiet" for a cycle.
    ``tests/test_scan_live_sweep.py`` runs the writer under BOTH modes.

    ⚠️ COMMIT and ROLLBACK are issued as SQL, not ``conn.commit()`` /
    ``conn.rollback()``: those two are documented no-ops under ``autocommit=True``,
    so the Python-level calls would leave this transaction open until the
    connection closed — and a close rolls back. A transaction already open on
    entry (``autocommit=False`` keeps one open at all times) is joined, not
    nested; SQLite refuses a BEGIN inside a BEGIN.
    """
    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")


def upsert_live_hits(def_hash: str, tf: Any, rows: Iterable[Any], as_of: Any) -> int:
    """Replace THIS definition's live set. ONE writer, ONE transaction: the DELETE
    and the INSERT commit together or not at all (a crash between them would
    read as 'the market went quiet' for five minutes)."""
    h, code = _live_key(def_hash, tf)
    tick = _normalise_tick(as_of)
    cleaned: dict = {}
    for r in rows or []:
        sym = str(r.get("symbol") or "").strip().upper()
        if not sym:
            continue
        cleaned[sym] = (r.get("value"), int(r.get("live_cols") or 0), r.get("src_price"))
    _ensure()
    with snapshot_db._WRITE_LOCK, contextlib.closing(snapshot_db.connect()) as conn, \
            _one_transaction(conn):
        conn.execute(f"DELETE FROM {LIVE_HITS_TABLE} WHERE def_hash=? AND tf=?", (h, code))
        if cleaned:
            conn.executemany(
                f"INSERT INTO {LIVE_HITS_TABLE} (def_hash, tf, symbol, as_of, value, "
                "live_cols, src_price) VALUES (?,?,?,?,?,?,?)",
                [(h, code, s, tick, v, lc, sp) for s, (v, lc, sp) in sorted(cleaned.items())])
    return len(cleaned)


def live_hits(def_hash: str, tf: Any) -> list:
    """This definition's live rows, sorted by symbol — every row, whatever its age.
    Freshness is `hits_for`'s decision, not this read's."""
    h, code = _live_key(def_hash, tf)
    _ensure()
    with contextlib.closing(snapshot_db.connect()) as conn:
        rows = conn.execute(
            f"SELECT symbol, as_of, value, live_cols, src_price FROM {LIVE_HITS_TABLE} "
            "WHERE def_hash=? AND tf=? ORDER BY symbol", (h, code)).fetchall()
    return [dict(r) for r in rows]


def record_live_cycle(receipt: Mapping[str, Any], swept: Sequence[str]) -> None:
    """The cycle receipt, ONE row per cycle, pruned to `LIVE_CYCLES_KEEP`.

    `receipt["cycle_started"]` is stored as the int TICK (a missing or
    YYYYMMDD value is refused by `_normalise_tick`); the receipt dict itself is
    kept verbatim as JSON, so a caller may also carry an ISO copy under
    `cycle_started_iso`."""
    started = _normalise_tick(receipt.get("cycle_started"))
    code = _normalise_tf(receipt.get("tf") or SCAN_JOIN_TF)
    _ensure()
    with snapshot_db._WRITE_LOCK, contextlib.closing(snapshot_db.connect()) as conn, \
            _one_transaction(conn):
        conn.execute(
            f"INSERT OR REPLACE INTO {LIVE_CYCLES_TABLE} (cycle_started, tf, receipt_json, "
            "swept_json) VALUES (?,?,?,?)",
            (started, code, json.dumps(dict(receipt), sort_keys=True, default=str),
             json.dumps(sorted(set(swept or [])))))
        conn.execute(
            f"DELETE FROM {LIVE_CYCLES_TABLE} WHERE cycle_started NOT IN "
            f"(SELECT cycle_started FROM {LIVE_CYCLES_TABLE} ORDER BY cycle_started DESC LIMIT ?)",
            (LIVE_CYCLES_KEEP,))


def last_live_cycle(tf: Any = SCAN_JOIN_TF) -> Optional[dict]:
    """The newest cycle receipt for this timeframe, or ``None`` — "no cycle has
    ever run" is a real answer, distinct from a cycle that swept nothing."""
    code = _normalise_tf(tf)
    _ensure()
    with contextlib.closing(snapshot_db.connect()) as conn:
        row = conn.execute(
            f"SELECT cycle_started, tf, receipt_json, swept_json FROM {LIVE_CYCLES_TABLE} "
            "WHERE tf=? ORDER BY cycle_started DESC LIMIT 1", (code,)).fetchone()
    if row is None:
        return None
    return {"cycle_started": row["cycle_started"], "tf": row["tf"],
            "receipt": json.loads(row["receipt_json"]), "swept": json.loads(row["swept_json"])}


# --------------------------------------------------------------------------- #
# the overlay read: nightly hits LEFT-JOINed with same-session live rows
# --------------------------------------------------------------------------- #

_ET = ZoneInfo("America/New_York")


def live_session_ymd(tick: Any) -> int:
    """The ET session a tick falls in, as YYYYMMDD — comparable with ``as_of``.

    The one place the two encodings meet: a live row keys the TICK, a nightly row
    keys the SESSION, and the same-session gate in ``hits_for`` needs the tick's
    session to say whether an overlay belongs on that nightly set at all.
    """
    d = datetime.datetime.fromtimestamp(int(tick), _ET)
    return d.year * 10_000 + d.month * 100 + d.day


def _now_for_reads() -> float:
    """The read path's clock — ONE seam a route test can freeze (``monkeypatch``)
    without touching the writers' ``time.time()``."""
    return time.time()


def hits_for(def_hash: str, tf: Any, as_of: Any = None, *,
             now: Optional[float] = None) -> dict:
    """The nightly hits for a session LEFT-JOINed with the definition's live rows.

    ``{"as_of": YYYYMMDD, "rows": [{symbol, tier, in_nightly, live_as_of, value,
    src_price, live_cols}], "live": {…the last cycle's receipt, definition_swept,
    fresh_rows} | None}``. ``tier`` is one of ``LIVE_TIERS``.

    ⛔ NEVER FABRICATES. A symbol is ``tier: "live"`` only if a live row exists
    for it, was written in the CURRENT ET session (``live_session_ymd``) and is
    younger than ``live_max_age_s()`` — a dead sweeper's rows age back into
    ``nightly`` instead of standing as fresh forever. A live-only symbol comes
    back with ``in_nightly: False`` rather than being dropped or promoted: the
    two sets answer DIFFERENT questions (this tick's forming bar vs. that
    session's closed bar) and the reader is told which one each row came from.
    The overlay applies only to the LATEST covered session — that is the set
    the live sweep evaluated against; an older requested session is served as
    it was.

    ``as_of None`` reads the latest covered session. No covered session at all
    is ``{"as_of": None, "rows": [], "live": None}`` — "nobody has looked", the
    same answer ``coverage`` gives, never an empty market.
    """
    h, code = _live_key(def_hash, tf)
    latest = latest_covered_as_of(h, code)
    session = _normalise_as_of(as_of) if as_of is not None else latest
    if session is None:
        return {"as_of": None, "rows": [], "live": None}
    nightly = hits(h, code, session)
    fresh: dict = {}
    if session == latest:
        now_ts = float(_now_for_reads() if now is None else now)
        today = live_session_ymd(int(now_ts))
        max_age = live_max_age_s()
        for r in live_hits(h, code):
            if live_session_ymd(r["as_of"]) == today and now_ts - r["as_of"] <= max_age:
                fresh[r["symbol"]] = r

    def _row(sym: str, r: Optional[dict], in_nightly: bool) -> dict:
        return {"symbol": sym, "tier": "live" if r else "nightly",
                "in_nightly": in_nightly,
                "live_as_of": r["as_of"] if r else None,
                "value": r["value"] if r else None,
                "src_price": r["src_price"] if r else None,
                "live_cols": r["live_cols"] if r else 0}

    seen = set(nightly)
    rows = [_row(s, fresh.get(s), True) for s in nightly]
    rows += [_row(s, r, False) for s, r in sorted(fresh.items()) if s not in seen]
    cycle = last_live_cycle(code)
    live = None
    if cycle:
        live = dict(cycle["receipt"])
        live["cycle_started"] = cycle["cycle_started"]
        live["definition_swept"] = h in set(cycle["swept"])
        live["fresh_rows"] = len(fresh)
    return {"as_of": session, "rows": rows, "live": live}
