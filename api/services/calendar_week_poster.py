"""Post the week-ahead earnings + economic-events cards to Discord.

Runs Saturday 4:30 AM ET. Renders both PNGs and posts them as ONE message with
two embeds, so the channel gets a single clean drop rather than two.

Design notes:
  • Targets are explicit. `test` resolves to a channel in the UCT Intelligence
    server (falling back to the existing admin webhook so a test post needs zero
    setup); `live` resolves to #event-calendar ONLY and refuses if unset — a
    live post must never silently land in the admin channel.
  • It refuses to post a hollow card. A scheduled job that "succeeds" with an
    empty calendar is the incident_wire_dns_outage_silent_success failure mode:
    it alerts instead, so silence is never mistaken for success.
  • Dedup on week_start, so a pod restart or a double-fire cannot double-post.
  • Never raises into the scheduler.
"""
from __future__ import annotations

import json
import logging
import os
import threading
from datetime import date, timedelta

_logger = logging.getLogger(__name__)

_STATE_PATH = os.path.join(os.environ.get("DATA_DIR", "/data"),
                           "calendar_week_posts.json")
_state_lock = threading.Lock()

_EARNINGS_FILE = "earnings.png"
_ECON_FILE = "econ.png"

_EMBED_COLOR = 0xC9A84C   # UCT gold


# ── Webhook targeting ─────────────────────────────────────────────────────────

def resolve_webhook(target: str) -> tuple[str, str]:
    """(url, resolved_name). Empty url = do not post.

    `live` NEVER falls back — an unset production webhook must stop the post,
    not redirect it into whatever other channel happens to be configured.
    """
    if target == "live":
        return os.environ.get("DISCORD_EVENT_CALENDAR_WEBHOOK_URL", ""), "live"
    url = os.environ.get("DISCORD_EVENT_CALENDAR_TEST_WEBHOOK_URL", "")
    if url:
        return url, "test"
    return os.environ.get("DISCORD_WEBHOOK_URL", ""), "test(admin-fallback)"


# ── Dedup ledger ──────────────────────────────────────────────────────────────

