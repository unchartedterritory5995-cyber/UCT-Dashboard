"""PHASE 7b — provider ADJUSTED-series discontinuities and what they do to membership.

`vintage_scan.json` lists events where a name's raw close is continuous but its adjusted
close jumps by a split-like factor between consecutive sessions. Many sit inside ONE fetch
batch, so they are not vintage breaks — they are defects in the provider's adjusted
series. The corrected pass has no gate for them: its coherence check compares the grouped
close with the grouped close.

For each event with a `to` date inside 2008-01-02..2026-09-11:
  - is the name a member of any universe that session (UCT pinned / reference CS|ADRC)?
  - on the event session, would it register as a 52-week high/low, a 4% mover, above its
    200-day SMA — computed from the adjusted series exactly as the pass would see it
  - for how many later sessions does the pre-jump scale remain inside its 251-session
    52-week window / 200-session SMA window (the contamination tail)
UCT symbol reuse is quantified alongside: member-sessions that fall BEFORE a pinned
symbol's current continuous trading segment.
"""
import bisect
import collections
import json
import os

from common import GROUPED, PINNED_UCT, calendar, write
import oracle as O

cal = calendar()
ci = {d: i for i, d in enumerate(cal)}
vs = json.load(open("/data/_audit/validation/v2c_final/out/vintage_scan.json"))
ev = [e for e in vs["vintage_breaks"] if "2008-01-02" <= e["to"] <= "2026-09-11"]
ref = json.load(open("/data/breadth_pit_reference.json"))
from api.services import breadth_pit_frame as bpf
from api.services import breadth_universes as bu
uct = set(json.load(open(PINNED_UCT))["tickers"])

def member(t, D):
    out = []
    if t in uct:
        out.append("uct")
    rec = bpf.resolve(ref.get(t), D)
    if rec and rec.get("type") in bpf.COMMON_TYPES:
        ex = (rec.get("primary_exchange") or "").upper()
        out += [u for u in ("us", "nasdaq", "nyse") if ex in bu.venues(u)]
    return out

rows = []
for e in ev:
    t, D = e["t"], e["to"]
    i = ci[D]
    hist = []
    for d in cal[max(0, i - 251):i]:
        v = O.dashed(O.grouped_raw(d, True)).get(t.replace(".", "-"))
        hist.append(v)
    px = O.dashed(O.grouped_raw(D, True)).get(t.replace(".", "-"))
    full = [h for h in hist if h is not None]
    flags = {}
    if px and len(full) == len(hist) and hist:
        flags["new_52w_high"] = px >= max(hist) * 0.999
        flags["new_52w_low"] = px <= min(hist) * 1.001
        flags["above_200sma"] = px > (sum(hist[-199:]) + px) / 200 if len(hist) >= 199 else None
    if px and hist and hist[-1]:
        r = px / hist[-1] - 1
        flags["up_4pct"] = r >= 0.04
        flags["down_4pct"] = r <= -0.04
    rows.append({**e, "members": member(t, D), "flags": flags,
                 "tail_sessions_in_2008_2026": min(251, len([d for d in cal[i:i + 251] if d <= "2026-09-11"]))})
inm = [r for r in rows if r["members"]]
R = {"events_in_range": len(rows), "events_on_members": len(inm),
     "events_on_members_by_universe": dict(collections.Counter(u for r in inm for u in r["members"])),
     "spurious_flags_on_event_day": dict(collections.Counter(k for r in inm for k, v in r["flags"].items() if v)),
     "distinct_member_names": sorted({r["t"] for r in inm}),
     "member_events": inm}

# UCT symbol reuse: pinned symbols' continuous segments in the RAW grouped files
pres = collections.defaultdict(list)
for i, d in enumerate(cal):
    for k in json.load(open(os.path.join(GROUPED, "%s_0.json" % d))):
        if k in uct:
            pres[k].append(i)
cur_start, pre = {}, collections.Counter()
for t, idx in pres.items():
    start = idx[0]
    for a, b in zip(idx, idx[1:]):
        if b - a > 60:
            start = b
    cur_start[t] = cal[start]
    for j in idx:
        if j < start and "2008-01-02" <= cal[j] <= "2026-09-11":
            pre[cal[j][:4]] += 1
R["uct_pre_segment_member_sessions_by_year"] = dict(sorted(pre.items()))
R["uct_symbols_with_pre_segment_history_in_range"] = sum(
    1 for t, idx in pres.items() if any(j < ci[cur_start[t]] and "2008-01-02" <= cal[j] <= "2026-09-11" for j in idx))
sizes = collections.Counter()
for t, idx in pres.items():
    for j in idx:
        if "2008-01-02" <= cal[j] <= "2026-09-11":
            sizes[cal[j][:4]] += 1
R["uct_member_sessions_by_year"] = dict(sorted(sizes.items()))
R["uct_pre_segment_share_by_year"] = {y: round(100.0 * pre[y] / sizes[y], 2) for y in sorted(sizes)}
print(write("provider_adj_events.json", R))
print(json.dumps({k: v for k, v in R.items() if k != "member_events"}, indent=1)[:6000])
for r in inm[:40]:
    print(r["t"], r["from"], r["to"], r["f_step"], r["raw_ratio"], r["adj_ratio"], r["members"], r["flags"])
