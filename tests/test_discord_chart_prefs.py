"""Per-user chart preferences for /chart: the /chartsettings command, storage,
and how preferences shape the render (house URL overrides, cache key, fallback)."""
from __future__ import annotations

import json

import pytest


@pytest.fixture(autouse=True)
def _prefs_db(tmp_path, monkeypatch):
    monkeypatch.setenv("DISCORD_CHART_PREFS_DB_PATH", str(tmp_path / "prefs.db"))
    from api.services import discord_chart_prefs as p
    p.reset_connection_for_tests()
    from api.services import discord_chart_cache as cc
    cc.clear()
    yield


# ── storage + validation ──────────────────────────────────────────────────────

def test_defaults_and_round_trip():
    from api.services import discord_chart_prefs as p
    assert p.get_prefs("u1") == p.DEFAULTS
    out = p.set_prefs("u1", mas="off", volume=False, tf="15")
    assert out == {**p.DEFAULTS, "mas": "off", "volume": False, "tf": "15"}
    assert p.get_prefs("u1") == out
    assert p.get_prefs("u2") == p.DEFAULTS          # isolation
    p.set_prefs("u1", ext=False)                     # partial update keeps the rest
    assert p.get_prefs("u1")["mas"] == "off" and p.get_prefs("u1")["ext"] is False
    assert p.reset_prefs("u1") == p.DEFAULTS
    assert p.get_prefs("u1") == p.DEFAULTS


def test_set_prefs_rejects_unknown_keys_and_values():
    from api.services import discord_chart_prefs as p
    with pytest.raises(ValueError):
        p.set_prefs("u1", tf="7")
    with pytest.raises(ValueError):
        p.set_prefs("u1", mas="fibonacci")
    with pytest.raises(ValueError):
        p.set_prefs("u1", theme="dark")
    assert p.get_prefs("u1") == p.DEFAULTS           # nothing partial was written


def test_describe_is_one_readable_line():
    from api.services import discord_chart_prefs as p
    text = p.describe({**p.DEFAULTS, "mas": "10-20-50", "volume": False, "tf": "60", "ext": False, "stats": True})
    assert "60 min" in text and "SMA 10/20/50" in text and "volume off" in text.lower()
    assert "pre/post" in text.lower() and "stats" in text.lower()
    assert "\n" not in text


# ── preferences → render options ──────────────────────────────────────────────

def test_render_options_for_defaults_touch_nothing():
    from api.services import discord_chart_prefs as p
    opts = p.render_options(p.DEFAULTS)
    assert opts == {"indicators": None, "ext": True, "stats": True}
    assert p.style_signature(p.DEFAULTS) == "default"


def test_render_options_hide_mas_and_volume_via_positional_overlays():
    from api.services import discord_chart_prefs as p
    opts = p.render_options({**p.DEFAULTS, "mas": "off", "volume": False})
    ind = opts["indicators"]
    assert ind["volume"] == {"visible": False}
    # the page's override merge REPLACES arrays wholesale, so every slot must be
    # a complete overlay object (type/period/color/...), not a partial patch
    assert len(ind["overlays"]) == 5 and all(o["enabled"] is False and {"type", "period", "color"} <= set(o) for o in ind["overlays"])
    opts2 = p.render_options({**p.DEFAULTS, "mas": "10-20-50"})
    ov = opts2["indicators"]["overlays"]
    assert [(o["enabled"], o["type"], o["period"]) for o in ov[:3]] == [(True, "SMA", 10), (True, "SMA", 20), (True, "SMA", 50)]
    assert all(o["enabled"] is False for o in ov[3:]) and len(ov) == 5
    assert "volume" not in opts2["indicators"]
    assert p.style_signature({**p.DEFAULTS, "mas": "off", "volume": False}) != p.style_signature(p.DEFAULTS)
    assert p.style_signature({**p.DEFAULTS, "tf": "W"}) == "default"   # tf is not part of the style


# ── command payloads + parsing ────────────────────────────────────────────────

