"""WEEKLY WISDOM REPORT, monthly packet and the two publish tools (stream S-F).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a rate printed without its n, or 0/0 printed as a percentage.
2. the metric list drifting from the contract, or a missing metric shown as zero.
3. a report missing a required section (Contradictions, "D16b: deferred", gates, costs).
4. delivery while the flag is off, on a dry run, twice for one week, or with source text.
5. one unreadable section taking the whole report down.
6. a tool writing into the shared data root, or defaulting its database.
"""
from __future__ import annotations

import json
import pathlib
import re
import sqlite3
import subprocess
import sys
from datetime import datetime

import pytest

from api.services.wisdom import registry
from api.services.wisdom.core import store, timeutil
from api.services.wisdom.publish import report, review

REPO = pathlib.Path(__file__).resolve().parents[1]
ET = timeutil.ET
SUNDAY = datetime(2026, 9, 20, 19, 52, tzinfo=ET)
WEEK = "2026-W38"
SECTIONS = ["## Calls", "## Principles", "## Contradictions", "## Capture health", "## Metrics",
            "## Extractor", "## Review queue", "## Cost actuals", "## D16b", "## Scheduled gates", "## Jobs"]


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()
    return tmp_path / "wisdom.db"


@pytest.fixture
def sent(monkeypatch):
    from api.services import discord_notify

    calls: list = []
    monkeypatch.setattr(discord_notify, "_send_webhook", lambda embed: calls.append(embed))
    return calls


def _ctx(dry_run=False, due_key=WEEK, run_id="weekly-run"):
    return registry.JobContext(job_id="wisdom_weekly_chain", now_et=SUNDAY, due_key=due_key, force=True,
                               dry_run=dry_run, run_id=run_id)


def _metric(conn, metric, num, den, computed_at="2026-09-20T18:00:00-04:00", slice_json="{}"):
    conn.execute("INSERT INTO wisdom_metrics (metric_run_id, metric, slice_json, numerator, denominator, value, "
                 "method_version, computed_at) VALUES ('m', ?, ?, ?, ?, ?, 'v0', ?)",
                 (metric, slice_json, num, den, (num / den) if den else None, computed_at))


def _markdown_section(md: str, heading: str) -> str:
    start = md.index(heading)
    nxt = md.find("\n## ", start + len(heading))
    return md[start: nxt if nxt != -1 else len(md)]


# ── 1-2. ratios and the metric list ──────────────────────────────────────────

def test_ratio_text_always_prints_n_and_never_a_percentage_over_zero():
    assert report.ratio_text(0, 0) == "0/0"
    assert report.ratio_text(None, None) == "0/0"
    assert report.ratio_text(5, 0) == "5/0"
    assert report.ratio_text(3, 12) == "3/12 (25.0%)"


def test_the_expected_metrics_are_the_contract_metric_names():
    text = (REPO / "docs" / "wisdom" / "CONTRACTS.md").read_text(encoding="utf-8")
    block = text[text.index("Metric names:"): text.index("`slice_json` keys")]
    names = tuple(re.findall(r"`([a-z_]+)`", block))
    assert len(names) >= 10 and names == report.EXPECTED_METRICS


# ── 3. an empty store still renders the whole report ────────────────────────

def test_an_empty_store_renders_every_section_with_nothing_invented(db):
    with store.read() as conn:
        built = report.build_weekly(conn, now=SUNDAY, week_key=WEEK)
    md = report.render_weekly_markdown(built)
    positions = [md.index(h) for h in SECTIONS]
    assert positions == sorted(positions)
    assert not [k for k, v in built["sections"].items() if isinstance(v, dict) and "error" in v]
    assert "D16b: deferred" in md
    metrics = _markdown_section(md, "## Metrics")
    assert "Not computed yet: " + ", ".join(report.EXPECTED_METRICS) in metrics
    assert "%" not in metrics and "nan" not in md.lower()
    assert "WEEKLY WISDOM REPORT — 2026-W38 (Sep 14 – Sep 20, 2026)" in md


