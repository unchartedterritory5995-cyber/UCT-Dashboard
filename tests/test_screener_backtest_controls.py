"""The controls spec §5.9 adds to the screen backtest, each with a CONTROL.

⭐ THE RULES ARE IMPORTED FROM `candle_backtest`, NEVER RESTATED. That module
measured them on 18.8M bars (`docs/superpowers/research/candles/11-MEASURED-EDGE
-2026-08-25.md`): clip at ±50% (a huge mean beside a tiny t is an outlier
report), and match the base rate on the bar's OWN same-day move in lagged-ATR
units (without it the whole finding was short-term mean reversion). A second
spelling of either rule here would drift from the first the day it moved.

⛔ NO CLOCK AND NO RNG IN ANY FIXTURE — the engine's determinism test in
``tests/test_screener_backtest.py`` is only meaningful if inputs are literal.
"""
from __future__ import annotations

import ast
import inspect
import re
from pathlib import Path

import pytest

from api.services.screener import backtest as bt
from api.services.screener import candle_backtest as cb


# ─── builders (copied from tests/test_screener_backtest.py, no clock, no RNG) ──

def NUM(v):
    return {"type": "num", "value": v}


def SER(n):
    return {"type": "series", "name": n}


def OP(n, *a):
    return {"type": "op", "name": n, "args": list(a)}


def CALL(n, *a):
    return {"type": "call", "name": n, "args": list(a)}


BAR_TREE = OP(">", SER("close"), CALL("sma", SER("close"), NUM(3)))
ALWAYS = OP(">", SER("close"), NUM(0))


def day(i: int) -> str:
    m, d = divmod(i, 28)
    return f"2024-{m + 1:02d}-{d + 1:02d}"


def bars(closes, opens=None, start=0):
    out = []
    for i, c in enumerate(closes):
        o = c if opens is None else opens[i]
        out.append({"t": day(start + i), "o": float(o), "h": float(max(o, c)) + 1,
                    "l": float(min(o, c)) - 1, "c": float(c), "v": 1000.0})
    return out


def reader(mapping):
    return lambda sym: mapping.get(sym)


def rising(n=80, base=10.0, step=1.0, start=0):
    return bars([base + step * i for i in range(n)], start=start)


# ─── 1 · winsorised means ────────────────────────────────────────────────────

def test_the_winsorised_mean_clips_an_outlier_the_raw_mean_keeps():
    s = bt._stats([1.0, 2.0, 300.0], withheld=False)
    assert s.avg_pct == pytest.approx(101.0)
    assert s.avg_pct_winsorised == pytest.approx((1.0 + 2.0 + cb.WINSOR_PCT) / 3)
    # CONTROL: no outlier -> the two means are one number, so the difference
    # above is the clip and not a second averaging rule.
    c = bt._stats([1.0, 2.0, 3.0], withheld=False)
    assert c.avg_pct_winsorised == pytest.approx(c.avg_pct)


def test_a_withheld_arm_withholds_the_winsorised_mean_too():
    """Rule 5 reaches the new field: below the floor the rate is `None`, never 0."""
    assert bt._stats([1.0, 2.0], withheld=True).avg_pct_winsorised is None


def test_the_clip_is_the_candle_modules_own_rule_not_a_second_one():
    assert bt.winsorise is cb._clip
    assert bt.WINSOR_PCT is cb.WINSOR_PCT


def test_the_receipt_carries_the_winsorised_mean_on_BOTH_arms_and_names_the_rule():
    """⭐ BOTH ARMS. `candle_backtest`: 'the universe base rate is clipped by the
    SAME rule in the SAME pass, so the excess is a difference between two
    like-treated populations'. A clipped strategy beside a raw baseline is not."""
    b = {"AAA": rising(), "BBB": bars([50 - i * 0.4 for i in range(80)])}
    r = bt.run_backtest(BAR_TREE, ["AAA", "BBB"], day(0), day(79),
                        bars_for=reader(b), min_signals=1, horizons=(5,))
    d = r.to_dict()
    assert d["method"]["winsorised"] is True
    assert d["method"]["winsor_pct"] == cb.WINSOR_PCT
    hz = d["horizons"][0]
    for arm in ("strategy", "baseline"):
        assert hz[arm]["avg_pct_winsorised"] is not None
        # this fixture has no move past ±50%, so clipped == raw on both arms
        assert hz[arm]["avg_pct_winsorised"] == pytest.approx(hz[arm]["avg_pct"])


