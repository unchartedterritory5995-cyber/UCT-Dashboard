"""The WEEKLY WISDOM REPORT and the monthly recognition packet (W1 Part 7, §0.6; CONTRACTS §6.6).

One JSON document is built from wisdom.db; the markdown and the Discord embed
are both RENDERED from that document, so the three can never disagree.

⛔ EVERY RATE PRINTS ITS n. A ratio renders "k/n (p%)" and 0/0 renders "0/0",
never a percentage (W1 §0.6). A metric that was never computed is listed as
"not computed yet", never as zero.

⛔ DELIVERY IS GATED TWICE. The admin Discord embed goes out only when
WISDOM_WEEKLY_REPORT_ENABLED is on AND the run is not a dry run, and at most
once per (week, variant). The embed carries counts and ratios only — no
transcript text, no quotes, no positions. The full report stays in
wisdom_reports and on the admin page.

⛔ NOTHING HERE READS JOURNAL / J2 / NOTEBOOK / BROKER DATA. The report says so
in its "D16b: deferred" section (W1 Part 10).

Every section is built independently and a section that cannot be read says
why instead of failing the report.
"""
from __future__ import annotations

import importlib
import json
import logging
import sqlite3
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Optional

from api.services.wisdom.core import flags, heartbeat, ids, store, timeutil
from api.services.wisdom.publish import chain, review
from api.services.wisdom.publish.schema import module_available

log = logging.getLogger(__name__)

REPORT_VERSION = "weekly-v1"
PACKET_VERSION = "recognition-packet-v0"

# CONTRACTS §6.5 metric names (test_wisdom_publish_admin_report derives them from the contract).
EXPECTED_METRICS = (
    "uct_see_rate_any", "uct_see_rate_topn", "uct_see_rate_setup", "false_positive_rate",
    "outcome_weighted_see_rate", "grounding_faithfulness", "grounding_citation_validity",
    "grounding_coverage", "extractor_precision", "extractor_recall", "capture_health",
)

FIRST_WEEKLY_REPORT_DUE = date(2026, 9, 20)  # W1 §9.1 scheduled gate
D20_REPLAY_BASELINE_N = 100                   # W1 D20 / CONTRACTS §6.6
D20_SILENT_SCORING_DAYS = 14
MEMBER_VIEW_LOOPS = 4                         # W1 §9.2
CAPTURE_HEALTH_SESSIONS = 3                   # W1 D12
LIST_CAP = 50
EMBED_DESCRIPTION_MAX = 3900


# ── small helpers ────────────────────────────────────────────────────────────

def ratio_text(numerator: Any, denominator: Any) -> str:
    """'k/n (p%)'; a zero denominator prints 'k/0' and never a percentage."""
    n = int(numerator or 0)
    d = int(denominator or 0)
    if d <= 0:
        return f"{n}/{d}"
    return f"{n}/{d} ({100.0 * n / d:.1f}%)"


def week_key_for(now: datetime) -> str:
    year, week, _ = timeutil.to_et(now).isocalendar()
    return f"{year}-W{week:02d}"


def week_window(week_key: str) -> tuple[date, date]:
    year, week = week_key.split("-W")
    monday = date.fromisocalendar(int(year), int(week), 1)
    return monday, monday + timedelta(days=6)


def _loads(text: Optional[str]) -> Any:
    if text is None:
        return None
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return {"unparsed": True}


def _section(fn: Callable[[], dict]) -> dict:
    try:
        return fn()
    except sqlite3.Error as exc:
        return {"error": f"could not read wisdom.db: {type(exc).__name__}: {exc}"}
    except Exception as exc:  # a section never takes the report down
        log.exception("[wisdom] report section failed")
        return {"error": f"{type(exc).__name__}: {exc}"}


def _optional_callable(module: str, attr: str) -> Optional[Callable]:
    if not module_available(module):
        return None
    try:
        fn = getattr(importlib.import_module(module), attr, None)
    except Exception:
        log.exception("[wisdom] %s failed to import", module)
        return None
    return fn if callable(fn) else None


# ── sections ─────────────────────────────────────────────────────────────────

