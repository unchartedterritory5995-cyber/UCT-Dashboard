"""Gentle universe 5m warm crawler — instant-origin Phase 2, v2.

WHY THIS EXISTS (the lesson from v1). The first attempt at universe-wide 5m warming
dumped ~3,200 shallow jobs into the worker's existing boot pass, which runs FOUR
concurrent warm threads. On 2026-08-19 that thrashed the worker's bars.db write-lock
(`database is locked`) and saturated the market-data provider, starving the web pod's
on-demand fetches — a self-inflicted post-close slowdown. Root cause: bulk + concurrent.

This crawler is built to be the OPPOSITE, by construction:
  • SINGLE in-flight fetch at a time (one thread) — so it can NEVER contend on the
    write-lock with itself the way 4 boot threads did.
  • RATE-LIMITED: it sleeps a fixed interval AFTER EACH ACTUAL fetch (not per
    iteration), so a cold universe fills over hours at a trickle the provider never
    notices, while an already-warm universe is swept for free (skips are instant).
  • DECOUPLED from the boot pass + refresh loop — it just cycles the universe forever,
    warming only the tickers whose 5m is MISSING or a whole SESSION stale, skipping the
    rest. Idempotent: re-passes over a warm universe cost ~nothing.

Net effect: every ticker ends up with a recent 5m tail in the store, so its first 5m
open is an instant local serve (the async-heal path tops it up non-blocking). The goal
the boot-bulk approach was reaching for, without the load spike.

Runs on the WORKER, gated by BARS_UNIVERSE_CRAWLER_ENABLED (default OFF). Supervised +
heartbeated like the prewarmer. Ship dark; enable + watch AFTER 8 PM ET.
"""
from __future__ import annotations

import json
import os
import threading
import time as _time

log_prefix = "[uni-crawler]"

# Liveness/telemetry for the worker health endpoint + a future watchdog.
_STATE_LOCK = threading.Lock()
_STATE: dict = {
    "enabled": None, "last_beat_ts": None, "warmed_total": 0, "skipped_total": 0,
    "empty_total": 0, "empty_parked": 0, "passes": 0, "cursor": 0, "universe": 0,
    "last_warm_sym": None, "last_error": None, "restarts": 0, "tail_cohort": 0,
    "no_advance_total": 0,
}


def _beat():
    with _STATE_LOCK:
        _STATE["last_beat_ts"] = _time.time()


def crawler_heartbeat() -> dict:
    """Snapshot for the worker health endpoint. `alive` = a unit of work within the
    last ~45 min (covers the idle sleep when the whole universe is already fresh)."""
    with _STATE_LOCK:
        s = dict(_STATE)
    beat = s.get("last_beat_ts")
    s["age_seconds"] = (_time.time() - beat) if beat else None
    s["alive"] = bool(beat and (_time.time() - beat) < 2700)
    return s


def _enabled() -> bool:
    return os.environ.get("BARS_UNIVERSE_CRAWLER_ENABLED", "0") == "1"


