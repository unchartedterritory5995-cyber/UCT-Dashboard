"""STAGE 3: V4-untouched proof, local V5 artifacts, freeze digests, read-only.
`baseline` records the V4 logical digest + R2 v4 index digest (read-only) BEFORE the grind ends;
`freeze` re-measures them and freezes V5. Nothing here writes R2, the prod store, or any flag."""
import sys
CODE = "/data/fundamentals_pit_v5/code/7dfda83de6a7"
sys.path.insert(0, CODE)
import glob, hashlib, json, os, stat, time
from api.services.fundamentals_pit import publish as P, store as S

ROOT = "/data/fundamentals_pit_v5"
RUN, VAL, ART = f"{ROOT}/run", f"{ROOT}/validation", f"{ROOT}/artifacts"
PROD = "/data/fundamentals_pit.db"
BASE = f"{VAL}/v4_baseline.json"


def sha_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def v4_logical(conn):
    h, n = hashlib.sha256(), 0
    for r in conn.execute("SELECT cik, metric, t_eff, v, period_end, method FROM series_point "
                          "WHERE derivation_version=4 ORDER BY cik, metric, t_eff"):
        h.update(repr(r).encode()); n += 1
    b = conn.execute("SELECT count(*), max(built_at) FROM series_build WHERE derivation_version=4").fetchone()
    return {"points": n, "digest": h.hexdigest(), "builds": b[0], "max_built_at": b[1],
            "filing_signal": conn.execute("SELECT count(*) FROM filing_signal").fetchone()[0],
            "has_v5_points": conn.execute("SELECT count(*) FROM series_point WHERE derivation_version=5").fetchone()[0]}


def r2_v4():
    from api.services import data_sync
    out = {}
    for key in (P.index_key(4), P.index_key(5)):
        body = data_sync.get_bytes(key)
        out[key] = hashlib.sha256(body).hexdigest() if body else None
    return out


def measure():
    prod = S.connect(PROD, readonly=True)
    return {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "v4": v4_logical(prod), "r2": r2_v4()}


mode = "baseline"

m = measure()
b = json.load(open(BASE))
st = os.stat(PROD)
print(json.dumps({"now": m, "equal_v4": b["v4"] == m["v4"], "equal_r2": b["r2"] == m["r2"],
                  "prod_mtime": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(st.st_mtime)), "prod_bytes": st.st_size,
                  "code_dir_exists": os.path.isdir(CODE), "launch_renamed": sorted(os.listdir(ROOT))}, indent=1))
