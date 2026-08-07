#!/usr/bin/env python3
"""Click EVERY Data Charts preset in a real browser and assert the chart draws.

The unit tests already prove axis layout and colour assignment THROUGH the real
rules. This proves the rest of the chain — preset click -> selection -> ECharts
-> actual pixels — which is the seam the unit tests cannot see and where this
feature has twice shipped a defect a browser caught first (QQQ drawn as a dead
flat line; a live-row background that flattened the whole heat map).

The assertion is INK ON THE CANVAS, not "a chart element exists". A mounted
ECharts container with zero series still has a container, so presence proves
nothing; a preset that selects nothing would sail through that check.

Serves the local `app/dist` and proxies /api to production, so it measures the
built bundle against real data.

    python tools/breadth_preset_check.py        # exit 0 clean, 1 on any failure

Two harness notes, both learned the hard way:
  * Popover buttons render as `label + hint` concatenated, so an exact-text
    match finds nothing. Prefix-match instead.
  * The popover is taller than the viewport; entries below the fold need
    scrollIntoView before the click, or they read as "not found" when they are
    simply off-screen.
"""
import re, threading, socketserver, importlib.util, sys
from pathlib import Path
R = r"C:\Users\Patrick\uct-worktrees\breadth-live"
spec = importlib.util.spec_from_file_location("vc", R + r"\tools\breadth_live_visual_check.py")
vc = importlib.util.module_from_spec(spec); spec.loader.exec_module(vc)
src = Path(R + r"\app\src\pages\breadth\chartMetrics.js").read_text(encoding="utf-8")
blk = src[src.find("export const CHART_PRESETS"):]
LABELS = [m.group(2) for m in re.finditer(r"id: .([a-z0-9-]+).,[\s\S]{0,120}?label: .([^']+).", blk)]
CORE = ['Market Health','Breadth vs Price','Participation','Breadth Thrust',
        'Volatility & Fear','A/D Line','Highs/Lows %']
print(f"{len(LABELS)} presets in source ({len(CORE)} core, {len(LABELS)-len(CORE)} popover)\n")
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(("127.0.0.1", vc.PORT), vc.Proxy)
threading.Thread(target=srv.serve_forever, daemon=True).start()
INK = """() => {
  const c=document.querySelector('div[_echarts_instance_] canvas');
  if(!c) return {ink:0,colors:0};
  const g=c.getContext('2d'); const d=g.getImageData(0,0,c.width,c.height).data;
  const hues=new Set(); let lit=0;
  for(let i=0;i<d.length;i+=4*37){
    const r=d[i],gg=d[i+1],b=d[i+2],a=d[i+3];
    if(a<40) continue; const mx=Math.max(r,gg,b),mn=Math.min(r,gg,b);
    if(mx<60) continue; lit++;
    if(mx-mn>25) hues.add(`${Math.round(r/48)}-${Math.round(gg/48)}-${Math.round(b/48)}`);
  }
  return {ink:lit, colors:hues.size};
}"""
CLICK = """(label)=>{
  const b=[...document.querySelectorAll('button')].filter(e=>e.offsetParent!==null)
    .find(e=>e.textContent.trim().startsWith(label));
  if(!b) return false; b.scrollIntoView({block:'center'}); b.click(); return true;
}"""
from playwright.sync_api import sync_playwright
fails=[]; rows=[]
with sync_playwright() as pw:
    b=pw.chromium.launch(headless=True)
    pg=b.new_context(viewport={"width":1440,"height":900}).new_page()
    errs=[]
    pg.on("console", lambda m: errs.append(m.text) if m.type=="error" else None)
    pg.goto(f"http://127.0.0.1:{vc.PORT}/breadth", wait_until="networkidle", timeout=90000)
    for sel in ("button:has-text('Skip')","button"):
        try: pg.click(sel, timeout=3000); break
        except Exception: continue
    pg.wait_for_timeout(3000)
    pg.click("button:has-text('Data Charts')", timeout=20000); pg.wait_for_timeout(3000)
    try: pg.click("button:has-text('Got it')", timeout=2500)
    except Exception: pass
    for label in LABELS:
        kind = "core" if label in CORE else "popover"
        if kind == "popover":
            try: pg.click("button:has-text('More')", timeout=6000); pg.wait_for_timeout(320)
            except Exception: pass
        clicked = pg.evaluate(CLICK, label)
        if not clicked:
            fails.append(f"{label}: not found"); rows.append(("MISS",label,kind,None,None)); continue
        pg.wait_for_timeout(1500)
        d=pg.evaluate(INK)
        ok = d["ink"]>150 and d["colors"]>=1
        if not ok: fails.append(f"{label}: {d}")
        rows.append((("OK" if ok else "FAIL"), label, kind, d["ink"], d["colors"]))
    real=[e for e in errs if "favicon" not in e.lower() and "404" not in e]
    b.close()
srv.shutdown()
for st,label,kind,ink,col in rows:
    print(f"  {st:<5} {label:<32} {kind:<8} ink={str(ink):>5} colors={str(col):>3}")
print(f"\ntested {len(rows)}/{len(LABELS)} · console errors: {len(real)}")
for e in real[:4]: print("   ", e[:120])
if real: fails.append(f"{len(real)} console errors")
print("\nRESULT:", f"PASS - all {len(rows)} presets draw" if not fails
      else f"FAIL ({len(fails)})\n  " + "\n  ".join(str(f) for f in fails[:10]))
sys.exit(1 if fails else 0)
