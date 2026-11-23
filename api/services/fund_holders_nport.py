"""Funds (N-PORT): which mutual funds and ETFs hold a stock, from the SEC's quarterly Form N-PORT data sets, on the
OWN panel beside the 13F block. The data set reader and the index builder are `fund_holders_nport_data.py` (its
docstring says where every fact about the source was established); this module downloads, schedules, holds and
serves.

WHAT IS DOWNLOADED (sec.gov only, through `fundamentals_pit.sec_client.download`: the site's declared SEC user agent
and its one process-wide fair-access limiter, one request per file, the body streamed to disk under a byte cap):
    https://www.sec.gov/files/dera/data/form-n-port-data-sets/{YYYY}q{N}_nport.zip   (the quarter's data set)
    https://www.sec.gov/files/company_tickers.json                                   (the SEC's ticker and company
                                                                                       names, for name matching)
A data set is listed at 387 to 483 MB for every quarter of 2023 to 2026 (690.83 MB at most, 2022 Q3). A download
past `ZIP_MAX_BYTES` is refused, not truncated, and nothing starts unless the data directory has
`DISK_HEADROOM_BYTES` free.
AND ONE READ OF THE STOCK SPLIT LIST per build (2026-11-22; `_read_splits`): Massive's split reference, through
`reference_corp_actions.fetch_confirmed_splits_strict` (the read the site already makes; DVD MARKET reads the same
vendor in the same licence class), over the execution dates between the earliest previous report and the newest
current report (`Builder.split_window`), at most 20 pages; it raises rather than give part of the window. A fund's
change across a split is worked out in post-split shares (`fund_holders_nport_data` says how). When the read fails,
nothing is guessed: every change that needed it is "not comparable" and the block says the split list could not be read.

WHEN (never on a member's request). The scheduler calls `run_scheduled` daily at `RUN_AT_ET` (00:50 New York time),
inside the quiet span scan_period keeps whole-universe work to (weekends, and weekdays before 07:00 or from 20:15), so
a run has until 07:00 on a weekday. Each run:
  * works out the newest data set that should exist (the last calendar quarter that has ended) and does NOTHING (no
    request) when the index already holds it;
  * else asks for that quarter's zip; a 404 (not posted yet) tries the quarter before it, if the index does not hold
    that one either; a quarter not posted is asked again the next day (one 404 a day at most);
  * with the newest posted data set in hand, reads it once (every fund's current report; its holdings split into
    `fund_holders_nport_data.PARTS` CUSIP partition files), deletes it, downloads the data set before it, reads each
    fund's previous report from it the same way, deletes it, matches holdings to tickers, then works out and writes
    the stocks one partition at a time into `index_v1.sqlite.part`, which is swapped in only when it is whole. One zip
    is on disk at a time, and the build never holds more than one partition's holdings.
  * stops at `RUN_BUDGET_S` of wall clock, or when the quiet span ends, or on a 403 / 429; the half-written `.part`
    file is deleted, the last good index stays, and the next day tries again.
  * writes a receipt when it ends, whatever it did (`receipt`). A fire that lands while the pod restarts for a deploy
    is lost (the new container schedules the NEXT day), and a run a restart kills ends without one, so `catch_up`,
    registered beside it (`CATCHUP_BOOT_DELAY_S` after boot, and daily at `CATCHUP_AT_ET`), starts the same run when
    no run has ended since the last slot (`behind`), through `run_scheduled` and so through every one of its guards.
    The catch-up never asks the SEC anything itself: the run it starts decides, as every run does, whether there is
    anything new (no request while the index holds the newest data set).
REQUESTS A RUN: none when current; else at most two zips, one 404, and one company_tickers.json (each may be retried
once by the client on a 403 / 429 / 5xx), and the one split list read from Massive. In a year: four new data sets, so
eight zip downloads (about 3.6 GB read, streamed, never kept).
DISK: one zip at a time (at most `ZIP_MAX_BYTES`, deleted when read), the partition files (24 bytes a kept holding,
at most `MAX_EQUITY_ROWS` of them, about 0.24 GB; each deleted once its partition is written), the new index while it
is written, any leftover of all of these deleted at the start of the next run, plus the index (`index_v1.sqlite`, at most `KEEP_ROWS` funds and `KEEP_SOLD` sold-out funds for each of at most
`MAX_TICKERS` stocks, tens of MB) and two small state files (the last run that did something, and the receipt of
the last run that ended), all under `<DATA_DIR>/fund_holders_nport/`.

THE REQUEST PATH (`overlay`, called by `GET /api/research/ownership/{sym}`): one read-only SQLite read of the held
index. It never downloads, never builds, never waits. Every state is said in the block's own words.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import sqlite3
import tempfile
import threading
import time
import zipfile
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

_log = logging.getLogger(__name__)

SOURCE = "SEC Form N-PORT (public; filed 60 days after each quarter-end month)"
DATA_SET_URL = "https://www.sec.gov/files/dera/data/form-n-port-data-sets/{year}q{quarter}_nport.zip"
LISTING_URL = "https://www.sec.gov/data-research/sec-markets-data/form-n-port-data-sets"
SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"

# ── the builder's defaults (not owner rulings) ───────────────────────────────────────────────────
RUN_AT_ET = (0, 50)                      # daily, New York time (the quiet span runs to 07:00 on a weekday)
CATCHUP_BOOT_DELAY_S = 1200              # the catch-up's boot check: this long after registration (INS 600 s, IV rank 900 s)
CATCHUP_AT_ET = (5, 40)                  # and its daily retry, inside the quiet span, clear of the 03:00 builds
QUIET_HOURS_ET = (7 * 60, 20 * 60 + 15)  # a weekday between these minutes is busy (scan_period._reuse_quiet_now)
RUN_BUDGET_S = 5400.0                    # wall clock one run may take (90 minutes)
ZIP_MAX_BYTES = 1_500_000_000            # a data set zip larger than this is refused (the largest listed: 690.83 MB)
DISK_HEADROOM_BYTES = 2_000_000_000      # free space the data directory must have before a download starts
TICKERS_MAX_BYTES = 10_000_000           # company_tickers.json is about 1 MB
DOWNLOAD_TIMEOUT_S = 300.0               # per read of the download
DOWNLOAD_RETRIES = 1
PAUSE_S = 0.02                           # the build sleeps this long every TICK_EVERY rows
DISPLAY_ROWS = 50                        # funds the answer carries (the index keeps the same)
DISK_DIR = "fund_holders_nport"
INDEX_NAME = "index_v1.sqlite"
STATE_NAME = "state_v1.json"
RECEIPT_NAME = "receipt_v1.json"


class TooLarge(ValueError):
    """A download larger than its cap: refused, never truncated."""


class _Stop(Exception):
    """End this run now; the last good index stays. `reason` is a word the block and the log can say."""

    def __init__(self, reason: str, http_status: Optional[int] = None):
        super().__init__(reason)
        self.reason = reason
        self.http_status = http_status


# ── clock and places ─────────────────────────────────────────────────────────────────────────────

def now_et() -> datetime:
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/New_York"))


def quiet(now: datetime) -> bool:
    """Weekends, and weekdays before 07:00 or from 20:15 New York time (`scan_period._reuse_quiet_now`'s span; a
    test pins the two together)."""
    from zoneinfo import ZoneInfo
    now = now.astimezone(ZoneInfo("America/New_York"))
    if now.weekday() >= 5:
        return True
    hm = now.hour * 60 + now.minute
    return hm < QUIET_HOURS_ET[0] or hm >= QUIET_HOURS_ET[1]


def next_run(now: Optional[datetime] = None) -> datetime:
    now = now or now_et()
    slot = now.replace(hour=RUN_AT_ET[0], minute=RUN_AT_ET[1], second=0, microsecond=0)
    return slot if slot > now else slot + timedelta(days=1)


def last_slot(now: Optional[datetime] = None) -> datetime:
    """The most recent scheduled run at or before `now` (New York): stepped forward with `next_run` from two days
    earlier, so the schedule is stated once (`next_run`, `RUN_AT_ET`)."""
    from zoneinfo import ZoneInfo
    now = (now or now_et()).astimezone(ZoneInfo("America/New_York"))
    slot = next_run(now - timedelta(days=2))          # a day holds one slot, so this one is before `now`
    while (following := next_run(slot)) <= now:
        slot = following
    return slot


def behind(receipt: Optional[dict], now: Optional[datetime] = None) -> bool:
    """Pure: should the catch-up start a run? True when no run has ended since the last scheduled slot: no receipt,
    or its `finished_at` before `last_slot(now)` (the fire was lost, or a restart killed the run). A run that ended
    in any state (current, built, not posted, stopped, failed) has run for that slot and waits for the next one. It
    never asks whether the SEC has posted a newer data set: only the run checks that. A `finished_at` that is not a
    moment counts as no receipt."""
    if not isinstance(receipt, dict):
        return True
    try:
        finished = datetime.fromisoformat(str(receipt.get("finished_at") or ""))
    except ValueError:
        return True
    if finished.tzinfo is None:
        return True
    return finished < last_slot(now)


def _base_dir() -> Optional[str]:
    base = os.environ.get("DATA_DIR", "/data")
    return os.path.join(base, DISK_DIR) if os.path.isdir(base) else None


def index_path() -> Optional[str]:
    d = _base_dir()
    return os.path.join(d, INDEX_NAME) if d else None


# ── quarters ─────────────────────────────────────────────────────────────────────────────────────

def quarter_of(d: date) -> tuple[int, int]:
    return d.year, (d.month - 1) // 3 + 1


def quarter_before(q: tuple[int, int]) -> tuple[int, int]:
    return (q[0], q[1] - 1) if q[1] > 1 else (q[0] - 1, 4)


def last_ended_quarter(today: date) -> tuple[int, int]:
    """The newest calendar quarter that has ended before `today` (its data set is the newest that can exist)."""
    return quarter_before(quarter_of(today))


def label(q: tuple[int, int]) -> str:
    return f"{q[0]}Q{q[1]}"


def parse_label(s: Any) -> Optional[tuple[int, int]]:
    try:
        y, q = str(s).upper().split("Q")
        y, q = int(y), int(q)
        return (y, q) if 1 <= q <= 4 else None
    except (ValueError, AttributeError):
        return None


def data_set_url(q: tuple[int, int]) -> str:
    return DATA_SET_URL.format(year=q[0], quarter=q[1])


# ── the SEC reads (each one small, so a test can stand in for it) ───────────────────────────────

class _Capped:
    """A response whose reads refuse to go past ZIP_MAX_BYTES in total."""

    def __init__(self, resp, cap: int):
        self._r, self._cap, self._n = resp, cap, 0
        self.headers = resp.headers

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self._r.close()
        return False

    def read(self, n: int = -1):
        chunk = self._r.read(n)
        self._n += len(chunk)
        if self._n > self._cap:
            raise TooLarge(f"larger than {self._cap} bytes; refused")
        return chunk


def _opener(cap: int):
    import urllib.request

    def open_(req, timeout=None):
        return _Capped(urllib.request.urlopen(req, timeout=timeout), cap)
    return open_


def _download(url: str, dest: str) -> int:
    """ONE download through the site's SEC client (declared user agent, the process-wide limiter), byte-capped.
    Raises `SecError` (a 404 at once). Tests replace this by name."""
    from api.services.fundamentals_pit import sec_client
    return sec_client.download(url, dest, retries=DOWNLOAD_RETRIES, timeout=DOWNLOAD_TIMEOUT_S,
                               opener=_opener(ZIP_MAX_BYTES))


def _sec_get(url: str) -> bytes:
    """ONE small read through the site's SEC transport (`edgar_ownership._sec_get`). Tests replace this by name."""
    from api.services import edgar_ownership
    return edgar_ownership._sec_get(url)


