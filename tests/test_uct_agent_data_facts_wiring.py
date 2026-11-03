"""W1-C C-02 / C-04 (builder-c) — the browser's wiring of the four server-only kinds, pinned against the gateway.

app/src/agent/capabilities/marketDataFacts.js reads `fundamentals`, `earnings`, `news.company`, `themes` (C-02) and
`quote` / `quotes` for the legacy stock.profile / alert.create reads (C-04). This file keeps the two sides honest:
every kind the browser module names is a registered gateway kind with the freshness class the browser words it
with, each is default OFF (fail-closed UCT_AGENT_DATA_KINDS), and the server's own alert-safety rail still holds
(the quotes adapter never imports the live-prices route). No provider, no model.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway

_ROOT = Path(__file__).resolve().parents[1]
_FACTS = _ROOT / "app/src/agent/capabilities/marketDataFacts.js"
_STOCK = _ROOT / "app/src/agent/capabilities/stock.js"
_ALERT = _ROOT / "app/src/agent/capabilities/alert.js"

#: kind -> the freshness class marketDataFacts.js words it with (periodic data is never worded live)
BROWSER_KINDS = {"fundamentals": "periodic", "earnings": "periodic", "news.company": "periodic", "themes": "periodic",
                 "quote": "live", "quotes": "live"}


def _browser_read_kinds() -> set:
    src = _FACTS.read_text(encoding="utf-8")
    return set(re.findall(r"readData\('([a-z.]+)'", src))


@pytest.fixture
def fresh(monkeypatch):
    gateway._reset_for_test()
    yield
    gateway._reset_for_test()


def test_the_browser_reads_exactly_the_six_kinds_by_literal_name():
    assert _browser_read_kinds() == set(BROWSER_KINDS)


def test_each_browser_kind_is_a_registered_market_kind_with_the_declared_freshness(fresh):
    d = {k["kind"]: k for k in gateway.describe()}
    for kind, freshness in BROWSER_KINDS.items():
        assert kind in d, kind
        assert d[kind]["category"] == "market" and d[kind]["freshness"] == freshness, (kind, d[kind])


@pytest.mark.parametrize("kind", sorted(BROWSER_KINDS))
def test_every_browser_kind_is_default_off_and_refused_without_the_allowlist(monkeypatch, fresh, kind):
    monkeypatch.delenv(gateway.KINDS_ENV, raising=False)
    monkeypatch.setenv(gateway.DATA_ENV, "1")
    out = gateway.read(kind, {"symbol": "NVDA"} if kind != "themes" else {}, user_id="u", turn_id="t-wiring", purpose="answer")
    assert out["status"] == "refused" and out["data"] is None
    assert env.validate_envelope(out) == []
    assert gateway.KINDS_ENV in out["notes"][0]


def test_the_legacy_readers_import_the_facts_module_and_name_no_route():
    stock = _STOCK.read_text(encoding="utf-8")
    alert = _ALERT.read_text(encoding="utf-8")
    assert "from './marketDataFacts'" in stock and "readQuoteRow" in stock
    assert "from './marketDataFacts'" in alert and "readQuoteMap" in alert
    for src in (stock, alert, _FACTS.read_text(encoding="utf-8")):
        code = "\n".join(l for l in src.splitlines() if not l.strip().startswith(("//", "*", "/*")))
        assert "/api/live-prices" not in code


def test_the_quotes_adapter_still_imports_neither_the_live_prices_route_nor_the_alert_service():
    src = (_ROOT / "api/services/uct_agent/marketdata/quotes.py").read_text(encoding="utf-8")
    code = "\n".join(l for l in src.splitlines() if not l.lstrip().startswith("#"))
    body = code.split('"""', 2)[-1]                 # past the module docstring, which names the route to forbid it
    assert "live_prices" not in body and "watchlist_alert_service" not in body
