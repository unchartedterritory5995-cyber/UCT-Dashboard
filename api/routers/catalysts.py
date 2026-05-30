"""Catalyst read endpoints (logged-in users) + admin force-refresh + stats."""
from __future__ import annotations

import datetime as dt
import logging
import re
import threading
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Body, Depends, HTTPException, Path

from api.middleware.auth_middleware import get_current_user, require_admin
from api.services.catalyst import engine, store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["catalysts"])

_ET = ZoneInfo("America/New_York")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _today() -> str:
    return dt.datetime.now(_ET).date().isoformat()


@router.get("/catalysts/today")
def catalysts_today(user=Depends(get_current_user)):
    md = _today()
    rows = store.get_for_date(md, ranked_only=True)
    sector_contexts = engine.get_sector_contexts(md)
    return {
        "market_date": md,
        "generated_at": rows[0]["thesis_at"] if rows else None,
        "rows": rows,
        "sector_contexts": sector_contexts,
    }


@router.get("/catalysts/by-date/{ymd}")
def catalysts_by_date(ymd: str = Path(...), user=Depends(get_current_user)):
    if not _DATE_RE.match(ymd):
        raise HTTPException(400, "date must be YYYY-MM-DD")
    rows = store.get_for_date(ymd, ranked_only=True)
    return {"market_date": ymd, "rows": rows}


@router.post("/catalysts/refresh")
def catalysts_refresh(user=Depends(require_admin)):
    """Trigger an immediate refresh. Runs in a background thread so the HTTP
    response returns immediately — refreshes can take 5–10s."""
    threading.Thread(target=engine.run_refresh, daemon=True,
                     name="catalyst-force-refresh").start()
    return {"ok": True, "message": "Refresh started in background."}


@router.get("/catalysts/explain/{sym}")
def catalysts_explain(sym: str = Path(...), user=Depends(get_current_user)):
    """Why isn't $SYM on today's list? Or what would put it there?

    Runs the SAME source pull + scoring + tagging logic the engine uses,
    isolated to one ticker. Returns a breakdown of which sources surfaced
    it, what tag it would get, what its composite score is, and what
    threshold/quota it would need to make the top-20.
    """
    sym = sym.upper().strip()
    if not sym or not sym.isalpha() or len(sym) > 6:
        raise HTTPException(400, "invalid ticker")

    from api.services.catalyst import sources, scoring, tagging, filters
    candidates = sources.collect_all()

    # Find our ticker first — so we can report a quality-gate exclusion before
    # scoring (excluded candidates never get tagged/scored in the real engine).
    me = next((c for c in candidates if c.get("ticker") == sym), None)
    if me is None:
        return {
            "ticker": sym,
            "found": False,
            "reason": "Ticker did not appear in any source pull (movers, earnings, tweets, RSS, scanner, Perplexity discovery).",
            "score": None,
            "tag": None,
            "signal_summary": {},
        }

    passed, gate_reason = filters.quality_gate(me)
    if passed:
        passed, gate_reason = filters.is_real_catalyst(me)
    if not passed:
        return {
            "ticker": sym,
            "found": True,
            "excluded_by_gate": True,
            "tag": None,
            "score": None,
            "rank_among_scored": None,
            "signal_summary": {
                "gap_pct": me.get("gap_pct"),
                "vol_x": me.get("vol_x"),
                "price": me.get("price"),
                "market_cap": me.get("market_cap"),
                "avg_volume_30d": me.get("avg_volume_30d"),
                "sector": me.get("sector"),
            },
            "reason": (
                f"Filtered out before scoring ({gate_reason}). It's a real "
                f"source hit but doesn't clear the tradeability + activity "
                f"floors, so it never enters the scored pool."
            ),
        }

    # Score + tag everyone (gate-passers only, to mirror the engine)
    def _passes(c):
        return filters.quality_gate(c)[0] and filters.is_real_catalyst(c)[0]
    candidates = [c for c in candidates if _passes(c)]
    for c in candidates:
        c["tag"] = tagging.assign_tag(c)
        c["score"] = scoring.score(c)
    scored = [c for c in candidates if c.get("tag")]

    # Where does my score rank among scored candidates?
    scored_sorted = sorted(scored, key=lambda c: c.get("score", 0), reverse=True)
    my_rank = next((i + 1 for i, c in enumerate(scored_sorted)
                    if c.get("ticker") == sym), None)

    return {
        "ticker": sym,
        "found": True,
        "tag": me.get("tag"),
        "score": me.get("score"),
        "rank_among_scored": my_rank,
        "total_scored": len(scored),
        "signal_summary": {
            "gap_pct": me.get("gap_pct"),
            "vol_x": me.get("vol_x"),
            "tweet_mention_count": me.get("tweet_mention_count"),
            "rss_headline_count": me.get("rss_headline_count"),
            "earnings_reported_recently": me.get("earnings_reported_recently"),
            "scanner_setup": me.get("scanner_setup"),
            "sector": me.get("sector"),
            "market_cap": me.get("market_cap"),
            "price": me.get("price"),
        },
        "reason": (
            "Tagged but didn't meet quota cutoff — sources too thin or"
            " score below higher-ranked peers." if my_rank and my_rank > 20
            else "On today's list." if my_rank and my_rank <= 20
            else "Has source signal but tag didn't qualify (e.g. Gapper needs ≥5% gap + ≥3× vol)."
        ),
    }


@router.post("/catalysts/feedback")
def catalysts_feedback(
    body: dict = Body(...),
    user=Depends(get_current_user),
):
    """Record a 👍/👎 on a catalyst row. The structured replacement for
    'screenshot the lame ones' — snapshots the row's full feature vector so
    the engine can learn which characteristics the trader considers garbage."""
    ticker = str(body.get("ticker") or "").upper().strip()
    verdict = str(body.get("verdict") or "").lower().strip()
    market_date = str(body.get("market_date") or _today()).strip()
    if not ticker or not ticker.isalpha() or len(ticker) > 6:
        raise HTTPException(400, "invalid ticker")
    if verdict not in ("bad", "good"):
        raise HTTPException(400, "verdict must be 'bad' or 'good'")
    if not _DATE_RE.match(market_date):
        raise HTTPException(400, "market_date must be YYYY-MM-DD")

    row = store.get_ticker_for_date(ticker, market_date) or {}
    store.record_feedback(user_id=str(user["id"]), market_date=market_date,
                          ticker=ticker, verdict=verdict, row=row)
    return {"ok": True, "ticker": ticker, "verdict": verdict}


@router.get("/admin/catalyst-feedback-summary")
def catalyst_feedback_summary(user=Depends(require_admin)):
    """Aggregate traits of 👎 rows so the operator can spot what 'lame'
    catalysts have in common and harden the gates / thresholds."""
    return store.feedback_summary()


@router.get("/admin/catalyst-stats")
def catalyst_stats(user=Depends(require_admin)):
    today = _today()
    daily = store.cost_stats_for_date(today)
    ym = today[:7]
    mtd = store.cost_stats_mtd(ym)
    today_rows = store.get_for_date(today, ranked_only=False)
    last_refresh_at = max((r["thesis_at"] for r in today_rows
                           if r.get("thesis_at")), default=None)
    return {
        "today": daily,
        "mtd_cost_usd": round(mtd["total_cost_usd"], 4),
        "mtd_call_count": mtd["call_count"],
        "today_rows": len(today_rows),
        "today_ranked": len([r for r in today_rows if r["rank"] is not None]),
        "last_refresh_at": last_refresh_at,
    }
