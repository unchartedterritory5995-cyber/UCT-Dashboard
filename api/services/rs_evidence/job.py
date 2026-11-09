"""The point-in-time driver, the artifact writer and the publish gate.

Plan §9; map §2.1 ("rs_evidence on the WORKER: ... resumable by (session,
signal) checkpoint, writing a store in the data directory, publishing
rs/evidence.json via data_sync.put_bytes") and §3 row 2b-01.

HOW A RUN WORKS
    1. The benchmark's held daily bars at or before ``asof`` define the SESSION
       calendar; the newest ``sessions`` of them are requested.
    2. The checkpoint says which ``(session, signal)`` pairs are already
       ``done``; the rest (new sessions, ``open`` sessions, and signals added
       since) are measured. A session is ``done`` when the longest horizon's
       window ends at or before ``asof`` on the benchmark calendar; otherwise
       ``open``, and re-measured next run once more bars are held.
    3. Every universe ticker is read ONCE (``bars_reader(ticker, depth, asof)``,
       the `rs_history.default_bars_reader` seam shape: rows ``(ts,o,h,l,c,v)``
       with ``ts <= asof``, newest ``depth``, oldest first) and its signal
       columns computed ONCE over that history (`signals.compute_signal_columns`
       explains why that is point-in-time). Rows for the wanted sessions go to
       the store's STAGE table per ticker; after the loop `store.swap_in`
       replaces the old rows of those pairs, writes their checkpoints and
       empties the stage in ONE transaction. A restart therefore costs the RUN
       in flight, never a finished one, and changes nothing published: the
       old rows and the ``open`` checkpoints stay until the swap, so the next
       run asks for the same sessions again (review finding #3, 2026-11-07).
       Sessions holding rows with no checkpoint (left by the clear-first run
       before that fix) are requested too. Bound a run with ``sessions``.
       Per ticker, the split guard (owner decision N5) asks `declared_splits`
       for the declared split list and the ONE detector,
       `bars_sanitize.unadjusted_splits`, for the boundaries still unadjusted in
       the held bars; a row whose forward window holds one is stored as
       SKIPPED and counted, never measured (`measure` header). An unknown list
       is counted in ``split_unchecked`` and the ticker is measured as held;
       the artifact carries that count (``split_guard.unchecked``) and, per
       signal, how many of those names stand behind the signal's numbers
       (``split_guard.unchecked_by_signal``), so the card can say so (unit VA3).
    4. The artifact is rebuilt from EVERYTHING in the store and published
       through the injected ``put_bytes`` when asked and when it clears the
       row floor.

THE ROW FLOOR. :data:`MIN_ROWS` is the smallest number of all-bars rows an
artifact may publish with. The cap universe is ~3,600 names, so ONE real
session yields ~3,600 baseline rows; 1,000 is below a single session with
two-thirds of the names missing and far above any sample, dry or broken run
(an empty bars.db, a wrong benchmark, a universe file of ten names). An
artifact below it is a failed run, not a quiet market - the `finviz_universe
._MIN_ROWS` / `opt_flow._MIN_TICKERS` rule on the same bridge - and must never
overwrite a last-known-good artifact. The DISPLAY floor is a different number:
:data:`DISPLAY_FLOOR_N` rides in the artifact so the card unit suppresses a
statistic whose ``n`` is below it (research base §(c): "suppress display when
effective N < 100") instead of inventing its own.

SURVIVORSHIP. bars.db holds the names we hold today (plan §9, §17.6), so the
measurement is "universe as held". ``delisted_count`` is how many names the
delisted registry records as having stopped trading inside the measured
window (``last_date`` between ``window.from`` and ``window.to``), read through
``delisted_fn`` - the registry by default, lazily, best effort, ``None`` when
it cannot be read. It is printed so the readout can say how many names the
measurement cannot see; it does not correct anything.

NO ENVIRONMENT VARIABLE IS READ IN THIS PACKAGE. The store path, the
destination key and the universe are arguments; the arming unit (2b-02) owns
the flag and the paths.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from datetime import date, datetime, timezone
from typing import Callable, Dict, List, Optional, Sequence, Tuple

from . import store as S
from .measure import BASELINE_KEY, HORIZONS, Row, benchmark_aligned, rows_for_ticker, split_indexes, summarise
from .signals import SIGNALS, compute_signal_columns, inputs_used

log = logging.getLogger(__name__)

# 2 since 2026-11-07: the forward return is based on the next session's open (N6)
# and a window holding an unadjusted split is not counted (N5). A version-1
# artifact measured something else, so the web pull refuses one rather than print
# it under the new wording.
ARTIFACT_VERSION = 2
ARTIFACT_KEY = "rs/evidence.json"        # the documented destination; the CLI still requires --dest
MIN_ROWS = 1000                          # the publish floor (module header)
DISPLAY_FLOOR_N = 100                    # the card's suppression floor, carried in the artifact
DEFAULT_BENCHMARK = "SPY"
SURVIVORSHIP_NOTE = "universe as held, survivorship not yet corrected"

# Bars read BEFORE the first measured session: 252 (the new-high lookback, the
# longest warm-up pad among the measured columns; Mansfield's 200 sits inside
# it) + 600 (the chart provider's own extra-history convention, plan §8
# "N + 600 bars daily"), so the 21-EMA seed is fixed well before any measured
# bar and the window start cannot move a cross (signals.compute_signal_columns).
WARMUP_BARS = 252 + 600

#: ``split_fetch_budget`` default for :func:`run` (see its docstring).
AUTO_SPLIT_BUDGET = -1

#: The method sentences the artifact carries (and the methodology page reads).
FORWARD_RETURN_METHOD = (
    "excess[h] = ((C[t+h]/O[t+1] - 1) - (B[t+h]/BO[t+1] - 1)) x 100, percent: from the open of the "
    "session after the signal (t+1, the first price a member who sees the dot after the close can act "
    "on) to the close h sessions after the signal; h counts the stock's own bars; BO and B are the "
    "benchmark's open and close at the stock's bar times")
SPLIT_UNCHECKED_RULE = (
    "unchecked counts the names whose declared split list was unknown on the run that built this "
    "artifact, so the split guard could not judge them and they are measured as held; "
    "unchecked_by_signal counts, per signal, how many of those names hold counted rows of it")
SPLIT_GUARD_RULE = (
    f"a row whose forward window (t+1 to t+{max(HORIZONS)}) holds an unadjusted split, found by the repo's split "
    "detector from the ticker's declared split list, is not counted in any statistic; skipped counts "
    "the rows left out, per signal and for all bars")

_FAR_FUTURE_YMD = 99991231
_ALL_SESSIONS_DEPTH = 20000


class UsageError(ValueError):
    """A caller asked for something the job refuses by contract (exit 2)."""


# --------------------------------------------------------------------------- #
# defaults (every one injectable; each imported inside its function)
# --------------------------------------------------------------------------- #

def default_bars_reader(ticker: str, n: int, to_key: int) -> list:
    """Daily rows ``(ts, o, h, l, c, v)`` with ``ts <= to_key``, newest ``n``, oldest
    first - `bars_sqlite.get_bars_before`, the seam `rs_history` reads through."""
    from api.services import bars_sqlite
    return bars_sqlite.get_bars_before(ticker, "D", int(n), int(to_key))


def default_universe() -> List[str]:
    """`groups.cap_universe_set()` - the file the ratings rank over."""
    from api.services.groups import cap_universe_set
    return sorted(str(t).upper() for t in cap_universe_set())


def default_splits_reader(conn, *, budget: Optional[int], persist: bool):
    """The declared split lists the split guard judges with: `declared_splits`
    over the evidence store (its memo table lives there), at most ``budget``
    provider fetches per run (``None``: no limit)."""
    from api.services.declared_splits import DeclaredSplits
    return DeclaredSplits(conn, budget=budget, persist=persist)


def split_boundary_times(bars: Sequence[dict], declared) -> List[int]:
    """The bar time (YYYYMMDD) of each unadjusted split boundary in ``bars``, as the
    ONE detector, `bars_sanitize.unadjusted_splits`, finds it from the declared
    list (``[]`` / ``None``: nothing to find, nothing guessed)."""
    if not declared:
        return []
    from api.services.bars_sanitize import unadjusted_splits
    series = [{"t": ymd_to_iso(b["t"]), "c": b.get("c")} for b in bars]
    return [int(d.strftime("%Y%m%d")) for d, _ratio in unadjusted_splits(series, list(declared))]


def default_put_bytes(key: str, data: bytes, content_type: str) -> bool:
    from api.services import data_sync
    return bool(data_sync.put_bytes(key, data, content_type))


def default_delisted_count(window_from: str, window_to: str) -> Optional[int]:
    """How many registry names stopped trading inside ``[window_from, window_to]``
    (ISO dates, inclusive, on the registry's ``last_date``); ``None`` when the
    registry cannot be read."""
    try:
        from api.services import delisted_registry
        n = 0
        for rec in delisted_registry.all_entries():
            last = rec.get("last_date")
            if last and window_from <= str(last)[:10] <= window_to:
                n += 1
        return n
    except Exception as e:                                   # noqa: BLE001 - best effort by contract
        log.warning("[rs_evidence] delisted registry unavailable: %s", e)
        return None


# --------------------------------------------------------------------------- #
# sessions and bars
# --------------------------------------------------------------------------- #

def ymd_to_iso(ymd) -> Optional[str]:
    if ymd is None:
        return None
    t = str(int(ymd))
    return f"{t[:4]}-{t[4:6]}-{t[6:8]}"


def iso_to_ymd(s) -> int:
    if isinstance(s, (date, datetime)):
        return int(s.strftime("%Y%m%d"))
    txt = str(s).strip()
    if len(txt) == 8 and txt.isdigit():
        return int(txt)
    return int(date.fromisoformat(txt[:10]).strftime("%Y%m%d"))


def rows_to_bars(rows) -> List[dict]:
    """Store rows ``(ts, o, h, l, c, v)`` -> the bar dicts the column maths reads.
    A row without a positive finite close is DROPPED (the `rs_history
    .closes_from_rows` rule): the RS join divides by the close and a hole is
    honest, a crash is not."""
    out: List[dict] = []
    for ts, o, h, l, c, v in rows or ():
        try:
            cf = float(c)
        except (TypeError, ValueError):
            continue
        if not (cf > 0 and cf == cf and cf not in (float("inf"),)):
            continue
        out.append({"t": int(ts), "o": o, "h": h, "l": l, "c": cf, "v": v})
    return out


def plan_sessions(sessions_held: Sequence[int], requested_n: int, checkpoints: Dict[Tuple[int, str], str],
                  signal_names: Sequence[str], max_horizon: int, *,
                  unchecked_sessions: Sequence[int] = ()) -> dict:
    """Which ``(session, signal)`` pairs this run measures, and which of them can
    be marked ``done``. Returns ``{requested, wanted, completable, pairs_skipped}``:
    ``wanted`` is ``{session: {signal, ...}}`` over the requested sessions, the
    signals (plus the baseline) not yet ``done``.

    An ``open`` checkpoint is a promise to re-measure, so every open session
    the calendar still holds is requested whether or not the newest
    ``requested_n`` window reaches it; a nightly run with a small window still
    closes the sessions it left open last time. ``unchecked_sessions`` (sessions
    holding rows without a checkpoint, `store.unchecked_pairs`) are requested
    on the same terms: a row with no checkpoint is a measurement nobody
    finished."""
    held = [int(s) for s in sessions_held]
    idx_of = {s: i for i, s in enumerate(held)}
    newest = held[-int(requested_n):] if requested_n and requested_n > 0 else list(held)
    reopened = {s for (s, _k), st in checkpoints.items() if st == S.OPEN and s in idx_of}
    reopened |= {int(s) for s in unchecked_sessions if int(s) in idx_of}
    requested = sorted(set(newest) | reopened)
    keys = list(signal_names) + [BASELINE_KEY]
    last_idx = len(held) - 1
    wanted: Dict[int, set] = {}
    completable: Dict[int, bool] = {}
    skipped = 0
    for s in requested:
        need = {k for k in keys if checkpoints.get((s, k)) != S.DONE}
        skipped += len(keys) - len(need)
        if need:
            wanted[s] = need
            completable[s] = idx_of[s] + int(max_horizon) <= last_idx
    return {"requested": requested, "wanted": wanted, "completable": completable, "pairs_skipped": skipped}


def collect(universe: Sequence[str], bars_reader: Callable, *, asof_ymd: int, depth: int,
            bench_bars: Sequence[dict], wanted: Dict[int, set], signals: Dict[str, dict],
            horizons: Sequence[int], sink: Callable[[str, List[Row]], None], log_every: int = 250,
            splits_reader: Optional[Callable] = None) -> dict:
    """The ticker loop (module header step 3). ``sink(ticker, rows)`` receives
    each ticker's rows as they are measured. ``splits_reader(ticker)`` gives the
    declared split list the split guard judges with (``None``: unknown, counted
    in ``split_unchecked``, the names in ``split_unchecked_names``; no reader:
    nothing is judged)."""
    stats = {"tickers": 0, "no_bars": 0, "rows": 0, "events": 0,
             "split_tickers": 0, "split_skipped": 0, "split_unchecked": 0, "split_unchecked_names": []}
    total = len(universe)
    for i, ticker in enumerate(universe, 1):
        bars = rows_to_bars(bars_reader(ticker, int(depth), int(asof_ymd)))
        if not bars:
            stats["no_bars"] += 1
            continue
        columns = compute_signal_columns(bars, bench_bars, signals)
        bench_opens, bench_closes = benchmark_aligned(bars, bench_bars)
        splits: List[int] = []
        if splits_reader is not None:
            try:
                declared = splits_reader(ticker)
            except Exception as e:                           # noqa: BLE001 - one name, not the run
                log.debug("[rs_evidence] split list read failed for %s: %s", ticker, e)
                declared = None
            if declared is None:
                stats["split_unchecked"] += 1
                stats["split_unchecked_names"].append(str(ticker).upper())
            splits = split_indexes(bars, split_boundary_times(bars, declared))
            stats["split_tickers"] += 1 if splits else 0
        rows = rows_for_ticker(ticker, bars, bench_opens, bench_closes, columns, horizons, wanted, splits)
        sink(ticker, rows)
        stats["tickers"] += 1
        stats["rows"] += len(rows)
        stats["events"] += sum(1 for r in rows if r[1] != BASELINE_KEY and r[3] is not None)
        stats["split_skipped"] += sum(1 for r in rows if r[3] is None)
        if log_every and i % log_every == 0:
            log.info("[rs_evidence] %d/%d tickers, %d rows", i, total, stats["rows"])
    return stats


# --------------------------------------------------------------------------- #
# artifact and publish
# --------------------------------------------------------------------------- #

def build_artifact(summary: dict, *, asof_ymd: Optional[int], benchmark: str, window_from: Optional[int],
                   window_to: Optional[int], sessions: int, sessions_open: int, universe: int,
                   universe_requested: int, delisted_fn: Optional[Callable] = None,
                   signals: Dict[str, dict] = SIGNALS, horizons: Sequence[int] = HORIZONS,
                   split_unchecked: Optional[int] = None,
                   split_unchecked_by_signal: Optional[Dict[str, int]] = None) -> dict:
    """The ``rs/evidence.json`` document (shape in the package docstring).

    ``split_unchecked`` is how many names the run's split guard could not judge
    (their declared split list was unknown); ``split_unchecked_by_signal`` how
    many of them hold counted rows of each signal. ``None`` (the default): not
    known, carried as null, and the card says nothing it cannot back."""
    w_from, w_to = ymd_to_iso(window_from), ymd_to_iso(window_to)
    delisted = None
    if w_from and w_to:
        fn = delisted_fn or default_delisted_count
        try:
            d = fn(w_from, w_to)
            delisted = int(d) if d is not None else None
        except Exception as e:                               # noqa: BLE001 - best effort by contract
            log.warning("[rs_evidence] delisted_fn failed: %s", e)
            delisted = None
    per_signal = {}
    for name, spec in signals.items():
        stats = summary["per_signal"].get(name) or {
            "n_signals": 0, "dates": 0, "tickers": 0,
            "horizons": {str(h): {"n": 0, "incomplete": 0, "incomplete_share": None, "hit_rate": None,
                                  "median_excess": None, "mean_excess": None, "dates": 0} for h in horizons},
        }
        per_signal[name] = {"column": spec["column"], "definition": spec["definition"], **stats}
    skipped = dict(summary.get("split_skipped") or {})
    by_sig = split_unchecked_by_signal if isinstance(split_unchecked_by_signal, dict) else None
    split_guard = {
        "skipped": {name: int(skipped.get(name, 0)) for name in list(signals) + [BASELINE_KEY]},
        "rule": SPLIT_GUARD_RULE,
        "unchecked": int(split_unchecked) if split_unchecked is not None else None,
        "unchecked_by_signal": ({name: int(by_sig.get(name, 0)) for name in list(signals) + [BASELINE_KEY]}
                                if by_sig is not None else None),
        "unchecked_rule": SPLIT_UNCHECKED_RULE,
    }
    return {
        "version": ARTIFACT_VERSION,
        "asof": ymd_to_iso(asof_ymd),
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "benchmark": benchmark,
        "window": {"from": w_from, "to": w_to},
        "sessions": int(sessions),
        "sessions_open": int(sessions_open),
        "universe": int(universe),
        "universe_requested": int(universe_requested),
        "delisted_count": delisted,
        "survivorship": SURVIVORSHIP_NOTE,
        "horizons": [int(h) for h in horizons],
        "rows": int(summary["rows"]),
        "per_signal": per_signal,
        "baseline": summary["baseline"],
        "split_guard": split_guard,
        "method": {
            "forward_return": FORWARD_RETURN_METHOD,
            "hit": "excess > 0",
            "baseline": "the same statistic over every bar of every measured ticker in the window",
            "point_in_time": "a signal on session s reads only bars <= s; a forward window past the "
                             "held history is excluded and counted as incomplete",
            "inputs": inputs_used(),
            "warmup_bars": WARMUP_BARS,
            "display_floor_n": DISPLAY_FLOOR_N,
            "publish_floor_rows": MIN_ROWS,
        },
    }


def artifact_bytes(artifact: dict) -> bytes:
    return json.dumps(artifact, sort_keys=True, separators=(",", ":")).encode("utf-8")


def publish(artifact: dict, *, dest: str, put_bytes: Optional[Callable] = None) -> dict:
    """Send the artifact to ``dest`` through ``put_bytes(key, data, content_type)``
    - or refuse: no destination, or fewer than :data:`MIN_ROWS` rows."""
    if not dest or not str(dest).strip():
        raise UsageError("a destination key is REQUIRED to publish (for example rs/evidence.json)")
    rows = int(artifact.get("rows") or 0)
    receipt = {"dest": dest, "rows": rows, "floor": MIN_ROWS, "published": False, "bytes": 0, "sha256": None,
               "reason": None}
    if rows < MIN_ROWS:
        receipt["reason"] = "row_floor"
        log.warning("[rs_evidence] refusing to publish: %d rows < floor %d", rows, MIN_ROWS)
        return receipt
    data = artifact_bytes(artifact)
    receipt["bytes"] = len(data)
    receipt["sha256"] = hashlib.sha256(data).hexdigest()
    ok = bool((put_bytes or default_put_bytes)(dest, data, "application/json"))
    receipt["published"] = ok
    receipt["reason"] = None if ok else "put_bytes_false"
    return receipt


# --------------------------------------------------------------------------- #
# the run
# --------------------------------------------------------------------------- #

def run(*, db: str, dry_run: bool = False, publish_to: Optional[str] = None, sessions: int = 0,
        asof=None, benchmark: str = DEFAULT_BENCHMARK, universe: Optional[Sequence[str]] = None,
        bars_reader: Optional[Callable] = None, put_bytes: Optional[Callable] = None,
        delisted_fn: Optional[Callable] = None, signals: Optional[Dict[str, dict]] = None,
        horizons: Sequence[int] = HORIZONS, splits_reader: Optional[Callable] = None,
        split_fetch_budget: Optional[int] = AUTO_SPLIT_BUDGET) -> dict:
    """One run (module header). Returns the receipt; raises :class:`UsageError`
    for a contract violation and lets other exceptions propagate (the CLI maps
    them to exit codes). ``publish_to`` is the destination key; ``None`` means
    measure only. A dry run opens the store read-only (if it exists), writes
    nothing, publishes nothing and summarises what THIS run measured.

    ``splits_reader(ticker)`` gives the declared split lists the split guard
    judges with (default :func:`default_splits_reader` over the store, with
    ``split_fetch_budget`` provider fetches: :data:`AUTO_SPLIT_BUDGET` is the
    nightly default, ``declared_splits.DEFAULT_FETCH_BUDGET``, on a real run and 0
    (stored answers only) on a dry run; ``None`` is no limit)."""
    t0 = time.time()
    if not db or not str(db).strip():
        raise UsageError("--db is REQUIRED: the evidence store has no default path")
    if dry_run and publish_to:
        raise UsageError("--dry-run and --publish contradict each other")
    if sessions is not None and int(sessions) < 0:
        raise UsageError("--sessions must be 0 (every held session) or a positive count")
    sig = dict(signals) if signals is not None else dict(SIGNALS)
    hs = [int(h) for h in horizons]
    reader = bars_reader or default_bars_reader
    bench = str(benchmark).upper()
    names = sorted({str(t).upper() for t in (universe if universe is not None else default_universe())})
    requested_universe = len(names)
    names = [t for t in names if t != bench]       # rs of the benchmark against itself is 1.0 on
                                                   # every bar: a "new high" by the tie rule, every day

    receipt: Dict[str, object] = {
        "ok": False, "dry_run": bool(dry_run), "db": str(db), "benchmark": bench, "asof": None,
        "universe_requested": requested_universe, "universe": 0, "no_bars": 0,
        "sessions_held": 0, "sessions_requested": 0, "sessions_measured": 0, "sessions_skipped": 0,
        "pairs_measured": 0, "pairs_done": 0, "pairs_open": 0, "pairs_skipped": 0,
        "rows_written": 0, "events": 0, "split_tickers": 0, "split_skipped": 0, "split_unchecked": 0,
        "split_unchecked_by_signal": None, "split_lists": None, "elapsed_s": 0.0, "artifact": None, "publish": None,
    }

    # 1. the calendar
    asof_ymd = iso_to_ymd(asof) if asof else None
    newest = reader(bench, 1, asof_ymd or _FAR_FUTURE_YMD)
    if not newest:
        receipt["error"] = f"no {bench} daily bars at or before {asof or 'today'}"
        receipt["elapsed_s"] = round(time.time() - t0, 3)
        return receipt
    asof_ymd = int(newest[-1][0])
    receipt["asof"] = ymd_to_iso(asof_ymd)
    bench_depth = (int(sessions) if sessions else _ALL_SESSIONS_DEPTH) + WARMUP_BARS
    bench_rows = reader(bench, bench_depth, asof_ymd)
    bench_bars = rows_to_bars(bench_rows)
    sessions_held = [b["t"] for b in bench_bars]
    receipt["sessions_held"] = len(sessions_held)

    # 2. the checkpoint
    conn = S.open_store(db, horizons=hs, read_only=dry_run)
    try:
        cps = S.checkpoints(conn)
        unchecked = {s for s, _k in S.unchecked_pairs(conn)}
        plan = plan_sessions(sessions_held, int(sessions or 0), cps, list(sig), max(hs),
                             unchecked_sessions=sorted(unchecked))
        wanted, completable = plan["wanted"], plan["completable"]
        receipt["sessions_requested"] = len(plan["requested"])
        receipt["sessions_measured"] = len(wanted)
        receipt["sessions_skipped"] = len(plan["requested"]) - len(wanted)
        receipt["pairs_skipped"] = plan["pairs_skipped"]
        receipt["pairs_measured"] = sum(len(v) for v in wanted.values())
        split_reader = splits_reader
        if split_reader is None:
            budget = split_fetch_budget
            if budget == AUTO_SPLIT_BUDGET:
                from api.services.declared_splits import DEFAULT_FETCH_BUDGET
                budget = 0 if dry_run else DEFAULT_FETCH_BUDGET
            split_reader = default_splits_reader(conn, budget=budget, persist=not dry_run)

        # 3. the ticker loop
        mem_rows: List[Row] = []
        pair_rows: Dict[Tuple[int, str], int] = {}
        unchecked_names: Optional[set] = None       # None: the ticker loop did not run
        if not dry_run:
            S.discard_stage(conn)                   # rows of a run that died are never published
        if wanted:
            oldest = min(wanted)
            # bars from the oldest wanted session to asof, plus the warm-up before it
            depth = (len(sessions_held) - sessions_held.index(oldest)) + WARMUP_BARS
            if dry_run:
                def sink(ticker: str, rows: List[Row]) -> None:
                    mem_rows.extend(rows)
            else:
                written = {"n": 0}

                def sink(ticker: str, rows: List[Row]) -> None:
                    S.write_rows(conn, rows, hs, table=S.STAGE_TABLE)
                    for r in rows:
                        pair_rows[(r[0], r[1])] = pair_rows.get((r[0], r[1]), 0) + 1
                    written["n"] += 1
                    if written["n"] % 50 == 0:
                        conn.commit()
            stats = collect(names, reader, asof_ymd=asof_ymd, depth=depth, bench_bars=bench_bars,
                            wanted=wanted, signals=sig, horizons=hs, sink=sink, splits_reader=split_reader)
            receipt["universe"] = stats["tickers"]
            receipt["no_bars"] = stats["no_bars"]
            receipt["rows_written"] = stats["rows"]
            receipt["events"] = stats["events"]
            for k in ("split_tickers", "split_skipped", "split_unchecked"):
                receipt[k] = stats[k]
            unchecked_names = set(stats["split_unchecked_names"])
            lists = getattr(split_reader, "stats", None)
            receipt["split_lists"] = dict(lists) if isinstance(lists, dict) else None
            # ⭐ AN UNKNOWN SPLIT LIST KEEPS THE SESSION OPEN while the provider can
            # still answer (review, 2026-11-07). A `done` pair is never asked for
            # again, so closing sessions over names measured unguarded made N5 a
            # one-shot: the first run's 600-list budget guarded ~600 of ~3,700
            # names forever. Open, they are re-measured each night as the memo
            # fills. Only a list left unknown because THIS run ran out of fetches or
            # of brake wait keeps them open: a later night can answer that. A name
            # the provider refused, or a missing key (`split_lists.no_key`), would
            # hold them open forever, so those close as before and stay counted.
            guard_pending = bool(stats["split_unchecked"]) and isinstance(lists, dict) and (
                bool(lists.get("budget_exhausted")) or bool(lists.get("gate_wait_capped")))
            receipt["split_guard_pending"] = guard_pending
            if not dry_run:
                marks: Dict[Tuple[int, str], Tuple[str, int]] = {}
                for s, ks in wanted.items():
                    status = S.DONE if completable[s] and not guard_pending else S.OPEN
                    for k in ks:
                        marks[(s, k)] = (status, pair_rows.get((s, k), 0))
                        receipt["pairs_done" if status == S.DONE else "pairs_open"] += 1
                S.swap_in(conn, marks, hs)
        elif not dry_run and unchecked:
            S.swap_in(conn, {}, hs)                 # nothing to measure: still drop unchecked rows

        # 4. the artifact
        if dry_run:
            summary = summarise(mem_rows, hs)
            counted = [r for r in mem_rows if r[3] is not None]     # the store's `skip = 0`
            sessions_n = len({r[0] for r in counted if r[1] == BASELINE_KEY})
            open_n = sum(1 for s in wanted if not completable[s])
            universe_n = len({r[2] for r in counted if r[1] == BASELINE_KEY})
            lo = min((r[0] for r in counted if r[1] == BASELINE_KEY), default=None)
            hi = max((r[0] for r in counted if r[1] == BASELINE_KEY), default=None)
        else:
            summary = S.summary(conn, hs)
            w = S.window(conn)
            sessions_n, open_n, universe_n, lo, hi = (w["sessions"], w["sessions_open"], w["universe"],
                                                      w["from"], w["to"])
        # The unchecked-split disclosure (unit VA3): this run's unknown lists, and
        # per signal how many of those names hold counted rows of it. Every real
        # run measures every name (the newest session is always still open), so
        # a run whose ticker loop did not run judged nothing and says null.
        by_signal: Optional[Dict[str, int]] = None
        unchecked_n: Optional[int] = None
        if unchecked_names is not None:
            if dry_run:
                by_signal = {}
                for signal, _t in {(r[1], r[2]) for r in mem_rows
                                   if r[3] is not None and r[2] in unchecked_names}:
                    by_signal[signal] = by_signal.get(signal, 0) + 1
            else:
                by_signal = S.tickers_by_signal(conn, unchecked_names)
            unchecked_n = len(unchecked_names)
        receipt["split_unchecked_by_signal"] = by_signal
        artifact = build_artifact(summary, asof_ymd=asof_ymd, benchmark=bench, window_from=lo, window_to=hi,
                                  sessions=sessions_n, sessions_open=open_n, universe=universe_n,
                                  universe_requested=requested_universe, delisted_fn=delisted_fn,
                                  signals=sig, horizons=hs, split_unchecked=unchecked_n,
                                  split_unchecked_by_signal=by_signal)
        receipt["artifact"] = {
            "rows": artifact["rows"], "sessions": artifact["sessions"], "sessions_open": artifact["sessions_open"],
            "universe": artifact["universe"], "window": artifact["window"],
            "delisted_count": artifact["delisted_count"], "publishable": artifact["rows"] >= MIN_ROWS,
            "per_signal": {k: {"n_signals": v["n_signals"], "dates": v["dates"],
                               "horizons": {h: {"n": x["n"], "hit_rate": x["hit_rate"],
                                                "median_excess": x["median_excess"]}
                                            for h, x in v["horizons"].items()}}
                           for k, v in artifact["per_signal"].items()},
            "baseline": {h: {"n": x["n"], "hit_rate": x["hit_rate"], "median_excess": x["median_excess"]}
                         for h, x in artifact["baseline"].items()},
            "split_skipped": artifact["split_guard"]["skipped"],
            "split_unchecked": artifact["split_guard"]["unchecked"],
        }
        receipt["ok"] = True

        # 5. publish
        if publish_to and not dry_run:
            receipt["publish"] = publish(artifact, dest=publish_to, put_bytes=put_bytes)
            receipt["ok"] = bool(receipt["publish"]["published"])
        receipt["elapsed_s"] = round(time.time() - t0, 3)
        if conn is not None and not dry_run:
            S.record_run(conn, receipt)
        return receipt
    finally:
        if conn is not None:
            conn.close()
