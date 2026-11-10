"""UCT RS Phase 4, unit 4-08: Study drill DRAFTS for reading relative strength (segment rs.drills, skill read.rs).

Engineering map 2026-11-08 (uct-rs-plan), unit 4-08 and decision D17: about 40 drafts in four families, small enough for
one review sitting, every one a draft until the owner rules on it.

  (a) "Tap the RS new high"        type tap.    The key is the FIRST bar in the 120-session window where the RS line made
                                    a new 52-week high (rsNH, lookback 252), {bar_index, bar_tol: 1}. The old high it breaks
                                    is on the chart (so the member can see the break) and is cleared by at least 0.2%; SPY
                                    is above its 200-day that day. Half are the gold dot, a new high BEFORE price, from a
                                    stock 3-15% under its own 52-week high.
  (b) "Which line is the leader?"  type spot.   Two stocks over the same 120 sessions, drawn as two RS lines (Line A and
                                    Line B) under the market's own chart. One line rose and made a new 52-week high; the
                                    other fell. In half of them the losing stock still rose in price.
  (c) "Strong on a weak day?"      type spot.   The last bar is a red SPY session (down at least 1.5%). Yes = the stock
                                    closed up on the day (gor, green on red); No = it fell more than SPY did.
  (d) "RS or RSI?"                 type recall. From the misconceptions list, number 1 ("RS is RSI"), of the research
                                    file 04-how-rs-is-taught.md §e. Unit 4-02 (app/src/content/rs/teaching.js ->
                                    api/data/rs_teaching.json, MISCONCEPTIONS[0]) does not exist yet; when it lands it
                                    becomes these items' source and `reveal_json.teaches.source` moves to it.

THE RS PANE IS PRECOMPUTED (map F51: a drill chart's `sym` is the item id, so a drill cannot fetch the server columns).
Every chart item carries `prompt_json.chart.rs = {columns: {rsLine, rsMa, dotNH, dotNHbeforePx}, times, inputs}`, the
exact output of `api.services.relative_strength.compute_phase1_columns` (the RS Line's own defaults: 21 EMA, 252-bar
lookback; `nativeRegistry.RS_CLASSIC_INPUTS`, the one object the Study overlay stamps on its instances, RS split U8),
rounded to six places as the server's provider rounds a ratio, aligned to the visible bars (`times` = the bars' own
YYYYMMDD keys). Unit 4-09 primes the real `rsLine` instance from it.

  * A TAP item's dot columns are BLANK in the prompt (all null): the dot IS the answer, and prompt_json is served to
    the member before scoring. The real dots are in `reveal_json.rs` (same shape) for the reveal.
  * A RED-DAY item's dot columns are BLANK in the prompt too: a new-high dot on the marked session says the stock was
    strong that day, which is the question. Its real columns are in `reveal_json.rs`, exactly as a TAP item's.
  * A LEADER item has no `chart.rs` (its chart is SPY, and SPY against SPY is the indicator's `same-symbol` state).
    It carries `prompt_json.chart.rs_pair = {"A": <rs shape>, "B": <rs shape>}`, each the real indicator for one stock,
    with BOTH lines' dot columns blank: only the leader can make a new 52-week RS high, so a dot on either line names
    the answer. The real columns of both lines are in `reveal_json.rs_pair` (same shape) for the reveal.
  * Bars are EMBEDDED (`bars_embed`, the import route's embed path): the pod's bars.db is not asked to cover these
    charts, and the columns are reproducible from what the item carries. `rs_source` holds the closes the computation
    needs beyond the visible window (the 252 warm-up sessions, and the benchmark), as compact JSON strings, so the bank
    stays small. The importer ignores the key; the test recomputes the columns from it.

THE TICKER STAYS IN `sym` (and in the reveal), never in any prompt text, choice or `subject`.

Bars: a local, read-only copy of the bars database (`ohlcv`, daily, split-adjusted, YYYYMMDD keys). Nothing is written
to it. The generator is deterministic: the same database gives the same items and ids.

  python -X utf8 scripts/study/bank_v2/gen_rs.py --bars-db <bars.db>
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sqlite3
import statistics
import sys
from collections import Counter

REPO = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))

from api.services import relative_strength as RS  # noqa: E402
from api.services import study_store  # noqa: E402
from api.services.indicator_compute import _round_series  # noqa: E402
from scripts.study import _common  # noqa: E402
from scripts.study._common import make_item, shuffled_choices  # noqa: E402

SEGMENT = "rs.drills"
SKILL = "read.rs"
MODULE = "F2"
WINDOW, FORWARD = 120, 20
INPUTS = RS.resolve_phase1_inputs({})              # the RS Line's defaults (O'Neil): 21 EMA, 252-bar lookback, 2% price tolerance
LOOKBACK = INPUTS["lookback"]
SLICE = LOOKBACK + WINDOW                          # the bars one item's columns are computed over
RS_KEYS = ("rsLine", "rsMa", "dotNH", "dotNHbeforePx")
BENCH = "SPY"
ERAS = ("1996-99", "2000-04", "2005-09", "2010-14", "2015-19", "2020-26")
MIN_DOLLAR_VOL = 25e6                              # 50-session median close x volume, point in time
RED_DAY_PCT = -1.5                                 # family (c): a clearly weak SPY session
MAX_DAY_MOVE = 0.35                                # a one-day close-to-close move past 35% is treated as bad data
BEFORE_PX_RANGE = (-15.0, -3.0)                    # family (a), gold dot: the stock sits 3-15% under its 52-week high
SOURCE_RESEARCH = "uct-rs-plan/docs/research/relative-strength/04-how-rs-is-taught.md"

#: Liquid, institutionally traded common stocks the local bars hold for years (no ETFs). Each item is checked again
#: for point-in-time dollar volume and for bars on every SPY session of its slice.
UNIVERSE = ("AAPL MSFT NVDA AMZN GOOGL META TSLA AVGO AMD NFLX LOW JPM MS BAC WFC V MA AXP LLY MRK ABBV PFE AMGN COP "
            "EOG CAT RTX CRM INTC CSCO TXN MU LRCX TMO DHR UPS FDX CMCSA T VZ UBER BKNG TJX ROST MO PM MMM EMR ETN FCX "
            "NEM LIN SHW ECL ADP PAYX MDT ABT SYK BSX CI HUM ELV CVS MCK GILD BMY VRTX REGN GS SBUX BA LMT QCOM AMAT "
            "ANET PANW XOM CVX").split()

#: The cards each family teaches: the five tour cards of map D12 (research 04 §d with card 3 rewritten) and the first
#: misconception of 04 §e. `lesson_origin` stays a value the validator accepts ("session"); the card rides here.
CARDS = {
    "tap": {"card": "tour-3", "title": "Watch for RS new highs.",
            "line": "When the line tops its old high before price does, the stock is leading before the chart shows it."},
    "leader": {"card": "tour-1", "title": "Beating the market, or just riding it?",
               "line": "A stock can go up and still lose the race."},
    "redday": {"card": "tour-4", "title": "Strong on a weak day.",
               "line": "Stocks that close green, or barely dip, while the market sells off are showing real demand."},
    "rsi": {"card": "misconception-1", "title": "RS is RSI.",
            "line": "RS compares a stock to a benchmark and has no bounds; RSI measures the stock's own momentum on a "
                    "0-100 scale."},
}


# ── bars ─────────────────────────────────────────────────────────────────────

def load(con, sym):
    rows = con.execute("SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf='D' ORDER BY ts", (sym,)).fetchall()
    return [{"t": int(t), "o": float(o), "h": float(h), "l": float(l), "c": float(c), "v": int(v or 0)}
            for t, o, h, l, c, v in rows if c is not None and c > 0]


def iso(t) -> str:
    s = str(t)
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def era_of(t) -> str:
    y = int(str(t)[:4])
    for e in ERAS:
        if int(e[:4]) <= y <= int(e[:2] + e[-2:]):
            return e
    return "other"


def hsh(*parts) -> int:
    return int(hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()[:12], 16)


def pct(a, b) -> float:
    return round((a / b - 1.0) * 100.0, 1)


def liquid(bars, e) -> bool:
    seg = bars[max(0, e - 49):e + 1]
    return len(seg) == 50 and statistics.median(b["c"] * b["v"] for b in seg) >= MIN_DOLLAR_VOL


def rs_block(cols, lo, hi, blank_dots=False) -> dict:
    """The wire shape 4-09 primes from: four columns, six places, aligned to bars[lo:hi]."""
    out = {}
    for k in RS_KEYS:
        seg = cols[k][lo:hi]
        out[k] = [None] * len(seg) if (blank_dots and k.startswith("dot")) else _round_series(seg, 6)
    return out


def compute_slice(stock, bench, e):
    """compute_phase1_columns over the SLICE stock[e-SLICE+1 .. e] against the benchmark's bars over the same dates.
    None when the stock misses a benchmark session in the slice (a hole has no honest answer)."""
    lo = e - SLICE + 1
    if lo < 0:
        return None
    s = stock[lo:e + 1]
    t0, t1 = s[0]["t"], s[-1]["t"]
    b = [x for x in bench if t0 <= x["t"] <= t1]
    if [x["t"] for x in s] != [x["t"] for x in b]:
        return None
    if any(abs(s[i]["c"] / s[i - 1]["c"] - 1) > MAX_DAY_MOVE for i in range(1, len(s))):
        return None                                  # a spin-off or a bad print reads as a move nobody traded
    cols = RS.compute_phase1_columns(s, b, INPUTS)
    if any(v is None for v in cols["rsLine"][-WINDOW:]) or any(v is None for v in cols["rsNH"][-WINDOW:]):
        return None
    return s, b, cols


def closes_str(bars) -> str:
    return json.dumps([[x["t"], x["c"]] for x in bars], separators=(",", ":"))


def embed(sym, bars, e):
    vis = bars[e - WINDOW + 1:e + 1]
    fwd = bars[e + 1:e + 1 + FORWARD]
    return {"sym": sym, "tf": "D", "asof": iso(bars[e]["t"]), "bars": vis, "forward": fwd,
            "sha256": study_store.bars_sha256(vis)}


def fwd_facts(stock, bench_by_t, e):
    """What came next, from the forward strip: the stock and SPY over the next 20 sessions (close to close)."""
    if e + FORWARD >= len(stock):
        return {}
    t_end = stock[e + FORWARD]["t"]
    b0, b1 = bench_by_t.get(stock[e]["t"]), bench_by_t.get(t_end)
    out = {"fwd_sessions": FORWARD, "fwd_stock_pct": pct(stock[e + FORWARD]["c"], stock[e]["c"])}
    if b0 and b1:
        out["fwd_spy_pct"] = pct(b1, b0)
    return out


def updown(x) -> str:
    return f"up {abs(x)}%" if x >= 0 else f"down {abs(x)}%"


def spread_pick(cands, n, key_sym="sym"):
    """Round-robin over the eras, one chart per stock, one per date, deterministic order."""
    by_era = {e: sorted([c for c in cands if c["era"] == e], key=lambda c: c["h"]) for e in ERAS}
    out, syms, dates = [], set(), set()
    while len(out) < n and any(by_era.values()):
        for e in ERAS:
            while by_era[e]:
                c = by_era[e].pop(0)
                names = c[key_sym] if isinstance(c[key_sym], tuple) else (c[key_sym],)
                if syms & set(names) or c["t"] in dates:
                    continue
                out.append(c)
                syms |= set(names)
                dates.add(c["t"])
                break
            if len(out) >= n:
                break
    return out


# ── (a) Tap the RS new high ──────────────────────────────────────────────────

TAP_Q = {"plain": "Tap the first day the RS line made a new 52-week high.",
         "before": "The RS line broke to a new 52-week high before price did. Tap the first day it did."}
TAP_I_RANGE = (60, 108)          # where the first new high sits in the 120-bar window (bar index)
PEAK_MIN_GAP = 5                 # the old RS high it breaks is at least this many bars earlier, and on the chart
BREAK_MIN_PCT = 0.2              # and the break clears it by at least this much (a tie counts as a high, but reads as none)


def spy_uptrend(bench) -> dict:
    """{t: SPY closed above its 200-day simple average}: the market the card's lesson is about."""
    out, run = {}, 0.0
    for i, x in enumerate(bench):
        run += x["c"]
        if i >= 200:
            run -= bench[i - 200]["c"]
        if i >= 199:
            out[x["t"]] = x["c"] > run / 200.0
    return out