def test_a_zero_denominator_prints_0_over_0_beside_a_real_ratio(db):
    with store.write() as conn:
        _metric(conn, "uct_see_rate_any", 4, 9, computed_at="2026-09-19T18:00:00-04:00")  # superseded below
        _metric(conn, "uct_see_rate_any", 0, 0)
        _metric(conn, "false_positive_rate", 3, 12)
    with store.read() as conn:
        built = report.build_weekly(conn, now=SUNDAY, week_key=WEEK)
    md = report.render_weekly_markdown(built)
    metrics = _markdown_section(md, "## Metrics")
    assert "| uct_see_rate_any | all | 0/0 |" in metrics
    assert "0/0 (" not in metrics and "4/9" not in metrics
    assert "| false_positive_rate | all | 3/12 (25.0%) |" in metrics
    rows = {r["metric"]: r for r in built["sections"]["metrics"]["rows"]}
    assert rows["uct_see_rate_any"]["value"] is None
    assert "uct_see_rate_any" not in built["sections"]["metrics"]["not_computed"]


# ── the sections count what the store holds ────────────────────────────────

def _seed_week(conn):
    conn.execute("INSERT INTO wisdom_sources (source_id, stream, external_ref, raw_sha256, ingest_version, "
                 "ingested_at) VALUES ('s1', 'sunday_scans', 'substack:x', 'h', 'v0', '2026-09-20')")
    conn.execute("INSERT INTO wisdom_segments (segment_id, source_id, source_version, ordinal, kind, text, "
                 "text_sha256, normalizer_version) VALUES ('g1', 's1', 1, 0, 'section', 'synthetic', 'h', 'n0')")
    for rid, when, status in (("r-in", "2026-09-15T10:05:00-04:00", "provisional"),
                              ("r-in2", "2026-09-20T09:00:00-04:00", "confirmed"),
                              ("r-out", "2026-09-10T10:05:00-04:00", "confirmed")):
        conn.execute("INSERT INTO wisdom_records (record_id, record_type, segment_id, source_id, source_version, "
                     "extractor_version, record_hash, author_id, ticker, direction, stance, stated_at_et, thesis, "
                     "status, extraction_confidence, created_at) VALUES (?, 'CALL', 'g1', 's1', 1, 'x0', ?, 'tsdr', "
                     "'ZZZT', 'long', 'taking', ?, 'SECRET-THESIS-TEXT', ?, 'high', '2026-09-20')",
                     (rid, rid, when, status))
    for day, health in (("2026-09-16", "ok"), ("2026-09-17", "ok"), ("2026-09-18", "ok")):
        conn.execute("INSERT INTO wisdom_capture_runs (run_id, dataset, session_date, started_at, status, "
                     "row_count, trailing_median, health) VALUES (?, 'wire', ?, ?, 'ok', 120, 118, ?)",
                     (f"c-{day}", day, f"{day}T16:52:00-04:00", health))
    conn.execute("INSERT INTO wisdom_capture_runs (run_id, dataset, session_date, started_at, status, row_count, "
                 "trailing_median, health) VALUES ('c-t', 'tweets', '2026-09-18', '2026-09-18T16:52:00-04:00', "
                 "'ok', 0, 40, 'zero')")
    conn.execute("INSERT INTO wisdom_batches (batch_id, kind, extractor_version, model, submitted_at, status, "
                 "request_count, cost_usd_estimate, cost_usd_actual, budget_cap_usd) VALUES "
                 "('b1', 'extract', 'x0', 'claude-opus-5', '2026-09-16T20:00:00-04:00', 'ended', 10, 2.0, 1.25, 120)")
    review.enqueue(conn, tab="contradictions", subject_ref="principle:p|record:r-in", summary="p: contradicted",
                   old={"principle_key": "p", "first_seen_at": "2026-09-01", "locator": "principle:p"},
                   new={"record_type": "PRINCIPLE", "stated_at_et": "2026-09-15", "locator": "s1#g1"},
                   evidence={"side_by_side": [{"principle_key": "p", "first_seen_at": "2026-09-01",
                                               "locator": "principle:p"},
                                              {"record_type": "PRINCIPLE", "stated_at_et": "2026-09-15",
                                               "locator": "s1#g1"}]},
                   recommendation="Keep both non-canonical and present both with dates until ruled.")


