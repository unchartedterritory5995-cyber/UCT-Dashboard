"""W9-T3b rails for `tools/vendor_harness/range_guard.py`.

Every rail names what it guards and has a control (a source, a window or a set that distinguishes), so a
guard that does nothing cannot pass. The mutation proof is `docs/pine/evidence/2026-11-05-w9-t3/EVIDENCE.md`.
"""
from __future__ import annotations

import glob
import json
import pathlib
import re
import subprocess
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools" / "vendor_harness"))
import range_guard as rg  # noqa: E402

X, Y = 1700000000000, 1760000000000
G = f"time >= {X} and time < {Y}"

WRAP_SRC = '''//@version=6
strategy("T", overlay = false)
up = ta.crossover(close, open)
if up
    strategy.entry("L", strategy.long)
    foo = 1
strategy.close_all()
'''

WHEN_SRC = '''//@version=5
strategy("T")
strategy.entry("L", strategy.long, when = a or b)
strategy.close("L", when = c)
'''


def unguarded_calls(source: str, x: int, y: int) -> list:
    """An independent checker (does not call `rewrite`): every order call of the authoritative set is either
    guarded through its own `when` or sits directly under an `if <guard>` one level in."""
    calls = rg.order_calls()
    code = rg.blank(source)
    lines = source.split("\n")
    guard = f"time >= {x} and time < {y}"
    bad = []
    for m in rg.CALL_RX.finditer(code):
        if m.group(1) not in calls:
            continue
        ln = code.count("\n", 0, m.start(1))
        close = rg._match_paren(code, m.end() - 1)
        text = source[m.start(1):close + 1]
        if re.search(r"\bwhen\s*=", text) and text.replace(" ", "").find(f"and{guard}".replace(" ", "")) >= 0:
            continue
        prev = lines[ln - 1] if ln else ""
        ind = len(lines[ln]) - len(lines[ln].lstrip())
        if prev.strip() == f"if {guard}" and len(prev) - len(prev.lstrip()) + 4 == ind:
            continue
        bad.append((ln + 1, m.group(1)))
    return bad


# ── the order-call set: ONE authority ───────────────────────────────────────────

def test_order_set_is_parsed_from_pine_js_and_excludes_risk_calls():
    s = rg.order_calls()
    assert {"strategy.entry", "strategy.exit", "strategy.close", "strategy.close_all", "strategy.order",
            "strategy.cancel", "strategy.cancel_all"} <= s
    assert not any(n.startswith("strategy.risk.") for n in s)
    text = (REPO / "app/src/components/chart/engine/ast/pine.js").read_text(encoding="utf-8")
    declared = set(re.findall(r"'(strategy\.[a-z_.]+)'", re.search(r"STRATEGY_ORDER_CALLS = .*?\]\)\)", text, re.S).group(0)))
    assert s == {n for n in declared if not n.startswith("strategy.risk.")}


def test_the_set_follows_the_source_not_a_copy(tmp_path):
    f = tmp_path / "pine.js"
    f.write_text("export const STRATEGY_ORDER_CALLS = Object.freeze(new Set(['strategy.entry', 'strategy.zap', 'strategy.risk.max_drawdown']))", encoding="utf-8")
    assert rg.order_calls(f) == frozenset({"strategy.entry", "strategy.zap"})
    out, rep = rg.rewrite('strategy.zap("a")\nstrategy.exit("x")\n', X, Y, rg.order_calls(f))
    assert rep["calls"] == 1 and "strategy.exit" in out and f"if {G}" in out
    f.write_text("nothing here", encoding="utf-8")
    with pytest.raises(rg.RangeGuardRefused) as e:
        rg.order_calls(f)
    assert e.value.name == "range_guard:order-set-unreadable"


# ── the rewrite ──────────────────────────────────────────────────────────────────

def test_an_unconditional_order_call_is_wrapped_and_nothing_else_moves():
    out, rep = rg.rewrite(WRAP_SRC, X, Y)
    body = out.split("// range_guard:")[0]
    assert rep["calls"] == 2 and rep["wrapped"] == 2 and rep["whenEdited"] == 0
    assert f"    if {G}\n        strategy.entry(\"L\", strategy.long)\n    foo = 1\n" in body
    assert f"if {G}\n    strategy.close_all()\n" in body
    # the enclosing `if up` and the state line beside the order are untouched: only the order is confined
    assert "if up\n" in body and "    foo = 1\n" in body
    # removing the added lines gives back the source byte for byte (nothing else changed)
    kept = [ln for ln in body.split("\n") if ln.strip() != f"if {G}"]
    assert "\n".join(l[4:] if l.startswith("        strategy.entry") else l for l in kept).replace("    strategy.close_all()", "strategy.close_all()") == WRAP_SRC
    assert unguarded_calls(out, X, Y) == []
    assert unguarded_calls(WRAP_SRC, X, Y) == [(5, "strategy.entry"), (7, "strategy.close_all")]   # control: the checker can fail


