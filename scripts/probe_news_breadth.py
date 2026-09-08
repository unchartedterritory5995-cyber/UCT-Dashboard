"""Bounded validation probe for FINNHUB and FMP company news.

The last source-validation step before the News tab is built. Answers one
question: do either of the two news providers we ALREADY PAY FOR supply the
financial journalism that Massive turned out to lack?

Deliberately reuses probe_massive_news's filters and ticker universe so the
numbers are directly comparable to the Massive run. It only READS.

    FINNHUB_API_KEY and FMP_API_KEY must be in the environment. Never read
    from a file, never printed, never written to disk.

Endpoints (taken from the production clients, not guessed):
    Finnhub  GET https://finnhub.io/api/v1/company-news
             ?symbol=&from=&to=&token=          [55 req/min budget in prod]
    FMP      GET https://financialmodelingprep.com/stable/news/stock
             ?symbols=&limit=&apikey=
    FMP      GET .../stable/news/press-releases  (the company's own wire)

Subcommands
    coverage   per-ticker pull for both providers over 30d
    history    historical depth at 1y and 2y back
    paging     pagination behaviour and caps
    all        all three
    report     render collected JSON

Usage:
    python scripts/probe_news_breadth.py all
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from probe_massive_news import (  # noqa: E402  shared so results compare
    COMMENTARY_RE, JUNK_RE, UNIVERSE, Budget, canon_url, dup_analysis,
    jaccard, parse_ts, pct, shingles, write_json, read_json,
)
import probe_massive_news as PM  # noqa: E402

FH_BASE = "https://finnhub.io/api/v1"
FMP_BASE = "https://financialmodelingprep.com"

OUT_DIR = Path(os.environ.get("PROBE_OUT")
               or (Path(__file__).resolve().parents[1] / "_probe_out"))
PM.OUT_DIR = OUT_DIR

CEILING = 300
FH_PER_MIN = 45.0          # stay under the 55/min production budget
FMP_PER_MIN = 120.0

# Legal-solicitation and paid market-research PR, the two junk families the
# Massive probe surfaced that a commentary detector alone misses.
import re  # noqa: E402

LEGAL_RE = re.compile(
    r"deadline (?:alert|reminder)|shareholders? who lost money|investor news|"
    r"class action|securities (?:fraud|litigation)|urged to contact|"
    r"investigation (?:of|into)|rosen law|glancy|pomerantz|levi & korsinsky|"
    r"bronstein|encouraged to contact|lawsuit deadline|investor alert", re.I)
PR_SPAM_RE = re.compile(
    r"market (?:size|share|report|trends|outlook|analysis|forecast|to reach|research)|"
    r"\bUSD [\d.]+ (?:billion|million|trillion)|\bCAGR\b|"
    r"industry (?:report|analysis|outlook)|\bglobal .{0,40}market\b|"
    r"forecast (?:to|period) 20\d\d|\b20\d\d-20\d\d\b", re.I)


def classify(title: str) -> str | None:
    """Rejection reason for a headline, or None if it survives."""
    t = title or ""
    if LEGAL_RE.search(t):
        return "legal-solicitation"
    if PR_SPAM_RE.search(t):
        return "market-research-PR"
    if COMMENTARY_RE.search(t) or JUNK_RE.search(t):
        return "editorial-commentary"
    return None


# ---------------------------------------------------------------------------
# Company names for the subject-vs-mention test. Massive handed us that signal
# in its reasoning text; Finnhub and FMP do not, so we compute it ourselves --
# which is what production has to do for every source anyway.
# ---------------------------------------------------------------------------
NAMES: dict[str, list[str]] = {
    "AAPL": ["apple"], "MSFT": ["microsoft"], "NVDA": ["nvidia"],
    "META": ["meta platforms", "meta", "facebook"], "GOOGL": ["alphabet", "google"],
    "AMZN": ["amazon"], "MU": ["micron"], "AMD": ["advanced micro", "amd"],
    "TSLA": ["tesla"], "AVGO": ["broadcom"], "INTC": ["intel"],
    "COIN": ["coinbase"], "SMCI": ["super micro", "supermicro"], "ROKU": ["roku"],
    "ONTO": ["onto innovation"], "CRDO": ["credo technology", "credo"],
    "RMBS": ["rambus"], "CROX": ["crocs"], "WING": ["wingstop"], "DECK": ["deckers"],
    "IONQ": ["ionq"], "RGTI": ["rigetti"], "BBAI": ["bigbear"], "SOUN": ["soundhound"],
    "LUNR": ["intuitive machines"], "RKLB": ["rocket lab"], "ASTS": ["ast spacemobile", "ast "],
    "WULF": ["terawulf"], "CIFR": ["cipher mining"], "PLUG": ["plug power"],
    "FCEL": ["fuelcell"], "GEVO": ["gevo"], "VKTX": ["viking therapeutics"],
    "MDGL": ["madrigal"], "CRSP": ["crispr therapeutics", "crispr"],
    "BEAM": ["beam therapeutics"], "NTLA": ["intellia"], "RXRX": ["recursion"],
    "JPM": ["jpmorgan", "jp morgan"], "KO": ["coca-cola", "coca cola"],
    "XOM": ["exxon"], "AR": ["antero resources"], "HON": ["honeywell"],
    "TSM": ["taiwan semiconductor", "tsmc"], "NVO": ["novo nordisk"],
    "BABA": ["alibaba"], "SPY": ["s&p 500", "spdr"], "QQQ": ["nasdaq-100", "invesco qqq"],
    "CAT": ["caterpillar"], "ON": ["on semiconductor", "onsemi"],
    "ALL": ["allstate"],
}


def subject_signal(sym: str, title: str, body: str) -> str:
    """SUBJECT | MENTION | UNKNOWN, from text alone.

    The production Stage 3 heuristic in miniature: a company that is the
    subject of a story is named in its HEADLINE. One that only appears in the
    body is being mentioned. This is deliberately source-agnostic -- it must
    work for SEC, IR, RSS and social too, not just one provider's metadata.
    """
    t = (title or "").lower()
    b = (body or "").lower()
    s = sym.lower()
    names = NAMES.get(sym.upper(), [])
    # The bare SYMBOL only counts as a match in cashtag or parenthesised form.
    # A loose word match on ON / ALL / CAT / AR / WING / BEAM would fire on
    # ordinary English, so identity comes from the company NAME. This
    # deliberately under-counts SUBJECT rather than over-counting it.
    def sym_hit(hay: str) -> bool:
        return f"${s}" in hay or f"({s})" in hay or f"({sym.upper()})" in (hay or "")

    if any(n in t for n in names) or sym_hit(t):
        return "SUBJECT"
    if any(n in b for n in names) or sym_hit(b):
        return "MENTION"
    return "UNKNOWN"


# ---------------------------------------------------------------------------
class Client:
    def __init__(self, budget: Budget) -> None:
        self.budget = budget
        self.http = httpx.Client(
            timeout=httpx.Timeout(connect=5.0, read=25.0, write=10.0, pool=10.0),
            headers={"Accept": "application/json", "User-Agent": "UCT-news-probe/1.0"})
        self.errors: list[str] = []
        self.ms: dict[str, list[float]] = defaultdict(list)
        self._last: dict[str, float] = {}
        self.limit_events: list[str] = []

    def _pace(self, who: str, per_min: float) -> None:
        gap = 60.0 / per_min
        last = self._last.get(who, 0.0)
        wait = gap - (time.time() - last)
        if wait > 0:
            time.sleep(wait)
        self._last[who] = time.time()

    def get(self, who: str, url: str, params: dict, per_min: float) -> Any:
        self.budget.spend()
        self._pace(who, per_min)
        for attempt in range(3):
            t0 = time.time()
            try:
                r = self.http.get(url, params=params)
                if r.status_code == 429:
                    self.limit_events.append(f"{who} 429 after {self.budget.used} calls")
                    time.sleep(5 + attempt * 5)
                    continue
                r.raise_for_status()
                self.ms[who].append((time.time() - t0) * 1000)
                return r.json()
            except httpx.HTTPStatusError as e:
                body = ""
                try:
                    body = e.response.text[:160]
                except Exception:
                    pass
                self.errors.append(f"{who} {e.response.status_code} {body}")
                if e.response.status_code in (401, 403):
                    self.limit_events.append(f"{who} {e.response.status_code} AUTH/PLAN: {body}")
                if e.response.status_code < 500:
                    return None
                time.sleep(1 + attempt)
            except httpx.HTTPError as e:
                self.errors.append(f"{who} {type(e).__name__} {e}")
                time.sleep(1 + attempt)
        return None


# ---------------------------------------------------------------------------
# normalization: one shape for both providers
# ---------------------------------------------------------------------------
def norm_finnhub(rows: Any) -> list[dict]:
    out = []
    for r in rows or []:
        ts = r.get("datetime")
        try:
            iso = datetime.fromtimestamp(int(ts), timezone.utc).isoformat() if ts else None
        except Exception:
            iso = None
        out.append({
            "id": str(r.get("id") or r.get("url") or ""),
            "title": r.get("headline") or "",
            "body": r.get("summary") or "",
            "source": r.get("source") or "?",
            "url": r.get("url") or "",
            "image": r.get("image") or "",
            "published_utc": iso,
            "category": r.get("category") or "",
            "related": [x for x in (r.get("related") or "").split(",") if x],
        })
    return out


def norm_fmp(rows: Any) -> list[dict]:
    out = []
    if isinstance(rows, dict):
        rows = rows.get("content") or rows.get("data") or []
    for r in rows or []:
        d = r.get("publishedDate") or r.get("date") or ""
        iso = None
        p = parse_ts(d.replace(" ", "T") if d and "T" not in d else d)
        if p:
            iso = p.isoformat()
        out.append({
            "id": str(r.get("url") or ""),
            "title": r.get("title") or "",
            "body": r.get("text") or r.get("snippet") or "",
            "source": r.get("publisher") or r.get("site") or "?",
            "url": r.get("url") or "",
            "image": r.get("image") or "",
            "published_utc": iso,
            "category": "",
            "related": [x for x in [r.get("symbol")] if x],
        })
    return out


def profile(sym: str, arts: list[dict], now: datetime) -> dict[str, Any]:
    n24 = n7 = n30 = 0
    desc = img = url_ok = 0
    src = Counter()
    rej = Counter()
    subj = Counter()
    newest = None
    body_lens: list[int] = []
    keep_titles: list[str] = []
    rej_titles: list[tuple[str, str]] = []
    for a in arts:
        ts = parse_ts(a["published_utc"])
        if ts:
            age = now - ts
            if age <= timedelta(hours=24):
                n24 += 1
            if age <= timedelta(days=7):
                n7 += 1
            if age <= timedelta(days=30):
                n30 += 1
            if newest is None or ts > newest:
                newest = ts
        if a["body"]:
            desc += 1
            body_lens.append(len(a["body"]))
        if a["image"]:
            img += 1
        if a["url"]:
            url_ok += 1
        src[a["source"]] += 1
        r = classify(a["title"])
        if r:
            rej[r] += 1
            if len(rej_titles) < 4:
                rej_titles.append((r, a["title"][:100]))
        else:
            if len(keep_titles) < 6:
                keep_titles.append(a["title"][:100])
        subj[subject_signal(sym, a["title"], a["body"])] += 1
    n = len(arts)
    return {
        "total": n, "n_24h": n24, "n_7d": n7, "n_30d": n30,
        "newest": newest.isoformat() if newest else None,
        "newest_age_hours": round((now - newest).total_seconds() / 3600, 1) if newest else None,
        "pct_body": pct(desc, n), "pct_image": pct(img, n), "pct_url": pct(url_ok, n),
        "median_body_len": sorted(body_lens)[len(body_lens) // 2] if body_lens else 0,
        "sources": src.most_common(10), "distinct_sources": len(src),
        "rejected": dict(rej), "reject_pct": pct(sum(rej.values()), n),
        "subject": dict(subj),
        "subject_pct": pct(subj.get("SUBJECT", 0), n),
        "mention_pct": pct(subj.get("MENTION", 0), n),
        "unknown_pct": pct(subj.get("UNKNOWN", 0), n),
        "dupes": dup_analysis([{"title": a["title"], "article_url": a["url"],
                                "published_utc": a["published_utc"],
                                "publisher": {"name": a["source"]}} for a in arts]) if n else {},
        "keep_samples": keep_titles, "reject_samples": rej_titles,
    }


# ---------------------------------------------------------------------------
def probe_coverage(c: Client, fh_key: str, fmp_key: str,
                   tickers: list[tuple[str, str]], days: int) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    frm = (now - timedelta(days=days)).date().isoformat()
    to = now.date().isoformat()
    out: dict[str, Any] = {"run_at": now.isoformat(), "window_days": days,
                           "finnhub": {}, "fmp_stock": {}, "fmp_pr": {}}
    raw: dict[str, Any] = {"finnhub": {}, "fmp_stock": {}, "fmp_pr": {}}

    for sym, prof in tickers:
        fh = norm_finnhub(c.get("finnhub", f"{FH_BASE}/company-news",
                                {"symbol": sym, "from": frm, "to": to,
                                 "token": fh_key}, FH_PER_MIN))
        fs = norm_fmp(c.get("fmp", f"{FMP_BASE}/stable/news/stock",
                            {"symbols": sym, "limit": 250, "apikey": fmp_key},
                            FMP_PER_MIN))
        fp = norm_fmp(c.get("fmp", f"{FMP_BASE}/stable/news/press-releases",
                            {"symbols": sym, "limit": 100, "apikey": fmp_key},
                            FMP_PER_MIN))
        for name, arts in (("finnhub", fh), ("fmp_stock", fs), ("fmp_pr", fp)):
            d = profile(sym, arts, now)
            d["profile"] = prof
            out[name][sym] = d
            raw[name][sym] = [{k: a.get(k) for k in
                               ("title", "source", "url", "image", "published_utc", "body")}
                              for a in arts[:40]]
        print(f"  {sym:6s} {prof:10s} FH={len(fh):4d} FMP={len(fs):4d} PR={len(fp):3d} "
              f"| FHrej={out['finnhub'][sym]['reject_pct']:5.1f}% "
              f"FMPrej={out['fmp_stock'][sym]['reject_pct']:5.1f}% "
              f"[{c.budget.used}/{c.budget.limit}]", flush=True)

    out["requests_used"] = c.budget.used
    out["errors"] = c.errors[:20]
    out["limit_events"] = c.limit_events[:20]
    out["median_ms"] = {k: (sorted(v)[len(v) // 2] if v else None) for k, v in c.ms.items()}
    write_json("breadth_raw.json", raw)
    return out


def probe_history(c: Client, fh_key: str, fmp_key: str) -> dict[str, Any]:
    """How far back does each provider actually serve?"""
    now = datetime.now(timezone.utc)
    res: dict[str, Any] = {"run_at": now.isoformat(), "windows": {}}
    for label, back in (("1y", 365), ("2y", 730), ("3y", 1095)):
        a = (now - timedelta(days=back)).date()
        b = (now - timedelta(days=back - 7)).date()
        row: dict[str, Any] = {"from": a.isoformat(), "to": b.isoformat()}
        for sym in ("AAPL", "MU", "RKLB"):
            fh = norm_finnhub(c.get("finnhub", f"{FH_BASE}/company-news",
                                    {"symbol": sym, "from": a.isoformat(),
                                     "to": b.isoformat(), "token": fh_key}, FH_PER_MIN))
            fm = norm_fmp(c.get("fmp", f"{FMP_BASE}/stable/news/stock",
                                {"symbols": sym, "from": a.isoformat(),
                                 "to": b.isoformat(), "limit": 250,
                                 "apikey": fmp_key}, FMP_PER_MIN))
            in_win = sum(1 for x in fm if (p := parse_ts(x["published_utc"]))
                         and a <= p.date() <= b)
            row[sym] = {"finnhub": len(fh), "fmp_returned": len(fm),
                        "fmp_in_window": in_win}
            print(f"  {label} {sym:6s} FH={len(fh):4d} "
                  f"FMP={len(fm):4d} (in-window {in_win})", flush=True)
        res["windows"][label] = row
    res["requests_used"] = c.budget.used
    return res


def probe_paging(c: Client, fh_key: str, fmp_key: str) -> dict[str, Any]:
    """Caps and pagination. Massive's cursor was broken; check these."""
    res: dict[str, Any] = {"run_at": datetime.now(timezone.utc).isoformat()}
    # FMP: does `page` advance, and does `limit` cap?
    pages = []
    seen: set[str] = set()
    for p in range(3):
        rows = norm_fmp(c.get("fmp", f"{FMP_BASE}/stable/news/stock",
                              {"symbols": "AAPL", "limit": 100, "page": p,
                               "apikey": fmp_key}, FMP_PER_MIN))
        ids = [r["id"] for r in rows]
        new = sum(1 for i in ids if i not in seen)
        seen.update(ids)
        ts = sorted(t for t in (parse_ts(r["published_utc"]) for r in rows) if t)
        pages.append({"page": p, "n": len(rows), "new": new,
                      "newest": ts[-1].isoformat() if ts else None,
                      "oldest": ts[0].isoformat() if ts else None})
        print(f"  fmp page={p} n={len(rows)} new={new}", flush=True)
    res["fmp_paging"] = pages
    res["fmp_paging_works"] = all(p["new"] > 0 for p in pages[1:]) if len(pages) > 1 else None

    # FMP limit ceiling
    caps = {}
    for lim in (250, 1000):
        rows = norm_fmp(c.get("fmp", f"{FMP_BASE}/stable/news/stock",
                              {"symbols": "AAPL", "limit": lim, "apikey": fmp_key},
                              FMP_PER_MIN))
        caps[str(lim)] = len(rows)
        print(f"  fmp limit={lim} -> {len(rows)}", flush=True)
    res["fmp_limit_caps"] = caps

    # Finnhub: date-window only, no paging. Measure the per-window cap.
    now = datetime.now(timezone.utc)
    fh_caps = {}
    for days in (7, 30, 90):
        a = (now - timedelta(days=days)).date().isoformat()
        rows = norm_finnhub(c.get("finnhub", f"{FH_BASE}/company-news",
                                  {"symbol": "AAPL", "from": a,
                                   "to": now.date().isoformat(),
                                   "token": fh_key}, FH_PER_MIN))
        fh_caps[f"{days}d"] = len(rows)
        print(f"  finnhub window={days}d -> {len(rows)}", flush=True)
    res["finnhub_window_caps"] = fh_caps
    res["requests_used"] = c.budget.used
    return res


