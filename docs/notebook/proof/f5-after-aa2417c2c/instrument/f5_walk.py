"""Lane F5's wrapper around 10E-1's proof walk (tools/notebook_proof_walk.py from the LOCAL
branch feat/notebook-w10-e1, copied here with ONE change: REPO read from $PROOF_REPO).

The walk's own geometry and axe sweeps run UNCHANGED (their controls must fail as they
must). After them, in the same boot and on the same seeded accounts, this adds ONE extra
reading, `f5probe.json`, for the questions the two sweeps do not answer directly:

  overflow   at 390/820/1200, per list surface: does `main` (or the document) actually PAN
             sideways (scrollLeft moves), or is the extra width clipped?  And what widens it.
  board      the board's columns container: does IT scroll its own overflow, or does an
             ancestor (the Notebook's pane / the app's main) scroll or clip it?
  coachmark  the "Meet Compass" card and the tour card: their boxes, and every control the
             card's box intersects that is not inside it.
  voicehint  the dictation first-run hint: its box, and every control it intersects.
  skiplink   at 390, what a tap at the centre of the Journal's "Today" and "Trades" tabs hits.

CONTROL for the probe: a planted 1400 px element inside `main` must make `main` pan
(scrollLeft moves), and a planted fixed box over a planted button must be reported as
intersecting it, at every width. A probe whose control did not fail is reported INVALID.
(v1 planted the wide element in the Notebook root; above 640 px the Notebook panel clips its
own overflow by design, so v1's pan plant could not fail there -- v2 plants in `main`.)
"""
from __future__ import annotations

import json
import os
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
REPO = Path(os.environ["PROOF_REPO"])
sys.path.insert(0, str(REPO))

import notebook_proof_walk as PW  # noqa: E402

OVERFLOW_JS = r"""() => {
  const m = document.querySelector('main');
  const out = {vw: innerWidth};
  if (m) {
    const cs = getComputedStyle(m);
    const b = m.scrollLeft; m.scrollLeft = 100000; const pan = m.scrollLeft; m.scrollLeft = b;
    out.main = {overflowX: cs.overflowX, scrollW: m.scrollWidth, clientW: m.clientWidth, pans_px: pan};
  }
  const se = document.scrollingElement;
  const bx = scrollX; scrollTo(100000, scrollY); const dpan = scrollX; scrollTo(bx, scrollY);
  out.doc = {scrollW: se.scrollWidth, clientW: se.clientWidth, pans_px: dpan};
  // every ancestor of the notebook root that can pan sideways, or clips width it holds
  const root = document.querySelector('[data-proof-root]');
  out.chain = [];
  for (let a = root; a && a !== document.documentElement; a = a.parentElement) {
    const cs = getComputedStyle(a);
    if (a.scrollWidth > a.clientWidth + 1) {
      const b2 = a.scrollLeft; a.scrollLeft = 100000; const p2 = a.scrollLeft; a.scrollLeft = b2;
      out.chain.push({tag: a.tagName, cls: (typeof a.className === 'string' ? a.className : '').slice(0, 60),
                      overflowX: cs.overflowX, scrollW: a.scrollWidth, clientW: a.clientWidth, pans_px: p2});
    }
  }
  // what sticks out past the viewport inside the notebook root (outermost only)
  out.wide = [];
  if (root) {
    const found = [];
    for (const el of root.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.right <= innerWidth + 1) continue;
      if (found.some(f => f.contains(el))) continue;
      let held = false;
      for (let a = el.parentElement; a && a !== root; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if (['auto', 'scroll', 'hidden', 'clip'].includes(ox)) { held = true; break; }
      }
      if (held) continue;
      found.push(el);
      if (out.wide.length < 8) out.wide.push({tag: el.tagName, cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60),
        text: (el.innerText || '').trim().split('\n')[0].slice(0, 40), right: Math.round(r.right), width: Math.round(r.width)});
    }
  }
  return out;
}"""

