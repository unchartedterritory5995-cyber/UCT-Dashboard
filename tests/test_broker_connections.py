"""Tests for broker connection persistence + SnapTrade→j2_account mapping.

Runs against a real temp-file SQLite (not :memory:) so multi-connection
behavior matches production (each service call opens its own connection).
"""

from __future__ import annotations

import importlib

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two.db import ensure_schema


@pytest.fixture
def db(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", Fernet.generate_key().decode())
    # Import after env + path are set so module-level state is clean.
    import api.services.crypto_box as cb
    importlib.reload(cb)
    import api.services.journal_two.broker.connections as conns
    importlib.reload(conns)
    return conns


def _raw_account(snap_id="SNAP-1", number="1234567890", inst="Charles Schwab", typ="margin"):
    return {
        "id": snap_id,
        "name": f"{inst} Individual",
        "number": number,
        "institution_name": inst,
        "type": typ,
        "balance": {"total": {"amount": 5000, "currency": "USD"}},
    }


def test_broker_user_roundtrip(db):
    assert db.get_broker_user("u1") is None
    db.save_broker_user("u1", "snap-uid", "the-secret")
    got = db.get_broker_user("u1")
    assert got["snaptradeUserId"] == "snap-uid"
    assert got["userSecret"] == "the-secret"   # decrypted
    assert got["consentAt"] is not None
    assert db.has_broker_user("u1") is True


def test_broker_user_secret_encrypted_on_disk(db):
    db.save_broker_user("u1", "snap-uid", "plaintext-secret")
    conn = auth_db.get_connection()
    row = conn.execute("SELECT user_secret_enc FROM j2_broker_users WHERE user_id='u1'").fetchone()
    conn.close()
    assert "plaintext-secret" not in row["user_secret_enc"]
    assert row["user_secret_enc"].startswith("v1:")


def test_save_broker_user_preserves_consent_on_update(db):
    db.save_broker_user("u1", "snap-uid", "s1")
    first = db.get_broker_user("u1")["consentAt"]
    # Re-save (e.g. secret rotation) — consent timestamp must persist.
    db.save_broker_user("u1", "snap-uid", "s2", record_consent=False)
    second = db.get_broker_user("u1")
    assert second["userSecret"] == "s2"
    assert second["consentAt"] == first


def test_summarize_account_masks_number():
    import api.services.journal_two.broker.connections as conns
    s = conns.summarize_account(_raw_account(number="987654321"))
    assert s["account_number_masked"] == "••4321"
    assert s["brokerage_name"] == "Charles Schwab"
    assert s["currency"] == "USD"


def test_map_snaptrade_account_creates_j2_account(db):
    from api.services.journal_two import accounts as accounts_service
    ba = db.map_snaptrade_account("u1", _raw_account())
    assert ba["j2AccountId"]
    assert ba["brokerageName"] == "Charles Schwab"
    assert ba["accountNumberMasked"] == "••7890"
    assert ba["syncEnabled"] is True
    assert ba["status"] == "active"

    # The created j2_account is marked broker-sourced.
    acct = accounts_service.get_account("u1", ba["j2AccountId"])
    assert acct is not None
    conn = auth_db.get_connection()
    row = conn.execute("SELECT balance_source FROM j2_accounts WHERE id=?", (ba["j2AccountId"],)).fetchone()
    conn.close()
    assert row["balance_source"] == "broker"


def test_map_snaptrade_account_idempotent(db):
    a = db.map_snaptrade_account("u1", _raw_account())
    b = db.map_snaptrade_account("u1", _raw_account())  # same snap id
    assert a["id"] == b["id"]
    assert a["j2AccountId"] == b["j2AccountId"]
    # Only one broker account + one j2 account created.
    assert len(db.list_broker_accounts("u1")) == 1


def test_map_two_accounts_unique_names(db):
    a = db.map_snaptrade_account("u1", _raw_account(snap_id="S1", number="1111"))
    b = db.map_snaptrade_account("u1", _raw_account(snap_id="S2", number="2222"))
    from api.services.journal_two import accounts as accounts_service
    names = {acc["name"] for acc in accounts_service.list_accounts("u1")}
    assert "Charles Schwab ••1111" in names
    assert "Charles Schwab ••2222" in names
    assert a["j2AccountId"] != b["j2AccountId"]


def test_sync_state_mutations(db):
    ba = db.map_snaptrade_account("u1", _raw_account())
    bid = ba["id"]
    assert db.update_cursor("u1", bid, "2026-06-15") is True
    assert db.set_sync_enabled("u1", bid, False) is True
    assert db.set_status("u1", bid, "broken", error="bad secret") is True
    assert db.record_sync_result("u1", bid, ok=True) is True
    got = db.get_broker_account("u1", bid)
    assert got["activitiesCursor"] == "2026-06-15"
    assert got["syncEnabled"] is False
    assert got["status"] == "broken"
    assert got["lastSyncStatus"] == "ok"
    assert got["lastError"] is None   # cleared on ok sync


def test_delete_broker_user_clears_rows(db):
    db.save_broker_user("u1", "snap-uid", "s")
    db.map_snaptrade_account("u1", _raw_account())
    db.delete_broker_user("u1")
    assert db.get_broker_user("u1") is None
    assert db.list_broker_accounts("u1") == []


def test_bad_status_rejected(db):
    ba = db.map_snaptrade_account("u1", _raw_account())
    with pytest.raises(ValueError):
        db.set_status("u1", ba["id"], "nonsense")


# ── partner-auth repair (prod 2026-07-23) ───────────────────────────────────
#
# When OUR SnapTrade credentials are rejected, every member connection fails at
# once and sync marks each one broken. Both list_due_accounts and
# sync_all_for_user EXCLUDE broken accounts, so fixing the root cause does not
# bring them back — the rows must be reset. The reset must be NARROW: a member
# whose own token genuinely lapsed still has to reconnect.

_PARTNER_401 = ("SnapTrade API error 401: Unauthorized (code 0000) "
                "— Authentication credentials were not provided.")


def test_reset_partner_auth_broken_only_touches_partner_auth_failures(db):
    victim = db.map_snaptrade_account("u1", _raw_account(snap_id="S1", number="1111"))
    genuine = db.map_snaptrade_account("u2", _raw_account(snap_id="S2", number="2222"))
    healthy = db.map_snaptrade_account("u3", _raw_account(snap_id="S3", number="3333"))
    db.set_status("u1", victim["id"], "broken", error=_PARTNER_401)
    db.set_status("u2", genuine["id"], "broken", error="user secret invalid")

    out = db.reset_partner_auth_broken()

    assert out["reset"] == 1
    assert out["resetAccounts"][0]["accountId"] == victim["id"]
    assert out["skipped"] == 1
    assert out["skippedAccounts"][0]["accountId"] == genuine["id"]

    assert db.get_broker_account("u1", victim["id"])["status"] == "active"
    assert db.get_broker_account("u1", victim["id"])["lastError"] is None
    # The genuinely-broken one must NOT be resurrected into a sync loop.
    assert db.get_broker_account("u2", genuine["id"])["status"] == "broken"
    assert db.get_broker_account("u3", healthy["id"])["status"] == "active"


def test_reset_partner_auth_broken_dry_run_writes_nothing(db):
    ba = db.map_snaptrade_account("u1", _raw_account())
    db.set_status("u1", ba["id"], "broken", error=_PARTNER_401)

    out = db.reset_partner_auth_broken(dry_run=True)

    assert out["dryRun"] is True and out["reset"] == 1
    assert db.get_broker_account("u1", ba["id"])["status"] == "broken"


def test_reset_partner_auth_broken_is_a_noop_when_nothing_is_broken(db):
    db.map_snaptrade_account("u1", _raw_account())
    out = db.reset_partner_auth_broken()
    assert out["reset"] == 0 and out["skipped"] == 0
