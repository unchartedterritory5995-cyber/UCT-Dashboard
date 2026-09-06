"""Cream of the Crop — EOD Discord card.

Renders the day's highest-conviction AGGREGATE builds
(`live_massive_router.compute_cream`) as a Bull/Bear PNG in the Top Flow / Watchlist
design system and posts it to Discord. Fixes the EOD blind spot the Top Flow card
(single prints) and the hand-curated Watchlist both had — a curation-free ranking of
real, fresh, sweep-backed builds.

Runs on the FLOW-WORKER (compute_cream needs flow.db). The flow-worker schedules it
~16:10 ET on weekdays. A market-hours restart is NOT required — the card is built
from the settled day's flow.db.

Env:
  CREAM_EOD_ENABLED       "1" to arm the scheduled post (default OFF → preview-only)
  CREAM_EOD_WEBHOOK_URL    Discord webhook; falls back to the Alpha-Gold-EOD / LiveFlow
                           admin webhook so it can NEVER default to a public channel
  CREAM_EOD_SKIP_EMPTY     "1" (default) = don't post a day with no qualifying builds
  (selection knobs live in compute_cream: CREAM_TOP_N / _MIN_VOI /
   CREAM_EXCLUDE_WEEKLY / CREAM_EXCLUDE_BLOCK_ONLY)
"""
import os
from datetime import datetime


def _webhook() -> str:
    # Fallback chain mirrors alpha_gold_eod so it can never default to a public channel.
    return (os.getenv("CREAM_EOD_WEBHOOK_URL")
            or os.getenv("ALPHA_GOLD_EOD_WEBHOOK_URL")
            or os.getenv("DISCORD_MASSIVE_WEBHOOK_URL")
            or os.getenv("DISCORD_LIVE_FLOW_WEBHOOK_URL")
            or os.getenv("DISCORD_WEBHOOK_URL", "")).strip()


def _date_text(mdy: str) -> str:
    try:
        return datetime.strptime(mdy, "%m/%d/%Y").strftime("%B %d, %Y").replace(" 0", " ")
    except Exception:
        return mdy


def run_cream_eod(*, target_date=None, force: bool = False, post: bool = True) -> dict:
    """Compute the cream, render the card, optionally post to Discord. Returns a
    summary dict; never raises into a scheduler (catches + reports).

    force=True bypasses the SKIP_EMPTY guard (so a manual trigger always renders).
    post=False renders + returns without touching Discord (preview)."""
    try:
        from api import live_massive_router as lmr
        from api.watchlist_card import render_watchlist_card
        from api.alpha_gold_eod import _post_discord_image

        today = lmr._resolve_date(target_date) if target_date else lmr._today_mdyyyy()
        data = lmr.compute_cream(today)
        bull, bear = data["bull"], data["bear"]
        n = len(bull) + len(bear)
        if n == 0 and not force and os.getenv("CREAM_EOD_SKIP_EMPTY", "1") == "1":
            return {"ok": True, "posted": False, "reason": "empty", "date": today}

        date_text = _date_text(today)
        png = render_watchlist_card(bull, bear, date_text, mobile=False,
                                    title="Top Flow", section="FLOW",
                                    net=data.get("net"), show_dte=True,
                                    sec_labels=("Bulls", "Bears"))
        posted, detail = False, ""
        if post:
            wh = _webhook()
            if not wh:
                detail = "no webhook configured"
            else:
                # No message text — the webhook bot name already reads
                # "UCT Intelligence · Top Flow" and the card itself carries the
                # date + net-flow read, so a content line is redundant.
                posted, detail = _post_discord_image(wh, png, "", filename="top_flow.png")
        return {"ok": True, "posted": posted, "detail": detail, "date": today,
                "bull": len(bull), "bear": len(bear), "png_bytes": len(png),
                "params": data.get("params")}
    except Exception as e:  # never break the scheduler
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def scheduled_cream_eod() -> None:
    """Scheduler entry (flow-worker). No-op unless CREAM_EOD_ENABLED=1."""
    if os.getenv("CREAM_EOD_ENABLED", "0") != "1":
        return
    res = run_cream_eod(post=True)
    print(f"[cream-eod] {res}")
