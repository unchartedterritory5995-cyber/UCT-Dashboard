"""Dark Pool records — per-ticker biggest-ever dark-pool prints (persistent, never
pruned) + new-record Discord alerts. Web-side (owns darkpool.db).

`darkpool_trades` is pruned to ~120 trading days, so an all-time record must live
in its OWN table that only ever grows. Records update from the nightly ingest
(authoritative) and the intraday poller (~3-min, real-time). A print that BEATS an
existing record AND is >= DARKPOOL_RECORDS_ALERT_FLOOR (default $100M) fires one
Discord ping to the same channel as the EOD card. A ticker's FIRST-ever print is
stored silently (nothing to beat). Alerts dedup naturally: only a strictly-bigger
notional updates the row, so re-seeing the same print never re-alerts.

Dark by default: DARKPOOL_RECORDS_ENABLED=1 to arm tracking + alerts.
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import urllib.error
import urllib.request
from datetime import datetime

log = logging.getLogger("darkpool_records")
_UA = "UCT-Massive/1.0 (+https://uctintelligence.com)"


def _enabled() -> bool:
    return os.getenv("DARKPOOL_RECORDS_ENABLED", "0") == "1"


def _alert_floor() -> float:
    try:
        return float(os.getenv("DARKPOOL_RECORDS_ALERT_FLOOR", "100e6"))
    except (TypeError, ValueError):
        return 100e6


def _conn():
    from api.darkpool_db import DB_PATH
    return sqlite3.connect(DB_PATH, timeout=15)


def _ensure_table():
    c = _conn()
    try:
        c.execute("""
            CREATE TABLE IF NOT EXISTS darkpool_records (
                ticker        TEXT PRIMARY KEY,
                notional      REAL NOT NULL,
                price         REAL,
                date          TEXT,
                prev_notional REAL,
                prev_date     TEXT,
                updated_at    TEXT
            )
        """)
        c.commit()
    finally:
        c.close()


def _records_count() -> int:
    _ensure_table()
    c = _conn()
    try:
        return c.execute("SELECT COUNT(*) FROM darkpool_records").fetchone()[0]
    finally:
        c.close()


def _max_per_ticker(source: str, date: str | None = None) -> list[tuple]:
    """Biggest print per ticker from a source table (darkpool_trades /
    darkpool_today), optionally one date. Returns (ticker, notional, price, date).
    `source` is a fixed internal literal — never user input."""
    c = _conn()
    try:
        if date:
            rows = c.execute(f"""
                SELECT t.ticker, t.notional, t.price, t.date FROM {source} t
                JOIN (SELECT ticker, MAX(notional) mx FROM {source}
                      WHERE notional IS NOT NULL AND date=? GROUP BY ticker) m
                  ON t.ticker=m.ticker AND t.notional=m.mx AND t.date=?
            """, (date, date)).fetchall()
        else:
            rows = c.execute(f"""
                SELECT t.ticker, t.notional, t.price, t.date FROM {source} t
                JOIN (SELECT ticker, MAX(notional) mx FROM {source}
                      WHERE notional IS NOT NULL GROUP BY ticker) m
                  ON t.ticker=m.ticker AND t.notional=m.mx
            """).fetchall()
    finally:
        c.close()
    # A ticker can tie its own max on two rows — keep one.
    seen: dict = {}
    for tk, notional, price, dt in rows:
        if tk and (tk not in seen or (notional or 0) > (seen[tk][1] or 0)):
            seen[tk] = (tk, notional, price, dt)
    return list(seen.values())


def seed_from_trades() -> int:
    """Idempotent seed: each ticker's biggest print in the retained trades history.
    Upserts the MAX so re-seeding never lowers a record. Returns rows written."""
    _ensure_table()
    prints = _max_per_ticker("darkpool_trades")
    c = _conn()
    n = 0
    try:
        now = datetime.utcnow().isoformat()
        for tk, notional, price, date in prints:
            if not tk or not notional or notional <= 0:
                continue
            cur = c.execute("SELECT notional FROM darkpool_records WHERE ticker=?", (tk,)).fetchone()
            if cur is None:
                c.execute("INSERT INTO darkpool_records (ticker,notional,price,date,updated_at) "
                          "VALUES (?,?,?,?,?)", (tk, notional, price, date, now))
                n += 1
            elif (notional or 0) > (cur[0] or 0):
                c.execute("UPDATE darkpool_records SET notional=?,price=?,date=?,updated_at=? "
                          "WHERE ticker=?", (notional, price, date, now, tk))
                n += 1
        c.commit()
    finally:
        c.close()
    return n


def _apply(prints: list[tuple]) -> list[dict]:
    """Update records from prints; return NEW-record events (only those that BEAT
    an existing record — a first-ever ticker is stored silently)."""
    _ensure_table()
    c = _conn()
    events: list[dict] = []
    try:
        now = datetime.utcnow().isoformat()
        for tk, notional, price, date in prints:
            if not tk or not notional or notional <= 0:
                continue
            cur = c.execute("SELECT notional,date FROM darkpool_records WHERE ticker=?", (tk,)).fetchone()
            if cur is None:
                c.execute("INSERT INTO darkpool_records (ticker,notional,price,date,updated_at) "
                          "VALUES (?,?,?,?,?)", (tk, notional, price, date, now))
            elif notional > (cur[0] or 0):
                c.execute("UPDATE darkpool_records SET notional=?,price=?,date=?,"
                          "prev_notional=?,prev_date=?,updated_at=? WHERE ticker=?",
                          (notional, price, date, cur[0], cur[1], now, tk))
                events.append({"ticker": tk, "notional": notional, "price": price, "date": date,
                               "prev_notional": cur[0], "prev_date": cur[1]})
        c.commit()
    finally:
        c.close()
    return events


# ── Discord alert (text ping, hand-rolled over stdlib urllib) ───────────────
def _post_text(content: str) -> None:
    from api.darkpool_eod import _webhook
    wh = _webhook()
    if not wh:
        return
    data = json.dumps({
        "content": content[:1900],
        "username": "UCT Intelligence · Dark Pool",
        "allowed_mentions": {"parse": []},
    }).encode("utf-8")
    req = urllib.request.Request(
        wh, data=data, method="POST",
        headers={"Content-Type": "application/json", "User-Agent": _UA})
    try:
        urllib.request.urlopen(req, timeout=15)
    except Exception as e:  # noqa: BLE001
        log.warning("[darkpool-records] alert post failed: %s", e)


def _alert(events: list[dict]) -> int:
    from api.darkpool_eod import _fmt_n
    floor = _alert_floor()
    sent = 0
    for e in sorted(events, key=lambda x: x["notional"] or 0, reverse=True):
        if (e["notional"] or 0) < floor:
            continue
        px = e.get("price")
        _at = f" @ ${px:,.2f}" if px else ""
        if e.get("prev_notional"):
            _prev = f" — beats {_fmt_n(e['prev_notional'])}" + (f" ({e['prev_date']})" if e.get("prev_date") else "")
        else:
            _prev = ""
        _post_text(f"🚨 **{e['ticker']}** set a new dark-pool record: **{_fmt_n(e['notional'])}**{_at}{_prev}")
        sent += 1
    return sent


# ── entry points (called from the ingest paths; fail-soft) ──────────────────
def _refresh(source: str, date: str | None) -> dict:
    if not _enabled():
        return {"ok": False, "reason": "disabled"}
    try:
        just_seeded = False
        if _records_count() == 0:
            seed_from_trades()          # first-ever: capture the baseline silently
            just_seeded = True
        events = _apply(_max_per_ticker(source, date))
        sent = 0 if just_seeded else _alert(events)   # never alert on the seed cycle
        return {"ok": True, "source": source, "new_records": len(events),
                "alerts_sent": sent, "seeded": just_seeded}
    except Exception as e:  # noqa: BLE001
        log.exception("[darkpool-records] refresh failed")
        return {"ok": False, "reason": str(e)}


def refresh_from_trades(date_mdyyyy: str | None = None) -> dict:
    """Nightly hook — the authoritative session just landed in darkpool_trades."""
    return _refresh("darkpool_trades", date_mdyyyy)


def refresh_from_today() -> dict:
    """Intraday hook — new live prints just landed in darkpool_today (~3 min)."""
    return _refresh("darkpool_today", None)


def get_records(limit: int = 300, sort: str = "notional") -> list[dict]:
    """The records table for the /api/darkpool/records endpoint + panel."""
    _ensure_table()
    order = {"notional": "notional DESC", "date": "date DESC",
             "ticker": "ticker ASC"}.get(sort, "notional DESC")
    c = _conn()
    try:
        rows = c.execute(
            f"SELECT ticker,notional,price,date,prev_notional,prev_date,updated_at "
            f"FROM darkpool_records ORDER BY {order} LIMIT ?", (int(limit),)).fetchall()
    finally:
        c.close()
    return [{"ticker": r[0], "notional": r[1], "price": r[2], "date": r[3],
             "prevNotional": r[4], "prevDate": r[5], "updatedAt": r[6]} for r in rows]


def _tracked_count() -> int:
    return _records_count()


# ── Records leaderboard card (Discord highlights) ────────────────────────────
def render_records_card(records: list[dict], as_of_text: str, tracked: int = 0) -> bytes:
    """All-time biggest-print leaderboard PNG, in the Dark Pool card's brand."""
    from PIL import Image, ImageDraw, ImageFont
    from api.darkpool_eod import (_BG, _BAND, _ROWALT, _GOLD, _GOLD_DIM, _TXT,
                                  _DIM, _DIV, _ASSETS, _fmt_n)
    W, ROWH, TOP, SS = 900, 34, 132, 2
    n = max(1, len(records))
    H = TOP + n * ROWH + 54

    def font(name, pt):
        return ImageFont.truetype(os.path.join(_ASSETS, name), int(pt * SS))

    def s(v):
        return int(v * SS)

    img = Image.new("RGB", (s(W), s(H)), _BG)
    d = ImageDraw.Draw(img)
    f_title, f_date = font("DejaVuSans-Bold.ttf", 28), font("DejaVuSans.ttf", 17)
    f_sub = font("DejaVuSans.ttf", 13)
    f_hdr = font("DejaVuSans-Bold.ttf", 12)
    f_row, f_rowb = font("DejaVuSans.ttf", 15), font("DejaVuSans-Bold.ttf", 15)
    f_foot = font("DejaVuSans.ttf", 12)

    def txt(x, y, t, fnt, fill, align="l"):
        t = str(t)
        w = d.textlength(t, font=fnt)
        d.text(((x * SS - w) if align == "r" else s(x), s(y)), t, font=fnt, fill=fill)
        return w / SS

    d.rectangle([0, 0, s(W), s(TOP - 26)], fill=_BAND)
    try:
        _logo = Image.open(os.path.join(_ASSETS, "compass-mark.png")).convert("RGBA")
        _logo.putdata([(r, g, b, 0 if (r > 242 and g > 242 and b > 242) else a)
                       for (r, g, b, a) in _logo.getdata()])
        _logo = _logo.resize((s(46), s(46)), Image.LANCZOS)
        img.paste(_logo, (s(30), s(16)), _logo)
    except Exception:
        pass
    tx = 90
    tx += txt(tx, 22, "UCT Intelligence", f_title, _GOLD) + 10
    tx += txt(tx, 22, "· Dark Pool Records", f_title, _GOLD_DIM) + 10
    txt(tx, 29, "— " + as_of_text, f_date, _DIM)
    txt(30, 66, f"All-time biggest dark-pool prints on record  ·  {tracked:,} tickers tracked",
        f_sub, _DIM)

    cols = [("rank", "#", 40, "l"), ("ticker", "TICKER", 92, "l"),
            ("notional", "RECORD", 420, "r"), ("price", "PRICE", 560, "r"),
            ("date", "DATE", 760, "r")]
    for _, hdr, x, al in cols:
        txt(x, TOP - 28, hdr, f_hdr, _DIM, al)
    d.rectangle([s(30), s(TOP - 8), s(W - 30), s(TOP - 8) + 1], fill=_DIV)

    y = TOP + 4
    for i, r in enumerate(records):
        if i % 2 == 1:
            d.rectangle([0, s(y - 6), s(W), s(y - 6) + s(ROWH)], fill=_ROWALT)
        txt(40, y, str(i + 1), f_row, _DIM)
        txt(92, y, r.get("ticker") or "", f_rowb, _GOLD)
        txt(420, y, _fmt_n(r.get("notional")), f_rowb, _GOLD, "r")
        _px = r.get("price")
        txt(560, y, (f"${_px:,.2f}" if _px else "—"), f_row, _TXT, "r")
        txt(760, y, r.get("date") or "—", f_row, _DIM, "r")
        y += ROWH

    d.rectangle([s(30), s(H - 40), s(W - 30), s(H - 40) + 1], fill=_DIV)
    txt(30, H - 32, "UCT Intelligence", f_foot, _DIM)
    txt(W - 30, H - 32, "uctintelligence.com", f_foot, _GOLD_DIM, "r")

    out = img.resize((W, H), Image.LANCZOS)
    import io
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


def run_records_card(*, post: bool = False, top_n: int = 25) -> dict:
    """Build (+ optionally post) the all-time records leaderboard card. Never
    raises; post=False returns the PNG under 'png' for preview."""
    try:
        from datetime import datetime as _dt
        from zoneinfo import ZoneInfo
        recs = get_records(limit=max(1, top_n), sort="notional")
        try:
            _now = _dt.now(ZoneInfo("America/New_York"))
            as_of = f"{_now.strftime('%B')} {_now.day}, {_now.year}"
        except Exception:
            as_of = ""
        png = render_records_card(recs, as_of, tracked=_tracked_count())
        res: dict = {"ok": True, "rows": len(recs)}
        if not post:
            res["png"] = png
            return res
        from api.darkpool_eod import _post_discord_image, _webhook
        wh = _webhook()
        if not wh:
            res.update(posted=False, reason="no webhook")
            return res
        ok, detail = _post_discord_image(wh, png, "", filename="dark_pool_records.png")
        res.update(posted=ok, detail=detail)
        return res
    except Exception as e:  # noqa: BLE001
        log.exception("[darkpool-records] card failed")
        return {"ok": False, "reason": str(e)}