def _calls(conn: sqlite3.Connection, start: date, end: date) -> dict:
    rows = [dict(r) for r in conn.execute(
        "SELECT record_type, author_id, ticker, direction, stance, setup_name_raw, vocab_id, status, "
        "stated_at_et, source_id, segment_id, hindsight, is_guest FROM wisdom_records "
        "WHERE record_type IN ('CALL', 'NEGATIVE_CALL') AND status != 'superseded' "
        "AND substr(stated_at_et, 1, 10) BETWEEN ? AND ? ORDER BY stated_at_et, record_id",
        (start.isoformat(), end.isoformat()))]
    by_type: dict = {}
    for r in rows:
        bucket = by_type.setdefault(r["record_type"], {"confirmed": 0, "provisional": 0, "rejected": 0, "combined": 0})
        if r["status"] in bucket:
            bucket[r["status"]] += 1
        bucket["combined"] += 1
    by_author: dict = {}
    for r in rows:
        by_author[r["author_id"] or "unknown"] = by_author.get(r["author_id"] or "unknown", 0) + 1
    listed = [{"type": r["record_type"], "author": r["author_id"], "ticker": r["ticker"],
               "direction": r["direction"], "stance": r["stance"], "setup": r["vocab_id"] or r["setup_name_raw"],
               "status": r["status"], "date": (r["stated_at_et"] or "")[:10], "hindsight": bool(r["hindsight"]),
               "locator": f"{r['source_id']}#{r['segment_id']}"} for r in rows[:LIST_CAP]]
    return {"n": len(rows), "by_type": by_type, "by_author": by_author, "listed": listed,
            "truncated": max(0, len(rows) - LIST_CAP)}


def _principles(conn: sqlite3.Connection, start: date, end: date) -> dict:
    new = [dict(r) for r in conn.execute(
        "SELECT principle_key, category, author_id, canonical, status, is_guest FROM wisdom_principles "
        "WHERE substr(first_seen_at, 1, 10) BETWEEN ? AND ? ORDER BY first_seen_at, principle_key",
        (start.isoformat(), end.isoformat()))]
    reinforced = [dict(r) for r in conn.execute(
        "SELECT s.principle_key, s.relation, COUNT(*) AS n FROM wisdom_principle_support s "
        "JOIN wisdom_records r ON r.record_id = s.record_id "
        "WHERE s.relation IN ('reinforces', 'qualifies') AND substr(r.stated_at_et, 1, 10) BETWEEN ? AND ? "
        "GROUP BY s.principle_key, s.relation ORDER BY n DESC, s.principle_key", (start.isoformat(), end.isoformat()))]
    for p in new:
        p["canonical"] = {1: "canonical", 0: "non-canonical"}.get(p["canonical"], "provisional")
    return {"new": new[:LIST_CAP], "new_n": len(new), "reinforced": reinforced[:LIST_CAP]}


def _contradictions(conn: sqlite3.Connection, start: date, end: date) -> dict:
    open_items = []
    for item in review.list_items(conn, tab="contradictions", status="open", limit=LIST_CAP):
        detail = review.get_item(conn, item["item_id"]) or {}
        sides = (detail.get("evidence") or {}).get("side_by_side") or []
        open_items.append({"item_id": item["item_id"], "summary": item["summary"],
                           "recommendation": item["recommendation"], "side_by_side": sides})
    decided = conn.execute(
        "SELECT COUNT(*) FROM wisdom_review_queue WHERE tab = 'contradictions' AND status != 'open' "
        "AND substr(resolved_at, 1, 10) BETWEEN ? AND ?", (start.isoformat(), end.isoformat())).fetchone()[0]
    return {"open": open_items, "open_n": len(open_items), "decided_this_week": decided}


def _consecutive_ok(rows: list) -> dict:
    per: dict = {}
    for r in rows:
        per.setdefault(str(r.get("dataset")), []).append(r)
    out = {}
    for dataset, items in per.items():
        items.sort(key=lambda x: str(x.get("session_date") or ""), reverse=True)
        streak = 0
        for it in items:
            if it.get("health") == "holiday":
                continue
            if it.get("health") != "ok":
                break
            streak += 1
        out[dataset] = streak
    return out


def _expand_health_table(rows: list) -> list:
    """capture.health_table returns ONE NESTED entry per registered dataset —
    ``{'dataset', 'latest', 'sessions': [run rows], ...}`` — while the local
    fallback returns one FLAT row per (dataset, session). Normalise to flat rows
    so `_consecutive_ok` and the latest-per-dataset pick read the same shape
    either way.

    ⚰️ Written because the nested shape carries no top-level `health` /
    `session_date` / `row_count`, so every dataset scored `health=None` and a
    streak of 0 no matter how healthy capture actually was — which silently
    pinned the D12 capture-health gate at 0/N forever.

    ⛔ A dataset with NO runs keeps a placeholder row rather than vanishing: the
    gate's denominator is `len(datasets)`, so dropping the empty ones would let
    one healthy dataset read as "met" while the rest had never captured."""
    flat: list = []
    for r in rows:
        sessions = r.get("sessions")
        if not isinstance(sessions, list):
            flat.append(r)
            continue
        dataset = r.get("dataset")
        if not sessions:
            flat.append({"dataset": dataset, "session_date": None, "row_count": None,
                         "trailing_median": None, "health": None})
            continue
        flat.extend({**s, "dataset": dataset} for s in sessions)
    return flat


