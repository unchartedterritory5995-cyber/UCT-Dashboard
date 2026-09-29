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
import datetime as _dt
import hashlib
import io
import json
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
TV_CAPTURE = HERE / "tv_capture.js"
VERIFY = HERE / "verify_capture.mjs"
DEFAULT_MANIFEST = REPO / "docs" / "pine" / "vendor-harness" / "batch-manifest.json"
CORPUS_TEST = "src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js"
DEFAULT_RUN_ROOT = pathlib.Path(
    os.environ.get("LOCALAPPDATA") or os.environ.get("TEMP") or "/tmp") / "uct-vendor-batch" / "runs"

CAPTURED = "CAPTURED"
REFUSED_BY_TV = "REFUSED_BY_TV"
GATE_FAILED = "GATE_FAILED"
INCONCLUSIVE = "INCONCLUSIVE"
INCOMPLETE = "INCOMPLETE"
OUTCOMES = (CAPTURED, REFUSED_BY_TV, GATE_FAILED, INCONCLUSIVE, INCOMPLETE)
DEFAULT_RETRY = (INCOMPLETE, INCONCLUSIVE, GATE_FAILED)

#: Listing days this tool may assert `startsAtBar0` against. A young listing is
#: the instrument (capture-procedure.md, "BAR 0 IS NOT REACHABLE ON A LONG-HISTORY
#: SYMBOL"): the flag is asserted ONLY when the loaded history stopped growing AND
#: its first bar falls on this date in the exchange's own timezone.
KNOWN_LISTING = {"NYSE:RDDT": "2024-03-21"}


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

#: The script-title control: the element holding the editor's script name, above
#: the editor, inside the panel that also holds the add/update control.
#: Returns its CENTRE for a real (CDP) pointer click — never a DOM `.click()`,
#: because the menu opens on pointer events. `sel` overrides the heuristic.
TITLE_JS = r"""(sel) => {
  const own = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.offsetParent !== null };
  const centre = (el) => { const r = el.getBoundingClientRect(); return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, text: own(el) || (el.textContent || '').trim().slice(0, 60) } };
  if (sel) { const el = document.querySelector(sel); return el && vis(el) ? { ...centre(el), how: 'selector' } : { ok: false, why: `selector ${sel} matched nothing visible` } }
  const ed = document.querySelector('.monaco-editor'); if (!ed) return { ok: false, why: 'no editor' };
  let box = ed.parentElement;
  const holdsAction = (n) => [...n.querySelectorAll('*')].some((e) => ['Add to chart', 'Update on chart'].includes(own(e)));
  while (box && !holdsAction(box)) box = box.parentElement;
  if (!box) return { ok: false, why: 'no panel holds both the editor and an add/update control' };
  const top = ed.getBoundingClientRect().top;
  const cands = [...box.querySelectorAll('button,[role="button"],div,span')]
    .filter((el) => vis(el) && el.getBoundingClientRect().bottom <= top + 2 && own(el));
  const pick = cands.find((el) => own(el) === 'Untitled script') || cands.find((el) => /script/i.test(own(el)) && own(el).length < 60);
  return pick ? { ...centre(pick), how: 'heuristic' } : { ok: false, why: 'no script-title control found', candidates: cands.slice(0, 12).map(own) };
}"""

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

VH_STUDIES_JS = "() => window.__uctVH.studies()"
VH_CAPTURE_JS = ("(o) => { try { return { ok: true, summary: window.__uctVH.capture(o) } } "
                 "catch (e) { return { ok: false, error: String((e && e.message) || e) } } }")
VH_CHUNK_JS = "(i) => JSON.stringify(window.__uctVH.chunk(i))"
VH_CLEANUP_JS = "() => (window.__uctVH ? window.__uctVH.cleanup() : { globalsLeft: [], absent: true })"
GLOBALS_JS = "() => Object.keys(window).filter((k) => /^__uct/.test(k))"


# ─── small helpers ───────────────────────────────────────────────────────────
def utcnow() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def sym_match(have, want) -> bool:
    if not have or not want:
        return False
    a, b = str(have).upper(), str(want).upper()
    if ":" in a and ":" in b:
        return a == b
    return a.split(":")[-1] == b.split(":")[-1]