def test_a_when_argument_gets_the_guard_with_the_old_condition_parenthesised():
    out, rep = rg.rewrite(WHEN_SRC, X, Y)
    assert rep["whenEdited"] == 2 and rep["wrapped"] == 0
    assert f"when = (a or b) and {G})" in out
    assert f"when = (c) and {G})" in out
    assert unguarded_calls(out, X, Y) == []


def test_multiline_calls_are_wrapped_whole_with_continuation_lines_moved_too():
    src = 'strategy.entry("L", strategy.long,\n     qty = 2,\n     comment = "c")\nx = 1\n'
    out, _ = rg.rewrite(src, X, Y)
    assert f"if {G}\n    strategy.entry(\"L\", strategy.long,\n         qty = 2,\n         comment = \"c\")\nx = 1\n" in out
    assert unguarded_calls(out, X, Y) == []


def test_comments_and_strings_do_not_count_as_order_calls():
    src = '// strategy.entry("no")\nlbl = "strategy.exit(x)"\nstrategy.entry("yes", strategy.long)\n'
    out, rep = rg.rewrite(src, X, Y)
    assert rep["calls"] == 1
    assert out.count(f"if {G}") == 1


def test_crlf_is_kept():
    out, _ = rg.rewrite('strategy.entry("L", strategy.long)\r\nx = 1\r\n', X, Y)
    assert "\r\n" in out and not re.search(r"(?<!\r)\n", out)


def test_idempotent_for_both_forms():
    for src in (WRAP_SRC, WHEN_SRC, 'strategy.entry("a", strategy.long)\nif x\n    strategy.exit("b")\n'):
        once, _ = rg.rewrite(src, X, Y)
        twice, rep2 = rg.rewrite(once, X, Y)
        assert twice == once
        assert rep2["alreadyGuarded"] == rep2["calls"] and rep2["wrapped"] == 0 and rep2["whenEdited"] == 0
        assert rep2["sourceSha256"] == rg.sha256(src)           # the ORIGINAL source's sha survives a second pass
    # control: a different source gives a different result and sha
    assert rg.rewrite('strategy.entry("z", strategy.long)\n', X, Y)[1]["sourceSha256"] != rg.sha256(WRAP_SRC)


# ── refusals, by name ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("src,name", [
    ('plot(close)\n', "range_guard:no-order-calls"),
    ('strategy.risk.max_drawdown(5, strategy.percent_of_equity)\nplot(close)\n', "range_guard:no-order-calls"),
    ('// strategy.entry("only in a comment")\n', "range_guard:no-order-calls"),
    ('x = cond ? strategy.entry("a", strategy.long) : 0\n', "range_guard:order-call-in-expression"),
    ('y = strategy.close("a")\n', "range_guard:order-call-in-expression"),
    ('strategy.entry("a", strategy.long) , 1\n', "range_guard:code-after-order-call"),
    ('if time >= 1 and time < 2\n    strategy.entry("a", strategy.long)\n', "range_guard:another-window"),
])
def test_refusals_are_named(src, name):
    with pytest.raises(rg.RangeGuardRefused) as e:
        rg.rewrite(src, X, Y)
    assert e.value.name == name


@pytest.mark.parametrize("x,y", [(0, 5), (5, 5), (9, 5), (1.5, 9), ("1", 9)])
def test_a_bad_window_is_refused(x, y):
    with pytest.raises(rg.RangeGuardRefused) as e:
        rg.rewrite('strategy.entry("a", strategy.long)\n', x, y)
    assert e.value.name == "range_guard:bad-window"


# ── real sources ─────────────────────────────────────────────────────────────────

CORPUS = ["72s-strategy-adaptive-hull-moving-average-pt1", "stop-loss-and-take-profit-in-example",
          "tradingview-alerts-to-mt4-mt5-forex-indices-commodities-stocks-crypto", "vwap-fibo-dev-extensions-strategy"]


