"""Exchange Breadth V1 validation — bounded deterministic rebuild over chosen WINDOWS.

argv: TAG OUTDIR DATES_FILE HOOK(0|1)

Identical to tools/breadth_v2cc/exch_grind.py (eff3eca45) in everything that computes data: same
pinned overlay (run through the same launch.py), same input-identity gate, same ledger-hash gate,
same `resolve_universes` wrapper (copied verbatim), same `cp.run(...)` call. Differences, all
non-computational: the session list is an explicit window list (exch_grind only takes --to); the
artifact/progress live under OUTDIR (never the candidate's directory); no 5-minute pump thread
(exch_session is written once at the end); HOOK=1 adds READ-ONLY capture wrappers that record
membership lists and the close cross-section's drill lists (they return the wrapped function's
result unchanged — proven by comparing the HOOK=1 artifact to the HOOK=0 artifacts).
"""
import hashlib
import json
import logging
import os
import sys

TAG, OUTDIR, DATES_FILE, HOOK = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "1"
LEDGER_PATH = "/data/_audit/exch_v1/venue_ledger_72eef1c2.json"
NYSE_START, NASDAQ_START = "2009-06-11", "2008-01-02"
os.makedirs(OUTDIR, exist_ok=True)
logging.basicConfig(level=logging.WARNING, stream=sys.stdout, format="%(asctime)s %(message)s")
ART = f"{OUTDIR}/det_{TAG}.db"
INPUTS = "/data/_audit/v2cc/inputs_v20260924f"
GROUPED = "/data/grouped_closes_v20260924f"
EXPECT = {
    "INPUT_MANIFEST.json": "0c5caacda02ee4634197aefd8c261f648e6ffe26496379f05ed7f753a1d7d07a",
    "pit_reference.json": "cf20e5f0019849aa7161170761d426da95e93df8f84f3a069527f13e10959d7c",
    "grouped_vintage_manifest.json": "2b8c0eafe714c52d17384bdc29af14b8cc9f3d4314181a6f632b2ee28d390773",
}


def _sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


for fn, want in EXPECT.items():
    got = _sha(os.path.join(INPUTS, fn))
    if got != want:
        raise SystemExit(f"INPUT MISMATCH {fn}: {got} != {want}")
if os.path.exists(ART):
    raise SystemExit(f"{ART} exists — refusing")

os.environ["BREADTH_GROUPED_DIR"] = GROUPED
os.environ["BREADTH_V2C2_INPUTS"] = INPUTS

from api.services import breadth_corrected_pass as cp      # noqa: E402  (overlaid)
from api.services import breadth_grouped_history as gh     # noqa: E402
from api.services import breadth_pit_frame as bpf          # noqa: E402
sys.path.insert(0, "/data/_audit/exch_v1/code_grind_eff3eca45b2f/tools/breadth_v2cc")
import breadth_venue_ledger as vl                          # noqa: E402

LDOC = json.load(open(LEDGER_PATH))
if vl.ledger_hash(LDOC["rows"]) != LDOC["sha256"]:
    raise SystemExit("ledger content does not match its recorded sha256")
L = vl.Ledger(LDOC["rows"])
cp.FLOORS["nyse"], cp.FLOORS["nasdaq"] = NYSE_START, NASDAQ_START

_orig = cp.resolve_universes
_counts = {}
CAP = {}


# ── verbatim from exch_grind.py (eff3eca45) ──────────────────────────────────────────────
def resolve_universes(D, traded, inp, ref_map, universes):
    base = _orig(D, traded, inp, ref_map, tuple(u for u in universes if u not in ("nyse", "nasdaq")))
    us = base.get("us") or []
    c = {"us": len(us), vl.NYSE: 0, vl.NASDAQ: 0, vl.OTHER: 0, vl.UNRESOLVED: 0, vl.CONFLICT: 0, "absent": 0}
    nyse, nas = [], []
    for t in us:
        ident = vl.identity_of(t, bpf.resolve(ref_map.get(t), D))
        if ident not in L.by_id:
            c["absent"] += 1
            continue
        st, _mic = L.status_on(ident, D)
        c[st] += 1
        if st == vl.NYSE:
            nyse.append(t)
        elif st == vl.NASDAQ:
            nas.append(t)
    if "nyse" in universes and D >= NYSE_START:
        base["nyse"] = nyse
    if "nasdaq" in universes and D >= NASDAQ_START:
        base["nasdaq"] = nas
    _counts[D] = c
    return base
