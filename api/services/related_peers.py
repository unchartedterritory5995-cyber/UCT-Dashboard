"""Licensed peers for `PEER`: Massive's related-companies list, held nightly (gap audit item D7).

Until this module `PEER` worked its peers out on every request (the stock's UCT theme, else its
industry, else the index board, else an AI model's guess, cached six hours: `groups.resolve_peers`).
Massive's related-companies route is in the site's stock plan (capability inventory: "Included in
the plan, not called") and had never been called. This module holds its answer for every stock in
the site's universe, built at night, so `PEER` reads a licensed list that is already there.

  the vendor route   GET /v1/related-companies/{ticker} (Massive reference data). The shape this
                     code reads, as the vendor's documentation gives it: `results[]` of objects with
                     a `ticker`; the order is the vendor's own (closest first). NOBODY HAS CALLED IT
                     WITH THIS SITE'S KEY: the code could not be run against the vendor when it was
                     written, so every way it can go wrong is a stated outcome (below), never a crash.
                     Read through the house adapter (`massive_adapter.get`), so it shares the one
                     client, the one token bucket and the one error model. Licensing class: Massive
                     `reference` (T-07, member display), the class every other Massive reference
                     route here carries.

  the nightly build  `run_nightly()` (api/main.py registers it on the web scheduler, weekdays
                     21:15 ET, only when PEER_RELATED_NIGHTLY_ENABLED=1; DARK by default because it
                     adds vendor calls). A ROLLING refresh, so the load stays small:
                       * the stocks with no held answer go first, then the oldest;
                       * a stock is asked again only when its answer is older than REFRESH_AGE_S
                         (7 days);
                       * at most NIGHT_MAX (1,000) vendor calls a night, paced PACE_S (0.5 s) apart,
                         so a run takes about 8 minutes and leaves the shared bucket (300 a minute)
                         to the members' own requests.
                     With 3,639 stocks in api/data/cap_universe.json the first fill takes 4 nights;
                     after that about 520 calls a night (3,639 / 7).
                     RETRIES: a rate limit or a transient vendor failure is tried RETRIES (2) more
                     times with a growing wait; a stock that still fails keeps its old answer and is
                     first in line next night. RESUME: progress is written to disk every SAVE_EVERY
                     stocks and at the end, so a restart mid-run loses at most that many answers.
                     STOP: a refused key (401 / 403 / the adapter's remembered refusal), no key on the
                     server, FAIL_STOP failures in a row, or NOT_FOUND_STOP "not found" answers before
                     any stock answers at all (the route is not there for this key) ends the run at
                     once; the reason is held in `status()` and logged on one `[related-peers]` line.
                     A "not found" for one stock, once the route has answered, is held as "the vendor
                     lists no related companies" and asked again after REFRESH_AGE_S.

  the store          <DATA_DIR>/related_peers/peers_v1.json (the short-interest store's pattern:
                     DATA_DIR, atomic write through a temp file). Stocks that left the universe are
                     dropped on each write. The raw vendor list is kept; what `PEER` may show is
                     decided when it is read, so a universe change never needs a rebuild.

  the reader         `held_peers(sym, n, chartable)` never asks the vendor and never builds. It
                     answers the held list cut to stocks the app can chart, in the vendor's order,
                     or None when nothing usable is held (no answer, an answer older than
                     MAX_SERVE_AGE_S, or fewer than MIN_PEERS chartable names). `groups.resolve_peers`
                     reads it first when the caller asks for licensed peers (`PEER` does), and keeps
                     today's logic, unchanged, as the fallback. It is also the held-only read a later
                     UCT Agent kind for PEER would use.

Every number above is the builder's default, not an owner ruling.
"""
from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Optional

_log = logging.getLogger(__name__)

FLAG = "PEER_RELATED_NIGHTLY_ENABLED"
PATH_FMT = "/v1/related-companies/{ticker}"
DATA_CLASS = "reference"
ACTIVITY = "related_peers.nightly"
SOURCE = "licensed"
SOURCE_NAME = "Massive related companies"
GROUP_NAME = "Related companies"

