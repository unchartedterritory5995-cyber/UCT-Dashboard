#!/usr/bin/env python3
"""Alert replay harness — the instrument Phase C measures itself with.

⛔ `--freeze-bars` AND `--record` ARE ONE-SHOT. Their output is COMMITTED and is
the oracle. Re-running `--record` after a change re-records whatever the code now
does and converts a real regression into a green build — the same trap
`tests/fixtures/indicators/_generate.py` and `tests/fixtures/_gen_alert_baseline.py`
are written under.

    python tools/alert_replay.py --freeze-bars                 # once, ever
    python tools/alert_replay.py --record                      # once, on the UNMODIFIED tree
    python tools/alert_replay.py --check                       # the gate
    python tools/alert_replay.py --repaint --k 1 2 4 8         # the repaint oracle
    python tools/alert_replay.py --diff --mode-a forming --mode-b closed
                                                               # the DECLARED lane diff

WHY THIS EXISTS AT ALL. Phase C ships a NOTIFICATION. No screenshot catches a
wrong alert and an email cannot be un-sent, so the pixel gate that carried Phases
B1-B5 has no analogue here. Three measurements replace it, and two of them live in
this file:

  (1) THE FIRE LOG AS AN EQUALITY. Walk frozen REAL bars, record every
      `(alert_key, bar_index, bar_time, value, triggered)`, commit it BEFORE
      anything changes. `value` is IN the key deliberately — a set keyed without
      it reports a changed NUMBER as no change at all.
  (2) THE REPAINT ORACLE. A fire repaints iff the fire set depends on WHEN YOU
      LOOKED. Replay the same bars at K intra-bar granularities and measure the
      disagreement. Today's evaluator judges the FORMING bar with
      cycle-granularity crossings, so it MUST disagree across K; a zero is
      REFUSED as vacuous rather than reported as a pass.
  (3) THE DECLARED LANE DIFF (Task 6). A DIFFERENT question from (2), and one it
      structurally cannot answer: (2) asks whether a lane agrees with ITSELF across
      granularities — Task 5 drove that to 0/0 — while this asks whether the NEW
      lane agrees with the OLD one, and where it does not, whether every difference
      is DECLARED per address with a reason. 🔴 Task 5 MEASURED that (2) is
      necessary and NOT sufficient: its M1 (the defect restored) and M4 (a
      uniformly shifted column) both repaint ZERO and are both wrong.

⚠️ THIS TOOL CHANGES NO SHIPPED SOURCE. It reads `indicator_alert_evaluator`;
it does not edit it, and `test_this_task_changed_no_shipped_source` is the rail.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from typing import Any, Callable, Iterable, Optional

_HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(_HERE, ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

FIXTURE_DIR = os.path.join(ROOT, "tests", "fixtures", "alerts")
BARS_PATH = os.path.join(FIXTURE_DIR, "replay_bars.json")
FIRE_LOG_PATH = os.path.join(FIXTURE_DIR, "fire_log_forming.json")

# ⭐ THE PRODUCTION BAR WINDOW, AND WHY THE REPLAY HONOURS IT.
#
# `_fetch_bars_for_alert(sym, tf, 200)` is what the live cycle hands every value
# function — never a growing prefix. A replay that fed an ever-longer series would
# be measuring an evaluator that does not exist: `compute_rsi`'s Wilder seed, OBV's
# pinned zero and Donchian's window all move when the left edge of the input moves.
# So the replay slides the same 200-bar window production does, and the harness is
# faithful rather than merely plausible.
PROD_BAR_WINDOW = 200

# The fire log records the CLOSED-bar answer (k=1) and the forming-bar answer
# (k=4) in one artifact. k=1 is the degenerate "only ever saw the close" replay,
# so Task 5 gets both halves — what the rebuilt lane must reproduce, and what it
# must stop doing — out of a single committed file.
RECORD_KS = (1, 4)

# The repaint oracle's default ladder. 1 ⊂ 2 ⊂ 4 ⊂ 8 as SAMPLE SETS (see
# `intrabar_path`), which is why measuring all four costs 8 samples per bar and
# not 15.
REPAINT_KS = (1, 2, 4, 8)


# ─── Step 2: THE PATH MODEL, AND WHY A MODEL IS THE RIGHT ANSWER ─────────────
#
# A repaint is BY DEFINITION a dependence of the fire set on the intra-bar path.
# We have no tick data, so we synthesize the path from OHLC using the standard
# convention: an UP bar walks o -> l -> h -> c, a DOWN bar walks o -> h -> l -> c.
# That carries the two extremes, which are the only points that can flip a
# threshold that the close does not.
#
# ⚠️ IT IS A MODEL, AND ITS LIMITS ARE STATED:
#
#   * it cannot reproduce a path that touches an extreme TWICE, so it UNDER-counts
#     repaints. That is the safe direction — a repaint this model does not see is
#     one the real tape can still produce, so a future `closed`-lane ZERO is a
#     claim about a SUPERSET of the paths this harness drives, never a subset.
#   * the running CLOSE never lands exactly on `h` or `l` unless k is a multiple
#     of 3 (the walk has three legs and the samples are evenly spaced), so a
#     threshold sitting in the last sliver below an extreme can be missed. Also
#     an under-count.
#   * volume accrues LINEARLY. Real volume clusters at the open and the close, so
#     MFI/OBV/VWAP partials are smoother here than on tape. Direction of the error
#     is not provable, and it is written down rather than glossed.
#   * the model says nothing about WHEN the evaluator looked in wall-clock terms.
#     k is a granularity, not a schedule; production polls on a 60s timer, so on a
#     5-minute bar k≈5 and on a daily bar k≈390. Reported k values are therefore a
#     LOWER bound on the sampling the live loop actually performs.


def intrabar_path(bar: dict, k: int) -> list[dict]:
    """The k partial bars the store would have held while `bar` was forming.

    Every partial carries the running high/low/close as of that sample. The LAST
    partial is the closed bar itself, byte-identical to `bar` — so `k=1` is the
    degenerate "only ever saw the close" case and MUST reproduce the closed-bar
    answer for any evaluator.
    """
    if k < 1:
        raise ValueError(f"k must be >= 1, got {k!r}")
    o, h, l, c = bar["o"], bar["h"], bar["l"], bar["c"]
    legs = [o, l, h, c] if c >= o else [o, h, l, c]
    out: list[dict] = []
    for i in range(k):
        # sample the piecewise-linear walk at k evenly spaced points, last == c
        pos = (i + 1) / k * (len(legs) - 1)
        seg = min(int(pos), len(legs) - 2)
        frac = pos - seg
        px = legs[seg] + (legs[seg + 1] - legs[seg]) * frac
        seen = legs[: seg + 1] + [px]
        out.append({
            "t": bar["t"], "o": o,
            "h": max(seen), "l": min(seen), "c": px,
            # volume accrues linearly; MFI and OBV read it
            "v": int(bar["v"] * (i + 1) / k),
        })
    out[-1] = dict(bar)
    return out


# ─── Step 3: the replay + the fire key ───────────────────────────────────────

def fire_key(f: dict) -> tuple:
    """The identity of one fire. `value` is IN the key on purpose.

    Two fires of the same alert on the same bar at different values are two
    different facts about the world, and a set keyed without the value would
    report a changed number as no change at all.
    """
    return (f["alert_key"], f["bar_index"], f["bar_time"],
            repr(f["value"]), f["triggered"])


def replay(bars: list[dict], alerts: list[dict], *, k: int,
           evaluate: Callable[[dict, list[dict]], tuple]) -> list[dict]:
    """Walk `bars` one bar at a time, k intra-bar samples each, collecting fires.

    `evaluate(alert, bars_seen) -> (value, triggered)` is injected — the harness
    never imports the evaluator's private names, so the same harness measures the
    forming lane and the closed lane without a branch.

    `alert["last_value"]` is carried between samples exactly as
    `record_evaluation` / `record_trigger` do in production. That is the whole
    mechanism under test.

    ⚠️ THE MUTATION HAPPENS ON A SHALLOW COPY, not on the caller's dict. The brief
    for this task wrote it in place; that makes `replay` single-use and silently
    couples two calls that look independent (`replay(bars, A, k=4)` followed by
    `replay(bars, A, k=1)` would start the second run with the first run's final
    `last_value`, which is exactly the accident that makes a "no repaints" reading
    look real). Copying preserves the mechanism — the write-back still happens,
    sample to sample, and mutation M4 still kills — while making the function
    idempotent for its callers.
    """
    work = [dict(a) for a in alerts]
    fires: list[dict] = []
    for i, bar in enumerate(bars):
        for j, partial in enumerate(intrabar_path(bar, k)):
            lo = max(0, i + 1 - PROD_BAR_WINDOW)
            seen = bars[lo:i] + [partial]
            for a in work:
                value, triggered = evaluate(a, seen)
                if value is None:
                    continue
                if triggered:
                    # `sample` is NOT part of fire_key — the key is the identity of
                    # a FIRE, and the same alert firing twice inside one bar at the
                    # same value is one fact, not two. It is carried alongside so
                    # the committed log can be replayed back in emission order and
                    # so Task 5 can see WHICH sample of a forming bar fired.
                    fires.append({"alert_key": a["alert_key"], "bar_index": i,
                                  "bar_time": bar["t"], "value": value,
                                  "triggered": True, "sample": j})
                a["last_value"] = value
    return fires


# ─── the evaluator adapter (TODAY'S FORMING LANE) ────────────────────────────

def make_forming_evaluate() -> Callable[[dict, list[dict]], tuple]:
    """An `evaluate` bound to TODAY'S `indicator_alert_evaluator`, memoized.

    ⚠️ THIS IS A RE-EXPRESSION OF `_evaluate_one`'s TAIL, AND THAT IS A FORK RISK.
    It exists only because the value of an address is a pure function of
    (address, params, window) while `triggered` also depends on the condition,
    the threshold and `last_value` — so a grid of ~350 alerts over one window
    costs ONE compute per address instead of 350. Without the memo the record run
    is twelve times longer and nobody runs it.

    The fork is not left on trust: `test_the_harness_agrees_with_the_evaluators_own_evaluate_one`
    drives BOTH this adapter and `ev._evaluate_one` over every address × every
    condition × a threshold ladder × several `prev` values and demands exact
    equality of `(value, triggered)`. If `_evaluate_one` changes and this does
    not, that test goes red before any replay number does.
    """
    from api.services import indicator_alert_evaluator as ev

    value_memo: dict[tuple, Optional[float]] = {}
    band_memo: dict[tuple, Optional[float]] = {}

    def _window_key(seen: list[dict]) -> tuple:
        tail = seen[-1]
        return (len(seen), seen[0]["t"], tail["t"], tail["o"], tail["h"],
                tail["l"], tail["c"], tail["v"])

    def evaluate(alert: dict, seen: list[dict]) -> tuple:
        address = ev.resolve_address(alert.get("indicator"))
        # 🔴 `ev.value_function(address)`, NOT `ev.INDICATOR_FUNCS.get(address)`,
        # AND THE DIFFERENCE WAS A LIVE FORK. `_evaluate_one` resolves through
        # `value_function`, which consults `INDICATOR_FUNCS` **and then**
        # `EVENT_FUNCS`; this adapter consulted only the first, so the two `sar`
        # event addresses evaluated to `(None, False)` here while the SHIPPED
        # forming lane fired them 39 times on spy_daily alone. It was invisible to
        # every committed measurement because `build_alert_grid` generates the
        # grid from `INDICATOR_FUNCS`, so no oracle had ever driven an event
        # address through this function — the anti-fork rail included, which
        # iterated the same dict. Task 6's diff drove all 30 addresses and found
        # it. The rail now iterates both tables.
        fn = ev.value_function(address)
        if fn is None or not seen:
            return None, False
        params = ev._parse_params(alert)
        pkey = json.dumps(params, sort_keys=True)
        wkey = _window_key(seen)

        vkey = (address, pkey, wkey)
        if vkey in value_memo:
            value = value_memo[vkey]
        else:
            try:
                value = fn(seen, params)
            except Exception:
                value = None
            value_memo[vkey] = value
        if value is None:
            return None, False

        condition = alert.get("condition") or ""
        threshold = alert.get("threshold")
        # ⚰️ `ev._bb_threshold_override` USED TO BE CALLED HERE, AND THIS LINE IS
        # WHY IT STILL EXISTED. Task 3 retired the band arithmetic into
        # `THRESHOLD_OPERAND` but left the symbol as a delegation, because
        # deleting it would have broken the `--check` being used to prove that
        # commit safe. Task 5 owns this file, so the binding is re-pointed at the
        # general grammar and the symbol is gone. The lookup is by (address,
        # condition) rather than `if address == "bb"`, which reaches the same two
        # declared rows on this grid — the grid is generated from
        # `INDICATOR_FUNCS`, and the only other declared operands belong to the
        # two `EVENT_FUNCS` addresses, which are not in it. `--check` reproduces
        # all 691,195 frozen fires digest for digest, which is the proof.
        bkey = (address, pkey, condition, wkey)
        if bkey in band_memo:
            dyn = band_memo[bkey]
        else:
            # NOT wrapped: `_evaluate_one` does not wrap it either, so a raise
            # here has to propagate or the adapter would be more forgiving
            # than the lane it claims to reproduce.
            dyn = ev.threshold_operand_value(address, condition, seen, params)
            band_memo[bkey] = dyn
        if dyn is not None:
            threshold = dyn

        triggered = ev.check_condition(condition, value, alert.get("last_value"),
                                       threshold)
        return value, triggered

    return evaluate


# ─── the evaluator adapter (THE CLOSED LANE) ─────────────────────────────────

def make_closed_evaluate() -> Callable[[dict, list[dict]], tuple]:
    """An `evaluate` bound to the SHIPPED closed lane, `ev._evaluate_one_closed`.

    ⭐ IT CALLS THE REAL FUNCTION. `tests/test_alert_replay.py::_closed_bar_evaluate`
    is a HYPOTHETICAL closed evaluator written in Task 2, before any of this
    existed, purely to prove the oracle could read zero. It stays exactly as it
    was — an oracle that predates its implementation is worth more than a tidy
    one — and this adapter is the separate thing: the production lane, driven
    through the same harness.

    ⚠️ WHERE `now_epoch` COMES FROM, AND WHY IT IS DERIVED PER WINDOW. `replay`
    hands every evaluator `bars[lo:i] + [partial]`, so the LAST element is by
    construction the bar that is still forming. Production asks `time.time()`;
    the replay asks "one second before this bar can close", which puts the loop
    at the same point in the bar's life that a live 60-second poll is at. The
    closed lane then resolves the newest CLOSED bar itself, through
    `closed_bar_index` — the same three-reason rule production runs, not a
    `seen[:-1]` shortcut that would make the harness measure a different
    evaluator from the one that ships.

    ⛔ THE MEMO KEYS ON THE FULL WINDOW, INCLUDING THE FORMING PARTIAL, AND THAT
    IS LOAD-BEARING. Keying it on the closed prefix instead would be faster AND
    WOULD MANUFACTURE THE ANSWER: every k would return a memo hit from k=1 and
    the repaint oracle would read zero no matter what the code did — a gate that
    cannot fail. The key is byte-for-byte the forming adapter's `_window_key`,
    so the zero is a property of the evaluator. (The memo is dropped whenever the
    window changes rather than accumulating: this one caches whole 200-element
    COLUMNS, and `replay` walks every alert of one window before moving on, so a
    per-window memo is the whole win and an unbounded one is gigabytes.)
    """
    from api.services import alert_series
    from api.services import indicator_alert_evaluator as ev

    state: dict = {"wkey": None, "series": {}}

    def _window_key(seen: list[dict]) -> tuple:
        tail = seen[-1]
        return (len(seen), seen[0]["t"], tail["t"], tail["o"], tail["h"],
                tail["l"], tail["c"], tail["v"])

    def evaluate(alert: dict, seen: list[dict]) -> tuple:
        if not seen:
            return None, False
        address = ev.resolve_address(alert.get("indicator"))
        if alert_series.series_function(address) is None:
            return None, False

        tf = alert.get("tf") or ""
        close_at = ev.bar_close_epoch(seen[-1].get("t"), tf)
        if close_at is None:
            return None, False
        now_epoch = close_at - 1

        i = ev.closed_bar_index(seen, tf, now_epoch)
        if i < 1:
            return None, False

        params = ev._parse_params(alert)
        pkey = json.dumps(params, sort_keys=True)
        wkey = _window_key(seen)
        if state["wkey"] != wkey:
            state["wkey"] = wkey
            state["series"] = {}
        skey = (address, pkey)
        if skey in state["series"]:
            series = state["series"][skey]
        else:
            try:
                series = alert_series.series_for(address, seen, params)
            except AssertionError:
                raise
            except Exception:
                series = None
            state["series"][skey] = series
        if series is None:
            return None, False

        current, prev = series[i], series[i - 1]
        if current is None:
            return None, False

        condition = alert.get("condition") or ""
        threshold = alert.get("threshold")
        dyn = ev._closed_threshold_operand_value(address, condition, seen,
                                                 params, i)
        if dyn is not None:
            threshold = dyn
        return current, ev.check_condition(condition, current, prev, threshold)

    return evaluate


# The two lanes, by name, so `--mode` cannot name one that does not exist and a
# third lane cannot be added without appearing here.
EVALUATE_FACTORIES: dict[str, Callable[[], Callable[[dict, list[dict]], tuple]]] = {
    "forming": make_forming_evaluate,
    "closed": make_closed_evaluate,
}


# ─── Step 5: THE REPAINT ORACLE ──────────────────────────────────────────────

def repaint_disagreement(bars: list[dict], alerts: list[dict], ks: Iterable[int],
                         evaluate: Callable[[dict, list[dict]], tuple]) -> dict:
    """How much the fire set depends on WHEN WE LOOKED.

    Returns `{k: fires}` plus the symmetric difference against k=1, at two
    resolutions:

      `keyed`    — the full `fire_key`, value included. A number that MOVED is a
                   different fact about the world and counts here.
      `identity` — `(alert_key, bar_index)` only. A fire that EXISTS at one
                   granularity and not at another. This is the number that cannot
                   be waved away as numeric jitter, and a zero here is refused
                   just as loudly as a zero in `keyed`.

    An evaluator that judges the CLOSED bar returns the same set at every k, so
    both unions are EMPTY. An evaluator that judges the forming bar with
    cycle-granularity crossings does not.
    """
    ks = sorted(set(int(x) for x in ks))
    if 1 not in ks:
        raise ValueError("the k ladder must contain 1 — it is the closed-bar baseline")

    per_k: dict[int, list[dict]] = {}
    for k in ks:
        per_k[k] = replay(bars, alerts, k=k, evaluate=evaluate)

    keyed = {k: {fire_key(f) for f in fs} for k, fs in per_k.items()}
    ident = {k: {(f["alert_key"], f["bar_index"]) for f in fs} for k, fs in per_k.items()}

    keyed_diff: dict[int, int] = {}
    ident_diff: dict[int, int] = {}
    keyed_union: set = set()
    ident_union: set = set()
    for k in ks:
        if k == 1:
            keyed_diff[k] = 0
            ident_diff[k] = 0
            continue
        dk = keyed[k] ^ keyed[1]
        di = ident[k] ^ ident[1]
        keyed_diff[k] = len(dk)
        ident_diff[k] = len(di)
        keyed_union |= dk
        ident_union |= di

    return {
        "ks": ks,
        "fires_per_k": {k: len(per_k[k]) for k in ks},
        "keyed_diff_vs_k1": keyed_diff,
        "identity_diff_vs_k1": ident_diff,
        "keyed_disagreement": len(keyed_union),
        "identity_disagreement": len(ident_union),
        "examples": sorted(str(x) for x in list(ident_union)[:12]),
        "_per_k": per_k,
    }


# ─── fixtures ────────────────────────────────────────────────────────────────

def _bars_digest(bars: list[dict]) -> str:
    return hashlib.sha256(
        json.dumps(bars, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def load_fixture(name: str) -> dict:
    """One frozen bar series, by name, with its provenance resolved.

    ⭐ `intraday5m` IS NOT COPIED, IT IS REFERENCED. Its entry carries
    `barsFrom: app/src/pages/parityBars/intraday5m.json` and a sha256, and this
    function reads THAT file and re-checks the digest. So the compute oracle
    (`tests/fixtures/indicators/intraday5m_sessions.json`), the pixel gate
    (`tools/chart_parity.py --fixedbars`) and this replay are provably ONE series
    — not three copies that agreed on the day somebody made them. A fixture only
    one lane reads proves nothing; a fork here would be silent, so the fork is
    made unrepresentable instead of merely discouraged.
    """
    with open(BARS_PATH, encoding="utf-8") as fh:
        doc = json.load(fh)
    if name not in doc["fixtures"]:
        raise KeyError(f"no such replay fixture: {name!r} "
                       f"(have {sorted(doc['fixtures'])})")
    entry = dict(doc["fixtures"][name])
    if entry.get("barsFrom"):
        src = os.path.join(ROOT, entry["barsFrom"].replace("/", os.sep))
        with open(src, encoding="utf-8") as fh:
            bars = json.load(fh)["bars"]
        got = _bars_digest(bars)
        if got != entry["sha256"]:
            raise AssertionError(
                f"{name}: {entry['barsFrom']} no longer digests to the recorded "
                f"sha256 ({got} != {entry['sha256']}). That file is the SHARED "
                "parity series — every pixel number and every golden indicator "
                "fixture measured against it moved too. Do not re-stamp this; "
                "find out why it changed."
            )
        entry["bars"] = bars
    else:
        got = _bars_digest(entry["bars"])
        if got != entry["sha256"]:
            raise AssertionError(f"{name}: inline bars no longer digest to {entry['sha256']}")
    return entry


def fixture_names() -> list[str]:
    with open(BARS_PATH, encoding="utf-8") as fh:
        return list(json.load(fh)["order"])


# ─── Step 6: the named wick fixture ──────────────────────────────────────────

def build_wick_that_unwinds() -> list[dict]:
    """A ramp that parks RSI(14) at ~67, one bar whose HIGH takes it above 70 and
    whose CLOSE leaves it at ~68.8, then flat.

    Measured on `compute_rsi` at build time and asserted by `--freeze-bars`:

        closed-bar RSI never exceeds 68.84 anywhere in the series, so `k=1` never
        crosses 70 and `cross_above 70` cannot fire on the close;
        the running close reaches 103.99 at k=2 (RSI 74.31), 104.875 at k=4
        (RSI 77.39) and 105.16 at k=8 (RSI 78.23), so the forming lane fires.

    The tail is deliberately FLAT — with every delta zero, Wilder's averages decay
    by the same factor and RSI holds at 68.84 rather than drifting up to 100, so
    the fixture proves the wick and nothing else.
    """
    warm, chop, step_up, ramp = 46, 0.45, 0.30, 7
    closes = [100.0]
    for i in range(1, warm):
        closes.append(round(closes[-1] + (chop if i % 2 else -chop), 4))
    for _ in range(ramp):
        closes.append(round(closes[-1] + step_up, 4))

    bars: list[dict] = []
    t, tf_step = 1761897600, 300
    for i, c in enumerate(closes):
        o = closes[i - 1] if i else round(c - 0.05, 4)
        bars.append({"t": t, "o": round(o, 4),
                     "h": round(max(o, c) + 0.09, 4),
                     "l": round(min(o, c) - 0.09, 4),
                     "c": round(c, 4), "v": 50000 + ((i * 37) % 9000)})
        t += tf_step
    o = closes[-1]
    c = round(o + 0.30, 4)
    bars.append({"t": t, "o": round(o, 4), "h": round(o + 3.00, 4),
                 "l": round(o - 0.12, 4), "c": c, "v": 214000})
    t += tf_step
    for _ in range(12):
        bars.append({"t": t, "o": c, "h": c, "l": c, "c": c, "v": 40000})
        t += tf_step
    return bars


WICK_INDEX = 53  # the wick bar's index in `wick_that_unwinds`


def rsi_cross_above_70(fixture: str = "wick_that_unwinds") -> dict:
    """A FRESH `cross_above 70` RSI alert. Fresh because `last_value` is carried."""
    return {
        "id": 1, "user_id": "replay", "sym": fixture, "tf": "5",
        "indicator": "rsi", "condition": "cross_above", "threshold": 70.0,
        "params_json": None, "last_value": None,
        "alert_key": f"{fixture}|rsi|cross_above|70.0",
    }


# ─── the alert grid, generated from the LIVE catalog ─────────────────────────

def _ladder(values: list) -> list[float]:
    """Three thresholds derived from what this address ACTUALLY produces here.

    A FIXED ladder (the 5,040 baseline's -100 … 150) misses every price-scale
    address outright: VWAP on SPY is ~600 and a threshold of 70 is never crossed,
    so the log would pin nothing at all about half the catalog. These sit at the
    20th / 50th / 80th percentile of the observed series, which makes `above`,
    `below` and both crosses reachable by construction.
    """
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return []

    def q(p: float) -> float:
        return vals[min(len(vals) - 1, max(0, int(round(p * (len(vals) - 1)))))]

    lo, mid, hi = q(0.20), q(0.50), q(0.80)
    if lo == hi:
        # A constant series (OBV on a zero-volume window, a flat Donchian).
        # Straddle it, or `above` can never fire and the per-address non-vacuity
        # assertion trips for a reason that has nothing to do with the code.
        span = max(abs(mid), 1.0) * 0.01
        lo, hi = mid - span, mid + span
    out: list[float] = []
    for t in (lo, mid, hi):
        r = round(float(t), 6)
        if r not in out:
            out.append(r)
    return out


def closed_bar_values(bars: list[dict], address: str,
                      evaluate: Callable[[dict, list[dict]], tuple]) -> list:
    """The address's value at every CLOSED bar — the k=1 series.

    Shares the evaluate memo with the replay that follows, so deriving the ladder
    is free once the k=1 pass has to happen anyway.
    """
    probe = {"id": 0, "user_id": "replay", "sym": "REPLAY", "tf": "?",
             "indicator": address, "condition": "above", "threshold": None,
             "params_json": None, "last_value": None, "alert_key": "probe"}
    out = []
    for i in range(len(bars)):
        lo = max(0, i + 1 - PROD_BAR_WINDOW)
        value, _ = evaluate(probe, bars[lo:i + 1])
        out.append(value)
    return out


def build_alert_grid(fixture: str, bars: list[dict], tf: str,
                     evaluate: Callable[[dict, list[dict]], tuple]) -> tuple[list[dict], dict]:
    """Every alert the LIVE catalog can express on this series.

    Generated from `INDICATOR_FUNCS` / `ALERT_CONDITIONS`, never hand-copied — the
    ledger and the evaluator's own comment both claim 25 addresses and there are
    28, so a hand-written list would have been wrong before it was committed.

    Params are left at their defaults on purpose. `tests/fixtures/indicator_alert_baseline.json`
    already replays 5,040 combinations ACROSS PARAMS on a fixed series; this log's
    job is the orthogonal one — the same params walked bar by bar down real tape.
    """
    from api.services import indicator_alert_evaluator as ev

    alerts: list[dict] = []
    ladders: dict[str, list[float]] = {}
    aid = 0
    for address in ev.INDICATOR_FUNCS:
        values = closed_bar_values(bars, address, evaluate)
        ladder = _ladder(values)
        ladders[address] = ladder
        for cond in ev.ALERT_CONDITIONS[address]:
            thresholds: list = ladder if cond.get("needs_threshold") else [None]
            for thr in thresholds:
                aid += 1
                alerts.append({
                    "id": aid, "user_id": "replay", "sym": fixture, "tf": tf,
                    "indicator": address, "condition": cond["value"],
                    "threshold": thr, "params_json": None, "last_value": None,
                    "alert_key": f"{fixture}|{address}|{cond['value']}|{thr!r}",
                })
    return alerts, ladders


# ─── recording / checking ────────────────────────────────────────────────────

def _git_head() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT,
                              capture_output=True, text=True).stdout.strip()
    except Exception:
        return "unknown"


def _address_of(alert_key: str) -> str:
    return alert_key.split("|")[1]


# ⭐ HOW THE LOG STORES 691,195 FIRES IN HALF A MEGABYTE, AND WHY THAT IS STILL
#    AN EQUALITY.
#
# The first recording of this log was 42 MB of raw rows. That is not a fixture, it
# is a liability — every clone pays for it forever and no reviewer reads it. But
# the number is not an accident to be tuned away: THIS EVALUATOR HAS NO
# FIRE-ONCE. `record_trigger` bumps `trigger_count` and leaves `active=1`, so
# `list_active` hands the alert straight back on the next 60-second cycle; an
# `above 70` RSI alert re-delivers bell + email + Discord every minute for as long
# as RSI stays above 70. 691,195 is what the lane actually does, so the log keeps
# it and stores it densely rather than shrinking the grid until the number looks
# comfortable.
#
# So each (fixture, k, alert) records its COUNT and a sha256 over the exact
# ordered `(bar_index, sample, repr(value))` sequence. `value` is inside the
# hashed text, so a changed NUMBER changes the digest — the property the raw rows
# existed for is preserved, not weakened. What is lost is READABILITY of a diff,
# and that is bought back two ways: the digest is per-ALERT so a failure names
# which alert moved, and `wick_that_unwinds` carries its rows IN FULL, which is
# the fixture `tests/test_alert_replay.py` replays row-for-row on every run.


def _rows_text(rows: list) -> str:
    return "\n".join(f"{r[0]}:{r[1]}:{r[2]}" for r in rows)


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _fire_rows(fires: list[dict]) -> list:
    return [[f["bar_index"], f["sample"], repr(f["value"])] for f in fires]


# The one fixture whose rows are stored verbatim: small enough to commit, small
# enough for pytest to replay in full, and it is the fixture whose whole reason
# for existing is a single fire nobody may lose track of.
VERBATIM_FIXTURE = "wick_that_unwinds"


def _run_all(ks: Iterable[int], only: Optional[list[str]] = None,
             progress: bool = True) -> dict:
    """Replay every frozen fixture at every k. The one engine behind every mode."""
    names = only or fixture_names()
    evaluate = make_forming_evaluate()
    out: dict[str, Any] = {"fixtures": {}, "grid_alerts": 0}
    for name in names:
        fx = load_fixture(name)
        bars = fx["bars"]
        alerts, ladders = build_alert_grid(name, bars, fx.get("tf", "?"), evaluate)
        out["grid_alerts"] += len(alerts)
        per_k = {}
        for k in ks:
            if progress:
                print(f"  {name:20} k={k} ({len(bars)} bars x {len(alerts)} alerts) …",
                      flush=True)
            per_k[k] = replay(bars, alerts, k=k, evaluate=evaluate)
        out["fixtures"][name] = {"bars": bars, "alerts": alerts,
                                 "ladders": ladders, "fires": per_k}
    return out


def _fire_blocks(fx: dict, name: str) -> tuple[dict, int, int, dict]:
    """One fixture's per-k fire-log blocks, plus the totals they contribute.

    Extracted verbatim out of `cmd_record` so `--record --append` cannot record a
    new fixture in a SHAPE the frozen ones were not recorded in. A second
    implementation of this would be a second definition of what a digest is, and
    the whole gate is that there is exactly one.
    """
    blocks: dict[str, Any] = {}
    fires_total = 0
    slots_total = 0
    per_address: dict[str, int] = {}
    for k, fires in fx["fires"].items():
        grouped: dict[str, list] = {}
        for f in fires:
            grouped.setdefault(f["alert_key"], []).append(
                [f["bar_index"], f["sample"], repr(f["value"])])
            addr = _address_of(f["alert_key"])
            per_address[addr] = per_address.get(addr, 0) + 1
        block = {
            "count": len(fires),
            "digest": _digest("\n".join(repr(fire_key(f)) for f in fires)),
            "per_alert": {key: [len(rows), _digest(_rows_text(rows))]
                          for key, rows in grouped.items()},
            "head": _fire_rows(fires[:15]),
        }
        if name == VERBATIM_FIXTURE:
            block["rows"] = grouped
        blocks[str(k)] = block
        fires_total += len(fires)
        slots_total += len(fx["alerts"]) * len(fx["bars"])
    return blocks, fires_total, slots_total, per_address


def cmd_record_append(args) -> int:
    """Record fire-log blocks for NAMED NEW fixtures. It may not touch the others.

    ⭐ WHY THIS IS A SEPARATE MODE AND NOT `--record --force`. `--force` re-records
    the WHOLE log from whatever the code now does, which is precisely the trap the
    module docstring opens with: a real regression becomes a green build and
    nobody can tell, because the artifact and the expectation moved together. The
    frozen digests are a CONTRACT — a corpus may grow, and an existing digest may
    not move. So this mode replays only the fixtures it is given, refuses one it
    has already seen, and then PROVES the untouched half is untouched by comparing
    every pre-existing fixture object before and after. If an existing digest
    moves, that is a finding about the closed lane, not a number to regenerate.
    """
    names = list(args.only or [])
    if not names:
        raise SystemExit("--record --append needs --only <fixture> [...] — appending "
                         "'everything' is --record, and --record is one-shot.")
    with open(FIRE_LOG_PATH, encoding="utf-8") as fh:
        log = json.load(fh)
    corpus = list(fixture_names())
    for name in names:
        if name in log["fixtures"]:
            raise SystemExit(
                f"{name!r} already has a fire-log block. This mode is ADDITIVE: "
                "re-recording an existing fixture re-records whatever the code now "
                "does and converts a real regression into a green build.")
        if name not in corpus:
            raise SystemExit(f"{name!r} is not in the frozen corpus "
                             f"({os.path.basename(BARS_PATH)}); freeze its bars first.")

    ks = log["ks"]
    print(f"=== RECORD --append (ks={ks}, window={PROD_BAR_WINDOW}) ===")
    print(f"  appending: {names}")
    run = _run_all(ks, only=names)

    before = {k: json.dumps(v, sort_keys=True) for k, v in log["fixtures"].items()}
    before_summary = dict(log["summary"])

    added_fires = 0
    added_slots = 0
    per_address: dict[str, int] = dict(log["summary"]["per_address_fires"])
    for name in names:
        fx = run["fixtures"][name]
        blocks, fires_n, slots_n, addrs = _fire_blocks(fx, name)
        # ⭐ EACH APPENDED FIXTURE ASSERTS ITS OWN NON-VACUITY SEPARATELY. A merged
        # total hides a fixture that fired nothing behind ten that did, and a
        # fixture that fires nothing pins nothing about the lane it was added to
        # measure.
        if not fires_n:
            raise SystemExit(f"{name}: NOTHING FIRED across {ks}. A fixture that "
                             "cannot fire cannot detect a change in firing.")
        if fires_n >= slots_n:
            raise SystemExit(f"{name}: every combination fired — the grid is saturated.")
        for addr, n in addrs.items():
            per_address[addr] = per_address.get(addr, 0) + n
        log["fixtures"][name] = {
            "bar_count": len(fx["bars"]),
            "alert_count": len(fx["alerts"]),
            "ladders": fx["ladders"],
            "alert_keys": [a["alert_key"] for a in fx["alerts"]],
            "fires": blocks,
        }
        added_fires += fires_n
        added_slots += slots_n
        run["fixtures"][name]["_appended"] = fires_n
        print(f"  + {name:22} {fires_n} fires over {ks}")

    log["summary"] = {
        "fires": before_summary["fires"] + added_fires,
        "slots": before_summary["slots"] + added_slots,
        "grid_alerts": before_summary["grid_alerts"] + run["grid_alerts"],
        "per_address_fires": dict(sorted(per_address.items())),
    }
    log.setdefault("appended", []).append({
        "at_head": _git_head(),
        "fixtures": names,
        "added_fires": added_fires,
        "note": (
            "APPENDED, NOT RE-RECORDED. The blocks above this entry are the ones "
            "frozen before any Phase C behaviour change and every one of their "
            "digests is byte-identical across this append — `--record --append` "
            "compares every pre-existing fixture object before and after and "
            "refuses to write if one moved. These fixtures were replayed through "
            "the SAME forming lane, on a tree where `ALERT_EVAL_MODE` is still "
            "'forming' and `--check` reproduced all eight original (fixture, k) "
            "pairs digest for digest immediately beforehand."),
    })

    moved = [k for k, b in before.items()
             if json.dumps(log["fixtures"][k], sort_keys=True) != b]
    if moved:
        raise SystemExit(
            f"the append CHANGED pre-existing fixture block(s): {moved}. Refusing to "
            "write. If an existing digest moves that is a finding about the closed "
            "lane, not a number to regenerate.")

    with open(FIRE_LOG_PATH, "w", encoding="utf-8") as fh:
        json.dump(log, fh, indent=1, allow_nan=False, sort_keys=False)
        fh.write("\n")
    print(f"\nappended {len(names)} fixture(s) to {FIRE_LOG_PATH}")
    print(f"  fires {before_summary['fires']} -> {log['summary']['fires']} "
          f"(+{added_fires})")
    return 0


def cmd_record(args) -> int:
    if args.append:
        return cmd_record_append(args)
    if os.path.exists(FIRE_LOG_PATH) and not args.force:
        raise SystemExit(
            f"{FIRE_LOG_PATH} already exists. --record is ONE-SHOT: re-recording "
            "after a change re-records whatever the code now does and converts a "
            "real regression into a green build. Pass --force only if you are "
            "deliberately re-establishing the oracle on an UNMODIFIED tree."
        )
    ks = list(RECORD_KS)
    print(f"=== RECORD (ks={ks}, window={PROD_BAR_WINDOW}) ===")
    run = _run_all(ks)

    # value_repr keeps the recorded number EXACT: a float rendered by json is
    # shortest-roundtrip, but `repr` is what `fire_key` hashes, so the stored form
    # and the compared form are the same string by construction.
    payload_fixtures: dict[str, Any] = {}
    total_fires = 0
    total_slots = 0
    per_address: dict[str, int] = {}
    for name, fx in run["fixtures"].items():
        # ⭐ THE SAME `_fire_blocks` `--record --append` USES. One definition of
        # what a block IS, so an appended fixture cannot be recorded in a shape the
        # frozen ones were not, and `test_fire_blocks_reproduces_a_committed_block`
        # drives it against the committed wick block to prove it.
        blocks, fires_n, slots_n, addrs = _fire_blocks(fx, name)
        for addr, n in addrs.items():
            per_address[addr] = per_address.get(addr, 0) + n
        total_fires += fires_n
        total_slots += slots_n
        payload_fixtures[name] = {
            "bar_count": len(fx["bars"]),
            "alert_count": len(fx["alerts"]),
            "ladders": fx["ladders"],
            "alert_keys": [a["alert_key"] for a in fx["alerts"]],
            "fires": blocks,
        }

    from api.services import indicator_alert_evaluator as ev
    for address in ev.INDICATOR_FUNCS:
        per_address.setdefault(address, 0)

    # ⭐ THE RECORDER ASSERTS ITS OWN NON-VACUITY BEFORE WRITING.
    assert total_fires, "no alert fired — the grid cannot detect a change in firing"
    assert total_fires < total_slots, "every combination fired — the grid is saturated"
    assert per_address and all(per_address.values()), (
        "an address produced ZERO fires across the whole replay: "
        f"{[a for a, n in per_address.items() if not n]} — widen its "
        "threshold ladder, or the log pins nothing about it"
    )

    payload = {
        "note": (
            "THE FROZEN FIRE LOG. Recorded from api/services/indicator_alert_evaluator "
            "as it stood BEFORE any Phase C behaviour change, walking the committed "
            "REAL bar fixtures in tests/fixtures/alerts/replay_bars.json bar by bar, "
            "through the same 200-bar window _fetch_bars_for_alert hands the live "
            "cycle. Every fire is (alert_key, bar_index, bar_time, value, "
            "triggered); bar_time is a pure function of bar_index over a FROZEN "
            "series and triggered is True by definition of 'a fire', so the stored "
            "row is (bar_index, sample, repr(value)) and the compared key is the "
            "full five-tuple fire_key() builds. `value` is IN the key deliberately: "
            "a changed NUMBER must not be able to read as no change, which is why "
            "it is inside the hashed text too. `digest` is sha256 over the whole "
            "ordered sequence; `per_alert` localises a failure to one alert; "
            "wick_that_unwinds carries its rows VERBATIM. THE GATE IS "
            "`python tools/alert_replay.py --check` AND ITS EXIT CODE. "
            "⚠️ 691,195 fires is not a grid that is too wide — THIS EVALUATOR HAS "
            "NO FIRE-ONCE. record_trigger leaves active=1, so an `above` condition "
            "re-delivers bell+email+Discord every 60-second cycle for as long as it "
            "holds. The log records that faithfully rather than deduping it away."
        ),
        "recorded_at_head": _git_head(),
        "prod_bar_window": PROD_BAR_WINDOW,
        "ks": ks,
        "address_count": len(ev.INDICATOR_FUNCS),
        "fixtures": payload_fixtures,
        "summary": {
            "fires": total_fires,
            "slots": total_slots,
            "grid_alerts": run["grid_alerts"],
            "per_address_fires": dict(sorted(per_address.items())),
        },
    }
    os.makedirs(FIXTURE_DIR, exist_ok=True)
    with open(FIRE_LOG_PATH, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1, allow_nan=False, sort_keys=False)
        fh.write("\n")
    print(f"\nwrote {FIRE_LOG_PATH}")
    print(f"  fires={total_fires}  alerts={run['grid_alerts']}  "
          f"addresses={len(per_address)}  ks={ks}")
    return 0


def expected_fires(log: dict, name: str, k: int) -> list[tuple]:
    """The committed VERBATIM rows for one fixture at one k, as full fire_keys.

    Only `wick_that_unwinds` stores rows; every other fixture is compared by
    digest (see the block above `_rows_text`). Raises rather than returning an
    empty list, because an empty expectation compared against an empty replay is
    the vacuous green this whole harness exists to refuse.
    """
    block = log["fixtures"][name]["fires"][str(k)]
    if "rows" not in block:
        raise KeyError(
            f"{name} is digest-only in the fire log — compare it with "
            "`python tools/alert_replay.py --check`, not row by row")
    bars = load_fixture(name)["bars"]
    order = {key: i for i, key in enumerate(log["fixtures"][name]["alert_keys"])}
    flat = []
    for alert_key, entries in block["rows"].items():
        for bar_index, sample, value_repr in entries:
            flat.append((bar_index, sample, order.get(alert_key, 1 << 30),
                         alert_key, value_repr))
    # `replay` emits bar-major, then SAMPLE within the bar, then grid order within
    # the sample. Reproduce that exactly so the comparison is a SEQUENCE equality
    # and not a set one — a reordering is a real behaviour change.
    flat.sort(key=lambda r: (r[0], r[1], r[2]))
    return [(alert_key, bar_index, bars[bar_index]["t"], value_repr, True)
            for bar_index, _s, _ord, alert_key, value_repr in flat]


def corpus_coverage(log: dict) -> tuple[list[str], list[str]]:
    """`(in the corpus but NOT in the fire log, in the fire log but NOT the corpus)`.

    🔴 A CORPUS THAT CAN QUIETLY NOT RUN IS WORSE THAN NO CORPUS. `--check` walks
    the FIRE LOG's fixture list, so a series added to `replay_bars.json` and never
    recorded is not checked, is not missed, and is not reported — the file sits in
    the tree looking like coverage while the gate never touches it. That is
    [[lesson_gate_that_cannot_fail]] with the evidence present rather than absent,
    and it is the failure mode a growing corpus invites.

    So the two sets are compared BOTH WAYS and the answer is a property of the two
    ARTIFACTS, not of whichever subset a particular run selected — which is why it
    is computed here rather than inside the `--only` branch, and why `--only`
    cannot suppress it.
    """
    corpus = list(fixture_names())
    logged = list(log["fixtures"])
    return ([n for n in corpus if n not in logged],
            [n for n in logged if n not in corpus])


def cmd_check(args) -> int:
    with open(FIRE_LOG_PATH, encoding="utf-8") as fh:
        log = json.load(fh)
    unrecorded, orphaned = corpus_coverage(log)
    if unrecorded or orphaned:
        print("=== THE CORPUS AND THE FIRE LOG DISAGREE ABOUT WHAT EXISTS ===")
        for name in unrecorded:
            print(f"  RED  {name!r} is a frozen fixture in {os.path.basename(BARS_PATH)} "
                  "with NO block in the fire log — it would be SILENTLY SKIPPED by "
                  "every --check. Record it with "
                  f"`--record --append --only {name}`.")
        for name in orphaned:
            print(f"  RED  {name!r} has a fire-log block but is not in the frozen "
                  "corpus — its digests are measured against bars that are no "
                  "longer there.")
        print(f"\n{len(unrecorded) + len(orphaned)} FIXTURE(S) OUT OF SYNC")
        return 1
    ks = log["ks"]
    names = args.only or list(log["fixtures"])
    print(f"=== CHECK (ks={ks}, window={log['prod_bar_window']}) ===")
    if log["prod_bar_window"] != PROD_BAR_WINDOW:
        raise SystemExit("the recorded bar window is not the harness's — the two "
                         "measure different evaluators")
    if log["address_count"] != len(__import__(
            "api.services.indicator_alert_evaluator",
            fromlist=["x"]).INDICATOR_FUNCS):
        print("  !! the catalog grew or shrank since the log was recorded — the "
              "grid below is NOT the grid that was frozen")
    run = _run_all(ks, only=names)
    bad = 0
    for name in names:
        for k in ks:
            fires = run["fixtures"][name]["fires"][k]
            block = log["fixtures"][name]["fires"][str(k)]
            got_digest = _digest("\n".join(repr(fire_key(f)) for f in fires))
            if len(fires) == block["count"] and got_digest == block["digest"]:
                print(f"  OK   {name:20} k={k}  {len(fires)} fires  "
                      f"{got_digest[:16]}…")
                # …and where rows exist, the sequence itself, not just its hash.
                if "rows" in block:
                    assert [fire_key(f) for f in fires] == expected_fires(log, name, k)
                continue
            bad += 1
            print(f"  RED  {name:20} k={k}  got {len(fires)} fires "
                  f"(recorded {block['count']})")
            grouped: dict[str, list] = {}
            for f in fires:
                grouped.setdefault(f["alert_key"], []).append(
                    [f["bar_index"], f["sample"], repr(f["value"])])
            moved = []
            for key in log["fixtures"][name]["alert_keys"]:
                rows = grouped.get(key, [])
                want = block["per_alert"].get(key, [0, _digest("")])
                if [len(rows), _digest(_rows_text(rows))] != want:
                    moved.append((key, want[0], len(rows)))
            print(f"        {len(moved)} alert(s) moved; first 8:")
            for key, was, now in moved[:8]:
                print(f"        {key}   recorded {was} fires, now {now}")
    print(f"\n{'FIRE LOG MATCHES' if not bad else f'{bad} (fixture,k) PAIRS DIVERGED'}")
    return 1 if bad else 0


def cmd_repaint(args) -> int:
    ks = args.k or list(REPAINT_KS)
    mode = args.mode or "forming"
    if mode not in EVALUATE_FACTORIES:
        raise SystemExit(f"--mode must be one of {sorted(EVALUATE_FACTORIES)}, "
                         f"got {mode!r}")
    print(f"=== REPAINT ORACLE (mode={mode}, ks={ks}, window={PROD_BAR_WINDOW}) ===")

    # ⭐ THE GRID IS BUILT FROM THE FORMING LANE IN BOTH MODES, ON PURPOSE. The
    # threshold ladder is three quantiles of the address's own closed-bar series,
    # so building it per-mode would hand the two modes DIFFERENT alerts and the
    # two numbers would not be comparable — the closed lane could read zero
    # because it was measured on an easier grid. Same bars, same grid, same k
    # ladder; only the evaluator changes. That is exactly what Task 2's own
    # control did.
    grid_evaluate = make_forming_evaluate()
    evaluate = grid_evaluate if mode == "forming" else EVALUATE_FACTORIES[mode]()
    names = args.only or fixture_names()
    totals = {"keyed": 0, "identity": 0, "fires": 0}
    per_fixture = {}
    for name in names:
        fx = load_fixture(name)
        bars = fx["bars"]
        alerts, _ = build_alert_grid(name, bars, fx.get("tf", "?"), grid_evaluate)
        print(f"  {name:20} ({len(bars)} bars x {len(alerts)} alerts) …", flush=True)
        res = repaint_disagreement(bars, alerts, ks, evaluate)
        res.pop("_per_k")
        per_fixture[name] = res
        totals["keyed"] += res["keyed_disagreement"]
        totals["identity"] += res["identity_disagreement"]
        totals["fires"] += sum(res["fires_per_k"].values())
        print(f"      fires/k={res['fires_per_k']}")
        print(f"      keyed diff vs k=1: {res['keyed_diff_vs_k1']}")
        print(f"      identity diff vs k=1: {res['identity_diff_vs_k1']}")

    print("\n=== THE NUMBER ===")
    print(f"  mode                  : {mode}")
    print(f"  total fires (all k)   : {totals['fires']}")
    print(f"  keyed disagreement    : {totals['keyed']}")
    print(f"  identity disagreement : {totals['identity']}")

    # 🔴 THE VACUITY REFUSAL — AND IT POINTS THE OPPOSITE WAY IN EACH MODE,
    # BECAUSE THE VACUOUS ANSWER IS A DIFFERENT NUMBER IN EACH.
    #
    #   forming: a ZERO is vacuous. Today's lane MUST disagree across k, so a
    #            zero means the harness is not driving the forming bar at all.
    #   closed : a zero is the RESULT — but a lane that never fires reads zero
    #            too, and that is the same gate-that-cannot-fail wearing the
    #            other hat. So the closed mode refuses on NO FIRES, and it
    #            refuses on a NON-zero disagreement.
    if mode == "forming":
        if not totals["keyed"] or not totals["identity"]:
            print(json.dumps(per_fixture, indent=1, default=str))
            raise SystemExit(
                "REPAINT DISAGREEMENT IS ZERO ON TODAY'S TREE — ABORTING AS VACUOUS.\n"
                "Today's evaluator scores the FORMING bar with cycle-granularity "
                "crossings (`last_value` from the prior 60-second poll, not the prior "
                "bar), so it MUST disagree across k. A zero here means this harness is "
                "not driving the forming bar at all, and every 'no repaints' this tool "
                "reports afterwards would be a gate that cannot fail. Fix the ORACLE, "
                "not the number."
            )
    else:
        if not totals["fires"]:
            raise SystemExit(
                "THE CLOSED LANE FIRED NOTHING — ABORTING AS VACUOUS.\n"
                "A lane that never fires reports 0 repaints, so the fire count is "
                "part of the measurement, not a footnote beside it."
            )
        if totals["keyed"] or totals["identity"]:
            print(json.dumps(per_fixture, indent=1, default=str))
            raise SystemExit(
                f"THE CLOSED LANE REPAINTS: keyed={totals['keyed']} "
                f"identity={totals['identity']}.\n"
                "Its fire set depends on WHEN YOU LOOKED, which is the defect this "
                "phase exists to remove. Something in the lane is still reading the "
                "forming bar — the threshold operand and the bar index are the two "
                "places it hides."
            )
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump({"mode": mode, "ks": ks, "totals": totals,
                       "per_fixture": per_fixture}, fh, indent=1, default=str)
            fh.write("\n")
        print(f"  wrote {args.out}")
    return 0


# ─── Task 6: THE DECLARED DIFF — WHAT CHANGES FOR AN ARMED ALERT ─────────────
#
# ⭐ THE REPAINT ORACLE SAYS THE CLOSED LANE IS INTERNALLY CONSISTENT. IT SAYS
# NOTHING ABOUT WHAT A USER'S INBOX RECEIVES. Task 5 measured 0 keyed / 0 identity
# disagreement at every k while the closed lane fired 2,012,025 times — that is
# "the answer does not depend on when you looked", which is the property the phase
# exists to buy. It is NOT "the answer is the same as yesterday's", and it must not
# be: the whole point is that a wick fire STOPS happening.
#
# So this measures the OTHER thing: the symmetric difference between the two
# lanes' fire sets, grouped by ADDRESS and DIRECTION, so every change that reaches
# a real inbox on cutover day is declared with a reason instead of discovered.
#
# ⛔ AND IT IS MEASURED WITH THE VALUE IN THE KEY (`fire_key`), for the same
# reason the fire log is: a fire whose NUMBER moved is a different fact about the
# world, and the single largest shape in this diff — an `above` alert that fired
# on every poll at a slightly different intra-bar value and now fires once per bar
# at the closed value — is invisible to a key without it.

# The granularity both lanes are driven at. k=4 is the FORMING granularity the
# frozen fire log was recorded at (`RECORD_KS`), i.e. an evaluator that looked
# four times inside each bar — which is what a 60-second poll does to a 5-minute
# bar. The closed lane is k-INVARIANT (Task 5: 0/0 at k ∈ {1,2,4,8}), so driving
# BOTH lanes at the same k costs nothing on its side and removes the need for a
# cross-k argument: same bars, same grid, same k, only the evaluator changes.
DIFF_K = 4


def address_of(alert_key: str) -> str:
    """The plot address inside an `alert_key`. Public because the diff groups on it."""
    return _address_of(alert_key)


def build_event_alerts(fixture: str, tf: str) -> list[dict]:
    """The two EVENT addresses, as alerts — the diff's coverage extension.

    ⛔ `build_alert_grid` IS NOT TOUCHED, AND THAT IS DELIBERATE. It generates
    from `INDICATOR_FUNCS`, the frozen fire log was recorded against exactly that
    grid, and Task 3 put the event addresses in a SEPARATE `EVENT_FUNCS` partly
    because growing the first dict would have destroyed the instrument. So the
    28-address grid stays byte-identical for `--record`/`--check`, and the diff —
    which compares two lanes against each other and never against the frozen log —
    adds the two `sar` event addresses on top, so the declared diff covers all
    **30** armable addresses rather than the 28 the fire log pins.

    An event address takes no threshold ladder: its operand is DECLARED
    (`THRESHOLD_OPERAND` → const 0.5), which is exactly why it is offered at all.
    """
    from api.services import indicator_alert_evaluator as ev

    out: list[dict] = []
    for address in ev.EVENT_FUNCS:
        for cond in ev.ALERT_CONDITIONS[address]:
            out.append({
                "id": 0, "user_id": "replay", "sym": fixture, "tf": tf,
                "indicator": address, "condition": cond["value"],
                "threshold": None, "params_json": None, "last_value": None,
                "alert_key": f"{fixture}|{address}|{cond['value']}|None",
            })
    return out


def build_price_alerts(fixture: str, bars: list[dict], tf: str,
                       evaluate: Callable[[dict, list[dict]], tuple]) -> list[dict]:
    """The PRICE partition's addresses, as alerts — the diff's SECOND coverage extension.

    ⛔ `build_alert_grid` IS NOT TOUCHED, FOR THE SAME REASON `build_event_alerts`
    does not touch it. The frozen 691,195-fire log was recorded against a grid
    generated from `INDICATOR_FUNCS`, and Phase C Task 10 put `close` in a THIRD
    partition (`PRICE_FUNCS`) precisely so that making price a LEFT operand could
    not grow that dict and destroy the instrument. So the 28-address grid stays
    byte-identical for `--record`/`--check`, and the diff — which compares two
    lanes against each other and never against the frozen log — adds the price
    addresses on top. That is what takes the declared diff from **30 of 31**
    armable addresses to **31 of 31**.

    ⚠️ AND IT IS NOT A COPY OF `build_event_alerts`, BECAUSE A PRICE ADDRESS IS A
    DIFFERENT KIND OF THING. An event address takes no threshold — its operand is
    DECLARED (`THRESHOLD_OPERAND` → const 0.5), which is exactly why it can be
    offered without one. `close` is a LEVEL: every one of its four conditions sets
    `needs_threshold`, so it takes the same three-quantile ladder derived from its
    OWN closed-bar series that `build_alert_grid` gives every other level address.
    A price address driven at a hand-picked threshold would measure the threshold,
    not the lane.
    """
    from api.services import indicator_alert_evaluator as ev

    out: list[dict] = []
    for address in ev.PRICE_FUNCS:
        ladder = _ladder(closed_bar_values(bars, address, evaluate))
        for cond in ev.ALERT_CONDITIONS[address]:
            thresholds: list = ladder if cond.get("needs_threshold") else [None]
            for thr in thresholds:
                out.append({
                    "id": 0, "user_id": "replay", "sym": fixture, "tf": tf,
                    "indicator": address, "condition": cond["value"],
                    "threshold": thr, "params_json": None, "last_value": None,
                    "alert_key": f"{fixture}|{address}|{cond['value']}|{thr!r}",
                })
    return out


def _lane_sets(bars: list[dict], alerts: list[dict], k: int,
               evaluate: Callable[[dict, list[dict]], tuple]) -> tuple:
    """(fire count, keyed set, identity set) for one lane on one fixture.

    The fire LIST is dropped immediately — a k=4 forming pass over the four
    fixtures is ~550k fire dicts and only the sets are ever compared.
    """
    fires = replay(bars, alerts, k=k, evaluate=evaluate)
    keyed = {fire_key(f) for f in fires}
    ident = {(f["alert_key"], f["bar_index"]) for f in fires}
    return len(fires), keyed, ident


def _classify(lost: set, gained: set) -> tuple[dict, dict]:
    """Give every differing fire a SHAPE, mechanically, not by assumption.

    The brief for this task listed four shapes it expected. A shape that is
    assumed is a shape nobody measured, so each one is DERIVED from the two sets:

      `value_moved`   the same alert fired on the same bar in both lanes, at a
                      different number. This is the `above`/`below` re-delivery
                      shape — the forming lane fires once per poll at the running
                      intra-bar value; the closed lane fires once per bar at the
                      closed value.
      `shifted_later` (lost) the same alert fires one bar LATER in the closed lane
                      / (gained) one bar EARLIER in the forming lane. A crossing
                      the forming lane saw mid-bar lands at that bar's close.
      `vanished`      lost with no closed-lane counterpart on this bar or the next.
      `appeared`      gained with no forming-lane counterpart on this bar or the
                      previous one.
    """
    lost_ident = {(k[0], k[1]) for k in lost}
    gained_ident = {(k[0], k[1]) for k in gained}
    lost_shapes: dict[str, int] = {}
    gained_shapes: dict[str, int] = {}
    # …and the same classification PER ADDRESS, because the reason a declaration
    # carries has to be about THAT address, not about the diff in aggregate.
    by_address: dict[str, dict[str, dict[str, int]]] = {}

    def _bump(address: str, direction: str, shape: str) -> None:
        slot = by_address.setdefault(address, {"lost": {}, "gained": {}})[direction]
        slot[shape] = slot.get(shape, 0) + 1

    for ak, bi, *_rest in lost:
        if (ak, bi) in gained_ident:
            shape = "value_moved"
        elif (ak, bi + 1) in gained_ident:
            shape = "shifted_later"
        else:
            shape = "vanished"
        lost_shapes[shape] = lost_shapes.get(shape, 0) + 1
        _bump(_address_of(ak), "lost", shape)
    for ak, bi, *_rest in gained:
        if (ak, bi) in lost_ident:
            shape = "value_moved"
        elif (ak, bi - 1) in lost_ident:
            shape = "shifted_later"
        else:
            shape = "appeared"
        gained_shapes[shape] = gained_shapes.get(shape, 0) + 1
        _bump(_address_of(ak), "gained", shape)
    return lost_shapes, gained_shapes, by_address


def lane_diff(names: Optional[list[str]] = None, k: int = DIFF_K,
              progress: bool = True) -> dict:
    """What the closed lane CHANGES about an armed alert, per address.

    Both lanes on the same bars, the same grid and the same k. Returns the
    per-(address, direction) counts a declaration has to cover, the shape
    breakdown behind them, and the per-lane fire totals that make a zero
    impossible to read as good news.
    """
    from api.services import indicator_alert_evaluator as ev

    names = list(names) if names else fixture_names()
    grid_evaluate = make_forming_evaluate()          # also THE forming lane
    closed_evaluate = make_closed_evaluate()

    per_address: dict[str, dict[str, int]] = {}
    per_condition: dict[str, dict[str, int]] = {}
    shapes: dict[str, dict[str, int]] = {"lost": {}, "gained": {}}
    shapes_by_address: dict[str, dict[str, dict[str, int]]] = {}
    examples: dict[str, list] = {"lost": [], "gained": []}
    totals = {"forming_fires": 0, "closed_fires": 0,
              "forming_keys": 0, "closed_keys": 0,
              "gained": 0, "lost": 0,
              "identity_gained": 0, "identity_lost": 0}
    per_fixture: dict[str, dict] = {}
    addresses: set[str] = set()

    for name in names:
        fx = load_fixture(name)
        bars = fx["bars"]
        tf = fx.get("tf", "?")
        alerts, _ = build_alert_grid(name, bars, tf, grid_evaluate)
        alerts = (alerts + build_event_alerts(name, tf)
                  + build_price_alerts(name, bars, tf, grid_evaluate))
        addresses |= {address_of(a["alert_key"]) for a in alerts}
        if progress:
            print(f"  {name:20} ({len(bars)} bars x {len(alerts)} alerts) k={k} …",
                  flush=True)

        f_n, f_keys, f_ident = _lane_sets(bars, alerts, k, grid_evaluate)
        c_n, c_keys, c_ident = _lane_sets(bars, alerts, k, closed_evaluate)

        gained = c_keys - f_keys
        lost = f_keys - c_keys
        l_shapes, g_shapes, a_shapes = _classify(lost, gained)
        for src, dst in ((l_shapes, shapes["lost"]), (g_shapes, shapes["gained"])):
            for kk, vv in src.items():
                dst[kk] = dst.get(kk, 0) + vv
        for addr, dirs in a_shapes.items():
            slot = shapes_by_address.setdefault(addr, {"lost": {}, "gained": {}})
            for direction, counts in dirs.items():
                for kk, vv in counts.items():
                    slot[direction][kk] = slot[direction].get(kk, 0) + vv

        for key_set, direction in ((gained, "gained"), (lost, "lost")):
            for fk in key_set:
                addr = address_of(fk[0])
                per_address.setdefault(addr, {"gained": 0, "lost": 0})
                per_address[addr][direction] += 1
                ckey = f"{addr}|{fk[0].split('|')[2]}"
                per_condition.setdefault(ckey, {"gained": 0, "lost": 0})
                per_condition[ckey][direction] += 1
        for direction, key_set in (("gained", gained), ("lost", lost)):
            for fk in sorted(key_set)[:3]:
                if len(examples[direction]) < 24:
                    examples[direction].append(list(fk))

        totals["forming_fires"] += f_n
        totals["closed_fires"] += c_n
        totals["forming_keys"] += len(f_keys)
        totals["closed_keys"] += len(c_keys)
        totals["gained"] += len(gained)
        totals["lost"] += len(lost)
        totals["identity_gained"] += len(c_ident - f_ident)
        totals["identity_lost"] += len(f_ident - c_ident)
        per_fixture[name] = {
            "bars": len(bars), "alerts": len(alerts),
            "forming_fires": f_n, "closed_fires": c_n,
            "forming_keys": len(f_keys), "closed_keys": len(c_keys),
            "gained": len(gained), "lost": len(lost),
            "identity_gained": len(c_ident - f_ident),
            "identity_lost": len(f_ident - c_ident),
        }
        if progress:
            print(f"      forming {f_n} fires / {len(f_keys)} keys · "
                  f"closed {c_n} fires / {len(c_keys)} keys · "
                  f"gained {len(gained)} · lost {len(lost)}", flush=True)

    rows = []
    for addr in sorted(per_address):
        for direction in ("gained", "lost"):
            n = per_address[addr][direction]
            if n:
                rows.append({"address": addr, "direction": direction, "count": n})

    catalog = (list(ev.INDICATOR_FUNCS) + list(ev.EVENT_FUNCS)
               + list(ev.PRICE_FUNCS))
    return {
        "k": k,
        "fixtures": names,
        # ⛔ THE SET, NOT ONLY ITS SIZE — AND A MUTATION IS WHY. Phase C Task 15's
        # M2 (delete `build_price_alerts` from the assembly above) SURVIVED,
        # because the only test asserting "the diff drives every armable address"
        # was reading the evaluator's PARTITIONS and calling them the instrument.
        # A count cannot say WHICH, and a caller that re-assembles these three
        # lists to find out is reimplementing the thing it is checking. So the
        # instrument publishes what it drove.
        "addresses": sorted(addresses),
        "addresses_covered": len(addresses),
        "addresses_in_catalog": len(catalog),
        "addresses_that_change": len(per_address),
        "totals": totals,
        "rows": rows,
        "per_address": {a: per_address[a] for a in sorted(per_address)},
        "per_condition": {c: per_condition[c] for c in sorted(per_condition)},
        "shapes": shapes,
        "shapes_by_address": {a: shapes_by_address[a] for a in sorted(shapes_by_address)},
        "per_fixture": per_fixture,
        "examples": examples,
    }


def diff_scope(declared: Optional[dict], only: Optional[list[str]],
               corpus: Optional[list[str]] = None) -> tuple[list[str], list[str]]:
    """`(fixtures to drive, corpus fixtures the declaration does not bound)`.

    Split out of `cmd_diff` so the decision can be tested without a fifteen-minute
    replay behind it — a scoping rule only exercised by the slow path is a scoping
    rule nobody re-checks.

    `--only` wins. Otherwise the scope is the declaration's OWN
    `measured.fixtures`, because every row's `count` is a bound observed over
    exactly those series and driving more tape through the same bounds
    over-budgets rows for a reason that has nothing to do with the lane. With no
    declaration at all the scope is the whole corpus, which is the state the
    "everything is undeclared" branch already reports.
    """
    corpus = list(corpus if corpus is not None else fixture_names())
    scope = list((declared or {}).get("measured", {}).get("fixtures") or [])
    driven = list(only) if only else (scope or corpus)
    return driven, [n for n in corpus if n not in driven]


def cmd_diff(args) -> int:
    mode_a = args.mode_a or "forming"
    mode_b = args.mode_b or "closed"
    if (mode_a, mode_b) != ("forming", "closed"):
        raise SystemExit(
            f"--diff measures forming → closed, got {mode_a!r} → {mode_b!r}. "
            "The declaration's DIRECTION words ('gained' = the closed lane fires "
            "where the forming lane did not, 'lost' = the reverse) are anchored to "
            "that orientation; swapping it would silently invert every reason."
        )
    k = args.k[0] if args.k else DIFF_K

    # ⛔ THE DECLARATION IS A BUDGET MEASURED ON A NAMED SET OF FIXTURES, SO THE
    # GATE HAS TO BE RUN ON THAT SET. `fire_diff_declared.json` records
    # `measured.fixtures`, and every row's `count` is a bound observed over
    # exactly those series. Driving a LARGER corpus through the same bounds
    # over-budgets every row — not because the lane changed, but because there is
    # more tape — and a gate that goes red for a reason that has nothing to do
    # with the behaviour it guards is a gate people learn to ignore.
    #
    # ⛔ AND THE FIXTURES OUTSIDE THAT SET ARE NAMED, LOUDLY, EVERY RUN. Scoping
    # silently would be the same defect one layer down: the declaration would look
    # like it covered the corpus. So the tool says which series it drove, which it
    # did not, and how to measure them.
    from api.services import alert_shadow_log as shadow
    declared: Optional[dict] = None
    try:
        declared = shadow.declared_diff()
    except FileNotFoundError:
        declared = None
    names, outside = diff_scope(declared, args.only)

    print(f"=== LANE DIFF ({mode_a} → {mode_b}, k={k}, window={PROD_BAR_WINDOW}) ===")
    print(f"  fixtures driven        : {names}")
    if outside:
        print(f"  NOT BOUNDED BY THE DECLARATION : {outside}")
        print("    ^ these are frozen fixtures the declaration's counts were NOT "
              "measured over, so its per-address budgets say nothing about them. "
              "Measure one with `--diff --only <name>` and read the result as a "
              "CENSUS: an (address, direction) group it produces that the "
              "declaration has never heard of is a FINDING about the closed lane "
              "on new tape, and belongs in a report before it belongs in a row.")
    res = lane_diff(names, k=k)

    t = res["totals"]
    print("\n=== THE DIFF ===")
    print(f"  addresses covered      : {res['addresses_covered']} "
          f"of {res['addresses_in_catalog']} in the catalog")
    print(f"  addresses that change  : {res['addresses_that_change']}")
    print(f"  forming fires / keys   : {t['forming_fires']} / {t['forming_keys']}")
    print(f"  closed  fires / keys   : {t['closed_fires']} / {t['closed_keys']}")
    print(f"  GAINED (closed only)   : {t['gained']}   identity {t['identity_gained']}")
    print(f"  LOST   (forming only)  : {t['lost']}   identity {t['identity_lost']}")
    print(f"  shapes lost            : {res['shapes']['lost']}")
    print(f"  shapes gained          : {res['shapes']['gained']}")

    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(res, fh, indent=1, default=str)
            fh.write("\n")
        print(f"\n  wrote {args.out}")

    # 🔴 THE VACUITY REFUSAL. A diff of nothing is exactly what a broken harness
    # produces, and "nothing changes" is the one answer this measurement may never
    # report without proving it could have seen a change.
    if not t["forming_fires"] or not t["closed_fires"]:
        raise SystemExit(
            "A LANE FIRED NOTHING — ABORTING AS VACUOUS. A diff between a lane and "
            "silence is not a diff."
        )
    if not t["lost"] or not t["gained"]:
        raise SystemExit(
            f"THE DIFF IS ONE-SIDED (gained={t['gained']} lost={t['lost']}) — "
            "ABORTING AS VACUOUS. The cutover both stops fires and starts them; a "
            "measurement that can only see one direction cannot see the one a user "
            "cannot report — a MISSING alert."
        )

    # …and then the declaration, which is the gate.
    if declared is None:
        print(f"\n  !! no declaration at {shadow.DECLARED_DIFF_PATH} — every one of "
              f"the {len(res['rows'])} (address, direction) groups above is "
              f"UNDECLARED.")
        return 1
    report = shadow.diff_report(res, declared)
    print("\n=== THE DECLARATION ===")
    print(f"  declared rows          : {len(declared.get('rows', []))}")
    print(f"  undeclared groups      : {len(report['undeclared'])}")
    print(f"  over-budget groups     : {len(report['over_budget'])}")
    print(f"  declared-but-unmet     : {len(report['unmet'])}  (REPORTED, never failed)")
    for row in report["unmet"]:
        print(f"      unmet: {row['address']} {row['direction']} "
              f"declared {row['declared']}, observed {row['observed']}")
    bad = report["undeclared"] + report["over_budget"] + shadow.validate_declaration(declared)
    for problem in bad:
        print(f"  RED  {problem}")
    print(f"\n{'EVERY DIFFERENCE IS DECLARED' if not bad else f'{len(bad)} UNDECLARED / OVER-BUDGET'}")
    return 1 if bad else 0


def cmd_freeze_bars(args) -> int:
    if os.path.exists(BARS_PATH) and not args.force:
        raise SystemExit(f"{BARS_PATH} already exists — --freeze-bars is ONE-SHOT.")
    from api.services import bars_sqlite

    def _from_store(sym: str, tf: str, count: int) -> list[dict]:
        rows = bars_sqlite.get_bars(sym.upper(), tf, count)
        if len(rows) < count:
            raise SystemExit(f"{sym}/{tf}: store has {len(rows)} of {count} bars")
        return [{"t": r[0], "o": float(r[1]), "h": float(r[2]), "l": float(r[3]),
                 "c": float(r[4]), "v": int(r[5] or 0)} for r in rows]

    parity_rel = "app/src/pages/parityBars/intraday5m.json"
    with open(os.path.join(ROOT, parity_rel.replace("/", os.sep)), encoding="utf-8") as fh:
        parity_bars = json.load(fh)["bars"]

    spy = _from_store("SPY", "D", 400)
    nvda = _from_store("NVDA", "5", 800)
    wick = build_wick_that_unwinds()

    # The wick fixture's whole claim, asserted at build time.
    from api.services import indicator_compute as ic

    def _rsi_last(cs):
        for v in reversed(ic.compute_rsi(cs, 14)):
            if v is not None:
                return v
        return None

    closes = [b["c"] for b in wick]
    closed = [_rsi_last(closes[:i + 1]) for i in range(len(wick))]
    assert max(v for v in closed if v is not None) < 70.0, (
        "wick_that_unwinds: a CLOSE takes RSI above 70 — it is not a wick and "
        "proves nothing")
    b = wick[WICK_INDEX]
    assert b["h"] - b["c"] > 2.0 and b["c"] > b["o"], "wick bar lost its wick"
    assert _rsi_last(closes[:WICK_INDEX] + [0.75 * b["h"] + 0.25 * b["c"]]) > 70.0, (
        "wick_that_unwinds: the k=4 intra-bar sample does NOT take RSI above 70")

    doc = {
        "note": (
            "Frozen bar series for tools/alert_replay.py. `intraday5m` is a "
            "REFERENCE, not a copy — load_fixture() reads "
            "app/src/pages/parityBars/intraday5m.json and re-checks the sha256, so "
            "the compute oracle, the pixel gate and the alert replay are provably "
            "ONE series rather than three copies that agreed once. The other three "
            "are inline and digest-pinned the same way. DO NOT REGENERATE: every "
            "row of fire_log_forming.json is measured against these exact bars."
        ),
        "frozen_at_head": _git_head(),
        "order": ["intraday5m", "spy_daily", "nvda_5m_extended", "wick_that_unwinds"],
        "fixtures": {
            "intraday5m": {
                "tf": "5",
                "barsFrom": parity_rel,
                "bar_count": len(parity_bars),
                "sha256": _bars_digest(parity_bars),
                "why": (
                    "THE SAME 579 bars tools/chart_parity.py renders through "
                    "?fixedbars= and the same series the golden VWAP fixture "
                    "computes against. Three extended-hours sessions spanning a "
                    "weekend gap AND the end of US DST, with 20:00 ET == 00:00 UTC "
                    "on the EDT session — spec §9.1's two mandatory session traps, "
                    "which is why the alert lane reads it too."
                ),
            },
            "spy_daily": {
                "tf": "D",
                "source": "bars_sqlite.get_bars('SPY', 'D', 400)",
                "bar_count": len(spy),
                "sha256": _bars_digest(spy),
                "why": ("real daily bars, real gaps, real holidays — a synthetic "
                        "ramp cannot produce a session gap. `t` is a YYYYMMDD int, "
                        "which is exactly what the live evaluator is handed."),
                "bars": spy,
            },
            "nvda_5m_extended": {
                "tf": "5",
                "source": "bars_sqlite.get_bars('NVDA', '5', 800)",
                "bar_count": len(nvda),
                "sha256": _bars_digest(nvda),
                "why": (
                    "real extended-hours 5-minute tape (04:00-19:55 ET), real "
                    "overnight gaps, real zero-volume pre-market prints. ⚠️ MEASURED "
                    "LIMIT: the retained window is 2026-04-16 … 2026-08-05, which "
                    "is entirely inside EDT and stops five minutes short of 20:00 "
                    "ET — so this series carries NEITHER a DST transition NOR a "
                    "UTC-midnight crossing. `intraday5m` carries both; that is not "
                    "an accident of ordering, it is why the reference fixture is in "
                    "this document at all."
                ),
                "bars": nvda,
            },
            "wick_that_unwinds": {
                "tf": "5",
                "source": "tools/alert_replay.py::build_wick_that_unwinds",
                "bar_count": len(wick),
                "wick_index": WICK_INDEX,
                "sha256": _bars_digest(wick),
                "why": ("hand-built: RSI(14) parks at 67, one bar's HIGH takes it "
                        "to 77 intra-bar and its CLOSE leaves it at 68.84, then "
                        "flat. The whole reason Phase C exists, as a number."),
                "bars": wick,
            },
        },
    }
    os.makedirs(FIXTURE_DIR, exist_ok=True)
    with open(BARS_PATH, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=1, allow_nan=False)
        fh.write("\n")
    print(f"wrote {BARS_PATH}")
    for name in doc["order"]:
        e = doc["fixtures"][name]
        print(f"  {name:20} {e['bar_count']:>4} bars  {e['sha256'][:16]}…")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    # ⚠️ cp1252 KILLS A HARNESS'S OWN STDOUT. On this box `sys.stdout` is cp1252,
    # `…` happens to map (0x85) and `⛔` does not — so every print here worked and
    # `--help`, which echoes this module's docstring, died with UnicodeEncodeError
    # and exit 1. A tool that cannot print its own usage is a tool nobody can use.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:                                    # noqa: BLE001
            pass

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--freeze-bars", action="store_true")
    ap.add_argument("--record", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--repaint", action="store_true")
    # ⭐ `--diff` IS THE TASK-6 MEASUREMENT AND IT IS A DIFFERENT QUESTION FROM
    # `--repaint`. The repaint oracle asks "does this lane agree with ITSELF across
    # granularities" (Task 5 drove it to 0/0). This asks "does the new lane agree
    # with the OLD one, and where it does not, is every difference DECLARED".
    ap.add_argument("--diff", action="store_true")
    ap.add_argument("--mode-a", dest="mode_a", choices=("forming", "closed"), default=None)
    ap.add_argument("--mode-b", dest="mode_b", choices=("forming", "closed"), default=None)
    ap.add_argument("--k", nargs="*", type=int)
    # ⚠️ `--mode` APPLIES TO `--repaint` ONLY. `--check` is the FORMING log's
    # gate by definition: `fire_log_forming.json` was recorded from the forming
    # lane on the unmodified tree, and a `--check --mode closed` would compare
    # the new lane against the old lane's frozen answers and report the intended
    # change as a failure. There is no closed fire log and there must not be one
    # until the cutover.
    ap.add_argument("--mode", choices=("forming", "closed"), default=None,
                    help="which evaluation lane --repaint measures")
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--out")
    ap.add_argument("--force", action="store_true")
    # ⭐ `--record --append --only <new fixture>` IS THE ONLY WAY THE LOG GROWS.
    # `--force` re-records everything and is the trap this file opens with;
    # `--append` replays ONLY what it is named, refuses a fixture it has already
    # seen, and proves every pre-existing block is byte-identical before it writes.
    ap.add_argument("--append", action="store_true",
                    help="with --record: ADD blocks for --only fixtures, "
                         "leaving every existing digest byte-identical")
    args = ap.parse_args(argv)

    if args.freeze_bars:
        return cmd_freeze_bars(args)
    if args.record:
        return cmd_record(args)
    if args.check:
        return cmd_check(args)
    if args.repaint:
        return cmd_repaint(args)
    if args.diff:
        return cmd_diff(args)
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
