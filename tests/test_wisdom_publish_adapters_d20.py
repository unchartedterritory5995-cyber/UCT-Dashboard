"""D20 — level-reached scorer and "looks like what TSDR buys", built and disabled.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. delivery with the flag off, with a CALL-REPLAY baseline under 100, or with less than two
   weeks / ten scored sessions of silent scoring — each gate on its own, and every reason reported.
2. a sliced metric row (per setup/author/month) counted as the replay baseline.
3. a silent run that scored nothing counted toward the two-week window.
4. any delivery at all in W1, even with every gate open (no S7 channel).
5. a cross missed, a closed call scored as open, a session without a bar scored as "no cross".
6. look-ahead in the reference vectors, or a candidate scored against non-owner calls.
7. an S7 (alert_taxonomy) import from either scorer.
"""
from __future__ import annotations

import ast
import json
import pathlib
from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pytest

from api.services.wisdom.core import store, timeutil
from api.services.wisdom.publish import level_alerts, lookalike
from api.services.wisdom.publish.adapters import d20_gates
from tests.test_wisdom_publish_adapters_store import add_record, add_segment, add_source, adapters_db, seeded  # noqa: F401

REPO = pathlib.Path(__file__).resolve().parents[1]
SESSION = date(2026, 9, 11)  # a Friday


def _ctx(when=datetime(2026, 9, 11, 18, 47, tzinfo=timeutil.ET), dry_run=False):
    return SimpleNamespace(now_et=when, dry_run=dry_run, log=lambda m: None)


def _ymd(d):
    return int(d.strftime("%Y%m%d"))


def _metric(conn, denominator, slice_=None, computed_at="2026-09-10T20:00:00-04:00"):
    conn.execute("INSERT INTO wisdom_metrics(metric_run_id, metric, slice_json, numerator, denominator, value, "
                 "method_version, computed_at) VALUES ('m', 'uct_see_rate_any', ?, 1, ?, NULL, 'm0', ?)",
                 (json.dumps(slice_ or {}), denominator, computed_at))


def _runs(conn, scorer, sessions, n_scored=3):
    for s in sessions:
        conn.execute("INSERT INTO wisdom_d20_scoring_runs(scorer, session_date, scored_at, n_scored, n_written) "
                     "VALUES (?, ?, 'x', ?, 0)", (scorer, s.isoformat(), n_scored))


# ── gates ────────────────────────────────────────────────────────────────────

def test_every_gate_refuses_on_its_own_and_all_reasons_are_reported(adapters_db):
    today = date(2026, 10, 1)
    sessions = [today - timedelta(days=d) for d in range(15, 0, -1)]
    with store.write() as conn:
        _metric(conn, 120)
        _runs(conn, "lookalike", sessions)
    with store.read() as conn:
        open_all = d20_gates.delivery_gate(conn, "lookalike", flag_env="F", flag_on=True, today=today)
        flag_off = d20_gates.delivery_gate(conn, "lookalike", flag_env="F", flag_on=False, today=today)
    assert open_all["allowed"] is True and open_all["reasons"] == []
    assert flag_off["allowed"] is False and flag_off["reasons"] == ["F is off"]
    with store.write() as conn:
        conn.execute("DELETE FROM wisdom_metrics")
        _metric(conn, 99)
    with store.read() as conn:
        low_n = d20_gates.delivery_gate(conn, "lookalike", flag_env="F", flag_on=True, today=today)
        young = d20_gates.delivery_gate(conn, "lookalike", flag_env="F", flag_on=False, today=sessions[5])
    assert low_n["allowed"] is False and low_n["reasons"] == ["CALL-REPLAY baseline n=99 is below 100"]
    assert len(young["reasons"]) == 3  # flag, baseline and window, all reported


def test_a_sliced_metric_is_not_the_replay_baseline(adapters_db):
    with store.write() as conn:
        _metric(conn, 500, {"setup": "v_ep"}, computed_at="2026-09-11T20:00:00-04:00")
        _metric(conn, 40, {"status": "combined"})
    with store.read() as conn:
        assert d20_gates.replay_baseline_n(conn) == 40
    with store.write() as conn:
        _metric(conn, 130, {}, computed_at="2026-09-12T20:00:00-04:00")
    with store.read() as conn:
        assert d20_gates.replay_baseline_n(conn) == 130