BOARD_JS = r"""() => {
  const secs = Array.from(document.querySelectorAll('[data-proof-root] section[aria-label]'));
  if (!secs.length) return {found: false};
  const cont = secs[0].parentElement;
  const cs = getComputedStyle(cont);
  const cr = cont.getBoundingClientRect();
  const b = cont.scrollLeft; cont.scrollLeft = 100000; const pan = cont.scrollLeft; cont.scrollLeft = b;
  const cols = secs.map(s => { const r = s.getBoundingClientRect(); return {label: s.getAttribute('aria-label'), left: Math.round(r.left), right: Math.round(r.right)}; });
  // the visible right edge: the tightest ancestor box that clips or scrolls
  let visRight = innerWidth, by = 'viewport';
  for (let a = cont; a && a !== document.documentElement; a = a.parentElement) {
    const ox = getComputedStyle(a).overflowX;
    if (['auto', 'scroll', 'hidden', 'clip'].includes(ox)) {
      const r = a.getBoundingClientRect();
      if (r.right < visRight) { visRight = r.right; by = a.tagName + '.' + (typeof a.className === 'string' ? a.className.split(' ')[0] : ''); }
    }
  }
  const anc = [];
  for (let a = cont.parentElement; a && a !== document.documentElement; a = a.parentElement) {
    if (a.scrollWidth > a.clientWidth + 1) {
      const b2 = a.scrollLeft; a.scrollLeft = 100000; const p2 = a.scrollLeft; a.scrollLeft = b2;
      anc.push({tag: a.tagName, cls: (typeof a.className === 'string' ? a.className : '').slice(0, 60),
                overflowX: getComputedStyle(a).overflowX, scrollW: a.scrollWidth, clientW: a.clientWidth, pans_px: p2});
    }
  }
  const beyond = cols.filter(c => c.right > Math.min(visRight, innerWidth) + 1).map(c => c.label);
  const bt = parseFloat(cs.borderTopWidth) || 0, bb = parseFloat(cs.borderBottomWidth) || 0;
  return {found: true, container: {overflowX: cs.overflowX, scrollW: cont.scrollWidth, clientW: cont.clientWidth,
          left: Math.round(cr.left), right: Math.round(cr.right), pans_px: pan, position: cs.position,
          scrollbar_px: Math.round(cont.offsetHeight - cont.clientHeight - bt - bb),
          scrollbarWidth: cs.scrollbarWidth || null, scrollbarColor: cs.scrollbarColor || null},
          visible_right: Math.round(visRight), visible_right_by: by, columns: cols, beyond_visible_right: beyond,
          ancestors_wider_than_their_box: anc};
}"""

# every control the box of `sel`-matched element intersects that is not inside it
COVER_JS = r"""(args) => {
  const [what, textRe] = args;
  const re = new RegExp(textRe);
  const vis = (el) => { const cs = getComputedStyle(el); return el.getClientRects().length > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  let card = null;
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const own = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.nodeValue).join(' ');
    if (re.test(own) || (el.children.length === 0 && re.test(el.textContent || ''))) { card = el; break; }
  }
  if (!card) return {what, found: false};
  // climb to the card's own box: the nearest ancestor that is positioned or in-flow block with a border
  let box = card;
  for (let a = card; a && a !== document.body; a = a.parentElement) {
    const cs = getComputedStyle(a);
    if (cs.position === 'absolute' || cs.position === 'fixed' || a.getAttribute('role') === 'status' || a.hasAttribute('data-coachmark') || a.hasAttribute('data-orb-coachmark')) { box = a; break; }
  }
  const r = box.getBoundingClientRect();
  const SEL = 'button,a[href],[role=button],[role=tab],input:not([type=hidden]),select,textarea,[contenteditable="true"]';
  const hits = [];
  for (const el of document.querySelectorAll(SEL)) {
    if (box.contains(el) || !vis(el)) continue;
    const b = el.getBoundingClientRect();
    if (b.width <= 0 || b.height <= 0) continue;
    const ix = Math.min(r.right, b.right) - Math.max(r.left, b.left);
    const iy = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
    if (ix > 1 && iy > 1) {
      // is the control actually painted under the card? (elementFromPoint at the overlap centre)
      const cx = (Math.max(r.left, b.left) + Math.min(r.right, b.right)) / 2;
      const cy = (Math.max(r.top, b.top) + Math.min(r.bottom, b.bottom)) / 2;
      const hit = document.elementFromPoint(cx, cy);
      hits.push({name: (el.getAttribute('aria-label') || (el.innerText || '').trim().split('\n')[0] || el.getAttribute('placeholder') || '').slice(0, 50),
                 tag: el.tagName, overlap: [Math.round(ix), Math.round(iy)], card_on_top: !!(hit && box.contains(hit))});
    }
  }
  const cs = getComputedStyle(box);
  return {what, found: true, position: cs.position, box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
          intersects: hits, intersects_on_top: hits.filter(h => h.card_on_top).length};
}"""

