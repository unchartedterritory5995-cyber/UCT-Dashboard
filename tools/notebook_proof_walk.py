"""Wave 10 lane 10E-1 -- the PROOF walk: five measuring instruments over the Notebook as it
stands, each carrying a planted-defect CONTROL that must FAIL. It adds no product feature.

Derived from `tools/notebook_wave8_walk.py` (the harness idioms: `record` / `guarded`, the
per-run synthetic accounts, the sandbox identity gate, the integrity verdict decided AFTER
the sandbox stops) and `tools/notebook_wave10b_walk.py` (it OWNS its sandbox through the perf
harness's `Sandbox`). Every change of shape is named here, never inherited silently.

    # the evidence run (PowerShell; the data dir single-quoted):
    python tools/notebook_proof_walk.py --boot --data-dir 'C:\\data-w10e1' --port 8215 `
        --out-dir docs/notebook/proof/<run-id> --artifacts <scratch>\\proof --tip <sha>
    # a shake-out against a sandbox somebody else holds (identity-verified first):
    python tools/notebook_proof_walk.py --base http://127.0.0.1:8215 --integrity-log <its log> ...
    python tools/notebook_proof_walk.py --self-check     # the judges' controls, no browser

THE INSTRUMENTS (`--sweeps`, default all):

  deadclick  every ENABLED control on a surface is clicked (tapped at a touch width) and must
             produce at least one of: a DOM change outside the page's measured idle noise, a
             product request (telemetry is NEVER evidence: `/api/j2/telemetry`,
             `/api/client-errors`), a navigation, a focus move to something other than the
             control, an aria-expanded change, a form-state change, or a browser door (file
             chooser, download, popup, print, clipboard, dialog). A field (input, select,
             textarea, the editor) is live when the click puts focus IN it.
             CONTROL: three planted buttons -- a dead one, a dead one that restyles itself on
             mousedown (the "looks pressed" trap), and a live one -- must read DEAD, DEAD, LIVE.
  silent     every endpoint a surface calls (and the write each named action sends) is forced
             to answer 500, then to fail as OFFLINE (the request aborted), and a visible
             sentence must render that the healthy load did not show.
             CONTROL: a planted consumer that swallows its failure must read SILENT, and one
             that says so must read SENTENCE, under both failure kinds.
  geometry   each surface at 390 (touch), 820 (touch) and 1200 px: no horizontal overflow of the
             document, no control another element covers (sampled with elementFromPoint), and at
             <= 1024 px every rendered target >= 44 px on both axes (an inline link in running
             text is recorded as exempt, never dropped).
             CONTROL: a planted 1400 px element, a planted 20 px button and a planted cover over
             a planted button must each be found at every width they apply to.
  axe        axe-core (the repo's exact pin, `app/node_modules/axe-core/axe.min.js`) in the real
             page, WCAG 2.0-2.2 A/AA tags INCLUDING colour-contrast, scoped to the Notebook
             surface's own root, over every surface of `a11y/notebookSurfaces.js` this walk can
             reach, in the three themes (dark, oled, light). A surface it cannot reach is
             UNREACHED with its reason, never dropped.
             CONTROL: planted low-contrast text and a nameless button must be reported in every
             theme.
  census     the path census: every shipped §B1 feature through each door -- desktop (mouse,
             1280), touch (tap, 390) and keyboard (1280, keys only). Per cell: WORKS (door found,
             its effect rendered), NO-DOOR, BROKEN (door found, no effect), N/A (by design, with
             the ruling), NOT-DRIVEN (the door exists, its effect needs a device or a key the
             sandbox has not got -- said which).
             CONTROL: a planted probe whose door does not exist must read NO-DOOR, and a planted
             door that does nothing must read BROKEN.

⛔ AN INSTRUMENT WHOSE CONTROL DID NOT FAIL IS NOT EVIDENCE. Its sweep reads INVALID and the
exit is 2, whatever its findings say. That is checked in-page, on the same surfaces, with the
same judge -- the controls are not a unit test standing in for the browser.

⛔ R-RAW: the JSON this writes is the RAW observation (what the DOM, the network and axe said).
Interpretation -- which finding is a defect, which is by design -- is written AFTER it is
committed, in `docs/notebook/proof/README.md`, never folded back into the raw files.

Preconditions (as wave 10B): app/dist rebuilt from the tip; the port free (refused, never
killed); the data dir outside the shared root (refused). The sandbox's gates are the ARMED
Notebook gates of `docs/feature_flags.json` plus email-in (live in production since 2026-09-27),
set by `--boot` in the sandbox's environment and listed in the run JSON; NO model key.

Exit: 0 = every requested instrument ran, every control failed as it must, integrity CLEAN and
no finding; 1 = findings (valid instruments); 2 = an instrument INVALID/INCONCLUSIVE or the
integrity not CLEAN/complete; 3 = refused / not run.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shutil
import sys
import time
import traceback
from pathlib import Path
from urllib.parse import urlsplit

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

# ─────────────────────────────────────────────────────────────────────────────
# THE IMPORTABLE PART. Nothing above `def main` sends a request or opens a browser;
# tests/test_notebook_proof_walk.py imports this module and rails the judges.
# ─────────────────────────────────────────────────────────────────────────────

SWEEPS = ("deadclick", "silent", "geometry", "axe", "census")
VIEWPORTS = {
    "phone": {"width": 390, "height": 844, "touch": True},
    "tablet": {"width": 820, "height": 1180, "touch": True},
    "desktop": {"width": 1200, "height": 800, "touch": False},
}
DESK = {"width": 1280, "height": 800}
THEMES = ("dark", "oled", "light")
TAP_MIN = 44.0            # `--tap-min` in tokens.css; read-checked by the rail
TAP_TOLERANCE = 0.5
TOUCH_MAX_WIDTH = 1024    # the touch tier (breakpoints.js); rail-checked
TELEMETRY_PATHS = ("/api/j2/telemetry", "/api/client-errors")
AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
GATES = {
    # production's ARMED Notebook gates (docs/feature_flags.json) + email-in (live 2026-09-27)
    "J2_SHARE_LINKS_ENABLED": "1", "NOTEBOOK_PUBLISH_ENABLED": "1", "NOTEBOOK_ONBOARDING_ENABLED": "1",
    "NOTEBOOK_ASK_INSERT_ON": "1", "NOTEBOOK_WRITING_HELP_ENABLED": "1", "COMPASS_NOTES_TOOL_ENABLED": "1",
    "NOTEBOOK_PERSONAL_API_ENABLED": "1", "NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED": "1",
    "NOTEBOOK_TASK_REMINDERS_ENABLED": "1", "NOTEBOOK_INBOUND_EMAIL_ENABLED": "1", "J2_OCR_ENABLED": "1",
    "ANTHROPIC_API_KEY": "", "OPENAI_API_KEY": "",
}
EFFECT_KINDS = ("dom", "request", "navigation", "focus", "expanded", "state",
                "download", "filechooser", "popup", "dialog", "print", "clipboard")
SESSION_ENDING = re.compile(r"\b(sign|log)\s*out\b|\blogout\b", re.I)

_ID_SEG = re.compile(r"^(?:[0-9a-f]{8,}|[0-9a-f-]{32,36}|\d+|[A-Za-z0-9_-]{20,})$")


def normalize_endpoint(url: str) -> str:
    """`/api/j2/notes/9f3c...?x=1` -> `/api/j2/notes/{id}`: the path, every id-shaped segment
    replaced, the query dropped. One endpoint TEMPLATE is what the silent sweep routes."""
    path = urlsplit(url).path
    segs = [("{id}" if _ID_SEG.match(s) else s) for s in path.split("/")]
    return "/".join(segs)


def is_telemetry(url: str) -> bool:
    p = urlsplit(url).path
    return any(p == t or p.startswith(t + "/") for t in TELEMETRY_PATHS)


def judge_click(obs: dict) -> tuple[str, list[str]]:
    """One click's observation -> ("LIVE", effects) | ("DEAD", []). `obs` holds the counts the
    browser half measured (see EFFECT_JS) plus the Python half's request / event lists.
    A telemetry POST alone is never evidence (the controller's rule for this lane)."""
    eff = []
    if obs.get("dom", 0) > 0:
        eff.append("dom")
    reqs = [r for r in obs.get("requests", []) if not is_telemetry(r.get("url", ""))
            and normalize_endpoint(r.get("url", "")) not in set(obs.get("noise_endpoints", []))]
    if reqs:
        eff.append("request")
    if obs.get("url_before") and obs.get("url_after") and obs["url_before"] != obs["url_after"]:
        eff.append("navigation")
    if obs.get("reloaded") and "navigation" not in eff:
        eff.append("navigation")
    if obs.get("focus_moved"):
        eff.append("focus")
    if obs.get("expanded", 0) > 0:
        eff.append("expanded")
    if obs.get("state_changed"):
        eff.append("state")
    for k in ("download", "filechooser", "popup", "dialog", "print", "clipboard"):
        if obs.get(k, 0) > 0:
            eff.append(k)
    return ("LIVE", eff) if eff else ("DEAD", [])


_WORD = re.compile(r"[A-Za-z][A-Za-z'’-]*")


def is_sentence(text: str) -> bool:
    """A member-readable sentence: at least three words and twelve characters of text."""
    t = " ".join((text or "").split())
    return len(t) >= 12 and len(_WORD.findall(t)) >= 3


def _norm_line(s: str) -> str:
    return re.sub(r"\d+", "#", " ".join((s or "").split())).strip()


EMPTY_STATE_HINT = re.compile(r"\b(no notes|nothing (here|yet)|is empty|get started|welcome to your|"
                              r"start a note|you have no|no results)\b", re.I)


def judge_failure(baselines: list[list[str]], failed: list[str], alerts: list[str]) -> dict:
    """A forced failure's page against the healthy loads of the same surface. New text = a
    line (digits folded) present in NO baseline. SENTENCE when an alert/status region or new
    text reads as a sentence; SILENT otherwise. A new sentence that reads like an EMPTY STATE
    is flagged, because "no notes" after a failed load is a false statement, not a notice."""
    base = set()
    for b in baselines:
        base |= {_norm_line(x) for x in b}
    new = []
    for x in failed:
        n = _norm_line(x)
        if n and n not in base and n not in {_norm_line(y) for y in new}:
            new.append(" ".join(x.split()))
    new_alerts = [" ".join(a.split()) for a in alerts if _norm_line(a) and _norm_line(a) not in base]
    sentences = [s for s in new_alerts + new if is_sentence(s)]
    verdict = "SENTENCE" if sentences else "SILENT"
    empty_like = [s for s in sentences if EMPTY_STATE_HINT.search(s)]
    return {"verdict": verdict, "sentences": sentences[:8], "new_text": new[:12],
            "new_alerts": new_alerts[:6], "empty_state_suspect": bool(empty_like) and len(empty_like) == len(sentences)}


def judge_geometry(cell: dict, *, width: int) -> dict:
    """One surface x width reading -> findings. Three kinds, each named:
       overflow  the document (or the app's main scroller) is wider than the viewport, or an
                 element sticks out past the viewport without a clipping/scrolling ancestor;
       occluded  a control's centre (or 3 of its 5 sample points) lands on another element;
       tap       at <= 1024 px, a control rendered under 44 px on an axis (inline links exempt).
    A control inside an on-screen sideways scroller is REACHABLE, not overflow (recorded)."""
    findings = []
    vw = cell.get("vw", width)
    if cell.get("docScrollW", 0) > cell.get("docClientW", vw) + 1:
        findings.append({"kind": "overflow", "what": "document", "scrollWidth": cell["docScrollW"],
                         "clientWidth": cell.get("docClientW")})
    for s in cell.get("pageScrollers", []):
        if s.get("scrollW", 0) > s.get("clientW", 0) + 1 and s.get("role") == "page":
            findings.append({"kind": "overflow", "what": s.get("desc"), "scrollWidth": s.get("scrollW"),
                             "clientWidth": s.get("clientW"), "widened_by": s.get("widenedBy", [])})
    for o in cell.get("offenders", []):
        findings.append({"kind": o.get("kind", "overflow"), "what": o.get("desc"), "right": o.get("right"),
                         "area": o.get("area")})
    for c in cell.get("controls", []):
        if not c.get("inViewport"):
            continue
        if c.get("occluder") and (c.get("centerCovered") or c.get("coveredPoints", 0) >= 3) and c.get("occluderPopup"):
            continue   # under the popup this surface OPENED (a menu over the note): by design, not a finding
        if c.get("occluder") and (c.get("centerCovered") or c.get("coveredPoints", 0) >= 3):
            findings.append({"kind": "occluded", "control": c.get("name"), "tag": c.get("tag"),
                             "area": c.get("area"), "by": c.get("occluder"), "hit": c.get("occluderHit"),
                             "by_modal": bool(c.get("occluderModal")),
                             "box": c.get("box")})
        if width <= TOUCH_MAX_WIDTH and not c.get("inlineLink") and not c.get("disabled"):
            w, h = c.get("w", 0), c.get("h", 0)
            if w < TAP_MIN - TAP_TOLERANCE or h < TAP_MIN - TAP_TOLERANCE:
                findings.append({"kind": "tap", "control": c.get("name"), "tag": c.get("tag"),
                                 "area": c.get("area"), "w": w, "h": h})
    return {"findings": findings,
            "reachable_in_scroller": [c.get("name") for c in cell.get("controls", [])
                                      if c.get("offscreenInScroller")]}


def judge_axe(result: dict) -> dict:
    v = result.get("violations") or []
    return {"verdict": "PASS" if not v else "FAIL", "violations": len(v),
            "rules": sorted({x.get("id") for x in v})}


def control_ok(sweep: str, got: dict) -> tuple[bool, str]:
    """Did the planted defect FAIL the instrument as it must? One authority per sweep."""
    if sweep == "deadclick":
        want = {"plant-dead": "DEAD", "plant-dead-styled": "DEAD", "plant-live": "LIVE"}
    elif sweep == "silent":
        want = {"plant-swallow:500": "SILENT", "plant-swallow:offline": "SILENT",
                "plant-honest:500": "SENTENCE", "plant-honest:offline": "SENTENCE"}
    elif sweep == "geometry":
        want = {"plant-wide": "found", "plant-small": "found", "plant-covered": "found"}
    elif sweep == "axe":
        want = {"color-contrast": "found", "button-name": "found"}
    elif sweep == "census":
        want = {"plant-no-door": "NO-DOOR", "plant-broken-door": "BROKEN"}
    else:
        return False, f"no control defined for {sweep!r}"
    bad = {k: (got.get(k), v) for k, v in want.items() if got.get(k) != v}
    if bad:
        return False, "; ".join(f"{k}: got {g!r}, must be {w!r}" for k, (g, w) in bad.items())
    return True, "every planted defect failed the instrument as it must"


# ── the browser half ─────────────────────────────────────────────────────────

# Installed with `context.add_init_script` so it runs before the app: one MutationObserver
# over the whole document (records kept with a moving base so the buffer stays bounded), and
# the three browser doors a headless page cannot show a member (print, clipboard) counted.
INSTRUMENT_JS = r"""
(() => {
  if (window.__proof) return;
  const P = window.__proof = {muts: [], base: 0, noise: new Set(), printed: 0, clip: 0};
  const push = (list) => {
    for (const m of list) P.muts.push({m, t: performance.now()});
    if (P.muts.length > 40000) { P.muts.splice(0, 20000); P.base += 20000; }
  };
  const start = () => {
    const obs = new MutationObserver(push);
    obs.observe(document.documentElement, {subtree: true, childList: true, attributes: true,
                                           characterData: true, attributeOldValue: true});
  };
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
  window.print = function () { P.printed++; };
  try {
    const c = navigator.clipboard;
    if (c) {
      const wt = c.writeText ? c.writeText.bind(c) : null;
      c.writeText = (t) => { P.clip++; return wt ? wt(t).catch(() => {}) : Promise.resolve(); };
      const w = c.write ? c.write.bind(c) : null;
      if (w) c.write = (d) => { P.clip++; return w(d).catch(() => {}); };
    }
  } catch (e) {}
  const ex = document.execCommand ? document.execCommand.bind(document) : null;
  if (ex) document.execCommand = function (cmd, a, b) { if (String(cmd).toLowerCase() === 'copy') P.clip++; return ex(cmd, a, b); };
})();
"""

MARK_JS = r"""() => { const P = window.__proof; P.focusMark = document.activeElement;
  return {mark: P.base + P.muts.length, printed: P.printed, clip: P.clip}; }"""

# Add every element that mutated in [from, now) to the page's noise set (the idle window).
NOISE_JS = r"""(from) => { const P = window.__proof; let n = 0;
  for (let i = Math.max(0, from - P.base); i < P.muts.length; i++) {
    const m = P.muts[i].m; const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
    if (el && !P.noise.has(el)) { P.noise.add(el); n++; }
  }
  return {added: n, size: P.noise.size}; }"""

# The effect of one click. `hoverFrom` .. `clickFrom` is the hover settle: whatever changed
# there is excluded for THIS click only (a tooltip that is slow to appear is not the click).
# Attribute changes ON the control itself count only when they are aria-* (a toggle); a class
# or style change there is pointer styling (":active", "pressed" classes) and never evidence.
EFFECT_JS = r"""(args) => {
  const [hoverFrom, clickFrom] = args; const P = window.__proof;
  const ctl = document.querySelector('[data-proof-target]');
  const local = new Set();
  for (let i = Math.max(0, hoverFrom - P.base); i < clickFrom - P.base && i < P.muts.length; i++) {
    const m = P.muts[i].m; const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
    if (el) local.add(el);
  }
  const inSet = (set, el) => { for (const n of set) { if (n === el || (n.isConnected && n.contains(el))) return true; } return false; };
  const out = {dom: 0, expanded: 0, selfIgnored: 0, noiseIgnored: 0, samples: []};
  const desc = (el) => el ? (el.tagName + (el.getAttribute('aria-label') ? '[' + el.getAttribute('aria-label').slice(0, 40) + ']' : '')
                              + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0].slice(0, 30) : '')) : '?';
  const SVGNS = 'http://www.w3.org/2000/svg';
  const chrome = (el) => !el.closest('main') && !el.closest('[role=dialog],[role=menu],[role=listbox],[role=alertdialog],[role=tooltip],[data-proof-popup]');
  const ctlChrome = ctl ? chrome(ctl) : false;
  out.chromeIgnored = 0; out.iconIgnored = 0; out.headIgnored = 0;
  for (let i = Math.max(0, clickFrom - P.base); i < P.muts.length; i++) {
    const m = P.muts[i].m;
    const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
    if (!el) continue;
    if (m.type === 'attributes' && (m.attributeName || '').startsWith('data-proof')) continue;
    // a lazy chunk's stylesheet landing in <head> is not something a member sees
    if (el.closest('head') || el === document.head) { out.headIgnored++; continue; }
    // UIcon re-numbers its gradient ids on every re-render: an icon attribute churning is not
    // an effect (a toggle that matters also changes its aria state or its text)
    if (m.type === 'attributes' && el.namespaceURI === SVGNS) { out.iconIgnored++; continue; }
    // an input re-randomising its name/autocomplete (an anti-autofill idiom) is not an effect
    if (m.type === 'attributes' && el.tagName === 'INPUT' && (m.attributeName === 'name' || m.attributeName === 'autocomplete')) { out.iconIgnored++; continue; }
    // the app's floating chrome (the voice orb reacts to ANY pointer activity) is not the
    // Notebook control's effect unless the control itself lives there
    if (!ctlChrome && chrome(el) && el.isConnected) { out.chromeIgnored++; continue; }
    if (inSet(P.noise, el) || inSet(local, el)) { out.noiseIgnored++; continue; }
    const a = m.attributeName || '';
    if (m.type === 'attributes' && a === 'aria-expanded') out.expanded++;
    const onSelf = ctl && (ctl === el || ctl.contains(el));
    if (m.type === 'attributes' && onSelf && !a.startsWith('aria-')) { out.selfIgnored++; continue; }
    out.dom++;
    if (out.samples.length < 4) out.samples.push(m.type + ':' + (a || '') + ':' + desc(el));
  }
  const f = document.activeElement;
  const field = ctl && ctl.matches('input,select,textarea,[contenteditable="true"],[contenteditable=""]');
  let focusMoved = false;
  if (ctl && f && f !== document.body && f !== P.focusMark) {
    focusMoved = field ? (f === ctl || ctl.contains(f)) : !(f === ctl || ctl.contains(f));
  }
  out.focus_moved = focusMoved;
  out.already_focused = !!(ctl && P.focusMark && (P.focusMark === ctl || ctl.contains(P.focusMark)));
  out.focus_after = f ? desc(f) : null;
  out.printed = P.printed; out.clip = P.clip;
  return out;
}"""

# Every control in `root` (a CSS selector; null = the document), with a key that survives a
# re-render: tag|role|name with digits folded, plus its index among equal keys.
CONTROLS_JS = r"""(root) => {
  const R = root ? document.querySelector(root) : document.body;
  if (!R) return null;
  const SEL = 'button,a[href],[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],' +
              '[role=menuitemradio],[role=option],[role=switch],[role=checkbox],[role=radio],[role=treeitem],' +
              'summary,input:not([type=hidden]),select,textarea,[contenteditable="true"]';
  const nameOf = (el) => {
    let n = el.getAttribute('aria-label');
    if (!n && el.getAttribute('aria-labelledby')) n = el.getAttribute('aria-labelledby').split(/\s+/).map(i => (document.getElementById(i) || {}).innerText || '').join(' ');
    if (!n) n = (el.innerText || '').split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
    if (!n) n = el.getAttribute('title') || el.getAttribute('placeholder') || el.value || '';
    return String(n).replace(/\s+/g, ' ').trim().slice(0, 70);
  };
  const seen = {}; const out = [];
  for (const el of R.querySelectorAll(SEL)) {
    if (el.closest('[data-proof-ignore]')) continue;
    if (el.matches('[contenteditable="true"]') && el.parentElement && el.parentElement.closest('[contenteditable="true"]')) continue;
    const cs = getComputedStyle(el);
    const rects = el.getClientRects();
    const visible = rects.length > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    if (!visible) continue;
    const role = el.getAttribute('role') || '';
    const name = nameOf(el);
    const key = el.tagName + '|' + role + '|' + name.replace(/\d+/g, '#');
    seen[key] = (seen[key] || 0) + 1;
    const disabled = !!(el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('fieldset[disabled]'));
    const field = el.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=file]),select,textarea,[contenteditable="true"]');
    const b = el.getBoundingClientRect();
    const cur = el.getAttribute('aria-selected') === 'true' || (el.getAttribute('aria-current') && el.getAttribute('aria-current') !== 'false')
                || (el.getAttribute('aria-pressed') === 'true' && !!el.closest('[role=group],[role=radiogroup],[role=tablist],[role=toolbar]'))
                || (el.getAttribute('role') === 'radio' && el.getAttribute('aria-checked') === 'true');
    out.push({key, nth: seen[key], tag: el.tagName, role, name, disabled, field, current: !!cur,
              type: el.getAttribute('type') || '', href: el.getAttribute('href') || '',
              target: el.getAttribute('target') || '', box: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]});
  }
  return out;
}"""

# Tag the nth control with `key` in `root` as THE target (and clear the previous tag).
TARGET_JS = r"""(args) => {
  const [root, key, nth] = args;
  for (const e of document.querySelectorAll('[data-proof-target]')) e.removeAttribute('data-proof-target');
  const R = root ? document.querySelector(root) : document.body;
  if (!R) return false;
  const SEL = 'button,a[href],[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],' +
              '[role=menuitemradio],[role=option],[role=switch],[role=checkbox],[role=radio],[role=treeitem],' +
              'summary,input:not([type=hidden]),select,textarea,[contenteditable="true"]';
  const nameOf = (el) => {
    let n = el.getAttribute('aria-label');
    if (!n && el.getAttribute('aria-labelledby')) n = el.getAttribute('aria-labelledby').split(/\s+/).map(i => (document.getElementById(i) || {}).innerText || '').join(' ');
    if (!n) n = (el.innerText || '').split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
    if (!n) n = el.getAttribute('title') || el.getAttribute('placeholder') || el.value || '';
    return String(n).replace(/\s+/g, ' ').trim().slice(0, 70);
  };
  let k = 0;
  for (const el of R.querySelectorAll(SEL)) {
    if (el.closest('[data-proof-ignore]')) continue;
    if (el.matches('[contenteditable="true"]') && el.parentElement && el.parentElement.closest('[contenteditable="true"]')) continue;
    const cs = getComputedStyle(el);
    if (!(el.getClientRects().length > 0 && cs.visibility !== 'hidden' && cs.display !== 'none')) continue;
    const kk = el.tagName + '|' + (el.getAttribute('role') || '') + '|' + nameOf(el).replace(/\d+/g, '#');
    if (kk === key && ++k === nth) { el.setAttribute('data-proof-target', '1'); return true; }
  }
  return false;
}"""

FORMSTATE_JS = r"""(root) => { const R = root ? document.querySelector(root) : document.body; if (!R) return '';
  return Array.from(R.querySelectorAll('input,select,textarea')).map(e =>
    (e.type === 'checkbox' || e.type === 'radio') ? (e.checked ? '1' : '0') : String(e.value || '').slice(0, 40)).join('|'); }"""

# The Notebook tab's own root: the parent of its skip link (NotebookTab.jsx renders
# `<a href="#notebook-pane">` as the wrap's first child). Tagged so every sweep scopes to it.
MARK_ROOT_JS = r"""() => {
  for (const e of document.querySelectorAll('[data-proof-root]')) e.removeAttribute('data-proof-root');
  const skip = document.querySelector('a[href="#notebook-pane"]');
  const r = skip ? skip.parentElement : null;
  if (r) r.setAttribute('data-proof-root', 'notebook');
  return !!r; }"""

# Visible text lines of the page (the silent sweep's reading), plus live regions.
TEXT_JS = r"""() => {
  const lines = new Set(); const alerts = [];
  const vis = (el) => { const cs = getComputedStyle(el); return el.getClientRects().length > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const t = (n.nodeValue || '').trim();
    if (!t) continue;
    const el = n.parentElement;
    if (!el || el.closest('script,style,noscript,[data-proof-ignore]') || !vis(el)) continue;
    const block = el.closest('p,li,h1,h2,h3,h4,h5,h6,div,span,td,th,label,button,a,section') || el;
    const bt = (block.innerText || t).replace(/\s+/g, ' ').trim();
    if (bt) lines.add(bt.slice(0, 240));
  }
  for (const a of document.querySelectorAll('[role=alert],[role=status],[aria-live]')) {
    if (!vis(a)) continue;
    const t = (a.innerText || '').replace(/\s+/g, ' ').trim();
    if (t) alerts.push(t.slice(0, 240));
  }
  return {lines: Array.from(lines), alerts};
}"""

# One geometry reading. Areas: 'notebook' (inside the tagged root), 'journal-shell' (inside
# <main> but outside the root), 'overlay' (a dialog/menu portaled to <body>), 'app-chrome'.
GEOM_JS = r"""() => {
  const vw = window.innerWidth, vh = window.innerHeight, de = document.documentElement;
  const vis = (el) => { const cs = getComputedStyle(el); return el.getClientRects().length > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const desc = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
      (el.dataset && el.dataset.proofControl ? '{' + el.dataset.proofControl + '}' : '') +
      (el.getAttribute('aria-label') ? '[' + el.getAttribute('aria-label').slice(0, 40) + ']' : '') +
      (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.').slice(0, 50) : '') +
      ((el.innerText || '').trim() ? ' "' + (el.innerText || '').trim().split('\n')[0].slice(0, 40) + '"' : '');
  const areaOf = (el) => {
    if (el.closest('[data-proof-root]')) return 'notebook';
    if (el.closest('[role=dialog],[role=menu],[role=listbox],[role=alertdialog]') && !el.closest('main')) return 'overlay';
    if (el.closest('main')) return 'journal-shell';
    return 'app-chrome';
  };
  const clipsX = (cs) => ['hidden', 'auto', 'scroll', 'clip'].includes(cs.overflowX);
  const res = {vw, vh, docScrollW: de.scrollWidth, docClientW: de.clientWidth, pageScrollers: [], offenders: [], controls: []};
  const main = document.querySelector('main');
  if (main) {
    const ps = {role: 'page', desc: 'main', scrollW: main.scrollWidth, clientW: main.clientWidth, widenedBy: []};
    if (main.scrollWidth > main.clientWidth + 1) {
      // NAME what widens the app's scroller: the outermost elements past its right edge that
      // no inner sideways scroller or clipping box holds
      const mr = main.getBoundingClientRect(); const found = [];
      for (const el of main.querySelectorAll('*')) {
        if (!vis(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.right <= mr.right + 1) continue;
        let held = false;
        for (let a = el.parentElement; a && a !== main; a = a.parentElement) { if (clipsX(getComputedStyle(a))) { held = true; break; } }
        if (held || found.some(f => f.contains(el))) continue;
        found.push(el);
        if (ps.widenedBy.length < 8) ps.widenedBy.push({desc: desc(el), right: Math.round(r.right), width: Math.round(r.width), area: areaOf(el)});
      }
    }
    res.pageScrollers.push(ps);
  }
  const offenderSet = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('[data-proof-ignore]') || !vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.right <= vw + 1) continue;
    let clipper = null;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (clipsX(getComputedStyle(a))) { clipper = a; break; }
    }
    let kind = 'overflow';
    if (clipper) {
      // inside a sideways scroller it is REACHABLE; clipped by a box that does not scroll and
      // that ends on screen, the part past that box is CUT OFF (no member can reach it)
      const ox = getComputedStyle(clipper).overflowX;
      const cr = clipper.getBoundingClientRect();
      if (ox === 'auto' || ox === 'scroll' || cr.right > vw + 1 || r.right <= cr.right + 1 || r.left >= vw) continue;
      kind = 'cutoff';
    }
    let covered = false;
    for (const o of offenderSet) if (o.contains(el)) { covered = true; break; }
    if (covered) continue;
    offenderSet.add(el);
    if (res.offenders.length < 25) res.offenders.push({kind, desc: desc(el), right: Math.round(r.right), width: Math.round(r.width),
                                                        position: getComputedStyle(el).position, area: areaOf(el)});
  }
  const SEL = 'button,a[href],[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=switch],' +
              '[role=checkbox],[role=radio],summary,input:not([type=hidden]),select,textarea';
  const hiddenLook = (el, b) => { const cs = getComputedStyle(el);
    if ((b.width <= 2 && b.height <= 2) || cs.clip === 'rect(0px, 0px, 0px, 0px)' || /inset\(50%/.test(cs.clipPath || '')) return 'visually hidden';
    if (parseFloat(cs.opacity) === 0) return 'transparent (revealed on hover)';
    // a skip link is hidden UNTIL IT HAS FOCUS by design (it may sit behind a header); it is
    // not judged as covered, but it stays a possible OCCLUDER of everything else
    if (el.tagName === 'A' && /^#/.test(el.getAttribute('href') || '') && /^skip\b/i.test((el.innerText || '').trim()) && document.activeElement !== el) return 'skip link (shown on focus)';
    return ''; };
  res.invisibleTargets = [];
  for (const el of document.querySelectorAll(SEL)) {
    if (el.closest('[data-proof-ignore]') || !vis(el)) continue;
    const b = el.getBoundingClientRect();
    if (b.width <= 0 || b.height <= 0) continue;
    const why = hiddenLook(el, b);
    if (why) {
      // not a control a member SEES at rest, so it is never judged -- listed with its reason
      // (a transparent target on a touch screen still takes a tap)
      if (res.invisibleTargets.length < 40) res.invisibleTargets.push({name: (el.getAttribute('aria-label') || (el.innerText || '').trim()).slice(0, 50),
        why, tag: el.tagName, area: areaOf(el), box: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]});
      continue;
    }
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const inViewport = cx >= 0 && cx <= vw && cy >= 0 && cy <= vh;
    let scroller = null;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && a.scrollWidth > a.clientWidth + 1) { scroller = a; break; }
    }
    const offscreenInScroller = !!scroller && (b.right > vw + 1 || b.left < -1);
    const name = (el.getAttribute('aria-label') || (el.innerText || '').split('\n')[0] || el.getAttribute('title') || el.getAttribute('placeholder') || '').trim().slice(0, 60);
    const c = {name, tag: el.tagName, area: areaOf(el), box: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
               w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, inViewport, offscreenInScroller,
               disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true')};
    if (el.tagName === 'A') {
      const p = el.parentElement;
      const own = (el.innerText || '').trim().length;
      const around = p ? (p.innerText || '').trim().length : 0;
      c.inlineLink = !!p && around > own + 20 && getComputedStyle(el).display === 'inline';
    }
    if (inViewport) {
      const pts = [[cx, cy], [b.x + b.width * 0.2, b.y + b.height * 0.25], [b.x + b.width * 0.8, b.y + b.height * 0.25],
                   [b.x + b.width * 0.2, b.y + b.height * 0.75], [b.x + b.width * 0.8, b.y + b.height * 0.75]];
      let covered = 0, centerCovered = false, occ = null;
      pts.forEach(([x, y], i) => {
        if (x < 0 || y < 0 || x > vw || y > vh) return;
        const hit = document.elementFromPoint(x, y);
        if (!hit || hit === el || el.contains(hit) || hit.contains(el)) return;
        if (hit.closest('[data-proof-ignore]')) return;
        covered++; if (i === 0) centerCovered = true;
        if (!occ) { occ = desc(hit.closest('[role=dialog],[role=tooltip],[role=status],section,aside,div') || hit);
                    c.occluderHit = desc(hit);
                    c.occluderPopup = !!(hit.closest('[data-proof-popup]') && !el.closest('[data-proof-popup]'));
                    c.occluderModal = !!(hit.closest('[aria-modal="true"]') || (hit.querySelector && hit.querySelector('[aria-modal="true"]'))); }
      });
      c.coveredPoints = covered; c.centerCovered = centerCovered; c.occluder = occ;
    }
    res.controls.push(c);
  }
  return res;
}"""

# The planted defects, one per instrument, each tagged `data-proof-plant` and removed after.
PLANT_DEADCLICK_JS = r"""(root) => {
  const R = (root && document.querySelector(root)) || document.body;
  const box = document.createElement('div'); box.setAttribute('data-proof-plant', 'deadclick');
  box.style.cssText = 'position:relative;display:flex;gap:8px;padding:4px;';
  const mk = (id, label) => { const b = document.createElement('button'); b.type = 'button';
    b.setAttribute('data-proof-control', id); b.setAttribute('aria-label', label); b.textContent = label;
    b.style.cssText = 'min-width:120px;min-height:44px;'; box.appendChild(b); return b; };
  mk('plant-dead', 'Planted dead control');
  const s = mk('plant-dead-styled', 'Planted dead styled control');
  s.addEventListener('mousedown', () => s.classList.add('pressed')); s.addEventListener('mouseup', () => s.classList.remove('pressed'));
  s.addEventListener('pointerdown', () => s.classList.add('pressed')); s.addEventListener('pointerup', () => s.classList.remove('pressed'));
  const l = mk('plant-live', 'Planted live control');
  l.addEventListener('click', () => { l.textContent = 'Planted live control, clicked ' + Date.now(); });
  R.insertBefore(box, R.firstChild);
  return true; }"""

PLANT_SILENT_JS = r"""() => {
  const box = document.createElement('div'); box.setAttribute('data-proof-plant', 'silent');
  box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147483647;display:flex;gap:6px;background:#fff;padding:4px';
  const sw = document.createElement('button'); sw.type = 'button'; sw.textContent = 'plant swallow'; sw.id = 'proof-plant-swallow';
  sw.addEventListener('click', () => { fetch('/api/proof-plant/swallow', {method: 'POST'}).catch(() => {}); });
  const hn = document.createElement('button'); hn.type = 'button'; hn.textContent = 'plant honest'; hn.id = 'proof-plant-honest';
  hn.addEventListener('click', async () => {
    let ok = false; try { const r = await fetch('/api/proof-plant/honest', {method: 'POST'}); ok = r.ok; } catch (e) { ok = false; }
    if (!ok) { const p = document.createElement('p'); p.setAttribute('role', 'alert'); p.textContent = 'We could not save that change. Try again in a moment.'; box.appendChild(p); }
  });
  box.appendChild(sw); box.appendChild(hn); document.body.appendChild(box); return true; }"""

PLANT_GEOMETRY_JS = r"""(root) => {
  const R = (root && document.querySelector(root)) || document.querySelector('main') || document.body;
  const box = document.createElement('div'); box.setAttribute('data-proof-plant', 'geometry');
  const wide = document.createElement('div'); wide.setAttribute('data-proof-control', 'plant-wide');
  wide.style.cssText = 'width:1400px;height:6px;background:#c00;'; wide.textContent = '';
  const small = document.createElement('button'); small.type = 'button'; small.setAttribute('aria-label', 'Planted small control');
  small.setAttribute('data-proof-control', 'plant-small'); small.style.cssText = 'width:20px;height:20px;padding:0;display:block;margin:4px;';
  const wrap = document.createElement('div'); wrap.style.cssText = 'position:relative;width:120px;height:44px;margin:4px;';
  const under = document.createElement('button'); under.type = 'button'; under.setAttribute('aria-label', 'Planted covered control');
  under.setAttribute('data-proof-control', 'plant-covered'); under.style.cssText = 'width:120px;height:44px;';
  const cover = document.createElement('div'); cover.setAttribute('aria-label', 'Planted cover');
  cover.style.cssText = 'position:absolute;inset:0;background:rgba(200,0,0,.4);';
  wrap.appendChild(under); wrap.appendChild(cover);
  box.appendChild(small); box.appendChild(wrap); box.appendChild(wide);
  R.insertBefore(box, R.firstChild); return true; }"""

PLANT_AXE_JS = r"""(root) => {
  const R = (root && document.querySelector(root)) || document.body;
  const box = document.createElement('div'); box.setAttribute('data-proof-plant', 'axe');
  const p = document.createElement('p'); p.id = 'proof-plant-contrast'; p.textContent = 'Planted low contrast text for the axe control';
  p.style.cssText = 'color:#777777;background:#808080;font-size:14px;';
  const b = document.createElement('button'); b.type = 'button'; b.id = 'proof-plant-noname';
  box.appendChild(p); box.appendChild(b); R.insertBefore(box, R.firstChild); return true; }"""

UNPLANT_JS = r"""(which) => { let n = 0; for (const e of document.querySelectorAll(which ? '[data-proof-plant="' + which + '"]' : '[data-proof-plant]')) { e.remove(); n++; } return n; }"""


def self_check() -> int:
    """The judges' own controls, no browser: each planted observation must be judged the way
    the in-page control is required to be. Printed; exit 0 only when every one holds."""
    rows = []
    rows.append(("dead click", judge_click({}), ("DEAD", [])))
    rows.append(("telemetry only", judge_click({"requests": [{"url": "http://x/api/j2/telemetry"}]})[0], "DEAD"))
    rows.append(("dom change", judge_click({"dom": 1})[0], "LIVE"))
    rows.append(("focus move", judge_click({"focus_moved": True})[0], "LIVE"))
    rows.append(("swallowed 500", judge_failure([["Notes", "All notes"]], ["Notes", "All notes"], [])["verdict"], "SILENT"))
    rows.append(("honest 500", judge_failure([["Notes"]], ["Notes", "We could not load your notes."], [])["verdict"], "SENTENCE"))
    rows.append(("1400px element", bool(judge_geometry({"vw": 390, "docScrollW": 1400, "docClientW": 390, "controls": []}, width=390)["findings"]), True))
    rows.append(("20px target at 390", judge_geometry({"vw": 390, "docScrollW": 390, "docClientW": 390, "controls": [
        {"name": "x", "tag": "BUTTON", "inViewport": True, "w": 20, "h": 20}]}, width=390)["findings"][0]["kind"], "tap"))
    rows.append(("20px target at 1200 (desktop, no tap rule)", judge_geometry({"vw": 1200, "docScrollW": 1200, "docClientW": 1200, "controls": [
        {"name": "x", "tag": "BUTTON", "inViewport": True, "w": 20, "h": 20}]}, width=1200)["findings"], []))
    rows.append(("axe violation", judge_axe({"violations": [{"id": "color-contrast"}]})["verdict"], "FAIL"))
    ok = True
    for name, got, want in rows:
        good = got == want
        ok &= good
        print(f"{'ok ' if good else 'BAD'} {name}: got {got!r}, want {want!r}")
    return 0 if ok else 1


# ─────────────────────────────────────────────────────────────────────────────
# THE RUNTIME PART: a browser, a sandbox, synthetic accounts made IN that sandbox.
# ─────────────────────────────────────────────────────────────────────────────

PATIENCE = {"f": 1.0}   # the silent sweep shortens every surface wait while a load is being failed


def _t(ms: float) -> int:
    return int(ms * PATIENCE["f"])


ROOT = '[data-proof-root="notebook"]'
POPUP = '[data-proof-popup]'
MAX_CONTROLS = 140
res: dict = {"wave": 10, "lane": "10E-1", "instrument": "tools/notebook_proof_walk.py", "errors": [],
             "pageerrors": [], "controls": {}, "sweep_status": {}}
OUT: dict = {"dir": None}
LINES: list[str] = []


def say(line: str) -> None:
    LINES.append(line)
    print(line, file=sys.stderr, flush=True)


def dump(name: str, obj) -> None:
    d = OUT["dir"]
    if d is None:
        return
    (Path(d) / f"{name}.json").write_text(json.dumps(obj, indent=1, ensure_ascii=False, default=str) + "\n",
                                          encoding="utf-8", newline="\n")


class Tap:
    """What one page did that the DOM cannot say: its requests and its browser doors."""

    def __init__(self, pg):
        self.reqs: list[dict] = []
        self.events = {"download": 0, "filechooser": 0, "popup": 0, "dialog": 0}
        self.popups = []
        pg.on("request", lambda r: self.reqs.append({"t": time.time(), "method": r.method, "url": r.url}))
        pg.on("download", lambda d: self._ev("download"))
        pg.on("filechooser", lambda fc: self._ev("filechooser"))
        pg.on("popup", self._popup)
        pg.on("dialog", self._dialog)
        pg.on("pageerror", lambda e: res["pageerrors"].append(str(e)[:300]))

    def _ev(self, k):
        self.events[k] += 1

    def _popup(self, p):
        self.events["popup"] += 1
        self.popups.append(p)

    def _dialog(self, d):
        self.events["dialog"] += 1
        try:
            d.dismiss()
        except Exception:  # noqa: BLE001
            pass


class World:
    """The sandbox as this walk sees it: an admin, the members it made, their contexts."""

    def __init__(self, browser, base: str, art: Path):
        from tools import notebook_perf_harness as H
        self.H = H
        self.browser, self.base, self.art = browser, base, art
        self.run = time.strftime("r%H%M%S")
        self.pw = secrets.token_urlsafe(18)       # a TEST value for this run; never written anywhere
        self.admin = browser.new_context()
        self.states: dict = {}
        self.emails: dict = {}
        self._ctx: dict = {}
        self.fx: dict = {}                        # fixtures: note ids, tokens, folder names
        self.noise_endpoints: set = set()
        self.fresh_n = 0
        self.opened: list = []                   # every page this walk opened (the census closes its own)
        self.cell_ctx: list | None = None        # a census cell's own contexts (None: the shared ones)

    # ── accounts ────────────────────────────────────────────────────────────
    def email(self, tag: str) -> str:
        return f"w10e1-{tag}-{self.run.lower()}@local.dev"

    SIGNUP_GAP_S = 21.0   # POST /api/auth/signup is limited to 3 a minute (api/routers/auth.py)

    def admin_login(self) -> None:
        """The sandbox admin (the launcher's ADMIN_EMAILS default), signed in ONCE: login
        first (it exists after the first run), signup only if it does not."""
        req, H = self.admin.request, self.H
        r = req.post(self.base + "/api/auth/login", data={"email": H.ADMIN_EMAIL, "password": H.ADMIN_PW})
        if r.status not in (200, 201):
            self._throttle()
            r = req.post(self.base + "/api/auth/signup",
                         data={"email": H.ADMIN_EMAIL, "password": H.ADMIN_PW, "display_name": "hubtest"})
        if r.status not in (200, 201):
            raise RuntimeError(f"the sandbox admin could not sign in: HTTP {r.status} {r.text()[:160]}")

    def _throttle(self) -> None:
        wait = self.SIGNUP_GAP_S - (time.time() - getattr(self, "_last_signup", 0.0))
        if wait > 0:
            time.sleep(wait)
        self._last_signup = time.time()

    def provision(self, tag: str, name: str):
        """A paid, verified member made through the product's doors (the wave-6 recipe:
        signup, the admin's comp-access and verify-email, then /api/auth/me must say paid)."""
        ctx = self.browser.new_context(viewport=DESK)
        ctx.add_init_script(INSTRUMENT_JS)
        email = self.email(tag)
        self._throttle()
        r = ctx.request.post(self.base + "/api/auth/signup", data={"email": email, "password": self.pw,
                                                                  "display_name": name})
        if r.status not in (200, 201):
            raise RuntimeError(f"signup {tag}: HTTP {r.status} {r.text()[:160]}")
        c = self.admin.request.post(self.base + "/api/auth/admin/comp-access", data={"email": email, "action": "grant"})
        v = self.admin.request.post(self.base + "/api/auth/admin/verify-email", data={"email": email})
        me = ctx.request.get(self.base + "/api/auth/me").json()
        if not me.get("paid_equiv"):
            raise RuntimeError(f"{tag} is not paid-equivalent (comp HTTP {c.status}, verify HTTP {v.status})")
        self.emails[tag] = email
        return ctx

    def fresh_account(self) -> str:
        """A brand-new paid member (first-run state), minted per call for a sweep that changes it."""
        self.fresh_n += 1
        tag = f"fresh{self.fresh_n}"
        ctx = self.provision(tag, f"Fresh {self.fresh_n}")
        self.states[tag] = ctx.storage_state()
        if self.fx.get("theme"):
            self.set_theme(tag, self.fx["theme"], ctx=ctx)
        ctx.close()
        return tag

    def api(self, account: str = "seasoned"):
        return self.context(account, "desk").request

    def set_theme(self, account: str, theme: str, ctx=None) -> int:
        req = (ctx or self.context(account, "desk")).request
        r = req.post(self.base + "/api/auth/preferences", data={"key": "theme", "value": theme})
        return r.status

    # ── contexts and pages ──────────────────────────────────────────────────
    def context(self, account: str, mode: str = "desk"):
        key = (account, mode)
        if key not in self._ctx:
            self._ctx[key] = self.new_context(account, mode)
        return self._ctx[key]

    def new_context(self, account: str, mode: str = "desk"):
        """A NEW context (pristine browser storage from the account's stored state)."""
        vp = DESK if mode == "desk" else VIEWPORTS[mode]
        kw = {"viewport": {"width": vp["width"], "height": vp["height"]}, "accept_downloads": True}
        if vp.get("touch"):
            kw["has_touch"] = True
            kw["is_mobile"] = mode == "phone"
        if account in self.states:
            kw["storage_state"] = self.states[account]
        ctx = self.browser.new_context(**kw)
        ctx.add_init_script(INSTRUMENT_JS)
        return ctx

    def drop_contexts(self, account: str | None = None) -> None:
        for k in list(self._ctx):
            if account is None or k[0] == account:
                try:
                    self._ctx.pop(k).close()
                except Exception:  # noqa: BLE001
                    pass

    def page(self, account: str, mode: str = "desk"):
        if self.cell_ctx is not None:
            # a census cell: a PRISTINE context, so one door's persisted state (a section it
            # opened, a pane it hid) never becomes the next door's starting point -- the
            # shake-out's keyboard cell CLOSED the Unlinked mentions the desktop cell had opened
            ctx = self.new_context(account, mode)
            self.cell_ctx.append(ctx)
        else:
            ctx = self.context(account, mode)
        pg = ctx.new_page()
        self.opened.append(pg)
        PUMP["pg"] = pg
        return pg, Tap(pg)

    # ── fixtures through the product's own doors ────────────────────────────
    def note(self, title: str, body: dict | None = None, account: str = "seasoned", **extra) -> str:
        data = {"title": title, "bodyJson": body or DOC(P(title))}
        data.update(extra)
        r = self.api(account).post(self.base + "/api/j2/notes", data=data)
        if r.status not in (200, 201):
            raise RuntimeError(f"create note {title!r}: HTTP {r.status} {r.text()[:200]}")
        return r.json()["note"]["id"]


def P(text: str) -> dict:
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def DOC(*nodes) -> dict:
    return {"type": "doc", "content": list(nodes)}


def H_(level: int, text: str) -> dict:
    return {"type": "heading", "attrs": {"level": level}, "content": [{"type": "text", "text": text}]}


def dismiss_intro(pg) -> None:
    d = pg.locator('div[role="dialog"][aria-label="Welcome"]')
    try:
        d.first.wait_for(state="visible", timeout=2500)
    except Exception:  # noqa: BLE001 -- it did not play in this tab
        return
    pg.keyboard.press("Escape")
    try:
        d.first.wait_for(state="detached", timeout=6000)
    except Exception:  # noqa: BLE001
        try:
            pg.get_by_role("button", name="Skip intro", exact=True).click(timeout=1500)
            d.first.wait_for(state="detached", timeout=6000)
        except Exception:  # noqa: BLE001
            pass


def goto(W: World, pg, path: str) -> None:
    pg.goto(W.base + path, wait_until="domcontentloaded", timeout=45000)
    dismiss_intro(pg)


def mark_root(pg, timeout: float = 25.0) -> str:
    end = time.time() + timeout * PATIENCE["f"]
    while time.time() < end:
        try:
            if pg.evaluate(MARK_ROOT_JS):
                return ROOT
        except Exception:  # noqa: BLE001 -- navigating
            pass
        pg.wait_for_timeout(400)
    raise RuntimeError("the Notebook root (its skip link's parent) never rendered")


def mark_popup(loc) -> str:
    loc.wait_for(state="visible", timeout=10000)
    loc.evaluate("e => { for (const x of document.querySelectorAll('[data-proof-popup]')) "
                 "x.removeAttribute('data-proof-popup'); e.setAttribute('data-proof-popup', '1'); }")
    return POPUP


def is_touch(pg) -> bool:
    try:
        return bool(pg.evaluate("() => matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0"))
    except Exception:  # noqa: BLE001
        return False


def press(pg, loc) -> None:
    """Activate the way the viewport's member would: a tap on a touch viewport, else a click."""
    if is_touch(pg):
        loc.tap(timeout=6000)
    else:
        loc.click(timeout=6000)


# ── the surfaces: each opens itself from a fresh page and returns its root selector ──

def s_list(W, pg, view: str | None = None) -> str:
    goto(W, pg, "/journal/notebook?view=all")
    root = mark_root(pg)
    pg.wait_for_timeout(1500)
    if view:
        b = pg.get_by_role("button", name=f"{view} view", exact=True).filter(visible=True).first
        press(pg, b)
        pg.wait_for_timeout(1500)
    return root


def s_first_run(W, pg) -> str:
    goto(W, pg, "/journal/notebook")
    root = mark_root(pg)
    pg.get_by_text("Welcome to your Notebook").filter(visible=True).first.wait_for(state="visible", timeout=15000)
    pg.wait_for_timeout(1500)
    return root


def s_home(W, pg) -> str:
    goto(W, pg, "/journal/notebook")
    root = mark_root(pg)
    pg.wait_for_timeout(2000)
    return root


def s_tasks(W, pg) -> str:
    goto(W, pg, "/journal/notebook?view=tasks")
    root = mark_root(pg)
    pg.wait_for_timeout(2000)
    return root


def s_search(W, pg) -> str:
    root = s_list(W, pg)
    press(pg, pg.get_by_role("tab", name="Search notes").filter(visible=True).first)
    box = pg.get_by_label("Search your notes").filter(visible=True).first
    box.wait_for(state="visible", timeout=8000)
    box.fill("base")
    pg.wait_for_timeout(2500)
    return root


def s_trash(W, pg) -> str:
    root = s_list(W, pg)
    press(pg, pg.get_by_role("button", name=re.compile(r"^Trash\b")).filter(visible=True).first)
    pg.wait_for_timeout(1500)
    return root


def s_bulk(W, pg) -> str:
    root = s_list(W, pg)
    boxes = pg.locator(f'{ROOT} input[type="checkbox"][aria-label^="Select "]')
    press(pg, boxes.nth(0))
    press(pg, boxes.nth(1))
    pg.wait_for_timeout(800)
    return root


def s_templates(W, pg) -> str:
    s_list(W, pg)
    press(pg, pg.get_by_role("button", name="Templates", exact=True).filter(visible=True).first)
    card = pg.get_by_role("button", name="Long/Short Thesis")
    card.first.wait_for(state="visible", timeout=10000)
    return mark_popup(pg.get_by_role("dialog").filter(has=card).filter(visible=True).first)


def s_import(W, pg) -> str:
    s_list(W, pg)
    b = pg.get_by_role("button", name=re.compile(r"^Import", re.I)).filter(visible=True).first
    press(pg, b)
    return mark_popup(pg.get_by_role("dialog").last)


def s_saved_view(W, pg) -> str:
    s_list(W, pg, view="Table")
    press(pg, pg.get_by_role("button", name="Save view").filter(visible=True).first)
    return mark_popup(pg.get_by_role("dialog", name="Save view"))


def s_publish_folder(W, pg) -> str:
    s_list(W, pg)
    name = W.fx.get("folder", "Sample notebook")
    b = pg.get_by_role("button", name=f"Publish {name}", exact=True).filter(visible=True).first
    if not is_touch(pg):
        pg.get_by_role("button", name=re.compile(re.escape(name))).filter(visible=True).first.hover()
    press(pg, b)
    return mark_popup(pg.get_by_role("dialog").last)


def open_note(W, pg, nid: str) -> str:
    goto(W, pg, f"/journal/notebook?note={nid}")
    pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=_t(30000))
    root = mark_root(pg)
    pg.wait_for_timeout(1500)
    return root


