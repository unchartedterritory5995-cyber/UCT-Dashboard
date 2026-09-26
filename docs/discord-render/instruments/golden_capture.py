"""Capture the PRE-V2 reply payloads, deterministically, with no network (step 2.7).

⛔⛔ **WHAT THIS PROVES, AND IT IS ONLY THIS: THE PRE-V2 PATH IS BYTE-FOR-BYTE UNCHANGED.** The P2
ground rule is that with `DISCORD_RENDER_V2_ENABLED` unset a member sees exactly what they see
today. That is a claim about the reply Discord receives — the content string, the control tree, the
filename, the image — and it is the only claim a golden can settle. It does **not** pin the V2 copy:
`tests/test_discord_render_badge.py` owns that, and a golden of copy nobody has shipped yet pins a
guess rather than a behaviour.

⛔⛔ **CAPTURE DETERMINISM IS ASSERTED BEFORE ANY STORED GOLDEN IS TRUSTED.** `capture_twice()` runs
the whole capture twice back to back and compares. A golden harness whose own output varies is worse
than none: it fails on a wall clock and passes on a real regression, and after two weeks of that
everybody re-baselines the golden without reading the diff. The test does this FIRST; so does
`--write`, which refuses to store a golden it could not reproduce a second time.

⛔ **NO NETWORK. THE STUB IS PART OF THE GOLDEN.** Every stub is declared in `STUBS`, written into
the capture, and compared like any other field — so "somebody quietly swapped a stub" reads as a
drift rather than as a mystery. There is no Chromium here and there must not be: this is
**payload-level**, not pixel-level. PNG bodies are hashed, never stored — a committed binary nobody
can read cannot distinguish a render change from a library upgrade.

⭐ **THE STUBS ARE ALSO THE ORACLE.** `bars_fn` and `render_fn` record what the pipeline ASKED them
for — which timeframe, how many bars, with which kwargs. That is where the pre-V2 path's real
behaviour lives (the daily-first fetch, the intraday multiplier, the `daily_bars` stats switch), and
a payload-only golden would let all of it move silently.

    python docs/discord-render/instruments/golden_capture.py            # capture + compare
    python docs/discord-render/instruments/golden_capture.py --write    # store a new golden
    python docs/discord-render/instruments/golden_capture.py --self-check

⚠️ **Run standalone, this file pins the shared-data-root census BEFORE importing anything from
`api.**`** — `DATA_DIR` alone reaches 1 of 72 path variables, and a bare probe that set only that
one wrote two databases into the owner's live `C:\\data` on 2026-09-12. Under pytest the repo-root
`conftest.py` has already done it at import; here `main()` does it explicitly.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
GOLDEN = Path(__file__).resolve().parent / "goldens" / "prev2_replies.json"
#: ⛔ A SEPARATE FILE, ON PURPOSE. `prev2_replies.json` has one job — proving the pre-V2 REPLY is
#: byte-for-byte unchanged — and it says in this module's docstring that it must not pin V2 copy.
#: The render URL is a different artifact answering a different question (what the renderer is
#: pointed at, C-07), and mixing the two would leave one file with two purposes and a reader unsure
#: which claim a drift belongs to.
URL_GOLDEN = Path(__file__).resolve().parent / "goldens" / "render_urls.json"

CAPTURE_VERSION = 1
URL_CAPTURE_VERSION = 1

# ── the fixed world ─────────────────────────────────────────────────────────
#
# ⛔ CLOSED-MARKET DATA, ON PURPOSE (§3.10). The same closed-market input must render the same
# pixels; a capture taken against a forming bar could not be compared with itself an hour later.
# Friday 2026-09-11 is a full trading day, and every fixture bar ends at its close.
FIXED_TODAY = "2026-09-11"
FIXED_SESSION_END_UNIX = 1757620800      # 2026-09-11 16:00 ET, as the intraday bars carry it

#: Env this capture pins. ⛔ Named and written into the golden rather than assumed: an unpinned
#: variable that happens to be unset on one machine is a golden that only reproduces on that machine.
ENV_PINS = {
    "DISCORD_CHART_FAST_FIRST": "0",     # the stand-in ladder needs a house renderer; there is none
    "DISCORD_CHART_SELF_HEAL": "0",      # the heal schedules a timer; a capture schedules nothing
    "DISCORD_ACTIVITY_GUILDS": "",       # the parked Activity swaps a button out of the last row
    "CHART_RENDER_BASE_URL": "https://uctintelligence.com",
}

#: Every stub, and why it exists. Written into the capture and compared, so swapping one is a drift.
STUBS = [
    {"target": "bars_fn", "kind": "fixture",
     "why": "the bars authority is a network call; the fixture is closed-market and records what "
            "the pipeline asked for, which is where the pre-V2 fetch plan actually lives"},
    {"target": "render_fn", "kind": "fixture",
     "why": "mplfinance draws a real PNG whose bytes move with the library; the stub returns bytes "
            "derived from the request, so the hash is sensitive to what we handed the renderer and "
            "not to matplotlib's version"},
    {"target": "house_fn", "kind": "absent",
     "why": "the house renderer is chart-renderer over HTTP. Absent, so `produce_chart` takes the "
            "mplfinance leg and nothing reaches the network"},
    {"target": "discord_interactions.pan_to(today=)", "kind": "clock",
     "why": "⚠️ THE ONLY WALL CLOCK IN THE PRE-V2 CONTROL TREE. The expanded rows' ◀ Earlier button "
            "encodes a date computed from `date.today()`, so that custom_id changes every day. "
            "Pinned here; recorded as a §3.10 finding in the report rather than silently frozen"},
    {"target": "edit_fn", "kind": "capture surface",
     "why": "the PATCH to Discord. It records the payload instead of sending it, and returns the "
            "message dict shape the real `edit_original` returns so the follow-up path is real"},
    {"target": "flow fetch_fn", "kind": "fixture",
     "why": "flow-worker over HTTP; the fixture is a fixed tape"},
    {"target": "flow render_fn / buzz render_fn", "kind": "fixture",
     "why": "the card and board renderers draw real images; hashed stubs, same reason as render_fn"},
]


# ── deterministic fixtures ──────────────────────────────────────────────────

def _n(seed: str, i: int, lo: int, hi: int) -> int:
    """A stable pseudo-random integer. ⛔ `hashlib`, never `hash()` — Python's is salted per process
    (PYTHONHASHSEED), so a fixture built on it produces a different golden on every run and the
    determinism check would fail for a reason that has nothing to do with the product."""
    d = hashlib.sha256(f"{seed}:{i}".encode()).digest()
    return lo + int.from_bytes(d[:4], "big") % (hi - lo + 1)


def _ohlcv(seed: str, i: int, t) -> dict:
    close = 50.0 + _n(seed, i, 0, 40_000) / 1000.0
    hi = round(close + _n(seed, i + 7919, 1, 900) / 1000.0, 3)
    lo = round(close - _n(seed, i + 104_729, 1, 900) / 1000.0, 3)
    return {"t": t, "o": round((hi + lo) / 2, 3), "h": hi, "l": lo, "c": round(close, 3),
            "v": _n(seed, i + 15_485_863, 100_000, 90_000_000)}


def _daily_series(ticker: str, n: int) -> list[dict]:
    import datetime as dt
    end = dt.date.fromisoformat(FIXED_TODAY)
    days, d = [], end
    while len(days) < n:
        if d.weekday() < 5:
            days.append(d.isoformat())
        d -= dt.timedelta(days=1)
    return [_ohlcv(ticker, i, t) for i, t in enumerate(reversed(days))]


def _weekly_series(ticker: str, n: int) -> list[dict]:
    import datetime as dt
    end = dt.date.fromisoformat(FIXED_TODAY)
    weeks = [(end - dt.timedelta(days=7 * k)).isoformat() for k in range(n)]
    return [_ohlcv(ticker, i, t) for i, t in enumerate(reversed(weeks))]


def _intraday_series(ticker: str, tf: str, n: int) -> list[dict]:
    step = int(tf) * 60
    stamps = [FIXED_SESSION_END_UNIX - step * k for k in range(n)]
    return [_ohlcv(ticker, i, t) for i, t in enumerate(reversed(stamps))]


def bars_for(ticker: str, tf: str, n: int) -> list[dict]:
    if tf == "D":
        return _daily_series(ticker, n)
    if tf == "W":
        return _weekly_series(ticker, n)
    return _intraday_series(ticker, tf, n)


class Recorder:
    """The stubs, and the tape of everything they were asked for."""

    def __init__(self, *, known=("NVDA", "AAPL", "SPY", "UCTA5"), fail_render: bool = False):
        self.known = set(known)
        self.fail_render = fail_render
        self.bars_calls: list = []
        self.render_calls: list = []
        self.edits: list = []

    # the bars authority
    def bars_fn(self, ticker, tf, n):
        self.bars_calls.append({"ticker": ticker, "tf": tf, "n": int(n)})
        if ticker not in self.known:
            return None
        return bars_for(ticker, tf, int(n))

    # mplfinance
    def render_fn(self, ticker, tf, bars, **kw):
        call = {"ticker": ticker, "tf": tf, "bars": len(bars or []),
                "first_t": (bars or [{}])[0].get("t"), "last_t": (bars or [{}])[-1].get("t"),
                "kwargs": {k: (len(v) if isinstance(v, list) else v) for k, v in sorted(kw.items())}}
        self.render_calls.append(call)
        if self.fail_render:
            raise RuntimeError("render stub: deliberate failure")
        return _png(call)

    # the PATCH to Discord
    def edit_fn(self, app_id, token, **kw):
        self.edits.append(_payload(kw))
        # the shape the real `edit_original` returns on 2xx — the caller reads its attachment ids
        return {"id": "0", "attachments": [{"id": 0, "filename": kw.get("filename")}]
                if kw.get("png") is not None else []}


def _png(call: dict) -> bytes:
    """A PNG whose bytes are a function of the request. ⛔ Hashed, never stored (04 §6)."""
    digest = hashlib.sha256(json.dumps(call, sort_keys=True, default=str).encode()).digest()
    return b"\x89PNG\r\n\x1a\n" + digest


def _render_class(cls) -> str:
    """The render class by the product's OWN name for it (render_gate.CLASS_NAMES), so a stored
    golden reads `member` and a changed class diffs as member -> background, not 0 -> 1."""
    from api.services.render_gate import CLASS_NAMES
    return CLASS_NAMES.get(cls, repr(cls))


def _payload(kw: dict) -> dict:
    """One reply payload, JSON-safe. The image is a hash and a length, never bytes."""
    out = {k: v for k, v in kw.items() if k not in ("png", "pngs", "client")}
    png = kw.get("png")
    if png is not None:
        out["png_sha256"] = hashlib.sha256(png).hexdigest()
        out["png_bytes"] = len(png)
    return out


# ── the scenarios ───────────────────────────────────────────────────────────

def _scenarios(di):
    CR = di.ChartRequest
    return [
        ("chart/NVDA/D/default", dict(req=CR(ticker="NVDA", tf="D"), prefs={})),
        ("chart/NVDA/D/controls-expanded", dict(req=CR(ticker="NVDA", tf="D", expanded=True), prefs={})),
        ("chart/NVDA/D/panned", dict(req=CR(ticker="NVDA", tf="D", to="2026-06-01", expanded=True), prefs={})),
        ("chart/AAPL/5/no-mas-no-volume",
         dict(req=CR(ticker="AAPL", tf="5"), prefs={"mas": "off", "volume": False})),
        ("chart/SPY/W/heikin-dark",
         dict(req=CR(ticker="SPY", tf="W"), prefs={"style": "heikin", "theme": "dark"})),
        ("chart/SPY/D/stats-off", dict(req=CR(ticker="SPY", tf="D"), prefs={"stats": False})),
        ("chart/UCTA5/D/breadth",
         dict(req=CR(ticker="UCTA5", tf="D", daily_only=True, breadth_name="pct_above_5sma",
                     display="UCTA5 · % of Stocks Above 5-Day MA"), prefs={})),
        ("chart/NOPE/D/unknown-ticker", dict(req=CR(ticker="NOPE", tf="D"), prefs={})),
        ("chart/NVDA/D/render-failed", dict(req=CR(ticker="NVDA", tf="D"), prefs={}, fail_render=True)),
        ("chart/NVDA/D/no-controls", dict(req=CR(ticker="NVDA", tf="D"), prefs={}, components=False)),
    ]


FLOW_TAPE = {
    "ok": True,
    "symbol": "NVDA",
    "window": {"days_requested": "5", "start": "2026-09-05", "end": "2026-09-11"},
    "contracts": [
        {"contract": "NVDA 2026-10-17 C 180", "premium": 4_250_000, "side": "call", "trades": 31},
        {"contract": "NVDA 2026-09-19 P 160", "premium": 1_100_000, "side": "put", "trades": 12},
    ],
    "net_premium": 3_150_000,
}


def _capture_chart(di, name: str, spec: dict) -> dict:
    from api.services import discord_chart_cache as png_cache
    png_cache.clear()
    rec = Recorder(fail_render=bool(spec.get("fail_render")))
    components_fn = di.chart_components if spec.get("components", True) else None
    outcome = di.run_chart_job("app", "tok", spec["req"], bars_fn=rec.bars_fn, render_fn=rec.render_fn,
                               edit_fn=rec.edit_fn, house_fn=None, prefs=spec["prefs"],
                               quote_fn=None, components_fn=components_fn, context_fn=None)
    return {"outcome": outcome, "bars_requests": rec.bars_calls,
            "render_requests": rec.render_calls, "edits": rec.edits}


def _capture_flow(router, name: str, spec: dict) -> dict:
    rec = Recorder()
    data = spec["data"]
    router.run_flow_card_job("app", "tok", spec["ticker"], spec["days"],
                             fetch_fn=lambda t, d: copy.deepcopy(data) if data is not None else None,
                             render_fn=lambda payload: _png({"flow": payload}),
                             edit_fn=rec.edit_fn)
    return {"edits": rec.edits}


def _capture_buzz(router, name: str, spec: dict) -> dict:
    rec = Recorder()
    router.run_buzz_image_job("app", "tok", spec["content"], spec["window"],
                              # `cls` is part of the REQUEST (83e430adf, 2026-09-15: the render class is required);
                              # the stub takes it and hashes it, so a change of class shows as drift.
                              render_fn=lambda w, cls=None: (_png({"buzz": w, "cls": _render_class(cls)}) if spec["draws"] else None),
                              edit_fn=rec.edit_fn)
    return {"edits": rec.edits}


def capture() -> dict:
    """One full capture. No network, no clock, no Chromium."""
    for k, v in ENV_PINS.items():
        os.environ[k] = v

    from api.routers import discord_interactions as router
    from api.services import discord_interactions as di

    real_pan_to = di.pan_to
    di.pan_to = lambda current_to, tf, zoom, direction, today=None: real_pan_to(
        current_to, tf, zoom, direction, today or FIXED_TODAY)
    try:
        scenarios = {}
        for name, spec in _scenarios(di):
            scenarios[name] = _capture_chart(di, name, spec)
        for name, spec in [
            ("flow/NVDA/5/delivered", dict(ticker="NVDA", days="5", data=FLOW_TAPE)),
            ("flow/NVDA/1/quiet-tape",
             dict(ticker="NVDA", days="1",
                  data={**FLOW_TAPE, "contracts": [], "window": {"days_requested": "1"}})),
            ("flow/NVDA/all/all-history",
             dict(ticker="NVDA", days="all",
                  data={**FLOW_TAPE, "window": {"days_requested": "all"}})),
            ("flow/NVDA/1/unreadable", dict(ticker="NVDA", days="1", data=None)),
            ("flow/NVDA/1/not-ok", dict(ticker="NVDA", days="1", data={"ok": False})),
        ]:
            scenarios[name] = _capture_flow(router, name, spec)
        for name, spec in [
            ("buzz/board/drawn", dict(content="**Buzz** · since the open", window="open", draws=True)),
            ("buzz/board/no-image", dict(content="**Buzz** · since the open", window="open", draws=False)),
        ]:
            scenarios[name] = _capture_buzz(router, name, spec)
    finally:
        di.pan_to = real_pan_to

    return {"version": CAPTURE_VERSION,
            "generated_by": "docs/discord-render/instruments/golden_capture.py",
            "world": {"today": FIXED_TODAY, "session_end_unix": FIXED_SESSION_END_UNIX,
                      "env": dict(ENV_PINS)},
            "stubs": STUBS,
            "scenarios": scenarios}


def capture_twice() -> tuple[dict, dict]:
    """⛔ THE FIRST THING ANY CALLER DOES. Two full captures, back to back."""
    return capture(), capture()


# ── the render URL the renderer is pointed at (C-07) ────────────────────────
#
# ⛔⛔ THE STALE RENDER IS COVERED HERE BECAUSE IT CANNOT BE COVERED ABOVE. The reply golden runs
# with `house_fn` absent — deliberately, so nothing reaches the network — which means the house URL
# is never built on that path at all. A golden that could not see the parameter it is supposed to
# cover would read as coverage and be none (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
#
# ⭐ AND THIS ONE COVERS BOTH SIDES OF THE PROMISE IN ONE ARTIFACT: the vintage-bearing URLs are the
# C-07 closure, and every row beside them carries no vintage and must never move.

#: The vintage stamps below are FIXED strings, never computed from a clock — §3.10 again: the same
#: closed-market input renders the same pixels, and a golden that re-derived "yesterday" would go
#: red every morning for a reason nobody could act on.
URL_BASE = {"base_url": "https://uctintelligence.com", "token": "RENDER-TOKEN"}
URL_STATS = {"as_of": FIXED_TODAY, "close": 553.11, "day_pct": -3.47, "volume": 41_000_000}
STALE_AT = "2026-09-04 16:00"

URL_CASES = [
    # ── no vintage: every one of these must be byte-identical forever ──────
    ("daily/bare", ("NVDA", "D", None), {}),
    ("daily/stats", ("NVDA", "D", URL_STATS), {}),
    ("intraday/5-ext", ("AAPL", "5", URL_STATS), {"ext": True}),
    ("intraday/30-no-ext", ("AAPL", "30", None), {"ext": False}),
    ("weekly/heikin-dark", ("SPY", "W", URL_STATS),
     {"stats": False, "preset": "dark", "indicators": {"heikinAshi": True}}),
    ("daily/panned", ("NVDA", "D", URL_STATS), {"to": "2026-06-01", "bars": 240}),
    ("breadth/uct-a5", ("UCTA5", "D", None), {"breadth": "pct_above_5sma"}),
    ("daily/compare", ("NVDA", "D", URL_STATS), {"compare": ["spy", "qqq"]}),
    ("daily/exttag", ("NVDA", "D", URL_STATS), {"exttag": ("post", 178.125)}),

    # ── the C-07 cases: what a member's picture is told about its own data ──
    ("stale/daily", ("NVDA", "D", URL_STATS), {"stale": True, "as_of": STALE_AT}),
    ("stale/intraday-with-everything", ("AAPL", "5", URL_STATS),
     {"ext": True, "compare": ["spy"], "preset": "dark", "stale": True, "as_of": STALE_AT}),
    ("stale/verdict-false", ("NVDA", "D", URL_STATS), {"stale": False, "as_of": STALE_AT}),
    ("stale/verdict-unknown", ("NVDA", "D", URL_STATS), {"stale": None, "as_of": STALE_AT}),
    ("stale/no-readable-timestamp", ("NVDA", "D", URL_STATS), {"stale": True, "as_of": ""}),
]


def capture_render_urls() -> dict:
    """Every render URL shape, including the stale one. No clock, no network, no env."""
    from api.services.discord_chart_house import build_render_url

    cases = {}
    for name, (sym, tf, stats), opts in URL_CASES:
        cases[name] = {
            # ⛔ THROUGH JSON, NOT `deepcopy`. The stored golden has been through a JSON round trip
            # and `("post", 178.125)` comes back a list; a fresh capture holding the tuple would
            # drift against it forever on a difference that is the file format, not the product.
            "options": json.loads(json.dumps(opts, sort_keys=True, default=str)),
            "carries_vintage": "stale=" in build_render_url(sym, tf, stats, **URL_BASE,
                                                            options=opts or None),
            "url": build_render_url(sym, tf, stats, **URL_BASE, options=opts or None),
        }
    return {"version": URL_CAPTURE_VERSION,
            "generated_by": "docs/discord-render/instruments/golden_capture.py",
            "world": {"today": FIXED_TODAY, "stale_at": STALE_AT, "base": dict(URL_BASE)},
            "cases": cases}


def canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, indent=2, ensure_ascii=False, default=str)


def diff_paths(a, b, path: str = "") -> list[str]:
    """Every leaf that differs, named by path. ⛔ NAMES, NOT A COUNT — a differ that says '3 fields
    moved' makes the reader open both files, which is the moment the golden stops being read."""
    if type(a) is not type(b):
        return [f"{path or '<root>'}: {type(a).__name__} vs {type(b).__name__}"]
    if isinstance(a, dict):
        out = []
        for k in sorted(set(a) | set(b)):
            if k not in a:
                out.append(f"{path}/{k}: absent vs {b[k]!r}")
            elif k not in b:
                out.append(f"{path}/{k}: {a[k]!r} vs absent")
            else:
                out += diff_paths(a[k], b[k], f"{path}/{k}")
        return out
    if isinstance(a, list):
        if len(a) != len(b):
            return [f"{path}: {len(a)} item(s) vs {len(b)}"]
        return [d for i, (x, y) in enumerate(zip(a, b)) for d in diff_paths(x, y, f"{path}[{i}]")]
    return [] if a == b else [f"{path or '<root>'}: {a!r} vs {b!r}"]


