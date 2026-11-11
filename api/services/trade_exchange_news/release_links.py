"""Original press-release links for TX-PressRelease headlines -- resolved in the
background, stored once, read as a dictionary lookup.

Trade Exchange's webhook carries the headline only (no URL, no embed, no extra
key: 0 of 637 press releases on 2026-11-01). The link is FOUND afterwards, from
sources UCT already has, and only when it can be VERIFIED:

  1. FMP wire records already in the company-news store (read-only, never
     written): exact headline + same ticker + one unique wire URL + publish time
     within 30 min of TX arrival + a URL slug that spells the headline.
  2. SEC EDGAR (free, the repo's fair-access client and declared User-Agent):
     an 8-K / 6-K accepted near the arrival whose Exhibit 99 opens with the exact
     headline, for the issuer named in the headline's symbol slot.

⛔ NOTHING IS GUESSED. A link is the URL of the record that matched -- FMP's own
``url`` or the EDGAR document we fetched -- never assembled from a pattern.
Anything weaker (close wording, a ticker disagreement, two candidate URLs, a
non-wire source) is written to ``release_link_candidates`` for accuracy review
and is never displayed. Enabling a weaker tier is a code change made after its
sampled accuracy is shown.

⭐ OFF THE DELIVERY PATH. Headlines are stored and published exactly as before;
this runs on its own thread, after company-news polls, and the only thing a
read does is ``lookup(event_id)`` -- a dict get. A link found later reaches open
widgets as a ``link`` SSE event.

⭐ PERMANENT, WRITE-ONCE. ``release_links`` is keyed by the TX event id and a
row is never replaced or deleted: FMP rows age out of company news (rejected
rows after 7 days), so the verified URL is kept here. The headline archive
(``headlines`` / ``deliveries``) is only read. The table lives in
``trade_exchange_news.db``, so the nightly snapshot already covers it.

⏱ TIMESTAMP CONTRACT (company news owns ``published_at``). FMP sends Eastern
wall-clock times without a zone and company news currently stores them as if
they were UTC (4-5 h early). Until that is fixed upstream, a candidate's time
is read BOTH ways -- as stored, and as an America/New_York wall clock (DST
aware) -- and must ALSO be bracketed by our own ``ingested_at`` (true UTC), so
neither the current reading nor a corrected one can pass a stale record.
"""
from __future__ import annotations

import html as _html
import json
import logging
import re
import sqlite3
import threading
import time
import zlib
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable
from urllib.parse import unquote, urlparse
from zoneinfo import ZoneInfo

from api.services.trade_exchange_news import config

logger = logging.getLogger(__name__)

SOURCE = "TX-PressRelease"
VERSION = 1
ET = ZoneInfo("America/New_York")

KIND_ORIGINAL = "original_release"
KIND_SEC = "sec_filing"

#: Accepted tiers. Everything else is shadow-only.
TIER_FMP_EXACT = "fmp_exact_ticker"
TIER_SEC_EXACT = "sec_exhibit_exact"

MIN = 60_000
FMP_TIME_MS = 30 * MIN            # FMP publish time vs TX arrival
SHORT_TIME_MS = 15 * MIN          # tighter for headlines of <= SHORT_WORDS words
SHORT_WORDS = 5
FMP_WINDOW_MS = 48 * 60 * MIN     # keep looking in FMP this long after arrival
#: SEC attempts, measured from arrival. The first waits past FMP's p90 (16 min)
#: so a wire link is found first wherever FMP has one.
SEC_DELAYS_MS = (45 * MIN, 2 * 60 * MIN, 6 * 60 * MIN, 24 * 60 * MIN, 72 * 60 * MIN)
SEC_RETRY_MS = 15 * MIN           # after a transport error
SEC_MAX_ATTEMPTS = 8
SEC_WINDOW = (-3 * 60 * MIN, 72 * 60 * MIN)   # acceptance time vs arrival
SEC_FORMS = frozenset({"8-K", "8-K/A", "6-K", "6-K/A"})
SEC_TITLE_CHARS = 3000            # how much of the exhibit is read
#: Where the exact headline must START in the normalized document to count as the
#: release itself. Measured on the 163 SEC matches of 2026-11-01: 156 start within
#: 400. Deeper matches are shadow-only (``sec_exhibit_deep``).
SEC_TITLE_HEAD = 800
#: Only a filing accepted within 6 h of the headline is ever LINKED. A later filing
#: with the exact headline (a combined release, a highlights bullet, a recap) may
#: be a different release, and text alone cannot always tell: it is shadow-only
#: (``sec_late_exact``). 4 of the 2026-11-01 SEC-only links were later than 6 h.
SEC_LINK_MAX_MS = 6 * 60 * MIN
SEC_MIN_WORDS = 4
SEC_MAX_FILINGS = 4
SEC_MAX_DOCS = 3
SEC_DOC_MAX_BYTES = 3_000_000
SEC_JSON_MAX_BYTES = 12_000_000
SEC_SUB_TTL_S = 600
#: Issuers whose filtered 8-K/6-K list is cached (least recently used evicted).
SEC_SUB_CACHE_MAX = 256
SEC_TICKERS_TTL_S = 24 * 3600
MAX_URL = 1024

#: Wire family -> the hosts its URLs may live on. FMP's ``source_display`` must
#: name the same family as the URL's host (measured 6,442 / 6,442 on 2026-11-01).
WIRE_HOSTS: dict[str, tuple[str, ...]] = {
    "GlobeNewswire": ("globenewswire.com",),
    "Business Wire": ("businesswire.com",),
    "PR Newswire": ("prnewswire.com",),
    "Newsfile": ("newsfilecorp.com",),
    "ACCESS Newswire": ("accessnewswire.com", "accesswire.com"),
}
SEC_HOST = "www.sec.gov"

