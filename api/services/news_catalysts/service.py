"""News & Catalysts feed orchestrator for ONE symbol.

Merges three ALREADY-collected sources into a newest-first event list — no
per-view LLM call:
  1. Historical significant catalysts (YTD-2026) — AI-generated ONCE per stock
     (both directions) via significant_catalysts.generate, cached in store.
  2. Earnings events — earnings_estimates.get_chart_markers (beat/miss + surprise),
     direction from the report-day price reaction when available.
  3. Breaking wire tweets — tweet_store.tweets_for_ticker (curated accounts,
     polled every ~2 min pre/post-market) — the fast after-hours signal.

Unified event: {date, type:'catalyst'|'earnings'|'breaking', direction:'up'|'down'
|'neutral', title, description, move_pct?, source, url?, ts}.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from datetime import date as _date, datetime, timedelta, timezone
from urllib.parse import quote_plus, urlparse

from api.services import significant_catalysts
from api.services.cache import cache
from api.services.news_catalysts import store

_logger = logging.getLogger(__name__)

HIST_PERIOD = "ytd2026_v10"  # v10 = drop vague 'moved on optimism' non-catalysts
YTD_LO = "2026-01-01"

_MODEL = os.environ.get("NEWS_LLM_MODEL") or os.environ.get("MODELBOOK_LLM_MODEL", "claude-sonnet-4-6")
_TWEET_HOURS = int(os.environ.get("NEWS_TWEET_WINDOW_HOURS", "48") or 48)
# Only the real news WIRES carry breaking catalysts — not the lower-signal
# aggregator/retail accounts the tweet store also ingests (AIStockSavvy,
# markflowchatter, faststocknewss…). Owner ask: "just the main news wires."
# Env-overridable (comma-separated handles, with/without @).
_DEFAULT_WIRE_ACCOUNTS = "deitaone,financialjuice,benzinga,wallstengine,firstsquawk,livesquawk"
_RETRY_AFTER = int(os.environ.get("NEWS_CATALYSTS_RETRY_AFTER", "86400") or 86400)
# A failed LOOK is not a finished look. When the web leg never answered (429 /
# timeout / bad shape) the symbol is eligible again in minutes, not a day.
_ERROR_RETRY_AFTER = int(os.environ.get("NEWS_CATALYSTS_ERROR_RETRY_AFTER", "1800") or 1800)
# How long a fallback-only ("ai", pre-cutoff) set may stand before we try once
# more to replace it with a web-grounded one. Bounded by _RETRY_AFTER on top,
# so at worst one upgrade attempt per symbol per day.
_UPGRADE_AFTER = int(os.environ.get("NEWS_CATALYSTS_UPGRADE_AFTER", str(6 * 3600)) or 6 * 3600)
_DAILY_CAP = int(os.environ.get("NEWS_CATALYSTS_DAILY_CAP", "300") or 300)  # generations/day (per process)
_MAX_HIST_ITEMS = 12          # a bit more coverage (was 8)
_HIST_TOP_N = 20              # candidate big-move days fed to the LLM (was 12)
_MAX_BREAKING = 40            # pre-dedup pool; dedup + relevance trims it
_HIST_TTL = 6 * 3600
_LIVE_TTL = 120
_RECENT_TTL = 20 * 60        # last-10-days catalyst layer refresh (near-real-time)
_EST_COST_PER_GEN = 0.02  # ~900 Sonnet out-tokens; for the cost log only

# Single-process generate-once dedupe + daily cap (matches the web pod's one-uvicorn
# assumption, like modelbook/awareness — see CLAUDE.md single-process invariants).
_gen_lock = threading.Lock()
_generating: set[str] = set()
_gen_day: str | None = None
_gen_count = 0


def _enabled() -> bool:
    return os.environ.get("NEWS_CATALYSTS_ENABLED", "1") == "1"


def _web_enabled() -> bool:
    return os.environ.get("NEWS_WEB_SEARCH_ENABLED", "1") == "1"


_CITE_MARK = re.compile(r"\[(\d+)\]")


def _strip_cites(text):
    """Remove Perplexity's inline [N] citation markers + tidy whitespace."""
    if not text:
        return text
    t = _CITE_MARK.sub("", text)
    return re.sub(r"\s{2,}", " ", t).replace(" .", ".").strip()


def _pick_citation(desc, citations):
    """Map a catalyst's own [N] markers → its specific source url (not a global one)."""
    if not citations:
        return None
    for m in _CITE_MARK.finditer(desc or ""):
        idx = int(m.group(1)) - 1
        if 0 <= idx < len(citations):
            return citations[idx]
    return None


def _domain_label(url):
    """finance.yahoo.com → 'yahoo', tikr.com → 'tikr' — a short source badge."""
    try:
        host = urlparse(url).netloc.lower()
        if host.startswith("www."):
            host = host[4:]
        parts = host.split(".")
        return parts[-2] if len(parts) >= 2 else (host or None)
    except Exception:
        return None


def _catalyst_link(raw_desc, citations, sym, title):
    """(source_label, url) for a web catalyst. Prefer the catalyst's OWN citation
    (badge = its domain); otherwise a web search for the exact event so the link is
    ALWAYS clickable (badge = 'web')."""
    cite = _pick_citation(raw_desc, citations)
    if cite:
        return (_domain_label(cite) or "web"), cite
    return "web", f"https://www.google.com/search?q={quote_plus(f'{sym} {title}')}"


