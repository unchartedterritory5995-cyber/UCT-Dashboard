"""Exchange Breadth V1 — the LIVE leg (sessions after the frozen history), producer semantics.

argv: INPUTS_DIR GROUPED_DIR DATES(csv) HIST_ARTIFACT LEDGER_JSON NYSE_START NASDAQ_START OUT_DIR

Exactly what `tools/breadth_v2/produce_sessions.py` does for a vintage, with the exchange module
set and the PIT venue ledger: preflight judged at the vintage's own acquisition instant (the
accepted reproduction rule), the EMA tie rule installed (as the live producer does), ratio priors
from the historical exchange artifact's last 9 sessions, and the batch computed TWICE into two
fresh artifacts that must be row-identical. Writes only under OUT_DIR.
Run through launch.py from the exchange grind code dir (overlay = accepted pins + `unchanged`).
"""
import hashlib
import json
import os
import sqlite3
import sys
import time

INPUTS, GROUPED, DATES, HIST, LEDGER, NYSE_START, NASDAQ_START, OUT = sys.argv[1:9]
os.environ["BREADTH_GROUPED_DIR"] = GROUPED
os.environ["BREADTH_V2C2_INPUTS"] = INPUTS
os.makedirs(OUT, exist_ok=True)
sys.path.insert(0, "/app")
from api.services import breadth_corrected_pass as cp       # noqa: E402  (overlaid)
from api.services import breadth_live as bl                 # noqa: E402
from api.services import breadth_pit_frame as bpf           # noqa: E402
from api.services.breadth_v2_overlay import ewm_last_tie_exact  # noqa: E402  (pure function, /app)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import breadth_venue_ledger as vl                           # noqa: E402

bl._ewm_last = ewm_last_tie_exact                           # the live producer's EMA rule
man = json.load(open(os.path.join(INPUTS, "INPUT_MANIFEST.json")))
at = (man.get("acquisition_window") or {}).get("finished")   # the vintage's own instant
if not at:
    raise SystemExit("INPUT_MANIFEST has no acquisition_window.finished — refusing to guess an instant")
pf = cp.preflight(INPUTS, now_utc=at)
dates = sorted(DATES.split(","))
res = {"dates": dates, "inputs": INPUTS, "preflight_at": at, "preflight_problems": pf["problems"]}
if pf["problems"]:
    json.dump(res, open(os.path.join(OUT, "live_leg.json"), "w"), indent=1, default=str)
    raise SystemExit("PREFLIGHT REFUSED: %s" % pf["problems"])

LDOC = json.load(open(LEDGER))
assert vl.ledger_hash(LDOC["rows"]) == LDOC["sha256"]
L = vl.Ledger(LDOC["rows"])
cp.FLOORS["nyse"], cp.FLOORS["nasdaq"] = NYSE_START, NASDAQ_START
_orig = cp.resolve_universes
counts = {}


def resolve_universes(D, traded, inp, ref_map, universes):
    base = _orig(D, traded, inp, ref_map, tuple(u for u in universes if u not in ("nyse", "nasdaq")))
    c = {"us": len(base.get("us") or []), vl.NYSE: 0, vl.NASDAQ: 0, vl.OTHER: 0,
         vl.UNRESOLVED: 0, vl.CONFLICT: 0, "absent": 0}
    ny, na = [], []
    for t in base.get("us") or []:
        ident = vl.identity_of(t, bpf.resolve(ref_map.get(t), D))
        if ident not in L.by_id:
            c["absent"] += 1
            continue
        st = L.status_on(ident, D)[0]
        c[st] += 1
        (ny if st == vl.NYSE else na if st == vl.NASDAQ else []).append(t)
    if "nyse" in universes and D >= NYSE_START:
        base["nyse"] = ny
    if "nasdaq" in universes and D >= NASDAQ_START:
        base["nasdaq"] = na
    counts[D] = c
    return base


cp.resolve_universes = resolve_universes

h = sqlite3.connect(f"file:{HIST}?mode=ro", uri=True)
first = dates[0]
prior_dates = [r[0] for r in h.execute(
    "SELECT DISTINCT date FROM breadth_daily_ohlc WHERE date<? ORDER BY date DESC LIMIT 9", (first,))]
priors = h.execute(
    "SELECT universe,date,metric,o,h,l,c,source FROM breadth_daily_ohlc WHERE date IN (%s) "
    "AND metric IN ('up_4pct_today','down_4pct_today') AND universe IN ('us','nyse','nasdaq')"
    % ",".join("?" * len(prior_dates)), prior_dates).fetchall()
h.close()


def one(tag):
    art = os.path.join(OUT, f"live_{tag}.db")
    for s in ("", "-wal", "-shm"):
        if os.path.exists(art + s):
            os.remove(art + s)
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
    return stats, hashlib.sha256(json.dumps(rows).encode()).hexdigest(), len(rows)


a = one("a")
b = one("b")
res.update(run_a={"stats": a[0], "sha256": a[1], "rows": a[2]},
           run_b={"stats": b[0], "sha256": b[1], "rows": b[2]},
           deterministic=a[1] == b[1], counts=counts, ledger_sha256=LDOC["sha256"],
           finished_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
json.dump(res, open(os.path.join(OUT, "live_leg.json"), "w"), indent=1, default=str)
print(json.dumps({"deterministic": res["deterministic"], "rows": a[2], "stats": a[0]}))
