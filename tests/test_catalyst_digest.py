"""Tests for the morning catalyst digest (build_digest + send_digest)."""
import inspect

import api.services.alert_routing as ar
import api.services.alerts as alerts_svc
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
    # ⚠️ `url=` IS PART OF THE CONTRACT NOW (TERM-011 step 6 row 10). A one-argument
    # stub raises TypeError, the module's try/except swallows it, and `out["discord"]`
    # reads False — a conversion failure wearing the costume of a send failure.
    monkeypatch.setattr(dn, "_send_webhook",
                        lambda e, url=None: dsent.append((e, url)))
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


# ══════════════════════════════════════════════════════════════════════════════
#  TERM-011 / RM-N09 step 6 row 10 — the conversion, and the duplicate it exposed.
#
#  ⛔ TWO SEPARABLE CHANGES ARE RAILED HERE AND THEY ARE NOT THE SAME CHANGE:
#     (a) the Discord leg resolves the OPS class instead of door C's captured value;
#     (b) the BELL leg stops posting the digest to Discord once per admin.
#  (b) is a live daily duplicate that predates this ticket and is fixed on its own.
# ══════════════════════════════════════════════════════════════════════════════

def _send(monkeypatch, sink):
    monkeypatch.setenv("CATALYST_DIGEST_ENABLED", "1")
    monkeypatch.setattr(digest.store, "get_for_date",
                        lambda md, ranked_only=True: _rows("A"))
    monkeypatch.setattr(digest, "_admin_recipients", lambda: [("admin1", "a@b.com")])
    monkeypatch.setattr(dn, "_send_webhook", lambda e, url=None: None)
    monkeypatch.setattr(es, "send_email", lambda to, s, h: True)
    monkeypatch.setattr(wal, "deliver_alert_payload", lambda **k: sink.append(k))
    return digest.send_digest("2026-06-10")


def test_the_discord_leg_is_handed_the_OPS_destination_not_door_Cs_captured_value(monkeypatch):
    """⭐ (a). With DISCORD_OPS_WEBHOOK_URL blank — production's state — the value handed
    to door C's sender is DISCORD_WEBHOOK_URL's, so the post lands where it lands today.
    """
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, "https://discord.test/TODAY")
    monkeypatch.setenv(ar.OPS_WEBHOOK_ENV, "")
    monkeypatch.setenv(ar.ROUTING_FLAG_ENV, "1")
    sent: list = []
    monkeypatch.setenv("CATALYST_DIGEST_ENABLED", "1")
    monkeypatch.setattr(digest.store, "get_for_date",
                        lambda md, ranked_only=True: _rows("A"))
    monkeypatch.setattr(digest, "_admin_recipients", lambda: [("admin1", "a@b.com")])
    monkeypatch.setattr(dn, "_send_webhook", lambda e, url=None: sent.append(url))
    monkeypatch.setattr(es, "send_email", lambda to, s, h: True)
    monkeypatch.setattr(wal, "deliver_alert_payload", lambda **k: None)
    digest.send_digest("2026-06-10")
    assert sent == ["https://discord.test/TODAY"]

    # ⛔ THE CONTROL. Without it this passes on a caller that hard-codes the admin
    # variable and was never converted at all.
    sent.clear()
    monkeypatch.setenv(ar.OPS_WEBHOOK_ENV, "https://discord.test/OPS-ONLY")
    digest.send_digest("2026-06-10")
    assert sent == ["https://discord.test/OPS-ONLY"]


def test_the_bell_leg_passes_a_severity_that_does_NOT_fire_discord(monkeypatch):
    """⛔⛔ (b) THE LIVE DAILY DUPLICATE. This call used to pass NO severity, so it took
    `deliver_alert_payload`'s `warning` default, and `add_alert` fires Discord on
    warning/critical — once per admin recipient, in the loop, on top of the digest's own
    single post. ⭐ And the two variables involved are the SAME value in production
    (measured 2026-09-27), so those copies landed in the SAME room, not a second one.

    ⛔ DERIVED, NOT TYPED: the firing set comes from `alerts.py`'s own constants, so a
    future change to which severities page cannot leave this rail asserting a stale word.
    """
    sink: list = []
    _send(monkeypatch, sink)
    assert len(sink) == 1
    firing = (alerts_svc.SEVERITY_WARNING, alerts_svc.SEVERITY_CRITICAL)
    assert "severity" in sink[0], (
        "the bell leg passes no severity again, so it takes the loud default")
    assert sink[0]["severity"] not in firing, sink[0]["severity"]


def test_the_CONTROL_the_default_severity_really_is_the_loud_one(monkeypatch):
    """⛔ NON-VACUITY for the rail above, in two halves.

    Without the first half, "not in the firing set" would pass on a default that never
    fired and there would have been no duplicate to fix. Without the second, it would
    pass on an `add_alert` that no longer posts to Discord for any severity.
    """
    default = inspect.signature(wal.deliver_alert_payload).parameters["severity"].default
    firing = (alerts_svc.SEVERITY_WARNING, alerts_svc.SEVERITY_CRITICAL)
    assert default in firing, (
        f"`deliver_alert_payload`'s severity default is {default!r}, which no longer "
        f"fires Discord — the duplicate this test documents cannot occur and the rail "
        f"above is now vacuous. Re-derive it.")

    monkeypatch.setenv(alerts_svc.DISCORD_WEBHOOK_ENV, "https://discord.test/DOOR-A")
    monkeypatch.setattr(alerts_svc, "_fire_discord", lambda alert: True)

    loud: dict = {}
    alerts_svc.add_alert("catalyst_digest", "t", "m", severity=default,
                         user_id="admin1", channels=loud)
    assert loud[alerts_svc.CHANNEL_DISCORD] == alerts_svc.CHANNEL_OK, loud

    quiet: dict = {}
    sink: list = []
    _send(monkeypatch, sink)
    alerts_svc.add_alert("catalyst_digest", "t", "m", severity=sink[0]["severity"],
                         user_id="admin1", channels=quiet)
    assert quiet[alerts_svc.CHANNEL_DISCORD] == alerts_svc.CHANNEL_SKIPPED, quiet
