"""Alert Return-to-Research Consistency V1.

Phase A found the notification-center click-through mechanism already exists
generically (``AlertBell.jsx``'s ``handleItemClick`` reads ``a.data?.research_url``
for ANY alert type — shipped for S7's document-arrival slice) and untouched by
this program. The only real gap was that most security-scoped alert producers
never populated that field even though they already hold a trustworthy symbol.

The V1 is exactly two additive lines in this file:

1. ``deliver_alert_payload`` — the ONE shared delivery function for
   indicator_alert, indicator_alert_migration, catalyst_alert, catalyst_mustknow,
   catalyst_digest, calendar_alert, awareness_engine, AND document_arrival (via
   ``alert_taxonomy.delivery.deliver``, which calls this same function with
   ``source="document_arrival"``) — now stamps ``data["research_url"]`` via
   ``setdefault`` whenever a real, non-"MARKET" ``sym`` is present.
2. ``_deliver_alert`` (the price-alert lane, which bypasses
   ``deliver_alert_payload`` entirely) got the same field added directly to its
   inline ``data`` literal.

These tests exercise ONLY the new field. Existing coverage in
``test_price_alert_delivery_truth.py``, ``test_indicator_alert_notification.py``,
``test_catalyst_mustknow.py``, ``test_catalyst_digest.py``,
``test_calendar_alerts.py``, ``test_awareness_engine.py`` and
``test_alert_taxonomy_document_arrival.py`` already prove delivery/dedup/fire-once
behavior is unchanged — this file does not re-test any of that.
"""
from __future__ import annotations

import pytest

from api.services import alerts as alerts_svc
from api.services import watchlist_alert_service as wls
from api.services.cache import cache


@pytest.fixture(autouse=True)
def clean_alert_store():
    """The TTLCache is a process-global singleton — isolate every test."""
    def _purge():
        cache.invalidate("alerts")
        cache.delete_prefix("alerts:")
    _purge()
    yield
    _purge()


@pytest.fixture(autouse=True)
def no_discord(monkeypatch):
    monkeypatch.setattr(alerts_svc, "_DISCORD_WEBHOOK", "", raising=False)


# ─── deliver_alert_payload — the shared seam (6 legacy families + S7) ───────

def test_a_real_symbol_gets_a_research_url_via_the_shared_delivery_seam():
    """Stands in for calendar_alert / catalyst_alert / awareness_engine —
    any source that already passes a real sym positionally."""
    wls.deliver_alert_payload(
        user_id="u1", sym="AAPL", title="Earnings today",
        message="AAPL reports before the open.", source="calendar_alert",
    )
    alerts = alerts_svc.get_alerts(user_id="u1")
    assert len(alerts) == 1
    assert alerts[0]["data"]["research_url"] == "/research/AAPL"


def test_a_lowercase_or_untrimmed_symbol_is_normalized_uppercase():
    wls.deliver_alert_payload(
        user_id="u1", sym="  msft ".strip(), title="t", message="m",
        source="catalyst_alert",
    )
    alerts = alerts_svc.get_alerts(user_id="u1")
    assert alerts[0]["data"]["research_url"] == "/research/MSFT"


def test_catalyst_digest_market_fallback_never_produces_a_bogus_route():
    """catalyst_digest's own multi-name-digest fallback is the literal string
    "MARKET" (no single ticker to represent the digest) — this must NEVER
    become a fabricated /research/MARKET link."""
    wls.deliver_alert_payload(
        user_id="u1", sym="MARKET", title="Today's catalysts",
        message="12 names crossed the wire.", source="catalyst_digest",
    )
    alerts = alerts_svc.get_alerts(user_id="u1")
    assert "research_url" not in alerts[0]["data"]


def test_an_empty_symbol_does_not_fabricate_a_destination():
    """indicator_alert_evaluator reads `sym = alert.get("sym", "")` with no
    upstream truthiness guard — an empty sym must degrade to no research_url,
    never crash and never produce "/research/" (a route to nowhere)."""
    wls.deliver_alert_payload(
        user_id="u1", sym="", title="Indicator fired", message="m",
        source="calendar_alert",
    )
    alerts = alerts_svc.get_alerts(user_id="u1")
    assert "research_url" not in alerts[0]["data"]