TOUR_JS = r"""() => {
  const d = document.querySelector('[role=dialog][aria-modal="true"]');
  const t = d && /STEP\s+\d+\s+OF/i.test(d.innerText || '') ? d : null;
  if (!t) return {tour_open: false};
  const r = t.getBoundingClientRect();
  return {tour_open: true, tour_box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]};
}"""

SKIP_JS = r"""() => {
  const out = {tabs: [], skip_links: []};
  const desc = (el) => el ? (el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '') + ' "' + ((el.innerText || '').trim().split('\n')[0] || '').slice(0, 30) + '"') : null;
  for (const name of ['Today', 'Trades']) {
    const el = Array.from(document.querySelectorAll('button,a,[role=tab]')).find(e => (e.innerText || '').trim() === name
      && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0);
    if (!el) { out.tabs.push({name, found: false}); continue; }
    const b = el.getBoundingClientRect();
    const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    out.tabs.push({name, found: true, box: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
                   hit: desc(hit), hit_is_tab: !!(hit && (hit === el || el.contains(hit))),
                   hit_in_skip_link: !!(hit && hit.closest('a[href^="#"]') && /^skip\b/i.test((hit.closest('a').innerText || '').trim()))});
  }
  for (const a of document.querySelectorAll('a[href^="#"]')) {
    if (!/^skip\b/i.test((a.innerText || '').trim())) continue;
    const b = a.getBoundingClientRect(); const cs = getComputedStyle(a);
    out.skip_links.push({text: (a.innerText || '').trim().slice(0, 40), href: a.getAttribute('href'),
                         box: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
                         transform: cs.transform, opacity: cs.opacity, visibility: cs.visibility, zIndex: cs.zIndex});
  }
  return out;
}"""

PLANT_JS = r"""() => {
  const m = document.querySelector('main');
  const w = document.createElement('div'); w.setAttribute('data-f5-plant', '1');
  w.style.cssText = 'width:1400px;height:4px;background:#c00';
  m.insertBefore(w, m.firstChild);
  const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = 'F5 planted control';
  btn.setAttribute('data-f5-plant', '1'); btn.style.cssText = 'position:fixed;left:20px;top:300px;width:120px;height:40px;z-index:1';
  const cov = document.createElement('div'); cov.setAttribute('data-f5-plant', '1'); cov.setAttribute('data-coachmark', '1');
  cov.style.cssText = 'position:fixed;left:10px;top:290px;width:200px;height:60px;z-index:2;background:rgba(0,0,0,.2)';
  cov.textContent = 'F5 planted cover';
  document.body.appendChild(btn); document.body.appendChild(cov);
  return true;
}"""
UNPLANT_JS = r"""() => { for (const e of document.querySelectorAll('[data-f5-plant]')) e.remove(); return true; }"""

OVERFLOW_SURFACES = ("nb-list", "nb-table", "nb-board", "nb-calendar", "nb-timeline", "nb-search", "nb-bulk",
                     "nb-templates", "nb-import", "nb-saved-view", "nb-publish-folder", "nb-home", "nb-graph",
                     "nb-tasks", "nb-trash", "nb-note")


