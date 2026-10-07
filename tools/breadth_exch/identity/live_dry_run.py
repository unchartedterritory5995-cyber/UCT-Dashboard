"""Exchange Breadth V1 — ISOLATED live-leg dry run through the stable identity bridge.

argv: OUT IDENTITY_STATE.json DATES(csv)

Identical to exch_live_leg.py in everything that computes data (vintage preflight at the vintage's own
instant, the live producer's EMA tie rule, ratio priors from the frozen history's last 9 sessions,
the pinned overlay via launch.py, `cp.run` computed TWICE into two fresh artifacts). Differences:
  * venue membership goes ticker → SID (identity state) → the ACCEPTED ledger key for that session,
    instead of the vintage's mutable `ticker|delisted_utc` key;
  * the frozen history is opened `immutable=1` (never `mode=ro`, which can create -shm beside it);
  * read-only capture of membership + the close cross-section, and the raw-key comparison under
    every reference snapshot.
Writes ONLY under OUT. Publishes nothing, touches no authority, no production artifact.
"""
import collections
import hashlib
import json
import os
import sqlite3
import sys
import time

OUT, STATE, DATES = sys.argv[1], sys.argv[2], sys.argv[3]
VIN = "p202610022300"
INPUTS = f"/data/breadth_v2_producer/vintages/{VIN}/inputs_{VIN}"
GROUPED = f"/data/breadth_v2_producer/vintages/{VIN}/grouped_{VIN}"
HIST = "/data/_audit/exch_v1/final/breadth_exch_v1_FINAL_v20260924f_VALIDATED_FROZEN_2026-10-05.db"
HIST_SHA = "e65b2af0779d5ff8cdce8668f866f0889e070207a260e88a64cd9d38c37462a0"
LEDGER = "/data/_audit/exch_v1/venue_ledger_72eef1c2.json"
NYSE_START, NASDAQ_START = "2009-06-11", "2008-01-02"
REFS = {"A": "/data/_audit/v2cc/inputs_v20260924f/pit_reference.json",
        "B1_0930": "/data/breadth_v2_producer/vintages/p202609302026/inputs_p202609302026/pit_reference.json",
        "B2_1001": "/data/breadth_v2_producer/vintages/p202610012031/inputs_p202610012031/pit_reference.json",
        "B3_1002": f"{INPUTS}/pit_reference.json"}
os.makedirs(OUT, exist_ok=True)
if os.listdir(OUT):
    raise SystemExit(f"{OUT} is not empty — refusing")
os.environ["BREADTH_GROUPED_DIR"] = GROUPED
os.environ["BREADTH_V2C2_INPUTS"] = INPUTS


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


if sha(HIST) != HIST_SHA:
    raise SystemExit("frozen history hash")
sys.path.insert(0, "/app")
from api.services import breadth_corrected_pass as cp       # noqa: E402  (overlaid)
from api.services import breadth_live as bl                 # noqa: E402
from api.services import breadth_pit_frame as bpf           # noqa: E402
from api.services import breadth_wick_recon as wr           # noqa: E402
from api.services.breadth_v2_overlay import ewm_last_tie_exact  # noqa: E402
sys.path.insert(0, "/data/_audit/exch_v1/code_grind_eff3eca45b2f/tools/breadth_v2cc")
import breadth_venue_ledger as vl                           # noqa: E402

bl._ewm_last = ewm_last_tie_exact                           # the live producer's EMA rule
man = json.load(open(os.path.join(INPUTS, "INPUT_MANIFEST.json")))
at = (man.get("acquisition_window") or {}).get("finished")
pf = cp.preflight(INPUTS, now_utc=at)
dates = sorted(DATES.split(","))
# ⛔ The V2c2 preflight pins the PRODUCTION module set. The exchange set differs in EXACTLY the declared
# `unchanged` patch (tests/test_breadth_exch_engine.py::test_only_two_modules_differ_from_the_accepted_pins)
# — the same digests the accepted v1 grind recorded in pass_meta. Only those exact three findings are
# accepted; ANY other preflight problem still refuses.
DECLARED_EXCHANGE_PATCH = {
    "pin mismatch registries: {'metrics': '0f90397dbbdd92cb7c1b5862b20295219de868631e25abf5f8cc72de7d82541a', "
    "'universes': '205704a9a2ea882f6ce17a6afc6115bde443de398c3d71b37d639a145a8681f3'} != {'metrics': "
    "'5047cb9b77d81d2593cf579376ce5629721a5ddbba2f9410f905fdfcda3577d0', 'universes': "
    "'205704a9a2ea882f6ce17a6afc6115bde443de398c3d71b37d639a145a8681f3'}",
    "module digest mismatch breadth_live.py: 2e40b4ee1e53835f7555e4a55c0284b3 != 5eacf10923ddd2ad875ce33c53ae3bcc",
    "module digest mismatch breadth_metrics.py: c6af68fe9ca7dc75dcd64f4afea2bad0 != aa7e15fcf1592e2ddda8ee3ad299a614"}
