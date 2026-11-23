"""Per-session membership of us / nasdaq / nyse, by production's own rules (breadth_corrected_pass
.resolve_universes + exch_grind's venue-ledger split), over the provider's grouped day files.
Run with PYTHONPATH = the exchange grind's code tree. argv: REF_JSON LEDGER_JSON LO HI OUT_DIR
Writes OUT_DIR/<date>.json {us,nasdaq,nyse} and OUT_DIR/counts.json. Prints counts only."""
import gzip, json, os, sys, glob, time
REF, LEDGER, LO, HI, OUT = sys.argv[1:6]
sys.path.insert(0, os.environ["GRIND_TOOLS"])
from api.services import breadth_pit_frame as bpf
from api.services import breadth_universes as bu
try:
    from api.services import breadth_ticker as bt
except ImportError:
    import breadth_ticker as bt
import breadth_venue_ledger as vl
ref_map = json.load(open(REF))
LDOC = json.load(open(LEDGER)); L = vl.Ledger(LDOC["rows"])
venues = bu.venues("us")
G = "/data/_audit/uct_pit/grouped"
os.makedirs(OUT, exist_ok=True)
counts = {}
t0 = time.time()
for p in sorted(glob.glob(G + "/*.json.gz")):
    D = os.path.basename(p)[:10]
    if D < LO or D > HI: continue
    g = json.load(gzip.open(p, "rt"))
    traded = {bt.canon(t) for t, b in g.items() if b and (b[4] or 0) > 0}
    us = []
    for t in traded:
        rec = bpf.resolve(ref_map.get(t), D)
        if rec is None or rec.get("type") not in bpf.COMMON_TYPES: continue
        ex = (rec.get("primary_exchange") or "").upper()
        if ex and ex in venues: us.append(t)
    nyse, nas = [], []
    for t in us:
        ident = vl.identity_of(t, bpf.resolve(ref_map.get(t), D))
        if ident not in L.by_id: continue
        st, _ = L.status_on(ident, D)
        if st == vl.NYSE: nyse.append(t)
        elif st == vl.NASDAQ: nas.append(t)
    m = {"us": sorted(us), "nasdaq": sorted(nas) if D >= "2008-01-02" else [], "nyse": sorted(nyse) if D >= "2009-06-11" else []}
    json.dump(m, open(f"{OUT}/{D}.json", "w"))
    counts[D] = {k: len(v) for k, v in m.items()}
json.dump(counts, open(f"{OUT}/counts.json", "w"))
print("sessions", len(counts), "secs", round(time.time() - t0))
