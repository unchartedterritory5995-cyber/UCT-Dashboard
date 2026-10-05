"""Exchange Breadth V1 — compute ONE live session from its FIRST-CONTAINING vintage (one process per
vintage: the pinned grouped history caches per process). Run through launch.py (pinned overlay).

argv: SPEC.json   (written by exch_live_leg.py; this worker writes only spec["out"] and spec["scratch"])

  1. PREFLIGHT    the unmodified V2c2 preflight, pointed at the EXPLICIT exchange pin set
                  (breadth_exch_live_pins.json). The vintage is the exchange archive's hash-verified copy:
                  every grouped file is re-verified against the vintage's own manifest here, and the ONE
                  accepted preflight finding is the grouped-dir path remap producer→archive (exact paths).
  2. MEMBERSHIP   identity_model.Bridge over the accepted ledger through its last session; after it, the
                  session's LIVE venue evidence (dated listing on the session + SIP tape on the session,
                  classified by the accepted breadth_venue_ledger.classify rule table).
  3. COMPUTE      cp.run TWICE into two scratch artifacts (live producer EMA tie rule, ratio priors from
                  the frozen history + the candidate); read-only capture of membership + close lists.
"""
import gzip
import hashlib
import json
import os
import sqlite3
import sys
import time

SPEC = json.load(open(sys.argv[1]))
D = SPEC["session"]
V = SPEC["vintage"]
os.environ["BREADTH_GROUPED_DIR"] = V["grouped_dir"]
os.environ["BREADTH_V2C2_INPUTS"] = V["inputs_dir"]
OUT = SPEC["out"]
os.makedirs(SPEC["scratch"], exist_ok=True)


def done(obj, code=0):
    json.dump(obj, open(OUT + ".tmp", "w"), sort_keys=True, default=str)
    os.replace(OUT + ".tmp", OUT)
    sys.exit(code)


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


sys.path.insert(0, "/app")
from api.services import breadth_corrected_pass as cp       # noqa: E402  (overlaid)
from api.services import breadth_live as bl                 # noqa: E402
from api.services import breadth_pit_frame as bpf           # noqa: E402
from api.services import breadth_wick_recon as wr           # noqa: E402
from api.services.breadth_v2_overlay import ewm_last_tie_exact  # noqa: E402
sys.path.insert(0, SPEC["tools_dir"])
sys.path.insert(0, os.path.join(SPEC["tools_dir"], "identity"))
import breadth_venue_ledger as vl                           # noqa: E402
import identity_model as im                                 # noqa: E402
import live_core as lc                                      # noqa: E402

# ── 1. preflight against the explicit exchange pin set ────────────────────────────────────────
man = json.load(open(os.path.join(V["inputs_dir"], "INPUT_MANIFEST.json")))
gm = json.load(open(os.path.join(V["inputs_dir"], "grouped_vintage_manifest.json")))
bad = [k for k, v in gm["manifest"].items() if sha(os.path.join(V["grouped_dir"], k + ".json")) != v["sha256"]]
cp.PINS_PATH = SPEC["pins_path"]
pf = cp.preflight(V["inputs_dir"], now_utc=man["acquisition_window"]["finished"], verify_files=False)
remap = "BREADTH_GROUPED_DIR %s is not the manifest's %s" % (V["grouped_dir"], man["grouped_dir"])
expected_remap = os.path.basename(man["grouped_dir"]) == os.path.basename(V["grouped_dir"]) == "grouped_" + V["tag"]
problems = [p for p in pf["problems"] if not (p == remap and expected_remap)]
if bad:
    problems.append("%d archived grouped files differ from the vintage manifest" % len(bad))
if problems:
    done({"refused": "PREFLIGHT", "problems": problems})
pre = {"pins_path_sha256": sha(SPEC["pins_path"]), "grouped_files_verified": len(gm["manifest"]),
       "accepted_findings": [p for p in pf["problems"] if p not in problems]}
bl._ewm_last = ewm_last_tie_exact                           # the live producer's EMA rule (as US V2)

# ── 2. membership ─────────────────────────────────────────────────────────────────────────────
LDOC = json.load(open(SPEC["ledger"]))
if vl.ledger_hash(LDOC["rows"]) != LDOC["sha256"]:
    done({"refused": "LEDGER_HASH"})
BR = im.Bridge(json.load(open(SPEC["identity_doc"])), LDOC["rows"])
LEDGER_END = SPEC["ledger_end"]
EVD = SPEC["evidence_dir"]
LIVE, EVROWS, DATED_IDS = {}, [], {}


