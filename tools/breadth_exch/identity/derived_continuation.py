"""Exchange Breadth V1 — DRY-RUN continuation of AD / MCO / MCS across the frozen → live boundary.

Usage: python derived_continuation.py FROZEN_INPUTS.json FROZEN_DERIVED.db DRY_ROWS.json OUT.json

1. BOUNDARY STATE from the accepted artifacts only: the frozen derived artifact gives AD and MCS at
   the last frozen session; the EMA trends (not stored) are reconstructed by folding the frozen
   inputs through the production TrendState — and that fold must reproduce EVERY frozen MCO value
   bit-exactly, which is what makes the reconstructed state the accepted one.
2. APPEND the dry-run sessions' ADV/DEC from that state (O(1) per session, history untouched).
3. INDEPENDENT full-history calculation (no project imports) over frozen inputs + appended sessions:
   the appended values must match, and the historical part must equal the frozen artifact.
"""
import hashlib
import json
import os
import sqlite3
import sys

INP, DER, DRY, OUT = sys.argv[1:5]
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(HERE))))
from api.services.market_indicators import mcclellan as mc  # noqa: E402

doc = json.load(open(INP))
c = sqlite3.connect(f"file:{DER}?immutable=1", uri=True)
frozen = {}
for s, d, v in c.execute("SELECT series, date, value FROM derived_series"):
    frozen.setdefault(s, {})[d] = v
meta = dict(c.execute("SELECT key, value FROM derived_meta"))
dry = json.load(open(DRY))
new = {}
for u, d, m, o, h, l, cc, src in dry:
    if u in ("nyse", "nasdaq") and m in ("advancing", "declining"):
        new.setdefault(u, {}).setdefault(d, {})[m] = cc
rep = {"derived_sha256": hashlib.sha256(open(DER, "rb").read()).hexdigest(),
       "inputs_sha256": hashlib.sha256(open(INP, "rb").read()).hexdigest(), "exchanges": {}, "checks": {}}
for u, X in (("nyse", "NYSE"), ("nasdaq", "NASDAQ")):
    rows = doc["series"][u]
    dates = [r[0] for r in rows]
    # ── 1. boundary state ──
    st = mc.TrendState(seed_mode=mc.SEED_ZERO)
    n_valid, osc_ok = 0, True
    epoch = meta[f"{X}.mco_first_publish"]
    for d, a, de, _u in rows:
        x = mc.normalise(a, de, 0.0, mc.RATIO_ADJUSTED)
        if x is None:
            continue
        o = st.step(x)
        n_valid += 1
        if d >= epoch and frozen[f"{X}:MCO"].get(d) != o:
            osc_ok = False
    last = dates[-1]
    bound = {"session": last, "AD": frozen[f"{X}:AD"][last], "MCS": frozen[f"{X}:MCS"][last],
             "ema_fast": st.ema19, "ema_slow": st.ema39, "valid_obs": n_valid, "burned_in": n_valid > 120,
             "MCO_frozen_last": frozen[f"{X}:MCO"][last], "fold_reproduces_every_frozen_MCO": osc_ok}
    # ── 2. append from the boundary state only ──
    ad, mcs, out = bound["AD"], bound["MCS"], []
    for d in sorted(new[u]):
        a, de = new[u][d]["advancing"], new[u][d]["declining"]
        ad = ad + (a - de)
        x = mc.normalise(a, de, 0.0, mc.RATIO_ADJUSTED)
        if x is None:                                  # a hole: AD/MCS hold, trends untouched
            out.append([d, ad, None, mcs])
            continue
        o = st.step(x)
        mcs = mcs + o
        out.append([d, ad, o, mcs])
    # ── 3. independent full-history calculation ──
    allrows = [(r[0], r[1], r[2]) for r in rows] + [(d, new[u][d]["advancing"], new[u][d]["declining"]) for d in sorted(new[u])]
    lvl, f, s_, seen, ep, lv2 = 0.0, None, None, 0, None, None
    ind = {}
    for d, a, de in allrows:
        lvl += a - de
        if a + de <= 0:
            ind[d] = (lvl, None, lv2)
            continue
        x = (a - de) / (a + de) * 1000.0
        f, s_ = (0.10 * x, 0.05 * x) if f is None else (0.9 * f + 0.10 * x, 0.95 * s_ + 0.05 * x)
        o = f - s_
        seen += 1
        if ep is None and seen > 120:
            ep, lv2 = d, 0.0
        elif ep is not None:
            lv2 += o
        ind[d] = (lvl, o if ep else None, lv2)
    hist_eq = all(ind[d][0] == frozen[f"{X}:AD"][d] for d in dates) and \
        all(ind[d][1] == frozen[f"{X}:MCO"][d] and ind[d][2] == frozen[f"{X}:MCS"][d] for d in dates if d >= epoch)
    app_eq = all(abs(ind[d][0] - a_) <= 1e-9 and abs(ind[d][1] - o_) <= 1e-9 and abs(ind[d][2] - m_) <= 1e-9
                 for d, a_, o_, m_ in out)
    bitexact = all(ind[d][0] == a_ and ind[d][1] == o_ and ind[d][2] == m_ for d, a_, o_, m_ in out)
    rep["exchanges"][X] = {"boundary": bound, "appended": out, "independent_epoch": ep, "frozen_epoch": epoch}
    rep["checks"][f"{X} boundary fold reproduces every frozen MCO"] = osc_ok
    rep["checks"][f"{X} independent full history == frozen (AD all, MCO/MCS from epoch)"] = hist_eq
    rep["checks"][f"{X} appended == independent full-history calc"] = app_eq
    rep["checks"][f"{X} appended bit-exact"] = bitexact
    rep["checks"][f"{X} epoch unchanged by append"] = ep == epoch
    rep["checks"][f"{X} append is contiguous after the frozen end"] = min(new[u]) > last
rep["pass"] = all(rep["checks"].values())
json.dump(rep, open(OUT, "w"), indent=1, sort_keys=True)
print(json.dumps({"pass": rep["pass"], "checks": rep["checks"],
                  "appended": {X: v["appended"] for X, v in rep["exchanges"].items()},
                  "boundary": {X: v["boundary"] for X, v in rep["exchanges"].items()}}, indent=1))