def first_high_layout(rs, nh, k):
    """For an RS new high at k: the bar index i it takes in a window where (1) no new high comes before it and (2) the
    old 52-week RS high it breaks is visible on the chart. None when no window does both."""
    peak = max(range(k - LOOKBACK, k), key=lambda j: (rs[j], j))
    if k - peak < PEAK_MIN_GAP or rs[k] < rs[peak] * (1 + BREAK_MIN_PCT / 100):
        return None
    prev_nh = max((j for j in range(k - LOOKBACK, k) if nh[j] == 1.0), default=None)
    lo_i = max(TAP_I_RANGE[0], k - peak + 3)
    hi_i = TAP_I_RANGE[1]
    if prev_nh is not None:
        hi_i = min(hi_i, k - prev_nh - 1)          # the window must start after the previous new high
    if lo_i > hi_i:
        return None
    return peak, lo_i, hi_i


def tap_candidates(sym, stock, bench, spy_up):
    cols = RS.compute_phase1_columns(stock, bench, INPUTS)
    nh, rs = cols["rsNH"], cols["rsLine"]
    out = []
    for k, v in enumerate(nh):
        if v != 1.0 or k < 2 * LOOKBACK or not spy_up.get(stock[k]["t"]):
            continue
        if nh[k - 1] == 1.0:
            continue                                            # the FIRST bar of a run of new highs
        kind = "before" if cols["rsNHbeforePx"][k] == 1.0 else "plain" if cols["pxNH"][k] == 1.0 else None
        if not kind:
            continue
        if kind == "before":
            hi = max(x["c"] for x in stock[k - LOOKBACK:k])
            if not (BEFORE_PX_RANGE[0] <= (stock[k]["c"] / hi - 1) * 100 <= BEFORE_PX_RANGE[1]):
                continue
        lay = first_high_layout(rs, nh, k)
        if not lay:
            continue
        _peak, lo_i, hi_i = lay
        i = lo_i + hsh(sym, stock[k]["t"]) % (hi_i - lo_i + 1)
        e = k + (WINDOW - 1 - i)
        if e + FORWARD >= len(stock) or e - SLICE + 1 < 0 or not liquid(stock, e):
            continue
        out.append({"sym": sym, "k": k, "e": e, "i": i, "kind": kind, "t": stock[e]["t"],
                    "era": era_of(stock[e]["t"]), "h": hsh("tap", sym, stock[e]["t"])})
    return out


