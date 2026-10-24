"""The member chart, replayed from one fixture's bars through the PRODUCTION route.

`member_payload(case)` calls api.routers.patterns.get_detections exactly as a paid member's chart does
(include_structures=True, confirmed_only=False, min_conf 50, role "member") with every released layer's flag
on, and with the route's data sources pointed at the fixture instead of the stores:

  * bars_sqlite.get_bars / get_bars_before  -> the fixture's daily bars (oldest first, the last one the as-of bar)
  * barspack._last_complete_session_ymd     -> the as-of bar (so the as-of session is COMPLETE)
  * memory.get_active_detections            -> the member detectors run on the bars as the daily scan runs them
                                               (the same replay auto_structures.shelf_member_facts uses)
  * memory.latest_scan_at                   -> the replayed scan's stamp
  * deal_status.chart_marker                -> None (no judged chart was a pending deal)
  * auto_structures._scan_universe          -> the fixture's recorded membership (no ticker is stored)

Nothing else is replaced: member_rows, the freshness filter, every precedence pass, one-line-per-base, the
metrics / textbook numbers, the shelf pivot, the S/R layer and the setup drawings all run as production code.
"""
from __future__ import annotations

import contextlib
import datetime as _dt
import gzip
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(HERE, "fixtures")

#: The flags of every member layer, on: the gate guards what the CODE serves once a layer is switched on.
MEMBER_FLAGS = ("AUTO_STRUCTURES_ENABLED", "AUTO_STRUCTURES_MEMBERS_ENABLED", "AUTO_STRUCTURES_SHAPES_ENABLED",
                "AUTO_STRUCTURES_METRICS_ENABLED", "AUTO_STRUCTURES_TEXTBOOK_NUMBERS_ENABLED",
                "AUTO_STRUCTURES_SHELF_ENABLED", "AUTO_STRUCTURES_SR_ENABLED", "AUTO_STRUCTURES_G4_SETUPS_ENABLED")
#: Off on purpose: an admin-only preview, never a member layer.
DARK_FLAGS = ("AUTO_STRUCTURES_RARE_PREVIEW_ENABLED", "DEAL_STATUS_ENABLED")
#: The replayed scan's last_seen_at (any int: every replayed row carries the same one).
SCAN_AT = 1_000_000_000
#: Synthetic calendar: day offset 0 is this Monday shifted to the window's first weekday.
_ORIGIN = _dt.date(2000, 1, 3)


def load_family(path):
    with (gzip.open(path, "rt", encoding="utf-8") if path.endswith(".gz") else open(path, encoding="utf-8")) as f:
        return json.load(f)


def families():
    out = []
    for name in sorted(os.listdir(FIXTURES)):
        if name.endswith(".json") or name.endswith(".json.gz"):
            out.append(load_family(os.path.join(FIXTURES, name)))
    return out


def _ymd(day: int, wd0: int) -> int:
    d = _ORIGIN + _dt.timedelta(days=int(day) + int(wd0))
    return d.year * 10000 + d.month * 100 + d.day


def ymd(case, day) -> int:
    """The synthetic YYYYMMDD of a fixture day offset."""
    return _ymd(day, case["bars"]["wd0"])


def _day_steps(s: str) -> list:
    """The session-to-session calendar-day steps: one digit per step, a step over 9 days written "(n)"."""
    out, i = [], 0
    while i < len(s):
        if s[i] == "(":
            j = s.index(")", i)
            out.append(int(s[i + 1:j]))
            i = j + 1
        else:
            out.append(int(s[i]))
            i += 1
    return out


def day_offsets(case) -> list:
    """Every bar's calendar-day offset from the window's first bar."""
    offs = [0]
    for step in _day_steps(case["bars"]["d"]):
        offs.append(offs[-1] + step)
    return offs


def decode_bars(case) -> list:
    """The fixture's bars as {t,o,h,l,c,v} dicts in REAL price units (the stored series divided by `scale`):
    the drawing code's absolute floors ($5 close, $20M dollar volume) see the prices the judges' charts had.
    Encoding (tests/golden_judged/encode.py): closes are delta-coded integers of price x scale x q; the open is an
    integer offset from the close, the high and low the wicks beyond the body; dividing by scale and rounding to `dp` places gives the source price exactly.
    Volume is in units of `vu` shares."""
    b = case["bars"]
    k, q, dp = float(b["scale"]), float(b["q"]), int(b["dp"])
    offs = day_offsets(case)
    assert len(offs) == len(b["c"]) == len(b["o"]) == len(b["h"]) == len(b["l"]) == len(b["v"]), case["id"]
    out, c = [], 0
    for i, day in enumerate(offs):
        c += b["c"][i]
        o = c + b["o"][i]
        h, lo = max(o, c) + b["h"][i], min(o, c) - b["l"][i]
        px = [round(x / q / k, dp) for x in (o, h, lo, c)]
        out.append({"t": _ymd(day, b["wd0"]), "o": px[0], "h": px[1], "l": px[2], "c": px[3],
                    "v": float(b["v"][i]) * float(b.get("vu", 1))})
    return out