other = [p_ for p_ in pf["problems"] if p_ not in DECLARED_EXCHANGE_PATCH]
res = {"vintage": VIN, "dates": dates, "preflight_at": at, "preflight_problems": pf["problems"],
       "preflight_accepted_as_declared_exchange_patch": sorted(set(pf["problems"]) & DECLARED_EXCHANGE_PATCH),
       "identity_state_sha256": sha(STATE), "hist_sha256": HIST_SHA}
if other:
    json.dump(res, open(os.path.join(OUT, "dry_run.json"), "w"), indent=1, default=str)
    raise SystemExit("PREFLIGHT REFUSED: %s" % other)
LDOC = json.load(open(LEDGER))
assert vl.ledger_hash(LDOC["rows"]) == LDOC["sha256"]
L = vl.Ledger(LDOC["rows"])
ST = json.load(open(STATE))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import identity_model as im                                  # noqa: E402  (the shared bridge)
BR = im.Bridge(ST, LDOC["rows"])


cp.FLOORS["nyse"], cp.FLOORS["nasdaq"] = NYSE_START, NASDAQ_START
_orig = cp.resolve_universes
counts, CAP = {}, {}


def resolve_universes(D, traded, inp, ref_map, universes):
    base = _orig(D, traded, inp, ref_map, tuple(u for u in universes if u not in ("nyse", "nasdaq")))
    c = {"us": len(base.get("us") or []), vl.NYSE: 0, vl.NASDAQ: 0, vl.OTHER: 0,
         vl.UNRESOLVED: 0, vl.CONFLICT: 0, "absent": 0}
    ny, na = [], []
    rec = CAP.setdefault(D, {"universes": {}, "close": {}, "member": {}})
    for t in base.get("us") or []:
        sid, k, st = BR.status(t, D)
        raw = vl.identity_of(t, bpf.resolve(ref_map.get(t), D))
        c[st] += 1
        rec["member"][t] = [sid, k, raw, st]
        (ny if st == vl.NYSE else na if st == vl.NASDAQ else []).append(t)
    if "nyse" in universes and D >= NYSE_START:
        base["nyse"] = ny
    if "nasdaq" in universes and D >= NASDAQ_START:
        base["nasdaq"] = na
    counts[D] = c
    for u, names in base.items():
        rec["universes"][u] = sorted(names)
    return base


cp.resolve_universes = resolve_universes
_so, _agg, _cm = wr.session_ohlc, wr.aggregate_day, bl.compute_metrics
STATE_ = {"in_agg": False, "close": None, "D": None}


def cap_agg(*a, **k):
    STATE_["in_agg"] = True
    try:
        return _agg(*a, **k)
    finally:
        STATE_["in_agg"] = False


def cap_cm(levels, prices, volumes=None, members=None, opens=None):
    if STATE_["in_agg"] or members is not None:
        return _cm(levels, prices, volumes, members, opens)
    drill = {}
    r = _cm(levels, prices, volumes, drill, opens)
    STATE_["close"] = (r, drill)
    return r


def cap_so(D, per_ticker, levels, *a, **k):
    STATE_["close"] = None
    r = _so(D, per_ticker, levels, *a, **k)
    mem = k.get("members")
    u = next((uu for uu, names in CAP.get(D, {}).get("universes", {}).items() if set(names) == mem), None)
    if STATE_["close"] is not None and u is not None:
        m, drill = STATE_["close"]
        CAP[D]["close"][u] = {"values": {x: m.get(x) for x in ("universe_count", "advancing", "declining", "unchanged", "_directional")},
                              "lists": {x: sorted(drill.get(x) or []) for x in ("universe_count", "advancing", "declining", "unchanged")}}
    return r


