"""The UNATTENDED vendor batch — steps 1-12 of VENDOR-HARNESS.md, per script, no keyboard.

    python tools/vendor_harness/batch_capture.py --self-check        # the whole loop vs a recording double
    python tools/vendor_harness/batch_capture.py recon               # sign-in + READ-ONLY readings
    python tools/vendor_harness/batch_capture.py run [--limit 1]     # the batch (resumable)
    python tools/vendor_harness/batch_capture.py grade --run-dir D   # verdicts.json + summary.md

⛔⛔ WHAT IT IS. `docs/pine/VENDOR-HARNESS.md` has a 13-step MANUAL capture. This
drives steps 1-12 of it for every script in a manifest (`batch_manifest.py`
derives one from what the member door can build), in the SESSION-OWNED browser
of `tools/pine_vendor_capture.py`: the owner signs in ONCE, at the keyboard, in
the window this tool opens, and every later step is this process.

⛔⛔ WHAT IT NEVER DOES, and each is structural, not a promise:
  * reads, types, stores or logs a credential — sign-in is `acquire()` from
    `pine_vendor_capture.py`, which waits for the SERVER to say the layout opens
    (403 "Chart Not Found" -> 200). There is no `fill`, no `type`, no text entry
    anywhere in this file (`tests/test_vendor_batch_capture.py` greps for them).
  * touches the owner's own Chrome or its profile — the profile is
    `resolve_profile()`'s (refused inside a git worktree) and is additionally
    refused if it resolves inside Chrome's or Edge's own `User Data`.
  * opens an account-scoped user script for writing — every script goes into a
    fresh `Create new > Indicator` buffer, and the add is gated on the corrected
    BINDING GATE (own-text `Add to chart` exactly once, `Update on chart` never),
    checked in Python AND again inside the same page evaluation as the click.
    A gate that refuses NEVER clicks.
  * saves anything, or calls `chart.exportData()` (plan-gated).
  * records the account name, or an unsalted hash of it: provenance keeps HMAC-SHA256 of the
    name under a LOCAL salt (`$UCT_PROVENANCE_SALT`, >= 16 characters), or `no-salt` without one.
  * paces below 10 s between scripts, or by a non-finite value (`throttle_refusal`).

⭐ OUTCOMES ARE FOUR, AND THEY ARE DIFFERENT FACTS:
  CAPTURED       a capture file written by `verify_capture.mjs --assemble`, exit 0
                 and `VERDICT: PASS`, read back and re-verified
  REFUSED_BY_TV  TradingView would not run the script — its own message recorded
  GATE_FAILED    a gate this tool owes refused (visibility, scratch layout not
                 empty, binding, buffer receipt, census) — nothing was clicked
                 past the gate
  INCONCLUSIVE   could not measure (timeout, unreadable model, a UI step not
                 found, verify refused the transport). Never a pass, never a fail.
and one more that only a crash can leave: INCOMPLETE — the result file is CLAIMED
(written INCOMPLETE) before the first step, so a killed process leaves an
explicit INCOMPLETE, never a stale pass.

⭐ RESUMABLE. Per run: `ledger.jsonl` (append-only, fsynced), `results/<slug>.json`
(the per-script state, atomically replaced), `captures/`, `scratch/<slug>/` (the
chunks, verbatim). Re-running with the same `--run-dir` skips a script whose
CAPTURED file still verifies (and a REFUSED_BY_TV one unless asked), and retries
INCOMPLETE / INCONCLUSIVE / GATE_FAILED.

⚠️ NOT YET RUN AGAINST LIVE TRADINGVIEW. Every page step is exercised by
`--self-check` and `tests/test_vendor_batch_capture.py` against a recording double
(`batch_double.py`). The two UI steps no double can vouch for — the script-title
menu (`Create new > Indicator`) and the Pine editor's open state — verify their
EFFECT (a fresh Monaco model; the binding gate), so a miss is INCONCLUSIVE or
GATE_FAILED and never a wrong click. Run `recon` first; it prints every reading.

Exit codes (run): 0 every script has a terminal result · 1 a MEASURED rig problem
(the scratch layout was not empty, cleanup left the chart dirty) · 2 INCONCLUSIVE
(no sign-in, the browser went away, a batch-level step could not be read).
"""
from __future__ import annotations

import argparse
import base64
import copy
import datetime as _dt
import hashlib
import hmac
import io
import json
import math
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import time

REPO = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools"))

# ⭐ ONE GATE AUTHORITY, ONE SIGN-IN AUTHORITY: imported, never copied.
from pine_vendor_capture import (  # noqa: E402
    BINDING_JS, LAYOUT, _profile_holders, acquire, layout_access, resolve_profile,
)
from pine_member_pane_capture import TIERS, _gate  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from evidence_ledger import CAPTURE_PHASES  # noqa: E402 — the ONE phase vocabulary: imported, never restated

TV_CAPTURE = HERE / "tv_capture.js"
VERIFY = HERE / "verify_capture.mjs"
DEFAULT_MANIFEST = REPO / "docs" / "pine" / "vendor-harness" / "batch-manifest.json"
CORPUS_TEST = "src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js"
DEFAULT_RUN_ROOT = pathlib.Path(
    os.environ.get("LOCALAPPDATA") or os.environ.get("TEMP") or "/tmp") / "uct-vendor-batch" / "runs"

CAPTURED = "CAPTURED"
REFUSED_BY_TV = "REFUSED_BY_TV"
GATE_FAILED = "GATE_FAILED"
#: ⭐⭐ THE RIG'S PERSISTED STATE (coordinator, 2026-11-18): the batch's exit code when the rig layout, read on a
#: FRESH load at the batch's end, carries a study or is not at the symbol / resolution the batch found. Every capture
#: may still be good; the NEXT batch's gate would stop on the rig. (See `Driver.verify_fresh_load`.)
RIG_DIRTY = 3
INCONCLUSIVE = "INCONCLUSIVE"
INCOMPLETE = "INCOMPLETE"
OUTCOMES = (CAPTURED, REFUSED_BY_TV, GATE_FAILED, INCONCLUSIVE, INCOMPLETE)
DEFAULT_RETRY = (INCOMPLETE, INCONCLUSIVE, GATE_FAILED)
#: The pause between scripts may be lowered, never below this: it is the owner's own account.
MIN_THROTTLE_S = 10.0
#: The LOCAL secret that salts the account fingerprint (never committed, never printed). A bare sha256
#: of a public username is a lookup table, not a fingerprint: anyone can hash a candidate name and
#: compare. Unset or shorter than MIN_SALT_CHARS -> the account is not fingerprinted (`no-salt`).
PROVENANCE_SALT_ENV = "UCT_PROVENANCE_SALT"
MIN_SALT_CHARS = 16

#: ⭐⭐ THE CONTROL PLOT a probe draws its own `bar_index` in (`I00_bar_index_CONTROL`, `F00_bar_index_CONTROL`, or a
#: plot titled `bar_index`). ⛔ Never a request's bar_index (`F12_W_bar_index_OFF` reads ANOTHER timeframe's index).
BAR_INDEX_CONTROL_RX = re.compile(r"(?:^|_)bar_index_CONTROL$|^bar_index$")


def starts_at_bar0_contradiction(capture: dict, symbol: str):
    """⭐⭐ (coordinator, 2026-11-19) Why the capture's OWN data refutes its `history.startsAtBar0` claim, or None. A capture
    that does not claim it is never refuted. Refuted when:
      1. the claim's `why` names a symbol that is not the chart's (`symbol.pro_name`), or the batch asserted it for
         another symbol (`symbol`): the 2026-09-27 wave wrote RDDT's listing on SPY / AAPL charts;
      2. a bar_index CONTROL plot reads anything but 0 on the capture's first row (vw-int-cast-spy-1d-2026-09-27 read
         8172 there: its history starts deep, not at bar 0)."""
    hist = (capture or {}).get("history") or {}
    if hist.get("startsAtBar0") is not True:
        return None
    sym = (capture.get("symbol") or {})
    pro = sym.get("pro_name") or sym.get("full_name") or ""
    if symbol and pro and not sym_match(pro, symbol):
        return f"it was asserted for {symbol}, and the chart is {pro}"
    why = str(hist.get("why") or "")
    named = re.match(r"\s*([A-Z0-9_.!]+:[A-Z0-9_.!]+)\s+listed\b", why)
    if named and pro and not sym_match(pro, named.group(1)):
        return f"its why names {named.group(1)}, and the chart is {pro}: {why[:120]!r}"
    plots = {p.get("id"): p.get("title") for p in ((capture.get("study") or {}).get("plots") or []) if isinstance(p, dict)}
    pv = capture.get("plotValues") or {}
    fields, rows = pv.get("fields") or [], pv.get("rows") or []
    if rows and fields:
        for col, pid in enumerate(fields):
            title = plots.get(pid)
            if not title or not BAR_INDEX_CONTROL_RX.search(str(title)):
                continue
            first = rows[0][col] if col < len(rows[0]) else None
            if isinstance(first, (int, float)) and first != 0:
                return f"its bar_index control plot {title!r} reads {first:g} on the capture's first row, not 0"
    return None


#: ⭐⭐ The listing date's SOURCE (coordinator ruling 2026-11-20): UCT production's own answer, read as the automation account
#: through the rig's browser context (`Driver.listing_for`). The table below is a CROSS-CHECK that must agree.
UCT_ORIGIN = "https://uctintelligence.com"
_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def uct_ticker_of(symbol) -> str:
    """Our store's ticker for a TradingView symbol: the part after the exchange, a class share's dot as a hyphen
    (`NYSE:BRK.B` -> `BRK-B`, the bars route's own spelling)."""
    return str(symbol or "").split(":")[-1].strip().upper().replace(".", "-")


def _json_of(resp):
    try:
        return json.loads(resp.text())
    except Exception:  # noqa: BLE001 -- an unreadable body is no answer
        return None


def uct_first_trade_date(page, symbol):
    """(date | None, why): `/api/ticker-ipo/<T>`'s `first_trade_date` when `first_trade_final` is true, read through the
    page's own browser context. ONE GET of a PUBLIC endpoint (measured 2026-11-20: it answers without a session), so
    the capture profile, which holds no UCT session, reads it without signing in as anyone. Never raises: a lookup that
    cannot answer is no listing date, with the reason."""
    try:
        req = page.context.request
        t = uct_ticker_of(symbol)
        r = req.get(f"{UCT_ORIGIN}/api/ticker-ipo/{t}")
        body = _json_of(r) if getattr(r, "status", 200) == 200 else None
        if not isinstance(body, dict):
            return None, f"/api/ticker-ipo/{t} answered {getattr(r, 'status', '?')}"
        day = body.get("first_trade_date")
        if body.get("first_trade_final") is not True or not isinstance(day, str) or not _ISO_DAY.match(day):
            return None, f"/api/ticker-ipo/{t} holds no FINAL first trade date ({body.get('first_trade_final')!r}, {day!r})"
        return day, f"/api/ticker-ipo/{t}: first trade {day} (final)"
    except Exception as exc:  # noqa: BLE001
        return None, f"the listing date could not be read ({type(exc).__name__}: {exc})"


#: Listing days this tool may assert `startsAtBar0` against. A young listing is
#: the instrument (capture-procedure.md, "BAR 0 IS NOT REACHABLE ON A LONG-HISTORY
#: SYMBOL"): the flag is asserted ONLY when the loaded history stopped growing AND
#: its first bar falls on this date in the exchange's own timezone.
KNOWN_LISTING = {
    "NYSE:RDDT": "2024-03-21",
    # Q-SD2 (2026-11-17): two sources agree, our /api/bars/ALAB?tf=D first bar and TradingView's first NASDAQ:ALAB 1D bar.
    "NASDAQ:ALAB": "2024-03-20",
}


# ─── outcomes ────────────────────────────────────────────────────────────────
class StepOutcome(Exception):
    outcome = INCONCLUSIVE

    def __init__(self, reason, detail=None, abort=False):
        super().__init__(reason)
        self.reason = reason
        self.detail = detail
        self.abort = abort


class RefusedByTV(StepOutcome):
    outcome = REFUSED_BY_TV


class GateFailed(StepOutcome):
    outcome = GATE_FAILED


class Inconclusive(StepOutcome):
    outcome = INCONCLUSIVE


def _is_target_closed(exc) -> bool:
    return "TargetClosed" in type(exc).__name__ or "has been closed" in str(exc)


# ─── the page snippets ───────────────────────────────────────────────────────
# ⛔ Every one is READ-ONLY unless its name says otherwise, and every write
# re-asserts its gate inside the same evaluation.

_CHART = r"""
  const tryv = (f, d = null) => { try { const v = f(); return v === undefined ? d : v } catch (e) { return d } };
  const chartOf = () => {
    for (const n of ['TradingViewApi', 'tvWidget', 'widget']) {
      const w = window[n];
      try { const c = w && typeof w.activeChart === 'function' ? w.activeChart() : null; if (c) return { n, c } } catch (e) {}
    }
    return null;
  };"""

_MONACO = r"""
  const monacoOf = () => {
    if (window.monaco && window.monaco.editor && typeof window.monaco.editor.getEditors === 'function') return { M: window.monaco, seen: -1 };
    const ck = Object.keys(window).find((k) => /^webpackChunk/.test(k));
    if (!ck) return { err: 'no webpackChunk registry on window', seen: 0 };
    let req; window[ck].push([[Symbol('uctvh')], {}, (r) => { req = r }]);
    let seen = 0; const ids = [];
    for (const c of window[ck]) if (c && c[1]) for (const id of Object.keys(c[1])) {
      seen += 1; const s = String(c[1][id]); if (s.includes('getEditors') && s.includes('createModel')) ids.push(id);
    }
    if (!req) return { err: 'webpack require was not captured', seen };
    for (const id of ids) {
      try {
        const m = req(id);
        for (const v of [m, ...Object.values(m || {})]) if (v && v.editor && typeof v.editor.getEditors === 'function' && v.Uri) return { M: v, seen, id };
      } catch (e) {}
    }
    return { err: 'the Monaco namespace was not found by the module scan', seen, candidates: ids.length };
  };"""

#: symbol, resolution, study roster, pane stretch factors (capture-procedure.md,
#: "Leaving the chart as you found it").
STATE_JS = "() => {" + _CHART + r"""
  const h = chartOf();
  if (!h) return { handle: null, vis: document.visibilityState };
  const c = h.c;
  return {
    handle: h.n, vis: document.visibilityState,
    symbol: tryv(() => c.symbol()), resolution: tryv(() => c.resolution()),
    studies: tryv(() => c.getAllStudies().map((s) => ({ id: s.id, name: s.name }))),
    panes: tryv(() => c.getPanes().map((p) => (typeof p.getStretchFactor === 'function' ? p.getStretchFactor() : null))),
  };
}"""