def s_note(W, pg) -> str:
    """A fresh copy of the rich note each time (a click can lock, archive or trash it)."""
    return open_note(W, pg, W.note(f"Proof rich {W.run} {time.time():.0f}", W.fx["rich_body"]))


def s_note_first_run(W, pg) -> str:
    """A new member's first note: the voice first-run hint and the Meet Compass card NOT seen."""
    return open_note(W, pg, W.fx["first_run_note"])


def _editor_end(pg) -> None:
    # the LAST block, not the editor's centre: on a phone the centre of a long note can sit
    # under the app's floating buttons, and a tap there never reaches the editor
    last = pg.locator(f"{ROOT} .ProseMirror > p").last
    press(pg, last if last.count() else pg.locator(f"{ROOT} .ProseMirror").first)
    pg.keyboard.press("Control+End")


def s_ed_slash(W, pg) -> str:
    s_note(W, pg)
    _editor_end(pg)
    pg.keyboard.press("Enter")
    pg.keyboard.type("/")
    return mark_popup(pg.get_by_role("listbox", name="Insert block"))


def s_ed_find(W, pg) -> str:
    s_note(W, pg)
    press(pg, pg.get_by_role("button", name="Find in note").filter(visible=True).first)
    return mark_popup(pg.get_by_role("search", name="Find in note").filter(visible=True).first)


