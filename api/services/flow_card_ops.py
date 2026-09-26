"""Operations for the Discord render products: the /flow outcome ledger, its daily line, the
flow pre-warm, and the post-deploy render smoke (2026-09-25).

⭐ WHY THIS EXISTS. On 2026-09-25 three render defects reached members and each was found by a
person looking at an image: the weekly candle frozen all week, a weekly strip describing the
day, and a bare "AMD W" header on the first render after a deploy. And the page-derived /flow
card went live with its market-hours behaviour measured once, by hand. This module turns those
looks into instruments:

- **the ledger** — every /flow card records what it delivered (the page's card, the page's card
  "as of" an earlier build, the labelled rollup and WHY, an honest empty, or a failure), so
  "is the market-hours path holding?" is a number, not a hope;
- **the daily line** — that number, once a session, in #render-alerts;
- **the pre-warm** — during market hours the names members asked for in the last hour are
  re-derived ahead of the next ask (the /chart hot set already does this for charts);
- **the smoke** — minutes after every web boot, the chart and flow paths are exercised in-process
  (nothing posted to members) and one pass/fail line lands in #render-smoke (a failure also in
  #render-alerts).

Every entry point here NEVER raises into its caller: a broken instrument must not cost a card.
"""
from __future__ import annotations

import collections
import datetime as dt
import logging
import os
import random
import sqlite3
import threading
import time

log = logging.getLogger(__name__)

# ── the outcome ledger ───────────────────────────────────────────────────────────────────────

_DB_PATH = os.environ.get("FLOW_CARD_STATS_DB_PATH", "/data/flow_card_stats.db")
_LOCK = threading.Lock()
_RETAIN_S = 30 * 86400
_SCHEMA = ("CREATE TABLE IF NOT EXISTS flow_card_outcomes ("
           "ts REAL NOT NULL, ticker TEXT NOT NULL, source TEXT, days TEXT, "
           "outcome TEXT NOT NULL, reason TEXT, ms INTEGER)")

#: The outcomes a /flow card can end in. `page_asof` is the page's own card served behind the tape
#: (the market-hours reuse); `rollup_fallback` is the labelled rollup answering because the page
#: card could not be had (the reason says why); `rollup` is the rollup with the page card switched
#: off; `empty` is the honest "no significant options flow" after every wider window was checked.
OUTCOMES = ("page", "page_asof", "rollup_fallback", "rollup", "empty", "failed")


def _conn():
    c = sqlite3.connect(_DB_PATH, timeout=2)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute(_SCHEMA)
    c.execute("CREATE INDEX IF NOT EXISTS idx_fco_ts ON flow_card_outcomes(ts)")
    return c


def record(ticker: str, source: str | None, days: str | None, outcome: str,
           reason: str | None = None, ms: float | None = None, *, now: float | None = None) -> bool:
    """One /flow card's outcome. Never raises; returns whether it was written."""
    try:
        ts = time.time() if now is None else float(now)
        with _LOCK:
            c = _conn()
            try:
                c.execute("INSERT INTO flow_card_outcomes(ts,ticker,source,days,outcome,reason,ms) VALUES(?,?,?,?,?,?,?)",
                          (ts, str(ticker or "").upper()[:12], source, str(days or ""), outcome,
                           (reason or None) and str(reason)[:80], None if ms is None else int(ms)))
                if random.random() < 0.01:
                    c.execute("DELETE FROM flow_card_outcomes WHERE ts < ?", (ts - _RETAIN_S,))
                c.commit()
            finally:
                c.close()
        return True
    except Exception as e:  # noqa: BLE001 — an instrument never costs a card
        log.debug("[flow-ops] record failed: %s", e)
        return False


def _rows(since: float, until: float) -> list:
    with _LOCK:
        c = _conn()
        try:
            return c.execute("SELECT ts,ticker,source,days,outcome,reason,ms FROM flow_card_outcomes "
                             "WHERE ts >= ? AND ts < ? ORDER BY ts", (since, until)).fetchall()
        finally:
            c.close()


