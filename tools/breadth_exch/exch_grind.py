"""Exchange Breadth V1 — the isolated historical recompute (Phase 2). ONE authoritative run, resumable.

argv: RUN_TAG LEDGER_JSON NYSE_START NASDAQ_START [--to YYYY-MM-DD] [--resume]

* Code: the pinned V2c2 corrected pass, overlaid from this code dir (launch.py), with the exchange
  module set (accepted pins + the `unchanged` patch). Production code and pins are not touched.
* Inputs: the FROZEN run's inputs, verified by hash before a single session is computed — this is a
  reproduction, so the reference is identity with the frozen launch, not freshness.
* Population: `us` exactly as V2c2 resolves it. `nyse`/`nasdaq` = the `us` members whose identity the
  PIT venue ledger places on NYSE/NASDAQ for that session. Anything else (OTHER, UNRESOLVED, CONFLICT,
  absent from the ledger) is in NEITHER exchange and is counted per session in `exch_session`.
* Artifact: /data/_audit/exch_v1/artifact/breadth_exch_v1_<RUN_TAG>.db — a NEW file. Never the frozen one.
* Singleton flock; checkpoints skip completed sessions; progress ledger every 5 min.
"""
import fcntl
import hashlib
import json
import logging
import os
import shutil
import sqlite3
import sys
import threading
import time

TAG, LEDGER_PATH, NYSE_START, NASDAQ_START = sys.argv[1:5]
TO = sys.argv[sys.argv.index("--to") + 1] if "--to" in sys.argv else "2026-09-24"
RESUME = "--resume" in sys.argv
BASE = "/data/_audit/exch_v1/artifact"
os.makedirs(BASE, exist_ok=True)
ART = f"{BASE}/breadth_exch_v1_{TAG}.db"
PROGRESS = f"{BASE}/PROGRESS_{TAG}.json"
INPUTS = "/data/_audit/v2cc/inputs_v20260924f"
GROUPED = "/data/grouped_closes_v20260924f"
EXPECT = {  # the frozen run's recorded launch identity (PRELAUNCH_v20260924f.json / pass_meta)
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


logging.basicConfig(level=logging.WARNING, stream=sys.stdout,
                    format="%(asctime)s %(message)s")
lock = open(f"{BASE}/exch_grind.lock", "w")
try:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except OSError:
    print("ANOTHER EXCHANGE GRIND HOLDS THE LOCK — refusing", flush=True)
    sys.exit(3)
lock.write(str(os.getpid()))
lock.flush()

for fn, want in EXPECT.items():
    got = _sha(os.path.join(INPUTS, fn))
    if got != want:
        raise SystemExit(f"INPUT MISMATCH {fn}: {got} != {want}")
if os.path.exists(ART) and not RESUME:
    raise SystemExit(f"{ART} exists — relaunch with --resume (never a second artifact)")

os.environ["BREADTH_GROUPED_DIR"] = GROUPED
os.environ["BREADTH_V2C2_INPUTS"] = INPUTS

from api.services import breadth_corrected_pass as cp      # noqa: E402  (overlaid)
from api.services import breadth_grouped_history as gh     # noqa: E402
from api.services import breadth_pit_frame as bpf          # noqa: E402
here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
import breadth_venue_ledger as vl                          # noqa: E402

LDOC = json.load(open(LEDGER_PATH))
if vl.ledger_hash(LDOC["rows"]) != LDOC["sha256"]:
    raise SystemExit("ledger content does not match its recorded sha256")
L = vl.Ledger(LDOC["rows"])
cp.FLOORS["nyse"], cp.FLOORS["nasdaq"] = NYSE_START, NASDAQ_START

_orig = cp.resolve_universes
_counts = {}


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


cp.resolve_universes = resolve_universes

# side table written in the same artifact by the 5-minute pump and at the end (idempotent)
def _write_counts(conn):
    conn.execute("CREATE TABLE IF NOT EXISTS exch_session (date TEXT PRIMARY KEY, counts TEXT)")
    for d, c in list(_counts.items()):
        conn.execute("INSERT OR REPLACE INTO exch_session VALUES(?,?)", (d, json.dumps(c, sort_keys=True)))
    conn.commit()
    _counts.clear()


cal = [d for d in gh.session_calendar() if "2008-01-02" <= d <= TO]
t0 = time.time()


def progress(state):
    P = {"tag": TAG, "artifact": ART, "state": state, "pid": os.getpid(), "code_dir": here,
         "ledger": LEDGER_PATH, "ledger_sha256": LDOC["sha256"], "nyse_start": NYSE_START,
         "nasdaq_start": NASDAQ_START, "range": [cal[0], cal[-1]], "sessions_expected": len(cal),
         "updated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    try:
        c = sqlite3.connect(f"file:{ART}?mode=ro", uri=True)
        P["checkpoints"] = dict(c.execute("SELECT status, COUNT(*) FROM pass_checkpoint GROUP BY 1").fetchall())
        P["last_completed"] = c.execute("SELECT MAX(date) FROM pass_checkpoint WHERE status='done'").fetchone()[0]
        c.close()
    except Exception as e:                        # noqa: BLE001
        P["read_error"] = repr(e)
    P["elapsed_h"] = round((time.time() - t0) / 3600, 2)
    P["disk_free_gb"] = round(shutil.disk_usage("/data").free / 1e9, 1)
    tmp = PROGRESS + ".tmp"
    json.dump(P, open(tmp, "w"), indent=1)
    os.replace(tmp, PROGRESS)


def pump():
    while True:
        time.sleep(300)
        try:
            w = sqlite3.connect(ART, timeout=60)
            _write_counts(w)
            w.close()
        except Exception:                          # noqa: BLE001
            pass
        progress("running")


progress("starting-resume" if RESUME else "starting")
threading.Thread(target=pump, daemon=True).start()
c = cp.open_artifact(ART)
c.execute("CREATE TABLE IF NOT EXISTS exch_meta (key TEXT PRIMARY KEY, value TEXT)")
for k, v in {"methodology": cp.METHODOLOGY + "+pit-venue-ledger-v1+unchanged",
             "ledger_path": LEDGER_PATH, "ledger_sha256": LDOC["sha256"],
             "population_sha256": LDOC.get("population_sha256"),
             "nyse_start": NYSE_START, "nasdaq_start": NASDAQ_START,
             "inputs": INPUTS, "grouped_dir": GROUPED, "frozen_reference": "5670fdc0d3de",
             "ema_rule": "frozen (no tie rule) — identical to the frozen V2 history"}.items():
    c.execute("INSERT OR REPLACE INTO exch_meta VALUES(?,?)", (k, str(v)))
c.commit()
c.close()
try:
    stats = cp.run(ART, cal, universes=("us", "nasdaq", "nyse"), inputs_dir=INPUTS, progress_every=25)
    w = sqlite3.connect(ART, timeout=60)
    _write_counts(w)
    w.close()
    progress("finished %s" % json.dumps(stats))
except Exception as e:
    progress("STOPPED: %r" % e)
    raise