def _looks_like_earnings(title, desc):
    """Earnings reports are covered by the real FMP earnings layer — exclude them
    from the web catalysts (avoids duplicates AND hallucinated 'Q2 beat' events)."""
    blob = f" {title or ''} {desc or ''} ".lower()
    return ("earnings" in blob or " eps " in blob
            or "quarterly result" in blob or "quarterly report" in blob)


_VAGUE_MARKERS = (
    "no company-specific", "no specific news", "no specific catalyst", "no fundamental",
    "no material news", "no new company", "no clear catalyst", "profit-taking", "profit taking",
    "took profits", "risk-off", "risk-on", "rotation out", "rotating out", "high-beta",
    "investor enthusiasm", "growing enthusiasm", "increased optimism", "growing optimism",
    "renewed optimism", "broad optimism", "general optimism", "sector-specific sentiment",
    "improved sentiment", "positive sentiment", "momentum names", "aggressive buying",
    "buying interest", "bargain hunting", "short covering", "increased volatility",
    "heightened volatility",
)


def _is_vague_move(title, desc):
    """Drop 'catalysts' that just DESCRIBE a price move with no specific event —
    'surged on optimism', 'sold off on profit-taking', 'no company-specific news',
    'high-beta risk-off'. The owner only wants concrete, named catalysts."""
    blob = f" {title or ''} {desc or ''} ".lower()
    return any(k in blob for k in _VAGUE_MARKERS)


def _shorten(text, limit=240):
    """Trim a long wire-tweet body to ~a couple sentences (the full text stays one
    click away via the source link). Prefers a sentence end, else a word boundary."""
    if not text or len(text) <= limit:
        return text
    cut = text[:limit]
    dot = cut.rfind(". ")
    if dot >= limit * 0.5:
        return cut[:dot + 1]
    sp = cut.rfind(" ")
    return (cut[:sp] if sp > 0 else cut).rstrip(" ,;:-") + "…"


def _web_catalysts(sym, company, bars, movers, *, outcome=None):
    """Perplexity → structured JSON of REAL, web-sourced 2026 catalysts.

    Perplexity IS web-grounded, so it directly knows the actual events + dates
    (NBIS's Meta/NVIDIA/Eigen deals; META's excess-compute cloud headline). We ask
    it for JSON directly — NOT via a second, pre-cutoff model that would over-omit.
    CRITICAL: date each event to when it ACTUALLY happened (do NOT anchor to the
    stock's move-days — that mis-dates catalysts). Returns (items, None).

    `outcome` is an optional OUT-dict carrying WHY nothing came back —
    `{"ok": False, "kind": "disabled"|"error"|"empty"}` — taken from the same
    evaluation that produced the answer, never inferred by the caller from the
    shape of a `None`. `"error"` means we never got a usable answer out of the
    provider; `"empty"` means it answered and had nothing to report. Those two
    deserve different retry windows, and collapsing them is what let a 429
    masquerade as a finished look."""
    def _out(ok, kind=None, reason=None):
        if outcome is not None:
            outcome.clear()
            outcome.update({"ok": ok, "kind": kind, "reason": reason})

    _out(False, "error", "not_started")
    if not _web_enabled():
        _out(False, "disabled")
        return None, None
    try:
        from api.services import perplexity_search
    except Exception as exc:
        _out(False, "error", f"import failed: {exc}")
        return None, None
    label = f"{sym} ({company}) stock" if company else f"{sym} stock"
    query = (
        f"Search the web for the most significant COMPANY-SPECIFIC catalysts and news events for "
        f"{label} during 2026 (January 1 to today). Cover: major customer/partner/contract deals, "
        f"strategic investments or funding rounds, mergers & acquisitions, notable institutional "
        f"stake disclosures, product/platform launches, regulatory or FDA events, analyst rating "
        f"or price-target changes, and standalone guidance updates. "
        f"Do NOT include quarterly or annual EARNINGS reports/results — those are shown "
        f"separately.\n\n"
        f"Return ONLY a JSON object (no prose, no markdown fences):\n"
        f'{{"catalysts": [{{"date": "YYYY-MM-DD", "title": "<3-7 word headline>", '
        f'"description": "<one factual sentence with the specifics>", "direction": "up" or "down"}}]}}\n'
        f"Be COMPREHENSIVE — most active stocks had SEVERAL catalysts this year; return as many "
        f"real ones as you can find (up to {_MAX_HIST_ITEMS}), not just the top two or three, "
        f"most recent first. Also include sector/policy events that specifically moved THIS stock "
        f"(e.g. an import ban or ruling that hit its industry). "
        f"CRITICAL: `date` MUST be the REAL date the event actually happened or was announced "
        f"(the article/press-release date) — NOT a later date the stock moved. Verify each date "
        f"against its source. Only real, verifiable events that materially moved the stock — no "
        f"generic market/macro items, no price targets, no advice."
    )
    system = ("You are a financial news researcher. Search the web and output ONLY the requested "
              "JSON of real, sourced, company-specific stock catalysts. Every date must be the "
              "ACTUAL date the event occurred, verified against its source. No preamble, no "
              "markdown, no commentary.")
    try:
        res = perplexity_search.web_search(query, max_tokens=1600, system=system,
                                           mode="fast", domain_pack="finance")
    except Exception as exc:
        _logger.warning("news_catalysts web catalysts failed for %s: %s", sym, exc)
        return None, None
    answer = (res.get("answer") or "").strip()
    if res.get("error") or not answer:
        # `web_search` returns transport failures IN-BAND (never raises), so a
        # 429/timeout arrives here as `error` — the exact case that must not
        # be remembered as "nothing to report".
        _out(False, "error", str(res.get("error") or "empty answer"))
        return None, None
    s, e = answer.find("{"), answer.rfind("}")
    if s == -1 or e == -1:
        return None, None
    try:
        raw = (json.loads(answer[s:e + 1]).get("catalysts")) or []
    except Exception:
        return None, None
    citations = res.get("citations") or []

    # Phase-1 preliminaries (titles/descriptions; the bulk call's dates are often
    # sloppy — a focused per-catalyst query fixes them below).
    prelim = []
    for it in raw[:_MAX_HIST_ITEMS]:
        title = (it.get("title") or "").strip()
        raw_desc = (it.get("description") or "").strip()
        if not title or significant_catalysts._is_uncertain(title, raw_desc):
            continue
        if _looks_like_earnings(title, raw_desc) or _is_vague_move(title, raw_desc):
            continue
        prelim.append({
            "title": title, "raw_desc": raw_desc,
            "rough_date": str(it.get("date") or "").strip()[:10],
            "direction": (it.get("direction") or "").strip().lower(),
        })
    if not prelim:
        return None, None

    # Phase 2: verify each catalyst's REAL announcement date with a FOCUSED query
    # (a single bulk request mis-dates; a targeted question is accurate — as the
    # owner observed). Parallel + bounded.
    verified = _verify_dates(sym, company, prelim)

    trading_days = sorted({str(b["t"])[:10] for b in bars if b.get("t")})
    day_set = set(trading_days)
    bar_idx = _build_bar_index(bars)
    hi = _today_iso()
    items = []
    for i, p in enumerate(prelim):
        real = verified[i] or p["rough_date"]
        d = significant_catalysts.snap_trading_day(real, trading_days, day_set, lo=YTD_LO, hi=hi, max_gap=3)
        if not d:
            continue
        mp = None
        direction = p["direction"]
        bar = bar_idx.get(d)
        if bar and bar.get("c") is not None:
            base = bar.get("_prev_c") or bar.get("o")
            if base:
                mp = round((bar["c"] - base) / base * 100, 1)
                direction = "up" if mp >= 0 else "down"
        if direction not in ("up", "down"):
            direction = "up"
        clean_title = _strip_cites(p["title"])[:90]
        src, url = _catalyst_link(p["raw_desc"], citations, sym, clean_title)
        items.append({
            "date": d, "title": clean_title,
            "description": (_strip_cites(p["raw_desc"])[:400]) or None,
            "move_pct": mp, "direction": direction, "sort_order": i,
            "source": src, "url": url,
        })
    return (items or None), None


_MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
_ISO_RE = re.compile(r"(20\d\d)-(\d{2})-(\d{2})")
_MDY_RE = re.compile(
    r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d\d)\b", re.I)
_DMY_RE = re.compile(
    r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(20\d\d)\b", re.I)


def _extract_iso_date(text):
    """First date in `text` as YYYY-MM-DD — handles ISO AND natural-language forms
    ('May 18, 2026', '18 May 2026') so a prose Perplexity answer still yields a date."""
    if not text:
        return None
    m = _ISO_RE.search(text)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = _MDY_RE.search(text)
    if m:
        mo = _MONTHS.get(m.group(1)[:3].lower())
        if mo:
            return f"{m.group(3)}-{mo:02d}-{int(m.group(2)):02d}"
    m = _DMY_RE.search(text)
    if m:
        mo = _MONTHS.get(m.group(2)[:3].lower())
        if mo:
            return f"{m.group(3)}-{mo:02d}-{int(m.group(1)):02d}"
    return None


def _verify_dates(sym, company, prelim):
    """Focused Perplexity query per catalyst → its exact YYYY-MM-DD announcement
    date (returns None for that item on failure). Parallel, bounded. Gated by
    NEWS_VERIFY_DATES (default on)."""
    if os.environ.get("NEWS_VERIFY_DATES", "1") != "1":
        return [None] * len(prelim)
    try:
        from api.services import perplexity_search
    except Exception:
        return [None] * len(prelim)
    label = f"{sym} ({company})" if company else sym

    def _one(p):
        q = (f'On exactly what calendar date was this news FIRST released/announced for '
             f'{label}: "{p["title"]}". {p["raw_desc"]} '
             f'Give the original announcement/press-release/article date (the day the news '
             f'first broke — NOT a later date the stock moved or a filing "as of" date). '
             f'Answer with ONLY that date as YYYY-MM-DD. If you cannot determine it, answer NONE.')
        try:
            res = perplexity_search.web_search(q, max_tokens=120, mode="fast", domain_pack="finance")
        except Exception:
            return None
        d = _extract_iso_date(res.get("answer") or "")
        # Guard against a nonsense parse: keep it within the YTD window.
        if d and YTD_LO <= d <= _today_iso():
            return d
        return None

    try:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=5, thread_name_prefix="news-datever") as ex:
            return list(ex.map(_one, prelim))
    except Exception:
        return [None] * len(prelim)


# ── Breaking-tweet helpers: headline split, relevance filter, near-dup dedup ──
_CASHTAG = re.compile(r"\$([A-Za-z]{1,6})\b")
_URL = re.compile(r"https?://\S+")
_STOP = {
    "update", "exclusive", "breaking", "alert", "said", "says", "sources", "source",
    "with", "from", "that", "this", "have", "will", "they", "been", "about", "would",
    "could", "their", "into", "after", "over", "more", "than", "amid", "what", "when",
    "were", "also", "just", "your", "which", "while",
}


