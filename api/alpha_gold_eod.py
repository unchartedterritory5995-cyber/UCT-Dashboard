"""End-of-day Alpha Gold summary — renders the day's Alpha Gold options flow as a
branded PNG and posts it to Discord as an image attachment.

Runs on the FLOW-WORKER (owns flow.db). Dark by default: gated by
ALPHA_GOLD_EOD_ENABLED; the flow-worker schedules it ~16:05 ET on weekdays. A
PUSH_SECRET endpoint (`POST /api/live/massive/alpha-gold-eod`) triggers it
manually — ?post=0 returns the rendered PNG for preview, ?post=1 posts it.

The Discord post is a hand-rolled multipart/form-data over stdlib urllib (NO
requests/httpx dependency — httpx is absent on the flow-worker), reusing the
Cloudflare-safe User-Agent that _post_massive_discord needs.

Env:
  ALPHA_GOLD_EOD_ENABLED      "1" to arm the scheduled post (default off)
  ALPHA_GOLD_EOD_WEBHOOK_URL  Discord webhook; falls back to the LiveFlow/admin
                              webhook so it can NEVER default to a public channel
  ALPHA_GOLD_EOD_TOP_N        max rows on the card (default 30; "+N more" footer)
  ALPHA_GOLD_EOD_SKIP_EMPTY   "1" (default) = don't post on a zero-alert day
"""
from __future__ import annotations

import io
import json
import logging
import os
import urllib.request
import urllib.error
from datetime import datetime

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


# ── formatting helpers ─────────────────────────────────────────────────────
def _fmt_prem(v) -> str:
    v = float(v or 0)
    if v >= 1e9:
        return f"${v / 1e9:.2f}B"
    m = v / 1e6
    return f"${m:.2f}M" if m < 10 else f"${m:.1f}M"


def _prem_m(v) -> float:
    return float(v or 0) / 1e6


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


def _totals(alerts: list[dict]) -> dict:
    bull = [a for a in alerts if _dir(a) == "bull"]
    bear = [a for a in alerts if _dir(a) == "bear"]
    bp = sum(_prem_m(a.get("alertPremium")) for a in bull)
    rp = sum(_prem_m(a.get("alertPremium")) for a in bear)
    return {"n": len(alerts), "total": sum(_prem_m(a.get("alertPremium")) for a in alerts),
            "nb": len(bull), "nr": len(bear), "bp": bp, "rp": rp, "net": bp - rp}


# ── render ─────────────────────────────────────────────────────────────────
_COLS = [
    ("time", "TIME", 36, "l"), ("ticker", "TICKER", 120, "l"), ("cp", "C/P", 210, "l"),
    ("strike", "STRIKE", 345, "r"), ("exp", "EXP", 362, "l"), ("spot", "SPOT", 560, "r"),
    ("money", "%ITM/OTM", 700, "r"), ("prem", "PREMIUM", 862, "r"), ("voi", "V/OI", 935, "r"),
    ("type", "TYPE", 952, "l"), ("dir", "DIR", 1058, "l"),
]
_W, _ROWH, _TOP = 1150, 34, 168
_SS = 2  # supersample then downscale for crisp text