def test_build_commands_has_chart_alias_and_settings_subcommands():
    from api.services.discord_interactions import build_commands, build_chart_command
    cmds = {c["name"]: c for c in build_commands()}
    assert set(cmds) == {"chart", "c", "chartsettings"}
    assert cmds["chart"] == build_chart_command()
    assert cmds["c"]["options"] == cmds["chart"]["options"]
    subs = {o["name"]: o for o in cmds["chartsettings"]["options"]}
    assert set(subs) == {"show", "set", "reset"} and all(o["type"] == 1 for o in subs.values())
    setopts = {o["name"]: o for o in subs["set"]["options"]}
    assert set(setopts) == {"tf", "mas", "volume", "ext", "stats"}
    assert {c["value"] for c in setopts["mas"]["choices"]} == {"house", "10-20-50", "off"}
    assert setopts["volume"]["type"] == 5 and setopts["ext"]["type"] == 5 and setopts["stats"]["type"] == 5  # BOOLEAN
    assert all(not o.get("required") for o in setopts.values())


def test_parse_chart_command_accepts_alias_and_applies_default_tf():
    from api.services.discord_interactions import parse_chart_command, ChartRequest
    inter = {"type": 2, "data": {"name": "c", "options": [{"name": "ticker", "type": 3, "value": "nvda"}]}}
    assert parse_chart_command(inter, default_tf="15") == ChartRequest("NVDA", "15")
    inter2 = {"type": 2, "data": {"name": "c", "options": [{"name": "ticker", "type": 3, "value": "nvda"},
                                                            {"name": "tf", "type": 3, "value": "W"}]}}
    assert parse_chart_command(inter2, default_tf="15") == ChartRequest("NVDA", "W")  # explicit tf wins


def test_parse_settings_command():
    from api.services.discord_interactions import parse_settings_command, CommandError
    def inter(sub, opts=None):
        return {"type": 2, "data": {"name": "chartsettings", "options": [
            {"name": sub, "type": 1, "options": [{"name": k, "value": v} for k, v in (opts or {}).items()]}]}}
    assert parse_settings_command(inter("show")) == ("show", {})
    assert parse_settings_command(inter("reset")) == ("reset", {})
    assert parse_settings_command(inter("set", {"mas": "off", "volume": False, "tf": "5"})) == \
        ("set", {"mas": "off", "volume": False, "tf": "5"})
    with pytest.raises(CommandError):
        parse_settings_command(inter("set"))                       # nothing to set
    with pytest.raises(CommandError):
        parse_settings_command({"type": 2, "data": {"name": "chartsettings", "options": []}})


def test_interaction_user_id_from_guild_or_dm():
    from api.services.discord_interactions import interaction_user_id
    assert interaction_user_id({"member": {"user": {"id": "42"}}}) == "42"
    assert interaction_user_id({"user": {"id": "7"}}) == "7"
    assert interaction_user_id({}) == ""


# ── the job applies preferences ───────────────────────────────────────────────

class _Edits:
    def __init__(self):
        self.calls = []

    def __call__(self, app_id, token, *, content, png=None, filename=None):
        self.calls.append({"content": content, "png": png, "filename": filename})
        return True


def _daily(n=300):
    import datetime as dt
    day = dt.date(2026, 1, 2); out = []
    px = 100.0
    for i in range(n):
        while day.weekday() >= 5:
            day += dt.timedelta(days=1)
        out.append({"t": day.isoformat(), "o": px, "h": px * 1.01, "l": px * 0.99, "c": px * 1.001, "v": 1_000_000})
        px *= 1.001; day += dt.timedelta(days=1)
    return out


def test_run_chart_job_passes_prefs_render_options_to_the_house_renderer_and_keys_the_cache_by_style():
    from api.services import discord_chart_prefs as p
    from api.services import discord_chart_cache as cc
    from api.services.discord_interactions import run_chart_job, ChartRequest
    seen = []

    def house_fn(tk, tf, stats, options):
        seen.append(options)
        return b"\x89PNG\r\n\x1a\n" + b"house"
    edits = _Edits()
    prefs = {**p.DEFAULTS, "mas": "off", "volume": False, "ext": False, "stats": False}
    assert run_chart_job("1", "t", ChartRequest("NVDA", "15"), bars_fn=lambda *a: _daily(), render_fn=lambda *a, **k: b"",
                         edit_fn=edits, house_fn=house_fn, prefs=prefs) == "ok"
    assert seen[-1]["ext"] is False and seen[-1]["stats"] is False
    assert seen[-1]["indicators"]["volume"] == {"visible": False}
    assert cc.get(f"NVDA:15:{p.style_signature(prefs)}") is not None
    assert cc.get("NVDA:15:default") is None
    # a default-pref user does not get the custom user's cached PNG
    seen.clear()
    assert run_chart_job("1", "t", ChartRequest("NVDA", "15"), bars_fn=lambda *a: _daily(), render_fn=lambda *a, **k: b"",
                         edit_fn=edits, house_fn=house_fn) == "ok"
    assert seen[-1] == {"indicators": None, "ext": True, "stats": True}


