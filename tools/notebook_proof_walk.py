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
             mousedown (the "looks pressed" trap), and a live one -- must read DEAD, DEAD, LIVE,
             with a planted POLLER firing inside the dead ones' windows (it must be seen there):
             a request the page's own timer sent is never the click's effect (F7; the voice poll
             made run 26e03bbe8's control read the styled dead button LIVE).
  silent     every endpoint a surface calls (and the write each named action sends) is forced
             to answer 500, then to fail as OFFLINE (the request aborted), and a visible
             sentence must render that the healthy load did not show. A failure that is silent
             BY DESIGN is declared in SILENT_EXEMPT with its reason and reads EXEMPT (F7).
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
import signal
import subprocess
import sys
import tempfile
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


def _req_key(r: dict) -> tuple[str, str]:
    return (str(r.get("method") or "GET").upper(), urlsplit(str(r.get("url", "")))._replace(fragment="").geturl())


def without_background(reqs: list[dict], background: list[dict]) -> list[dict]:
    """The requests of a click's window minus the ones the page's own timers sent (the in-page
    half records those -- see INSTRUMENT_JS). Matched one for one by method and URL, so a click
    that asks for the same URL a poll also asked for still keeps its own request."""
    left: dict = {}
    for b in background or []:
        k = _req_key(b)
        left[k] = left.get(k, 0) + 1
    out = []
    for r in reqs or []:
        k = _req_key(r)
        if left.get(k, 0) > 0:
            left[k] -= 1
            continue
        out.append(r)
    return out


def judge_click(obs: dict) -> tuple[str, list[str]]:
    """One click's observation -> ("LIVE", effects) | ("DEAD", []). `obs` holds the counts the
    browser half measured (see EFFECT_JS) plus the Python half's request / event lists.
    A telemetry POST alone is never evidence (the controller's rule for this lane), and neither
    is a request the page's own timer sent inside the click's window (`background_requests`,
    wave 10 follow-up F7: the voice poll read the planted dead control LIVE)."""
    eff = []
    if obs.get("dom", 0) > 0:
        eff.append("dom")
    reqs = [r for r in without_background(obs.get("requests", []), obs.get("background_requests", []))
            if not is_telemetry(r.get("url", ""))
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


# Failures that are SILENT BY DESIGN, each with its reason (wave 10 follow-up F7, clause 5d).
# A forced failure of one of these that shows no sentence reads EXEMPT, never SILENT -- and a
# sentence, if one appears, still reads SENTENCE. Keyed by (method, endpoint template). An entry
# needs a reason a reviewer can check against the code it names; "nobody would notice" is not one.
SILENT_EXEMPT = {
    ("POST", "/api/j2/notes/{id}/opened"): (
        "the recents touch: useJ2Notes.recordNoteOpened is fire-and-forget by contract (never "
        "awaited, never throws into the caller -- the server route's own 'must never break note "
        "viewing' rule). When it fails the note has already opened and nothing on screen changes; "
        "the only effect is that the Recents list does not move this note up until a later open "
        "lands. Telling the member would report a failure of something they did not ask for."),
    # F7 fix round 1 (review I1). Only the "All Accounts" state reads SILENT: there the header
    # pill carries NO comparison value (no balance is drawn, loaded or not), so nothing on the
    # pill is withheld; with one account selected the pill says "balance didn't load" and the
    # row reads SENTENCE, which an exemption never hides.
    ("GET", "/api/j2/accounts/comparison"): (
        "the current-balance comparison under All Accounts: the header pill shows no balance in "
        "that state whether the read succeeds or fails, so the failure is said where the "
        "comparison lives, in the opened account menu (AccountSelector's LoadFailed line, "
        "\"Couldn't load your current balances.\"). The walk does not open that menu. Proved by "
        "app/src/pages/journal-2-0/a11y/silentFailures.test.jsx, 'the account comparison under "
        "\"All Accounts\" is said in the menu, where it lives'."),
}


def exempt_verdict(row: dict, method: str, endpoint: str) -> dict:
    """SILENT -> EXEMPT (with the reason) for a declared silent-by-design endpoint."""
    reason = SILENT_EXEMPT.get((str(method).upper(), endpoint))
    if reason and row.get("verdict") == "SILENT":
        row["verdict"] = "EXEMPT"
        row["exempt_reason"] = reason
    return row


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
        want = {"plant-dead": "DEAD", "plant-dead-styled": "DEAD", "plant-live": "LIVE",
                "plant-poller": "IN-WINDOW"}
    elif sweep == "silent":
        want = {"plant-swallow:500": "SILENT", "plant-swallow:offline": "SILENT",
                "plant-honest:500": "SENTENCE", "plant-honest:offline": "SENTENCE"}
    elif sweep == "geometry":
        want = {"plant-wide": "found", "plant-small": "found", "plant-covered": "found",
                "plant-mislabel": "named-the-real-occluder", "plant-scroll-clear": "CLEAR",
                "plant-scroll-pinned": "OCCLUDED"}
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
  // ⛔ WHO ASKED FOR A REQUEST (wave 10 follow-up F7). A request that lands inside a click's
  // window is not the click's effect when the page's OWN timer sent it: the sweep of 26e03bbe8
  // read the planted dead control LIVE on `GET /api/voice/insights/unspoken`, the voice poll's
  // first tick (useProactiveVoice: 8 s after load, then every 90 s) -- far longer than the
  // 1.5 s idle window that learns noise endpoints, so no idle window could ever have seen it.
  // Timer callbacks carry a flag: a callback scheduled BEFORE the current click was armed
  // (`P.armedAt`, set by MARK_JS), or scheduled by a callback that was itself background, runs
  // as background, and every fetch / XHR it sends is recorded in `P.bgReqs`. A timer the CLICK
  // scheduled (a debounce, a setTimeout(0)) is born after the arm and stays the click's.
  // Residual, stated: a background callback's work after an `await` (a promise continuation)
  // is not followed -- only the synchronous send inside the timer callback is attributed.
  P.armedAt = Infinity; P.bgDepth = 0; P.bgReqs = [];
  const wrapTimer = (name) => {
    const orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function (fn, ...rest) {
      if (typeof fn !== 'function') return orig.call(this, fn, ...rest);
      const born = performance.now(); const bornBg = P.bgDepth > 0;
      return orig.call(this, function (...a) {
        const bg = bornBg || born < P.armedAt;
        if (bg) P.bgDepth++;
        try { return fn.apply(this, a); } finally { if (bg) P.bgDepth--; }
      }, ...rest);
    };
  };
  wrapTimer('setTimeout'); wrapTimer('setInterval'); wrapTimer('requestAnimationFrame');
  const noteBg = (method, url) => {
    if (P.bgDepth <= 0) return;
    try { const u = new URL(String(url), location.href); u.hash = '';
          P.bgReqs.push({method: String(method || 'GET').toUpperCase(), url: u.href}); } catch (e) {}
  };
  const f0 = window.fetch;
  if (typeof f0 === 'function') window.fetch = function (input, init) {
    try {
      const isReq = input && typeof input === 'object' && 'url' in input;
      noteBg((init && init.method) || (isReq ? input.method : 'GET'), isReq ? input.url : input);
    } catch (e) {}
    return f0.apply(this, arguments);
  };
  const XO = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XO) {
    const o0 = XO.open, s0 = XO.send;
    XO.open = function (m, u) { this.__proofReq = [m, u]; return o0.apply(this, arguments); };
    XO.send = function () { if (this.__proofReq) noteBg(this.__proofReq[0], this.__proofReq[1]); return s0.apply(this, arguments); };
  }
})();
"""

# Arms the click as well as marking it: every timer callback scheduled before this moment is
# background from now on (see INSTRUMENT_JS), so a poll that fires inside the click's window is
# never credited to the click. `bgMark` is where this click's background requests start.
MARK_JS = r"""() => { const P = window.__proof; P.focusMark = document.activeElement;
  P.armedAt = performance.now();
  return {mark: P.base + P.muts.length, printed: P.printed, clip: P.clip, bgMark: P.bgReqs.length}; }"""

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
  const [hoverFrom, clickFrom, bgFrom] = args; const P = window.__proof;
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
  out.bg_requests = (P.bgReqs || []).slice(bgFrom || 0).slice(0, 40);
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

# The Notebook tab's own root: the skip link's TARGET, not its parent (WK, wave 10 clause a).
# NotebookTab.jsx renders `<a href="#notebook-pane">`; since F4's <SkipLinkPortal> (wave 10,
# `components/skipLinks.jsx`) that anchor is portaled into the app shell's skip-link slot (a
# bare `<span data-skip-link-slot>` sibling of `<main>`), so `skip.parentElement` is app-chrome,
# not the Notebook. The anchor's semantic target never moved -- it is still `#notebook-pane`
# (`NotebookTab.jsx`'s own `<div id="notebook-pane">`, which DOES contain `.ProseMirror` once a
# note is open). Resolve the href, not the DOM position. Tagged so every sweep scopes to it.
MARK_ROOT_JS = r"""() => {
  for (const e of document.querySelectorAll('[data-proof-root]')) e.removeAttribute('data-proof-root');
  const skip = document.querySelector('a[href="#notebook-pane"]');
  const href = skip ? skip.getAttribute('href') : null;
  const id = href && href.startsWith('#') ? href.slice(1) : null;
  const r = id ? document.getElementById(id) : null;
  if (r) r.setAttribute('data-proof-root', 'notebook');
  return !!r; }"""

# CONTROL for MARK_ROOT_JS (clause a): on an editor surface the marked root must actually
# CONTAIN the editor. A root marked wrong (e.g. the old `skip.parentElement` shape, which is a
# bare app-chrome span) contains no `.ProseMirror` at all -- this is what proves the fix can
# fail, not just that it happens to pass today.
MARK_ROOT_CONTAINS_EDITOR_JS = r"""() => {
  const r = document.querySelector('[data-proof-root="notebook"]');
  return !!(r && r.querySelector('.ProseMirror')); }"""

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
  // ⛔ wave 10 lane WK3, fix 1 (found by lane FX): `hit.closest('...,section,aside,div')`
  // climbed from a non-matching hit (e.g. MobileNav's <header>, not itself a div) up through
  // EVERY intervening div, including a full-viewport app-shell wrapper -- and `desc()` reads
  // an ancestor's `.innerText`, the FIRST rendered line of its WHOLE subtree, which for that
  // wrapper is a portaled skip link's own text (off-screen via `top:-9999px`, but `innerText`
  // does not consider off-screen positioning, only display/visibility). The skip link was
  // blamed for occlusions it never causes. Fix: only accept a candidate ancestor whose OWN
  // bounding box is not (near-)viewport-spanning -- a genuine popup/card is far smaller than
  // the page; the app shell is not. A rejected candidate falls back to naming HIT itself.
  const viewportArea = vw * vh;
  const tightOccluderAncestor = (hit) => {
    for (let a = hit; a && a !== document.body; a = a.parentElement) {
      if (!(a.matches && a.matches('[role=dialog],[role=tooltip],[role=status],[role=menu],[role=listbox],[data-proof-popup],section,aside,div'))) continue;
      const r = a.getBoundingClientRect();
      if (r.width * r.height > 0 && r.width * r.height <= viewportArea * 0.85) return a;
    }
    return hit;
  };
  // ⛔ wave 10 lane WK3, fix 2 (controller ruling, "at rest" semantics): a control that sits
  // under FIXED/STICKY chrome (the voice orb, the Log-Trade FAB, a sticky header) mid-scroll
  // is not a layout regression BY ITSELF -- a floating element always covers something while
  // the page is mid-scroll. `canEscapeByScroll(el)` answers whether EL has anywhere to go: a
  // control that is itself fixed/sticky, or trapped inside fixed/sticky chrome with no
  // scrollable ancestor before it, cannot move -- an overlap there IS a real finding. A
  // control with a genuine scrollable ancestor (even one nested inside fixed-positioned
  // chrome, like a panel with its own scrollbar) CAN be brought clear.
  const isFixedOrSticky = (el) => { const p = getComputedStyle(el).position; return p === 'fixed' || p === 'sticky'; };
  const canEscapeByScroll = (el) => {
    if (isFixedOrSticky(el)) return false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && a.scrollHeight > a.clientHeight + 1) return true;
      if (cs.position === 'fixed' || cs.position === 'sticky') return false;
    }
    const m = document.querySelector('main');
    if (m && m.contains(el) && m.scrollHeight > m.clientHeight + 10) return true;
    return document.scrollingElement.scrollHeight > innerHeight + 10;
  };
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
      let covered = 0, centerCovered = false, occ = null, occHitEl = null;
      pts.forEach(([x, y], i) => {
        if (x < 0 || y < 0 || x > vw || y > vh) return;
        const hit = document.elementFromPoint(x, y);
        if (!hit || hit === el || el.contains(hit) || hit.contains(el)) return;
        if (hit.closest('[data-proof-ignore]')) return;
        covered++; if (i === 0) centerCovered = true;
        if (!occ) { occ = desc(tightOccluderAncestor(hit));
                    occHitEl = hit;
                    c.occluderHit = desc(hit);
                    c.occluderPopup = !!(hit.closest('[data-proof-popup]') && !el.closest('[data-proof-popup]'));
                    c.occluderModal = !!(hit.closest('[aria-modal="true"]') || (hit.querySelector && hit.querySelector('[aria-modal="true"]'))); }
      });
      c.coveredPoints = covered; c.centerCovered = centerCovered; c.occluder = occ;
      // fix 2: an occluder that is fixed/sticky chrome gets one more chance -- scroll EL to the
      // centre of its own scroller (if it has one to escape into) and look again. Restore the
      // scroll position immediately after so later controls in this same pass are unaffected.
      if (occ && (centerCovered || covered >= 3) && occHitEl && isFixedOrSticky(occHitEl) && canEscapeByScroll(el)) {
        const savedX = window.scrollX, savedY = window.scrollY;
        const savedTops = [];
        for (let a = el.parentElement; a; a = a.parentElement) savedTops.push([a, a.scrollTop]);
        el.scrollIntoView({block: 'center', inline: 'nearest'});
        const b2 = el.getBoundingClientRect();
        const cx2 = b2.x + b2.width / 2, cy2 = b2.y + b2.height / 2;
        const hit2 = (cx2 >= 0 && cy2 >= 0 && cx2 <= vw && cy2 <= vh) ? document.elementFromPoint(cx2, cy2) : null;
        const stillCovered = !!(hit2 && hit2 !== el && !el.contains(hit2) && !hit2.contains(el) && !hit2.closest('[data-proof-ignore]'));
        c.restScrollClear = !stillCovered;
        if (!stillCovered) { c.centerCovered = false; c.coveredPoints = 0; c.occluder = null; }
        for (const [a, top] of savedTops) a.scrollTop = top;
        window.scrollTo(savedX, savedY);
      }
    }
    res.controls.push(c);
  }
  return res;
}"""

