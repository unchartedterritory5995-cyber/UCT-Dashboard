"""Deal status: is this stock pinned at a buyout price? ONE answer for the whole app.

WHY THIS EXISTS. On 2026-10-23 the chart engine drew a base on TECH, a stock pinned at
its buyout price since a +19% gap on 2026-06-25, because nothing told it the stock was
being acquired. The screener had its own hand list (TECH absent), breadth had another
(TECH present), the catalyst curator had a prompt line, and the pattern layers had
nothing. This module is the one place they all ask.

Three sources, merged:
  1. HAND LISTS (confidence 1.0). `api/data/screener_buyout_exclude.json` (the screener's
     owner-maintained list; this module is now its ONLY reader; its non-deal owner excludes,
     `breadth_server_universe.NOT_DEALS`, are never called pending) and the breadth server's
     verbatim mirror of the PC's `universe_exclude._MANUAL`
     (`breadth_server_universe.EXCLUDE` minus its named non-deal entries,
     `breadth_server_universe.NOT_DEALS`). A hand-listed name stays pending until the
     owner removes it: a news "terminated" headline does not override the owner.
  2. NEWS (0.9). Definitive-agreement headlines already stored by the app: the catalyst
     engine's 48-hour store (`catalyst_news.db`) and the persistent company-news store
     (`company_news.db`). Both are opened READ-ONLY; nothing here fetches anything.
     "X to be acquired by Y for $N per share", "Y agrees to acquire X ...", tender offers.
     Rumours, talks, proposals and unsolicited bids are NOT pending (they are live
     trades). A later "completed / closed / terminated / delisted" headline about the
     target ends it, and so does going N days (DEAL_STATUS_NEWS_MAX_AGE_DAYS, default
     120) without a confirming headline or a confirming price pin.
  3. PRICE BEHAVIOUR (corroboration only). A gap of 8%+ that never filled, then 15+
     sessions in a tiny range (range < 2%, ATR < 0.5% of price). Beside a news deal price
     it confirms the deal (0.95, and it keeps an old headline alive). ON ITS OWN it only
     marks `possible: True` at confidence 0.5 and is NEVER pending: a quiet chart is not
     a takeover.

Fail safe: any error means NOT pending (a bug must never hide a chart), logged.
Cached per ET day (refreshed at most every DEAL_STATUS_REFRESH_S within the day, so a
deal announced at 9am is picked up the same day).

DEAL_STATUS_ENABLED (default OFF, read per call) gates every CONSUMER (the screener
universe and the chart drawings). With it off every consumer is byte-identical to before
this module existed; the functions here still answer, for reports and tests.
"""
from __future__ import annotations

import contextlib
import json
import logging
import os
import re
import sqlite3
import threading
import time
from datetime import date, datetime, timedelta, timezone

_log = logging.getLogger(__name__)

_TRUTHY = ("1", "true", "yes", "on")

HAND_FILENAME = "screener_buyout_exclude.json"

#: Confidence per source. A consumer that hides something reads `pending`, which is only
#: ever true at >= PENDING_MIN_CONFIDENCE; price behaviour alone sits below it on purpose.
CONF_HAND = 1.0
CONF_NEWS = 0.9
CONF_NEWS_PRICE = 0.95
CONF_NEWS_STALE_PRICE = 0.85
CONF_PRICE_ONLY = 0.5
PENDING_MIN_CONFIDENCE = 0.8

CHART_LABEL = "Pending acquisition — pattern drawings hidden"

# Price-pin geometry.
GAP_MIN = 0.08            # |open / prior close - 1| of the deal gap
PIN_SESSIONS = 15         # trailing sessions that must sit in the tiny range
PIN_RANGE_MAX = 0.02      # max(high) / min(low) - 1 over those sessions
PIN_ATR_MAX = 0.005       # mean true range / last close over the last 14 sessions
# The whole post-gap stretch stays this tight (arb drift; TECH 2026: 3.7%). Kept BELOW GAP_MIN on
# purpose: a gap that filled has a post-gap range of at least the gap, so this one check also
# refuses every filled gap (one guard, not two).
POST_GAP_RANGE_MAX = 0.06
GAP_LOOKBACK = 260        # sessions searched for the gap
DEAL_PRICE_BAND = (0.90, 1.03)  # last close / deal price, to count as "near" it
PRICE_BARS = 300