def load_universe() -> list[str]:
    """cap_universe.json tickers (upper-cased, de-duped, order-preserving)."""
    path = os.path.join(os.path.dirname(__file__), "..", "data", "cap_universe.json")
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
    except Exception:
        return []
    out, seen = [], set()
    for row in raw:
        t = row if isinstance(row, str) else (row.get("ticker") or row.get("symbol") if isinstance(row, dict) else None)
        if not t:
            continue
        u = t.upper()
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def tail_cohort(reference_syms, base_universe, *, enabled: bool, cap: int,
                dollar_volume=None, has_5m=None, discovery_every=5) -> list[str]:
    """A BOUNDED, RANKED slice of the reference long tail to append after `base_universe`.

    ⛔⛔ THE TAIL IS WHY BFRG HAD NO 5m CHART, AND IT IS NOT IN ANY INTRADAY LIST.
    `load_universe()` reads cap_universe.json (3,640). The ~22k active reference symbols
    outside it are warmed D/W/M only — "instant every symbol" made DAILY universe-wide
    and left intraday behind. So a member can search BFRG, open its daily, and find no
    5m. Measured 2026-09-23: BFRG / SNGX / GRRR / CNEY / VRME are all absent from
    cap_universe.json.

    ⛔ IT BELONGS HERE AND NOT IN THE BOOT PASS. v1 of this initiative put ~3,200 shallow
    jobs into the worker's FOUR-thread boot pass and on 2026-08-19 thrashed the bars.db
    write-lock and saturated the provider. This crawler is single-in-flight and paced, so
    widening WHAT it walks does not widen the RATE it walks at — the cohort costs the same
    1-fetch-per-interval trickle, just for longer.

    ⭐ RANKED, so a bounded cohort is the most useful names rather than the alphabet:
    highest 20-session average dollar volume first, from local daily bars
    (`avg_dollar_volume_bulk`). Ties and unmeasurable symbols fall back to alphabetical,
    so the cohort is DETERMINISTIC across restarts — a cohort that churns re-buys itself.

    ⚠️⚠️ FAIL SAFE, NOT FAIL OPEN. A missing/garbage/negative cap yields ZERO, never the
    full ~22k: a configuration slip must not become 20,000 unplanned provider calls. The
    caller opts in with a flag AND a bound, and both have to be right.
    """
    if not enabled:
        return []
    try:
        n = int(cap)
    except (TypeError, ValueError):
        return []
    if n <= 0:
        return []
    base = set(base_universe or ())
    dv = {str(k).upper(): float(v) for k, v in (dollar_volume or {}).items()}
    # ⚠️ INDEX ROWS ARE FILTERED HERE, NOT ONLY IN THE CALLER. `I:`-prefixed symbols
    # have no 5m OHLC series (indices warm via `index_bars`), so crawling one spends a
    # provider call to learn nothing. Defending it in the pure function means a second
    # caller cannot reintroduce it.
    cands = sorted({str(s).strip().upper() for s in (reference_syms or ()) if s} - base)
    cands = [t for t in cands if not t.startswith("I:")]
    cands.sort(key=lambda t: (-dv.get(t, 0.0), t))
    if has_5m is None:
        return cands[:n]
    # ⭐ CAPABILITY PREFERENCE, APPLIED WITHIN THE EXISTING RANKING — not instead of it.
    # Dollar volume still decides the order inside each group; capability only decides
    # which group you are in. Measured 2026-09-24 on a deterministic n=80 spread of the
    # 9,645 tail CANDIDATES: **82.5% hold no 5m rows at all** (preferreds AHLPE/BHRPB,
    # units ALUB.U, tiny ETFs BRRR/BULZ), against 0.0% in cap_universe. So a rank-only
    # tail spends most of a fixed 1-fetch-per-3s budget on instruments that have never
    # produced an intraday series.
    #
    # ⚠️ THAT 82.5% IS THE CANDIDATE POOL, NOT THIS COHORT. The cohort is the
    # dollar-volume-ranked top slice, which is a better-selected subset; treat the
    # sample as evidence that preference is worth trying, never as this cohort's rate.
    #
    # ⛔ NOT A FILTER — `discovery_every` RESERVES slots for unproven names, because
    # no rows -> never crawled -> never any rows is a closed loop that would lock out
    # every new listing, newly supported instrument and symbol-normalisation fix. The
    # evidence used is POSITIVE ONLY (`get_last_ts(sym,'5') is not None` = this symbol
    # has previously produced a validated stored 5m row). That is CAPABILITY evidence,
    # NOT freshness: it says nothing about current, deep or complete.
    proven, unknown = [], []
    for t in cands:
        try:
            (proven if has_5m(t) else unknown).append(t)
        except Exception:      # noqa: BLE001 — an unreadable store must not empty the cohort
            proven.append(t)
        if len(proven) + len(unknown) >= n * 4:
            break              # bounded scan: never walk 9,645 candidates for 2,500 slots
    step = max(2, int(discovery_every))
    out, pi, ui = [], 0, 0
    for i in range(n):
        if ((i + 1) % step == 0) and ui < len(unknown):
            out.append(unknown[ui]); ui += 1
        elif pi < len(proven):
            out.append(proven[pi]); pi += 1
        elif ui < len(unknown):
            out.append(unknown[ui]); ui += 1
        else:
            break
    return out