# The planted defects, one per instrument, each tagged `data-proof-plant` and removed after.
#
# ⛔ Clause b (WK, wave 10): WK's deadclick control read the plant-dead control LIVE, naming
# the voice orb cluster's (GlobalVoiceLayer) own DOM churn as the cause and asking for the F7
# idiom -- learn/exclude app-chrome self-mutations by REGION, never a hardcoded selector. That
# idiom already exists here (`chrome()`/`ctlChrome` in EFFECT_JS above, added by F7 for exactly
# this: "the voice orb reacts to ANY pointer activity"): a mutation outside `<main>` (and outside
# any open dialog/menu/popup) is excluded UNLESS the clicked control itself also lives outside
# `<main>`. The reason it was defeated is clause a, not a missing mechanism: this plant is
# inserted into `root` (the MARK_ROOT_JS-tagged element), and the old MARK_ROOT_JS marked a bare
# app-chrome span (`skip.parentElement`, outside `<main>`) -- so the plant itself read as chrome
# (`ctlChrome = true`), which switches the exclusion OFF for a control that "lives there" by
# name (correct for a real chrome control; wrong here, since the plant was mis-scoped, not
# actually chrome). Fixing clause a alone restores `ctlChrome` to false (the plant's real root,
# `#notebook-pane`, is inside `<main>`), and F7's existing region check recovers on its own --
# verified live (wk2 diagnostic run): plant-dead/plant-dead-styled/plant-live/plant-poller all
# read DEAD/DEAD/LIVE/IN-WINDOW with ONLY clause a's fix applied, no change below this line.
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
  // A planted POLLER shaped like the one that broke run 26e03bbe8 (the voice poll, first tick
  // 8 s after load): an interval set up now, silent through the 1.5 s idle window that learns
  // noise endpoints, then fetching every 200 ms -- so every planted click's 1.2 s window holds
  // several of its requests. An instrument that credits them to the click reads both dead plants
  // LIVE and the control fails. It stops itself once the box is gone.
  const t0 = performance.now();
  const id = setInterval(() => {
    if (!box.isConnected) { clearInterval(id); return; }
    if (performance.now() - t0 < 2500) return;
    fetch('/api/proof-plant/poll?t=' + Math.round(performance.now()), {credentials: 'include'}).catch(() => {});
  }, 200);
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