#: TX press releases lead with the issuer slot: "SYM - ", "SYM, SYM2 - ", "$SYM - ",
#: and -- measured in the 2026-11-01 review, 60+ of 74 'close wording' rows -- symbols
#: repeated or listed with spaces and class suffixes: "APPN APPN - ", "DCOM DCOM-P
#: DCBG - ", "SPGI KMB MGRC OKTA ... - ". Up to 12 symbols of <= 7 characters; the
#: separator before the headline is a dash or colon WITH spaces, so "DCOM-P" stays one.
_SLOT = re.compile(r"^\s*\$?([A-Z][A-Z0-9.\-]{0,6}(?:(?:\s*[,/]\s*|\s+)\$?[A-Z][A-Z0-9.\-]{0,6}){0,11})\s+[-–—:]\s+")
_SLUG_SPLIT = re.compile(r"[^a-z0-9]+")
_SLUG_NOISE = frozenset({"news", "release", "releases", "html", "htm", "en", "home", "aspx", "php"})
_TAGS = re.compile(r"<[^>]+>")
#: Markup whose text is never document text (CSS, scripts, the <head> and its <title>).
_NOISE_OPEN = re.compile(r"(?i)<(script|style|head)\b")
_NOISE_CLOSE = {t: re.compile(rf"(?i)</{t}\b") for t in ("script", "style", "head")}


def _strip_noise(s: str) -> str:
    """Drop <script>/<style>/<head> elements in ONE linear scan. An unclosed one
    keeps the rest of the document as text (a regex scanning ahead for every
    unclosed tag is quadratic: 64 s on a 3 MB document, holding the GIL)."""
    out, i = [], 0
    while True:
        m = _NOISE_OPEN.search(s, i)
        if m is None:
            break
        c = _NOISE_CLOSE[m.group(1).lower()].search(s, m.end())
        if c is None:
            break
        out.append(s[i:m.start()])
        close = s.find(">", c.start())
        i = len(s) if close < 0 else close + 1
    out.append(s[i:])
    return " ".join(out)
_EX99 = re.compile(r"ex[-_]?99|exhibit[-_]?99|ex991|dex99", re.I)


def _norm(s: str) -> str:
    """Company news' own headline folding, after HTML entities are decoded: TX sends
    some headlines entity-encoded ("Floor &amp; Decor", "&quot;Together&quot;")."""
    from api.services.news.dedupe import normalize_headline
    return normalize_headline(_html.unescape(s or ""))


# ── pure helpers ─────────────────────────────────────────────────────────────

def split_slot(content: str) -> tuple[set[str], str]:
    """(issuer symbols from the leading slot, the headline after it)."""
    m = _SLOT.match(content or "")
    if not m:
        return set(), content or ""
    syms = {s.strip().lstrip("$").upper() for s in re.split(r"[\s,/]+", m.group(1)) if s.strip()}
    return syms, content[m.end():]


def _fold(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (name or "").lower())


def wire_family(publisher: str) -> str | None:
    """'GlobeNewsWire' / 'Globe Newswire' -> 'GlobeNewswire'; None if not a wire we link."""
    f = _fold(publisher)
    for fam in WIRE_HOSTS:
        if _fold(fam) == f:
            return fam
    return None


def safe_url(url: Any, hosts: Iterable[str]) -> str | None:
    """The URL unchanged if it is an https link on one of ``hosts`` (or a
    subdomain), with no credentials, port, whitespace or markup; else None."""
    if not isinstance(url, str) or not url or len(url) > MAX_URL:
        return None
    if any(ch.isspace() or ord(ch) < 0x20 or ch in "<>\"'`\\" for ch in url):
        return None
    try:
        p = urlparse(url)
        port = p.port
    except ValueError:
        return None
    if p.scheme != "https" or p.username or p.password or port not in (None, 443):
        return None
    host = (p.hostname or "").lower().rstrip(".")
    if not host or not any(host == h or host.endswith("." + h) for h in hosts):
        return None
    if not p.path or p.path == "/":
        return None
    return url


def slug_overlap(url: str, title_tokens: set[str]) -> float | None:
    """Share of the URL path's words that appear in the headline (None: no words)."""
    toks = [t for t in _SLUG_SPLIT.split(unquote(urlparse(url).path).lower())
            if t and not t.isdigit() and t not in _SLUG_NOISE]
    if not toks:
        return None
    return sum(t in title_tokens for t in toks) / len(toks)


def _iso_ms(iso: str) -> tuple[int | None, bool]:
    """(ms, zone_was_explicit_non_utc)."""
    try:
        d = datetime.fromisoformat((iso or "").replace("Z", "+00:00"))
    except ValueError:
        return None, False
    if d.tzinfo is None:
        return int(d.replace(tzinfo=timezone.utc).timestamp() * 1000), False
    off = d.utcoffset()
    return int(d.timestamp() * 1000), bool(off and off.total_seconds())


def fmp_time_readings(published_at: str) -> list[tuple[str, int]]:
    """Every plausible UTC instant for a stored FMP ``published_at`` (module doc)."""
    ms, explicit = _iso_ms(published_at)
    if ms is None:
        return []
    out = [("stored", ms)]
    if not explicit:
        try:
            wall = datetime.fromisoformat((published_at or "")[:19])
            out.append(("et_wall", int(wall.replace(tzinfo=ET).timestamp() * 1000)))
        except ValueError:
            pass
    return out


def _timed(c: dict[str, Any], tx_ms: int, limit_ms: int) -> tuple[str, int] | None:
    """(reading, delta_ms) when the candidate's time fits, else None."""
    ing, _ = _iso_ms(c.get("ingested_at") or "")
    if ing is None or not (tx_ms - FMP_TIME_MS <= ing <= tx_ms + FMP_WINDOW_MS):
        return None
    best = None
    for name, ms in fmp_time_readings(c.get("published_at") or ""):
        d = ms - tx_ms
        if abs(d) <= limit_ms and (best is None or abs(d) < abs(best[1])):
            best = (name, d)
    return best


