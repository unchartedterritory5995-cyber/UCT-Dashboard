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
import time
from collections.abc import Mapping as _MappingABC
from typing import Any, Iterable, Mapping, Optional, Sequence

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


def latest_covered_as_of(def_hash: str, tf: Any) -> Optional[int]:
    """MAX(as_of) holding a COVERAGE row for this (def_hash, tf), else None.

    None == "nobody has ever looked" == the chip's "first sweep tonight".
    Delegates to latest_coverage_for — one query shape, one owner.
    """
    row = latest_coverage_for([def_hash], tf).get(str(def_hash or "").strip())
    return row["as_of"] if row else None


def latest_coverage_for(def_hashes, tf) -> dict:
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