def crawl_pass(universe, cursor, *, is_stale, warm, pace, beat=lambda: None,
               on_warm=lambda sym: None, on_empty=lambda sym: None,
               on_no_advance=lambda sym: None, budget=None):
    """ONE sweep of the universe starting at `cursor`, warming only stale/missing 5m.

    Pure control flow with every side-effect INJECTED, so the pacing + skip logic is
    unit-testable without a network, SQLite, or real sleeps:
      • is_stale(sym) -> bool : True when this ticker's 5m needs warming (missing or a
        whole session behind) AND is not in the no-data cooldown. Skipped tickers cost
        nothing (no pace()).
      • warm(sym) -> bool     : perform the single synchronous shallow 5m fetch+store;
        return True if rows were actually stored, False if the fetch came back EMPTY
        (thin/inactive ticker with no valid recent 5m — nothing to warm).
      • pace()               : the rate-limit — called after every ATTEMPT (fill OR
        empty), because both hit the provider. Skips never pace.
      • beat()               : liveness heartbeat, called each step.
      • on_warm(sym)/on_empty(sym): telemetry + the no-data cooldown hook.
      • budget (int|None)     : stop after this many ATTEMPTS this pass (None = full).

    Returns (new_cursor, filled, skipped, empty, no_advance). The four outcomes are
    deliberately distinct: SKIPPED means the fetch was never attempted (fresh or parked);
    NO_ADVANCE means it was attempted and the symbol already held valid 5m that simply
    did not move; NO_DATA/empty means it was attempted and nothing usable came back;
    FILLED means the tail advanced. Collapsing the middle two is the defect this fixes.
    """
    n = len(universe)
    filled = skipped = empty = no_advance = 0
    if n == 0:
        return cursor, 0, 0, 0, 0
    i = cursor % n
    attempts = 0
    for _ in range(n):
        sym = universe[i]
        i = (i + 1) % n
        beat()
        try:
            if not is_stale(sym):
                skipped += 1
                continue
            # ⭐ THREE OUTCOMES, NOT TWO. `warm` may return the legacy bool (True =
            # warmed, False = no usable data) or one of WARMED / NO_ADVANCE / NO_DATA.
            # Only genuine NO_DATA parks: a symbol that already holds valid 5m and
            # merely printed nothing new has PROVEN capability and must not be filed
            # as unsupported. It still costs a provider call, so it still paces.
            res = warm(sym)
            outcome = (WARMED if res is True else NO_DATA if res is False else res)
            if outcome == WARMED:
                filled += 1
                on_warm(sym)
            elif outcome == NO_ADVANCE:
                no_advance += 1
                on_no_advance(sym)
            else:
                empty += 1
                on_empty(sym)   # cooldown so we don't retry a no-data ticker every pass
            pace()
            attempts += 1
        except Exception:
            # A bad ticker never stops the sweep; it retries next pass.
            skipped += 1
        if budget is not None and attempts >= budget:
            break
    return i, filled, skipped, empty, no_advance


# Tickers that came back EMPTY (no valid recent 5m — thin/inactive) are parked here
# until `expiry_ts` so the crawler doesn't burn a provider call retrying them every
# pass. This is what lets a run SETTLE: once the warmable tickers are warm and the
# unwarmable ones are parked, a sweep is all-skips → the daemon idles.
_NO_DATA_UNTIL: dict[str, float] = {}


def _empty_cooldown_secs() -> int:
    return int(os.environ.get("BARS_CRAWLER_EMPTY_COOLDOWN_SEC", "21600"))  # 6h


def _mark_empty(sym: str) -> None:
    _NO_DATA_UNTIL[sym] = _time.time() + _empty_cooldown_secs()
    with _STATE_LOCK:
        _STATE["empty_parked"] = len(_NO_DATA_UNTIL)


def _default_is_stale(sym: str) -> bool:
    """5m needs warming when it is MISSING entirely or missing >=1 whole session AND
    it isn't parked in the no-data cooldown. Same-session-fresh tickers (already warmed
    today) are skipped. Uses the serve path's own cold-stale predicate so the crawler
    and the chart agree."""
    exp = _NO_DATA_UNTIL.get(sym)
    if exp is not None:
        if _time.time() < exp:
            return False           # parked: known no-data, don't retry yet
        _NO_DATA_UNTIL.pop(sym, None)   # cooldown elapsed → allow one retry
    from api.services import bars_sqlite as _sqlite
    from api.services.bars_fetch import _is_cold_stale_intraday
    last_ts = _sqlite.get_last_ts(sym, "5")
    if last_ts is None:
        return True
    return _is_cold_stale_intraday("5", last_ts)