def _jaccard_words(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def decide_fmp(tx: dict[str, Any], candidates: list[dict[str, Any]]) -> dict[str, Any]:
    """The FMP verdict for one headline.

    ``tx``: {"ms", "syms", "norm", "tokens"}; candidates: company-news rows
    {"id", "provider", "source_class", "publisher", "url", "headline",
    "published_at", "ingested_at", "tickers"}. Returns
    {"accept": cand | None, "detail": {...}, "shadow": [(tier, cand, score, detail)]}.
    """
    out: dict[str, Any] = {"accept": None, "detail": {}, "shadow": [], "reason": "no_candidate"}
    if not tx["norm"]:
        out["reason"] = "empty_headline"
        return out
    if any(c.get("overflow") for c in candidates):
        out["reason"] = "too_many_identical"       # never unique; nothing to review either
        return out
    short = len(tx["tokens"]) <= SHORT_WORDS
    limit = SHORT_TIME_MS if short else FMP_TIME_MS
    seen: set[tuple] = set()
    exact_ok: dict[str, tuple[dict, tuple[str, int]]] = {}
    for c in candidates:
        key = (c["id"],)
        if key in seen:
            continue
        seen.add(key)
        cn = _norm(c.get("headline") or "")
        ctoks = set(cn.split())
        is_wire = c.get("provider") == "fmp" and c.get("source_class") == "wire"
        timing = _timed(c, tx["ms"], limit)
        share = bool(tx["syms"] & set(c.get("tickers") or ()))
        if cn == tx["norm"]:
            if not is_wire:
                out["shadow"].append(("nonwire_exact", c, 1.0, {}))
                continue
            if timing is None:
                out["shadow"].append(("fmp_exact_time_off", c, 1.0, {}))
                continue
            if not share:
                out["shadow"].append(("fmp_exact_ticker_disagree", c, 1.0, {"reading": timing[0]}))
                continue
            fam = wire_family(c.get("publisher") or "")
            url = safe_url(c.get("url"), WIRE_HOSTS.get(fam, ())) if fam else None
            if url is None:
                out["shadow"].append(("fmp_exact_url_rejected", c, 1.0, {}))
                continue
            so = slug_overlap(url, tx["tokens"])
            if so is not None and so < 0.5:
                out["shadow"].append(("fmp_exact_slug_mismatch", c, so, {}))
                continue
            prev = exact_ok.get(url)
            if prev is None or abs(timing[1]) < abs(prev[1][1]):
                exact_ok[url] = (c, timing)
            continue
        if not (is_wire and share and timing):
            continue
        cont = len(tx["tokens"] & ctoks) / max(1, len(tx["tokens"]))
        jac = _jaccard_words(tx["tokens"], ctoks)
        if max(cont, jac) >= 0.6:
            out["shadow"].append(("fmp_fuzzy_ticker", c, round(max(cont, jac), 3), {"reading": timing[0]}))
    if len(exact_ok) == 1:
        (url, (c, timing)), = exact_ok.items()
        out.update(accept=c, reason="accepted",
                   detail={"url": url, "publisher": wire_family(c["publisher"]), "reading": timing[0],
                           "delta_ms": timing[1]})
    elif len(exact_ok) > 1:
        out["reason"] = "ambiguous"
        for url, (c, timing) in exact_ok.items():
            out["shadow"].append(("fmp_exact_ambiguous", c, 1.0, {"urls": len(exact_ok)}))
    elif out["shadow"]:
        out["reason"] = "shadow_only"
    return out


def exhibit_text(raw: bytes) -> str:
    """The exhibit's opening, normalized like a headline."""
    s = _strip_noise(raw[:SEC_DOC_MAX_BYTES].decode("utf-8", "replace"))
    s = _html.unescape(_TAGS.sub(" ", s))
    return _norm(s)[:SEC_TITLE_CHARS * 2]


def decide_sec_text(tx_norm: str, text: str, head: int = SEC_TITLE_HEAD) -> tuple[str, float] | None:
    """('exact', 1.0) when the headline starts within ``head`` characters of the
    document; ('deep', 1.0) when it appears later in the read part; ('containment',
    share) when >= 90% of its words are in the opening; else None."""
    if not tx_norm:
        return None
    # Whole words only: padded with spaces, the headline never matches inside a
    # longer word ("result" in "results"). ``at`` is the offset in ``text``.
    at = f" {text[:SEC_TITLE_CHARS]} ".find(f" {tx_norm} ")
    if at >= 0 and len(tx_norm.split()) >= SEC_MIN_WORDS:
        return ("exact", 1.0) if at <= head else ("deep", 1.0)
    words = tx_norm.split()
    if len(words) >= 6:
        opening = set(text.split()[:400])
        share = sum(w in opening for w in set(words)) / len(set(words))
        if share >= 0.9:
            return "containment", round(share, 3)
    return None


# ── the persistent side ──────────────────────────────────────────────────────

_SCHEMA = """
CREATE TABLE IF NOT EXISTS release_links (
    event_id        TEXT PRIMARY KEY,           -- the TX event id (headlines.event_id)
    kind            TEXT NOT NULL,              -- original_release | sec_filing
    url             TEXT NOT NULL,
    publisher       TEXT NOT NULL,
    tier            TEXT NOT NULL,
    ref             TEXT NOT NULL DEFAULT '',   -- fmp:<news_id> | sec:<accession>
    form            TEXT NOT NULL DEFAULT '',
    reading         TEXT NOT NULL DEFAULT '',   -- which time reading verified it
    delta_ms        INTEGER,                    -- source time - TX arrival
    verified_at_ms  INTEGER NOT NULL,
    version         INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS release_link_candidates (
    event_id    TEXT NOT NULL,
    source      TEXT NOT NULL,                  -- fmp | sec
    tier        TEXT NOT NULL,
    ref         TEXT NOT NULL,
    score       REAL,
    url         TEXT NOT NULL DEFAULT '',
    publisher   TEXT NOT NULL DEFAULT '',
    detail      TEXT NOT NULL DEFAULT '{}',
    seen_at_ms  INTEGER NOT NULL,
    PRIMARY KEY (event_id, source, tier, ref)
);
CREATE TABLE IF NOT EXISTS release_link_state (
    event_id        TEXT PRIMARY KEY,
    received_at_ms  INTEGER NOT NULL,
    status          TEXT NOT NULL,              -- pending | linked | exhausted
    fmp_passes      INTEGER NOT NULL DEFAULT 0,
    fmp_final       INTEGER NOT NULL DEFAULT 0,
    sec_attempts    INTEGER NOT NULL DEFAULT 0,
    sec_next_ms     INTEGER,
    last_reason     TEXT NOT NULL DEFAULT '',
    updated_ms      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_txn_rls_pending ON release_link_state(status, received_at_ms);
"""

_lock = threading.Lock()
_LINKS: dict[str, dict[str, str]] = {}
COUNTS: dict[str, int] = {}


def _bump(k: str, n: int = 1) -> None:
    with _lock:
        COUNTS[k] = COUNTS.get(k, 0) + n


def _public(kind: str, url: str, publisher: str) -> dict[str, str]:
    return {"kind": kind, "url": url, "publisher": publisher}


def lookup(event_id: str) -> dict[str, str] | None:
    """The verified link for a headline, or None. A dict get; never raises.
    ``TXN_RELEASE_LINKS_DISPLAY_ENABLED`` unset hides every link at once (the
    rollback switch) without touching what is stored."""
    if not event_id or not _LINKS or not config.release_links_display_enabled():
        return None
    return _LINKS.get(event_id)


def ensure_schema(store) -> None:
    store._conn().executescript(_SCHEMA)  # noqa: SLF001 -- same package, own thread-local connection


def load(store, *, create: bool = True) -> int:
    """Fill the in-memory map from the table (boot). ``create=False`` (resolver
    off) never creates the tables: a database that never had links is left
    exactly as it was."""
    c = store._conn()  # noqa: SLF001
    if create:
        ensure_schema(store)
    elif not c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='release_links'").fetchone():
        return 0
    rows = c.execute("SELECT event_id, kind, url, publisher FROM release_links").fetchall()
    with _lock:
        _LINKS.clear()
        for eid, kind, url, pub in rows:
            _LINKS[eid] = _public(kind, url, pub)
    return len(rows)


def _company_news_ro() -> sqlite3.Connection | None:
    try:
        from api.services.news import store as cn_store
        p = Path(cn_store.db_path())
        if not p.exists():
            return None
        c = sqlite3.connect(p.resolve().as_uri() + "?mode=ro", uri=True, timeout=2, check_same_thread=False)
        c.execute("PRAGMA query_only=1")
        return c
    except Exception:  # noqa: BLE001
        _bump("fmp_db_unavailable")
        return None


def _fmp_poll_marker(cn: sqlite3.Connection) -> str:
    try:
        r = cn.execute("SELECT last_ok FROM news_source_health WHERE source='fmp'").fetchone()
        return (r[0] if r else "") or ""
    except sqlite3.Error:
        return ""


#: Extra history below the window when bounding by row id (see _first_id_since).
ID_BOUND_MARGIN_MS = 6 * 60 * MIN
#: More identical headlines than this in one window is never a unique match.
HK_MAX = 200


def _first_id_since(cn: sqlite3.Connection, lo_iso: str) -> int:
    """The first company-news row stored at or after ``lo_iso`` -- a binary search
    over the primary key, ~20 lookups.

    ⚠ INVARIANT IT RELIES ON (company news owns it): ``news_items.id`` is
    AUTOINCREMENT and ``ingested_at`` is stamped when a row is normalized just before
    its insert and never changed after (``store.upsert`` excludes it from UPDATE),
    so the two rise together up to a small batching lag (a row stamped, then
    inserted a little later). The caller subtracts ``ID_BOUND_MARGIN_MS`` for that.

    ⭐ WHAT BREAKS IF IT DOES NOT HOLD: only CLOSE-WORDING shadow candidates (the
    ticker query). Every row with the EXACT headline comes from the headline-key
    query, which is never id-bounded -- so an accepted link, an ambiguity and a
    ticker disagreement never depend on this optimization (tests rail both)."""
    top = cn.execute("SELECT MAX(id) FROM news_items").fetchone()[0] or 0
    a, b = 1, top + 1
    while a < b:
        m = (a + b) // 2
        r = cn.execute("SELECT ingested_at FROM news_items WHERE id>=? ORDER BY id LIMIT 1", (m,)).fetchone()
        if r is not None and r[0] < lo_iso:
            a = m + 1
        else:
            b = m
    return a


def _fmp_candidates(cn: sqlite3.Connection, tx: dict[str, Any]) -> list[dict[str, Any]]:
    """Wire rows sharing a TX symbol, stored near the arrival, plus any row whose
    headline key equals the TX headline (to see ticker disagreements)."""
    from api.services.news.dedupe import headline_key
    lo = datetime.fromtimestamp((tx["ms"] - 6 * 60 * MIN) / 1000, timezone.utc).isoformat()
    hi = datetime.fromtimestamp((tx["ms"] + FMP_WINDOW_MS + 60 * MIN) / 1000, timezone.utc).isoformat()
    cols = "i.id, i.provider, i.source_class, i.source_display, i.url, i.headline, i.published_at, i.ingested_at"
    rows: dict[int, tuple] = {}
    syms = sorted(tx["syms"])[:6]
    if syms:
        marks = ",".join("?" for _ in syms)
        # ``news_id >= first id stored since lo``: without it a ticker with decades of
        # SEC rows is walked whole (prod p90 56 ms -> 0.19 ms, identical results).
        lo_id = datetime.fromtimestamp((tx["ms"] - 6 * 60 * MIN - ID_BOUND_MARGIN_MS) / 1000, timezone.utc).isoformat()
        for r in cn.execute(f"SELECT DISTINCT {cols} FROM news_tickers t JOIN news_items i ON i.id=t.news_id "
                            f"WHERE t.ticker IN ({marks}) AND t.news_id >= ? AND i.provider='fmp' "
                            f"AND i.ingested_at BETWEEN ? AND ? LIMIT 400", [*syms, _first_id_since(cn, lo_id), lo, hi]):
            rows[r[0]] = r
    # The EXACT-headline rows, whatever their ticker and id: the only rows an
    # accepted link, an ambiguity or a ticker disagreement is decided from.
    hk = headline_key(_html.unescape(tx["body"]))
    overflow = False
    if hk:
        exact = cn.execute(f"SELECT {cols} FROM news_items i WHERE i.headline_key=? AND i.ingested_at BETWEEN ? AND ? "
                           f"LIMIT ?", (hk, lo, hi, HK_MAX + 1)).fetchall()
        overflow = len(exact) > HK_MAX
        for r in exact:
            rows[r[0]] = r
    if overflow:
        return [{"overflow": True}]
    if not rows:
        return []
    ids = list(rows)
    tick: dict[int, set[str]] = {i: set() for i in ids}
    for nid, t in cn.execute(f"SELECT news_id, ticker FROM news_tickers WHERE news_id IN ({','.join('?' for _ in ids)})", ids):
        tick[nid].add(t.upper())
    return [{"id": r[0], "provider": r[1], "source_class": r[2], "publisher": r[3], "url": r[4], "headline": r[5],
             "published_at": r[6], "ingested_at": r[7], "tickers": tick[r[0]]} for r in rows.values()]


class SecLookup:
    """EDGAR reads for the SEC stage, through the repo's one fair-access client.
    ``get(url, max_bytes) -> bytes`` is injectable (tests); budgeted per pass."""

    def __init__(self, get: Callable[[str, int], bytes] | None = None, now: Callable[[], float] = time.time):
        self._get = get or _sec_get
        self._now = now
        self._tickers: tuple[float, dict[str, int]] | None = None
        # Only each issuer's filtered 8-K/6-K tuples are kept, never the parsed
        # submissions JSON (about 1 MB each), and at most SEC_SUB_CACHE_MAX issuers.
        self._subs: OrderedDict[int, tuple[float, list[dict[str, Any]]]] = OrderedDict()
        self.budget = 0
        self.requests = 0

    def fetch(self, url: str, max_bytes: int) -> bytes:
        if self.budget <= 0:
            raise BudgetSpent()
        self.budget -= 1
        self.requests += 1
        _bump("sec_requests")
        return self._get(url, max_bytes)

    def ciks(self, syms: Iterable[str]) -> set[int]:
        if self._tickers is None or self._now() - self._tickers[0] > SEC_TICKERS_TTL_S:
            j = json.loads(self.fetch("https://www.sec.gov/files/company_tickers.json", SEC_JSON_MAX_BYTES))
            self._tickers = (self._now(), {str(v["ticker"]).upper(): int(v["cik_str"]) for v in j.values()})
        m = self._tickers[1]
        out = set()
        for s in syms:
            s = s.upper()
            cik = m.get(s) or m.get(s.replace(".", "-")) or m.get(s.replace("-", "."))
            if cik:
                out.add(cik)
        return out

    def filings(self, cik: int) -> list[dict[str, Any]]:
        hit = self._subs.get(cik)
        if hit is not None and self._now() - hit[0] <= SEC_SUB_TTL_S:
            self._subs.move_to_end(cik)
            return hit[1]
        j = json.loads(self.fetch(f"https://data.sec.gov/submissions/CIK{cik:010d}.json", SEC_JSON_MAX_BYTES))
        rc = j.get("filings", {}).get("recent", {})
        out = []
        for i, form in enumerate(rc.get("form", [])):
            if form not in SEC_FORMS:
                continue
            ms, _ = _iso_ms(rc["acceptanceDateTime"][i])
            if ms is None:
                continue
            out.append({"form": form, "accepted_ms": ms, "accession": rc["accessionNumber"][i],
                        "primary": rc["primaryDocument"][i]})
        self._subs[cik] = (self._now(), out)
        self._subs.move_to_end(cik)
        while len(self._subs) > SEC_SUB_CACHE_MAX:
            self._subs.popitem(last=False)
        return out

    def documents(self, cik: int, accession: str, primary: str) -> list[tuple[str, bytes]]:
        base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession.replace('-', '')}"
        idx = json.loads(self.fetch(f"{base}/index.json", SEC_JSON_MAX_BYTES))
        names = [it.get("name", "") for it in idx.get("directory", {}).get("item", [])]
        names = [n for n in names if re.fullmatch(r"[A-Za-z0-9._\-]{1,120}", n) and n.lower().endswith((".htm", ".html", ".txt"))]
        picks = [n for n in names if _EX99.search(n)] or ([primary] if primary in names else [])
        out = []
        for n in picks[:SEC_MAX_DOCS]:
            out.append((f"{base}/{n}", self.fetch(f"{base}/{n}", SEC_DOC_MAX_BYTES)))
        return out