#: WRITE (chart state, not the account): one setter per call — the J2 discipline
#: sets, then the caller ASSERTS the read-back before touching anything else.
SET_SYMBOL_JS = "(s) => {" + _CHART + r"""
  const h = chartOf(); if (!h) return { ok: false, why: 'no chart handle' };
  try { h.c.setSymbol(s); return { ok: true } } catch (e) { return { ok: false, why: String(e) } }
}"""
SET_RESOLUTION_JS = "(r) => {" + _CHART + r"""
  const h = chartOf(); if (!h) return { ok: false, why: 'no chart handle' };
  try { h.c.setResolution(r); return { ok: true } } catch (e) { return { ok: false, why: String(e) } }
}"""
SET_STRETCH_JS = "(f) => {" + _CHART + r"""
  const h = chartOf(); if (!h) return { ok: false };
  const panes = tryv(() => h.c.getPanes(), []);
  f.forEach((x, i) => { if (x !== null && panes[i] && typeof panes[i].setStretchFactor === 'function') tryv(() => panes[i].setStretchFactor(x)) });
  return { ok: true };
}"""

EDITOR_PRESENT_JS = "() => !!document.querySelector('.monaco-editor')"

#: WRITE (UI only): clicks the Pine editor launcher when no editor is present.
OPEN_EDITOR_JS = r"""() => {
  if (document.querySelector('.monaco-editor')) return { open: true, clicked: false };
  const b = document.querySelector('[data-name="pine-dialog-button"]');
  if (!b) return { open: false, clicked: false, why: 'no [data-name="pine-dialog-button"] on the page' };
  b.click(); return { open: false, clicked: true };
}"""

MODELS_JS = "() => {" + _MONACO + r"""
  const f = monacoOf(); if (!f.M) return { ok: false, why: f.err, seen: f.seen };
  return { ok: true, seen: f.seen, uris: f.M.editor.getModels().map((m) => String(m.uri)).filter((u) => u.includes('.pine')) };
}"""

#: The script-title control of TradingView's Pine editor, from `rig_title.js` (one function
#: expression, its leading comment dropped). Returns its CENTRE for a real (CDP) pointer click,
#: never a DOM `.click()`, because the menu opens on pointer events.
#: ⛔ A CAPTURE RUN NEVER CLICKS ANYTHING IT CANNOT NAME (2026-11-16): the finder is an
#: allow-list (a heading whose own text is a script name, exactly one, above the editor), never a
#: fallback over every control. Its old fallback chose "Publish script" and the driver clicked it on
#: the owner's account. Railed over the recorded header in
#: app/src/components/chart/engine/__tests__/vendorHarness/rigTitle.test.js.
_RIG_TITLE_SRC = (HERE / "rig_title.js").read_text(encoding="utf-8")
TITLE_JS = _RIG_TITLE_SRC[_RIG_TITLE_SRC.index("(sel) =>"):].strip()

#: The rig browser's viewport. ⛔ 1760 wide, not the member-pane tool's 1440 desktop tier: at 1440
#: TradingView's Pine editor dialog collapses `Add to chart` to an icon, so the binding gate (which
#: reads the button's own text) counts 0 and every script is refused (measured 2026-11-16).
RIG_VIEWPORT = {"width": 1760, "height": 1000}

#: How long the binding gate waits for the editor header to re-render after `Create new > Indicator`
#: before it decides. Read the instant the fresh model appears, it counted 0 / 0 (2026-11-16).
BINDING_SETTLE_S = 15.0

#: A visible menu row by OWN text; `a.rightOf` picks a submenu row to the right.
MENU_ITEM_JS = r"""(a) => {
  const own = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
  const hits = [...document.querySelectorAll('*')].filter((el) => {
    if (own(el) !== a.text) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
  }).map((el) => el.getBoundingClientRect());
  const ok = a.rightOf ? hits.filter((r) => r.left >= a.rightOf.right - 8) : hits;
  if (!ok.length) return { ok: false, found: hits.length };
  const r = ok[0];
  return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } };
}"""

#: WRITE (the unsaved buffer only), behind the pre-write gate IN THE SAME
#: EVALUATION: visible, and the binding gate true. Returns the read-back's sha256.
SET_SOURCE_JS = "async (a) => {" + _MONACO + r"""
  const gate = (""" + BINDING_JS + r""")();
  const vis = document.visibilityState;
  if (vis !== 'visible' || !gate.gate) return { STOP: true, vis, gate };
  const f = monacoOf(); if (!f.M) return { ok: false, why: f.err, seen: f.seen };
  const ed = f.M.editor.getEditors().find((e) => e.getModel() && String(e.getModel().uri) === a.uri);
  if (!ed) return { ok: false, why: `no editor holds ${a.uri}` };
  const bytes = Uint8Array.from(atob(a.b64), (ch) => ch.charCodeAt(0));
  ed.getModel().setValue(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const back = ed.getModel().getValue();
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(back));
  return { ok: true, seen: f.seen, chars: back.length, sha256: [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('') };
}"""

#: WRITE (adds a study to the scratch layout), gate re-asserted in this
#: evaluation; `STOP` means NOTHING was clicked.
ADD_JS = r"""() => {
  const gate = (""" + BINDING_JS + r""")();
  const vis = document.visibilityState;
  if (vis !== 'visible' || !gate.gate) return { STOP: true, vis, gate };
  const own = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
  const el = [...document.querySelectorAll('button, a, [role="button"], div, span')].find((e) => {
    const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.disabled && own(e) === 'Add to chart';
  });
  if (!el) return { STOP: true, vis, gate, why: 'the gated control vanished before the click' };
  el.click();
  return { clicked: true, vis, gate };
}"""

#: A study's own answer: `status()` (type 3 = compile error, with TradingView's
#: message) and `dataLength()` — the handles capture-procedure.md measured.
STUDY_JS = "(id) => {" + _CHART + r"""
  const h = chartOf(); const si = h ? tryv(() => h.c.getStudyById(id)) : null;
  if (!si) return { found: false };
  const st = tryv(() => si.status());
  const ed = st && st.errorDescription;
  return { found: true, rows: tryv(() => si.dataLength()),
           status: st ? { type: st.type, error: ed ? (ed.error || JSON.stringify(ed)) : null, title: ed ? ed.title || null : null } : null };
}"""

#: ⭐⭐ (coordinator ruling 2026-11-20, (ii)) THE CHART'S RESOLVED SESSION, read-only: what the main series resolved
#: (`symbolInfo().session`, e.g. '0400-2000' extended / '0930-1600' regular for a US listing, and `subsession_id`).
SESSION_JS = r"""() => {
  const col = window._exposed_chartWidgetCollection; if (!col) return { ok: false, why: 'no _exposed_chartWidgetCollection' };
  let si; try { si = col.activeChartWidget.value().model().mainSeries().symbolInfo() } catch (e) { return { ok: false, why: String(e) } }
  if (!si) return { ok: false, why: 'no symbolInfo yet' };
  return { ok: true, session: si.session || null, subsession: si.subsession_id || null };
}"""

#: Ask for more history (n > 0) and read the loaded depth. Read-only at n = 0.
DEPTH_JS = r"""(n) => {
  const col = window._exposed_chartWidgetCollection; if (!col) return { ok: false, why: 'no _exposed_chartWidgetCollection' };
  let ms; try { ms = col.activeChartWidget.value().model().mainSeries() } catch (e) { return { ok: false, why: String(e) } }
  let asked = false;
  if (n > 0 && typeof ms.requestMoreData === 'function') { try { ms.requestMoreData(n); asked = true } catch (e) {} }
  let count = 0, first = null; const b = ms.bars();
  if (b && typeof b.each === 'function') b.each((i, v) => { if (i > -1000000 && v) { count += 1; if (first === null) first = v[0] } return false });
  let tz = null; try { tz = ms.symbolInfo().timezone || null } catch (e) {}
  return { ok: true, asked, count, first, tz };
}"""

#: WRITE: removes one study by entity id (the one this run added).
REMOVE_JS = "(id) => {" + _CHART + r"""
  const h = chartOf(); if (!h) return { ok: false, why: 'no chart handle' };
  try { h.c.removeEntity(id); return { ok: true } } catch (e) { return { ok: false, why: String(e) } }
}"""

# ─── ⭐⭐ FOLDED FROM THE SCRATCHPAD WRAPPERS (coordinator ruling 2026-11-20: a capture instrument with no self-check of its own
# is not trusted, so `batch_wide.py` and `batch_builtin.py` retire). A manifest row may name `inputs` (TradingView's own input
# ids: the k-th `input*()` of the source is `in_k`), set on the study THIS run added through the chart's study API (no
# click, no dialog) and read back; or `builtin` (a TradingView built-in study, added from the Indicators dialog by its
# exact `data-id`) with `builtinInputs` by the dialog's LABEL. Every one is railed in `batch_double.self_check`.

#: WRITE (the study THIS run added): `setInputValues`, then the read-back; ok only when every input reads back as asked.
INPUTS_JS = "(arg) => {" + _CHART + r"""
  const h = chartOf(); const si = h ? tryv(() => h.c.getStudyById(arg.id)) : null;
  if (!si) return { ok: false, why: 'study not found' };
  if (typeof si.setInputValues !== 'function' || typeof si.getInputValues !== 'function')
    return { ok: false, why: 'the study API has no setInputValues / getInputValues' };
  const want = Object.entries(arg.inputs).map(([id, value]) => ({ id, value }));
  try { si.setInputValues(want) } catch (e) { return { ok: false, why: 'setInputValues threw: ' + e } }
  const got = tryv(() => si.getInputValues()) || [];
  const byId = Object.fromEntries(got.map((x) => [x.id, x.value]));
  const bad = want.filter((w) => byId[w.id] !== w.value).map((w) => ({ id: w.id, want: w.value, got: byId[w.id] }));
  return { ok: bad.length === 0, bad, set: want.length };
}"""

#: READ: the study's metaInfo default palette colours vs its LIVE palette state, and the moved colour inputs whose default
#: a palette holds but whose value the live palette does not (`lag`). ⛔ A reading that saw no palette colour is no
#: reading. ⚰️ 2026-11-16 (run rssetc, ALAB): TradingView read back in_27 = #4CAF50, and its live palette still drew #FF5252.
PALETTE_JS = "(arg) => {" + _CHART + r"""
  const h = chartOf(); const si = h ? tryv(() => h.c.getStudyById(arg.id)) : null;
  if (!si) return { ok: false, why: 'study not found' };
  const seen = new Set(); let ds = null;
  const look = (o, d) => { if (!o || typeof o !== 'object' || seen.has(o) || d > 2 || ds) return; seen.add(o);
    if (typeof o.metaInfo === 'function' && typeof o.properties === 'function') { ds = o; return }
    for (const k of Object.keys(o)) { const v = tryv(() => o[k]); if (v && typeof v === 'object') look(v, d + 1) } };
  look(si, 0);
  if (!ds) return { ok: false, why: 'no data source behind the study API' };
  const rgba = (s) => { s = String(s || '').trim(); let m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
    if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3]), +(m[4] === undefined ? 1 : +m[4]).toFixed(3)].join(',');
    m = s.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
    if (m) { const x = m[1]; return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16), +(m[2] ? parseInt(m[2], 16) / 255 : 1).toFixed(3)].join(',') }
    return null };
  const cols = (pals) => { const out = new Set(); for (const p of Object.values(pals || {})) for (const c of Object.values((p && p.colors) || {})) { const t = rgba(c && c.color); if (t) out.add(t) } return out };
  const mi = tryv(() => ds.metaInfo()) || {};
  const state = tryv(() => ds.properties().state()) || {};
  const meta = cols((mi.defaults && mi.defaults.palettes) || {}); for (const t of cols(mi.palettes)) meta.add(t);
  const live = cols(state.palettes);
  const inputs = tryv(() => si.getInputValues()) || [];
  const defs = Object.fromEntries((mi.inputs || []).map((i) => [i.id, i.defval]));
  const moved = inputs.filter((i) => { const v = rgba(i.value), d = rgba(defs[i.id]); return v && d && v !== d && meta.has(d) });
  const lag = moved.filter((i) => !live.has(rgba(i.value))).map((i) => i.id);
  if (!meta.size || !live.size) return { ok: false, why: 'no palette colours read', meta: meta.size, live: live.size };
  return { ok: true, lag, moved: moved.map((i) => i.id), meta: meta.size, live: live.size };
}"""

#: A built-in row: the Indicators dialog. OPEN clicks only its own launcher (`data-name`); PICK types the row's name into
#: the dialog's search and clicks ONLY the list element whose `data-id` is EXACTLY the row's id (none or several: nothing
#: is clicked, STOP); CLOSED reads whether the dialog is gone. INPUT_IDS: the added built-in's input ids by their LABEL.
BUILTIN_OPEN_JS = r"""() => { if (document.querySelector('[data-name="indicators-dialog"]')) return { open: true }
  const b = document.querySelector('[data-name="open-indicators-dialog"]'); if (!b) return { open: false, clicked: false }
  b.click(); return { open: false, clicked: true } }"""
BUILTIN_PICK_JS = r"""async ({ id, search }) => {
  const d = document.querySelector('[data-name="indicators-dialog"]'); const input = d && d.querySelector('input')
  if (!input) return { STOP: 'no dialog search input' }
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, search)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 300))
    const hits = [...d.querySelectorAll('[data-id]')].filter((el) => el.getAttribute('data-id') === id)
    if (hits.length === 1) {
      const title = (hits[0].getAttribute('data-title') || hits[0].textContent || '').trim().slice(0, 100)
      hits[0].click()
      return { clicked: true, title }
    }
    if (hits.length > 1) return { STOP: `${hits.length} elements carry data-id ${id}` }
  }
  return { STOP: `no element with data-id ${id} after searching ${JSON.stringify(search)}` } }"""
BUILTIN_CLOSED_JS = r"""() => !document.querySelector('[data-name="indicators-dialog"]')"""
BUILTIN_INPUT_IDS_JS = "(id) => {" + _CHART + r"""
  const h = chartOf(); const si = h ? tryv(() => h.c.getStudyById(id)) : null;
  if (!si) return {};
  const got = tryv(() => si.getInputsInfo && si.getInputsInfo()) || [];
  const out = {}; for (const i of got) if (i && i.name && i.id) out[i.name] = i.id;
  return out }"""


