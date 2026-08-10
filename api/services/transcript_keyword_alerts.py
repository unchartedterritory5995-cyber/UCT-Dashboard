"""Cross-company transcript keyword alerts — "tell me when anyone says 'tariff'".

The Quartr feature this mirrors: a reader follows a THEME rather than a ticker,
and wants to know when it surfaces on any call. Nothing here is new
infrastructure — FMP transcripts are already fetched and cached 30d,
`watchlist_alert_service.deliver_alert_payload` already fans out to AlertBell +
email + Discord, and the atomic-INSERT dedup shape is lifted from
`catalyst.store.try_record_alert`. This module is the join between them.

Gated by TRANSCRIPT_KEYWORD_ALERTS_ENABLED; inert when unset.

The dedup key is (user, keyword, symbol, quarter): you want to hear once that
DIS said "tariff" on the Q3 call, not once per re-scan and not once per mention.
"""
from __future__ import annotations

import contextlib
import logging
import os
import re
import sqlite3
import threading
import time
from typing import Any, Optional

_log = logging.getLogger(__name__)
_WRITE_LOCK = threading.Lock()

DB_PATH = os.environ.get(
    "TRANSCRIPT_ALERTS_DB_PATH",
    os.path.join(os.environ.get("DATA_DIR", "/data"), "transcript_alerts.db"),
)

MAX_KEYWORDS_PER_USER = 25
MIN_KEYWORD_LEN = 3          # "AI" is 2 and would fire on nearly every call
EXCERPT_RADIUS = 90          # characters either side of the hit

_SCHEMA = """
CREATE TABLE IF NOT EXISTS keyword_subs (
  user_id    TEXT NOT NULL,
  keyword    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, keyword)
);
CREATE TABLE IF NOT EXISTS keyword_fired (
  user_id   TEXT NOT NULL,
  keyword   TEXT NOT NULL,
  symbol    TEXT NOT NULL,
  quarter   TEXT NOT NULL,
  fired_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, keyword, symbol, quarter)
);
"""


def _connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.execute("PRAGMA journal_mode=WAL")
    return c


def init_db() -> None:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.executescript(_SCHEMA)
        c.commit()


def enabled() -> bool:
    return os.environ.get("TRANSCRIPT_KEYWORD_ALERTS_ENABLED", "").strip() == "1"


# ── matching (pure, so it can be tested without a DB or a provider) ──────────

def normalize_keyword(raw: str) -> Optional[str]:
    """Trim and lowercase, or None when it isn't worth subscribing to.

    Too-short keywords are refused rather than silently accepted: a 2-character
    term matches on essentially every call, and an alert that always fires is
    indistinguishable from no alert at all.
    """
    kw = re.sub(r"\s+", " ", (raw or "")).strip().lower()
    if len(kw) < MIN_KEYWORD_LEN or len(kw) > 60:
        return None
    return kw


def find_mentions(keyword: str, segments: list[dict]) -> list[dict]:
    """Every mention of `keyword`, with the speaker and a readable excerpt.

    Word-boundary matched, so "tariff" hits "tariffs" only via the caller's own
    phrasing rather than matching inside an unrelated word — and "AI" would not
    match "said" even if the length floor let it through.
    """
    kw = (keyword or "").strip()
    if not kw:
        return []
    pattern = re.compile(r"\b" + re.escape(kw).replace(r"\ ", r"\s+") + r"\w{0,3}\b", re.I)

    out: list[dict] = []
    for i, seg in enumerate(segments or []):
        body = seg.get("content") or ""
        m = pattern.search(body)
        if not m:
            continue
        start = max(0, m.start() - EXCERPT_RADIUS)
        end = min(len(body), m.end() + EXCERPT_RADIUS)
        excerpt = ("…" if start else "") + body[start:end].strip() + ("…" if end < len(body) else "")
        out.append({
            "segment": i,
            "speaker": (seg.get("speaker") or "").strip(),
            "excerpt": excerpt,
            "count": len(pattern.findall(body)),
        })
    return out


# ── subscriptions ────────────────────────────────────────────────────────────

