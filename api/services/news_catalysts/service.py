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
from datetime import date as _date, datetime, timezone

from api.services import significant_catalysts
from api.services.cache import cache
from api.services.news_catalysts import store

_logger = logging.getLogger(__name__)

HIST_PERIOD = "ytd2026_v2"   # bump to force regen under looser criteria + placeholder filter
YTD_LO = "2026-01-01"

_MODEL = os.environ.get("NEWS_LLM_MODEL") or os.environ.get("MODELBOOK_LLM_MODEL", "claude-sonnet-4-6")
_TWEET_HOURS = int(os.environ.get("NEWS_TWEET_WINDOW_HOURS", "48") or 48)
_RETRY_AFTER = int(os.environ.get("NEWS_CATALYSTS_RETRY_AFTER", "86400") or 86400)
_DAILY_CAP = int(os.environ.get("NEWS_CATALYSTS_DAILY_CAP", "300") or 300)  # generations/day (per process)
_MAX_HIST_ITEMS = 12          # a bit more coverage (was 8)
_HIST_TOP_N = 20              # candidate big-move days fed to the LLM (was 12)
_MAX_BREAKING = 40            # pre-dedup pool; dedup + relevance trims it
_HIST_TTL = 6 * 3600
_LIVE_TTL = 120
_EST_COST_PER_GEN = 0.02  # ~900 Sonnet out-tokens; for the cost log only

# Single-process generate-once dedupe + daily cap (matches the web pod's one-uvicorn
# assumption, like modelbook/awareness — see CLAUDE.md single-process invariants).
_gen_lock = threading.Lock()
_generating: set[str] = set()
_gen_day: str | None = None
_gen_count = 0


def _enabled() -> bool:
    return os.environ.get("NEWS_CATALYSTS_ENABLED", "1") == "1"


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
    name-dropped in a roundup (owner ask: don't show a post just because $SYM appears)."""
    sym = sym.upper()
    tags = _cashtags(text)
    if len(tags) <= 2:
        return True                                   # 1-2 tickers → a genuine subject
    if tags and tags[0] == sym:
        return True                                   # the primary/first ticker
    if re.search(rf"\${re.escape(sym)}\b", headline or "", re.I):
        return True                                   # named in the headline itself
    return False                                      # buried among many cashtags → skip


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
    """2026-YTD daily bars via the in-process bars path (same parse modelbook uses)."""
    try:
        from api.services import bars_fetch
        resp = bars_fetch._get_bars_inner(sym, "D", 5000)
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
            "move_pct": mp, "source": "ai", "url": None, "ts": _date_ts(d),
        })
    return out


def _earnings_events(sym: str, bar_idx: dict) -> list:
    out = []
    try:
        from api.services import earnings_estimates
        markers = earnings_estimates.get_chart_markers(sym) or {}
    except Exception as exc:
        _logger.warning("news_catalysts earnings fetch failed for %s: %s", sym, exc)
        return out
    for e in (markers.get("earnings") or []):
        d = str(e.get("date") or "")[:10]
        if not d or d < YTD_LO:
            continue
        # Direction/move from the report-day price REACTION when the bar exists
        # (a beat can still sell off), else fall back to beat/miss.
        move = None
        direction = None
        bar = bar_idx.get(d)
        if bar and bar.get("c") is not None:
            base = bar.get("_prev_c") or bar.get("o")
            if base:
                move = round((bar["c"] - base) / base * 100, 1)
                direction = "up" if move >= 0 else "down"
        beat = e.get("beat")
        if direction is None:
            direction = "up" if beat else "down" if beat is False else "neutral"
        fq, fy = e.get("fiscal_quarter"), e.get("fiscal_year")
        qlabel = f"Q{fq} FY{fy} " if fq and fy else ""
        verdict = "beat" if beat else "miss" if beat is False else "report"
        title = f"{qlabel}earnings — {verdict}".strip()
        # Full highlights (dropdown) — EPS, revenue, surprise, report-day reaction.
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
        if e.get("surprise") is not None:
            details.append(f"{'+' if e['surprise'] >= 0 else ''}{e['surprise']}% EPS surprise")
        if move is not None:
            details.append(f"{'+' if move >= 0 else ''}{move}% on the report day")
        out.append({
            "date": d, "type": "earnings", "direction": direction,
            "title": title,
            # Inline (wide) shows the two headline stats; the dropdown shows all details.
            "description": "; ".join(details[:2]) or None,
            "details": details or None,
            "move_pct": move if move is not None else e.get("surprise"),
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
    pairs = []
    for t in rows[:_MAX_BREAKING]:
        ts = t.get("created_at")
        text = (t.get("text") or "").strip()
        if not ts or not text:
            continue
        head, body = _split_headline(text)
        # Relevance: skip a post that only name-drops this ticker among many.
        if not _tweet_relevant(text, sym, head):
            continue
        d = datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m-%d")
        handle = (t.get("author_handle") or "wire").lstrip("@")
        ev = {
            "date": d, "type": "breaking", "direction": "neutral",
            "title": head or text,          # bold headline only — full body goes to `description`
            "description": body,
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


def _combined(sym: str) -> list:
    events = list(_hist_and_earnings(sym))
    live = cache.get(f"news_live_{sym}")
    if live is None:
        live = _breaking_events(sym)
        cache.set(f"news_live_{sym}", live, ttl=_LIVE_TTL)
    events += live
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
        items = significant_catalysts.generate(
            sym, None, bars, "2026 YTD", direction="both",
            model=_MODEL, max_items=_MAX_HIST_ITEMS, top_n=_HIST_TOP_N, enabled=True,
            trading_bounds=(YTD_LO, _today_iso()),
        )
        if items:
            store.replace_catalysts(sym, HIST_PERIOD, items)
            cache.invalidate(f"news_hist_{sym}")
            store.log_cost(sym, _MODEL, _EST_COST_PER_GEN)
        else:
            store.mark_attempt(sym, HIST_PERIOD)
    except Exception as exc:
        _logger.warning("news_catalysts generation failed for %s: %s", sym, exc)
        try:
            store.mark_attempt(sym, HIST_PERIOD)
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


def feed(sym: str) -> dict:
    """The endpoint payload: merged events now + a status telling the client whether
    historical catalysts are still generating."""
    sym = (sym or "").upper()
    if not sym:
        return {"symbol": sym, "status": "ready", "events": [], "generated_at": int(time.time())}
    status = "ready"
    if _enabled() and store.needs_generation(sym, HIST_PERIOD, _RETRY_AFTER):
        _gen_async(sym)
        status = "generating"
    return {"symbol": sym, "status": status, "events": _combined(sym), "generated_at": int(time.time())}