def _capture(conn: sqlite3.Connection, today: date) -> dict:
    fn = _optional_callable("api.services.wisdom.capture", "health_table")
    if fn is not None:
        rows = _expand_health_table([dict(r) for r in (fn(conn, days=10) or [])])
        source = "capture.health_table"
    else:
        since = (today - timedelta(days=21)).isoformat()
        rows = [dict(r) for r in conn.execute(
            "SELECT dataset, session_date, status, row_count, trailing_median, health, MAX(started_at) AS started_at "
            "FROM wisdom_capture_runs WHERE session_date >= ? GROUP BY dataset, session_date "
            "ORDER BY dataset, session_date DESC", (since,))]
        source = "wisdom_capture_runs (capture.health_table not built yet)"
    latest: dict = {}
    for r in rows:
        key = str(r.get("dataset"))
        if key not in latest or str(r.get("session_date") or "") > str(latest[key].get("session_date") or ""):
            latest[key] = r
    streaks = _consecutive_ok(rows)
    table = [{"dataset": ds, "session_date": r.get("session_date"), "row_count": r.get("row_count"),
              "trailing_median": r.get("trailing_median"), "health": r.get("health"),
              "consecutive_ok_sessions": streaks.get(ds, 0)} for ds, r in sorted(latest.items())]
    return {"source": source, "datasets": table, "n_datasets": len(table)}


def _metrics(conn: sqlite3.Connection) -> dict:
    rows = [dict(r) for r in conn.execute(
        "SELECT m.metric, m.slice_json, m.numerator, m.denominator, m.value, m.method_version, m.computed_at "
        "FROM wisdom_metrics m JOIN (SELECT metric, slice_json, MAX(computed_at) AS c FROM wisdom_metrics "
        "GROUP BY metric, slice_json) x ON m.metric = x.metric AND m.slice_json = x.slice_json "
        "AND m.computed_at = x.c ORDER BY m.metric, m.slice_json")]
    out = [{"metric": r["metric"], "slice": _loads(r["slice_json"]) or {}, "numerator": r["numerator"],
            "denominator": r["denominator"], "display": ratio_text(r["numerator"], r["denominator"]),
            "value": r["value"] if r["denominator"] else None, "method_version": r["method_version"],
            "computed_at": r["computed_at"]} for r in rows]
    present = {r["metric"] for r in out}
    return {"rows": out[:200], "n_rows": len(out), "not_computed": [m for m in EXPECTED_METRICS if m not in present]}


def _headline(metrics: dict, name: str) -> Optional[dict]:
    rows = [r for r in metrics.get("rows", []) if r["metric"] == name]
    for wanted in ({}, {"status": "combined"}):
        for r in rows:
            if r["slice"] == wanted:
                return r
    return None


def _extractor(conn: sqlite3.Connection, metrics: dict) -> dict:
    runs = []
    for r in conn.execute(
            "SELECT e.run_id, e.kind, e.extractor_version, e.method_version, e.n, e.metrics_json, e.created_at "
            "FROM wisdom_eval_runs e JOIN (SELECT kind, MAX(created_at) AS c FROM wisdom_eval_runs GROUP BY kind) x "
            "ON e.kind = x.kind AND e.created_at = x.c ORDER BY e.kind"):
        d = dict(r)
        d["metrics"] = _loads(d.pop("metrics_json"))
        runs.append(d)
    rates = [r for r in metrics.get("rows", []) if r["metric"] in ("extractor_precision", "extractor_recall")]
    return {"eval_runs": runs, "rates": rates}


def _costs(conn: sqlite3.Connection, start: date, end: date) -> dict:
    def totals(where: str = "", params: tuple = ()) -> dict:
        row = conn.execute(
            "SELECT COUNT(*) AS batches, COALESCE(SUM(cost_usd_actual), 0) AS actual, "
            "COALESCE(SUM(CASE WHEN cost_usd_actual IS NULL THEN cost_usd_estimate END), 0) AS pending_estimate "
            f"FROM wisdom_batches {where}", params).fetchone()
        return {"batches": row["batches"], "actual_usd": round(row["actual"], 4),
                "pending_estimate_usd": round(row["pending_estimate"], 4)}

    cap = conn.execute("SELECT budget_cap_usd FROM wisdom_batches ORDER BY submitted_at DESC LIMIT 1").fetchone()
    out = {"this_week": totals("WHERE substr(submitted_at, 1, 10) BETWEEN ? AND ?",
                               (start.isoformat(), end.isoformat())),
           "to_date": totals(),
           "budget_cap_usd": cap["budget_cap_usd"] if cap else None,
           "budget_cap_source": "latest wisdom_batches row" if cap else "no batch submitted yet",
           "not_tracked_here": "R2 storage and X/TwitterAPI.io spend are not recorded in wisdom.db"}
    fn = _optional_callable("api.services.wisdom.extract.budget", "budget_status")
    if fn is not None:
        try:
            out["extract_budget"] = fn(conn)
        except Exception as exc:
            out["extract_budget"] = {"error": f"{type(exc).__name__}: {exc}"}
    return out


