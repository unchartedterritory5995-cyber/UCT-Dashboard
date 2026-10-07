"""Exchange Breadth V1 — validate the derived artifact against an INDEPENDENT implementation.

Usage: python validate_derived.py INPUTS.json DERIVED.db OUT.json

The independent calculation below imports nothing from the project: plain-Python A/D, ratio-adjusted
input, 0.10/0.05 trends from a zero seed, a count-based 120-observation burn-in and a declared-epoch
summation. Every stored value is compared to it. The production path (`derive`) is then exercised
for append-only/no-lookahead (prefixes), hole behaviour (synthetic holes) and determinism.
"""
import hashlib
import json
import os
import sqlite3
import sys

INP, DB, OUT = sys.argv[1:4]
HERE = os.path.dirname(os.path.abspath(__file__))
raw = open(INP, "rb").read()
doc = json.loads(raw)
A_FAST, A_SLOW, BURN = 0.10, 0.05, 120


def independent(rows):
    """[(date, adv, dec)] -> {AD, MCO, MCS} dicts of published values."""
    ad, mco_all, out_ad = 0.0, [], {}
    f = s = None
    seen = 0
    for d, a, de in rows:
        ad += a - de
        out_ad[d] = ad
        if a + de <= 0:                       # zero denominator: a hole, trends not advanced
            mco_all.append((d, None))
            continue
        x = (a - de) / (a + de) * 1000.0
        if f is None:
            f, s = (1 - A_FAST) * 0.0 + A_FAST * x, (1 - A_SLOW) * 0.0 + A_SLOW * x
        else:
            f, s = (1 - A_FAST) * f + A_FAST * x, (1 - A_SLOW) * s + A_SLOW * x
        mco_all.append((d, f - s))
    out_mco, out_mcs, lvl, epoch = {}, {}, None, None
    for d, o in mco_all:
        if o is not None:
            seen += 1
        if epoch is None and seen > BURN:      # first session with BURN real observations before it
            epoch, lvl = d, 0.0
            out_mco[d], out_mcs[d] = o, 0.0
            continue
        if epoch is not None:
            if o is not None:
                out_mco[d] = o
                lvl += o
            out_mcs[d] = lvl
    return {"AD": out_ad, "MCO": out_mco, "MCS": out_mcs, "epoch": epoch}


c = sqlite3.connect(f"file:{DB}?immutable=1", uri=True)
meta = dict(c.execute("SELECT key, value FROM derived_meta"))
stored = {}
for sname, d, v in c.execute("SELECT series, date, value FROM derived_series"):
    stored.setdefault(sname, {})[d] = v
rep = {"derived": DB, "derived_sha256": hashlib.sha256(open(DB, "rb").read()).hexdigest(),
       "inputs_sha256": hashlib.sha256(raw).hexdigest(), "checks": {}, "series": {}}
chk = rep["checks"]
chk["meta inputs/source hashes match"] = (meta["inputs_sha256"] == rep["inputs_sha256"]
                                          and meta["source_artifact_sha256"] == doc["source_sha256"])