def _fmt_usd(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    a = abs(n)
    if a >= 1e12: return f"${n / 1e12:.2f}T"
    if a >= 1e9:  return f"${n / 1e9:.2f}B"
    if a >= 1e6:  return f"${n / 1e6:.1f}M"
    if a >= 1e3:  return f"${n / 1e3:.0f}K"
    return f"${n:.2f}"


def _eps_fmt(v):
    try:
        return f"{float(v):.2f}"
    except (TypeError, ValueError):
        return str(v)


def _split_headline(text):
    """(headline, body): the bold headline is just the lead line; the rest is detail.
    Wire posts pack a full story into one tweet — show only the headline bold."""
    t = (text or "").strip()
    t = re.sub(r"^(?:[\U0001F000-\U0001FAFF -➿←-⇿\s•\-])+", "", t)
    t = re.sub(r"^(UPDATE|EXCLUSIVE|BREAKING|ALERT|JUST IN)\s*:?\s*", "", t, flags=re.I).strip()
    if not t:
        return (text or "").strip(), None
    cuts = []
    for pat in (r"\s[-–—]\s\$", r"👉", r"\shttps?://", r"\n", r"\s▶", r"\bKey Highlights\b", r"\bWhy This Matters\b"):
        m = re.search(pat, t)
        if m:
            cuts.append(m.start())
    # An ALL-CAPS lead: cut where the caps run gives way to a Title/lower-case word.
    m = re.match(r"^([A-Z0-9$&.,'\"%()\-/ ]{14,}?)(?=[A-Z][a-z])", t)
    if m:
        cuts.append(m.end())
    # Otherwise the first real sentence break.
    m = re.search(r"(?<=[a-z])\.\s+(?=[A-Z])", t)
    if m:
        cuts.append(m.end() - 1)
    cut = min([c for c in cuts if c >= 14], default=None)
    if cut:
        head = t[:cut].strip(" -–—:•").strip()
        body = t[cut:].strip(" -–—:•👉▶").strip()
        return (head or t), (body or None)
    return t, None


def _cashtags(text):
    out, seen = [], set()
    for m in _CASHTAG.finditer(text or ""):
        tk = m.group(1).upper()
        if tk not in seen:
            seen.add(tk)
            out.append(tk)
    return out


def _tweet_relevant(text, sym, headline):
    """Keep a tweet only when the stock is a real SUBJECT, not one of many tickers
    name-dropped in a roundup (owner ask: don't show a post just because $SYM appears).

    The hard case is a multi-ticker post. Two kinds look identical by cashtag count:
      • "AMAZON $AMZN TOPS $3T … joining $MSFT $AAPL"  → about AMZN; MSFT is a passer-by
      • "US drafting ban on China datacenter gear - $AAOI $COHR $LITE $CIEN"  → a POLICY
        event that genuinely hits EVERY listed name (owner: this is the one we were missing)
    The distinguisher is the HEADLINE: if it names ANOTHER ticker, the post is about that
    company; if it names no ticker (a general/policy headline), it's relevant to all."""
    sym = sym.upper()
    tags = _cashtags(text)
    if len(tags) <= 1:
        return True                                   # single subject
    hl = headline or ""
    if re.search(rf"\${re.escape(sym)}\b", hl, re.I):
        return True                                   # this stock is IN the headline
    if any(re.search(rf"\${re.escape(tk)}\b", hl, re.I) for tk in tags if tk != sym):
        return False                                  # a DIFFERENT stock owns the headline
    if tags and tags[0] == sym:
        return True                                   # leads the cashtag list
    # No ticker in the headline → a general/sector/policy event affecting every listed
    # name. Keep it, but guard against a giant movers-roundup dump.
    return len(tags) <= 10


def _sig_words(text):
    t = _URL.sub("", text or "")
    t = _CASHTAG.sub("", t)
    return {w for w in re.findall(r"[a-z]{4,}", t.lower()) if w not in _STOP}


def _jaccard(a, b):
    if not a or not b:
        return 0.0
    union = len(a | b)
    return (len(a & b) / union) if union else 0.0


def _dedup_breaking(pairs):
    """Collapse near-duplicate wire posts (same story, different accounts), keeping
    the EARLIEST (fastest) one. pairs = [(event, sig_words)]."""
    kept = []
    for ev, words in pairs:
        merged = False
        for k in kept:
            if _jaccard(words, k["words"]) >= 0.55:
                if ev["ts"] < k["ev"]["ts"]:
                    k["ev"], k["words"] = ev, words   # keep the earlier one
                merged = True
                break
        if not merged:
            kept.append({"ev": ev, "words": words})
    return [k["ev"] for k in kept]


def _today_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _date_ts(date_str: str) -> int:
    """Epoch (UTC noon) for a 'YYYY-MM-DD' — a stable sort key for dated events."""
    try:
        return int(datetime.fromisoformat(f"{date_str[:10]}T12:00:00").replace(tzinfo=timezone.utc).timestamp())
    except Exception:
        return 0


def _daily_bars_since(sym: str, lo: str = YTD_LO) -> list:
    """2026-YTD daily bars via the in-process bars path (same parse modelbook uses).

    Depth is sized to `lo`. Asking 5000 for a YTD window crossed
    `_DEEP_REQUEST_THRESHOLD` and took the synchronous full-history backfill
    path — 4-31s per symbol in production, paid inside the Catalysts tab's
    own request."""
    try:
        from api.services import bars_fetch
        resp = bars_fetch._get_bars_inner(sym, "D", bars_fetch.daily_bars_needed_since(lo))
        body = getattr(resp, "body", None)
        data = json.loads(body) if body is not None else (resp if isinstance(resp, dict) else {})
        bars = [b for b in data.get("bars", []) if str(b.get("t", "")) >= lo]
        bars.sort(key=lambda b: b.get("t", ""))
        return bars
    except Exception as exc:
        _logger.warning("news_catalysts bars fetch failed for %s: %s", sym, exc)
        return []


def _build_bar_index(bars: list) -> dict:
    """date → bar (+ `_prev_c` prior close) for report-day reaction lookups."""
    idx = {}
    prev_c = None
    for b in bars:
        t = str(b.get("t", ""))[:10]
        if not t:
            continue
        rec = dict(b)
        rec["_prev_c"] = prev_c
        idx[t] = rec
        if b.get("c") is not None:
            prev_c = b.get("c")
    return idx


def _historical_events(sym: str) -> list:
    out = []
    for it in store.get_catalysts(sym, HIST_PERIOD):
        d = it.get("catalyst_date")
        if not d:
            continue
        mp = it.get("move_pct")
        direction = it.get("direction") or ("down" if (mp is not None and mp < 0) else "up")
        out.append({
            "date": d, "type": "catalyst", "direction": direction,
            "title": it.get("title"), "description": it.get("description"),
            "move_pct": mp, "source": it.get("source") or "ai",
            "url": it.get("url"), "ts": _date_ts(d),
        })
    return out


def _pct_paren(v):
    """+366% / -5% in parentheses for the abbreviated chart lines (None → '')."""
    if v is None:
        return ""
    try:
        n = round(float(v))
    except (TypeError, ValueError):
        return ""
    return f" ({'+' if n >= 0 else ''}{n}%)"


def _earnings_events(sym: str, bar_idx: dict) -> list:
    out = []
    try:
        from api.services import earnings_estimates
        markers = earnings_estimates.get_chart_markers(sym) or {}
    except Exception as exc:
        _logger.warning("news_catalysts earnings fetch failed for %s: %s", sym, exc)
        return out

    # Ordered trading days (from the bar index) so we can anchor to the REACTION day.
    dates = sorted(bar_idx.keys())
    pos = {d: i for i, d in enumerate(dates)}

    def _move_at(i):
        if i < 0 or i >= len(dates):
            return None
        b = bar_idx.get(dates[i])
        if not b or b.get("c") is None:
            return None
        base = b.get("_prev_c") or b.get("o")
        if not base:
            return None
        return round((b["c"] - base) / base * 100, 1)

    def _reaction(d0):
        """The trading day the stock actually REACTED to the print. A pre-market/BMO
        report reacts intraday on the report day; an after-close/AMC report reacts the
        NEXT session (e.g. BLZE reports after close → the gap lands on the following
        candle). We don't get a BMO/AMC flag from the provider, so infer it from price:
        of {report day, next trading day} take the bigger single-day move, biased
        slightly toward the report day so a mere continuation day never steals the
        anchor. Returns (reaction_date, reaction_move_pct)."""
        import bisect
        i0 = pos.get(d0)
        if i0 is None:
            j = bisect.bisect_left(dates, d0)
            if j >= len(dates):
                return d0, None          # report in the future — no bar yet
            i0 = j                        # report day wasn't a session → its next one
        m0 = _move_at(i0)
        m1 = _move_at(i0 + 1)
        if m1 is not None and (m0 is None or abs(m1) > abs(m0) + 0.5):
            return dates[i0 + 1], m1
        return dates[i0], m0

    for e in (markers.get("earnings") or []):
        d0 = str(e.get("date") or "")[:10]
        if not d0 or d0 < YTD_LO:
            continue
        # Anchor the marker to the reaction day (not the raw report day).
        d, move = _reaction(d0)
        direction = ("up" if move >= 0 else "down") if move is not None else None
        beat = e.get("beat")
        if direction is None:
            direction = "up" if beat else "down" if beat is False else "neutral"
        fq, fy = e.get("fiscal_quarter"), e.get("fiscal_year")
        qlabel = f"Q{fq} FY{fy} " if fq and fy else ""
        # Title Case (owner ask): "Q2 FY2026 Earnings — Beat".
        verdict = "Beat" if beat else "Miss" if beat is False else "Report"
        title = f"{qlabel}Earnings — {verdict}".strip()
        # Full highlights (widget dropdown) — EPS, revenue, surprise, reaction.
        details = []
        if e.get("eps_actual") is not None:
            eps = f"EPS {_eps_fmt(e['eps_actual'])}"
            if e.get("eps_estimate") is not None:
                eps += f" vs {_eps_fmt(e['eps_estimate'])} est"
            details.append(eps)
        rev_a = _fmt_usd(e.get("revenue_actual"))
        if rev_a:
            rev = f"Revenue {rev_a}"
            rev_e = _fmt_usd(e.get("revenue_estimate"))
            if rev_e:
                rev += f" vs {rev_e} est"
            details.append(rev)
        eps_sp = e.get("eps_surprise_pct", e.get("surprise"))
        if eps_sp is not None:
            details.append(f"{'+' if eps_sp >= 0 else ''}{eps_sp}% EPS surprise")
        if move is not None:
            details.append(f"{'+' if move >= 0 else ''}{move}% earnings reaction")
        # Abbreviated lines for the ON-CHART marker's second line (owner ask):
        #   - EPS 0.08 (+366%)
        #   - REV $42.7M (+7%)
        chart_lines = []
        if e.get("eps_actual") is not None:
            chart_lines.append(f"EPS {_eps_fmt(e['eps_actual'])}{_pct_paren(eps_sp)}")
        if rev_a:
            chart_lines.append(f"REV {rev_a}{_pct_paren(e.get('revenue_surprise_pct'))}")
        out.append({
            "date": d, "type": "earnings", "direction": direction,
            "title": title,
            # Inline (wide) shows the two headline stats; the dropdown shows all details.
            "description": "; ".join(details[:2]) or None,
            "details": details or None,
            "chart_lines": chart_lines or None,
            # PRICE reaction only — NEVER the EPS surprise (a tiny estimate makes that a
            # nonsense % like -168%). None until the reaction day's daily bar completes.
            "move_pct": move,
            "source": "earnings", "url": None, "ts": _date_ts(d),
        })
    return out


def _breaking_events(sym: str) -> list:
    out = []
    try:
        from api.services import tweet_store
        rows = tweet_store.tweets_for_ticker(sym, hours=_TWEET_HOURS)
    except Exception as exc:
        _logger.warning("news_catalysts tweets fetch failed for %s: %s", sym, exc)
        return out
    wires = _wire_accounts()
    pairs = []
    for t in rows[:_MAX_BREAKING]:
        ts = t.get("created_at")
        text = (t.get("text") or "").strip()
        if not ts or not text:
            continue
        # Wire-only: drop the tweet store's lower-signal aggregator/retail accounts.
        handle = (t.get("author_handle") or "").lstrip("@")
        if wires and handle.lower() not in wires:
            continue
        head, body = _split_headline(text)
        # Relevance: skip a post that only name-drops this ticker among many.
        if not _tweet_relevant(text, sym, head):
            continue
        # Drop vague "moved on optimism" non-events even from a wire.
        if _is_vague_move(head or text, body or ""):
            continue
        d = datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m-%d")
        ev = {
            "date": d, "type": "breaking", "direction": "neutral",
            "title": head or text,          # bold headline only — full body goes to `description`
            "description": _shorten(body),  # cap giant wire dumps; full text via the source link
            "move_pct": None, "source": f"@{handle}", "url": t.get("url"), "ts": int(ts),
        }
        pairs.append((ev, _sig_words(text)))
    deduped = _dedup_breaking(pairs)                # collapse same story → keep earliest
    deduped.sort(key=lambda e: e["ts"], reverse=True)
    return deduped


def _hist_and_earnings(sym: str) -> list:
    """Cached (6h) historical catalysts + earnings, deduped. Invalidated when a
    fresh generation lands."""
    ck = f"news_hist_{sym}"
    cached = cache.get(ck)
    if cached is not None:
        return cached
    bar_idx = _build_bar_index(_daily_bars_since(sym))
    hist = _historical_events(sym)
    earn = _earnings_events(sym, bar_idx)
    # Dedup: an AI catalyst within ±1 day of an earnings event → drop it (earnings
    # is the dated, factual anchor for that move).
    earn_days = set()
    for e in earn:
        try:
            earn_days.add(_date.fromisoformat(e["date"]))
        except Exception:
            pass

    def near_earnings(dstr):
        try:
            dd = _date.fromisoformat(dstr)
        except Exception:
            return False
        return any(abs((dd - ed).days) <= 1 for ed in earn_days)

    combined = [h for h in hist if not near_earnings(h["date"])] + earn
    cache.set(ck, combined, ttl=_HIST_TTL)
    return combined


def _breaking_enabled() -> bool:
    # ON by default: the curated news-WIRE layer is the fast real-time signal for
    # breaking sector/policy catalysts (e.g. a Reuters China datacenter-ban wire)
    # that Perplexity's index lags on. Kill with NEWS_BREAKING_ENABLED=0.
    return os.environ.get("NEWS_BREAKING_ENABLED", "1") == "1"


def _wire_accounts() -> set:
    """The allowlisted news-wire handles (lowercased, no @). Only these carry
    breaking catalysts; the tweet store's aggregator/retail accounts are dropped."""
    raw = os.environ.get("NEWS_WIRE_ACCOUNTS", _DEFAULT_WIRE_ACCOUNTS)
    return {h.strip().lower().lstrip("@") for h in raw.split(",") if h.strip()}


def _recent_enabled() -> bool:
    return os.environ.get("NEWS_RECENT_ENABLED", "1") == "1" and _web_enabled()


def _recent_catalysts(sym):
    """Near-real-time layer: a web search scoped to the LAST ~10 DAYS so TODAY's
    catalyst (e.g. the optical stocks gapping on a policy headline) shows up — the
    cached year-history can't. Uses each event's REAL date as-is (no snapping — a
    today-dated catalyst has no completed bar yet). Cached ~20 min by the caller."""
    if not _recent_enabled():
        return []
    try:
        from api.services import perplexity_search
    except Exception:
        return []
    bars = _daily_bars_since(sym)
    query = (
        f"Why is {sym} stock moving today, and what specific news has driven it over the last day "
        f"or two? Search the live web including this morning's headlines. Name the EXACT catalyst "
        f"behind any gap or spike — it may be a company event (deal, investment, contract, M&A, "
        f"product, analyst action, guidance, stake) OR an INDUSTRY / POLICY / REGULATORY development "
        f"affecting {sym} and its sector (e.g. a tariff, an import/export ban, or a government "
        f"ruling — such as a report that the U.S. is drafting a ban on Chinese data-center or "
        f"optical hardware). Do NOT include routine quarterly earnings reports, and do NOT include "
        f"vague 'moved on optimism/sentiment/profit-taking' items with no concrete catalyst.\n\n"
        f'Return ONLY JSON: {{"catalysts": [{{"date": "YYYY-MM-DD", "title": "<3-7 word headline>", '
        f'"description": "<one factual sentence naming the specific catalyst and source>", '
        f'"direction": "up" or "down"}}]}} — up to 6, most recent first. Use the REAL date each was '
        f"reported. Only real, verifiable events with a concrete named catalyst and a source."
    )
    system = ("You are a real-time financial news researcher. Search the live web (including "
              "today's breaking headlines) and output ONLY the requested JSON of real, recent "
              "catalysts — company-specific AND sector/policy events — with accurate dates. No preamble.")
    try:
        # recency="day" scopes to the LAST 24H so TODAY's driver isn't competing with a
        # week of news for the slots (the reason a 3-hour-old policy headline was missed);
        # general web so any source that broke it is reachable.
        res = perplexity_search.web_search(query, max_tokens=1000, system=system, mode="fast",
                                           recency="day", domain_pack="general")
    except Exception as exc:
        _logger.warning("news_catalysts recent failed for %s: %s", sym, exc)
        return []
    answer = (res.get("answer") or "").strip()
    if res.get("error") or not answer:
        return []
    a, b = answer.find("{"), answer.rfind("}")
    if a == -1 or b == -1:
        return []
    try:
        raw = (json.loads(answer[a:b + 1]).get("catalysts")) or []
    except Exception:
        return []
    citations = res.get("citations") or []
    bar_idx = _build_bar_index(bars)
    today = _today_iso()
    lo = (datetime.now(timezone.utc).date() - timedelta(days=14)).isoformat()
    out = []
    for i, it in enumerate(raw[:6]):
        title = (it.get("title") or "").strip()
        raw_desc = (it.get("description") or "").strip()
        if not title or significant_catalysts._is_uncertain(title, raw_desc):
            continue
        if _looks_like_earnings(title, raw_desc) or _is_vague_move(title, raw_desc):
            continue
        d = str(it.get("date") or "").strip()[:10]
        if not _ISO_RE.match(d) or not (lo <= d <= today):
            continue
        mp = None
        direction = (it.get("direction") or "").strip().lower()
        bar = bar_idx.get(d)
        if bar and bar.get("c") is not None:                 # completed session → real reaction
            base = bar.get("_prev_c") or bar.get("o")
            if base:
                mp = round((bar["c"] - base) / base * 100, 1)
                direction = "up" if mp >= 0 else "down"
        if direction not in ("up", "down"):
            direction = "up"
        clean_title = _strip_cites(title)[:90]
        src, url = _catalyst_link(raw_desc, citations, sym, clean_title)
        out.append({
            "date": d, "type": "catalyst", "direction": direction,
            "title": clean_title, "description": _shorten(_strip_cites(raw_desc), 300) or None,
            "move_pct": mp, "source": src, "url": url, "ts": _date_ts(d),
        })
    return out


def _dedup_catalysts(events):
    """Drop duplicate catalyst events (recent layer overlaps the year history) —
    keyed by (date, normalized-title-prefix); keeps the first seen. Earnings +
    breaking pass through untouched."""
    seen = set()
    out = []
    for e in events:
        if e.get("type") != "catalyst":
            out.append(e)
            continue
        key = (e.get("date"), re.sub(r"[^a-z0-9 ]", "", (e.get("title") or "").lower())[:36])
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
    return out


_recent_lock = threading.Lock()
_recent_inflight: set[str] = set()


def _recent_layer(sym):
    """SWR: serve the cached (or last-known) recent catalysts instantly; refresh in
    the BACKGROUND when the 20-min TTL lapses — never a Perplexity call on the
    request path (the 524 threadpool-exhaustion class)."""
    if not _recent_enabled():
        return []
    ck = f"news_recent_{sym}"
    fresh = cache.get(ck)
    if fresh is not None:
        return fresh
    stale = cache.get(f"{ck}_last") or []
    with _recent_lock:
        if sym in _recent_inflight:
            return stale
        _recent_inflight.add(sym)

    def _run():
        try:
            rec = _recent_catalysts(sym)
            cache.set(ck, rec, ttl=_RECENT_TTL)
            cache.set(f"{ck}_last", rec, ttl=24 * 3600)   # stale fallback between refreshes
        except Exception as exc:
            _logger.warning("news_catalysts recent refresh failed for %s: %s", sym, exc)
        finally:
            with _recent_lock:
                _recent_inflight.discard(sym)

    threading.Thread(target=_run, daemon=True, name=f"news-recent-{sym}").start()
    return stale


def _combined(sym: str) -> list:
    events = list(_hist_and_earnings(sym))
    events += _recent_layer(sym)
    if _breaking_enabled():
        live = cache.get(f"news_live_{sym}")
        if live is None:
            live = _breaking_events(sym)
            cache.set(f"news_live_{sym}", live, ttl=_LIVE_TTL)
        events += live
    events = _dedup_catalysts(events)
    events.sort(key=lambda e: e.get("ts", 0), reverse=True)
    return events


def _cost_ok() -> bool:
    """Per-process daily generation cap (reserve a slot). Returns False when the
    cap is hit so the widget can't run away with LLM spend."""
    global _gen_day, _gen_count
    today = _today_iso()
    with _gen_lock:
        if _gen_day != today:
            _gen_day, _gen_count = today, 0
        if _DAILY_CAP > 0 and _gen_count >= _DAILY_CAP:
            return False
        _gen_count += 1
        return True


def _generate_and_store(sym: str) -> None:
    """Synchronous: generate YTD-2026 significant catalysts (both directions) for
    `sym` and persist them, or stamp an attempt when nothing is produced. Runs on
    a background thread via _gen_async; called directly in tests."""
    sym = sym.upper()
    try:
        if not _enabled():
            return
        if not _cost_ok():
            store.mark_attempt(sym, HIST_PERIOD)
            return
        bars = _daily_bars_since(sym)
        if not bars:
            store.mark_attempt(sym, HIST_PERIOD)
            return
        # PRIMARY: Perplexity web search returns the REAL catalysts directly (it knows
        # the actual 2026 events). FALLBACK: from-memory generation when Perplexity is
        # unavailable (produces less — the model is pre-cutoff).
        web_oc: dict = {}
        items, _cite = _web_catalysts(sym, None, bars, None, outcome=web_oc)
        if not items:
            gen = significant_catalysts.generate(
                sym, None, bars, "2026 YTD", direction="both",
                model=_MODEL, max_items=_MAX_HIST_ITEMS, top_n=_HIST_TOP_N, enabled=True,
                trading_bounds=(YTD_LO, _today_iso()),
            )
            if gen:
                bar_idx = _build_bar_index(bars)
                for it in gen:
                    bar = bar_idx.get(it.get("date"))
                    if bar and bar.get("c") is not None:
                        base = bar.get("_prev_c") or bar.get("o")
                        if base:
                            mv = round((bar["c"] - base) / base * 100, 1)
                            it["move_pct"] = mv
                            it["direction"] = "up" if mv >= 0 else "down"
                    it["source"] = "ai"
            items = gen
        if items:
            store.replace_catalysts(sym, HIST_PERIOD, items)
            cache.invalidate(f"news_hist_{sym}")
            store.log_cost(sym, _MODEL, _EST_COST_PER_GEN)
            if web_oc.get("kind") == "error":
                # Persisted, but from the pre-cutoff fallback because the web
                # leg never answered. `source='ai'` marks it PROVISIONAL and
                # `needs_generation` will come back for it — the reader gets a
                # feed now instead of a spinner, and the real one later.
                _logger.info("news_catalysts %s stored from FALLBACK (web %s)",
                             sym, web_oc.get("reason"))
        else:
            # Nothing at all. Say WHY, so a 429 is not remembered for a day as
            # "this company has no catalysts".
            store.mark_attempt(sym, HIST_PERIOD,
                               kind="error" if web_oc.get("kind") == "error" else None)
    except Exception as exc:
        _logger.warning("news_catalysts generation failed for %s: %s", sym, exc)
        try:
            store.mark_attempt(sym, HIST_PERIOD, kind="error")
        except Exception:
            pass


def _gen_async(sym: str) -> None:
    sym = sym.upper()
    with _gen_lock:
        if sym in _generating:
            return
        _generating.add(sym)

    def _run():
        try:
            _generate_and_store(sym)
        finally:
            with _gen_lock:
                _generating.discard(sym)

    threading.Thread(target=_run, name=f"news-cat-{sym}", daemon=True).start()


def debug_web(sym: str) -> dict:
    """Admin diagnostic: run the web-catalyst search LIVE (no cache) and return what
    Perplexity produced, so we can see whether web grounding is actually working."""
    sym = (sym or "").upper()
    bars = _daily_bars_since(sym)
    movers = significant_catalysts.rank_big_move_days(bars, top_n=_HIST_TOP_N, direction="both") if bars else []
    items, citation = _web_catalysts(sym, None, bars, movers)
    recent = _recent_catalysts(sym)          # LIVE recent-layer result (today's drivers)
    breaking = _breaking_events(sym) if _breaking_enabled() else []   # curated news-wire layer
    return {
        "symbol": sym,
        "web_enabled": _web_enabled(),
        "recent_enabled": _recent_enabled(),
        "breaking_enabled": _breaking_enabled(),
        "wire_accounts": sorted(_wire_accounts()),
        "perplexity_key_set": bool(os.environ.get("PERPLEXITY_API_KEY", "").strip()),
        "bars": len(bars),
        "movers": movers[:12],
        "web_items": items,
        "recent_items": recent,
        "breaking_items": breaking,
        "citation": citation,
        "period": HIST_PERIOD,
    }


def _combined_has_rows(sym: str) -> bool:
    """Is there already a catalyst set on disk for this symbol? Used to keep an
    UPGRADE silent: rows are on screen, so the client must not be told
    "generating" and swap a readable feed for a spinner."""
    try:
        return bool(store.get_catalysts(sym.upper(), HIST_PERIOD))
    except Exception:
        return False


def needs_catalysts(sym: str) -> bool:
    """THE gate — one authority on "does this symbol need a catalyst set?".

    Both callers (the endpoint below and the calendar's warm pass) route
    through this rather than each passing its own copy of the three retry
    knobs to the store; a second copy of a policy is how the warm and the
    click path come to disagree about what is already covered."""
    if not _enabled():
        return False
    store._init_db()
    return store.needs_generation(
        sym.upper(), HIST_PERIOD, _RETRY_AFTER,
        error_retry_after=_ERROR_RETRY_AFTER, upgrade_after=_UPGRADE_AFTER)


def feed(sym: str) -> dict:
    """The endpoint payload: merged events now + a status telling the client whether
    historical catalysts are still generating."""
    sym = (sym or "").upper()
    if not sym:
        return {"symbol": sym, "status": "ready", "events": [], "generated_at": int(time.time())}
    status = "ready"
    if needs_catalysts(sym):
        _gen_async(sym)
        # A PROVISIONAL set being upgraded already has rows on screen — telling
        # the client "generating" would replace a readable feed with a spinner.
        # Only an empty one is genuinely still being written.
        status = "generating" if not _combined_has_rows(sym) else "ready"
    return {"symbol": sym, "status": status, "events": _combined(sym), "generated_at": int(time.time())}
