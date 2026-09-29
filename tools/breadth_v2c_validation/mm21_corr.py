"""mm21 — CORRECTION side. ⚠ NOT independent by design: this process runs the correction's own
modules (the pinned code dir overlaid on /app, exactly as the grind ran them) to record, for each
(date, universe) that golden4 scored non-exact, the per-name EMA level and every price the path
compared against it. Pairs with mm21_oracle.py; mm21_explain.py diffs the two.
argv: CODE_DIR (the pinned correction code dir, e.g. /data/_audit/v2cc/code_<md5>)"""
import os, sys, json, collections
CODE = sys.argv[1]
if os.environ.get("_MM21_CHILD") != "1":
    env = {}
    for kv in open('/proc/1/environ', 'rb').read().split(b'\0'):
        if b'=' in kv:
            k, v = kv.split(b'=', 1); env[k.decode()] = v.decode(errors='replace')
    here = os.path.dirname(os.path.abspath(__file__))
    env['PYTHONPATH'] = here + ':/app'
    env['_MM21_CHILD'] = '1'
    os.chdir(here)
    exe = os.readlink('/proc/1/exe')
    os.execve('/usr/bin/nice', ['nice', '-n', '15', exe, '-u', os.path.abspath(__file__)] + sys.argv[1:], env)
sys.path.insert(0, "/app")
import api.services
api.services.__path__.insert(0, os.path.join(CODE, "api", "services"))
import mm21_common as mc
TAG = mc.TAG
os.environ["BREADTH_GROUPED_DIR"] = "/data/grouped_closes_" + TAG
INP = os.environ["BREADTH_V2C2_INPUTS"] = "/data/_audit/v2cc/inputs_" + TAG
mc.arm_guard()
import numpy as np
from api.services import breadth_corrected_pass as cp
from api.services import breadth_grouped_history as gh
from api.services import breadth_live as bl
from api.services import breadth_wick_recon as wr
from api.services import build_intraday_cache as bic
led = json.load(open("/data/_audit/v2cc/final/LEDGER_%s.json" % TAG))
dig = cp._code_digests()
pins = led["pins"]["modules_md5_lf"]
bad = {k: (dig.get(k), v) for k, v in pins.items() if dig.get(k) != v}
print("module pins", "OK" if not bad else bad, flush=True)
assert not bad, "overlay code does not match the grind's pinned modules"
for p in (bl, wr, cp, gh):
    assert p.__file__.startswith(CODE), p.__file__
want = collections.defaultdict(set)
for x in mc.cells():
    want[x["date"]].add(x["u"])
inp = cp.Inputs(INP)
client = wr._s3_client()
_orig = bl.compute_metrics
for D in sorted(want):
    key = wr._S3_KEY.format(y=D[:4], m=D[5:7], d=D)
    per_all = ((bic.download_and_resample(client, key, [1], None) or {}).get(1)) or {}
    assert per_all, "no minute file for %s" % D
    unis = cp.resolve_universes(D, set(per_all), inp, inp.ref_map, cp.UNIVERSES)
    union = sorted({t for v in unis.values() for t in v})
    frame = gh.frame_dates(D)
    withhold = frozenset(t for t in union if frame and (
        inp.guard.withheld(t, frame[0], D) or inp.divbasis.withheld_in(t, frame[0], D)))
    levels = gh.levels_for_day(union, D, withhold=withhold, dividend_basis=inp.divbasis)
    factors = {t: f for t, f in gh.session_factors(D, union).items() if t not in withhold}
    eod_px = gh.official_closes(D, union)
    tk = levels["tickers"]
    ix = {t: i for i, t in enumerate(tk)}
    for u in sorted(want[D]):
        names = unis[u]
        cap = []

        def spy(lv, prices, vols=None, *a, **k):
            px = np.full(len(lv["tickers"]), np.nan)
            for i, t in enumerate(lv["tickers"]):
                v = prices.get(t)
                if v is not None and v > 0:
                    px[i] = v
            cap.append(px)
            return _orig(lv, prices, vols, *a, **k)
        bl.compute_metrics = spy
        try:
            sub = {t: per_all[t] for t in names if t in per_all}
            out = wr.session_ohlc(D, sub, levels, 1, members=set(names), basis=factors,
                                  eod_prices=eod_px, path_rule=wr.PATH_RULE, calendar_window=True,
                                  rolling_prior=None)
        finally:
            bl.compute_metrics = _orig
        sel = np.array([ix[t] for t in names if t in ix])
        PX = np.stack(cap, axis=1)[sel]            # col 0 = official close, cols 1.. = buckets
        np.savez_compressed(os.path.join(mc.OUTDIR, "corr_%s_%s.npz" % (D, u)),
                            names=np.array([tk[i] for i in sel]), ema=levels["ema20_prev"][sel], PX=PX,
                            withheld=np.array([tk[i] in withhold for i in sel]))
        r = out.get("pct_above_20ema")
        print(D, u, "names", len(sel), "buckets", PX.shape[1] - 1, "session_ohlc", r, flush=True)
        with open(os.path.join(mc.OUTDIR, "corr_%s_%s.json" % (D, u)), "w") as f:
            json.dump({"date": D, "u": u, "pct_above_20ema": r, "members": len(names),
                       "buckets": (out.get("_session") or {}).get("buckets")}, f)
print("DONE", flush=True)
