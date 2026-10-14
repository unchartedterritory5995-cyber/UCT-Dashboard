"""Timed probe: how long can a member's Daily prep note create hold a request worker?

Notebook P2b Task 15 pre-arming, integrator ruling R-T12-C. `POST /api/j2/notes` with
`kindId: "daily_prep"` is a SYNC route (`api/routers/journal_two.py::create_note_endpoint`), so it runs
on the web pod's ONE shared anyio threadpool, and `journal_styles.create_styled_note` composes the
Daily prep v2 blocks (prepWire, marketcontext, prepEarnings, prepMovers, prepLevels, myRules) on that
thread before its one insert. This probe times that call, per member, and names every read it makes.

WHAT IT DOES
  * Sandboxes every data path (CLAUDE.md "C:\\data IS REAL ON THIS BOX"): imports the repo-root
    conftest (which redirects and arms the shared-root tripwire), applies
    `conftest.shared_data_root_census()`'s pins aimed at a fresh temp directory, and REFUSES to run
    if any resolved data path is inside the shared root. Never sets ALLOW_LOCAL_VENDOR_SOCKETS.
  * Seeds two members through the services that own the tables: auth_service.create_user,
    watchlist_service (a watchlist + the flagged list), journal_two.positions.create_position, and
    bars_sqlite.put_bars (three settled daily bars per name, so the movers part quotes from held
    bars). BIG = trader_blocks.MOVERS_SCAN_MAX names (the movers scan cap, read, never typed);
    SMALL = 5 names (the control).
  * Scenarios: `cold` (the pod holds no wire and no earnings list) and `warm` (a synthetic wire and
    earnings list placed in the process cache under the keys their owners write: push.py's
    `wire_data`, engine.EARNINGS_CACHE_KEY), so the wire / regime / earnings legs actually run.
  * Instruments every LEG (a read the prep builders reach that leaves process memory) and every
    OBSERVER (a vendor door that must not be reached at all), plus an outbound-socket guard that
    records and refuses any connection attempt. `--vendor-delay S` makes each leg sleep S seconds per
    call and then FAIL (`--vendor-mode fail`, the brief's shape) or carry on (`slow`), so the run
    shows whether anything on the create path cuts a leg short.
  * Runs K creates per member (after `--warmup` untimed creates, reported separately), and reads each
    composed note: every prep block's frozen snapshot (answered, or its named gap), the market
    context readings, and whether builtin:regime_at_write was stored.

  python tools/notebook_daily_prep_probe.py --self-check
  python tools/notebook_daily_prep_probe.py --k 10 --json docs/notebook/perf-runs/p2b/daily-prep-probe-d0.json
  python tools/notebook_daily_prep_probe.py --k 1 --vendor-delay 20 --json ...

Percentiles are NEAREST-RANK (p = the ceil(q/100 * n)-th smallest), so p95 of 10 samples is the max.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import platform
import socket
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PREP_WIDGETS = ("prepWire", "prepEarnings", "prepMovers", "prepLevels")
CONTEXT_FIELDS = ("regime", "spy", "qqq", "vix")
REGIME_PROP = "builtin:regime_at_write"
SMALL_NAMES = 5

#: The legs: every read the Daily prep builders reach that leaves process memory, found from source
#: (trader_blocks prep readers, market_context_params, setups_board, member_interest, engine). Each is
#: (key, module, attribute, what it reads). A leg is patched at its MODULE attribute; every caller on
#: the path resolves it there at call time (late binding), which the non-vacuity check below proves.
LEGS = (
    ("engine._load_wire_data", "api.services.engine", "_load_wire_data",
     "the wire: the process cache, then PERSISTENT_WIRE_DATA_FILE / WIRE_DATA_FILE (local files)"),
    ("engine._load_state", "api.services.engine", "_load_state",
     "the morning-wire state file (local file)"),
    ("member_interest._watchlist_syms", "api.services.member_interest", "_watchlist_syms",
     "the member's watchlist names (auth.db, sqlite3.connect default timeout)"),
    ("member_interest._flagged_syms", "api.services.member_interest", "_flagged_syms",
     "the member's flagged names (auth.db)"),
    ("member_interest._position_syms", "api.services.member_interest", "_position_syms",
     "the member's open positions (auth.db)"),
    ("member_interest._uct20_syms", "api.services.member_interest", "_uct20_syms",
     "the UCT 20 (the wire; interest_for asks it though _my_names drops it)"),
    ("bars_sqlite.get_bars", "api.services.bars_sqlite", "get_bars",
     "held daily bars (bars.db): the last close for SPY/QQQ and for each name the live cache misses"),
    ("setups_board.build_cards", "api.services.journal_two.setups_board", "build_cards",
     "the levels part's setups board scan (auth.db notes, prices through the cache-only seam)"),
)

#: Vendor doors: a call to any of these from a Daily prep create is a finding by itself. Counted,
#: never delayed. `engine.get_breadth` is split by mode: only the DEFAULT mode can reach the live
#: fetch (`morning_wire_engine.fetch_breadth`, engine.py Priority 3).
OBSERVERS = (
    ("live_prices.get_live_prices", "api.routers.live_prices", "get_live_prices"),
    ("massive._get_client", "api.services.massive", "_get_client"),
    ("engine.get_earnings", "api.services.engine", "get_earnings"),
    ("engine.build_earnings", "api.services.engine", "build_earnings"),
)


# ── pure helpers (the self-check runs these; no api import) ─────────────────────────────────

class SharedRootRefused(RuntimeError):
    """A resolved data path is inside the shared data root (the owner's live C:\\data)."""


def shared_roots() -> list[str]:
    roots = {os.path.normcase(os.path.abspath(p)) for p in ("/data", "C:\\data")}
    return sorted(roots)


def refuse_shared_root(paths: dict) -> None:
    """Raise SharedRootRefused naming every path that resolves inside the shared root."""
    bad = {}
    for name, p in paths.items():
        if not p:
            continue
        n = os.path.normcase(os.path.abspath(str(p)))
        for r in shared_roots():
            if n == r or n.startswith(r + os.sep):
                bad[name] = str(p)
    if bad:
        raise SharedRootRefused(f"refusing: {len(bad)} path(s) inside the shared data root: {bad}")


def nearest_rank(values: list[float], q: float) -> float | None:
    if not values:
        return None
    s = sorted(values)
    k = max(1, math.ceil(q / 100.0 * len(s)))
    return s[k - 1]


def summarize(values: list[float]) -> dict:
    return {"n": len(values), "p50": nearest_rank(values, 50), "p95": nearest_rank(values, 95),
            "max": max(values) if values else None,
            "mean": (sum(values) / len(values)) if values else None}


def classify_snapshot(attrs: dict | None) -> str:
    """One prep block's outcome, read from the composed node (never inferred)."""
    if attrs is None:
        return "absent"
    snap = (attrs.get("params") or {}).get("snapshot")
    if not isinstance(snap, dict):
        return "uncaptured"
    if snap.get("needs"):
        return f"fell_back:needs({snap['needs']})"
    if snap.get("missing"):
        return f"fell_back:{snap['missing']}"
    return "answered"


class ProbeLegFailure(RuntimeError):
    """What a delayed leg raises in `fail` mode (the brief's "sleep that long before failing")."""


class Leg:
    """Wraps one function: counts calls, records the thread, start/end and the real time inside it.
    delay 0 = pass-through. delay > 0: sleep, then raise ProbeLegFailure (fail) or call through (slow)."""

    def __init__(self, key: str, delay: float = 0.0, mode: str = "fail", observe_only: bool = False):
        self.key, self.delay, self.mode, self.observe_only = key, delay, mode, observe_only
        self.calls: list[dict] = []
        self._lock = threading.Lock()

    def wrap(self, fn):
        def wrapper(*args, **kwargs):
            rec = {"thread": threading.get_ident(), "start": time.perf_counter(), "end": None,
                   "slept": 0.0, "failed": False, "args": _short(args)}
            with self._lock:
                self.calls.append(rec)
            try:
                if self.delay > 0 and not self.observe_only:
                    t0 = time.perf_counter()
                    time.sleep(self.delay)
                    rec["slept"] = time.perf_counter() - t0
                    if self.mode == "fail":
                        rec["failed"] = True
                        raise ProbeLegFailure(f"probe: {self.key} is dead (after {self.delay}s)")
                return fn(*args, **kwargs)
            finally:
                rec["end"] = time.perf_counter()
        wrapper.__wrapped__ = fn
        wrapper.__probe_leg__ = self.key
        return wrapper


def _short(args) -> str:
    try:
        s = repr(args)
    except Exception:  # noqa: BLE001
        s = "?"
    return s[:80]


# ── self-check (offline controls that can fail) ─────────────────────────────────────────────

def self_check() -> int:
    results = []

    def control(name, fn):
        try:
            fn()
            results.append((name, True, ""))
        except Exception as e:  # noqa: BLE001
            results.append((name, False, f"{type(e).__name__}: {e}"))

    def c1():
        for p in ("C:\\data\\auth.db", "c:\\DATA\\bars.db", "/data/auth.db", "C:\\data"):
            try:
                refuse_shared_root({"x": p})
            except SharedRootRefused:
                continue
            raise AssertionError(f"the pin guard ACCEPTED {p!r}")

    def c2():
        refuse_shared_root({"tmp": os.path.join(tempfile.gettempdir(), "probe", "auth.db"),
                            "near_miss": "C:\\data-probe\\auth.db"})

    def c3():
        xs = [5.0, 1.0, 4.0, 2.0, 3.0, 10.0, 9.0, 8.0, 7.0, 6.0]
        s = summarize(xs)
        assert (s["p50"], s["p95"], s["max"], s["mean"]) == (5.0, 10.0, 10.0, 5.5), s
        assert nearest_rank([3.0, 1.0, 2.0], 50) == 2.0
        assert summarize([2.0])["p95"] == 2.0 and nearest_rank([], 50) is None

    def c4():
        real = []
        leg = Leg("fake", delay=0.05, mode="fail")
        w = leg.wrap(lambda: real.append(1) or "real")
        t0 = time.perf_counter()
        try:
            w()
            raise AssertionError("a fail-mode leg returned instead of failing")
        except ProbeLegFailure:
            pass
        assert time.perf_counter() - t0 >= 0.05 and real == [] and len(leg.calls) == 1, leg.calls
        assert leg.calls[0]["failed"] and leg.calls[0]["end"] is not None

    def c5():
        leg = Leg("fake", delay=0.02, mode="slow")
        assert leg.wrap(lambda x: x * 2)(21) == 42 and leg.calls[0]["slept"] >= 0.02
        passthru = Leg("fake", delay=0.0)
        assert passthru.wrap(lambda: "y")() == "y" and passthru.calls[0]["slept"] == 0.0

    def c6():
        assert classify_snapshot({"params": {"snapshot": {"missing": None}}}) == "answered"
        assert classify_snapshot({"params": {"snapshot": {"missing": "no_names"}}}) == "fell_back:no_names"
        assert classify_snapshot({"params": {"snapshot": {"needs": "the active setups board",
                                                          "missing": None}}}).startswith("fell_back:needs")
        assert classify_snapshot({"params": {}}) == "uncaptured" and classify_snapshot(None) == "absent"

    control("C1 pin guard refuses paths under the shared root", c1)
    control("C2 pin guard accepts a temp path and a near-miss sibling", c2)
    control("C3 nearest-rank summary maths on a known list", c3)
    control("C4 a fail-mode leg sleeps, records, and fails without calling through", c4)
    control("C5 a slow-mode leg sleeps then calls through; delay 0 passes through", c5)
    control("C6 snapshot classification reads the node", c6)
    for name, ok, why in results:
        print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  -- {why}" if why else ""))
    bad = [r for r in results if not r[1]]
    print(f"SELF-CHECK: {len(results) - len(bad)}/{len(results)} controls passed")
    return 1 if bad else 0


# ── the sandbox ─────────────────────────────────────────────────────────────────────────────

def pin_sandbox(sandbox: str) -> dict:
    """Census pins aimed at `sandbox`, applied BEFORE any api import (paths are captured at module
    import). Returns {env: path}. Importing conftest also arms the shared-root tripwire."""
    sys.path.insert(0, str(ROOT))
    import conftest  # noqa: F401 -- redirect + tripwire at import (not a deployed service)
    _, pins, unpinnable = conftest.shared_data_root_census()
    applied = {}
    for env, literal in pins.items():
        tail = literal.replace("\\", "/").strip("/")
        assert tail == "data" or tail.startswith("data/"), (env, literal)
        rest = tail[len("data"):].strip("/")
        target = os.path.join(sandbox, *rest.split("/")) if rest else sandbox
        os.environ[env] = target
        applied[env] = target
    os.environ["DATA_DIR"] = sandbox
    applied["DATA_DIR"] = sandbox
    os.environ.pop("ALLOW_LOCAL_VENDOR_SOCKETS", None)
    os.environ.pop("WORKER_ENABLED", None)          # web semantics (bars busy_timeout 2 s)
    # Mirror production's armed state for the two gates the levels part reads
    # (docs/feature_flags.json: both "armed" on web since 2026-10-08).
    os.environ["NOTEBOOK_SETUPS_BOARD_ENABLED"] = "1"
    os.environ["NOTEBOOK_CHART_PLAN_ENABLED"] = "1"
    refuse_shared_root(applied)
    return {"pins": applied, "unpinnable": list(unpinnable), "conftest": conftest}


class SocketGuard:
    """Records and REFUSES every outbound connection attempt in this process."""

    def __init__(self):
        self.attempts: list[dict] = []
        self._orig = {}

    def __enter__(self):
        guard = self
        self._orig = {"connect": socket.socket.connect, "connect_ex": socket.socket.connect_ex,
                      "create_connection": socket.create_connection, "getaddrinfo": socket.getaddrinfo}

        def refuse(kind, addr):
            import traceback
            guard.attempts.append({"kind": kind, "addr": repr(addr)[:120],
                                   "stack": traceback.format_stack(limit=12)[:-2]})
            raise OSError(f"probe: outbound {kind} refused ({addr!r})")

        socket.socket.connect = lambda self_, addr: refuse("connect", addr)
        socket.socket.connect_ex = lambda self_, addr: refuse("connect_ex", addr)
        socket.create_connection = lambda addr, *a, **k: refuse("create_connection", addr)
        socket.getaddrinfo = lambda host, *a, **k: refuse("getaddrinfo", host)
        return self

    def __exit__(self, *exc):
        socket.socket.connect = self._orig["connect"]
        socket.socket.connect_ex = self._orig["connect_ex"]
        socket.create_connection = self._orig["create_connection"]
        socket.getaddrinfo = self._orig["getaddrinfo"]


def _tickers(n: int) -> list[str]:
    data = json.loads((ROOT / "api" / "data" / "cap_universe.json").read_text(encoding="utf-8"))
    out = [t for t in data if isinstance(t, str) and t.isalpha() and t.isupper() and t not in ("SPY", "QQQ")]
    if len(out) < n:
        raise SystemExit(f"cap_universe has {len(out)} plain tickers, need {n}")
    return out[:n]


def _sessions(now: datetime, n: int = 3) -> list:
    from api.services import session_calendar
    from api.services.journal_two import trader_blocks as tb
    d = tb._last_completed_session(now)
    if d is None:
        raise SystemExit("the session calendar cannot place the last completed session")
    out = []
    while len(out) < n:
        if session_calendar.is_trading_day(d):
            out.append(d)
        d -= timedelta(days=1)
    return sorted(out)


def seed(now: datetime, big_n: int) -> dict:
    from api.services import auth_db, auth_service, bars_sqlite, watchlist_service
    from api.services.journal_two import positions
    from api.services.journal_two import trader_blocks as tb
    auth_db.init_db()
    bars_sqlite.init_db()
    names = _tickers(big_n + SMALL_NAMES)
    days = _sessions(now)
    for i, sym in enumerate(names + ["SPY", "QQQ"]):
        base = 20.0 + (i % 180)
        bars, prev = [], base
        for j, d in enumerate(days):
            c = round(prev * (1 + (((i * 7 + j * 3) % 13) - 6) / 100.0), 2)
            o = prev
            bars.append({"t": d.isoformat(), "o": o, "h": round(max(o, c) * 1.01, 2),
                         "l": round(min(o, c) * 0.99, 2), "c": c, "v": 100000 + i})
            prev = c
        if bars_sqlite.put_bars(sym, "D", bars, date_tf=True) != len(bars):
            raise SystemExit(f"put_bars refused a seeded bar for {sym}")
    members = {}
    for label, mine, split in (("big", names[:big_n], (10, 40)), ("small", names[big_n:], (1, 1))):
        u = auth_service.create_user(f"probe-{label}@probe.invalid", "ProbeOnly-Not-A-Secret-1", label)
        uid = u["id"]
        n_pos, n_flag = split
        pos, flag, wl = mine[:n_pos], mine[n_pos:n_pos + n_flag], mine[n_pos + n_flag:]
        for k, sym in enumerate(pos):
            positions.create_position(uid, {"symbol": sym, "side": "Long", "shares": 10, "entryPrice": 50.0,
                                            "entryDate": days[0].isoformat(), "stopPrice": 45.0}, {})
        watchlist_service.sync_flagged_items(uid, flag)
        w = watchlist_service.create_watchlist(uid, f"Probe {label}")
        watchlist_service.bulk_add_items(uid, w["id"], wl)
        got = tb._my_names(uid)
        if sorted(got) != sorted(mine):   # non-vacuity: the seed IS the prep's name set
            raise SystemExit(f"{label}: _my_names returned {len(got)} names, seeded {len(mine)}")
        members[label] = {"user_id": uid, "names": len(mine), "positions": len(pos), "flagged": len(flag),
                          "watchlist": len(wl)}
    return {"members": members, "sessions": [d.isoformat() for d in days], "names_sample": names[:5]}


def warm_caches(now: datetime, member_names: list[str]) -> dict:
    """The `warm` scenario: a held wire and a held earnings list, under the keys their owners write."""
    from api.services import engine
    from api.services.cache import cache
    from zoneinfo import ZoneInfo
    today = now.astimezone(ZoneInfo("America/New_York")).date().isoformat()
    para = ("Futures are firm into the open and the tape keeps rewarding tight bases near highs. "
            "Leadership rotated toward semis while defensives lagged, and breadth held up. ")
    focus = "".join(f"<li>FOCUS {i}: watch the opening range</li>" for i in range(12))
    body = "".join(f"<p>{para * 3}</p>" for _ in range(70))
    html = (f'<div class="rd-sections"><h3>TODAY\'S FOCUS</h3><ul>{focus}</ul>'
            f'<h3>THE NARRATIVE</h3>{body}</div>')
    wire = {"date": today, "rundown_html": html,
            "breadth": {"pct_above_50ma": 61.2, "pct_above_200ma": 55.4, "breadth_score": 64.0,
                        "distribution_days": 3, "market_phase": "Uptrend"},
            "exposure": {"score": 72.0, "score_delta": 4.0, "date": today},
            "leadership": [{"sym": s} for s in member_names[:20]]}
    cache.set("wire_data", wire, ttl=82800)        # push.py::push_wire_data stores exactly this key
    earnings = {"date": today, "bmo": [{"sym": s} for s in member_names[:6]] + [{"sym": "ZZZZ"}],
                "amc": [{"sym": s} for s in member_names[6:10]], "amc_tonight": [{"sym": s} for s in member_names[10:14]]}
    cache.set(engine.EARNINGS_CACHE_KEY, earnings, ttl=3600)
    return {"wire_html_bytes": len(html.encode("utf-8")), "earnings_rows": sum(len(v) for v in earnings.values()
                                                                            if isinstance(v, list))}


# ── the run ─────────────────────────────────────────────────────────────────────────────────

def _install(delay: float, mode: str) -> tuple[dict, dict, list]:
    import importlib
    legs, observers, undo = {}, {}, []
    for key, mod, attr, _what in LEGS:
        m = importlib.import_module(mod)
        leg = Leg(key, delay=delay, mode=mode)
        orig = getattr(m, attr)
        setattr(m, attr, leg.wrap(orig))
        undo.append((m, attr, orig))
        legs[key] = leg
    for key, mod, attr in OBSERVERS:
        m = importlib.import_module(mod)
        leg = Leg(key, observe_only=True)
        orig = getattr(m, attr)
        setattr(m, attr, leg.wrap(orig))
        undo.append((m, attr, orig))
        observers[key] = leg
    # engine.get_breadth, split by mode: held_only=True never fetches; the DEFAULT can (Priority 3).
    from api.services import engine
    held, default = Leg("engine.get_breadth(held_only=True)", observe_only=True), \
        Leg("engine.get_breadth(default)", observe_only=True)
    orig_gb = engine.get_breadth

    def get_breadth(held_only: bool = False):
        return (held if held_only else default).wrap(orig_gb)(held_only=held_only)
    engine.get_breadth = get_breadth
    undo.append((engine, "get_breadth", orig_gb))
    observers[held.key], observers[default.key] = held, default
    return legs, observers, undo


def _embed(note: dict, widget_id: str) -> dict | None:
    stack = list((note.get("bodyJson") or {}).get("content") or [])
    while stack:
        n = stack.pop(0)
        if isinstance(n, dict) and n.get("type") == "widgetEmbed" and (n.get("attrs") or {}).get("widgetId") == widget_id:
            return n["attrs"]
        if isinstance(n, dict) and isinstance(n.get("content"), list):
            stack[0:0] = n["content"]
    return None


def read_note(note: dict) -> dict:
    out = {"parts": {}, "context": {}, "regime_at_write": (note.get("propertiesJson") or {}).get(REGIME_PROP)}
    for wid in PREP_WIDGETS:
        attrs = _embed(note, wid)
        rec = {"outcome": classify_snapshot(attrs)}
        snap = ((attrs or {}).get("params") or {}).get("snapshot") or {}
        if wid == "prepMovers":
            rec.update({k: snap.get(k) for k in ("scanned", "total", "unquoted")},
                       items=len(snap.get("items") or []))
        if wid == "prepEarnings":
            rec.update(listed=sum(len(snap.get(k) or []) for k in ("bmo", "amc", "amcTonight")))
        if wid == "prepWire":
            rec.update(headline=bool(snap.get("headline")), regime=snap.get("regime"))
        out["parts"][wid] = rec
    mc = _embed(note, "marketcontext")
    readings = ((mc or {}).get("params") or {}).get("readings") or {}
    for f in CONTEXT_FIELDS:
        r = readings.get(f) or {}
        out["context"][f] = "absent" if not r else ("answered" if not r.get("missing") else "fell_back")
    return out


def run_member(label: str, uid: str, k: int, legs: dict, observers: dict, warmup: int = 1) -> dict:
    from api.services.journal_two import journal_styles as js
    creates = []
    for i in range(warmup + k):                  # the first `warmup` creates are reported apart
        before = {key: len(l.calls) for key, l in {**legs, **observers}.items()}
        me = threading.get_ident()
        t0 = time.perf_counter()
        note, skipped = js.create_styled_note(uid, {"kindId": "daily_prep", "title": f"Probe prep {label} {i}"})
        t1 = time.perf_counter()
        per_leg = {}
        for key, l in {**legs, **observers}.items():
            calls = l.calls[before[key]:]
            if not calls:
                continue
            per_leg[key] = {
                "calls": len(calls),
                "seconds_inside": round(sum((c["end"] or t1) - c["start"] for c in calls), 6),
                "slept": round(sum(c["slept"] for c in calls), 6),
                "failed": sum(1 for c in calls if c["failed"]),
                "off_thread": sum(1 for c in calls if c["thread"] != me),
                "outlived_create": sum(1 for c in calls if c["end"] is None or c["end"] > t1),
            }
        creates.append({"i": i, "warmup": i < warmup, "wall_s": round(t1 - t0, 6), "skipped": skipped,
                        "styleVersion": note.get("styleVersion"), "note": read_note(note), "legs": per_leg})
    timed = [c["wall_s"] for c in creates if not c["warmup"]]
    outcomes: dict = {}
    for c in creates:
        if c["warmup"]:
            continue
        for wid, rec in c["note"]["parts"].items():
            outcomes.setdefault(wid, {}).setdefault(rec["outcome"], 0)
            outcomes[wid][rec["outcome"]] += 1
        for f, o in c["note"]["context"].items():
            outcomes.setdefault(f"marketcontext.{f}", {}).setdefault(o, 0)
            outcomes[f"marketcontext.{f}"][o] += 1
        o = "stored" if c["note"]["regime_at_write"] else "absent"
        outcomes.setdefault("regime_at_write", {}).setdefault(o, 0)
        outcomes["regime_at_write"][o] += 1
    return {"label": label, "user_id": uid, "wall_s": summarize(timed),
            "warmup_wall_s": [c["wall_s"] for c in creates if c["warmup"]],
            "outcomes": outcomes, "creates": creates}


def _git(*args) -> str:
    try:
        return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True,
                              check=True).stdout.strip()
    except Exception as e:  # noqa: BLE001
        return f"unreadable: {e}"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--k", type=int, default=10, help="timed creates per member")
    ap.add_argument("--warmup", type=int, default=1, help="untimed warm-up creates per member (reported apart)")
    ap.add_argument("--vendor-delay", type=float, default=0.0, help="seconds each leg sleeps per call")
    ap.add_argument("--vendor-mode", choices=("fail", "slow"), default="fail")
    ap.add_argument("--scenario", choices=("cold", "warm", "both"), default="both")
    ap.add_argument("--big-names", type=int, default=None, help="default: trader_blocks.MOVERS_SCAN_MAX")
    ap.add_argument("--json", dest="json_path", default=None)
    ap.add_argument("--sandbox", default=None, help="default: a fresh temp directory")
    a = ap.parse_args(argv)
    if a.self_check:
        return self_check()

    sandbox = a.sandbox or tempfile.mkdtemp(prefix="t15b_daily_prep_probe_")
    pinned = pin_sandbox(sandbox)
    conftest = pinned["conftest"]
    from api.services import auth_db, bars_sqlite, engine, member_interest
    from api.services.journal_two import trader_blocks as tb
    resolved = {"auth_db._DB_PATH": auth_db._DB_PATH, "bars_sqlite._DB_PATH": bars_sqlite._DB_PATH,
                "member_interest._auth_db_path()": member_interest._auth_db_path(),
                "engine.PERSISTENT_WIRE_DATA_FILE": engine.PERSISTENT_WIRE_DATA_FILE,
                "engine.WIRE_DATA_FILE": engine.WIRE_DATA_FILE, "engine.STATE_FILE": engine.STATE_FILE}
    refuse_shared_root(resolved)
    if os.path.normcase(os.path.abspath(auth_db._DB_PATH)) != os.path.normcase(os.path.abspath(member_interest._auth_db_path())):
        raise SystemExit(f"auth.db split: auth_db={auth_db._DB_PATH} member_interest={member_interest._auth_db_path()}")
    big_n = a.big_names or tb.MOVERS_SCAN_MAX
    now = datetime.now(timezone.utc)
    print(f"tree {_git('rev-parse', '--short', 'HEAD')}  sandbox {sandbox}")
    print(f"pins applied: {len(pinned['pins'])}  unpinnable: {len(pinned['unpinnable'])}  "
          f"every resolved path outside {shared_roots()}")
    seeded = seed(now, big_n)
    print(f"seeded: {seeded['members']}")
    scenarios = ("cold", "warm") if a.scenario == "both" else (a.scenario,)
    out = {
        "probe": "tools/notebook_daily_prep_probe.py", "tree": _git("rev-parse", "--short", "HEAD"),
        "tree_dirty_paths": [ln for ln in _git("status", "--porcelain").splitlines() if ln.strip()],
        "started_utc": now.isoformat(), "python": sys.version.split()[0], "platform": platform.platform(),
        "config": {"k": a.k, "vendor_delay_s": a.vendor_delay, "vendor_mode": a.vendor_mode,
                   "big_names": big_n, "small_names": SMALL_NAMES, "movers_scan_max": tb.MOVERS_SCAN_MAX,
                   "percentiles": "nearest-rank", "warmup_creates_per_member": a.warmup,
                   "env": {k: os.environ.get(k) for k in ("NOTEBOOK_SETUPS_BOARD_ENABLED",
                                                         "NOTEBOOK_CHART_PLAN_ENABLED", "WORKER_ENABLED",
                                                         "ALLOW_LOCAL_VENDOR_SOCKETS")}},
        "sandbox": sandbox, "resolved_paths": resolved, "seed": seeded,
        "legs": [{"key": k, "module": m, "attr": at, "reads": w} for k, m, at, w in LEGS],
        "observers": [k for k, _, _ in OBSERVERS] + ["engine.get_breadth(held_only=True)", "engine.get_breadth(default)"],
        "scenarios": {},
    }
    from api.services.cache import cache
    for sc in scenarios:
        for key in ("wire_data", "breadth", "rundown", engine.EARNINGS_CACHE_KEY):
            cache.invalidate(key)
        warm = warm_caches(now, _tickers(big_n)) if sc == "warm" else None
        legs, observers, undo = _install(a.vendor_delay, a.vendor_mode)
        try:
            with SocketGuard() as guard:
                members = {}
                for label in ("small", "big"):
                    uid = seeded["members"][label]["user_id"]
                    print(f"[{sc}] {label}: {a.warmup}+{a.k} creates, vendor delay {a.vendor_delay}s ({a.vendor_mode}) ...",
                          flush=True)
                    members[label] = run_member(label, uid, a.k, legs, observers, a.warmup)
                    w = members[label]["wall_s"]
                    print(f"[{sc}] {label}: p50 {w['p50']:.4f}s  p95 {w['p95']:.4f}s  max {w['max']:.4f}s  "
                          f"(warm-up {members[label]['warmup_wall_s']})", flush=True)
                    for part, oc in members[label]["outcomes"].items():
                        print(f"      {part:28s} {oc}")
        finally:
            for m, attr, orig in reversed(undo):
                setattr(m, attr, orig)
        out["scenarios"][sc] = {"warm_seed": warm, "members": members,
                                "outbound_socket_attempts": guard.attempts}
        print(f"[{sc}] outbound socket attempts: {len(guard.attempts)}")
    out["shared_root_writes_blocked"] = len(conftest.SHARED_ROOT_VIOLATIONS)
    out["shared_root_reads_recorded"] = len(conftest.SHARED_ROOT_READS)
    out["finished_utc"] = datetime.now(timezone.utc).isoformat()
    print(f"shared-root writes blocked: {out['shared_root_writes_blocked']}  reads recorded: "
          f"{out['shared_root_reads_recorded']}")
    if a.json_path:
        p = Path(a.json_path)
        if not p.is_absolute():
            p = ROOT / p
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "w", encoding="utf-8", newline="\n") as f:
            json.dump(out, f, indent=1)
            f.write("\n")
        print(f"raw JSON: {p}")
    bad = out["shared_root_writes_blocked"] or any(s["outbound_socket_attempts"] for s in out["scenarios"].values())
    print("VERDICT: " + ("FINDINGS (see shared-root / socket counts)" if bad else "RAN CLEAN"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
