# api/services/bars_rail_monitor.py — TERM-013 / FB-OBS-02: read the push-rail drop counters on a schedule.
"""S1 (push-rail silence -> PAGE) and S2 (drop accumulation -> DIGEST), in one reader.

Spec: ``docs/terminal-research/10-roadmap/backlog.md`` "#### TERM-013", and
``10-roadmap/observability-plan.md`` §4.3 rows S1/S2 and §4.9 OBS-2:

    "Any Δ`bars_dropped_total` -> DIGEST. `bars_emitted_total` flat across 3
     consecutive 60 s RTH polls with `subscriber_pairs > 0` -> PAGE."

THE PROBLEM, in one sentence
────────────────────────────
The counters exist, are correct, and nothing read them on a schedule: the only
reader of ``/api/admin/bars-stream-status`` was the admin panel (on demand, when a
person opened it) and ``tools/market_open_chart_check.py`` (one-time RTH triggers).
So when the live-bars rail died, a member noticed the Finnhub fallback first.

WHAT IT READS — the shipped admin route, not a second copy of it
────────────────────────────────────────────────────────────────
``read_status`` calls the route's own handler (``api.routers.bars.bars_stream_status``),
so every poll sees exactly the bytes the endpoint serves. Nothing here recomputes a
counter; a reader that did would be a second authority over the numbers it reports.

⛔⛔ INST-3 IS THE TRAP, AND ``decide`` IS BUILT AROUND IT
────────────────────────────────────────────────────────
``bars_emitted_total`` / ``bars_dropped_total`` are per-process module ints, reset to 0
by every deploy (median pod life 26 minutes). So:
  • a total is only ever read as a DELTA against the previous reading of the SAME
    process — ``BOOT_TOKEN`` names the process, and two equal totals from two
    processes are two unrelated numbers;
  • a new process's first reading has no history to be flat against, so the flat
    count restarts — a redeploy mid-window can never page (acceptance (c));
  • a new process's drop total IS its delta (its counter began at 0 at its boot), so
    the day's drops accumulate across deploys in the T1 ledger and never go negative.

SEVERITY — PAGE for silence, DIGEST for drops, never the other way round
────────────────────────────────────────────────────────────────────────
The fan-out is last-value-wins by construction (``bar_broadcaster`` queue maxsize 64,
drop-oldest), so a dropped developing bar is CONFLATION — a digest line. A flat
emitted count with an audience during RTH means the rail is dead and every member
silently fell back — a page. ⛔ Paging on drops is the severity inversion item 16
names: it trains the channel to be ignored, which is how the page that matters gets
muted.

WHERE IT RUNS, AND WHY NOT ON ``terminal-next-monitor``
────────────────────────────────────────────────────────
OBS-2 needs a 60 s poll inside RTH. The monitor is a Railway CRON whose schedule lives
in the service config (``RAILWAY_CRON_UTC``: minutes 0/12/20/30 of six hours) and that
nothing in this repo can change, so it cannot poll every 60 s. This reader therefore
runs as its own daemon thread on ``web`` — started by ``bars_continuous_audit.start()``,
which ``api/main.py`` already calls (lane A touches ``api/main.py`` only at TERM-014) —
and the two things that must outlive a pod leave it:
  • the DIGEST: one T1 ledger file per ET day under ``$DATA_DIR/bars_rail`` (the
    ``cadence_heartbeat`` idiom and retention), printed inside TERM-015's daily
    roll-up by ``tools/cadence_rollup_report.py`` — so it is ONE message on the ops
    channel, not a new paging surface;
  • the PAGE: ``chart_health_alerts.emit(..., "critical")`` — the OPS-class sink, with
    TERM-016's durable cooldown, so a standing dead rail pages once per 30 min and a
    redeploy does not re-page it.
⚠️ What an in-web reader cannot see is ``web`` itself being down; that is S10
(``worker_main``'s down-alert) and is deliberately not rebuilt here.

⛔ THE PAGE SHIPS DARK. ``BARS_RAIL_PAGE_ENABLED`` (default off, read per poll) gates
only the emit. The reading, the verdict and the ledger run regardless, and the ledger
counts ``page_verdicts`` beside ``pages_emitted`` — so before anybody arms the page,
the daily roll-up already says how often it WOULD have fired.

⛔ ``poll_once`` NEVER RAISES, and marks its cadence heartbeat on ENTRY: a reader that
runs and finds the route broken is still REPORTING (TERM-015's recursive requirement).
"""