def s_ed_outline(W, pg) -> str:
    s_note(W, pg)
    press(pg, pg.get_by_role("button", name="Outline").filter(visible=True).first)
    return mark_popup(pg.locator('[aria-label="Outline"]').last)


def s_ed_color(W, pg) -> str:
    s_note(W, pg)
    ed = pg.locator(f"{ROOT} .ProseMirror").first
    press(pg, ed)
    pg.keyboard.press("Control+Home")
    pg.keyboard.press("Shift+Control+ArrowRight")
    press(pg, pg.get_by_role("button", name="Text color and highlight").filter(visible=True).first)
    return mark_popup(pg.get_by_role("group", name="Text color and highlight").filter(visible=True).first)


def s_ed_table(W, pg) -> str:
    s_note(W, pg)
    press(pg, pg.locator(f"{ROOT} .ProseMirror table td").first)
    return mark_popup(pg.get_by_role("toolbar", name="Table").filter(visible=True).first)


def s_ed_emoji(W, pg) -> str:
    s_note(W, pg)
    _editor_end(pg)
    pg.keyboard.press("Enter")
    pg.keyboard.type(":rock")
    return mark_popup(pg.get_by_role("listbox", name="Insert emoji"))


def s_ed_note_link(W, pg) -> str:
    s_note(W, pg)
    _editor_end(pg)
    pg.keyboard.press("Enter")
    pg.keyboard.type("[[Pro")
    pg.wait_for_timeout(1200)
    return mark_popup(pg.get_by_role("listbox").last)


