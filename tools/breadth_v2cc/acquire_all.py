"""ONE-WINDOW ACQUISITION of every provider input the V2c2 specification reads.

Writes to NEW paths only (argv[1] = tag, argv[2] = last session, e.g. 2026-09-22):
  /data/grouped_closes_<tag>/            grouped daily adjusted (split-only) + raw, verbatim
  /data/_audit/v2cc/inputs_<tag>/        splits_ledger, dividends_ledger, uct_identity_ledger,
                                         uct_identity_changepoints, pit_uct_ledger (copied),
                                         INPUT_MANIFEST.json (fetch window + sha256 per object)
The calendar is the previous cache's session list extended by rule trading days up to the
last session; every session must return a non-empty grouped file or the acquisition fails.
"""
import concurrent.futures as cf, datetime as dt, hashlib, json, os, shutil, sys, time, urllib.error, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
K = os.environ["MASSIVE_API_KEY"]; B = "https://api.massive.com"
TAG, LAST = sys.argv[1], sys.argv[2]
G = "/data/grouped_closes_" + TAG
OUT = "/data/_audit/v2cc/inputs_" + TAG
for p in (G, OUT):
    assert not os.path.exists(p), "refusing to reuse " + p
    os.makedirs(p)
utc = lambda: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
def get(path, tries=7):
    u = (path if path.startswith("http") else B + path)
    u += ("&" if "?" in u else "?") + "apiKey=" + K
    for i in range(tries):
        try:
            with urllib.request.urlopen(u, timeout=90) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404: return None
            time.sleep(2 ** i)
        except Exception:
            time.sleep(2 ** i)
    raise RuntimeError("failed " + path)
sha = lambda b: hashlib.sha256(b).hexdigest()
window = {"started": utc()}
from api.services import breadth_calendar as bcal
cal = sorted(f[:-7] for f in os.listdir("/data/grouped_closes_v20260923") if f.endswith("_1.json"))
d = dt.date.fromisoformat(cal[-1]) + dt.timedelta(days=1)
while d.isoformat() <= LAST:
    if bcal.is_trading_day(d.isoformat()):
        cal.append(d.isoformat())
    d += dt.timedelta(days=1)
man = {}
def one(job):
    iso, adj = job
    t0 = utc()
    j = get("/v2/aggs/grouped/locale/us/market/stocks/%s?adjusted=%s" % (iso, "true" if adj else "false")) or {}
    out = {r["T"]: r["c"] for r in (j.get("results") or []) if r.get("T") and isinstance(r.get("c"), (int, float)) and r["c"] > 0}
    body = json.dumps(out, sort_keys=True).encode()
    p = os.path.join(G, "%s_%d.json" % (iso, adj))
    open(p + ".partial", "wb").write(body); os.rename(p + ".partial", p)
    return iso, adj, {"fetched_start": t0, "fetched_end": utc(), "n": len(out), "sha256": sha(body)}
with cf.ThreadPoolExecutor(8) as ex:
    for i, (iso, adj, m) in enumerate(ex.map(one, [(x, a) for x in cal for a in (1, 0)])):
        man["%s_%d" % (iso, adj)] = m
        if i % 1000 == 0: print("grouped", i, iso, flush=True)
empty = [k for k, v in man.items() if v["n"] == 0]
assert not empty, "empty grouped files: %s" % empty[:10]
fs = sorted(v["fetched_start"] for v in man.values()); fe = sorted(v["fetched_end"] for v in man.values())
gm = {"dir": G, "files": len(man), "sessions": len(cal), "first": cal[0], "last": cal[-1],
      "fetch_window": [fs[0], fe[-1]], "empty": [], "manifest": man}
json.dump(gm, open(OUT + "/grouped_vintage_manifest.json", "x"))
print("grouped done", len(man), gm["fetch_window"], flush=True)
def paged(url):
    res = []
    while url:
        j = get(url); res += j.get("results") or []
        url = j.get("next_url")
    return res