from __future__ import annotations

import datetime as _dt
import json
import logging
import os
import threading
import time
import uuid
from typing import Callable, Optional
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")

#: ⛔ DARK UNTIL SET. Gates ONLY the page. Read per poll, never at import.
FLAG = "BARS_RAIL_PAGE_ENABLED"
#: A LOCATION, not a gate: overrides where the daily drop ledger lives.
LEDGER_DIR_ENV = "BARS_RAIL_LEDGER_DIR"
#: The cadence contract this reader reports under (``cadence_heartbeat.CONTRACTS``).
SIGNAL = "bars-stream-rail"
#: The chart-health alert key of the PAGE.
ALERT_KEY = "bars_stream_rail_silent"

POLL_INTERVAL_S = 60
#: OBS-2: three consecutive flat polls — i.e. four readings, ~3 minutes of silence.
PAGE_AFTER_FLAT_POLLS = 3

#: Names THIS process. The counters it reads are this process's module ints, so a
#: reading is only comparable with another reading carrying the same token.
BOOT_TOKEN = uuid.uuid4().hex

OK = "ok"
OFF = "off"                  # STREAM_BARS_ENABLED is off — the rail is not running
UNREADABLE = "unreadable"    # the route answered something that is not a reading

_MAX_TOKENS_KEPT = 64        # the ledger names processes by prefix; bounded


def page_enabled() -> bool:
    return os.environ.get(FLAG, "0").strip().lower() in ("1", "true", "yes")


def read_status() -> dict:
    """The shipped admin route's own payload (``GET /api/admin/bars-stream-status``)."""
    from api.routers.bars import bars_stream_status
    return bars_stream_status()


# ────────────────────────────────────────────────────────────────── pure core

def observe(payload, *, token: str, now: float) -> dict:
    """PURE. One poll's reading. ⛔ UNREADABLE carries ``None`` counters, never 0."""
    obs = {"kind": UNREADABLE, "token": token, "now": float(now), "reason": None,
           "emitted": None, "dropped": None, "subs": None, "last_emit_age_s": None}
    if not isinstance(payload, dict):
        obs["reason"] = "status payload is %s, not an object" % type(payload).__name__
        return obs
    if payload.get("_read_error"):
        obs["reason"] = str(payload["_read_error"])[:200]
        return obs
    if payload.get("enabled") is False:
        obs.update(kind=OFF, reason="STREAM_BARS_ENABLED is off")
        return obs
    b = payload.get("broadcaster")
    if not isinstance(b, dict):
        obs["reason"] = str(payload.get("broadcaster_error") or "no broadcaster block")[:200]
        return obs
    try:
        emitted = int(b["bars_emitted_total"])
        dropped = int(b["bars_dropped_total"])
        subs = int(b["subscriber_pairs"])
    except (KeyError, TypeError, ValueError) as e:
        obs["reason"] = "broadcaster block unreadable: %s: %s" % (type(e).__name__, e)
        return obs
    obs.update(kind=OK, emitted=emitted, dropped=dropped, subs=subs,
               last_emit_age_s=b.get("last_emit_age_s"))
    return obs


def initial_state() -> dict:
    return {"token": None, "emitted": None, "dropped": None, "flat_polls": 0}