def test_runs_that_scored_nothing_do_not_count_toward_the_window(adapters_db):
    today = date(2026, 10, 1)
    with store.write() as conn:
        _metric(conn, 150)
        _runs(conn, "level_alerts", [today - timedelta(days=d) for d in range(20, 0, -1)], n_scored=0)
    with store.read() as conn:
        gate = d20_gates.delivery_gate(conn, "level_alerts", flag_env="F", flag_on=True, today=today)
    assert gate["allowed"] is False and gate["window"]["sessions"] == 0


def test_w1_never_delivers_even_with_every_gate_open(adapters_db, monkeypatch):
    today = date(2026, 10, 1)
    with store.write() as conn:
        _metric(conn, 150)
        for scorer in ("level_alerts", "lookalike"):
            _runs(conn, scorer, [today - timedelta(days=d) for d in range(20, 0, -1)])
    monkeypatch.setenv("WISDOM_LEVEL_ALERTS_ENABLED", "1")
    monkeypatch.setenv("WISDOM_LOOKALIKE_ENABLED", "1")
    for module in (level_alerts, lookalike):
        out = module.deliver(today=today)
        assert out["allowed"] is True and out["delivered"] == 0 and out["refused"] is True
        assert out["refusal_reasons"] == [d20_gates.S7_DEPENDENCY]
    monkeypatch.delenv("WISDOM_LEVEL_ALERTS_ENABLED")
    assert level_alerts.deliver(today=today)["refusal_reasons"] == ["WISDOM_LEVEL_ALERTS_ENABLED is off"]


def test_neither_scorer_imports_s7():
    for rel in ("api/services/wisdom/publish/level_alerts.py", "api/services/wisdom/publish/lookalike.py",
                "api/services/wisdom/publish/adapters/d20_gates.py"):
        tree = ast.parse((REPO / rel).read_text(encoding="utf-8"))
        names = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                names.update({node.module, *(f"{node.module}.{a.name}" for a in node.names)})
            elif isinstance(node, ast.Import):
                names.update(a.name for a in node.names)
        assert not [n for n in names if "alert_taxonomy" in n], rel
        assert any(n.startswith("api.services.wisdom") for n in names), rel  # non-vacuity


# ── level alerts ─────────────────────────────────────────────────────────────

def _bars(prev_close, high, low, session=SESSION):
    prev = session - timedelta(days=1)
    return [(_ymd(prev), 1, 1, 1, prev_close, 1), (_ymd(session), 1, high, low, (high + low) / 2, 1)]


def test_the_silent_scorer_records_crosses_for_open_calls_only(seeded, monkeypatch):
    bars = {"NVDA": _bars(139.0, 143.0, 138.5)}   # crosses 140.25 and 142.75 up; not the 131.5 stop or 160 target
    monkeypatch.setattr(level_alerts, "_daily_bars", lambda t, ymd, n: bars.get(t, []))
    out = level_alerts.score_silently(_ctx())
    # 140.25 (zone low) and 142.75 (zone high AND the typed breakout level) are crossed up
    assert out["open_calls"] == 1 and out["crosses"] == 3 and out["delivered"] == 0
    assert out["tickers_without_bars"] == 0
    with store.read() as conn:
        crosses = {(r["level_kind"], r["level_price"], r["cross_direction"]) for r in conn.execute(
            "SELECT * FROM wisdom_level_crosses")}
        run = conn.execute("SELECT n_scored FROM wisdom_d20_scoring_runs WHERE scorer = 'level_alerts'").fetchone()
    assert crosses == {("entry_zone_lo", 140.25, "up"), ("entry_zone_hi", 142.75, "up"),
                       ("level:breakout", 142.75, "up")}
    assert run["n_scored"] == 5
    assert level_alerts.score_silently(_ctx())["written"] == 0  # idempotent per session


def test_a_later_exit_closes_the_call_and_a_missing_bar_is_not_a_quiet_session(seeded, monkeypatch):
    monkeypatch.setattr(level_alerts, "_daily_bars", lambda t, ymd, n: [])
    out = level_alerts.score_silently(_ctx())
    assert out["open_calls"] == 1 and out["tickers_without_bars"] == 1 and out["levels_scored"] == 0
    with store.read() as conn:
        assert conn.execute("SELECT n_scored FROM wisdom_d20_scoring_runs").fetchone()[0] == 0
    with store.write() as conn:
        add_record(conn, "recEXIT", "CALL", "segLIVE1", "srcLIVE", author_id="tsdr", ticker="NVDA", stance="exited",
                   stated_at_et="2026-09-10T11:00:00-04:00", record_hash="exit")
    assert level_alerts.score_silently(_ctx())["open_calls"] == 0