def _read_splits(from_iso: str, to_iso: str) -> list:
    """ONE read of the stock split list over [from_iso, to_iso] (`reference_corp_actions.fetch_confirmed_splits_strict`:
    raises `CorpActionsUnavailable` when Massive could not give the whole window). Tests replace this by name."""
    from api.services import reference_corp_actions
    return reference_corp_actions.fetch_confirmed_splits_strict(from_iso, to_iso)


def _sec_error_type():
    from api.services.fundamentals_pit.sec_client import SecError
    return SecError


def sec_name_map(body: bytes) -> dict[str, set]:
    """{normal company name: {tickers}} from company_tickers.json ({"0": {"cik_str", "ticker", "title"}, ...})."""
    from api.services import fund_holders_nport_data as D
    if len(body) > TICKERS_MAX_BYTES:
        raise ValueError("company_tickers.json larger than it ever is")
    doc = json.loads(body.decode("utf-8", "replace"))
    rows = doc.values() if isinstance(doc, dict) else []
    out: dict[str, set] = {}
    for r in rows:
        if not isinstance(r, dict):
            continue
        t, n = D.norm_ticker(r.get("ticker")), D.norm_name(r.get("title"))
        if t and n:
            out.setdefault(n, set()).add(t)
    return out


def ftd_pairs() -> dict[str, str]:
    """{CUSIP: symbol} from the SEC fails-to-deliver files this server already holds (`ftd_dataset`'s store), the
    newest pair for each CUSIP; empty when the store is not on this server. A local read only."""
    from api.services import fund_holders_nport_data as D
    try:
        from api.services import ftd_dataset
        path = ftd_dataset.db_path()
    except Exception:  # noqa: BLE001
        return {}
    if not path or not os.path.exists(path):
        return {}
    out: dict[str, str] = {}
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2.0)
        try:
            for cusip, sym in con.execute("SELECT cusip, symbol FROM ftd WHERE symbol IS NOT NULL AND symbol != '' "
                                          "ORDER BY settle_date"):
                c, t = D.valid_cusip(cusip), D.norm_ticker(sym)
                if c and t:
                    out[c] = t
        finally:
            con.close()
    except sqlite3.Error:
        return {}
    return out