def _d20_silent_days(conn: sqlite3.Connection) -> dict:
    for module in ("api.services.wisdom.publish.level_alerts", "api.services.wisdom.publish.lookalike"):
        fn = _optional_callable(module, "silent_scoring_days")
        if fn is not None:
            try:
                return {"days": int(fn(conn)), "source": f"{module}.silent_scoring_days"}
            except Exception as exc:
                return {"days": None, "source": f"{module}: {type(exc).__name__}: {exc}"}
    return {"days": None, "source": "publish.level_alerts / publish.lookalike not built yet"}


def _gates(conn: sqlite3.Connection, today: date, metrics: dict, capture: dict, week_key: str) -> list:
    gates = []
    first_week = week_key_for(datetime.combine(FIRST_WEEKLY_REPORT_DUE, datetime.min.time(), tzinfo=timeutil.ET))
    first = conn.execute("SELECT generated_at FROM wisdom_reports WHERE kind = 'weekly' AND variant = 'final' "
                         "AND period_key = ?", (first_week,)).fetchone()
    gates.append({
        "gate": "First WEEKLY WISDOM REPORT (W1 §9.1)", "due": FIRST_WEEKLY_REPORT_DUE.isoformat(),
        "status": "met" if (first or week_key == first_week) else (
            "scheduled" if today <= FIRST_WEEKLY_REPORT_DUE else "missed"),
        "evidence": f"final weekly report for {first_week}" + (" stored" if first else " not stored yet")})
    datasets = capture.get("datasets") or []
    healthy = sum(1 for d in datasets if d["consecutive_ok_sessions"] >= CAPTURE_HEALTH_SESSIONS)
    gates.append({
        "gate": f"Capture health: {CAPTURE_HEALTH_SESSIONS} consecutive sessions per dataset (D12)",
        "due": "3 trading sessions after capture is armed",
        "status": ("not started" if not datasets else "met" if healthy == len(datasets) else "in progress"),
        "evidence": f"datasets at {CAPTURE_HEALTH_SESSIONS}+ consecutive ok sessions: {ratio_text(healthy, len(datasets))}"})
    see = _headline(metrics, "uct_see_rate_any")
    replay_n = int(see["denominator"]) if see else 0
    silent = _d20_silent_days(conn)
    d20_met = replay_n >= D20_REPLAY_BASELINE_N and (silent["days"] or 0) >= D20_SILENT_SCORING_DAYS
    gates.append({
        "gate": f"D20 enable: CALL-REPLAY baseline n >= {D20_REPLAY_BASELINE_N} and "
                f">= {D20_SILENT_SCORING_DAYS} days of silent scoring",
        "due": "after both conditions hold; enabling stays the owner's flag flip",
        "status": "conditions met (owner flip pending)" if d20_met else "not met",
        "evidence": f"replay calls n={replay_n}; silent scoring days="
                    f"{silent['days'] if silent['days'] is not None else 'unknown'} ({silent['source']})"})
    delivered = [r["period_key"] for r in conn.execute(
        "SELECT period_key FROM wisdom_reports WHERE kind = 'weekly' AND variant = 'final' "
        "AND delivery_status = 'sent' ORDER BY period_key DESC")]
    streak = 0
    expected = week_key
    for key in delivered:
        if key != expected:
            break
        streak += 1
        monday, _ = week_window(key)
        expected = week_key_for(datetime.combine(monday - timedelta(days=7), datetime.min.time(), tzinfo=timeutil.ET))
    gates.append({
        "gate": f"Members view: {MEMBER_VIEW_LOOPS} consecutive weekly loops before the owner reopens it (W1 §9.2)",
        "due": "not before four consecutive delivered weekly reports",
        "status": "met (owner decision pending)" if streak >= MEMBER_VIEW_LOOPS else "not met",
        "evidence": f"consecutive delivered weekly reports ending {week_key}: {streak}/{MEMBER_VIEW_LOOPS}"})
    return gates


def _jobs(conn: sqlite3.Connection) -> dict:
    return {"heartbeats": heartbeat.job_health(conn), "chains": chain.last_runs(conn)}


# ── the weekly report ────────────────────────────────────────────────────────