def decide(prev: dict, obs: dict, *, in_session: bool,
           page_after: int = PAGE_AFTER_FLAT_POLLS) -> tuple:
    """PURE. ``(new_state, verdict)``. No environment, no disk, no clock.

    verdict: ``page`` (S1), ``digest`` (S2), ``drop_delta``, ``emitted_delta``,
    ``flat_polls``, ``same_process``.
    """
    if obs["kind"] != OK:
        # A gap is not a confirm — but the last READABLE baseline is kept, so drops
        # that happened across the gap are counted once on the next reading.
        state = dict(prev)
        state["flat_polls"] = 0
        return state, {"page": False, "digest": False, "drop_delta": 0,
                       "emitted_delta": 0, "flat_polls": 0, "same_process": False}

    same_process = prev.get("token") == obs["token"]
    if same_process and prev.get("dropped") is not None and obs["dropped"] >= prev["dropped"]:
        drop_delta = obs["dropped"] - prev["dropped"]
    else:
        drop_delta = obs["dropped"]          # a new process's counter began at 0 at ITS boot
    if same_process and prev.get("emitted") is not None and obs["emitted"] >= prev["emitted"]:
        emitted_delta = obs["emitted"] - prev["emitted"]
    else:
        emitted_delta = obs["emitted"]

    flat = (in_session and obs["subs"] > 0 and same_process
            and obs["emitted"] == prev.get("emitted"))
    flat_polls = int(prev.get("flat_polls") or 0) + 1 if flat else 0

    state = {"token": obs["token"], "emitted": obs["emitted"],
             "dropped": obs["dropped"], "flat_polls": flat_polls}
    return state, {"page": flat_polls >= page_after, "digest": drop_delta > 0,
                   "drop_delta": drop_delta, "emitted_delta": emitted_delta,
                   "flat_polls": flat_polls, "same_process": same_process}


# ─────────────────────────────────────────────────────────── T1 daily ledger

def ledger_dir() -> str:
    """Read NOW. ``$BARS_RAIL_LEDGER_DIR``, else ``$DATA_DIR/bars_rail``."""
    explicit = os.environ.get(LEDGER_DIR_ENV)
    if explicit:
        return explicit
    return os.path.join(os.environ.get("DATA_DIR", "/data"), "bars_rail")


def _day(ts: float) -> str:
    return _dt.datetime.fromtimestamp(ts, _ET).strftime("%Y-%m-%d")


def _et_text(ts: float) -> str:
    return _dt.datetime.fromtimestamp(ts, _ET).strftime("%Y-%m-%d %H:%M ET")


_ledger_lock = threading.Lock()


def record(obs: dict, verdict: dict, *, in_session: bool, paged: bool,
           base_dir: Optional[str] = None) -> bool:
    """Fold one poll into today's ledger. True on a write. ⛔ NEVER RAISES.

    Reuses ``cadence_heartbeat``'s atomic write and its 90-day period pruning, so the
    directory is bounded by construction and a reader never sees half a file.
    """
    try:
        from api.services.cadence_heartbeat import _prune, _write_atomic
        ts = obs["now"]
        root = base_dir or ledger_dir()
        path = os.path.join(root, _day(ts) + ".json")
        with _ledger_lock:
            prev = None
            if os.path.exists(path):
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        prev = json.load(f)
                except (OSError, ValueError):
                    prev = None      # a corrupt ledger is rewritten, never trusted
            d = prev if isinstance(prev, dict) else {}
            fresh = not d
            tokens = list(d.get("tokens") or [])
            short = str(obs["token"])[:8]
            if obs["kind"] == OK and short not in tokens and len(tokens) < _MAX_TOKENS_KEPT:
                tokens.append(short)
            d.update({
                "date": _day(ts),
                "first_as_of": d.get("first_as_of", ts),
                "as_of": ts,
                "as_of_et": _et_text(ts),
                "polls": int(d.get("polls") or 0) + 1,
                "readable_polls": int(d.get("readable_polls") or 0) + (obs["kind"] == OK),
                "off_polls": int(d.get("off_polls") or 0) + (obs["kind"] == OFF),
                "unreadable_polls": int(d.get("unreadable_polls") or 0) + (obs["kind"] == UNREADABLE),
                "rth_polls": int(d.get("rth_polls") or 0) + bool(in_session),
                "drops": int(d.get("drops") or 0) + int(verdict["drop_delta"]),
                "drop_polls": int(d.get("drop_polls") or 0) + bool(verdict["digest"]),
                "max_drop_delta": max(int(d.get("max_drop_delta") or 0), int(verdict["drop_delta"])),
                "emitted": int(d.get("emitted") or 0) + int(verdict["emitted_delta"]),
                "tokens": tokens,
                "processes": len(tokens),
                "max_flat_polls": max(int(d.get("max_flat_polls") or 0), int(verdict["flat_polls"])),
                "page_verdicts": int(d.get("page_verdicts") or 0) + bool(verdict["page"]),
                "pages_emitted": int(d.get("pages_emitted") or 0) + bool(paged),
                "last_reason": obs.get("reason") or d.get("last_reason"),
            })
            _write_atomic(path, d)
            if fresh:
                _prune(root, ts)
        return True
    except Exception as e:                                   # noqa: BLE001
        log.warning("[bars-rail] ledger not written: %s: %s", type(e).__name__, e)
        return False


