"""TERM-011 / RM-N09 rows 1, 3, 4, 5 + step 7 — implemented in code.

docs/terminal-research/07-technical-architecture/term-011-routing-decisions.md,
ruling commit `231c51a59`. This is the DELIVERABLE the plumbing rails
(`test_alert_destination.py`, `test_alert_routing.py`) do not prove: that
`api/services/alerts.py::add_alert` actually applies the two ruled decisions,
at the wire, not just that the resolver they lean on works in isolation.

⛔ TWO SEPARABLE CHANGES, BOTH RAILED HERE, NEITHER SUBSTITUTES FOR THE OTHER:

  (1) Rows 1/3 — `regime_change`/`exposure_shift` (the two LIVE broadcast
      types; see `alerts.py`'s own header table) resolve their Discord copy
      through `alert_destination.ops_webhook()` instead of the admin webhook.
      The member bell entry is completely untouched — this is a DESTINATION
      change, never a delivery-or-not change.
  (2) Rows 4/5 + step 7 — a PRIVATE alert (`user_id` set) retires its Discord
      leg outright, whatever its severity. `severity` keeps ranking, colouring
      and glyphing the in-app row; it no longer decides Discord for one.

⛔ SCOPED RUN ONLY, same box constraints as the sibling files:
`python -m pytest tests/test_term011_rows1_3_4_5_step7_alerts_gate.py
tests/test_alert_destination.py tests/test_alerts_privacy.py
tests/test_alert_delivery_channel_truth.py -q`. Never an unscoped pytest here.
"""
from __future__ import annotations

import pytest

from api.services import alerts as alerts_svc


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    """Every OPS/BUSINESS/admin/routing-flag variable, blanked before each
    test. Without this, a variable left set by an earlier test in the same
    process (env vars are process-global) would silently pick this test's
    destination for it."""
    for name in (
        alerts_svc.DISCORD_WEBHOOK_ENV,   # "DISCORD_ALERT_WEBHOOK"
        "DISCORD_WEBHOOK_URL",
        "DISCORD_OPS_WEBHOOK_URL",
        "DISCORD_BUSINESS_WEBHOOK_URL",
        "ALERT_ROUTING_ENABLED",
    ):
        monkeypatch.delenv(name, raising=False)


def _posts(monkeypatch):
    """Count REAL webhook posts, same technique as `test_alerts_privacy.py`'s
    `discord_posts` fixture: patch `requests.post`, leave `_fire_discord`
    alone, so what is under test is the URL `_fire_discord` is actually handed
    — not a proxy for it."""
    import requests
    sent: list[dict] = []

    def _post(url, **kw):
        sent.append({"url": url, **kw})
        class _R:
            status_code = 204
        return _R()

    monkeypatch.setattr(requests, "post", _post)
    return sent


# ══════════════════════════════════════════════════════════════════════════
#  ROWS 1/3 — regime_change / exposure_shift resolve through ops_webhook()
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("alert_type,factory", [
    ("regime_change", lambda: alerts_svc.alert_regime_change("Markup", "Distribution", 45)),
    ("exposure_shift", lambda: alerts_svc.alert_exposure_shift(30, 55, "up")),
])
def test_the_two_live_broadcast_types_go_to_the_OPS_destination_not_the_admin_one(
    alert_type, factory, monkeypatch,
):
    """⭐⭐ THE ROWS 1/3 DELIVERABLE. With `DISCORD_OPS_WEBHOOK_URL` SET to a
    room distinct from `DISCORD_ALERT_WEBHOOK`, the post must land in the OPS
    room — proving the destination genuinely moved, not merely that the byte-
    identical-today fallback happens to agree with the old value."""
    sent = _posts(monkeypatch)
    monkeypatch.setenv(alerts_svc.DISCORD_WEBHOOK_ENV, "https://discord.test/ADMIN-ROOM")
    monkeypatch.setenv("DISCORD_OPS_WEBHOOK_URL", "https://discord.test/OPS-ROOM")

    factory()

    assert len(sent) == 1, (
        f"{alert_type} produced {len(sent)} webhook post(s), expected exactly 1")
    assert sent[0]["url"] == "https://discord.test/OPS-ROOM", (
        f"{alert_type}'s Discord copy did not move to the ops destination: {sent[0]['url']!r}")


