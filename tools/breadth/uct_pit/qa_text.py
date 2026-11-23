"""Cover-page counts vs machine-readable counts: for an issuer with both, the text count nearest
before its first XBRL count, as a ratio (after splits are not applied: both raw). Value-free."""
import gzip, json, bisect
from collections import Counter
ROOT = "/data/_audit/uct_pit"
x = json.load(gzip.open(f"{ROOT}/shares.json.gz", "rt"))
t = json.load(gzip.open(f"{ROOT}/text_shares.json.gz", "rt"))
buckets = Counter(); n = 0; sus = []
for cik, obs in t.items():
    xo = sorted(o for o in x.get(str(cik).lstrip("0"), []) if o[3] in ("cover", "bs"))
    if not xo: buckets["no_xbrl_to_compare"] += 1; continue
    first = xo[0]
    tt = sorted(o for o in obs if o[0] <= first[0])
    if not tt: buckets["no_text_before"] += 1; continue
    r = first[2] / tt[-1][2]; n += 1
    b = ("<0.002" if r < 0.002 else "0.002-0.5" if r < 0.5 else "0.5-0.8" if r < 0.8 else "0.8-1.25" if r <= 1.25
         else "1.25-2" if r <= 2 else "2-500" if r <= 500 else ">500")
    buckets[b] += 1
    if b in ("<0.002", ">500"): sus.append(cik)
print("issuers with text counts", len(t), "compared", n)
print({k: v for k, v in sorted(buckets.items())})
print("scale-suspect issuers", len(sus))