def live_evidence(us):
    """Session-dated venue evidence for every US member (cached append-only under EVD; replays read it)."""
    os.makedirs(os.path.join(EVD, "dated"), exist_ok=True)
    os.makedirs(os.path.join(EVD, "tape"), exist_ok=True)
    dp = os.path.join(EVD, "dated", f"{D}.json.gz")
    import acquire_dated_venues as adv
    if not os.path.exists(dp):
        data = adv.fetch_day(D, adv._key())
        with gzip.open(dp + ".tmp", "wt") as fh:
            json.dump(data, fh, separators=(",", ":"))
        os.replace(dp + ".tmp", dp)
    with gzip.open(dp, "rt") as fh:
        dated = json.load(fh)
    venues, ids = {}, {}
    for mic, rows in dated.items():
        for r in rows:
            venues.setdefault(r[0], set()).add(mic)
            ids.setdefault(r[0], (r[2], r[3] if len(r) > 3 else None))
    tp = os.path.join(EVD, "tape", f"{D}.json")
    tapes = json.load(open(tp)) if os.path.exists(tp) else {}
    need = [t for t in us if t not in tapes]
    if need:
        import acquire_tape_and_build as atb
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=8) as ex:
            for t, v in zip(need, ex.map(lambda t: atb.tape(t, D), need)):
                tapes[t] = v
        json.dump(tapes, open(tp + ".tmp", "w"), sort_keys=True)
        os.replace(tp + ".tmp", tp)
    for t in us:
        dc = vl.dated_class(venues.get(t, ()))
        st, mic, src = vl.classify(dc, tapes.get(t))
        LIVE[t] = {"status": st, "source": src}
        EVROWS.append([D, t, None, dc[0], dc[1], tapes.get(t), st, mic, src])
        DATED_IDS[t] = ids.get(t, (None, None))
    return {"dated_file_sha256": sha(dp), "tape_file_sha256": sha(tp), "probed": len(need), "members": len(us)}


cp.FLOORS["nyse"], cp.FLOORS["nasdaq"] = SPEC["nyse_start"], SPEC["nasdaq_start"]
_orig = cp.resolve_universes
CAP = {"member": {}, "universes": {}, "close": {}, "counts": None, "evidence": None}


def resolve_universes(Dx, traded, inp, ref_map, universes):
    base = _orig(Dx, traded, inp, ref_map, tuple(u for u in universes if u not in ("nyse", "nasdaq")))
    us = base.get("us") or []
    if Dx > LEDGER_END and not LIVE:
        CAP["evidence"] = live_evidence(us)
    st = {}
    for t in us:
        sid, key, status, source = lc.membership_status(t, Dx, BR, LEDGER_END, LIVE)
        rec = bpf.resolve(ref_map.get(t), Dx)
        st[t] = status
        CAP["member"][t] = [sid, key, status, source, vl.identity_of(t, rec)] + list(DATED_IDS.get(t, (None, None)))
    ny, na, counts = lc.partition(us, st, Dx, SPEC["nyse_start"], SPEC["nasdaq_start"])
    if "nyse" in universes and Dx >= SPEC["nyse_start"]:
        base["nyse"] = ny
    if "nasdaq" in universes and Dx >= SPEC["nasdaq_start"]:
        base["nasdaq"] = na
    CAP["counts"] = counts
    for u, names in base.items():
        CAP["universes"][u] = sorted(names)
    return base


cp.resolve_universes = resolve_universes
_so, _agg, _cm = wr.session_ohlc, wr.aggregate_day, bl.compute_metrics
S_ = {"in_agg": False, "close": None}


def cap_agg(*a, **k):
    S_["in_agg"] = True
    try:
        return _agg(*a, **k)
    finally:
        S_["in_agg"] = False


def cap_cm(levels, prices, volumes=None, members=None, opens=None):
    if S_["in_agg"] or members is not None:
        return _cm(levels, prices, volumes, members, opens)
    drill = {}
    r = _cm(levels, prices, volumes, drill, opens)
    S_["close"] = (r, drill)
    return r


def cap_so(Dx, per_ticker, levels, *a, **k):
    S_["close"] = None
    r = _so(Dx, per_ticker, levels, *a, **k)
    mem = k.get("members")
    u = next((uu for uu, names in CAP["universes"].items() if set(names) == mem), None)
    if S_["close"] is not None and u is not None:
        m, drill = S_["close"]
        CAP["close"][u] = {"values": {x: m.get(x) for x in ("universe_count", "advancing", "declining", "unchanged",
                                                             "_directional")},
                           "lists": {x: sorted(drill.get(x) or []) for x in ("universe_count", "advancing",
                                                                              "declining", "unchanged")}}
    return r


wr.session_ohlc, wr.aggregate_day, bl.compute_metrics = cap_so, cap_agg, cap_cm


def one(tag):
    art = os.path.join(SPEC["scratch"], f"s_{tag}.db")
    for s in ("", "-wal", "-shm", "-journal"):
        if os.path.exists(art + s):
            os.remove(art + s)
    c = cp.open_artifact(art)
    c.executemany("INSERT INTO breadth_daily_ohlc(universe,date,metric,o,h,l,c,source,updated_at) "
                  "VALUES(?,?,?,?,?,?,?,?,'priors')", SPEC["priors"])
    c.commit()
    c.close()
    stats = cp.run(art, [D], ("us", "nasdaq", "nyse"), V["inputs_dir"], progress_every=0)
    c = sqlite3.connect(f"file:{art}?mode=ro", uri=True)
    rows = c.execute("SELECT universe,date,metric,o,h,l,c,source FROM breadth_daily_ohlc WHERE date=? "
                     "ORDER BY 1,2,3", (D,)).fetchall()
    c.close()
    return stats, rows


sa, ra = one("a")
cap_a = json.loads(json.dumps(CAP))
for k in ("member", "universes", "close"):
    CAP[k] = {}
sb, rb = one("b")
deterministic = ra == rb and json.dumps(cap_a, sort_keys=True) == json.dumps(CAP, sort_keys=True)
if not deterministic or sa.get("done") != 1:
    done({"refused": "COMPUTE", "deterministic": deterministic, "stats_a": sa, "stats_b": sb})
done({"session": D, "vintage": V["tag"], "preflight": pre, "stats": sa, "rows": ra, "capture": cap_a,
      "evidence_rows": EVROWS, "deterministic": True, "finished_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
