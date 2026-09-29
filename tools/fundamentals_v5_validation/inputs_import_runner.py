"""RUNNER: download the stage-2 parity inputs via short-lived presigned GETs and verify sha256.
Writes only /data/fundamentals_pit_work/{companyfacts,submissions}.zip (+ a report). Deletes the url file after."""
import hashlib, json, os, sys, time, urllib.request

W = "/data/fundamentals_pit_work"
os.makedirs(W, exist_ok=True)
src = sys.argv[1]
doc = json.load(open(src))
rep = {"started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "files": {}}


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


try:
    for name, f in doc["manifest"]["files"].items():
        dst = f"{W}/{name}"
        if os.path.exists(dst):
            sys.exit(f"REFUSED: {dst} exists")
        with urllib.request.urlopen(doc["urls"][name], timeout=900) as r, open(dst + ".part", "wb") as o:
            while True:
                b = r.read(1 << 20)
                if not b:
                    break
                o.write(b)
        got = sha(dst + ".part")
        rep["files"][name] = {"expected": f["sha256"], "got": got, "bytes": os.path.getsize(dst + ".part"), "ok": got == f["sha256"]}
        if got != f["sha256"]:
            sys.exit(f"STOP: hash mismatch {name}")
        os.rename(dst + ".part", dst)
finally:
    os.remove(src)
    rep["finished"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    json.dump(rep, open(W + "/inputs_import_report.json", "w"), indent=1)
    print(json.dumps(rep, indent=1))