def test_the_baseline_stays_REQUIRED_after_stats_grew_a_defaulted_field():
    """⭐ THE RAIL THE CONTRACT ASKS FOR (mutation: drop the baseline arg).
    `Stats` gained a field WITH a default; `HorizonResult.baseline` must not
    have caught one on the way."""
    p = inspect.signature(bt.HorizonResult).parameters["baseline"]
    assert p.default is inspect.Parameter.empty
    with pytest.raises(TypeError):
        bt.HorizonResult(horizon=5, strategy=bt.Stats(n=10),
                         below_floor=False, coverage={})


# ─── 2 · the purity rail reaches the module the rules come from ─────────────
#
# `tests/test_screener_backtest.py::test_the_engine_imports_no_clock_and_no_rng`
# scans `backtest.py`'s OWN text. Since W5a.1 the engine's determinism also
# rests on `candle_backtest.py` (the clip; W5a.2 adds the bucket rule), which
# that rail never reads. At HEAD the module imports only `math` -- a fact, not
# a rail -- so this section makes it one. The banned tokens are DERIVED from the
# owner rail's source (never re-typed), so the two rails cannot drift apart.

OWNER_RAIL_FILE = "test_screener_backtest.py"
OWNER_RAIL = "test_the_engine_imports_no_clock_and_no_rng"
#: What a pure rules module may import: annotations and arithmetic, nothing else.
ALLOWED_IMPORTS = frozenset({"__future__", "math"})


def _owner_banned_tokens() -> tuple:
    """The literal tuple the owner rail iterates (`for banned in (...)`), read
    off its AST -- so this file never re-types the list and cannot lag it."""
    src = Path(__file__).with_name(OWNER_RAIL_FILE).read_text(encoding="utf-8")
    fn = next(n for n in ast.walk(ast.parse(src))
              if isinstance(n, ast.FunctionDef) and n.name == OWNER_RAIL)
    for node in ast.walk(fn):
        if isinstance(node, ast.For) and isinstance(node.iter, ast.Tuple):
            toks = tuple(e.value for e in node.iter.elts
                         if isinstance(e, ast.Constant) and isinstance(e.value, str))
            if toks:
                return toks
    raise AssertionError(f"{OWNER_RAIL} no longer iterates a literal tuple of tokens")


def _imports_of(src: str) -> set:
    """Top-level module names a source text imports (`a.b` -> `a`); a relative
    import is reported as `.` so it is refused by name too."""
    found = set()
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Import):
            found.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            found.add("." if node.level else (node.module or "").split(".")[0])
    return found


def _tokens_found(src: str, banned) -> list:
    return [b for b in banned if b in src]


def test_candle_backtest_imports_only_math():
    """⭐ THE RAIL. `backtest.winsorise` IS `candle_backtest._clip`; a clock or an
    RNG imported THERE reaches the engine through a door the owner rail never
    scans. Refused BY NAME: the message lists the offending modules."""
    extra = _imports_of(inspect.getsource(cb)) - ALLOWED_IMPORTS
    assert not extra, f"candle_backtest must stay pure (imports only math): {sorted(extra)}"


def test_candle_backtest_carries_none_of_the_owner_rails_banned_tokens():
    banned = _owner_banned_tokens()
    assert banned, "derived an EMPTY banned list -- this rail would measure nothing"
    found = _tokens_found(inspect.getsource(cb), banned)
    assert not found, f"candle_backtest must be deterministic: found {found}"


def test_the_purity_rail_goes_red_when_a_forbidden_import_is_planted():
    """CONTROL (contract: a rail that reads 0 both ways has measured nothing).
    The same checkers over a COPY of the source with `time` and `datetime`
    planted name them, and over a copy with the derived tokens planted find
    every one; over the real source both name nothing."""
    src = inspect.getsource(cb)
    banned = _owner_banned_tokens()
    assert _imports_of(src) - ALLOWED_IMPORTS == set()
    assert _tokens_found(src, banned) == []
    planted_imports = src + "\nimport time\nfrom datetime import datetime\n"
    assert _imports_of(planted_imports) - ALLOWED_IMPORTS == {"time", "datetime"}
    planted_tokens = src + "\n" + "\n".join(banned) + "\n"
    assert sorted(_tokens_found(planted_tokens, banned)) == sorted(banned)


