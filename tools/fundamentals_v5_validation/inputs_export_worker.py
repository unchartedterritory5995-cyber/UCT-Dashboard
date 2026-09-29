"""WORKER: stage the two SEC bulk files the V4/V5 store was ingested from (2026-09-23, public SEC data) into the
PRIVATE run prefix so the dedicated runner can run the established stage-2 parity test on identical inputs.
Reads the two zips; writes ONLY under _runs/fundamentals_pit_v5/<run>/validation_inputs/ in R2 and one local json.
Touches no production store, no fundamentals_pit/ publication key, no flag."""
import sys
sys.path.insert(0, "/app")
import hashlib, json, os, time
from api.services import data_sync

RUN_ID = "v5-20260925T124921Z"
PREFIX = f"_runs/fundamentals_pit_v5/{RUN_ID}/validation_inputs/"
W = "/data/fundamentals_pit_work"
OUT = W + "/v5_transfer/inputs_presigned.json"


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


assert PREFIX.startswith("_runs/") and "fundamentals_pit/v" not in PREFIX
cl, bucket = data_sync._client(), data_sync._bucket()
man = {"run_id": RUN_ID, "purpose": "stage-2 parity inputs (the SEC bulk files the source store was ingested from)",
       "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "files": {}}
for name in ("companyfacts.zip", "submissions.zip"):
    p = f"{W}/{name}"
    s = os.stat(p)
    man["files"][name] = {"bytes": s.st_size, "sha256": sha(p),
                          "mtime": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(s.st_mtime)), "key": PREFIX + name}
    cl.upload_file(p, bucket, PREFIX + name)
    man["files"][name]["r2_bytes"] = cl.head_object(Bucket=bucket, Key=PREFIX + name)["ContentLength"]
    print("uploaded", name, man["files"][name], flush=True)
mb = json.dumps(man, indent=1, sort_keys=True).encode()
cl.put_object(Bucket=bucket, Key=PREFIX + "inputs_manifest.json", Body=mb)
urls = {n: cl.generate_presigned_url("get_object", Params={"Bucket": bucket, "Key": f["key"]}, ExpiresIn=86400)
        for n, f in man["files"].items()}
json.dump({"manifest": man, "urls": urls}, open(OUT, "w"))
print("MANIFEST_SHA256", hashlib.sha256(mb).hexdigest())
print("DONE")