def read_day(date: str, *, base_dir: Optional[str] = None) -> tuple:
    """``(ledger, error)``. ``(None, None)`` = nothing recorded; ``(None, reason)`` =
    UNREADABLE. Read-only."""
    path = os.path.join(base_dir or ledger_dir(), date + ".json")
    if not os.path.exists(path):
        return None, None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError("ledger is not an object")
        int(data["polls"])
        return data, None
    except Exception as e:                                   # noqa: BLE001
        return None, "%s: %s" % (type(e).__name__, e)


def _digest_line(label: str, date: str, base_dir: Optional[str]) -> str:
    d, err = read_day(date, base_dir=base_dir)
    if err:
        return "  %s %s: UNREADABLE ledger (%s)" % (label, date, err)
    if d is None:
        return "  %s %s: no reading recorded" % (label, date)
    drops = int(d.get("drops") or 0)
    drop_txt = ("DROPS: %d bar(s) in %d poll(s), max %d in one"
                % (drops, int(d.get("drop_polls") or 0), int(d.get("max_drop_delta") or 0))
                if drops > 0 else "no drops")
    return ("  %s %s: %s | %d poll(s) (%d read, %d rail-off, %d unreadable), %d process(es)"
            " | emitted +%d | longest flat-with-audience %d poll(s)"
            " | page verdicts %d, emitted %d"
            % (label, date, drop_txt, int(d.get("polls") or 0),
               int(d.get("readable_polls") or 0), int(d.get("off_polls") or 0),
               int(d.get("unreadable_polls") or 0), int(d.get("processes") or 0),
               int(d.get("emitted") or 0), int(d.get("max_flat_polls") or 0),
               int(d.get("page_verdicts") or 0), int(d.get("pages_emitted") or 0)))


def format_digest(now: float, *, base_dir: Optional[str] = None) -> str:
    """The S2 digest for the daily roll-up: today so far, and yesterday's final day
    (the roll-up posts before the evening session ends). Read-only; never raises."""
    try:
        today = _day(now)
        yday = (_dt.datetime.fromtimestamp(now, _ET).date() - _dt.timedelta(days=1)).isoformat()
        return "\n".join([
            "BARS PUSH-RAIL DIGEST (TERM-013)  --  page %s"
            % ("ARMED" if page_enabled() else "dark (%s unset)" % FLAG),
            _digest_line("today", today, base_dir),
            _digest_line("yesterday", yday, base_dir),
        ])
    except Exception as e:                                   # noqa: BLE001
        return "BARS PUSH-RAIL DIGEST (TERM-013)  --  UNREADABLE (%s: %s)" % (type(e).__name__, e)


# ────────────────────────────────────────────────────────────── the page