def s_ed_link_paste(W, pg) -> str:
    s_note(W, pg)
    _editor_end(pg)
    pg.evaluate("""(u) => { const el = document.querySelector('.ProseMirror');
        const dt = new DataTransfer(); dt.setData('text/plain', u);
        el.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true})); }""",
                "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    return mark_popup(pg.get_by_label("Pasted link").filter(visible=True).first)


def s_ed_writing_help(W, pg) -> str:
    s_note(W, pg)
    press(pg, pg.get_by_role("button", name="Writing help").filter(visible=True).first)
    pg.wait_for_timeout(800)
    return mark_popup(pg.locator('[role="dialog"],[role="region"],[role="menu"]').filter(
        has_text=re.compile(r"Summari[sz]e")).last)


def s_ed_history(W, pg) -> str:
    s_note(W, pg)
    press(pg, pg.get_by_role("button", name="Version history").filter(visible=True).first)
    return mark_popup(pg.get_by_role("dialog", name="Version history"))


def s_ed_palette(W, pg) -> str:
    s_note(W, pg)
    press(pg, pg.get_by_role("button", name="Insert widget").filter(visible=True).first)
    return mark_popup(pg.get_by_role("dialog", name="Insert widget"))


def s_ed_share(W, pg) -> str:
    s_note(W, pg)
    press(pg, pg.get_by_role("button", name=re.compile(r"^Share$")).filter(visible=True).first)
    return mark_popup(pg.get_by_role("dialog", name="Share this note"))


def s_ed_export(W, pg) -> str:
    s_note(W, pg)
    press(pg, pg.get_by_role("button", name=re.compile(r"^Export$")).filter(visible=True).first)
    return mark_popup(pg.get_by_role("menu", name="Export this note as"))


def s_ed_ask(W, pg) -> str:
    s_note(W, pg)
    press(pg, pg.get_by_role("button", name="Ask a question about this note").filter(visible=True).first)
    pg.get_by_test_id("ask-scope").first.wait_for(state="visible", timeout=8000)
    return mark_popup(pg.locator('[role="complementary"],[role="dialog"],[role="region"]').filter(
        has=pg.get_by_test_id("ask-scope")).last)


def s_ed_delete(W, pg) -> str:
    s_note(W, pg)
    press(pg, pg.get_by_role("button", name=re.compile(r"^Delete$")).filter(visible=True).first)
    return mark_popup(pg.get_by_role("dialog", name=re.compile("Delete this note")).filter(visible=True).first)


def s_ed_property(W, pg) -> str:
    """The inline property picker (it renders in the note, not in a popup)."""
    root = s_note(W, pg)
    press(pg, pg.get_by_role("button", name="Add property").filter(visible=True).first)
    pg.wait_for_timeout(800)
    return root


def s_research(W, pg) -> str:
    goto(W, pg, "/journal/notebook/research/NVDA")
    pg.wait_for_timeout(3000)
    try:
        return mark_root(pg, timeout=8)
    except RuntimeError:
        pg.evaluate("() => { const m = document.querySelector('main'); if (m) m.setAttribute('data-proof-root', 'notebook'); }")
        return ROOT


SETTINGS_CARDS = ("Personal API", "Email to Notebook", "Browser Capture", "Sharing & publishing")


def s_settings(W, pg) -> str:
    """Settings -> Connections: the four Notebook cards, each a TileCard region named by its title."""
    goto(W, pg, "/settings?section=connections")
    pg.wait_for_timeout(3000)
    n = pg.evaluate("""(names) => {
      for (const e of document.querySelectorAll('[data-proof-root]')) e.removeAttribute('data-proof-root');
      let n = 0;
      for (const r of document.querySelectorAll('[role="region"][aria-label]')) {
        if (names.includes(r.getAttribute('aria-label'))) { r.setAttribute('data-proof-root', 'notebook'); n++; } }
      return n; }""", list(SETTINGS_CARDS))
    if not n:
        raise RuntimeError("none of the Notebook cards rendered on /settings?section=connections")
    W.fx.setdefault("settings_cards_seen", n)
    return ROOT


def s_support(W, pg) -> str:
    goto(W, pg, "/support")
    pg.wait_for_timeout(2500)
    pg.evaluate("() => { const m = document.querySelector('main'); if (m) m.setAttribute('data-proof-root', 'notebook'); }")
    return ROOT


def s_capture_connect(W, pg) -> str:
    goto(W, pg, "/journal/capture-connect")
    pg.wait_for_timeout(2500)
    pg.evaluate("() => { const m = document.querySelector('main') || document.body; m.setAttribute('data-proof-root', 'notebook'); }")
    return ROOT


def s_share_target(W, pg) -> str:
    goto(W, pg, "/journal/share?title=Proof&text=A%20shared%20sentence&url=https%3A%2F%2Fexample.com%2Fa")
    pg.wait_for_timeout(2500)
    pg.evaluate("() => { const m = document.querySelector('main') || document.querySelector('#root') || document.body; m.setAttribute('data-proof-root', 'notebook'); }")
    return ROOT


def s_capture_dialog(W, pg) -> str:
    s_list(W, pg)
    pg.keyboard.press("Control+Shift+KeyY")
    return mark_popup(pg.get_by_role("dialog").last)


def _public(W, pg, key: str) -> str:
    url = W.fx.get(key)
    if not url:
        raise RuntimeError(f"no {key} fixture")
    pg.goto(url if url.startswith("http") else W.base + url, wait_until="domcontentloaded")
    pg.wait_for_timeout(2500)
    pg.evaluate("() => { const m = document.querySelector('main') || document.querySelector('#root') || document.body; m.setAttribute('data-proof-root', 'notebook'); }")
    return ROOT


def s_shared_page(W, pg) -> str:
    return _public(W, pg, "share_url")


def s_published_page(W, pg) -> str:
    return _public(W, pg, "publish_url")


def s_doc_preview(W, pg) -> str:
    nid = W.fx.get("pdf_note")
    if not nid:
        raise RuntimeError("no PDF note fixture")
    open_note(W, pg, nid)
    chip = pg.locator(f'{ROOT} .ProseMirror a[data-type="attachmentChip"]').first
    press(pg, chip)
    return mark_popup(pg.get_by_role("dialog", name=re.compile(r"^Preview of")).filter(visible=True).first)


class Surface:
    def __init__(self, sid, fn, *, account="seasoned", manifest=(), sweeps=("geometry", "axe", "deadclick"),
                 modes=("desk",), before_click=None, fresh_each=False, note=""):
        self.sid, self.fn, self.account, self.manifest = sid, fn, account, tuple(manifest)
        self.sweeps, self.modes, self.before_click = set(sweeps), modes, before_click
        self.fresh_each, self.note = fresh_each, note

    def open(self, W, pg):
        return self.fn(W, pg)


def _select_first_word(pg) -> None:
    pg.evaluate(r"""() => { const pm = document.querySelector('[data-proof-root] .ProseMirror'); if (!pm) return;
      const w = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if ((n.nodeValue || '').trim().length >= 4) break; }
      if (!n) return; const r = document.createRange(); r.setStart(n, 0); r.setEnd(n, Math.min(4, n.nodeValue.length));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r); }""")
    pg.wait_for_timeout(150)


ALL = ("geometry", "axe", "deadclick")
SURFACES = [
    Surface("nb-first-run", s_first_run, account="fresh", manifest=("tab-list", "NotebookTour"),
            sweeps=("geometry", "axe"), note="a new member's first visit: the tour auto-starts"),
    Surface("nb-first-run-clicks", s_first_run, account="fresh-new", sweeps=("deadclick",),
            note="the first-run screen's controls, a new member per reset (a click adds notes)"),
    Surface("nb-home", s_home, manifest=("ResearchHome",)),
    Surface("nb-list", s_list, manifest=("tab-list", "note-card-states", "folder-sidebar-edit"),
            modes=("desk", "phone")),
    Surface("nb-table", lambda W, pg: s_list(W, pg, "Table"), manifest=("tab-table",)),
    Surface("nb-board", lambda W, pg: s_list(W, pg, "Board"), manifest=("tab-board",)),
    Surface("nb-calendar", lambda W, pg: s_list(W, pg, "Calendar"), manifest=("tab-calendar",)),
    Surface("nb-timeline", lambda W, pg: s_list(W, pg, "Timeline"), manifest=("tab-timeline",)),
    Surface("nb-graph", lambda W, pg: s_list(W, pg, "Graph"), manifest=("graph-canvas",)),
    Surface("nb-tasks", s_tasks, manifest=("tasks-view",)),
    Surface("nb-search", s_search, manifest=("folder-sidebar-edit",)),
    Surface("nb-trash", s_trash, manifest=("note-card-states",)),
    Surface("nb-bulk", s_bulk, manifest=("bulk-action-bar",)),
    Surface("nb-templates", s_templates, manifest=("template-picker", "member-templates")),
    Surface("nb-import", s_import, manifest=("import-wizard",)),
    Surface("nb-saved-view", s_saved_view, manifest=("saved-view-editor",)),
    Surface("nb-publish-folder", s_publish_folder, manifest=("publish-folder-sheet",)),
    Surface("nb-note", s_note, manifest=("editor", "editor-thesis", "editor-nodes"), modes=("desk", "phone"),
            before_click=_select_first_word),
    Surface("nb-note-first-run", s_note_first_run, account="fresh", manifest=("editor",),
            sweeps=("geometry", "axe"), note="a new member's first note: the voice hint and Meet Compass unseen"),
    Surface("ed-slash", s_ed_slash, manifest=("editor-slash",)),
    Surface("ed-find", s_ed_find, manifest=("editor-find",)),
    Surface("ed-outline", s_ed_outline, manifest=("editor-outline",)),
    Surface("ed-color", s_ed_color, manifest=("editor-color",)),
    Surface("ed-table", s_ed_table, manifest=("editor-table",)),
    Surface("ed-emoji", s_ed_emoji, manifest=("editor-emoji",)),
    Surface("ed-note-link", s_ed_note_link, manifest=("editor-note-link",)),
    Surface("ed-link-paste", s_ed_link_paste, manifest=("editor-link-paste",)),
    Surface("ed-writing-help", s_ed_writing_help, manifest=("editor-writing-help",)),
    Surface("ed-history", s_ed_history, manifest=("editor-history",)),
    Surface("ed-palette", s_ed_palette, manifest=("editor-palette",)),
    Surface("ed-share", s_ed_share, manifest=("NoteShareControls",)),
    Surface("ed-export", s_ed_export, manifest=("NoteExportControls",)),
    Surface("ed-ask", s_ed_ask, manifest=("ask-panel",)),
    Surface("ed-delete", s_ed_delete, manifest=("unsent-trash",), note="the delete confirmation"),
    Surface("ed-property", s_ed_property, manifest=("editor-thesis",)),
    Surface("doc-preview", s_doc_preview, manifest=("document-preview-pdf",)),
    Surface("nb-research", s_research, manifest=("ticker-research",)),
    Surface("settings-cards", s_settings, manifest=("settings-personal-api", "settings-inbound-email",
                                                     "settings-browser-capture", "SharingCard")),
    Surface("support", s_support, manifest=("Support",), sweeps=("geometry", "axe")),
    Surface("capture-connect", s_capture_connect, manifest=("capture-connect",), sweeps=("geometry", "axe")),
    Surface("capture-dialog", s_capture_dialog, manifest=("capture-dialog",)),
    Surface("share-target", s_share_target, account="anon", manifest=("share-target-signed-out",),
            sweeps=("geometry", "axe")),
    Surface("shared-page", s_shared_page, account="anon", manifest=("SharedNotePage",), sweeps=("geometry", "axe")),
    Surface("published-page", s_published_page, account="anon", manifest=("PublishedPage",),
            sweeps=("geometry", "axe")),
]


def wanted(surf: Surface, only: list[str]) -> bool:
    return not only or any(surf.sid.startswith(o) for o in only)


# ── seeding ─────────────────────────────────────────────────────────────────

def seed(W: World) -> None:
    """The seasoned member's library, through the product's doors: the sample notebook (the
    first-run screen's own "Add a sample notebook"), one rich note carrying every editor node
    this walk's popups need, a PDF attachment, a share link and a published page."""
    ctx = W.provision("seasoned", "Proof Seasoned")
    W.states["seasoned"] = ctx.storage_state()
    api = ctx.request
    r = api.post(W.base + "/api/j2/onboarding/sample-notebook")
    W.fx["sample_status"] = r.status
    folders = api.get(W.base + "/api/j2/note-folders").json()
    flat = folders.get("folders") if isinstance(folders, dict) else folders
    W.fx["folder"] = next((f.get("name") for f in (flat or []) if f.get("name")), "Sample notebook")
    today = time.strftime("%Y-%m-%d")
    rich = DOC(
        H_(1, "Proof heading one"), P("Base forming under the prior high with volume drying up."),
        H_(2, "Setup table"),
        {"type": "table", "content": [
            {"type": "tableRow", "content": [
                {"type": "tableHeader", "content": [P("Ticker")]}, {"type": "tableHeader", "content": [P("Entry")]}]},
            {"type": "tableRow", "content": [
                {"type": "tableCell", "content": [P("NVDA")]}, {"type": "tableCell", "content": [P("121")]}]}]},
        {"type": "codeBlock", "attrs": {"language": "python"}, "content": [{"type": "text", "text": "risk = entry - stop"}]},
        {"type": "blockMath", "attrs": {"latex": "R = \\frac{target - entry}{entry - stop}"}},
        {"type": "callout", "content": [P("A callout for the style picker.")]},
        {"type": "taskList", "content": [{"type": "taskItem", "attrs": {"checked": False}, "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "Review the base "},
                                              {"type": "dateMention", "attrs": {"date": today}}]}]}]},
        H_(3, "Closing notes"), P("Proof closing paragraph with a few more words to select."))
    W.fx["rich_body"] = rich
    W.fx["rich_note"] = W.note(f"Proof rich base {W.run}", rich)
    for i in range(3):
        W.note(f"Proof ledger {i} {W.run}", DOC(P(f"Ledger entry {i} about the base and the stop.")),
               tags=["proof/nested", "review"])
    # a share link and a published page (the stranger surfaces)
    sid = W.note(f"Proof public {W.run}", DOC(P("Public words for the stranger pages.")))
    s = api.post(W.base + f"/api/j2/notes/{sid}/share", data={})
    body = s.json() if s.ok else {}
    share = (body or {}).get("share") or {}
    W.fx["share_url"] = share.get("url") or (f"/share/n/{share['token']}" if share.get("token") else None)
    p = api.post(W.base + f"/api/j2/publish/notes/{sid}", data={})
    pb = p.json() if p.ok else {}
    pub = pb.get("publication") or pb.get("published") or pb
    W.fx["publish_url"] = (pub or {}).get("url") or ((f"/p/{pub['slug']}") if (pub or {}).get("slug") else None)
    W.fx["share_status"], W.fx["publish_status"] = s.status, p.status
    W.fx["share_raw_keys"] = sorted((share or {}).keys())
    W.fx["publish_raw_keys"] = sorted((pub or {}).keys()) if isinstance(pub, dict) else None
    # the returning member: dismiss the voice hint and the Meet Compass card through their own
    # buttons once, in this context, and carry that browser state to every seasoned context.
    pg = ctx.new_page()
    goto(W, pg, f"/journal/notebook?note={W.fx['rich_note']}")
    pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
    pg.wait_for_timeout(1500)
    for name in ("Dismiss tip", "Got it"):
        b = pg.get_by_role("button", name=name, exact=True)
        if b.count():
            try:
                b.first.click(timeout=4000)
            except Exception:  # noqa: BLE001
                pass
    # a PDF attachment for the document preview (through the editor's own upload door)
    pdf = W.art / f"proof-{W.run}.pdf"
    pdf.write_bytes(_pdf_bytes("Proof guidance document text"))
    pid = W.note(f"Proof PDF {W.run}", DOC(P("PDF note.")))
    goto(W, pg, f"/journal/notebook?note={pid}")
    pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
    pg.locator(".ProseMirror").first.click()
    pg.keyboard.press("Control+End")
    try:
        pg.locator('input[aria-label="Upload file attachment"]').first.set_input_files(str(pdf))
        pg.locator('.ProseMirror a[data-type="attachmentChip"]').first.wait_for(state="visible", timeout=25000)
        pg.wait_for_timeout(2500)
        W.fx["pdf_note"] = pid
    except Exception as e:  # noqa: BLE001
        W.fx["pdf_error"] = f"{type(e).__name__}: {e}"[:200]
    pg.close()
    W.states["seasoned"] = ctx.storage_state()
    W.drop_contexts("seasoned")      # every later seasoned context carries the dismissals
    ctx.close()
    # the first-run member (read-only surfaces) and its one note for nb-note-first-run
    fr = W.fresh_account()
    W.fx["first_run_account"] = fr
    W.fx["first_run_note"] = W.note(f"Proof first note {W.run}", DOC(P("My first note.")), account=fr)
    W.states["fresh"] = W.states[fr]    # nb-note-first-run opens THIS member's note; tour needs 0 notes
    W.fx["fresh_list_account"] = "fresh-list"
    lctx = W.provision("fresh-list", "Proof Fresh List")
    W.states["fresh-list"] = lctx.storage_state()
    lctx.close()


def _pdf_bytes(text: str) -> bytes:
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"]
    stream = ("BT /F1 18 Tf 72 700 Td (%s) Tj ET" % text).encode("latin-1")
    objs.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = b"%PDF-1.4\n"
    offs = []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n" % (len(objs) + 1) + b"0000000000 65535 f \n" + b"".join(b"%010d 00000 n \n" % o for o in offs)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n" % (len(objs) + 1, xref) + b"%%EOF\n"
    return out


def account_for(W: World, surf: Surface) -> str:
    if surf.account == "fresh-new":
        return W.fresh_account()
    if surf.account == "fresh" and surf.sid == "nb-first-run":
        return "fresh-list"       # a member with NO note: the first-run screen and the tour
    return surf.account


def open_surface(W: World, surf: Surface, mode: str):
    acct = account_for(W, surf)
    pg, tap = W.page(acct, mode)
    root = surf.open(W, pg)
    return pg, tap, root, acct


# ── shared page mechanics ───────────────────────────────────────────────────

def idle_noise(W: World, pg, tap: Tap, ms: int = 1500) -> dict:
    """The page's own motion with nobody touching it: every element that changed and every
    endpoint requested in `ms` becomes NOISE, never counted as a click's effect."""
    m = pg.evaluate(MARK_JS)["mark"]
    n0 = len(tap.reqs)
    pg.wait_for_timeout(ms)
    added = pg.evaluate(NOISE_JS, m)
    for r in tap.reqs[n0:]:
        W.noise_endpoints.add(normalize_endpoint(r["url"]))
    return added


def shot(W: World, pg, name: str) -> str:
    p = W.art / f"{W.run}-{re.sub(r'[^A-Za-z0-9_.-]+', '_', name)[:80]}.png"
    try:
        pg.screenshot(path=str(p))
        return p.name
    except Exception as e:  # noqa: BLE001
        return f"screenshot failed: {e}"[:120]


def surface_by_id(sid: str) -> Surface:
    return next(s for s in SURFACES if s.sid == sid)


# ── geometry ─────────────────────────────────────────────────────────────────

GEO_MODES = ("phone", "tablet", "desktop")


def _slim(reading: dict) -> dict:
    r = dict(reading)
    r["controls"] = [c for c in reading.get("controls", []) if c.get("inViewport") or c.get("offscreenInScroller")]
    return r


def _geo_read(pg) -> list[dict]:
    """Two readings: the top of the surface, then one page further down its main scroller."""
    out = [pg.evaluate(GEOM_JS)]
    moved = pg.evaluate("""() => { const m = document.querySelector('main'); let s = 0;
        if (m && m.scrollHeight > m.clientHeight + 10) { m.scrollTop += Math.round(m.clientHeight * 0.8); s = m.scrollTop; }
        else if (document.scrollingElement.scrollHeight > innerHeight + 10) { window.scrollBy(0, Math.round(innerHeight * 0.8)); s = scrollY; }
        return s; }""")
    if moved:
        pg.wait_for_timeout(500)
        out.append(pg.evaluate(GEOM_JS))
    return out


def _merge_findings(readings: list[dict], width: int) -> tuple[list, list]:
    seen, findings, reach = set(), [], []
    for rd in readings:
        j = judge_geometry(rd, width=width)
        for f in j["findings"]:
            k = (f["kind"], f.get("control") or f.get("what"), f.get("area"))
            if k not in seen:
                seen.add(k)
                findings.append(f)
        reach += [x for x in j["reachable_in_scroller"] if x not in reach]
    return findings, reach


def geometry_sweep(W: World, only: list[str]) -> dict:
    out = {"modes": {m: VIEWPORTS[m] for m in GEO_MODES}, "cells": [], "controls": {}}
    # CONTROL: the three plants on the list, at every width, against the same page unplanted.
    got = {"plant-wide": "found", "plant-small": "found", "plant-covered": "found"}
    ctl_rows = []
    for mode in GEO_MODES:
        w = VIEWPORTS[mode]["width"]
        pg, tap, root, acct = open_surface(W, surface_by_id("nb-list"), mode)
        try:
            r0 = pg.evaluate(GEOM_JS)
            before, _ = _merge_findings([r0], w)
            pg.evaluate(PLANT_GEOMETRY_JS, root)
            pg.wait_for_timeout(400)
            r1 = pg.evaluate(GEOM_JS)
            after, _ = _merge_findings([r1], w)
            pg.evaluate(UNPLANT_JS, "geometry")
        finally:
            pg.close()
        keys_before = {(f["kind"], f.get("control") or f.get("what")) for f in before}
        new = [f for f in after if (f["kind"], f.get("control") or f.get("what")) not in keys_before]

        def widest(r):
            return max([r.get("docScrollW", 0)] + [p.get("scrollW", 0) for p in r.get("pageScrollers", [])])
        grew = widest(r1) - widest(r0)
        wide = any(f["kind"] in ("overflow", "cutoff") for f in new) or grew >= 400 or any(
            "plant-wide" in json.dumps(f.get("widened_by", [])) for f in after)
        small = any(f["kind"] == "tap" and f.get("control") == "Planted small control" for f in new)
        covered = any(f["kind"] == "occluded" and f.get("control") == "Planted covered control" for f in new)
        want_small = w <= TOUCH_MAX_WIDTH
        ctl_rows.append({"mode": mode, "width": w, "wide_found": wide, "page_grew_px": grew, "small_found": small,
                         "small_expected": want_small, "covered_found": covered, "new_findings": new})
        if not wide:
            got["plant-wide"] = f"missed at {w}"
        if small != want_small:
            got["plant-small"] = f"{'missed' if want_small else 'wrongly flagged'} at {w}"
        if not covered:
            got["plant-covered"] = f"missed at {w}"
    ok, why = control_ok("geometry", got)
    out["controls"] = {"got": got, "ok": ok, "why": why, "rows": ctl_rows}
    say(f"[{'VALID' if ok else 'INVALID'}] geometry control: {why}")
    dump("geometry", out)
    for surf in SURFACES:
        if "geometry" not in surf.sweeps or not wanted(surf, only):
            continue
        for mode in GEO_MODES:
            w = VIEWPORTS[mode]["width"]
            cell = {"surface": surf.sid, "mode": mode, "width": w, "manifest": list(surf.manifest)}
            try:
                pg, tap, root, acct = open_surface(W, surf, mode)
            except Exception as e:  # noqa: BLE001
                cell.update(status="UNREACHED", reason=f"{type(e).__name__}: {e}"[:300])
                out["cells"].append(cell)
                say(f"[UNREACHED] geometry {surf.sid} @{w}: {cell['reason'][:120]}")
                continue
            try:
                pg.wait_for_timeout(800)
                top_shot = shot(W, pg, f"geo-{surf.sid}-{w}-top")
                readings = _geo_read(pg)
                findings, reach = _merge_findings(readings, w)
                cell.update(status="MEASURED", findings=findings, reachable_in_scroller=reach,
                            readings=[_slim(r) for r in readings],
                            screenshots=[top_shot, shot(W, pg, f"geo-{surf.sid}-{w}-scrolled")])
                say(f"[{'FINDINGS' if findings else 'CLEAN'}] geometry {surf.sid} @{w}: "
                    + "; ".join(f"{f['kind']}:{(f.get('control') or f.get('what') or '')[:40]}" for f in findings[:6]))
            except Exception as e:  # noqa: BLE001
                cell.update(status="ERROR", reason=f"{type(e).__name__}: {e}"[:300])
            finally:
                try:
                    pg.close()
                except Exception:  # noqa: BLE001
                    pass
            out["cells"].append(cell)
        dump("geometry", out)
    return out