# CONTROL support (wk2, clause a's second-order finding): `plant-wide` assumed a 1400px
# element would always show as page/main OVERFLOW. On `nb-list` at >640px the marked root
# (`#notebook-pane`, correct since clause a) has `overflow-y: auto`, which per the CSS
# overflow-pairing rule computes `overflow-x: auto` too (NotebookTab.module.css `.main`,
# no `overflow-x` of its own) -- a real, working horizontal scroller, exactly the
# "REACHABLE, not overflow" case `judge_geometry`'s own offender walk already excludes on
# purpose. The old MARK_ROOT_JS (clause a) planted into an unclipped app-chrome span with no
# such scroller, which is why this control read as passing before -- by accident, not by
# testing this surface's real containment. A plant a real auto-scroller correctly contains
# is still evidence the instrument SAW it; this names that ancestor rather than assuming
# "not overflow" means "not found".
WIDE_REACHABLE_JS = r"""() => {
  const el = document.querySelector('[data-proof-control="plant-wide"]');
  if (!el) return false;
  for (let a = el.parentElement; a; a = a.parentElement) {
    const cs = getComputedStyle(a);
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && a.scrollWidth > a.clientWidth + 1) return true;
  }
  return false; }"""

# CONTROL for fix 1 (occluder mislabel): a wrapper whose FIRST child is off-screen text,
# containing a full-viewport HEADER (never matched by 'div', so the OLD code climbed past it)
# that covers a planted target. The correct occluder description must name the header (or at
# least never quote the decoy text) -- reproduces the exact shape lane FX measured live.
PLANT_MISLABEL_JS = r"""() => {
  const wrap = document.createElement('div'); wrap.setAttribute('data-proof-plant', 'mislabel');
  wrap.style.cssText = 'position:fixed;inset:0;pointer-events:none;';
  const target = document.createElement('button'); target.type = 'button';
  target.setAttribute('aria-label', 'Planted mislabel target'); target.setAttribute('data-proof-control', 'plant-mislabel-target');
  target.style.cssText = 'position:fixed;left:50%;top:50%;width:120px;height:44px;pointer-events:auto;z-index:1;';
  const decoy = document.createElement('span'); decoy.textContent = 'Off-screen decoy text';
  decoy.style.cssText = 'position:absolute;top:-9999px;left:-9999px;';
  const occ = document.createElement('header'); occ.setAttribute('data-proof-control', 'plant-mislabel-occluder');
  occ.style.cssText = 'position:fixed;inset:0;pointer-events:auto;z-index:2;';
  wrap.appendChild(target); wrap.appendChild(decoy); wrap.appendChild(occ);
  document.body.appendChild(wrap); return true; }"""

# CONTROL for fix 2 (at-rest semantics): `plant-fixed-bar` is a FIXED band pinned over a small
# scrollable panel's own top edge. `plant-scroll-clear` starts under that band but lives in the
# panel's OWN internal scroller, so centring it moves it clear -- must read CLEAR (the same
# shape as the voice orb passing over content mid-scroll). `plant-scroll-pinned` starts under
# the identical band but is ITSELF position:fixed with nothing to scroll it into -- must stay
# OCCLUDED, proving the fix does not turn every fixed-chrome overlap into a false negative.
PLANT_RESTSCROLL_JS = r"""() => {
  const wrap = document.createElement('div'); wrap.setAttribute('data-proof-plant', 'restscroll');
  wrap.style.cssText = 'position:fixed;left:8px;top:100px;width:220px;height:180px;overflow-y:auto;background:#fff;z-index:2;';
  // clearTarget sits mid-content (280px of spacer on BOTH sides) -- close to the top of the
  // content, `block:'center'` cannot scroll PAST 0, so it can never move at all (the bug this
  // fixture exists to catch: it read INVALID, `plant-scroll-clear` stuck OCCLUDED, measured
  // live 2026-09-29). With room on both sides, centring genuinely relocates it.
  const spacerTop = document.createElement('div'); spacerTop.style.cssText = 'height:280px;';
  const clearTarget = document.createElement('button'); clearTarget.type = 'button';
  clearTarget.setAttribute('aria-label', 'Planted scroll-clear target'); clearTarget.setAttribute('data-proof-control', 'plant-scroll-clear');
  clearTarget.style.cssText = 'width:120px;height:44px;display:block;margin:0;';
  const spacerBottom = document.createElement('div'); spacerBottom.style.cssText = 'height:280px;';
  wrap.appendChild(spacerTop); wrap.appendChild(clearTarget); wrap.appendChild(spacerBottom);
  document.body.appendChild(wrap);
  // start scrolled so clearTarget's CURRENT screen position sits under the fixed band below,
  // with slack in both scroll directions -- `scrollIntoView({block:'center'})` then has
  // somewhere real to move it to.
  wrap.scrollTop = 270;
  const pinnedTarget = document.createElement('button'); pinnedTarget.type = 'button';
  pinnedTarget.setAttribute('aria-label', 'Planted pinned target'); pinnedTarget.setAttribute('data-proof-control', 'plant-scroll-pinned');
  pinnedTarget.style.cssText = 'position:fixed;left:8px;top:110px;width:120px;height:44px;z-index:1;';
  pinnedTarget.setAttribute('data-proof-plant', 'restscroll');
  const bar = document.createElement('div'); bar.setAttribute('data-proof-control', 'plant-fixed-bar');
  bar.setAttribute('data-proof-plant', 'restscroll');
  bar.style.cssText = 'position:fixed;left:8px;top:100px;width:220px;height:50px;background:rgba(0,0,0,.01);z-index:3;';
  document.body.appendChild(pinnedTarget); document.body.appendChild(bar);
  return true; }"""

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
    poll = {"method": "GET", "url": "http://x/api/voice/insights/unspoken"}
    rows.append(("a background poll only", judge_click({"requests": [poll], "background_requests": [poll]})[0], "DEAD"))
    rows.append(("the click's own request beside a poll", judge_click({"requests": [poll, poll], "background_requests": [poll]})[0], "LIVE"))
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


def mark_root(pg, timeout: float = 25.0, *, expect_editor: bool = False) -> str:
    end = time.time() + timeout * PATIENCE["f"]
    while time.time() < end:
        try:
            if pg.evaluate(MARK_ROOT_JS):
                if expect_editor and not pg.evaluate(MARK_ROOT_CONTAINS_EDITOR_JS):
                    # CONTROL (clause a): a note is open (the caller only sets expect_editor
                    # once `.ProseMirror` is already visible somewhere on the page -- see
                    # open_note()), so a root that does not contain it is marked WRONG, not
                    # merely early. Raise rather than silently scoping every downstream probe
                    # to an empty root, which is exactly what read as UNREACHED/INCONCLUSIVE
                    # across 9a/2c/5d/6c/2b before this fix.
                    raise RuntimeError(
                        "MARK_ROOT_JS marked a root that does not contain .ProseMirror on an "
                        "editor surface -- the skip link's target moved and the marker is "
                        "reading the wrong element")
                return ROOT
        except RuntimeError:
            raise
        except Exception:  # noqa: BLE001 -- navigating
            pass
        pg.wait_for_timeout(400)
    raise RuntimeError("the Notebook root (its skip link's target, #notebook-pane) never rendered")


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
    root = mark_root(pg, expect_editor=True)
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
    open_format_more(pg)   # phone-only: "Text color and highlight" is a `.formatRun` member
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
    open_more_note_actions(pg)   # "Version history" lives in NoteMoreMenu
    press(pg, pg.get_by_role("button", name="Version history").filter(visible=True).first)
    return mark_popup(pg.get_by_role("dialog", name="Version history"))


def s_ed_palette(W, pg) -> str:
    s_note(W, pg)
    open_format_more(pg)   # phone-only: "Insert widget" is a `.formatRun` member (group -d)
    press(pg, pg.get_by_role("button", name="Insert widget").filter(visible=True).first)
    return mark_popup(pg.get_by_role("dialog", name="Insert widget"))


def s_ed_share(W, pg) -> str:
    s_note(W, pg)
    press(pg, pg.get_by_role("button", name=re.compile(r"^Share$")).filter(visible=True).first)
    return mark_popup(pg.get_by_role("dialog", name="Share this note"))


