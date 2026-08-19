"""End-of-day Alpha Gold summary — renders the day's Alpha Gold options flow as a
branded PNG and posts it to Discord as an image attachment.

Runs on the FLOW-WORKER (owns flow.db). Dark by default: gated by
ALPHA_GOLD_EOD_ENABLED; the flow-worker schedules it ~16:05 ET on weekdays. A
PUSH_SECRET endpoint (`POST /api/live/massive/alpha-gold-eod`) triggers it
manually — ?post=0 returns the rendered PNG for preview, ?post=1 posts it.

Card v2 (2026-07-31): STOCKS + ETFs sections (source=='indexes' → ETF), one row
per (ticker, direction) rolled up with a ×N repeat count (mixed-direction tickers
show two rows), NO premium shown. Sorted premium-desc internally.

The Discord post is a hand-rolled multipart/form-data over stdlib urllib (NO
requests/httpx dependency — httpx is absent on the flow-worker), reusing the
Cloudflare-safe User-Agent that _post_massive_discord needs.

Env:
  ALPHA_GOLD_EOD_ENABLED      "1" to arm the scheduled post (default off)
  ALPHA_GOLD_EOD_WEBHOOK_URL  Discord webhook; falls back to the LiveFlow/admin
                              webhook so it can NEVER default to a public channel
  ALPHA_GOLD_EOD_TOP_N        max rows per section (default 30)
  ALPHA_GOLD_EOD_SKIP_EMPTY   "1" (default) = don't post a zero-alert day
"""
from __future__ import annotations

import io
import json
import logging
import os
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

log = logging.getLogger("alpha_gold_eod")

_ASSETS = os.path.join(os.path.dirname(__file__), "services", "desk_assets")
_UA = "UCT-Massive/1.0 (+https://uctintelligence.com)"

# ── palette (mirrors the dashboard + desk_thumbnail brand gold) ────────────
_BG = (12, 14, 17)
_BAND = (18, 21, 25)
_ROWALT = (16, 19, 23)
_GOLD = (201, 168, 76)
_GOLD_DIM = (150, 128, 66)
_TXT = (223, 227, 231)
_DIM = (132, 139, 148)
_DIV = (36, 40, 46)
_BULL = (74, 200, 120)
_BEAR = (232, 96, 96)


def _webhook() -> str:
    return (os.getenv("ALPHA_GOLD_EOD_WEBHOOK_URL")
            or os.getenv("DISCORD_MASSIVE_WEBHOOK_URL")
            or os.getenv("DISCORD_LIVE_FLOW_WEBHOOK_URL")
            or os.getenv("DISCORD_WEBHOOK_URL", "")).strip()


# ── data ───────────────────────────────────────────────────────────────────
def get_alpha_gold_today(today: str | None = None) -> list[dict]:
    """The day's Alpha Gold alerts (tier=alpha), premium-desc. Calls the classifier
    in-process — flow.db has no tier column; the tier is derived in _row_to_alert.
    (Alpha Gold is ask-side only, so the clean-directional bid gate never touches
    it.)"""
    from api import live_massive_router as lmr
    day = today or lmr._today_mdyyyy()
    payload = lmr._compute_recent(day, 10000, "D", "recent", "alpha", False)
    alerts = list((payload or {}).get("alerts") or [])
    alerts.sort(key=lambda a: (a.get("alertPremium") or 0), reverse=True)
    return alerts


