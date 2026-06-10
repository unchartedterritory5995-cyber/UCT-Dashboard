"""Tests for the morning catalyst digest (build_digest + send_digest)."""
import api.services.catalyst.digest as digest
import api.services.discord_notify as dn
import api.services.email_service as es
import api.services.watchlist_alert_service as wal


def _rows(*grades):
    return [{"ticker": f"T{i}", "grade": g, "catalyst_type": "M&A",
             "gap_pct": 5.0, "thesis_text": "thesis", "tag": "Catalyst"}
            for i, g in enumerate(grades)]


def test_build_digest_filters_AB(monkeypatch):
    monkeypatch.setattr(digest.store, "get_for_date",
                        lambda md, ranked_only=True: _rows("A", "B", "C"))
    d = digest.build_digest("2026-06-10")
    assert d["count"] == 2  # grade C excluded


def test_build_digest_empty_returns_none(monkeypatch):
    monkeypatch.setattr(digest.store, "get_for_date",
                        lambda md, ranked_only=True: _rows("C"))
    assert digest.build_digest("2026-06-10") is None


def test_send_gated_off_by_default(monkeypatch):
    monkeypatch.delenv("CATALYST_DIGEST_ENABLED", raising=False)
    out = digest.send_digest("2026-06-10")
    assert out["sent"] is False and out["reason"] == "disabled"


def test_send_all_three_channels(monkeypatch):
    monkeypatch.setenv("CATALYST_DIGEST_ENABLED", "1")
    monkeypatch.setattr(digest.store, "get_for_date",
                        lambda md, ranked_only=True: _rows("A", "B", "C"))
    monkeypatch.setattr(digest, "_admin_recipients", lambda: [("admin1", "a@b.com")])
    dsent, esent, asent = [], [], []
    monkeypatch.setattr(dn, "_send_webhook", lambda e: dsent.append(e))
    monkeypatch.setattr(es, "send_email", lambda to, s, h: (esent.append(to) or True))
    monkeypatch.setattr(wal, "deliver_alert_payload", lambda **k: asent.append(k))
    out = digest.send_digest("2026-06-10")
    assert out["sent"] is True and out["count"] == 2
    assert out["discord"] is True and out["email"] == 1 and out["alertbell"] == 1
    assert len(dsent) == 1 and esent == ["a@b.com"] and len(asent) == 1


def test_send_empty_skips(monkeypatch):
    monkeypatch.setenv("CATALYST_DIGEST_ENABLED", "1")
    monkeypatch.setattr(digest.store, "get_for_date", lambda md, ranked_only=True: [])
    out = digest.send_digest("2026-06-10")
    assert out["sent"] is False and out["reason"] == "empty"
