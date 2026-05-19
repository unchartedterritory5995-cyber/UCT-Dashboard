"""
Regression tests for plan resolution — specifically that a *comped* user
(granted free Pro access via the admin "Comp Access" button) actually
resolves to the 'pro' plan that AuthGuard requires.

Root cause guarded here: comp_user_access() writes subscriptions
(plan='pro', status='comped'), but get_user_plan() historically only
honored status IN ('active','trialing'), so comped users read back as
'free' and were confined to FREE_PAGES.
"""

import pytest

from api.services import auth_db
from api.services.auth_service import (
    create_user,
    comp_user_access,
    get_user_plan,
    upsert_subscription,
)


@pytest.fixture()
def temp_auth_db(tmp_path, monkeypatch):
    db_path = str(tmp_path / "auth_test.db")
    monkeypatch.setattr(auth_db, "_DB_PATH", db_path)
    auth_db.init_db()
    return db_path


def test_comped_user_resolves_to_pro(temp_auth_db):
    """The exact bug: comping a user must grant 'pro' access."""
    user = create_user("comped@example.com", "pw12345")
    comp_user_access("comped@example.com", grant=True)
    assert get_user_plan(user["id"]) == "pro"


def test_revoked_comp_falls_back_to_free(temp_auth_db):
    user = create_user("revoked@example.com", "pw12345")
    comp_user_access("revoked@example.com", grant=True)
    comp_user_access("revoked@example.com", grant=False)
    assert get_user_plan(user["id"]) == "free"


def test_active_subscription_is_pro(temp_auth_db):
    """Positive control — normal paying subscriber still works."""
    user = create_user("paid@example.com", "pw12345")
    upsert_subscription(user["id"], "cus_x", "sub_x", "pro", "active")
    assert get_user_plan(user["id"]) == "pro"


def test_no_subscription_is_free(temp_auth_db):
    """Positive control — a brand-new user with no subscription is free."""
    user = create_user("free@example.com", "pw12345")
    assert get_user_plan(user["id"]) == "free"