def _get_bcontract_accumulations(day: str, min_score: float = 4.5) -> list[dict]:
    """The day's ≥B by-contract accumulations (COIN 'UCT Accumulation' + GLW
    'UCT Bull LEAPS' style), shaped like Alpha Gold alerts so they drop into the
    same card rows. Conviction ≥ B == accumulation_score >= 4.5 (the grade cutoff
    in _accumulation_grade). AVG = total_premium / (total_volume × 100). Fail-open:
    returns [] on any error so a data hiccup never blanks the card."""
    from api import live_massive_router as lmr
    try:
        res = lmr._build_by_contract(day, "all", 1, True, 1)
    except Exception as e:  # noqa: BLE001
        log.warning("[alpha-gold-eod] by-contract fetch failed: %s", e)
        return []
    out: list[dict] = []
    for c in (res or {}).get("contracts") or []:
        if (c.get("accumulation_score") or 0) < min_score:
            continue
        vol = c.get("total_volume") or 0
        prem = c.get("total_premium") or 0
        avg = (prem / (vol * 100.0)) if vol > 0 else None
        out.append({
            "ticker": c.get("ticker"), "cp": c.get("cp"), "strike": c.get("strike"),
            "exp": c.get("exp"), "dte": c.get("dte"), "spot": c.get("spot"),
            "source": c.get("source"),
            "alertPremium": prem, "averageFillPrice": avg,
            "_direction": c.get("direction"),
            "moneynessLabel": c.get("moneynessLabel"), "moneynessPct": c.get("moneynessPct"),
            "_accum": True, "_accScore": c.get("accumulation_score"),
        })
    return out


def _merge_accum(alerts: list[dict], accum: list[dict]) -> list[dict]:
    """Fold accumulations into the Alpha Gold alert list, deduped by contract
    (ticker, C/P, strike, exp) — a contract already shown as an Alpha Gold print
    isn't duplicated. Re-sorted premium-desc so the biggest flow leads each
    section after _rollup."""
    def _key(a):
        return (a.get("ticker"), (a.get("cp") or "").upper(), a.get("strike"), str(a.get("exp") or ""))
    seen = {_key(a) for a in alerts}
    merged = list(alerts)
    for c in accum:
        k = _key(c)
        if k in seen:
            continue
        seen.add(k)
        merged.append(c)
    merged.sort(key=lambda a: (a.get("alertPremium") or 0), reverse=True)
    return merged


def _earnings_soon_syms(within_days: int) -> set[str]:
    """Uppercase symbols reporting earnings within `within_days` calendar days,
    read from the flow-worker's earnings-date cache ({sym: 'YYYY-MM-DD'} of the
    EARLIEST upcoming report, populated by the massive_ws_worker earnings-calendar
    task). Used to drop pre-earnings names from the EOD card. Fail-open: an empty
    set on a cold/unreadable cache, so a data gap never blanks the whole card."""
    if within_days <= 0:
        return set()
    try:
        from api import massive_ws_worker as mw
        cache = dict(getattr(mw, "_ER_DATE_CACHE", None) or {})
    except Exception:
        return set()
    if not cache:
        return set()
    try:
        today = datetime.now(ZoneInfo("America/New_York")).date()
    except Exception:
        return set()
    horizon = today + timedelta(days=within_days)
    out: set[str] = set()
    for sym, dstr in cache.items():
        try:
            d = datetime.strptime(str(dstr), "%Y-%m-%d").date()
        except (ValueError, TypeError):
            continue
        if today <= d <= horizon:          # upcoming report within the window
            out.add(str(sym).upper())
    return out


# ── formatting helpers ─────────────────────────────────────────────────────
def _is_etf(a: dict) -> bool:
    """ETF/index product vs single stock — the same split as the feed's
    Stocks/ETFs toggle (source=='indexes' → ETF; live_massive_router ~L543)."""
    return (a.get("source") or "").strip().lower() == "indexes"


def _fmt_prem(v) -> str:
    v = float(v or 0)
    if v >= 1e9:
        return f"${v / 1e9:.2f}B"
    m = v / 1e6
    return f"${m:.2f}M" if m < 10 else f"${m:.1f}M"


def _money(a: dict) -> str:
    lbl = a.get("moneynessLabel") or ""
    pct = a.get("moneynessPct")
    if lbl == "ATM" or pct is None:
        return lbl or "—"
    return f"{abs(pct):.1f}% {lbl}"


def _voi(a: dict) -> str:
    r = a.get("volumeOIRatio")
    if r is None:
        return "—"
    return f"{r:.0f}x" if r >= 10 else f"{r:.1f}x"


def _time_et(a: dict) -> str:
    ts = a.get("timestamp") or 0
    if not ts:
        return "—"
    from api.live_massive_router import ET
    dt = datetime.fromtimestamp(ts, tz=ET)
    h = dt.hour % 12 or 12
    return f"{h}:{dt.minute:02d}{'a' if dt.hour < 12 else 'p'}"


