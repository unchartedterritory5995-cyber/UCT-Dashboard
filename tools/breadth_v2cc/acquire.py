"""Acquisition for the corrected specification — NEW paths only, nothing overwritten.

  grouped   re-fetch every cached session (adjusted + raw) into ONE vintage directory
            /data/grouped_closes_v20260923/, provider spelling VERBATIM (no upper/dot
            rewriting), with a manifest of per-file fetch times + sha256, so the whole
            input is provably one adjustment vintage.
  splits    the provider's full split ledger (/v3/reference/splits).
  identity  point-in-time identity for the pinned UCT list: current details (cik, FIGI),
            ticker-change events, and as-of details at the start of every continuous
            trading segment of the symbol.
"""
import concurrent.futures as cf, hashlib, json, os, sys, time, urllib.request, urllib.error
K = os.environ["MASSIVE_API_KEY"]; B = "https://api.massive.com"
OUT = "/data/_audit/v2cc/inputs"; os.makedirs(OUT, exist_ok=True)
def get(path, tries=6):
    u = B + path + ("&" if "?" in path else "?") + "apiKey=" + K
    for i in range(tries):
        try:
            with urllib.request.urlopen(u, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404: return None
            if e.code in (429, 500, 502, 503, 504): time.sleep(2 ** i); continue
            raise
        except Exception:
            time.sleep(2 ** i)
    raise RuntimeError("failed " + path)
def utc(): return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

what = sys.argv[1]
if what == "grouped":
    D = "/data/grouped_closes_v20260923"; os.makedirs(D, exist_ok=True)
    cal = sorted(f[:-7] for f in os.listdir("/data/grouped_closes") if f.endswith("_1.json"))
    man = {}
    def one(job):
        d, adj = job
        p = os.path.join(D, "%s_%d.json" % (d, adj))
        t0 = utc()
        j = get("/v2/aggs/grouped/locale/us/market/stocks/%s?adjusted=%s" % (d, "true" if adj else "false")) or {}
        out = {r["T"]: r["c"] for r in (j.get("results") or []) if r.get("T") and isinstance(r.get("c"), (int, float)) and r["c"] > 0}
        body = json.dumps(out, sort_keys=True).encode()
        with open(p + ".partial", "wb") as f: f.write(body)
        os.rename(p + ".partial", p)
        return (d, adj, {"fetched_start": t0, "fetched_end": utc(), "n": len(out), "sha256": hashlib.sha256(body).hexdigest()})
    jobs = [(d, a) for d in cal for a in (1, 0)]
    t = time.time()
    with cf.ThreadPoolExecutor(8) as ex:
        for i, (d, a, m) in enumerate(ex.map(one, jobs)):
            man["%s_%d" % (d, a)] = m
            if i % 500 == 0: print(i, d, round(time.time() - t), flush=True)
    fs = sorted(v["fetched_start"] for v in man.values()); fe = sorted(v["fetched_end"] for v in man.values())
    json.dump({"dir": D, "files": len(man), "fetch_window": [fs[0], fe[-1]], "empty": [k for k, v in man.items() if v["n"] == 0],
               "manifest": man}, open(os.path.join(OUT, "grouped_vintage_manifest.json"), "x"), indent=0)
    print("DONE", len(man), fs[0], fe[-1])
elif what == "splits":
    res, url = [], "/v3/reference/splits?limit=1000&order=asc&sort=execution_date"
    while url:
        j = get(url); res += j.get("results") or []
        nxt = j.get("next_url"); url = nxt.replace(B, "") if nxt else None
    json.dump({"fetched": utc(), "n": len(res), "splits": res}, open(os.path.join(OUT, "splits_ledger.json"), "x"))
    print("splits", len(res), res[0]["execution_date"], res[-1]["execution_date"])
elif what == "identity":
    pin = json.load(open("/data/_audit/validation/pinned_uct_universe.json"))["tickers"]
    cal = sorted(f[:-7] for f in os.listdir("/data/grouped_closes") if f.endswith("_0.json"))
    pres = {t: [] for t in pin}; ps = set(pin)
    for i, d in enumerate(cal):
        for k in json.load(open("/data/grouped_closes/%s_0.json" % d)):
            if k in ps: pres[k].append(i)
    def one(t):
        idx = pres[t]; segs = []
        if idx:
            s = idx[0]
            for a, b in zip(idx, idx[1:]):
                if b - a > 5: segs.append((cal[s], cal[a])); s = b
            segs.append((cal[s], cal[idx[-1]]))
        cur = (get("/v3/reference/tickers/%s" % t) or {}).get("results")
        ev = (get("/vX/reference/tickers/%s/events" % t) or {}).get("results")
        asof = {}
        for s0, s1 in segs:
            r = (get("/v3/reference/tickers/%s?date=%s" % (t, s0)) or {}).get("results")
            asof[s0] = {k: (r or {}).get(k) for k in ("name", "cik", "composite_figi", "share_class_figi", "type", "primary_exchange")} if r else None
        return t, {"current": {k: (cur or {}).get(k) for k in ("name", "cik", "composite_figi", "share_class_figi", "type", "primary_exchange", "list_date")},
                   "events": ev, "segments": segs, "asof_at_segment_start": asof}
    out = {}
    with cf.ThreadPoolExecutor(8) as ex:
        for i, (t, v) in enumerate(ex.map(one, pin)):
            out[t] = v
            if i % 300 == 0: print(i, t, flush=True)
    json.dump({"fetched": utc(), "n": len(out), "segment_gap_sessions": 5, "identity": out}, open(os.path.join(OUT, "uct_identity_ledger.json"), "x"))
    print("identity", len(out))
elif what == "changepoints":
    # For segments the identity table EXCLUDED because the holder at the segment START is a
    # different CIK/FIGI: ask who holds the ticker at the segment END. If that is the current
    # company, bisect point-in-time details for the date identity changed (≈13 calls).
    Tb = json.load(open(os.path.join(OUT, "uct_identity_table.json")))["tickers"]
    L = json.load(open(os.path.join(OUT, "uct_identity_ledger.json")))["identity"]
    cal = sorted(f[:-7] for f in os.listdir("/data/grouped_closes_v20260923") if f.endswith("_0.json"))
    def holder(t, d):
        r = (get("/v3/reference/tickers/%s?date=%s" % (t, d)) or {}).get("results")
        return {k: (r or {}).get(k) for k in ("name", "cik", "composite_figi")} if r else None
    def is_cur(t, h):
        c = L[t]["current"]
        return bool(h) and ((c.get("cik") and h.get("cik") == c["cik"]) or (c.get("composite_figi") and h.get("composite_figi") == c["composite_figi"]))
    todo = [(t, s0, s1) for t, rows in Tb.items() for (s0, s1, frm, rule, _d) in rows if rule == "EXCLUDED"]
    def one(job):
        t, s0, s1 = job
        he = holder(t, s1)
        if not is_cur(t, he):
            return t, s0, s1, {"end_holder": he, "changepoint": None}
        lo, hi = cal.index(s0), cal.index(s1)          # holder(lo) not current, holder(hi) current
        n = 0
        while hi - lo > 1:
            mid = (lo + hi) // 2; n += 1
            if is_cur(t, holder(t, cal[mid])): hi = mid
            else: lo = mid
        return t, s0, s1, {"end_holder": he, "changepoint": cal[hi], "last_other": cal[lo],
                           "holder_before": holder(t, cal[lo]), "calls": n}
    out = {}
    with cf.ThreadPoolExecutor(8) as ex:
        for i, (t, s0, s1, v) in enumerate(ex.map(one, todo)):
            out.setdefault(t, {})[s0] = v
            if i % 100 == 0: print(i, t, flush=True)
    json.dump({"fetched": utc(), "segments": len(todo), "changepoints": out}, open(os.path.join(OUT, "uct_identity_changepoints.json"), "x"))
    print("changepoints", len(todo), sum(1 for t in out for v in out[t].values() if v["changepoint"]))
