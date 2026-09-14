"""Metrics 6.1-6.3 and the daily evals step (metrics-v1; stream S-E).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a 0/0 rendered as a percentage, or a value stored where the denominator is 0.
2. an unproven or never-replayed call counted in a denominator.
3. hindsight calls in the see rate; no-views (MENTIONs) in the false-positive rate.
4. a slice row whose numerator/denominator do not match its records.
5. the weighted rate shown without its raw rate.
6. the daily step running with its switch off, writing on a dry run, or swallowing a failed step.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta

import pytest

from api.services.wisdom import registry
from api.services.wisdom.core import store
from api.services.wisdom.core.timeutil import ET
from api.services.wisdom.evals import metrics, outcomes, pipeline, replay
from api.services.wisdom.evals.bars_asof import BarsAsOf, MemoryReader, ymd_int

NOW = datetime(2026, 9, 14, 19, 0, tzinfo=ET)


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()
    with store.write() as conn:
        for sid, stream in (("s-zoom", "zoom_live"), ("s-scans", "sunday_scans")):
            conn.execute("INSERT INTO wisdom_sources (source_id, stream, external_ref, raw_sha256, ingest_version, "
                         "ingested_at) VALUES (?, ?, ?, 'x', 't', 't')", (sid, stream, sid))
    return tmp_path / "wisdom.db"


_n = {"i": 0}


def _record(conn, **over):
    _n["i"] += 1
    rec = {"record_id": f"r{_n['i']}", "record_type": "CALL", "segment_id": "seg", "source_id": "s-zoom",
           "source_version": 1, "extractor_version": "t", "record_hash": f"h{_n['i']}", "author_id": "tsdr",
           "stated_at_et": "2026-09-10T10:00:00-04:00", "stated_at_precision": "minute", "ticker": "NVDA",
           "direction": "long", "stance": "watching", "hindsight": 0, "extraction_confidence": "high",
           "status": "confirmed", "created_at": "t"}
    rec.update(over)
    cols = ", ".join(rec)
    conn.execute(f"INSERT INTO wisdom_records ({cols}) VALUES ({', '.join('?' for _ in rec)})", tuple(rec.values()))
    return rec["record_id"]


def _check(conn, rid, source, verdict, **over):
    row = {"record_id": rid, "source": source, "method_version": replay.METHOD_VERSION, "as_of": "2026-09-10",
           "verdict": verdict, "rank": None, "top_n": None, "setup_raw": None, "vocab_id": None, "reason": None,
           "checked_at": "t"}
    row.update(over)
    conn.execute(f"INSERT INTO wisdom_replay_checks ({', '.join(row)}) VALUES ({', '.join('?' for _ in row)})",
                 tuple(row.values()))


def _rows(slice_=None, metric=None):
    with store.read() as conn:
        rows = metrics.compute(conn, now=NOW)
    want = json.dumps(slice_ or {"status": "combined"}, sort_keys=True)
    return {r["metric"]: r for r in rows if r["slice_json"] == want and (metric is None or r["metric"] == metric)}


def test_zero_over_zero_is_null_and_renders_0_over_0(db):
    rows = _rows()
    assert set(rows) == set(metrics.SEE_RATE_METRICS.values()) | {metrics.FALSE_POSITIVE, metrics.OUTCOME_WEIGHTED}
    for row in rows.values():
        assert (row["numerator"], row["denominator"], row["value"]) == (0, 0, None)
        assert metrics.render(row) == "0/0"
    # control: a real denominator renders k/n with a percentage
    assert metrics.render({"metric": "uct_see_rate_any", "numerator": 1, "denominator": 4, "value": 0.25}) == "1/4 (25.0%)"


def test_unproven_and_never_replayed_calls_stay_out_of_the_denominator(db):
    with store.write() as conn:
        a, b, c = _record(conn), _record(conn), _record(conn)
        _record(conn)                                   # never replayed
        _check(conn, a, "leadership_snapshots:morning_wire", "hit", rank=3, top_n=20)
        _check(conn, b, "leadership_snapshots:morning_wire", "miss", top_n=20)
        _check(conn, c, "leadership_snapshots:morning_wire", "unproven", top_n=20, reason="no_snapshot_for_date")
    row = _rows()["uct_see_rate_any"]
    assert (row["numerator"], row["denominator"], row["value"]) == (1, 2, 0.5)
    notes = json.loads(row["notes"])
    assert (notes["unproven"], notes["not_replayed"], notes["population"]) == (1, 1, 4)
    assert _rows()["uct_see_rate_topn"]["numerator"] == 1


def test_hindsight_calls_never_enter_the_see_rate(db):
    with store.write() as conn:
        _check(conn, _record(conn, stance="hindsight"), "x", "hit")
        _check(conn, _record(conn, hindsight=1), "x", "hit")
        _check(conn, _record(conn), "x", "miss")
    row = _rows()["uct_see_rate_any"]
    assert (row["numerator"], row["denominator"]) == (0, 1)


def test_the_false_positive_rate_uses_explicit_passes_matched_on_setup(db):
    with store.write() as conn:
        p1 = _record(conn, record_type="NEGATIVE_CALL", stance="passed", vocab_id="v:flag", direction=None)
        p2 = _record(conn, record_type="NEGATIVE_CALL", stance="avoid", vocab_id="v:flag", direction=None)
        p3 = _record(conn, record_type="NEGATIVE_CALL", stance="passed", direction=None)       # no setup
        _check(conn, p1, "leadership_snapshots:morning_wire", "hit", vocab_id="v:flag")
        _check(conn, p2, "leadership_snapshots:morning_wire", "hit", vocab_id="v:vcp")
        _check(conn, p3, "leadership_snapshots:morning_wire", "hit", vocab_id="v:flag")
        # a no-view is a MENTION and can never enter
        conn.execute("UPDATE wisdom_records SET record_type='MENTION', stance='no_view' WHERE record_id=?",
                     (_record(conn, record_type="NEGATIVE_CALL", stance="passed", vocab_id="v:flag"),))
    row = _rows()["false_positive_rate"]
    assert (row["numerator"], row["denominator"]) == (1, 2)
    assert json.loads(row["notes"])["excluded"] == 1


def test_every_slice_row_carries_its_own_numerator_and_denominator(db):
    with store.write() as conn:
        _check(conn, _record(conn, author_id="tsdr", source_id="s-zoom", status="confirmed"), "x", "hit")
        _check(conn, _record(conn, author_id="bracco", source_id="s-scans", status="provisional",
                             stated_at_et="2026-08-20T10:00:00-04:00"), "x", "miss")
    assert _rows({"status": "combined", "author": "tsdr"})["uct_see_rate_any"]["denominator"] == 1
    bracco = _rows({"status": "combined", "author": "bracco"})["uct_see_rate_any"]
    assert (bracco["numerator"], bracco["denominator"], bracco["value"]) == (0, 1, 0.0)
    assert _rows({"status": "combined", "stream": "sunday_scans"})["uct_see_rate_any"]["denominator"] == 1
    assert _rows({"status": "combined", "month": "2026-08"})["uct_see_rate_any"]["numerator"] == 0
    assert _rows({"status": "confirmed"})["uct_see_rate_any"]["denominator"] == 1
    assert _rows({"status": "provisional"})["uct_see_rate_any"]["denominator"] == 1
    assert _rows({"status": "combined"})["uct_see_rate_any"]["denominator"] == 2
    assert _rows({"status": "combined", "setup": "(none)"})["uct_see_rate_any"]["denominator"] == 2
    # an empty dimension value is not emitted as a row
    assert _rows({"status": "confirmed", "author": "bracco"}) == {}


def _outcome(conn, rid, **over):
    row = {"record_id": rid, "methodology_version": outcomes.METHODOLOGY_VERSION, "anchor_price": 100.0,
           "ret_10": 0.0, "n_sessions_available": 20, "computed_at": "t",
           "horizons_json": json.dumps({"first_hit": None, "stop_used": None})}
    row.update(over)
    conn.execute(f"INSERT INTO wisdom_outcomes ({', '.join(row)}) VALUES ({', '.join('?' for _ in row)})",
                 tuple(row.values()))


def test_the_outcome_weighted_rate_sits_beside_its_raw_rate(db):
    with store.write() as conn:
        good, bad, flat, fresh = (_record(conn) for _ in range(4))
        _check(conn, good, "x", "hit")
        _check(conn, bad, "x", "miss")
        _check(conn, flat, "x", "miss")
        _check(conn, fresh, "x", "hit")
        _outcome(conn, good, horizons_json=json.dumps({"first_hit": "target"}))
        _outcome(conn, bad, horizons_json=json.dumps({"first_hit": "stop"}))
        _outcome(conn, flat, ret_10=0.0)
        _outcome(conn, fresh, ret_10=None, n_sessions_available=3)                 # nothing matured
    row = _rows()["outcome_weighted_see_rate"]
    notes = json.loads(row["notes"])
    assert (row["numerator"], row["denominator"]) == (1, 3)
    assert row["value"] == round(1.0 / 1.5, 6)
    assert (notes["raw"], notes["raw_value"], notes["no_matured_outcome"]) == ("1/3", round(1 / 3, 6), 1)
    assert "raw 1/3" in metrics.render(row) and "weighted" in metrics.render(row)


def test_latest_metrics_returns_only_the_newest_run_with_n_in_every_row(db):
    with store.write() as conn:
        _check(conn, _record(conn), "x", "hit")
    with store.write() as conn:
        metrics.write(conn, metrics.compute(conn, now=NOW - timedelta(days=1)))
        _check(conn, _record(conn), "x", "miss")
    with store.write() as conn:
        metrics.write(conn, metrics.compute(conn, now=NOW))
    with store.read() as conn:
        latest = metrics.latest_metrics(conn)
    overall = [r for r in latest if r["metric"] == "uct_see_rate_any" and r["slice"] == {"status": "combined"}]
    assert len(overall) == 1 and overall[0]["display"] == "1/2 (50.0%)"
    assert all("display" in r and "denominator" in r for r in latest)


# ── the daily step ───────────────────────────────────────────────────────────

class _Adapter:
    name = "fake"
    top_n = None
    list_name = None

    def __init__(self, verdict="hit", boom=False):
        self.verdict, self.boom = verdict, boom

    def check(self, ticker, session):
        if self.boom:
            raise RuntimeError("adapter exploded")
        return replay.Check(self.name, self.verdict, session.isoformat())

    def close(self):
        return None


def _bars():
    sessions, cur = [], date(2026, 8, 3)
    while len(sessions) < 40:
        if cur.weekday() < 5:
            sessions.append(ymd_int(cur))
        cur += timedelta(days=1)
    rows = {(t, "D"): [(s, 50.0, 51.0, 49.0, 50.0, 1.0) for s in sessions] for t in ("SPY", "QQQ", "IWM", "NVDA")}
    return BarsAsOf(MemoryReader(rows))


def _ctx(force=True, dry_run=False):
    return registry.JobContext(job_id="t", now_et=NOW, due_key=None, force=force, dry_run=dry_run, run_id="run")


def _count(table):
    with store.read() as conn:
        return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


def _env():
    from api.services.wisdom.evals import context
    return context.ContextEnv(bars=_bars(), now=NOW)


def test_the_daily_step_skips_every_switched_off_part(db, monkeypatch):
    for env in ("WISDOM_OUTCOMES_ENABLED", "WISDOM_CONTEXT_SNAPSHOT_ENABLED", "WISDOM_REPLAY_ENABLED",
                "WISDOM_METRICS_ENABLED"):
        monkeypatch.delenv(env, raising=False)
    with store.write() as conn:
        _record(conn)
    summary = pipeline.run_daily(_ctx(force=False), bars=_bars(), adapters=[_Adapter()], env=_env())
    assert all(summary[k] == {"skipped": "kill switch off"} for k in ("context", "outcomes", "replay", "metrics"))
    assert _count("wisdom_metrics") == 0
    # control: one switch on runs exactly that part
    monkeypatch.setenv("WISDOM_METRICS_ENABLED", "1")
    summary = pipeline.run_daily(_ctx(force=False), bars=_bars(), adapters=[_Adapter()], env=_env())
    assert summary["metrics"]["rows"] > 0 and summary["replay"] == {"skipped": "kill switch off"}


def test_a_dry_run_computes_and_writes_nothing(db):
    with store.write() as conn:
        _record(conn)
    summary = pipeline.run_daily(_ctx(dry_run=True), bars=_bars(), adapters=[_Adapter()], env=_env())
    assert summary["replay"]["replayed"] == 1 and summary["outcomes"]["computed"] == 1
    for table in ("wisdom_outcomes", "wisdom_replay_checks", "wisdom_replay_hits", "wisdom_metrics",
                  "wisdom_context_snapshots"):
        assert _count(table) == 0, table


def test_a_real_run_writes_every_part_once_and_is_idempotent(db):
    with store.write() as conn:
        _record(conn)
    pipeline.run_daily(_ctx(), bars=_bars(), adapters=[_Adapter()], env=_env())
    assert (_count("wisdom_replay_checks"), _count("wisdom_replay_hits"), _count("wisdom_context_snapshots")) == (1, 1, 1)
    assert _count("wisdom_outcomes") == 1
    again = pipeline.run_daily(_ctx(), bars=_bars(), adapters=[_Adapter()], env=_env())
    assert again["replay"]["replayed"] == 0 and again["context"] == {"candidates": 0, "written": 0}
    assert (_count("wisdom_replay_checks"), _count("wisdom_context_snapshots")) == (1, 1)


class _Unreadable(_Adapter):
    """A source that cannot be READ — the answer is about us, not about that session."""

    def check(self, ticker, session):
        return replay.Check(self.name, "unproven", session.isoformat(), reason="source_file_missing")


class _SettledAbsence(_Adapter):
    """A source that WAS read and simply recorded nothing that session — a permanent fact."""

    def check(self, ticker, session):
        return replay.Check(self.name, "unproven", session.isoformat(), reason="no_snapshot_for_date")


def test_an_unreadable_source_is_re_asked_at_any_age_but_a_settled_absence_is_not(db):
    """🔴 The retry horizon keyed on the RECORD'S SESSION date alone, so an older record whose
    source was down on its single replay stayed unproven forever and left the denominator."""
    with store.write() as conn:
        _record(conn, stated_at_et="2026-08-12T10:00:00-04:00")      # 33 days before NOW
    assert pipeline.run_replay(_ctx(), adapters=[_Unreadable()])["replayed"] == 1
    # the source comes back: the old record MUST be asked again
    again = pipeline.run_replay(_ctx(), adapters=[_Adapter(verdict="hit")])
    assert again["replayed"] == 1 and again["levels"]["any:hit"] == 1
    with store.read() as conn:
        assert [r[0] for r in conn.execute("SELECT verdict FROM wisdom_replay_checks")] == ["hit"]


def test_a_settled_absence_on_an_old_record_is_not_re_asked(db):
    """CONTROL for the test above: without this, 'retry everything' would pass it too, and the
    retry horizon would be dead code (every unproven record re-replayed against every source,
    every night, forever)."""
    with store.write() as conn:
        _record(conn, stated_at_et="2026-08-12T10:00:00-04:00")
    assert pipeline.run_replay(_ctx(), adapters=[_SettledAbsence()])["replayed"] == 1
    assert pipeline.run_replay(_ctx(), adapters=[_Adapter(verdict="hit")])["replayed"] == 0
    # and a RECENT record with the same settled absence still is re-asked (the horizon lives)
    with store.write() as conn:
        _record(conn, stated_at_et="2026-09-14T10:00:00-04:00")
    assert pipeline.run_replay(_ctx(), adapters=[_SettledAbsence()])["replayed"] == 1


def test_a_failed_part_does_not_stop_the_others_and_is_never_swallowed(db):
    with store.write() as conn:
        _record(conn)
    with pytest.raises(pipeline.EvalsStepFailed) as failed:
        pipeline.run_daily(_ctx(), bars=_bars(), adapters=[_Adapter(boom=True)], env=_env())
    assert "replay" in str(failed.value)
    assert _count("wisdom_metrics") > 0 and _count("wisdom_outcomes") == 1
