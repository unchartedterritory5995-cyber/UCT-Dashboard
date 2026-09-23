import glob, hashlib, json, os, shutil, time
def sha(p):
    h = hashlib.sha256(); f = open(p, "rb")
    for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()
W = "/data/_audit/v2cc"; here = os.path.dirname(os.path.abspath(__file__))
rep = W + "/V2C2_CORRECTION_REPORT_2026-09-23.md"; idx = W + "/V2C2_CORRECTION_INDEX_2026-09-23.json"
assert not os.path.exists(rep) and not os.path.exists(idx)
fz = "/data/_audit/breadth_replacement_v2_corrected_COMPLETE_FROZEN_2026-09-23.db"
I = {"written_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
     "correction_commit": os.environ.get("C", ""), "validator_commit": "9fabd6a64873f3b368345bee9c8b437003a95923",
     "merge_design_commit": "33971f6898cf4e69a0406781150952cfe0b8bd9c",
     "frozen_v2c": {"sha256": sha(fz), "unchanged": sha(fz) == "ad8c157fceafad163b844b113cb1784a9d9672ccbb732ed6c8a8270d37afe8e8"},
     "artifacts": {p: sha(p) for p in (W + "/bounded_matrix_v2c2.db", W + "/pit_uct_2026_v2c2.db")},
     "inputs": {os.path.basename(p): sha(p) for p in glob.glob(W + "/inputs/*.json")},
     "validator_results": {os.path.basename(p): sha(p) for p in glob.glob("/data/_audit/validation/v2c_final/out/*.json")},
     "census": {os.path.basename(p): sha(p) for p in glob.glob(W + "/*.json")}}
json.dump(I, open(idx, "x"), indent=1)
shutil.copyfile(os.path.join(here, "V2C2_CORRECTION_REPORT_2026-09-23.md"), rep)
for p in (rep, idx, W + "/bounded_matrix_v2c2.db", W + "/pit_uct_2026_v2c2.db"): os.chmod(p, 0o444)
print(json.dumps({"index": idx, "report": rep, "frozen_unchanged": I["frozen_v2c"]["unchanged"], "artifacts": I["artifacts"]}, indent=1))
