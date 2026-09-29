"""Compute V2 sessions for ONE vintage with the accepted corrected pass — twice — and report.

argv: INPUTS_DIR GROUPED_DIR DATES(csv, ascending) PRIORS_JSON OUT_JSON WORK_DIR
(run through run_overlay.py; never imported by a server process)

* preflight must be clean (pins, every input + grouped-file hash, vintage window, PIT live_from)
* PRIORS_JSON seeds the ratio priors ({universe: {date: {up_4pct_today, down_4pct_today}}}) —
  the 9 canonical sessions before the first date; later dates use the batch's own rows
* the batch runs TWICE into two fresh work artifacts; the rows must be identical (determinism)
* the membership each universe was computed over is captured (durable session identity)
Writes only under WORK_DIR and OUT_JSON.
"""
import hashlib
import json
import os
import sqlite3
import sys
import time

INPUTS, GROUPED, DATES, PRIORS, OUT, WORK = sys.argv[1:7]
os.environ["BREADTH_GROUPED_DIR"] = GROUPED
os.environ["BREADTH_V2C2_INPUTS"] = INPUTS
from api.services import breadth_calendar as bcal  # noqa: E402
from api.services import breadth_corrected_pass as cp  # noqa: E402
from api.services import breadth_v2_overlay as ov  # noqa: E402

dates = sorted(DATES.split(","))
res = {"dates": dates, "started_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
       "overlay": ov.status()}
# BV2_PREFLIGHT_AT: judge vintage staleness at a RECORDED instant — reproduction proofs on a past
# vintage only (the accepted `--resume` rule). The producer never sets it.
pf = cp.preflight(INPUTS, now_utc=os.environ.get("BV2_PREFLIGHT_AT") or None)
res["preflight_problems"] = pf["problems"]
res["preflight_now"] = pf["checks"].get("now_utc")
if pf["problems"]:
    json.dump(res, open(OUT, "w"), indent=1, default=str)
    print(json.dumps({"REFUSED": pf["problems"]}))
    sys.exit(3)

members = {}
_orig = cp.resolve_universes


def _spy(D, traded, inp, ref_map, universes):
    out = _orig(D, traded, inp, ref_map, universes)
    members.setdefault(D, {u: sorted(v) for u, v in out.items()})
    return out


cp.resolve_universes = _spy
priors = json.load(open(PRIORS))


def one(tag):
    art = os.path.join(WORK, "work_%s.db" % tag)
    for s in ("", "-wal", "-shm"):
        if os.path.exists(art + s):
            os.remove(art + s)
    c = cp.open_artifact(art)
    c.executemany("INSERT INTO breadth_daily_ohlc(universe,date,metric,o,h,l,c,source,updated_at) "
                  "VALUES(?,?,?,?,?,?,?,'prior_seed',datetime('now'))",
                  [(u, d, m, v, v, v, v) for u, byd in priors.items() for d, mv in byd.items()
                   for m, v in mv.items() if v is not None])
    c.commit()
    c.close()
    stats = cp.run(art, dates, cp.UNIVERSES, INPUTS, progress_every=0)
    c = sqlite3.connect("file:%s?mode=ro" % art, uri=True)
    rows = sorted(c.execute("SELECT universe,date,metric,o,h,l,c,source FROM breadth_daily_ohlc "
                            "WHERE source <> 'prior_seed' ORDER BY universe,date,metric").fetchall())
    ck = {d: (s, det) for d, s, det in c.execute("SELECT date,status,detail FROM pass_checkpoint")}
    sess = {r[0]: {"universe_sizes": json.loads(r[1] or "{}"), "universe_buckets": json.loads(r[2] or "{}"),
                   "withheld": json.loads(r[3] or "{}"), "dual_class": json.loads(r[4] or "{}"),
                   "last_bar_min": r[5], "expected_buckets": r[6], "early_close": r[7]}
            for r in c.execute("SELECT * FROM pass_session_v2c2")}
    meta = dict(c.execute("SELECT key, value FROM pass_meta"))
    c.close()
    return stats, rows, ck, sess, meta


t0 = time.time()
sa, ra, cka, sessa, meta = one("a")
sb, rb, ckb, sessb, _ = one("b")
res.update(seconds=round(time.time() - t0, 1), stats=[sa, sb], determinism=(ra == rb and cka == ckb and sessa == sessb),
           checkpoints=cka, sessions=sessa, rows=ra, members=members,
           calendar={d: {"trading_day": bcal.is_trading_day(d), "window": bcal.session_window(d)} for d in dates},
           meta={k: meta.get(k) for k in ("methodology", "guard_version", "guard_input_key", "dividend_input_key",
                                          "grouped_calendar", "path_rule", "ema", "price_basis", "identity_rule",
                                          "pit_uct_live_from", "input_fingerprints")},
           membership_sha256={d: {u: hashlib.sha256("\n".join(v).encode()).hexdigest() for u, v in m.items()}
                              for d, m in members.items()})
json.dump(res, open(OUT, "w"), default=str)
print(json.dumps({"ok": True, "determinism": res["determinism"], "stats": sa, "seconds": res["seconds"]}))