def add_keyword(user_id: str, raw: str) -> Optional[str]:
    kw = normalize_keyword(raw)
    if not kw or not user_id:
        return None
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        n = c.execute("SELECT COUNT(*) FROM keyword_subs WHERE user_id=?",
                      (user_id,)).fetchone()[0]
        if n >= MAX_KEYWORDS_PER_USER:
            return None
        c.execute(
            "INSERT OR IGNORE INTO keyword_subs (user_id, keyword, created_at) VALUES (?,?,?)",
            (user_id, kw, int(time.time())))
        c.commit()
    return kw


def remove_keyword(user_id: str, raw: str) -> bool:
    kw = normalize_keyword(raw)
    if not kw:
        return False
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute("DELETE FROM keyword_subs WHERE user_id=? AND keyword=?",
                        (user_id, kw))
        c.commit()
        return cur.rowcount > 0


def list_keywords(user_id: str) -> list[str]:
    with contextlib.closing(_connect()) as c:
        return [r[0] for r in c.execute(
            "SELECT keyword FROM keyword_subs WHERE user_id=? ORDER BY keyword",
            (user_id,))]


def all_subscriptions() -> dict[str, list[str]]:
    """{keyword: [user_id, ...]} — keyed by keyword so one transcript scan
    serves every subscriber of that term instead of re-scanning per user."""
    out: dict[str, list[str]] = {}
    with contextlib.closing(_connect()) as c:
        for user_id, kw in c.execute("SELECT user_id, keyword FROM keyword_subs"):
            out.setdefault(kw, []).append(user_id)
    return out


def try_record_fire(user_id: str, keyword: str, symbol: str, quarter: str) -> bool:
    """Atomic compare-and-set. True exactly once per (user, keyword, sym, quarter)."""
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        try:
            c.execute(
                "INSERT INTO keyword_fired (user_id, keyword, symbol, quarter, fired_at)"
                " VALUES (?,?,?,?,?)",
                (user_id, keyword, (symbol or "").upper(), quarter or "", int(time.time())))
            c.commit()
            return True
        except sqlite3.IntegrityError:
            return False


# ── the scan ─────────────────────────────────────────────────────────────────

def scan_transcript(symbol: str, transcript: dict, subs: dict[str, list[str]],
                    deliver=None) -> int:
    """Fire alerts for every keyword mentioned in one transcript.

    Returns the number of alerts delivered. Never raises: one bad keyword or one
    failing delivery must not abort the rest of the sweep.
    """
    segments = (transcript or {}).get("segments") or []
    quarter = (transcript or {}).get("quarter") or ""
    if not segments or not subs:
        return 0

    if deliver is None:
        from api.services.watchlist_alert_service import deliver_alert_payload as deliver

    fired = 0
    for keyword, user_ids in subs.items():
        try:
            mentions = find_mentions(keyword, segments)
        except Exception as exc:
            _log.warning("[kw_alerts] match failed for %r: %s", keyword, exc)
            continue
        if not mentions:
            continue
        total = sum(m["count"] for m in mentions)
        first = mentions[0]
        for user_id in user_ids:
            if not try_record_fire(user_id, keyword, symbol, quarter):
                continue
            try:
                deliver(
                    user_id=user_id,
                    sym=symbol.upper(),
                    title=f"{symbol.upper()} mentioned “{keyword}” on the {quarter} call",
                    message=(f"{first['speaker']}: {first['excerpt']}"
                             if first["speaker"] else first["excerpt"]),
                    source="transcript_keyword",
                    extra_data={
                        "keyword": keyword, "quarter": quarter,
                        "mentions": total, "turns": len(mentions),
                        "segment": first["segment"],
                    },
                )
                fired += 1
            except Exception as exc:
                _log.warning("[kw_alerts] delivery failed %s/%s: %s", user_id, symbol, exc)
    return fired