class BudgetSpent(Exception):
    pass


class RedirectRefused(ValueError):
    pass


def _sec_get(url: str, max_bytes: int) -> bytes:
    import urllib.request
    from api.services.fundamentals_pit import sec_client

    class _Capped:
        def __init__(self, resp):
            self._r = resp
            # A gzip body is inflated HERE, capped, and handed on as plain bytes, so
            # the shared client never inflates an unbounded body (a small download
            # must not become an unbounded allocation).
            self._gzip = resp.headers.get("Content-Encoding") == "gzip"
            self.headers = {"Content-Encoding": "identity"} if self._gzip else resp.headers
            # ⛔ NO REDIRECTS. urllib follows them silently; the link we store is the
            # URL we asked for, so the bytes we verified must have come from exactly
            # there -- never from wherever a redirect pointed.
            if resp.geturl() != url:
                resp.close()
                raise RedirectRefused(f"SEC response came from a different URL than requested: {url}")

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            self._r.close()
            return False

        def read(self, *_a):
            body = self._r.read(max_bytes + 1)
            if len(body) > max_bytes:
                raise ValueError("SEC document larger than the cap; refused")
            if self._gzip:
                d = zlib.decompressobj(16 + zlib.MAX_WBITS)
                body = d.decompress(body, max_bytes + 1)
                if len(body) > max_bytes or d.unconsumed_tail:
                    raise ValueError("SEC document larger than the cap once inflated; refused")
            return body

    return sec_client.get_bytes(url, retries=1, timeout=20.0,
                                opener=lambda req, timeout=None: _Capped(urllib.request.urlopen(req, timeout=timeout)))