def build_weekly(conn: sqlite3.Connection, *, now: datetime, week_key: Optional[str] = None,
                 variant: str = "final") -> dict:
    if variant not in ("preview", "final"):
        raise ValueError(f"unknown variant {variant!r}")
    now = timeutil.to_et(now)
    week_key = week_key or week_key_for(now)
    start, end = week_window(week_key)
    metrics = _section(lambda: _metrics(conn))
    capture = _section(lambda: _capture(conn, now.date()))
    sections = {
        "calls": _section(lambda: _calls(conn, start, end)),
        "principles": _section(lambda: _principles(conn, start, end)),
        "contradictions": _section(lambda: _contradictions(conn, start, end)),
        "capture_health": capture,
        "metrics": metrics,
        "extractor": _section(lambda: _extractor(conn, metrics if "rows" in metrics else {})),
        "review_queue": _section(lambda: review.counts(conn)),
        "costs": _section(lambda: _costs(conn, start, end)),
        "d16b": {"status": "deferred",
                 "note": "D16b: deferred. No Journal, J2, Notebook or broker-fill data is read, matched, "
                         "reconciled or searched (W1 Part 10)."},
        "scheduled_gates": _section(lambda: {"gates": _gates(
            conn, now.date(), metrics if "rows" in metrics else {}, capture if "datasets" in capture else {},
            week_key)}),
        "jobs": _section(lambda: _jobs(conn)),
    }
    return {"report_version": REPORT_VERSION, "kind": "weekly", "period_key": week_key, "variant": variant,
            "window": {"start": start.isoformat(), "end": end.isoformat()},
            "generated_at": timeutil.iso_et(now),
            "flags": [{"env": env, "on": reader(), "member_visible": visible} for env, reader, visible in flags.GATES],
            "sections": sections}


def _md_table(headers: list, rows: list) -> list:
    if not rows:
        return ["_none_"]
    esc = lambda v: "—" if v in (None, "") else str(v).replace("|", "/").replace("\n", " ")  # noqa: E731
    return ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)] + [
        "| " + " | ".join(esc(c) for c in row) + " |" for row in rows]


def _md_error(section: dict) -> Optional[list]:
    return [f"_section unavailable: {section['error']}_"] if "error" in section else None


