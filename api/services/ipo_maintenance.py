"""
IPO theme maintenance — auto-refresh the Recent IPOs & Spinoffs theme.

Runs on a schedule (weekly) to:
1. Remove holdings older than 12 months from IPO date
2. Flag holdings approaching the 12-month mark
3. Log removals for operator review

The actual ADDITION of new IPOs is manual (operator adds to themes_taxonomy.json)
because determining whether an IPO is "significant" requires judgment.
This service only handles the automated REMOVAL of aged-out IPOs.
"""

import json
import logging
import os
from datetime import datetime, timedelta, timezone

_logger = logging.getLogger(__name__)

# IPO date tracking — operator maintains this mapping
# Format: {ticker: "YYYY-MM-DD"} for IPO/listing date
IPO_DATES = {
    # 2024 IPOs
    "RDDT": "2024-03-21",
    "RBRK": "2024-04-25",
    "IBTA": "2024-04-18",
    "SAIL": "2024-05-01",
    "LINE": "2024-07-25",
    "TTAN": "2024-12-12",
    # 2024 Spinoffs
    "GEV": "2024-04-02",
    "SOLV": "2024-04-01",
    "VLTO": "2023-09-30",
    "KVUE": "2023-05-04",
    # 2025 IPOs
    "SFD": "2025-01-28",
    "MTSR": "2025-01-31",
    "KRMN": "2025-02-13",
    "CRWV": "2025-03-28",
    "CRCL": "2025-06-05",
    "CHYM": "2025-06-12",
    "OMDA": "2025-06-06",
    "FIG": "2025-07-01",
    "BLSH": "2025-08-13",
    "VG": "2025-01-24",
    "CRIS": "2025-06-01",
    "BLLN": "2025-11-06",
    "SNDK": "2025-02-01",
    "KLAR": "2025-11-01",
    "MDLN": "2025-12-17",
    # 2026 IPOs
    "EQPT": "2026-01-23",
    "YSS": "2026-01-29",
    "BTGO": "2026-01-22",
    "FPS": "2026-02-05",
    "MWH": "2026-02-11",
    "MANE": "2026-02-04",
    "SWMR": "2026-03-17",
    "SGP": "2026-02-06",
    "AKTS": "2026-01-09",
}


def check_ipo_expirations():
    """Check which IPOs are older than 12 months and should be removed.
    Returns dict with 'expired' and 'expiring_soon' lists.
    """
    now = datetime.now(timezone.utc).date()
    cutoff = now - timedelta(days=365)
    warning = now - timedelta(days=335)  # 30 days before expiry

    expired = []
    expiring_soon = []
    unknown = []

    # Load taxonomy
    paths = [
        os.path.join(os.path.dirname(__file__), "..", "..", "themes_taxonomy.json"),
        "/app/themes_taxonomy.json",
    ]
    taxonomy = None
    for p in paths:
        if os.path.exists(os.path.abspath(p)):
            # ⛔ ENCODING IS EXPLICIT. Bare `open()` uses the LOCALE encoding, and
            # `themes_taxonomy.json` carries non-ASCII company names — so this
            # raised UnicodeDecodeError on cp1252 (every Windows box, including
            # the one the operator runs the curation tools on) while working on
            # Railway. A maintenance job that only ever ran on the machine where
            # it crashes is a special kind of silent.
            with open(os.path.abspath(p), encoding="utf-8") as f:
                taxonomy = json.load(f)
            break

    if not taxonomy:
        return {"expired": [], "expiring_soon": [], "unknown": []}

    ipo_theme = next((t for t in taxonomy["themes"] if t["id"] == "recent_ipos"), None)
    if not ipo_theme:
        return {"expired": [], "expiring_soon": [], "unknown": []}

    for h in ipo_theme["holdings"]:
        sym = h["sym"]
        if sym in IPO_DATES:
            ipo_date = datetime.strptime(IPO_DATES[sym], "%Y-%m-%d").date()
            if ipo_date < cutoff:
                expired.append({"sym": sym, "ipo_date": IPO_DATES[sym], "days_since": (now - ipo_date).days})
            elif ipo_date < warning:
                expiring_soon.append({"sym": sym, "ipo_date": IPO_DATES[sym], "days_remaining": (ipo_date + timedelta(days=365) - now).days})
        else:
            unknown.append(sym)

    return {"expired": expired, "expiring_soon": expiring_soon, "unknown": unknown}


def digest_text(result) -> str:
    """The operator-facing summary of one check, or "" when there is nothing to say.

    ⛔ EMPTY IS A REAL ANSWER. A weekly ping that always fires is a weekly ping
    nobody reads; this returns "" on a clean week so the notification only ever
    means "there is something for you to do".
    """
    lines = []
    if result.get("expired"):
        lines.append("**Aged out (>12 months) — remove from `recent_ipos`:** "
                     + ", ".join(f"{e['sym']} ({e['days_since']}d)"
                                 for e in result["expired"]))
    if result.get("expiring_soon"):
        lines.append("**Expiring within 30 days:** "
                     + ", ".join(f"{e['sym']} ({e['days_remaining']}d left)"
                                 for e in result["expiring_soon"]))
    if result.get("unknown"):
        lines.append("**No IPO date tracked** (add to `IPO_DATES`): "
                     + ", ".join(result["unknown"]))
    return "\n".join(lines)


def run_ipo_maintenance():
    """Run the IPO theme maintenance check. Logs results + pings the operator.

    ⛔ THE DELIVERY IS THE POINT, NOT DECORATION. This function's docstring said
    *"Runs on a schedule (weekly)"* while it sat in NO scheduler with ZERO
    callers — the reachability audit's §3e, and a verbatim repeat of the
    session-insights precedent (defined, never wired, deferred work silently
    uncollected for weeks). Wiring it to log alone would have been the other half
    of the same lie: `lesson_scheduler_job_return_value_goes_nowhere` — a job's
    return value goes nowhere and Railway keeps ~500 log lines, so a weekly
    WARNING is indistinguishable from a job that never ran. The removal it asks
    for is a MANUAL edit to `themes_taxonomy.json` (the owner's inviolable
    baseline — see the Theme Membership Engine invariants), so the artifact has
    to reach a human. Discord is where this repo already sends operator digests.

    Inert without `DISCORD_WEBHOOK_URL`; never raises.
    """
    result = check_ipo_expirations()

    if result["expired"]:
        _logger.warning("[IPO] %d expired IPOs to remove: %s",
                       len(result["expired"]),
                       ", ".join(f"{e['sym']} ({e['days_since']}d)" for e in result["expired"]))

    if result["expiring_soon"]:
        _logger.info("[IPO] %d IPOs expiring within 30 days: %s",
                    len(result["expiring_soon"]),
                    ", ".join(f"{e['sym']} ({e['days_remaining']}d left)" for e in result["expiring_soon"]))

    if result["unknown"]:
        _logger.warning("[IPO] %d IPOs with no tracked date: %s",
                       len(result["unknown"]), ", ".join(result["unknown"]))

    body = digest_text(result)
    if body:
        try:
            from api.services.discord_notify import _send_webhook
            _send_webhook({
                "title": "🗓️ Recent IPOs — theme maintenance",
                "description": body[:3900],
                "color": 0xC9A84C,  # UCT gold
            })
        except Exception as e:                 # pragma: no cover - never break the job
            _logger.warning("[IPO] digest notification failed (non-fatal): %s", e)
    else:
        _logger.info("[IPO] nothing aged out or expiring — no digest sent")

    return result