t0 = utc(); spl = paged("/v3/reference/splits?limit=1000&order=asc&sort=execution_date")
json.dump({"fetched": [t0, utc()], "n": len(spl), "splits": spl}, open(OUT + "/splits_ledger.json", "x"))
print("splits", len(spl), flush=True)
t0 = utc(); div = paged("/v3/reference/dividends?limit=1000&order=asc&sort=ex_dividend_date&ex_dividend_date.lte=" + LAST)
json.dump({"fetched": [t0, utc()], "n": len(div), "ex_date_lte": LAST, "dividends": div}, open(OUT + "/dividends_ledger.json", "x"))
print("dividends", len(div), flush=True)
# identity (same rule inputs as before, from THIS grouped vintage)
pin = json.load(open("/data/_audit/validation/pinned_uct_universe.json"))["tickers"]; ps = set(pin)
pres = {t: [] for t in pin}
for i, x in enumerate(cal):
    for k in json.load(open("%s/%s_0.json" % (G, x))):
        if k in ps: pres[k].append(i)
def ident(t):
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
idl = {}
with cf.ThreadPoolExecutor(8) as ex:
    for t, v in ex.map(ident, pin): idl[t] = v
json.dump({"fetched": utc(), "n": len(idl), "identity": idl}, open(OUT + "/uct_identity_ledger.json", "x"))
print("identity", len(idl), flush=True)
from api.services import breadth_identity as bi
def holder(t, x):
    r = (get("/v3/reference/tickers/%s?date=%s" % (t, x)) or {}).get("results")
    return {k: (r or {}).get(k) for k in ("name", "cik", "composite_figi")} if r else None
def is_cur(t, h):
    c = idl[t]["current"]
    return bool(h) and ((c.get("cik") and h.get("cik") == c["cik"]) or (c.get("composite_figi") and h.get("composite_figi") == c["composite_figi"]))
import bisect
rc = lambda iso, t: json.load(open("%s/%s_0.json" % (G, iso))).get(t)
pv = lambda iso: cal[bisect.bisect_left(cal, iso) - 1] if bisect.bisect_left(cal, iso) > 0 else None
pre = bi.build_table({"identity": idl}, rc, pv, LAST)
todo = [(t, s0, s1) for t, rows in pre["tickers"].items() for (s0, s1, frm, rule, _d) in rows if rule == "EXCLUDED"]
def cp(job):
    t, s0, s1 = job
    he = holder(t, s1)
    if not is_cur(t, he): return t, s0, {"end_holder": he, "changepoint": None}
    lo, hi = cal.index(s0), cal.index(s1)
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if is_cur(t, holder(t, cal[mid])): hi = mid
        else: lo = mid
    return t, s0, {"end_holder": he, "changepoint": cal[hi], "last_other": cal[lo]}
cps = {}
with cf.ThreadPoolExecutor(8) as ex:
    for t, s0, v in ex.map(cp, todo): cps.setdefault(t, {})[s0] = v
json.dump({"fetched": utc(), "segments": len(todo), "changepoints": cps}, open(OUT + "/uct_identity_changepoints.json", "x"))
T = bi.build_table({"identity": idl}, rc, pv, LAST, changepoints=cps)
json.dump(T, open(OUT + "/uct_identity_table_v3.json", "x"))
shutil.copyfile("/data/_audit/v2cc/inputs/pit_uct_ledger.json", OUT + "/pit_uct_ledger.json")
window["finished"] = utc()
files = {f: sha(open(os.path.join(OUT, f), "rb").read()) for f in sorted(os.listdir(OUT))}
json.dump({"tag": TAG, "last_session": LAST, "acquisition_window": window, "grouped_dir": G,
           "grouped_fetch_window": gm["fetch_window"], "objects_sha256": files,
           "provider": "api.massive.com (grouped aggs, reference splits/dividends/tickers/events)"},
          open(OUT + "/INPUT_MANIFEST.json", "x"), indent=1)
print("ALL DONE", window)
