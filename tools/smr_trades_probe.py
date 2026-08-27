"""One-off: reconstruct TRUE bid/ask side for SMR $11P 10/16/26 prints on 2026-08-25.

Pulls raw /v3/trades + /v3/quotes (NBBO) from Massive and classifies each print by
comparing its price to the prevailing NBBO — the same thing BlackBox does — independent
of our Q-pool side coverage. Run via:  railway run --service flow-worker -- python tools/smr_trades_probe.py
"""
import json, os, urllib.parse, urllib.request
from datetime import datetime, timezone, timedelta
from bisect import bisect_right

OCC = "O:SMR261016P00011000"
KEY = os.environ["MASSIVE_API_KEY"]
BASE = os.environ.get("MASSIVE_REST_BASE", "https://api.massive.com")
UA = {"User-Agent": "UCT-Massive/1.0 (+https://uctintelligence.com)"}

# window: 2026-08-25 17:15:00Z .. 18:00:00Z  (= 1:15p .. 2:00p ET, EDT)
t0 = datetime(2026, 8, 25, 17, 15, 0, tzinfo=timezone.utc)
t1 = datetime(2026, 8, 25, 18, 0, 0, tzinfo=timezone.utc)
NS0, NS1 = int(t0.timestamp() * 1e9), int(t1.timestamp() * 1e9)
ET = timezone(timedelta(hours=-4))  # EDT


def _get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)


def _page(kind):
    """kind = 'trades' or 'quotes'. Return all results in the ns window."""
    url = (f"{BASE}/v3/{kind}/{urllib.parse.quote(OCC)}"
           f"?timestamp.gte={NS0}&timestamp.lte={NS1}&order=asc&limit=50000"
           f"&apiKey={urllib.parse.quote(KEY)}")
    out = []
    for _ in range(40):
        d = _get(url)
        out.extend(d.get("results") or [])
        nxt = d.get("next_url")
        if not nxt:
            break
        url = nxt + (("&" if "?" in nxt else "?") + "apiKey=" + urllib.parse.quote(KEY))
    return out


def ns_to_et(ns):
    return datetime.fromtimestamp(ns / 1e9, tz=timezone.utc).astimezone(ET).strftime("%H:%M:%S")


COND = {219: "ISOI(SWEEP)", 227: "SLAN", 228: "SLAI", 229: "SLCN", 230: "SLCI",
        231: "SLFT", 209: "AUTO"}


def main():
    trades = _page("trades")
    quotes = _page("quotes")
    print(f"trades={len(trades)} quotes={len(quotes)} in window {ns_to_et(NS0)}-{ns_to_et(NS1)} ET")
    if not trades:
        print("NO TRADES — check OCC / window")
        return
    q_ts = [q.get("sip_timestamp", 0) for q in quotes]

    def nbbo_at(ts):
        i = bisect_right(q_ts, ts) - 1
        if i < 0:
            return None, None
        q = quotes[i]
        return q.get("bid_price"), q.get("ask_price")

    buckets = {"BID": [0, 0.0], "ASK": [0, 0.0], "BID-lean": [0, 0.0],
               "ASK-lean": [0, 0.0], "MID": [0, 0.0], "NO-NBBO": [0, 0.0]}
    rows = []
    tot_prem = 0.0
    for t in trades:
        ts = t.get("sip_timestamp", 0)
        px = t.get("price") or 0
        sz = t.get("size") or 0
        prem = px * sz * 100
        tot_prem += prem
        bp, ap = nbbo_at(ts)
        if bp is None or ap is None:
            side = "NO-NBBO"
        else:
            mid = (bp + ap) / 2
            if px <= bp + 1e-9:
                side = "BID"
            elif px >= ap - 1e-9:
                side = "ASK"
            elif px < mid:
                side = "BID-lean"
            elif px > mid:
                side = "ASK-lean"
            else:
                side = "MID"
        buckets[side][0] += 1
        buckets[side][1] += prem
        conds = t.get("conditions") or []
        clabel = ",".join(COND.get(c, str(c)) for c in conds) or "-"
        rows.append((ns_to_et(ts), sz, px, bp, ap, side, clabel))

    # only print size-relevant prints (>= 100 ct) to keep it readable, but count all
    print(f"\nTOTAL premium (all {len(trades)} prints): ${tot_prem/1e6:.2f}M")
    print("\nBY TRUE SIDE (count | premium):")
    for k, (n, p) in buckets.items():
        if n:
            print(f"  {k:9s}  {n:4d}  ${p/1e6:.3f}M")
    bid_prem = buckets["BID"][1] + buckets["BID-lean"][1]
    ask_prem = buckets["ASK"][1] + buckets["ASK-lean"][1]
    print(f"\nBID-side (put SELLING / bullish-neutral): ${bid_prem/1e6:.3f}M")
    print(f"ASK-side (put BUYING / bearish):          ${ask_prem/1e6:.3f}M")

    print("\nPRINTS >= 100 ct  (time ET | size | px | bid | ask | side | conds):")
    for r in rows:
        if r[1] >= 100:
            print(f"  {r[0]}  {r[1]:5d} @{r[2]:.3f}  bid={r[3]} ask={r[4]}  {r[5]:8s}  {r[6]}")


if __name__ == "__main__":
    main()
