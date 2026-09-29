"""Keyboard-walk plumbing for the independent second accessibility review (lane 10E-2,
`docs/notebook/a11y-second-review-brief.md` section 3). Nothing here judges; `keyboard_walk.py`
owns every verdict.

The reviewer's hands are the keyboard only: every step presses keys through Playwright's
`page.keyboard` and reads what the DOM says happened (the focused element, its name, whether
it shows a focus indicator, what opened). No `click()` is used on the page under review; the
only pointer use in the whole walk is none. Seeding the account's notes goes through the API,
exactly as a member's earlier sessions would have left them, and is recorded as setup.
"""
from __future__ import annotations

import json
import time

# One JS probe for "what has focus, and can a sighted keyboard user see it?"
FOCUS_JS = r"""
() => { try {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) {
    return {tag: el ? el.tagName.toLowerCase() : null, body: true};
  }
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const name = (() => {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map(id => (document.getElementById(id) || {}).textContent || '').join(' ').trim();
      if (t) return t;
    }
    const al = el.getAttribute('aria-label');
    if (al) return al.trim();
    if (el.labels && el.labels.length) return Array.from(el.labels).map(l => l.textContent.trim()).join(' ');
    const t = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (t) return t.slice(0, 80);
    return (el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('alt') || '').trim();
  })();
  let fv = false;
  try { fv = el.matches(':focus-visible'); } catch (e) {}
  const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
  const shadow = cs.boxShadow && cs.boxShadow !== 'none';
  const dlg = el.closest('[role="dialog"],[role="alertdialog"],dialog');
  const vw = window.innerWidth, vh = window.innerHeight;
  return {
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role') || '',
    name: name,
    id: el.id || '',
    testid: el.getAttribute('data-testid') || '',
    type: el.getAttribute('type') || '',
    expanded: el.getAttribute('aria-expanded'),
    pressed: el.getAttribute('aria-pressed'),
    selected: el.getAttribute('aria-selected'),
    checked: el.getAttribute('aria-checked'),
    contenteditable: el.isContentEditable || false,
    rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    inViewport: r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw,
    focusVisible: fv,
    indicator: outline || shadow,
    outline: outline ? `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}` : '',
    shadow: shadow ? cs.boxShadow.slice(0, 80) : '',
    inDialog: dlg ? ((dlg.getAttribute('aria-label') || (dlg.querySelector('h1,h2,h3') || {}).textContent || dlg.getAttribute('role') || 'dialog').trim().slice(0, 60)) : null,
    path: location.pathname + location.search,
  };
} catch (e) {
  const el = document.activeElement;
  return {error: String(e && e.message || e), tag: el ? el.tagName.toLowerCase() : null,
          role: el && el.getAttribute ? (el.getAttribute('role') || '') : '',
          name: el && el.getAttribute ? (el.getAttribute('aria-label') || '') : ''};
} }
"""

DIALOGS_JS = r"""
() => Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"],dialog[open]'))
  .filter(d => { const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
  .map(d => ({role: d.getAttribute('role') || 'dialog', modal: d.getAttribute('aria-modal'),
              label: (d.getAttribute('aria-label') || (d.querySelector('h1,h2,h3') || {}).textContent || '').trim().slice(0, 80)}))
"""

OVERFLOW_JS = r"""
() => {
  const de = document.documentElement;
  const main = document.querySelector('main') || document.querySelector('[class*="main"]');
  return {docScrollW: de.scrollWidth, docClientW: de.clientWidth,
          bodyScrollW: document.body.scrollWidth,
          mainScrollW: main ? main.scrollWidth : null, mainClientW: main ? main.clientWidth : null};
}
"""

TARGETS_JS = r"""
(minPx) => {
  const sel = 'a[href],button,input,select,textarea,[role="button"],[role="tab"],[role="menuitem"],[role="option"],[role="checkbox"],[role="switch"],[tabindex]:not([tabindex="-1"])';
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    if (r.width < minPx || r.height < minPx) {
      const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '').replace(/\s+/g,' ').trim().slice(0, 50);
      out.push({tag: el.tagName.toLowerCase(), name, w: Math.round(r.width), h: Math.round(r.height)});
    }
  }
  return out;
}
"""


def short(f: dict | None) -> str:
    if not f:
        return "(none)"
    if f.get("body"):
        return "<body>"
    bits = [f.get("tag", "")]
    if f.get("role"):
        bits.append(f"[{f['role']}]")
    n = (f.get("name") or "").strip()
    if n:
        bits.append(repr(n[:48]))
    if f.get("contenteditable"):
        bits.append("(editable)")
    return " ".join(bits)


def focus(page) -> dict:
    try:
        return page.evaluate(FOCUS_JS)
    except Exception as e:  # noqa: BLE001 -- a navigation mid-read
        return {"error": f"{type(e).__name__}: {str(e)[:120]}"}


def press(page, key: str, settle_ms: int = 120) -> dict:
    page.keyboard.press(key)
    page.wait_for_timeout(settle_ms)
    return focus(page)


def tab_until(page, pred, max_presses: int = 120, reverse: bool = False, settle_ms: int = 60):
    """Press Tab (or Shift+Tab) until `pred(focus)` is true. Returns (found, presses, trail),
    where `trail` is the short name of every stop -- the keyboard route, recorded as walked."""
    key = "Shift+Tab" if reverse else "Tab"
    trail = []
    for i in range(1, max_presses + 1):
        f = press(page, key, settle_ms)
        trail.append(short(f))
        try:
            if pred(f):
                return True, i, trail, f
        except Exception:  # noqa: BLE001
            pass
    return False, max_presses, trail, focus(page)


def tab_census(page, max_presses: int = 150, settle_ms: int = 40):
    """Every Tab stop from the current focus until the sequence returns to its first stop
    (a full cycle) or `max_presses`. Returns the list of stops (dicts)."""
    stops = []
    first_key = None
    for _ in range(max_presses):
        f = press(page, "Tab", settle_ms)
        k = (f.get("tag"), f.get("name"), tuple(f.get("rect") or ()), f.get("id"))
        if first_key is None:
            first_key = k
        elif k == first_key:
            stops.append({"cycle": True})
            break
        stops.append(f)
    return stops


def name_has(*needles):
    low = [n.lower() for n in needles]
    return lambda f: any(n in (f.get("name") or "").lower() for n in low)


def dialogs(page) -> list:
    try:
        return page.evaluate(DIALOGS_JS)
    except Exception:  # noqa: BLE001
        return []


def small_targets(page, min_px: int) -> list:
    return page.evaluate(TARGETS_JS, min_px)


def overflow(page) -> dict:
    return page.evaluate(OVERFLOW_JS)


class Recorder:
    """The raw record: every step appended as it happens and flushed to disk each time,
    so a walk that dies leaves what it saw (R-RAW), never a stale pass."""

    def __init__(self, path, meta: dict):
        self.path = path
        self.rec = {"meta": meta, "steps": [], "census": {}, "shots": [], "errors": []}
        self.flush()

    def flush(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(self.rec, fh, indent=1, default=str)

    def step(self, sid, section, keys, expected, observed, verdict, **extra):
        row = {"id": sid, "section": section, "keys": keys, "expected": expected,
               "observed": observed, "verdict": verdict, "t": time.strftime("%H:%M:%S")}
        row.update(extra)
        self.rec["steps"].append(row)
        self.flush()
        print(f"[{verdict:>10}] {sid} {section}: {observed[:140]}", flush=True)
        return row