def summary(since: float, until: float) -> dict:
    """Counts per outcome, the reasons behind fallbacks and failures, page-card latency, top names."""
    rows = _rows(since, until)
    by = collections.Counter(r[4] for r in rows)
    reasons = {o: collections.Counter(r[5] or "unknown" for r in rows if r[4] == o)
               for o in ("rollup_fallback", "failed")}
    page_ms = sorted(r[6] for r in rows if r[4] in ("page", "page_asof") and r[6] is not None)

    def pct(p):
        if not page_ms:
            return None
        return page_ms[min(len(page_ms) - 1, int(round(p * (len(page_ms) - 1))))]
    return {"total": len(rows), "by": dict(by), "reasons": {k: dict(v) for k, v in reasons.items()},
            "page_p50_ms": pct(0.5), "page_p95_ms": pct(0.95),
            "top": collections.Counter(r[1] for r in rows).most_common(5)}


def _et(now: float | None = None) -> dt.datetime:
    from zoneinfo import ZoneInfo
    return dt.datetime.fromtimestamp(time.time() if now is None else now, tz=ZoneInfo("America/New_York"))


def daily_text(now: float | None = None) -> str:
    """The day's line (ET calendar day up to `now`)."""
    et = _et(now)
    start = et.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    s = summary(start, et.timestamp() + 1)
    day = f"{et.strftime('%a %b')} {et.day}"
    if not s["total"]:
        return f"📊 /flow · {day} · no cards requested today"
    b = s["by"]
    page = b.get("page", 0) + b.get("page_asof", 0)

    def why(o):
        r = s["reasons"].get(o) or {}
        return (" (" + ", ".join(f"{k} {v}" for k, v in sorted(r.items(), key=lambda kv: -kv[1])) + ")") if r else ""
    parts = [f"📊 /flow · {day} · {s['total']} cards",
             f"page-derived {page}" + (f" (as-of {b['page_asof']})" if b.get("page_asof") else "")]
    if b.get("rollup_fallback"):
        parts.append(f"rollup fallback {b['rollup_fallback']}{why('rollup_fallback')}")
    if b.get("rollup"):
        parts.append(f"rollup (page card off) {b['rollup']}")
    if b.get("empty"):
        parts.append(f"empty {b['empty']}")
    if b.get("failed"):
        parts.append(f"failed {b['failed']}{why('failed')}")
    if s["page_p50_ms"] is not None:
        parts.append(f"page p50 {s['page_p50_ms'] / 1000:.1f}s · p95 {s['page_p95_ms'] / 1000:.1f}s")
    parts.append("top: " + ", ".join(f"{t} {n}" for t, n in s["top"]))
    return " · ".join(parts)


def recent_names(within_s: float = 3600, limit: int = 4, *, now: float | None = None) -> list:
    """[(ticker, source)] members asked /flow for in the last `within_s`, most-asked first."""
    try:
        t = time.time() if now is None else now
        rows = _rows(t - within_s, t + 1)
    except Exception as e:  # noqa: BLE001
        log.debug("[flow-ops] recent read failed: %s", e)
        return []
    counts = collections.Counter((r[1], r[2] or "stocks") for r in rows if r[1])
    return [k for k, _ in counts.most_common(limit)]


# ── the flow pre-warm ────────────────────────────────────────────────────────────────────────

FLOW_WARM_INTERVAL_S = int(os.environ.get("DISCORD_FLOW_WARM_INTERVAL_S", "120") or 120)
#: A cycle never occupies more than a third of the gap before its own next run — the rule the
#: /chart hot-warm learned when its cycle overran its interval (main.py, 2026-08-29).
FLOW_WARM_BUDGET_S = FLOW_WARM_INTERVAL_S / 3.0
FLOW_WARM_MAX = int(os.environ.get("DISCORD_FLOW_WARM_MAX", "4") or 4)