def res_norm(r) -> str:
    return re.sub(r"^1(?=[DWM]$)", "", str(r or "").strip().upper())


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
        self.retry = set(kw.get("retry", DEFAULT_RETRY))
        self.date = kw.get("date") or _dt.datetime.now().strftime("%Y-%m-%d")


class Driver:
    """One script's steps 1-12, over any object with the Playwright `page` surface
    this file uses: `evaluate`, `mouse.click/move`, `keyboard.press`, and what
    `acquire`/`layout_access` read. The self-check hands it a recording double."""

    def __init__(self, page, clock, opts: Opts, rd: RunDir, verifier, log=print):
        self.page, self.clock, self.opts, self.rd, self.verifier, self.log = page, clock, opts, rd, verifier, log
        self.abort = None           # (exit code, reason) once the rig cannot be trusted
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
    def read_state(self, name="state"):
        st = self.ev(name, STATE_JS)
        if not st or st.get("handle") is None:
            raise Inconclusive("no chart handle answered on window (TradingViewApi/tvWidget/widget)", st)
        if st.get("studies") is None:
            raise Inconclusive("the chart handle answered but getAllStudies() did not", st)
        return st

    def ensure_symbol_tf(self, st):
        o = self.opts
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
        g = self.ev("binding_gate", BINDING_JS)
        if not g or not g.get("gate"):
            raise GateFailed(f"binding gate: {g and g.get('addToChart')} own-text `Add to chart`, "
                             f"{g and g.get('updateOnChart')} `Update on chart` — refusing to write or click", g)
        return g

    def set_source(self, raw: bytes, uri: str, sha: str):
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

    def history_assertion(self, depth):
        o = self.opts
        if not depth.get("ok"):
            return False, f"the loaded depth could not be read ({depth.get('why')}) — not asserted"
        if not depth.get("stable"):
            return False, f"history was still growing after {depth.get('rounds')} requestMoreData rounds — not asserted"
        first_day = iso_date_in(depth.get("first"), depth.get("tz") or "Etc/UTC") if depth.get("first") else None
        if not o.listing_date:
            return False, f"no listing date is known for {o.symbol} — not asserted (first bar {first_day})"
        if first_day != o.listing_date:
            return False, f"first loaded bar {first_day} is not the listing day {o.listing_date} — not asserted"
        return True, (f"{o.symbol} listed {o.listing_date}; the chart's first bar is the listing day after "
                      f"requestMoreData stopped growing ({depth.get('count')} bars, batch_capture.py)")

    def capture(self, script) -> dict:
        o = self.opts
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
        forming, forming_why = newest_bar_forming(o.newest_bar_forming)
        sym_slug = slugify(o.symbol.split(":")[-1])
        tf_slug = slugify(res_norm(o.tf) if re.fullmatch(r"\d+", res_norm(o.tf)) else "1" + res_norm(o.tf))
        capture_id = f"{script['slug']}-{sym_slug}-{tf_slug}-{o.date}"
        res = self.ev("vh_capture", VH_CAPTURE_JS, {
            "study": title, "source": text, "id": capture_id,
            "newestBarIsForming": forming, "startsAtBar0": starts, "startsAtBar0Why": why,
            "chunkSize": o.chunk_size,
        })
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

    def run_one(self, script: dict) -> dict:
        self._reset()
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
            drv.gate("batch start")
            original = drv.read_state("state_original")
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
def _launch(args, body):
    """Open the session-owned browser on the rig layout, sign in (once, by the
    owner), then hand the page to `body`. Mirrors pine_vendor_capture.main()."""
    profile = resolve_profile(args.profile)
    refuse_owner_browser_profile(profile)
    profile.mkdir(parents=True, exist_ok=True)
    print(f"[batch] profile: {profile}  (this tool's own; never your Chrome's)")
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        launch = dict(headless=False, viewport={"width": TIERS[-1][1], "height": TIERS[-1][2]},
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

    if args.cmd == "run":
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
                    retry=[x.strip() for x in args.retry.split(",") if x.strip()])
        print(f"[batch] run dir: {run_dir}")
        return _launch(args, lambda page: run_batch(page, manifest, rd, opts, RealClock(page),
                                                    only=args.only, limit=args.limit))

    ap.print_help()
    return 2


sys.path.insert(0, str(HERE))

if __name__ == "__main__":
    sys.exit(main())