@pytest.mark.parametrize("alert_type,factory", [
    ("regime_change", lambda: alerts_svc.alert_regime_change("Markup", "Distribution", 45)),
    ("exposure_shift", lambda: alerts_svc.alert_exposure_shift(30, 55, "up")),
])
def test_with_the_ops_variable_UNSET_the_destination_is_BYTE_IDENTICAL_to_today(
    alert_type, factory, monkeypatch,
):
    """⭐ THE PACKET'S OWN CLAIM, PROVED RATHER THAN QUOTED: §6 measured
    `DISCORD_OPS_WEBHOOK_URL` absent on every Railway service today. With it
    absent here too, `ops_webhook()`'s fallback (`ADMIN_WEBHOOK_ENV` =
    `DISCORD_WEBHOOK_URL`) must resolve to the SAME url the admin webhook
    would have used — the observable change on day one is none.
    """
    sent = _posts(monkeypatch)
    # DISCORD_OPS_WEBHOOK_URL left unset by the autouse fixture.
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.test/ADMIN-ROOM")

    factory()

    assert len(sent) == 1, sent
    assert sent[0]["url"] == "https://discord.test/ADMIN-ROOM", (
        f"{alert_type} moved destination even with the ops variable unset: "
        f"{sent[0]['url']!r}")


def test_the_member_bell_is_UNCHANGED_by_the_destination_move(monkeypatch):
    """Rows 1/3 are a DESTINATION change, never a delivery-or-not change — the
    broadcast bell entry every member reads must be identical whichever room
    the Discord copy lands in."""
    from api.services.cache import cache
    cache.invalidate("alerts")

    monkeypatch.setenv("DISCORD_OPS_WEBHOOK_URL", "https://discord.test/OPS-ROOM")
    _posts(monkeypatch)

    alerts_svc.alert_regime_change("Markup", "Distribution", 45)

    broadcast = cache.get("alerts") or []
    assert broadcast and broadcast[0]["type"] == "regime_change"
    assert broadcast[0]["severity"] == alerts_svc.SEVERITY_CRITICAL, (
        "the severity that colours/glyphs the member's bell moved — rows 1/3 "
        "must never demote it")
    assert broadcast[0]["user_id"] is None, "the broadcast audience moved"


def test_an_UNROUTED_broadcast_type_still_uses_the_admin_webhook_unchanged(monkeypatch):
    """Every broadcast type NOT in `_OPS_ROUTED_TYPES` must be completely
    unaffected by rows 1/3 — the ops variable existing must not leak into a
    type nobody classed."""
    sent = _posts(monkeypatch)
    monkeypatch.setenv(alerts_svc.DISCORD_WEBHOOK_ENV, "https://discord.test/ADMIN-ROOM")
    monkeypatch.setenv("DISCORD_OPS_WEBHOOK_URL", "https://discord.test/OPS-ROOM")

    # `scanner_match`'s own default severity is INFO (never fires Discord at
    # all) -- `severity="critical"` is explicit so this test is actually about
    # the destination, not a second way to prove the severity gate.
    alerts_svc.add_alert("scanner_match", "Scanner: NVDA (92pts)",
                         "NVDA scored 92/110 — VCP", severity="critical")

    assert len(sent) == 1, sent
    assert sent[0]["url"] == "https://discord.test/ADMIN-ROOM", (
        "an unrelated broadcast type was pulled into the ops destination")


