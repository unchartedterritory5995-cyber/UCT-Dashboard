"""
Card-required 7-day trial at Stripe checkout (api/services/stripe_service.py).

Covers:
  * is_trial_eligible — never-subscribed → True; prior stripe_subscription_id
    → False; store error → False (defensive, never accidentally grant).
  * create_checkout_session — trial_days=7 sets subscription_data.
    trial_period_days AND payment_method_collection="always" (card required on
    the $0-today invoice); trial_days=None leaves both out (plain checkout for
    returning subscribers).

Stripe is never called for real: `stripe.checkout.Session.create` is
monkeypatched to capture params.
"""

import pytest

from api.services import stripe_service


class _FakeSession:
    url = "https://checkout.stripe.test/session"


@pytest.fixture()
def captured(monkeypatch):
    """Capture Session.create params; no subscription row by default."""
    box = {}

    def _create(**params):
        box.update(params)
        return _FakeSession()

    monkeypatch.setattr(stripe_service.stripe.checkout.Session, "create", _create)
    monkeypatch.setattr(stripe_service, "get_subscription", lambda uid: None)
    return box


# ── is_trial_eligible ────────────────────────────────────────────────────────

def test_eligible_when_never_subscribed(monkeypatch):
    monkeypatch.setattr(stripe_service, "get_subscription", lambda uid: None)
    assert stripe_service.is_trial_eligible("u1") is True


def test_eligible_when_row_has_no_subscription_id(monkeypatch):
    monkeypatch.setattr(
        stripe_service, "get_subscription",
        lambda uid: {"stripe_customer_id": "cus_1", "stripe_subscription_id": ""},
    )
    assert stripe_service.is_trial_eligible("u1") is True


def test_not_eligible_after_any_prior_subscription(monkeypatch):
    monkeypatch.setattr(
        stripe_service, "get_subscription",
        lambda uid: {"stripe_customer_id": "cus_1", "stripe_subscription_id": "sub_1"},
    )
    assert stripe_service.is_trial_eligible("u1") is False


def test_not_eligible_on_store_error(monkeypatch):
    def _boom(uid):
        raise RuntimeError("db down")
    monkeypatch.setattr(stripe_service, "get_subscription", _boom)
    assert stripe_service.is_trial_eligible("u1") is False


# ── create_checkout_session trial params ─────────────────────────────────────

def test_trial_checkout_sets_trial_and_requires_card(captured):
    url = stripe_service.create_checkout_session(
        "u1", "t@example.com", "https://x/s", "https://x/c",
        billing="monthly", trial_days=stripe_service.TRIAL_PERIOD_DAYS,
    )
    assert url == _FakeSession.url
    assert captured["subscription_data"] == {"trial_period_days": 7}
    assert captured["payment_method_collection"] == "always"
    assert captured["mode"] == "subscription"
    assert captured["metadata"] == {"user_id": "u1"}


def test_plain_checkout_has_no_trial(captured):
    stripe_service.create_checkout_session(
        "u1", "t@example.com", "https://x/s", "https://x/c",
        billing="monthly", trial_days=None,
    )
    assert "subscription_data" not in captured
    assert "payment_method_collection" not in captured


def test_trial_checkout_annual_price_when_configured(captured, monkeypatch):
    monkeypatch.setattr(stripe_service, "STRIPE_PRICE_ID_ANNUAL", "price_annual")
    stripe_service.create_checkout_session(
        "u1", "t@example.com", "https://x/s", "https://x/c",
        billing="annual", trial_days=7,
    )
    assert captured["line_items"] == [{"price": "price_annual", "quantity": 1}]
    assert captured["subscription_data"] == {"trial_period_days": 7}
