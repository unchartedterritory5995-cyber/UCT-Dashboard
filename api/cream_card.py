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
import json
import logging
import os
import threading
from datetime import datetime
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)

# ── EOD slot + catch-up state (mirrors api/oi_morning.py) ────────────────────
# The scheduled post is a 16:10 ET cron in an IN-MEMORY APScheduler job store on
# the flow-worker. A pod that restarts across the slot never SCHEDULES that fire,
# so `misfire_grace_time` cannot see it and the card vanishes with no trace — the
# exact silent miss observed 2026-09-08 (a redeploy burst; the worker did not
# stabilise until 17:53 ET, 103m past the slot). The cron entry (run_scheduled)
# and a 60s catch-up both consult a DURABLE per-day record so a miss is recovered
# within the honesty window, paged past it, and never double-posted.
SLOT_ET = (16, 10)

_RUN_LOCK = threading.Lock()


def _grace_min() -> int:
    """How late an EOD card may still be honest. This card is a SETTLED-day
    snapshot ("the day's biggest builds"), so its claim stays true all evening —
    a wider window than the morning OI card's 45m. Tunable."""
    try:
        return int(os.getenv("CREAM_EOD_CATCHUP_GRACE_MIN", "120"))
    except (TypeError, ValueError):
        return 120


def _state_path() -> str:
    return os.getenv("CREAM_EOD_STATE_PATH",
                     os.path.join(os.getenv("DATA_DIR", "/data"), "cream_eod_state.json"))


def _load_state() -> dict:
    try:
        with open(_state_path(), "r", encoding="utf-8") as fh:
            d = json.load(fh)
        return d if isinstance(d, dict) else {}
    except Exception:  # noqa: BLE001 — a missing or corrupt file is "nothing recorded"
        return {}


def _save_state(state: dict) -> None:
    """⛔ tmp -> os.replace. `open(path, "w")` truncates BEFORE the write can fail,
    so a crash mid-write would leave an empty file and forget every slot handled
    today — which reads as "nothing posted" and re-posts."""
    path = _state_path()
    try:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        tmp = f"{path}.tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(state, fh)
        os.replace(tmp, path)
    except Exception as e:  # noqa: BLE001
        log.warning("[cream-eod] could not persist slot state: %s", e)


def _state_file_exists() -> bool:
    """Whether this volume has ever recorded a cream slot. False only on the very
    first run after this feature deploys (or after a /data reset) — the one window
    in which a 'never posted' page cannot be trusted, because a card posted before
    tracking existed left no record here."""
    return os.path.exists(_state_path())


def slot_done(day: str) -> bool:
    return bool(_load_state().get("done", {}).get(day))


def mark_slot_done(day: str, how: str) -> None:
    state = _load_state()
    done = state.setdefault("done", {})
    done[day] = how
    # Keep the file small; ~40 weekdays is ample to debug a fortnight of days.
    for stale in sorted(done)[:-40]:
        done.pop(stale, None)
    _save_state(state)


def _now_et():
    return datetime.now(ZoneInfo("America/New_York"))


def _armed() -> bool:
    return os.getenv("CREAM_EOD_ENABLED", "0") == "1"


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


def _alert_missed(day: str, late: int) -> None:
    """⛔ A LOG LINE IS NOT A NOTIFICATION. This pod's stream is flooded; a warning
    closes the hole in the CODE and leaves it open in PRACTICE. `critical` is the
    only severity `chart_health_alerts` pages on. Never raises — an alerting
    failure must not cost the tape its ingest."""
    try:
        from api.services import chart_health_alerts
        chart_health_alerts.emit(
            f"cream_eod_missed:{day}", "critical",
            f"The EOD Top Flow card for {day} was never posted ({late}m past the "
            f"{_grace_min()}m catch-up window). Most likely the flow-worker restarted "
            f"across the {SLOT_ET[0]:02d}:{SLOT_ET[1]:02d} ET slot.",
            {"day": day, "minutes_late": late},
        )
    except Exception as e:  # noqa: BLE001
        log.warning("[cream-eod] could not raise a missed-slot alert: %s", e)


def run_scheduled(*, now=None) -> dict:
    """Cron entry: post the card and RECORD the day handled. No-op unless armed.

    ⛔ SEPARATE FROM run_cream_eod ON PURPOSE. A manual preview or a force run must
    never mark the slot done — that would suppress the real card for the rest of
    the day, the opposite of what a previewer wants. An empty day IS marked done
    (nothing to post is "handled", not "missed")."""
    if not _armed():
        return {"ok": False, "reason": "disarmed"}
    now_dt = now or _now_et()
    day = now_dt.date().isoformat()
    with _RUN_LOCK:
        if slot_done(day):
            return {"ok": False, "reason": "already handled today"}
        res = run_cream_eod(post=True)
        if res.get("ok"):
            mark_slot_done(day, "posted" if res.get("posted") else
                           str(res.get("reason") or "completed"))
        print(f"[cream-eod] {res}")
        return res


def catch_up(*, now=None) -> dict:
    """Post a slot the scheduler never fired, or say why it will not be. Safe to
    call every minute: `_RUN_LOCK` makes a race with the cron a no-op for whichever
    arrives second, and the persisted per-day record makes a double-post impossible
    even across a restart."""
    if not _armed():
        return {"posted": False, "reason": "disarmed"}
    now_dt = now or _now_et()
    if now_dt.weekday() > 4:                      # the cron is mon-fri
        return {"posted": False, "reason": "weekend"}
    day = now_dt.date().isoformat()
    if slot_done(day):
        return {"posted": False, "reason": "already handled today"}
    late = (now_dt.hour * 60 + now_dt.minute) - (SLOT_ET[0] * 60 + SLOT_ET[1])
    if late <= 0:
        return {"posted": False, "reason": "not due yet"}
    grace = _grace_min()
    if late <= grace:
        log.warning("[cream-eod] the %02d:%02d ET slot never fired (%dm ago) — "
                    "catching it up now", SLOT_ET[0], SLOT_ET[1], late)
        return run_scheduled(now=now_dt)
    # Past the honesty window. Normally that's a missed-slot page — but on the
    # FIRST run after this feature deploys (no state file has ever been written on
    # this volume) we cannot know whether the slot was handled before tracking
    # existed, so adopt the day silently rather than page a miss we can't verify.
    first_run = not _state_file_exists()
    with _RUN_LOCK:
        if slot_done(day):
            return {"posted": False, "reason": "already handled today"}
        mark_slot_done(day, "pre-tracking (feature just deployed)" if first_run
                       else f"missed ({late}m late)")
    if first_run:
        log.info("[cream-eod] first run past the %02d:%02d ET slot — adopting %s as "
                 "pre-tracking (no page: cannot verify a pre-feature post)",
                 SLOT_ET[0], SLOT_ET[1], day)
        return {"posted": False, "reason": "pre-tracking bootstrap"}
    log.warning("[cream-eod] MISSED today's card — %dm late, past the %dm catch-up "
                "window, so it will not be posted.", late, grace)
    _alert_missed(day, late)
    return {"posted": False, "reason": "past the catch-up window"}


def scheduled_cream_eod() -> None:
    """Back-compat alias for the old cron entry — delegates to run_scheduled (which
    is flag-gated + slot-recording). Retained so any external caller still works."""
    run_scheduled()