def render_card(alerts: list[dict], date_text: str, top_n: int = 30) -> bytes:
    from PIL import Image, ImageDraw, ImageFont

    def font(name, pt):
        return ImageFont.truetype(os.path.join(_ASSETS, name), int(pt * _SS))

    def s(v):
        return int(v * _SS)

    rows = alerts[:max(0, top_n)]
    extra = len(alerts) - len(rows)
    tot = _totals(alerts)
    H = _TOP + max(1, len(rows)) * _ROWH + 54

    img = Image.new("RGB", (s(_W), s(H)), _BG)
    d = ImageDraw.Draw(img)
    f_title, f_date = font("DejaVuSans-Bold.ttf", 30), font("DejaVuSans.ttf", 19)
    f_sum = font("DejaVuSans-Bold.ttf", 17)
    f_hdr = font("DejaVuSans-Bold.ttf", 12)
    f_row, f_rowb = font("DejaVuSans.ttf", 15), font("DejaVuSans-Bold.ttf", 15)
    f_foot = font("DejaVuSans.ttf", 12)

    def txt(x, y, t, fnt, fill, align="l"):
        t = str(t)
        if align == "r":
            w = d.textlength(t, font=fnt)
            d.text((x * _SS - w, y * _SS), t, font=fnt, fill=fill)
        else:
            d.text((s(x), s(y)), t, font=fnt, fill=fill)

    # header band + title
    d.rectangle([0, 0, s(_W), s(_TOP - 24)], fill=_BAND)
    d.text((s(36), s(30)), "★", font=f_title, fill=_GOLD)
    txt(72, 30, "ALPHA GOLD", f_title, _GOLD)
    tw = d.textlength("ALPHA GOLD", font=f_title) / _SS
    txt(72 + tw + 14, 38, "—  " + date_text, f_date, _DIM)

    # summary line
    sx = 36

    def chunk(x, t, fill):
        txt(x, 80, t, f_sum, fill)
        return x + d.textlength(str(t), font=f_sum) / _SS + 8

    sx = chunk(sx, f"{tot['n']} alerts", _TXT)
    sx = chunk(sx, "·", _DIM)
    sx = chunk(sx, f"${tot['total']:.1f}M premium", _GOLD)
    sx = chunk(sx, "·", _DIM)
    sx = chunk(sx, f"▲ {tot['nb']} Bull", _BULL)
    sx = chunk(sx, "/", _DIM)
    sx = chunk(sx, f"▼ {tot['nr']} Bear", _BEAR)
    sx = chunk(sx, "·", _DIM)
    net = tot["net"]
    chunk(sx, f"Net {'+' if net >= 0 else '−'}${abs(net):.1f}M {'Bull' if net >= 0 else 'Bear'}",
          _BULL if net >= 0 else _BEAR)

    # column headers + divider
    for key, hdr, x, al in _COLS:
        txt(x, _TOP - 42, hdr, f_hdr, _DIM, al)
    d.rectangle([s(36), s(_TOP - 20), s(_W - 36), s(_TOP - 20) + 1], fill=_DIV)

    # rows
    for i, a in enumerate(rows):
        y = _TOP - 12 + i * _ROWH
        if i % 2 == 1:
            d.rectangle([0, s(y - 6), s(_W), s(y - 6) + s(_ROWH)], fill=_ROWALT)
        is_bull = _dir(a) == "bull"
        dcol = _BULL if is_bull else _BEAR
        cp = (a.get("cp") or "").upper()
        strike = a.get("strike")
        spot = a.get("spot")
        vals = {
            "time": (_time_et(a), _DIM, f_row, "l"),
            "ticker": (a.get("ticker") or "", _GOLD, f_rowb, "l"),
            "cp": (cp or "—", (_BULL if cp == "C" else _BEAR), f_rowb, "l"),
            "strike": (f"${strike:g}" if strike else "—", _TXT, f_row, "r"),
            "exp": (_exp_short(a.get("exp")), _DIM, f_row, "l"),
            "spot": (f"{spot:.2f}" if spot else "—", _DIM, f_row, "r"),
            "money": (_money(a), _TXT, f_row, "r"),
            "prem": (_fmt_prem(a.get("alertPremium")), _GOLD, f_rowb, "r"),
            "voi": (_voi(a), _TXT, f_row, "r"),
            "type": ((a.get("_type") or "").strip(), _DIM, f_row, "l"),
        }
        for key, hdr, x, al in _COLS:
            if key == "dir":
                arw = "▲" if is_bull else "▼"
                txt(x, y, f"{arw} {'BULL' if is_bull else 'BEAR'}", f_rowb, dcol, "l")
            else:
                t, fill, fnt, al2 = vals[key]
                txt(x, y, t, fnt, fill, al2)

    # footer
    d.rectangle([s(36), s(H - 40), s(_W - 36), s(H - 40) + 1], fill=_DIV)
    foot = "UCT Intelligence  ·  Alpha Gold — the day's top-conviction $1M+ ask sweeps"
    if extra > 0:
        foot += f"   ( +{extra} more )"
    txt(36, H - 32, foot, f_foot, _DIM)
    txt(_W - 36, H - 32, "uctintelligence.com", f_foot, _GOLD_DIM, "r")

    out = img.resize((_W, H), Image.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


# ── Discord post (hand-rolled multipart over stdlib urllib) ────────────────
def _summary_line(alerts: list[dict], date_text: str) -> str:
    t = _totals(alerts)
    net = t["net"]
    sign = "+" if net >= 0 else "-"
    lead = alerts[0] if alerts else None
    line = (f"⭐ **Alpha Gold — {date_text}**  ·  {t['n']} alerts  ·  "
            f"${t['total']:.1f}M  ·  {t['nb']}▲ / {t['nr']}▼  ·  "
            f"net {sign}${abs(net):.1f}M {'bull' if net >= 0 else 'bear'}")
    if lead:
        line += f"\nTop: {lead.get('ticker')} {lead.get('cp')} ${lead.get('strike'):g} · {_fmt_prem(lead.get('alertPremium'))}"
    return line


def _post_discord_image(webhook: str, png: bytes, content: str,
                        filename: str = "alpha_gold.png") -> tuple[bool, str]:
    """POST the PNG as a Discord image attachment via hand-built multipart/form-data
    over stdlib urllib (urllib has no files= helper). Cloudflare-safe UA required."""
    boundary = "----uctAlphaGold7f3b9c1e"
    payload_json = json.dumps({
        "content": content[:1900],
        "username": "UCT Alpha Gold",
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
        date_text = _date_text(day)
        top_n = int(os.getenv("ALPHA_GOLD_EOD_TOP_N", "30"))
        png = render_card(alerts, date_text, top_n)
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
        ok, detail = _post_discord_image(wh, png, _summary_line(alerts, date_text))
        res.update(posted=ok, detail=detail)
        log.info("[alpha-gold-eod] %s — %d alerts, posted=%s (%s)",
                 day, len(alerts), ok, detail)
        return res
    except Exception as e:  # noqa: BLE001
        log.exception("[alpha-gold-eod] run failed")
        return {"ok": False, "reason": f"error: {e}"}