# ─────────────────────────────────────────────────────────────────────────────────────────


cp.resolve_universes = resolve_universes

if HOOK:
    from api.services import breadth_live as bl              # noqa: E402
    from api.services import breadth_wick_recon as wr        # noqa: E402
    _rv, _so, _agg, _cm = cp.resolve_universes, wr.session_ohlc, wr.aggregate_day, bl.compute_metrics
    STATE = {"D": None, "unis": None, "in_agg": False, "close": None}

    def cap_resolve(D, traded, inp, ref_map, universes):
        out = _rv(D, traded, inp, ref_map, universes)
        STATE["D"], STATE["unis"] = D, out
        rec = CAP.setdefault(D, {"universes": {}, "close": {}})
        rec["traded_n"] = len(traded)
        for u, names in out.items():
            rec["universes"][u] = sorted(names)
        rec["us_identity"] = {t: vl.identity_of(t, bpf.resolve(ref_map.get(t), D)) for t in out.get("us", [])}
        return out

    def cap_agg(*a, **k):
        STATE["in_agg"] = True
        try:
            return _agg(*a, **k)
        finally:
            STATE["in_agg"] = False

    def cap_cm(levels, prices, volumes=None, members=None, opens=None):
        if STATE["in_agg"] or members is not None:
            return _cm(levels, prices, volumes, members, opens)
        drill = {}
        res = _cm(levels, prices, volumes, drill, opens)
        STATE["close"] = (res, drill)
        return res

    def cap_so(D, per_ticker, levels, *a, **k):
        STATE["close"] = None
        res = _so(D, per_ticker, levels, *a, **k)
        mem = k.get("members")
        u = next((uu for uu, names in (STATE["unis"] or {}).items() if set(names) == mem), None)
        if STATE["close"] is not None and u is not None:
            m, drill = STATE["close"]
            CAP[D]["close"][u] = {
                "values": {x: m.get(x) for x in ("universe_count", "advancing", "declining", "unchanged",
                                                  "_directional", "_zero_prev_close", "new_52w_highs", "new_52w_lows")},
                "lists": {x: sorted(drill.get(x) or []) for x in ("universe_count", "advancing", "declining", "unchanged")}}
        return res

    cp.resolve_universes = cap_resolve
    wr.session_ohlc, wr.aggregate_day, bl.compute_metrics = cap_so, cap_agg, cap_cm

dates = sorted({l.strip() for l in open(DATES_FILE) if l.strip()})
c = cp.open_artifact(ART)
c.execute("CREATE TABLE IF NOT EXISTS exch_meta (key TEXT PRIMARY KEY, value TEXT)")
for k, v in {"methodology": cp.METHODOLOGY + "+pit-venue-ledger-v1+unchanged",
             "ledger_path": LEDGER_PATH, "ledger_sha256": LDOC["sha256"],
             "population_sha256": LDOC.get("population_sha256"),
             "nyse_start": NYSE_START, "nasdaq_start": NASDAQ_START,
             "inputs": INPUTS, "grouped_dir": GROUPED, "frozen_reference": "5670fdc0d3de",
             "ema_rule": "frozen (no tie rule) — identical to the frozen V2 history",
             "validation_tag": TAG, "hook": str(HOOK), "dates": json.dumps(dates)}.items():
    c.execute("INSERT OR REPLACE INTO exch_meta VALUES(?,?)", (k, str(v)))
c.commit()
c.close()
stats = cp.run(ART, dates, universes=("us", "nasdaq", "nyse"), inputs_dir=INPUTS, progress_every=5)
import sqlite3  # noqa: E402
w = sqlite3.connect(ART, timeout=60)
w.execute("CREATE TABLE IF NOT EXISTS exch_session (date TEXT PRIMARY KEY, counts TEXT)")
for d, cc in sorted(_counts.items()):
    w.execute("INSERT OR REPLACE INTO exch_session VALUES(?,?)", (d, json.dumps(cc, sort_keys=True)))
w.commit()
w.close()
if HOOK:
    json.dump(CAP, open(f"{OUTDIR}/capture_{TAG}.json", "w"), separators=(",", ":"), sort_keys=True)
print("FINISHED", TAG, json.dumps(stats), flush=True)