# ── one run ──────────────────────────────────────────────────────────────────────────────────────

def _held_meta(path: Optional[str]) -> Optional[dict]:
    if not path or not os.path.exists(path):
        return None
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2.0)
        try:
            return {k: json.loads(v) for k, v in con.execute("SELECT k, v FROM meta")}
        finally:
            con.close()
    except (sqlite3.Error, ValueError):
        return None


def build(now: datetime, *, held_quarter: Optional[tuple[int, int]] = None) -> dict:
    """One run on the CALLING thread. Returns the run's summary ({state, ...}); writes the index when it built one.
    `state`: 'current' (nothing to do) | 'built' | 'not_published' | 'stopped' | 'failed' | 'shape' | 'low_disk'."""
    from api.services import fund_holders_nport_data as D
    SecError = _sec_error_type()
    started = time.monotonic()
    base = _base_dir()
    summary: dict[str, Any] = {"state": None, "quarter": None, "prior_quarter": None, "downloads": 0,
                               "bytes": 0, "requests": 0, "at": _now_iso()}
    if base is None:
        return {**summary, "state": "failed", "reason": "no data directory"}
    target_candidates = []
    newest = last_ended_quarter(now.date())
    for q in (newest, quarter_before(newest)):
        if held_quarter is not None and q <= held_quarter:
            break
        target_candidates.append(q)
    if not target_candidates:
        return {**summary, "state": "current", "quarter": label(held_quarter) if held_quarter else None}

    work = os.path.join(base, "tmp")
    part_path = os.path.join(base, INDEX_NAME + ".part")
    shutil.rmtree(work, ignore_errors=True)        # a killed run's leftovers never pile up
    _remove(part_path)
    os.makedirs(work, exist_ok=True)

    def tick():
        if time.monotonic() - started > RUN_BUDGET_S:
            raise _Stop("time")
        if not quiet(now_et()):
            raise _Stop("busy")
        time.sleep(PAUSE_S)

    def fetch(q) -> str:
        if shutil.disk_usage(base).free < DISK_HEADROOM_BYTES:
            raise _Stop("low_disk")
        dest = os.path.join(work, f"{q[0]}q{q[1]}_nport.zip")
        summary["requests"] += 1
        n = _download(data_set_url(q), dest)
        summary["downloads"] += 1
        summary["bytes"] += n
        return dest

    def read(path, fn):
        try:
            with zipfile.ZipFile(path) as zf:
                fn(zf)
        except zipfile.BadZipFile as exc:
            raise D.Shape("the download is not a zip") from exc
        finally:
            try:
                os.remove(path)
            except OSError:
                pass

    try:
        builder = D.Builder(tick, work_dir=os.path.join(work, "parts"), parts=D.PARTS)
        target, path = None, None
        for q in target_candidates:
            try:
                path = fetch(q)
            except SecError as exc:
                if exc.status == 404:
                    summary.setdefault("not_posted", []).append(label(q))
                    continue
                raise
            target = q
            break
        if target is None:
            return {**summary, "state": "not_published", "elapsed_s": round(time.monotonic() - started, 1)}
        summary["quarter"] = label(target)
        read(path, builder.add_current)
        prior = quarter_before(target)
        summary["prior_quarter"] = label(prior)
        # Only a 404 (not there) lets the build go on without the data set before it or the SEC's names: any other
        # failure ends the run and tomorrow's tries again, because an index of the newest quarter is not rebuilt
        # until the next quarter's data set is posted.
        try:
            read(fetch(prior), builder.add_prior)
        except SecError as exc:
            if exc.status != 404:
                raise
            summary["prior_missing"] = "sec_404"                       # changes are then "no earlier report"
        names: dict = {}
        try:
            summary["requests"] += 1
            names = sec_name_map(_sec_get(SEC_TICKERS_URL))
        except SecError as exc:
            if exc.status != 404:
                raise
            summary["names_missing"] = "sec_404"
        except ValueError:
            summary["names_missing"] = "shape"
        pairs = ftd_pairs()
        # the split list, read once, so a fund's change across a split is in post-split shares; never guessed
        window = builder.split_window()
        splits = D.split_table(None, None)
        if window is not None:
            try:
                splits = D.split_table(_read_splits(*window), window)
            except Exception as exc:  # noqa: BLE001 -- said on the block: those changes are not comparable
                splits = D.split_table(None, window, reason=type(exc).__name__)
        summary["splits"] = splits["state"]
        meta = {"quarter": label(target), "prior_quarter": label(prior) if builder.stats["prior_read"] else None,
                "url": data_set_url(target), "listing": LISTING_URL, "built_at": D.built_now(),
                "prior_missing": summary.get("prior_missing"), "names_missing": summary.get("names_missing"),
                "ftd_pairs": bool(pairs), "source": SOURCE}
        index = builder.finish(part_path, meta, ftd_pairs=pairs, sec_names=names, splits=splits)
        os.replace(part_path, os.path.join(base, INDEX_NAME))       # whole, or not at all
        cov = index["coverage"]
        summary.update(state="built", index_bytes=index["bytes"], stocks=cov["stocks"],
                       matched_value_pct=cov["matched_value_pct"], matched_rows_pct=cov["matched_rows_pct"],
                       max_rows_held=index["stats"]["max_rows_held"])
    except _Stop as stop:
        summary.update(state="low_disk" if stop.reason == "low_disk" else "stopped", reason=stop.reason)
    except D.Shape as shape:
        summary.update(state="shape", reason=shape.why)
    except TooLarge:
        summary.update(state="failed", reason="too_large")
    except SecError as exc:
        summary.update(state="stopped" if exc.status in (403, 429) else "failed",
                       reason=f"sec_{exc.status or 'error'}", http_status=exc.status)
    except Exception as exc:  # noqa: BLE001 -- only the class is logged; the last good index stays
        summary.update(state="failed", reason=type(exc).__name__)
    finally:
        shutil.rmtree(work, ignore_errors=True)
        _remove(part_path)                         # a run cut short leaves no half-written index
    summary["elapsed_s"] = round(time.monotonic() - started, 1)
    return summary