# ── defaults (each one is the builder's, not an owner ruling) ────────────────────────────────
REFRESH_AGE_S = 7 * 86400.0       # a held answer is asked again after this long
MAX_SERVE_AGE_S = 45 * 86400.0    # an answer older than this is not served (PEER falls back)
NIGHT_MAX = 1000                  # vendor calls in one night's run, retries not counted
PACE_S = 0.5                      # wait between two stocks (2 a second at most)
RETRIES = 2                       # extra tries for a rate limit or a transient failure
RETRY_WAIT_S = (2.0, 6.0)         # the wait before each extra try (a vendor retry_after wins)
SAVE_EVERY = 100                  # stocks between two disk writes (the resume point)
FAIL_STOP = 10                    # failures in a row that end the run
NOT_FOUND_STOP = 20               # "not found" answers, before any stock answered, that end the run
MIN_PEERS = 3                     # fewer chartable peers than this is "nothing held" for PEER
VENDOR_TIMEOUT_S = 20.0
DISK_VERSION = 1

_SYMBOL = re.compile(r"^[A-Z]{1,6}(?:[.\-][A-Z]{1,2})?$")

_lock = threading.Lock()
_run_lock = threading.Lock()
_state: dict[str, Any] = {"held": None, "mtime": None, "last_run": None}


# ── where it lives ───────────────────────────────────────────────────────────────────────────

def enabled() -> bool:
    return os.environ.get(FLAG, "0") == "1"


def _data_dir() -> Optional[str]:
    base = os.environ.get("DATA_DIR", "/data")
    return base if os.path.isdir(base) else None


def disk_path() -> Optional[str]:
    base = _data_dir()
    return os.path.join(base, "related_peers", f"peers_v{DISK_VERSION}.json") if base else None


def norm(sym: Any) -> str:
    """The app's canonical form: upper case, hyphen class shares (BRK-B)."""
    return str(sym or "").strip().upper().replace(".", "-")


def vendor_ticker(sym: str) -> str:
    """Massive's form: dot class shares (BRK.B)."""
    return norm(sym).replace("-", ".")


def universe() -> list[str]:
    """The site's stock universe, sorted. Empty when its file cannot be read (cannot build)."""
    from api.services import cap_universe
    return sorted({norm(s) for s in cap_universe.symbols() if s})


# ── the store ────────────────────────────────────────────────────────────────────────────────

def _empty() -> dict:
    return {"version": DISK_VERSION, "peers": {}, "last_run": None}


def _load() -> dict:
    """The held store, re-read only when the file changed (another worker process may own the
    scheduler and write it). Never raises: an unreadable file is an empty store."""
    path = disk_path()
    try:
        mtime = os.path.getmtime(path) if path and os.path.exists(path) else None
    except OSError:
        mtime = None
    with _lock:
        if _state["held"] is not None and _state["mtime"] == mtime:
            return _state["held"]
    held = _empty()
    if mtime is not None:
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, dict) and data.get("version") == DISK_VERSION and isinstance(data.get("peers"), dict):
                held = data
        except Exception as exc:  # noqa: BLE001 -- a bad file is "nothing held", said once
            _log.warning("[related-peers] store unreadable (%s); serving nothing held", type(exc).__name__)
    with _lock:
        _state["held"] = held
        _state["mtime"] = mtime
    return held


def _save(held: dict, keep: Optional[set] = None) -> None:
    path = disk_path()
    if not path:
        return
    if keep:
        held["peers"] = {k: v for k, v in held["peers"].items() if k in keep}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".peers_", suffix=".tmp", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(held, fh, separators=(",", ":"), sort_keys=True)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    with _lock:
        _state["held"] = held
        try:
            _state["mtime"] = os.path.getmtime(path)
        except OSError:
            _state["mtime"] = None


# ── the vendor ───────────────────────────────────────────────────────────────────────────────

def _vendor_get(sym: str) -> dict:
    """ONE vendor request through the house adapter: the JSON object as sent. Raises `ProviderError`."""
    from api.services import massive_adapter
    path = PATH_FMT.format(ticker=vendor_ticker(sym))
    return massive_adapter.get(path, data_class=DATA_CLASS, activity=ACTIVITY,
                               timeout=VENDOR_TIMEOUT_S).value