# ── axe ──────────────────────────────────────────────────────────────────────

AXE_RUN_JS = r"""async (args) => {
  const [root, tags] = args;
  const ctx = (root && document.querySelector(root)) ? {include: [[root]]} : document;
  const r = await axe.run(ctx, {runOnly: {type: 'tag', values: tags}, resultTypes: ['violations', 'incomplete']});
  return {version: axe.version, scoped: ctx !== document,
          violations: r.violations.map(v => ({id: v.id, impact: v.impact, help: v.help, count: v.nodes.length,
            nodes: v.nodes.slice(0, 10).map(n => ({target: n.target, html: (n.html || '').slice(0, 220),
                                                    summary: (n.failureSummary || '').slice(0, 300)}))})),
          incomplete: r.incomplete.map(v => ({id: v.id, count: v.nodes.length}))};
}"""


def _axe(pg, root: str, axe_src: str) -> dict:
    if not pg.evaluate("() => typeof window.axe !== 'undefined'"):
        pg.add_script_tag(content=axe_src)
    return pg.evaluate(AXE_RUN_JS, [root, AXE_TAGS])


def axe_sweep(W: World, only: list[str], axe_src: str) -> dict:
    out = {"tags": AXE_TAGS, "themes": list(THEMES), "runs": [], "controls": {}}
    ctl = {"color-contrast": "found", "button-name": "found"}
    ctl_rows = []
    anon_done = set()
    for theme in THEMES:
        W.fx["theme"] = theme
        statuses = {a: W.set_theme(a, theme) for a in ("seasoned", "fresh", "fresh-list")}
        # CONTROL, per theme: the plants on the list page must be reported.
        pg, tap, root, acct = open_surface(W, surface_by_id("nb-list"), "desk")
        try:
            applied = pg.evaluate("() => document.documentElement.dataset.theme")
            pg.evaluate(PLANT_AXE_JS, root)
            r = _axe(pg, root, axe_src)
            pg.evaluate(UNPLANT_JS, "axe")
        finally:
            pg.close()
        ids = {v["id"]: v for v in r["violations"]}
        cc = any("#proof-plant-contrast" in json.dumps(n["target"]) for n in (ids.get("color-contrast") or {}).get("nodes", []))
        bn = any("#proof-plant-noname" in json.dumps(n["target"]) for n in (ids.get("button-name") or {}).get("nodes", []))
        ctl_rows.append({"theme": theme, "applied": applied, "pref_status": statuses, "contrast_found": cc,
                         "button_name_found": bn})
        if not cc:
            ctl["color-contrast"] = f"missed in {theme}"
        if not bn:
            ctl["button-name"] = f"missed in {theme}"
        for surf in SURFACES:
            if "axe" not in surf.sweeps or not wanted(surf, only):
                continue
            if surf.account == "anon":
                if surf.sid in anon_done:
                    continue
                anon_done.add(surf.sid)
            run = {"surface": surf.sid, "theme": theme if surf.account != "anon" else "signed-out default",
                   "manifest": list(surf.manifest)}
            try:
                pg, tap, root, acct = open_surface(W, surf, "desk")
            except Exception as e:  # noqa: BLE001
                run.update(status="UNREACHED", reason=f"{type(e).__name__}: {e}"[:300])
                out["runs"].append(run)
                say(f"[UNREACHED] axe {surf.sid} ({theme}): {run['reason'][:120]}")
                continue
            try:
                run["theme_applied"] = pg.evaluate("() => document.documentElement.dataset.theme")
                pg.wait_for_timeout(500)
                r = _axe(pg, root, axe_src)
                j = judge_axe(r)
                run.update(status="MEASURED", root=root, **j, axe=r)
                say(f"[{j['verdict']}] axe {surf.sid} ({theme}->{run['theme_applied']}): {j['rules']}")
            except Exception as e:  # noqa: BLE001
                run.update(status="ERROR", reason=f"{type(e).__name__}: {e}"[:300])
            finally:
                try:
                    pg.close()
                except Exception:  # noqa: BLE001
                    pass
            out["runs"].append(run)
            dump("axe", out)
    ok, why = control_ok("axe", ctl)
    out["controls"] = {"got": ctl, "ok": ok, "why": why, "rows": ctl_rows}
    say(f"[{'VALID' if ok else 'INVALID'}] axe control: {why}")
    W.fx["theme"] = None
    for a in ("seasoned", "fresh", "fresh-list"):
        W.set_theme(a, "dark")
    dump("axe", out)
    return out


# ── dead clicks ──────────────────────────────────────────────────────────────

def click_one(W: World, pg, tap: Tap, root: str, c: dict, surf: Surface, mode: str) -> dict:
    if surf.before_click:
        try:
            surf.before_click(pg)
        except Exception:  # noqa: BLE001
            pass
    if not pg.evaluate(TARGET_JS, [root, c["key"], c["nth"]]):
        return {"verdict": "NOT-FOUND", "reset": False}
    loc = pg.locator("[data-proof-target]").first
    touch = VIEWPORTS.get(mode, {}).get("touch", False)
    if c.get("field"):
        # a field is judged by focus arriving IN it: start from nothing focused
        pg.evaluate("() => { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); }")
    url0 = pg.url
    origin0 = pg.evaluate("() => performance.timeOrigin")
    hover_from = pg.evaluate(MARK_JS)["mark"]
    if not touch:
        try:
            loc.hover(timeout=2500)
        except Exception:  # noqa: BLE001
            pass
    pg.wait_for_timeout(450)
    m = pg.evaluate(MARK_JS)
    fs0 = pg.evaluate(FORMSTATE_JS, root)
    n0, ev0 = len(tap.reqs), dict(tap.events)
    try:
        if touch:
            loc.tap(timeout=3500)
        else:
            loc.click(timeout=3500)
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        inter = next((ln.strip() for ln in msg.splitlines() if "intercepts pointer events" in ln), "")
        return {"verdict": "OCCLUDED" if inter else "NOT-ACTIONABLE",
                "reason": (inter or msg.splitlines()[0])[:240], "reset": True}
    pg.wait_for_timeout(1200)
    reloaded = False
    try:
        reloaded = pg.evaluate("() => performance.timeOrigin") != origin0
        if reloaded:
            raise RuntimeError("document reloaded")
        eff = pg.evaluate(EFFECT_JS, [hover_from, m["mark"]])
        fs1 = pg.evaluate(FORMSTATE_JS, root)
    except Exception as e:  # noqa: BLE001 -- a full navigation replaced the document
        eff = {"dom": 0, "expanded": 0, "focus_moved": False, "printed": m["printed"], "clip": m["clip"],
               "samples": [f"no in-page reading: {type(e).__name__}"]}
        fs1 = fs0
        reloaded = True
    reqs = tap.reqs[n0:]
    obs = {"dom": eff.get("dom", 0), "expanded": eff.get("expanded", 0), "focus_moved": eff.get("focus_moved"),
           "requests": reqs, "noise_endpoints": sorted(W.noise_endpoints), "url_before": url0,
           "url_after": pg.url, "state_changed": fs0 != fs1, "reloaded": reloaded,
           "print": eff.get("printed", 0) - m["printed"], "clipboard": eff.get("clip", 0) - m["clip"],
           **{k: tap.events[k] - ev0[k] for k in tap.events}}
    verdict, effects = judge_click(obs)
    if verdict == "DEAD" and c.get("current"):
        # the option already chosen (a selected tab, the current folder, the pressed view of a
        # group) clicked again: a no-op by design, recorded as such and never hidden
        verdict = "CURRENT-NO-OP"
    mutating = [r for r in reqs if r["method"] not in ("GET", "HEAD", "OPTIONS") and not is_telemetry(r["url"])]
    reset = bool(mutating) or reloaded or pg.url != url0 or tap.events["popup"] > ev0["popup"]
    for p in tap.popups:
        try:
            p.close()
        except Exception:  # noqa: BLE001
            pass
    tap.popups.clear()
    if not reset:
        try:
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(200)
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(300)
            if not pg.locator(root).count():
                reset = True
        except Exception:  # noqa: BLE001
            reset = True
    return {"verdict": verdict, "effects": effects, "dom_samples": eff.get("samples", [])[:4],
            "requests": [f"{r['method']} {normalize_endpoint(r['url'])}" for r in reqs][:6],
            "noise_ignored": eff.get("noiseIgnored"), "self_ignored": eff.get("selfIgnored"),
            "focus_after": eff.get("focus_after"), "url_after": pg.url if pg.url != url0 else None,
            "mutating": [f"{r['method']} {normalize_endpoint(r['url'])}" for r in mutating][:4], "reset": reset}


def _prefs(W: World, acct: str) -> dict:
    try:
        return dict(W.api(acct).get(W.base + "/api/auth/me").json().get("preferences") or {})
    except Exception:  # noqa: BLE001
        return {}


def _restore_prefs(W: World, acct: str, snap: dict) -> list[str]:
    """Put the member's preferences back through their own door (a click can collapse a panel
    or switch a view, and a preference outlives the page). Returns the keys it rewrote."""
    now = _prefs(W, acct)
    fixed = []
    for k in sorted(set(now) | set(snap)):
        if now.get(k) != snap.get(k):
            W.api(acct).post(W.base + "/api/auth/preferences", data={"key": k, "value": snap.get(k, "")})
            fixed.append(k)
    return fixed


LS_JS = "() => { try { return JSON.stringify(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)])); } catch (e) { return ''; } }"


def deadclick_surface(W: World, surf: Surface, mode: str, *, plant: bool = False) -> dict:
    """Every enabled control of one surface, each clicked from the SAME starting state.

    ⛔ State is the trap: a click can collapse the folder panel, switch the view or change a
    preference, and every later control would then be measured on a different page (the
    shake-out read 16 sidebar controls "covered" after one "Hide folders panel"). So after a
    click the surface is reopened from scratch -- a NEW browser context from the member's
    stored state (pristine localStorage) and the member's server preferences put back -- when
    the click wrote anything, navigated, changed the page's control set, or changed local
    storage. Otherwise the same page is reused (Escape pressed twice)."""
    rec = {"surface": surf.sid, "mode": mode, "manifest": list(surf.manifest), "controls": [], "resets": 0,
           "prefs_restored": []}
    holder = {"ctx": None, "acct": None}
    snap = {}

    def fresh():
        if holder["ctx"] is not None:
            try:
                holder["ctx"].close()
            except Exception:  # noqa: BLE001
                pass
        acct = account_for(W, surf)
        if holder["acct"] == acct and snap.get("prefs") is not None:
            rec["prefs_restored"] += _restore_prefs(W, acct, snap["prefs"])
        holder["acct"] = acct
        if "prefs" not in snap:
            snap["prefs"] = _prefs(W, acct) if acct != "anon" else {}
        ctx = W.new_context(acct, mode)
        holder["ctx"] = ctx
        pg = ctx.new_page()
        tap = Tap(pg)
        root = surf.open(W, pg)
        if plant:
            pg.evaluate(PLANT_DEADCLICK_JS, root)
        rec.setdefault("noise", []).append(idle_noise(W, pg, tap))
        keys = sorted({c["key"] for c in (pg.evaluate(CONTROLS_JS, root) or [])})
        return pg, tap, root, keys, pg.evaluate(LS_JS)

    try:
        pg, tap, root, keys0, ls0 = fresh()
    except Exception as e:  # noqa: BLE001
        rec.update(status="UNREACHED", reason=f"{type(e).__name__}: {e}"[:300])
        if holder["ctx"] is not None:
            holder["ctx"].close()
        return rec
    listing = pg.evaluate(CONTROLS_JS, root) or []
    if plant:
        listing = [c for c in listing if c["name"].startswith("Planted")]
    rec["enumerated"] = len(listing)
    rec["capped"] = max(0, len(listing) - MAX_CONTROLS)
    for c in listing[:MAX_CONTROLS]:
        row = {k: c[k] for k in ("key", "nth", "tag", "role", "name", "field", "box")}
        if c["disabled"]:
            row["verdict"] = "DISABLED"
            rec["controls"].append(row)
            continue
        if SESSION_ENDING.search(c["name"]):
            row.update(verdict="SKIPPED", reason="ends the session")
            rec["controls"].append(row)
            continue
        if c["tag"] == "A" and c["href"].startswith("#") and re.match(r"(?i)skip\b", c["name"]):
            row.update(verdict="SKIPPED", reason="a skip link: its door is the keyboard (shown on focus)")
            rec["controls"].append(row)
            continue
        try:
            r = click_one(W, pg, tap, root, c, surf, mode)
        except Exception as e:  # noqa: BLE001
            r = {"verdict": "ERROR", "reason": f"{type(e).__name__}: {e}"[:240], "reset": True}
        if not r.get("reset"):
            try:
                keys1 = sorted({x["key"] for x in (pg.evaluate(CONTROLS_JS, root) or [])})
                if keys1 != keys0 or pg.evaluate(LS_JS) != ls0:
                    r["reset"] = True
                    r["state_left_changed"] = True
            except Exception:  # noqa: BLE001
                r["reset"] = True
        row.update({k: v for k, v in r.items() if k != "reset"})
        rec["controls"].append(row)
        if r.get("reset"):
            rec["resets"] += 1
            try:
                pg, tap, root, keys0, ls0 = fresh()
            except Exception as e:  # noqa: BLE001
                rec["aborted"] = f"could not reopen the surface: {type(e).__name__}: {e}"[:300]
                break
    if holder["acct"] and holder["acct"] != "anon" and not holder["acct"].startswith("fresh"):
        rec["prefs_restored"] += _restore_prefs(W, holder["acct"], snap.get("prefs", {}))
    try:
        holder["ctx"].close()
    except Exception:  # noqa: BLE001
        pass
    rec["status"] = "MEASURED"
    counts = {}
    for r in rec["controls"]:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    rec["counts"] = counts
    return rec


def deadclick_sweep(W: World, only: list[str]) -> dict:
    out = {"telemetry_never_evidence": list(TELEMETRY_PATHS), "surfaces": [], "controls": {}}
    ctl = deadclick_surface(W, surface_by_id("nb-list"), "desk", plant=True)
    names = {"Planted dead styled control": "plant-dead-styled", "Planted dead control": "plant-dead",
             "Planted live control": "plant-live"}
    got = {}
    for r in ctl["controls"]:
        for label, cid in names.items():
            if r["name"].startswith(label) and cid not in got:
                got[cid] = r["verdict"]
                break
    ok, why = control_ok("deadclick", got)
    out["controls"] = {"got": got, "ok": ok, "why": why, "raw": ctl}
    say(f"[{'VALID' if ok else 'INVALID'}] deadclick control: {why}")
    dump("deadclick", out)
    for surf in SURFACES:
        if "deadclick" not in surf.sweeps or not wanted(surf, only):
            continue
        for mode in surf.modes:
            rec = deadclick_surface(W, surf, mode)
            out["surfaces"].append(rec)
            say(f"[{rec.get('status')}] deadclick {surf.sid} ({mode}): {rec.get('counts') or rec.get('reason', '')}")
            dump("deadclick", out)
    out["noise_endpoints"] = sorted(W.noise_endpoints)
    dump("deadclick", out)
    return out


# ── silent failures ──────────────────────────────────────────────────────────

RAW_MARK = "zqproofraw"
# The endpoints this lane judges: the Notebook's own API and the Journal shell it renders in.
# App-wide reads (watchlists, alerts, voice, market packs...) are listed, never forced here.
NOTEBOOK_API = re.compile(r"^/api/j2/(note|notes|notebook|saved-views|property-defs|onboarding|share|shared|publish|"
                          r"published|personal|inbound-email|templates|member-templates|documents|excerpts|research|"
                          r"ask|writing|capture|accounts|telemetry)")
SILENT_READ_SURFACES = ("nb-list", "nb-home", "nb-note", "nb-tasks", "nb-graph", "nb-research",
                        "nb-templates", "ed-history", "ed-share", "settings-cards", "shared-page")


def _act_click(name, exact=True):
    def act(W, pg):
        press(pg, pg.get_by_role("button", name=name, exact=exact).first)
    return act


def _act_type(W, pg):
    _editor_end(pg)
    pg.keyboard.type(" proof words typed", delay=20)


def _act_tag(W, pg):
    box = pg.get_by_label("Add a tag to this note").first
    press(pg, box)
    box.fill("prooftag")
    box.press("Enter")


def _act_new_folder(W, pg):
    press(pg, pg.get_by_role("button", name="+ New folder").first)
    inp = pg.get_by_label("New folder name")
    inp.fill(f"Proof folder {time.time():.0f}")
    inp.press("Enter")


def _act_confirm_delete(W, pg):
    press(pg, pg.locator(POPUP).get_by_role("button", name=re.compile(r"^(Delete|Move to Trash)", re.I)).last)


def _act_create_link(W, pg):
    press(pg, pg.locator(POPUP).get_by_role("button", name="Create link").first)


WRITE_ACTIONS = (
    ("save-body", "nb-note", _act_type),
    ("add-tag", "nb-note", _act_tag),
    ("favorite", "nb-note", _act_click("Add to Favorites")),
    ("lock", "nb-note", _act_click("Lock")),
    ("archive", "nb-note", _act_click("Archive")),
    ("save-template", "nb-note", _act_click("Save as template")),
    ("share-link", "ed-share", _act_create_link),
    ("trash-note", "ed-delete", _act_confirm_delete),
    ("new-folder", "nb-list", _act_new_folder),
    ("new-note", "nb-list", _act_click("+ New note")),
    ("daily-note", "nb-list", _act_click("Today")),
)


