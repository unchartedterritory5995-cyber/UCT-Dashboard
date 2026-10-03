"""AC-2 (one channel registry) and AC-7 (ops monitor + channel health)."""
from __future__ import annotations

import pathlib
import re

import pytest

from api.services import alerts as alerts_svc
from api.services.alert_taxonomy import channels, ops_monitor, receipts, registry
from api.services.alert_taxonomy import db as at_db

_API = pathlib.Path(__file__).resolve().parents[1] / "api"
_LITERAL = re.compile(r"[\"'](DISCORD_[A-Z0-9_]*WEBHOOK[A-Z0-9_]*)[\"']")


# ── AC-2 ─────────────────────────────────────────────────────────────────────

def _census() -> set[str]:
    found = set()
    for p in _API.rglob("*.py"):
        found |= set(_LITERAL.findall(p.read_text(encoding="utf-8", errors="replace")))
    return found


def test_every_discord_webhook_the_estate_reads_is_in_the_registry():
    found = _census()
    assert len(found) >= 10                       # the census can see them at all
    assert found - set(channels.LEGACY_WEBHOOKS) == set(), \
        "a Discord webhook variable outside the one channel registry"


def test_CONTROL_the_census_would_see_a_new_name(tmp_path):
    p = tmp_path / "x.py"
    p.write_text('os.environ.get("DISCORD_SHINY_NEW_WEBHOOK_URL")', encoding="utf-8")
    assert _LITERAL.findall(p.read_text()) == ["DISCORD_SHINY_NEW_WEBHOOK_URL"]


def test_one_entry_per_channel_kind_never_per_alert_type():
    assert set(channels.REGISTRY) == {"in_app", "email", "discord", "push", "browser",
                                      "sound", "webhook"}
    assert {k for k, _ in [(v[0], 0) for v in channels.LEGACY_WEBHOOKS.values()]} == \
        set(channels._BY_PURPOSE)                 # purposes are unique


@pytest.mark.parametrize("name", sorted(channels.LEGACY_WEBHOOKS))
def test_the_migration_keeps_every_existing_hook_resolving_identically(name, monkeypatch):
    purpose = channels.LEGACY_WEBHOOKS[name][0]
    monkeypatch.setenv(name, f"https://discord.test/{name}")
    assert channels.resolve_webhook(purpose) == f"https://discord.test/{name}"
    monkeypatch.setenv(name, "")                  # blank is OFF, read per call
    assert channels.resolve_webhook(purpose) == ""


def test_the_alert_owner_reads_the_same_value_armed_or_dark(monkeypatch):
    monkeypatch.setenv("DISCORD_ALERT_WEBHOOK", "https://discord.test/alerts")
    monkeypatch.delenv(channels.FLAG, raising=False)
    dark = alerts_svc.discord_webhook()
    monkeypatch.setenv(channels.FLAG, "1")
    assert alerts_svc.discord_webhook() == dark == "https://discord.test/alerts"
    monkeypatch.setenv("DISCORD_ALERT_WEBHOOK", "")
    assert alerts_svc.discord_webhook() == ""


def test_an_unknown_purpose_resolves_to_nothing_never_another_room(monkeypatch):
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.test/general")
    assert channels.resolve_webhook("no-such-purpose") == ""


def test_describe_carries_names_never_values(monkeypatch):
    monkeypatch.setenv("DISCORD_ALERT_WEBHOOK", "https://secret.example/abc")
    blob = repr(channels.describe())
    assert "secret.example" not in blob and "DISCORD_ALERT_WEBHOOK" in blob


# ── AC-7 ─────────────────────────────────────────────────────────────────────

@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(at_db, "DB_PATH", str(tmp_path / "alert_taxonomy.db"))
    monkeypatch.setenv("RESEND_API_KEY", "x")
    return monkeypatch


def _fire(n, chans, ttype="document-arrival"):
    fid = receipts.record_fire("p", ttype, "u1", "AAPL", f"k{n}", as_of=1.0)
    receipts.record_delivery_channels(fid, chans)


def test_PRD_7_a_failing_source_is_NAMED_per_type_not_collapsed(store):
    registry.register_trigger_type("document-arrival", {}, "m")
    registry.register_trigger_type("rating-change", {}, "m")
    registry.register_trigger_type("price-level", {}, "m")
    ops_monitor.record_sweep("document-arrival", evaluated=10, fired=2, could_not_evaluate=0)
    ops_monitor.record_sweep("rating-change", evaluated=4, fired=0, could_not_evaluate=6)
    t = ops_monitor.report()["trigger_types"]
    assert t["document-arrival"] == {**t["document-arrival"], "evaluated": 10, "fired": 2,
                                     "could_not_evaluate": 0, "status": "clean"}
    assert t["rating-change"]["could_not_evaluate"] == 6 and t["rating-change"]["status"] == "degraded"
    # A type that did not run checked nothing -- never reported "clean".
    assert t["price-level"]["status"] == "no-runs"


def test_PRD_8_one_channel_down_is_flagged_while_the_bell_still_delivers(store):
    for i in range(4):
        _fire(i, {"in_app": "ok", "email": "failed"})
    rows = {c["kind"]: c for c in ops_monitor.report()["channels"]}
    assert rows["email"]["status"] == "degraded" and rows["email"]["failed"] == 4
    assert rows["in_app"]["status"] == "ok" and rows["in_app"]["ok"] == 4


def test_withheld_fires_are_counted_apart_never_as_channel_failures(store):
    _fire(1, {"routing": "suspended"})
    _fire(2, {"queue": "capped"})
    rep = ops_monitor.report()
    assert rep["withheld"] == {"suspended": 1, "capped": 1}
    assert all(c["failed"] == 0 for c in rep["channels"])


def test_an_unconfigured_channel_says_so(store):
    store.delenv("RESEND_API_KEY")
    rows = {c["kind"]: c for c in ops_monitor.report()["channels"]}
    assert rows["email"]["status"] == "unconfigured"
    assert rows["browser"]["configured"] is None             # client-side: unknowable here


def test_record_sweep_never_raises(store, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("disk full")
    monkeypatch.setattr(ops_monitor, "_conn", boom)
    assert ops_monitor.record_sweep("x", evaluated=1, fired=0, could_not_evaluate=0) is False