def f5_probe(W) -> dict:
    out = {"control": {}, "overflow": [], "board": [], "coachmark": [], "voicehint": [], "skiplink": []}
    modes = ("phone", "tablet", "desktop")
    # CONTROL
    ctl_ok = True
    for mode in modes:
        pg, tap, root, acct = PW.open_surface(W, PW.surface_by_id("nb-list"), mode)
        try:
            pg.wait_for_timeout(600)
            base = pg.evaluate(OVERFLOW_JS)
            pg.evaluate(PLANT_JS)
            pg.wait_for_timeout(300)
            planted = pg.evaluate(OVERFLOW_JS)
            cov = pg.evaluate(COVER_JS, ["plant", "^F5 planted cover$"])
            pg.evaluate(UNPLANT_JS)
        finally:
            pg.close()
        pans = max((planted.get("main") or {}).get("pans_px", 0), planted["doc"]["pans_px"],
                   max([c["pans_px"] for c in planted.get("chain", [])] or [0]))
        seen_cover = any(h["name"] == "F5 planted control" and h["card_on_top"] for h in cov.get("intersects", []))
        row = {"mode": mode, "pan_found": pans > 0, "pans_px": pans, "cover_found": seen_cover,
               "baseline_main": base.get("main")}
        out["control"][mode] = row
        ctl_ok = ctl_ok and row["pan_found"] and row["cover_found"]
    out["control_ok"] = ctl_ok
    PW.say(f"[{'VALID' if ctl_ok else 'INVALID'}] f5probe control: {json.dumps(out['control'])[:300]}")
    # overflow
    for sid in OVERFLOW_SURFACES:
        for mode in modes:
            cell = {"surface": sid, "mode": mode, "width": PW.VIEWPORTS[mode]["width"]}
            try:
                pg, tap, root, acct = PW.open_surface(W, PW.surface_by_id(sid), mode)
            except Exception as e:  # noqa: BLE001
                cell.update(status="UNREACHED", reason=f"{type(e).__name__}: {e}"[:200])
                out["overflow"].append(cell)
                continue
            try:
                pg.wait_for_timeout(800)
                cell.update(status="MEASURED", **pg.evaluate(OVERFLOW_JS))
                if sid == "nb-board":
                    b = pg.evaluate(BOARD_JS)
                    b.update(mode=mode, width=cell["width"])
                    out["board"].append(b)
                if sid == "nb-list" and mode == "phone":
                    s = pg.evaluate(SKIP_JS)
                    s["screenshot"] = PW.shot(W, pg, "f5-skiplink-390")
                    out["skiplink"].append(s)
            except Exception as e:  # noqa: BLE001
                cell.update(status="ERROR", reason=f"{type(e).__name__}: {e}"[:200])
            finally:
                pg.close()
            m = cell.get("main") or {}
            PW.say(f"[f5 overflow] {sid} @{cell['width']}: main {m.get('scrollW')}/{m.get('clientW')} "
                   f"pans {m.get('pans_px')} doc pans {(cell.get('doc') or {}).get('pans_px')}")
            out["overflow"].append(cell)
    # coachmark / tour / voice hint, on the first-run surfaces
    for sid in ("nb-first-run", "nb-note-first-run"):
        for mode in modes:
            try:
                pg, tap, root, acct = PW.open_surface(W, PW.surface_by_id(sid), mode)
            except Exception as e:  # noqa: BLE001
                out["coachmark"].append({"surface": sid, "mode": mode, "status": "UNREACHED",
                                         "reason": f"{type(e).__name__}: {e}"[:200]})
                continue
            try:
                pg.wait_for_timeout(1200)
                w = PW.VIEWPORTS[mode]["width"]
                c = pg.evaluate(COVER_JS, ["coachmark", "Meet Compass"])
                t = pg.evaluate(TOUR_JS)
                if c.get("found") and t.get("tour_open"):
                    a, b = c["box"], t["tour_box"]
                    ix = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
                    iy = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
                    t["overlaps_coachmark"] = ix > 1 and iy > 1
                c.update(surface=sid, mode=mode, width=w, status="MEASURED", tour=t,
                         screenshot=PW.shot(W, pg, f"f5-coach-{sid}-{w}"))
                out["coachmark"].append(c)
                v = pg.evaluate(COVER_JS, ["voicehint", "speak instead of type"])
                v.update(surface=sid, mode=mode, width=w, status="MEASURED")
                out["voicehint"].append(v)
                PW.say(f"[f5 coach] {sid} @{w}: card {c.get('found')} {c.get('position')} "
                       f"covers {c.get('intersects_on_top')}; tour {t}; voice hint {v.get('found')} "
                       f"covers {v.get('intersects_on_top')}")
            except Exception as e:  # noqa: BLE001
                out["coachmark"].append({"surface": sid, "mode": mode, "status": "ERROR",
                                         "reason": f"{type(e).__name__}: {e}"[:200]})
            finally:
                pg.close()
    return out