def sec_issuer_syms(tx: dict[str, Any]) -> set[str]:
    """The issuer: the slot's symbols, else the resolver's only ticker."""
    if tx["slot"]:
        return set(tx["slot"])
    return set(tx["tickers"]) if len(tx["tickers"]) == 1 else set()


def decide_sec(tx: dict[str, Any], sec: SecLookup) -> dict[str, Any]:
    """The SEC verdict. Raises ``BudgetSpent`` / transport errors for a retry."""
    from api.services.fundamentals_pit.sec_client import SecError
    out: dict[str, Any] = {"accept": None, "shadow": [], "reason": "no_issuer"}
    syms = sec_issuer_syms(tx)
    ciks = sec.ciks(syms) if syms else set()
    if not ciks:
        out["reason"] = "issuer_not_in_sec_map" if syms else "no_issuer"
        return out
    if len(ciks) > 1:
        out["reason"] = "issuer_ambiguous"
        return out
    cik = next(iter(ciks))
    lo, hi = tx["ms"] + SEC_WINDOW[0], tx["ms"] + SEC_WINDOW[1]
    try:
        filings = sec.filings(cik)
    except SecError as e:
        if e.status != 404:
            raise
        filings = []
    fl = sorted((f for f in filings if lo <= f["accepted_ms"] <= hi),
                key=lambda f: (f["form"].endswith("/A"), abs(f["accepted_ms"] - tx["ms"])))[:SEC_MAX_FILINGS]
    if not fl:
        out["reason"] = "no_filing_in_window"
        return out
    exact = []
    for f in fl:
        try:
            docs = sec.documents(cik, f["accession"], f["primary"])
        except SecError as e:
            if e.status == 404:
                continue
            raise
        late = f["accepted_ms"] - tx["ms"] > SEC_LINK_MAX_MS
        for url, body in docs:
            v = decide_sec_text(tx["norm"], exhibit_text(body))
            if v is None:
                continue
            if v[0] == "exact" and late:
                v = ("late", 1.0)
            if safe_url(url, (SEC_HOST,)) is None:
                continue
            ref = f"sec:{f['accession']}"
            if v[0] == "exact":
                exact.append((f, url, ref))
                break
            tier = {"deep": "sec_exhibit_deep", "late": "sec_late_exact"}.get(v[0], "sec_containment")
            out["shadow"].append((tier, {"url": url, "ref": ref, "publisher": "SEC EDGAR"}, v[1],
                                  {"form": f["form"], "delta_ms": f["accepted_ms"] - tx["ms"]}))
        if exact:
            break
    if exact:
        f, url, ref = exact[0]
        out.update(accept={"url": url, "ref": ref, "form": f["form"], "delta_ms": f["accepted_ms"] - tx["ms"]},
                   reason="accepted")
    else:
        out["reason"] = "shadow_only" if out["shadow"] else "title_not_in_exhibit"
    return out