def tap_item(c, stock, bench, bench_by_t):
    got = compute_slice(stock, bench, c["e"])
    if not got:
        return None
    s, b, cols = got
    lo = SLICE - WINDOW
    nh = cols["rsNH"][lo:]
    hits = [i for i, v in enumerate(nh) if v == 1.0]
    if not hits or hits[0] != c["i"]:
        return None                                             # the slice must find the same first high
    i = hits[0]
    rs = cols["rsLine"][lo:]
    kind = c["kind"]
    ka = lo + i                                                 # index of the event inside the slice
    peak_s = max(range(ka - LOOKBACK, ka), key=lambda j: (cols["rsLine"][j], j))
    if peak_s < lo + 3 or max(rs[:i]) != cols["rsLine"][peak_s]:
        return None                                             # the old high it breaks is on the chart
    prior_px_high = max(x["c"] for x in s[ka - LOOKBACK:ka])
    day = s[ka]
    prior_rs_high = cols["rsLine"][peak_s]
    e_full = c["e"]
    sym = c["sym"]
    asof = iso(stock[e_full]["t"])
    key = {"bar_index": i, "bar_tol": 1}
    facts = {"rs_high_date": iso(day["t"]), "rs_high_bar_index": i, "bar_tol": 1, "rs_line": round(rs[i], 6),
             "prior_rs_high": round(prior_rs_high, 6), "prior_rs_high_date": iso(s[peak_s]["t"]),
             "prior_rs_high_bar_index": peak_s - lo, "new_highs_in_window": len(hits), "rs_above_prior_high_pct": pct(rs[i], prior_rs_high),
             "close": day["c"], "price_52w_high_close": prior_px_high,
             "price_vs_52w_high_pct": pct(day["c"], prior_px_high), "price_at_high": kind == "plain",
             "before_price": kind == "before", "lookback_bars": LOOKBACK, "price_tolerance_pct": INPUTS["priceTolerance"],
             "window_bars": WINDOW, "lookback_weeks": 52, "era": era_of(stock[e_full]["t"])}
    k_full = e_full - SLICE + 1 + ka
    if k_full != c["k"]:
        return None
    # what came next after the dot (the RS high day itself), on the full series
    facts.update(fwd_facts(stock, bench_by_t, k_full))
    if kind == "before":
        lesson = (f"That's the day: {facts['rs_high_date']}. The RS line cleared its old high from "
                  f"{facts['prior_rs_high_date']} while the stock closed {abs(facts['price_vs_52w_high_pct'])}% under its "
                  f"own 52-week high. The line led price. " + CARDS["tap"]["line"])
    else:
        lesson = (f"That's the day: {facts['rs_high_date']}. The RS line cleared its old high from "
                  f"{facts['prior_rs_high_date']}, and price was at its high too, within {facts['price_tolerance_pct']}% "
                  f"of it. Both agree: the stock is beating the market.")
    lesson += f" A tap counts within {key['bar_tol']} bar of it."
    ref = f"relative_strength.compute_phase1_columns#tap-rs-high#{sym}#{asof}"
    q = TAP_Q[kind]
    # ⭐ RS split, U8 (2026-11-09): the indicator ships as "UCT RS Line" (the slim definition's `meta.name`); the
    # Classic preset it used to name is gone, and these defaults ARE the line. Reveal copy, never a prompt string.
    reveal = {"system": "UCT RS Line (21 EMA, 52-week new highs)",
              "detector": "relative_strength.compute_phase1_columns", "label": "The RS new high",
              "answer": key, "facts": facts, "source": ref, "window_bars": WINDOW, "forward_bars": FORWARD,
              "rs": {"columns": rs_block(cols, lo, SLICE), "times": [x["t"] for x in s[lo:]], "inputs": INPUTS},
              "teaches": dict(CARDS["tap"], source="map D12 tour card 3"),
              "example": {"sym": sym, "asof": asof, "found_by": "scripts/study/bank_v2/gen_rs.py"}}
    return make_item(
        type="tap", skill_id=SKILL, module=MODULE, difficulty=2, q=q, answer=None, answer_json=key,
        prompt_extra={"target": "the RS new high", "subject": f"rs-new-high {kind} {asof}",
                      "chart": {"window_bars": WINDOW, "tf": "D",
                                "rs": {"columns": rs_block(cols, lo, SLICE, blank_dots=True),
                                       "times": [x["t"] for x in s[lo:]], "inputs": INPUTS}}},
        reveal=reveal, lesson_text=lesson, lesson_origin="session", source_kind="generator", source_ref=ref,
        sym=sym, asof=asof, adjustment_basis="split-adjusted", bars_embed=embed(sym, stock, e_full),
        rs_source={"stock_warmup": closes_str(s[:lo]), "bench": closes_str(b)})


