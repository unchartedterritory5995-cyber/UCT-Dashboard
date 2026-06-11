"""Run catalyst collect->gate->tag->score->select locally (prod env via
`railway run`), no synthesis / no Perplexity / no Twitter => $0. Shows what the
tile would select right now + the raw gap-scan view of premarket movers."""
import os, sys
os.environ["CATALYST_PERPLEXITY_ENABLED"] = "0"
os.environ["CATALYST_TWITTER_SEARCH_ENABLED"] = "0"
sys.path.insert(0, ".")

from api.services.catalyst import sources, filters, tagging, scoring, selection

cands = sources.collect_all()
print(f"collected: {len(cands)} candidates")
gap_scan = [c for c in cands if c.get("from_gap_scan")]
print(f"  from gap_scan: {len(gap_scan)}")

kept, excluded = [], []
for c in cands:
    ok, reason = filters.quality_gate(c)
    if ok:
        ok, reason = filters.is_real_catalyst(c)
    (kept if ok else excluded).append((c, reason))
print(f"gates: kept {len(kept)}, excluded {len(excluded)}")

for c, _ in kept:
    c["tag"] = tagging.assign_tag(c)
    c["score"] = scoring.score(c)
scored = [c for c, _ in kept if c.get("tag")]
untagged = [c for c, _ in kept if not c.get("tag")]
print(f"tagged: {len(scored)}  |  TAG=None (dropped): {len(untagged)}")
if untagged:
    print("  dropped-untagged sample:", ", ".join(
        f"{c['ticker']}({c.get('gap_pct', 0):+.1f}%)" for c in
        sorted(untagged, key=lambda x: abs(x.get("gap_pct") or 0), reverse=True)[:12]))

top = selection.select_top_12(scored)
print(f"\nSELECTED {len(top)}:")
print(f"{'#':>2} {'TICK':<6} {'TAG':<9} {'SCORE':>6} {'GAP%':>7} {'VOLx':>5} "
      f"{'CAP($B)':>8} {'GS':<3} {'TW':>2} {'RSS':>3} SECTOR")
for i, c in enumerate(top, 1):
    cap = (c.get("market_cap") or 0) / 1e9
    print(f"{i:>2} {c['ticker']:<6} {(c.get('tag') or '-'):<9} {c.get('score', 0):>6.1f} "
          f"{(c.get('gap_pct') or 0):>+7.2f} {(c.get('vol_x') or 0):>5.1f} "
          f"{cap:>8.1f} {'Y' if c.get('from_gap_scan') else '-':<3} "
          f"{len(c.get('tweets') or []):>2} {len(c.get('rss') or []):>3} "
          f"{(c.get('sector') or '?')[:18]}")

print("\nGAP-SCAN top 20 by |gap| (the raw premarket-mover view):")
for c in sorted(gap_scan, key=lambda x: abs(x.get("gap_pct") or 0), reverse=True)[:20]:
    sel = "SELECTED" if any(t["ticker"] == c["ticker"] for t in top) else ""
    cap = (c.get("market_cap") or 0) / 1e9
    print(f"  {c['ticker']:<6} {(c.get('gap_pct') or 0):>+7.2f}%  cap={cap:>7.1f}B  "
          f"tag={c.get('tag') or 'None'}  {sel}")
