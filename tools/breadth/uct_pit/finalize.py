"""UCT PIT rebuild, stage 6: assemble the served series from the computed chunks.
  rows[date] = the per-universe base columns the Monitor stores for a session (the derive pass
  makes the ratios, hi/lo ratios, net, Health from them), new highs/lows on the intraday basis,
  `mcclellan_osc` over the rebuilt net advances (the V1 recurrence: a = 2/20, 2/40, seeded at the
  first observation), `ad_back` = the rebuilt net advances summed over the sessions AFTER this one
  through the last rebuilt session (the server anchors the A/D line on it so the line runs into
  the collector's sessions without a step), and `new_ath` withheld (needs each name's full history).
Only sessions BEFORE the collector's first session (2026-01-02) are written: from there the
collector / V2 rows are served as they are. Writes /data/_audit/uct_pit/breadth_uct_pit_v1.json."""
import glob, hashlib, json, sys, time
ROOT = "/data/_audit/uct_pit"
LAST = sys.argv[1] if len(sys.argv) > 1 else "2025-12-31"
rows = {}
for p in sorted(glob.glob(f"{ROOT}/out/rows_*.jsonl")):
    if "_ledger" in p: continue
    for line in open(p):
        j = json.loads(line)
        if j.get("ok") and j["date"] <= LAST:
            m = {k: v for k, v in j["metrics"].items() if not k.endswith("_close") and not k.startswith("_")}
            m["new_ath"] = None
            m["members"] = j.get("members")
            rows[j["date"]] = m
ds = sorted(rows)
a19, a39 = 2.0 / 20, 2.0 / 40
e19 = e39 = None
for d in ds:
    v = rows[d].get("adv_decline")
    if v is None:
        rows[d]["mcclellan_osc"] = None; continue
    e19 = v if e19 is None else a19 * v + (1 - a19) * e19
    e39 = v if e39 is None else a39 * v + (1 - a39) * e39
    rows[d]["mcclellan_osc"] = round(e19 - e39, 1)
back = 0
for d in reversed(ds):
    rows[d]["ad_back"] = back
    back += rows[d].get("adv_decline") or 0
body = {"version": "uct-pit-v1", "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "first": ds[0], "last": ds[-1], "sessions": len(ds),
        "method": ("UCT list rebuilt per session from the live rule (CS/ADRC, prior-session close >= $2 and "
                   "volume >= 200k, market cap >= $300M from SEC share counts x prior close, traded that day) "
                   "over every traded US stock incl. delisted; columns from production's breadth engine on "
                   "split- and dividend-adjusted day bars; new highs/lows on the intraday basis"),
        "rows": rows}
raw = json.dumps(body, separators=(",", ":"), sort_keys=True).encode()
open(f"{ROOT}/breadth_uct_pit_v1.json", "wb").write(raw)
print("sessions", len(ds), ds[0], "->", ds[-1], "sha256", hashlib.sha256(raw).hexdigest()[:16], "bytes", len(raw))
