"""TERM-018 / G-14: `single_stock_etfs._finish`'s refusal alert, observed TWO-SIDED.

`tests/test_single_stock_etfs.py` asserts ONE alert across three refusals - close to
a control, but nothing showed a SINGLE refusal stays quiet, that a success re-arms
the transition, or what severity the guard decides. Driven through the real
`rebuild` with only the Finviz pull and the sink replaced; the DB is a tmp path.
"""
from __future__ import annotations

import importlib

import pytest

from api.services import single_stock_etfs as ss


def _rows(n_etf: int) -> list[dict]:
    rows = [{"Ticker": "NBIS", "Company": "Nebius Group NV", "Sector": "Technology",
             "Industry": "Software", "Average Volume": "5,000,000", "Price": "40.00"}]
    for i in range(n_etf):
        rows.append({"Ticker": f"LG{i:02d}", "Company": f"Issuer{i} 2X Long NBIS Daily ETF",
                     "Sector": "Financial", "Industry": "Exchange Traded Fund",
                     "Average Volume": "1,000,000", "Price": "50.00"})
    return rows


@pytest.fixture()
def rig(tmp_path, monkeypatch):
    monkeypatch.setenv("SSETF_DB_PATH", str(tmp_path / "ssetf.db"))
    mod = importlib.reload(ss)
    monkeypatch.setattr(mod, "_spawn_rebuild", lambda trig: None)
    sent = []
    monkeypatch.setattr(mod.chart_health_alerts, "emit",
                        lambda *a, **k: sent.append(a) or True)

    def run(n_etf: int):
        monkeypatch.setattr(mod, "_fetch_finviz_market", lambda: _rows(n_etf))
        return mod.rebuild(trigger="test")

    yield run, sent
    mod.invalidate_cache()


def test_CONTROL_one_refusal_alerts_nobody(rig):
    run, sent = rig
    run(10)
    assert run(1)["status"].startswith("refused")
    assert sent == []


def test_the_second_consecutive_refusal_alerts_once_as_a_warning(rig):
    """Once: the third and fourth refusals of the same streak stay quiet."""
    run, sent = rig
    run(10)
    run(1)
    run(1)
    run(1)
    run(1)
    assert [(a[0], a[1]) for a in sent] == [("ssetf_rebuild_refused", "warning")]


def test_a_success_rearms_the_transition(rig):
    run, sent = rig
    run(10)
    run(1); run(1)               # alert 1
    run(10)                      # success resets the consecutive count
    run(1); run(1)               # alert 2
    assert len(sent) == 2
