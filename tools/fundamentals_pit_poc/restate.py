"""List period keys whose value CHANGED across filings (restatements), excluding pure split re-basing."""
import sys, collections
from load import load
from api.services.fundamentals_pit import knowledge as K
from api.services.fundamentals_pit.filings import ET
TAGS = sys.argv[2].split(",") if len(sys.argv) > 2 else None
t = sys.argv[1]
doc, sub, fl, fx = load(t); kb = K.build(fx, fl)
amend = [a for a, f in fl.items() if f.form in ("10-K/A", "10-Q/A")]
print(t, "amendments:", [(a, fl[a].form, fl[a].public_at.astimezone(ET).strftime("%Y-%m-%d %H:%M"), fl[a].report_date) for a in amend])
n = 0
for key, rows in sorted(kb.history.items(), key=lambda kv: (kv[0][0], str(kv[0][3]))):
    if TAGS and key[0].split(":")[1] not in TAGS: continue
    vals = [r.fact.val for r in rows]
    if len(set(vals)) > 1 and key[1] == "USD":
        n += 1
        if n <= 40:
            print(" ", key[0].split(":")[1], key[2], key[3], " -> ", " | ".join(f"{r.public_at.astimezone(ET):%Y-%m-%d %H:%M} {r.form} {r.fact.accn} {r.fact.val:,.0f}" for r in rows))
print("USD keys with changed values:", n, "of", sum(1 for k in kb.history if k[1] == "USD"))
