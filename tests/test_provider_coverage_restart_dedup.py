"""Alert-on-CHANGE has to survive a process restart, or it is alert-on-BOOT.

2026-08-09 evidence: the same two standing defects announced themselves at
22:07, again at 22:16, and again at 22:27 — three embeds, one underlying state,
no change between them. `_prev_defect_fields` lives in `_state`, a module dict,
so every redeploy reset it to empty and the next cycle called everything
"newly breached". This pod redeploys several times a day.

The cost is not noise for its own sake. The 22:07 embed carried BOTH the real
`avg_vol` hole and a field that could never be green; by the third repeat of an
unchanged pair, the channel reads as broken rather than as reporting. A
detector nobody reads is off.

The previous defect set therefore persists next to the coverage history, in the
DB the monitor already owns.
"""
import importlib


def _boot(monkeypatch, db_path):
    """A cold process: fresh module state, same on-disk DB — i.e. a redeploy."""
    import api.services.provider_coverage_monitor as pcm
    importlib.reload(pcm)
    monkeypatch.setattr(pcm, "DB_PATH", str(db_path))
    return pcm


def _stub_healthy(monkeypatch, pcm):
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
    monkeypatch.setattr(pcm, "_intel_map",
                        lambda syms: {s: {"price_target": {"x": 1}, "consensus": {"y": 1},
                                          "beat_history": [1, 2, 3, 4]} for s in syms})


def _break_intel(monkeypatch, pcm):
    monkeypatch.setattr(pcm, "_intel_map", lambda syms: {s: None for s in syms})


def test_a_standing_defect_does_not_re_alert_after_a_restart(tmp_path, monkeypatch):
    db = tmp_path / "coverage_restart.db"

    pcm = _boot(monkeypatch, db)
    _stub_healthy(monkeypatch, pcm)
    _break_intel(monkeypatch, pcm)
    alerts = []
    monkeypatch.setattr(pcm, "_alert", lambda newly: alerts.append([d["field"] for d in newly]))
    assert pcm.run_cycle()["newly_alerted"] > 0
    assert len(alerts) == 1

    # Redeploy. Nothing about the world changed; the process did.
    pcm = _boot(monkeypatch, db)
    _stub_healthy(monkeypatch, pcm)
    _break_intel(monkeypatch, pcm)
    monkeypatch.setattr(pcm, "_alert", lambda newly: alerts.append([d["field"] for d in newly]))
    out = pcm.run_cycle()

    assert out["defects"] > 0, "the defect must still be REPORTED in state"
    assert out["newly_alerted"] == 0, f"re-alerted a standing defect after a restart: {alerts}"
    assert len(alerts) == 1


def test_a_breach_that_began_while_the_process_was_down_still_alerts(tmp_path, monkeypatch):
    """CONTROL. Persisting the set must not become a way to swallow a real new
    breach — if the world got worse across the restart, that is exactly the
    case the channel exists for."""
    db = tmp_path / "coverage_restart_control.db"

    pcm = _boot(monkeypatch, db)
    _stub_healthy(monkeypatch, pcm)
    alerts = []
    monkeypatch.setattr(pcm, "_alert", lambda newly: alerts.append([d["field"] for d in newly]))
    pcm.run_cycle()
    assert alerts == []

    pcm = _boot(monkeypatch, db)
    _stub_healthy(monkeypatch, pcm)
    _break_intel(monkeypatch, pcm)
    monkeypatch.setattr(pcm, "_alert", lambda newly: alerts.append([d["field"] for d in newly]))
    pcm.run_cycle()

    assert len(alerts) == 1
    assert {"price_target", "consensus", "beat_history"} <= set(alerts[0])


def test_one_field_healing_while_others_stay_broken_unlatches_only_that_field(tmp_path, monkeypatch):
    """PARTIAL recovery — the case a full recovery cannot reach.

    When every defect clears at once the set is emptied wholesale, so a bug
    that only fails to REMOVE individual healed fields hides behind that path.
    Here the intel fields stay broken throughout while analyst_actions heals
    and then breaks again: if the healed field never left the persisted set,
    its second, genuine breach is silent — the exact failure a durable
    baseline is most likely to introduce.
    """
    db = tmp_path / "coverage_partial_recover.db"
    alerts = []

    def _boot_broken(analyst_ok):
        pcm = _boot(monkeypatch, db)
        _stub_healthy(monkeypatch, pcm)
        _break_intel(monkeypatch, pcm)          # intel stays down the whole time
        monkeypatch.setattr(
            pcm, "_analyst_actions_rate",
            lambda syms: {"observed": 1.0 if analyst_ok else 0.0, "sample": 8, "missing": []})
        monkeypatch.setattr(pcm, "_alert", lambda newly: alerts.append([d["field"] for d in newly]))
        return pcm

    pcm = _boot_broken(analyst_ok=False)
    pcm.run_cycle()
    assert "analyst_actions" in set(alerts[0])

    pcm = _boot_broken(analyst_ok=True)         # analyst heals; intel still down
    pcm.run_cycle()
    flagged = {d["field"] for d in pcm.get_state()["defects_current"]}
    assert "analyst_actions" not in flagged
    assert "price_target" in flagged, "control: the other defects must still stand"

    pcm = _boot_broken(analyst_ok=False)        # breaks again -> genuinely new
    pcm.run_cycle()
    assert len(alerts) == 2, f"a healed-then-rebroken field went unannounced: {alerts}"
    assert alerts[1] == ["analyst_actions"]


def test_recovery_across_a_restart_clears_the_persisted_set(tmp_path, monkeypatch):
    """A defect that healed while the process was down must not stay latched —
    otherwise its NEXT genuine breach is silent, which is the failure mode that
    matters most."""
    db = tmp_path / "coverage_restart_recover.db"

    pcm = _boot(monkeypatch, db)
    _stub_healthy(monkeypatch, pcm)
    _break_intel(monkeypatch, pcm)
    alerts = []
    monkeypatch.setattr(pcm, "_alert", lambda newly: alerts.append([d["field"] for d in newly]))
    pcm.run_cycle()
    assert len(alerts) == 1

    pcm = _boot(monkeypatch, db)          # restart, providers recovered
    _stub_healthy(monkeypatch, pcm)
    monkeypatch.setattr(pcm, "_alert", lambda newly: alerts.append([d["field"] for d in newly]))
    pcm.run_cycle()
    assert pcm.get_state()["defects_current"] == []

    pcm = _boot(monkeypatch, db)          # restart, breaks again -> genuinely new
    _stub_healthy(monkeypatch, pcm)
    _break_intel(monkeypatch, pcm)
    monkeypatch.setattr(pcm, "_alert", lambda newly: alerts.append([d["field"] for d in newly]))
    pcm.run_cycle()
    assert len(alerts) == 2