#: The three things an attempted crawl can actually mean. `WARMED` and `NO_DATA` are the
#: outcomes this module always had; `NO_ADVANCE` is the one it was hiding.
WARMED = "warmed"
NO_ADVANCE = "no_advance"
NO_DATA = "no_data"


def _default_warm(sym: str, depth: int):
    """One paced shallow 5m warm. Returns WARMED / NO_ADVANCE / NO_DATA.

    ⛔⛔ THIS USED TO RETURN A BOOL, AND THE FALSE BRANCH WAS TWO DIFFERENT FACTS.
    It answered `after is not None and (before is None or after > before)` — "did the
    stored tail advance?" — and everything else was reported as EMPTY and parked in the
    no-data cooldown. But a symbol holding perfectly valid 5m bars that simply did not
    PRINT since the last pass lands in that same branch. An illiquid name that did not
    trade is cold-stale, so it is attempted; the provider correctly returns nothing new;
    the tail does not move; and the crawler concluded "no usable 5m data" about a series
    a member could chart right now.

    ⭐ MEASURED 2026-09-24 by indexed point lookups (n=80 deterministic spread each):
    in cap_universe **0.0%** of symbols have no 5m rows at all, while 12.5% hold rows and
    are cold-stale — so the BASE population's "empty" outcomes were ENTIRELY this
    misclassification. In the reference tail the picture inverts (82.5% hold no rows), so
    there the label was mostly right. One counter was averaging two different populations
    and two different meanings, which is why "46% empty" never meant what it looked like.

    ⚠️ NO_DATA IS STILL A REAL OUTCOME and still parks: `after is None` after an attempt
    means nothing usable came back. Only the no-advance case is rescued.
    """
    from api.routers.bars import _get_bars_inner
    from api.services import bars_sqlite as _sqlite
    before = _sqlite.get_last_ts(sym, "5")
    _get_bars_inner(sym, "5", depth)
    after = _sqlite.get_last_ts(sym, "5")
    if after is None:
        return NO_DATA
    if before is not None and after <= before:
        return NO_ADVANCE
    return WARMED