def flow_warm_enabled() -> bool:
    return os.environ.get("DISCORD_FLOW_HOTWARM_ENABLED", "1").strip().lower() not in ("0", "false", "off", "")


def _is_session(day: dt.date) -> bool:
    if day.weekday() >= 5:
        return False
    try:
        from api.services.bars_fetch import _is_nyse_holiday
        return not _is_nyse_holiday(int(day.strftime("%Y%m%d")))
    except Exception:  # noqa: BLE001 — without the calendar, a weekday is a session
        return True


def last_closed_session(now: float | None = None) -> dt.date:
    """The ET date of the most recent NYSE session whose 16:00 close has passed — the newest day an
    intraday chart must reach whatever the hour. Today once it has closed, else the session before."""
    et = _et(now)
    day = et.date()
    if not (_is_session(day) and et.hour >= 16):
        day -= dt.timedelta(days=1)
        while not _is_session(day):
            day -= dt.timedelta(days=1)
    return day


def market_hours(now: float | None = None) -> bool:
    """Weekday, 09:25-16:10 ET, not an NYSE holiday: when a name's version moves with every print."""
    et = _et(now)
    if et.weekday() >= 5:
        return False
    try:
        from api.services.bars_fetch import _is_nyse_holiday
        if _is_nyse_holiday(int(et.strftime("%Y%m%d"))):
            return False
    except Exception:  # noqa: BLE001 — without the calendar, assume open on a weekday
        pass
    minutes = et.hour * 60 + et.minute
    return 9 * 60 + 25 <= minutes <= 16 * 60 + 10


def flow_hot_warm(*, now: float | None = None, fetch=None, clock=time.monotonic) -> dict:
    """Re-derive the page card's product for the names asked for in the last hour, so the next
    member's /flow is a cache hit. Market hours only, at most FLOW_WARM_MAX names, inside
    FLOW_WARM_BUDGET_S. The server side takes a build lane only if one is free and never queues
    (flow_router._spawn_basis_refresh / the busy decline), so this cannot starve the Options Flow
    page's own Search builds. Never raises."""
    try:
        from api.services import flow_card_from_page as page
        if not flow_warm_enabled():
            return {"skipped": "disabled"}
        if not page.enabled():
            return {"skipped": "page card off"}
        if not market_hours(now):
            return {"skipped": "market closed"}
        names = recent_names(3600, FLOW_WARM_MAX, now=now)
        fetch = fetch or (lambda t, s: page.fetch_basis_product(t, s, page.BASIS_ROWS, page.PAGE_FETCH_TIMEOUT_S))
        t0, warmed, missed = clock(), [], []
        for ticker, source in names:
            if clock() - t0 > FLOW_WARM_BUDGET_S:
                break
            try:
                (warmed if fetch(ticker, source) is not None else missed).append(ticker)
            except Exception:  # noqa: BLE001
                missed.append(ticker)
        return {"warmed": warmed, "missed": missed, "asked": len(names)}
    except Exception as e:  # noqa: BLE001
        log.warning("[flow-ops] hot-warm failed: %s", e)
        return {"skipped": f"error: {type(e).__name__}"}


# ── posting ──────────────────────────────────────────────────────────────────────────────────

SMOKE_CHANNEL_DEFAULT = "1549129739048853544"      # Uncharted Territory #render-smoke (admin)


def post_alert(content: str) -> bool:
    """#render-alerts, through the existing DISCORD_RENDER_ALERT_WEBHOOK. Never raises."""
    try:
        from api.services.discord_render import observe
        url = (os.environ.get(observe.ALERT_WEBHOOK_ENV) or "").strip()
        return bool(url) and bool(observe.post_webhook(url, content[:1900]))
    except Exception as e:  # noqa: BLE001
        log.warning("[flow-ops] alert post failed: %s", e)
        return False


