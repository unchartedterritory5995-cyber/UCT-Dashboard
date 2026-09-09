"""Bounded validation probe for the Massive/Polygon news endpoint.

Answers the 14 questions in the approved News architecture review BEFORE any
production news_store is built. It only READS. It writes nothing to any
application database and touches no service code.

    MASSIVE_API_KEY must be set in the environment. The script never reads it
    from a file, never prints it, and never writes it to disk.

Subcommands
    coverage   one-shot per-ticker pull over 30d  (the bulk of the evidence)
    history    cursor pagination + historical depth on a few tickers
    images     image_url reachability / genuineness / dimensions
    latency    repeated polling of the GLOBAL feed to observe arrival delay
    report     render collected JSON into a readable report

    all        coverage + history + images  (one shot, no waiting)

Every subcommand enforces a hard API-request ceiling and refuses to exceed it.
Output is ASCII-only: this runs in a Windows cp1252 console.

Typical use:
    python scripts/probe_massive_news.py all
    python scripts/probe_massive_news.py latency --minutes 90 --every 5
    python scripts/probe_massive_news.py report
"""

from __future__ import annotations

import argparse
import json
import os
import re
import struct
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

import httpx

BASE = "https://api.massive.com"
NEWS = f"{BASE}/v2/reference/news"

OUT_DIR = Path(os.environ.get("PROBE_OUT") or (Path(__file__).resolve().parents[1] / "_probe_out"))

# ---------------------------------------------------------------------------
# Hard ceilings. The probe aborts rather than quietly exceeding them.
# ---------------------------------------------------------------------------
CEILING = {
    "coverage": 200,
    "history": 30,
    "latency": 60,
    "images": 0,      # image checks hit publisher CDNs, not the Massive API
}
IMAGE_SAMPLE = 60     # separate budget: HTTP HEAD/partial GET to publisher hosts

# ---------------------------------------------------------------------------
# The test universe, tagged by profile so the report can group by profile
# rather than dumping 50 undifferentiated rows.
# ---------------------------------------------------------------------------
UNIVERSE: list[tuple[str, str]] = [
    # mega cap
    ("AAPL", "mega"), ("MSFT", "mega"), ("NVDA", "mega"), ("META", "mega"),
    ("GOOGL", "mega"), ("AMZN", "mega"),
    # large / high-news-flow
    ("MU", "large"), ("AMD", "large"), ("TSLA", "large"), ("AVGO", "large"),
    ("INTC", "large"), ("COIN", "large"), ("SMCI", "large"), ("ROKU", "large"),
    # mid cap
    ("ONTO", "mid"), ("CRDO", "mid"), ("RMBS", "mid"), ("CROX", "mid"),
    ("WING", "mid"), ("DECK", "mid"),
    # small cap, actively traded
    ("IONQ", "small"), ("RGTI", "small"), ("BBAI", "small"), ("SOUN", "small"),
    ("LUNR", "small"), ("RKLB", "small"), ("ASTS", "small"), ("WULF", "small"),
    ("CIFR", "small"), ("PLUG", "small"), ("FCEL", "small"), ("GEVO", "small"),
    # clinical-stage / development biotech
    ("VKTX", "biotech"), ("MDGL", "biotech"), ("CRSP", "biotech"),
    ("BEAM", "biotech"), ("NTLA", "biotech"), ("RXRX", "biotech"),
    # sector representatives
    ("JPM", "financial"), ("KO", "staples"), ("XOM", "energy"),
    ("AR", "energy"), ("HON", "industrial"),
    # ADR
    ("TSM", "adr"), ("NVO", "adr"), ("BABA", "adr"),
    # ETF / index
    ("SPY", "etf"), ("QQQ", "etf"),
    # ticker-collision stress cases (bare words). Coverage matters far less
    # here than WHAT comes back -- these test the relevance stage.
    ("CAT", "collision"), ("ON", "collision"), ("ALL", "collision"),
]

HISTORY_TICKERS = ["AAPL", "MU", "RKLB"]

# Headline shapes that are structurally low-value regardless of publisher.
JUNK_PATTERNS = [
    r"\b\d+\s+(?:best|top|great|cheap)\b.*\bstocks?\b",
    r"\bshould you buy\b",
    r"\bis it too late to buy\b",
    r"\bmillionaire\b",
    r"\bthese \d+ stocks\b",
    r"\bwhy .* stock (?:is|was) (?:moving|up|down|climbing|falling|sinking)\b",
    r"\bstocks? to (?:buy|watch) (?:now|today|this)\b",
    r"\bhere's what\b.*\bshould know\b",
    r"\bshareholder (?:alert|rights|investigation)\b",
    r"\bclass action\b",
    r"\bdeadline reminder\b",
]
JUNK_RE = re.compile("|".join(JUNK_PATTERNS), re.I)

STOP = {
    "the", "a", "an", "and", "or", "of", "in", "on", "for", "to", "as", "at",
    "by", "with", "from", "is", "are", "was", "were", "be", "its", "it", "s",
    "after", "amid", "over", "into", "this", "that", "than", "up", "down",
    "new", "says", "said", "will", "has", "have", "more", "but", "not",
}


# ---------------------------------------------------------------------------
# transport
# ---------------------------------------------------------------------------
class Budget:
    """A hard request ceiling. Raises rather than silently overspending."""

    def __init__(self, limit: int, label: str) -> None:
        self.limit = limit
        self.label = label
        self.used = 0

    def spend(self, n: int = 1) -> None:
        if self.used + n > self.limit:
            raise RuntimeError(
                f"request ceiling reached for '{self.label}': "
                f"{self.used}/{self.limit}. Aborting rather than exceeding it."
            )
        self.used += n


