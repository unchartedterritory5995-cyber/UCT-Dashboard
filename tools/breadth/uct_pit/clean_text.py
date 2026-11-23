"""Stage 2c: guard the cover-page counts before they enter the list. Value-free output.
A cover page read wrong is usually off by a scale (a count 'in thousands', or a dollar figure read
as shares); too LARGE a count would put a small company in the list, so every text count must
 (1) be a plausible share count (1e5 .. 3e10),
 (2) sit within 10x of the issuer's own median cover-page count, and
 (3) when the issuer later files XBRL, sit within 5x of its first XBRL count once splits between
     the two dates are applied (dilution over a few years stays well inside that).
Writes text_shares_clean.json.gz."""
import gzip, json, os, statistics, sys
sys.path.insert(0, "/data/_audit/uct_pit/code")
from membership import ROOT, Ref, Splits, load
from collections import Counter
x = load(f"{ROOT}/shares.json.gz"); t = load(f"{ROOT}/" + os.environ.get("C_IN", "text_shares.json.gz"))
ref, spl = Ref(), Splits()
tick = {}
for tk, recs in ref.by.items():
    for _dl, _ld, _typ, cik in recs:
        if cik: tick.setdefault(cik, tk)
why = Counter(); out = {}
for cik, obs in t.items():
    c = str(cik).lstrip("0")
    obs = [o for o in obs if 1e5 <= o[2] <= 3e10] if obs else []
    why["implausible"] += len(t[cik]) - len(obs)
    if not obs: continue
    med = statistics.median(o[2] for o in obs)
    keep = [o for o in obs if 0.1 <= o[2] / med <= 10]
    why["off_own_median"] += len(obs) - len(keep)
    xo = sorted(o for o in x.get(c, []) if o[3] in ("cover", "bs"))
    if xo:
        first = xo[0]; tk = tick.get(c); k2 = []
        for o in keep:
            f = spl.factor(tk, o[0], first[0]) if tk else 1.0
            r = first[2] / (o[2] * f)
            if 0.2 <= r <= 5: k2.append(o)
            else: why["off_xbrl"] += 1
        keep = k2
    if keep: out[cik] = keep
    else: why["issuer_dropped"] += 1
json.dump(out, gzip.open(f"{ROOT}/" + os.environ.get("C_OUT", "text_shares_clean.json.gz"), "wt"))
print("issuers in", len(t), "kept", len(out), "obs dropped", dict(why))