def render_weekly_markdown(report: dict) -> str:
    s = report["sections"]
    start, end = date.fromisoformat(report["window"]["start"]), date.fromisoformat(report["window"]["end"])
    out = [f"# WEEKLY WISDOM REPORT — {report['period_key']} ({start:%b} {start.day} – {end:%b} {end.day}, {end.year})",
           "", f"Generated {report['generated_at']} · variant **{report['variant']}** · {report['report_version']}",
           "Every rate prints its n; 0/0 prints 0/0.", ""]

    out.append("## Calls")
    calls = s["calls"]
    out += _md_error(calls) or (
        [f"CALL + NEGATIVE_CALL records stated this week: n={calls['n']}", ""]
        + _md_table(["type", "confirmed", "provisional", "rejected", "combined"],
                    [[t, b["confirmed"], b["provisional"], b["rejected"], b["combined"]]
                     for t, b in sorted(calls["by_type"].items())])
        + [""] + _md_table(["author", "records"], sorted(calls["by_author"].items()))
        + [""] + _md_table(["date", "type", "author", "ticker", "dir", "stance", "setup", "status", "locator"],
                           [[c["date"], c["type"], c["author"], c["ticker"], c["direction"],
                             c["stance"] + (" (hindsight)" if c["hindsight"] else "") if c["stance"] else None,
                             c["setup"], c["status"], c["locator"]] for c in calls["listed"]])
        + ([f"_… {calls['truncated']} more on the admin page_"] if calls["truncated"] else []))
    out.append("")

    out.append("## Principles")
    pr = s["principles"]
    out += _md_error(pr) or (
        [f"New this week: {pr['new_n']}", ""]
        + _md_table(["principle", "category", "author", "canonical", "status"],
                    [[p["principle_key"], p["category"], p["author_id"], p["canonical"], p["status"]]
                     for p in pr["new"]])
        + ["", "Reinforced or qualified by this week's statements:", ""]
        + _md_table(["principle", "relation", "n"], [[r["principle_key"], r["relation"], r["n"]]
                                                     for r in pr["reinforced"]]))
    out.append("")

    out.append("## Contradictions")
    co = s["contradictions"]
    if _md_error(co):
        out += _md_error(co)
    else:
        out.append(f"Open: {co['open_n']} · decided this week: {co['decided_this_week']}")
        for item in co["open"]:
            out += ["", f"### {item['summary']}"]
            sides = item["side_by_side"]
            if len(sides) == 2:
                a, b = sides
                out += _md_table(["", "statement A", "statement B"], [
                    ["what", a.get("principle_key"), b.get("record_type")],
                    ["author", a.get("author_id"), b.get("author_id")],
                    ["date", (a.get("first_seen_at") or "")[:10], (b.get("stated_at_et") or "")[:10]],
                    ["locator", a.get("locator"), b.get("locator")]])
            out.append(f"**Recommended ruling:** {item['recommendation'] or 'none recorded'}")
    out.append("")

    out.append("## Capture health")
    ca = s["capture_health"]
    out += _md_error(ca) or (
        [f"Source: {ca['source']}", ""]
        + _md_table(["dataset", "last session", "rows", "trailing median", "health", "consecutive ok"],
                    [[d["dataset"], d["session_date"], d["row_count"], d["trailing_median"], d["health"],
                      d["consecutive_ok_sessions"]] for d in ca["datasets"]]))
    out.append("")

    out.append("## Metrics")
    me = s["metrics"]
    out += _md_error(me) or (
        _md_table(["metric", "slice", "k/n", "method", "computed"],
                  [[r["metric"], json.dumps(r["slice"], sort_keys=True) if r["slice"] else "all", r["display"],
                    r["method_version"], r["computed_at"]] for r in me["rows"]])
        + ([f"Not computed yet: {', '.join(me['not_computed'])}"] if me["not_computed"] else []))
    out.append("")

    out.append("## Extractor")
    ex = s["extractor"]
    out += _md_error(ex) or (
        _md_table(["kind", "extractor version", "method", "n", "created"],
                  [[r["kind"], r["extractor_version"], r["method_version"], r["n"], r["created_at"]]
                   for r in ex["eval_runs"]])
        + [""] + _md_table(["rate", "slice", "k/n"], [[r["metric"], json.dumps(r["slice"], sort_keys=True)
                                                        if r["slice"] else "all", r["display"]] for r in ex["rates"]]))
    out.append("")

    out.append("## Review queue")
    rq = s["review_queue"]
    out += _md_error(rq) or _md_table(
        ["tab", "open", "accepted", "vetoed", "resolved", "total"],
        [[t, c["open"], c["accepted"], c["vetoed"], c["resolved"], c["total"]] for t, c in rq["tabs"].items()]
        + [["**all**", rq["totals"]["open"], rq["totals"]["accepted"], rq["totals"]["vetoed"],
            rq["totals"]["resolved"], rq["totals"]["total"]]])
    out.append("")

    out.append("## Cost actuals")
    cost = s["costs"]
    if _md_error(cost):
        out += _md_error(cost)
    else:
        out += _md_table(["window", "batches", "actual USD", "pending estimate USD"], [
            ["this week", cost["this_week"]["batches"], cost["this_week"]["actual_usd"],
             cost["this_week"]["pending_estimate_usd"]],
            ["to date", cost["to_date"]["batches"], cost["to_date"]["actual_usd"],
             cost["to_date"]["pending_estimate_usd"]]])
        cap = cost["budget_cap_usd"]
        out.append(f"Budget cap: {cap if cap is not None else '—'} ({cost['budget_cap_source']}). "
                   f"{cost['not_tracked_here']}.")
    out.append("")

    out += ["## D16b", s["d16b"]["note"], ""]

    out.append("## Scheduled gates")
    ga = s["scheduled_gates"]
    out += _md_error(ga) or _md_table(["gate", "due", "status", "evidence"],
                                      [[g["gate"], g["due"], g["status"], g["evidence"]] for g in ga["gates"]])
    out.append("")

    out.append("## Jobs")
    jo = s["jobs"]
    if _md_error(jo):
        out += _md_error(jo)
    else:
        out += _md_table(["job", "last status", "last ok", "consecutive failures"],
                         [[h["job_id"], h["last_status"], h["last_ok_at"], h["consecutive_failures"]]
                          for h in jo["heartbeats"]])
        for name, run in jo["chains"].items():
            if run:
                sm = run["summary"]
                out.append(f"- {name} chain {run['due_key']}: ok {sm['ok']} · failed {sm['failed']} · "
                           f"not built {sm['not_available']} · skipped {sm['skipped']}")
    out.append("")
    return "\n".join(out)


def weekly_embed(report: dict) -> dict:
    """Counts and ratios only — never text from a source."""
    s = report["sections"]
    lines = []
    calls = s.get("calls", {})
    if "error" not in calls:
        lines.append(f"Calls stated this week: n={calls['n']}")
    co = s.get("contradictions", {})
    if "error" not in co:
        lines.append(f"Contradictions open: {co['open_n']}")
    me = s.get("metrics", {})
    if "error" not in me:
        for name in ("uct_see_rate_any", "uct_see_rate_topn", "uct_see_rate_setup", "false_positive_rate"):
            row = _headline(me, name)
            lines.append(f"{name}: {row['display'] if row else 'not computed yet'}")
    rq = s.get("review_queue", {})
    if "error" not in rq:
        open_tabs = ", ".join(f"{t} {c['open']}" for t, c in rq["tabs"].items() if c["open"])
        lines.append(f"Review queue open: {rq['totals']['open']}" + (f" ({open_tabs})" if open_tabs else ""))
    cost = s.get("costs", {})
    if "error" not in cost:
        lines.append(f"Batch spend this week: ${cost['this_week']['actual_usd']} · to date ${cost['to_date']['actual_usd']}")
    lines.append("D16b: deferred")
    ga = s.get("scheduled_gates", {})
    if "error" not in ga:
        lines += [f"Gate · {g['gate']}: {g['status']}" for g in ga["gates"]]
    text = "\n".join(lines)
    if len(text) > EMBED_DESCRIPTION_MAX:
        text = text[:EMBED_DESCRIPTION_MAX - 1] + "…"
    return {"title": f"Weekly Wisdom Report — {report['period_key']}", "description": text, "color": 0xC9A84C,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "footer": {"text": "Full report: /admin/wisdom → Reports"}}


