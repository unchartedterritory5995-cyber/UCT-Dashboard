import sys, re, json
from datetime import datetime, timezone, date, timedelta
from load import load
from run import yahoo_ledger
from docs import doc_of_type, earnings_8k_near
from api.services.fundamentals_pit import knowledge as K, metrics as M
from api.services.fundamentals_pit.concepts import PRIMITIVES
from api.services.fundamentals_pit.filings import ET
TAGS = {tg for p in PRIMITIVES.values() for tg in p.tags}
def book_at(t_sym, when):
    doc, sub, fl, fx = load(t_sym); kb = K.build(fx, fl)
    st = {k: v for k, v in kb.state_at(when).items() if k[0] in TAGS}
    return M.build_book(st, yahoo_ledger(t_sym), kb, when), fl, sub, kb
def fmt_m(v, scale): return f"{v/scale:,.0f}"
CASES = json.load(open("cases.json"))
rows = []
for c in CASES:
    t = c["t"]; q = date.fromisoformat(c["q"])
    when = datetime.fromisoformat(c.get("at", "2026-09-22")).replace(tzinfo=timezone.utc)
    b, fl, sub, kb = book_at(t, when)
    cik = int(json.load(open(os.path.join(__import__("fetch").CACHE, f"facts_{t}.json")))["cik"])
    pages = [sub["filings"]["recent"]]
    # the document to check against
    if c["doc"] == "pr":
        near = earnings_8k_near(pages, cik, (q + timedelta(days=5)).isoformat(), (q + timedelta(days=75)).isoformat())
        accn = near[0][1] if near else None
        txt = doc_of_type(cik, accn, "EX-99") if accn else None
    else:
        accn = c["doc"]; txt = doc_of_type(cik, accn, c.get("type", "10-"))
    for metric, how, scale, dec in c["checks"]:
        if how == "q": v = M.quarter_value(b, metric, q)
        elif how == "ttm": v = M.ttm(b, metric, q)
        elif how == "i": v = M.instant(b, metric, q)
        val = v.v if v else None
        s = None if val is None else (f"{abs(val)/scale:,.{dec}f}")
        pat = r"(?<![\d,.])" + re.escape(s) + r"(?![\d,])"
        ms = list(re.finditer(pat, txt)) if (txt and s) else []
        if metric == "eps_diluted":     # the number must sit on a DILUTED line
            ms = [m for m in ms if re.search(r"(?i)dilut", txt[max(0, m.start()-120):m.start()])
                  and not re.search(r"(?i)basic\s*\$?\s*$", txt[max(0, m.start()-12):m.start()])]
        found = bool(ms)
        snip = ""
        if found:
            m = ms[0]; snip = txt[max(0, m.start()-70):m.end()+10]
        rows.append((t, c["q"], metric, how, v.note if v else "-", s, accn, "MATCH" if found else "NOT FOUND", snip))
        print(f"{t:5s} {c['q']} {metric:18s} {how:3s} {(v.note if v else '-'):11s} ours={s!s:>12} doc={accn} -> {'MATCH' if found else 'NOT FOUND'} | {snip[-90:]}")
json.dump(rows, open("validation_rows.json", "w"), indent=1, default=str)