# ─── 3 · the same-day-move control ──────────────────────────────────────────
#
# `candle_backtest` measured the confound: matched on date alone, every bearish
# label read POSITIVE and every bullish one NEGATIVE — short-term mean reversion,
# not the shape. The remedy is a base rate matched on (date, same-day move in
# lagged-ATR units). The screen engine's baseline is POOLED (every answered bar
# over the window), so a screen keyed off a big move measures the bounce. This
# section adds the matched comparison BESIDE the pooled one, never instead.

PATTERN = (8.0, -3.0, 1.0, 6.0, -4.0, -5.0, 2.0, -4.0)   # day returns, %, cycled


def path(start: float, n: int = 60):
    """Closes following PATTERN from `start`; opens = the previous close, so the
    next-open fill is the close the signal was read at.

    ⛔ SCALE-FREE BY CONSTRUCTION, and `bars()` is NOT used because its ±1
    high/low offsets are absolute: a 200-dollar and a 50-dollar tape would get
    different true ranges, different ATR%, and could land in different buckets.
    Here high/low are ±0.5% of price, so two tapes whose `start` differ by a
    power of two have BIT-IDENTICAL day returns, ATR%, buckets and forward
    returns (scaling by 2^k is exact in binary floating point) — which is what
    makes the matched excess computable by hand."""
    closes = [start]
    for i in range(1, n):
        closes.append(closes[-1] * (1 + PATTERN[i % len(PATTERN)] / 100.0))
    out = []
    for i, c in enumerate(closes):
        o = closes[i - 1] if i else c
        out.append({"t": day(i), "o": o, "h": max(o, c) * 1.005,
                    "l": min(o, c) * 0.995, "c": c, "v": 1000.0})
    return out


def flat(px: float = 50.0, n: int = 60):
    """A tape that never moves: o = h = l = c. Zero true range, so its
    same-day move is UNMEASURABLE (bucket `None`) and it joins no cell — but it
    is answered on every bar, so it sits in the POOLED baseline with a forward
    return of exactly 0."""
    return [{"t": day(i), "o": px, "h": px, "l": px, "c": px, "v": 1000.0}
            for i in range(n)]


def opens_ramped(tape, first: float = 20.0, per_bar: float = 1.02):
    """A COPY of `tape` whose OPENS are a constant-growth ramp and whose
    ``t``/``h``/``l``/``c`` are untouched.

    ⭐ THE PERTURBATION THAT ISOLATES ONE HALF OF THE CELL. `_move_buckets`
    reads ``h``, ``l``, ``c`` and the previous ``c`` and NEVER ``o``, while
    `_forward_return` reads ONLY ``o``. So this moves a peer's forward return
    while leaving its (date, bucket) bit-identical — same cell, same membership,
    same counts, a different base rate. ⚠️ The opens are deliberately detached
    from the bar's own high/low: that is not a tape, it is a scalpel, and the
    isolation is the whole point of the control.

    Every bar's forward return over ``h`` bars is then exactly
    ``(per_bar ** h - 1) * 100`` — a constant, so the matched excess it produces
    is arithmetic rather than an empirical accident."""
    out = []
    for i, bar in enumerate(tape):
        b = dict(bar)
        b["o"] = first * (per_bar ** i)
        out.append(b)
    return out


#: Fires on every bar of a symbol priced above 100 and never on one below —
#: so a 50-dollar twin of a 200-dollar name is the matched CONTROL: same move,
#: same day, same bucket, not a signal.
ABOVE_100 = OP(">", SER("close"), NUM(100))


def test_move_buckets_are_lagged_and_scale_free():
    a, c = path(200.0), path(50.0)
    assert bt._move_buckets(a)[2:] == bt._move_buckets(c)[2:]
    # bar 0 has no previous close; bar 1 has no true range on file yet
    assert bt._move_buckets(a)[0] is None and bt._move_buckets(a)[1] is None
    assert all(b is not None for b in bt._move_buckets(a)[2:])
    # CONTROL: a zero-range tape has zero ATR — UNMEASURABLE, never bucket 0
    assert all(b is None for b in bt._move_buckets(flat(n=20)))