def s_ed_export(W, pg) -> str:
    s_note(W, pg)
    open_more_note_actions(pg)   # NoteExportControls (the "Export" door) lives in NoteMoreMenu
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
    open_more_note_actions(pg)   # "Delete" is the LAST action in NoteMoreMenu
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
    # deadclick's own `before_click` (click_one's only caller of this file's before_click
    # surfaces) -- safe_evaluate bounds it the same as every other deadclick evaluate call.
    safe_evaluate(pg, r"""() => { const pm = document.querySelector('[data-proof-root] .ProseMirror'); if (!pm) return;
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
    endpoint requested in `ms` becomes NOISE, never counted as a click's effect. Used only from
    `deadclick_surface`'s own `fresh()` -- its two evaluate calls go through `safe_evaluate` for
    the same reason every other deadclick evaluate call does (see the comment above `click_one`)."""
    m = safe_evaluate(pg, MARK_JS)["mark"]
    n0 = len(tap.reqs)
    pg.wait_for_timeout(ms)
    added = safe_evaluate(pg, NOISE_JS, m)
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
            # ⛔ wk2: was a single unscrolled `pg.evaluate(GEOM_JS)`. At <=640px
            # `NotebookTab.module.css`'s phone query drops `.main`'s scroll containment
            # (`overflow: visible`; "Phones keep normal page scroll") and stacks the folder
            # panel ABOVE the notes list, so the plant box -- inserted at the root's DOM top --
            # can render below the first screenful on a populated list. A single unscrolled
            # read missed it (small/covered read "missed at 390" once clause a's fix put the
            # plant in the REAL root instead of an unclipped app-chrome span that never had
            # this problem). `_geo_read` is the exact two-reading (top + scrolled) mechanism
            # every real surface cell already uses for this same reason -- give the control
            # the same robustness rather than a second, weaker reading path.
            r0 = _geo_read(pg)
            before, _ = _merge_findings(r0, w)
            pg.evaluate(PLANT_GEOMETRY_JS, root)
            pg.wait_for_timeout(400)
            r1 = _geo_read(pg)
            after, _ = _merge_findings(r1, w)
            wide_reachable = pg.evaluate(WIDE_REACHABLE_JS)
            pg.evaluate(UNPLANT_JS, "geometry")
        finally:
            pg.close()
        keys_before = {(f["kind"], f.get("control") or f.get("what")) for f in before}
        new = [f for f in after if (f["kind"], f.get("control") or f.get("what")) not in keys_before]

        def widest(readings):
            return max(max([r.get("docScrollW", 0)] + [p.get("scrollW", 0) for p in r.get("pageScrollers", [])])
                       for r in readings)
        grew = widest(r1) - widest(r0)
        wide = any(f["kind"] in ("overflow", "cutoff") for f in new) or grew >= 400 or wide_reachable or any(
            "plant-wide" in json.dumps(f.get("widened_by", [])) for f in after)
        small = any(f["kind"] == "tap" and f.get("control") == "Planted small control" for f in new)
        covered = any(f["kind"] == "occluded" and f.get("control") == "Planted covered control" for f in new)
        want_small = w <= TOUCH_MAX_WIDTH
        ctl_rows.append({"mode": mode, "width": w, "wide_found": wide, "page_grew_px": grew,
                         "wide_reachable_in_scroller": wide_reachable, "small_found": small,
                         "small_expected": want_small, "covered_found": covered, "new_findings": new})
        if not wide:
            got["plant-wide"] = f"missed at {w}"
        if small != want_small:
            got["plant-small"] = f"{'missed' if want_small else 'wrongly flagged'} at {w}"
        if not covered:
            got["plant-covered"] = f"missed at {w}"

    # CONTROL for fix 1 (occluder mislabel) and fix 2 (at-rest semantics), each plant read in
    # ISOLATION (sequentially unplanted before the next) so neither's full-viewport fixed
    # element can shadow the other's occluder.
    pg, tap, root, acct = open_surface(W, surface_by_id("nb-list"), "desktop")
    try:
        pg.evaluate(PLANT_MISLABEL_JS)
        pg.wait_for_timeout(200)
        g1 = pg.evaluate(GEOM_JS)
        pg.evaluate(UNPLANT_JS, "mislabel")
        pg.wait_for_timeout(200)
        pg.evaluate(PLANT_RESTSCROLL_JS)
        pg.wait_for_timeout(200)
        g2 = pg.evaluate(GEOM_JS)
        pg.evaluate(UNPLANT_JS, "restscroll")
    finally:
        pg.close()
    by_name1 = {c.get("name"): c for c in g1.get("controls", [])}
    mislabel = by_name1.get("Planted mislabel target")
    occ_desc = (mislabel or {}).get("occluder") or ""
    if mislabel is None:
        got["plant-mislabel"] = "control not found"
    elif "decoy" in occ_desc.lower():
        got["plant-mislabel"] = f"named the decoy: {occ_desc!r}"
    elif "plant-mislabel-occluder" not in occ_desc:
        got["plant-mislabel"] = f"named neither the decoy nor the real occluder: {occ_desc!r}"
    else:
        got["plant-mislabel"] = "named-the-real-occluder"

    def _geo_verdict(c):
        return "OCCLUDED" if (c and c.get("occluder") and (c.get("centerCovered") or c.get("coveredPoints", 0) >= 3)) else "CLEAR"
    by_name2 = {c.get("name"): c for c in g2.get("controls", [])}
    got["plant-scroll-clear"] = _geo_verdict(by_name2.get("Planted scroll-clear target"))
    got["plant-scroll-pinned"] = _geo_verdict(by_name2.get("Planted pinned target"))
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

class EvalTimeout(Exception):
    """A `page.evaluate` call whose JS-side race (see `safe_evaluate`) timed out. Raised in
    Python, from a NORMAL `evaluate()` return -- never from an abandoned call -- so it is a
    plain, catchable exception on the calling thread, not a sign that anything is still
    blocked."""


EVAL_TIMEOUT_MS = 8000   # generous for a DOM read; several fit inside one control's
                         # CLICK_DEADLINE_S budget without a single one eating all of it


def safe_evaluate(pg, script: str, arg=None, timeout_ms: int = EVAL_TIMEOUT_MS):
    """`page.evaluate(script, arg)`, bounded by a JS-side `Promise.race` against a JS
    `setTimeout` -- Playwright's Python sync API takes no `timeout=` for `evaluate()` at all
    (docs/notebook/proof/wk4-e1ef47435/README.md, "THE THREADING DEFECT"), so a script whose
    async work never resolves would otherwise block this call, and the whole OS thread with
    it, forever. `script` is any of this file's existing `(...) => {...}` constants,
    unmodified -- the wrapper calls it and awaits its result, so a plain synchronous function
    (everything this file defines) returns exactly as before, just with a ceiling.

    Raises `EvalTimeout` when the JS-side timer wins the race, and re-raises the script's own
    thrown error (as a plain `RuntimeError`) when it wins by throwing -- both ordinary Python
    exceptions on the calling thread, never a hang.

    ⛔ THIS DOES NOT COVER A RENDERER WEDGED AT THE NATIVE LEVEL. If nothing in the page can
    run ANY JavaScript at all -- a native OS-level modal is the WK4 README's own hypothesis for
    what blocked WK3's stall -- the `setTimeout` this wrapper depends on never fires either,
    because firing it needs the SAME JS engine the frozen renderer cannot run. That class is
    bounded by the per-surface PROCESS deadline in `deadclick_surface_bounded`, never by this
    function: a process boundary can be killed from the outside regardless of what the inside
    is doing; a JS timer inside a wedged renderer cannot."""
    wrapped = (
        "(__uctArg) => new Promise((__uctResolve) => {"
        f"  const __uctTimer = setTimeout(() => __uctResolve({{__uctTimedOut: true}}), {int(timeout_ms)});"
        "  (async () => {"
        "    try {"
        f"      const __uctFn = ({script});"
        "      const __uctValue = await __uctFn(__uctArg);"
        "      clearTimeout(__uctTimer);"
        "      __uctResolve({__uctOk: true, __uctValue});"
        "    } catch (__uctErr) {"
        "      clearTimeout(__uctTimer);"
        "      __uctResolve({__uctErr: true, __uctMessage: String((__uctErr && __uctErr.message) || __uctErr)});"
        "    }"
        "  })();"
        "})"
    )
    out = pg.evaluate(wrapped, arg)
    if isinstance(out, dict) and out.get("__uctTimedOut"):
        raise EvalTimeout(f"evaluate exceeded {timeout_ms}ms: {script[:80]!r}")
    if isinstance(out, dict) and out.get("__uctErr"):
        raise RuntimeError(out.get("__uctMessage") or "evaluate failed")
    if isinstance(out, dict) and "__uctValue" in out:
        return out["__uctValue"]
    return out


HOVER_TIMEOUT_MS = 2500
ACTION_TIMEOUT_MS = 3500   # click/tap -- Playwright's own native, already-bounded wait


def click_one(W: World, pg, tap: Tap, root: str, c: dict, surf: Surface, mode: str) -> dict:
    if surf.before_click:
        try:
            surf.before_click(pg)
        except Exception:  # noqa: BLE001
            pass
    if not safe_evaluate(pg, TARGET_JS, [root, c["key"], c["nth"]]):
        return {"verdict": "NOT-FOUND", "reset": False}
    loc = pg.locator("[data-proof-target]").first
    touch = VIEWPORTS.get(mode, {}).get("touch", False)
    if c.get("field"):
        # a field is judged by focus arriving IN it: start from nothing focused
        safe_evaluate(pg, "() => { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); }")
    url0 = pg.url
    origin0 = safe_evaluate(pg, "() => performance.timeOrigin")
    hover_from = safe_evaluate(pg, MARK_JS)["mark"]
    if not touch:
        try:
            loc.hover(timeout=HOVER_TIMEOUT_MS)
        except Exception:  # noqa: BLE001
            pass
    pg.wait_for_timeout(450)
    m = safe_evaluate(pg, MARK_JS)
    fs0 = safe_evaluate(pg, FORMSTATE_JS, root)
    n0, ev0 = len(tap.reqs), dict(tap.events)
    try:
        if touch:
            loc.tap(timeout=ACTION_TIMEOUT_MS)
        else:
            loc.click(timeout=ACTION_TIMEOUT_MS)
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        inter = next((ln.strip() for ln in msg.splitlines() if "intercepts pointer events" in ln), "")
        return {"verdict": "OCCLUDED" if inter else "NOT-ACTIONABLE",
                "reason": (inter or msg.splitlines()[0])[:240], "reset": True}
    pg.wait_for_timeout(1200)
    reloaded = False
    try:
        reloaded = safe_evaluate(pg, "() => performance.timeOrigin") != origin0
        if reloaded:
            raise RuntimeError("document reloaded")
        eff = safe_evaluate(pg, EFFECT_JS, [hover_from, m["mark"], m.get("bgMark", 0)])
        fs1 = safe_evaluate(pg, FORMSTATE_JS, root)
    except EvalTimeout:
        raise   # a stuck read is TIMEOUT, never mistaken for the page having navigated
    except Exception as e:  # noqa: BLE001 -- a full navigation replaced the document
        eff = {"dom": 0, "expanded": 0, "focus_moved": False, "printed": m["printed"], "clip": m["clip"],
               "samples": [f"no in-page reading: {type(e).__name__}"]}
        fs1 = fs0
        reloaded = True
    reqs = tap.reqs[n0:]
    bg = eff.get("bg_requests") or []
    obs = {"dom": eff.get("dom", 0), "expanded": eff.get("expanded", 0), "focus_moved": eff.get("focus_moved"),
           "requests": reqs, "background_requests": bg,
           "noise_endpoints": sorted(W.noise_endpoints), "url_before": url0,
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
            "background_ignored": [f"{b.get('method')} {normalize_endpoint(b.get('url', ''))}" for b in bg][:6],
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


# ── wave 10 lane WK4/WK5: the dead-click sweep's hang on `nb-bulk` (docs/notebook/proof/wk3-d5ca882b9/HUNG-deadclick.md) ──
# WK3 measured a ~50-minute, ~0%-CPU stall inside the per-control loop, hard-killed with no
# shutdown checkpoint. Every explicit Playwright wait in `click_one` already carries its own
# timeout (hover 2.5s, click 3.5s, the settle waits are fixed `wait_for_timeout`s) -- none of
# those can hang. What CANNOT hang-proof itself is `page.evaluate(...)`: Playwright's Python API
# takes no `timeout=` for it at all, so a call whose JS never returns control (native browser UI
# outside the page's own JS thread -- a `<select>`'s OS-native popup is the one this file's own
# `window.print` stub does NOT cover, since BulkActionBar's folder picker is a real `<select>`)
# blocks the walk process forever, not the browser: the sandbox's OWN requests kept answering
# throughout WK3's stall, which is what a page-JS-thread block, not a crashed server, looks like.
#
# ⛔⛔ WK4 (`e1ef47435`) wrapped that risk in `_run_with_deadline`, a wall-clock watchdog that ran
# the wrapped call on a `threading.Thread` and, on overrun, called into that thread's Playwright
# objects (closing a browser context) FROM THE OUTER THREAD. Playwright's sync API dispatches
# every one of its objects (`Page`, `BrowserContext`, `Locator`, ...) through a greenlet bound to
# the ONE OS thread that created `sync_playwright()`; a second thread touching ANY of them raises
# immediately ("Cannot switch to a different thread"), which is what happened to every one of the
# 39 deadclick surface x mode cells the very first time `deadclick_surface`'s own `fresh()` tried
# to open a page from inside the watchdog's worker thread (docs/notebook/proof/wk4-e1ef47435/
# deadclick.json, `controls.raw.reason` and every per-surface `reason`, verbatim). The mechanism
# built to catch a hang never got the chance to: the wrapped call failed on its own, instantly,
# for an unrelated reason, and the watchdog's own timeout path never fired.
#
# ⭐ WK5's redesign (this lane): NO Playwright object is ever touched from a second OS THREAD --
# because none is ever touched by a second thread at all. The per-CLICK bound (`_click_or_timeout`
# below) stays on the ONE thread that owns the page: every `page.evaluate` call `click_one` makes
# now goes through `safe_evaluate` (above `click_one`), whose JS-SIDE `Promise.race` against a JS
# `setTimeout` makes a stuck async handler return a bounded sentinel instead of blocking Python's
# read of the CDP response forever -- an ordinary Python exception (`EvalTimeout`) on the SAME
# thread, not a preemption from another one. click/tap/hover already carry Playwright-native
# `timeout=`. The per-SURFACE bound (`deadclick_surface_bounded`) is a PROCESS boundary instead of
# a thread one: the parent spawns `--deadclick-worker` as a CHILD PYTHON PROCESS (its own
# `sync_playwright()`, its own greenlet, its own browser), waits on it, and kills the OS process
# tree at the deadline -- the parent NEVER calls a method on a Playwright object the child
# created; it only starts the child, waits, and reads the JSON file the child wrote. A process
# boundary has no greenlet to violate, so a kill here is safe regardless of what the child's
# single thread is doing when it happens, including a genuine native-renderer freeze that even
# `safe_evaluate`'s JS-side timer cannot catch (see its own docstring).

CLICK_DEADLINE_S = 25.0     # per control: several safe_evaluate calls, each well under this, plus
                            # click_one's own bounded waits; a control that still runs long is
                            # relabeled TIMEOUT rather than read as an ordinary slow verdict
SURFACE_DEADLINE_S = 360.0  # per surface x mode: the child process's hard ceiling, enforced by
                            # the parent killing the OS process tree -- the backstop for anything
                            # the per-click guard cannot reach (inside `fresh()`'s own
                            # `surf.open()`, before any control has been clicked, OR a renderer
                            # wedged at the native level, which no in-process guard can catch)


def _kill_process_tree(pid: int) -> None:
    """Hard-kill `pid` and everything it spawned -- the browser Playwright launched underneath
    it, not just the Python interpreter. `Popen.kill()` alone only signals the direct child; on
    Windows that can orphan a chromium.exe the child never got the chance to close. Best-effort,
    the same way `notebook_perf_harness.Sandbox.stop`'s own last-resort kill is: the parent is
    force-closing an OS process it does not own the internals of, so a failure here is swallowed,
    not raised -- the caller's own timeout handling is what matters, not this cleanup succeeding."""
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True, timeout=15)
        else:
            os.killpg(pid, signal.SIGKILL)
    except Exception:  # noqa: BLE001
        pass


def _click_or_timeout(W: World, pg, tap: Tap, root: str, c: dict, surf: Surface, mode: str,
                       deadline: float = CLICK_DEADLINE_S) -> dict:
    """`click_one`, bounded WITHOUT a second thread. `click_one`'s own Playwright waits that
    accept a `timeout=` (click/tap/hover) already carry one; every `page.evaluate` it makes goes
    through `safe_evaluate`, whose JS-side race turns a stuck async handler into a bounded
    `EvalTimeout` on THIS thread rather than an indefinite block. A control that nonetheless runs
    past `deadline` (several evaluate calls each near their own ceiling, say) is relabeled TIMEOUT
    after the fact instead of reading as an ordinary slow verdict.

    What this cannot catch is a renderer wedged at the native/OS level -- nothing can run ANY JS,
    so `safe_evaluate`'s own JS-side timer never fires either. That class is bounded by the
    per-surface PROCESS deadline in `deadclick_surface_bounded`, never here: a control caught only
    by that outer bound still ends its whole SURFACE in a named TIMEOUT, and the sweep continues
    to the next surface -- it does not hang the walk, it just costs a coarser-grained verdict."""
    started = time.monotonic()
    try:
        r = click_one(W, pg, tap, root, c, surf, mode)
    except EvalTimeout as e:
        return {"verdict": "TIMEOUT", "reset": True, "reason": f"evaluate: {e}"[:240]}
    except Exception as e:  # noqa: BLE001
        return {"verdict": "ERROR", "reason": f"{type(e).__name__}: {e}"[:240], "reset": True}
    elapsed = time.monotonic() - started
    if elapsed > deadline:
        r = dict(r)
        r["verdict"] = "TIMEOUT"
        r["reset"] = True
        r["reason"] = f"completed in {elapsed:.1f}s, past the {deadline:.0f}s per-click budget"
    return r


DEADCLICK_CONTEXT_TIMEOUT_MS = 20000  # a per-context default for anything below with no
                                       # explicit timeout= of its own (a bare .fill()/.click()
                                       # inside a surf.open() function) -- well below Playwright's
                                       # native 30s default, comfortably above every explicit
                                       # timeout this file's own surfaces already use


def deadclick_surface(W: World, surf: Surface, mode: str, *, plant: bool = False, on_progress=None) -> dict:
    """Every enabled control of one surface, each clicked from the SAME starting state.

    ⛔ State is the trap: a click can collapse the folder panel, switch the view or change a
    preference, and every later control would then be measured on a different page (the
    shake-out read 16 sidebar controls "covered" after one "Hide folders panel"). So after a
    click the surface is reopened from scratch -- a NEW browser context from the member's
    stored state (pristine localStorage) and the member's server preferences put back -- when
    the click wrote anything, navigated, changed the page's control set, or changed local
    storage. Otherwise the same page is reused (Escape pressed twice).

    `on_progress`, when given, is called with a COPY of `rec` after every control (and on the
    early UNREACHED return) -- see `_deadclick_worker_main`, which uses it to flush this
    surface's progress to disk so a parent that has to hard-kill this function's OS process at
    the deadline still salvages whatever had already run, the same contract the old thread-based
    `handle['rec']` used to provide, now surviving a process kill rather than depending on a
    thread that shares memory with the one being killed."""
    rec = {"surface": surf.sid, "mode": mode, "manifest": list(surf.manifest), "controls": [], "resets": 0,
           "prefs_restored": []}
    holder = {"ctx": None, "acct": None}
    snap = {}

    def progress():
        if on_progress is not None:
            on_progress(dict(rec))

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
        ctx.set_default_timeout(DEADCLICK_CONTEXT_TIMEOUT_MS)
        holder["ctx"] = ctx
        pg = ctx.new_page()
        tap = Tap(pg)
        root = surf.open(W, pg)
        if plant:
            safe_evaluate(pg, PLANT_DEADCLICK_JS, root)
        rec.setdefault("noise", []).append(idle_noise(W, pg, tap))
        keys = sorted({c["key"] for c in (safe_evaluate(pg, CONTROLS_JS, root) or [])})
        return pg, tap, root, keys, safe_evaluate(pg, LS_JS)

    try:
        pg, tap, root, keys0, ls0 = fresh()
    except Exception as e:  # noqa: BLE001
        rec.update(status="UNREACHED", reason=f"{type(e).__name__}: {e}"[:300])
        if holder["ctx"] is not None:
            holder["ctx"].close()
        progress()
        return rec
    listing = safe_evaluate(pg, CONTROLS_JS, root) or []
    if plant:
        listing = [c for c in listing if c["name"].startswith("Planted")]
    rec["enumerated"] = len(listing)
    rec["capped"] = max(0, len(listing) - MAX_CONTROLS)
    progress()
    for c in listing[:MAX_CONTROLS]:
        row = {k: c[k] for k in ("key", "nth", "tag", "role", "name", "field", "box")}
        if c["disabled"]:
            row["verdict"] = "DISABLED"
            rec["controls"].append(row)
            progress()
            continue
        if SESSION_ENDING.search(c["name"]):
            row.update(verdict="SKIPPED", reason="ends the session")
            rec["controls"].append(row)
            progress()
            continue
        if c["tag"] == "A" and c["href"].startswith("#") and re.match(r"(?i)skip\b", c["name"]):
            row.update(verdict="SKIPPED", reason="a skip link: its door is the keyboard (shown on focus)")
            rec["controls"].append(row)
            progress()
            continue
        r = _click_or_timeout(W, pg, tap, root, c, surf, mode)
        if not r.get("reset"):
            try:
                keys1 = sorted({x["key"] for x in (safe_evaluate(pg, CONTROLS_JS, root) or [])})
                if keys1 != keys0 or safe_evaluate(pg, LS_JS) != ls0:
                    r["reset"] = True
                    r["state_left_changed"] = True
            except Exception:  # noqa: BLE001
                r["reset"] = True
        row.update({k: v for k, v in r.items() if k != "reset"})
        rec["controls"].append(row)
        progress()
        if r.get("reset"):
            rec["resets"] += 1
            try:
                pg, tap, root, keys0, ls0 = fresh()
            except Exception as e:  # noqa: BLE001
                rec["aborted"] = f"could not reopen the surface: {type(e).__name__}: {e}"[:300]
                progress()
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
    progress()
    return rec


def deadclick_surface_bounded(W: World, surf: Surface, mode: str, *, plant: bool = False,
                               deadline: float = SURFACE_DEADLINE_S) -> dict:
    """`deadclick_surface`, run in a CHILD OS PROCESS with a wall-clock ceiling the PARENT
    enforces by killing that process -- never by touching its Playwright objects from a second
    THREAD, the exact defect the comment above this section documents ("Cannot switch to a
    different thread"). A process boundary carries no such rule: this function starts the child
    (`--deadclick-worker`, see `_deadclick_worker_main`), waits on it, and reads the JSON file it
    wrote -- nothing here ever calls a method on a Playwright object the child created, so a hard
    kill at the deadline is safe regardless of what the child's one thread is doing, including a
    renderer wedged at the native level that even `safe_evaluate`'s JS-side timer cannot catch.

    The child reuses the PARENT's already-seeded accounts and fixtures (`W.fx`/`W.states`,
    written to `--worker-in`) rather than re-running `seed()` -- signups are rate-limited 21s
    apart, so re-seeding per surface would multiply the whole walk's wall time by the surface
    count for no benefit. The child flushes its record to `--worker-out` after every control, so
    a hard kill still salvages whatever it had already measured -- the same contract the old
    thread-based `handle['rec']` used to provide, now surviving an OS-level kill rather than
    depending on a thread that shares memory with the one being killed."""
    seed_path = out_path = None
    started = time.monotonic()
    try:
        fd, name = tempfile.mkstemp(prefix="nbwalk-seed-", suffix=".json")
        os.close(fd)
        seed_path = Path(name)
        seed_path.write_text(json.dumps({"base": W.base, "fx": W.fx, "states": W.states},
                                         ensure_ascii=False, default=str), encoding="utf-8")
        fd, name = tempfile.mkstemp(prefix="nbwalk-out-", suffix=".json")
        os.close(fd)
        out_path = Path(name)
        out_path.unlink(missing_ok=True)   # the child writes this; its absence at the end is real
        cmd = [sys.executable, str(Path(__file__).resolve()), "--deadclick-worker",
               "--worker-surface", surf.sid, "--worker-mode", mode,
               "--worker-in", str(seed_path), "--worker-out", str(out_path),
               "--worker-art", str(W.art)]
        if plant:
            cmd.append("--worker-plant")
        kw = ({"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt"
              else {"start_new_session": True})
        proc = subprocess.Popen(cmd, cwd=str(REPO), stdout=subprocess.DEVNULL,
                                 stderr=subprocess.PIPE, text=True, **kw)
        timed_out, stderr_tail = False, ""
        try:
            _, stderr_out = proc.communicate(timeout=deadline)
            stderr_tail = (stderr_out or "")[-800:]
        except subprocess.TimeoutExpired:
            timed_out = True
            _kill_process_tree(proc.pid)
            try:
                proc.communicate(timeout=15)
            except Exception:  # noqa: BLE001
                pass
        elapsed = round(time.monotonic() - started, 1)
        rec = None
        if out_path.exists():
            try:
                rec = json.loads(out_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                rec = None
        if rec is None:
            rec = {"surface": surf.sid, "mode": mode, "manifest": list(surf.manifest), "controls": []}
        if timed_out:
            rec["status"] = "TIMEOUT"
            rec["reason"] = (f"exceeded the {deadline:.0f}s per-surface budget "
                              f"(its process was force-closed so the sweep could continue)")
            rec["elapsed_s"] = elapsed
        elif rec.get("status") not in ("MEASURED", "UNREACHED"):
            # the worker exited (whatever its returncode) without ever reaching a terminal status
            # of its own -- a crash, never silently promoted to a MEASURED that never happened
            rec["status"] = "ERROR"
            rec.setdefault("reason", f"the worker process ended (rc {proc.returncode}) without a "
                                      f"terminal status" + (f"; stderr: {stderr_tail}" if stderr_tail else ""))
            rec["elapsed_s"] = elapsed
        return rec
    finally:
        for p in (seed_path, out_path):
            try:
                if p is not None:
                    p.unlink(missing_ok=True)
            except OSError:
                pass


def deadclick_sweep(W: World, only: list[str]) -> dict:
    out = {"telemetry_never_evidence": list(TELEMETRY_PATHS), "surfaces": [], "controls": {}}
    ctl = deadclick_surface_bounded(W, surface_by_id("nb-list"), "desk", plant=True)
    names = {"Planted dead styled control": "plant-dead-styled", "Planted dead control": "plant-dead",
             "Planted live control": "plant-live"}
    got = {}
    for r in ctl["controls"]:
        for label, cid in names.items():
            if r["name"].startswith(label) and cid not in got:
                got[cid] = r["verdict"]
                break
    # ⛔ NON-VACUITY: the planted poller must actually have fired inside a dead plant's click
    # window. Otherwise "DEAD, DEAD" proves nothing about the background-request fix.
    polled = [r for r in ctl["controls"] if r["name"].startswith("Planted dead")
              and any("/api/proof-plant/poll" in b for b in (r.get("background_ignored") or []))]
    got["plant-poller"] = "IN-WINDOW" if polled else "NOT-SEEN"
    ok, why = control_ok("deadclick", got)
    out["controls"] = {"got": got, "ok": ok, "why": why, "raw": ctl}
    say(f"[{'VALID' if ok else 'INVALID'}] deadclick control: {why}")
    dump("deadclick", out)
    for surf in SURFACES:
        if "deadclick" not in surf.sweeps or not wanted(surf, only):
            continue
        for mode in surf.modes:
            rec = deadclick_surface_bounded(W, surf, mode)
            out["surfaces"].append(rec)
            say(f"[{rec.get('status')}] deadclick {surf.sid} ({mode}): {rec.get('counts') or rec.get('reason', '')}")
            dump("deadclick", out)
    out["noise_endpoints"] = sorted(W.noise_endpoints)
    dump("deadclick", out)
    return out


def _deadclick_worker_main(args) -> int:
    """The per-surface deadclick CHILD `deadclick_surface_bounded` spawns (`--deadclick-worker`):
    its own `sync_playwright()`, its own browser, its own OS process -- so the parent can hard-
    kill it at the deadline without ever touching a Playwright object from a second thread. Reads
    the parent's already-seeded fixtures and account storage_state (`--worker-in`, JSON; never
    re-runs `seed()` -- see `deadclick_surface_bounded`'s docstring for why), measures exactly one
    surface x mode, and writes its record to `--worker-out` after EVERY control so a hard kill
    still salvages whatever ran before the deadline."""
    from playwright.sync_api import sync_playwright
    surf = surface_by_id(args.worker_surface)
    out_path = Path(args.worker_out)
    seeded = json.loads(Path(args.worker_in).read_text(encoding="utf-8"))

    def flush(rec: dict) -> None:
        tmp = out_path.with_name(out_path.name + ".tmp")
        tmp.write_text(json.dumps(rec, ensure_ascii=False, default=str), encoding="utf-8", newline="\n")
        os.replace(tmp, out_path)

    flush({"surface": surf.sid, "mode": args.worker_mode, "manifest": list(surf.manifest),
           "controls": [], "resets": 0, "prefs_restored": [], "status": "IN-PROGRESS"})
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            try:
                Wc = World(browser, seeded["base"], Path(args.worker_art))
                Wc.fx = seeded.get("fx") or {}
                Wc.states = seeded.get("states") or {}
                Wc.admin_login()
                rec = deadclick_surface(Wc, surf, args.worker_mode, plant=bool(args.worker_plant),
                                         on_progress=flush)
            finally:
                browser.close()
    except Exception as e:  # noqa: BLE001 -- the parent still reads whatever this flushed first
        try:
            existing = json.loads(out_path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            existing = {"surface": surf.sid, "mode": args.worker_mode, "manifest": list(surf.manifest),
                        "controls": []}
        existing["status"] = "ERROR"
        existing["reason"] = f"{type(e).__name__}: {e}"[:300]
        flush(existing)
        return 1
    flush(rec)
    return 0


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


def _act_more_menu_click(name, exact=True):
    """Like `_act_click`, but for a WRITE_ACTIONS entry whose button lives in the editor's
    "More note actions" overflow (NoteMoreMenu.jsx) rather than on the bare note page --
    Lock/Archive/Save as template, same as `f_note_btn`/`f_save_template` in the census sweep
    (clause 5d, wave 10 lane WK3). `surface_by_id("nb-note").open()` is `s_note`, which never
    opens that menu, so a bare `_act_click` timed out waiting for a button that was never
    shown -- the 5d README's "lock"/"archive"/"save-template" UNREACHED writes. Not a feature's
    own door (mirrors `open_more_note_actions`' own contract): opening the menu is not the write
    itself, so a write that genuinely disappeared from the menu still reads UNREACHED here, not
    silently NO-WRITE."""
    def act(W, pg):
        open_more_note_actions(pg)
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
    """Wave 10 lane WK4 (5d): the ConfirmModal's own "Delete" is not always the whole door.
    `onDeleteConfirm` (NoteEditorPage.jsx) asks the local durable store first
    (`noteHasUnsentWork`) and, when the note reads as still holding words the server does not
    have, opens a SECOND dialog (UnsentTrashDialog, "Trash anyway") instead of trashing --
    found live tracing WK3's `trash-note` NO-WRITE: the probe's one click landed on a
    ConfirmModal that never fires the DELETE request on that branch, so nothing was ever
    silently missed downstream, the probe itself stopped one dialog short of the real door."""
    press(pg, pg.locator(POPUP).get_by_role("button", name=re.compile(r"^(Delete|Move to Trash)", re.I)).last)
    again = pg.get_by_role("button", name="Trash anyway", exact=True).filter(visible=True)
    try:
        again.first.wait_for(state="visible", timeout=2500)
    except Exception:  # noqa: BLE001 -- the ordinary path: the first Delete already trashed it
        return
    press(pg, again.first)


def _act_save_template(W, pg):
    """Wave 10 lane WK4 (5d/G-155): "Save as template" (NoteMenuActions.jsx) does not itself
    write -- it only REVEALS an inline name form (`templateDraft`, defaulting to the note's
    title), and the POST fires on that form's own submit. `_act_more_menu_click` stopped at
    the reveal, which is exactly WK3's `save-template` NO-WRITE: the button this probe pressed
    never sends a request on any branch, so there was nothing for the forced-failure sweep to
    force. Drive the submit too."""
    open_more_note_actions(pg)
    press(pg, pg.get_by_role("button", name="Save as template", exact=True).first)
    inp = pg.get_by_label("Template name")
    inp.wait_for(state="visible", timeout=6000)
    press(pg, pg.get_by_role("button", name="Save template", exact=True).first)


def _act_create_link(W, pg):
    press(pg, pg.locator(POPUP).get_by_role("button", name="Create link").first)


WRITE_ACTIONS = (
    ("save-body", "nb-note", _act_type),
    ("add-tag", "nb-note", _act_tag),
    ("favorite", "nb-note", _act_click("Add to Favorites")),
    ("lock", "nb-note", _act_more_menu_click("Lock")),
    ("archive", "nb-note", _act_more_menu_click("Archive")),
    ("save-template", "nb-note", _act_save_template),
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
    exempt_verdict(row, methods[0], ep)
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
    mark_root(pg, expect_editor=True)
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


def open_format_more(pg, door: str | None = None) -> bool:
    """On the touch tier, ALL FOUR toolbar `.formatRun` groups (font/size/colour, headings,
    blockquote/code/links/images/files, and more -- lane D3P, one "Format" disclosure controls
    all four via one `aria-controls`) sit behind that single disclosure below 640px
    (NoteEditorPage.jsx `formatToggle`/`data-format-open`); at <=640 they are not VISIBLE at
    all until it opens. `.formatToggle` itself is `display:none` above 640px (base rule), so
    this is a safe no-op at desktop/tablet widths -- callers with a known non-touch door still
    pass door="desktop"/"keyboard" to skip the lookup outright; callers with no width context
    (a Surface's own `open()`) pass nothing and let the toggle's own absence decide.

    Found live (wave 10 lane WK2): with the root-scoping fix (clause a) landed, G-160
    (OCR/text from images and docx) still read touch=NO-DOOR, and G-159 (Camera scan with OCR,
    touch-only) was in WK's own "believed genuine" NO-DOOR list -- both reach for their
    toolbar button directly and neither opened this disclosure first. The SAME gap sat behind
    three more UNREACHED surfaces this lane's live full run then found (axe: ed-history/
    ed-export/ed-delete UNREACHED at all 3 themes; geometry: the same three plus ed-color at
    390) -- their Surface `open()` functions (`s_ed_history` etc.) reach directly for a button
    that is a `.formatRun` member too, at the one width where it is collapsed.

    Not a feature's own door (mirrors focus_editor()): never sets door_used, so a control
    genuinely missing AFTER this opens still reads NO-DOOR, not StepMissing."""
    if door is not None and door != "touch":
        return False
    toggle = pg.get_by_role("button", name="Format", exact=True).filter(visible=True).first
    if not toggle.count():
        return False
    if toggle.get_attribute("aria-expanded") == "true":
        return False
    if is_touch(pg):
        toggle.tap(timeout=4000)
    else:
        toggle.click(timeout=4000)
    pg.wait_for_timeout(300)
    return True


def open_more_note_actions(pg) -> bool:
    """The editor's "More note actions" disclosure (NoteMoreMenu.jsx) -- Duplicate, Lock,
    Archive, Save as template, Open a note beside, the file doors, the word count, and Delete
    LAST -- is `hidden={!open}` until this button opens it, at EVERY width (unlike
    `open_format_more`'s phone-only toggle: this one is the door's own overflow menu, not a
    responsive collapse). Found live (wave 10 lane WK2): `s_ed_history`/`s_ed_export`/
    `s_ed_delete` reach directly for "Version history"/"Export"/"Delete" and time out --
    exactly WK's own 5d UNREACHED-write note ("Lock"/"Archive"/"Save as template"/"Delete" each
    sit in this menu) and the same-shaped axe/geometry UNREACHED this lane's own full run
    found for the read side. Not a feature's own door: never sets door_used."""
    toggle = pg.get_by_role("button", name="More note actions", exact=True).filter(visible=True).first
    if not toggle.count():
        return False
    if toggle.get_attribute("aria-expanded") == "true":
        return False
    if is_touch(pg):
        toggle.tap(timeout=4000)
    else:
        toggle.click(timeout=4000)
    pg.wait_for_timeout(300)
    return True


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
    open_format_more(pg, door)   # phone-only: "Text color and highlight" is a `.formatRun` member (G-131)
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
    """Owner ruling D-3 (wave 10) moved word count + reading time off the bare note page and
    into the editor's "More note actions" menu (NoteMoreMenu.jsx, `<NoteStats>` rendered as its
    child, `hidden={!open}` until the disclosure opens). Checking the page directly -- what this
    probe did before -- always reads NO-DOOR on all 3 doors now; that is an instrument gap (WK,
    wave 10), not a missing feature. Open the door first, by mouse, tap or keyboard alike."""
    pg, nid = c_note(W, door)
    how = use(pg, door, btn(pg, "More note actions"))
    ok = wait_true(lambda: pg.get_by_text(re.compile(r"\b\d[\d,]* words?\b")).filter(visible=True).count() > 0, 5)
    if not ok:
        raise NoDoor("the More note actions menu opened but no word count is shown inside it")
    return how + "; shown in the More note actions menu"


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
        open_more_note_actions(pg)   # "Archive"/"Lock" (G-150/G-151) live in NoteMoreMenu at EVERY width
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
    open_more_note_actions(pg)   # "Open a note beside" (G-152) lives in NoteMoreMenu at EVERY width
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
    """G-155 (wave 10 lane WK4): the prior check -- "template" appears anywhere on the page --
    was satisfied by the still-OPEN "Save as template" disclosure's own label (NoteMenuActions.jsx
    reveals an inline `templateDraft` form on that click; nothing is written until the form is
    submitted), so a menu that opens and a template that saves were indistinguishable to this
    probe. The independent signal is the member's own template list: GET /api/j2/note-templates
    carries a row this run made, named for the note it copied."""
    title = f"Tmpl {door} {W.run} {time.time():.0f}"
    pg, nid = c_note(W, door, title=title)
    open_more_note_actions(pg)   # "Save as template" (G-155) lives in NoteMoreMenu at EVERY width
    how = use(pg, door, btn(pg, "Save as template"))
    inp = pg.get_by_label("Template name")
    inp.wait_for(state="visible", timeout=6000)
    if door == "keyboard":
        pg.keyboard.press("Enter")   # the autofocused draft input submits its own <form>
        how += "; Enter (submits the template-name field)"
    else:
        how += "; " + use(pg, door, pg.get_by_role("button", name="Save template", exact=True).first)
    ok = wait_true(lambda: any(
        t.get("title") == title or t.get("name") == title
        for t in (W.api().get(W.base + "/api/j2/note-templates").json().get("templates") or [])), 8)
    must(ok, f"GET /api/j2/note-templates lists no template named {title!r} after Save as template")
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
    open_format_more(pg, door)
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
    open_format_more(pg, door)
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
    open_more_note_actions(pg)   # "Export" (G-169) lives in NoteMoreMenu at EVERY width
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


def _first_run_tour_seen(tour_loc, timeout_ms: float = 1500) -> bool:
    """Wave 10 lane WK4 (G-171, diagnosed by lane FX2 -- docs/notebook/proof/fx2-788f3a439/
    item1-g171-keyboard/): whether the first-run tour dialog actually opened THIS run --
    WAITED for, never sampled once. `f_first_run` used to read `tour.count() > 0`
    immediately after ResearchHome's own "Welcome to your Notebook" heading became
    visible; the heading renders at ~386ms live and the tour DIALOG lazy-loads at
    ~1074ms, so that immediate sample read the dialog as absent on every single run,
    skipped the Skip-tour dismiss branch, and let the tour open a moment later and
    correctly trap keyboard focus (Skip<->Next) around "Add a sample notebook" --
    which a keyboard door can then never Tab to. That is exactly G-171's own reading,
    every run of this program: "not reached with Tab in 220 presses" -- a PROBE RACE,
    not a product defect. A timeout here (the dialog genuinely never opens) is the
    honest negative, not a hang: it is bounded by `timeout_ms`, never indefinite."""
    try:
        tour_loc.wait_for(state="visible", timeout=timeout_ms)
        return True
    except Exception:  # noqa: BLE001 -- the timeout IS the answer: it did not auto-open
        return False


def f_first_run(W, door):
    acct = W.fresh_account()
    pg, tap = W.page(acct, DOOR_MODE[door])
    goto(W, pg, "/journal/notebook")
    mark_root(pg)
    pg.get_by_text("Welcome to your Notebook").filter(visible=True).first.wait_for(state="visible", timeout=15000)
    tour = pg.get_by_role("dialog", name=re.compile("Welcome to your Notebook")).filter(visible=True).first
    tour_seen = _first_run_tour_seen(tour)
    skip = pg.get_by_role("button", name="Skip tour").filter(visible=True).first
    if tour_seen:
        try:
            skip.wait_for(state="visible", timeout=1500)
        except Exception:  # noqa: BLE001 -- the dialog opened but its own Skip button never did
            pass
    if tour_seen and skip.count():
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


def _axe_core_path() -> Path:
    """The repo's exact-pinned axe-core build (`app/package.json`'s `axe-core` devDependency,
    checked by `test_axe_is_the_repo_s_exact_pin`). `NOTEBOOK_PROOF_WALK_AXE_CORE` is a
    read-only escape hatch for a worktree whose `app/node_modules` is a JUNCTION into another
    lane's install that predates axe-core's introduction to this program (wave 10 lane WK3,
    measured live: the junction target had no `axe-core` directory at all, so EVERY sweep --
    not just axe -- failed before seeding, since this path is read unconditionally at the top
    of `run_sweeps`). Never written by this tool. Unset (the default, every other worktree
    whose junction already carries the pin) resolves the identical path as before."""
    override = os.environ.get("NOTEBOOK_PROOF_WALK_AXE_CORE")
    return Path(override) if override else REPO / "app" / "node_modules" / "axe-core" / "axe.min.js"


def run_sweeps(base: str, art: Path, sweeps: list[str], only: list[str]) -> None:
    from playwright.sync_api import sync_playwright
    axe_path = _axe_core_path()
    axe_src = axe_path.read_text(encoding="utf-8")
    axe_rel = str(axe_path.relative_to(REPO)) if REPO in axe_path.resolve().parents else str(axe_path)
    res["axe_core"] = {"path": axe_rel, "bytes": len(axe_src)}
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
    # internal: the per-surface deadclick child `deadclick_surface_bounded` spawns -- never a
    # human-facing flag, see `_deadclick_worker_main`
    ap.add_argument("--deadclick-worker", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--worker-surface", help=argparse.SUPPRESS)
    ap.add_argument("--worker-mode", default="desk", help=argparse.SUPPRESS)
    ap.add_argument("--worker-plant", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--worker-in", help=argparse.SUPPRESS)
    ap.add_argument("--worker-out", help=argparse.SUPPRESS)
    ap.add_argument("--worker-art", help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    if args.deadclick_worker:
        return _deadclick_worker_main(args)
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