def post_smoke(content: str, *, client=None) -> bool:
    """#render-smoke as the bot (DISCORD_BOT_TOKEN); the #render-alerts webhook when the bot cannot
    post there, so a smoke line is never silently lost. Never raises."""
    channel = (os.environ.get("DISCORD_RENDER_SMOKE_CHANNEL") or SMOKE_CHANNEL_DEFAULT).strip()
    token = (os.environ.get("DISCORD_BOT_TOKEN") or "").strip()
    if channel and token:
        try:
            import httpx
            c = client or httpx.Client(timeout=10.0)
            r = c.post(f"https://discord.com/api/v10/channels/{channel}/messages",
                       headers={"Authorization": f"Bot {token}"},
                       json={"content": content[:1900], "allowed_mentions": {"parse": []}})
            if getattr(r, "is_success", False):
                return True
            log.warning("[flow-ops] smoke post to #render-smoke refused: HTTP %s", getattr(r, "status_code", "?"))
        except Exception as e:  # noqa: BLE001
            log.warning("[flow-ops] smoke post failed: %s", e)
    return post_alert(content)


# ── the post-deploy render smoke ─────────────────────────────────────────────────────────────

SMOKE_CHART_SYMBOL = "NVDA"
SMOKE_WEEKLY_BASKET = ("NVDA", "AMD", "QQQ", "MSFT", "TSLA")
SMOKE_FLOW_SYMBOL = "AMD"
#: Every button a member can press on a /chart card except 15m (COLLAPSED_TFS): the two intraday ones
#: go through a different bar path (intraday cache + delta fetch) from D/W, so D/W green says
#: nothing about them.
SMOKE_CHART_TFS = ("D", "W", "60", "5")
#: The intraday timeframe whose NEWEST bar must reach the last closed session. A render alone cannot
#: see a frozen feed: a chart of four-day-old bars draws perfectly (the 2026-05-16 universe-wide
#: intraday freeze rendered clean charts for days).
SMOKE_FRESH_TF = "5"


def smoke_enabled() -> bool:
    return os.environ.get("DISCORD_RENDER_SMOKE_ENABLED", "1").strip().lower() not in ("0", "false", "off", "")


def _commit() -> str:
    for k in ("RAILWAY_GIT_COMMIT_SHA", "RAILWAY_GIT_COMMIT", "GIT_COMMIT_SHA"):
        v = (os.environ.get(k) or "").strip()
        if v:
            return v[:9]
    return "?"


