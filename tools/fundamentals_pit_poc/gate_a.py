"""GATE A: accession -> acceptance join over EVERY fact."""
import sys, collections
from load import load
from api.services.fundamentals_pit import knowledge as K
for t in sys.argv[1:]:
    doc, sub, fl, fx = load(t)
    forms = collections.Counter(); miss = collections.Counter(); noacc = 0
    for f in fx:
        if f.accn in fl:
            forms[fl[f.accn].form] += 1
            if fl[f.accn].accepted_at is None: noacc += 1
        else:
            miss[f.form] += 1
    accns = {f.accn for f in fx}; joined = {a for a in accns if a in fl}
    per = [a for a in accns if a in fl and fl[a].form in ('10-K','10-Q','10-K/A','10-Q/A')]
    late = sum(1 for a in joined if fl[a].accepted_at and fl[a].public_at > fl[a].accepted_at)
    print(f"{t}: facts={len(fx)} accns={len(accns)} joined_accns={len(joined)} ({len(joined)/len(accns):.1%}) facts_unjoined={sum(miss.values())} by_form={dict(miss)} no_accept_time={noacc} public_after_accept(after 17:30 / next-day)={late}")
    print("   forms carrying facts:", dict(forms.most_common(12)))
    print("   periodic 10-K/10-Q/A accns:", collections.Counter(fl[a].form for a in per))