class Massive:
    def __init__(self, key: str, budget: Budget) -> None:
        self.key = key
        self.budget = budget
        self.client = httpx.Client(
            timeout=httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=10.0),
            headers={"Accept": "application/json",
                     "User-Agent": "UCT-news-probe/1.0"},
        )
        self.errors: list[str] = []
        self.latencies_ms: list[float] = []

    def get(self, url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        self.budget.spend()
        p = dict(params or {})
        p["apiKey"] = self.key
        for attempt in range(3):
            t0 = time.time()
            try:
                r = self.client.get(url, params=p)
                if r.status_code == 429:
                    time.sleep(2 + attempt * 3)
                    continue
                r.raise_for_status()
                self.latencies_ms.append((time.time() - t0) * 1000)
                return r.json()
            except httpx.HTTPStatusError as e:
                body = ""
                try:
                    body = e.response.text[:200]
                except Exception:
                    pass
                self.errors.append(f"{e.response.status_code} {url} {body}")
                if e.response.status_code < 500:
                    return {}
                time.sleep(1 + attempt)
            except httpx.HTTPError as e:
                self.errors.append(f"{type(e).__name__} {url} {e}")
                time.sleep(1 + attempt)
        return {}

    def news_pages(self, params: dict[str, Any], max_pages: int) -> tuple[list[dict], bool]:
        """Follow next_url up to max_pages. Returns (results, truncated)."""
        out: list[dict] = []
        data = self.get(NEWS, params)
        out.extend(data.get("results") or [])
        pages = 1
        nxt = data.get("next_url")
        while nxt and pages < max_pages:
            data = self.get(nxt)
            got = data.get("results") or []
            if not got:
                break
            out.extend(got)
            pages += 1
            nxt = data.get("next_url")
        return out, bool(nxt)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def parse_ts(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        t = s.replace("Z", "+00:00")
        d = datetime.fromisoformat(t)
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def shingles(title: str) -> set[str]:
    words = [w for w in re.sub(r"[^a-z0-9 ]", " ", (title or "").lower()).split()
             if w and w not in STOP]
    if len(words) < 3:
        return {" ".join(words)} if words else set()
    return {" ".join(words[i:i + 3]) for i in range(len(words) - 2)}


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def canon_url(u: str | None) -> str:
    if not u:
        return ""
    u = re.sub(r"[?#].*$", "", u.strip().lower())
    u = re.sub(r"^https?://(www\.)?", "", u)
    return u.rstrip("/")


def pct(n: int, d: int) -> float:
    return round(100.0 * n / d, 1) if d else 0.0


def insight_for(article: dict, ticker: str) -> dict | None:
    for ins in article.get("insights") or []:
        if (ins.get("ticker") or "").upper() == ticker.upper():
            return ins
    return None


def write_json(name: str, payload: Any) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / name
    p.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    return p


def read_json(name: str) -> Any:
    p = OUT_DIR / name
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def api_key() -> str:
    k = (os.environ.get("MASSIVE_API_KEY") or "").strip()
    if not k:
        sys.exit(
            "MASSIVE_API_KEY is not set.\n"
            "This probe never reads the key from a file. Populate it in your\n"
            "shell first, then re-run. The key is never printed or stored."
        )
    return k


# ---------------------------------------------------------------------------
# A/B/C/D: coverage, sentiment, duplicates, relevance
# ---------------------------------------------------------------------------
def dup_analysis(arts: list[dict]) -> dict[str, Any]:
    """Exact-URL and near-title duplication within a +/-6h window."""
    rows = []
    for a in arts:
        ts = parse_ts(a.get("published_utc"))
        if not ts:
            continue
        rows.append((ts, a.get("title") or "", canon_url(a.get("article_url")),
                     (a.get("publisher") or {}).get("name") or "?"))
    rows.sort(key=lambda r: r[0])

    url_seen: dict[str, int] = {}
    url_dupes = 0
    for _, _, cu, _ in rows:
        if not cu:
            continue
        if cu in url_seen:
            url_dupes += 1
        url_seen[cu] = 1

    shg = [shingles(t) for _, t, _, _ in rows]
    near = 0
    clusters: list[list[int]] = []
    assigned = [-1] * len(rows)
    win = timedelta(hours=6)
    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            if rows[j][0] - rows[i][0] > win:
                break
            if jaccard(shg[i], shg[j]) >= 0.6:
                near += 1
                if assigned[i] >= 0:
                    c = assigned[i]
                elif assigned[j] >= 0:
                    c = assigned[j]
                else:
                    c = len(clusters)
                    clusters.append([])
                for k in (i, j):
                    if assigned[k] != c:
                        assigned[k] = c
                        clusters[c].append(k)
                break

    samples = []
    for c in clusters[:5]:
        samples.append([{"t": rows[k][0].isoformat(), "pub": rows[k][3],
                         "title": rows[k][1][:110]} for k in sorted(set(c))[:4]])

    return {
        "exact_url_dupes": url_dupes,
        "near_title_dupes": near,
        "dupe_rate_pct": pct(url_dupes + near, len(rows)),
        "cluster_count": len(clusters),
        "cluster_samples": samples,
    }


def probe_coverage(m: Massive, tickers: list[tuple[str, str]],
                   days: int, max_pages: int) -> dict[str, Any]:
    t_now = now_utc()
    gte = (t_now - timedelta(days=days)).date().isoformat()
    out: dict[str, Any] = {"run_at": t_now.isoformat(), "window_days": days,
                           "tickers": {}}

    for sym, profile in tickers:
        try:
            arts, truncated = m.news_pages(
                {"ticker": sym, "published_utc.gte": gte, "order": "desc",
                 "sort": "published_utc", "limit": 1000}, max_pages)
        except RuntimeError as e:
            out["aborted"] = str(e)
            break

        n24 = n7 = n30 = 0
        has_desc = has_img = has_ins = has_reason = 0
        sent = Counter()
        pubs = Counter()
        junk = 0
        no_mention = 0
        basket = 0
        newest = None
        desc_lens: list[int] = []
        reason_lens: list[int] = []
        sent_samples: list[dict] = []
        junk_samples: list[str] = []

        for a in arts:
            ts = parse_ts(a.get("published_utc"))
            if ts:
                age = t_now - ts
                if age <= timedelta(hours=24):
                    n24 += 1
                if age <= timedelta(days=7):
                    n7 += 1
                if age <= timedelta(days=30):
                    n30 += 1
                if newest is None or ts > newest:
                    newest = ts

            title = a.get("title") or ""
            desc = a.get("description") or ""
            if desc:
                has_desc += 1
                desc_lens.append(len(desc))
            if a.get("image_url"):
                has_img += 1
            pubs[(a.get("publisher") or {}).get("name") or "?"] += 1

            ins = insight_for(a, sym)
            if ins:
                has_ins += 1
                s = (ins.get("sentiment") or "").lower()
                sent[s or "?"] += 1
                reason = ins.get("sentiment_reasoning") or ""
                if reason:
                    has_reason += 1
                    reason_lens.append(len(reason))
                if len(sent_samples) < 6 and reason:
                    sent_samples.append({
                        "title": title[:110], "sentiment": s,
                        "reasoning": reason[:400],
                        "published": a.get("published_utc"),
                    })
            else:
                sent["none"] += 1

            if JUNK_RE.search(title):
                junk += 1
                if len(junk_samples) < 5:
                    junk_samples.append(title[:120])
            blob = f"{title} {desc}".lower()
            if sym.lower() not in blob and not ins:
                no_mention += 1
            if len(a.get("tickers") or []) > 10:
                basket += 1

        total = len(arts)
        out["tickers"][sym] = {
            "profile": profile,
            "total_30d": total,
            "truncated": truncated,
            "n_24h": n24, "n_7d": n7, "n_30d": n30,
            "newest": newest.isoformat() if newest else None,
            "newest_age_hours": round((t_now - newest).total_seconds() / 3600, 1)
            if newest else None,
            "pct_description": pct(has_desc, total),
            "pct_image": pct(has_img, total),
            "pct_insight": pct(has_ins, total),
            "pct_reasoning": pct(has_reason, total),
            "median_desc_len": sorted(desc_lens)[len(desc_lens) // 2] if desc_lens else 0,
            "median_reason_len": sorted(reason_lens)[len(reason_lens) // 2] if reason_lens else 0,
            "sentiment": dict(sent),
            "top_publishers": pubs.most_common(6),
            "junk_headline_pct": pct(junk, total),
            "junk_samples": junk_samples,
            "no_mention_pct": pct(no_mention, total),
            "basket_article_pct": pct(basket, total),
            "sentiment_samples": sent_samples,
            "dupes": dup_analysis(arts) if total else {},
        }
        print(f"  {sym:6s} {profile:10s} 30d={total:5d} 24h={n24:3d} "
              f"img={out['tickers'][sym]['pct_image']:5.1f}% "
              f"ins={out['tickers'][sym]['pct_insight']:5.1f}%  "
              f"[{m.budget.used}/{m.budget.limit} calls]", flush=True)

    out["requests_used"] = m.budget.used
    out["api_errors"] = m.errors[:20]
    out["median_api_ms"] = (sorted(m.latencies_ms)[len(m.latencies_ms) // 2]
                            if m.latencies_ms else None)
    return out


# ---------------------------------------------------------------------------
# E: cursor pagination + historical depth
# ---------------------------------------------------------------------------
def probe_history(m: Massive, tickers: list[str], max_pages: int) -> dict[str, Any]:
    res: dict[str, Any] = {"run_at": now_utc().isoformat(), "tickers": {}}
    for sym in tickers:
        seen_ids: set[str] = set()
        overlap = 0
        out_of_order = 0
        page_meta = []
        prev_ts: datetime | None = None
        url: str | None = NEWS
        params: dict[str, Any] | None = {
            "ticker": sym, "order": "desc", "sort": "published_utc", "limit": 1000}
        oldest = None
        pages = 0
        try:
            while url and pages < max_pages:
                data = m.get(url, params)
                params = None
                arts = data.get("results") or []
                if not arts:
                    break
                first = parse_ts(arts[0].get("published_utc"))
                last = parse_ts(arts[-1].get("published_utc"))
                for a in arts:
                    aid = a.get("id") or a.get("article_url")
                    if aid in seen_ids:
                        overlap += 1
                    seen_ids.add(aid)
                    ts = parse_ts(a.get("published_utc"))
                    if ts and prev_ts and ts > prev_ts:
                        out_of_order += 1
                    if ts:
                        prev_ts = ts
                        if oldest is None or ts < oldest:
                            oldest = ts
                page_meta.append({
                    "page": pages + 1, "n": len(arts),
                    "first": first.isoformat() if first else None,
                    "last": last.isoformat() if last else None,
                })
                pages += 1
                url = data.get("next_url")
        except RuntimeError as e:
            res["aborted"] = str(e)

        span_days = None
        if oldest:
            span_days = round((now_utc() - oldest).days)
        res["tickers"][sym] = {
            "pages_fetched": pages,
            "unique_articles": len(seen_ids),
            "cross_page_overlap": overlap,
            "out_of_order": out_of_order,
            "oldest_reached": oldest.isoformat() if oldest else None,
            "span_days": span_days,
            "cursor_stable": overlap == 0 and out_of_order == 0,
            "pages": page_meta,
        }
        print(f"  {sym:6s} pages={pages} unique={len(seen_ids)} "
              f"oldest={oldest.date() if oldest else '-'} "
              f"overlap={overlap} ooo={out_of_order}", flush=True)
    res["requests_used"] = m.budget.used
    return res


# ---------------------------------------------------------------------------
# D: image reachability, genuineness, dimensions
# ---------------------------------------------------------------------------
def image_dims(data: bytes) -> tuple[int, int] | None:
    try:
        if data[:8] == b"\x89PNG\r\n\x1a\n":
            w, h = struct.unpack(">II", data[16:24])
            return int(w), int(h)
        if data[:3] == b"\xff\xd8\xff":
            i = 2
            while i < len(data) - 9:
                if data[i] != 0xFF:
                    i += 1
                    continue
                marker = data[i + 1]
                if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                              0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    h, w = struct.unpack(">HH", data[i + 5:i + 9])
                    return int(w), int(h)
                seg = struct.unpack(">H", data[i + 2:i + 4])[0]
                i += 2 + seg
            return None
        if data[:6] in (b"GIF87a", b"GIF89a"):
            w, h = struct.unpack("<HH", data[6:10])
            return int(w), int(h)
        if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            if data[12:16] == b"VP8X":
                w = int.from_bytes(data[24:27], "little") + 1
                h = int.from_bytes(data[27:30], "little") + 1
                return w, h
            if data[12:16] == b"VP8 ":
                w = struct.unpack("<H", data[26:28])[0] & 0x3FFF
                h = struct.unpack("<H", data[28:30])[0] & 0x3FFF
                return int(w), int(h)
    except Exception:
        return None
    return None


def probe_images(coverage: dict[str, Any], sample: int) -> dict[str, Any]:
    """Collect image_urls from the coverage pull and check them directly.

    Does NOT spend Massive API budget -- these are requests to publisher CDNs.
    A URL that repeats across many articles from one publisher is a generic
    house image, not a story image; that is measured rather than guessed.
    """
    raw = read_json("raw_articles.json") or {}
    urls: list[tuple[str, str, str]] = []       # (url, publisher, title)
    per_pub_url = defaultdict(Counter)
    for sym, arts in raw.items():
        for a in arts:
            u = a.get("image_url")
            pub = (a.get("publisher") or {}).get("name") or "?"
            if u:
                per_pub_url[pub][u] += 1
                urls.append((u, pub, a.get("title") or ""))

    # Generic-image detection: same URL used by the same publisher many times.
    repeated = {u for pub, c in per_pub_url.items() for u, n in c.items() if n >= 4}
    generic_hits = sum(1 for u, _, _ in urls if u in repeated)

    # Even sample across publishers so one prolific wire does not dominate.
    by_pub: dict[str, list] = defaultdict(list)
    for row in urls:
        by_pub[row[1]].append(row)
    picked: list[tuple[str, str, str]] = []
    i = 0
    while len(picked) < sample and any(len(v) > i for v in by_pub.values()):
        for pub in sorted(by_pub):
            if len(by_pub[pub]) > i and len(picked) < sample:
                picked.append(by_pub[pub][i])
        i += 1

    client = httpx.Client(timeout=httpx.Timeout(connect=5.0, read=12.0,
                                                write=5.0, pool=5.0),
                          follow_redirects=True,
                          headers={"User-Agent": "Mozilla/5.0 (compatible; UCT-news-probe/1.0)",
                                   "Range": "bytes=0-32767"})
    ok = broken = 0
    dims: list[tuple[int, int]] = []
    ctypes = Counter()
    failures: list[dict] = []
    checked = []
    for u, pub, title in picked:
        try:
            r = client.get(u)
            if r.status_code >= 400:
                broken += 1
                failures.append({"status": r.status_code, "pub": pub, "url": u[:120]})
                continue
            ok += 1
            ctypes[(r.headers.get("content-type") or "?").split(";")[0]] += 1
            d = image_dims(r.content)
            if d:
                dims.append(d)
            checked.append({"pub": pub, "dims": d, "generic": u in repeated,
                            "title": title[:80]})
        except Exception as e:
            broken += 1
            failures.append({"status": type(e).__name__, "pub": pub, "url": u[:120]})
    client.close()

    widths = sorted(w for w, _ in dims)
    ars = sorted(round(w / h, 2) for w, h in dims if h)
    return {
        "run_at": now_utc().isoformat(),
        "total_image_urls_seen": len(urls),
        "distinct_image_urls": len({u for u, _, _ in urls}),
        "reuse_rate_pct": pct(generic_hits, len(urls)),
        "generic_house_images": len(repeated),
        "sampled": len(picked),
        "reachable": ok,
        "broken": broken,
        "broken_rate_pct": pct(broken, len(picked)),
        "content_types": dict(ctypes),
        "dims_parsed": len(dims),
        "width_min": widths[0] if widths else None,
        "width_median": widths[len(widths) // 2] if widths else None,
        "width_max": widths[-1] if widths else None,
        "aspect_median": ars[len(ars) // 2] if ars else None,
        "aspect_min": ars[0] if ars else None,
        "aspect_max": ars[-1] if ars else None,
        "under_320px_wide": sum(1 for w in widths if w < 320),
        "failures": failures[:12],
        "sample_rows": checked[:20],
    }


# ---------------------------------------------------------------------------
# A: arrival latency (global feed, repeated polling)
# ---------------------------------------------------------------------------
def probe_latency(m: Massive, minutes: int, every: int, page: int) -> dict[str, Any]:
    """Poll the GLOBAL news feed and time when each article first appears.

    delay = first_observed - published_utc

    The first round is a SEED and is discarded: everything looks 'new' then.
    Rounds after that measure real arrival. The per-round new-article counts
    are what reveal whether the dataset refreshes continuously or in hourly
    batches -- a documented 'hourly refresh' should show most rounds at zero
    and periodic bursts.
    """
    rounds: list[dict] = []
    seen: dict[str, datetime] = {}
    deadline = time.time() + minutes * 60
    rn = 0
    print(f"  polling global feed every {every} min for {minutes} min "
          f"(ceiling {m.budget.limit} calls)", flush=True)
    while time.time() < deadline:
        rn += 1
        t = now_utc()
        try:
            data = m.get(NEWS, {"order": "desc", "sort": "published_utc",
                                "limit": page})
        except RuntimeError as e:
            rounds.append({"round": rn, "aborted": str(e)})
            break
        arts = data.get("results") or []
        fresh = []
        for a in arts:
            aid = a.get("id") or a.get("article_url")
            if not aid or aid in seen:
                continue
            seen[aid] = t
            ts = parse_ts(a.get("published_utc"))
            fresh.append({
                "id": aid,
                "published_utc": a.get("published_utc"),
                "observed": t.isoformat(),
                "delay_min": round((t - ts).total_seconds() / 60, 1) if ts else None,
                "publisher": (a.get("publisher") or {}).get("name"),
                "title": (a.get("title") or "")[:100],
                "tickers": len(a.get("tickers") or []),
            })
        oldest = min((parse_ts(a.get("published_utc")) for a in arts
                      if parse_ts(a.get("published_utc"))), default=None)
        rounds.append({
            "round": rn, "at": t.isoformat(), "returned": len(arts),
            "new": len(fresh), "seed": rn == 1,
            "page_spans_hours": round((t - oldest).total_seconds() / 3600, 1)
            if oldest else None,
            "items": [] if rn == 1 else fresh[:40],
        })
        print(f"  round {rn:3d} {t.strftime('%H:%M:%S')}Z  returned={len(arts):4d} "
              f"new={len(fresh):4d}{'  (seed, discarded)' if rn == 1 else ''}",
              flush=True)
        if time.time() >= deadline:
            break
        time.sleep(max(5, every * 60))

    measured = [i for r in rounds if not r.get("seed")
                for i in r.get("items", []) if i.get("delay_min") is not None]
    delays = sorted(i["delay_min"] for i in measured)

    def q(p: float):
        return delays[min(len(delays) - 1, int(len(delays) * p))] if delays else None

    non_seed = [r for r in rounds if not r.get("seed") and "new" in r]
    return {
        "run_at": now_utc().isoformat(),
        "minutes": minutes, "interval_min": every, "page_size": page,
        "rounds": rounds,
        "measured_articles": len(delays),
        "delay_min_p10": q(0.10), "delay_min_p50": q(0.50),
        "delay_min_p90": q(0.90), "delay_min_p99": q(0.99),
        "delay_min_max": delays[-1] if delays else None,
        "rounds_with_zero_new": sum(1 for r in non_seed if r["new"] == 0),
        "rounds_measured": len(non_seed),
        "new_per_round": [r["new"] for r in non_seed],
        "requests_used": m.budget.used,
        "slowest": sorted(measured, key=lambda i: -(i["delay_min"] or 0))[:8],
        "fastest": sorted(measured, key=lambda i: (i["delay_min"] or 0))[:8],
    }


# ---------------------------------------------------------------------------
# verify: is the narrow publisher set a property of the DATASET, or an
# artifact of filtering by ticker? This single question decides whether
# Massive can be a core source or only a supplementary one.
# ---------------------------------------------------------------------------
VERIFY_THIN = ["XOM", "HON", "ONTO", "CVX", "BA"]

# Opinion / commentary shapes. Deliberately SEPARATE from JUNK_RE: this is not
# spam, it is publisher-voice editorial. The distinction matters because the
# feed should reject it while still counting it as legitimate content.
COMMENTARY_PATTERNS = [
    r"\bbuy,? sell,? or hold\b", r"\bis .* a (?:buy|sell|screaming buy|no-brainer)\b",
    r"\bhere(?:['’]?s| is) (?:why|what|which|how)\b",
    r"\bmy top\b", r"\bbetter buy\b",
    # First person in a headline is editorial voice, not reporting.
    r"\b(?:i['’]?d|i['’]?ve|i['’]?m|i['’]?ll|why i)\b",
    r"\bprediction\b", r"\b(?:could|will) (?:double|soar|skyrocket|crash)\b",
    r"\b\d+ reasons?\b", r"\bno-brainer\b", r"\bmillionaire[- ]maker\b",
    r"\bwhere will .* be in \d+ years?\b", r"\bworth buying\b",
    r"\binvesting radar\b", r"\bdown \d+%.*\bbuy\b",
    # The Zacks/Fool interrogative headline: a question ABOUT a stock rather
    # than a report of an event. Straight news almost never ends in '?'.
    # The question can open the headline or follow a colon/dash.
    r"(?:^|[:\-–—]\s*)"
    r"(?:can|will|is|are|should|why|what|how|where|which|do|does|has|have)\b"
    r"[^?]{0,170}\?\s*$",
    # Numeric listicle ("3 Dividend Kings You Can Buy and Never Sell").
    r"^\s*\d{1,2}\s+\S",
    # Explainer voice ("Why Microsoft (MSFT) is a Top Stock for the Long-Term").
    r"^\s*why\b",
    r"\b(?:stock|shares) (?:a|an) (?:buy|steal|bargain)\b",
    r"\bshould investors\b", r"\bwhat investors (?:need|should) (?:to )?know\b",
]
COMMENTARY_RE = re.compile("|".join(COMMENTARY_PATTERNS), re.I)

# ---------------------------------------------------------------------------
# Subject-vs-mention, read out of the provider's OWN sentiment_reasoning.
#
# This is the strongest relevance signal found anywhere in the probe, and it
# is free: when a ticker is tagged on an article it is not actually about,
# Massive's reasoning text routinely says so in as many words --
#   "Apple is mentioned as a high-flying tech stock ... but it is not the
#    subject of analysis in this article"
# Treat a hit here as a REJECTION candidate for the company feed, independent
# of the sentiment value itself.
# ---------------------------------------------------------------------------
MENTION_PATTERNS = [
    r"\bis (?:only |merely |briefly |simply |just )?(?:mentioned|referenced|cited|noted|listed)\b",
    r"\b(?:only|merely|briefly|simply|just|passing) (?:mentioned|referenced|noted)\b",
    r"\bnot the (?:subject|focus|primary focus|main subject|central)\b",
    r"\bnot (?:the )?(?:directly )?(?:analyzed|discussed|examined|evaluated)\b",
    r"\bno (?:specific )?sentiment is expressed\b",
    r"\bnot directly (?:recommended|addressed|discussed|analyzed|covered)\b",
    r"\bin passing\b", r"\btangential",
    r"\bas a (?:comparison|point of comparison|benchmark|reference point|contrast)\b",
    r"\bcompared (?:to|with|against)\b.*\bbut\b",
    r"\bdoes not (?:discuss|analyze|address|cover|provide)\b",
    r"\bmentioned (?:as|among|alongside|in the context)\b",
    r"\bno (?:specific |direct )?(?:commentary|analysis|opinion) (?:is |was )?(?:offered|provided|expressed)\b",
    r"\bwithout (?:specific |direct )?(?:analysis|commentary|discussion)\b",
    r"\bpeer\b.*\bnot\b", r"\bcontext(?:ual)? (?:mention|reference)\b",
]
MENTION_RE = re.compile("|".join(MENTION_PATTERNS), re.I)


def subject_signal(reasoning: str | None) -> str:
    """SUBJECT | MENTION | UNKNOWN, from the provider's reasoning text."""
    if not reasoning:
        return "UNKNOWN"
    return "MENTION" if MENTION_RE.search(reasoning) else "SUBJECT"


def _corpus_stats(arts: list[dict], label: str) -> dict[str, Any]:
    """Quality profile of a corpus, and the same profile per publisher."""
    per_pub: dict[str, dict] = defaultdict(
        lambda: {"n": 0, "desc": 0, "img": 0, "ins": 0, "reason": 0,
                 "junk": 0, "comm": 0, "sent": Counter(), "imgs": Counter(),
                 "subj": Counter()})
    tot = {"n": 0, "desc": 0, "img": 0, "ins": 0, "reason": 0, "junk": 0,
           "comm": 0}
    sent_all = Counter()
    subj_all = Counter()
    mention_samples: list[dict] = []
    for a in arts:
        p = (a.get("publisher") or {}).get("name") or "?"
        d = per_pub[p]
        title = a.get("title") or ""
        d["n"] += 1
        tot["n"] += 1
        if a.get("description"):
            d["desc"] += 1
            tot["desc"] += 1
        iu = a.get("image_url")
        if iu:
            d["img"] += 1
            tot["img"] += 1
            d["imgs"][iu] += 1
        ins = a.get("insights") or []
        if ins:
            d["ins"] += 1
            tot["ins"] += 1
            if any(i.get("sentiment_reasoning") for i in ins):
                d["reason"] += 1
                tot["reason"] += 1
            for i in ins:
                s = (i.get("sentiment") or "?").lower()
                d["sent"][s] += 1
                sent_all[s] += 1
                sig = subject_signal(i.get("sentiment_reasoning"))
                d["subj"][sig] += 1
                subj_all[sig] += 1
                if sig == "MENTION" and len(mention_samples) < 12:
                    mention_samples.append({
                        "ticker": i.get("ticker"), "publisher": p,
                        "title": title[:100],
                        "reasoning": (i.get("sentiment_reasoning") or "")[:300],
                    })
        if JUNK_RE.search(title):
            d["junk"] += 1
            tot["junk"] += 1
        if COMMENTARY_RE.search(title):
            d["comm"] += 1
            tot["comm"] += 1

    pubs = {}
    for p, d in sorted(per_pub.items(), key=lambda kv: -kv[1]["n"]):
        house = {u for u, c in d["imgs"].items() if c >= 4}
        house_slots = sum(c for u, c in d["imgs"].items() if u in house)
        pubs[p] = {
            "n": d["n"], "share_pct": pct(d["n"], tot["n"]),
            "pct_description": pct(d["desc"], d["n"]),
            "pct_image": pct(d["img"], d["n"]),
            "pct_insight": pct(d["ins"], d["n"]),
            "pct_reasoning": pct(d["reason"], d["n"]),
            "junk_pct": pct(d["junk"], d["n"]),
            "commentary_pct": pct(d["comm"], d["n"]),
            "sentiment": dict(d["sent"]),
            "pos_neg_ratio": round(d["sent"].get("positive", 0) /
                                   max(1, d["sent"].get("negative", 0)), 2),
            "distinct_images": len(d["imgs"]),
            "house_art_urls": len(house),
            "house_art_slots_pct": pct(house_slots, max(1, d["img"])),
            "real_story_image_pct": pct(d["img"] - house_slots, d["n"]),
            "subject_signal": dict(d["subj"]),
            "mention_only_pct": pct(d["subj"].get("MENTION", 0),
                                    max(1, sum(d["subj"].values()))),
        }
    subj_tot = max(1, sum(subj_all.values()))
    return {
        "label": label,
        "articles": tot["n"],
        "publisher_count": len(per_pub),
        "pct_description": pct(tot["desc"], tot["n"]),
        "pct_image": pct(tot["img"], tot["n"]),
        "pct_insight": pct(tot["ins"], tot["n"]),
        "pct_reasoning": pct(tot["reason"], tot["n"]),
        "junk_pct": pct(tot["junk"], tot["n"]),
        "commentary_pct": pct(tot["comm"], tot["n"]),
        "sentiment": dict(sent_all),
        "pos_neg_ratio": round(sent_all.get("positive", 0) /
                               max(1, sent_all.get("negative", 0)), 2),
        "subject_signal": dict(subj_all),
        "mention_only_pct": pct(subj_all.get("MENTION", 0), subj_tot),
        "subject_pct": pct(subj_all.get("SUBJECT", 0), subj_tot),
        "mention_samples": mention_samples,
        "per_publisher": pubs,
    }


def _cursor_forensics(pages: list[list[dict]]) -> dict[str, Any]:
    """Separate PROVIDER ORDERING problems from CURSOR PAGING problems.

    within_page_inversions -> the provider's own sort is not monotonic
    boundary_inversions    -> page N+1 starts NEWER than page N ended
    repeat_same_id         -> the same article id served on two pages
    repeat_same_url_diff_id-> the same story served under two ids
    """
    seen_id: dict[str, int] = {}
    seen_url: dict[str, int] = {}
    within = 0
    boundary = 0
    rep_id: list[dict] = []
    rep_url: list[dict] = []
    meta = []
    prev_last: datetime | None = None
    for pi, arts in enumerate(pages):
        ts = [parse_ts(a.get("published_utc")) for a in arts]
        w = sum(1 for i in range(len(ts) - 1)
                if ts[i] and ts[i + 1] and ts[i] < ts[i + 1])
        within += w
        b = 0
        if prev_last and ts and ts[0] and ts[0] > prev_last:
            boundary += 1
            b = 1
        for a in arts:
            aid = a.get("id")
            cu = canon_url(a.get("article_url"))
            if aid and aid in seen_id:
                rep_id.append({"id": aid, "first_page": seen_id[aid],
                               "again_page": pi + 1,
                               "title": (a.get("title") or "")[:80]})
            elif aid:
                seen_id[aid] = pi + 1
            if cu:
                if cu in seen_url and not any(r["id"] == aid for r in rep_id):
                    rep_url.append({"url": cu[:90], "first_page": seen_url[cu],
                                    "again_page": pi + 1})
                else:
                    seen_url[cu] = pi + 1
        meta.append({
            "page": pi + 1, "n": len(arts),
            "first": ts[0].isoformat() if ts and ts[0] else None,
            "last": ts[-1].isoformat() if ts and ts[-1] else None,
            "within_page_inversions": w, "boundary_inversion": b,
        })
        if ts and ts[-1]:
            prev_last = ts[-1]
    total = sum(len(p) for p in pages)
    return {
        "pages": len(pages), "articles_served": total,
        "unique_ids": len(seen_id),
        "within_page_inversions": within,
        "boundary_inversions": boundary,
        "repeat_same_id": len(rep_id),
        "repeat_same_url_diff_id": len(rep_url),
        "repeat_rate_pct": pct(len(rep_id) + len(rep_url), max(1, total)),
        "page_meta": meta,
        "repeat_id_samples": rep_id[:8],
        "repeat_url_samples": rep_url[:5],
        "verdict": ("provider ordering is non-monotonic" if within
                    else "provider ordering monotonic within pages")
                   + "; " +
                   ("cursor re-serves rows across page boundaries"
                    if (rep_id or boundary) else "cursor boundaries clean"),
    }


def probe_decay(m: Massive) -> dict[str, Any]:
    """Date the publisher-set decay.

    The all-time per-ticker pulls contain Benzinga, MarketWatch, Seeking Alpha
    and Investing.com; the last 30 days contain none of them. Either those
    feeds stopped, or the recent window is an anomaly. Sampling one 24h slice
    of the GLOBAL feed per quarter answers it in ~12 calls and tells us
    whether Massive news is a stable product or a decaying one.
    """
    anchors: list[str] = []
    d = now_utc().date().replace(day=15)
    for _ in range(13):
        anchors.append(d.isoformat())
        # step back one quarter
        mth = d.month - 3
        yr = d.year
        if mth <= 0:
            mth += 12
            yr -= 1
        d = d.replace(year=yr, month=mth)
    anchors.reverse()

    series = []
    for a in anchors:
        end = (datetime.fromisoformat(a) + timedelta(days=1)).date().isoformat()
        data = m.get(NEWS, {"published_utc.gte": a, "published_utc.lte": end,
                            "order": "desc", "sort": "published_utc",
                            "limit": 1000})
        arts = data.get("results") or []
        pubs = Counter((x.get("publisher") or {}).get("name") or "?" for x in arts)
        tk = Counter(t for x in arts for t in (x.get("tickers") or []))
        row = {
            "date": a, "articles": len(arts), "truncated": len(arts) >= 1000,
            "publisher_count": len(pubs),
            "publishers": dict(pubs.most_common(12)),
            "distinct_tickers": len(tk),
            "commentary_pct": pct(sum(1 for x in arts
                                      if COMMENTARY_RE.search(x.get("title") or "")
                                      or JUNK_RE.search(x.get("title") or "")),
                                  max(1, len(arts))),
        }
        series.append(row)
        print(f"  {a}  n={len(arts):5d}{' TRUNC' if row['truncated'] else '     '} "
              f"pubs={len(pubs):3d}  tickers={len(tk):5d}  "
              f"comm={row['commentary_pct']:5.1f}%  "
              f"{list(pubs)[:4]}", flush=True)

    all_pubs = sorted({p for r in series for p in r["publishers"]})
    matrix = {p: [r["publishers"].get(p, 0) for r in series] for p in all_pubs}
    lost = [p for p, v in matrix.items() if sum(v[:len(v) // 2]) > 0
            and sum(v[len(v) // 2:]) == 0]
    return {
        "run_at": now_utc().isoformat(),
        "anchors": anchors,
        "series": series,
        "publisher_matrix": matrix,
        "publishers_lost": lost,
        "requests_used": m.budget.used,
        "api_errors": m.errors[:10],
    }


def probe_verify(m: Massive, pages: int) -> dict[str, Any]:
    # 1. the unfiltered global corpus, kept page-by-page for cursor forensics
    page_list: list[list[dict]] = []
    url: str | None = NEWS
    params: dict[str, Any] | None = {"order": "desc", "sort": "published_utc",
                                     "limit": 1000}
    while url and len(page_list) < pages:
        data = m.get(url, params)
        params = None
        got = data.get("results") or []
        if not got:
            break
        page_list.append(got)
        print(f"    page {len(page_list)}: {len(got)} articles", flush=True)
        url = data.get("next_url")
    glob = [a for p in page_list for a in p]

    stats = _corpus_stats(glob, "massive global feed")
    forensics = _cursor_forensics(page_list)

    gt = Counter(t for a in glob for t in (a.get("tickers") or []))
    per_art = sorted(len(a.get("tickers") or []) for a in glob)
    times = sorted(t for t in (parse_ts(a.get("published_utc")) for a in glob) if t)

    print(f"\n  GLOBAL: {len(glob)} articles from "
          f"{stats['publisher_count']} publishers, {m.budget.used} calls")
    print(f"  {'PUBLISHER':34s} {'N':>5s} {'SHARE':>7s} {'COMM%':>6s} "
          f"{'IMG%':>6s} {'HOUSE%':>7s} {'P:N':>6s}")
    for p, d in list(stats["per_publisher"].items())[:20]:
        print(f"  {p[:34]:34s} {d['n']:5d} {d['share_pct']:6.1f}% "
              f"{d['commentary_pct']:5.1f}% {d['pct_image']:5.1f}% "
              f"{d['house_art_slots_pct']:6.1f}% {d['pos_neg_ratio']:6.1f}",
              flush=True)

    # 2. thin tickers with NO date window -- is 30d the constraint, or the data?
    thin: dict[str, Any] = {}
    for sym in VERIFY_THIN:
        arts, _ = m.news_pages({"ticker": sym, "order": "desc",
                                "sort": "published_utc", "limit": 1000}, 1)
        ts = sorted(t for t in (parse_ts(a.get("published_utc")) for a in arts) if t)
        thin[sym] = {
            "returned": len(arts),
            "publishers": dict(Counter((a.get("publisher") or {}).get("name") or "?"
                                       for a in arts).most_common(10)),
            "newest": ts[-1].isoformat() if ts else None,
            "oldest": ts[0].isoformat() if ts else None,
            "span_days": (ts[-1] - ts[0]).days if len(ts) > 1 else None,
            "per_year": dict(Counter(t.year for t in ts)),
            "titles": [(a.get("title") or "")[:100] for a in arts[:8]],
        }
        print(f"  {sym:5s} all-time={len(arts):5d} span="
              f"{thin[sym]['span_days']}d pubs={list(thin[sym]['publishers'])[:3]}",
              flush=True)

    # 3. is the ticker-filtered view lossy vs the global corpus?
    cross = {sym: {"tagged_in_global_sample":
                   sum(1 for a in glob if sym in (a.get("tickers") or []))}
             for sym in VERIFY_THIN}

    write_json("verify_raw_global.json",
               [{k: a.get(k) for k in ("id", "title", "description", "publisher",
                                       "image_url", "published_utc", "tickers",
                                       "article_url", "insights")}
                for a in glob])

    return {
        "run_at": now_utc().isoformat(),
        "global_pages": len(page_list),
        "corpus": stats,
        "cursor_forensics": forensics,
        "dupes": dup_analysis(glob),
        "global_distinct_tickers": len(gt),
        "global_top_tickers": gt.most_common(30),
        "tickers_per_article_median": per_art[len(per_art) // 2] if per_art else None,
        "tickers_per_article_max": per_art[-1] if per_art else None,
        "articles_with_no_ticker": sum(1 for x in per_art if x == 0),
        "articles_over_10_tickers": sum(1 for x in per_art if x > 10),
        "global_span_hours": round((times[-1] - times[0]).total_seconds() / 3600, 1)
        if len(times) > 1 else None,
        "global_newest": times[-1].isoformat() if times else None,
        "global_oldest": times[0].isoformat() if times else None,
        "thin_tickers_all_time": thin,
        "cross_check": cross,
        "requests_used": m.budget.used,
        "api_errors": m.errors[:10],
    }


# ---------------------------------------------------------------------------
# report
# ---------------------------------------------------------------------------
def bar(v: float, width: int = 20) -> str:
    n = int(round(min(100.0, max(0.0, v)) / 100 * width))
    return "#" * n + "." * (width - n)


def render_report() -> str:
    cov = read_json("coverage.json")
    hist = read_json("history.json")
    img = read_json("images.json")
    lat = read_json("latency.json")
    L: list[str] = []
    add = L.append

    add("=" * 78)
    add("MASSIVE NEWS VALIDATION PROBE")
    add("=" * 78)

    if lat:
        add("")
        add("-- 1. OBSERVED ARRIVAL LATENCY " + "-" * 46)
        add(f"   window {lat['minutes']} min, polled every {lat['interval_min']} min, "
            f"page={lat['page_size']}, {lat['requests_used']} calls")
        add(f"   articles measured: {lat['measured_articles']}")
        add(f"   delay published->observed (minutes)")
        add(f"     p10 {lat['delay_min_p10']}   p50 {lat['delay_min_p50']}   "
            f"p90 {lat['delay_min_p90']}   p99 {lat['delay_min_p99']}   "
            f"max {lat['delay_min_max']}")
        add(f"   rounds with zero new articles: "
            f"{lat['rounds_with_zero_new']}/{lat['rounds_measured']}")
        add(f"   new-per-round: {lat['new_per_round']}")
        zero = lat["rounds_with_zero_new"]
        tot = max(1, lat["rounds_measured"])
        if zero / tot > 0.6:
            add("   PATTERN: mostly-empty rounds with bursts -> BATCHED refresh.")
        else:
            add("   PATTERN: new articles in most rounds -> CONTINUOUS refresh.")

    if cov:
        t = cov["tickers"]
        add("")
        add("-- 2..6. COVERAGE BY PROFILE " + "-" * 48)
        add(f"   window {cov['window_days']}d, {cov['requests_used']} calls, "
            f"median API response {cov.get('median_api_ms')} ms")
        add("")
        add(f"   {'SYM':6s} {'PROFILE':10s} {'30d':>5s} {'7d':>5s} {'24h':>4s} "
            f"{'NEWEST':>8s} {'DESC%':>6s} {'IMG%':>6s} {'SENT%':>6s} {'DUP%':>5s} {'JUNK%':>6s}")
        order = ["mega", "large", "mid", "small", "biotech", "financial",
                 "staples", "energy", "industrial", "adr", "etf", "collision"]
        for prof in order:
            rows = [(s, d) for s, d in t.items() if d["profile"] == prof]
            if not rows:
                continue
            for s, d in rows:
                age = d.get("newest_age_hours")
                add(f"   {s:6s} {prof:10s} {d['n_30d']:5d} {d['n_7d']:5d} "
                    f"{d['n_24h']:4d} {(str(age) + 'h') if age is not None else '  -':>8s} "
                    f"{d['pct_description']:6.1f} {d['pct_image']:6.1f} "
                    f"{d['pct_insight']:6.1f} "
                    f"{d.get('dupes', {}).get('dupe_rate_pct', 0):5.1f} "
                    f"{d['junk_headline_pct']:6.1f}")
            n30 = [d["n_30d"] for _, d in rows]
            ins = [d["pct_insight"] for _, d in rows]
            im = [d["pct_image"] for _, d in rows]
            dup = [d.get("dupes", {}).get("dupe_rate_pct", 0) for _, d in rows]
            jk = [d["junk_headline_pct"] for _, d in rows]
            zero_ct = sum(1 for v in n30 if v == 0)
            thin = sum(1 for v in n30 if v < 5)
            add(f"   {'':6s} {'= ' + prof:10s} "
                f"median30d={sorted(n30)[len(n30) // 2]:5d} "
                f"sent={sum(ins) / len(ins):5.1f}% img={sum(im) / len(im):5.1f}% "
                f"dup={sum(dup) / len(dup):4.1f}% junk={sum(jk) / len(jk):4.1f}% "
                f"empty={zero_ct}/{len(rows)} thin={thin}/{len(rows)}")
            add("")

        add("-- 7. SENTIMENT AVAILABILITY " + "-" * 48)
        allsent = Counter()
        for d in t.values():
            for k, v in d["sentiment"].items():
                allsent[k] += v
        tot = sum(allsent.values()) or 1
        for k, v in allsent.most_common():
            add(f"   {k:10s} {v:6d}  {pct(v, tot):5.1f}%  {bar(pct(v, tot))}")
        with_ins = tot - allsent.get("none", 0)
        add(f"   -> insight present on {pct(with_ins, tot)}% of ticker-article pairs")
        reasons = [d["pct_reasoning"] for d in t.values() if d["total_30d"]]
        if reasons:
            add(f"   -> reasoning string present on "
                f"{sum(reasons) / len(reasons):.1f}% (median length "
                f"{sorted(d['median_reason_len'] for d in t.values())[len(t) // 2]} chars)")

        add("")
        add("-- 8. SENTIMENT QUALITY SAMPLES " + "-" * 45)
        shown = 0
        for s, d in t.items():
            for smp in d["sentiment_samples"][:1]:
                if shown >= 10:
                    break
                add(f"   [{s}] {smp['sentiment'].upper()}")
                add(f"     {smp['title']}")
                add(f"     > {smp['reasoning'][:260]}")
                shown += 1

    if img:
        add("")
        add("-- 9. IMAGE AVAILABILITY AND QUALITY " + "-" * 40)
        add(f"   image_urls seen {img['total_image_urls_seen']} "
            f"({img['distinct_image_urls']} distinct)")
        add(f"   sampled {img['sampled']}: reachable {img['reachable']}, "
            f"broken {img['broken']} ({img['broken_rate_pct']}%)")
        add(f"   repeated house/logo images: {img['generic_house_images']} URLs, "
            f"{img['reuse_rate_pct']}% of all image slots")
        add(f"   width min/median/max: {img['width_min']}/"
            f"{img['width_median']}/{img['width_max']}   "
            f"under 320px: {img['under_320px_wide']}")
        add(f"   aspect min/median/max: {img['aspect_min']}/"
            f"{img['aspect_median']}/{img['aspect_max']}")
        add(f"   content types: {img['content_types']}")
        for f in img["failures"][:6]:
            add(f"     BROKEN {f['status']} {f['pub']} {f['url']}")

    if cov:
        add("")
        add("-- 10. DUPLICATION " + "-" * 58)
        t = cov["tickers"]
        rates = [(s, d.get("dupes", {}).get("dupe_rate_pct", 0))
                 for s, d in t.items() if d["total_30d"] > 20]
        rates.sort(key=lambda r: -r[1])
        for s, r in rates[:10]:
            add(f"   {s:6s} {r:5.1f}%  {bar(r)}")
        if rates:
            add(f"   mean duplicate rate across covered tickers: "
                f"{sum(r for _, r in rates) / len(rates):.1f}%")
        for s, d in t.items():
            cs = d.get("dupes", {}).get("cluster_samples") or []
            if cs:
                add(f"   example syndication cluster ({s}):")
                for row in cs[0]:
                    add(f"     {row['t'][11:16]} {row['pub'][:22]:22s} {row['title'][:70]}")
                break

    if hist:
        add("")
        add("-- 11. HISTORICAL PAGINATION " + "-" * 48)
        for s, d in hist["tickers"].items():
            flag = "STABLE" if d["cursor_stable"] else "UNSTABLE"
            add(f"   {s:6s} pages={d['pages_fetched']} unique={d['unique_articles']:5d} "
                f"oldest={str(d['oldest_reached'])[:10]} span={d['span_days']}d "
                f"overlap={d['cross_page_overlap']} ooo={d['out_of_order']}  {flag}")

    add("")
    add("=" * 78)
    return "\n".join(L)


# ---------------------------------------------------------------------------
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["coverage", "history", "images", "latency",
                                    "verify", "decay", "report", "all"])
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--max-pages", type=int, default=2,
                    help="pages per ticker in coverage (1000 articles each)")
    ap.add_argument("--hist-pages", type=int, default=5)
    ap.add_argument("--verify-pages", type=int, default=5)
    ap.add_argument("--minutes", type=int, default=90, help="latency: total window")
    ap.add_argument("--every", type=int, default=5, help="latency: minutes between polls")
    ap.add_argument("--page", type=int, default=500, help="latency: articles per poll")
    ap.add_argument("--limit-tickers", type=int, default=0,
                    help="smoke test: only probe the first N tickers")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.cmd == "report":
        text = render_report()
        print(text)
        (OUT_DIR / "REPORT.txt").write_text(text, encoding="utf-8")
        print(f"\nwritten: {OUT_DIR / 'REPORT.txt'}")
        return

    key = api_key()

    if args.cmd in ("coverage", "all"):
        uni = UNIVERSE[:args.limit_tickers] if args.limit_tickers else UNIVERSE
        print(f"[coverage] {len(uni)} tickers, {args.days}d, "
              f"ceiling {CEILING['coverage']} calls")
        m = Massive(key, Budget(CEILING["coverage"], "coverage"))
        # keep raw articles for the image pass, then discard from memory
        raw: dict[str, list] = {}
        orig = m.news_pages

        def capture(params, max_pages, _o=orig, _r=raw):
            arts, tr = _o(params, max_pages)
            _r[params.get("ticker", "?")] = [
                {k: a.get(k) for k in ("image_url", "publisher", "title",
                                       "article_url", "published_utc")}
                for a in arts]
            return arts, tr

        m.news_pages = capture  # type: ignore[method-assign]
        cov = probe_coverage(m, uni, args.days, args.max_pages)
        write_json("coverage.json", cov)
        write_json("raw_articles.json", raw)
        print(f"[coverage] done, {m.budget.used} calls -> {OUT_DIR / 'coverage.json'}")

    if args.cmd in ("history", "all"):
        print(f"[history] ceiling {CEILING['history']} calls")
        m = Massive(key, Budget(CEILING["history"], "history"))
        write_json("history.json", probe_history(m, HISTORY_TICKERS, args.hist_pages))
        print(f"[history] done, {m.budget.used} calls")

    if args.cmd in ("images", "all"):
        print(f"[images] sampling up to {IMAGE_SAMPLE} publisher images (0 API calls)")
        write_json("images.json", probe_images(read_json("coverage.json") or {},
                                               IMAGE_SAMPLE))
        print("[images] done")

    if args.cmd == "verify":
        print("[verify] global corpus + all-time thin-ticker pulls, ceiling 20")
        m = Massive(key, Budget(20, "verify"))
        write_json("verify.json", probe_verify(m, args.verify_pages))
        print(f"[verify] done, {m.budget.used} calls -> {OUT_DIR / 'verify.json'}")
        return

    if args.cmd == "decay":
        print("[decay] quarterly global slices, ceiling 20 calls")
        m = Massive(key, Budget(20, "decay"))
        write_json("decay.json", probe_decay(m))
        print(f"[decay] done, {m.budget.used} calls -> {OUT_DIR / 'decay.json'}")
        return

    if args.cmd == "latency":
        need = args.minutes // args.every + 2
        m = Massive(key, Budget(min(CEILING["latency"], need), "latency"))
        write_json("latency.json", probe_latency(m, args.minutes, args.every, args.page))
        print(f"[latency] done, {m.budget.used} calls")

    print("\n" + render_report())


if __name__ == "__main__":
    main()