def atr14(bars) -> float:
    trs = [max(bars[j]["h"], bars[j - 1]["c"]) - min(bars[j]["l"], bars[j - 1]["c"])
           for j in range(len(bars) - 14, len(bars))]
    return sum(trs) / len(trs)


def _replayed_detections(sym, bars):
    """The member detectors' rows on `bars`, as the daily scan writes them (auto_structures.shelf_member_facts'
    replay: build_context on the scan depth, detect_all with the member detector ids, sym handed in)."""
    from api.services import auto_structures as AS
    from api.services.pattern_engine import detect_all
    from api.services.pattern_engine.primitives.context import build_context
    from api.services.pattern_engine.detectors import registry as reg
    from api.services.pattern_engine.detectors.uct import flat_base as _fb  # noqa: F401 -- registers
    from api.services.pattern_engine.detectors.uct import uct_flat_top_breakout as _ft  # noqa: F401
    from api.services.pattern_engine.detectors.uct import uct_pullback_ma_v5 as _pb  # noqa: F401
    from api.services.pattern_engine.detectors.classical import bull_flag as _bf  # noqa: F401
    det_ids = sorted(i for i in AS.member_ids() if not i.startswith(("bc:", "draw:")))
    ctx = build_context(bars[-reg.SCAN_BASE_DEPTH:], sym=sym)
    raw = detect_all(list(bars), ctx, pattern_ids=det_ids, base_depth=reg.SCAN_BASE_DEPTH, sym=sym)
    return [{**d, "sym": sym, "tf": "D", "last_seen_at": SCAN_AT} for d in raw]


@contextlib.contextmanager
def _patched(monkeypatch, sym, bars, in_universe):
    from api.services import auto_structures as AS
    from api.services import bars_sqlite, barspack
    from api.services.pattern_engine import memory
    tuples = [(b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]) for b in bars]
    asof = int(bars[-1]["t"])
    for k in MEMBER_FLAGS:
        monkeypatch.setenv(k, "1")
    for k in DARK_FLAGS:
        monkeypatch.delenv(k, raising=False)
    dets = _replayed_detections(sym, bars)

    def get_bars(ticker, tf, max_bars):
        assert ticker.upper() == sym and tf == "D", (ticker, tf)
        return tuples[-int(max_bars):] if max_bars else []

    def get_bars_before(ticker, tf, max_bars, to_key):
        assert ticker.upper() == sym and tf == "D", (ticker, tf)
        rows = [r for r in tuples if r[0] <= int(to_key)]
        return rows[-int(max_bars):] if max_bars else []

    def get_active_detections(s, tf, pattern_ids=None, min_conf=0.0, include_internal=False):
        assert s.upper() == sym and tf == "D", (s, tf)
        from api.services.pattern_engine.detectors import registry as reg
        out = []
        for d in dets:
            if d.get("status") in ("completed", "failed", "expired"):
                continue
            if float(d.get("confidence") or 0) < float(min_conf):
                continue
            if pattern_ids and d["pattern_id"] not in pattern_ids:
                continue
            if not include_internal and d["pattern_id"] in reg.INTERNAL_PATTERN_IDS:
                continue
            out.append(dict(d))
        return out

    monkeypatch.setattr(bars_sqlite, "get_bars", get_bars)
    monkeypatch.setattr(bars_sqlite, "get_bars_before", get_bars_before)
    monkeypatch.setattr(barspack, "_last_complete_session_ymd", lambda now=None: asof)
    monkeypatch.setattr(memory, "get_active_detections", get_active_detections)
    monkeypatch.setattr(memory, "latest_scan_at", lambda s, tf: SCAN_AT, raising=False)
    try:
        from api.services import deal_status
        monkeypatch.setattr(deal_status, "chart_marker", lambda s: None)
    except ImportError:  # a checkout older than the deal-status service (history replays only)
        pass
    monkeypatch.setattr(AS, "_scan_universe", lambda: frozenset({sym}) if in_universe else frozenset(),
                        raising=False)
    caches = [getattr(AS, n) for n in ("_CACHE", "_DRAWN_CACHE", "_SHELF_CACHE", "_SR_CACHE", "_SETUP_CACHE") if hasattr(AS, n)]
    for cache in caches:
        cache.clear()
    try:
        yield
    finally:
        for cache in caches:
            cache.clear()


def member_payload(monkeypatch, case):
    """(payload, bars) -- the member route's JSON for this fixture's chart, and the real-unit bars it drew on."""
    from api.routers import patterns as P
    sym = "CASE" + case["id"].replace("-", "").replace("_", "").upper()[-12:]
    bars = decode_bars(case)
    flags = case.get("sym_flags") or {}
    with _patched(monkeypatch, sym, bars, bool(flags.get("scan_universe"))):
        if flags.get("pb4_exclude"):
            from api.services.pattern_engine.detectors.uct import uct_pullback_ma_v5 as pb
            monkeypatch.setattr(pb, "PB4_EXCLUDE", frozenset(pb.PB4_EXCLUDE) | {sym})
        out = P.get_detections(sym, _user={"id": 0, "role": "member", "plan": "pro"}, tf="D", types=None,
                               min_conf=50.0, confirmed_only=False, include_structures=True)
    return out, bars
