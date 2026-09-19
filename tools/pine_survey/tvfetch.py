"""
tvfetch.py — acquisition tool for the TradingView Pine indicator survey.

Reads only PUBLIC, unauthenticated TradingView endpoints:
  * enumeration : https://www.tradingview.com/pubscripts-suggest-json/?search=<q>
  * source      : https://pine-facade.tradingview.com/pine-facade/get/<PUB;id>/last
  * builtins    : https://pine-facade.tradingview.com/pine-facade/list/?filter=standard

Politeness: sequential, fixed delay between requests, retries with backoff.
Idempotent: re-running skips anything already on disk.

Subcommands:
  enumerate   build catalog.json from the query vocabulary
  builtins    fetch the platform's built-in indicator list
  fetch       download source for open-source scripts in the catalog
  status      print counts
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = HERE
SRC_DIR = os.path.join(OUT, "sources")
CATALOG = os.path.join(OUT, "catalog.json")
BUILTINS = os.path.join(OUT, "builtins.json")
FETCHLOG = os.path.join(OUT, "fetch_log.json")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
DELAY = 0.35

SUGGEST = "https://www.tradingview.com/pubscripts-suggest-json/?search="
FACADE_GET = "https://pine-facade.tradingview.com/pine-facade/get/"
FACADE_LIST = "https://pine-facade.tradingview.com/pine-facade/list/?filter=standard"

# Query vocabulary — spans every category named in the survey brief.
QUERIES = [
    # trend
    "supertrend", "moving average", "ema ribbon", "trend following", "hull moving average",
    "ichimoku", "parabolic sar", "adx", "donchian", "linear regression channel",
    "trend strength", "zigzag", "half trend", "range filter", "kaufman adaptive",
    # momentum
    "rsi", "macd", "stochastic", "momentum oscillator", "cci", "williams %r",
    "rate of change", "awesome oscillator", "tsi", "squeeze momentum",
    "divergence", "rsi divergence", "wavetrend", "qqe", "connors rsi",
    # volatility
    "bollinger bands", "keltner channel", "atr", "volatility", "standard deviation",
    "chandelier exit", "vix fix", "historical volatility", "bollinger band width",
    # volume
    "volume profile", "vwap", "anchored vwap", "on balance volume", "money flow",
    "volume delta", "accumulation distribution", "chaikin", "cumulative volume delta",
    "relative volume", "volume weighted", "footprint",
    # breadth / market internals
    "market breadth", "advance decline", "mcclellan", "breadth thrust", "sector rotation",
    "relative strength comparison", "correlation matrix",
    # market structure / smart money
    "market structure", "break of structure", "change of character", "order block",
    "fair value gap", "imbalance", "liquidity", "liquidity void", "smart money concepts",
    "supply and demand", "premium discount", "ict", "inner circle trader", "swing high low",
    "equal highs lows", "displacement", "mitigation block", "breaker block",
    # order flow / heatmaps
    "order flow", "liquidation", "heatmap", "open interest", "funding rate", "delta volume",
    "auction", "market profile", "tpo",
    # patterns
    "candlestick patterns", "engulfing", "doji", "pin bar", "inside bar",
    "harmonic patterns", "gartley", "elliott wave", "chart patterns", "head and shoulders",
    "triangle pattern", "wedge pattern", "double top", "cup and handle", "flag pattern",
    # support / resistance
    "support and resistance", "pivot points", "fibonacci retracement", "fibonacci levels",
    "trendline", "auto trendline", "horizontal levels", "round numbers", "camarilla",
    # sessions / time
    "session", "killzone", "opening range", "asian session", "london session",
    "new york session", "time of day", "day separator", "week separator", "previous day high low",
    # dashboards / multi-timeframe
    "dashboard", "screener", "multi timeframe", "mtf dashboard", "table", "watchlist",
    "heat table", "scanner", "multi symbol", "info panel", "statistics table",
    # machine learning styled
    "machine learning", "knn", "neural network", "kernel regression",
    "nadaraya watson", "clustering", "k means", "lorentzian",
    # visual / decoration
    "gradient", "colored candles", "heikin ashi", "renko", "candle coloring",
    "background color", "rainbow", "3d", "visual", "art",
    # risk / position
    "risk reward", "position size", "stop loss", "take profit", "trailing stop",
    # author-flavoured probes (titles usually carry the tag)
    "LuxAlgo", "ChartPrime", "Zeiierman", "BigBeluga", "AlgoAlpha", "BackQuant",
    "LonesomeTheBlue", "HPotter", "jdehorty", "KivancOzbilgic", "LazyBear",
    "TradingView", "loxx", "everget", "QuantNomad", "Fractalyst",
]


def http_get(url, tries=3):
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "en-US,en;q=0.9",
            })
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise last


def load(path, default):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return default


def save(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1, ensure_ascii=False)
    os.replace(tmp, path)


def cmd_enumerate():
    catalog = load(CATALOG, {})
    done = load(os.path.join(OUT, "queries_done.json"), [])
    done = set(done)
    for i, q in enumerate(QUERIES, 1):
        if q in done:
            continue
        try:
            raw = http_get(SUGGEST + urllib.parse.quote(q))
            data = json.loads(raw)
        except Exception as e:  # noqa: BLE001
            print("QUERY FAIL %-32s %s" % (q, e), flush=True)
            continue
        results = data.get("results", []) or []
        new = 0
        for s in results:
            sid = s.get("scriptIdPart")
            if not sid:
                continue
            if sid not in catalog:
                new += 1
                catalog[sid] = {
                    "scriptIdPart": sid,
                    "title": s.get("title"),
                    "scriptName": s.get("scriptName"),
                    "shortTitle": s.get("shortTitle"),
                    "author": (s.get("author") or {}).get("username"),
                    "agreeCount": s.get("agreeCount"),
                    "access": s.get("access"),
                    "editorsPick": s.get("editorsPick"),
                    "isRecommended": s.get("isRecommended"),
                    "imageUrl": s.get("imageUrl"),
                    "version": s.get("version"),
                    "type": s.get("type"),
                    "weight": s.get("weight"),
                    "extra": s.get("extra"),
                    "found_by": [q],
                }
            else:
                fb = catalog[sid].setdefault("found_by", [])
                if q not in fb:
                    fb.append(q)
        done.add(q)
        print("[%3d/%3d] %-34s results=%-3d new=%-3d total=%d"
              % (i, len(QUERIES), q, len(results), new, len(catalog)), flush=True)
        save(CATALOG, catalog)
        save(os.path.join(OUT, "queries_done.json"), sorted(done))
        time.sleep(DELAY)
    print("\nENUMERATE DONE unique_scripts=%d" % len(catalog))


def cmd_builtins():
    raw = http_get(FACADE_LIST)
    data = json.loads(raw)
    save(BUILTINS, data)
    print("builtins fetched: %d" % len(data))
    kinds = {}
    for b in data:
        k = (b.get("extra") or {}).get("kind")
        kinds[k] = kinds.get(k, 0) + 1
    print("kinds:", kinds)


LICENSE_HINTS = [
    ("MPL-2.0", "mozilla public license"),
    ("MPL-2.0", "mozilla.org/mpl"),
    ("GPL-3.0", "gnu general public license v3"),
    ("GPL-3.0", "gpl-3"),
    ("GPL", "gnu general public license"),
    ("CC-BY-NC-SA", "creativecommons.org/licenses/by-nc-sa"),
    ("CC-BY-NC-ND", "creativecommons.org/licenses/by-nc-nd"),
    ("CC-BY-NC", "creativecommons.org/licenses/by-nc"),
    ("CC-BY-SA", "creativecommons.org/licenses/by-sa"),
    ("CC-BY", "creativecommons.org/licenses/by/"),
    ("MIT", "mit license"),
    ("Apache-2.0", "apache license"),
]


def detect_license(src):
    head = "\n".join(src.splitlines()[:40]).lower()
    hits = []
    for name, needle in LICENSE_HINTS:
        if needle in head and name not in hits:
            hits.append(name)
    return hits[0] if hits else "NONE-IN-SOURCE (TV default MPL-2.0)"


def safe_slug(sid, title):
    base = (title or sid or "script")
    keep = []
    for ch in base:
        if ch.isalnum():
            keep.append(ch.lower())
        elif ch in " -_":
            keep.append("-")
    slug = "".join(keep).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    slug = slug[:70] or "script"
    tail = sid.split(";")[-1][:10]
    return "%s__%s" % (slug, tail)


def cmd_fetch(limit=None):
    catalog = load(CATALOG, {})
    log = load(FETCHLOG, {})
    os.makedirs(SRC_DIR, exist_ok=True)
    # open-source first, most-boosted first
    items = [v for v in catalog.values() if v.get("access") == 1]
    items.sort(key=lambda v: -(v.get("agreeCount") or 0))
    if limit:
        items = items[:int(limit)]
    ok = skip = fail = 0
    for i, v in enumerate(items, 1):
        sid = v["scriptIdPart"]
        if sid in log and log[sid].get("status") == "ok":
            skip += 1
            continue
        url = FACADE_GET + urllib.parse.quote(sid, safe="") + "/last"
        try:
            data = json.loads(http_get(url))
        except Exception as e:  # noqa: BLE001
            log[sid] = {"status": "error", "error": str(e)[:200]}
            fail += 1
            print("[%4d/%4d] FAIL %s %s" % (i, len(items), sid, str(e)[:80]), flush=True)
            save(FETCHLOG, log)
            time.sleep(DELAY)
            continue
        if isinstance(data, list):
            data = data[0] if data else {}
        src = data.get("source") or ""
        access = data.get("scriptAccess")
        if not src or access != "open_no_auth":
            log[sid] = {"status": "not_open", "scriptAccess": access, "len": len(src)}
            skip += 1
            time.sleep(DELAY)
            continue
        slug = safe_slug(sid, v.get("title"))
        path = os.path.join(SRC_DIR, slug + ".pine")
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(src)
        log[sid] = {
            "status": "ok",
            "slug": slug,
            "path": path,
            "scriptAccess": access,
            "chars": len(src),
            "lines": len(src.splitlines()),
            "license": detect_license(src),
            "scriptName": data.get("scriptName"),
            "version": data.get("version"),
        }
        ok += 1
        if ok % 25 == 0:
            save(FETCHLOG, log)
            print("[%4d/%4d] ok=%d skip=%d fail=%d" % (i, len(items), ok, skip, fail), flush=True)
        time.sleep(DELAY)
    save(FETCHLOG, log)
    print("\nFETCH DONE ok=%d skip=%d fail=%d  (files in %s)" % (ok, skip, fail, SRC_DIR))


def cmd_status():
    catalog = load(CATALOG, {})
    log = load(FETCHLOG, {})
    acc = {}
    for v in catalog.values():
        a = v.get("access")
        acc[a] = acc.get(a, 0) + 1
    okn = sum(1 for v in log.values() if v.get("status") == "ok")
    print("catalog scripts : %d" % len(catalog))
    print("access breakdown: %s   (1=open, 2=protected, 3=invite-only)" % acc)
    print("sources fetched : %d" % okn)
    print("editors picks   : %d" % sum(1 for v in catalog.values() if v.get("editorsPick")))
    if os.path.isdir(SRC_DIR):
        print("files on disk   : %d" % len([f for f in os.listdir(SRC_DIR) if f.endswith(".pine")]))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    arg = sys.argv[2] if len(sys.argv) > 2 else None
    {"enumerate": cmd_enumerate, "builtins": cmd_builtins,
     "fetch": lambda: cmd_fetch(arg), "status": cmd_status}[cmd]()