def test_calls_capture_costs_contradictions_and_gates_come_from_the_store(db):
    with store.write() as conn:
        _seed_week(conn)
    with store.read() as conn:
        built = report.build_weekly(conn, now=SUNDAY, week_key=WEEK)
    s = built["sections"]
    assert s["calls"]["n"] == 2 and s["calls"]["by_type"]["CALL"] == {
        "confirmed": 1, "provisional": 1, "rejected": 0, "combined": 2}
    assert {d["dataset"]: d["consecutive_ok_sessions"] for d in s["capture_health"]["datasets"]} == {
        "tweets": 0, "wire": 3}
    assert s["costs"]["this_week"] == {"batches": 1, "actual_usd": 1.25, "pending_estimate_usd": 0}
    assert s["costs"]["budget_cap_usd"] == 120
    assert s["contradictions"]["open_n"] == 1 and s["review_queue"]["tabs"]["contradictions"]["open"] == 1
    gates = {g["gate"].split(":")[0]: g for g in s["scheduled_gates"]["gates"]}
    assert "1/2 (50.0%)" in gates["Capture health"]["evidence"]
    assert gates["First WEEKLY WISDOM REPORT (W1 §9.1)"]["status"] == "met"
    md = report.render_weekly_markdown(built)
    assert "**Recommended ruling:** Keep both non-canonical" in md
    assert "SECRET-THESIS-TEXT" not in md  # the report lists fields, never a record's text


def test_one_unreadable_section_names_its_error_and_the_rest_render(db, monkeypatch):
    def broken(conn, start, end):
        raise sqlite3.OperationalError("no such table: wisdom_batches")

    monkeypatch.setattr(report, "_costs", broken)
    with store.read() as conn:
        built = report.build_weekly(conn, now=SUNDAY, week_key=WEEK)
    md = report.render_weekly_markdown(built)
    assert "no such table: wisdom_batches" in _markdown_section(md, "## Cost actuals")
    assert all(h in md for h in SECTIONS) and "D16b: deferred" in md
    assert "error" not in built["sections"]["metrics"]


def test_the_dashboard_numbers_come_from_the_same_builders_as_the_report(db):
    with store.write() as conn:
        _seed_week(conn)
        _metric(conn, "uct_see_rate_any", 0, 0)
    with store.read() as conn:
        dash = report.dashboard(conn, now=SUNDAY)
        weekly = report.build_weekly(conn, now=SUNDAY, week_key=WEEK)
    assert dash["week"] == WEEK and dash["d16b"] == "deferred"
    assert dash["metrics"] == weekly["sections"]["metrics"]
    assert dash["budget"] == weekly["sections"]["costs"]
    assert dash["capture_health"] == weekly["sections"]["capture_health"]
    assert dash["scheduled_gates"] == weekly["sections"]["scheduled_gates"]


# ── 4. delivery ──────────────────────────────────────────────────────────────

def test_a_dry_run_stores_a_preview_and_sends_nothing(db, sent, monkeypatch):
    monkeypatch.setenv("WISDOM_WEEKLY_REPORT_ENABLED", "1")
    out = report.run_weekly(_ctx(dry_run=True))
    assert (out["variant"], out["delivery"], out["delivery_note"]) == ("preview", "skipped", "dry run: nothing sent")
    assert sent == []


def test_the_flag_off_stores_the_final_report_and_sends_nothing(db, sent, monkeypatch):
    monkeypatch.delenv("WISDOM_WEEKLY_REPORT_ENABLED", raising=False)
    out = report.run_weekly(_ctx())
    assert (out["variant"], out["delivery"]) == ("final", "skipped")
    assert out["delivery_note"] == "WISDOM_WEEKLY_REPORT_ENABLED is off"
    assert sent == []
    with store.read() as conn:
        (row,) = report.list_reports(conn)
    assert (row["kind"], row["period_key"], row["variant"], row["delivery_status"]) == (
        "weekly", WEEK, "final", "skipped")


def test_with_the_flag_on_the_week_is_sent_once_and_carries_no_source_text(db, sent, monkeypatch):
    monkeypatch.setenv("WISDOM_WEEKLY_REPORT_ENABLED", "1")
    with store.write() as conn:
        _seed_week(conn)
        _metric(conn, "uct_see_rate_any", 0, 0)
    first = report.run_weekly(_ctx(run_id="one"))
    second = report.run_weekly(_ctx(run_id="two"))
    assert first["delivery"] == "sent" and second["delivery"] == "skipped"
    assert second["delivery_note"].startswith("already delivered at")
    (embed,) = sent
    blob = json.dumps(embed)
    assert "SECRET-THESIS-TEXT" not in blob and "D16b: deferred" in embed["description"]
    assert "uct_see_rate_any: 0/0" in embed["description"]
    assert "uct_see_rate_topn: not computed yet" in embed["description"]
    assert len(embed["description"]) <= report.EMBED_DESCRIPTION_MAX
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_reports").fetchone()[0] == 1