def _forced(W: World, surf: Surface, ep: str, kind: str, methods: tuple, baselines: list, act=None,
            wait_ms: int = 3500) -> dict:
    acct = account_for(W, surf)
    pg, tap = W.page(acct, "desk")
    hits = []

    def handler(route):
        req = route.request
        if normalize_endpoint(req.url) == ep and req.method in methods:
            hits.append(req.method)
            if kind == "500":
                route.fulfill(status=500, content_type="application/json",
                              body=json.dumps({"detail": f"{RAW_MARK} forced failure"}))
            else:
                route.abort("internetdisconnected")
        else:
            route.continue_()

    pg.route("**/api/**", handler)
    row = {"endpoint": ep, "kind": kind, "methods": list(methods)}
    PATIENCE["f"] = 0.35 if act is None else 1.0
    try:
        surf.open(W, pg)
    except Exception as e:  # noqa: BLE001
        row["open_error"] = f"{type(e).__name__}: {e}"[:200]
    finally:
        PATIENCE["f"] = 1.0
    if act is not None and "open_error" not in row:
        try:
            act(W, pg)
        except Exception as e:  # noqa: BLE001
            row["act_error"] = f"{type(e).__name__}: {e}"[:200]
    pg.wait_for_timeout(wait_ms)
    txt = _texts(pg)
    j = judge_failure(baselines, txt["lines"], txt["alerts"])
    row.update(hits=len(hits), url=pg.url.replace(W.base, ""), **j,
               raw_detail_shown=any(RAW_MARK in s for s in txt["lines"] + txt["alerts"]),
               screenshot=shot(W, pg, f"silent-{surf.sid}-{kind}-{ep}"))
    if not hits:
        row["verdict"] = "NOT-TRIGGERED"
    try:
        pg.close()
    except Exception:  # noqa: BLE001
        pass
    return row


def _texts(pg) -> dict:
    try:
        return pg.evaluate(TEXT_JS)
    except Exception:  # noqa: BLE001
        return {"lines": [], "alerts": []}


def silent_sweep(W: World, only: list[str]) -> dict:
    out = {"forced": {"500": "HTTP 500 with a JSON detail carrying the marker " + RAW_MARK,
                      "offline": "route.abort('internetdisconnected') for that endpoint only"},
           "reads": [], "writes": [], "controls": {}}
    # CONTROL: the two planted consumers, under both failure kinds.
    got = {}
    rows = []
    for kind in ("500", "offline"):
        pg, tap, root, acct = open_surface(W, surface_by_id("nb-list"), "desk")

        def plant_handler(route, kind=kind):
            if kind == "500":
                route.fulfill(status=500, content_type="application/json", body='{"detail": "x"}')
            else:
                route.abort("internetdisconnected")

        pg.route("**/api/proof-plant/**", plant_handler)
        pg.evaluate(PLANT_SILENT_JS)
        pg.wait_for_timeout(400)
        base = _texts(pg)
        for which in ("swallow", "honest"):
            pg.locator(f"#proof-plant-{which}").click()
            pg.wait_for_timeout(1500)
            now = _texts(pg)
            j = judge_failure([base["lines"]], now["lines"], now["alerts"])
            got[f"plant-{which}:{kind}"] = j["verdict"]
            rows.append({"plant": which, "kind": kind, **j})
            base = now
        pg.close()
    ok, why = control_ok("silent", got)
    out["controls"] = {"got": got, "ok": ok, "why": why, "rows": rows}
    say(f"[{'VALID' if ok else 'INVALID'}] silent control: {why}")
    dump("silent", out)
    tested = set()
    for sid in SILENT_READ_SURFACES:
        surf = surface_by_id(sid)
        if not wanted(surf, only):
            continue
        baselines, endpoints = [], {}
        for _ in range(2):
            try:
                pg, tap, root, acct = open_surface(W, surf, "desk")
                pg.wait_for_timeout(2500)
                baselines.append(_texts(pg)["lines"])
                for r in tap.reqs:
                    path = urlsplit(r["url"]).path
                    if r["method"] == "GET" and path.startswith("/api/") and not is_telemetry(r["url"]):
                        endpoints.setdefault(normalize_endpoint(r["url"]), path)
                pg.close()
            except Exception as e:  # noqa: BLE001
                out["reads"].append({"surface": sid, "status": "UNREACHED", "reason": f"{type(e).__name__}: {e}"[:200]})
                break
        if len(baselines) < 2:
            continue
        for ep in endpoints:
            if ep in tested:
                continue
            tested.add(ep)
            if not NOTEBOOK_API.match(ep) or is_telemetry(ep):
                out.setdefault("app_wide_not_forced", []).append({"surface": sid, "endpoint": ep})
                continue
            for kind in ("500", "offline"):
                row = _forced(W, surf, ep, kind, ("GET",), baselines)
                row["surface"] = sid
                out["reads"].append(row)
                say(f"[{row['verdict']}] silent read {sid} {kind} {ep}: {(row.get('sentences') or [''])[0][:80]}")
            dump("silent", out)
    for name, sid, act in WRITE_ACTIONS:
        surf = surface_by_id(sid)
        if only and not any(name.startswith(o) or sid.startswith(o) for o in only):
            continue
        try:
            pg, tap, root, acct = open_surface(W, surf, "desk")
            pg.wait_for_timeout(1200)
            before = _texts(pg)["lines"]
            n0 = len(tap.reqs)
            act(W, pg)
            pg.wait_for_timeout(4000)
            after = _texts(pg)["lines"]
            writes = [r for r in tap.reqs[n0:] if r["method"] not in ("GET", "HEAD", "OPTIONS")
                      and urlsplit(r["url"]).path.startswith("/api/") and not is_telemetry(r["url"])]
            pg.close()
        except Exception as e:  # noqa: BLE001
            out["writes"].append({"action": name, "status": "UNREACHED", "reason": f"{type(e).__name__}: {e}"[:200]})
            say(f"[UNREACHED] silent write {name}: {e}"[:160])
            continue
        eps = []
        for r in writes:
            k = (r["method"], normalize_endpoint(r["url"]))
            if k not in eps:
                eps.append(k)
        if not eps:
            out["writes"].append({"action": name, "status": "NO-WRITE", "note": "the action sent no write request"})
            continue
        for method, ep in eps:
            for kind in ("500", "offline"):
                row = _forced(W, surf, ep, kind, (method,), [before, after], act=act, wait_ms=6000)
                row.update(action=name, surface=sid)
                out["writes"].append(row)
                say(f"[{row['verdict']}] silent write {name} {kind} {method} {ep}: {(row.get('sentences') or [''])[0][:80]}")
            dump("silent", out)
    dump("silent", out)
    return out


# ── the path census ──────────────────────────────────────────────────────────
#
# Every shipped §B1 feature (docs/notebook/parity-scorecard.md §B1, one ledger row each)
# through each DOOR a member has: desktop (a mouse at 1280), touch (a finger at 390) and
# keyboard (1280, no pointer at all: the control is REACHED with Tab and pressed with
# Enter/Space). A cell's verdict is decided by what rendered, never by a call returning.

DOORS = ("desktop", "touch", "keyboard")
DOOR_MODE = {"desktop": "desk", "touch": "phone", "keyboard": "desk"}
KB_MAX_TABS = 220


class NoDoor(Exception):
    pass


class Broken(Exception):
    pass


class NotDriven(Exception):
    pass


KB_REACHED_JS = "(e) => !!e && (e === document.activeElement || e.contains(document.activeElement))"


def kb_reach(pg, loc, max_tabs: int = KB_MAX_TABS) -> int:
    """Press Tab until `loc` holds focus; the number of presses. NoDoor when it never does.
    The locator is RE-RESOLVED after every press: a control React remounts on each render
    (the editor toolbar's buttons) leaves a stale element handle that never matches focus --
    the shake-out read "Attach a file" as not reachable although Tab x73 reached it."""
    if not loc.count():
        raise NoDoor("the control is not in the page")
    for i in range(1, max_tabs + 1):
        pg.keyboard.press("Tab")
        try:
            if loc.count() and loc.evaluate(KB_REACHED_JS, timeout=2000):
                return i
        except Exception:  # noqa: BLE001 -- detached between resolve and evaluate: not yet
            pass
    raise NoDoor(f"not reached with Tab in {max_tabs} presses")


CENSUS_STATE = {"door_used": False}


class StepMissing(Exception):
    """A LATER control of the flow was not found once the door had been used: the instrument's
    step, never a verdict about the door (the shake-out read the callout picker as NO-DOOR
    because the probe looked for the wrong role on the SECOND control)."""


def use(pg, door: str, loc, key: str = "Enter") -> str:
    """Activate `loc` through `door`. NoDoor if the FIRST control of a flow is absent or
    unreachable that way; StepMissing if a later one is (see CENSUS_STATE)."""
    try:
        how = _use(pg, door, loc, key)
    except NoDoor as e:
        if CENSUS_STATE["door_used"]:
            raise StepMissing(str(e))
        raise
    CENSUS_STATE["door_used"] = True
    return how


ATTACH_WAIT_MS = 6000   # a control rendered after a fetch (the Share sheet's "Loading...") is waited FOR


def _use(pg, door: str, loc, key: str = "Enter") -> str:
    try:
        loc.wait_for(state="attached", timeout=ATTACH_WAIT_MS)
    except Exception:  # noqa: BLE001 -- the waiter's timeout IS the answer: not there
        raise NoDoor(f"no such control on this page (waited {ATTACH_WAIT_MS} ms)")
    if door == "keyboard":
        n = kb_reach(pg, loc)
        pg.keyboard.press(key)
        return f"Tab x{n} + {key}"
    try:
        loc.wait_for(state="visible", timeout=5000)
    except Exception:  # noqa: BLE001
        raise NoDoor("the control exists but is not visible")
    if door == "touch":
        loc.tap(timeout=6000)
        return "tap"
    loc.click(timeout=6000)
    return "click"


def btn(pg, name, exact=True, scope=None):
    return (scope or pg).get_by_role("button", name=name, exact=exact).filter(visible=True).first


def c_open(W, door: str, path: str, acct: str = "seasoned"):
    pg, tap = W.page(acct, DOOR_MODE[door])
    goto(W, pg, path)
    return pg


def c_note(W, door: str, body=None, title=None, acct: str = "seasoned") -> tuple:
    nid = W.note(title or f"Census {door} {time.time():.0f}", body or DOC(P("Census starting paragraph text.")),
                 account=acct)
    pg, tap = W.page(acct, DOOR_MODE[door])
    goto(W, pg, f"/journal/notebook?note={nid}")
    pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
    mark_root(pg)
    pg.wait_for_timeout(1200)
    return pg, nid


def focus_editor(pg, door: str) -> str:
    """Put the caret at the end of the note (not a feature's door: it never sets door_used)."""
    ed = pg.locator(f"{ROOT} .ProseMirror").first
    if door == "keyboard":
        n = kb_reach(pg, ed)
        pg.keyboard.press("Control+End")
        return f"editor reached with Tab x{n}"
    last = pg.locator(f"{ROOT} .ProseMirror > p").last
    tgt = last if last.count() else ed
    if door == "touch":
        tgt.tap(timeout=6000)
    else:
        tgt.click(timeout=6000)
    pg.keyboard.press("Control+End")
    return "editor " + ("tapped" if door == "touch" else "clicked")


def ed_html(pg) -> str:
    return pg.locator(f"{ROOT} .ProseMirror").first.inner_html()


def slash_insert(pg, door: str, name: str) -> str:
    how = focus_editor(pg, door)
    pg.keyboard.press("Enter")
    pg.keyboard.type("/")
    lb = pg.get_by_role("listbox", name="Insert block")
    lb.wait_for(state="visible", timeout=6000)
    pg.keyboard.type(name[:6])
    opt = lb.get_by_role("option", name=re.compile("^" + re.escape(name), re.I)).filter(visible=True).first
    opt.wait_for(state="visible", timeout=6000)
    if door == "keyboard":
        for _ in range(12):
            if opt.get_attribute("aria-selected") == "true":
                break
            pg.keyboard.press("ArrowDown")
        pg.keyboard.press("Enter")
        return how + f"; '/{name[:6]}' + Enter"
    use(pg, door, opt)
    return how + f"; '/{name[:6]}' + {door} on the option"


def must(cond, what: str) -> None:
    if not cond:
        raise Broken(what)


PUMP = {"pg": None}   # the newest page this walk opened: a wait pumps Playwright's events through it


def _pump(seconds: float) -> None:
    pg = PUMP.get("pg")
    try:
        if pg is not None and not pg.is_closed():
            pg.wait_for_timeout(seconds * 1000)
            return
    except Exception:  # noqa: BLE001 -- a page closing under the wait falls back to a sleep
        pass
    time.sleep(seconds)


def wait_true(fn, timeout: float = 8.0, every: float = 0.3):
    """Poll `fn` until it is truthy. The wait PUMPS Playwright's event loop: a bare
    time.sleep blocks the sync API's dispatcher, so a value fed by an EVENT (pg.url after a
    pushState, a download or file-chooser counter) cannot change while we sleep -- the
    shake-out read Today and Export BROKEN on exactly that."""
    end = time.time() + timeout
    v = fn()
    while not v and time.time() < end:
        _pump(every)
        v = fn()
    return v


# ── one function per feature; each returns a detail sentence or raises ─────

def f_slash(name: str, sel: str, extra=None):
    def f(W, door):
        pg, nid = c_note(W, door)
        before = pg.locator(f"{ROOT} .ProseMirror {sel}").count()
        how = slash_insert(pg, door, name)
        pg.wait_for_timeout(700)
        if extra:
            how += "; " + extra(pg, door)
        n = wait_true(lambda: pg.locator(f"{ROOT} .ProseMirror {sel}").count() > before, 6)
        must(n, f"no {sel} after /{name}")
        return how
    return f


def _callout_style(pg, door):
    b = pg.get_by_role("button", name=re.compile(r"^Callout style")).filter(visible=True).first
    how = use(pg, door, b)
    grp = pg.get_by_role("group", name="Callout style").filter(visible=True).first
    grp.wait_for(state="visible", timeout=5000)
    opt = grp.locator('button[aria-pressed="false"]').first
    if door == "keyboard":
        # the picker focuses its current option; arrows move within it (calloutNode.js)
        pg.keyboard.press("ArrowDown")
        pg.keyboard.press("Enter")
        return how + "; ArrowDown + Enter in the picker"
    return how + "; " + use(pg, door, opt)


def f_callout(W, door):
    pg, nid = c_note(W, door)
    how = slash_insert(pg, door, "Callout")
    pg.wait_for_timeout(600)
    before = pg.evaluate("() => { const c = document.querySelector('[data-proof-root] .ProseMirror [data-callout], [data-proof-root] .ProseMirror [data-type=\"callout\"], [data-proof-root] .ProseMirror aside'); return c ? c.outerHTML.slice(0, 300) : null; }")
    must(before, "no callout after /Callout")
    how += "; " + _callout_style(pg, door)
    pg.wait_for_timeout(600)
    after = pg.evaluate("() => { const c = document.querySelector('[data-proof-root] .ProseMirror [data-callout], [data-proof-root] .ProseMirror [data-type=\"callout\"], [data-proof-root] .ProseMirror aside'); return c ? c.outerHTML.slice(0, 300) : null; }")
    must(after and after != before, "the callout's style did not change")
    return how


def f_text_color(W, door):
    pg, nid = c_note(W, door)
    how = focus_editor(pg, door)
    pg.keyboard.press("Control+Home")
    pg.keyboard.press("Shift+Control+ArrowRight")
    pg.wait_for_timeout(300)   # the editor reads a native selection change asynchronously (see f_block_move)
    b = btn(pg, "Text color and highlight")
    how += "; " + use(pg, door, b)
    grp = pg.get_by_role("group", name="Text color and highlight").filter(visible=True).first
    grp.wait_for(state="visible", timeout=5000)
    sw = grp.locator("button").nth(1)
    if door == "keyboard":
        n = kb_reach(pg, sw, max_tabs=30)
        pg.keyboard.press("Enter")
        how += f"; swatch Tab x{n} + Enter"
    else:
        use(pg, door, sw)
        how += "; swatch"
    pg.wait_for_timeout(700)
    html = ed_html(pg)
    must(re.search(r'style="[^"]*color|data-color|data-text-color|class="[^"]*(color|highlight)', html),
         "no colour mark in the note")
    return how


def f_table_rows(W, door):
    pg, nid = c_note(W, door)
    how = slash_insert(pg, door, "Table")
    pg.wait_for_timeout(800)
    rows0 = pg.locator(f"{ROOT} .ProseMirror table tr").count()
    must(rows0, "no table after /Table")
    if door == "keyboard":
        # the table keymap: Tab walks the cells and adds a row after the last one
        for _ in range(rows0 * 3 + 3):
            pg.keyboard.press("Tab")
        how += "; Tab past the last cell"
    else:
        cell = pg.locator(f"{ROOT} .ProseMirror table td, {ROOT} .ProseMirror table th").first
        use(pg, door, cell)
        bar = pg.get_by_role("toolbar", name="Table").filter(visible=True).first
        bar.wait_for(state="visible", timeout=5000)
        how += "; " + use(pg, door, btn(pg, "Add a row below", scope=bar))
    pg.wait_for_timeout(600)
    rows1 = pg.locator(f"{ROOT} .ProseMirror table tr").count()
    must(rows1 > rows0, f"rows {rows0} -> {rows1}")
    return how + f"; rows {rows0} -> {rows1}"


def f_block_move(W, door):
    pg, nid = c_note(W, door, body=DOC(P("Alpha block first."), P("Beta block second.")))
    first = lambda: pg.locator(f"{ROOT} .ProseMirror p").first.inner_text()  # noqa: E731
    if door == "keyboard":
        how = focus_editor(pg, door)
        # Ctrl+End lands in the editor's trailing empty paragraph (moving THAT proves nothing):
        # go to the top and one block down, into "Beta", and say so before moving it
        pg.keyboard.press("Control+Home")
        pg.keyboard.press("ArrowDown")
        # the editor learns a native caret move from the ASYNC selectionchange event: a
        # shortcut sent within milliseconds acts on the OLD selection (measured: the same key
        # sequence moved the block in some trials and not others). A member's cadence is not 5 ms.
        pg.wait_for_timeout(300)
        at = pg.evaluate("() => { const n = getSelection().anchorNode; return n ? (n.textContent || '') : '' }")
        if "Beta" not in at:
            raise StepMissing(f"the caret is in {at[:30]!r}, not the second block")
        pg.keyboard.press("Alt+Shift+ArrowUp")
        how += "; caret in the second block; Alt+Shift+ArrowUp"
    else:
        para = pg.locator(f"{ROOT} .ProseMirror p").nth(1)
        if door == "desktop":
            para.hover()
        else:
            para.tap()
        grip = pg.get_by_role("button", name="Move this block").filter(visible=True).first
        how = use(pg, door, grip)
        up = pg.get_by_role("menuitem", name=re.compile(r"^Move up")).filter(visible=True).first
        if not up.count():
            up = pg.get_by_role("button", name=re.compile(r"^Move up")).filter(visible=True).first
        how += "; " + use(pg, door, up)
    pg.wait_for_timeout(700)
    got = first()
    must(got.startswith("Beta"), f"first block is {got[:30]!r}")
    return how


def f_outline(W, door):
    pg, nid = c_note(W, door, body=DOC(H_(2, "Outline heading census"), P("Body.")))
    how = use(pg, door, btn(pg, "Outline"))
    pnl = pg.locator('[aria-label="Outline"]').last
    ok = wait_true(lambda: pnl.count() and "Outline heading census" in (pnl.inner_text() or ""), 5)
    must(ok, "the outline did not list the heading")
    return how


def f_word_count(W, door):
    pg, nid = c_note(W, door)
    t = pg.get_by_text(re.compile(r"\b\d[\d,]* words?\b")).filter(visible=True).first
    ok = t.count() and t.is_visible()
    if not ok:
        raise NoDoor("no word count visible")
    return "shown on the note page"