for u, X in (("nyse", "NYSE"), ("nasdaq", "NASDAQ")):
    rows = [(r[0], r[1], r[2]) for r in doc["series"][u]]
    unch = {r[0]: r[3] for r in doc["series"][u]}
    ind = independent(rows)
    dates = [r[0] for r in rows]
    for k in ("AD", "MCO", "MCS"):
        st, iv = stored.get(f"{X}:{k}", {}), ind[k]
        diffs = [abs(st[d] - iv[d]) for d in iv if d in st]
        rep["series"][f"{X}:{k}"] = {"rows": len(st), "first": min(st), "last": max(st),
                                     "independent_rows": len(iv), "same_dates": set(st) == set(iv),
                                     "bit_exact": sum(1 for d in iv if st.get(d) == iv[d]),
                                     "max_abs_diff": max(diffs) if diffs else None}
        chk[f"{X}:{k} == independent (same dates, |diff| <= 1e-9)"] = set(st) == set(iv) and max(diffs) <= 1e-9
    i0 = dates.index(ind["epoch"])
    chk[f"{X} start == canonical"] = dates[0] == doc["starts"][u] == meta[f"{X}.start"]
    chk[f"{X}:AD first == ADV0-DEC0 (base 0 before start)"] = stored[f"{X}:AD"][dates[0]] == rows[0][1] - rows[0][2]
    chk[f"{X}:AD cumulative arithmetic (every step == ADV-DEC)"] = all(
        stored[f"{X}:AD"][dates[i]] - stored[f"{X}:AD"][dates[i - 1]] == rows[i][1] - rows[i][2] for i in range(1, len(dates)))
    chk[f"{X}:MCO first publish = 121st valid session (index 120)"] = (
        i0 == 120 and min(stored[f"{X}:MCO"]) == dates[120] == meta[f"{X}.mco_first_publish"])
    chk[f"{X}:MCO nothing published inside burn-in"] = all(d not in stored[f"{X}:MCO"] for d in dates[:120])
    chk[f"{X}:MCS epoch == MCO first publish, value 0"] = stored[f"{X}:MCS"].get(dates[120]) == 0.0
    chk[f"{X}:MCS(t)-MCS(t-1) == MCO(t) after epoch"] = all(
        abs(stored[f"{X}:MCS"][dates[i]] - stored[f"{X}:MCS"][dates[i - 1]] - stored[f"{X}:MCO"][dates[i]]) <= 1e-9
        for i in range(121, len(dates)))
    # unchanged exclusion is real: including it changes the input on every session with unchanged > 0
    inc = sum(1 for d, a, de in rows if unch[d] and (a - de) / (a + de) != (a - de) / (a + de + unch[d]))
    chk[f"{X}:MCO input excludes unchanged (differs from inclusive on {inc} sessions)"] = inc > 0
    # the first raw trend values pin seed 0 and the exact rates
    d0, a0, e0 = rows[0]
    x0 = (a0 - e0) / (a0 + e0) * 1000.0
    rep["series"][f"{X}:seed_probe"] = {"x0": x0, "fast0": 0.10 * x0, "slow0": 0.05 * x0, "osc0": 0.05 * x0}
    rep["series"][f"{X}:mco_first_publish"] = dates[120]
    rep["series"][f"{X}:burn_in_last"] = dates[119]

# ── production path: append-only / no-lookahead, holes, determinism ─────────────────────────
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(HERE))))
sys.path.insert(0, os.path.dirname(HERE))
import derive_exchange_series as dx  # noqa: E402

for u, X in (("nyse", "NYSE"), ("nasdaq", "NASDAQ")):
    rows = doc["series"][u]
    D, AV, DC = [r[0] for r in rows], [r[1] for r in rows], [r[2] for r in rows]
    full = dx.derive(D, AV, DC)
    bad = 0
    cuts = [n for n in (130, 250, 500, 1000, 2000, 3000, 4000, len(D) - 1) if n < len(D)]
    for n in cuts:
        pre = dx.derive(D[:n], AV[:n], DC[:n])
        for k in ("AD", "MCO", "MCS"):
            bad += sum(1 for i in range(n) if pre[k][i] != full[k][i])
    chk[f"{X} append-only/no-lookahead: {len(cuts)} prefixes reproduce the full history exactly"] = bad == 0
    chk[f"{X} derive() deterministic"] = dx.derive(D, AV, DC) == full
    # synthetic hole at session 300 (and 50, inside burn-in): AD holds; MCO None and trends NOT advanced;
    # the series after the hole equals the series with that session removed (state unchanged by a hole)
    for h in (50, 300):
        AVh, DCh = list(AV), list(DC)
        AVh[h] = DCh[h] = None
        wh = dx.derive(D, AVh, DCh)
        wo = dx.derive(D[:h] + D[h + 1:], AV[:h] + AV[h + 1:], DC[:h] + DC[h + 1:])
        ad_hold = wh["AD"][h] == wh["AD"][h - 1]
        mco_none = wh["MCO"][h] is None
        tail_eq = all(abs((wh["MCO"][i] or 0) - (wo["MCO"][i - 1] or 0)) <= 1e-12 for i in range(h + 1, len(D)))
        epoch_shift = D.index(wh["epoch"]) == D.index(full["epoch"]) + (1 if h < 120 else 0)
        mcs_hold = h < D.index(wh["epoch"]) or wh["MCS"][h] == wh["MCS"][h - 1]
        chk[f"{X} hole@{h}: AD holds, MCO none, trends not advanced, epoch counts real obs, MCS holds"] = (
            ad_hold and mco_none and tail_eq and epoch_shift and mcs_hold)
rep["pass"] = all(chk.values())
json.dump(rep, open(OUT, "w"), indent=1, sort_keys=True)
print(json.dumps({"pass": rep["pass"], "failed": [k for k, v in chk.items() if not v],
                  "series": {k: v for k, v in rep["series"].items() if isinstance(v, (dict, str))}}, indent=1, default=str))