def _remove(path: str) -> None:
    for p in (path, path + "-journal"):
        try:
            os.remove(p)
        except OSError:
            pass


# ── one run at a time, its state held here and on disk ──────────────────────────────────────────

_lock = threading.Lock()
_state: dict[str, Any] = {"inflight": None, "last": None, "loaded": False, "receipt": None, "receipt_loaded": False}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _state_path() -> Optional[str]:
    d = _base_dir()
    return os.path.join(d, STATE_NAME) if d else None


def _receipt_path() -> Optional[str]:
    d = _base_dir()
    return os.path.join(d, RECEIPT_NAME) if d else None


def _write_json(path: Optional[str], doc: dict, what: str) -> None:
    if not path:
        return
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".state_", suffix=".tmp", dir=os.path.dirname(path))
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(doc, fh)
        os.replace(tmp, path)
    except Exception as exc:  # noqa: BLE001
        _log.warning("[fund-holders-nport] the %s could not be written (%s)", what, type(exc).__name__)


def _save_state(last: dict) -> None:
    _write_json(_state_path(), last, "run state")


def _save_receipt(state: str) -> None:
    """The receipt of a run that ENDED, whatever it did. It sits beside the state file, which keeps only the runs
    that did something (a 'current' run leaves that file as it was)."""
    rec = {"finished_at": _now_iso(), "state": state}
    with _lock:
        _state["receipt"], _state["receipt_loaded"] = rec, True
    _write_json(_receipt_path(), rec, "run receipt")


