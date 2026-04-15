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
            with open(os.path.abspath(p)) as f:
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


def run_ipo_maintenance():
    """Run the IPO theme maintenance check. Logs results."""
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

    return result