def load_golden(path: Path = GOLDEN) -> dict | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def write_golden(data: dict, path: Path = GOLDEN) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # ⛔ LF, matching what git stores for a new file (owner ruling R-2, 2026-09-13).
    path.write_bytes((canonical(data) + "\n").encode("utf-8"))


# ── standalone entry point ──────────────────────────────────────────────────

def _pin_shared_data_root() -> None:
    """⛔ APPLY THE CENSUS, NEVER A HAND-PICKED VAR — and BEFORE importing anything from `api.**`.

    `DATA_DIR` reaches one of the 72 independent path variables; a probe that set only that one
    still wrote into the owner's live `C:\\data`. These paths are captured at MODULE IMPORT, so a
    pin set afterwards reaches nothing."""
    import tempfile

    sys.path.insert(0, str(ROOT))
    import conftest                                   # the repo-root one, which owns the census
    sandbox = Path(tempfile.gettempdir()) / "uct-golden-capture"
    sandbox.mkdir(exist_ok=True)
    _, pins, _ = conftest.shared_data_root_census()
    for env, literal in pins.items():
        os.environ[env] = literal.replace("/data", str(sandbox)).replace("\\", "/")


def _self_check() -> int:
    """⛔ PROVE THE DIFFER CAN FAIL. A comparison nobody has seen report a difference is not a
    comparison, and this whole instrument is one comparison."""
    a = {"scenarios": {"x": {"edits": [{"content": "hello", "components": [1]}]}}}
    b = copy.deepcopy(a)
    print("identical captures         ->", diff_paths(a, b) or "no drift  ok")
    b["scenarios"]["x"]["edits"][0]["content"] = "hell"
    print("one character changed      ->", diff_paths(a, b))
    b = copy.deepcopy(a)
    b["scenarios"]["x"]["edits"].append({"content": "extra"})
    print("an extra edit              ->", diff_paths(a, b))
    b = copy.deepcopy(a)
    del b["scenarios"]["x"]["edits"][0]["components"]
    print("a dropped control tree     ->", diff_paths(a, b))
    ok = (not diff_paths(a, a)) and len(diff_paths(a, b)) == 1
    print("\nself-check", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def main() -> int:
    if "--self-check" in sys.argv:
        return _self_check()
    _pin_shared_data_root()
    first, second = capture_twice()
    unstable = diff_paths(first, second)
    print(f"scenarios captured: {len(first['scenarios'])}")
    if unstable:
        print(f"*** THE CAPTURE IS NOT DETERMINISTIC — {len(unstable)} field(s) moved between two "
              "back-to-back runs. Nothing below would mean anything.")
        for line in unstable[:20]:
            print("   ", line)
        return 1
    print("capture determinism: two back-to-back runs agree")

    urls_first, urls_second = capture_render_urls(), capture_render_urls()
    url_unstable = diff_paths(urls_first, urls_second)
    if url_unstable:
        print(f"*** THE RENDER-URL CAPTURE IS NOT DETERMINISTIC — {len(url_unstable)} field(s) moved")
        for line in url_unstable[:20]:
            print("   ", line)
        return 1
    stale_cases = sum(1 for c in urls_first["cases"].values() if c["carries_vintage"])
    print(f"render URLs captured: {len(urls_first['cases'])} ({stale_cases} carrying a vintage)")

    if "--write" in sys.argv:
        write_golden(first)
        write_golden(urls_first, URL_GOLDEN)
        print(f"wrote {GOLDEN.relative_to(ROOT)}")
        print(f"wrote {URL_GOLDEN.relative_to(ROOT)}")
        return 0
    stored = load_golden()
    if stored is None:
        print(f"*** no stored golden at {GOLDEN.relative_to(ROOT)} — run with --write")
        return 1
    drift = diff_paths(stored, first)
    print(f"drift against the stored golden: {len(drift)}")
    for line in drift[:40]:
        print("   ", line)

    stored_urls = load_golden(URL_GOLDEN)
    if stored_urls is None:
        print(f"*** no stored golden at {URL_GOLDEN.relative_to(ROOT)} — run with --write")
        return 1
    url_drift = diff_paths(stored_urls, urls_first)
    print(f"drift against the stored render-URL golden: {len(url_drift)}")
    for line in url_drift[:40]:
        print("   ", line)
    return 0 if not (drift or url_drift) else 1


if __name__ == "__main__":
    sys.exit(main())