# ── storing and delivering ───────────────────────────────────────────────────

def report_id_for(kind: str, period_key: str, variant: str) -> str:
    return ids.sha24("wisdom_report", kind, period_key, variant)


def store_report(conn: sqlite3.Connection, report: dict, markdown: str, *, run_id: Optional[str] = None) -> str:
    report_id = report_id_for(report["kind"], report["period_key"], report["variant"])
    conn.execute(
        "INSERT INTO wisdom_reports (report_id, kind, period_key, variant, generated_at, run_id, markdown, "
        "report_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(report_id) DO UPDATE SET "
        "generated_at = excluded.generated_at, run_id = excluded.run_id, markdown = excluded.markdown, "
        "report_json = excluded.report_json",
        (report_id, report["kind"], report["period_key"], report["variant"], report["generated_at"], run_id,
         markdown, json.dumps(report, default=str, ensure_ascii=False)))
    return report_id


def deliver_weekly(report_id: str, report: dict, *, dry_run: bool) -> dict:
    if dry_run:
        return _record_delivery(report_id, "skipped", "dry run: nothing sent")
    if not flags.weekly_report_enabled():
        return _record_delivery(report_id, "skipped", "WISDOM_WEEKLY_REPORT_ENABLED is off")
    with store.read() as conn:
        row = conn.execute("SELECT delivered_at FROM wisdom_reports WHERE report_id = ?", (report_id,)).fetchone()
    if row is not None and row["delivered_at"]:
        return {"status": "skipped", "note": f"already delivered at {row['delivered_at']}"}
    from api.services import discord_notify

    discord_notify._send_webhook(weekly_embed(report))
    return _record_delivery(report_id, "sent", "admin webhook (fire-and-forget)",
                            delivered_at=timeutil.iso_et(timeutil.now_et()))


def _record_delivery(report_id: str, status: str, note: str, *, delivered_at: Optional[str] = None) -> dict:
    with store.write() as conn:
        conn.execute("UPDATE wisdom_reports SET delivery_status = ?, delivery_note = ?, "
                     "delivered_at = COALESCE(?, delivered_at) WHERE report_id = ?",
                     (status, note, delivered_at, report_id))
    return {"status": status, "note": note}


def run_weekly(ctx) -> dict:
    """Weekly chain step. A dry run stores a PREVIEW and sends nothing."""
    due = ctx.due_key if isinstance(ctx.due_key, str) and "-W" in ctx.due_key else None
    variant = "preview" if ctx.dry_run else "final"
    with store.read() as conn:
        report = build_weekly(conn, now=ctx.now_et, week_key=due, variant=variant)
    markdown = render_weekly_markdown(report)
    with store.write() as conn:
        report_id = store_report(conn, report, markdown, run_id=ctx.run_id)
    delivery = deliver_weekly(report_id, report, dry_run=ctx.dry_run)
    errors = sorted(k for k, v in report["sections"].items() if isinstance(v, dict) and "error" in v)
    return {"report_id": report_id, "period_key": report["period_key"], "variant": variant,
            "delivery": delivery["status"], "delivery_note": delivery["note"], "section_errors": errors}


def generate_preview(*, now: Optional[datetime] = None, week_key: Optional[str] = None,
                     db_path: Optional[str] = None, persist: bool = True) -> dict:
    """The preview the admin page and tools/wisdom/publish_report_preview.py produce. Never delivers."""
    now = now or timeutil.now_et()
    with store.read(db_path) as conn:
        report = build_weekly(conn, now=now, week_key=week_key, variant="preview")
    markdown = render_weekly_markdown(report)
    report_id = report_id_for("weekly", report["period_key"], "preview")
    if persist:
        with store.write(db_path) as conn:
            store_report(conn, report, markdown)
    return {"report_id": report_id, "period_key": report["period_key"], "markdown": markdown, "report": report}


# ── the monthly recognition packet (W6 format, dark) ─────────────────────────