def _rgba(v):
    """A colour as (r, g, b, a) from `rgba(...)` / `rgb(...)` / `#rrggbb[aa]`, or None."""
    t = str(v or "").strip()
    m = re.match(r"^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$", t, re.I)
    if m:
        return (round(float(m[1])), round(float(m[2])), round(float(m[3])), round(float(m[4] if m[4] else 1), 3))
    m = re.match(r"^#([0-9a-f]{6})([0-9a-f]{2})?$", t, re.I)
    if m:
        h = m[1]
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), round(int(m[2], 16) / 255 if m[2] else 1, 3))
    return None


def _palette_colours(pals):
    out = set()
    for p in (pals or {}).values():
        for c in ((p or {}).get("colors") or {}).values():
            t = _rgba((c or {}).get("color"))
            if t:
                out.add(t)
    return out


def palette_lag(capture: dict) -> list:
    """The moved colour inputs a plot draws (their DEFAULT is one of the study's own palette colours) that the capture's
    LIVE palette does not hold: [] when the capture agrees with itself."""
    st = capture.get("study") or {}
    meta = _palette_colours(st.get("palettes"))
    live = _palette_colours(st.get("paletteState"))
    lag = []
    for i in st.get("inputs") or []:
        v, d = _rgba(i.get("value")), _rgba(i.get("defval"))
        if v and d and v != d and d in meta and v not in live:
            lag.append({"id": i.get("id"), "name": i.get("name"), "value": i.get("value"), "defval": i.get("defval")})
    return lag


_TITLE_RE = re.compile(r"""^\s*(?:indicator|strategy|study|library)\s*\(\s*(?:title\s*=\s*)?(["'])(.*?)\1""", re.M)


def manifest_titles(scripts) -> set:
    """The study titles this manifest's own probes declare (`indicator("...")` / `strategy("...")`, read from each source
    that is on disk and matches its sha), plus a built-in row's `builtin.title`: what a leftover of THIS batch's probes
    can be called on the chart. A source that cannot be read, or whose sha differs, names nothing."""
    out = set()
    for s in scripts:
        b = s.get("builtin")
        if isinstance(b, dict) and b.get("title"):
            out.add(str(b["title"]))
            continue
        try:
            path = pathlib.Path(s["path"])
            raw = (path if path.is_absolute() else REPO / path).read_bytes()
        except (OSError, KeyError, TypeError):
            continue
        if hashlib.sha256(raw).hexdigest() != s.get("sha256"):
            continue
        m = _TITLE_RE.search(raw.decode("utf-8", errors="replace"))
        if m and m.group(2):
            out.add(m.group(2))
    return out


#: (2026-11-20) the manifest key a retired wrapper read: a row naming it stops the batch BY NAME, never silently ignored
RETIRED_ROW_KEYS = {"sessionId": "`sessionId` is retired (a scratchpad wrapper's): name the row's `session` "
                                 "(`regular` or `extended`, #2134), which the batch sets and reads back"}


def retired_key_refusal(scripts) -> str | None:
    """None when no row names a retired key, else why the batch may not start (checked before any page step)."""
    bad = [(s.get("slug"), k) for s in scripts for k in RETIRED_ROW_KEYS if k in s]
    if not bad:
        return None
    return "; ".join(f"{slug}: {RETIRED_ROW_KEYS[k]}" for slug, k in bad)

VH_STUDIES_JS = "() => window.__uctVH.studies()"
VH_CAPTURE_JS = ("(o) => { try { return { ok: true, summary: window.__uctVH.capture(o) } } "
                 "catch (e) { return { ok: false, error: String((e && e.message) || e) } } }")
VH_CHUNK_JS = "(i) => JSON.stringify(window.__uctVH.chunk(i))"
# ⭐⭐ THE GUARDED CLEAN-SAVE (owner ruling, delegated to the coordinator, 2026-11-19): the layout's own Save (its
# keyboard shortcut), pressed ONLY by `Driver.guarded_clean_save` behind `clean_save_refusal`, and ONLY when the batch
# runs with `--clean-save` (or the `repair` command). TradingView's saved word, waited for after the press.
SAVE_SHORTCUT = "Control+s"
SAVED_TEXT_JS = "() => /all changes saved/i.test(document.body ? (document.body.innerText || '') : '')"
# ⛔ Before the Save key: focus leaves whatever holds it (the Pine editor's Ctrl+S saves a SCRIPT to the account, not
# the layout). True only when nothing but the page itself holds focus; anything else refuses the save.
FOCUS_BODY_JS = ("() => { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); "
                 "const b = document.activeElement; return !b || b === document.body || b === document.documentElement }")


def clean_save_refusal(state: dict, original: dict):
    """⛔ THE GUARD: why the in-page state may NOT be saved, or None when it may. Saved only when it reads exactly
    0 studies on the batch's original symbol and resolution: a dirty layout is never saved."""
    st = state or {}
    studies = st.get("studies")
    if studies is None:
        return "the in-page state was not read"
    if len(studies) != 0:
        return f"{len(studies)} studies are still on the chart: {studies}"
    if not sym_match(st.get("symbol"), (original or {}).get("symbol")):
        return f"the symbol reads {st.get('symbol')!r}, not {(original or {}).get('symbol')!r}"
    if res_norm(st.get("resolution")) != res_norm((original or {}).get("resolution")):
        return f"the resolution reads {st.get('resolution')!r}, not {(original or {}).get('resolution')!r}"
    return None


#: ⭐⭐ ONE SETTLED READ OF THE RIG (coordinator ruling, 2026-11-19): the one definition of what a fresh load READS,
#: for every clean-check (`Driver.verify_fresh_load`, which the batch end, the repair's verify-before and the guarded
#: clean-save's verify-after all call, and the scratchpad end-of-batch rail `rig_verify.py`).
#: ⚰️ THE CONTRADICTION IT ENDS (2026-11-19, 03:07Z and again 21:31Z): run htfform-c's verify_fresh_load took the first
#: read where the chart handle answered (0 studies) and called the layout clean, so the guarded clean-save never ran;
#: the end-of-batch rail's new launch, a few seconds later, read the saved leftover UCTPROBE_RS_SEED_RSRATING. The
#: next batch (nhdot) read it on its own fresh load and repaired it. A handle that answers is not a layout that has
#: finished attaching its studies: an empty list read too early is not "clean".
#: A read counts once the handle answers with a studies list and a symbol; the state is SETTLED when (symbol,
#: resolution, study ids) is unchanged for `RIG_SETTLE_S` straight. Never settled inside `RIG_SETTLE_MAX_S`: NOT
#: READ, which no caller may report as clean.
#: ⛔ RIG_SETTLE_S is a CHOICE, not a measured bound: the read-only measurement of 2026-11-19 22:02Z found the layout
#: already clean (0 studies for 30 s on a new launch and on a reload), so no attach time was measured. Every settled read
#: records when its state last changed (`lastChangeS`, `changes`), so the ledger measures it from here on.
RIG_SETTLE_S = 10.0
RIG_SETTLE_MAX_S = 90.0


def rig_state_key(st):
    """What a settled read compares: the symbol, the resolution and the study ids, in order. None until it counts."""
    if not st or st.get("handle") is None or st.get("studies") is None or not st.get("symbol"):
        return None
    return (st.get("symbol"), str(st.get("resolution")), tuple(str(s.get("id")) for s in st.get("studies") or []))


def settled_rig_read(read, clock, poll_s, settle_s=RIG_SETTLE_S, max_s=RIG_SETTLE_MAX_S) -> dict:
    """⭐⭐ THE settled read (see RIG_SETTLE_S). `read()` returns the page's STATE_JS answer; `clock` has `monotonic()`
    and `sleep()`. Returns {"state", "settled", "waitedS", "answeredS", "lastChangeS", "changes"}: `changes` is every
    distinct state seen, with the second it was first seen, so a study that attaches late is on the record."""
    t0 = clock.monotonic()
    last_key, since, answered, st = None, None, None, None
    changes = []
    while True:
        st = read()
        now = clock.monotonic() - t0
        key = rig_state_key(st)
        if key is not None:
            if answered is None:
                answered = now
            if key != last_key:
                last_key, since = key, now
                changes.append({"atS": round(now, 2), "symbol": key[0], "resolution": key[1],
                                "studies": [s.get("name") for s in (st.get("studies") or [])]})
            elif now - since >= settle_s:
                return {"state": st, "settled": True, "waitedS": round(now, 2), "answeredS": round(answered, 2),
                        "lastChangeS": round(since, 2), "changes": changes}
        if now >= max_s:
            return {"state": st, "settled": False, "waitedS": round(now, 2),
                    "answeredS": None if answered is None else round(answered, 2),
                    "lastChangeS": None if since is None else round(since, 2), "changes": changes}
        clock.sleep(poll_s)


VH_CLEANUP_JS = "() => (window.__uctVH ? window.__uctVH.cleanup() : { globalsLeft: [], absent: true })"
GLOBALS_JS = "() => Object.keys(window).filter((k) => /^__uct/.test(k))"

#: READ-ONLY: the signed-in TradingView username, for PROVENANCE only. Python keeps
#: HMAC-SHA256(local salt, username)[:12], never the name (the repository is public), and never
#: an unsalted hash of it (`account_fingerprint`). `null` when the page does not expose one:
#: provenance then says `unread`, which is honest, not a failure.
ACCOUNT_JS = r"""() => {
  const tryv = (f) => { try { const v = f(); return (typeof v === 'string' && v) ? v : null } catch (e) { return null } };
  return tryv(() => window.user.username) || tryv(() => window.TradingView.currentUser.username)
      || tryv(() => window.initData.user.username) || null;
}"""


# ─── small helpers ───────────────────────────────────────────────────────────
def utcnow() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


#: ⭐⭐ (coordinator ruling 2026-11-20, (ii)) A ROW MAY NAME ITS SESSION. TradingView takes a JSON symbol spec
#: (`={"session":"extended","symbol":"AMEX:SPY"}`), the same per-row `setSymbol` the batch already makes, so nothing new
#: persists. The resolved session MUST read back as this (`SESSION_JS`), or the row stops by name; it is restored after.
#: ⛔ The layout's own session is never toggled (the rig rule: AUTOSAVE is account-wide).
ROW_SESSIONS = {"extended": "0400-2000", "regular": "0930-1600"}
#: what a capture id says of a row's NAMED session (`capture_id_for`); one entry per `ROW_SESSIONS` key
SESSION_SUFFIX = {"extended": "-ext", "regular": "-rth"}


def session_spec(symbol, session) -> str:
    """The symbol spec naming a session (`=` + JSON, keys sorted: TradingView's own encoding)."""
    return "=" + json.dumps({"session": session, "symbol": symbol}, separators=(",", ":"), sort_keys=True)


def spec_symbol(s):
    """The plain symbol inside a spec (`={...}`), or `s` itself."""
    t = str(s or "")
    if t.startswith("="):
        try:
            return str((json.loads(t[1:]) or {}).get("symbol") or "")
        except (ValueError, AttributeError):
            return ""
    return t


def sym_match(have, want) -> bool:
    have, want = spec_symbol(have), spec_symbol(want)
    if not have or not want:
        return False
    a, b = str(have).upper(), str(want).upper()
    if ":" in a and ":" in b:
        return a == b
    return a.split(":")[-1] == b.split(":")[-1]


def res_norm(r) -> str:
    return re.sub(r"^1(?=[DWM]$)", "", str(r or "").strip().upper())


def same_period(day, listing, tf) -> bool:
    """Do two ISO days fall in one weekly (ISO week) or monthly (calendar month) period? Malformed: False."""
    import datetime as _dt
    try:
        d, l = _dt.date.fromisoformat(str(day)[:10]), _dt.date.fromisoformat(str(listing)[:10])
    except (TypeError, ValueError):
        return False
    if tf == "W":
        return d.isocalendar()[:2] == l.isocalendar()[:2]
    if tf == "M":
        return (d.year, d.month) == (l.year, l.month)
    return False


def slugify(s) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")


def iso_date_in(unix_s, tz) -> str | None:
    try:
        from zoneinfo import ZoneInfo
        return _dt.datetime.fromtimestamp(unix_s, ZoneInfo(tz)).date().isoformat()
    except Exception:
        return None


def newest_bar_forming(mode: str, now_utc=None):
    """(value, why). `auto`: a weekday inside 09:30-16:00 ET says a daily bar is
    forming (a holiday would make that wrong, which is why the doc says run it
    after the close); outside those hours the newest daily bar is closed."""
    if mode in ("true", "false"):
        return mode == "true", "asserted by --newest-bar-forming"
    from zoneinfo import ZoneInfo
    now = (now_utc or _dt.datetime.now(_dt.timezone.utc)).astimezone(ZoneInfo("America/New_York"))
    rth = now.weekday() < 5 and (9, 30) <= (now.hour, now.minute) < (16, 0)
    return rth, f"auto: {now:%a %H:%M} ET is {'inside' if rth else 'outside'} regular hours"


def throttle_refusal(throttle_s) -> str | None:
    """None when `throttle_s` may pace a batch, else why not. THE pacing authority: this CLI and the
    evidence engine's `batch` both ask it. ⛔ A non-finite value is refused by name: `nan < 10` is
    False, so a bare floor test let `--throttle-s nan` through (and `inf` cannot be slept)."""
    t = float(throttle_s)
    if not math.isfinite(t):
        return f"--throttle-s {throttle_s} is not a finite number of seconds"
    if t < MIN_THROTTLE_S:
        return f"--throttle-s {throttle_s} is below {MIN_THROTTLE_S:.0f}s (this is the owner's own account)"
    return None


