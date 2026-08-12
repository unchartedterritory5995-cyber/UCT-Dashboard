"""Self-ENFORCING completeness for the earnings wire: heal first, alert second.

The owner's requirement (2026-08-11): *"if I'm looking at that feed … know
what I'm seeing is complete and total."* A pull-based check
(`GET /api/calendar/wire-coverage`) only answers when asked; this job asks on
a schedule, and — unlike the observe-only monitors — when it finds a gap it
FIXES the pipeline before it says a word:

    measure → (gap?) → rebuild the calendar payload + run a detector tick
            → re-measure → alert ONLY what survived the heal.

Healing first is what makes the alert trustworthy. The wire's two lag windows
(the 10-min `calendar_weekly` TTL and the hourly off-window detector tick) are
NORMAL mechanics — an observe-only check firing inside them would cry wolf
four times a day and get muted inside a week (`lesson_gate_that_cannot_fail`'s
cousin: an alert nobody believes). After a forced build + tick, anything still
missing is a real defect: a name all three roster sources missed, a provider
regression, or a broken wire.

Alert rules (the denominator lessons):
- `measured: false` (BOTH provider legs down) alerts as its own WARNING — a
  check that cannot run is a finding, never a clean bill. No heal is attempted
  (there is no truth to heal toward).
- Missing names are NAMED in the message, never just counted
  (`lesson_a_differ_can_truncate_the_names_a_rail_exists_to_report`).
- A weekend/holiday session with zero reporters is `ok` — nothing to show is
  not the same as failing to show it.

Never raises: a monitor that dies on a provider blip silently stops
monitoring, which is the exact failure mode it exists to catch.
"""
from __future__ import annotations

import logging
import os
import threading
from datetime import datetime, timezone

from api.services.wire import coverage
from api.services.wire.session import market_session_date

_logger = logging.getLogger(__name__)

# Read by /api/calendar/wire-coverage consumers and the status probe below —
# the last run's summary, so "when did the monitor last look, and what did it
# see" is answerable without log archaeology.
LAST_RUN: dict = {"at": None, "market_date": None, "result": None}
_run_lock = threading.Lock()

_DISPLAY_CAP = 25   # names shown in an alert before "+N more" (all still logged)


def enabled() -> bool:
    return os.environ.get("WIRE_COVERAGE_MONITOR_ENABLED", "1") == "1"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fmt_names(syms: list[str]) -> str:
    shown = ", ".join(syms[:_DISPLAY_CAP])
    extra = len(syms) - _DISPLAY_CAP
    return f"{shown} +{extra} more" if extra > 0 else shown


def _alert_incomplete(md: str, after: dict) -> None:
    """Discord (owner channel) + in-app, names in the MESSAGE. Best-effort."""
    missing = after.get("missing_from_feed") or []
    pending = after.get("numbers_pending_on_feed") or []
    not_on_roster = after.get("missing_not_on_roster") or []
    lines = []
    if missing:
        lines.append(f"**Missing from the feed ({len(missing)}):** {_fmt_names(missing)}")
    if not_on_roster:
        lines.append(f"**…of which not even on the calendar roster ({len(not_on_roster)}):** "
                     f"{_fmt_names(not_on_roster)}")
    if pending:
        lines.append(f"**On the feed but numbers still pending ({len(pending)}):** "
                     f"{_fmt_names(pending)}")
    body = "\n".join(lines)
    summary = (f"Earnings wire INCOMPLETE for {md} after a forced heal — "
               f"{len(missing)} missing, {len(pending)} pending. "
               f"{_fmt_names((missing + pending))}")

    try:
        from api.services import chart_health_alerts
        chart_health_alerts.emit("wire_coverage_incomplete", "critical", summary,
                                 {"market_date": md,
                                  "missing": missing[:50], "pending": pending[:50]})
    except Exception:  # pragma: no cover
        pass
    try:
        from api.services import discord_notify
        discord_notify._send_webhook({
            "title": "🔴 Earnings wire incomplete (survived a heal)",
            "description": f"Session **{md}** — reported names a member cannot "
                           f"see on the feed:\n{body}",
            "color": 0xE23B3B,
            "timestamp": _now_iso(),
        })
    except Exception:  # pragma: no cover
        pass


def _alert_unmeasured(md: str) -> None:
    try:
        from api.services import chart_health_alerts
        chart_health_alerts.emit(
            "wire_coverage_unmeasured", "warning",
            f"Wire coverage for {md} could NOT be measured — both provider "
            f"legs (Finnhub + FMP) failed. The feed may be incomplete and "
            f"nothing can currently prove otherwise.", {"market_date": md})
    except Exception:  # pragma: no cover
        pass
    try:
        from api.services import discord_notify
        discord_notify._send_webhook({
            "title": "🟡 Wire coverage not measurable",
            "description": f"Session **{md}**: both provider legs failed — "
                           f"completeness of the earnings feed is UNKNOWN "
                           f"(not clean, not broken).",
            "color": 0xE2B93B,
            "timestamp": _now_iso(),
        })
    except Exception:  # pragma: no cover
        pass


def _heal() -> None:
    """Force the two stages whose SCHEDULES are the normal lag: a fresh
    current-week build (writes the `calendar_weekly` TTL cache the detector
    reads) and one detector tick. Both are idempotent and never raise."""
    try:
        from api.routers import calendar as cal
        cal._build_current_week()
    except Exception as exc:
        _logger.warning("wire coverage monitor: forced calendar build failed: %s", exc)
    try:
        from api.services.wire.detector import run_wire_tick
        run_wire_tick()
    except Exception as exc:
        _logger.warning("wire coverage monitor: forced tick failed: %s", exc)


def run_check(heal: bool = True) -> dict:
    """One measure→heal→re-measure→alert pass. Returns a summary. Never raises."""
    result: dict = {"market_date": None, "measured": None, "ok": None,
                    "healed": False, "alerted": False}
    with _run_lock:
        try:
            md = market_session_date()
            result["market_date"] = md

            first = coverage.build_coverage(md)
            result["measured"] = bool(first.get("measured"))
            if not first.get("measured"):
                _alert_unmeasured(md)
                result.update({"alerted": True, "ok": None})
                return result

            gaps = ((first.get("missing_from_feed") or [])
                    or (first.get("numbers_pending_on_feed") or []))
            if not gaps:
                result["ok"] = True
                result["after"] = {k: first.get(k) for k in
                                   ("reported", "on_feed_with_numbers", "ok")}
                return result

            after = first
            if heal:
                _heal()
                result["healed"] = True
                after = coverage.build_coverage(md)

            result["after"] = {k: after.get(k) for k in
                               ("measured", "reported", "on_feed_with_numbers",
                                "missing_from_feed", "numbers_pending_on_feed", "ok")}
            still_broken = (after.get("measured")
                            and ((after.get("missing_from_feed") or [])
                                 or (after.get("numbers_pending_on_feed") or [])))
            result["ok"] = bool(after.get("measured")) and not still_broken
            if still_broken:
                _alert_incomplete(md, after)
                result["alerted"] = True
        except Exception as exc:
            _logger.warning("wire coverage monitor: check failed: %s", exc)
            result["error"] = str(exc)
        finally:
            LAST_RUN.update({"at": _now_iso(),
                             "market_date": result.get("market_date"),
                             "result": result})
    return result