@pytest.mark.parametrize("slug", CORPUS)
def test_committed_corpus_strategies_get_every_order_call_guarded_and_stay_idempotent(slug):
    path = glob.glob(str(REPO / "corpus" / "committed" / f"{slug}__*.pine"))[0]
    src = pathlib.Path(path).read_text(encoding="utf-8")
    assert unguarded_calls(src, X, Y), "control: the source starts unguarded"
    out, rep = rg.rewrite(src, X, Y)
    assert unguarded_calls(out, X, Y) == []
    assert rg.rewrite(out, X, Y)[0] == out
    # the only changes are additions and the order calls' own lines: every original code line survives
    body = out.split("// range_guard:")[0]
    kept = {ln.strip() for ln in body.split("\n")}
    assert all(ln.strip() in kept or "when" in ln for ln in src.split("\n") if ln.strip() and not ln.strip().startswith("//"))
    assert rep["calls"] >= 3


def test_the_committed_method_b_probe_is_fully_guarded_and_the_plain_core_is_not():
    p = REPO / "tools" / "visual_conformance" / "probes"
    rng = (p / "s1-broker-core-range.pine").read_text(encoding="utf-8")
    plain = (p / "s1-broker-core.pine").read_text(encoding="utf-8")
    gens = re.search(r"^RANGE_X_MS = (\d+)\nRANGE_Y_MS = (\d+)", (REPO / "tools/vendor_harness/w9_probes.py").read_text(encoding="utf-8"), re.M)
    x, y = int(gens.group(1)), int(gens.group(2))
    assert unguarded_calls(rng, x, y) == []
    assert unguarded_calls(plain, x, y) != []


# ── the window, from TradingView's own bars ──────────────────────────────────────

def _rows(n):
    return [[1_000_000 + i * 86400, 1, 1, 1, 1, 1] for i in range(n)]


def test_window_from_bars_is_five_lookbacks_in_and_just_past_the_last_closed_bar():
    rows = _rows(100)
    w = rg.window_from_bars(rows, 10, newest_forming=False)
    assert w["fromTime"] == rows[50][0] and w["toTime"] == rows[99][0] + 1 and w["warmupBars"] == 50
    assert (w["x"], w["y"]) == (w["fromTime"] * 1000, w["toTime"] * 1000)
    forming = rg.window_from_bars(rows, 10, newest_forming=True)
    assert forming["toTime"] == rows[98][0] + 1 != w["toTime"]           # the forming bar is never graded
    assert rg.window_from_bars(rows, 12, False)["fromTime"] != w["fromTime"]


def test_a_window_that_cannot_hold_the_warmup_is_refused():
    with pytest.raises(rg.RangeGuardRefused) as e:
        rg.window_from_bars(_rows(40), 10, False)
    assert e.value.name == "range_guard:bad-window"
    with pytest.raises(rg.RangeGuardRefused):
        rg.window_from_bars(_rows(400), 0, False)


def test_longest_lookback_proxy_reads_ta_calls_and_inputs_and_ignores_comments():
    src = 'a = ta.sma(close, 200)\nb = ta.ema(close, 50)\nl = input.int(300, "len")\n// ta.sma(close, 900)\n'
    assert rg.longest_lookback(src) == 300
    assert rg.longest_lookback('a = ta.sma(close, 5000)\n') == 1                   # capped at 1000
    assert rg.longest_lookback('plot(close)\n') == 1


def test_cli_rewrite_and_window_round_trip(tmp_path):
    src = tmp_path / "s.pine"
    src.write_text(WRAP_SRC, encoding="utf-8")
    out = tmp_path / "o.pine"
    r = subprocess.run([sys.executable, str(REPO / "tools/vendor_harness/range_guard.py"), "rewrite", str(src), str(out),
                        "--from-ms", str(X), "--to-ms", str(Y)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout)["calls"] == 2 and unguarded_calls(out.read_text(encoding="utf-8"), X, Y) == []
    bad = subprocess.run([sys.executable, str(REPO / "tools/vendor_harness/range_guard.py"), "rewrite", str(out), str(tmp_path / "o2.pine"),
                          "--from-ms", "1", "--to-ms", "2"], capture_output=True, text=True)
    assert bad.returncode == 2 and "range_guard:another-window" in bad.stderr
    cap = tmp_path / "cap.json"
    cap.write_text(json.dumps({"bars": {"rows": _rows(100)}}), encoding="utf-8")
    w = subprocess.run([sys.executable, str(REPO / "tools/vendor_harness/range_guard.py"), "window", str(cap), "--lookback", "10"], capture_output=True, text=True)
    assert w.returncode == 0 and json.loads(w.stdout)["warmupBars"] == 50