def receipt() -> Optional[dict]:
    """The last ended run's receipt ({finished_at, state}), from disk once; None before any run has ended here."""
    with _lock:
        if _state["receipt"] is not None or _state["receipt_loaded"]:
            return _state["receipt"]
    got = None
    path = _receipt_path()
    if path and os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as fh:
                got = json.load(fh)
        except (OSError, ValueError):
            got = None
    with _lock:
        if not _state["receipt_loaded"]:
            _state["receipt_loaded"] = True
            if _state["receipt"] is None and isinstance(got, dict):
                _state["receipt"] = got
        return _state["receipt"]


def last_run() -> Optional[dict]:
    with _lock:
        if _state["last"] is not None or _state["loaded"]:
            return _state["last"]
    got = None
    path = _state_path()
    if path and os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as fh:
                got = json.load(fh)
        except (OSError, ValueError):
            got = None
    with _lock:
        if not _state["loaded"]:
            _state["loaded"] = True
            if _state["last"] is None and isinstance(got, dict):
                _state["last"] = got
        return _state["last"]


def _run(done: threading.Event, now: datetime) -> None:
    try:
        from api.services.fund_holders_nport_data import INDEX_VERSION
        meta = _held_meta(index_path())
        # an index written by another version of the builder is rebuilt, whatever quarter it holds
        held = parse_label((meta or {}).get("quarter")) if (meta or {}).get("version") == INDEX_VERSION else None
        out = build(now, held_quarter=held)
        if out["state"] != "current":
            with _lock:
                _state["last"] = out
            _save_state(out)
        _save_receipt(out["state"])
        line = (f"state={out['state']} quarter={out.get('quarter')} prior={out.get('prior_quarter')} "
                f"downloads={out.get('downloads')} bytes={out.get('bytes')} requests={out.get('requests')} "
                f"stocks={out.get('stocks')} matched_value_pct={out.get('matched_value_pct')} "
                f"splits={out.get('splits')} "
                f"reason={out.get('reason')} {out.get('elapsed_s')}s")
        (_log.info if out["state"] in ("built", "current", "not_published") else _log.warning)(
            "[fund-holders-nport] %s", line)
    except Exception as exc:  # noqa: BLE001
        _log.warning("[fund-holders-nport] run failed (%s); the last good index is kept", type(exc).__name__)
    finally:
        with _lock:
            _state["inflight"] = None
        done.set()