class Resolver:
    """One pass = new headlines registered, due FMP checks, due SEC checks."""

    def __init__(self, store, *, sec: SecLookup | None = None, on_link: Callable[[str, dict], None] | None = None,
                 cn_connect: Callable[[], sqlite3.Connection | None] = _company_news_ro,
                 now_ms: Callable[[], int] = lambda: int(time.time() * 1000)):
        self.store, self.sec, self.on_link = store, sec, on_link
        self._cn_connect, self._now = cn_connect, now_ms
        self._marker: str | None = None
        self._seq_mark = 0
        self._hold_ms = 0.0
        self.last: dict[str, Any] = {}
        ensure_schema(store)

    # -- state ----------------------------------------------------------------

    def _register_new(self, now: int) -> int:
        """New press releases since the last pass (seq watermark; the first pass
        of a process reads the whole archive once -- the historical catch-up)."""
        c = self.store._conn()  # noqa: SLF001
        top = c.execute("SELECT COALESCE(MAX(seq), 0) FROM headlines").fetchone()[0]
        if top <= self._seq_mark:
            return 0
        cur = c.execute(
            "INSERT OR IGNORE INTO release_link_state(event_id, received_at_ms, status, sec_next_ms, updated_ms) "
            "SELECT event_id, received_at_ms, 'pending', received_at_ms + ?, ? FROM headlines "
            "WHERE seq > ? AND seq <= ? AND source=?", (SEC_DELAYS_MS[0], now, self._seq_mark, top, SOURCE))
        self._seq_mark = top
        return cur.rowcount or 0

    def _write(self, stmts: list[tuple[str, tuple]]) -> None:
        """State and shadow rows in ONE short transaction: the headline writer
        waits on this lock for a few ms at most, never for a whole pass. The
        longest hold of a pass is reported (``write_ms_max``)."""
        if not stmts:
            return
        t0 = time.perf_counter()
        c = self.store._conn()  # noqa: SLF001
        c.execute("BEGIN IMMEDIATE")
        try:
            for sql, args in stmts:
                c.execute(sql, args)
            c.execute("COMMIT")
        except Exception:
            c.execute("ROLLBACK")
            raise
        finally:
            self._hold_ms = max(self._hold_ms, (time.perf_counter() - t0) * 1000)

    def _tx(self, event_id: str) -> dict[str, Any] | None:
        r = self.store._conn().execute(  # noqa: SLF001
            "SELECT seq, content, received_at_ms, tickers FROM headlines WHERE event_id=?", (event_id,)).fetchone()
        if not r:
            return None
        slot, body = split_slot(r[1])
        try:
            tick = {str(t).upper() for t in json.loads(r[3] or "[]") if isinstance(t, str)}
        except ValueError:
            tick = set()
        n = _norm(body)
        return {"id": event_id, "seq": r[0], "ms": r[2], "slot": slot, "tickers": tick, "syms": slot | tick,
                "body": body, "norm": n, "tokens": set(n.split())}

    @staticmethod
    def _shadow(out: list, eid: str, source: str, items: list, now: int) -> None:
        for tier, cand, score, detail in items:
            ref = cand.get("ref") or f"fmp:{cand.get('id')}"
            out.append(("INSERT OR REPLACE INTO release_link_candidates(event_id, source, tier, ref, score, url, "
                        "publisher, detail, seen_at_ms) VALUES (?,?,?,?,?,?,?,?,?)",
                        (eid, source, tier, ref, score, str(cand.get("url") or "")[:MAX_URL],
                         str(cand.get("publisher") or "")[:64], json.dumps(detail)[:2000], now)))
            _bump(f"shadow_{tier}")

    def _link(self, tx: dict, kind: str, url: str, publisher: str, tier: str, ref: str, form: str,
              reading: str, delta_ms: int | None, now: int) -> bool:
        c = self.store._conn()  # noqa: SLF001
        c.execute("BEGIN IMMEDIATE")
        try:
            cur = c.execute("INSERT OR IGNORE INTO release_links(event_id, kind, url, publisher, tier, ref, form, reading, "
                            "delta_ms, verified_at_ms, version) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                            (tx["id"], kind, url, publisher, tier, ref, form, reading, delta_ms, now, VERSION))
            c.execute("UPDATE release_link_state SET status='linked', last_reason=?, updated_ms=? WHERE event_id=?",
                      (tier, now, tx["id"]))
            c.execute("COMMIT")
        except Exception:
            c.execute("ROLLBACK")
            raise
        if not cur.rowcount:
            return False
        pub = _public(kind, url, publisher)
        with _lock:
            _LINKS[tx["id"]] = pub
        _bump(f"linked_{tier}")
        logger.info("[txn] release link id=%s kind=%s tier=%s", tx["id"], kind, tier)
        if self.on_link and config.release_links_display_enabled():
            try:
                self.on_link(tx["id"], {"seq": tx["seq"], "link": pub})
            except Exception:  # noqa: BLE001 -- a publish fault never undoes a stored link
                pass
        return True

    # -- the pass -------------------------------------------------------------

    def run_pass(self, *, fmp_batch: int = 300, sec_budget: int = 40) -> dict[str, Any]:
        t0 = time.perf_counter()
        self._hold_ms = 0.0
        now = self._now()
        st = {"registered": self._register_new(now), "fmp_checked": 0, "fmp_linked": 0, "sec_checked": 0,
              "sec_linked": 0, "sec_errors": 0, "fmp_ran": False}
        c = self.store._conn()  # noqa: SLF001
        # Each stage has its own switch, read every pass: FMP and SEC are enabled,
        # watched and rolled back independently.
        cn = self._cn_connect() if config.release_links_fmp_enabled() else None
        if not config.release_links_fmp_enabled():
            st["fmp_off"] = True
        elif cn is not None:
            try:
                marker = _fmp_poll_marker(cn)
                fresh_due = marker != self._marker
                # New rows first, then rows past the 48 h window (their last check,
                # which finalizes them), then the least-checked: with more pending
                # rows than the batch, every row is still re-checked in turn.
                rows = c.execute(
                    "SELECT event_id, received_at_ms, fmp_passes FROM release_link_state "
                    "WHERE status='pending' AND fmp_final=0 AND (fmp_passes=0 OR ?) "
                    "ORDER BY (fmp_passes=0) DESC, (received_at_ms<=?) DESC, fmp_passes, received_at_ms DESC LIMIT ?",
                    (1 if fresh_due else 0, now - FMP_WINDOW_MS, fmp_batch)).fetchall()
                st["fmp_ran"] = bool(rows)
                writes: list = []
                for eid, rms, _passes in rows:
                    tx = self._tx(eid)
                    if tx is None:
                        continue
                    v = decide_fmp(tx, _fmp_candidates(cn, tx))
                    st["fmp_checked"] += 1
                    _bump(f"fmp_{v['reason']}")
                    if v["shadow"]:
                        self._shadow(writes, eid, "fmp", v["shadow"], now)
                    final = 1 if now - rms >= FMP_WINDOW_MS else 0
                    if v["accept"] is not None:
                        d = v["detail"]
                        if self._link(tx, KIND_ORIGINAL, d["url"], d["publisher"], TIER_FMP_EXACT,
                                      f"fmp:{v['accept']['id']}", "", d["reading"], d["delta_ms"], now):
                            st["fmp_linked"] += 1
                        continue
                    writes.append(("UPDATE release_link_state SET fmp_passes=fmp_passes+1, fmp_final=?, "
                                   "last_reason=?, updated_ms=? WHERE event_id=? AND status='pending'",
                                   (final, f"fmp:{v['reason']}", now, eid)))
                self._write(writes)
                self._marker = marker
            finally:
                cn.close()
        else:
            st["fmp_db_unavailable"] = True
        if self.sec is not None and config.release_links_sec_enabled():
            self.sec.budget = sec_budget
            # Headlines still on their live schedule go first; the historical
            # catch-up drains behind them with whatever budget is left.
            due = c.execute("SELECT event_id, received_at_ms, sec_attempts FROM release_link_state "
                            "WHERE status='pending' AND sec_next_ms IS NOT NULL AND sec_next_ms<=? "
                            "ORDER BY (received_at_ms>=?) DESC, sec_next_ms LIMIT 50",
                            (now, now - SEC_DELAYS_MS[-1] - 60 * MIN)).fetchall()
            writes = []
            for eid, rms, attempts in due:
                tx = self._tx(eid)
                if tx is None:
                    continue
                try:
                    v = decide_sec(tx, self.sec)
                except BudgetSpent:
                    break
                except Exception as e:  # noqa: BLE001 -- transport: bounded retry
                    st["sec_errors"] += 1
                    _bump("sec_errors")
                    nxt = now + SEC_RETRY_MS if attempts + 1 < SEC_MAX_ATTEMPTS else None
                    writes.append(self._sec_done(eid, attempts + 1, nxt, f"sec:error:{type(e).__name__}", now))
                    continue
                st["sec_checked"] += 1
                _bump(f"sec_{v['reason']}")
                if v["shadow"]:
                    self._shadow(writes, eid, "sec", v["shadow"], now)
                if v["accept"] is not None:
                    a = v["accept"]
                    if self._link(tx, KIND_SEC, a["url"], "SEC EDGAR", TIER_SEC_EXACT, a["ref"], a["form"], "accepted",
                                  a["delta_ms"], now):
                        st["sec_linked"] += 1
                    continue
                n = attempts + 1
                later = [rms + d for d in SEC_DELAYS_MS if rms + d > now]
                permanent = v["reason"] in ("no_issuer", "issuer_not_in_sec_map", "issuer_ambiguous")
                nxt = None if permanent or n >= SEC_MAX_ATTEMPTS or not later else later[0]
                writes.append(self._sec_done(eid, n, nxt, f"sec:{v['reason']}", now))
            self._write(writes)
        # exhausted: FMP finished and every SEC attempt made. With SEC off a row
        # stays pending, so turning SEC on later still reaches it.
        self._write([("UPDATE release_link_state SET status='exhausted', updated_ms=? WHERE status='pending' "
                      "AND fmp_final=1 AND sec_attempts>0 AND sec_next_ms IS NULL", (now,))])
        st["ms"] = round((time.perf_counter() - t0) * 1000, 1)
        st["write_ms_max"] = round(self._hold_ms, 2)
        st["sec_requests"] = self.sec.requests if self.sec else 0
        self.last = st
        _bump("passes")
        if st["fmp_linked"] or st["sec_linked"] or st["registered"]:
            logger.info("[txn] release links pass %s", {k: v for k, v in st.items() if v})
        return st

    @staticmethod
    def _sec_done(eid: str, attempts: int, nxt: int | None, reason: str, now: int) -> tuple[str, tuple]:
        return ("UPDATE release_link_state SET sec_attempts=?, sec_next_ms=?, last_reason=?, updated_ms=? "
                "WHERE event_id=? AND status='pending'", (attempts, nxt, reason, now, eid))


def snapshot(store=None) -> dict[str, Any]:
    out: dict[str, Any] = {"enabled": config.release_links_enabled(), "fmp_enabled": config.release_links_fmp_enabled(),
                           "sec_enabled": config.release_links_sec_enabled(),
                           "display_enabled": config.release_links_display_enabled(),
                           "links_cached": len(_LINKS), "counts": dict(COUNTS),
                           "last_pass": dict(_RESOLVER.last) if _RESOLVER else None}
    if store is not None:
        try:
            c = store._conn()  # noqa: SLF001
            out["by_tier"] = dict(c.execute("SELECT tier, COUNT(*) FROM release_links GROUP BY tier").fetchall())
            out["state"] = dict(c.execute("SELECT status, COUNT(*) FROM release_link_state GROUP BY status").fetchall())
            out["shadow"] = dict(c.execute("SELECT tier, COUNT(DISTINCT event_id) FROM release_link_candidates "
                                           "GROUP BY tier").fetchall())
        except sqlite3.Error:
            pass
    return out


# ── the background thread ────────────────────────────────────────────────────

_RESOLVER: Resolver | None = None
_stop = threading.Event()
_thread: threading.Thread | None = None


def start(pipe) -> None:
    """Load stored links (always: they display even with the resolver off), then
    run the resolver thread when TXN_RELEASE_LINKS_ENABLED=1."""
    global _RESOLVER, _thread, _stop
    try:
        load(pipe.store, create=config.release_links_enabled())
    except Exception:  # noqa: BLE001 -- links are an extra; never block News start
        logger.exception("[txn] release links: load failed")
        return
    if not config.release_links_enabled() or _thread is not None:
        return

    def on_link(event_id: str, ev: dict) -> None:
        pipe.loop.call_soon_threadsafe(pipe.hub.publish, {"type": "link", "epoch": pipe.store.epoch, "id": event_id,
                                                          "seq": ev["seq"], "link": ev["link"]})

    _RESOLVER = resolver = Resolver(pipe.store, sec=SecLookup(), on_link=on_link)
    _stop = halt = threading.Event()

    def loop() -> None:
        halt.wait(config.release_links_start_delay_s())
        while not halt.is_set():
            try:
                resolver.run_pass(fmp_batch=config.release_links_fmp_batch(),
                                   sec_budget=config.release_links_sec_budget())
            except Exception:  # noqa: BLE001
                _bump("pass_errors")
                logger.exception("[txn] release links pass failed")
            halt.wait(config.release_links_interval_s())

    _thread = threading.Thread(target=loop, name="txn-release-links", daemon=True)
    _thread.start()


def stop() -> None:
    global _thread, _RESOLVER
    _stop.set()
    if _thread is not None:
        _thread.join(timeout=5)
    _thread, _RESOLVER = None, None
