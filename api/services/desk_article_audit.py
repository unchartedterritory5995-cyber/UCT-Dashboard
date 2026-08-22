"""Did the article pipeline actually run? Re-reads the ARTIFACTS and says so.

Every stage of the native-articles chain is deliberately fail-soft: the poll
cannot break the roster, a body cannot break the poll, the index cannot break an
article, a missing video cannot break the reader. That is right for
availability — and it means TOTAL FAILURE LOOKS EXACTLY LIKE A QUIET WEEK.

The Desk already learned this once. `desk_session_audit` exists because the
video pipeline had this same shape, and its insights pass sat "written,
documented as scheduled, wired into no scheduler" for weeks without a symptom.
This is the articles equivalent, deliberately built to the same rules:

  * READ THE ARTIFACT, NEVER A COUNTER. Everything below is derived from the
    stored rows on each run. An in-memory tally would reset on every redeploy —
    and this pod redeploys many times a day — so it would report healthy
    straight through a total outage.
  * NAME THINGS, DON'T COUNT THEM. "3 articles missing bodies" sends someone
    hunting; naming them is a two-minute fix.
  * A GRACE WINDOW IS LOAD-BEARING. A post published minutes ago legitimately
    has no body yet (RSS carries it within the hour, the backfill within ~9h).
    Without the window this fires on every healthy Sunday and gets muted.

⛔ THE STALENESS CHECK IS THE POINT. Missing bodies are self-healing; a poller
that stopped is not. `days_since_newest_post` is the one number that catches
"the whole thing died" rather than "one step lagged".
"""
from __future__ import annotations

import json
import os
import time

_DEFAULT_GRACE_SECS = 12 * 3600        # a body lands within the hour; 12h is slack
_DEFAULT_STALE_DAYS = 10.0             # the letter is weekly; 10d means two missed
_DEFAULT_MAX_NAMED = 12


def is_enabled() -> bool:
    return os.environ.get("DESK_ARTICLE_AUDIT_ENABLED", "1") != "0"


def _num(env: str, default):
    try:
        return type(default)(os.environ.get(env, default))
    except (TypeError, ValueError):
        return default


