"""Every `bar_broadcaster.get_last_price` caller is a declared kind.

Per-trade freshness from get_last_price is promised only for a symbol with
registered interest (`add_interest` / `remove_interest`) or a chart subscriber,
because that is what holds the symbol on the T channel (owner "bars"). Under
STREAM_SCOPED_CHANNELS=1 a symbol held only by the volume owner moves once a
minute. A caller that relied on another owner happening to hold T would silently
degrade, so each caller must be one of:

  INTEREST  registers interest and releases it (both calls are in the file);
  ONE_SHOT  a single read inside one request, where registering would subscribe and
            release before a tick lands. It must carry the contract marker and treat
            the tick as best-effort.

The callers are derived (git grep over api/**, then an AST pass so prose and
comments never count) and never typed: a new caller fails BY NAME until it is put
in one of the two lists below.
"""
from __future__ import annotations

import ast
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

#: Register + release live-price interest around their reads.
INTEREST = {
    "api/routers/stream.py",                                   # /api/stream/prices: add on open, remove in finally
    "api/services/alert_taxonomy/price_level_projection.py",   # D3 cohort, reconciled every tick
}
#: Documented one-shot reads (best-effort tick, labelled with its minute).
ONE_SHOT = {
    "api/services/journal_two/notebook_today.py",
    "api/services/journal_two/setups_board.py",
}
ONE_SHOT_MARKER = "ONE-SHOT get_last_price READ"


def _calls(src: str, attr: str) -> int:
    return sum(1 for n in ast.walk(ast.parse(src))
               if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
               and n.func.attr == attr)


def _grep_candidates() -> set[str]:
    out = subprocess.run(["git", "grep", "-l", "get_last_price", "--", "api"],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return {line.strip().replace("\\", "/") for line in out.splitlines()
            if line.strip() and not line.strip().endswith("_test.py")}


def _callers() -> set[str]:
    return {rel for rel in _grep_candidates()
            if _calls((ROOT / rel).read_text(encoding="utf-8"), "get_last_price")}


def _undeclared(callers: set[str]) -> list[str]:
    return sorted(callers - INTEREST - ONE_SHOT)


def test_every_get_last_price_caller_is_declared():
    callers = _callers()
    assert callers, "found no get_last_price caller at all: the derivation is broken"
    missing = _undeclared(callers)
    assert not missing, (
        "get_last_price callers that neither register interest nor are a documented "
        "one-shot read (see bar_broadcaster.get_last_price FRESHNESS CONTRACT): "
        f"{missing}")


def test_the_lists_hold_no_stale_entries():
    stale = sorted((INTEREST | ONE_SHOT) - _callers())
    assert not stale, f"listed but no longer calling get_last_price: {stale}"
    assert not (INTEREST & ONE_SHOT)


@pytest.mark.parametrize("rel", sorted(INTEREST))
def test_interest_callers_register_and_release(rel):
    src = (ROOT / rel).read_text(encoding="utf-8")
    assert _calls(src, "add_interest") >= 1, f"{rel}: reads get_last_price but never add_interest"
    assert _calls(src, "remove_interest") >= 1, f"{rel}: add_interest with no remove_interest (a leak)"


@pytest.mark.parametrize("rel", sorted(ONE_SHOT))
def test_one_shot_callers_carry_the_contract_marker(rel):
    src = (ROOT / rel).read_text(encoding="utf-8")
    assert ONE_SHOT_MARKER in src, f"{rel}: one-shot get_last_price read without the contract marker"


def test_the_contract_is_stated_where_the_method_lives():
    src = (ROOT / "api/services/bar_broadcaster.py").read_text(encoding="utf-8")
    assert "FRESHNESS CONTRACT" in src and "tests/test_get_last_price_consumers.py" in src


def test_control_an_undeclared_caller_is_reported_and_prose_is_not():
    """The rail can fail: a new caller is reported by name, a comment mentioning the
    method is not a caller."""
    assert _undeclared({"api/services/new_widget.py"}) == ["api/services/new_widget.py"]
    assert _calls("x = bb.get_last_price('A')\n", "get_last_price") == 1
    assert _calls("# bb.get_last_price('A')\ns = 'get_last_price'\n", "get_last_price") == 0