wr.session_ohlc, wr.aggregate_day, bl.compute_metrics = cap_so, cap_agg, cap_cm

h = sqlite3.connect(f"file:{HIST}?immutable=1", uri=True)
first = dates[0]
prior_dates = [r[0] for r in h.execute(
    "SELECT DISTINCT date FROM breadth_daily_ohlc WHERE date<? ORDER BY date DESC LIMIT 9", (first,))]
priors = h.execute(
    "SELECT universe,date,metric,o,h,l,c,source FROM breadth_daily_ohlc WHERE date IN (%s) "
    "AND metric IN ('up_4pct_today','down_4pct_today') AND universe IN ('us','nyse','nasdaq')"
    % ",".join("?" * len(prior_dates)), prior_dates).fetchall()
hist_last = h.execute("SELECT MAX(date) FROM pass_checkpoint WHERE status='done'").fetchone()[0]
h.close()


def one(tag):
    art = os.path.join(OUT, f"dry_{tag}.db")
    c = cp.open_artifact(art)
    c.executemany("INSERT INTO breadth_daily_ohlc(universe,date,metric,o,h,l,c,source,updated_at) "
                  "VALUES(?,?,?,?,?,?,?,?,'priors')", priors)
    c.commit()
    c.close()
    stats = cp.run(art, dates, ("us", "nasdaq", "nyse"), INPUTS, progress_every=0)
    c = sqlite3.connect(art)
    rows = c.execute("SELECT universe,date,metric,o,h,l,c,source FROM breadth_daily_ohlc "
                     "WHERE date>=? ORDER BY 1,2,3", (first,)).fetchall()
    c.execute("CREATE TABLE IF NOT EXISTS exch_session (date TEXT PRIMARY KEY, counts TEXT)")
    for d, k in counts.items():
        c.execute("INSERT OR REPLACE INTO exch_session VALUES(?,?)", (d, json.dumps(k, sort_keys=True)))
    c.commit()
    c.close()
    return stats, hashlib.sha256(json.dumps(rows).encode()).hexdigest(), len(rows), rows


a = one("a")
cap_a = json.loads(json.dumps(CAP))
CAP.clear()
b = one("b")
res.update(hist_last_session=hist_last, contiguous=hist_last < first,
           run_a={"stats": a[0], "rows_sha256": a[1], "rows": a[2]},
           run_b={"stats": b[0], "rows_sha256": b[1], "rows": b[2]},
           deterministic=a[1] == b[1] and json.dumps(cap_a, sort_keys=True) == json.dumps(CAP, sort_keys=True),
           exch_session=counts, ledger_sha256=LDOC["sha256"])
json.dump(a[3], open(os.path.join(OUT, "would_append_rows.json"), "w"))
json.dump(cap_a, open(os.path.join(OUT, "capture.json"), "w"), separators=(",", ":"), sort_keys=True)

# ── the raw-key failure mode vs the bridge, under every reference snapshot ──────────────────
refs = {n: json.load(open(p)) for n, p in REFS.items()}
cmp_ = {}
for n, R in refs.items():
    lost = changed = 0
    names = collections.Counter()
    for d, rec in cap_a.items():
        for t, (sid, k, raw, st) in rec["member"].items():
            rr = bpf.resolve(R.get(t), d)
            rk = vl.identity_of(t, rr) if rr else None
            rst = L.status_on(rk, d)[0] if rk and rk in L.by_id else "absent"
            if rst != st:
                changed += 1
                names[t] += 1
                lost += st in (vl.NYSE, vl.NASDAQ)
    cmp_[n] = {"raw_key_status_changes": changed, "exchange_members_lost_by_raw_key": lost, "names": dict(names)}
res["raw_key_vs_bridge_by_snapshot"] = cmp_
res["finished_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
json.dump(res, open(os.path.join(OUT, "dry_run.json"), "w"), indent=1, default=str, sort_keys=True)
print(json.dumps({"deterministic": res["deterministic"], "rows": a[2], "stats": a[0], "contiguous": res["contiguous"]}))