def test_a_signal_that_did_what_its_own_move_peers_did_has_ZERO_matched_excess_while_the_pooled_arms_differ():
    """AAA/BBB (signals) and CCC (their 50-dollar twin, never a signal) move
    identically every day, so each signal's cell holds a non-signal peer with
    the SAME forward return: the matched excess is exactly zero. DDD is flat and
    drags the POOLED baseline away from the strategy — the comparison the pooled
    arms make is real, and it is a different question from the matched one."""
    b = {"AAA": path(200.0), "BBB": path(200.0), "CCC": path(50.0), "DDD": flat()}
    r = bt.run_backtest(ABOVE_100, ["AAA", "BBB", "CCC", "DDD"], day(2), day(59),
                        bars_for=reader(b), min_signals=1, horizons=(5,))
    hz = r.horizons[0]
    sd = hz.same_day
    assert sd["n_matched"] > 0 and sd["n_unmatched"] == 0
    assert sd["n_matched"] + sd["n_unmatched"] == hz.strategy.n
    assert sd["excess_pct_winsorised"] == pytest.approx(0.0, abs=1e-9)
    assert hz.strategy.avg_pct != pytest.approx(hz.baseline.avg_pct)


def test_CONTROL_moving_only_the_peers_forward_return_moves_the_matched_excess_off_zero():
    """⭐ THE DISCRIMINATING HALF, because a fixture that reads 0.0 both with and
    WITHOUT its perturbation has measured nothing (lane contract). The peer's
    opens are ramped and NOTHING else changes: same dates, same buckets, same
    cells, same membership, same counts — and the matched excess leaves 0.

    The arithmetic is closed-form. Each cell holds two signals at the winsorised
    return `w` and one peer at the constant `K = (1.02**5 - 1) * 100`, so every
    signal's excess is `w - (2w + K)/3 = (w - K)/3` and the reported mean is
    `(mean(w) - K) / 3`."""
    peer = opens_ramped(path(50.0))
    # the perturbation touched the RETURN and not the CELL: prove it, do not
    # assume it — the buckets are bit-identical to the untouched twin's.
    assert bt._move_buckets(peer) == bt._move_buckets(path(50.0))

    def run(ccc):
        b = {"AAA": path(200.0), "BBB": path(200.0), "CCC": ccc, "DDD": flat()}
        return bt.run_backtest(ABOVE_100, ["AAA", "BBB", "CCC", "DDD"],
                               day(2), day(59), bars_for=reader(b),
                               min_signals=1, horizons=(5,)).horizons[0]

    zero, moved = run(path(50.0)), run(peer)
    # the cells did not move: identical matched/unmatched counts on both runs
    assert zero.same_day["n_matched"] == moved.same_day["n_matched"] > 0
    assert zero.same_day["n_unmatched"] == moved.same_day["n_unmatched"] == 0
    assert zero.strategy.n == moved.strategy.n
    # ...and the number did
    assert zero.same_day["excess_pct_winsorised"] == pytest.approx(0.0, abs=1e-9)
    k = (1.02 ** 5 - 1) * 100.0
    assert moved.same_day["excess_pct_winsorised"] == pytest.approx(
        (moved.strategy.avg_pct_winsorised - k) / 3.0)
    assert moved.same_day["excess_pct_winsorised"] < -1.0


def test_the_control_a_screen_that_IS_the_whole_cell_measures_nothing_about_itself():
    """Without CCC nothing else moved that much on those days: every signal cell
    is wholly signals, the base rate would be the signals' own mean and the
    excess identically zero — so it is counted UNMATCHED, never reported as 0."""
    b = {"AAA": path(200.0), "BBB": path(200.0), "DDD": flat()}
    r = bt.run_backtest(ABOVE_100, ["AAA", "BBB", "DDD"], day(2), day(59),
                        bars_for=reader(b), min_signals=1, horizons=(5,))
    hz = r.horizons[0]
    assert hz.same_day["n_matched"] == 0
    assert hz.same_day["n_unmatched"] == hz.strategy.n
    assert hz.same_day["excess_pct_winsorised"] is None