# ---------------------------------------------------------------------------
def render() -> str:
    cov = read_json("coverage_breadth.json")
    hist = read_json("history_breadth.json")
    pag = read_json("paging_breadth.json")
    L: list[str] = []
    add = L.append
    add("=" * 78)
    add("FINNHUB / FMP BREADTH PROBE")
    add("=" * 78)
    if not cov:
        add("no coverage data")
        return "\n".join(L)

    order = ["mega", "large", "mid", "small", "biotech", "financial", "staples",
             "energy", "industrial", "adr", "etf", "collision"]
    for lane, label in (("finnhub", "FINNHUB company-news"),
                        ("fmp_stock", "FMP /news/stock"),
                        ("fmp_pr", "FMP /news/press-releases")):
        t = cov[lane]
        add("")
        add(f"-- {label} " + "-" * max(0, 60 - len(label)))
        add(f"   {'SYM':6s} {'PROF':10s} {'30d':>5s} {'7d':>5s} {'24h':>4s} "
            f"{'AGE':>7s} {'BODY%':>6s} {'IMG%':>6s} {'REJ%':>6s} {'SUBJ%':>6s} {'DUP%':>5s}")
        for prof in order:
            rows = [(s, d) for s, d in t.items() if d.get("profile") == prof]
            if not rows:
                continue
            for s, d in rows:
                age = d["newest_age_hours"]
                add(f"   {s:6s} {prof:10s} {d['n_30d']:5d} {d['n_7d']:5d} {d['n_24h']:4d} "
                    f"{(str(age) + 'h') if age is not None else '   -':>7s} "
                    f"{d['pct_body']:6.1f} {d['pct_image']:6.1f} {d['reject_pct']:6.1f} "
                    f"{d['subject_pct']:6.1f} {d.get('dupes', {}).get('dupe_rate_pct', 0):5.1f}")
            n30 = [d["n_30d"] for _, d in rows]
            add(f"   {'':6s} {'= ' + prof:10s} med30={sorted(n30)[len(n30) // 2]:5d} "
                f"rej={sum(d['reject_pct'] for _, d in rows) / len(rows):5.1f}% "
                f"subj={sum(d['subject_pct'] for _, d in rows) / len(rows):5.1f}% "
                f"zero={sum(1 for v in n30 if v == 0)}/{len(rows)}")
            add("")
        allsrc = Counter()
        rej = Counter()
        subj = Counter()
        tot = 0
        for d in t.values():
            for s, n in d["sources"]:
                allsrc[s] += n
            for k, v in d["rejected"].items():
                rej[k] += v
            for k, v in d["subject"].items():
                subj[k] += v
            tot += d["total"]
        add(f"   TOTAL articles {tot}, distinct sources {len(allsrc)}")
        add(f"   top sources: {allsrc.most_common(12)}")
        add(f"   rejected: {dict(rej)}  = {pct(sum(rej.values()), tot)}%")
        add(f"   subject: {dict(subj)}  SUBJECT={pct(subj.get('SUBJECT', 0), tot)}% "
            f"MENTION={pct(subj.get('MENTION', 0), tot)}% "
            f"UNKNOWN={pct(subj.get('UNKNOWN', 0), tot)}%")

    if hist:
        add("")
        add("-- HISTORICAL DEPTH " + "-" * 56)
        for label, row in hist["windows"].items():
            add(f"   {label} ({row['from']} .. {row['to']})")
            for s in ("AAPL", "MU", "RKLB"):
                d = row.get(s, {})
                add(f"     {s:6s} finnhub={d.get('finnhub')} "
                    f"fmp_returned={d.get('fmp_returned')} "
                    f"fmp_in_window={d.get('fmp_in_window')}")
    if pag:
        add("")
        add("-- PAGINATION / CAPS " + "-" * 55)
        add(f"   fmp paging works: {pag.get('fmp_paging_works')}")
        for p in pag.get("fmp_paging", []):
            add(f"     page={p['page']} n={p['n']} new={p['new']} "
                f"{str(p['oldest'])[:16]} .. {str(p['newest'])[:16]}")
        add(f"   fmp limit caps: {pag.get('fmp_limit_caps')}")
        add(f"   finnhub window caps: {pag.get('finnhub_window_caps')}")
    add("")
    add(f"requests used: {cov.get('requests_used')}   "
        f"median ms: {cov.get('median_ms')}")
    if cov.get("limit_events"):
        add(f"RATE/PLAN EVENTS: {cov['limit_events']}")
    if cov.get("errors"):
        add(f"errors (first 5): {cov['errors'][:5]}")
    add("=" * 78)
    return "\n".join(L)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["coverage", "history", "paging", "all", "report"])
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--limit-tickers", type=int, default=0)
    args = ap.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.cmd == "report":
        txt = render()
        print(txt)
        (OUT_DIR / "BREADTH_REPORT.txt").write_text(txt, encoding="utf-8")
        return

    fh_key = (os.environ.get("FINNHUB_API_KEY") or "").strip()
    fmp_key = (os.environ.get("FMP_API_KEY") or "").strip()
    missing = [n for n, v in (("FINNHUB_API_KEY", fh_key), ("FMP_API_KEY", fmp_key)) if not v]
    if missing:
        sys.exit(f"missing env: {', '.join(missing)}. Never read from a file; set them and re-run.")

    c = Client(Budget(CEILING, "breadth"))
    if args.cmd in ("coverage", "all"):
        uni = UNIVERSE[:args.limit_tickers] if args.limit_tickers else UNIVERSE
        print(f"[coverage] {len(uni)} tickers x 3 endpoints, ceiling {CEILING}")
        write_json("coverage_breadth.json",
                   probe_coverage(c, fh_key, fmp_key, uni, args.days))
    if args.cmd in ("history", "all"):
        print("[history]")
        write_json("history_breadth.json", probe_history(c, fh_key, fmp_key))
    if args.cmd in ("paging", "all"):
        print("[paging]")
        write_json("paging_breadth.json", probe_paging(c, fh_key, fmp_key))
    print(f"\n[done] {c.budget.used} calls\n")
    print(render())


if __name__ == "__main__":
    main()