def parse(sym: str, data: Any) -> Optional[list[str]]:
    """The related tickers in the vendor's order: canonical form, de-duplicated, the stock itself
    removed. None when the answer is not the shape this code reads (no `results` list)."""
    if not isinstance(data, dict):
        return None
    rows = data.get("results")
    if rows is None:
        return []          # the vendor answered and lists nothing
    if not isinstance(rows, list):
        return None
    self_sym = norm(sym)
    seen, out = {self_sym}, []
    for row in rows:
        t = norm(row.get("ticker") if isinstance(row, dict) else row)
        if t and _SYMBOL.match(t) and t not in seen:
            seen.add(t)
            out.append(t)
    return out


def due(held: dict, syms: Iterable[str], now: float) -> list[str]:
    """The stocks to ask tonight, in order: never held first (universe order), then the oldest
    held answers. A stock asked less than REFRESH_AGE_S ago is not due."""
    peers = held.get("peers", {})
    missing, stale = [], []
    for s in syms:
        row = peers.get(s)
        at = row.get("at") if isinstance(row, dict) else None
        if not isinstance(at, (int, float)):
            missing.append(s)
        elif now - at >= REFRESH_AGE_S:
            stale.append((at, s))
    stale.sort()
    return missing + [s for _, s in stale]


class _Stop(Exception):
    def __init__(self, reason: str, status: Optional[int] = None):
        super().__init__(reason)
        self.reason = reason
        self.status = status


def _ask(sym: str, fetch: Callable[[str], dict], sleep: Callable[[float], None]) -> tuple[str, Optional[list]]:
    """('ok', peers) | ('not_found', []) | ('failed', None). Raises `_Stop` for a refusal."""
    from api.services import provider_errors as pe
    for attempt in range(RETRIES + 1):
        try:
            out = parse(sym, fetch(sym))
            return ("ok", out) if out is not None else ("failed", None)
        except pe.ProviderNotFound:
            return "not_found", []
        except pe.ProviderAuthError as exc:
            raise _Stop("refused", exc.status or 403) from None
        except pe.ProviderNotConfigured:
            raise _Stop("not_configured") from None
        except (pe.ProviderRateLimited, pe.ProviderTransient) as exc:
            if attempt >= RETRIES:
                return "failed", None
            wait = getattr(exc, "retry_after", None)
            sleep(float(wait) if isinstance(wait, (int, float)) and 0 < wait <= 60
                  else RETRY_WAIT_S[min(attempt, len(RETRY_WAIT_S) - 1)])
        except pe.ProviderError:
            return "failed", None
        except Exception:  # noqa: BLE001 -- one stock's failure never ends the build thread
            return "failed", None
    return "failed", None


def build(*, fetch: Optional[Callable[[str], dict]] = None, sleep: Callable[[float], None] = time.sleep,
          now: Optional[Callable[[], float]] = None, syms: Optional[list[str]] = None,
          limit: int = NIGHT_MAX) -> dict:
    """One rolling refresh. Returns (and holds) a record of what it did. Single flight."""
    fetch = fetch or _vendor_get
    clock = now or time.time
    if not _run_lock.acquire(blocking=False):
        return {"state": "skipped", "reason": "already_running"}
    try:
        started = clock()
        syms = universe() if syms is None else [norm(s) for s in syms]
        rec: dict[str, Any] = {"state": "done", "reason": None, "status": None,
                               "started": _iso(started), "universe": len(syms), "calls": 0,
                               "ok": 0, "not_found": 0, "failed": 0, "due": 0}
        if not syms:
            rec.update(state="stopped", reason="no_universe")
            return _finish(rec)
        held = _load()
        held = {"version": DISK_VERSION, "peers": dict(held.get("peers", {})), "last_run": held.get("last_run")}
        todo = due(held, syms, started)
        rec["due"] = len(todo)
        todo = todo[:max(0, int(limit))]
        answered = False
        fails_in_row = 0
        unsaved = 0
        for i, sym in enumerate(todo):
            if i:
                sleep(PACE_S)
            rec["calls"] += 1
            try:
                outcome, peers = _ask(sym, fetch, sleep)
            except _Stop as stop:
                rec.update(state="stopped", reason=stop.reason, status=stop.status)
                break
            if outcome == "failed":
                rec["failed"] += 1
                fails_in_row += 1
                if fails_in_row >= FAIL_STOP:
                    rec.update(state="stopped", reason="failures_in_a_row")
                    break
                continue
            fails_in_row = 0
            if outcome == "not_found":
                rec["not_found"] += 1
                if not answered and rec["not_found"] >= NOT_FOUND_STOP:
                    rec.update(state="stopped", reason="route_not_found")
                    break
            else:
                rec["ok"] += 1
                answered = True
            held["peers"][sym] = {"at": clock(), "peers": peers}
            unsaved += 1
            if unsaved >= SAVE_EVERY:
                _save(held, keep=set(syms))
                unsaved = 0
        rec["finished"] = _iso(clock())
        rec["held"] = len([s for s in syms if s in held["peers"]])
        held["last_run"] = rec
        # a run stopped before any stock answered still writes, so its reason survives a restart
        _save(held, keep=set(syms))
        return _finish(rec)
    finally:
        _run_lock.release()