def run_scheduled(now: Optional[datetime] = None) -> dict:
    """THE SCHEDULED ENTRY (`api/main.py`, daily at RUN_AT_ET): start one run on its own thread, unless one is
    running or the quiet span is over. Returns at once."""
    now = now or now_et()
    if not quiet(now):
        return {"started": False, "reason": "not_quiet"}
    with _lock:
        if _state["inflight"] is not None:
            return {"started": False, "reason": "running"}
        done = _state["inflight"] = threading.Event()
    threading.Thread(target=_run, args=(done, now), daemon=True, name="fund-holders-nport").start()
    return {"started": True}


def catch_up(now: Optional[datetime] = None) -> dict:
    """THE CATCH-UP ENTRY (`api/main.py`: a DATE job `CATCHUP_BOOT_DELAY_S` after boot and a daily retry at
    `CATCHUP_AT_ET`): `run_scheduled` itself (the quiet span, one run at a time) only when `behind`; otherwise it
    reads the receipt (from disk once) and nothing else, never the SEC. Never on a member's request. Returns at once:
    `{"started": False, "reason": "current"}`, or `run_scheduled`'s answer (which says "running" while a run is in
    flight)."""
    now = now or now_et()
    if not behind(receipt(), now):
        return {"started": False, "reason": "current"}
    return run_scheduled(now)


def building() -> bool:
    with _lock:
        return _state["inflight"] is not None


def reset_for_tests() -> None:
    with _lock:
        _state.update({"inflight": None, "last": None, "loaded": False, "receipt": None, "receipt_loaded": False})


# ── the request path ─────────────────────────────────────────────────────────────────────────────

def _fund(row) -> dict:
    from api.services.edgar_ownership import filing_index_url
    (series_id, name, family, cik, acc, rdate, filed, net, pacc, prdate, pfiled) = row
    return {"series_id": series_id, "name": name, "family": family, "cik": cik, "accession": acc,
            "period": rdate, "filed": filed, "net_assets": net,
            "url": filing_index_url(cik, acc) if cik and acc else None,
            "prior_period": prdate, "prior_filed": pfiled}