def test_a_preview_is_stored_as_a_preview_and_never_delivers(db, sent, monkeypatch):
    monkeypatch.setenv("WISDOM_WEEKLY_REPORT_ENABLED", "1")
    out = report.generate_preview(now=SUNDAY)
    assert out["period_key"] == WEEK and out["markdown"].startswith("# WEEKLY WISDOM REPORT")
    assert sent == []
    with store.read() as conn:
        got = report.get_report(conn, out["report_id"])
    assert got["variant"] == "preview" and got["delivery_status"] == "not_sent"
    assert got["report"]["sections"]["d16b"]["status"] == "deferred"


def test_the_monthly_packet_is_stored_dark_with_its_baseline_n(db, sent):
    with store.write() as conn:
        _metric(conn, "false_positive_rate", 0, 0)
    ctx = registry.JobContext(job_id="wisdom_monthly_packet", now_et=datetime(2026, 10, 4, 20, 22, tzinfo=ET),
                              due_key="2026-10", force=True, dry_run=False, run_id="m1")
    out = report.build_monthly_packet(ctx)
    assert (out["period_key"], out["proposals"], out["delivered"]) == ("2026-10", 0, False)
    assert sent == []
    with store.read() as conn:
        got = report.get_report(conn, out["report_id"])
    assert got["kind"] == "monthly_packet" and got["delivery_status"] == "not_sent"
    assert "| false_positive_rate | 0/0 |" in got["markdown"]
    assert "no proposal generator in Wave 1" in got["markdown"]


# ── 6. the tools ─────────────────────────────────────────────────────────────

def _run_tool(name, *args):
    return subprocess.run([sys.executable, str(REPO / "tools" / "wisdom" / name), *args],
                          capture_output=True, text=True, encoding="utf-8", errors="replace",
                          cwd=str(REPO), timeout=300)


def test_the_preview_tool_writes_the_report_to_the_path_it_is_given(db, tmp_path):
    out_md = tmp_path / "out" / "preview.md"
    done = _run_tool("publish_report_preview.py", "--db", str(db), "--out", str(out_md), "--week", WEEK)
    assert done.returncode == 0, done.stderr[-2000:]
    assert out_md.read_text(encoding="utf-8").startswith("# WEEKLY WISDOM REPORT — 2026-W38")
    assert json.loads(done.stdout.strip().splitlines()[-1])["persisted"] is False


def test_the_tools_refuse_a_missing_db_and_the_shared_data_root(db, tmp_path):
    import conftest

    assert _run_tool("publish_report_preview.py", "--out", str(tmp_path / "x.md")).returncode == 2
    assert _run_tool("publish_report_preview.py", "--db", str(tmp_path / "absent.db"),
                     "--out", str(tmp_path / "x.md")).returncode == 2
    inside = str(pathlib.Path(conftest.SHARED_DATA_ROOTS[0]) / "wisdom-preview-refusal.md")
    refused = _run_tool("publish_report_preview.py", "--db", str(db), "--out", inside)
    assert refused.returncode == 2 and "inside the shared data root" in refused.stderr
    assert not pathlib.Path(inside).exists()


def test_the_queue_import_tool_loads_into_an_explicit_db_and_a_dry_run_writes_nothing(db, tmp_path):
    queue = tmp_path / "review-queue-v1.jsonl"
    queue.write_text(json.dumps({"tab": "vocabulary", "subject_ref": "vocab:x", "summary": "promote?"}) + "\n",
                     encoding="utf-8")
    dry = _run_tool("publish_queue_import.py", "--db", str(db), "--file", str(queue), "--dry-run")
    assert dry.returncode == 0, dry.stderr[-2000:]
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_review_queue").fetchone()[0] == 0
    real = _run_tool("publish_queue_import.py", "--db", str(db), "--file", str(queue))
    assert real.returncode == 0 and json.loads(real.stdout.strip().splitlines()[-1])["created"] == 1
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_review_queue").fetchone()[0] == 1
    absent = _run_tool("publish_queue_import.py", "--db", str(db), "--file", str(tmp_path / "none.jsonl"))
    assert absent.returncode == 0 and json.loads(absent.stdout)["present"] is False