# ── (b) Which line is the leader? ────────────────────────────────────────────

LEADER_Q = "Two stocks against the market over the same 120 sessions. Which line is the leader?"
LEADER_FRAMING = ("The market's daily chart, 120 sessions. Line A and Line B are two stocks' RS lines against it. "
                  "The tickers are hidden until you answer.")


def leader_items(data, bench, bench_by_t, n):
    """Quarter-end dates over the eras; per date the clearest leader and a laggard."""
    bt = [x["t"] for x in bench]
    idx_of = {t: i for i, t in enumerate(bt)}
    dates = []
    for i in range(SLICE + 5, len(bt) - FORWARD - 1):
        if bt[i] // 100 % 100 in (3, 6, 9, 12) and bt[i + 1] // 100 != bt[i] // 100:
            dates.append(bt[i])
    rows = []
    for t in dates:
        per = []
        for sym, stock in data.items():
            pos = {x["t"]: j for j, x in enumerate(stock)}
            e = pos.get(t)
            if e is None or not liquid(stock, e):
                continue
            got = compute_slice(stock, bench, e)
            if not got:
                continue
            s, b, cols = got
            lo = SLICE - WINDOW
            rs = cols["rsLine"][lo:]
            nh = cols["rsNH"][lo:]
            per.append({"sym": sym, "e": e, "s": s, "b": b, "cols": cols, "rs_chg": pct(rs[-1], rs[0]),
                        "px_chg": pct(s[-1]["c"], s[lo]["c"]), "nh_last20": any(v == 1.0 for v in nh[-20:]),
                        "nh_any": any(v == 1.0 for v in nh), "last_nh": max((j for j, v in enumerate(nh) if v == 1.0),
                                                                           default=None)})
        leaders = sorted([p for p in per if p["rs_chg"] >= 15 and p["nh_last20"] and p["px_chg"] > 0],
                         key=lambda p: (-p["rs_chg"], p["sym"]))
        lagg = [p for p in per if p["rs_chg"] <= -10 and not p["nh_any"]]
        if not leaders or not lagg:
            continue
        lead = leaders[hsh("lead", t) % min(3, len(leaders))]
        rose = sorted([p for p in lagg if p["px_chg"] > 0], key=lambda p: (p["rs_chg"], p["sym"]))
        fell = sorted([p for p in lagg if p["px_chg"] <= 0], key=lambda p: (p["rs_chg"], p["sym"]))
        lag = (rose or fell)[0]
        rows.append({"sym": (lead["sym"], lag["sym"]), "t": t, "era": era_of(t), "h": hsh("leader", t),
                     "lead": lead, "lag": lag, "rose": lag["px_chg"] > 0})
    first = spread_pick([r for r in rows if r["rose"]], n - n // 2)
    used_syms = {s for r in first for s in r["sym"]}
    used_t = {r["t"] for r in first}
    rest = spread_pick([r for r in rows if not r["rose"] and not (set(r["sym"]) & used_syms)
                        and r["t"] not in used_t], n - len(first))
    out = []
    for r in sorted(first + rest, key=lambda r: r["t"]):
        lead, lag = r["lead"], r["lag"]
        t = r["t"]
        be = idx_of[t]
        asof = iso(t)
        lead_label = "Line A" if hsh("label", t) % 2 == 0 else "Line B"
        lag_label = "Line B" if lead_label == "Line A" else "Line A"
        lo = SLICE - WINDOW
        times = [x["t"] for x in lead["s"][lo:]]
        def pair_of(blank):
            return {lead_label[-1]: {"columns": rs_block(lead["cols"], lo, SLICE, blank_dots=blank), "times": times,
                                     "inputs": INPUTS},
                    lag_label[-1]: {"columns": rs_block(lag["cols"], lo, SLICE, blank_dots=blank), "times": times,
                                    "inputs": INPUTS}}
        pair = pair_of(True)                     # the prompt: no dot on either line (a dot names the leader)
        spy_chg = pct(bench[be]["c"], bench[be - WINDOW + 1]["c"])
        last_nh_date = iso(lead["s"][lo + lead["last_nh"]]["t"])
        facts = {"leader": lead_label, "laggard": lag_label, "leader_rs_change_pct": lead["rs_chg"],
                 "laggard_rs_change_pct": lag["rs_chg"], "leader_price_change_pct": lead["px_chg"],
                 "laggard_price_change_pct": lag["px_chg"], "spy_change_pct": spy_chg,
                 "leader_last_rs_high": last_nh_date, "window_bars": WINDOW, "lookback_weeks": 52, "lookback_bars": LOOKBACK,
                 "laggard_price_rose": lag["px_chg"] > 0, "era": era_of(t)}
        why_lag = (f"{lag_label}'s fell {abs(lag['rs_chg'])}%, even though that stock was up {lag['px_chg']}% in price. "
                   + CARDS["leader"]["line"]) if lag["px_chg"] > 0 else (
                   f"{lag_label}'s fell {abs(lag['rs_chg'])}%: that stock lost ground to the market, "
                   f"{updown(lag['px_chg'])} in price while SPY was {updown(spy_chg)}.")
        lesson = (f"{lead_label}. Its RS line rose {lead['rs_chg']}% over these 120 sessions and made a new 52-week "
                  f"high on {last_nh_date}: that stock beat the market. {why_lag} Read the slope, not the level.")
        ref = f"relative_strength.compute_phase1_columns#leader#{lead['sym']}-vs-{lag['sym']}#{asof}"
        out.append(make_item(
            type="spot", skill_id=SKILL, module=MODULE, difficulty=1, q=LEADER_Q, answer=lead_label,
            choices=["Line A", "Line B"],
            prompt_extra={"subject": f"rs-leader {asof}", "framing": LEADER_FRAMING,
                          "chart": {"window_bars": WINDOW, "tf": "D", "rs_pair": pair}},
            reveal={"system": "UCT RS Line, two stocks against SPY",
                    "detector": "relative_strength.compute_phase1_columns", "label": lead_label, "facts": facts,
                    "source": ref, "window_bars": WINDOW, "forward_bars": FORWARD, "rs_pair": pair_of(False),
                    "teaches": dict(CARDS["leader"], source="research 04 §d tour card 1"),
                    "example": {"sym": BENCH, "asof": asof, "names": {lead_label: lead["sym"], lag_label: lag["sym"]},
                                "found_by": "scripts/study/bank_v2/gen_rs.py"}},
            lesson_text=lesson, lesson_origin="session", source_kind="generator", source_ref=ref,
            sym=BENCH, asof=asof, adjustment_basis="split-adjusted", bars_embed=embed(BENCH, bench, be),
            rs_source={"bench": closes_str(lead["b"]),
                       "names": {lead_label[-1]: closes_str(lead["s"]), lag_label[-1]: closes_str(lag["s"])}}))
    return out


# ── (c) Strong on a weak day? ────────────────────────────────────────────────

def redday_candidates(sym, stock, bench_by_t):
    out = []
    for e in range(SLICE, len(stock) - FORWARD - 1):
        t, tp = stock[e]["t"], stock[e - 1]["t"]
        b, bp = bench_by_t.get(t), bench_by_t.get(tp)
        if not b or not bp:
            continue
        spy = (b / bp - 1) * 100
        if spy > RED_DAY_PCT:
            continue
        bar, prev = stock[e], stock[e - 1]
        chg = (bar["c"] / prev["c"] - 1) * 100
        if chg >= 0.5 and bar["c"] > bar["o"]:
            kind = "yes"
        elif chg <= spy - 0.5 and bar["c"] < bar["o"]:
            kind = "no"
        else:
            continue
        if not liquid(stock, e):
            continue
        out.append({"sym": sym, "e": e, "t": t, "era": era_of(t), "kind": kind, "h": hsh("red", sym, t)})
    return out


def redday_item(c, stock, bench, bench_by_t):
    got = compute_slice(stock, bench, c["e"])
    if not got:
        return None
    s, b, cols = got
    lo = SLICE - WINDOW
    if cols["gor"][-1] != (1.0 if c["kind"] == "yes" else 0.0):
        return None                                              # the indicator's own green-on-red must agree
    sym, e = c["sym"], c["e"]
    bar, prev = stock[e], stock[e - 1]
    asof = iso(bar["t"])
    spy_day = pct(bench_by_t[bar["t"]], bench_by_t[prev["t"]])
    day = pct(bar["c"], prev["c"])
    nh_red = cols["rsNHred"][-1] == 1.0
    facts = {"date": asof, "spy_day_pct": spy_day, "stock_day_pct": day, "close": bar["c"], "prev_close": prev["c"],
             "open": bar["o"], "gor": c["kind"] == "yes", "rs_new_high_on_red_day": nh_red,
             "red_day_threshold_pct": INPUTS["redDayThreshold"], "marked_bar_index": WINDOW - 1,
             "window_bars": WINDOW, "lookback_weeks": 52, "era": era_of(bar["t"]), **fwd_facts(stock, bench_by_t, e)}
    if c["kind"] == "yes":
        lesson = (f"Yes. SPY fell {abs(spy_day)}% on {asof} and this stock closed up {day}%. Green on a red day: "
                  f"someone was buying while the market sold."
                  + (" The RS line made a new 52-week high that same day." if nh_red else "")
                  + " It tells you where to look, not when to buy.")
    else:
        lesson = (f"No. SPY fell {abs(spy_day)}% on {asof} and this stock fell {abs(day)}%, more than the market did. "
                  f"Weak on a weak day shows no demand. The ones I want close green, or barely dip.")
    q = f"SPY fell {abs(spy_day)}% on the last day of this chart. Was this stock strong on that weak day?"
    ref = f"relative_strength.compute_phase1_columns#red-day#{sym}#{asof}"
    return make_item(
        type="spot", skill_id=SKILL, module=MODULE, difficulty=1, q=q, answer=c["kind"], choices=["Yes", "No"],
        prompt_extra={"subject": f"rs-red-day {asof}",
                      "chart": {"window_bars": WINDOW, "tf": "D",
                                "mark": {"bar_index": WINDOW - 1, "time": bar["t"], "label": f"SPY {spy_day}%"},
                                "rs": {"columns": rs_block(cols, lo, SLICE, blank_dots=True),
                                       "times": [x["t"] for x in s[lo:]], "inputs": INPUTS}}},
        reveal={"system": "UCT RS Line, green on a red market day (gor)",
                "detector": "relative_strength.compute_phase1_columns", "label": c["kind"].capitalize(),
                "facts": facts, "source": ref, "window_bars": WINDOW, "forward_bars": FORWARD,
                "rs": {"columns": rs_block(cols, lo, SLICE), "times": [x["t"] for x in s[lo:]], "inputs": INPUTS},
                "teaches": dict(CARDS["redday"], source="research 04 §d tour card 4"),
                "example": {"sym": sym, "asof": asof, "found_by": "scripts/study/bank_v2/gen_rs.py"}},
        lesson_text=lesson, lesson_origin="session", source_kind="generator", source_ref=ref,
        sym=sym, asof=asof, adjustment_basis="split-adjusted", bars_embed=embed(sym, stock, e),
        rs_source={"stock_warmup": closes_str(s[:lo]), "bench": closes_str(b)})


# ── (d) RS or RSI? ───────────────────────────────────────────────────────────

#: (subject, question, key, distractors, quote, quote_source, lesson). The quote is verbatim from research 04 (its §6
#: and §e); the lesson is drafted for the owner's review. Choices are at most 40 characters (VOICE.md §4).
RSI_ITEMS = (
    ("rs-vs-rsi compare", "RS or RSI: which one compares a stock to the market?", "RS, the RS line",
     ("RSI", "Both of them", "Neither of them"),
     "Relative Strength is a simple ratio of two securities' prices, whereas RSI... identify[ies] overbought and "
     "oversold conditions in a single asset.", "TradingView (FXOpen), research 04 §6",
     "RS, the RS line. It is the stock's price divided by the market's, drawn as a line. RSI never looks at the market."),
    ("rs-vs-rsi scale", "Which one runs on a fixed 0 to 100 scale?", "RSI",
     ("RS, the RS line", "Both of them", "Neither of them"),
     "RS compares a stock to a benchmark and has no bounds; RSI measures the stock's own momentum on a 0-100 scale.",
     "research 04 §e, misconception 1",
     "RSI. It lives between 0 and 100. The RS line has no bounds: only its direction and its own old highs matter."),
    ("rs-vs-rsi rsi-80", "A stock's RSI reads 80. What does that say about it against SPY?",
     "Nothing. RSI never looks at SPY", ("It is beating SPY", "It is lagging SPY", "It made an RS new high"),
     "RSI is a momentum oscillator comparing a stock to its own recent history.",
     "Timeless Market Theory, research 04 §6",
     "Nothing. RSI compares the stock to its own recent history. To know if it is beating the market, read the RS "
     "line."),
    ("rs-vs-rsi overbought", "The RS line just made a new 52-week high. Is the stock overbought?",
     "Not from that. RS shows leadership", ("Yes, a new high is overbought", "Yes, sell into it", "Only above 70"),
     "Calling RSI 'relative strength' is the first mistake.", "The Right Trader, research 04 §8",
     "Not from that. A new RS high says the stock is beating the market by the most it has in a year. Overbought is an "
     "RSI word."),
    ("rs-vs-rsi shared-math", "RS and RSI both carry the word relative. How much math do they share?",
     "They share no math", ("The same formula", "RSI is RS smoothed", "RS is RSI against SPY"),
     "One word, 'relative', got attached to two tools that share no math, no scale, and no purpose.",
     "Trends & Breakouts, research 04 §6",
     "They share no math. One divides the stock by the market. The other measures the stock's own up days against its "
     "down days."),
    ("rs-vs-rsi diverge", "RSI dropped from 70 to 50 while the RS line kept rising. Still beating the market?",
     "Yes, the RS line says it is", ("No, RSI says it is weak", "No, both must rise", "You cannot tell"),
     "Relative Strength analysis compares the performance of different assets.", "TrendSpider, research 04 §6",
     "Yes. The RS line rising means the stock is still beating the market. RSI cooling off is the stock against "
     "itself."),
    # RS split, U8: the indicator is "UCT RS Line" now (the split's slim definition); the key and the lesson name it.
    # The item id hashes source_ref + question + subject, never the key, so the owner's verdict (if any) stays bound.
    ("rs-vs-rsi search", "You want strength against the market on your chart. Which indicator do you add?",
     "UCT RS Line", ("RSI", "Stochastic RSI", "MACD"),
     "Calling RSI 'relative strength' is the first mistake.", "The Right Trader, research 04 §8",
     "UCT RS Line. RSI sits right next to it in the search and answers a different question."),
    ("rs-vs-rsi meaning", "What does a rising RS line tell you?",
     "The stock is beating the market", ("The price is going up", "The stock is overbought", "Buy it now"),
     "RS compares a stock to a benchmark and has no bounds; RSI measures the stock's own momentum on a 0-100 scale.",
     "research 04 §e, misconception 1",
     "The stock is beating the market. Both can be falling: the stock just falls less. RS says where to look, not when "
     "to buy."),
)


def rsi_items():
    out = []
    for subject, q, key, distractors, quote, qsrc, lesson in RSI_ITEMS:
        ref = f"{SOURCE_RESEARCH}#e-misconception-1#{subject}"
        choices = shuffled_choices(key, list(distractors), subject)
        out.append(make_item(
            type="recall", skill_id=SKILL, module=MODULE, difficulty=1, q=q, answer=key, choices=choices,
            prompt_extra={"subject": subject},
            reveal={"quote": quote, "quote_source": qsrc, "source": ref,
                    "facts": {"rsi_scale": "0-100", "rsi_bounds": [0, 100], "rs_bounds": None},
                    "teaches": dict(CARDS["rsi"], source=f"{SOURCE_RESEARCH} §e misconception 1; becomes "
                                                         "api/data/rs_teaching.json MISCONCEPTIONS[0] when unit 4-02 "
                                                         "lands")},
            lesson_text=lesson, lesson_origin="session", source_kind="generator", source_ref=ref))
    return out


# ── the segment ──────────────────────────────────────────────────────────────

def build(bars_db: str, counts=(12, 10, 10)) -> list:
    n_tap, n_lead, n_red = counts
    con = sqlite3.connect(f"file:{bars_db}?mode=ro", uri=True)
    bench = load(con, BENCH)
    bench_by_t = {x["t"]: x["c"] for x in bench}
    spy_up = spy_uptrend(bench)
    data = {}
    for sym in UNIVERSE:
        bars = load(con, sym)
        if len(bars) >= SLICE + FORWARD + 60:
            data[sym] = bars
    con.close()

    items: list = []
    # (a) half before price, half with price at its high
    tap_c = [c for sym, st in data.items() for c in tap_candidates(sym, st, bench, spy_up)]
    for kind, n in (("before", n_tap - n_tap // 2), ("plain", n_tap // 2)):
        got, pool = [], [c for c in tap_c if c["kind"] == kind]
        used = {i["sym"] for i in items}
        for c in spread_pick([c for c in pool if c["sym"] not in used], len(pool)):
            if len(got) >= n:
                break
            it = tap_item(c, data[c["sym"]], bench, bench_by_t)
            if it:
                got.append(it)
        items += got
    # (b)
    items += leader_items(data, bench, bench_by_t, n_lead)
    # (c) half yes, half no
    red_c = [c for sym, st in data.items() for c in redday_candidates(sym, st, bench_by_t)]
    for kind, n in (("yes", n_red - n_red // 2), ("no", n_red // 2)):
        got = []
        taken = {i["asof"] for i in items if i["prompt_json"].get("subject", "").startswith("rs-red-day")}
        pool = [c for c in red_c if c["kind"] == kind and iso(c["t"]) not in taken]
        for c in spread_pick(pool, len(pool)):
            if len(got) >= n:
                break
            it = redday_item(c, data[c["sym"]], bench, bench_by_t)
            if it:
                got.append(it)
        items += got
    # (d)
    items += rsi_items()
    return items


def family(item) -> str:
    s = (item.get("prompt_json") or {}).get("subject", "")
    return ("tap" if s.startswith("rs-new-high") else "leader" if s.startswith("rs-leader")
            else "redday" if s.startswith("rs-red-day") else "rsi")


def write(items) -> pathlib.Path:
    """write_segment's steps with the one difference this segment needs: a generator item may embed its bars."""
    from scripts.study import corrections
    items = corrections.apply(items)
    problems = _common.validate(items, allow_embed_kinds=("fixture", "generator"))
    if problems:
        raise ValueError(f"{SEGMENT}: {len(problems)} problem(s):\n  " + "\n  ".join(problems[:40]))
    path = _common.BANK_DIR / f"{SEGMENT}.json"
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(items, fh, indent=1, ensure_ascii=False, sort_keys=True)
        fh.write("\n")
    return path


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bars-db", required=True, help="a local bars database, opened read-only")
    a = ap.parse_args(argv)
    items = build(a.bars_db)
    path = write(items)
    print(f"{SEGMENT}: {len(items)} items -> {path} ({path.stat().st_size} bytes)")
    print("   by family:", dict(Counter(family(i) for i in items)))
    print("   by era:", dict(Counter((i["reveal_json"].get("facts") or {}).get("era") for i in items)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