def _change(now: Optional[float], before: Optional[float]):
    if now is None or before is None:
        return None, None
    ch = now - before
    return ch, (round(ch / before * 100.0, 2) if before > 0 else None)


_FUND_COLS = ("f.series_id, f.name, f.family, f.cik, f.accession, f.report_date, f.filed, f.net_assets, "
              "f.prior_accession, f.prior_report_date, f.prior_filed")


def answer_for(sym: str) -> dict:
    """The block for one stock, from the held index only. Never raises."""
    from api.services.ticker_resolver import route_symbol
    s = route_symbol(sym) or ""
    base = {"source": SOURCE, "sym": s}
    path = index_path()
    if not path or not os.path.exists(path):
        last = last_run()
        return {**base, "state": "not_built", "building": building(),
                "next_check": next_run().isoformat(timespec="minutes"),
                "last_check": {k: (last or {}).get(k) for k in ("state", "reason", "at", "quarter")} if last else None}
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2.0)
        try:
            meta = {k: json.loads(v) for k, v in con.execute("SELECT k, v FROM meta")}
            stock = con.execute("SELECT summary FROM stock WHERE sym = ?", (s,)).fetchone()
            holders = con.execute(
                f"SELECT h.shares, h.value, h.pct, h.prior_shares, h.prior_value, h.state, {_FUND_COLS} "
                "FROM holder h JOIN fund f ON f.id = h.fund WHERE h.sym = ? ORDER BY h.rank LIMIT ?",
                (s, DISPLAY_ROWS)).fetchall() if stock else []
            sold = con.execute(
                f"SELECT d.prior_shares, d.prior_value, {_FUND_COLS} "
                "FROM sold d JOIN fund f ON f.id = d.fund WHERE d.sym = ? ORDER BY d.rank", (s,)).fetchall() if stock else []
        finally:
            con.close()
    except (sqlite3.Error, ValueError) as exc:
        _log.warning("[fund-holders-nport] the index could not be read (%s)", type(exc).__name__)
        return {**base, "state": "unavailable", "reason": "the held index could not be read"}
    cov = meta.get("coverage") or {}
    data_set = {"quarter": meta.get("quarter"), "prior_quarter": meta.get("prior_quarter"), "url": meta.get("url"),
                "listing": meta.get("listing"), "built_at": meta.get("built_at"),
                "periods": meta.get("periods"), "prior_missing": meta.get("prior_missing"),
                "splits": meta.get("splits")}
    coverage = {"matched_value_pct": cov.get("matched_value_pct"), "matched_rows_pct": cov.get("matched_rows_pct"),
                "pct_units": meta.get("pct_units")}
    out = {**base, "data_set": data_set, "coverage": coverage, "building": building(),
           "holders_limit": meta.get("keep_rows"), "sold_limit": meta.get("keep_sold")}
    last = last_run()
    if last and last.get("state") not in ("built", "current", "not_published"):
        out["check"] = {k: last.get(k) for k in ("state", "reason", "at")}
    if not stock:
        return {**out, "state": "not_matched"}
    summary = json.loads(stock[0])
    rows = []
    for (shares, value, pct, pshares, pvalue, state, *fund) in holders:
        # a change across a split that could not be checked is never given (the index says `not_comparable`)
        ch, chp = (None, None) if state == "not_comparable" else _change(shares, pshares)
        rows.append({**_fund(fund), "shares": shares, "value": value, "pct": pct, "prior_shares": pshares,
                     "prior_value": pvalue, "change_shares": ch, "change_pct": chp, "state": state})
    sold_rows = [{**_fund(fund), "prior_shares": ps, "prior_value": pv} for (ps, pv, *fund) in sold]
    return {**out, "state": "ok" if summary.get("funds") else "none_now", "summary": summary,
            "holders": rows, "holders_total": summary.get("funds"),
            "sold_out": sold_rows, "sold_out_total": summary.get("sold_out")}


def overlay(payload: dict, sym: str) -> dict:
    """The ownership answer with `funds_nport` added. Never mutates the (cached) payload, never raises."""
    if not isinstance(payload, dict) or not payload:
        return payload
    try:
        block = answer_for(sym)
    except Exception as exc:  # noqa: BLE001 -- said as a state
        _log.warning("[fund-holders-nport] overlay failed (%s)", type(exc).__name__)
        block = {"source": SOURCE, "state": "unavailable", "reason": "the held index could not be read"}
    return {**payload, "funds_nport": block}

