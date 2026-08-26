"""The Discord Activity handoff: "Open in Discord" under a chart -> LAUNCH_ACTIVITY,
the channel remembers what it launched, the Activity page asks for it."""
import json
import pytest

from tests.test_discord_chart import _keypair, _app_client, _post, _interaction, UT_GUILD


@pytest.fixture(autouse=True)
def _clean():
    from api.services import discord_activity_handoff as h, discord_interactions as di
    h.clear_for_tests(); di.reset_rate_for_tests()
    yield
    h.clear_for_tests()


def test_handoff_store_keeps_the_newest_per_channel_and_expires():
    from api.services import discord_activity_handoff as h
    h.record("c1", user_id="u1", ticker="nvda", tf="D", prefs={"mas": "off"}, now=1000.0)
    h.record("c1", user_id="u2", ticker="AMD", tf="15", now=1010.0)
    h.record("c2", user_id="u1", ticker="SPY", tf="W", now=1010.0)
    assert h.latest("c1", now=1020.0)["ticker"] == "AMD"                       # newest wins
    assert h.latest("c1", now=1020.0)["tf"] == "15"
    assert h.latest("c2", now=1020.0)["ticker"] == "SPY"
    assert h.latest("c1", now=1010.0 + h.TTL_S + 1) is None                    # expired
    assert h.latest("nope") is None


def test_open_in_discord_button_only_in_activity_guilds_and_it_launches(monkeypatch):
    from api.services import discord_interactions as di
    monkeypatch.setenv("DISCORD_ACTIVITY_GUILDS", "1524909611054792786")
    rows = di.chart_components(di.ChartRequest("NVDA", "D"), dict(di.prefs_mod.DEFAULTS), guild_id="1524909611054792786")
    labels = [b["label"] for b in rows[1]["components"]]
    assert labels[-1] == "Open in Discord" and rows[1]["components"][-1]["custom_id"] == "activity|NVDA|D|house|1"
    rows = di.chart_components(di.ChartRequest("NVDA", "D"), dict(di.prefs_mod.DEFAULTS), guild_id="882293203485720596")
    assert "Open in Discord" not in [b["label"] for b in rows[1]["components"]]   # members' server: not until verified
    rows = di.chart_components(di.ChartRequest("NVDA", "D"), dict(di.prefs_mod.DEFAULTS))
    assert "Open in Discord" not in [b["label"] for b in rows[1]["components"]]
    monkeypatch.setenv("DISCORD_ACTIVITY_GUILDS", "")
    rows = di.chart_components(di.ChartRequest("NVDA", "D"), dict(di.prefs_mod.DEFAULTS), guild_id="1524909611054792786")
    assert "Open in Discord" not in [b["label"] for b in rows[1]["components"]]   # blank = nowhere
    assert di.component_kind({"data": {"custom_id": "activity|NVDA|D|house|1"}}) == "activity"
    assert di.component_kind({"data": {"custom_id": "chart|NVDA|D|house|1"}}) == "chart"
    with pytest.raises(di.CommandError):
        di.component_kind({"data": {"custom_id": "poll|1"}})
    assert di.parse_component({"data": {"custom_id": "activity|NVDA|15|off|0"}}) == di.ChartRequest("NVDA", "15", mas="off", volume=False)


def test_endpoint_activity_click_records_the_handoff_and_answers_launch_activity(monkeypatch):
    from api.services import discord_activity_handoff as h, discord_interactions as di
    from api.services import discord_chart_prefs as p
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, rt = _app_client()
    monkeypatch.setattr(rt.di, "run_chart_job", lambda *a, **k: pytest.fail("a launch must not render"))
    p.set_prefs("77", theme="oled")
    click = {"type": 3, "application_id": "123", "token": "tok", "guild_id": UT_GUILD, "channel_id": "555",
             "member": {"user": {"id": "77"}}, "data": {"custom_id": "activity|NVDA|15|off|1", "component_type": 2}}
    assert _post(client, sk, click).json() == {"type": 12}
    entry = h.latest("555")
    assert (entry["ticker"], entry["tf"], entry["user_id"]) == ("NVDA", "15", "77")
    assert entry["prefs"]["mas"] == "off" and entry["prefs"]["theme"] == "oled"   # the click's state over the member's settings
    r = client.get("/api/discord/activity/handoff", params={"channel_id": "555"})
    assert r.status_code == 200 and r.json()["ticker"] == "NVDA" and r.json()["tf"] == "15" and r.json()["prefs"]["theme"] == "oled"
    assert client.get("/api/discord/activity/handoff", params={"channel_id": "556"}).json() == {"ticker": None, "tf": None, "prefs": None}
    assert client.get("/api/discord/activity/handoff").json()["ticker"] is None
    # the Entry Point command (App Launcher) launches too, recording nothing
    launch = {"type": 2, "application_id": "123", "token": "tok", "guild_id": UT_GUILD, "channel_id": "556",
              "member": {"user": {"id": "77"}}, "data": {"name": "launch", "type": 4}}
    assert _post(client, sk, launch).json() == {"type": 12}
    assert h.latest("556") is None
    # a foreign server cannot launch it either
    assert _post(client, sk, {**click, "guild_id": "999"}).json()["data"]["content"] == di.NOT_ALLOWED_MESSAGE
    p.reset_prefs("77")


def test_chart_reply_components_carry_the_guild_so_the_launch_button_can_be_scoped(monkeypatch):
    from api.services import discord_interactions as di
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    monkeypatch.setenv("DISCORD_ACTIVITY_GUILDS", UT_GUILD)
    client, rt = _app_client()
    seen = {}
    monkeypatch.setattr(rt.di, "run_chart_job", lambda *a, **k: seen.update(k) or "ok")
    assert _post(client, sk, _interaction("NVDA")).json() == {"type": 5}
    rows = seen["components_fn"](di.ChartRequest("NVDA", "D"), dict(di.prefs_mod.DEFAULTS))
    assert rows[1]["components"][-1]["label"] == "Open in Discord"


def test_launch_command_is_an_admin_only_entry_point_registered_only_on_request():
    from api.services.discord_interactions import build_commands, build_launch_command
    assert [c["name"] for c in build_commands()] == ["chart", "c", "chartsettings"]
    cmds = {c["name"]: c for c in build_commands(activity=True)}
    launch = cmds["launch"]
    assert launch["type"] == 4 and launch["handler"] == 1 and launch["default_member_permissions"] == "8"
    assert launch["integration_types"] == [0] and launch["contexts"] == [0]
    assert build_launch_command()["description"]