def _exp_short(exp) -> str:
    parts = str(exp or "").split("/")
    return "/".join(parts[:2]) if len(parts) >= 2 else str(exp or "")


def _exp_mdy(exp) -> str:
    """MM/DD/YYYY → mm/dd/yy (2-digit year). Falls back to the short m/d form."""
    parts = str(exp or "").split("/")
    if len(parts) < 3:
        return _exp_short(exp)
    try:
        m, d = int(parts[0]), int(parts[1])
        yy = parts[2][-2:]
        return f"{m:02d}/{d:02d}/{yy}"
    except (ValueError, IndexError):
        return _exp_short(exp)


def _dte(a: dict) -> str:
    d = a.get("dte")
    return f"{int(d)}d" if d is not None else "—"


def _avg(a: dict) -> str:
    """Average fill price PAID per contract (option price, not the underlying).
    Alpha Gold prints carry `averageFillPrice`; merged accumulations pre-compute
    it as total_premium / (total_volume × 100)."""
    try:
        p = float(a.get("averageFillPrice"))
    except (TypeError, ValueError):
        return "—"
    return f"${p:.2f}" if p > 0 else "—"


def _dir(a: dict) -> str:
    d = (a.get("_direction") or "").lower()
    if d.startswith("bull"):
        return "bull"
    if d.startswith("bear"):
        return "bear"
    cp = (a.get("cp") or "").upper()
    return "bull" if cp == "C" else "bear" if cp == "P" else ""


def _date_text(day_mdyyyy: str) -> str:
    try:
        dt = datetime.strptime(day_mdyyyy, "%m/%d/%Y")
        return f"{dt.strftime('%B')} {dt.day}, {dt.year}"
    except (ValueError, TypeError):
        return str(day_mdyyyy)


def _counts(alerts: list[dict]) -> dict:
    bull = [a for a in alerts if _dir(a) == "bull"]
    bear = [a for a in alerts if _dir(a) == "bear"]
    bp = sum((a.get("alertPremium") or 0) for a in bull) / 1e6
    rp = sum((a.get("alertPremium") or 0) for a in bear) / 1e6
    return {"n": len(alerts), "nb": len(bull), "nr": len(bear),
            "total": bp + rp, "net": bp - rp, "bull_prem": bp, "bear_prem": rp}


def _rollup(alerts: list[dict]) -> list[dict]:
    """One row per (ticker, direction): keep the biggest-premium print as the
    representative and stamp _n = how many prints rolled up. Input is premium-desc
    (get_alpha_gold_today sorts it), so first-seen = biggest and order is preserved.
    Mixed-direction tickers yield TWO rows (one per direction)."""
    seen: dict = {}
    order: list[dict] = []
    for a in alerts:
        key = (a.get("ticker"), _dir(a))
        if key in seen:
            seen[key]["_n"] += 1
        else:
            rep = dict(a)
            rep["_n"] = 1
            seen[key] = rep
            order.append(rep)
    return order


# ── render ─────────────────────────────────────────────────────────────────
# Columns spread across the card so spacing is even — no dead gap in the middle.
# C/P is folded into STRIKE ($195C); the underlying spot, %ITM/OTM and V/OI columns
# were dropped for a cleaner row (owner preference). AVG = avg fill price paid.
_COLS = [
    ("ticker", "TICKER", 40, "l"), ("strike", "STRIKE", 210, "l"),
    ("expdte", "EXP · DTE", 400, "l"), ("avg", "AVG", 730, "r"),
    ("prem", "PREMIUM", 915, "r"), ("dir", "DIR", 985, "l"),
]
_W, _ROWH, _TOP, _SECH = 1150, 34, 170, 32
_SS = 2  # supersample then downscale for crisp text


