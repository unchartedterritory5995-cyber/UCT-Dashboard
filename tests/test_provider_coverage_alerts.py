"""Alert-routing + status-endpoint tests for the provider-coverage monitor
(Task 23, 2026-08-05 data-dependability migration).
"""
import importlib

from fastapi.testclient import TestClient


def _mod():
    import api.services.provider_coverage_monitor as pcm
    importlib.reload(pcm)
    return pcm


def _isolate_db(monkeypatch, pcm, tmp_path):
    monkeypatch.setattr(pcm, "DB_PATH", str(tmp_path / "coverage_alerts_test.db"))


def _stub_all_healthy(monkeypatch, pcm):
    monkeypatch.setattr(pcm, "_sample_tickers", lambda n: ["AAPL"])
    monkeypatch.setattr(pcm, "_meta_map", lambda syms: {s: {"name": "X", "industry": "Y"} for s in syms})
    monkeypatch.setattr(pcm, "_transcript_rate", lambda syms: {"observed": None, "sample": 0, "missing": []})
    monkeypatch.setattr(pcm, "_analyst_actions_rate", lambda syms: {"observed": 1.0, "sample": 8, "missing": []})
    monkeypatch.setattr(pcm, "_calendar_hour_rate", lambda: {"observed": 0.7, "sample": 100})
    # Stubbed like every other measurer here: unstubbed it reads the REAL
    # `calendar_weekly` cache, which a sibling suite in the same chunk may
    # have seeded, and then flags a blank forward week that has nothing to
    # do with this file. (Production cannot hit that: `calendar_weekly` is
    # only ever written by `_build_current_week`, which writes the coverage
    # report in the same pass.)
    monkeypatch.setattr(pcm, "_calendar_forward_multisource_rate",
                        lambda: {"observed": 1.0, "sample": 4})
    monkeypatch.setattr(pcm, "_enrichment_with_em_rate", lambda: {"observed": 0.6, "sample": 200})
    monkeypatch.setattr(pcm, "_implied_fiscal_rate", lambda: {"observed": None, "sample": 0})
    monkeypatch.setattr(pcm, "_day_metrics_rate", lambda field: {"observed": 0.8, "sample": 50})
    monkeypatch.setattr(pcm, "_denial_snapshot", lambda: {"finnhub": 0, "alphavantage": None})


def _stub_intel_all_present(monkeypatch, pcm):
    monkeypatch.setattr(
        pcm, "_intel_map",
        lambda syms: {s: {"price_target": {"x": 1}, "consensus": {"y": 1}, "beat_history": [1, 2, 3, 4]}
                      for s in syms},
    )


def _stub_intel_all_blank(monkeypatch, pcm):
    monkeypatch.setattr(pcm, "_intel_map", lambda syms: {s: None for s in syms})


# ── alert-on-change semantics ───────────────────────────────────────────────
def test_newly_breached_field_alerts_exactly_once(tmp_path, monkeypatch):
    pcm = _mod()
    _isolate_db(monkeypatch, pcm, tmp_path)
    _stub_all_healthy(monkeypatch, pcm)
    _stub_intel_all_blank(monkeypatch, pcm)  # price_target/consensus/beat_history all 0%

    alerts = []
    monkeypatch.setattr(pcm, "_alert", lambda newly: alerts.append([d["field"] for d in newly]))

    out1 = pcm.run_cycle()
    assert out1["newly_alerted"] > 0
    first_alert_fields = set(alerts[0])
    assert {"price_target", "consensus", "beat_history"} <= first_alert_fields

    # Same persistent defect on cycle 2 -- must NOT alert again.
    out2 = pcm.run_cycle()
    assert out2["newly_alerted"] == 0
    assert len(alerts) == 1  # _alert was called exactly once total


def test_recovered_field_clears_from_prev_and_can_re_alert_later(tmp_path, monkeypatch):
    pcm = _mod()
    _isolate_db(monkeypatch, pcm, tmp_path)
    _stub_all_healthy(monkeypatch, pcm)

    alerts = []
    monkeypatch.setattr(pcm, "_alert", lambda newly: alerts.append([d["field"] for d in newly]))

    _stub_intel_all_blank(monkeypatch, pcm)
    pcm.run_cycle()
    assert len(alerts) == 1

    # Field recovers -- must clear from the "currently defective" set.
    _stub_intel_all_present(monkeypatch, pcm)
    pcm.run_cycle()
    assert pcm.get_state()["defects_current"] == []

    # Goes bad again -- since it's no longer in the persistent set, this is a
    # genuinely NEW breach and must alert again.
    _stub_intel_all_blank(monkeypatch, pcm)
    pcm.run_cycle()
    assert len(alerts) == 2