def _load_state() -> dict:
    try:
        with open(_STATE_PATH, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (FileNotFoundError, ValueError, OSError):
        return {}


def already_posted(week_start: str, target: str) -> bool:
    return f"{target}:{week_start}" in _load_state()


def _record_posted(week_start: str, target: str) -> None:
    from datetime import datetime, timezone
    with _state_lock:
        state = _load_state()
        state[f"{target}:{week_start}"] = datetime.now(timezone.utc).isoformat()
        # Keep the ledger small — 40 weeks is far more than the dedup needs.
        if len(state) > 40:
            for k in sorted(state, key=lambda k: state[k])[:len(state) - 40]:
                del state[k]
        try:
            tmp = _STATE_PATH + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(state, f)
            os.replace(tmp, _STATE_PATH)
        except OSError as exc:
            _logger.warning("[week-post] could not persist dedup state: %s", exc)


# ── Payload assembly ──────────────────────────────────────────────────────────

def week_label(monday: date) -> str:
    end = monday + timedelta(days=4)
    if monday.month == end.month:
        return f"Week of {monday.strftime('%b')} {monday.day}-{end.day}, {monday.year}"
    return (f"Week of {monday.strftime('%b')} {monday.day} - "
            f"{end.strftime('%b')} {end.day}, {monday.year}")


# ── What earns a gold ring ────────────────────────────────────────────────────
# ATTENTION first, size second. Market cap alone rang CAT, DUK, ATO and EVRG —
# big companies whose prints nobody trades — while missing RBLX, RDDT, RIVN and
# MSTR, which are exactly what a trader scans a week-ahead card for.
#
# EarningsWhispers ships an anticipation count per report: how many people are
# actually watching it. That IS the signal, and it is available on the run that
# matters — on a Saturday `_week_dates()` rolls to next Monday, so the live EW
# path builds the card. Measured on a real week: AAPL 186, AMZN 171, RBLX 33,
# RDDT 29, RIVN 19, MSTR 11, COIN 8.
MARQUEE_EW = 8

# Size is the FALLBACK, not the rule, and it has two jobs:
#   1. EW zeroes a name's anticipation once it has reported, so META/MSFT/ARM/
#      KLAC all read ew=0 on a mid-week rebuild — cap keeps them ringed.
#   2. Range weeks (any week but the current one) carry no EW data at all, so
#      without this a future-week preview would have no rings whatsoever.
# $200B keeps that fallback unambiguous. $50B re-rings the boring tier above.
MARQUEE_MC_B = 200.0

# ── What gets left out ────────────────────────────────────────────────────────
# Drop a name only when it is BOTH small AND unwatched. Cap alone would have
# deleted AXTI ($0.4B) despite 18 people following its print — "nobody cares
# about it" is an attention claim, so attention gets a veto.
# A cap we could NOT read is kept: fail toward showing, never hide silently.
MIN_DRAW_MC_B = 1.0
MIN_DRAW_EW = 3


def build_payloads(monday: date) -> tuple[list[dict], list[dict]]:
    """(earnings_days, econ_days) shaped for the renderers. Ranks each day's
    reporters by market cap, using day-metrics for the caps the live calendar
    path doesn't carry."""
    from api.routers.calendar import get_calendar, get_day_metrics, _week_dates
    from api.services import ticker_logos as _logos
    from api.services.calendar_week_png import MAX_PER_SESSION, MAX_TBD

    cur_monday = _week_dates()[0]
    payload = (get_calendar() if monday == cur_monday
               else get_calendar(week=monday.isoformat()))
    days = payload.get("days") or {}

    earnings_days: list[dict] = []
    econ_days: list[dict] = []

    for i in range(5):
        d = monday + timedelta(days=i)
        ds = d.isoformat()
        day = days.get(ds) or {}
        label = f"{d.strftime('%a').upper()} {d.day}"

        metrics = {}
        try:
            metrics = get_day_metrics(date=ds) or {}
        except Exception as exc:                       # noqa: BLE001
            _logger.warning("[week-post] day-metrics failed for %s: %s", ds, exc)

        def _rank(bucket: str, draw_cap: int = MAX_PER_SESSION) -> list[dict]:
            rows = []
            for e in day.get(bucket) or []:
                sym = (e.get("sym") or "").upper()
                if not sym:
                    continue
                mc = e.get("mc_b")
                if mc is None:
                    mc = (metrics.get(sym) or {}).get("mc_b")
                rows.append({"sym": sym, "mc_b": mc,
                             "ew": int(e.get("ew") or 0)})
            # Unknown cap sinks below known caps rather than sorting as zero-ish
            rows.sort(key=lambda r: (r["mc_b"] is not None, r["mc_b"] or 0),
                      reverse=True)
            # Hard floor, not a fallback tail: a light session showing two real
            # companies beats one padded out with sub-$1B shells. They stay in
            # `total` and `+N more`, so the card never understates the day —
            # they just stop taking a tile from something people trade.
            ordered = [r for r in rows
                       if r["mc_b"] is None
                       or r["mc_b"] >= MIN_DRAW_MC_B
                       or r["ew"] >= MIN_DRAW_EW]
            # Resolve logo paths ONLY for the names that actually get drawn —
            # a busy day now carries ~150 reporters and each lookup stats disk.
            top = ordered[:draw_cap]
            for r in top:
                r["logo_path"] = _logos.get_logo_path(r["sym"])
                r["marquee"] = (r["ew"] >= MARQUEE_EW
                                or (r["mc_b"] or 0) >= MARQUEE_MC_B)
            return top + ordered[draw_cap:]

        bmo, amc = _rank("bmo"), _rank("amc")
        tbd_n = len(day.get("tbd") or [])
        # Unconfirmed-session names are ranked and passed too. They used to be
        # counted in `total` (so `+N more` was honest) but never drawn — which
        # buried 144 reporters in a single week, and on a light Friday left 34
        # of 43 names invisible while a $2B confirmed-BMO name showed.
        tbd = _rank("tbd", MAX_TBD)
        total = len(day.get("bmo") or []) + len(day.get("amc") or []) + tbd_n
        shown = (min(len(bmo), MAX_PER_SESSION)
                 + min(len(amc), MAX_PER_SESSION)
                 + min(len(tbd), MAX_TBD))
        earnings_days.append({
            "label": label,
            "total": total or None,
            "bmo": bmo,
            "amc": amc,
            "tbd": tbd,
            # TRUE reporter counts per session — the draw lists are filtered, so
            # badging their length made a day read "BMO 2" when 4 companies
            # report. The header total, the session badges and `+N more` must
            # all reconcile, or the card quietly contradicts itself.
            "bmo_n": len(day.get("bmo") or []),
            "amc_n": len(day.get("amc") or []),
            "tbd_n": tbd_n,
            "overflow": max(0, total - shown),
        })

        events = []
        for ev in (day.get("econ") or []):
            # `is_key` drives the card's accent rail — the calendar already
            # computes it for the current week, so reuse it rather than
            # re-deriving importance in the renderer.
            events.append({"time": ev.get("time"), "event": ev.get("event"),
                           "estimate": ev.get("estimate"), "prior": ev.get("prior"),
                           "is_fed": False, "is_key": bool(ev.get("is_key"))})
        for ev in (day.get("fed") or []):
            events.append({"time": ev.get("time"), "event": ev.get("event"),
                           "estimate": None, "prior": None,
                           "is_fed": True, "is_key": False})
        econ_days.append({"label": label, "ds": ds, "events": events})

    # ForexFactory's `ff_calendar_nextweek.json` 404s, so the calendar payload
    # carries ZERO econ events for any week but the current one — a Saturday
    # "week ahead" post would ship an empty econ card. Fall back to FMP, which
    # covers arbitrary ranges. Only fires when the payload gave us nothing, so
    # the current week keeps its existing ForexFactory data.
    if not any(d["events"] for d in econ_days):
        from api.services.calendar_week_png import MAX_ECON_PER_DAY
        from api.services.econ_calendar_fmp import fetch_us_econ_week
        # Same cap the renderer draws, so the importance ranking picks exactly
        # the events that make the card instead of ranking a 9th that's cut.
        fmp = fetch_us_econ_week(monday.isoformat(),
                                 (monday + timedelta(days=4)).isoformat(),
                                 limit_per_day=MAX_ECON_PER_DAY)
        if fmp:
            for d in econ_days:
                d["events"] = fmp.get(d["ds"], [])
            _logger.info("[week-post] econ filled from FMP (%d events)",
                         sum(len(d["events"]) for d in econ_days))

    return earnings_days, econ_days


# ── The job ───────────────────────────────────────────────────────────────────

def post_week(target: str = "test", monday: date | None = None,
              force: bool = False) -> dict:
    """Render + post. Never raises. Returns a result dict for the caller/log."""
    try:
        from api.routers.calendar import _week_dates
        from api.services.calendar_week_png import (
            render_earnings_week_png, render_econ_week_png,
        )

        if monday is None:
            monday = _week_dates()[0]
        ws = monday.isoformat()

        url, resolved = resolve_webhook(target)
        if not url:
            _logger.warning("[week-post] no webhook for target=%s — not posting", target)
            return {"ok": False, "reason": "no_webhook", "target": target}

        if not force and already_posted(ws, target):
            return {"ok": True, "skipped": "already_posted", "week_start": ws,
                    "target": resolved}

        earnings_days, econ_days = build_payloads(monday)

        n_earn = sum(len(d["bmo"]) + len(d["amc"]) for d in earnings_days)
        n_econ = sum(len(d["events"]) for d in econ_days)
        # A trading week with ZERO reporters does not exist — that reading is
        # always a provider failure (observed 2026-07-30: a Finnhub 429 returned
        # an empty earnings set while econ came back fine, and an earlier
        # `n_earn == 0 AND n_econ == 0` guard let the post through with a card
        # that read "No scheduled reporters for this week"). Both images ship in
        # one message, so an empty EITHER side makes the whole post a lie.
        # Econ is judged separately: a genuinely quiet macro week is real, and
        # its card says so honestly.
        if n_earn == 0:
            _alert_admin(f"Weekly calendar post ABORTED for {ws} — the earnings "
                         f"calendar came back EMPTY (provider failure; econ={n_econ}). "
                         f"Nothing was posted.")
            return {"ok": False, "reason": "empty_calendar", "week_start": ws,
                    "earnings": 0, "econ": n_econ}

        label = week_label(monday)
        earn_png = render_earnings_week_png(label, earnings_days)
        econ_png = render_econ_week_png(label, econ_days)

        # The cards carry the counts and the week in their own headers, so the
        # copy says what the drop is and where it comes from. Nothing else.
        content = (f"**Earnings and Economic Events for the week ahead "
                   f"({label.replace('Week of ', '')})**\n"
                   f"UCTIntelligence.com")
        ok = _post_two_images(url, content, label, earn_png, econ_png)
        if not ok:
            return {"ok": False, "reason": "discord_post_failed", "week_start": ws}

        _record_posted(ws, target)
        _logger.info("[week-post] posted %s to %s (%d earnings, %d econ)",
                     ws, resolved, n_earn, n_econ)
        return {"ok": True, "week_start": ws, "target": resolved,
                "earnings": n_earn, "econ": n_econ}
    except Exception as exc:                            # noqa: BLE001
        _logger.warning("[week-post] failed: %s", exc, exc_info=True)
        return {"ok": False, "reason": str(exc)}


def _post_two_images(url: str, content: str, label: str,
                     earn_png: bytes, econ_png: bytes) -> bool:
    """One message, two embeds, two attachments. Discord resolves an embed's
    image from `attachment://<filename>` against the multipart files."""
    import requests

    payload = {
        "content": content,
        "embeds": [
            {"title": "Earnings", "color": _EMBED_COLOR,
             "image": {"url": f"attachment://{_EARNINGS_FILE}"}},
            {"title": "Economic Events", "color": _EMBED_COLOR,
             "image": {"url": f"attachment://{_ECON_FILE}"}},
        ],
    }
    try:
        r = requests.post(
            url,
            data={"payload_json": json.dumps(payload)},
            files={
                "files[0]": (_EARNINGS_FILE, earn_png, "image/png"),
                "files[1]": (_ECON_FILE, econ_png, "image/png"),
            },
            timeout=30,
        )
        if not r.ok:
            _logger.warning("[week-post] Discord HTTP %d: %s", r.status_code, r.text[:300])
            return False
        return True
    except Exception as exc:                            # noqa: BLE001
        _logger.warning("[week-post] Discord post failed: %s", exc)
        return False


def _alert_admin(msg: str) -> None:
    import requests
    hook = os.environ.get("DISCORD_WEBHOOK_URL", "")
    if not hook:
        _logger.warning("[week-post] %s (no admin webhook to alert)", msg)
        return
    try:
        requests.post(hook, json={"content": f"⚠️ {msg}"}, timeout=10)
    except Exception:                                   # noqa: BLE001
        pass


def run_scheduled_post() -> None:
    """APScheduler entry point — always LIVE."""
    if os.environ.get("CALENDAR_WEEK_POST_ENABLED") != "1":
        return
    post_week(target="live")
