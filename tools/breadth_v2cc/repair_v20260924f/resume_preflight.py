"""READ-ONLY replica of breadth_corrected_pass.main()'s --resume gate (lines 472-511), stopping before run()."""
import json, os, sys, hashlib, glob, sqlite3
TAG = "v20260924f"
F = "/data/_audit/v2cc/final"; ART = "%s/breadth_v2c2div_FINAL_%s.db" % (F, TAG)
INPUTS = "/data/_audit/v2cc/inputs_" + TAG
os.environ["BREADTH_GROUPED_DIR"] = "/data/grouped_closes_" + TAG
os.environ["BREADTH_V2C2_INPUTS"] = INPUTS
from api.services import breadth_corrected_pass as cp
from api.services import breadth_universes as bu
from api.services import build_intraday_cache as bic
frm = "2008-01-02"
out = {"problems": []}
P = out["problems"]
man_sha = cp._sha(os.path.join(INPUTS, "INPUT_MANIFEST.json"))
launch = cp.launch_record(ART)
man0 = json.load(open(os.path.join(INPUTS, "INPUT_MANIFEST.json")))
req_to = man0["last_session"]
pit_sha = cp._sha(os.path.join(INPUTS, "pit_uct_ledger.json"))
if not launch.get("launch_preflight_clean_at"): P.append("no clean launch record")
if launch.get("launch_input_manifest_sha256") != man_sha: P.append("manifest sha differs")
if launch.get("launch_pit_ledger_sha256") != pit_sha: P.append("PIT ledger sha differs")
if (launch.get("launch_from"), launch.get("launch_to")) != (frm, req_to): P.append("range differs")
cur = json.loads(json.dumps(cp.current_pins(), sort_keys=True))
if json.loads(launch.get("launch_pins") or "null") != cur: P.append("pins differ from launch")
c = sqlite3.connect("file:%s?mode=ro&immutable=1" % ART, uri=True)
stray = c.execute("SELECT COUNT(*) FROM pass_checkpoint WHERE date < ? OR date > ?", (frm, req_to)).fetchone()[0]
if stray: P.append("%d stray checkpoints" % stray)
pf = cp.preflight(INPUTS, now_utc=launch["launch_preflight_clean_at"])
P.extend("PREFLIGHT: " + p for p in pf["problems"])
def md5lf(p): return hashlib.md5(open(p, "rb").read().replace(b"\r\n", b"\n")).hexdigest()
out.update({
 "vintage": man0.get("tag"), "last_session": req_to, "range": [frm, req_to],
 "launch_record": {k: (v if k != "launch_pins" else hashlib.sha256(v.encode()).hexdigest()) for k, v in launch.items()},
 "manifest_sha256": man_sha, "pit_ledger_sha256": pit_sha,
 "acquisition_window": man0.get("acquisition_window"), "grouped_fetch_window": man0.get("grouped_fetch_window"),
 "input_objects_sha256": man0["objects_sha256"],
 "grouped_files_verified": pf["checks"].get("grouped_files_verified"),
 "cache_valid_until": pf["checks"].get("cache_valid_until"), "judged_at": pf["checks"].get("now_utc"),
 "flags": {k: pf["checks"].get(k) for k in cp.PRODUCTION_WRITING_FLAGS},
 "pins_now": cur, "pins_file_sha256": cp._sha(cp.PINS_PATH),
 "research_universes_in_registry": [r for r in cp.RESEARCH_UNIVERSES if r in bu.UNIVERSES],
 "module_files": {m.__name__: m.__file__ for m in (cp, bic)},
 "build_intraday_cache_md5_lf": md5lf(bic.__file__),
 "checkpoint_namespace": {"artifact": ART, "rows": c.execute("select count(*) from pass_checkpoint").fetchone()[0],
                          "legs": [k for k, in c.execute("select key from pass_meta where key like 'leg%_started_at'")]},
 "deployment": os.environ.get("RAILWAY_DEPLOYMENT_ID"), "git": os.environ.get("RAILWAY_GIT_COMMIT_SHA"),
})
print(json.dumps(out, indent=1, default=str))