def _finish(rec: dict) -> dict:
    with _lock:
        _state["last_run"] = rec
    _log.info("[related-peers] %s reason=%s status=%s due=%s calls=%s ok=%s not_found=%s failed=%s",
              rec.get("state"), rec.get("reason"), rec.get("status"), rec.get("due"), rec.get("calls"),
              rec.get("ok"), rec.get("not_found"), rec.get("failed"))
    return rec


def run_nightly() -> dict:
    """The scheduled job. Reads the switch PER RUN, so turning it off stops the next night."""
    if not enabled():
        return {"state": "skipped", "reason": "switched_off"}
    try:
        return build()
    except Exception as exc:  # noqa: BLE001 -- the scheduler thread never sees a raise
        _log.warning("[related-peers] run failed (%s)", type(exc).__name__)
        return {"state": "failed", "reason": type(exc).__name__}


def register(scheduler) -> bool:
    """Add the nightly job to the web scheduler. Registers NOTHING while the switch is off."""
    if not enabled():
        return False
    from apscheduler.triggers.cron import CronTrigger
    scheduler.add_job(run_nightly, trigger=CronTrigger(day_of_week="mon-fri", hour=21, minute=15,
                                                       timezone="America/New_York"),
                      id="related_peers_nightly", max_instances=1, coalesce=True,
                      replace_existing=True, misfire_grace_time=3600)
    return True


# ── the reader (never asks the vendor, never builds) ─────────────────────────────────────────

def held_peers(sym: str, n: int, chartable: Optional[Callable[[str], bool]] = None,
               now: Optional[float] = None) -> Optional[dict]:
    """The licensed peers held for `sym`, or None when nothing usable is held.

    {"peers": [...], "as_of": ISO time the vendor was asked}. Peers keep the vendor's order, are
    cut to stocks `chartable` accepts, and to `n`."""
    s = norm(sym)
    if not s:
        return None
    row = _load().get("peers", {}).get(s)
    if not isinstance(row, dict) or not isinstance(row.get("at"), (int, float)):
        return None
    t = time.time() if now is None else now
    if t - row["at"] > MAX_SERVE_AGE_S:
        return None
    raw = row.get("peers") if isinstance(row.get("peers"), list) else []
    out = []
    for p in raw:
        q = norm(p)
        if q and q != s and q not in out and (chartable is None or chartable(q)):
            out.append(q)
    if len(out) < MIN_PEERS:
        return None
    return {"peers": out[:max(1, int(n))], "as_of": _iso(row["at"])}


def status() -> dict:
    """What is held and what the last run did, for an admin read or a test. No vendor request."""
    held = _load()
    with _lock:
        last = _state["last_run"] or held.get("last_run")
    return {"enabled": enabled(), "held": len(held.get("peers", {})), "last_run": last}


def _iso(t: float) -> str:
    return datetime.fromtimestamp(t, tz=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _reset_for_tests() -> None:
    with _lock:
        _state.update(held=None, mtime=None, last_run=None)