def run_smoke(*, produce=None, bars=None, flow=None, clock=time.monotonic, now: float | None = None) -> dict:
    """Exercise the member paths in-process; nothing reaches a member. Returns
    {"ok": bool, "text": str, "checks": [...]}. The seams exist for the rails; production passes none.

    Checks, each one a defect this programme shipped once:
      1. /chart for SMOKE_CHART_SYMBOL on every SMOKE_CHART_TFS comes back from the HOUSE renderer
         (outcome `ok`), not the stand-in — the blank-render and bare-header class; and the newest
         SMOKE_FRESH_TF bar reaches last_closed_session() — the frozen-intraday class;
      2. the weekly bar equals the daily bars for SMOKE_WEEKLY_BASKET (close, and the week's high
         covers the last daily high) — the frozen-weekly-candle class;
      3. /flow for SMOKE_FLOW_SYMBOL: the page card when it is switched on (derivation `page`)."""
    checks = []
    try:
        from api.routers import discord_interactions as rt
        from api.services import discord_chart_house as house
        from api.services import discord_interactions as di
        from api.services import discord_chart_prefs as prefs_mod
        from api.services.discord_chart_render import render_chart_png
        from api.services.render_gate import MEMBER
        fetch_bars = bars or rt.fetch_bars

        def _produce(tf):
            if produce is not None:
                return produce(tf)
            p = dict(prefs_mod.DEFAULTS)
            return di.produce_chart(di.ChartRequest(SMOKE_CHART_SYMBOL, tf), prefs_mod.render_options(p, tf), p, (),
                                    cls=MEMBER, bars_fn=fetch_bars, render_fn=render_chart_png,
                                    house_fn=house.render_house_chart if house.house_enabled() else None,
                                    quote_fn=rt.fetch_ext_quote, slot_wait=25.0)
        for tf in SMOKE_CHART_TFS:
            t = clock()
            try:
                out = _produce(tf)
                outcome = out[0] if out else "none"
            except Exception as e:  # noqa: BLE001
                outcome = f"raised {type(e).__name__}"
            checks.append({"name": f"chart {tf}", "ok": outcome == "ok",
                           "detail": f"{outcome} {clock() - t:.1f}s"})
        want = last_closed_session(now)
        try:
            ib = fetch_bars(SMOKE_CHART_SYMBOL, SMOKE_FRESH_TF, 3) or []
            newest = _et(float(ib[-1]["t"])).date() if ib else None
        except Exception as e:  # noqa: BLE001
            ib, newest = [], None
            log.debug("[flow-ops] smoke intraday read failed: %s", e)
        checks.append({"name": f"{SMOKE_FRESH_TF}m fresh", "ok": newest is not None and newest >= want,
                       "detail": (f"last bar {newest:%a %b} {newest.day}" if newest else "no bars")
                                 + ("" if newest is not None and newest >= want else f", want {want:%a %b} {want.day}")})
        bad = []
        for sym in SMOKE_WEEKLY_BASKET:
            try:
                d = fetch_bars(sym, "D", 6) or []
                w = fetch_bars(sym, "W", 2) or []
                if not d or not w or w[-1]["c"] != d[-1]["c"] or w[-1]["h"] < d[-1]["h"]:
                    bad.append(sym)
            except Exception:  # noqa: BLE001
                bad.append(sym)
        checks.append({"name": "weekly = daily", "ok": not bad,
                       "detail": f"{len(SMOKE_WEEKLY_BASKET) - len(bad)}/{len(SMOKE_WEEKLY_BASKET)}"
                                 + (f" off: {', '.join(bad)}" if bad else "")})
        from api.services import flow_card_from_page as page
        if page.enabled():
            t = clock()
            diag: dict = {}
            try:
                pay = (flow(diag) if flow is not None else
                       page.page_derived_payload(SMOKE_FLOW_SYMBOL, "1", "stocks",
                                                 timeout_s=page.PAGE_FETCH_TIMEOUT_S, enrich=False, diag=diag))
            except Exception as e:  # noqa: BLE001
                pay, diag["reason"] = None, f"raised {type(e).__name__}"
            ok = bool(pay) and pay.get("derivation") == "page"
            checks.append({"name": f"/flow {SMOKE_FLOW_SYMBOL}", "ok": ok,
                           "detail": (f"page-derived {clock() - t:.1f}s" if ok
                                      else f"no page card ({diag.get('reason') or 'unknown'})")})
        else:
            checks.append({"name": "/flow", "ok": True, "detail": "page card off (rollup)"})
    except Exception as e:  # noqa: BLE001 — the smoke itself failing is a failed smoke, said so
        checks.append({"name": "smoke", "ok": False, "detail": f"raised {type(e).__name__}: {e}"[:120]})
    ok = all(c["ok"] for c in checks)
    text = (("✅" if ok else "❌") + f" render smoke · web {_commit()} · "
            + " · ".join(f"{c['name']} {'ok' if c['ok'] else 'FAIL'} ({c['detail']})" for c in checks))
    return {"ok": ok, "text": text, "checks": checks}


def smoke_and_post() -> dict:
    """The scheduled entry point: run, post to #render-smoke, and a failure to #render-alerts too."""
    if not smoke_enabled():
        return {"skipped": "disabled"}
    res = run_smoke()
    post_smoke(res["text"])
    if not res["ok"]:
        post_alert(res["text"])
    log.info("[flow-ops] %s", res["text"])
    return res


def daily_stats_and_post(now: float | None = None) -> str | None:
    if os.environ.get("DISCORD_FLOW_STATS_ENABLED", "1").strip().lower() in ("0", "false", "off", ""):
        return None
    text = daily_text(now)
    post_alert(text)
    return text