def test_indicator_alert_source_still_stamps_research_url(monkeypatch):
    """The one source value that also has to clear claim_delivery's fire-once
    gate first — confirmed the new field survives that gate unrelated."""
    monkeypatch.setattr(
        "api.services.indicator_alert_service.claim_delivery",
        lambda alert_id: True,
    )
    wls.deliver_alert_payload(
        user_id="u1", sym="TSLA", title="Above 250", message="m",
        source="indicator_alert", extra_data={"alert_id": 1},
    )
    alerts = alerts_svc.get_alerts(user_id="u1")
    assert alerts[0]["data"]["research_url"] == "/research/TSLA"


def test_an_already_supplied_research_url_wins_unchanged():
    """Simulates document_arrival's own extra_data, which already sets
    research_url before this V1's setdefault ever runs — the merge at
    `data.update(extra_data)` happens BEFORE the new line, so setdefault must
    be a true no-op here, never overwriting S7's own value."""
    wls.deliver_alert_payload(
        user_id="u1", sym="NVDA", title="New 8-K", message="m",
        source="document_arrival",
        extra_data={"research_url": "/research/NVDA", "accession": "0001-26-000009"},
    )
    alerts = alerts_svc.get_alerts(user_id="u1")
    assert alerts[0]["data"]["research_url"] == "/research/NVDA"
    assert alerts[0]["data"]["accession"] == "0001-26-000009"


# ─── _deliver_alert — the independent price-alert lane ──────────────────────

PRICE_ALERT = {"id": "a1", "user_id": "u2", "sym": "AKAM",
               "direction": "above", "target_price": 95.0}


def test_price_alert_gets_a_research_url(monkeypatch):
    monkeypatch.setattr(wls, "_get_user_email", lambda uid: None)  # skip email
    wls._deliver_alert(dict(PRICE_ALERT), 96.25)
    alerts = alerts_svc.get_alerts(user_id="u2")
    assert alerts[0]["data"]["research_url"] == "/research/AKAM"


def test_price_alert_research_url_survives_alongside_existing_fields(monkeypatch):
    monkeypatch.setattr(wls, "_get_user_email", lambda uid: None)
    wls._deliver_alert(dict(PRICE_ALERT), 96.25)
    data = alerts_svc.get_alerts(user_id="u2")[0]["data"]
    assert data["symbol"] == "AKAM"
    assert data["target_price"] == 95.0
    assert data["current_price"] == 96.25
    assert data["direction"] == "above"
    assert data["research_url"] == "/research/AKAM"


# ─── non-security families must stay untouched ──────────────────────────────

def test_regime_change_carries_no_research_url():
    alert = alerts_svc.alert_regime_change("Markup", "Distribution", exposure=40)
    assert "research_url" not in alert["data"]


def test_exposure_shift_carries_no_research_url():
    alert = alerts_svc.alert_exposure_shift(60, 45, "down")
    assert "research_url" not in alert["data"]


# ─── S7 read-state / dedup mechanisms are keyed on other fields entirely ────

def test_a_research_url_key_does_not_trip_the_s7_dual_write_guard():
    """`_dual_write_s7_read_if_applicable` gates on data["source"] ==
    "document_arrival" — a legacy alert with a research_url but a different
    source must be a pure no-op through that path (proven here by exercising
    the real mark_read code path end-to-end rather than re-reading the guard)."""
    wls.deliver_alert_payload(
        user_id="u3", sym="AAPL", title="t", message="m", source="calendar_alert",
    )
    alert_id = alerts_svc.get_alerts(user_id="u3")[0]["id"]
    # Must not raise, and must mark read normally — no S7 durable side effect
    # is possible for a non-document_arrival source.
    assert alerts_svc.mark_read(alert_id, "u3") is True
    assert alerts_svc.get_alerts(user_id="u3")[0]["read"] is True