def run_scan_via_index(since: str = None, deliver=None, index=None,
                       subs: dict = None) -> dict:
    """Scan the WHOLE indexed corpus for every subscribed keyword.

    The calendar-driven scan reaches at most 45 symbols a day — `engine.
    _normalize_earnings` caps each reporter bucket at 15 — which on a heavy day
    is a fraction of the tape, and the module comment below has said so since it
    was written. The transcript index now holds ~1,500 calls with full-text
    search, so the coverage problem is already solved; this just points the
    alerts at it.

    It also inverts the work. The old shape fetched N transcripts and matched
    every keyword against each. This runs ONE indexed query per keyword — the
    number of subscribed keywords, not the number of companies that reported —
    so cost scales with what people actually asked for.

    Dedup is unchanged: `try_record_fire` on (user, keyword, symbol, quarter)
    is what stops a re-scan from re-alerting, so a wider net cannot mean
    repeat notifications.
    """
    if not enabled():
        return {"skipped": "disabled"}
    if index is None:
        from api.services import transcript_index as index
    if subs is None:
        subs = all_subscriptions()
    if not subs:
        return {"keywords": 0, "fired": 0, "note": "no subscriptions"}
    if deliver is None:
        from api.services.watchlist_alert_service import deliver_alert_payload as deliver

    if since is None:
        import datetime
        # A day back, not "today": a call at 16:30 ET publishes its transcript
        # ~2h later, and a same-day-only window would miss every one of them on
        # the run that matters most.
        since = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()

    fired = 0
    scanned = 0
    for keyword, user_ids in subs.items():
        try:
            res = index.search(keyword, limit=200, since=since)
        except Exception as exc:
            _log.warning("[kw_alerts] index search failed for %r: %s", keyword, exc)
            continue
        hits = res.get("hits") or []
        scanned += len(hits)
        for hit in hits:
            symbol = (hit.get("symbol") or "").upper()
            quarter = f"{hit.get('year')}Q{hit.get('quarter')}"
            # The snippet carries <mark> from FTS5; alerts are plain text.
            excerpt = re.sub(r"</?mark>", "", hit.get("snippet") or "").strip()
            for user_id in user_ids:
                if not try_record_fire(user_id, keyword, symbol, quarter):
                    continue
                try:
                    deliver(
                        user_id=user_id,
                        sym=symbol,
                        title=f"{symbol} mentioned “{keyword}” on the {quarter} call",
                        message=excerpt,
                        source="transcript_keyword",
                        extra_data={"keyword": keyword, "quarter": quarter,
                                    "date": hit.get("date"), "via": "index"},
                    )
                    fired += 1
                except Exception as exc:
                    _log.warning("[kw_alerts] delivery failed %s/%s: %s",
                                 user_id, symbol, exc)
    return {"keywords": len(subs), "hits": scanned, "fired": fired, "since": since}


# `engine.get_earnings()` returns THREE buckets, not two. At the 18:30 ET scan
# the one that matters most is `amc_tonight` — companies that reported after
# today's close, whose transcripts publish ~2h later. Reading only bmo+amc would
# have scanned yesterday's news and missed tonight's entirely.
#
# ⚠️ KNOWN BOUND: each bucket is capped at 15 in `engine._normalize_earnings`,
# so this covers at most 45 symbols/day. On a heavy earnings day that is a
# fraction of the tape. Fuller coverage means a reporter source that isn't
# capped for display purposes — tracked as a follow-up, not silently assumed.
_REPORTER_BUCKETS = ("bmo", "amc", "amc_tonight")


def reporters_from_earnings(earnings: dict) -> list[str]:
    """Every symbol in every reporter bucket, deduped, order preserved."""
    out: list[str] = []
    for bucket in _REPORTER_BUCKETS:
        for row in ((earnings or {}).get(bucket) or []):
            if not isinstance(row, dict):
                continue
            sym = (row.get("sym") or "").upper().strip()
            if sym and sym not in out:
                out.append(sym)
    return out


def run_scan(symbols: list[str], fetch=None) -> dict[str, Any]:
    """Scan each symbol's newest transcript against every subscription.

    Cheap by construction: FMP transcripts are uncapped and cached 30d, so a
    re-scan of a symbol already read today costs nothing at the provider.
    """
    if not enabled():
        return {"skipped": "disabled"}
    init_db()
    subs = all_subscriptions()
    if not subs:
        return {"scanned": 0, "fired": 0, "keywords": 0}

    if fetch is None:
        from api.services.fmp_transcripts import get_transcript as fetch

    scanned = fired = 0
    for sym in symbols or []:
        try:
            t = fetch(sym)
        except Exception as exc:
            _log.warning("[kw_alerts] transcript fetch failed for %s: %s", sym, exc)
            continue
        if not t or not t.get("segments"):
            continue
        scanned += 1
        fired += scan_transcript(sym, t, subs)
    return {"scanned": scanned, "fired": fired, "keywords": len(subs)}
