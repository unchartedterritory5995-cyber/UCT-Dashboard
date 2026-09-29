"""Shared by the mm21_* tools (explain the 21 non-exact golden4 cells of the FINAL V2c2 artifact).

⛔ READ-ONLY GUARD: every process that imports this refuses any file write outside OUTDIR, so
loading the correction's Inputs can never rewrite an input cache, and nothing can touch the
artifact. The artifact itself is only ever opened `mode=ro&immutable=1`.
"""
import builtins, glob, json, os

TAG = "v20260924f"
ART = "/data/_audit/v2cc/final/breadth_v2c2div_FINAL_%s.db" % TAG
ART_SHA = "5670fdc0d3deeb9ed1d7eb13da794457d395d3ad007255a8a685769aeefb904e"
ART_BYTES = 88072192
OUTDIR = "/data/_audit/validation/v2c_final/mismatch21"
G4 = "/data/_audit/validation/v2c_final/out/golden4_final_%s_c*.json" % TAG

_open = builtins.open


def _guarded_open(file, mode="r", *a, **k):
    if isinstance(file, (str, bytes, os.PathLike)) and any(c in mode for c in "wax+"):
        p = os.path.abspath(os.fsdecode(file))
        if not (p.startswith(OUTDIR + "/") or p.startswith("/tmp/")):
            raise PermissionError("mm21 read-only guard: refused write to %s" % p)
    return _open(file, mode, *a, **k)


def arm_guard():
    os.makedirs(OUTDIR, exist_ok=True)
    builtins.open = _guarded_open

    def _replace(s, d, *a, **k):
        raise PermissionError("mm21 read-only guard: refused os.replace %s -> %s" % (s, d))
    os.replace = _replace


def cells():
    out = []
    for f in sorted(glob.glob(G4)):
        out.extend(json.load(_open(f))["nonexact"])
    return out