def build_monthly_packet(ctx) -> dict:
    """Baseline 6.1/6.2 with n over the trailing 90 days, plus any candidate definitions.

    Wave 1 has no proposal generator (W6). The packet is stored, never delivered,
    and every proposal is a dark candidate awaiting the owner's gate line."""
    now = timeutil.to_et(ctx.now_et)
    period = ctx.due_key if isinstance(ctx.due_key, str) and len(ctx.due_key) == 7 else now.strftime("%Y-%m")
    variant = "preview" if ctx.dry_run else "final"
    with store.read() as conn:
        metrics = _section(lambda: _metrics(conn))
        baseline = {name: (_headline(metrics, name) or {"display": "not computed yet"})
                    for name in ("uct_see_rate_any", "uct_see_rate_topn", "uct_see_rate_setup", "false_positive_rate")}
        generator = _optional_callable("api.services.wisdom.evals", "recognition_proposals")
        if generator is None:
            proposals, source = [], "no proposal generator in Wave 1 (W6 builds it)"
        else:
            try:
                proposals, source = list(generator(conn, window_days=90) or []), "evals.recognition_proposals"
            except Exception as exc:
                proposals, source = [], f"evals.recognition_proposals failed: {type(exc).__name__}: {exc}"
    packet = {"report_version": PACKET_VERSION, "kind": "monthly_packet", "period_key": period, "variant": variant,
              "window": {"start": (now.date() - timedelta(days=90)).isoformat(), "end": now.date().isoformat()},
              "generated_at": timeutil.iso_et(now),
              "sections": {"baseline": baseline, "proposals": proposals, "proposal_source": source,
                           "gate": "Each proposal ships dark as a candidate definition. Nothing member-visible "
                                   "changes without the owner's gate line (W1 Part 7)."}}
    lines = [f"# RECOGNITION PROPOSAL PACKET — {period}", "",
             f"Generated {packet['generated_at']} · variant **{variant}** · trailing 90 days "
             f"{packet['window']['start']} → {packet['window']['end']}", "", "## Baseline (6.1 / 6.2)"]
    lines += _md_table(["metric", "k/n"], [[k, v["display"]] for k, v in baseline.items()])
    lines += ["", "## Proposals", f"Source: {source}", ""]
    lines += _md_table(["candidate", "expected 6.1", "expected 6.2", "status", "owner gate line"],
                       [[p.get("name"), p.get("expected_see_rate"), p.get("expected_false_positive_rate"),
                         "candidate (dark)", "OWNER GATE: ________"] for p in proposals])
    lines += ["", packet["sections"]["gate"], ""]
    markdown = "\n".join(lines)
    with store.write() as conn:
        report_id = store_report(conn, packet, markdown, run_id=ctx.run_id)
    return {"report_id": report_id, "period_key": period, "variant": variant, "proposals": len(proposals),
            "delivered": False}


# ── reading ──────────────────────────────────────────────────────────────────

def list_reports(conn: sqlite3.Connection, *, kind: Optional[str] = None, limit: int = 20) -> list:
    sql = ("SELECT report_id, kind, period_key, variant, generated_at, run_id, delivery_status, delivery_note, "
           "delivered_at, length(markdown) AS markdown_chars FROM wisdom_reports")
    params: list = []
    if kind:
        sql += " WHERE kind = ?"
        params.append(kind)
    sql += " ORDER BY generated_at DESC LIMIT ?"
    params.append(max(1, min(int(limit), 200)))
    return [dict(r) for r in conn.execute(sql, params)]


def get_report(conn: sqlite3.Connection, report_id: str) -> Optional[dict]:
    row = conn.execute("SELECT * FROM wisdom_reports WHERE report_id = ?", (report_id,)).fetchone()
    if row is None:
        return None
    out = {k: row[k] for k in row.keys() if k != "report_json"}
    out["report"] = _loads(row["report_json"])
    return out


def dashboard(conn: sqlite3.Connection, *, now: Optional[datetime] = None) -> dict:
    """The admin dashboard's numbers, built by the SAME section builders as the weekly
    report, so the page and the report can never show two different values."""
    now = timeutil.to_et(now or timeutil.now_et())
    week = week_key_for(now)
    start, end = week_window(week)
    metrics = _section(lambda: _metrics(conn))
    capture = _section(lambda: _capture(conn, now.date()))
    return {
        "generated_at": timeutil.iso_et(now),
        "week": week,
        "metrics": metrics,
        "capture_health": capture,
        "extractor": _section(lambda: _extractor(conn, metrics if "rows" in metrics else {})),
        "budget": _section(lambda: _costs(conn, start, end)),
        "scheduled_gates": _section(lambda: {"gates": _gates(
            conn, now.date(), metrics if "rows" in metrics else {}, capture if "datasets" in capture else {},
            week)}),
        "d16b": "deferred",
    }
