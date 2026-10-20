"""Task 9: wave-1 notebook widgets end to end, through the real services.

A temp auth DB is seeded with the product's own write functions (manual trade, broker trade,
open position, watchlists). Only the market-data seams are patched: live prices, the reporting
window, implied move, bars, the regime read. No network, and nothing under the live data dir.

The route is driven through a TestClient, each payload is wrapped as a `widgetEmbed` and run
through the public reducer in share mode.
"""
from __future__ import annotations

import json
from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.notebook_widgets as nwr
from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two import public_note_payload as public

URL = "/api/j2/notebook-widgets/"
WAVE1 = ("myWatchlistToday", "myNamesReporting", "tickerCard", "myPnlStats", "myPositionsRisk")
ACCOUNT = ("myPnlStats", "myPositionsRisk")
QUERY = {"tickerCard": "?symbol=NVDA", "myPnlStats": "?from=2020-01-01&to=2099-12-31"}
NEUTRAL_ACCOUNT = public.ACCOUNT_NEUTRAL_LINE
NEUTRAL_MARKET = public.NEUTRAL_LINE


def _user(uid):
    return {"id": uid, "email": f"{uid}@example.test", "role": "member", "plan": "pro"}


def _client(uid):
    app = FastAPI()
    app.include_router(nwr.router)
    app.dependency_overrides[get_current_user] = lambda: _user(uid)
    app.dependency_overrides[get_current_user_with_plan] = lambda: _user(uid)
    return TestClient(app)


@pytest.fixture
def env(monkeypatch, tmp_path):
    """A temp auth DB (also DATA_DIR, which member_interest reads) and every market seam patched."""
    from api.services import auth_db
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W1_ENABLED", "1")
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    auth_db.init_db()

    import api.routers.live_prices as lp
    import api.services.bars_sqlite as bars
    import api.services.earnings_enrichment as ee
    import api.services.journal_two.earnings_prep as ep
    import api.services.journal_two.regime as regime

    def fake_prices(tickers=""):
        return {s: {"price": 120.0, "change_pct": 1.25} for s in tickers.split(",") if s}

    monkeypatch.setattr(lp, "get_live_prices", fake_prices)
    monkeypatch.setattr(bars, "get_bars", lambda sym, tf, n: [(i, 0, 0, 0, 100.0 + i, 0) for i in range(n)])
    monkeypatch.setattr(ee, "get_implied_move", lambda sym, d=None, t=None: {"pct": 6.5})
    monkeypatch.setattr(regime, "get_current_regime", lambda *a, **k: {"regime": "uptrend"})
    soon = {"items": [{"symbol": "NVDA", "date": "2026-10-21", "daysAway": 1, "timing": "amc",
                       "sources": ["watchlist"]}], "partial": False}
    monkeypatch.setattr(ep, "reporting_soon", lambda user_id, today=None: soon)
    monkeypatch.setattr(ep, "_window", lambda today: ({"NVDA": "2026-10-21"}, {"NVDA": "amc"}, False, None))
    # the ticker card's history is cached per (member, symbol) at module level
    monkeypatch.setattr(nw, "_HISTORY_CACHE", type(nw._HISTORY_CACHE)(max_size=10))
    return auth_db


def _seed_member(uid):
    """One broker trade, one manual trade (both closed), an open position with a placeholder stop,
    two watchlist names. Returns the ids that must never reach a public page."""
    from api.services import auth_db, watchlist_service
    from api.services.journal_two import positions, settings as j2_settings, trades

    conn = auth_db.get_connection()
    try:
        conn.execute("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)",
                     (uid, f"{uid}@example.test", "x"))
        conn.commit()
    finally:
        conn.close()
    cfg = j2_settings.get_settings(uid)
    d1 = (date.today() - timedelta(days=4)).isoformat()
    d2 = (date.today() - timedelta(days=2)).isoformat()
    trades.bulk_insert_trades(uid, [{
        "symbol": "AMD", "side": "Long", "shares": 10, "entryPrice": 100.0, "entryDate": d1,
        "exitPrice": 110.0, "exitDate": d2, "originalStop": 95.0, "externalId": "ext-1",
    }], cfg, source="broker")
    manual = trades.create_trade_manual(uid, {
        "symbol": "MSFT", "side": "Long", "shares": 5, "entryPrice": 200.0, "entryDate": d1,
        "exitPrice": 190.0, "exitDate": d2, "originalStop": 195.0,
    }, cfg)
    pos = positions.create_position(uid, {
        "symbol": "NVDA", "side": "Long", "shares": 20, "entryPrice": 100.0, "stopPrice": 95.0,
        "entryDate": d2,
    }, {})
    # create_position refuses a stop at or above entry for a Long, but a broker import stores exactly
    # that placeholder (stop == entry), so the row is set the way the import leaves it.
    conn = auth_db.get_connection()
    try:
        conn.execute("UPDATE j2_positions SET stop_price = entry_price WHERE id = ?", (pos["id"],))
        conn.commit()
    finally:
        conn.close()
    wl = watchlist_service.create_watchlist(uid, "Mine")
    watchlist_service.add_item(uid, wl["id"], "AAPL")
    watchlist_service.add_item(uid, wl["id"], "TSLA")

    conn = auth_db.get_connection()
    try:
        trade_ids = [r[0] for r in conn.execute("SELECT id FROM j2_trades WHERE user_id = ?", (uid,)).fetchall()]
    finally:
        conn.close()
    assert len(trade_ids) == 2 and manual["id"] in trade_ids
    return {"position_id": pos["id"], "trade_ids": trade_ids}