def render_card(alerts: list[dict], date_text: str, top_n: int = 30,
                net_stats: dict | None = None) -> bytes:
    from PIL import Image, ImageDraw, ImageFont

    def font(name, pt):
        return ImageFont.truetype(os.path.join(_ASSETS, name), int(pt * _SS))

    def s(v):
        return int(v * _SS)

    stocks = [a for a in alerts if not _is_etf(a)]
    etfs = [a for a in alerts if _is_etf(a)]
    sections = []
    for label, group in (("STOCKS", stocks), ("ETFs", etfs)):
        if group:
            sections.append((label, group, _rollup(group)[:max(0, top_n)]))

    grand = _counts(alerts)
    body_h = sum(_SECH + max(1, len(rows)) * _ROWH for _, _, rows in sections) or _ROWH
    H = _TOP + body_h + 54

    img = Image.new("RGB", (s(_W), s(H)), _BG)
    d = ImageDraw.Draw(img)
    f_title, f_date = font("DejaVuSans-Bold.ttf", 30), font("DejaVuSans.ttf", 19)
    f_sum = font("DejaVuSans-Bold.ttf", 17)
    f_hdr = font("DejaVuSans-Bold.ttf", 12)
    f_sec = font("DejaVuSans-Bold.ttf", 14)
    f_row, f_rowb = font("DejaVuSans.ttf", 15), font("DejaVuSans-Bold.ttf", 15)
    f_n = font("DejaVuSans-Bold.ttf", 12)
    f_foot = font("DejaVuSans.ttf", 12)

    def txt(x, y, t, fnt, fill, align="l"):
        t = str(t)
        w = d.textlength(t, font=fnt)
        if align == "r":
            d.text((x * _SS - w, y * _SS), t, font=fnt, fill=fill)
        else:
            d.text((s(x), s(y)), t, font=fnt, fill=fill)
        return w / _SS

    # title band + UCT compass logo
    d.rectangle([0, 0, s(_W), s(_TOP - 26)], fill=_BAND)
    try:
        _logo = Image.open(os.path.join(_ASSETS, "compass-mark.png")).convert("RGBA")
        # asset is white-backed → knock near-white pixels to transparent
        _logo.putdata([(r, g, b, 0 if (r > 242 and g > 242 and b > 242) else a)
                       for (r, g, b, a) in _logo.getdata()])
        _logo = _logo.resize((s(48), s(48)), Image.LANCZOS)
        img.paste(_logo, (s(32), s(18)), _logo)
    except Exception:
        pass
    tx = 94
    tx += txt(tx, 24, "UCT Intelligence", f_title, _GOLD) + 12
    tx += txt(tx, 24, "· Top Flow", f_title, _GOLD_DIM) + 12
    txt(tx, 32, "— " + date_text, f_date, _DIM)

    # net bull-vs-bear bar — the OVERALL day's directional flow (net_stats, in $,
    # the same premium-weighted read the LiveFlow dashboard shows), NOT just the
    # Alpha Gold prints on this card. Falls back to the card's own subset only if
    # the overall read is unavailable.
    if net_stats:
        _bp = (net_stats.get("bull_prem") or 0) / 1e6
        _rp = (net_stats.get("bear_prem") or 0) / 1e6
    else:
        _bp, _rp = grand["bull_prem"], grand["bear_prem"]
    _totp = _bp + _rp
    _bpct = (_bp / _totp) if _totp > 0 else 0.5
    _net = _bp - _rp
    _nsign = "+" if _net >= 0 else ""
    _ncol = _BULL if _net >= 0 else _BEAR
    txt(36, 76, f"▲ ${_bp:.1f}M Bull", f_sum, _BULL)
    _nt = f"NET {_nsign}${abs(_net):.1f}M"
    txt(_W / 2 - d.textlength(_nt, font=f_sum) / _SS / 2, 76, _nt, f_sum, _ncol)
    txt(_W - 36, 76, f"${_rp:.1f}M Bear ▼", f_sum, _BEAR, "r")
    _bx0, _bx1, _by, _bh = 36, _W - 36, 102, 14
    _gw = (_bx1 - _bx0) * _bpct
    _rad = s(4)
    if _gw > 5:
        d.rounded_rectangle([s(_bx0), s(_by), s(_bx0 + _gw), s(_by + _bh)], radius=_rad,
                            fill=_BULL, corners=(True, False, False, True))
    if (_bx1 - _bx0) - _gw > 5:
        d.rounded_rectangle([s(_bx0 + _gw), s(_by), s(_bx1), s(_by + _bh)], radius=_rad,
                            fill=_BEAR, corners=(False, True, True, False))

    # column headers
    for key, hdr, x, al in _COLS:
        txt(x, _TOP - 30, hdr, f_hdr, _DIM, al)
    d.rectangle([s(36), s(_TOP - 10), s(_W - 36), s(_TOP - 10) + 1], fill=_DIV)

    y = _TOP + 4
    for label, group, rows in sections:
        d.rectangle([0, s(y - 4), s(_W), s(y - 4) + s(_SECH - 6)], fill=_BAND)
        txt(40, y, label, f_sec, _GOLD)
        y += _SECH
        for i, a in enumerate(rows):
            if i % 2 == 1:
                d.rectangle([0, s(y - 6), s(_W), s(y - 6) + s(_ROWH)], fill=_ROWALT)
            is_bull = _dir(a) == "bull"
            dcol = _BULL if is_bull else _BEAR
            cp = (a.get("cp") or "").upper()
            strike = a.get("strike")
            for key, hdr, x, al in _COLS:
                if key == "ticker":
                    w = txt(x, y, a.get("ticker") or "", f_rowb, _GOLD)
                    if a.get("_n", 1) > 1:
                        txt(x + w + 6, y + 1, f"×{a['_n']}", f_n, _DIM)
                elif key == "strike":
                    txt(x, y, f"${strike:g}{cp}" if strike else "—", f_rowb, _TXT)
                elif key == "expdte":
                    txt(x, y, f"{_exp_mdy(a.get('exp'))} · {_dte(a)}", f_row, _DIM)
                elif key == "avg":
                    txt(x, y, _avg(a), f_row, _TXT, "r")
                elif key == "prem":
                    txt(x, y, _fmt_prem(a.get("alertPremium")), f_rowb, _GOLD, "r")
                elif key == "dir":
                    txt(x, y, f"{'▲' if is_bull else '▼'} {'BULL' if is_bull else 'BEAR'}",
                        f_rowb, dcol)
            y += _ROWH
        y += 6

    # footer
    d.rectangle([s(36), s(H - 40), s(_W - 36), s(H - 40) + 1], fill=_DIV)
    txt(36, H - 32, "UCT Intelligence", f_foot, _DIM)
    txt(_W - 36, H - 32, "uctintelligence.com", f_foot, _GOLD_DIM, "r")

    out = img.resize((_W, H), Image.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


# ── Discord post (hand-rolled multipart over stdlib urllib) ────────────────
def _summary_line(alerts: list[dict], date_text: str) -> str:
    c = _counts(alerts)
    ns = sum(1 for a in alerts if not _is_etf(a))
    ne = c["n"] - ns
    return (f"🎯 **UCT Intelligence · Top Flow — {date_text}**  ·  {c['n']} prints  ·  "
            f"${c['total']:.1f}M  ·  {c['nb']}▲ / {c['nr']}▼  ·  {ns} stocks / {ne} ETFs")


def _post_discord_image(webhook: str, png: bytes, content: str,
                        filename: str = "top_flow.png") -> tuple[bool, str]:
    """POST the PNG as a Discord image attachment via hand-built multipart/form-data
    over stdlib urllib (urllib has no files= helper). Cloudflare-safe UA required."""
    boundary = "----uctAlphaGold7f3b9c1e"
    payload_json = json.dumps({
        "content": content[:1900],
        "username": "UCT Intelligence · Top Flow",
        "allowed_mentions": {"parse": []},
    })
    parts: list[bytes] = []

    def add(name, value, fname=None, ctype=None):
        head = f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"'
        if fname:
            head += f'; filename="{fname}"'
        head += "\r\n"
        if ctype:
            head += f"Content-Type: {ctype}\r\n"
        head += "\r\n"
        parts.append(head.encode("utf-8"))
        parts.append(value if isinstance(value, bytes) else value.encode("utf-8"))
        parts.append(b"\r\n")

    add("payload_json", payload_json)
    add("files[0]", png, fname=filename, ctype="image/png")
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(parts)

    req = urllib.request.Request(
        webhook, data=body, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}",
                 "User-Agent": _UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            code = resp.getcode()
            return (200 <= code < 300, f"discord {code}")
    except urllib.error.HTTPError as e:
        return (False, f"discord HTTP {e.code}: {e.read()[:200]!r}")
    except Exception as e:  # noqa: BLE001
        return (False, f"post error: {e}")


# ── orchestration ──────────────────────────────────────────────────────────
def run_eod_summary(*, force: bool = False, post: bool = True,
                    today: str | None = None) -> dict:
    """Build + optionally post the EOD Alpha Gold card. `force` bypasses the
    ALPHA_GOLD_EOD_ENABLED gate (for the manual test trigger). When post=False,
    returns the PNG bytes under 'png' for preview. Never raises."""
    try:
        enabled = os.getenv("ALPHA_GOLD_EOD_ENABLED", "0") == "1"
        if not enabled and not force:
            return {"ok": False, "reason": "disabled (ALPHA_GOLD_EOD_ENABLED != 1)"}
        from api import live_massive_router as lmr
        day = today or lmr._today_mdyyyy()
        alerts = get_alpha_gold_today(day)
        # Fold in the day's ≥B by-contract accumulations (COIN/GLW-style conviction
        # flow) so the card surfaces more than just the biggest single prints.
        try:
            accum = _get_bcontract_accumulations(day, min_score=4.5)
            if accum:
                alerts = _merge_accum(alerts, accum)
                log.info("[alpha-gold-eod] merged %d ≥B accumulation(s)", len(accum))
        except Exception as e:  # noqa: BLE001
            log.warning("[alpha-gold-eod] accumulation merge failed: %s", e)
        # Owner rule: drop names reporting earnings this week (binary-event risk) —
        # the featured Alpha Gold list should be clean directional flow, not a
        # pre-earnings gamble. Window is env-tunable; NET bar below stays the
        # OVERALL day flow (deliberately unfiltered). Fail-open on a cold ER cache.
        er_days = int(os.getenv("ALPHA_GOLD_EOD_ER_EXCLUDE_DAYS", "7"))
        er_syms = _earnings_soon_syms(er_days)
        if er_syms:
            dropped = sorted({(a.get("ticker") or "").upper() for a in alerts
                              if (a.get("ticker") or "").upper() in er_syms})
            if dropped:
                alerts = [a for a in alerts
                          if (a.get("ticker") or "").upper() not in er_syms]
                log.info("[alpha-gold-eod] excluded %d earnings-week name(s) "
                         "(<=%dd): %s", len(dropped), er_days, ", ".join(dropped))
        date_text = _date_text(day)
        top_n = int(os.getenv("ALPHA_GOLD_EOD_TOP_N", "30"))
        # NET bar reflects the OVERALL day's directional flow (the LiveFlow "Market
        # Read"), not just the Alpha Gold prints on this card.
        net_stats = None
        try:
            ds = lmr._build_day_stats(day)
            net_stats = {"bull_prem": ds.get("bull_premium") or 0,
                         "bear_prem": ds.get("bear_premium") or 0}
        except Exception as e:
            log.warning("[alpha-gold-eod] overall day-stats unavailable: %s", e)
        png = render_card(alerts, date_text, top_n, net_stats=net_stats)
        res: dict = {"ok": True, "date": day, "count": len(alerts)}

        if not post:
            res["png"] = png
            return res

        if not alerts and os.getenv("ALPHA_GOLD_EOD_SKIP_EMPTY", "1") == "1":
            log.info("[alpha-gold-eod] no Alpha Gold today (%s) — skip post", day)
            res.update(posted=False, reason="no alpha gold today")
            return res

        wh = _webhook()
        if not wh:
            res.update(posted=False, reason="no webhook (set ALPHA_GOLD_EOD_WEBHOOK_URL)")
            return res
        # Post the image ONLY — no text line above it (owner preference). The card
        # already carries the title + totals. (_summary_line kept for reuse/tests.)
        ok, detail = _post_discord_image(wh, png, "")
        res.update(posted=ok, detail=detail)
        log.info("[alpha-gold-eod] %s — %d alerts, posted=%s (%s)",
                 day, len(alerts), ok, detail)
        return res
    except Exception as e:  # noqa: BLE001
        log.exception("[alpha-gold-eod] run failed")
        return {"ok": False, "reason": f"error: {e}"}