def run_universe_crawler_forever():
    """Blocks forever: gentle single-threaded rate-limited 5m warm of the whole
    universe. No-ops unless BARS_UNIVERSE_CRAWLER_ENABLED=1."""
    if not _enabled():
        with _STATE_LOCK:
            _STATE["enabled"] = False
        print(f"{log_prefix} disabled (set BARS_UNIVERSE_CRAWLER_ENABLED=1 to enable)")
        return
    universe = load_universe()
    # ── PILOT: a bounded, ranked slice of the reference long tail ──────────────
    # Both a FLAG and a BOUND are required, and the bound fails safe to zero. Walking
    # more symbols does not walk them faster: the pace is unchanged, so the cohort is
    # the same trickle for longer (2,500 x BARS_CRAWLER_FETCH_INTERVAL_SEC).
    _tail = []
    try:
        if os.environ.get("PREWARM_5M_REF_TAIL", "0") == "1":
            from api.services import massive as _massive
            from api.services import bars_sqlite as _bsq
            from api.services.bars_fetch import _expected_latest_session_yyyymmdd
            from datetime import datetime as _dt, timedelta as _td
            from zoneinfo import ZoneInfo as _ZI
            _rows = _massive.list_reference_tickers(active=True, market="stocks")
            _ref = [(r.get("ticker") or "").strip().upper() for r in (_rows or [])]
            _ref = [t for t in _ref if t and not t.startswith("I:")]
            _floor = int((_dt.now(_ZI("America/New_York")) - _td(days=90)).strftime("%Y%m%d"))
            _dv = _bsq.avg_dollar_volume_bulk(20, _expected_latest_session_yyyymmdd(), _floor)
            # Capability preference uses the DURABLE positive evidence already in the
            # store (an indexed point lookup per candidate, bounded to 4x the cap).
            _seen5 = {}

            def _has5(sym, _c=_seen5):
                v = _c.get(sym)
                if v is None:
                    v = _bsq.get_last_ts(sym, "5") is not None
                    _c[sym] = v
                return v

            _tail = tail_cohort(
                _ref, universe, enabled=True,
                cap=os.environ.get("PREWARM_5M_REF_TAIL_CAP", "2500"),
                dollar_volume=_dv,
                has_5m=(_has5 if os.environ.get("CRAWLER_TAIL_CAPABILITY", "1") == "1" else None),
                discovery_every=int(os.environ.get("CRAWLER_TAIL_DISCOVERY_EVERY", "5")),
            )
            _prov = sum(1 for t in _tail if _seen5.get(t))
            print(f"{log_prefix} reference-tail pilot: +{len(_tail)} ranked symbols "
                  f"(cap={os.environ.get('PREWARM_5M_REF_TAIL_CAP', '2500')}, "
                  f"{len(_ref)} reference, {len(_dv)} with a local dollar-volume metric); "
                  f"capability: {_prov} proven-capable + {len(_tail) - _prov} discovery")
            universe = universe + _tail
    except Exception as e:                       # noqa: BLE001
        # The pilot must never be able to stop the crawler doing its existing job.
        print(f"{log_prefix} reference-tail pilot unavailable, crawling base universe: {e}")
    with _STATE_LOCK:
        _STATE["enabled"] = True
        _STATE["universe"] = len(universe)
        _STATE["tail_cohort"] = len(_tail)
    if not universe:
        print(f"{log_prefix} no universe loaded — nothing to crawl")
        return

    interval = float(os.environ.get("BARS_CRAWLER_FETCH_INTERVAL_SEC", "3.0"))
    depth = int(os.environ.get("BARS_CRAWLER_5M_BARS", "780"))
    idle_sleep = int(os.environ.get("BARS_CRAWLER_IDLE_SLEEP_SEC", "600"))
    print(f"{log_prefix} started: {len(universe)} tickers, 1 fetch / {interval}s, "
          f"depth={depth} (single-threaded, skip-fresh)")

    cursor = 0
    while True:
        _beat()
        def _pace():
            _time.sleep(interval)
            _beat()

        def _on_warm(sym):
            with _STATE_LOCK:
                _STATE["warmed_total"] += 1
                _STATE["last_warm_sym"] = sym

        try:
            cursor, filled, skipped, empty, no_adv = crawl_pass(
                universe, cursor,
                is_stale=_default_is_stale,
                warm=lambda s: _default_warm(s, depth),
                pace=_pace, beat=_beat, on_warm=_on_warm, on_empty=_mark_empty,
            )
            with _STATE_LOCK:
                _STATE["passes"] += 1
                _STATE["cursor"] = cursor
                _STATE["skipped_total"] += skipped
                _STATE["empty_total"] += empty
                _STATE["no_advance_total"] += no_adv
            print(f"{log_prefix} pass complete: {filled} filled, {empty} no-data(parked), "
                  f"{no_adv} no-advance(kept), {skipped} skipped, "
                  f"{len(_NO_DATA_UNTIL)} parked total")
            if filled == 0 and empty == 0 and no_adv == 0:
                # Whole universe already fresh/parked — idle instead of hot-looping skips.
                _time.sleep(idle_sleep)
        except Exception as e:  # pragma: no cover - defensive
            with _STATE_LOCK:
                _STATE["last_error"] = str(e)[:180]
            print(f"{log_prefix} pass crashed (non-fatal): {e}")
            _time.sleep(60)


def run_universe_crawler_supervised():
    """Restart the crawler (bounded backoff) if it ever exits/raises, so warming can't
    stop permanently from a single unhandled error."""
    backoff = 5
    while True:
        try:
            run_universe_crawler_forever()
            return  # returned normally = disabled; nothing to supervise
        except Exception as e:  # pragma: no cover
            with _STATE_LOCK:
                _STATE["restarts"] += 1
                _STATE["last_error"] = f"restart: {str(e)[:180]}"
            print(f"{log_prefix} crashed — restarting in {backoff}s: {e}")
            _time.sleep(backoff)
            backoff = min(backoff * 2, 300)