def test_same_day_excess_is_a_per_observation_excess_over_the_cells_winsorised_mean():
    cells = {("d1", 5): [4, 4 * 2.0]}                     # 4 answered bars, mean +2.0
    obs = [(("d1", 5), 3.0), (("d1", 5), 1.0), (None, 9.0)]
    out = bt._same_day_excess(obs, cells, withheld=False)
    assert out["n_matched"] == 2 and out["n_unmatched"] == 1
    assert out["excess_pct_winsorised"] == pytest.approx(0.0)
    # CONTROL 1: the clip reaches the observation — a +300% signal counts as +50
    out = bt._same_day_excess([(("d1", 5), 300.0)], cells, withheld=False)
    assert out["excess_pct_winsorised"] == pytest.approx(cb.WINSOR_PCT - 2.0)
    # CONTROL 2: below the floor the counts survive and the number is withheld
    out = bt._same_day_excess(obs, cells, withheld=True)
    assert out["n_matched"] == 2 and out["excess_pct_winsorised"] is None


def test_the_method_block_names_the_control_and_the_buckets_are_the_candle_modules():
    r = bt.run_backtest(ALWAYS, ["AAA"], day(2), day(59),
                        bars_for=reader({"AAA": path(200.0)}), min_signals=1,
                        horizons=(5,))
    d = r.to_dict()
    m = d["method"]
    assert m["same_day_control"] is True
    assert m["same_day_buckets_atr"] == list(cb.MOVE_BUCKETS)
    assert m["atr_bars"] == bt.ATR_BARS
    sd = d["horizons"][0]["same_day"]
    assert sd["n_matched"] + sd["n_unmatched"] == r.horizons[0].strategy.n


def test_the_atr_window_is_the_candle_modules_own_number():
    """`candle_backtest.scan_ticker` carries the window as an inline literal;
    naming it there is W0's file. Read the artifact rather than retype it."""
    src = inspect.getsource(cb.scan_ticker)
    m = re.search(r"if len\(trs\) > (\d+):", src)
    assert m, ("candle_backtest.scan_ticker no longer bounds its true-range "
               "window the way this rail reads it — re-derive, do not retype")
    assert int(m.group(1)) == bt.ATR_BARS


# ─── 4 · what the port did NOT carry, reported rather than hidden ────────────
#
# `candle_backtest.summarize` averages per (date, bucket) CELL — "each date
# contributes once no matter how many tickers carried the label" — and refuses a
# label under MIN_DATES cells. This engine averages per OBSERVATION and floors on
# min_signals, which counts SIGNALS. Porting the clustering would change what
# `min_signals` means for every existing horizon, so the difference is REPORTED
# (`n_cells`, the owner's `n_dates` one axis over) rather than left for a reader
# of the source to notice.

def test_thirty_signals_on_ONE_date_are_ONE_cell_and_the_receipt_says_so():
    """🔴 THE GAP THE PORT LEFT, MADE VISIBLE. Thirty signals on one date in one
    bucket clear `min_signals` and publish an excess the owner would have refused
    outright (30 cells is its floor). `n_cells` is what lets a consumer see it."""
    sig, peer = path(200.0), path(50.0)
    names = [f"S{i:02d}" for i in range(30)] + ["PEER"]
    b = {n: (peer if n == "PEER" else sig) for n in names}
    one_date = bt.run_backtest(ABOVE_100, names, day(30), day(30),
                               bars_for=reader(b), min_signals=30,
                               horizons=(5,)).horizons[0]
    assert one_date.below_floor is False          # the SIGNAL floor is cleared...
    assert one_date.strategy.n == 30
    assert one_date.same_day["n_matched"] == 30
    assert one_date.same_day["n_cells"] == 1      # ...on ONE cell
    assert one_date.same_day["excess_pct_winsorised"] is not None

    # CONTROL: the SAME n_matched, the SAME floor verdict, spread over thirty
    # dates. `min_signals` cannot tell these two runs apart — `n_cells` is the
    # only field that can, which is the whole reason it ships.
    spread = bt.run_backtest(ABOVE_100, ["AAA", "PEER"], day(24), day(53),
                             bars_for=reader({"AAA": sig, "PEER": peer}),
                             min_signals=30, horizons=(5,)).horizons[0]
    assert spread.same_day["n_matched"] == one_date.same_day["n_matched"] == 30
    assert spread.below_floor is one_date.below_floor is False
    assert spread.same_day["n_cells"] == 30


