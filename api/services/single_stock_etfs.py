"""Single-stock leveraged/inverse ETF family map.

Spec: docs/superpowers/specs/2026-07-21-single-stock-etf-switcher-design.md.
Shape mirrors industry_map.py (bulk Finviz export -> /data SQLite) with
deliberate divergences: fail-closed validation gates, per-run meta record,
no empty-table self-heal cooldown bypass, and auth-token log redaction.
"""
from __future__ import annotations

import contextlib
import csv
import io
import json
import logging
import os
import re
import sqlite3
import threading
import time
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# Exact header names asserted on EVERY rebuild (spec §3.4 gate 1).
EXPECTED_HEADERS = ["Ticker", "Company", "Sector", "Industry", "Average Volume", "Price"]
_EXPORT_COLS = "1,2,3,4,63,65"  # ids config; headers are the runtime contract


def _num(v) -> Optional[float]:
    """Finviz numeric: '1,234,567' | '12.34' | '-' | '' -> float | None.
    Unparseable NEVER coerces to 0 — zeros feed the liquidity gate (spec §3.4)."""
    if v is None:
        return None
    s = str(v).strip().replace(",", "")
    if not s or s in ("-", "n/a", "N/A"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _fetch_finviz_market() -> list[dict]:
    """Whole-market export (~11k rows) — ETF rows + stock membership in one call.
    Token passed via params and NEVER logged (redaction test-pinned)."""
    token = os.environ.get("FINVIZ_API_KEY", "")
    if not token:
        logger.warning("[ssetf] FINVIZ_API_KEY not set — fetch skipped")
        return []
    url = "https://elite.finviz.com/export.ashx"
    try:
        r = httpx.get(
            url,
            params={"v": "152", "c": _EXPORT_COLS, "auth": token},
            headers={"User-Agent": "Mozilla/5.0", "Accept": "text/csv"},
            timeout=90.0,
            follow_redirects=True,
        )
        r.raise_for_status()
        return list(csv.DictReader(io.StringIO(r.text)))
    except httpx.HTTPStatusError as e:
        logger.warning("[ssetf] Finviz fetch failed: HTTP %s (url redacted)",
                       e.response.status_code)
        return []
    except Exception as e:
        logger.warning("[ssetf] Finviz fetch failed: %s", type(e).__name__)
        return []