def f_find_replace(W, door):
    pg, nid = c_note(W, door, body=DOC(P("alpha beta alpha gamma")))
    if door == "keyboard":
        focus_editor(pg, door)
        pg.keyboard.press("Control+h")
        how = "Ctrl+H"
    else:
        how = use(pg, door, btn(pg, "Find in note"))
        how += "; " + use(pg, door, pg.get_by_role("button", name=re.compile(r"^Show replace")).filter(visible=True).first)
    find = pg.locator('input[aria-label="Find in note"]').first
    find.wait_for(state="visible", timeout=5000)
    find.fill("alpha")
    rep = pg.get_by_label("Replace with").filter(visible=True).first
    rep.fill("delta")
    ra = pg.get_by_role("button", name=re.compile(r"^Replace all")).filter(visible=True).first
    if door == "keyboard":
        n = kb_reach(pg, ra, max_tabs=15)
        pg.keyboard.press("Enter")
        how += f"; Replace all Tab x{n} + Enter"
    else:
        how += "; " + use(pg, door, ra)
    pg.wait_for_timeout(600)
    txt = ed_html(pg)
    must("delta" in txt and "alpha" not in txt, "Replace all did not replace")
    return how


def f_typed(trigger: str, sel: str, pick: str | None = None):
    def f(W, door):
        pg, nid = c_note(W, door)
        how = focus_editor(pg, door)
        pg.keyboard.type(" " + trigger)
        pg.wait_for_timeout(700)
        if pick:
            lb = pg.get_by_role("listbox", name=pick).filter(visible=True).first
            lb.wait_for(state="visible", timeout=5000)
            opt = lb.get_by_role("option").filter(visible=True).first
            if door == "keyboard":
                pg.keyboard.press("Enter")
            else:
                use(pg, door, opt)
        else:
            pg.keyboard.type(" ")
        pg.wait_for_timeout(700)
        html = ed_html(pg)
        must(re.search(sel, html), f"typed {trigger!r}: nothing matched {sel!r}")
        return how + f"; typed {trigger!r}"
    return f