def test_fallback_renderer_honours_mas_and_volume_flags():
    from api.services.discord_chart_render import render_chart_png, build_frame
    bars = _daily(200)
    plain = render_chart_png("NVDA", "D", bars, daily_bars=bars, show_mas=False, show_volume=False)
    full = render_chart_png("NVDA", "D", bars, daily_bars=bars)
    assert plain[:8] == b"\x89PNG\r\n\x1a\n" and full[:8] == b"\x89PNG\r\n\x1a\n"
    assert plain != full


def test_house_build_render_url_encodes_indicators_ext_and_stats_options():
    import base64
    from urllib.parse import parse_qs, urlparse
    from api.services.discord_chart_house import build_render_url, HOUSE_H
    opts = {"indicators": {"volume": {"visible": False}}, "ext": False, "stats": False}
    url = build_render_url("NVDA", "15", {"close": 1}, base_url="https://x", token="", options=opts)
    q = parse_qs(urlparse(url).query)
    assert q["ext"] == ["0"] and "stats" not in q and q["h"] == [str(HOUSE_H)]
    raw = q["indicators"][0]; padded = raw.replace("-", "+").replace("_", "/") + "=" * (-len(raw) % 4)
    assert json.loads(base64.b64decode(padded)) == {"volume": {"visible": False}}
    url2 = build_render_url("NVDA", "15", {"close": 1}, base_url="https://x", token="", options={"indicators": None, "ext": True, "stats": True})
    q2 = parse_qs(urlparse(url2).query)
    assert q2["ext"] == ["1"] and "stats" in q2 and "indicators" not in q2


# ── endpoint: /chartsettings replies ephemerally and /chart picks up the saved default tf ──

def test_endpoint_settings_round_trip_and_chart_uses_saved_default_tf(monkeypatch):
    from tests.test_discord_chart import _keypair, _sign, _app_client, _post
    from api.services import discord_chart_prefs as p
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, rt = _app_client()
    member = {"user": {"id": "424242"}}

    def settings(sub, opts=None):
        return {"type": 2, "application_id": "123", "token": "tok", "member": member,
                "data": {"name": "chartsettings", "options": [
                    {"name": sub, "type": 1, "options": [{"name": k, "value": v} for k, v in (opts or {}).items()]}]}}

    r = _post(client, sk, settings("show"))
    assert r.status_code == 200 and r.json()["type"] == 4 and r.json()["data"]["flags"] == 64
    assert "Daily" in r.json()["data"]["content"]

    r = _post(client, sk, settings("set", {"tf": "15", "mas": "off", "volume": False}))
    assert r.json()["data"]["content"].startswith("Saved:")
    assert p.get_prefs("424242") == {**p.DEFAULTS, "tf": "15", "mas": "off", "volume": False}

    r = _post(client, sk, settings("set", {}))
    assert "Nothing to set" in r.json()["data"]["content"]

    scheduled = []

    def fake_job(app_id, token, req, *, bars_fn, render_fn, edit_fn, house_fn=None, prefs=None):
        scheduled.append((req, prefs))
        return "ok"
    monkeypatch.setattr(rt.di, "run_chart_job", fake_job)
    chart = {"type": 2, "application_id": "123", "token": "tok", "member": member,
             "data": {"name": "c", "options": [{"name": "ticker", "type": 3, "value": "nvda"}]}}
    r = _post(client, sk, chart)
    assert r.json() == {"type": 5}
    req, prefs = scheduled[-1]
    assert req == rt.di.ChartRequest("NVDA", "15")          # saved default tf applied through the alias
    assert prefs["mas"] == "off" and prefs["volume"] is False

    r = _post(client, sk, settings("reset"))
    assert r.json()["data"]["content"].startswith("Reset to defaults")
    assert p.get_prefs("424242") == p.DEFAULTS