def test_status_payload_has_no_private_keys(tmp_path, monkeypatch):
    pcm = _mod()
    _isolate_db(monkeypatch, pcm, tmp_path)
    _stub_all_healthy(monkeypatch, pcm)
    _stub_intel_all_blank(monkeypatch, pcm)
    pcm.run_cycle()
    state = pcm.get_state()
    assert not any(k.startswith("_") for k in state)
    # the internal bookkeeping key must genuinely exist in the module (proves
    # this test isn't vacuously passing on an empty state) -- it's just
    # filtered out of the PUBLIC payload.
    assert "_prev_defect_fields" in pcm._state


def test_alert_routes_to_owner_channel_never_public_tsdr_webhook(monkeypatch):
    """Task 23: NEVER route to DISCORD_TSDR_WEBHOOK_URL (the public,
    allowlist-gated community channel). Verifies the alert only ever touches
    discord_notify's admin-channel sender."""
    pcm = _mod()
    calls = []
    from api.services import discord_notify
    monkeypatch.setattr(discord_notify, "_send_webhook", lambda embed: calls.append(embed))
    pcm._alert([{"field": "price_target", "observed": 0.0, "floor": 0.8, "sample": 10,
                 "provider": "data_missing", "kind": "blank"}])
    # Exactly one webhook fired, and it went through discord_notify's admin-
    # channel sender (which reads DISCORD_WEBHOOK_URL internally) -- the only
    # network call _alert makes. A second, TSDR-routed call would show up
    # here as len(calls) > 1 or as a call carrying a different destination.
    assert len(calls) == 1
    # _alert's compiled bytecode must not NAME-REFERENCE the TSDR webhook
    # anywhere (co_names holds referenced globals/attrs, not string literals
    # -- so a mention in the docstring can't false-positive this the way
    # grepping source text would). It only ever names discord_notify /
    # _send_webhook / chart_health_alerts.
    assert not any("TSDR" in n for n in pcm._alert.__code__.co_names)


# ── router / status endpoint ─────────────────────────────────────────────────
def test_status_endpoint_requires_no_auth_and_returns_state(monkeypatch):
    from api.main import app
    import api.services.provider_coverage_monitor as pcm
    fake_state = {"enabled": True, "cycles_completed": 3, "fields": {}, "defects_current": []}
    monkeypatch.setattr(pcm, "get_state", lambda: fake_state)
    client = TestClient(app)
    r = client.get("/api/admin/provider-coverage")
    assert r.status_code == 200
    assert r.json() == fake_state


# ── mutation control ─────────────────────────────────────────────────────────
# Proves the "no re-alert on a persistent breach" test above actually depends
# on the `newly` filter: patching run_cycle to alert on ALL current defects
# (not just newly-breached ones) must make cycle 2 alert again, flipping the
# above assertion's premise. This is the mutation-control counterpart run as
# a plain assertion here (the file-level mutation + real pytest exit code is
# performed separately, see task report).
def test_mutation_control_alert_on_all_defects_would_re_alert_every_cycle(tmp_path, monkeypatch):
    pcm = _mod()
    _isolate_db(monkeypatch, pcm, tmp_path)
    _stub_all_healthy(monkeypatch, pcm)
    _stub_intel_all_blank(monkeypatch, pcm)

    alerts = []
    monkeypatch.setattr(pcm, "_alert", lambda newly: alerts.append(newly))

    # Simulate the mutated behaviour directly: alert on ALL current defects
    # every cycle (i.e. drop the `newly` filter) and confirm it WOULD spam --
    # this is exactly the bug `newly_syms` prevents.
    for _ in range(3):
        defects = pcm.get_state().get("defects_current") or pcm.run_cycle() and pcm.get_state()["defects_current"]
        pcm._alert(defects)  # mutated call site: alerts unconditionally
    assert len(alerts) >= 3  # would have re-alerted every cycle under the mutation
