"""🔴 A MEMBER'S PRIVATE ALERT REACHED A SHARED ADMIN CHANNEL.

`DISCORD_ALERT_WEBHOOK` is ONE global destination. `alerts.add_alert` fired it
for any alert whose `severity` was warning or critical — and
`deliver_alert_payload`, the door every member-private producer goes through,
defaults `severity` to `"warning"`. So a member's own condition alert ("TSLA
Trend Up became true", with their symbol, their formula's name and the value)
was posted to a channel shared by whoever can read it, although Discord is not
offered to members anywhere and nobody selected it.

⛔ THE MECHANISM WAS THE DEFECT, NOT THE SETTING. Severity is a PRESENTATION
field — it drives the member's own bell (gold border for warning, green for
info) — and it was also, silently, the audience boundary. `ai_search_briefings`
hit this in the 2026-08-28 review and worked around it by passing
`severity="info"`, which fixed one producer by making a presentation field carry
a routing decision. `allow_admin_discord` is that decision said out loud.

⚠️ AND THE DEFAULT STAYS `True`, so the genuinely admin/global producers — the
wire watchdog, the exposure gate, and `alerts.py`'s own broadcast helpers, none
of which pass a `user_id` — are untouched. The rail at the bottom is what makes
a forgotten call site FAIL instead of leak.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

from api.services import alerts as alerts_svc
from api.services import watchlist_alert_service as wls


@pytest.fixture
def discord(monkeypatch, tmp_path):
    """Record what WOULD have been posted. Nothing leaves the process."""
    posted: list = []
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(alerts_svc, "_DISCORD_WEBHOOK", "https://discord.example/NEVER-CALLED")
    monkeypatch.setattr(alerts_svc, "_fire_discord", lambda alert: (posted.append(alert), True)[1])
    monkeypatch.setattr(wls, "_get_user_email", lambda uid: None)
    monkeypatch.setattr(wls, "send_email", lambda *a, **k: True)
    from api.services import indicator_alert_service as ias
    monkeypatch.setattr(ias, "claim_delivery", lambda *a, **k: True)
    return posted


def _deliver(**kw):
    base = dict(user_id="member-123", sym="TSLA", title="TSLA Trend Up alert",
                message="TSLA Trend Up becomes true", source="indicator_alert",
                extra_data={"alert_id": 1})
    base.update(kw)
    return wls.deliver_alert_payload(**base)


def test_a_member_private_alert_does_NOT_reach_the_admin_channel(discord):
    """⛔⛔ THE DEFECT, CLOSED. This posted before `allow_admin_discord` existed."""
    report = _deliver(allow_admin_discord=False)
    assert discord == [], (
        "a member's private alert was posted to the shared admin Discord channel")
    assert report["channels"]["discord"] == "skipped"
    # ⚠️ SKIPPED, NEVER FAILED — `failed` releases the delivery lease and the next
    # cycle retries, so a suppressed channel would be retried forever.
    assert report["channels_failed"] == 0


def test_suppression_does_not_touch_the_members_OWN_notification(discord):
    """⭐ THE MEMBER STILL GETS THEIR ALERT. Only the shared channel loses it."""
    report = _deliver(allow_admin_discord=False)
    assert report["channels"]["in_app"] == "ok"


def test_severity_is_UNCHANGED_and_is_not_the_boundary(discord):
    """⛔ THE FIX IS NOT `severity="info"`.

    A suppressed alert keeps `warning`, so the member's bell still renders it
    with the urgency it has always had. Routing and presentation are now two
    switches, which is the whole point.
    """
    captured = {}
    real = alerts_svc.add_alert

    def spy(*a, **kw):
        captured.update(kw)
        return real(*a, **kw)

    import api.services.watchlist_alert_service as m
    m.add_alert = spy
    try:
        _deliver(allow_admin_discord=False)
    finally:
        m.add_alert = real
    assert captured["severity"] == "warning"
    assert captured["allow_admin_discord"] is False


def test_an_INTENTIONALLY_ADMIN_alert_still_reaches_the_channel(discord):
    """⛔⛔ THE OTHER HALF. A broadcast with no `user_id` is operator traffic and
    must be unaffected — the wire watchdog is the live example, and losing it
    would be an outage nobody is told about."""
    alerts_svc.add_alert(
        "wire_missed", "Morning wire MISSED its run",
        "the engine laptop is likely off", severity="critical")
    assert len(discord) == 1
    assert discord[0]["user_id"] is None


def test_the_default_is_unchanged_so_nothing_existing_moved(discord):
    """⚠️ Calling the gate exactly as every pre-existing caller does still fires."""
    alerts_svc.add_alert("regime_change", "Regime: Markup", "msg", severity="warning")
    assert len(discord) == 1


# ─── the rail ────────────────────────────────────────────────────────────────

_HUB = "deliver_alert_payload"


def _call_sites() -> list[tuple[str, int, bool]]:
    """Every call to the member-private delivery hub, and whether it suppresses."""
    root = pathlib.Path(__file__).resolve().parents[1] / "api"
    out: list[tuple[str, int, bool]] = []
    for path in root.rglob("*.py"):
        if path.name.startswith("test_"):
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:                                    # pragma: no cover
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            fn = node.func
            name = getattr(fn, "attr", None) or getattr(fn, "id", None)
            if name != _HUB:
                continue
            # the definition itself is not a call site
            explicit = any(
                kw.arg == "allow_admin_discord"
                and isinstance(kw.value, ast.Constant) and kw.value.value is False
                for kw in node.keywords)
            out.append((str(path.relative_to(root.parent)), node.lineno, explicit))
    return out


def test_every_member_private_producer_suppresses_the_admin_channel():
    """⛔⛔ THE RAIL, AND IT IS WHY THE DEFAULT MAY STAY `True`.

    `user_id` is this hub's FIRST and REQUIRED parameter, so everything delivered
    through it is member-private by construction. Flipping the default would fix
    the same producers while making the decision INVISIBLE at the call sites —
    and an audience decision nobody can see at the point of delivery is exactly
    how this defect happened. So the default is loud, and forgetting it fails
    HERE rather than leaking in production.
    """
    sites = _call_sites()
    assert sites, "the rail found no call sites — it has stopped watching anything"
    missing = [f"{f}:{n}" for f, n, ok in sites if not ok]
    assert not missing, (
        "these member-private delivery sites do not suppress the shared admin "
        "Discord channel:\n  " + "\n  ".join(missing))
