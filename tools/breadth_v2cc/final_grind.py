"""THE final V2c2 grind — one authoritative run, resumable, with a durable ledger.

argv: TAG [--resume]
  artifact  /data/_audit/v2cc/final/breadth_v2c2div_FINAL_<TAG>.db
  ledger    /data/_audit/v2cc/final/LEDGER_<TAG>.json   (rewritten every 5 min)
Singleton: an exclusive flock on /data/_audit/v2cc/final/v2c2_final.lock — a second grinder
exits immediately. The launcher (breadth_corrected_pass.main) runs the full preflight; on
--resume it refuses unless the artifact's clean launch record names THIS manifest.
"""
import fcntl, json, os, shutil, sqlite3, sys, threading, time
TAG = sys.argv[1]; RESUME = "--resume" in sys.argv
F = "/data/_audit/v2cc/final"; os.makedirs(F, exist_ok=True)
ART = "%s/breadth_v2c2div_FINAL_%s.db" % (F, TAG); LEDGER = "%s/LEDGER_%s.json" % (F, TAG)
INPUTS = "/data/_audit/v2cc/inputs_" + TAG
os.environ["BREADTH_GROUPED_DIR"] = "/data/grouped_closes_" + TAG
os.environ["BREADTH_V2C2_INPUTS"] = INPUTS
lock = open(F + "/v2c2_final.lock", "w")
try:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except OSError:
    print("ANOTHER FINAL GRIND HOLDS THE LOCK — refusing to start a second grinder", flush=True); sys.exit(3)
lock.write(str(os.getpid())); lock.flush()
from api.services import breadth_corrected_pass as cp
from api.services import breadth_grouped_history as gh
here = os.path.dirname(os.path.abspath(__file__))
cal = [d for d in gh.session_calendar() if d >= "2008-01-02"]
t_start = time.time()
D0 = [None]                                  # sessions already done when this leg began


def ledger(state):
    L = {"tag": TAG, "artifact": ART, "inputs": INPUTS, "state": state, "pid": os.getpid(),
         "code_dir": here, "code_md5_dir": os.path.basename(os.path.dirname(os.path.dirname(here))),
         "updated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
         "methodology": cp.METHODOLOGY, "pins": json.load(open(cp.PINS_PATH)) if os.path.exists(cp.PINS_PATH) else None,
         "manifest_sha256": cp._sha(INPUTS + "/INPUT_MANIFEST.json"), "sessions_expected": len(cal),
         "range": [cal[0], cal[-1]]}
    try:
        c = sqlite3.connect("file:%s?mode=ro" % ART, uri=True)
        st = dict(c.execute("SELECT status, COUNT(*) FROM pass_checkpoint GROUP BY 1").fetchall())
        last = c.execute("SELECT MAX(date) FROM pass_checkpoint WHERE status='done'").fetchone()[0]
        rows = c.execute("SELECT COUNT(*) FROM breadth_daily_ohlc").fetchone()[0]
        meta = dict(c.execute("SELECT key, value FROM pass_meta WHERE key LIKE 'launch_%' OR key LIKE 'leg%'").fetchall())
        c.close()
        done = st.get("done", 0) + st.get("missing_source", 0)
        el = time.time() - t_start
        L.update(checkpoints=st, last_completed=last, rows=rows, launch=meta, sessions_done=done,
                 elapsed_this_leg_h=round(el / 3600, 2),
                 est_remaining_h=None)
        if D0[0] is None:
            D0[0] = done
        if done > D0[0]:
            L["sec_per_session_this_leg"] = round(el / (done - D0[0]), 1)
            L["est_remaining_h"] = round((len(cal) - done) * el / (done - D0[0]) / 3600, 1)
    except Exception as e:  # noqa: BLE001 — the ledger never stops the grind
        L["read_error"] = repr(e)
    du = shutil.disk_usage("/data"); L["disk_free_gb"] = round(du.free / 1e9, 1)
    try:
        L["rss_mb"] = int(open("/proc/self/status").read().split("VmRSS:")[1].split()[0]) // 1024
    except Exception:
        pass
    tmp = LEDGER + ".tmp"; json.dump(L, open(tmp, "w"), indent=1); os.replace(tmp, LEDGER)


def pump():
    while True:
        time.sleep(300)
        ledger("running")


ledger("starting-resume" if RESUME else "starting")
threading.Thread(target=pump, daemon=True).start()
argv = ["--artifact", ART, "--inputs", INPUTS, "--from", "2008-01-02"] + (["--resume"] if RESUME else [])
try:
    rc = cp.main(argv)
    ledger("finished rc=%s" % rc)
except Exception as e:
    ledger("STOPPED: %r" % e)
    raise