def run_sweeps(base, art, sweeps, only):
    """10E-1's run_sweeps, verbatim in what it runs, plus the f5 probe before the browser closes."""
    from playwright.sync_api import sync_playwright
    R = PW.res
    axe_path = PW.REPO / "app" / "node_modules" / "axe-core" / "axe.min.js"
    axe_src = axe_path.read_text(encoding="utf-8")
    R["axe_core"] = {"path": str(axe_path.relative_to(PW.REPO)), "bytes": len(axe_src)}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        W = PW.World(browser, base, art)
        R["run"] = W.run
        W.admin_login()
        t0 = time.time()
        PW.seed(W)
        R["seed"] = {k: v for k, v in W.fx.items() if k != "rich_body"}
        R["seed_seconds"] = round(time.time() - t0, 1)
        PW.say(f"[SEED] {json.dumps(R['seed'], default=str)[:300]}")
        PW.dump("run", R)
        order = [s for s in ("census", "geometry", "axe", "silent", "deadclick") if s in sweeps]
        for sw in order:
            t1 = time.time()
            try:
                if sw == "geometry":
                    out = PW.geometry_sweep(W, only)
                elif sw == "axe":
                    out = PW.axe_sweep(W, only, axe_src)
                elif sw == "silent":
                    out = PW.silent_sweep(W, only)
                elif sw == "deadclick":
                    out = PW.deadclick_sweep(W, only)
                elif sw == "census":
                    out = PW.census_sweep(W, only)
                ctl = out.get("controls", {})
                R["sweep_status"][sw] = {"control_ok": ctl.get("ok"), "control_why": ctl.get("why"),
                                         "findings": PW.findings_count(sw, out),
                                         "seconds": round(time.time() - t1, 1)}
                R["findings_total"] = sum(int(v.get("findings") or 0) for v in R["sweep_status"].values())
            except Exception as e:  # noqa: BLE001
                R["sweep_status"][sw] = {"control_ok": None, "error": f"{type(e).__name__}: {e}"[:400],
                                         "traceback": traceback.format_exc()[-2000:]}
                PW.say(f"[ERROR] sweep {sw}: {type(e).__name__}: {e}"[:300])
            PW.dump("run", R)
        t1 = time.time()
        try:
            f5 = f5_probe(W)
            f5["seconds"] = round(time.time() - t1, 1)
        except Exception as e:  # noqa: BLE001
            f5 = {"error": f"{type(e).__name__}: {e}"[:400], "traceback": traceback.format_exc()[-2000:]}
            PW.say(f"[ERROR] f5probe: {type(e).__name__}: {e}"[:300])
        PW.dump("f5probe", f5)
        browser.close()


PW.run_sweeps = run_sweeps

if __name__ == "__main__":
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        except Exception:  # noqa: BLE001
            pass
    sys.exit(PW.main())