def f_web_embed(W, door):
    pg, nid = c_note(W, door)
    how = focus_editor(pg, door)
    pg.evaluate("""(u) => { const el = document.querySelector('[data-proof-root] .ProseMirror');
        const dt = new DataTransfer(); dt.setData('text/plain', u);
        el.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true})); }""",
                "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    menu = pg.get_by_label("Pasted link").filter(visible=True).first
    menu.wait_for(state="visible", timeout=6000)
    emb = menu.get_by_role("button", name="Embed", exact=True).filter(visible=True).first
    how += "; paste (a dispatched ClipboardEvent: an ENGINE test of the paste path)"
    how += "; " + use(pg, door, emb)
    pg.wait_for_timeout(1500)
    html = ed_html(pg)
    # the node itself, never the pasted URL's text (which says "youtube" whatever happened)
    must(re.search(r'data-type="web-embed"|<iframe', html), "no embed node after choosing Embed")
    return how


def f_touch_undo(W, door):
    if door == "desktop":
        raise NotDriven("N/A by design: the Undo/Redo control is the touch tier's (hidden at >= 1025 px, where Ctrl+Z is the door)")
    pg, nid = c_note(W, door, body=DOC(P("Start.")))
    how = focus_editor(pg, door)
    pg.keyboard.type(" one", delay=40)
    pg.wait_for_timeout(800)
    if door == "keyboard":
        pg.keyboard.press("Control+z")
        how += "; Ctrl+Z"
    else:
        how += "; " + use(pg, door, btn(pg, "Undo"))
    pg.wait_for_timeout(600)
    t = pg.locator(f"{ROOT} .ProseMirror").first.inner_text().strip()
    must(t == "Start.", f"after undo the note reads {t!r}")
    return how


def f_switcher(W, door):
    title = f"Switcher target {W.run}"
    nid = W.fx.get("switch_target") or W.note(title, DOC(P("switch me")))
    W.fx["switch_target"] = nid
    pg = c_open(W, door, "/journal/notebook")
    mark_root(pg)
    pg.wait_for_timeout(1000)
    if door == "keyboard":
        pg.keyboard.press("Control+k")
        how = "Ctrl+K"
    else:
        b = pg.get_by_role("button", name=re.compile(r"^Search", re.I)).filter(visible=True).first
        how = use(pg, door, b)
    dlg = pg.get_by_role("dialog", name="Command palette")
    dlg.wait_for(state="visible", timeout=6000)
    inp = dlg.get_by_role("combobox").first if dlg.get_by_role("combobox").count() else dlg.locator("input").filter(visible=True).first
    inp.fill(title)
    opt = dlg.get_by_role("option", name=re.compile(re.escape(title))).filter(visible=True).first
    opt.wait_for(state="visible", timeout=8000)
    if door == "keyboard":
        for _ in range(12):
            if opt.get_attribute("aria-selected") == "true":
                break
            pg.keyboard.press("ArrowDown")
        pg.keyboard.press("Enter")
    else:
        use(pg, door, opt)
    ok = wait_true(lambda: nid in pg.evaluate("() => location.search"), 8)
    must(ok, "the switcher did not open the note")
    return how + "; typed the title; option chosen"


def _list(W, door):
    pg = c_open(W, door, "/journal/notebook?view=all")
    mark_root(pg)
    pg.wait_for_timeout(1500)
    return pg


def f_bulk(W, door):
    pg = _list(W, door)
    boxes = pg.locator(f'{ROOT} input[type="checkbox"][aria-label^="Select "]')
    if not boxes.count():
        raise NoDoor("no select boxes on the list")
    how = use(pg, door, boxes.nth(0), key="Space")
    how += "; " + use(pg, door, boxes.nth(1), key="Space")
    pg.wait_for_timeout(700)
    bar = pg.get_by_role("group", name="Actions for the selected notes").filter(visible=True).first
    checked = pg.locator(f'{ROOT} input[type="checkbox"][aria-label^="Select "]:checked').count()
    ok = bar.count() > 0 and checked == 2
    must(ok, f"bulk bar present {bar.count() > 0}, {checked} boxes checked")
    return how + "; two selected, the bulk bar shows"


def f_nested_tags(W, door):
    pg = _list(W, door)
    how = use(pg, door, btn(pg, "Expand tag proof"))
    ok = wait_true(lambda: pg.get_by_role("button", name=re.compile(r"(Tag )?nested", re.I)).count() > 0
                   or pg.get_by_text(re.compile(r"#?nested")).count() > 0, 4)
    must(ok, "no child tag under #proof")
    return how


def f_view(name: str, sel: str):
    def f(W, door):
        pg = _list(W, door)
        how = use(pg, door, btn(pg, f"{name} view"))
        ok = wait_true(lambda: pg.locator(sel).count() > 0, 8)
        must(ok, f"{name} view rendered nothing matching {sel}")
        return how
    return f


def f_unlinked(W, door):
    t = f"Mention target {W.run}"
    tid = W.fx.get("mention_target")
    if not tid:
        tid = W.note(t, DOC(P("The target.")))
        W.note(f"Mentions it {W.run}", DOC(P(f"I keep returning to {t} today.")))
        W.fx["mention_target"] = tid
    pg, tap = W.page("seasoned", DOOR_MODE[door])
    goto(W, pg, f"/journal/notebook?note={tid}")
    pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
    mark_root(pg)
    sec = pg.get_by_role("button", name=re.compile(r"^Unlinked mentions \(\d+\)")).filter(visible=True).first
    sec.wait_for(state="attached", timeout=12000)
    how = use(pg, door, sec)
    ok = wait_true(lambda: pg.get_by_text(f"Mentions it {W.run}").count() > 0, 5)
    must(ok, "the mention did not list")
    return how


def f_note_btn(name: str, check):
    def f(W, door):
        pg, nid = c_note(W, door)
        how = use(pg, door, btn(pg, name))
        pg.wait_for_timeout(1200)
        ok, why = check(W, pg, nid)
        must(ok, why)
        return how
    return f


def _archived(W, pg, nid):
    ids = [n.get("id") for n in (W.api().get(W.base + "/api/j2/notes?limit=200").json().get("notes") or [])]
    return nid not in ids, "the archived note is still in the default list"


def _locked(W, pg, nid):
    v = pg.locator(f"{ROOT} .ProseMirror").first.get_attribute("contenteditable")
    return v == "false", f"contenteditable={v}"


def f_split(W, door):
    if door == "touch":
        raise NotDriven("N/A by design: split view is desktop only (two panes need >= 1025 px)")
    other = W.fx.get("split_other") or W.note(f"Split other {W.run}", DOC(P("the other pane")))
    W.fx["split_other"] = other
    pg, nid = c_note(W, door)
    how = use(pg, door, pg.get_by_role("button", name=re.compile(r"Open a note beside", re.I)).filter(visible=True).first)
    inp = pg.get_by_label("Find a note to open beside")
    inp.wait_for(state="visible", timeout=5000)
    inp.fill(f"Split other {W.run}")
    res_btn = pg.get_by_role("list", name="Notes to open beside").get_by_role(
        "button", name=re.compile(re.escape(f"Split other {W.run}"))).first
    res_btn.wait_for(state="visible", timeout=8000)
    if door == "keyboard":
        n = kb_reach(pg, res_btn, max_tabs=10)
        pg.keyboard.press("Enter")
        how += f"; result Tab x{n} + Enter"
    else:
        use(pg, door, res_btn)
    ok = wait_true(lambda: pg.locator(".ProseMirror").count() >= 2, 8)
    must(ok, "the second editor did not mount")
    return how


def f_today(W, door):
    pg = _list(W, door)
    how = use(pg, door, btn(pg, "Today"))
    ok = wait_true(lambda: "note=" in pg.evaluate("() => location.search"), 10)
    must(ok, "Today did not open a note")
    return how


def f_save_template(W, door):
    pg, nid = c_note(W, door, title=f"Tmpl {door} {W.run}")
    how = use(pg, door, btn(pg, "Save as template"))
    pg.wait_for_timeout(1500)
    txt = pg.locator("body").inner_text()
    must(re.search(r"template", txt, re.I), "no word about the template")
    return how


def f_relation(W, door):
    tgt = f"Relation target {door} {W.run}"
    W.note(tgt, DOC(P("target")))
    pg, nid = c_note(W, door)
    how = use(pg, door, btn(pg, "Add property"))
    how += "; " + use(pg, door, pg.get_by_role("button", name=re.compile("New property")).filter(visible=True).first)
    pg.get_by_placeholder("Property name").fill(f"Rel {door}")
    sel = pg.locator("select").filter(has=pg.locator('option[value="relation"]')).first
    sel.select_option("relation")
    how += "; " + use(pg, door, btn(pg, "Create"))
    how += "; " + use(pg, door, btn(pg, "Link a note"))
    pg.get_by_label("Find a note to link").fill(tgt)
    r = pg.get_by_role("list", name="Notes to link").get_by_role("button", name=re.compile(re.escape(tgt))).filter(visible=True).first
    r.wait_for(state="visible", timeout=8000)
    if door == "keyboard":
        n = kb_reach(pg, r, max_tabs=10)
        pg.keyboard.press("Enter")
    else:
        use(pg, door, r)
    ok = wait_true(lambda: pg.get_by_role("button", name=re.compile(re.escape(tgt))).count() > 0, 6)
    must(ok, "no relation chip for the target")
    return how


def f_scan(W, door):
    if door != "touch":
        raise NotDriven("N/A by design: the Scan button is the touch tier's (a camera door)")
    pg, nid = c_note(W, door)
    b = btn(pg, "Scan a document with the camera")
    fc = {"n": 0}
    pg.on("filechooser", lambda f: fc.__setitem__("n", fc["n"] + 1))
    how = use(pg, door, b)
    pg.wait_for_timeout(1000)
    if fc["n"]:
        raise NotDriven(how + "; the camera/file chooser opened (no camera in the sandbox: the scan itself is not driven)")
    raise Broken("the Scan control opened no chooser")


def f_attach_docx(W, door):
    pg, nid = c_note(W, door)
    path = W.art / f"census-{door}.docx"
    path.write_bytes(_docx_bytes(f"Census docx word zqcensus{door}"))
    fc = {}
    pg.on("filechooser", lambda f: fc.setdefault("fc", f))
    b = pg.get_by_role("button", name="Attach a file").filter(visible=True).first
    how = focus_editor(pg, door) if door != "keyboard" else ""
    how += "; " + use(pg, door, b)
    pg.wait_for_timeout(800)
    if "fc" not in fc and door == "keyboard":
        pg.keyboard.press("Space")          # a button answers Space as well as Enter
        pg.wait_for_timeout(800)
        how += "; Space"
        if "fc" not in fc:
            raise Broken(how.strip("; ") + ": Attach a file holds focus, and neither Enter nor Space opened the file chooser")
    if "fc" not in fc:
        raise Broken("Attach a file opened no chooser")
    fc["fc"].set_files(str(path))
    ok = wait_true(lambda: pg.locator(f'{ROOT} .ProseMirror a[data-type="attachmentChip"]').count() > 0, 20)
    docs = wait_true(lambda: [d for d in (W.api().get(W.base + f"/api/j2/notes/{nid}/documents").json().get("documents") or [])
                              if d.get("status") not in ("pending", None)], 40)
    must(ok, "no attachment chip")
    must(docs, "the .docx never became a document")
    return how + f"; document status {docs[0].get('status')}"


def _settings_card(W, door, card, action_re, check_re):
    pg = c_open(W, door, "/settings?section=connections")
    pg.wait_for_timeout(2500)
    region = pg.locator(f'[role="region"][aria-label="{card}"]').first
    if not region.count():
        raise NoDoor(f"no {card!r} card on Settings -> Connections")
    before = region.inner_text()
    b = region.get_by_role("button", name=re.compile(action_re, re.I)).filter(visible=True).first
    how = use(pg, door, b)
    ok = wait_true(lambda: re.search(check_re, region.inner_text(), re.I) is not None and region.inner_text() != before, 8)
    must(ok, f"the {card} card showed nothing matching /{check_re}/ after /{action_re}/")
    return how


def f_personal_api(W, door):
    return _settings_card(W, door, "Personal API", r"(create|new|generate|make)", r"(token|copy|revoke)")


def f_email_in(W, door):
    pg = c_open(W, door, "/settings?section=connections")
    region = pg.locator('[role="region"][aria-label="Email to Notebook"]').first
    try:
        region.wait_for(state="visible", timeout=10000)
    except Exception:  # noqa: BLE001
        raise NoDoor("no 'Email to Notebook' card on Settings -> Connections")
    addr = region.get_by_label("Your Notebook email address")
    before = addr.input_value() if addr.count() else ""
    if not before:
        how = use(pg, door, btn(pg, "Create my address", scope=region))
    else:
        # the member already has one: the door is making a NEW one (two steps, a confirmation)
        how = use(pg, door, btn(pg, "Make a new address\u2026", scope=region))
        grp = region.get_by_role("group", name="Make a new address")
        how += "; " + use(pg, door, btn(pg, "Make a new address", scope=grp))
    ok = wait_true(lambda: addr.count() > 0 and "@" in addr.input_value() and addr.input_value() != before, 10)
    must(ok, "no new address in the Email to Notebook card")
    return how + ("; a new address replaced the old one" if before else "; the address shows")


def f_dictation(W, door):
    pg, nid = c_note(W, door)
    b = pg.get_by_role("button", name=re.compile(r"voice input", re.I)).filter(visible=True).first
    if not b.count():
        raise NoDoor("no voice input control")
    if door == "keyboard":
        n = kb_reach(pg, b)
        raise NotDriven(f"the mic is reachable (Tab x{n}); dictation needs a microphone the sandbox browser has not got")
    vis = b.is_visible()
    if not vis:
        raise NoDoor("the voice input control is not visible")
    raise NotDriven("the mic control is present; dictation needs a microphone the sandbox browser has not got")


def f_writing_help(W, door):
    pg, nid = c_note(W, door, body=DOC(P("A sentence to rewrite for the census.")))
    how = use(pg, door, btn(pg, "Writing help"))
    ok = wait_true(lambda: re.search(r"Summari[sz]e", pg.locator("body").inner_text()) is not None, 5)
    must(ok, "the writing-help panel did not open")
    raise NotDriven(how + "; the panel and its actions render -- no model key, so no output is observed")


def f_ask(W, door):
    pg, nid = c_note(W, door)
    how = use(pg, door, btn(pg, "Ask a question about this note"))
    ok = wait_true(lambda: pg.get_by_test_id("ask-scope").count() > 0, 6)
    must(ok, "the Ask panel did not open")
    raise NotDriven(how + "; the Ask panel opens with its scope -- no model key, so no answer (or insert) is observed")


def f_share(W, door):
    pg, nid = c_note(W, door)
    how = use(pg, door, pg.get_by_role("button", name=re.compile(r"^Share$")).filter(visible=True).first)
    sheet = pg.get_by_role("dialog", name="Share this note")
    sheet.wait_for(state="visible", timeout=6000)
    how += "; " + use(pg, door, btn(pg, "Create link", scope=sheet))
    ok = wait_true(lambda: sheet.get_by_label("Share link address").count() > 0, 8)
    must(ok, "no share address")
    return how


def f_publish(W, door):
    pg, nid = c_note(W, door)
    how = use(pg, door, pg.get_by_role("button", name=re.compile(r"^Share$")).filter(visible=True).first)
    sheet = pg.get_by_role("dialog", name="Share this note")
    sheet.wait_for(state="visible", timeout=6000)
    how += "; " + use(pg, door, btn(pg, "Publish this note", scope=sheet))
    ok = wait_true(lambda: sheet.get_by_label("Published page address").count() > 0, 8)
    must(ok, "no published address")
    return how


def f_export(W, door):
    pg, nid = c_note(W, door)
    dl = {"n": 0}
    pg.on("download", lambda d: dl.__setitem__("n", dl["n"] + 1))
    how = use(pg, door, pg.get_by_role("button", name=re.compile(r"^Export$")).filter(visible=True).first)
    menu = pg.get_by_role("menu", name="Export this note as")
    menu.wait_for(state="visible", timeout=5000)
    item = menu.get_by_role("menuitem").filter(visible=True).first
    if door == "keyboard":
        if not item.evaluate("e => e === document.activeElement"):
            pg.keyboard.press("ArrowDown")
        pg.keyboard.press("Enter")
        how += "; menu item Enter"
    else:
        how += "; " + use(pg, door, item)
    ok = wait_true(lambda: dl["n"] > 0, 12)
    must(ok, "no download")
    return how


def f_first_run(W, door):
    acct = W.fresh_account()
    pg, tap = W.page(acct, DOOR_MODE[door])
    goto(W, pg, "/journal/notebook")
    mark_root(pg)
    pg.get_by_text("Welcome to your Notebook").filter(visible=True).first.wait_for(state="visible", timeout=15000)
    tour = pg.get_by_role("dialog", name=re.compile("Welcome to your Notebook")).filter(visible=True).first
    tour_seen = tour.count() > 0
    skip = pg.get_by_role("button", name="Skip tour").filter(visible=True).first
    if skip.count():
        use(pg, door, skip)
        pg.wait_for_timeout(600)
    how = use(pg, door, btn(pg, "Add a sample notebook"))
    ok = wait_true(lambda: len(W.api(acct).get(W.base + "/api/j2/notes?limit=50").json().get("notes") or []) >= 5, 12)
    must(ok, "the sample notebook's notes did not arrive")
    return f"tour shown: {tour_seen}; Skip tour; " + how


def f_help(W, door):
    pg = c_open(W, door, "/support")
    pg.wait_for_timeout(2500)
    link = pg.get_by_role("button", name=re.compile(r"notebook", re.I)).filter(visible=True).first
    if not link.count():
        link = pg.get_by_role("link", name=re.compile(r"notebook", re.I)).filter(visible=True).first
    how = use(pg, door, link)
    pg.wait_for_timeout(1200)
    txt = pg.locator("body").inner_text()
    must(len(re.findall(r"[Nn]otebook", txt)) > 3, "no Notebook article text")
    return how


def f_share_target(W, door):
    if door != "touch":
        raise NotDriven("N/A by design: the share target is the phone's share sheet (Android PWA); iOS rides Shortcuts over the personal API (a device run, S-2)")
    mark = f"zqshare{W.run}"
    pg, tap = W.page("seasoned", "phone")
    goto(W, pg, f"/journal/share?title=Census%20shared%20{mark}&text=Census%20shared%20{mark}"
                "&url=https%3A%2F%2Fexample.com%2Fcensus")
    dlg = pg.get_by_role("dialog", name="Capture").filter(visible=True).first
    try:
        dlg.wait_for(state="visible", timeout=15000)
    except Exception:  # noqa: BLE001
        raise NoDoor("the share target opened no Capture sheet")
    pick = dlg.get_by_test_id("capture-destination-picker")
    nid, how = None, ""
    if pick.count():
        opts = pick.locator("option")
        if not wait_true(lambda: opts.count() > 1, 8):
            raise StepMissing("the destination picker listed no note")
        nid = opts.nth(1).get_attribute("value")
        pick.select_option(nid)
        how = "destination chosen; "
    how += use(pg, door, btn(pg, "Save", scope=dlg))
    if nid:
        # a capture becomes a DOCUMENT of the note (POST /api/j2/capture -> web_capture_store), not
        # text in its body: the marker rides in the source title and the passage
        ok = wait_true(lambda: mark in json.dumps(W.api().get(W.base + f"/api/j2/notes/{nid}/documents").json()), 12)
        said = dlg.get_by_role("status").filter(visible=True)
        said = said.first.inner_text() if said.count() else ""
        must(ok, f"the shared source is not among the chosen note's documents (the sheet said {said[:60]!r})")
        return how + f"; the source is a document of the chosen note; the sheet said {said[:60]!r}"
    pg.wait_for_timeout(2500)
    must(re.search(r"saved|added|in your notebook", pg.locator("body").inner_text(), re.I),
         "no confirmation after saving the share")
    return how


def f_folder_publish(W, door):
    pg = _list(W, door)
    name = W.fx.get("folder", "Sample notebook")
    if door == "desktop":
        pg.get_by_role("button", name=re.compile(re.escape(name))).filter(visible=True).first.hover()
    how = use(pg, door, btn(pg, f"Publish {name}"))
    ok = wait_true(lambda: pg.get_by_role("dialog").filter(has_text=re.compile("Publish folder")).count() > 0, 6)
    must(ok, "the folder's publish sheet did not open")
    return how


def f_templates_picker(W, door):
    pg = _list(W, door)
    how = use(pg, door, btn(pg, "Templates"))
    card = pg.get_by_role("button", name="Long/Short Thesis").filter(visible=True).first
    card.wait_for(state="visible", timeout=8000)
    how += "; " + use(pg, door, card)
    ok = wait_true(lambda: pg.locator(".ProseMirror h1, .ProseMirror h2").count() > 0, 12)
    must(ok, "the template made no headings")
    return how


def f_graph_kb(W, door):
    pg = _list(W, door)
    how = use(pg, door, btn(pg, "Graph view"))
    ok = wait_true(lambda: pg.locator('canvas[aria-label^="Note graph"]').count() > 0, 12)
    lst = pg.get_by_role("button", name=re.compile(r"show as list", re.I)).count()
    must(ok, "no graph canvas")
    return how + f"; list mode control present: {bool(lst)}"


def _na(reason):
    def f(W, door):
        raise NotDriven(reason)
    f.na = True
    return f


# (ledger row, feature, probe). A probe raising NotDriven("N/A by design: ...") is N/A.
CENSUS = [
    ("G-129", "Syntax highlighting (code block)", f_slash("Code block", "pre")),
    ("G-130", "Math, inline + block", f_slash("Math block", '[data-type="blockMath"], .katex, [data-latex]')),
    ("G-131", "Text colour + highlight", f_text_color),
    ("G-132", "Callout icon and colour picker", f_callout),
    ("G-133", "Image captions + alignment", _na("NOT DRIVEN here: needs an image upload per door; its caption/align controls were walked by 9B B26 (desktop)")),
    ("G-134", "Table UI (rows/columns/header)", f_table_rows),
    ("G-135", "Drag handles and block reordering", f_block_move),
    ("G-136", "Table of contents / outline", f_outline),
    ("G-137", "Word count + reading time", f_word_count),
    ("G-138", "Find and replace", f_find_replace),
    ("G-139", "Emoji picker", f_typed(":rock", "🚀", pick="Insert emoji")),
    ("G-140", "@date mentions", f_typed("@tomorrow", r"data-date")),
    ("G-141", "Web embeds + link bookmarks", f_web_embed),
    ("G-142", "Multi-column layout", f_slash("2 columns", '[data-type="columns"], [class*="olumns"]')),
    ("G-143", "Heading levels H4-H6", f_slash("Heading 4", "h4")),
    ("G-144", "Undo/redo control on touch", f_touch_undo),
    ("G-145", "Quick switcher over all notes", f_switcher),
    ("G-146", "Bulk operations", f_bulk),
    ("G-147", "Nested tags", f_nested_tags),
    ("G-148", "Unlinked mentions", f_unlinked),
    ("G-149", "Timeline view", f_view("Timeline", '[role="group"][aria-label="Zoom"]')),
    ("G-150", "Archive state", f_note_btn("Archive", _archived)),
    ("G-151", "Note lock (read-only)", f_note_btn("Lock", _locked)),
    ("G-152", "Split view", f_split),
    ("G-153", "Reminders with notifications", _na("NOT DRIVEN: a 07:00 ET server pass rings the bell; no member door to drive (G-153 is recorded unobserved in the ledger)")),
    ("G-154", "Tasks view across notes", f_view("Tasks", '[role="group"][aria-label="Show tasks"]')),
    ("G-155", "Member-made templates", f_save_template),
    ("G-156", "A real daily note", f_today),
    ("G-158", "Lightweight relations", f_relation),
    ("G-159", "Camera scan with OCR", f_scan),
    ("G-160", "OCR/text from images and docx", f_attach_docx),
    ("G-161", "Email-to-notebook", f_email_in),
    ("G-162", "Dictation in the editor", f_dictation),
    ("G-165", "Writing help", f_writing_help),
    ("G-064", "Ask insert", f_ask),
    ("G-080", "Share links", f_share),
    ("G-167", "Publish to web (note)", f_publish),
    ("G-167f", "Publish to web (folder)", f_folder_publish),
    ("G-085", "Personal API (token)", f_personal_api),
    ("G-044", "Mobile capture (share target)", f_share_target),
    ("G-169", "Export formats", f_export),
    ("G-171", "First-run tour + sample notebook", f_first_run),
    ("G-172", "Help-centre articles", f_help),
    ("G-026", "Template picker (built-in)", f_templates_picker),
    ("G-021", "Graph view (+ its list mode)", f_graph_kb),
    ("G-043", "Browser extension", _na("N/A: the extension awaits the Chrome Web Store (S-1); nothing a member can open in this sandbox")),
    ("G-127", "Semantic retrieval", _na("N/A: dark until OpenAI's written zero retention (R-20)")),
    ("G-157", "Pages inside pages", _na("N/A by ruling D10 (folders + links + backlinks)")),
    ("G-163", "Cold-start offline", _na("N/A by ruling D6 (no caching service worker)")),
    ("G-081", "Comments / co-editing", _na("N/A by ruling D4 (G-081 out of scope)")),
    ("G-164", "Real-device matrix", _na("N/A: a process run per landing on BrowserStack Live (S-2), not a product door")),
    ("G-166", "AI over attachments", _na("NOT DRIVEN: needs a model key the sandbox has not got")),
    ("G-093", "Sync connectors (read-only)", _na("NOT DRIVEN: every connector needs a third-party account (Notion, Dropbox, OneNote...) the sandbox has not got")),
    ("G-168", "Accessibility (property)", _na("N/A: a property, not a door -- measured by this walk's axe sweep and E2's keyboard walk")),
    ("G-170", "Error reporting and telemetry", _na("N/A: operability, not a member door (10D's rails and browser check)")),
]


def census_cell(W: World, probe, door: str, name: str = "") -> dict:
    t0 = time.time()
    CENSUS_STATE["door_used"] = False
    n0 = len(W.opened)
    W.cell_ctx = []
    out = _census_verdict(W, probe, door)
    out["seconds"] = round(time.time() - t0, 1)
    mine = W.opened[n0:]
    if out["verdict"] not in ("WORKS", "N/A"):
        live = [pg for pg in mine if not pg.is_closed()]
        if live:
            out["screenshot"] = shot(W, live[-1], f"census-{name}-{door}")
    for pg in mine:
        try:
            if not pg.is_closed():
                pg.close()
        except Exception:  # noqa: BLE001
            pass
    del W.opened[n0:]
    for ctx in W.cell_ctx or []:
        try:
            ctx.close()
        except Exception:  # noqa: BLE001
            pass
    W.cell_ctx = None
    return out


def _census_verdict(W: World, probe, door: str) -> dict:
    try:
        detail = probe(W, door)
        v = "WORKS"
    except NoDoor as e:
        v, detail = "NO-DOOR", str(e)
    except Broken as e:
        v, detail = "BROKEN", str(e)
    except NotDriven as e:
        detail = str(e)
        v = "N/A" if detail.startswith("N/A") else "NOT-DRIVEN"
    except StepMissing as e:
        v, detail = "INCONCLUSIVE", f"the door worked; a later control was not found: {e}"
    except Exception as e:  # noqa: BLE001 -- the INSTRUMENT failed; never a verdict about the product
        v, detail = "INCONCLUSIVE", f"{type(e).__name__}: {e}"[:300]
    return {"verdict": v, "detail": str(detail)[:400]}


def census_sweep(W: World, only: list[str]) -> dict:
    out = {"doors": {d: DOOR_MODE[d] for d in DOORS}, "rows": [], "controls": {}}

    # CONTROL: a door that does not exist must read NO-DOOR, a door that does nothing BROKEN.
    def plant_no_door(W, door):
        pg = _list(W, door)
        try:
            return use(pg, door, btn(pg, "Planted nonexistent door"))
        finally:
            pg.close()

    def plant_broken(W, door):
        pg = _list(W, door)
        pg.evaluate("""() => { const b = document.createElement('button'); b.type = 'button';
            b.textContent = 'Planted broken door'; b.style.cssText = 'min-height:44px;min-width:160px';
            document.querySelector('[data-proof-root]').prepend(b); }""")
        how = use(pg, door, btn(pg, "Planted broken door"))
        ok = wait_true(lambda: pg.get_by_role("dialog", name="Planted result").count() > 0, 2)
        pg.close()
        must(ok, "the planted door opened nothing")
        return how

    got = {}
    rows = []
    for door in DOORS:
        a = census_cell(W, plant_no_door, door, "plant-no-door")
        b = census_cell(W, plant_broken, door, "plant-broken")
        rows.append({"door": door, "no_door": a, "broken": b})
        got.setdefault("plant-no-door", a["verdict"])
        got.setdefault("plant-broken-door", b["verdict"])
        if a["verdict"] != "NO-DOOR":
            got["plant-no-door"] = f"{a['verdict']} ({door})"
        if b["verdict"] != "BROKEN":
            got["plant-broken-door"] = f"{b['verdict']} ({door})"
    ok, why = control_ok("census", got)
    out["controls"] = {"got": got, "ok": ok, "why": why, "rows": rows}
    say(f"[{'VALID' if ok else 'INVALID'}] census control: {why}")
    dump("census", out)
    for row, feature, probe in CENSUS:
        if only and not any(row.lower().startswith(o.lower()) for o in only):
            continue
        rec = {"row": row, "feature": feature, "cells": {}}
        for door in DOORS:
            rec["cells"][door] = census_cell(W, probe, door, row)
        out["rows"].append(rec)
        say(f"[CENSUS] {row} {feature}: " + " | ".join(f"{d}={c['verdict']}" for d, c in rec["cells"].items()))
        dump("census", out)
    return out


def _docx_bytes(text: str) -> bytes:
    import io
    import zipfile
    doc = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
           f'<w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>')
    ct = ('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          '<Default Extension="xml" ContentType="application/xml"/>'
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
          '</Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", ct)
        z.writestr("_rels/.rels", rels)
        z.writestr("word/document.xml", doc)
    return buf.getvalue()


# ── the run ──────────────────────────────────────────────────────────────────

def findings_count(sweep: str, out: dict) -> int:
    """How many findings a sweep's raw record holds (what the exit code reads). A cell the
    instrument could not measure (UNREACHED / ERROR / INCONCLUSIVE) is NOT a finding."""
    if sweep == "census":
        return sum(1 for r in out.get("rows") or [] for c in (r.get("cells") or {}).values()
                   if c.get("verdict") in ("BROKEN", "NO-DOOR"))
    if sweep == "geometry":
        return sum(len(c.get("findings") or []) for c in out.get("cells") or [])
    if sweep == "axe":
        return sum(int(r.get("violations") or 0) for r in out.get("runs") or [] if r.get("status") == "MEASURED")
    if sweep == "silent":
        return sum(1 for r in (out.get("reads") or []) + (out.get("writes") or []) if r.get("verdict") == "SILENT")
    if sweep == "deadclick":
        return sum(int((r.get("counts") or {}).get("DEAD", 0)) for r in out.get("surfaces") or [])
    raise ValueError(f"no finding count defined for {sweep!r}")


def run_sweeps(base: str, art: Path, sweeps: list[str], only: list[str]) -> None:
    from playwright.sync_api import sync_playwright
    axe_path = REPO / "app" / "node_modules" / "axe-core" / "axe.min.js"
    axe_src = axe_path.read_text(encoding="utf-8")
    res["axe_core"] = {"path": str(axe_path.relative_to(REPO)), "bytes": len(axe_src)}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        W = World(browser, base, art)
        res["run"] = W.run
        W.admin_login()
        t0 = time.time()
        seed(W)
        res["seed"] = {k: v for k, v in W.fx.items() if k != "rich_body"}
        res["seed_seconds"] = round(time.time() - t0, 1)
        say(f"[SEED] {json.dumps(res['seed'], default=str)[:300]}")
        dump("run", res)
        order = [s for s in ("census", "geometry", "axe", "silent", "deadclick") if s in sweeps]
        for sw in order:
            t1 = time.time()
            try:
                if sw == "geometry":
                    out = geometry_sweep(W, only)
                elif sw == "axe":
                    out = axe_sweep(W, only, axe_src)
                elif sw == "silent":
                    out = silent_sweep(W, only)
                elif sw == "deadclick":
                    out = deadclick_sweep(W, only)
                elif sw == "census":
                    out = census_sweep(W, only)
                ctl = out.get("controls", {})
                res["sweep_status"][sw] = {"control_ok": ctl.get("ok"), "control_why": ctl.get("why"),
                                           "findings": findings_count(sw, out),
                                           "seconds": round(time.time() - t1, 1)}
                res["findings_total"] = sum(int(v.get("findings") or 0) for v in res["sweep_status"].values())
            except Exception as e:  # noqa: BLE001 -- one sweep never stops the rest
                res["sweep_status"][sw] = {"control_ok": None, "error": f"{type(e).__name__}: {e}"[:400],
                                           "traceback": traceback.format_exc()[-2000:]}
                say(f"[ERROR] sweep {sw}: {type(e).__name__}: {e}"[:300])
            dump("run", res)
        browser.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Wave 10 lane 10E-1 proof walk (see the module header).")
    ap.add_argument("--self-check", action="store_true", help="the judges' controls, no browser")
    ap.add_argument("--boot", action="store_true", help="own the sandbox (the evidence run)")
    ap.add_argument("--data-dir")
    ap.add_argument("--port", type=int, default=8215)
    ap.add_argument("--base", help="a sandbox somebody else holds (needs --integrity-log)")
    ap.add_argument("--integrity-log")
    ap.add_argument("--out-dir", help="the evidence directory (the raw JSON lands here)")
    ap.add_argument("--artifacts", help="a scratch directory for screenshots and the launcher log")
    ap.add_argument("--tip")
    ap.add_argument("--sweeps", default=",".join(SWEEPS))
    ap.add_argument("--only", default="", help="surface-id prefixes (a shake-out; the evidence run runs all)")
    ap.add_argument("--no-hold", action="store_true", help="do not hold the sandbox past +120 s (shake-out only)")
    args = ap.parse_args(argv)
    if args.self_check:
        return self_check()
    if not args.out_dir or not args.artifacts:
        ap.error("--out-dir and --artifacts are required")
    sweeps = [s.strip() for s in args.sweeps.split(",") if s.strip()]
    bad = [s for s in sweeps if s not in SWEEPS]
    if bad:
        ap.error(f"unknown sweep(s) {bad}; known: {SWEEPS}")
    only = [s.strip() for s in args.only.split(",") if s.strip()]
    out_dir, art = Path(args.out_dir), Path(args.artifacts)
    out_dir.mkdir(parents=True, exist_ok=True)
    art.mkdir(parents=True, exist_ok=True)
    OUT["dir"] = out_dir
    res.update({"tip": args.tip, "sweeps": sweeps, "only": only, "gates": GATES,
                "started": time.strftime("%Y-%m-%dT%H:%M:%S%z")})
    from tools import notebook_perf_harness as H
    sys.path.insert(0, str(REPO / "scripts"))
    import sandbox_identity  # noqa: E402
    required = [H.PRE_BOOT, H.POST_BOOT, H.SHUTDOWN] + ([] if args.no_hold else [H.PREWARM])
    not_run, sb, ipath = None, None, None
    if args.boot:
        if not args.data_dir:
            ap.error("--boot needs --data-dir")
        base = f"http://127.0.0.1:{args.port}"
        refused = H.refuse_shared_root(args.data_dir)
        if not refused and H.port_busy(args.port):
            refused = f"port {args.port} already has a listener (never killed)"
        if refused:
            print(f"SANDBOX INTEGRITY: NOT RUN (refused: {refused})")
            return 3
        os.environ.update(GATES)
        res["data_dir"] = args.data_dir
        sb = H.Sandbox(args.data_dir, args.port, art / "launcher.log")
    else:
        if not args.base or not args.integrity_log:
            ap.error("without --boot, --base and --integrity-log are required")
        base = args.base.rstrip("/")
        ipath = args.integrity_log
    res["base"] = base
    try:
        if sb is not None:
            sb.start()
            if not sb.wait_healthy(base, 300):
                not_run = "the sandbox never answered /api/health"
            else:
                sb.wait_checkpoint(H.POST_BOOT, H.POST_BOOT_WAIT_S)
                ipath = sb.integrity_path()
        if not not_run:
            v = sandbox_identity.verify(base, ipath)
            res["sandbox_identity"] = {"ok": v.ok, "sentence": v.sentence}
            if not v.ok:
                not_run = v.sentence
            else:
                say("SANDBOX IDENTITY: " + v.sentence)
                try:
                    run_sweeps(base, art, sweeps, only)
                except Exception as e:  # noqa: BLE001
                    not_run = f"{type(e).__name__}: {e}"
                    res["traceback"] = traceback.format_exc()[-3000:]
                if sb is not None and not args.no_hold:
                    res["prewarm_checkpoint_reached"] = sb.wait_checkpoint(H.PREWARM, H.PREWARM_WAIT_S)
    finally:
        if sb is not None:
            res["stop"] = sb.stop()
            ipath = sb.integrity_path()
        integ = H.read_integrity(ipath, required)
        if sb is not None and ipath and Path(ipath).is_file():
            kept = out_dir / "integrity.md"
            shutil.move(ipath, kept)
            integ["path"] = str(kept.relative_to(REPO)) if kept.is_absolute() and REPO in kept.parents else str(kept)
        elif ipath and Path(ipath).is_file():
            shutil.copy(ipath, out_dir / "integrity-borrowed.md")
        first = H.integrity_line(integ, not_run=not_run)
        res.update({"first_line": first, "integrity": integ, "not_run": not_run,
                    "finished": time.strftime("%Y-%m-%dT%H:%M:%S%z")})
        dump("run", res)
        print(first)
        for line in LINES:
            print(line)
        print(f"evidence: {out_dir}")
    if not_run:
        return 3
    st = res["sweep_status"]
    if not integ.get("clean") or any(v.get("control_ok") is not True for v in st.values()):
        return 2
    return 1 if res.get("findings_total") else 0


if __name__ == "__main__":
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        except Exception:  # noqa: BLE001
            pass
    sys.exit(main())