def capture_id_for(script: dict, o: Opts) -> str:
    """⭐ THE capture id the driver writes for `script` on the chart `o` names (`Driver.opts_for`):
    `<captureStem>-<sym>-<tf>-<yyyy-mm-dd>`, then `-<capturePhase>` when the manifest entry carries one. ONE authority:
    `Driver.capture` names its file with it and `run_batch` checks every script's before the first capture.
    ⛔ A capturePhase outside `evidence_ledger.CAPTURE_PHASES` is refused (GATE_FAILED, the batch stops): an id the
    gate cannot read back is never written."""
    phase = script.get("capturePhase")
    if phase is not None and phase not in CAPTURE_PHASES:
        raise GateFailed(f"capturePhase {phase!r} of {script.get('slug')} is not one of {list(CAPTURE_PHASES)}",
                         abort=True)
    sym_slug = slugify(o.symbol.split(":")[-1])
    tf_slug = slugify(res_norm(o.tf) if re.fullmatch(r"\d+", res_norm(o.tf)) else "1" + res_norm(o.tf))
    # ⭐ (2026-11-20) a row that NAMES its session says it in the id: `-ext` extended (`vw-clock-vwap-spy-5-ext-2026-09-28`,
    # the convention), `-rth` regular. ⚰️ A regular-session row was named exactly as a capture of the chart's own session,
    # and master's `vw-bi-time-d-extended-spy-60-2026-11-19` (no suffix) holds the EXTENDED session: the next reader trusts
    # the file name. A row that names no session keeps its name (the chart's own session, recorded in the capture).
    sess = SESSION_SUFFIX.get(getattr(o, "session", None), "")
    capture_id = f"{script.get('captureStem') or script['slug']}-{sym_slug}-{tf_slug}{sess}-{o.date}"
    return f"{capture_id}-{phase}" if phase else capture_id


def capture_id_refusal(scripts, opts_for) -> str | None:
    """None when every script of the manifest names its own capture id, else why the batch may not start.
    ⛔ Checked at BATCH START over the WHOLE manifest (a `--only` / `--limit` run writes into the same run dir), before
    any page step: two scripts naming one id would write one capture file twice (2026-11-19: rows Q-HTF-FORM-a and -c,
    one probe on AMEX:SPY 1D in two session states on one day, named the same capture)."""
    seen, clashes = {}, []
    for s in scripts:
        try:
            cid = capture_id_for(s, opts_for(s))
        except StepOutcome as so:
            return so.reason
        if cid in seen:
            clashes.append(f"{seen[cid]} and {s.get('slug')} both name {cid}")
        else:
            seen[cid] = s.get("slug")
    if clashes:
        return "two scripts would write the same capture id (give each a distinct capturePhase): " + "; ".join(clashes)
    return None