def test_the_two_null_reasons_are_NAMED_and_the_precedence_matches_the_number():
    """⛔ NAMED, NOT INFERRED. The two states call for OPPOSITE actions: below the
    floor, widen the window; wholly-occupied, widening will not help."""
    cells = {("d1", 5): [4, 4 * 2.0]}
    obs = [(("d1", 5), 3.0)]
    ok = bt._same_day_excess(obs, cells, withheld=False)
    assert ok["excess_null_reason"] is None
    assert ok["excess_pct_winsorised"] is not None

    floor = bt._same_day_excess(obs, cells, withheld=True)
    assert floor["excess_null_reason"] == "below_floor"

    own = bt._same_day_excess([(("d9", 1), 3.0)], {("d9", 1): [1, 3.0]},
                              withheld=False)
    assert own["n_matched"] == 0 and own["n_cells"] == 0
    assert own["excess_null_reason"] == "no_unoccupied_cell"

    for r in (floor, own):
        assert r["excess_null_reason"] in bt.SAME_DAY_NULL_REASONS
        assert r["excess_pct_winsorised"] is None
    # the reason can never disagree with the number: one expression owns both,
    # and `below_floor` wins because it withholds the rate whatever matching found
    both = bt._same_day_excess([(("d9", 1), 3.0)], {("d9", 1): [1, 3.0]},
                               withheld=True)
    assert both["excess_null_reason"] == "below_floor"


def test_a_NON_null_excess_survives_to_dict_and_the_basis_names_its_conditioning():
    """⭐ THE KEY W5a.5 RENDERS, READ THROUGH THE DOOR IT RENDERS IT FROM. The
    other `to_dict()` read in this file lands on the all-cells-occupied fixture
    where the value is `None`, so the FLOAT path through `dict(self.same_day)`
    was never exercised — and a receipt whose only proven serialisation is the
    null one is a receipt nobody has watched carry a number."""
    b = {"AAA": path(200.0), "BBB": path(200.0),
         "CCC": opens_ramped(path(50.0)), "DDD": flat()}
    r = bt.run_backtest(ABOVE_100, ["AAA", "BBB", "CCC", "DDD"], day(2), day(59),
                        bars_for=reader(b), min_signals=1, horizons=(5,))
    sd = r.to_dict()["horizons"][0]["same_day"]
    assert isinstance(sd["excess_pct_winsorised"], float)
    assert sd["excess_pct_winsorised"] == pytest.approx(
        r.horizons[0].same_day["excess_pct_winsorised"])
    assert sd["excess_null_reason"] is None and sd["n_cells"] > 0

    # ⚠️ THE CONDITIONING IS STATED BESIDE THE NUMBER. W5a.5 renders this next to
    # a POOLED excess computed over 100% of the arm; a reader who is not told
    # that this one is not will read them as like for like.
    basis = r.to_dict()["method"]["same_day_basis"]
    for clause in ("MATCHED observations alone", "conditioned subsample",
                   "per OBSERVATION, not per cell", "`n_cells`",
                   "floors SIGNALS, not cells"):
        assert clause in basis, f"same_day_basis no longer states: {clause}"


def test_an_EMPTY_same_day_serialises_as_empty_and_not_as_absent():
    """⛔ `is not None`, NOT TRUTHINESS. "computed and empty" and "never computed"
    are different facts; a falsy check folds the first into the second, which is
    the same class of defect as a 0 that means "unknown"."""
    kw = dict(horizon=5, strategy=bt.Stats(n=1), baseline=bt.Stats(n=1),
              below_floor=False, coverage={})
    assert bt.HorizonResult(same_day={}, **kw).to_dict()["same_day"] == {}
    # CONTROL: genuinely absent still serialises as absent
    assert bt.HorizonResult(**kw).to_dict()["same_day"] is None


def test_an_inverted_bar_is_not_bucketed_the_owners_h_ge_l_check_reaches_here():
    """`candle_backtest._usable` refuses `h < l`. An inverted bar's true range is
    NEGATIVE, which would pull the lagged ATR down and inflate every |z| measured
    against it — moving real bars into buckets they do not belong in."""
    good = path(200.0, n=20)
    bad = [dict(b) for b in good]
    bad[8]["h"], bad[8]["l"] = bad[8]["l"], bad[8]["h"]        # invert ONE bar
    assert bt._move_buckets(good)[8] is not None               # CONTROL
    assert bt._move_buckets(bad)[8] is None
    # and the inversion is the only difference: every bar before it is untouched
    assert bt._move_buckets(bad)[:8] == bt._move_buckets(good)[:8]
