"""Wave 10 lane L3 (clause 6c, "no layout regressions at 390/820/1200") -- the layout instrument.

WHAT IT ANSWERS, per Notebook surface x width x pass:

  a. OCCLUSION. Every interactive element whose visible centre (or 3 of its 5 sample points) lands
     on a DIFFERENT element, with the occluder NAMED by class: the fixed top bar, the Journal
     header, the phone Log FAB, the voice orb, the hub joystick -- or `other` with its description.
     10E-1's sweep could not tell a control SCROLLED under fixed chrome (normal: scroll it back)
     from one that is covered wherever it sits (a defect). This instrument asks the product that
     question directly: every control that is not clear at rest is scrolled into view
     (`scrollIntoView` block center / start / end / nearest, every scroll ancestor at once) and
     re-tested. Clear in any of them = REACHABLE (a lead, cleared, with the reading that cleared
     it). Covered in all of them = CONFIRMED, with the occluder at the best position.
     A control whose centre sits outside its own clipping ancestors is NOT "covered": it is
     scrolled out of its scroller (10E-1 read that as "under the Journal header"); if no scroll
     brings it inside, it is CONFIRMED-CLIPPED (cut off).
     A SWEEP scrolls `<main>` (and up to three inner vertical scrollers) from top to bottom in
     half-screen steps and records every control a named chrome layer covers on the way: the
     10E-1 leads, reproduced, so each one is confirmed or cleared by name.
  b. OVERFLOW. Document and `<main>` scrollWidth vs clientWidth, and whether each really PANS
     (scrollLeft moves) -- F5's reading -- with the outermost elements that widen `<main>`.
  c. TARGETS. Under 24 px on either axis (WCAG 2.5.8; inline links, disabled and visually hidden
     controls exempt; axe's spacing exception applied: a 24 px circle on the centre that touches no
     other target). On the touch tier (<= 1024 px) a control whose OWN computed min-width /
     min-height declares a floor >= 44 px but renders under it (a floor that is inert) is a
     finding; every other under-44 target is counted and listed as information, because the
     repo's floor rails (styles/tapFloor.test.js, a11y/targetFloors.test.js) are the authority on
     where 44 is required, and they are declarations.

Everything a member does not do is kept out: the "Meet Compass" first-run card is marked seen (F5
measured it), the Welcome intro is dismissed, `<main>` is at scrollTop 0 at every "at rest"
reading, and the whole occlusion pass is ONE synchronous in-page call so the orb and the FABs keep
their at-rest state (their auto-hide reacts to scroll EVENTS, which fire only after the call).

CONTROLS (the run is INVALID and no verdict is read unless every one comes out as it must):
  SYNTH-CLEAN   a synthetic page (a fixed `_topBar_` header, a fixed `_logFab_` button, 30 rows,
                bottom padding that clears the FAB) at every width: 0 findings of every kind, and
                at least one lead cleared under each of top-bar and log-fab (non-vacuity: the leads
                exist on the page and the instrument clears them).
  SYNTH-DEFECT  the same page with no bottom padding, a 1400 px row, an absolutely positioned
                cover over one button, two 20 px buttons 2 px apart, and an inline link that
                declares min-height 44 px: the last row CONFIRMED under log-fab, the covered button
                CONFIRMED under plant, main PANS, both small buttons under 24, the inert floor found
                at <= 1024 and NOT judged at 1200.
  PLANTS        the same defects planted into the real Notebook list at every width of every pass,
                plus a clean 48 px button (must read clear) and a button scrolled under a planted
                fixed strip (must read REACHABLE, not confirmed).

    python l3_layout_measure.py --data-dir C:/data-w10l3 --port 8230 --tip <sha> --out-dir <dir>
    python l3_layout_measure.py --self-check      (the pure judge against hand-made readings)
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))

TOUCH_MAX = 1024          # breakpoints.css TOUCH
TAP_MIN = 44.0            # tokens.css --tap-min
TARGET_MIN = 24.0         # WCAG 2.5.8
TOL = 0.5
NAMED = ("top-bar", "journal-header", "log-fab", "voice-orb", "hub")
VIEWPORTS = {390: (390, 844, True, True), 820: (820, 1180, True, False), 1200: (1200, 800, False, False)}
PASSES = {"orb": (390, 820, 1200), "hub": (390, 820)}   # the hub draws only at <1024 on coarse
MEMBERS = {"orb": ("l3orb@local.dev", "LocalTest2026!", "l3 orb"),
           "hub": ("l3hub@local.dev", "LocalTest2026!", "l3 hub")}
SEED_N = 16

# ── the in-page instrument ───────────────────────────────────────────────────────────────

LIB_JS = r"""
window.__l3 = (() => {
  const SEL = 'button,a[href],[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],' +
              '[role=menuitemradio],[role=option],[role=switch],[role=checkbox],[role=radio],[role=treeitem],' +
              'summary,input:not([type=hidden]),select,textarea,[contenteditable="true"]';
  const de = document.documentElement;
  const vis = (el) => { const cs = getComputedStyle(el); return el.getClientRects().length > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const desc = (el) => { if (!el || !el.tagName) return String(el);
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
      (el.getAttribute('aria-label') ? '[' + el.getAttribute('aria-label').slice(0, 40) + ']' : '') +
      (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.').slice(0, 60) : '') +
      ((el.innerText || '').trim() ? ' "' + (el.innerText || '').trim().split('\n')[0].slice(0, 40) + '"' : ''); };
  const nameOf = (el) => {
    let n = el.getAttribute('aria-label');
    if (!n && el.getAttribute('aria-labelledby')) n = el.getAttribute('aria-labelledby').split(/\s+/).map(i => (document.getElementById(i) || {}).innerText || '').join(' ');
    if (!n) n = (el.innerText || '').split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
    if (!n) n = el.getAttribute('title') || el.getAttribute('placeholder') || el.value || '';
    return String(n).replace(/\s+/g, ' ').trim().slice(0, 70);
  };
  const journalHeader = () => { const h1 = Array.from(document.querySelectorAll('h1')).find(h => /Trade Journal/.test(h.textContent || ''));
    return h1 ? h1.parentElement : null; };
  // ONE authority for "which chrome is this": order matters (a plant cover is checked first).
  const classify = (hit, jh) => {
    if (!hit || !hit.closest) return 'nothing';
    if (hit.closest('[data-l3-plant-cover]')) return 'plant';
    if (hit.closest('header[class*="_topBar_"]')) return 'top-bar';
    if (jh && jh.contains(hit)) return 'journal-header';
    if (hit.closest('[class*="_logFab_"]')) return 'log-fab';
    if (hit.closest('[class*="_orbCluster_"]')) return 'voice-orb';
    if (hit.closest('[data-testid="hub-root"]')) return 'hub';
    if (hit.closest('[class*="_fab_"]')) return 'feedback';   // FeedbackWidget's "?" (fb.fab)
    return 'other';
  };
  const hiddenLook = (el, b) => { const cs = getComputedStyle(el);
    if ((b.width <= 2 && b.height <= 2) || cs.clip === 'rect(0px, 0px, 0px, 0px)' || /inset\(50%/.test(cs.clipPath || '')) return 'visually hidden';
    if (parseFloat(cs.opacity) === 0) return 'transparent';
    if (el.tagName === 'A' && /^#/.test(el.getAttribute('href') || '') && /^skip\b/i.test((el.innerText || '').trim()) && document.activeElement !== el) return 'skip link (shown on focus)';
    return ''; };
  // The part of the viewport this element can be SEEN in: the viewport cut by every ancestor that
  // clips it (overflow != visible), following containing blocks (an absolute box escapes the
  // static ancestors between it and its positioned one; a fixed box escapes all of them).
  const visibleRect = (el) => {
    const r = {l: 0, t: 0, r: innerWidth, b: innerHeight};
    let mode = getComputedStyle(el).position;
    if (mode === 'fixed') return r;
    for (let a = el.parentElement; a && a !== document.body && a !== de; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const positioned = cs.position !== 'static' || cs.transform !== 'none';
      if (mode === 'absolute' && !positioned) continue;
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const b = a.getBoundingClientRect();
        if (cs.overflowX !== 'visible') { r.l = Math.max(r.l, b.left); r.r = Math.min(r.r, b.right); }
        if (cs.overflowY !== 'visible') { r.t = Math.max(r.t, b.top); r.b = Math.min(r.b, b.bottom); }
      }
      if (cs.position === 'fixed') break;
      mode = cs.position;
    }
    return r;
  };
  const controls = (scope) => {
    const R = (scope && document.querySelector(scope)) || document.body;
    const seen = {}; const out = [];
    for (const el of R.querySelectorAll(SEL)) {
      if (el.closest('[data-l3-ignore]')) continue;
      if (el.matches('[contenteditable="true"]') && el.parentElement && el.parentElement.closest('[contenteditable="true"]')) continue;
      if (!vis(el)) continue;
      const b = el.getBoundingClientRect();
      if (b.width <= 0 || b.height <= 0) continue;
      const name = nameOf(el);
      const key = el.tagName + '|' + (el.getAttribute('role') || '') + '|' + name.replace(/\d+/g, '#');
      seen[key] = (seen[key] || 0) + 1;
      out.push({el, key, nth: seen[key], name, hidden: hiddenLook(el, b)});
    }
    return out;
  };
  // One reading of one control where it sits NOW.
  const probe = (el, jh, popup) => {
    const b = el.getBoundingClientRect();
    const vr = visibleRect(el);
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const inside = (x, y) => x >= vr.l - 0.5 && x <= vr.r + 0.5 && y >= vr.t - 0.5 && y <= vr.b + 0.5 && x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight;
    const out = {box: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], centreVisible: inside(cx, cy)};
    if (!out.centreVisible) return out;
    const pts = [[cx, cy], [b.x + b.width * 0.2, b.y + b.height * 0.25], [b.x + b.width * 0.8, b.y + b.height * 0.25],
                 [b.x + b.width * 0.2, b.y + b.height * 0.75], [b.x + b.width * 0.8, b.y + b.height * 0.75]];
    let covered = 0, tested = 0, centreCovered = false, occ = null;
    pts.forEach(([x, y], i) => {
      if (!inside(x, y)) return;
      tested++;
      const hit = document.elementFromPoint(x, y);
      if (!hit || hit === el || el.contains(hit) || hit.contains(el)) return;
      if (hit.closest('[data-l3-ignore]')) return;
      covered++; if (i === 0) centreCovered = true;
      if (!occ) occ = {cls: classify(hit, jh), hit: desc(hit),
                       layer: desc(hit.closest('[role=dialog],[role=tooltip],[role=status],[role=group],header,section,aside,nav,div') || hit),
                       popup: !!(popup && popup.contains(hit) && !popup.contains(el)),
                       modal: !!(hit.closest('[aria-modal="true"]') || (hit.querySelector && hit.querySelector('[aria-modal="true"]')))};
    });
    out.tested = tested; out.covered = covered; out.centreCovered = centreCovered;
    out.occluded = !!occ && (centreCovered || covered >= 3);
    if (out.occluded) out.occ = occ;
    return out;
  };
  const vScrollers = () => {
    const out = [];
    const main = document.querySelector('main');
    if (main && main.scrollHeight > main.clientHeight + 1) out.push(main);
    const R = main || document.body;
    const inner = [];
    for (const el of R.querySelectorAll('*')) {
      if (el.closest('[data-l3-ignore]')) continue;
      const cs = getComputedStyle(el);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1 && el.clientHeight >= 160 && vis(el)) inner.push(el);
    }
    inner.sort((a, b) => b.clientHeight - a.clientHeight);
    return out.concat(inner.slice(0, 3));
  };
  // EVERY element that can scroll, with where it is now: a scrollIntoView moves every scroll
  // ancestor at once, so restoring only the ones that were off zero would leave the rest moved.
  const allScrollers = () => { const s = [[de, de.scrollTop, de.scrollLeft]];
    for (const el of document.querySelectorAll('body, body *')) {
      if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) s.push([el, el.scrollTop, el.scrollLeft]); }
    return s; };
  const restore = (snap) => { for (const [s, t, l] of snap) { if (s.scrollTop !== t) s.scrollTop = t; if (s.scrollLeft !== l) s.scrollLeft = l; } };

  // THE READING. `opts`: {popup: selector|null, modalOnly: bool, extraMainTops: [px], plantKeys: bool}
  const measure = (opts) => {
    opts = opts || {};
    const t0 = performance.now();
    const vw = innerWidth, vh = innerHeight, main = document.querySelector('main');
    const jh = journalHeader();
    const popup = opts.popup ? document.querySelector(opts.popup) : null;
    const res = {vw, vh, touchTier: vw <= 1024, path: location.pathname + location.search,
                 chrome: {}, overflow: {}, controls: [], sweep: [], scrollers: []};
    const box = (el) => { if (!el || !vis(el)) return null; const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
    res.chrome = {topBar: box(document.querySelector('header[class*="_topBar_"]')), journalHeader: box(jh),
                  logFab: box(document.querySelector('[class*="_logFab_"]')), orb: box(document.querySelector('[class*="_orbCluster_"]')),
                  hub: !!document.querySelector('[data-testid="hub-root"]'), hubBox: box(document.querySelector('[data-testid="hub-root"] button, [data-testid="hub-root"] [role=button]')),
                  popup: box(popup)};
    // b. overflow, with the pan test
    const saved = allScrollers(); const sx = scrollX, sy = scrollY;
    res.overflow.docScrollW = de.scrollWidth; res.overflow.docClientW = de.clientWidth;
    scrollTo(99999, sy); res.overflow.docPan = scrollX; scrollTo(sx, sy);
    if (main) {
      res.overflow.mainScrollW = main.scrollWidth; res.overflow.mainClientW = main.clientWidth;
      const l = main.scrollLeft; main.scrollLeft = 99999; res.overflow.mainPan = main.scrollLeft; main.scrollLeft = l;
      res.overflow.widenedBy = [];
      if (main.scrollWidth > main.clientWidth + 1) {
        const mr = main.getBoundingClientRect(); const found = [];
        const clipsX = (cs) => ['hidden', 'auto', 'scroll', 'clip'].includes(cs.overflowX);
        for (const el of main.querySelectorAll('*')) {
          if (!vis(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.right <= mr.right + 1) continue;
          let held = false;
          for (let a = el.parentElement; a && a !== main; a = a.parentElement) { if (clipsX(getComputedStyle(a))) { held = true; break; } }
          if (held || found.some(f => f.contains(el))) continue;
          found.push(el);
          if (res.overflow.widenedBy.length < 8) res.overflow.widenedBy.push({desc: desc(el), right: Math.round(r.right), width: Math.round(r.width)});
        }
      }
    }
    // the controls, with sizes, declared floors and their at-rest reading
    let list = controls(opts.modalOnly && opts.popup ? opts.popup : null);
    const recs = list.map(({el, key, nth, name, hidden}) => {
      const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      const rec = {key, nth, name, tag: el.tagName, role: el.getAttribute('role') || '', w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10,
                   hidden, disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true'),
                   minW: parseFloat(cs.minWidth) || 0, minH: parseFloat(cs.minHeight) || 0,
                   inPopup: !!(popup && popup.contains(el)), plant: el.getAttribute('data-l3-plant') || ''};
      if (el.tagName === 'A') { const p = el.parentElement; const own = (el.innerText || '').trim().length;
        const around = p ? (p.innerText || '').trim().length : 0; rec.inlineLink = !!p && around > own + 20 && cs.display === 'inline'; }
      return rec;
    });
    // spacing exception (axe target-size): an undersized target passes if a 24 px circle on its
    // centre touches no other target's box and no other undersized target's circle
    const rects = list.map(({el}) => el.getBoundingClientRect());
    const small = recs.map(r => !r.hidden && (r.w < 24 - 0.5 || r.h < 24 - 0.5));
    recs.forEach((r, i) => {
      if (!small[i] || r.hidden) return;
      const a = rects[i]; const cx = a.x + a.width / 2, cy = a.y + a.height / 2;
      let crowded = null;
      for (let j = 0; j < rects.length && !crowded; j++) {
        if (j === i || recs[j].hidden) continue;
        const o = rects[j];
        if (o.width <= 0 || o.height <= 0) continue;
        if (list[j].el.contains(list[i].el) || list[i].el.contains(list[j].el)) continue;
        const dx = Math.max(o.left - cx, 0, cx - o.right), dy = Math.max(o.top - cy, 0, cy - o.bottom);
        if (Math.hypot(dx, dy) < 12) crowded = recs[j].name || recs[j].key;
        else if (small[j]) { const ox = o.x + o.width / 2, oy = o.y + o.height / 2; if (Math.hypot(ox - cx, oy - cy) < 24) crowded = recs[j].name || recs[j].key; }
      }
      r.spacingOk = !crowded; if (crowded) r.crowdedBy = String(crowded).slice(0, 60);
    });
    // a. occlusion: at rest
    list.forEach(({el}, i) => { if (!recs[i].hidden) recs[i].rest = probe(el, jh, popup); });
    // the sweep: main (plus extra positions the controls ask for) and up to 3 inner scrollers
    const scs = vScrollers();
    res.scrollers = scs.map(s => ({desc: desc(s), clientH: s.clientHeight, scrollH: s.scrollHeight}));
    scs.forEach((s, si) => {
      const start = s.scrollTop; const max = s.scrollHeight - s.clientHeight;
      const tops = []; for (let t = 0; t < max; t += Math.max(120, Math.floor(s.clientHeight * 0.5))) tops.push(t);
      tops.push(max);
      if (si === 0 && s === main && opts.extraMainTops) for (const t of opts.extraMainTops) tops.push(t);
      for (const t of tops) {
        s.scrollTop = t;
        list.forEach(({el}, i) => {
          if (recs[i].hidden) return;
          const p = probe(el, jh, popup);
          if (p.occluded && !p.occ.popup) res.sweep.push({i, scroller: si, top: Math.round(s.scrollTop), cls: p.occ.cls, hit: p.occ.hit, box: p.box});
        });
      }
      s.scrollTop = start;
    });
    // the verdict: is each control that was not clear at rest clear SOMEWHERE?
    const swept = new Set(res.sweep.map(x => x.i));
    list.forEach(({el}, i) => {
      const r = recs[i];
      if (r.hidden) return;
      const clearAtRest = r.rest && r.rest.centreVisible && !r.rest.occluded;
      if (clearAtRest && !swept.has(i)) { r.verdict = 'clear'; return; }
      let best = null, how = null;
      for (const block of ['center', 'start', 'end', 'nearest']) {
        try { el.scrollIntoView({block, inline: 'nearest', behavior: 'instant'}); } catch (e) { el.scrollIntoView(); }
        const p = probe(el, jh, popup);
        if (p.centreVisible && !p.occluded) { how = block; best = p; break; }
        if (!best || (p.centreVisible && !best.centreVisible)) best = p;
      }
      restore(saved);
      if (how) { r.verdict = clearAtRest ? 'clear' : 'reachable'; r.reachedBy = how; if (!clearAtRest) r.clearAt = best.box; return; }
      if (!best.centreVisible) { r.verdict = 'CONFIRMED-CLIPPED'; r.best = best; return; }
      if (best.occ && (best.occ.popup || (best.occ.modal && !r.inPopup))) { r.verdict = 'under-open-popup'; r.best = best; return; }
      r.verdict = 'CONFIRMED-OCCLUDED'; r.best = best;
    });
    restore(saved);
    res.controls = recs;
    res.ms = Math.round(performance.now() - t0);
    return res;
  };

  // The planted defects (in-product control). Each is tagged and removed by unplant().
  const plant = (touch) => {
    const main = document.querySelector('main');
    const host = main || document.body;
    const box = document.createElement('div'); box.setAttribute('data-l3-plantbox', '1');
    box.style.cssText = 'position:relative;padding:8px;display:block;';
    const mk = (tag, id, label, css) => { const b = document.createElement(tag); if (tag === 'button') b.type = 'button';
      b.setAttribute('data-l3-plant', id); b.setAttribute('aria-label', label); b.textContent = label; b.style.cssText = css; return b; };
    box.appendChild(mk('button', 'clean', 'L3 planted clean control', 'display:block;width:48px;height:48px;margin:8px 0;padding:0;overflow:hidden;font-size:8px;'));
    const cw = document.createElement('div'); cw.style.cssText = 'position:relative;width:140px;height:44px;margin:8px 0;';
    cw.appendChild(mk('button', 'covered', 'L3 planted covered control', 'width:140px;height:44px;font-size:8px;'));
    const cover = document.createElement('div'); cover.setAttribute('data-l3-plant-cover', 'abs');
    cover.style.cssText = 'position:absolute;inset:0;background:rgba(200,0,0,.45);'; cw.appendChild(cover); box.appendChild(cw);
    const sr = document.createElement('div'); sr.style.cssText = 'display:flex;gap:2px;margin:8px 0;';
    sr.appendChild(mk('button', 'small-a', 'L3 planted small control A', 'width:20px;height:20px;padding:0;overflow:hidden;font-size:1px;'));
    sr.appendChild(mk('button', 'small-b', 'L3 planted small control B', 'width:20px;height:20px;padding:0;overflow:hidden;font-size:1px;'));
    box.appendChild(sr);
    const p = document.createElement('p'); p.style.cssText = 'margin:8px 0;font-size:14px;line-height:18px;';
    p.appendChild(document.createTextNode('L3 planted paragraph around an inline link whose floor is declared and inert: '));
    const a = mk('a', 'floor-inert', 'L3 planted inert floor', 'display:inline;min-height:44px;'); a.href = '#l3-plant'; a.textContent = 'inert';
    p.appendChild(a); box.appendChild(p);
    box.appendChild(Object.assign(document.createElement('div'), {style: 'width:1400px;height:6px;background:#c00;'}));
    const spacer1 = document.createElement('div'); spacer1.style.height = Math.round(innerHeight * 1.5) + 'px'; box.appendChild(spacer1);
    box.appendChild(mk('button', 'scrolled-under', 'L3 planted scrolled-under control', 'display:block;width:140px;height:44px;font-size:8px;'));
    const spacer2 = document.createElement('div'); spacer2.style.height = Math.round(innerHeight * 1.5) + 'px'; box.appendChild(spacer2);
    host.insertBefore(box, host.firstChild);
    const strip = document.createElement('div'); strip.setAttribute('data-l3-plant-cover', 'fixed-strip');
    strip.style.cssText = 'position:fixed;left:0;right:0;top:' + Math.round(innerHeight * 0.4) + 'px;height:60px;background:rgba(0,0,200,.35);z-index:2147483000;';
    document.body.appendChild(strip);
    // the main scrollTop at which the scrolled-under control sits inside the strip
    const su = box.querySelector('[data-l3-plant="scrolled-under"]');
    const mt = main ? main.scrollTop : 0;
    const want = su.getBoundingClientRect().top + mt - (Math.round(innerHeight * 0.4) + 8);
    return {underTop: Math.max(0, Math.round(want))};
  };
  const unplant = () => { for (const e of document.querySelectorAll('[data-l3-plantbox],[data-l3-plant-cover="fixed-strip"]')) e.remove(); };

  // Outline one control for a screenshot (pointer-events none, ignored by every probe).
  const mark = (key, nth, block) => {
    for (const e of document.querySelectorAll('[data-l3-mark]')) e.remove();
    const c = controls(null).find(c => c.key === key && c.nth === nth);
    if (!c) return false;
    try { c.el.scrollIntoView({block: block || 'center', inline: 'nearest', behavior: 'instant'}); } catch (e) {}
    const b = c.el.getBoundingClientRect();
    const m = document.createElement('div'); m.setAttribute('data-l3-mark', '1'); m.setAttribute('data-l3-ignore', '1');
    m.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:3px solid #ff00ff;left:' + (b.x - 3) + 'px;top:' + (b.y - 3) + 'px;width:' + b.width + 'px;height:' + b.height + 'px;';
    document.body.appendChild(m); return true;
  };
  const unmark = () => { for (const e of document.querySelectorAll('[data-l3-mark]')) e.remove(); };
  return {measure, plant, unplant, mark, unmark};
})();
"""

def ensure_lib(pg) -> None:
    pg.evaluate("() => { if (window.__l3) return true; " + LIB_JS + " return true; }")


def synthetic_html(vw: int, defect: bool) -> str:
    rows = "".join(
        f'<div style="height:56px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #333">'
        f'<button style="width:44px;height:44px;margin-left:16px" aria-label="Select row {i}">.</button>'
        f'<span style="color:#ccc">Row {i}</span></div>' for i in range(30))
    extra = ""
    if defect:
        extra = ('<div style="width:1400px;height:6px;background:#c00"></div>'
                 '<div style="position:relative;width:140px;height:44px;margin:8px 16px">'
                 '<button style="width:140px;height:44px" aria-label="Synthetic covered">covered</button>'
                 '<div data-l3-plant-cover="abs" style="position:absolute;inset:0;background:rgba(200,0,0,.4)"></div></div>'
                 '<div style="display:flex;gap:2px;margin:8px 16px"><button style="width:20px;height:20px;padding:0" aria-label="Synthetic small A"></button>'
                 '<button style="width:20px;height:20px;padding:0" aria-label="Synthetic small B"></button></div>'
                 '<p style="margin:8px 16px;color:#ccc">A paragraph long enough to hold an inline link whose floor is '
                 '<a href="#x" style="display:inline;min-height:44px" aria-label="Synthetic inert floor">inert</a> by construction.</p>')
    pb = 0 if defect else 104
    return f"""<!doctype html><html><head><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#111;font:14px sans-serif">
<div style="display:flex;flex-direction:column;height:100vh;overflow:hidden">
<header class="_topBar_syn_1" style="position:fixed;top:0;left:0;right:0;height:48px;background:#222;z-index:10;display:flex;align-items:center">
<button style="width:44px;height:44px;margin-left:4px" aria-label="Synthetic menu">=</button></header>
<main style="flex:1;overflow-y:auto;padding-top:48px;padding-bottom:{pb}px">{extra}{rows}</main>
<div class="_logFab_syn_1" style="position:fixed;left:16px;bottom:16px;z-index:20">
<button style="width:64px;height:48px" aria-label="Synthetic log">Log</button></div>
</div></body></html>"""


# ── the pure judge ───────────────────────────────────────────────────────────────────────

def judge(reading: dict) -> dict:
    """One reading -> findings, leads and information. Pure (railed by --self-check)."""
    vw = reading.get("vw", 0)
    touch = vw <= TOUCH_MAX
    ov = reading.get("overflow", {})
    findings, leads, info = [], [], {"under44_nofloor": [], "hidden_targets": 0}
    if ov.get("docPan", 0) > 0 or ov.get("docScrollW", 0) > ov.get("docClientW", vw) + 1:
        findings.append({"kind": "overflow", "what": "document", "pan": ov.get("docPan"),
                         "scrollW": ov.get("docScrollW"), "clientW": ov.get("docClientW")})
    if ov.get("mainPan", 0) > 0:
        findings.append({"kind": "overflow", "what": "main", "pan": ov.get("mainPan"),
                         "scrollW": ov.get("mainScrollW"), "clientW": ov.get("mainClientW"),
                         "widenedBy": ov.get("widenedBy", [])})
    ctrls = reading.get("controls", [])
    for c in ctrls:
        ident = {"control": c.get("name"), "key": c.get("key"), "nth": c.get("nth"), "tag": c.get("tag"),
                 "plant": c.get("plant") or None}
        if c.get("hidden"):
            info["hidden_targets"] += 1
            continue
        v = c.get("verdict")
        if v == "CONFIRMED-OCCLUDED":
            occ = (c.get("best") or {}).get("occ") or {}
            findings.append({**ident, "kind": "occluded", "by": occ.get("cls"), "hit": occ.get("hit"),
                             "layer": occ.get("layer"), "box": (c.get("best") or {}).get("box")})
        elif v == "CONFIRMED-CLIPPED":
            findings.append({**ident, "kind": "clipped", "box": (c.get("best") or {}).get("box")})
        if c.get("disabled"):
            continue
        w, h = c.get("w", 0), c.get("h", 0)
        if not c.get("inlineLink") and (w < TARGET_MIN - TOL or h < TARGET_MIN - TOL) and not c.get("spacingOk"):
            findings.append({**ident, "kind": "target<24", "w": w, "h": h, "crowdedBy": c.get("crowdedBy")})
        if touch:
            inert = [ax for ax, dim, floor in (("w", w, c.get("minW", 0)), ("h", h, c.get("minH", 0)))
                     if floor >= TAP_MIN - TOL and dim < TAP_MIN - TOL]
            if inert:
                findings.append({**ident, "kind": "floor-inert", "axes": inert, "w": w, "h": h,
                                 "minW": c.get("minW"), "minH": c.get("minH")})
            elif not c.get("inlineLink") and (w < TAP_MIN - TOL or h < TAP_MIN - TOL):
                info["under44_nofloor"].append({"control": c.get("name"), "w": w, "h": h})
    # leads: every (control, named chrome) the sweep or the rest reading saw it under
    seen = {}
    for s in reading.get("sweep", []):
        c = ctrls[s["i"]] if 0 <= s["i"] < len(ctrls) else {}
        k = (c.get("key"), c.get("nth"), s.get("cls"))
        seen.setdefault(k, {"control": c.get("name"), "key": c.get("key"), "nth": c.get("nth"),
                            "by": s.get("cls"), "at": [], "verdict": c.get("verdict"),
                            "reachedBy": c.get("reachedBy"), "clearAt": c.get("clearAt"),
                            "plant": c.get("plant") or None})["at"].append(
            {"scroller": s.get("scroller"), "top": s.get("top"), "box": s.get("box")})
    for c in ctrls:
        r = c.get("rest") or {}
        if r.get("occluded") and not (r.get("occ") or {}).get("popup"):
            k = (c.get("key"), c.get("nth"), r["occ"].get("cls"))
            seen.setdefault(k, {"control": c.get("name"), "key": c.get("key"), "nth": c.get("nth"),
                                "by": r["occ"].get("cls"), "at": [], "verdict": c.get("verdict"),
                                "reachedBy": c.get("reachedBy"), "clearAt": c.get("clearAt"),
                                "plant": c.get("plant") or None})["at"].insert(0, {"rest": True, "box": r.get("box")})
    for v in seen.values():
        v["status"] = ("CLEARED" if v["verdict"] in ("reachable", "clear") else
                       "CONFIRMED" if (v["verdict"] or "").startswith("CONFIRMED") else v["verdict"])
        v["at"] = v["at"][:4]
        leads.append(v)
    return {"findings": findings, "leads": leads, "info": {**info, "under44_nofloor_n": len(info["under44_nofloor"]),
                                                            "under44_nofloor": info["under44_nofloor"][:40]}}


def control_verdict_synth(clean: dict, defect: dict, vw: int) -> tuple[bool, list[str]]:
    why = []
    jc, jd = judge(clean), judge(defect)
    if jc["findings"]:
        why.append(f"SYNTH-CLEAN @{vw}: {len(jc['findings'])} findings, must be 0: "
                   + "; ".join(f"{f['kind']} {f.get('control') or f.get('what')}" for f in jc["findings"][:4]))
    for cls in ("top-bar", "log-fab"):
        if not any(l["by"] == cls and l["status"] == "CLEARED" for l in jc["leads"]):
            why.append(f"SYNTH-CLEAN @{vw}: no {cls} lead cleared (non-vacuity)")
    kinds = lambda k, pred=lambda f: True: [f for f in jd["findings"] if f["kind"] == k and pred(f)]  # noqa: E731
    if not kinds("occluded", lambda f: f["by"] == "log-fab"):
        why.append(f"SYNTH-DEFECT @{vw}: the last row under the FAB was not CONFIRMED")
    if not kinds("occluded", lambda f: f["by"] == "plant"):
        why.append(f"SYNTH-DEFECT @{vw}: the covered button was not CONFIRMED")
    if not kinds("overflow", lambda f: f["what"] == "main"):
        why.append(f"SYNTH-DEFECT @{vw}: main did not pan")
    if len(kinds("target<24", lambda f: "Synthetic small" in (f.get("control") or ""))) != 2:
        why.append(f"SYNTH-DEFECT @{vw}: the two small buttons were not both under 24")
    inert = kinds("floor-inert", lambda f: "inert floor" in (f.get("control") or ""))
    if vw <= TOUCH_MAX and not inert:
        why.append(f"SYNTH-DEFECT @{vw}: the inert floor was not found on the touch tier")
    if vw > TOUCH_MAX and inert:
        why.append(f"SYNTH-DEFECT @{vw}: the inert floor was judged on the desktop tier")
    return (not why), why


def control_verdict_plants(reading: dict, vw: int) -> tuple[bool, list[str], dict]:
    j = judge(reading)
    by_plant = {c.get("plant"): c for c in reading.get("controls", []) if c.get("plant")}
    got = {}
    why = []
    clean = by_plant.get("clean")
    got["clean"] = clean and clean.get("verdict")
    if not clean or clean.get("verdict") != "clear" or any(f.get("plant") == "clean" for f in j["findings"]):
        why.append(f"plant clean @{vw}: {got['clean']!r} (+findings), must read clear with no finding")
    cov = [f for f in j["findings"] if f.get("plant") == "covered" and f["kind"] == "occluded" and f["by"] == "plant"]
    got["covered"] = bool(cov)
    if not cov:
        why.append(f"plant covered @{vw}: not CONFIRMED under the plant")
    su = by_plant.get("scrolled-under")
    lead = [l for l in j["leads"] if l.get("plant") == "scrolled-under" and l["by"] == "plant"]
    got["scrolled-under"] = {"verdict": su and su.get("verdict"), "lead": [l["status"] for l in lead]}
    if not su or su.get("verdict") != "reachable" or not lead or lead[0]["status"] != "CLEARED":
        why.append(f"plant scrolled-under @{vw}: {got['scrolled-under']}, must be a CLEARED lead (reachable)")
    small = [f for f in j["findings"] if f["kind"] == "target<24" and (f.get("plant") or "").startswith("small")]
    got["small"] = len(small)
    if len(small) != 2:
        why.append(f"plants small @{vw}: {len(small)} under 24, must be 2")
    inert = [f for f in j["findings"] if f["kind"] == "floor-inert" and f.get("plant") == "floor-inert"]
    got["floor-inert"] = len(inert)
    if (vw <= TOUCH_MAX) != bool(inert):
        why.append(f"plant floor-inert @{vw}: {len(inert)} found, must be {'1' if vw <= TOUCH_MAX else '0'}")
    pan = [f for f in j["findings"] if f["kind"] == "overflow" and f["what"] == "main"]
    got["wide"] = bool(pan)
    if not pan:
        why.append(f"plant wide @{vw}: main did not pan")
    return (not why), why, got


def self_check() -> int:
    """The pure judge against hand-made readings: every kind must be able to fire AND to stay quiet."""
    base = {"vw": 390, "overflow": {"docScrollW": 390, "docClientW": 390, "docPan": 0, "mainPan": 0}, "sweep": []}
    ok_ctrl = {"name": "ok", "key": "BUTTON||ok", "nth": 1, "tag": "BUTTON", "w": 48, "h": 48, "minW": 0, "minH": 0,
               "rest": {"centreVisible": True, "occluded": False}, "verdict": "clear"}
    rows = []
    j = judge({**base, "controls": [ok_ctrl]})
    rows.append(("clean reading has no finding", not j["findings"]))
    occ = {**ok_ctrl, "verdict": "CONFIRMED-OCCLUDED", "best": {"occ": {"cls": "log-fab"}, "box": [0, 0, 1, 1]}}
    rows.append(("confirmed occlusion fires", any(f["kind"] == "occluded" and f["by"] == "log-fab" for f in judge({**base, "controls": [occ]})["findings"])))
    reach = {**ok_ctrl, "verdict": "reachable", "reachedBy": "center"}
    jr = judge({**base, "controls": [reach], "sweep": [{"i": 0, "cls": "top-bar", "top": 400}]})
    rows.append(("reachable under chrome is a CLEARED lead, not a finding", not jr["findings"] and jr["leads"][0]["status"] == "CLEARED"))
    rows.append(("pan fires", any(f["what"] == "main" for f in judge({**base, "overflow": {**base["overflow"], "mainPan": 55}, "controls": []})["findings"])))
    small = {**ok_ctrl, "w": 20, "h": 20, "spacingOk": False}
    rows.append(("20 px crowded fires", any(f["kind"] == "target<24" for f in judge({**base, "controls": [small]})["findings"])))
    rows.append(("20 px spaced is exempt", not judge({**base, "controls": [{**small, "spacingOk": True}]})["findings"]))
    rows.append(("inline link exempt from 24", not judge({**base, "controls": [{**small, "inlineLink": True}]})["findings"]))
    inert = {**ok_ctrl, "w": 30, "h": 18, "minH": 44, "inlineLink": True, "spacingOk": True}
    rows.append(("inert floor fires at 390", any(f["kind"] == "floor-inert" for f in judge({**base, "controls": [inert]})["findings"])))
    rows.append(("inert floor NOT judged at 1200", not judge({**base, "vw": 1200, "controls": [inert]})["findings"]))
    rows.append(("under 44 without a floor is info only", not judge({**base, "controls": [{**ok_ctrl, "w": 30, "h": 30}]})["findings"]))
    bad = [n for n, ok in rows if not ok]
    for n, ok in rows:
        print(("PASS " if ok else "FAIL ") + n)
    return 1 if bad else 0


# ── the browser half ────────────────────────────────────────────────────────────────────

def top0(pg) -> None:
    pg.evaluate("() => { const m = document.querySelector('main'); if (m) { m.scrollTop = 0; m.scrollLeft = 0; } window.scrollTo(0, 0); }")
    pg.wait_for_timeout(500)


def goto(H, pg, base: str, path: str, wait_sel: str) -> None:
    pg.goto(base + path, wait_until="domcontentloaded", timeout=45000)
    H._dismiss_intro(pg)
    pg.wait_for_selector(wait_sel, state="attached", timeout=30000)
    pg.wait_for_timeout(2500)


def press(pg, loc, touch: bool) -> None:
    loc.wait_for(state="visible", timeout=10000)
    if touch:
        loc.tap(timeout=8000)
    else:
        loc.click(timeout=8000)


def surfaces(notes: dict) -> list[tuple[str, callable]]:
    """(name, opener) -- each opener gets (H, pg, base, touch) and returns (popup selector|None, modalOnly)."""
    def list_(H, pg, base, touch):
        goto(H, pg, base, "/journal/notebook?view=all", "[data-note-card-id]")
        return None, False

    def view(label):
        def f(H, pg, base, touch):
            list_(H, pg, base, touch)
            b = pg.locator(f'button[aria-label="{label}"]').filter(visible=True).first
            b.scroll_into_view_if_needed(timeout=5000)
            press(pg, b, touch)
            pg.wait_for_timeout(2500)
            return None, False
        return f

    def editor(H, pg, base, touch):
        goto(H, pg, base, f"/journal/notebook?note={notes['rich']}", ".ProseMirror")
        return None, False

    def home(H, pg, base, touch):
        goto(H, pg, base, "/journal/notebook", "#notebook-pane")
        pg.wait_for_timeout(1500)
        return None, False

    def research(H, pg, base, touch):
        goto(H, pg, base, "/journal/notebook/research/NVDA", "main")
        pg.wait_for_timeout(3000)
        return None, False

    def gallery(H, pg, base, touch):
        list_(H, pg, base, touch)
        b = pg.get_by_role("button", name="Templates", exact=True).filter(visible=True).first
        b.scroll_into_view_if_needed(timeout=5000)
        press(pg, b, touch)
        d = pg.get_by_role("dialog", name="New note").first
        d.wait_for(state="visible", timeout=10000)
        pg.wait_for_timeout(1200)
        d.evaluate("e => e.setAttribute('data-l3-popup', '1')")
        return '[data-l3-popup]', True

    def more(H, pg, base, touch):
        editor(H, pg, base, touch)
        b = pg.locator('button[aria-label="More note actions"]').filter(visible=True).first
        press(pg, b, touch)
        panel = pg.locator('[role="group"][aria-label="More note actions"]').first
        panel.wait_for(state="visible", timeout=8000)
        pg.wait_for_timeout(800)
        panel.evaluate("e => e.setAttribute('data-l3-popup', '1')")
        return '[data-l3-popup]', False

    return [("list", list_), ("table", view("Table view")), ("board", view("Board view")),
            ("calendar", view("Calendar view")), ("timeline", view("Timeline view")), ("graph", view("Graph view")),
            ("tasks", view("Tasks view")), ("editor", editor), ("research-home", home), ("research-nvda", research),
            ("template-gallery", gallery), ("more-menu-open", more)]


def seed(H, req, base: str) -> dict:
    today = time.strftime("%Y-%m-%d")
    have = {}
    r = req.get(base + "/api/j2/notes?limit=200")
    for n in (r.json().get("notes") or []) if r.ok else []:
        have[n.get("title")] = n["id"]
    out = {}

    def P(t):
        return {"type": "paragraph", "content": [{"type": "text", "text": t}]}

    rich = {"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "L3 heading one"}]},
        P("Base forming under the prior high with volume drying up."),
        {"type": "bulletList", "content": [{"type": "listItem", "content": [P(f"Point {i}")]} for i in range(3)]},
        {"type": "taskList", "content": [{"type": "taskItem", "attrs": {"checked": False}, "content": [P(f"Task {i}")]} for i in range(3)]},
        {"type": "table", "content": [
            {"type": "tableRow", "content": [{"type": "tableHeader", "content": [P("Ticker")]}, {"type": "tableHeader", "content": [P("Entry")]}]},
            {"type": "tableRow", "content": [{"type": "tableCell", "content": [P("NVDA")]}, {"type": "tableCell", "content": [P("121")]}]}]},
        {"type": "codeBlock", "attrs": {"language": "python"}, "content": [{"type": "text", "text": "risk = entry - stop"}]},
    ] + [P(f"L3 paragraph {i}: price reclaimed the 20 EMA on rising volume, stop under the swing low.") for i in range(14)]}
    specs = [("L3 rich note", rich, {"tags": ["l3/review", "setup"]})]
    for i in range(SEED_N):
        body, _ = H.paragraphs_doc(3, f"l3-{i}")
        specs.append((f"L3 note {i:02d}", body, {"tags": ["l3/review"] if i % 2 else ["setup"]}))
    for title, body, extra in specs:
        if title in have:
            out[title] = have[title]
            continue
        c = req.post(base + "/api/j2/notes", data={"title": title, "bodyJson": body, **extra})
        if c.status not in (200, 201):
            c = req.post(base + "/api/j2/notes", data={"title": title, "bodyJson": body})
        if c.status not in (200, 201):
            raise H.SetupFailed(f"seeding {title!r}: HTTP {c.status} {c.text()[:200]}")
        out[title] = c.json()["note"]["id"]
    return {"rich": out["L3 rich note"], "ids": out, "today": today}


def take(pg, path: Path) -> str:
    pg.screenshot(path=str(path), type="jpeg", quality=55)
    return path.name


def run_config(br, H, base: str, notes: dict, pass_: str, width: int, storage, art: Path, only: set | None) -> list[dict]:
    w, h, touch, mobile = VIEWPORTS[width]
    ctx = br.new_context(viewport={"width": w, "height": h}, has_touch=touch, is_mobile=mobile,
                         reduced_motion="reduce", storage_state=storage)
    ctx.add_init_script("try { localStorage.setItem('voice.orb.coachmarkSeen', '1'); } catch (e) {}")
    rows = []
    pg = ctx.new_page()
    errors: list[str] = []
    pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    try:
        # the synthetic controls, once per viewport per pass
        synth = {}
        for kind in ("clean", "defect"):
            pg.set_content(synthetic_html(w, kind == "defect"))
            pg.wait_for_timeout(200)
            ensure_lib(pg)
            synth[kind] = pg.evaluate("() => window.__l3.measure({})")
        ok, why = control_verdict_synth(synth["clean"], synth["defect"], width)
        rows.append({"pass": pass_, "width": width, "surface": "SYNTH-CONTROL", "valid": ok, "why": why,
                     "judged": {k: judge(v) for k, v in synth.items()}})
        for name, opener in surfaces(notes):
            if only and name not in only:
                continue
            row = {"pass": pass_, "width": width, "surface": name}
            errors.clear()
            try:
                popup, modal_only = opener(H, pg, base, touch)
                if not popup:
                    top0(pg)
                ensure_lib(pg)
                reading = pg.evaluate("(o) => window.__l3.measure(o)", {"popup": popup, "modalOnly": modal_only})
                row["reading"] = reading
                row["judged"] = judge(reading)
                row["shot"] = take(pg, art / f"{pass_}-{width}-{name}.jpg")
                # a shot per CONFIRMED finding, at its best position, outlined
                shots = []
                for f in row["judged"]["findings"]:
                    if f["kind"] in ("occluded", "clipped") and len(shots) < 6:
                        if pg.evaluate("(a) => window.__l3.mark(a[0], a[1], 'center')", [f["key"], f["nth"]]):
                            pg.wait_for_timeout(150)
                            nm = f"{pass_}-{width}-{name}-finding{len(shots)}.jpg"
                            take(pg, art / nm)
                            shots.append({"control": f["control"], "shot": nm})
                        pg.evaluate("() => window.__l3.unmark()")
                row["finding_shots"] = shots
                if name == "list":
                    # the in-product plants: same code path, same surface
                    top0(pg)
                    pl = pg.evaluate(f"() => window.__l3.plant({str(touch).lower()})")
                    pr = pg.evaluate("(o) => window.__l3.measure(o)", {"popup": None, "extraMainTops": [pl["underTop"]]})
                    ok, why, got = control_verdict_plants(pr, width)
                    pg.evaluate("() => window.__l3.unplant()")
                    rows.append({"pass": pass_, "width": width, "surface": "PLANT-CONTROL", "valid": ok, "why": why, "got": got,
                                 "underTop": pl["underTop"]})
            except Exception as e:  # noqa: BLE001 -- the row says why; never a silent pass
                row["error"] = f"{type(e).__name__}: {str(e)[:300]}"
                row["trace"] = traceback.format_exc()[-900:]
                try:
                    row["shot"] = take(pg, art / f"{pass_}-{width}-{name}-ERROR.jpg")
                except Exception:  # noqa: BLE001
                    pass
            row["page_errors"] = list(errors[:5])
            rows.append(row)
            print(json.dumps({"pass": pass_, "width": width, "surface": name, "error": row.get("error"),
                              "findings": len((row.get("judged") or {}).get("findings", []))}), flush=True)
    finally:
        ctx.close()
    return rows


def summarize(rows: list[dict]) -> dict:
    ctl = [r for r in rows if r["surface"] in ("SYNTH-CONTROL", "PLANT-CONTROL")]
    valid = bool(ctl) and all(r.get("valid") for r in ctl)
    table = []
    for r in rows:
        if r["surface"] in ("SYNTH-CONTROL", "PLANT-CONTROL"):
            continue
        j = r.get("judged") or {}
        for f in j.get("findings", []):
            table.append({"pass": r["pass"], "width": r["width"], "surface": r["surface"], **{k: f.get(k) for k in
                          ("kind", "control", "what", "by", "hit", "w", "h", "pan", "crowdedBy", "axes", "box")}})
    leads = []
    for r in rows:
        for l in (r.get("judged") or {}).get("leads", []):
            if l["by"] in NAMED:
                leads.append({"pass": r["pass"], "width": r["width"], "surface": r["surface"], "control": l["control"],
                              "by": l["by"], "status": l["status"], "reachedBy": l.get("reachedBy")})
    return {"controls_valid": valid, "control_rows": [{k: r.get(k) for k in ("pass", "width", "surface", "valid", "why", "got")} for r in ctl],
            "errors": [{k: r.get(k) for k in ("pass", "width", "surface", "error")} for r in rows if r.get("error")],
            "findings": table, "named_leads": leads,
            "named_leads_by_status": {s: sum(1 for l in leads if l["status"] == s) for s in sorted({l["status"] for l in leads})}}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--data-dir")
    ap.add_argument("--port", type=int, default=8230)
    ap.add_argument("--tip")
    ap.add_argument("--out-dir")
    ap.add_argument("--passes", default="orb,hub")
    ap.add_argument("--widths", default="390,820,1200")
    ap.add_argument("--only", default="", help="comma list of surfaces (default all)")
    a = ap.parse_args()
    if a.self_check:
        return self_check()
    from tools import notebook_perf_harness as H
    if not (a.data_dir and a.tip and a.out_dir):
        ap.error("--data-dir, --tip and --out-dir are required")
    if H.refuse_shared_root(a.data_dir):
        print(H.refuse_shared_root(a.data_dir))
        return 3
    out = Path(a.out_dir)
    art = out / "shots"
    art.mkdir(parents=True, exist_ok=True)
    only = {s for s in a.only.split(",") if s} or None
    widths = [int(x) for x in a.widths.split(",")]
    base = f"http://127.0.0.1:{a.port}"
    res: dict = {"tip": a.tip, "instrument": "docs/notebook/proof/l3-instrument/l3_layout_measure.py",
                 "data_dir": a.data_dir, "port": a.port, "started": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "rows": []}
    sb = H.Sandbox(a.data_dir, a.port, out / "sandbox-boot.log")
    sb.start()
    rc = 0
    try:
        if not sb.wait_healthy(base, 240):
            res["error"] = "sandbox never became healthy"
            return 3
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            br = p.chromium.launch(ignore_default_args=["--hide-scrollbars"])
            admin_ctx = br.new_context()
            for pass_ in a.passes.split(","):
                member = MEMBERS[pass_]
                mctx = br.new_context()
                H._provision(admin_ctx.request, mctx.request, base, member=member)
                notes = seed(H, mctx.request, base)
                hub_pref = {"enabled": pass_ == "hub", "coachMarkSeen": True}
                pr = mctx.request.post(base + "/api/auth/preferences", data={"key": "joystick_hub", "value": json.dumps(hub_pref)})
                if pr.status not in (200, 201):   # a validator that refuses the coach-mark field: the switch alone
                    hub_pref = {"enabled": pass_ == "hub"}
                    pr = mctx.request.post(base + "/api/auth/preferences", data={"key": "joystick_hub", "value": json.dumps(hub_pref)})
                res.setdefault("setup", {})[pass_] = {"member": member[0], "notes": len(notes["ids"]), "hub_pref": hub_pref,
                                                      "hub_pref_http": pr.status}
                storage = mctx.storage_state()
                mctx.close()
                for wdt in widths:
                    if wdt not in PASSES[pass_]:
                        continue
                    res["rows"].extend(run_config(br, H, base, notes, pass_, wdt, storage, art, only))
            br.close()
        sb.wait_checkpoint("post-prewarm (+120s)", 200)
    except Exception as e:  # noqa: BLE001
        res["error"] = f"{type(e).__name__}: {e}"
        res["trace"] = traceback.format_exc()[-1500:]
        rc = 3
    finally:
        res["stop"] = sb.stop()
        ipath = sb.integrity_path()
        res["integrity"] = H.read_integrity(ipath, []) if ipath else None
        res["integrity_line"] = H.integrity_line(res["integrity"]) if res["integrity"] else "SANDBOX INTEGRITY: MISSING"
        if ipath and Path(ipath).is_file():
            shutil.copyfile(ipath, out / "integrity.md")
        res["summary"] = summarize(res["rows"])
        (out / "run.json").write_text(json.dumps(res, indent=1, default=str), encoding="utf-8")
        print(res["integrity_line"], flush=True)
        print(json.dumps({"controls_valid": res["summary"]["controls_valid"], "findings": len(res["summary"]["findings"]),
                          "named_leads": res["summary"]["named_leads_by_status"], "errors": len(res["summary"]["errors"])}), flush=True)
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