# ══════════════════════════════════════════════════════════════════════════
#  ROWS 4/5 + STEP 7 — a private alert's Discord leg is retired outright
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("severity", [
    alerts_svc.SEVERITY_WARNING, alerts_svc.SEVERITY_CRITICAL,
])
def test_a_private_alert_NEVER_reaches_discord_whatever_its_severity(severity, monkeypatch):
    """⭐⭐ THE ROWS 4/5 DELIVERABLE. `severity="warning"`/`"critical"` used to
    be the ONLY thing deciding Discord — 11 of the 13 `deliver_alert_payload`
    call sites pass no severity at all and inherit its `"warning"` default, so
    this is the exact shape that flooded the admin channel with private
    member alerts."""
    sent = _posts(monkeypatch)
    monkeypatch.setenv(alerts_svc.DISCORD_WEBHOOK_ENV, "https://discord.test/ADMIN-ROOM")
    monkeypatch.setenv("DISCORD_OPS_WEBHOOK_URL", "https://discord.test/OPS-ROOM")

    channels: dict = {}
    alerts_svc.add_alert(
        "price_alert", "Alert: NVDA $900.00", "NVDA crossed above $900.00",
        severity=severity, user_id="u_member", channels=channels,
    )

    assert len(sent) == 0, (
        f"a private {severity} alert posted to Discord: {sent}")
    assert channels[alerts_svc.CHANNEL_DISCORD] == alerts_svc.CHANNEL_SKIPPED, channels


def test_a_private_alert_of_an_OPS_ROUTED_TYPE_still_never_fires(monkeypatch):
    """The user_id gate is checked BEFORE the ops-routed-type check in
    `add_alert` — a private alert of a type that WOULD be ops-routed if
    broadcast must still be silent, never accidentally posted to the ops room
    instead of skipped."""
    sent = _posts(monkeypatch)
    monkeypatch.setenv("DISCORD_OPS_WEBHOOK_URL", "https://discord.test/OPS-ROOM")

    channels: dict = {}
    alerts_svc.add_alert(
        "regime_change", "Regime: Distribution", "Market regime shifted.",
        user_id="u_member", channels=channels,
    )

    assert len(sent) == 0, sent
    assert channels[alerts_svc.CHANNEL_DISCORD] == alerts_svc.CHANNEL_SKIPPED


def test_the_private_alerts_in_app_bell_is_UNAFFECTED_by_the_discord_retirement(monkeypatch):
    """The member's own bell — the channel step 7 says carries it instead —
    must still land, unaffected by the Discord leg disappearing."""
    _posts(monkeypatch)
    monkeypatch.setenv(alerts_svc.DISCORD_WEBHOOK_ENV, "https://discord.test/ADMIN-ROOM")

    alert = alerts_svc.add_alert(
        "price_alert", "Alert: NVDA $900.00", "NVDA crossed above $900.00",
        severity="warning", user_id="u_member",
    )

    from api.services.cache import cache
    mine = cache.get("alerts:u:u_member") or []
    assert mine and mine[0]["id"] == alert["id"], (
        "the member's own bell did not receive the alert — step 7 would be "
        "retiring the only channel that reaches them")


def test_a_broadcast_alert_of_the_SAME_type_still_fires(monkeypatch):
    """⭐ NON-VACUITY for the two tests above: if `add_alert` no longer fired
    Discord for ANY caller, "a private alert never fires" would be true for
    the wrong reason. `price_alert` itself is never broadcast in production,
    so this proves the gate keys on `user_id`, not on the alert type."""
    sent = _posts(monkeypatch)
    monkeypatch.setenv(alerts_svc.DISCORD_WEBHOOK_ENV, "https://discord.test/ADMIN-ROOM")

    alerts_svc.add_alert(
        "price_alert", "Alert: NVDA $900.00", "NVDA crossed above $900.00",
        severity="warning", user_id=None,
    )

    assert len(sent) == 1, (
        "a broadcast alert of the same type and severity did not fire — the "
        "gate is keying on something other than user_id")
