# -*- coding: utf-8 -*-
"""The live last-price source by REGISTRATION (api/services/live_price_source.py).

journal_two.setups_board reads the live price through the registry, never by importing the stream module, so
bar_broadcaster leaves flow-worker's static import closure by this edge (the remaining route through
api.routers.bars is the routers.bars split, CHART SPEED). Behaviour is the reader's old one exactly:
unregistered (bar_broadcaster never loaded) or uninitialised raises, and the reader falls back to closes.
"""
import ast
import pathlib

import pytest

from api.services import live_price_source as lps

ROOT = pathlib.Path(__file__).resolve().parents[1]
STREAM = {"api.services.bar_broadcaster", "api.services.bar_stream"}


def _imported_modules(path: pathlib.Path) -> set:
    """Every module a file names in an import, function bodies included (the rail walker's own reading);
    comments and strings cannot count, because this reads the AST."""
    out = set()
    for n in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(n, ast.Import):
            out |= {a.name for a in n.names}
        elif isinstance(n, ast.ImportFrom) and n.module:
            out.add(n.module)
            out |= {f"{n.module}.{a.name}" for a in n.names}
    return out


@pytest.fixture
def restore_provider():
    saved = lps._provider
    yield
    lps._provider = saved


def test_setups_board_never_imports_a_stream_module():
    names = _imported_modules(ROOT / "api/services/journal_two/setups_board.py")
    assert not (names & STREAM), sorted(names & STREAM)
    assert "api.services.live_price_source" in names  # control: the reader does ask the registry


def test_unregistered_raises_and_a_provider_is_called_at_call_time(restore_provider):
    lps._provider = None
    with pytest.raises(RuntimeError, match="no live price source"):
        lps.broadcaster()
    calls = []
    lps.register(lambda: calls.append(1) or "bc")
    assert lps.broadcaster() == "bc" and lps.broadcaster() == "bc" and len(calls) == 2


def test_bar_broadcaster_registers_its_own_get_broadcaster(restore_provider, monkeypatch):
    # no reload (it would orphan an initialised singleton for later tests): importing it is what registers
    from api.services import bar_broadcaster
    assert lps._provider is not None
    monkeypatch.setattr(bar_broadcaster, "_singleton", None)
    with pytest.raises(RuntimeError, match="not initialized"):
        lps.broadcaster()
    marker = object()
    monkeypatch.setattr(bar_broadcaster, "_singleton", marker)
    assert lps.broadcaster() is marker


def test_read_prices_takes_the_live_tick_through_the_registry(restore_provider):
    from api.services.journal_two import setups_board

    class BC:
        def get_last_price(self, sym):
            return {"price": 101.5, "ts": 1_795_000_000_000} if sym == "NVDA" else None

    lps.register(lambda: BC())
    out = setups_board.read_prices(["NVDA"])
    assert out["NVDA"]["price"] == 101.5 and out["NVDA"]["source"] == "live"


def test_read_prices_with_no_live_source_reads_closes_only(restore_provider, monkeypatch):
    from api.services import bars_sqlite
    from api.services.journal_two import setups_board
    lps._provider = None
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda sym, tf, n: [[20261125, 1, 1, 1, 42.0, 1]])
    out = setups_board.read_prices(["NVDA"])
    assert out["NVDA"]["price"] == 42.0 and out["NVDA"]["source"] != "live"
