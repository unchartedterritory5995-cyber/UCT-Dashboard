"""
Stripe integration — checkout sessions, customer portal, webhook handling.
All Stripe interactions isolated here. Nothing else in the codebase touches Stripe.
"""

import os
from datetime import datetime, timezone

import stripe

from api.services.auth_service import (
    get_user_by_id,
    get_subscription_by_stripe_customer,
    upsert_subscription,
    get_subscription,
)

stripe.api_key = os.environ.get("STRIPE_SECRET_KEY")

STRIPE_PRICE_ID_PRO = os.environ.get("STRIPE_PRICE_ID_PRO", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")


def create_checkout_session(user_id: str, user_email: str, success_url: str, cancel_url: str) -> str:
    """Create a Stripe Checkout session and return the URL."""
    # Check if user already has a Stripe customer
    sub = get_subscription(user_id)
    customer_id = sub["stripe_customer_id"] if sub and sub.get("stripe_customer_id") else None

    params = {
        "mode": "subscription",
        "line_items": [{"price": STRIPE_PRICE_ID_PRO, "quantity": 1}],
        "success_url": success_url,
        "cancel_url": cancel_url,
        "metadata": {"user_id": user_id},
    }

    if customer_id:
        params["customer"] = customer_id
    else:
        params["customer_email"] = user_email

    session = stripe.checkout.Session.create(**params)
    return session.url


def create_portal_session(user_id: str, return_url: str) -> str:
    """Create a Stripe Customer Portal session for self-service management."""
    sub = get_subscription(user_id)
    if not sub or not sub.get("stripe_customer_id"):
        raise ValueError("No Stripe customer found for this user")

    session = stripe.billing_portal.Session.create(
        customer=sub["stripe_customer_id"],
        return_url=return_url,
    )
    return session.url


def handle_webhook_event(payload: bytes, sig_header: str) -> dict:
    """
    Process a Stripe webhook event. Returns a summary dict.
    This is the ONLY function that writes subscription data.
    """
    event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    event_type = event["type"]
    data = event["data"]["object"]

    result = {"event_type": event_type, "handled": False}

    if event_type == "checkout.session.completed":
        _handle_checkout_completed(data)
        result["handled"] = True

    elif event_type in (
        "customer.subscription.updated",
        "customer.subscription.deleted",
    ):
        _handle_subscription_change(data)
        result["handled"] = True

    elif event_type == "invoice.payment_failed":
        _handle_payment_failed(data)
        result["handled"] = True

    return result


def _handle_checkout_completed(session_data: dict):
    user_id = session_data.get("metadata", {}).get("user_id")
    if not user_id:
        print(f"[stripe] checkout.session.completed missing user_id in metadata")
        return

    customer_id = session_data.get("customer")
    subscription_id = session_data.get("subscription")

    # Fetch subscription details from Stripe
    if subscription_id:
        sub = stripe.Subscription.retrieve(subscription_id)
        period_end = datetime.fromtimestamp(sub.current_period_end, tz=timezone.utc).isoformat()
        upsert_subscription(
            user_id=user_id,
            stripe_customer_id=customer_id,
            stripe_subscription_id=subscription_id,
            plan="pro",
            status="active",
            current_period_end=period_end,
        )
        print(f"[stripe] User {user_id} subscribed (pro, active)")


def _handle_subscription_change(sub_data: dict):
    customer_id = sub_data.get("customer")
    sub_record = get_subscription_by_stripe_customer(customer_id)
    if not sub_record:
        print(f"[stripe] subscription change for unknown customer {customer_id}")
        return

    status = sub_data.get("status", "active")
    period_end = None
    if sub_data.get("current_period_end"):
        period_end = datetime.fromtimestamp(sub_data["current_period_end"], tz=timezone.utc).isoformat()

    plan = "pro" if status in ("active", "trialing") else "free"
    upsert_subscription(
        user_id=sub_record["user_id"],
        stripe_customer_id=customer_id,
        stripe_subscription_id=sub_data.get("id"),
        plan=plan,
        status=status,
        current_period_end=period_end,
    )
    print(f"[stripe] Subscription updated: user={sub_record['user_id']} status={status}")


def _handle_payment_failed(invoice_data: dict):
    customer_id = invoice_data.get("customer")
    sub_record = get_subscription_by_stripe_customer(customer_id)
    if not sub_record:
        return

    upsert_subscription(
        user_id=sub_record["user_id"],
        stripe_customer_id=customer_id,
        stripe_subscription_id=sub_record.get("stripe_subscription_id"),
        plan=sub_record.get("plan", "pro"),
        status="past_due",
        current_period_end=sub_record.get("current_period_end"),
    )
    print(f"[stripe] Payment failed for user {sub_record['user_id']} — marked past_due")