NEWS_LOOKBACK_DAYS = 400


def enabled() -> bool:
    """DEAL_STATUS_ENABLED, read PER CALL. Unset means OFF."""
    return os.environ.get("DEAL_STATUS_ENABLED", "0").strip().lower() in _TRUTHY


def _news_max_age_days() -> int:
    try:
        return max(1, int(os.environ.get("DEAL_STATUS_NEWS_MAX_AGE_DAYS", "120")))
    except ValueError:
        return 120


def _refresh_s() -> float:
    try:
        return max(60.0, float(os.environ.get("DEAL_STATUS_REFRESH_S", "14400")))
    except ValueError:
        return 14400.0


def _data_dir() -> str:
    return os.environ.get("DATA_DIR", "/data")


def _today() -> date:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/New_York")).date()
    except Exception:  # noqa: BLE001
        return datetime.now(timezone.utc).date()


# ---------------------------------------------------------------------------
# 1. Hand lists
# ---------------------------------------------------------------------------

def _hand_path() -> str:
    return os.path.join(os.path.dirname(__file__), "..", "data", HAND_FILENAME)


def hand_list() -> frozenset:
    """The owner's screener buyout list, exactly as the screener read it before this
    module (upper-cased, empty on any fault). The ONE reader of the file."""
    try:
        with open(_hand_path(), "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        return frozenset()
    except Exception as exc:  # noqa: BLE001
        _log.warning("[deal-status] hand list load failed: %s", exc)
        return frozenset()
    if not isinstance(data, list):
        _log.warning("[deal-status] hand list is not a list")
        return frozenset()
    return frozenset(str(t).upper() for t in data if t)


def hand_deals() -> frozenset:
    """The hand list's DEAL names: the screener file also carries owner excludes that are not
    acquisitions (`breadth_server_universe.NOT_DEALS`). They stay excluded from the screener and
    are never reported as pending acquisitions. Empty on any fault (fail safe: not pending)."""
    try:
        from api.services import breadth_server_universe as bsu
        return hand_list() - bsu.NOT_DEALS
    except Exception as exc:  # noqa: BLE001
        _log.warning("[deal-status] NOT_DEALS unavailable, hand list not used: %s", exc)
        return frozenset()


def mirror_list() -> frozenset:
    """The PC's manual buyout names as the breadth server mirrors them (its non-deal
    entries removed by name). Empty on any fault."""
    try:
        from api.services import breadth_server_universe as bsu
        return frozenset(bsu.EXCLUDE - bsu.NOT_DEALS)
    except Exception as exc:  # noqa: BLE001
        _log.warning("[deal-status] mirror list unavailable: %s", exc)
        return frozenset()


# ---------------------------------------------------------------------------
# 2. News
# ---------------------------------------------------------------------------

_NAME = r"[A-Za-z0-9&.,'\-() :]+?"
# Target BEFORE the verb: "<target> to be acquired by ...".
_TARGET_SIDE = re.compile(
    r"\b(?:(?:agree[sd]?|agreed|has\s+agreed|signs?\s+(?:a\s+)?definitive\s+(?:merger\s+)?agreement|"
    r"enters?\s+into\s+(?:a\s+)?definitive\s+(?:merger\s+)?agreement|announces?\s+(?:a\s+)?definitive\s+"
    r"(?:merger\s+)?agreement)\s+)?to\s+be\s+(?:acquired|bought|purchased|taken\s+private)\b"
    r"|\b(?:agrees?|agreed)\s+to\s+(?:a\s+)?sale\s+to\b",
    re.I)
# Target AFTER the verb: "<acquirer> agrees to acquire <target> ...", tender offers.
_ACQUIRER_SIDE = re.compile(
    r"\b(?:to|will|agrees?\s+to|agreed\s+to|has\s+agreed\s+to|signs?\s+(?:a\s+)?definitive\s+(?:merger\s+)?"
    r"agreement\s+to|enters?\s+into\s+(?:a\s+)?definitive\s+(?:merger\s+)?agreement\s+to)\s+"
    r"(?:acquire|buy|purchase|take\s+private)\b"
    r"|\b(?:commences?|launch(?:es|ed)?|extends?|completes?|successfully\s+completes?)\s+(?:a\s+|its\s+|the\s+)?"
    r"(?:cash\s+)?tender\s+offer\s+(?:for|to\s+acquire)\b",
    re.I)
# Words that make an acquirer-side headline definitive (a bare "to buy" is not enough).
_DEFINITIVE = re.compile(
    r"definitive|\bagree|per\s+share|a\s+share|/\s?sh\b|tender\s+offer|merger\s+agreement|"
    r"in\s+cash|all[\s-]cash|\bdeal\s+valued|\$\s?[\d.,]+\s*(?:billion|million|bn|b|m)\s+deal", re.I)
# Live / speculative M&A: still a trade, never "pending".
_SPECULATIVE = re.compile(
    r"\b(?:rumou?rs?|rumou?red|reportedly|sources?|said\s+to|in\s+talks|talks|explor(?:es|ing)|"
    r"consider(?:s|ing)?|weigh(?:s|ing)|nears?|approach(?:es|ed)?|interest\s+in|could|may|might|"
    r"potential|possible|unsolicited|hostile|non[\s-]binding|proposal|propos(?:es|ed)|bid|bids|"
    r"counter[\s-]?offer|considers)\b|\?", re.I)
_END = re.compile(
    r"\b(?:complet(?:es|ed|ion)|closes|closed|closing\s+of|finaliz(?:es|ed)|terminat(?:es|ed|ion)|"
    r"called\s+off|abandon(?:s|ed)|walks?\s+away|scrap(?:s|ped)?|delist(?:s|ed|ing)?|falls?\s+through|"
    r"withdraw[sn]?|blocks|blocked)\b", re.I)
_END_VETO = re.compile(r"\bexpect|\banticipat|\bpending\b|\bon\s+track\b|\bsubject\s+to\b", re.I)
_DEAL_WORD = re.compile(r"acqui|merger|\bdeal\b|tender\s+offer|takeover|buyout|transaction|take[\s-]private|"
                        r"taken\s+private|\bsale\b", re.I)
_PRICE = re.compile(
    r"\$\s?(\d{1,5}(?:,\d{3})*(?:\.\d{1,4})?)\s*(?:per\s+share|a\s+share|/\s?sh(?:are)?\b|each)", re.I)


def parse_price(text: str):
    """The per-share deal price in a headline, or None. "$11.3 billion" is not a price."""
    m = _PRICE.search(text or "")
    if not m:
        return None
    try:
        v = float(m.group(1).replace(",", ""))
    except ValueError:
        return None
    return v if v > 0 else None


def _known_name(sym: str) -> str:
    """A company name ONLY if one is already in memory (no fetch, ever)."""
    try:
        from api.services.news import subject
        n = subject._NAME_CACHE.get(sym)
        if n:
            return n
    except Exception:  # noqa: BLE001
        pass
    try:
        from api.services import sec_filings
        m = sec_filings._CACHE.get("sec::name_map") or {}
        return m.get(sym, "") if isinstance(m, dict) else ""
    except Exception:  # noqa: BLE001
        return ""


def _named_in(sym: str, text: str) -> bool:
    """True when `text` names `sym`: `$SYM`, `(NASDAQ: SYM)`, an unambiguous bare symbol, or
    the company name (the news subject test's own matchers)."""
    if not text:
        return False
    from api.services.news import subject
    if subject._symbol_hit(sym, text):
        return True
    name = _known_name(sym)
    return bool(name) and subject._name_hit(subject._aliases(sym, name), text)


def parse_headline(title: str, tickers) -> list:
    """The deal events one headline carries: [(sym, kind, price)], kind is 'definitive',
    'confirm' or 'end'. `tickers` are the symbols the store tagged on it. Conservative: a
    headline it cannot attribute to a target yields nothing."""
    t = (title or "").strip()
    syms = [str(s).upper() for s in (tickers or []) if s]
    if not t or not syms or not _DEAL_WORD.search(t):
        return []
    price = parse_price(t)

    def _target_syms(target_text: str, *, sole_ok: bool) -> list:
        hits = [s for s in syms if _named_in(s, target_text)]
        if not hits and sole_ok and len(syms) == 1:
            hits = list(syms)
        return hits

    tm = _TARGET_SIDE.search(t)
    am = _ACQUIRER_SIDE.search(t)
    if _END.search(t) and not _END_VETO.search(t):
        if am:
            hits = _target_syms(t[am.end():], sole_ok=False)
        elif tm:
            hits = _target_syms(t[:tm.start()], sole_ok=True)
        else:
            # "X completes acquisition of Y" / "Y merger terminated": every tagged symbol.
            hits = list(syms)
        return [(s, "end", None) for s in hits]
    if _SPECULATIVE.search(t):
        return []
    if tm:
        return [(s, "definitive", price) for s in _target_syms(t[:tm.start()], sole_ok=True)]
    if am and _DEFINITIVE.search(t):
        return [(s, "definitive", price) for s in _target_syms(t[am.end():], sole_ok=False)]
    # A deal-worded, non-speculative headline: confirms an ALREADY pending deal only.
    return [(s, "confirm", price) for s in syms]


def _ro(path: str):
    if not path or not os.path.exists(path):
        return None
    uri = "file:" + path.replace("\\", "/") + "?mode=ro"
    return sqlite3.connect(uri, uri=True, timeout=5.0)


def _catalyst_db() -> str:
    return os.environ.get("CATALYST_NEWS_DB_PATH") or os.path.join(_data_dir(), "catalyst_news.db")


def _company_db() -> str:
    return os.environ.get("COMPANY_NEWS_DB_PATH") or os.path.join(_data_dir(), "company_news.db")


_LIKE_TERMS = ("%acqui%", "%merger%", "%tender offer%", "%take private%", "%taken private%",
               "%buyout%", "%to buy %", "%delist%", "%terminat%", "%per share%")


def _parse_day(s) -> date | None:
    if s is None or s == "":
        return None
    if isinstance(s, (int, float)):
        try:
            return datetime.fromtimestamp(float(s), timezone.utc).date()
        except (OverflowError, OSError, ValueError):
            return None
    txt = str(s).strip()
    try:
        return datetime.fromisoformat(txt.replace("Z", "+00:00")).date()
    except ValueError:
        pass
    m = re.match(r"(\d{4})-?(\d{2})-?(\d{2})", txt)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    return None


def stored_headlines(since: date) -> list:
    """[(day, title, [tickers])] of deal-worded headlines the app already stored, oldest
    first. Read-only; a missing or unreadable store contributes nothing (logged)."""
    out: list = []
    # catalyst engine's 48-hour working set
    try:
        c = _ro(_catalyst_db())
        if c is not None:
            with contextlib.closing(c):
                where = " OR ".join(["lower(title) LIKE ?"] * len(_LIKE_TERMS))
                for title, tp, seen, tj in c.execute(
                        f"SELECT title, time_published, first_seen_at, tickers_json FROM news_items "
                        f"WHERE {where}", _LIKE_TERMS):
                    day = _parse_day(tp) or _parse_day(seen)
                    try:
                        tickers = json.loads(tj or "[]")
                    except (TypeError, ValueError):
                        tickers = []
                    if day and day >= since:
                        out.append((day, title or "", tickers))
    except Exception as exc:  # noqa: BLE001
        _log.warning("[deal-status] catalyst news read failed: %s", exc)
    # persistent company-news store
    try:
        c = _ro(_company_db())
        if c is not None:
            with contextlib.closing(c):
                where = " OR ".join(["lower(i.headline) LIKE ?"] * len(_LIKE_TERMS))
                rows = c.execute(
                    f"SELECT i.headline, i.published_at, group_concat(t.ticker) FROM news_items i "
                    f"JOIN news_tickers t ON t.news_id = i.id "
                    f"WHERE i.published_at >= ? AND i.reject_reason = '' AND ({where}) "
                    f"GROUP BY i.id", (since.isoformat(), *_LIKE_TERMS)).fetchall()
                for title, pub, tick in rows:
                    day = _parse_day(pub)
                    if day:
                        out.append((day, title or "", [x for x in (tick or "").split(",") if x]))
    except Exception as exc:  # noqa: BLE001
        _log.warning("[deal-status] company news read failed: %s", exc)
    out.sort(key=lambda r: r[0])
    return out


def fold_news(headlines) -> dict:
    """{sym: {active, since, price, last_confirm, ended}} from dated headlines (oldest
    first). A definitive headline starts (or re-confirms) a deal; a confirm headline only
    refreshes an active one; an end headline closes it."""
    deals: dict = {}
    for day, title, tickers in sorted(headlines, key=lambda r: r[0]):
        for sym, kind, price in parse_headline(title, tickers):
            d = deals.get(sym)
            if kind == "definitive":
                if d is None or not d["active"]:
                    d = deals[sym] = {"active": True, "since": day, "price": None,
                                      "last_confirm": day, "ended": None, "headline": title}
                d["last_confirm"] = max(d["last_confirm"], day)
                if price is not None:
                    d["price"] = price
            elif kind == "confirm":
                if d is not None and d["active"]:
                    d["last_confirm"] = max(d["last_confirm"], day)
                    if price is not None and d["price"] is None:
                        d["price"] = price
            elif kind == "end":
                if d is not None and d["active"] and day >= d["since"]:
                    d["active"] = False
                    d["ended"] = day
    return deals


# ---------------------------------------------------------------------------
# 3. Price behaviour
# ---------------------------------------------------------------------------

def _norm_bars(bars) -> list:
    out = []
    for b in bars or []:
        if isinstance(b, dict):
            out.append((b.get("t"), float(b["o"]), float(b["h"]), float(b["l"]), float(b["c"])))
        else:
            out.append((b[0], float(b[1]), float(b[2]), float(b[3]), float(b[4])))
    return out


def _bar_day(t) -> str | None:
    try:
        ti = int(t)
    except (TypeError, ValueError):
        return None
    if 19000101 <= ti <= 29991231:
        s = str(ti)
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    try:
        return datetime.fromtimestamp(ti, timezone.utc).date().isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def price_pinned(bars, deal_price=None):
    """The deal-pin read of daily `bars` (oldest first; {t,o,h,l,c} dicts or (t,o,h,l,c,..)
    tuples), or None when the chart does not look pinned. Geometry only:
      * a gap of GAP_MIN+ (open vs prior close) in the last GAP_LOOKBACK sessions, at least
        PIN_SESSIONS sessions ago (the latest such gap is the one judged);
      * the whole post-gap stretch within POST_GAP_RANGE_MAX, which is below GAP_MIN, so a gap
        that filled can never pass;
      * the last PIN_SESSIONS sessions within PIN_RANGE_MAX, and their mean true range under
        PIN_ATR_MAX of the last close.
    `near_deal_price` is None without a deal price, else whether the last close sits in
    DEAL_PRICE_BAND of it."""
    b = _norm_bars(bars)
    n = len(b)
    if n < PIN_SESSIONS + 2:
        return None
    last_c = b[-1][4]
    if last_c <= 0:
        return None
    win = b[-PIN_SESSIONS:]
    rng = max(x[2] for x in win) / min(x[3] for x in win) - 1.0
    if rng >= PIN_RANGE_MAX:
        return None
    trs = []
    for i in range(n - 14, n):
        _, _, h, l, _ = b[i]
        pc = b[i - 1][4]
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    atr = sum(trs) / len(trs) / last_c
    if atr >= PIN_ATR_MAX:
        return None
    lo = max(1, n - GAP_LOOKBACK)
    for g in range(n - PIN_SESSIONS, lo - 1, -1):
        pc = b[g - 1][4]
        if pc <= 0:
            continue
        gap = b[g][1] / pc - 1.0
        if abs(gap) < GAP_MIN:
            continue
        post = b[g:]
        hi = max(x[2] for x in post)
        low = min(x[3] for x in post)
        if hi / low - 1.0 > POST_GAP_RANGE_MAX:
            return None            # drifted, or the gap filled: not a deal pin
        near = None
        if deal_price:
            near = DEAL_PRICE_BAND[0] * deal_price <= last_c <= DEAL_PRICE_BAND[1] * deal_price
        return {"gap_date": _bar_day(b[g][0]), "gap_pct": round(gap * 100, 2),
                "sessions_since_gap": n - g, "range_pct": round(rng * 100, 3),
                "atr_pct": round(atr * 100, 3), "last_close": last_c, "near_deal_price": near}
    return None


def _bars_for(sym: str) -> list:
    from api.services import bars_sqlite
    return bars_sqlite.get_bars(sym, "D", PRICE_BARS) or []


# ---------------------------------------------------------------------------
# The merged answer, cached per day
# ---------------------------------------------------------------------------

_LOCK = threading.Lock()
_STATE: dict = {}
_SYM_CACHE: dict = {}


def reset_cache() -> None:
    with _LOCK:
        _STATE.clear()
        _SYM_CACHE.clear()


def _snapshot() -> dict:
    """{day, hand, mirror, news} for today, rebuilt at most every _refresh_s()."""
    today = _today()
    now = time.time()
    with _LOCK:
        if _STATE.get("day") == today and now - _STATE.get("built", 0) < _refresh_s():
            return _STATE["snap"]
    snap = {"day": today, "hand": hand_deals(), "mirror": mirror_list(),
            "news": fold_news(stored_headlines(today - timedelta(days=NEWS_LOOKBACK_DAYS)))}
    with _LOCK:
        if _STATE.get("snap") is not snap:
            _SYM_CACHE.clear()
        _STATE.update(day=today, built=now, snap=snap)
    return snap


def _not_pending(sym: str) -> dict:
    return {"sym": sym, "pending": False, "possible": False, "source": [], "since": None,
            "price": None, "confidence": 0.0}


def _delisted(sym: str) -> bool:
    try:
        from api.services import delisted_registry
        return bool(delisted_registry.is_delisted(sym))
    except Exception:  # noqa: BLE001
        return False


def _compute(sym: str, snap: dict, bars) -> dict:
    out = _not_pending(sym)
    src: list = []
    conf = 0.0
    if sym in snap["hand"]:
        src.append("hand_list")
        conf = CONF_HAND
    if sym in snap["mirror"]:
        src.append("pc_exclude_mirror")
        conf = CONF_HAND
    deal = snap["news"].get(sym)
    if deal is not None and deal["active"] and _delisted(sym):
        deal = None
    if deal is not None and deal["active"]:
        out["since"] = deal["since"].isoformat()
        out["price"] = deal["price"]
    pin = None
    try:
        pin = price_pinned(bars if bars is not None else _bars_for(sym),
                           deal_price=deal["price"] if deal and deal["active"] else None)
    except Exception as exc:  # noqa: BLE001
        _log.warning("[deal-status] price read failed for %s: %s", sym, exc)
    if deal is not None and deal["active"]:
        fresh = (snap["day"] - deal["last_confirm"]).days <= _news_max_age_days()
        corroborated = bool(pin) and pin.get("near_deal_price") is not False
        if fresh or corroborated:
            src.append("news")
            if corroborated:
                src.append("price_pinned")
            conf = max(conf, CONF_NEWS_PRICE if (fresh and corroborated)
                       else CONF_NEWS if fresh else CONF_NEWS_STALE_PRICE)
        else:
            out["since"] = out["price"] = None
    if pin and not src:
        out["possible"] = True
        src.append("price_pinned")
        conf = CONF_PRICE_ONLY
        out["since"] = pin["gap_date"]
    if pin:
        out["pin"] = pin
    out["source"] = src
    out["confidence"] = conf
    out["pending"] = conf >= PENDING_MIN_CONFIDENCE
    if out["pending"] and out["since"] is None and pin:
        out["since"] = pin["gap_date"]
    return out


def deal_status(sym: str, bars=None) -> dict:
    """{sym, pending, possible, source, since, price, confidence[, pin]} for `sym`.
    `pending` is the only field a consumer hides things on. Never raises: an error is
    NOT pending (logged). `bars` (daily, oldest first) skips the bar read; tests pass it."""
    s = (sym or "").upper().strip()
    if not s:
        return _not_pending(s)
    try:
        snap = _snapshot()
        key = (snap["day"], s)
        if bars is None:
            with _LOCK:
                hit = _SYM_CACHE.get(key)
            if hit is not None:
                return dict(hit)
        res = _compute(s, snap, bars)
        if bars is None:
            with _LOCK:
                _SYM_CACHE[key] = res
        return dict(res)
    except Exception as exc:  # noqa: BLE001 -- fail safe: never hide a chart on a bug
        _log.warning("[deal-status] %s failed, treating as not pending: %s", s, exc)
        return _not_pending(s)


def pending_deal_symbols() -> frozenset:
    """Every symbol that is `pending` today: hand lists, fresh news deals, and old news
    deals still confirmed by a price pin. Price behaviour alone never adds a name (it is
    never pending). Never raises: an error yields the hand lists alone (logged)."""
    try:
        snap = _snapshot()
        out = set(snap["hand"]) | set(snap["mirror"])
        for sym, d in snap["news"].items():
            if d["active"] and sym not in out and deal_status(sym)["pending"]:
                out.add(sym)
        return frozenset(out)
    except Exception as exc:  # noqa: BLE001
        _log.warning("[deal-status] pending set failed, hand lists only: %s", exc)
        return hand_deals() | mirror_list()


def screener_excludes() -> frozenset:
    """The screener's buyout exclude set. Flag OFF: the hand list file alone, exactly as
    `screener_universe.buyout_excludes` read it before this module. Flag ON: that file (all of
    it, its non-deal owner excludes included) plus every pending symbol."""
    if not enabled():
        return hand_list()
    return hand_list() | pending_deal_symbols()


def chart_marker(sym: str):
    """The small marker a chart shows instead of its pattern drawings, or None. None while
    DEAL_STATUS_ENABLED is off or the symbol is not pending. Never raises."""
    if not enabled():
        return None
    st = deal_status(sym)
    if not st.get("pending"):
        return None
    return {"pending": True, "label": CHART_LABEL, "source": list(st["source"]),
            "since": st.get("since"), "price": st.get("price"),
            "confidence": st.get("confidence")}


# ---------------------------------------------------------------------------
# Consumers that PICK names to show (scans, leaders, notable picks, grades)
# ---------------------------------------------------------------------------

#: What a member sees in place of a grade, a pick or a scan row for a pending target.
PENDING_LABEL = "Pending acquisition"


def _norm(sym) -> str:
    """One spelling for a comparison: upper case, class shares with a hyphen (BRK.B -> BRK-B)."""
    return str(sym or "").strip().upper().replace(".", "-").replace("/", "-")


def consumer_pending() -> frozenset:
    """The pending set a candidate-picking consumer excludes, in `_norm` spelling.

    Flag OFF: empty WITHOUT consulting anything (every consumer byte-identical to before).
    Flag ON: `pending_deal_symbols()`, the one shared answer. Any error: empty, logged
    (fail safe: a bug excludes nothing)."""
    if not enabled():
        return frozenset()
    try:
        return frozenset(_norm(s) for s in pending_deal_symbols() if s)
    except Exception as exc:  # noqa: BLE001
        _log.warning("[deal-status] consumer pending set failed, excluding nothing: %s", exc)
        return frozenset()


def is_pending(sym, pending=None) -> bool:
    """True when `sym` is a pending acquisition for a consumer. `pending` is a set a caller
    already read with `consumer_pending()` (one read per run); None reads it now."""
    p = consumer_pending() if pending is None else pending
    return bool(p) and _norm(sym) in p


def definitive_target(sym, headline) -> bool:
    """True when `headline` announces a DEFINITIVE agreement with `sym` as the TARGET (the
    same parser the news source uses). Rumours, talks, bids and the acquirer's side are
    False. Never raises: an error is False (logged)."""
    s = _norm(sym)
    if not s or not headline:
        return False
    try:
        return any(k == "definitive" and _norm(x) == s
                   for x, k, _p in parse_headline(str(headline), [s]))
    except Exception as exc:  # noqa: BLE001
        _log.warning("[deal-status] headline read failed for %s: %s", s, exc)
        return False
