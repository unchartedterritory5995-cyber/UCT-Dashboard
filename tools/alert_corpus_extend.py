#!/usr/bin/env python3
"""Extend the frozen alert-replay corpus with REAL tape, one condition per fixture.

⛔ THIS TOOL IS ADDITIVE AND IT REFUSES TO BE ANYTHING ELSE. It appends entries to
`tests/fixtures/alerts/replay_bars.json`; it may not rewrite one that is already
there. Before writing it re-serialises the ORIGINAL parsed document and compares
it BYTE FOR BYTE against the file on disk, so "the untouched half is untouched"
is a measurement rather than a promise. `tools/alert_replay.py --freeze-bars`
stays ONE-SHOT and is not called.

WHY IT EXISTS. The corpus the closed-bar lane was measured on is **four**
fixtures: one 5-minute reference series, one daily series, one extended-hours
5-minute series and one hand-built wick. Production's shadow lane has 8,130 rows
and **every one of them was recorded between 16:52 and 21:30 ET** — nothing is
forming after hours, so that data says almost nothing about the behaviour the
cutover changes. The offline corpus is the only place a regular session can be
reproduced before one is lived through, so it has to carry what a real session
throws at the lane.

EVERY WINDOW IS REAL BARS OUT OF THE LOCAL STORE, AND EVERY FIXTURE'S CLAIM IS A
CHECK. A fixture whose reason for existing is written only in prose is a fixture
nobody can tell has stopped covering its case: the store is re-fetched, the
symbol re-splits, the window slides, and the sentence stays true-looking. So each
spec below carries `checks`, run against the fetched bars BEFORE anything is
written, and the run aborts naming the fixture and the failed claim.

⛔ THE TABLE NAME IS DERIVED FROM `sqlite_master`, NEVER TYPED. Five false alarms
in one session on this project came from a typed identifier — a table, a route
param, a column, a module name — each failing in the shape of a catastrophic
finding. See [[lesson_probe_names_must_be_derived_not_typed]].

    python tools/alert_corpus_extend.py --dry-run     # fetch, check, print, write nothing
    python tools/alert_corpus_extend.py               # …and append
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import sqlite3
import sys
import zoneinfo
from typing import Any, Callable, Optional

_HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(_HERE, ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from tools.alert_replay import BARS_PATH, _bars_digest, _git_head  # noqa: E402

ET = zoneinfo.ZoneInfo("America/New_York")

# The local mirror of the bars volume. `/data` resolves to `C:\data` on this box,
# which is why the default is spelled out rather than joined from DATA_DIR: a
# service that resolved `/data` here would hit the same file, and a fixture built
# from a DIFFERENT store than the one named would be unreproducible.
BARS_DB = os.environ.get("ALERT_CORPUS_BARS_DB", r"C:\data\bars.db")

REQUIRED_COLUMNS = ("ticker", "tf", "ts", "o", "h", "l", "c", "v")


# ─── the store, with its table name DERIVED ──────────────────────────────────

def resolve_bars_table(conn: sqlite3.Connection) -> str:
    """The one table in this database that holds OHLCV bars, by INSPECTION.

    Raises when zero or more than one table qualifies — an ambiguous store is a
    store where a typed guess would have looked right.
    """
    hits = []
    for (name,) in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall():
        cols = {r[1] for r in conn.execute(f'PRAGMA table_info("{name}")')}
        if set(REQUIRED_COLUMNS) <= cols:
            hits.append(name)
    if len(hits) != 1:
        raise SystemExit(
            f"{BARS_DB}: expected exactly ONE table carrying {REQUIRED_COLUMNS}, "
            f"found {hits!r}. Do not guess — the name is the thing being derived.")
    return hits[0]


def fetch(conn: sqlite3.Connection, table: str, ticker: str, tf: str,
          ts_from: int, ts_to: int) -> list[dict]:
    rows = conn.execute(
        f'SELECT ts,o,h,l,c,v FROM "{table}" WHERE ticker=? AND tf=? '
        "AND ts>=? AND ts<=? ORDER BY ts", (ticker, tf, ts_from, ts_to)).fetchall()
    return [{"t": r[0], "o": float(r[1]), "h": float(r[2]), "l": float(r[3]),
             "c": float(r[4]), "v": int(r[5] or 0)} for r in rows]


def _et(ts: int) -> _dt.datetime:
    return _dt.datetime.fromtimestamp(ts, ET)


def _hm(ts: int) -> str:
    return _et(ts).strftime("%H:%M")


def _sessions(bars: list[dict]) -> dict:
    out: dict = {}
    for b in bars:
        out.setdefault(_et(b["t"]).date(), []).append(b)
    return out


def _rth(bars: list[dict]) -> list[dict]:
    return [b for b in bars
            if 9 * 60 + 30 <= _et(b["t"]).hour * 60 + _et(b["t"]).minute < 16 * 60]


# ─── the claims, as checks ───────────────────────────────────────────────────

def _check_gap_open(bars: list[dict]) -> list[str]:
    bad = []
    days = sorted(_sessions(bars))
    if len(days) < 2:
        return ["fewer than two sessions — there is no overnight gap to open across"]
    prev_rth = _rth(_sessions(bars)[days[-2]])
    cur_rth = _rth(_sessions(bars)[days[-1]])
    if not prev_rth or not cur_rth:
        return ["a session has no RTH bars"]
    gap = (cur_rth[0]["o"] - prev_rth[-1]["c"]) / prev_rth[-1]["c"] * 100
    if abs(gap) < 30:
        bad.append(f"the open gaps {gap:+.2f}% off the prior RTH close — under the "
                   "30% this fixture claims")
    if _hm(cur_rth[0]["t"]) != "09:30":
        bad.append(f"the first RTH bar starts {_hm(cur_rth[0]['t'])}, not 09:30")
    steps = [bars[i]["t"] - bars[i - 1]["t"] for i in range(1, len(bars))]
    if max(steps) < 8 * 3600:
        bad.append(f"largest inter-bar gap is {max(steps)}s — no overnight gap")
    return bad


def _check_high_vol(bars: list[dict]) -> list[str]:
    bad = []
    closes = sorted(b["c"] for b in bars)
    med = closes[len(closes) // 2]
    crossings = sum(1 for i in range(1, len(bars))
                    if (bars[i - 1]["c"] - med) * (bars[i]["c"] - med) < 0)
    if crossings < 40:
        bad.append(f"only {crossings} crossings of the window's own median close — "
                   "this fixture exists to make a threshold get crossed often")
    span = (max(b["h"] for b in bars) - min(b["l"] for b in bars)) / bars[0]["o"] * 100
    if span < 5.0:
        bad.append(f"window range {span:.2f}% — under the 5% this fixture claims")
    worst = max((b["h"] - b["l"]) / b["c"] for b in bars if b["c"])
    if worst > 0.02:
        bad.append(f"a single bar spans {worst * 100:.2f}% of its close — that is a "
                   "print artifact, and a fixture built on one measures the artifact")
    return bad


def _check_thin(bars: list[dict]) -> list[str]:
    bad = []
    zero_vol = sum(1 for b in bars if not b["v"])
    repeated = sum(1 for i in range(1, len(bars))
                   if (bars[i]["o"], bars[i]["h"], bars[i]["l"], bars[i]["c"])
                   == (bars[i - 1]["o"], bars[i - 1]["h"], bars[i - 1]["l"],
                       bars[i - 1]["c"]))
    steps = [bars[i]["t"] - bars[i - 1]["t"] for i in range(1, len(bars))]
    missing = sum(1 for s in steps if s != 300)
    distinct = len({b["c"] for b in bars})
    if zero_vol < 60:
        bad.append(f"only {zero_vol} zero-volume bars — MFI/OBV/VWAP never see the "
                   "no-trade case this fixture exists for")
    if repeated < 20:
        bad.append(f"only {repeated} consecutive identical OHLC bars — the repeated-bar "
                   "case is not covered")
    if missing < 40:
        bad.append(f"only {missing} of {len(steps)} inter-bar steps are off the "
                   "5-minute grid — the missing-bar case is not covered")
    if distinct * 2 >= len(bars):
        bad.append(f"{distinct} distinct closes over {len(bars)} bars — not thin")
    return bad


def _check_warmup(bars: list[dict]) -> list[str]:
    """The claim is 'the SERIES starts mid-fixture', so it is checked on a SERIES.

    ⛔ NOT ON THE BAR COUNT. "84 < 78 + something" is arithmetic about a constant
    somebody wrote down; this asks `alert_series` what it actually produces and
    fails if every column is already warm at index 0.
    """
    from api.services import alert_series

    bad = []
    if len(bars) > 120:
        bad.append(f"{len(bars)} bars is not a short history")
    late: dict[str, int] = {}
    trailing: dict[str, int] = {}
    for address in alert_series.SERIES_FUNCS:
        try:
            col = alert_series.series_for(address, bars, {})
        except Exception:
            continue
        if col is None:
            continue
        first = next((i for i, v in enumerate(col) if v is not None), None)
        if first is None:
            late[address] = len(col)
            continue
        if first > 0:
            late[address] = first
        if col[-1] is None:
            trailing[address] = sum(1 for v in reversed(col) if v is None)
    if len(late) < 10:
        bad.append(f"only {len(late)} addresses start after index 0 ({sorted(late)}) "
                   "— the LEADING warmup case is not covered")
    if not late or max(late.values()) * 2 < len(bars):
        bad.append(f"the latest first value lands at index "
                   f"{max(late.values()) if late else 0} of {len(bars)} — no address "
                   "spends most of this fixture producing nothing, so 'insufficient "
                   "history' is not what is being measured")
    if not trailing:
        bad.append("no address is still None at the LAST index — the TRAILING pad "
                   "case (the shape `ichimoku.chikou` has on the closed lane, where "
                   "`series[i]` is the bar being judged) is not covered")
    return bad


def _check_halfday(bars: list[dict]) -> list[str]:
    bad = []
    sess = _sessions(bars)
    if _dt.date(2025, 11, 27) in sess:
        bad.append("2025-11-27 (Thanksgiving) has bars — it must be a whole-session hole")
    half = _dt.date(2025, 11, 28)
    if half not in sess:
        bad.append("2025-11-28 (the half day) is not in the window")
        return bad
    last_rth = {d: _rth(bs)[-1] for d, bs in sess.items() if _rth(bs)}
    # ⭐ THE HALF DAY'S LAST REGULAR-SESSION BUCKET STARTS AT 13:00, NOT 12:30, AND
    # THE REASON IS THE POINT. The session ends AT 13:00, so the closing auction
    # prints at 13:00:00 and lands alone in the 13:00 bucket — 2.36 M shares in a
    # bar spanning eight cents. `bar_close_epoch` answers 13:30 for it and nothing
    # ever updates it again, then the tape does not resume for three hours.
    if _hm(last_rth[half]["t"]) != "13:00":
        bad.append(f"the half day's last RTH 30m bar starts {_hm(last_rth[half]['t'])}, "
                   "not 13:00 (the closing-auction bucket of a 13:00 ET close)")
    else:
        after = [b for b in bars if b["t"] > last_rth[half]["t"]]
        if not after or after[0]["t"] - last_rth[half]["t"] < 2 * 3600:
            bad.append("the half day's closing bucket is not followed by a multi-hour "
                       "hole — that hole is what makes it a half day and not a lunch lull")
    for d, b in last_rth.items():
        if d != half and _hm(b["t"]) != "15:30":
            bad.append(f"{d} is neither the half day nor a 15:30 last RTH bar "
                       f"({_hm(b['t'])})")
    if any(_et(b["t"]).utcoffset() != _dt.timedelta(hours=-5) for b in bars):
        bad.append("a bar is not in EST — this fixture is the winter-offset one")
    return bad


def _check_hourly_open(bars: list[dict]) -> list[str]:
    """The 60-minute grid is NOT uniform, and this fixture is where that is pinned.

    `bars_fetch.bucket_60_et_unix_seconds` gives the RTH open its own bucket, so a
    session carries BOTH an 09:00 and an 09:30 "hourly" bar and each of them spans
    THIRTY minutes. `indicator_alert_evaluator.bar_close_epoch` answers `t + 3600`
    for every intraday 60m bar, so it overstates the close of both by half an hour.
    That is a real closed-lane latency finding and it is checked, not narrated.
    """
    bad = []
    sess = _sessions(bars)
    both = 0
    for d, bs in sess.items():
        hm = {_hm(b["t"]) for b in bs}
        if {"09:00", "09:30"} <= hm:
            both += 1
    if both < 8:
        bad.append(f"only {both} sessions carry BOTH an 09:00 and an 09:30 hourly "
                   "bucket — the irregular open grid is not covered")
    short = 0
    for i in range(1, len(bars)):
        step = bars[i]["t"] - bars[i - 1]["t"]
        if _et(bars[i - 1]["t"]).date() == _et(bars[i]["t"]).date() and step == 1800:
            short += 1
    if short < 8:
        bad.append(f"only {short} intraday 60m steps are 30 minutes — the two "
                   "half-length open buckets are not in this window")
    return bad


def _check_gap_daily(bars: list[dict]) -> list[str]:
    bad = []
    if not all(isinstance(b["t"], int) and 19000101 <= b["t"] <= 21001231 for b in bars):
        bad.append("a `t` is not a YYYYMMDD calendar key — the daily lane resolves "
                   "its close through the ET calendar and this fixture is what pins it")
    gaps = [(bars[i]["o"] - bars[i - 1]["c"]) / bars[i - 1]["c"] * 100
            for i in range(1, len(bars)) if bars[i - 1]["c"]]
    if min(gaps) > -20:
        bad.append(f"deepest overnight gap is {min(gaps):+.1f}% — under the -20% claimed")
    if max(gaps) < 12:
        bad.append(f"largest overnight gap is {max(gaps):+.1f}% — under the +12% claimed")

    def _d(v: int) -> _dt.date:
        return _dt.date(v // 10000, v // 100 % 100, v % 100)

    spans = [(_d(bars[i]["t"]) - _d(bars[i - 1]["t"])).days for i in range(1, len(bars))]
    if max(spans) < 4:
        bad.append("no calendar gap longer than a weekend — no holiday in the window")
    return bad


# ─── the specs ───────────────────────────────────────────────────────────────
#
# `ts_from`/`ts_to` are PINNED, not computed from "the last N rows": a window
# expressed as an offset into a live store silently becomes a different window
# the next time the store is written, and the sha256 would then look like a
# regression instead of a moved goalpost.

SPECS: list[dict[str, Any]] = [
    {
        "name": "gap_open_5m",
        "ticker": "SNOW", "tf": "5",
        "ts_from": 1779898200, "ts_to": 1779995700, "bars": 230,
        "covers": "a GAP OPEN — the first bar of a session far from the prior close",
        "why": (
            "SNOW 5-minute tape across 2026-05-27 12:10 ET -> 2026-05-28 15:15 ET. "
            "The 2026-05-27 regular session closes at 175.26 and the 2026-05-28 "
            "regular session OPENS at 237.00 — a +35.2% overnight gap, with 160 "
            "bars of warmup before it and 69 after. THIS IS WHERE A LEVEL ALERT "
            "MOST PLAUSIBLY FIRES DIFFERENTLY BETWEEN THE LANES: the forming lane "
            "judges the 09:30 bar while it is still moving through a 7-point range "
            "on 4.1 M shares, the closed lane judges it once, at 234.12."
        ),
        "checks": _check_gap_open,
    },
    {
        "name": "high_vol_5m",
        "ticker": "ZS", "tf": "5",
        "ts_from": 1782396000, "ts_to": 1782489600, "bars": 200,
        "covers": "a HIGH-VOLATILITY session with many threshold crossings",
        "why": (
            "ZS 5-minute tape across 2026-06-25 10:00 ET -> 2026-06-26 12:00 ET: a "
            "6.85% window range whose close crosses the window's OWN MEDIAN 47 "
            "times. The median matters because the replay grid derives every "
            "threshold from the 20th/50th/80th percentile of the address's own "
            "series — so a series that re-crosses its median is a series that "
            "re-crosses its thresholds, which is the condition that makes the "
            "`above`/`below` re-delivery shape and the `cross_*` shape both large. "
            "No bar in the window spans more than 1.23% of its close, so the "
            "choppiness is tape and not a print artifact."
        ),
        "checks": _check_high_vol,
    },
    {
        "name": "thin_illiquid_5m",
        "ticker": "ADXN", "tf": "5",
        "ts_from": 1777469700, "ts_to": 1781812800, "bars": 220,
        "covers": "a THIN/ILLIQUID symbol with missing and repeated bars",
        "why": (
            "ADXN 5-minute tape, 2026-04-29 -> 2026-06-18: 220 bars spread over "
            "SEVEN WEEKS because most 5-minute slots have no print at all. 171 of "
            "219 inter-bar steps are off the 5-minute grid (10 min, 20 min, 25 min, "
            "3 h, 12 h), 108 bars carry ZERO volume, 34 consecutive pairs are "
            "byte-identical OHLC, and 220 bars hold only 85 distinct closes. This "
            "is the shape that breaks a lane which assumes a bar per slot: OBV and "
            "MFI take a zero-volume bar, Donchian sees a flat window, and "
            "`closed_bar_index` has to resolve a newest bar that can be HALF A DAY "
            "old and unambiguously closed."
        ),
        "checks": _check_thin,
    },
    {
        "name": "warmup_first_bars_5m",
        "ticker": "UBER", "tf": "5",
        "ts_from": 1776347400, "ts_to": 1776372300, "bars": 84,
        "covers": "a series that STARTS MID-FIXTURE — insufficient history, warmup",
        "why": (
            "The FIRST 84 five-minute bars UBER has in the store (2026-04-16 09:50 "
            "ET onward) — literally the first bars an alert armed on a "
            "newly-covered ticker is handed, not a slice chosen from the middle of "
            "a warm series. Every other fixture in this corpus hands the evaluator "
            "a series that is already warm; this one hands it one that is not. "
            "Measured on `alert_series`: 27 of 31 addresses produce their first "
            "value AFTER index 0, the latest at index 51 of 84 (all four "
            "non-displaced ichimoku columns), and `ichimoku.chikou` is None for the "
            "last 51 indices — so BOTH ends of the None handling are exercised as "
            "the rule rather than as an edge, including the trailing-pad shape that "
            "is the closed lane's one accepted casualty."
        ),
        "checks": _check_warmup,
    },
    {
        "name": "halfday_30m",
        "ticker": "SPY", "tf": "30",
        "ts_from": 1763715600, "ts_to": 1764721800, "bars": 213,
        "covers": "a HALF-DAY session, a whole-session holiday hole, EST, and tf=30",
        "why": (
            "SPY 30-minute tape 2025-11-21 -> 2025-12-02, which is a REAL half day "
            "out of the store rather than an analytical argument about a future "
            "one: Thanksgiving 2025-11-27 is a whole-session hole and 2025-11-28 "
            "closes at 13:00 ET, so its last regular-session bucket is the 13:00 "
            "one — the closing auction alone, 2,357,259 shares in a bar spanning "
            "eight cents — followed by a THREE-HOUR hole, while every other "
            "session's last regular bar starts at 15:30. It is also the corpus's "
            "first 30-minute fixture and its first winter-offset one — every "
            "existing fixture is tf 5 or D, so `bar_close_epoch`'s 30-minute "
            "branch and `closed_bar_index` under EST had NO coverage from real "
            "tape at all."
        ),
        "checks": _check_halfday,
    },
    {
        "name": "hourly_open_60m",
        "ticker": "SPY", "tf": "60",
        "ts_from": 1784052000, "ts_to": 1785970800, "bars": 208,
        "covers": "SESSION BOUNDARIES on tf=60, including the irregular RTH-open bucket",
        "why": (
            "SPY 60-minute tape 2026-07-14 -> 2026-08-05, 17 sessions. The corpus's "
            "first 60-minute fixture, and it carries a boundary no other fixture "
            "can: the hourly grid is NOT uniform. `bucket_60_et_unix_seconds` gives "
            "the regular-session open its own bucket, so a session runs "
            "04:00…09:00, 09:30, 10:00…19:00 and BOTH the 09:00 and the 09:30 bar "
            "span THIRTY minutes. Verified against the 5-minute tape on 2026-07-15: "
            "the 09:30 hourly bar reproduces the 09:30-10:00 five-minute aggregate "
            "EXACTLY (o 754.24 h 755.58 l 753.18 c 754.45 v 4,886,107). Also "
            "carries the last bar before the 16:00 close, the first after the 04:00 "
            "pre-market open and 16 overnight gaps."
        ),
        "checks": _check_hourly_open,
    },
    {
        "name": "gap_daily",
        "ticker": "SMCI", "tf": "D",
        "ts_from": 20251003, "ts_to": 20260805, "bars": 210,
        "covers": "DAILY bars whose boundary is ET MIDNIGHT, with real overnight gaps",
        "why": (
            "SMCI daily 2025-10-03 -> 2026-08-05. `spy_daily` already carries the "
            "daily encoding, but an index ETF gaps a percent; this gaps -26.9% "
            "(2026-03-20) and +13.3% (2026-07-22), which is the size at which the "
            "difference between judging the forming daily row and the closed one "
            "stops being academic. The daily boundary is the NEXT ET MIDNIGHT, not "
            "16:00 — extended-hours prints still update the stored daily row, so a "
            "16:00 rule would call a bar closed that then changed — and this "
            "fixture's `t` is a YYYYMMDD calendar key, the encoding "
            "`closed_bar_index` has to resolve through the ET calendar rather than "
            "compare to an epoch."
        ),
        "checks": _check_gap_daily,
    },
]


# ─── the append ──────────────────────────────────────────────────────────────

def _dump(doc: dict) -> bytes:
    """The writer `--freeze-bars` used, reproduced exactly, including CRLF.

    Verified against the committed file before anything is written: `_append`
    re-serialises the ORIGINAL parsed document and refuses to continue unless it
    reproduces the bytes on disk.
    """
    return (json.dumps(doc, indent=1, allow_nan=False) + "\n").replace("\n", "\r\n").encode("utf-8")


def build(dry_run: bool = False) -> dict:
    conn = sqlite3.connect(f"file:{BARS_DB}?mode=ro", uri=True)
    table = resolve_bars_table(conn)
    print(f"bars store  : {BARS_DB}")
    print(f"bars table  : {table}   (DERIVED from sqlite_master, not typed)")

    built: dict[str, dict] = {}
    for spec in SPECS:
        bars = fetch(conn, table, spec["ticker"], spec["tf"],
                     spec["ts_from"], spec["ts_to"])
        if len(bars) != spec["bars"]:
            raise SystemExit(
                f"{spec['name']}: the store returned {len(bars)} bars for "
                f"{spec['ticker']}/{spec['tf']} in [{spec['ts_from']}, "
                f"{spec['ts_to']}], the spec pins {spec['bars']}. The window moved "
                "under the fixture — do not re-pin the number, find out why.")
        problems = spec["checks"](bars)
        if problems:
            raise SystemExit(
                f"{spec['name']}: the fixture no longer supports its own claim:\n  "
                + "\n  ".join(problems))
        built[spec["name"]] = {
            "tf": spec["tf"],
            "source": (f'{table}: ticker={spec["ticker"]!r} tf={spec["tf"]!r} '
                       f'ts in [{spec["ts_from"]}, {spec["ts_to"]}]'),
            "bar_count": len(bars),
            "sha256": _bars_digest(bars),
            "covers": spec["covers"],
            "why": spec["why"],
            "bars": bars,
        }
        print(f"  OK  {spec['name']:22} {len(bars):>4} bars  "
              f"{built[spec['name']]['sha256'][:16]}…  {spec['covers']}")
    conn.close()
    if not dry_run:
        _append(built)
    return built


def _append(built: dict[str, dict]) -> None:
    raw = open(BARS_PATH, "rb").read()
    doc = json.loads(raw.decode("utf-8"))

    # ⭐ THE ROUND-TRIP CONTROL. If re-serialising what was just parsed does not
    # reproduce the file byte for byte, then this writer is not the writer that
    # made it and an "additive" write would silently reformat every existing
    # entry — the diff would be unreadable and the claim "the original fixtures
    # are untouched" would be unverifiable.
    if _dump(doc) != raw:
        raise SystemExit(
            f"{BARS_PATH}: re-serialising the parsed document does not reproduce "
            "the bytes on disk, so an append cannot be proved additive. Refusing.")

    for name in built:
        if name in doc["fixtures"] or name in doc["order"]:
            raise SystemExit(
                f"{name!r} is already in {BARS_PATH}. This tool is ADDITIVE: a "
                "fixture already in the corpus has fire-log digests measured "
                "against its exact bars, and rewriting it converts a regression "
                "into a green build.")

    before = {k: _dump(v) for k, v in doc["fixtures"].items()}
    doc["order"] = list(doc["order"]) + list(built)
    doc["fixtures"].update(built)
    doc["extended_at_head"] = _git_head()
    doc["extended_note"] = (
        "The four fixtures above the extension were frozen by "
        "`tools/alert_replay.py --freeze-bars` and are UNTOUCHED — "
        "`tools/alert_corpus_extend.py` proves that by re-serialising the parsed "
        "document and comparing it byte for byte against the file before it "
        "writes, and by comparing every pre-existing fixture object before and "
        "after. The extension exists because the closed-bar lane was measured on "
        "four series while production's shadow lane recorded 8,130 rows entirely "
        "AFTER HOURS, where nothing is forming — so neither corpus covered what a "
        "regular session presents. Each added fixture carries a `covers` line and "
        "a `checks` function in the tool that fails if the bars stop supporting "
        "it. DO NOT REGENERATE: every row of fire_log_forming.json is measured "
        "against these exact bars.")

    for k, b in before.items():
        if _dump(doc["fixtures"][k]) != b:
            raise SystemExit(f"the append changed the pre-existing fixture {k!r}. Refusing.")

    open(BARS_PATH, "wb").write(_dump(doc))
    print(f"\nappended {len(built)} fixture(s) to {BARS_PATH}")
    print(f"  order is now: {doc['order']}")


def main(argv: Optional[list[str]] = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:                                        # noqa: BLE001
            pass
    ap = argparse.ArgumentParser(description="Append real-tape fixtures to the alert replay corpus")
    ap.add_argument("--dry-run", action="store_true",
                    help="fetch and CHECK every fixture, print, write nothing")
    args = ap.parse_args(argv)
    build(dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
