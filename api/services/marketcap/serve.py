"""The canonical server authority (DARK): read one MCAP_V1 build and answer Market Cap questions.

Nothing in production imports this module. `dark_app.create_app()` mounts it on a standalone FastAPI app for shadow
work; a future, separately authorized cutover would mount the same router in the production app.

Contract (the chart becomes a thin consumer -- it never composes close x shares again):
  GET /api/marketcap/pit/{ticker}?start=YYYY-MM-DD&end=YYYY-MM-DD
  -> {"ticker", "issuer_id", "company_level": true, "build_id",
      "points": [["YYYY-MM-DD", company_market_cap_usd], ...],        # daily, company equity capitalization
      "gaps":   [{"start", "end", "reason", "n_days"}, ...],           # every missing trading day, reason-coded
      "structure": [{"start", "end", "kind", "reason", "components"}]}
  GET /api/marketcap/pit/{ticker}/latest -> {"ticker", "date", "company_market_cap", "security_market_cap", ...}

GOOG and GOOGL return the SAME company series (ruling 6); `security_market_cap` in /latest is the class x own price.
"""
from __future__ import annotations

import json
import os
import sqlite3
from datetime import date
from functools import lru_cache


def _iso(i: int) -> str:
    return f"{i // 10000:04d}-{i // 100 % 100:02d}-{i % 100:02d}"


def _int(s: str) -> int:
    return int(s.replace("-", ""))


class Authority:
    def __init__(self, build_path: str, prices_path: str | None = None):
        self.db = sqlite3.connect(f"file:{build_path}?mode=ro", uri=True, check_same_thread=False)
        self.px = sqlite3.connect(f"file:{prices_path}?mode=ro", uri=True, check_same_thread=False) if prices_path else None
        self.build_id = dict(self.db.execute("SELECT key, value FROM manifest")).get("build_id")

    def issuer_for(self, ticker: str, on: date | None = None) -> tuple[int, dict] | None:
        """Time-bounded ticker -> issuer: the mapping whose listing interval contains `on` (default: latest)."""
        t = ticker.upper().replace(".", "-")
        rows = self.db.execute("SELECT cik, start, end FROM ticker_map WHERE REPLACE(UPPER(ticker),'.','-')=? ORDER BY start DESC",
                               (t,)).fetchall()
        for cik, s, e in rows:
            if on is None or (on.isoformat() >= s and (e is None or on.isoformat() <= e)):
                return cik, {"start": s, "end": e}
        return None

    def series(self, ticker: str, start: str | None = None, end: str | None = None) -> dict | None:
        hit = self.issuer_for(ticker)
        if hit is None:
            return None
        cik, lst = hit
        lo, hi = _int(start) if start else 0, _int(end) if end else 99999999
        pts = [[_iso(d), v] for d, v in self.db.execute("SELECT d, cap FROM cap_daily WHERE cik=? AND d BETWEEN ? AND ? ORDER BY d",
                                                         (cik, lo, hi))]
        gaps = [{"start": _iso(s), "end": _iso(e), "reason": r, "n_days": n} for s, e, r, n in self.db.execute(
            "SELECT start, end, reason, n_days FROM gap_run WHERE cik=? AND end >= ? AND start <= ? ORDER BY start", (cik, lo, hi))]
        reg = [{"start": s, "end": e, "classes": json.loads(c), "kind": k, "reason": r, "components": json.loads(cp)}
               for s, e, c, k, r, _n, cp in self.db.execute("SELECT start, end, classes, kind, reason, note, components FROM regime "
                                                          "WHERE issuer_id=? ORDER BY start", (f"cik:{cik}",))]
        return {"ticker": ticker.upper(), "issuer_id": f"cik:{cik}", "listing": lst, "company_level": True,
                "build_id": self.build_id, "points": pts, "gaps": gaps, "structure": reg}

    def latest(self, ticker: str) -> dict | None:
        hit = self.issuer_for(ticker)
        if hit is None:
            return None
        cik, _ = hit
        row = self.db.execute("SELECT d, cap FROM cap_daily WHERE cik=? ORDER BY d DESC LIMIT 1", (cik,)).fetchone()
        if row is None:
            gap = self.db.execute("SELECT end, reason FROM gap_run WHERE cik=? ORDER BY end DESC LIMIT 1", (cik,)).fetchone()
            return {"ticker": ticker.upper(), "issuer_id": f"cik:{cik}", "company_market_cap": None,
                    "reason": gap[1] if gap else None, "build_id": self.build_id}
        d, cap = row
        sec = None
        comp = self.db.execute("SELECT components FROM regime WHERE issuer_id=? ORDER BY end DESC LIMIT 1", (f"cik:{cik}",)).fetchone()
        if comp and self.px is not None:
            for ck, pt, mult, _ev in json.loads(comp[0]):
                if pt.upper().replace(".", "-") == ticker.upper().replace(".", "-"):
                    sr = self.db.execute("SELECT shares FROM state_run WHERE issuer_id=? AND class_key=? AND start<=? AND end>=?",
                                         (f"cik:{cik}", ck, _iso(d), _iso(d))).fetchone()
                    px = self.px.execute("SELECT c FROM bar WHERE ticker=? AND d=?", (pt.replace(".", "-"), d)).fetchone()
                    if sr and px:
                        sec = (sec or 0.0) + sr[0] * px[0]
        return {"ticker": ticker.upper(), "issuer_id": f"cik:{cik}", "date": _iso(d), "company_market_cap": cap,
                "security_market_cap": sec, "build_id": self.build_id}


@lru_cache(maxsize=1)
def authority() -> Authority:
    b = os.environ.get("MCAP_PIT_V1_BUILD")
    if not b:
        raise RuntimeError("MCAP_PIT_V1_BUILD is not set: the Market Cap PIT authority is dark")
    return Authority(b, os.environ.get("MCAP_PIT_V1_PRICES"))


def router():
    from fastapi import APIRouter, HTTPException

    r = APIRouter()

    @r.get("/api/marketcap/pit/{ticker}")
    def get_series(ticker: str, start: str | None = None, end: str | None = None):
        out = authority().series(ticker, start, end)
        if out is None:
            raise HTTPException(404, "unknown ticker")
        return out

    @r.get("/api/marketcap/pit/{ticker}/latest")
    def get_latest(ticker: str):
        out = authority().latest(ticker)
        if out is None:
            raise HTTPException(404, "unknown ticker")
        return out

    return r