def write_json_atomic(path: pathlib.Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-", suffix=".json")
    with io.open(fd, "w", encoding="utf-8", newline="") as fh:
        fh.write(json.dumps(obj, indent=1, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


def refuse_owner_browser_profile(profile: pathlib.Path) -> None:
    """⛔ The owner's own browser profile is never this tool's, even outside a worktree."""
    local = os.environ.get("LOCALAPPDATA")
    if not local:
        return
    p = pathlib.Path(os.path.abspath(str(profile))).resolve()
    for owned in (pathlib.Path(local) / "Google" / "Chrome" / "User Data",
                  pathlib.Path(local) / "Microsoft" / "Edge" / "User Data"):
        o = owned.resolve()
        if p == o or o in p.parents:
            raise SystemExit(f"REFUSED: {p} is inside the owner's own browser profile ({o}). "
                             "This tool only ever uses its own profile.")


# ─── clocks ──────────────────────────────────────────────────────────────────
class RealClock:
    def __init__(self, page):
        self.page = page

    def sleep(self, seconds: float) -> None:
        if seconds > 0:
            self.page.wait_for_timeout(int(seconds * 1000))

    @staticmethod
    def monotonic() -> float:
        return time.monotonic()


# ─── verify_capture.mjs, read by exit code AND verdict line, never through a pipe
class NodeVerifier:
    def __init__(self):
        self.node = shutil.which("node")

    def _run(self, args):
        if not self.node:
            return {"exit": None, "verdict": None, "ok": False, "tail": "node is not on PATH"}
        proc = subprocess.run([self.node, str(VERIFY), *args], capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=300)
        out = (proc.stdout or "") + (proc.stderr or "")
        verdict = next((ln.strip() for ln in reversed(out.splitlines()) if ln.startswith("VERDICT:")), None)
        ok = proc.returncode == 0 and bool(verdict) and verdict.startswith("VERDICT: PASS")
        return {"exit": proc.returncode, "verdict": verdict, "ok": ok, "tail": "\n".join(out.splitlines()[-6:])}

    def assemble(self, chunk_dir: pathlib.Path, out: pathlib.Path):
        return self._run(["--assemble", str(chunk_dir), "--out", str(out)])

    def verify_file(self, path: pathlib.Path):
        return self._run([str(path)])


# ─── the run directory ───────────────────────────────────────────────────────
class RunDir:
    def __init__(self, root: pathlib.Path, run_id: str):
        self.root = pathlib.Path(root)
        self.run_id = run_id
        for sub in ("results", "captures", "scratch"):
            (self.root / sub).mkdir(parents=True, exist_ok=True)
        self.ledger_path = self.root / "ledger.jsonl"

    def ledger(self, event: str, **fields) -> None:
        line = json.dumps({"ts": utcnow(), "runId": self.run_id, "event": event, **fields}, ensure_ascii=False)
        with io.open(self.ledger_path, "a", encoding="utf-8", newline="") as fh:
            fh.write(line + "\n")
            fh.flush()
            os.fsync(fh.fileno())

    def result_path(self, slug: str) -> pathlib.Path:
        return self.root / "results" / f"{slug}.json"

    def read_result(self, slug: str):
        p = self.result_path(slug)
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def claim(self, script: dict, started: str) -> dict:
        """⛔ BEFORE THE FIRST STEP: a crash from here on leaves THIS on disk."""
        claim = {
            "schema": "uct.vendor-batch-result/v1", "runId": self.run_id,
            "slug": script["slug"], "path": script["path"], "sha256": script["sha256"],
            "outcome": INCOMPLETE,
            "reason": f"claimed at {started}; the script did not finish (the process stopped mid-script)",
            "startedAtUTC": started, "finishedAtUTC": None,
        }
        write_json_atomic(self.result_path(script["slug"]), claim)
        self.ledger("claim", slug=script["slug"], sha256=script["sha256"])
        return claim

    def note_on_claim(self, slug: str, **fields) -> None:
        cur = self.read_result(slug) or {}
        if cur.get("outcome") == INCOMPLETE:
            write_json_atomic(self.result_path(slug), {**cur, **fields})

    def finish(self, result: dict) -> None:
        write_json_atomic(self.result_path(result["slug"]), result)
        self.ledger("result", slug=result["slug"], sha256=result["sha256"], outcome=result["outcome"],
                    reason=result.get("reason"), capture=result.get("capture"))

    def results(self) -> dict:
        out = {}
        for p in sorted((self.root / "results").glob("*.json")):
            try:
                r = json.loads(p.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            out[r.get("slug") or p.stem] = r
        return out


# ─── the driver ──────────────────────────────────────────────────────────────
class Opts:
    def __init__(self, **kw):
        self.symbol = kw.get("symbol", "NYSE:RDDT")
        self.tf = kw.get("tf", "1D")
        self.listing_date = kw.get("listing_date", KNOWN_LISTING.get(self.symbol.upper()))
        # ⭐⭐ (2026-11-20) the row's session (`ROW_SESSIONS`), or None: the chart's own, as before
        self.session = kw.get("session")
        if self.session is not None and self.session not in ROW_SESSIONS:
            raise GateFailed(f"session {self.session!r} is not one of {sorted(ROW_SESSIONS)}", abort=True)
        self.throttle_s = float(kw.get("throttle_s", 30))
        self.compute_timeout_s = float(kw.get("compute_timeout_s", 120))
        self.add_timeout_s = float(kw.get("add_timeout_s", 30))
        self.ui_timeout_s = float(kw.get("ui_timeout_s", 10))
        self.settle_s = float(kw.get("settle_s", 4))
        self.poll_s = float(kw.get("poll_s", 1.5))
        self.depth_rounds = int(kw.get("depth_rounds", 30))
        self.depth_chunk = int(kw.get("depth_chunk", 1000))
        self.chunk_size = int(kw.get("chunk_size", 60000))
        self.newest_bar_forming = kw.get("newest_bar_forming", "auto")
        self.title_selector = kw.get("title_selector")
        self.profile_leaf = kw.get("profile_leaf")
        self.retry = set(kw.get("retry", DEFAULT_RETRY))
        self.date = kw.get("date") or _dt.datetime.now().strftime("%Y-%m-%d")
        # ⭐ the guarded clean-save (`Driver.guarded_clean_save`): OFF unless the run asks for it
        self.clean_save = bool(kw.get("clean_save", False))
        # ⭐⭐ the settled read of the rig (`settled_rig_read`): how long its state must hold still, and the most it waits
        self.rig_settle_s = float(kw.get("rig_settle_s", RIG_SETTLE_S))
        self.rig_settle_max_s = float(kw.get("rig_settle_max_s", RIG_SETTLE_MAX_S))


class Driver:
    """One script's steps 1-12, over any object with the Playwright `page` surface
    this file uses: `evaluate`, `mouse.click/move`, `keyboard.press`, and what
    `acquire`/`layout_access` read. The self-check hands it a recording double."""

    def __init__(self, page, clock, opts: Opts, rd: RunDir, verifier, log=print):
        self.page, self.clock, self.opts, self.rd, self.verifier, self.log = page, clock, opts, rd, verifier, log
        self.base_opts = opts
        self.provenance = {}         # batch-level: run, account fingerprint, profile, engine sha
        self.abort = None           # (exit code, reason) once the rig cannot be trusted
        # batch-level: the titles of the studies THIS batch added (`capture`), the only ones the guarded repair may
        # remove from a layout a fresh load shows dirty (`guarded_clean_save`)
        self.added_titles = set()
        self._reset()

    def _reset(self):
        self.steps = []
        # ⛔ None = NOT YET READ. Cleanup then removes only the one id this script
        # recorded adding — never "everything not in an empty baseline", which
        # would delete a study that was on the rig before this script began.
        self.baseline_ids = None
        self.script_state = None
        self.added_id = None
        self.injected = False
        self.menu_open = False
        self.slug = None
        # ⭐⭐ (folded 2026-11-20) the manifest row this script runs (`run_one`): its `inputs` / `builtin` / `builtinInputs`
        self.row = {}

    def builtin(self):
        """The row's built-in study (`{"id": "STD;...", "search": "<name typed in the dialog>"}`), or None."""
        b = (self.row or {}).get("builtin")
        return b if isinstance(b, dict) and b.get("id") else None

    def step(self, name):
        self.steps.append(name)

    def ev(self, name, expr, arg=None):
        self.step(name)
        return self.page.evaluate(expr, arg) if arg is not None else self.page.evaluate(expr)

    def gate(self, what):
        self.step(f"gate:{what}")
        try:
            _gate(self.page, what)
        except SystemExit as exc:           # the imported gate raises SystemExit
            raise GateFailed(f"visibility gate v2.1: {exc}") from None

    def poll(self, name, expr, arg, done, timeout_s):
        deadline = self.clock.monotonic() + timeout_s
        last = None
        while True:
            last = self.ev(name, expr, arg)
            if done(last):
                return last, True
            if self.clock.monotonic() >= deadline:
                return last, False
            self.clock.sleep(self.opts.poll_s)

    # ── batch-level ─────────────────────────────────────────────────────────
    def verify_fresh_load(self, original):
        """⭐⭐ THE RIG'S PERSISTED STATE (coordinator, 2026-11-18): reload the rig layout and read it as the NEXT batch
        will: 0 studies, and the symbol and resolution this batch found (`original`). The verdict is the FRESH load's,
        never the page's own: on TradingView with the layout's autosave on, a study removed through the widget API
        (`REMOVE_JS`) and a resolution set through it are NOT recorded, while an add from the Pine editor is.
        ⚰️ MEASURED 2026-11-18: run l12-is-2026-11-18's last probe (UCTPROBE_RS_OWN_DAILY_INTRADAY, RDDT 5m) was removed
        and verified gone in the page, the batch restored 1D, and a fresh load read the probe on 5m: the layout had
        saved it at the add. The next batch (Q-FCMP3) stopped at its gate, and the owner's layout carried it until it
        was cleared by hand. ⛔ Read only: it never removes or sets anything (the only repair is `guarded_clean_save`).
        ⭐⭐ The read is THE settled read (`settled_rig_read`): the first answer is not the layout (2026-11-19, htfform-c)."""
        self.page.reload(wait_until="domcontentloaded")
        s = settled_rig_read(lambda: self.ev("verify:state", STATE_JS), self.clock, self.opts.poll_s,
                             self.opts.rig_settle_s, self.opts.rig_settle_max_s)
        st, ok = s["state"] or {}, s["settled"]
        studies = [{"id": x.get("id"), "name": x.get("name")} for x in (st.get("studies") or [])]
        want = {"symbol": original.get("symbol"), "resolution": original.get("resolution")}
        got = {"symbol": st.get("symbol"), "resolution": st.get("resolution")}
        clean = (ok and not studies and sym_match(got["symbol"], want["symbol"])
                 and res_norm(got["resolution"]) == res_norm(want["resolution"]))
        return {"ok": bool(clean), "read": bool(ok), "studies": studies, "want": want, "got": got,
                "settle": {k: s[k] for k in ("waitedS", "answeredS", "lastChangeS", "changes")}}

    def guarded_clean_save(self, original, label="repair") -> dict:
        """⭐⭐ THE GUARDED CLEAN-SAVE (owner ruling, delegated to the coordinator, 2026-11-19: "Save only through the
        guarded clean-save step"). On the rig layout the editor's add is AUTOSAVED and a widget-API removal or
        resolution change is NOT, so a probe that outlived an autosave persists. The repair, on the page a FRESH load
        just gave (the persisted, dirty layout):
          1. remove ONLY the studies THIS batch added (`added_titles`); a study it did not add is never touched,
             and the layout is reported dirty instead;
          2. put the symbol and resolution back (`restore`);
          3. ⛔ THE GUARD: read the IN-PAGE state. Not exactly 0 studies on the original symbol and resolution: NO
             SAVE, the result says why. A dirty layout is never saved;
          4. clean: focus leaves any editor (`FOCUS_BODY_JS`; else NO SAVE: the Pine editor's Ctrl+S saves a SCRIPT),
             the layout's own Save (`SAVE_SHORTCUT`), then wait for TradingView's saved word;
          5. a FRESH load decides (`verify_fresh_load`): only a clean read is CLEAN.
        Every save is recorded (`ok`, `saved`, the state before and after). Never raises."""
        out = {"label": label, "at": utcnow(), "saved": False, "ok": False}
        try:
            st = self.read_state(f"{label}:dirty")
            ours = [s for s in (st.get("studies") or []) if s.get("name") in self.added_titles]
            foreign = [s for s in (st.get("studies") or []) if s.get("name") not in self.added_titles]
            out["found"] = [{"id": s.get("id"), "name": s.get("name")} for s in (st.get("studies") or [])]
            if foreign:
                out["refused"] = f"studies this batch did not add are on the layout: {[s.get('name') for s in foreign]}"
                return out
            for s in ours:
                self.ev(f"{label}:remove", REMOVE_JS, s.get("id"))
            back = self.restore(original, label)
            out["restore"] = back
            now = self.read_state(f"{label}:in-page")
            before = {"studies": [s.get("name") for s in (now.get("studies") or [])],
                      "symbol": now.get("symbol"), "resolution": now.get("resolution")}
            out["before"] = before
            why = clean_save_refusal(before, original)
            if why:
                out["refused"] = why
                return out
            if self.ev(f"{label}:focus", FOCUS_BODY_JS) is not True:
                out["refused"] = "focus could not leave the element holding it (an editor's Ctrl+S saves a script)"
                return out
            self.step(f"{label}:save")
            self.page.keyboard.press(SAVE_SHORTCUT)
            out["saved"] = True
            _, out["sawSaved"] = self.poll(f"{label}:saved", SAVED_TEXT_JS, None, bool, max(self.opts.ui_timeout_s, 5))
            self.clock.sleep(self.opts.settle_s)
            after = self.verify_fresh_load(original)
            out["after"] = after
            out["ok"] = bool(after.get("ok"))
            return out
        except Exception as exc:  # noqa: BLE001 -- recorded; the batch reports RIG_DIRTY
            out["error"] = f"{type(exc).__name__}: {exc}"
            return out

    def read_state(self, name="state"):
        st = self.ev(name, STATE_JS)
        if not st or st.get("handle") is None:
            raise Inconclusive("no chart handle answered on window (TradingViewApi/tvWidget/widget)", st)
        if st.get("studies") is None:
            raise Inconclusive("the chart handle answered but getAllStudies() did not", st)
        return st

    def read_session(self, label="session"):
        r = self.ev(label, SESSION_JS)
        return r if isinstance(r, dict) and r.get("ok") else None

    def set_row_session(self, symbol, session, label):
        """setSymbol with the session spec, then the read-back: the resolved session must be `ROW_SESSIONS[session]`
        within 30 s, or the ROW stops by name (GateFailed). Returns the session read."""
        want = ROW_SESSIONS[session]
        r = self.ev(f"{label}:set_symbol", SET_SYMBOL_JS, session_spec(symbol, session))
        if not r or not r.get("ok"):
            raise GateFailed(f"setSymbol({session_spec(symbol, session)}) refused: {r} — the row stops")
        got, ok = self.poll(f"{label}:session", SESSION_JS, None,
                            lambda s: isinstance(s, dict) and s.get("ok") and s.get("session") == want, 30)
        if not ok:
            raise GateFailed(f"{symbol}: the chart's session read back {(got or {}).get('session')!r}, not the {session} "
                             f"session {want!r} — the row stops by name, nothing captured")
        self.clock.sleep(self.opts.settle_s)
        return got

    def ensure_symbol_tf(self, st):
        o = self.opts
        if o.session is not None:
            # ⭐⭐ (2026-11-20) a row that names its session: what the chart had, for the restore after this row
            before = self.read_session("session_before")
            self.row_session_restore = {"symbol": spec_symbol(st.get("symbol")) or o.symbol,
                                        "session": (before or {}).get("session"),
                                        "subsession": (before or {}).get("subsession")}
            self.set_row_session(o.symbol, o.session, "row")
            st = self.read_state()
        if not sym_match(st.get("symbol"), o.symbol):
            r = self.ev("set_symbol", SET_SYMBOL_JS, o.symbol)
            if not r or not r.get("ok"):
                raise Inconclusive(f"setSymbol({o.symbol}) refused: {r}")
            _, ok = self.poll("state", STATE_JS, None, lambda s: sym_match((s or {}).get("symbol"), o.symbol), 30)
            if not ok:
                raise Inconclusive(f"the symbol did not read back as {o.symbol}")
            self.clock.sleep(o.settle_s)
        st = self.read_state()
        if res_norm(st.get("resolution")) != res_norm(o.tf):
            r = self.ev("set_resolution", SET_RESOLUTION_JS, o.tf)
            if not r or not r.get("ok"):
                raise Inconclusive(f"setResolution({o.tf}) refused: {r}")
            _, ok = self.poll("state", STATE_JS, None,
                              lambda s: res_norm((s or {}).get("resolution")) == res_norm(o.tf), 30)
            if not ok:
                raise Inconclusive(f"the resolution did not read back as {o.tf}")
            self.clock.sleep(o.settle_s)
            st = self.read_state()
        return st

    def restore_session(self, back, label):
        """The chart's session as it was before a row named its own (`back`: symbol, session, subsession), read back."""
        now = self.read_session(f"{label}:session_now")
        if not back.get("session") or (now and now.get("session") == back["session"]):
            return {"ok": True, "changed": {}}
        sub_id = back.get("subsession") or ("extended" if back["session"] == ROW_SESSIONS["extended"] else "regular")
        self.ev(f"{label}:set_symbol", SET_SYMBOL_JS, session_spec(back["symbol"], sub_id))
        _, ok = self.poll(f"{label}:session", SESSION_JS, None,
                          lambda s: isinstance(s, dict) and s.get("ok") and s.get("session") == back["session"], 30)
        return {"ok": bool(ok), "changed": {"session": bool(ok)}}

    def restore(self, target, label):
        """Put symbol, resolution and pane stretch back to `target`, asserting the read-back."""
        st = self.read_state(f"{label}:state")
        done = {}
        if target.get("symbol") and not sym_match(st.get("symbol"), target["symbol"]):
            self.ev(f"{label}:set_symbol", SET_SYMBOL_JS, target["symbol"])
            _, done["symbol"] = self.poll(f"{label}:state", STATE_JS, None,
                                          lambda s: sym_match((s or {}).get("symbol"), target["symbol"]), 30)
        if target.get("resolution") and res_norm(st.get("resolution")) != res_norm(target["resolution"]):
            self.ev(f"{label}:set_resolution", SET_RESOLUTION_JS, target["resolution"])
            _, done["resolution"] = self.poll(f"{label}:state", STATE_JS, None,
                                              lambda s: res_norm((s or {}).get("resolution")) == res_norm(target["resolution"]), 30)
        if target.get("panes") and st.get("panes") and target["panes"] != st["panes"] \
                and len(target["panes"]) == len(st["panes"]):
            self.ev(f"{label}:set_stretch", SET_STRETCH_JS, target["panes"])
            done["panes"] = True
        return {"ok": all(done.values()) if done else True, "changed": done}

    # ── one script ──────────────────────────────────────────────────────────
    def source_of(self, script):
        path = pathlib.Path(script["path"])
        path = path if path.is_absolute() else REPO / path
        raw = path.read_bytes()
        sha = hashlib.sha256(raw).hexdigest()
        if sha != script["sha256"]:
            raise GateFailed(f"{script['path']} is sha {sha[:12]} on disk, the manifest says "
                             f"{script['sha256'][:12]} — the script compared must be the script the vendor ran")
        return raw, raw.decode("utf-8")

    def open_editor(self):
        if self.builtin():
            self.step("open_editor:skipped (built-in)")
            return
        r = self.ev("open_editor", OPEN_EDITOR_JS)
        if r and r.get("open"):
            return
        if not r or not r.get("clicked"):
            raise Inconclusive(f"the Pine editor is not open and its launcher was not found: {r}")
        _, ok = self.poll("editor_present", EDITOR_PRESENT_JS, None, bool, self.opts.ui_timeout_s)
        if not ok:
            raise Inconclusive("the Pine editor launcher was clicked and no editor appeared")

    def create_new_indicator(self):
        """script-title chevron -> hover `Create new` -> `Indicator`, by a REAL
        pointer; its effect (a fresh Monaco model) is what is verified."""
        if self.builtin():
            self.step("create_new_indicator:skipped (built-in)")
            return "builtin"
        before = self.ev("models", MODELS_JS)
        if not before or not before.get("ok"):
            raise Inconclusive(f"the Monaco handle could not be read: {before}")
        known = set(before.get("uris") or [])
        title = self.ev("title", TITLE_JS, self.opts.title_selector or "")
        if not title or not title.get("ok"):
            raise Inconclusive(f"the script-title control was not found: {title}")
        self.step("click:title")
        self.page.mouse.click(title["x"], title["y"])
        self.menu_open = True
        cn, ok = self.poll("menu:Create new", MENU_ITEM_JS, {"text": "Create new"},
                           lambda r: bool(r and r.get("ok")), self.opts.ui_timeout_s)
        if not ok:
            raise Inconclusive("the script-title menu showed no `Create new` row")
        self.step("hover:Create new")
        self.page.mouse.move(cn["x"], cn["y"])
        self.clock.sleep(0.8)
        ind, ok = self.poll("menu:Indicator", MENU_ITEM_JS, {"text": "Indicator", "rightOf": cn["rect"]},
                            lambda r: bool(r and r.get("ok")), self.opts.ui_timeout_s)
        if not ok:
            raise Inconclusive("`Create new` opened no `Indicator` row (the submenu needs a real hover)")
        self.step("click:Indicator")
        self.page.mouse.click(ind["x"], ind["y"])
        self.menu_open = False
        after, ok = self.poll("models", MODELS_JS, None,
                              lambda r: bool(r and r.get("ok") and set(r.get("uris") or []) - known),
                              self.opts.ui_timeout_s)
        if not ok:
            raise Inconclusive("`Create new > Indicator` yielded no fresh Monaco model")
        fresh = sorted(set(after["uris"]) - known)
        return fresh[-1]

    def binding_gate(self):
        if self.builtin():
            self.step("binding_gate:skipped (built-in)")
            return None
        # the header re-renders after `Create new > Indicator`; wait for it, then decide as before
        self.poll("binding_gate:settle", BINDING_JS, None, lambda r: bool(r and r.get("gate")),
                  BINDING_SETTLE_S)
        g = self.ev("binding_gate", BINDING_JS)
        if not g or not g.get("gate"):
            raise GateFailed(f"binding gate: {g and g.get('addToChart')} own-text `Add to chart`, "
                             f"{g and g.get('updateOnChart')} `Update on chart` — refusing to write or click", g)
        return g

    def set_source(self, raw: bytes, uri: str, sha: str):
        if self.builtin():
            # a built-in has no pasted source: the row's `path` is a one-line LABEL of what was added (its `source`)
            self.step("set_source:skipped (built-in)")
            return {"ok": True}
        r = self.ev("set_source", SET_SOURCE_JS, {"b64": base64.b64encode(raw).decode("ascii"), "uri": uri})
        if r and r.get("STOP"):
            raise GateFailed(f"pre-write gate refused inside the write: {r}", r)
        if not r or not r.get("ok"):
            raise Inconclusive(f"the buffer could not be written through the Monaco handle: {r}", r)
        if r.get("sha256") != sha:
            raise GateFailed(f"buffer receipt: the editor holds sha {str(r.get('sha256'))[:12]} "
                             f"({r.get('chars')} chars), the committed file is {sha[:12]}", r)
        return r

    def add_to_chart(self):
        sid = self.add_builtin() if self.builtin() else self.add_from_editor()
        self.set_row_inputs(sid)
        return sid

    def add_from_editor(self):
        r = self.ev("add", ADD_JS)
        if not r or r.get("STOP") or not r.get("clicked"):
            raise GateFailed(f"the add was refused by its own gate — nothing clicked: {r}", r)
        st, ok = self.poll("state", STATE_JS, None,
                           lambda s: bool(s and s.get("studies") is not None
                                          and {x["id"] for x in s["studies"]} - self.baseline_ids),
                           self.opts.add_timeout_s)
        new = [x for x in (st or {}).get("studies") or [] if x["id"] not in self.baseline_ids]
        if not new:
            raise Inconclusive("`Add to chart` was clicked and no study appeared")
        if len(new) != 1:
            raise GateFailed(f"one add produced {len(new)} new studies: {new}", abort=True)
        self.added_id = new[0]["id"]
        self.rd.note_on_claim(self.slug, addedStudyId=self.added_id)
        return self.added_id

    def add_builtin(self):
        """A TradingView BUILT-IN from the Indicators dialog (folded from batch_builtin.py, 2026-11-18): open the dialog,
        type the row's name, click ONLY the element whose `data-id` is exactly the row's id (else nothing is clicked and
        the row is GATE_FAILED), close the dialog; then the same one-new-study rule as the editor's add."""
        b = self.builtin()
        r = self.ev("builtin:open_dialog", BUILTIN_OPEN_JS)
        if not r or not (r.get("open") or r.get("clicked")):
            raise Inconclusive(f"the Indicators dialog could not be opened: {r}")
        self.clock.sleep(2.5)
        r = self.ev("builtin:pick", BUILTIN_PICK_JS, {"id": b["id"], "search": b.get("search") or ""})
        self.log(f"[builtin] {b['id']} ({b.get('search')!r}): {json.dumps(r)}")
        if not r or r.get("STOP") or not r.get("clicked"):
            self.page.keyboard.press("Escape")
            raise GateFailed(f"the built-in add was refused by its own gate (nothing clicked): {r}", r)
        self.clock.sleep(1.5)
        self.page.keyboard.press("Escape")
        self.clock.sleep(0.8)
        if not self.ev("builtin:closed", BUILTIN_CLOSED_JS):
            self.page.keyboard.press("Escape")
        st, _ = self.poll("state", STATE_JS, None,
                          lambda s: bool(s and s.get("studies") is not None
                                         and {x["id"] for x in s["studies"]} - self.baseline_ids),
                          self.opts.add_timeout_s)
        new = [x for x in (st or {}).get("studies") or [] if x["id"] not in self.baseline_ids]
        if not new:
            raise Inconclusive("the built-in was clicked and no study appeared")
        if len(new) != 1:
            raise GateFailed(f"one add produced {len(new)} new studies: {new}", abort=True)
        self.added_id = new[0]["id"]
        self.rd.note_on_claim(self.slug, addedStudyId=self.added_id)
        return self.added_id

    def set_row_inputs(self, sid):
        """⭐⭐ THE ROW'S INPUTS (folded from batch_wide.py / batch_builtin.py, 2026-11-16..18), on the study THIS run added:
          * `inputs` {"in_17": 30, ...}: one `setInputValues` (or one per input with `inputsOnePerCall`: ⚰️ the LAST
            colour of a multi-input call never reached TradingView's live palette, runs rssetc2-5), each read back;
          * `builtinInputs` {"<dialog label>": value}: resolved to the built-in's own input id, set one per call.
        Anything not read back as asked: the row is INCONCLUSIVE (an unknown label: GATE_FAILED), nothing captured.
        Then the study recomputes, and a moved PLOT colour must reach the live palette (`PALETTE_JS`, 20 s, set once more
        and 20 s again); the capture's own check (`palette_lag`) stays the authority. The capture records `study.inputs`
        itself, so the values a capture was taken at are in the capture, never only in the manifest."""
        row = self.row or {}
        want, labelled = row.get("inputs") or {}, row.get("builtinInputs") or {}
        if not want and not labelled:
            return
        self.wait_compute(sid, "compute:before-inputs")
        if labelled:
            ids = self.ev("inputs:ids", BUILTIN_INPUT_IDS_JS, sid) or {}
            for label, value in labelled.items():
                iid = ids.get(label)
                if not iid:
                    raise GateFailed(f"the built-in has no input labelled {label!r} (inputs: {sorted(ids)})")
                self._set_inputs(sid, {iid: value}, f"input-{iid}")
        if want and row.get("inputsOnePerCall"):
            for k, v in want.items():
                self._set_inputs(sid, {k: v}, f"input-{k}")
        elif want:
            self._set_inputs(sid, want, "inputs")
        self.clock.sleep(3)
        self.wait_compute(sid, "compute:inputs")
        if not want:
            return
        p = None
        for attempt in (1, 2):
            p, ok = self.poll(f"palette:{attempt}", PALETTE_JS, {"id": sid},
                              lambda r: bool(r and r.get("ok") and not r.get("lag")), 20)
            if ok:
                self.log(f"[palette] {self.slug}: live palette synced (attempt {attempt})")
                return
            self.log(f"[palette] {self.slug}: not synced after 20 s (attempt {attempt}): {p}")
            if attempt == 1:
                self._set_inputs(sid, want, "inputs-reset")

    def _set_inputs(self, sid, inputs, label):
        r = self.ev(f"set:{label}", INPUTS_JS, {"id": sid, "inputs": inputs})
        self.log(f"[inputs] {self.slug} {label}: {r}")
        if not r or not r.get("ok"):
            raise Inconclusive(f"{label}: the input(s) could not be set as asked: {r}", r)
        self.wait_compute(sid, f"compute:{label}")
        self.clock.sleep(1.5)

    def wait_compute(self, sid, label="compute"):
        deadline = self.clock.monotonic() + self.opts.compute_timeout_s
        prev = None
        while True:
            s = self.ev(label, STUDY_JS, sid)
            if not s or not s.get("found"):
                raise Inconclusive(f"study {sid} is no longer on the chart")
            st = s.get("status") or {}
            if st.get("type") == 3:
                raise RefusedByTV(f"TradingView: {st.get('title') or 'error'}: {st.get('error')}", s)
            rows = s.get("rows")
            if isinstance(rows, int) and rows > 0 and rows == prev:
                return rows
            prev = rows
            if self.clock.monotonic() >= deadline:
                raise Inconclusive(f"the study did not finish computing in {self.opts.compute_timeout_s:.0f}s "
                                   f"(last rows {rows}, status {st or None})", s)
            self.clock.sleep(self.opts.poll_s)

    def force_depth(self):
        """requestMoreData until the loaded history stops growing (two equal reads)."""
        o = self.opts
        last, stable, rounds, r = None, 0, 0, None
        while rounds < o.depth_rounds:
            rounds += 1
            r = self.ev("depth", DEPTH_JS, o.depth_chunk)
            if not r or not r.get("ok"):
                return {"ok": False, "why": (r or {}).get("why"), "rounds": rounds}
            self.clock.sleep(2.5)
            r = self.ev("depth", DEPTH_JS, 0)
            if r.get("count") == last:
                stable += 1
                if stable >= 2:
                    return {"ok": True, "stable": True, "rounds": rounds, **r}
            else:
                stable = 0
            last = r.get("count")
        return {"ok": True, "stable": False, "rounds": rounds, **(r or {})}

    def listing_for(self, symbol, stated=None):
        """⭐⭐ THE LISTING DATE IS READ, NOT TYPED (coordinator ruling 2026-11-20). The symbol's first session as UCT's
        production answers it (`/api/ticker-ipo/<T>`: `first_trade_date`, only when `first_trade_final` is true), read
        through the rig's own browser context (a public GET, no session). `KNOWN_LISTING` and a
        manifest row's `listingDate` (`stated`) are CROSS-CHECKS: each one present must AGREE, and a disagreement STOPS the
        batch by name (GateFailed, abort) -- never a silent override either way. No final answer: no listing date, so
        `startsAtBar0` is not asserted (the safe direction), and the reason says why.
        ⚰️ 2026-11-19: Q-FRED-NHDOT's NASDAQ:BGIN capture (listed 2025-10-21, first_trade_final true) carried no
        startsAtBar0, because BGIN was not in the hand-typed table; the harness then graded it as a chart reaching before
        its history (its run half refused `runtime:history-start`) where a member's daily chart draws it."""
        key = str(symbol or "").upper()
        cache = self.__dict__.setdefault("_listings", {})
        if key not in cache:
            cache[key] = uct_first_trade_date(self.page, symbol)
        fetched, why = cache[key]
        self.listing_why = why
        for name, other in (("KNOWN_LISTING", KNOWN_LISTING.get(key)), ("the manifest row's listingDate", stated)):
            if other and fetched and other != fetched:
                raise GateFailed(f"{symbol}: {name} says {other}, and UCT's /api/ticker-ipo says {fetched} (first_trade_final) "
                                 "-- the listing date is not settled; fix the table or the row before capturing", abort=True)
        return fetched

    def history_assertion(self, depth):
        o = self.opts
        if not depth.get("ok"):
            return False, f"the loaded depth could not be read ({depth.get('why')}) — not asserted"
        if not depth.get("stable"):
            return False, f"history was still growing after {depth.get('rounds')} requestMoreData rounds — not asserted"
        first_day = iso_date_in(depth.get("first"), depth.get("tz") or "Etc/UTC") if depth.get("first") else None
        if not o.listing_date:
            return False, (f"no listing date is known for {o.symbol} ({getattr(self, 'listing_why', 'not read')}) — not asserted "
                           f"(first bar {first_day})")
        tf = res_norm(o.tf)
        if tf in ("W", "M"):
            # ⭐⭐ (coordinator ruling 2026-11-20) ON A WEEKLY / MONTHLY CHART the first bar starts at the listing when ITS
            # PERIOD holds the first trade: the same ISO week, the same calendar month (the app's own
            # `listingSeed.listingStartOf`). Without it Saturday's NASDAQ:BGIN 1W capture from the listing could never
            # say so, and the W / M run half's serving gate would have no evidence to grade.
            if not same_period(first_day, o.listing_date, tf):
                unit = "week" if tf == "W" else "month"
                return False, f"first loaded bar {first_day} is not in the listing {unit} of {o.listing_date} — not asserted"
            unit = "week" if tf == "W" else "month"
            return True, (f"{o.symbol} listed {o.listing_date}; the chart's first bar ({first_day}) is the listing {unit} after "
                          f"requestMoreData stopped growing ({depth.get('count')} bars, batch_capture.py)")
        if first_day != o.listing_date:
            return False, f"first loaded bar {first_day} is not the listing day {o.listing_date} — not asserted"
        # ⭐ the claim names the symbol it was derived FOR; `starts_at_bar0_contradiction` refuses a capture whose own
        # symbol is another (2026-11-19: 17 captures of the 2026-09-27 wave carried "NYSE:RDDT listed 2024-03-21" on SPY,
        # AAPL and other charts, 12 of them false by their own bar_index rows)
        return True, (f"{o.symbol} listed {o.listing_date}; the chart's first bar is the listing day after "
                      f"requestMoreData stopped growing ({depth.get('count')} bars, batch_capture.py)")

    def capture(self, script) -> dict:
        o = self.opts
        # ⛔ the id first, before any page step: a capturePhase outside the vocabulary stops here, nothing touched
        capture_id = capture_id_for(script, o)
        self.gate("script start")
        self.step("signin")
        verdict, detail = layout_access(self.page)
        if verdict != "signed_in":
            raise Inconclusive(f"the session is no longer signed in ({verdict}: {detail}) — stopping", abort=True)
        raw, text = self.source_of(script)
        st = self.read_state("state_before")
        self.baseline_ids = {x["id"] for x in st["studies"]}
        if st["studies"]:
            raise GateFailed(f"the scratch layout carries {len(st['studies'])} studies "
                             f"{[s.get('name') for s in st['studies']]} — the rig must read 0 before a capture",
                             st, abort=True)
        self.script_state = self.ensure_symbol_tf(st)
        self.open_editor()
        uri = self.create_new_indicator()
        self.binding_gate()
        self.set_source(raw, uri, script["sha256"])
        self.gate("before add")
        sid = self.add_to_chart()
        self.wait_compute(sid)
        depth = self.force_depth()
        rows = self.wait_compute(sid, "compute:settle")
        self.opts.listing_date = self.listing_for(self.opts.symbol, self.opts.listing_date)
        starts, why = self.history_assertion(depth)
        lw = script.get("largestWindow")
        window = {"bars_loaded": rows, "largest_declared_window": lw,
                  "verdict": ("UNMEASURED" if not isinstance(rows, int) or lw is None
                              else "FULL_WINDOW" if rows >= lw else "WINDOW_TRUNCATED")}
        self.injected = True     # set BEFORE the evaluate: a half-run paste still gets cleaned
        ready = self.ev("inject", TV_CAPTURE.read_text(encoding="utf-8"))
        if not isinstance(ready, str) or not ready.startswith("uct vendor harness ready"):
            raise Inconclusive(f"tv_capture.js did not report ready: {ready!r}")
        census = self.ev("vh_studies", VH_STUDIES_JS)
        if not census or not census.get("controlProbeSawSomething") or not census.get("controlFilterRemovedExactlyTheEvents"):
            raise GateFailed(f"the study census failed its control: {census}", census)
        listed = census.get("list") or []
        if len(listed) != 1:
            raise GateFailed(f"the census lists {len(listed)} indicators — the scratch layout holds exactly the one "
                             f"added: {[x.get('title') for x in listed]}", census)
        title = listed[0].get("title") or listed[0].get("description")
        if not title:
            raise Inconclusive("the one indicator on the chart has no title to select it by", listed)
        self.added_titles.add(title)
        forming, forming_why = newest_bar_forming(o.newest_bar_forming)
        cap_opts = {
            "study": title, "source": text, "id": capture_id,
            "newestBarIsForming": forming, "startsAtBar0": starts, "startsAtBar0Why": why,
            "chunkSize": o.chunk_size,
        }
        # W9-T3a: a STRATEGY row carries how it is graded (a, b, none), its window for method (b)
        # and, only once the owner has taken W9-C0, the report path. Absent keys are not sent, so an
        # indicator's capture call is byte-identical to before.
        for key in ("gradeMethod", "gradeRange", "reportPath"):
            if script.get(key) is not None:
                cap_opts[key] = script[key]
        res = self.ev("vh_capture", VH_CAPTURE_JS, cap_opts)
        # ⭐ (c) THE PROBE LEAVES THE CHART THE MOMENT ITS VALUES ARE READ: `capture()` staged the whole capture text in
        # the page (`tv_capture.js`: `chunk(i)` slices `staged.text`), so the chunk reads and the transport check below
        # need no study. On the rig layout the editor's add is AUTOSAVED and a widget-API removal is not: a study that
        # outlives an autosave stays on the owner's layout (01:17Z 2026-11-19, the settled L12 batch). The shorter its
        # life, the smaller that window. `cleanup()` still runs after, as before (it finds nothing left to remove).
        self.remove_added_now()
        if not res or not res.get("ok"):
            msg = (res or {}).get("error") or str(res)
            if "failed to compile" in msg:
                raise RefusedByTV(f"TradingView: {msg}", res)
            if "matched" in msg or "census" in msg or "event filter" in msg:
                raise GateFailed(f"tv_capture refused: {msg}", res)
            raise Inconclusive(f"tv_capture could not read the study: {msg}", res)
        summary = res["summary"]
        scratch = self.rd.root / "scratch" / script["slug"]
        scratch.mkdir(parents=True, exist_ok=True)
        for old in scratch.glob("chunk-*.json"):
            old.unlink()
        n = int(summary.get("chunks") or 0)
        if n < 1:
            raise Inconclusive(f"tv_capture staged {n} chunks")
        for i in range(n):
            txt = self.ev("chunk", VH_CHUNK_JS, i)
            if not isinstance(txt, str):
                raise Inconclusive(f"chunk {i} did not come back as text")
            # ⭐ VERBATIM: the page's JSON.stringify output, byte for byte.
            with io.open(scratch / f"chunk-{i:03d}.json", "w", encoding="utf-8", newline="") as fh:
                fh.write(txt)
        out = self.rd.root / "captures" / f"{capture_id}.json"
        self.step("verify")
        v = self.verifier.assemble(scratch, out)
        if not v["ok"]:
            raise Inconclusive(f"verify_capture.mjs refused the transport (exit {v['exit']}, {v['verdict']}): "
                               f"{v['tail']}", v)
        back = self.verifier.verify_file(out)
        if not back["ok"]:
            raise Inconclusive(f"the written capture does not re-verify (exit {back['exit']}): {back['tail']}", back)
        # ⭐⭐ A CLAIM THE CAPTURE'S OWN DATA REFUTES IS REFUSED HERE, never written as evidence (coordinator, 2026-11-19)
        written = json.loads(out.read_text(encoding="utf-8"))
        contra = starts_at_bar0_contradiction(written, o.symbol)
        if contra:
            out.unlink()
            raise Inconclusive(f"startsAtBar0 refused at capture time: {contra}")
        # ⭐⭐ (folded 2026-11-20) A ROW THAT MOVED A COLOUR keeps its capture only when the study's LIVE palette holds every
        # moved colour a plot draws; otherwise the file is set aside (`captures-refused/`) and the row is INCONCLUSIVE
        if (self.row or {}).get("inputs"):
            lag = palette_lag(written)
            if lag:
                aside = self.rd.root / "captures-refused"
                aside.mkdir(exist_ok=True)
                out.replace(aside / out.name)
                raise Inconclusive(f"TradingView's live palette does not hold the moved colour(s) {lag}", {"lag": lag})
        return {"capture": str(out), "captureId": capture_id, "verify": {"exit": v["exit"], "verdict": v["verdict"]},
                "summary": {k: summary.get(k) for k in ("study", "symbol", "timeframe", "bars", "studyRows",
                                                        "plots", "objects", "warnings", "chars", "chunks")},
                "history": {"startsAtBar0": starts, "why": why}, "window": window,
                # ⭐ What tv_capture WROTE, which it derives from the chart (the bar's
                # period end vs the capture instant) and which overrides this guess: the
                # guess below only knows daily bars (a 1W bar on a Monday evening is
                # forming; the guess said closed). The guess is kept as `asserted`.
                "newestBarIsForming": {
                    "value": (summary.get("newestBarIsForming")
                              if isinstance(summary.get("newestBarIsForming"), bool) else forming),
                    "source": summary.get("newestBarIsFormingSource") or "asserted",
                    "asserted": forming, "why": forming_why},
                "depth": depth}

    def remove_added_now(self) -> list:
        """(c) Remove every study this script added (not in the row's baseline) right now, through the same
        model-level remove `cleanup()` uses; returns the ids asked to go. Never raises: a removal that fails here is
        retried, checked and reported by `cleanup()`, which always runs."""
        try:
            st = self.page.evaluate(STATE_JS) or {}
            base = self.baseline_ids if self.baseline_ids is not None else set()
            ids = [s["id"] for s in (st.get("studies") or []) if s.get("id") not in base]
            for sid in ids:
                self.page.evaluate(REMOVE_JS, sid)
            self.step("removed-at-capture")
            return ids
        except Exception:  # noqa: BLE001 — cleanup() owns the verdict
            return []

    def cleanup(self) -> dict:
        """⛔ ALWAYS RUNS. Remove what this script added, put the chart back,
        remove every trace. Each sub-step is independent: one failing does not
        skip the rest, and a dirty result stops the batch."""
        out = {"steps": []}
        problems = []

        def sub(name, fn):
            out["steps"].append(name)
            try:
                return fn()
            except Exception as exc:  # noqa: BLE001 — recorded, never swallowed silently
                problems.append(f"{name}: {type(exc).__name__}: {exc}")
                return None

        if self.menu_open:
            sub("dismiss_menu", lambda: self.page.keyboard.press("Escape"))
            self.menu_open = False
        st = sub("cleanup:state", lambda: self.page.evaluate(STATE_JS))
        base = self.baseline_ids
        extra = ([] if base is None
                 else [s["id"] for s in ((st or {}).get("studies") or []) if s["id"] not in base])
        if self.added_id and self.added_id not in extra:
            extra.append(self.added_id)
        for sid in extra:
            r = sub(f"remove:{sid}", lambda sid=sid: self.page.evaluate(REMOVE_JS, sid))
            if r is not None and not r.get("ok") and st and any(s["id"] == sid for s in st.get("studies") or []):
                problems.append(f"remove {sid}: {r}")
        if extra:
            after = None
            deadline = self.clock.monotonic() + self.opts.ui_timeout_s
            while True:
                after = sub("cleanup:state", lambda: self.page.evaluate(STATE_JS))
                left = [s for s in ((after or {}).get("studies") or [])
                        if (s["id"] not in base if base is not None else s["id"] in extra)]
                if after is not None and not left:
                    break
                if self.clock.monotonic() >= deadline:
                    problems.append(f"studies still on the chart after removal: {left}")
                    break
                self.clock.sleep(self.opts.poll_s)
            out["removed"] = extra
        if self.script_state:
            r = sub("cleanup:restore", lambda: self.restore(self.script_state, "cleanup"))
            if r is not None and not r["ok"]:
                problems.append(f"restore did not read back: {r}")
        # ⭐⭐ (2026-11-20) a row that named its session puts the chart's own back, read back like every restore
        back = getattr(self, "row_session_restore", None)
        if back:
            self.row_session_restore = None
            r = sub("cleanup:session", lambda: self.restore_session(back, "cleanup"))
            if r is not None and not r.get("ok"):
                problems.append(f"the session restore did not read back: {r}")
        if self.injected:
            r = sub("vh_cleanup", lambda: self.page.evaluate(VH_CLEANUP_JS))
            if r is not None and r.get("globalsLeft"):
                problems.append(f"__uctVH.cleanup() left {r['globalsLeft']}")
        g = sub("globals", lambda: self.page.evaluate(GLOBALS_JS))
        if g:
            problems.append(f"globals left on window: {g}")
        out["ok"] = not problems
        out["problems"] = problems
        if problems and not self.abort:
            self.abort = (1, f"cleanup left the chart dirty after {self.slug}: {problems}")
        return out

    def opts_for(self, script: dict) -> Opts:
        """⭐ PER-SCRIPT CHART (evidence engine): a manifest row may name its own
        `symbol` / `tf` / `listingDate`. Absent, the batch's own options stand, exactly
        as before. A listing date is never carried over from another symbol."""
        if not any(script.get(k) for k in ("symbol", "tf", "listingDate", "session")):
            return self.base_opts
        o = copy.copy(self.base_opts)
        if script.get("session") is not None:
            if script["session"] not in ROW_SESSIONS:
                raise GateFailed(f"{script.get('slug')}: session {script['session']!r} is not one of {sorted(ROW_SESSIONS)}",
                                 abort=True)
            o.session = script["session"]
        if script.get("symbol"):
            o.symbol = script["symbol"]
            o.listing_date = script.get("listingDate") or KNOWN_LISTING.get(o.symbol.upper())
        elif script.get("listingDate"):
            o.listing_date = script["listingDate"]
        if script.get("tf"):
            o.tf = script["tf"]
        return o

    def run_one(self, script: dict) -> dict:
        self._reset()
        self.row = script
        self.opts = self.opts_for(script)
        self.slug = script["slug"]
        started = utcnow()
        self.rd.claim(script, started)             # ⛔ BEFORE the first step
        result = {"schema": "uct.vendor-batch-result/v1", "runId": self.rd.run_id, "slug": script["slug"],
                  "path": script["path"], "sha256": script["sha256"], "startedAtUTC": started}
        try:
            try:
                got = self.capture(script)
                result.update(outcome=CAPTURED, reason="verified capture written", **got)
            except StepOutcome as so:
                result.update(outcome=so.outcome, reason=so.reason, detail=so.detail)
                if so.abort and not self.abort:
                    self.abort = (1 if so.outcome == GATE_FAILED else 2, so.reason)
            except Exception as exc:  # noqa: BLE001 — "could not measure" is never a pass or a fail
                result.update(outcome=INCONCLUSIVE, reason=f"{type(exc).__name__}: {exc}")
                if _is_target_closed(exc):
                    self.abort = (2, "the browser went away mid-batch")
        finally:
            cleanup = self.cleanup()
        result["cleanup"] = cleanup
        result["provenance"] = {**self.provenance, "symbol": self.opts.symbol, "tf": self.opts.tf,
                                "queueTargetId": script.get("queueTargetId"), "rows": script.get("rows") or [],
                                "localOnly": bool(script.get("localOnly")), "operator": "owner"}
        result["steps"] = list(self.steps)
        result["finishedAtUTC"] = utcnow()
        self.rd.finish(result)
        return result


def should_skip(prior, script, rd: RunDir, verifier, retry) -> tuple[bool, str]:
    if not prior:
        return False, "no prior result"
    if prior.get("sha256") != script["sha256"]:
        return False, "the script changed since the prior result"
    out = prior.get("outcome")
    if out == CAPTURED:
        cap = prior.get("capture")
        if not cap or not pathlib.Path(cap).exists():
            return False, "CAPTURED, but the capture file is gone"
        try:
            c = json.loads(pathlib.Path(cap).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return False, "CAPTURED, but the capture file does not parse"
        if (c.get("source") or {}).get("sha256") != script["sha256"]:
            return False, "CAPTURED, but the capture carries a different source"
        v = verifier.verify_file(pathlib.Path(cap))
        return (True, "CAPTURED and the file re-verifies") if v["ok"] else (False, f"CAPTURED, but it no longer verifies: {v['verdict']}")
    if out in retry:
        return False, f"prior outcome {out} is retried"
    if out in OUTCOMES:
        return True, f"prior outcome {out} is terminal"
    return False, f"unknown prior outcome {out!r}"


def provenance_salt() -> str | None:
    """The local salt from `$UCT_PROVENANCE_SALT`, or None when it is unset or too short to be a secret."""
    s = os.environ.get(PROVENANCE_SALT_ENV) or ""
    return s if len(s) >= MIN_SALT_CHARS else None


def account_fingerprint(page) -> str:
    """HMAC-SHA256(local salt, username)[:12] of the signed-in account; `no-salt` when no local salt is set
    (DOCUMENTED FALLBACK: the account is then not fingerprinted at all, and the page is not even asked);
    `unread` when the page names no user. Never the name, never an unsalted hash of it."""
    salt = provenance_salt()
    if salt is None:
        return "no-salt"
    try:
        name = page.evaluate(ACCOUNT_JS)
    except Exception:  # noqa: BLE001 — provenance must never fail a capture
        name = None
    if not (isinstance(name, str) and name):
        return "unread"
    return hmac.new(salt.encode("utf-8"), name.encode("utf-8"), hashlib.sha256).hexdigest()[:12]


def engine_sha() -> str:
    try:
        out = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(REPO), capture_output=True, text=True, timeout=20)
        return out.stdout.strip() or "unread"
    except Exception:  # noqa: BLE001
        return "unread"


def batch_provenance(page, rd, opts) -> dict:
    return {"runId": rd.run_id, "account": account_fingerprint(page),
            "profile": getattr(opts, "profile_leaf", None) or "unread",
            "rigLayout": LAYOUT.rstrip("/").rsplit("/", 1)[-1], "engineSha": engine_sha()}


def run_batch(page, manifest: dict, rd: RunDir, opts: Opts, clock, verifier=None,
              only=None, limit=None, log=print) -> int:
    verifier = verifier or NodeVerifier()
    scripts = [s for s in manifest["scripts"] if not only or s["slug"] in only]
    if limit is not None:
        scripts = scripts[:limit]
    drv = Driver(page, clock, opts, rd, verifier, log)
    rd.ledger("batch-start", scripts=len(scripts), symbol=opts.symbol, tf=opts.tf, throttleS=opts.throttle_s)
    counts = {k: 0 for k in OUTCOMES}
    counts["SKIPPED"] = 0
    code = 0
    original = None
    try:
        try:
            # ⛔ BEFORE ANY PAGE STEP: every script's capture id, and no two the same (nothing is captured otherwise)
            clash = capture_id_refusal(manifest["scripts"], drv.opts_for)
            if clash:
                raise GateFailed(f"capture ids: {clash}", abort=True)
            retired = retired_key_refusal(manifest["scripts"])
            if retired:
                raise GateFailed(f"manifest: {retired}", abort=True)
            drv.gate("batch start")
            original = drv.read_state("state_original")
            drv.provenance = batch_provenance(page, rd, opts)
            rd.ledger("provenance", **drv.provenance)
            if drv.provenance["account"] == "no-salt":
                log(f"[batch] provenance: ${PROVENANCE_SALT_ENV} is unset or under {MIN_SALT_CHARS} characters, "
                    "so the account is NOT fingerprinted (set it once to a local secret to record one)")
            # ⭐ A DEAD PROCESS'S ORPHAN, RECOGNISED BY ITS RECORDED ID — never by
            # name. A study is removed here ONLY if every study on the chart is
            # one an INCOMPLETE result in THIS run dir recorded adding; anything
            # else is left for the scratch-layout gate to STOP on.
            orphans = {r.get("addedStudyId") for r in rd.results().values()
                       if r.get("outcome") == INCOMPLETE and r.get("addedStudyId")}
            present = [s["id"] for s in original["studies"]]
            if present and set(present) <= orphans:
                for sid in present:
                    r = drv.ev("orphan:remove", REMOVE_JS, sid)
                    rd.ledger("orphan-removed", id=sid, ok=bool(r and r.get("ok")))
                original = drv.read_state("state_original")
            # ⭐⭐ (folded 2026-11-20, coordinator ruling) A LEFTOVER OF THIS MANIFEST'S OWN PROBES, from a batch that ended
            # before its own repair (an interrupted run whose add the layout autosaved, inputs and all): repaired ONLY
            # through the guarded clean-save, and only with `--clean-save`. The repair may remove nothing but studies
            # whose title one of this manifest's own probes declares; ANY other study, or a repair whose fresh load does
            # not read clean, stops the batch, as the scratch-layout gate always has. (It replaces the scratchpad
            # wrapper's in-memory "clear the one known leftover" stopgap, which never saved.)
            present = original.get("studies") or []
            names = {s.get("name") for s in present}
            if present and getattr(opts, "clean_save", False) and names <= manifest_titles(manifest["scripts"]):
                drv.added_titles |= names
                rep = drv.guarded_clean_save(original, "start-repair")
                rd.ledger("clean-save", **rep)
                if not rep.get("ok"):
                    raise GateFailed(f"the rig carries this manifest's own leftover(s) {sorted(names)} and the guarded "
                                     f"clean-save did not repair it: "
                                     f"{json.dumps({k: rep.get(k) for k in ('saved', 'refused', 'error')})}", rep,
                                     abort=True)
                log(f"[batch] start: the guarded clean-save removed this manifest's own leftover(s) {sorted(names)}; "
                    "a fresh load reads clean")
                original = drv.read_state("state_original")
        except StepOutcome as so:
            rd.ledger("abort", reason=so.reason)
            log(f"[batch] {so.outcome}: {so.reason}")
            return 1 if so.outcome == GATE_FAILED else 2
        processed = 0
        for script in scripts:
            prior = rd.read_result(script["slug"])
            if prior and prior.get("outcome") == INCOMPLETE:
                rd.ledger("found-incomplete", slug=script["slug"], claimedAt=prior.get("startedAtUTC"),
                          addedStudyId=prior.get("addedStudyId"))
            skip, why = should_skip(prior, script, rd, verifier, opts.retry)
            if skip:
                counts["SKIPPED"] += 1
                rd.ledger("skip", slug=script["slug"], reason=why)
                log(f"[batch] skip {script['slug']}: {why}")
                continue
            if processed and opts.throttle_s > 0:
                log(f"[batch] throttle {opts.throttle_s:.0f}s (this is the owner's own account)")
                clock.sleep(opts.throttle_s)
            processed += 1
            log(f"[batch] {script['slug']} …")
            r = drv.run_one(script)
            counts[r["outcome"]] += 1
            log(f"[batch] {script['slug']}: {r['outcome']} — {r.get('reason')}")
            if drv.abort:
                code = drv.abort[0]
                rd.ledger("abort", reason=drv.abort[1], after=script["slug"])
                log(f"[batch] STOPPING: {drv.abort[1]}")
                break
    finally:
        if original is not None:
            try:
                drv.steps = []
                back = drv.restore(original, "batch_restore")
                rd.ledger("batch-restore", **back, steps=drv.steps)
            except Exception as exc:  # noqa: BLE001
                rd.ledger("batch-restore", ok=False, error=f"{type(exc).__name__}: {exc}")
            # ⭐⭐ THE RIG'S PERSISTED STATE: only a FRESH load proves the batch left nothing persisted
            try:
                verified = drv.verify_fresh_load(original)
            except Exception as exc:  # noqa: BLE001
                verified = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
            rd.ledger("batch-verify", **verified)
            # ⭐⭐ THE GUARDED CLEAN-SAVE: a layout the fresh load shows dirty is repaired only through the guard, and
            # only when this run was started with `--clean-save`; every attempt is a ledger row
            if not verified.get("ok") and verified.get("read") and getattr(opts, "clean_save", False):
                rep = drv.guarded_clean_save(original, "batch-repair")
                rd.ledger("clean-save", **rep)
                if rep.get("ok"):
                    log(f"[batch] the guarded clean-save repaired the rig: a fresh load reads clean ({json.dumps(rep.get('before'))})")
                    verified = rep["after"]
                else:
                    log(f"[batch] the guarded clean-save did not repair the rig: {json.dumps({k: rep.get(k) for k in ('saved', 'refused', 'error')})}")
            if not verified.get("ok"):
                log(f"[batch] ⛔⛔ RIG LEFT DIRTY on a fresh load: {json.dumps(verified)} — the next batch's gate will "
                    "stop on it; the rig needs a repair before any capture")
                code = code or RIG_DIRTY
        rd.ledger("batch-end", counts=counts)
    log(f"[batch] done: {json.dumps(counts)}")
    return code


# ─── grade ───────────────────────────────────────────────────────────────────
def grade(run_dir: pathlib.Path, flag_on: bool, log=print) -> int:
    run_dir = pathlib.Path(run_dir).resolve()
    caps = run_dir / "captures"
    files = sorted(caps.glob("*.json")) if caps.exists() else []
    if not files:
        log(f"[grade] INCONCLUSIVE: no captures under {caps}")
        log("VERDICT: INCONCLUSIVE")
        return 2
    node = shutil.which("node")
    if not node:
        log("[grade] INCONCLUSIVE: node is not on PATH")
        return 2
    env = dict(os.environ)
    env["VENDOR_HARNESS_DIR"] = str(caps)
    env["VENDOR_HARNESS_OUT"] = str(run_dir)
    env["VITE_PINE_OBJECTS_ONLY_PANE_ENABLED"] = "1" if flag_on else ""
    started = time.time()
    proc = subprocess.run([node, "node_modules/vitest/vitest.mjs", "run", CORPUS_TEST], cwd=str(REPO / "app"),
                          env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=3600)
    out = (proc.stdout or "") + (proc.stderr or "")
    (run_dir / "grade.log").write_text(out, encoding="utf-8")
    totals = [ln for ln in out.splitlines() if re.search(r"\bTests\b.*\b(passed|failed)\b", ln)]
    written = [p for p in (run_dir / "verdicts.json", run_dir / "summary.md")
               if p.exists() and p.stat().st_mtime >= started - 1]
    ok = proc.returncode == 0 and bool(totals) and len(written) == 2
    if len(written) == 2:
        results = RunDir(run_dir, "grade").results()
        lines = ["", "## Batch outcomes (from `results/`)", "",
                 f"Graded with `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED={'1' if flag_on else ''}`.", "",
                 "| script | outcome | reason |", "|---|---|---|"]
        for slug, r in sorted(results.items()):
            reason = str(r.get("reason") or "").replace("|", "\\|").replace("\n", " ")[:200]
            lines.append(f"| `{slug}` | {r.get('outcome')} | {reason} |")
        with io.open(run_dir / "summary.md", "a", encoding="utf-8", newline="") as fh:
            fh.write("\n".join(lines) + "\n")
    log(f"[grade] vitest exit {proc.returncode}; totals: {totals[-1].strip() if totals else 'ABSENT'}; "
        f"wrote {[p.name for p in written]}")
    log(f"VERDICT: {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


# ─── the live session ────────────────────────────────────────────────────────
def report_profile_lock(profile) -> bool:
    """⛔ TEARDOWN KEEPS THE PROFILE AND PROVES ITS LOCK RELEASED (the rig rule): the next
    run must find it free. Reported, never forced: nothing here kills a process."""
    try:
        from window_check import profile_lock_released  # noqa: E402 — the one lock-release authority
        ok, held = profile_lock_released(timeout=30, profile=profile)
    except Exception as exc:  # noqa: BLE001
        print(f"[batch] profile lock: could not be checked ({type(exc).__name__}: {exc})")
        return False
    print(f"[batch] profile lock: {'released' if ok else 'STILL HELD ' + str(held)} ({pathlib.Path(profile).name}; "
          "the profile is kept, never deleted)")
    return ok


def _launch(args, body):
    """Open the session-owned browser on the rig layout, sign in (once, by the
    owner), then hand the page to `body`. Mirrors pine_vendor_capture.main()."""
    profile = resolve_profile(args.profile)
    refuse_owner_browser_profile(profile)
    profile.mkdir(parents=True, exist_ok=True)
    print(f"[batch] profile: {profile}  (this tool's own; never your Chrome's)")
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        launch = dict(headless=False, viewport=dict(RIG_VIEWPORT),
                      args=["--window-position=40,40"])
        if args.channel:
            launch["channel"] = args.channel
        try:
            ctx = p.chromium.launch_persistent_context(str(profile), **launch)
        except Exception as exc:  # noqa: BLE001
            print(f"[batch] LAUNCH FAILED: {type(exc).__name__}")
            for line in _profile_holders(profile):
                print(f"[batch]   {line}")
            print("[batch] INCONCLUSIVE: the profile is held by another process (not killed here).")
            return 2
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            page.goto(LAYOUT, wait_until="domcontentloaded")
            page.wait_for_timeout(9000)
            code = acquire(page, args.wait)
            if code != 0:
                return code
            page.wait_for_timeout(4000)
            return body(page)
        except Exception as exc:  # noqa: BLE001
            if _is_target_closed(exc):
                print("[batch] INCONCLUSIVE: the browser went away. The run dir keeps every result; re-run to resume.")
                return 2
            raise
        finally:
            try:
                ctx.close()
            except Exception:  # noqa: BLE001
                pass
            report_profile_lock(profile)


def _recon(page, args) -> int:
    """READ-ONLY: every reading the batch will rely on, printed, nothing clicked."""
    rd = {}
    try:
        _gate(page, "recon")
        rd["gate"] = "visible"
    except SystemExit as exc:
        rd["gate"] = str(exc)
    for name, expr, arg in (("state", STATE_JS, None), ("binding", BINDING_JS, None),
                            ("editor_present", EDITOR_PRESENT_JS, None), ("models", MODELS_JS, None),
                            ("title", TITLE_JS, args.title_selector or ""), ("depth", DEPTH_JS, 0)):
        try:
            rd[name] = page.evaluate(expr, arg) if arg is not None else page.evaluate(expr)
        except Exception as exc:  # noqa: BLE001
            rd[name] = f"{type(exc).__name__}: {exc}"
    print(json.dumps(rd, indent=1, default=str))
    st = rd.get("state") if isinstance(rd.get("state"), dict) else {}
    if not st.get("handle"):
        print("[recon] INCONCLUSIVE: no chart handle.")
        return 2
    if st.get("studies"):
        print(f"[recon] MEASURED: the rig layout carries {len(st['studies'])} studies — it must read 0.")
        return 1
    print("[recon] OK — the batch's readings are above. Nothing was clicked.")
    return 0


def _load_manifest(path) -> dict:
    m = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    if m.get("schema") != "uct.vendor-batch-manifest/v1" or not isinstance(m.get("scripts"), list):
        raise SystemExit(f"{path} is not a uct.vendor-batch-manifest/v1")
    return m


def main(argv=None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass
    ap = argparse.ArgumentParser(description="The unattended vendor batch (docs/pine/VENDOR-HARNESS.md).")
    ap.add_argument("--self-check", action="store_true", help="run the whole loop against a recording double")
    sub = ap.add_subparsers(dest="cmd")

    def common(sp):
        sp.add_argument("--profile", default=None)
        sp.add_argument("--channel", default=None, help="chrome | msedge (see pine_vendor_capture.py)")
        sp.add_argument("--wait", type=int, default=1800, help="seconds to wait for the one-time sign-in")
        sp.add_argument("--title-selector", default=None, help="CSS for the editor's script-title control")

    rc = sub.add_parser("recon", help="sign in + read-only readings")
    common(rc)
    r = sub.add_parser("run", help="the batch (resumable)")
    common(r)
    r.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
    r.add_argument("--run-dir", default=None, help="re-use to RESUME; default a new dir under "
                                                   f"{DEFAULT_RUN_ROOT}")
    r.add_argument("--symbol", default="NYSE:RDDT")
    r.add_argument("--tf", default="1D")
    r.add_argument("--listing-date", default=None, help="YYYY-MM-DD; enables startsAtBar0 for a young listing")
    r.add_argument("--throttle-s", type=float, default=30.0, help="pause between scripts (default 30s)")
    r.add_argument("--compute-timeout-s", type=float, default=120.0)
    r.add_argument("--chunk-size", type=int, default=60000)
    r.add_argument("--newest-bar-forming", choices=["auto", "true", "false"], default="auto")
    r.add_argument("--limit", type=int, default=None)
    r.add_argument("--only", action="append", default=None, help="a slug (repeatable)")
    r.add_argument("--retry", default=",".join(DEFAULT_RETRY),
                   help="prior outcomes to retry on resume (comma list)")
    r.add_argument("--clean-save", action="store_true",
                   help="repair a layout the fresh load shows dirty through the GUARDED clean-save (owner ruling 2026-11-19)")
    rp = sub.add_parser("repair", help="ONE guarded clean-save of the rig layout: remove the named leftover probes, "
                                       "restore symbol / resolution, Save only if clean in the page, verify on a fresh load")
    common(rp)
    rp.add_argument("--symbol", default="NYSE:RDDT")
    rp.add_argument("--tf", default="1D")
    rp.add_argument("--remove-title", action="append", required=True,
                    help="a leftover study's title this repair may remove (repeatable); nothing else is touched")
    g = sub.add_parser("grade", help="grade a run's captures (verdicts.json + summary.md)")
    g.add_argument("--run-dir", required=True)
    g.add_argument("--objects-only-pane", choices=["manifest", "on", "off"], default="manifest")
    args = ap.parse_args(argv)

    if args.self_check:
        from batch_double import self_check  # noqa: E402 — tools/vendor_harness is on the path below
        return self_check()

    if args.cmd == "grade":
        rdp = pathlib.Path(args.run_dir)
        if args.objects_only_pane == "manifest":
            try:
                m = json.loads((rdp / "manifest.json").read_text(encoding="utf-8"))
                flag_on = m["derivation"]["doorFlag"]["state"] == "on"
            except (OSError, ValueError, KeyError):
                print("[grade] INCONCLUSIVE: the run dir has no manifest.json naming its door-flag state; "
                      "pass --objects-only-pane on|off")
                return 2
        else:
            flag_on = args.objects_only_pane == "on"
        return grade(rdp, flag_on)

    if args.cmd == "recon":
        return _launch(args, lambda page: _recon(page, args))

    if args.cmd == "repair":
        run_id = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        rd = RunDir(DEFAULT_RUN_ROOT / f"repair-{run_id}", run_id)
        opts = Opts(symbol=args.symbol, tf=args.tf, title_selector=args.title_selector,
                    profile_leaf=resolve_profile(args.profile).name, clean_save=True)

        def _repair(page):
            drv = Driver(page, RealClock(page), opts, rd, None)
            drv.added_titles = set(args.remove_title)
            original = {"symbol": args.symbol, "resolution": args.tf}
            first = drv.verify_fresh_load(original)
            rd.ledger("repair-verify-before", **first)
            if first.get("ok"):
                print("[repair] the rig already reads clean on a fresh load: nothing to do")
                return 0
            out = drv.guarded_clean_save(original, "repair")
            rd.ledger("clean-save", **out)
            print(f"[repair] {json.dumps({k: out.get(k) for k in ('saved', 'refused', 'error', 'before', 'sawSaved')})}")
            print(f"[repair] fresh load after: {json.dumps(out.get('after'))}")
            return 0 if out.get("ok") else RIG_DIRTY
        return _launch(args, _repair)

    if args.cmd == "run":
        why = throttle_refusal(args.throttle_s)
        if why:
            print(f"[batch] REFUSED: {why}")
            return 2
        manifest = _load_manifest(args.manifest)
        run_id = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        run_dir = pathlib.Path(args.run_dir) if args.run_dir else DEFAULT_RUN_ROOT / run_id
        rd = RunDir(run_dir, run_id)
        mpath = run_dir / "manifest.json"
        if mpath.exists():
            old = json.loads(mpath.read_text(encoding="utf-8"))
            if [s["sha256"] for s in old.get("scripts", [])] != [s["sha256"] for s in manifest["scripts"]]:
                print(f"[batch] NOTE: resuming {run_dir} with a manifest that differs from the one it started with")
        write_json_atomic(mpath, manifest)
        opts = Opts(symbol=args.symbol, tf=args.tf,
                    listing_date=args.listing_date or KNOWN_LISTING.get(args.symbol.upper()),
                    throttle_s=args.throttle_s, compute_timeout_s=args.compute_timeout_s,
                    chunk_size=args.chunk_size, newest_bar_forming=args.newest_bar_forming,
                    title_selector=args.title_selector,
                    profile_leaf=resolve_profile(args.profile).name,
                    retry=[x.strip() for x in args.retry.split(",") if x.strip()],
                    clean_save=bool(args.clean_save))
        print(f"[batch] run dir: {run_dir}")
        return _launch(args, lambda page: run_batch(page, manifest, rd, opts, RealClock(page),
                                                    only=args.only, limit=args.limit))

    ap.print_help()
    return 2


sys.path.insert(0, str(HERE))

if __name__ == "__main__":
    sys.exit(main())