# ── lookalike ────────────────────────────────────────────────────────────────

def _series(start_close, drift, n=70, end=SESSION):
    rows, close = [], start_close
    day = end - timedelta(days=n - 1)
    for _ in range(n):
        close *= (1 + drift)
        rows.append((_ymd(day), close, close * 1.03, close * 0.97, close, 1_000_000))
        day += timedelta(days=1)
    return rows


def _seed_reference_calls(conn, n=12):
    add_source(conn, "srcREF", "discord", "discord:339:ref", title="#tsdr")
    for i in range(n):
        add_segment(conn, f"segREF{i}", "srcREF", i, f"Synthetic ref call {i}.", "tsdr", kind="message")
        add_record(conn, f"recREF{i}", "CALL", f"segREF{i}", "srcREF", author_id="tsdr", ticker=f"REF{i}",
                   direction="long", stance="taking", stated_at_et=f"2026-08-{10 + i:02d}T10:00:00-04:00")
    # a Bracco call must never become a reference
    add_record(conn, "recBRACCO", "CALL", "segDISC1", "srcDISC", author_id="bracco", ticker="BRAC",
               direction="long", stance="taking", stated_at_et="2026-08-20T10:00:00-04:00", record_hash="b")


def test_lookalike_scores_candidates_against_owner_calls_without_look_ahead(seeded, monkeypatch):
    with store.write() as conn:
        _seed_reference_calls(conn)
    asked: list = []

    def bars(ticker, to_ymd, n):
        asked.append((ticker, to_ymd))
        end = date(int(str(to_ymd)[:4]), int(str(to_ymd)[4:6]), int(str(to_ymd)[6:]))
        drift = 0.004 if ticker.startswith(("REF", "HOT")) else -0.004
        return _series(100.0, drift, end=end)

    monkeypatch.setattr(lookalike, "_daily_bars", bars)
    monkeypatch.setattr(lookalike, "candidate_tickers", lambda s: [("HOT1", "catalysts"), ("COLD1", "catalysts")])
    out = lookalike.score_silently(_ctx())
    # 12 seeded references + the seed's own open NVDA call by TSDR; Bracco's call is never one
    assert out["reference_calls"] == 13 and out["scored"] == 2 and out["delivered"] == 0
    assert "BRAC" not in {t for t, _ in asked}
    # reference bars are read AS OF each call's own session, never the scoring session
    assert ("REF0", 20260810) in asked and all(ymd <= _ymd(SESSION) for _, ymd in asked)
    with store.read() as conn:
        ranked = [r["ticker"] for r in conn.execute("SELECT ticker FROM wisdom_lookalike_scores ORDER BY rank")]
    assert ranked == ["HOT1", "COLD1"]


def test_lookalike_refuses_to_score_on_a_thin_reference_set_and_reconciles_matches(seeded, monkeypatch):
    monkeypatch.setattr(lookalike, "_daily_bars", lambda t, ymd, n: _series(100.0, 0.004))
    out = lookalike.score_silently(_ctx())
    assert out["scored"] == 0 and "insufficient reference calls" in out["note"]
    with store.write() as conn:
        conn.execute("INSERT INTO wisdom_lookalike_scores(session_date, ticker, model_version, score, rank, provider, "
                     "features_json, scored_at) VALUES ('2026-09-01', 'NVDA', ?, 0.5, 1, 'catalysts', '{}', 'x')",
                     (lookalike.MODEL_VERSION,))
        assert lookalike.reconcile(conn) == 1   # recCALL_OPEN, TSDR, NVDA, 2026-09-08
    with store.read() as conn:
        row = conn.execute("SELECT matched_record_id, matched_session FROM wisdom_lookalike_scores").fetchone()
        precision = lookalike.silent_precision(conn, today=date(2026, 9, 30))
        empty = lookalike.silent_precision(conn, today=date(2026, 9, 2))
    assert (row["matched_record_id"], row["matched_session"]) == ("recCALL_OPEN", "2026-09-08")
    assert (precision["k"], precision["n"]) == (1, 1)
    assert (empty["k"], empty["n"], empty["rate"]) == (0, 0, None)