def _embed(kind, payload, *, share=None):
    params = dict(payload)
    if share is not None:
        params["share"] = share
    return {"type": "doc", "content": [{"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": kind, "params": params, "mode": "snapshot",
        "capturedAt": payload.get("asOf"), "embedId": "e1"}}]}


def _reduce(doc):
    return public.reduce(doc, mode="share", owner_id="u-e2e", note_id="n1",
                         attachment_base="/api/notebook/shares/x/attachments/")


def _paragraph_texts(doc):
    return [n["content"][0]["text"] for n in doc["content"] if n.get("type") == "paragraph" and n.get("content")]


def _embeds(doc):
    return [n for n in doc["content"] if n.get("type") == "widgetEmbed"]


def _get(client, kind):
    r = client.get(URL + kind + QUERY.get(kind, ""))
    assert r.status_code == 200, (kind, r.status_code, r.text)
    return r.json()


def test_each_wave1_kind_builds_and_reduces(env):
    ids = _seed_member("u-e2e")
    client = _client("u-e2e")
    payloads = {k: _get(client, k) for k in WAVE1}

    # the seeds really reached the account payloads (an accidentally empty member would pass the rest)
    assert payloads["myPnlStats"]["tradeCount"] == 2
    assert payloads["myPnlStats"]["source"] == "mixed"
    rows = payloads["myPositionsRisk"]["rows"]
    assert len(rows) == 1 and rows[0]["positionId"] == ids["position_id"]
    assert rows[0]["noStop"] is True and rows[0]["distToStopPct"] is None
    assert [r["symbol"] for r in payloads["myWatchlistToday"]["rows"]] == ["AAPL", "TSLA"]
    assert payloads["myPositionsRisk"]["accountSizeSource"] == "default"
    assert payloads["myPositionsRisk"]["accountSize"] == 100000.0

    for kind in WAVE1:
        payload = payloads[kind]
        assert payload["asOf"] and payload["source"] in {"broker", "manual", "mixed", "market"}
        want = NEUTRAL_ACCOUNT if kind in ACCOUNT else NEUTRAL_MARKET
        # neutral without the switch
        off = _reduce(_embed(kind, payload))
        assert _paragraph_texts(off) == [want], kind
        assert not _embeds(off)
        # a non-boolean switch is not the switch
        assert _paragraph_texts(_reduce(_embed(kind, payload, share="true"))) == [want]

        on = _reduce(_embed(kind, payload, share=True))
        if kind in ACCOUNT:
            assert len(_embeds(on)) == 1, kind
            shown = json.dumps(on)
            assert ids["position_id"] not in shown
            for tid in ids["trade_ids"]:
                assert tid not in shown
            assert "positionId" not in shown
        else:
            # market kinds are neutral even with the switch on
            assert _paragraph_texts(on) == [NEUTRAL_MARKET], kind
            assert not _embeds(on)

    # the shown account embeds carry their figures
    pnl = _embeds(_reduce(_embed("myPnlStats", payloads["myPnlStats"], share=True)))[0]["attrs"]["params"]
    assert pnl["tradeCount"] == 2 and pnl["netPnl"] == payloads["myPnlStats"]["netPnl"]
    risk = _embeds(_reduce(_embed("myPositionsRisk", payloads["myPositionsRisk"], share=True)))[0]["attrs"]["params"]
    assert risk["rows"][0]["symbol"] == "NVDA" and "positionId" not in risk["rows"][0]
    assert risk["accountSizeSource"] == "default"


def test_new_member_no_data(env):
    client = _client("u-fresh")
    for kind in WAVE1:
        payload = _get(client, kind)
        assert payload["asOf"], kind
        if kind == "myPnlStats":
            assert payload["netPnl"] is None and payload["winRate"] is None and payload["avgR"] is None
            assert payload["tradeCount"] == 0 and payload["empty"]
            assert payload["equity"] == []
        if kind == "myPositionsRisk":
            assert payload["rows"] == [] and payload["empty"] == "No open positions."
            assert payload["accountSizeSource"] == "default" and payload["accountSize"] == 100000.0
        if kind == "myWatchlistToday":
            assert payload["rows"] == []
        if kind == "tickerCard":
            assert payload["history"] is None
        # nowhere does a P&L figure read 0.0 for "no data"
        for key in ("netPnl", "winRate", "avgR", "openPnl"):
            assert payload.get(key) != 0.0, (kind, key)
        for row in payload.get("rows") or []:
            assert row.get("openPnl") != 0.0, kind