def _page(obs: dict, verdict: dict) -> bool:
    """The S1 page, through the OPS-class chart-health sink. Never raises."""
    try:
        # ⛔ A PLAIN `chart_health_alerts.emit(...)` CALL, never through a helper that
        # returns the module: the emit-site sweeps (TERM-018's population and the
        # severity-vocabulary pin) resolve `<name>.emit` by AST and cannot see
        # `_sink().emit` — measured: an indirection hid this page from both rails.
        from api.services import chart_health_alerts
        msg = ("Live-bars push rail is SILENT: bars_emitted_total flat at %s for %d "
               "consecutive %ds RTH polls while %s (sym,tf) pair(s) are subscribed -- "
               "members are silently on the Finnhub fallback. Check "
               "/api/admin/bars-stream-status (websocket.connected, last_emit_age_s)."
               % (obs["emitted"], verdict["flat_polls"], POLL_INTERVAL_S, obs["subs"]))
        return bool(chart_health_alerts.emit(
            "bars_stream_rail_silent", "critical", msg,
            {"subscriber_pairs": obs["subs"], "bars_emitted_total": obs["emitted"],
             "flat_polls": verdict["flat_polls"], "last_emit_age_s": obs["last_emit_age_s"],
             "boot_token": str(obs["token"])[:8]}))
    except Exception as e:                                   # noqa: BLE001
        log.warning("[bars-rail] page not emitted: %s: %s", type(e).__name__, e)
        return False


# ────────────────────────────────────────────────────────────── the poll

_state_lock = threading.Lock()
_state: dict = initial_state()


def reset_state() -> None:
    """Test isolation only; the thread keeps its state for the life of the process."""
    global _state
    with _state_lock:
        _state = initial_state()


def _in_session(ts: float) -> bool:
    """RTH per the one session authority the outage oracle already uses
    (``liveflow_monitor.session_window``: 09:35-16:05 ET, early closes, holidays)."""
    from api.services.liveflow_monitor import session_window
    in_session, _, _ = session_window(_dt.datetime.fromtimestamp(ts, _ET))
    return bool(in_session)


def poll_once(now: Optional[float] = None, *, read: Callable[[], dict] = None,
              token: Optional[str] = None, in_session: Optional[bool] = None,
              base_dir: Optional[str] = None) -> Optional[dict]:
    """One poll: read, decide, page (if armed), record. ⛔ NEVER RAISES.

    Every input is injectable; production passes none of them.
    """
    global _state
    try:
        from api.services import cadence_heartbeat
        cadence_heartbeat.mark("bars-stream-rail", now=now)
    except Exception:                                        # noqa: BLE001
        pass
    try:
        ts = time.time() if now is None else float(now)
        try:
            payload = (read or read_status)()
        except Exception as e:                               # noqa: BLE001
            payload = {"_read_error": "%s: %s" % (type(e).__name__, e)}
        obs = observe(payload, token=token or BOOT_TOKEN, now=ts)
        sess = _in_session(ts) if in_session is None else bool(in_session)
        with _state_lock:
            _state, verdict = decide(_state, obs, in_session=sess)
        paged = bool(verdict["page"] and page_enabled() and _page(obs, verdict))
        record(obs, verdict, in_session=sess, paged=paged, base_dir=base_dir)
        return dict(verdict, kind=obs["kind"], paged=paged, in_session=sess)
    except Exception as e:                                   # noqa: BLE001
        log.warning("[bars-rail] poll failed: %s: %s", type(e).__name__, e)
        return None


# ────────────────────────────────────────────────────────────── the thread

_running = threading.Event()
_thread: Optional[threading.Thread] = None


def _loop() -> None:
    # Wait one interval BEFORE the first poll: at boot the app is still importing, and
    # `read_status` imports the bars router. A first poll a minute late costs nothing.
    while _running.is_set():
        for _ in range(POLL_INTERVAL_S):
            if not _running.is_set():
                return
            time.sleep(1)
        poll_once()


def start() -> bool:
    """Start the reader's daemon thread (idempotent). Called by
    ``bars_continuous_audit.start()``, which ``api/main.py`` calls at boot."""
    global _thread
    if _running.is_set():
        return False
    _running.set()
    _thread = threading.Thread(target=_loop, daemon=True, name="bars-rail-monitor")
    _thread.start()
    return True


def stop() -> None:
    _running.clear()
