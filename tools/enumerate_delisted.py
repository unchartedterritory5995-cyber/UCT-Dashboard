"""Enumerate every delisted US common stock from Massive → build the bulk delisted registry.

Regenerates api/data/delisted_tickers_bulk.json (loaded by api/services/delisted_registry).
Reuse-aware keys + date-clamped by construction (last_date on every entry), so a reused
symbol's eras can never combine and a live ticker is never mislabeled.

Run with the Massive key in the environment (e.g. `railway run --service web -- python
tools/enumerate_delisted.py`). Read-only against the provider; writes one local JSON file.
"""
import os
import json
import time
import urllib.request
import urllib.error

_HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(_HERE, "..", "api", "data", "delisted_tickers_bulk.json")
KEY = os.environ.get("MASSIVE_API_KEY", "")
BASE = "https://api.massive.com"
FLOOR = "2004-01-01"   # provider daily floor ~2003-09; require real chartable history

# The hand-curated seed (delisted_tickers.json) owns these provider symbols with real
# sector/industry — bulk skips them so the curated versions win.
SEED_PROVIDERS = {"YHOO", "TWTR", "CELG", "ATVI", "LEH", "BSC"}
MAJOR_EXCH = {"XNYS", "XNAS", "XASE", "ARCX", "BATS", "IEXG", "XNGS", "XNMS", "XNCM"}


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(1.5 * (attempt + 1)); continue
            raise
        except Exception:
            time.sleep(1.0 * (attempt + 1))
    return {}


def paginate(url, cap=400):
    out = []
    for _ in range(cap):
        data = _get(url)
        out.extend(data.get("results") or [])
        nxt = data.get("next_url")
        if not nxt:
            break
        url = nxt + (f"&apiKey={KEY}" if "apiKey=" not in nxt else "")
    return out


def main():
    if not KEY:
        raise SystemExit("MASSIVE_API_KEY not set")
    live = set()
    for r in paginate(f"{BASE}/v3/reference/tickers?active=true&market=stocks&limit=1000&apiKey={KEY}"):
        t = (r.get("ticker") or "").upper()
        if t:
            live.add(t)
    delisted = paginate(f"{BASE}/v3/reference/tickers?active=false&market=stocks&type=CS&limit=1000&apiKey={KEY}")

    by_sym = {}
    for r in delisted:
        sym = (r.get("ticker") or "").upper()
        name = r.get("name")
        dl = (r.get("delisted_utc") or "")[:10]
        exch = r.get("primary_exchange") or ""
        if not sym or not name or not dl or dl < FLOOR:
            continue
        if exch and exch not in MAJOR_EXCH:
            continue
        if sym in SEED_PROVIDERS:
            continue
        nm = name.upper()
        if ("WHEN ISSUED" in nm or "WHEN-ISSUED" in nm or "W.I." in nm
                or nm.endswith(" WI") or "TEST STOCK" in nm or nm.startswith("ZZ")):
            continue
        by_sym.setdefault(sym, []).append({"name": name, "delisted_date": dl})

    entries = []
    for sym, lst in by_sym.items():
        seen, uniq = set(), []
        for e in lst:
            k = (e["name"].strip().upper(), e["delisted_date"][:4])
            if k in seen:
                continue
            seen.add(k); uniq.append(e)
        bare_live = sym in live          # the bare symbol is a CURRENTLY-LIVE ticker
        reused = bare_live or (len(uniq) > 1)
        year_ct = {}
        for e in uniq:
            if reused:
                base = f"{sym}-{e['delisted_date'][:4]}"
                n = year_ct.get(base, 0); year_ct[base] = n + 1
                key = base if n == 0 else f"{base}-{n + 1}"
            else:
                key = sym
            rec = {
                "ticker": key, "provider_symbol": sym, "name": e["name"],
                "delisted_date": e["delisted_date"], "last_date": e["delisted_date"],
                "source": "massive",
            }
            # Mark when the bare symbol is a live ticker — the registry then must NOT alias
            # the bare symbol to this dead entity (that would mislabel the live one).
            if bare_live:
                rec["bare_live"] = True
            entries.append(rec)

    entries.sort(key=lambda x: x["ticker"])
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(entries, fh, separators=(",", ":"))
    print(f"wrote {len(entries)} delisted entries -> {OUT}")


if __name__ == "__main__":
    main()