def audit_articles(*, now: float | None = None) -> dict:
    """Re-read the store and report what is missing. Pure-ish: no alerting."""
    from api.services import desk_store, substack_article

    now = time.time() if now is None else now
    grace = max(0, int(_num("DESK_ARTICLE_AUDIT_GRACE_SECS", _DEFAULT_GRACE_SECS)))
    stale_days = float(_num("DESK_ARTICLE_AUDIT_STALE_DAYS", _DEFAULT_STALE_DAYS))
    cap = int(_num("DESK_ARTICLE_AUDIT_MAX_NAMED", _DEFAULT_MAX_NAMED))

    rows = desk_store.list_posts(limit=5000)
    report = {
        "checked": len(rows),
        "with_body": sum(1 for r in rows if r.get("has_body")),
        "indexed": desk_store.count_indexed_posts(),
        "fts_available": desk_store.fts_available(),
        "converter_version": substack_article.CONVERTER_VERSION,
        "grace_secs": grace,
        "problems": [],          # human-readable, each one actionable
        "missing_bodies": [],
        "missing_from_index": [],
        "stale_converter": 0,
        "days_since_newest_post": None,
        "newest_post": None,
        "sunday_scans_watchlist": None,
    }
    if not rows:
        report["problems"].append("no articles at all — the poller has never stored one")
        return report

    newest = max((r.get("published_at") or 0) for r in rows)
    if newest:
        days = (now - newest) / 86400.0
        report["days_since_newest_post"] = round(days, 1)
        report["newest_post"] = next(
            (r.get("display_title") or r.get("title") for r in rows
             if (r.get("published_at") or 0) == newest), None)
        # ⛔ The one check that catches "the whole pipeline died" rather than
        # "one step lagged". Everything else self-heals; this does not.
        if days > stale_days:
            report["problems"].append(
                f"no new post in {days:.0f} days (newest: {report['newest_post']}) — "
                "the poller may have stopped")

    # Past the grace window, an article with no body is a real gap: RSS supplies
    # the newest ~20 within the hour and the backfill walks the rest.
    for r in rows:
        if r.get("has_body"):
            continue
        age = now - (r.get("published_at") or 0)
        if age > grace:
            report["missing_bodies"].append(r.get("display_title") or r.get("title"))
    if report["missing_bodies"]:
        report["problems"].append(
            f"{len(report['missing_bodies'])} article(s) still have no body past the "
            "grace window")

    if report["fts_available"]:
        missing = desk_store.posts_missing_from_index(limit=500)
        report["missing_from_index"] = [
            (m.get("display_title") or m.get("title")) for m in missing]
        if missing:
            report["problems"].append(
                f"{len(missing)} article(s) hold a body but are absent from search — "
                "a search that finds nothing reads as 'he never wrote about it'")
    else:
        report["problems"].append("FTS5 unavailable — archive search is off")

    stale = desk_store.posts_needing_body(substack_article.CONVERTER_VERSION, limit=500)
    report["stale_converter"] = len(stale)
    if len(stale) > len(report["missing_bodies"]):
        report["problems"].append(
            f"{len(stale)} article(s) still on an older converter — a version bump "
            "has not finished applying")

    # The community watchlist is a downstream ARTIFACT of the newest issue: once
    # the hourly sync has had its grace, the 'Sunday Scans' prebuilt list must
    # hold exactly the newest roster. A stale list quietly publishes LAST week's
    # names under this week's letter — precisely the fail-soft-looks-quiet shape
    # this audit exists to catch. (The list name is DERIVED from the module that
    # owns it, never restated here.)
    try:
        latest = desk_store.latest_post_with_tickers()
    except Exception:  # noqa: BLE001 — an old schema without the column is not a finding
        latest = None
    if latest and (now - (latest.get("published_at") or 0)) > grace:
        desired = {str(t).upper() for t in (latest.get("tickers") or []) if t}
        if desired:
            try:
                from api.services import watchlist_prebuilt as wp
                from api.services import watchlist_service as wl
                nm = wp.SUNDAY_SCANS_NAME.strip().lower()
                row = next((w for w in wl.list_prebuilt_watchlists(500)
                            if (w.get("name") or "").strip().lower() == nm), None)
                if row is None:
                    report["problems"].append(
                        f"the '{wp.SUNDAY_SCANS_NAME}' community watchlist is MISSING — "
                        f"the newest issue ({latest.get('title')}) has a roster and no "
                        "list carries it")
                else:
                    listed = {(i.get("sym") or "").upper() for i in (row.get("items") or [])}
                    report["sunday_scans_watchlist"] = {
                        "listed": len(listed), "expected": len(desired)}
                    if listed != desired:
                        missing = sorted(desired - listed)[:cap]
                        extra = sorted(listed - desired)[:cap]
                        detail = []
                        if missing:
                            detail.append("missing: " + ", ".join(missing))
                        if extra:
                            detail.append("not in the issue: " + ", ".join(extra))
                        report["problems"].append(
                            f"the '{wp.SUNDAY_SCANS_NAME}' community watchlist is STALE "
                            f"vs the newest issue ({latest.get('title')}) — "
                            + "; ".join(detail))
            except Exception as e:  # noqa: BLE001 — an unreadable store IS the finding
                report["problems"].append(
                    "could not read the community watchlist store to verify the "
                    f"Sunday Scans list: {str(e)[:120]}")

    for key in ("missing_bodies", "missing_from_index"):
        report[key] = report[key][:cap]
    return report


def format_alert(report: dict) -> str:
    """One Discord-ready block that NAMES what is wrong."""
    lines = [
        f"Archive: **{report.get('with_body', 0)}/{report.get('checked', 0)}** articles readable, "
        f"**{report.get('indexed', 0)}** indexed."
    ]
    for p in report.get("problems", []):
        lines.append(f"• {p}")
    for label, key in (("no body", "missing_bodies"), ("not in search", "missing_from_index")):
        named = report.get(key) or []
        if named:
            lines.append(f"  _{label}:_ " + ", ".join(str(n) for n in named))
    return "\n".join(lines)


def _send_alert(text: str) -> None:
    from api.services import discord_notify
    discord_notify._send_webhook({
        "title": "⚠️ Desk articles — the pipeline needs a look",
        "description": text, "color": 0xE0A800})


def run_audit_and_alert(*, now: float | None = None) -> dict:
    """Scheduler entry point. Silent when healthy; one message naming every gap
    when not. NEVER raises — a failing alert channel must not take down the
    scheduler thread it shares with everything else."""
    if not is_enabled():
        return {"skipped": "disabled"}
    try:
        report = audit_articles(now=now)
    except Exception as e:  # noqa: BLE001
        print(f"[article-audit] audit failed (non-fatal): {str(e)[:200]}")
        return {"error": str(e)[:200]}
    if report.get("problems"):
        try:
            _send_alert(format_alert(report))
        except Exception as e:  # noqa: BLE001
            print(f"[article-audit] alert failed (non-fatal): {e}")
    return report
