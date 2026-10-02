"""Notebook editor budgets in a real browser: note-open p95 and typing cost per character.
Wave 7, lane I2. It runs LOCALLY ONLY and is never run in CI.

Playwright is a LOCAL install on this box. It is not in requirements.txt and is not in any
workflow. CI runs the search benchmark and the byte budget instead
(`.github/workflows/notebook-budgets.yml`; since wave 10 the gating byte check is
`notebook-bytes.yml` and the ratio latency check `notebook-latency.yml`); these two budgets
are a local gate step.

Wave 10 (lane 10A), `--attribute`: after each size's timed typing pass -- the budget reading,
uninstrumented -- the same characters are typed AGAIN with every piece of the editor timed in
place: each ProseMirror plugin's state field, plugin view `update`, `decorations` / text-input
props and `appendTransaction` (named by plugin key, so 10B's per-transaction column-resizing
plugin is a named row), the view's `dispatch` and `updateState`, TipTap's `emit` per event, and
React's scheduler tasks (its render + commit work, timed through the MessageChannel it runs
on) with a count of React commits. Reported as ms per timed keystroke, largest first. The
wrappers add their own cost, so the instrumented pass's p50 is printed beside it and never
used as a budget reading. The same pass is TRACED (Chrome's own timeline, `summarize_trace`):
the renderer main thread's self time per phase -- each input event's dispatch, style, layout,
paint, script, GC -- because what the wrappers cannot see (the browser's own editing work on
a large contenteditable) can be where a keystroke's time goes.

Lane TY4, `--busy`: a THIRD, TRACE-ONLY pass (no wrappers of any kind, not even the typing
probe's own keydown/MessageChannel listeners) types the same characters again with Chrome
tracing on. The window for each timed keystroke is read back out of the trace itself --
that keydown's `EventDispatch keydown` up to the next one's -- and the renderer main thread's
busy time inside that window (`keystroke_busy_ms`) is reported as a new row,
`typing_busy_per_char`, with p50 and p95. It exists because `typing_per_char`'s wall-clock
sample is bounded below by the ~16.7 ms display-frame interval (the control reading,
docs/notebook/perf-runs/ty-floor/README.md), so near the 16 ms budget line it can no longer
tell a fast editor from a slow one; `typing_busy_per_char` is the main-thread work alone, with
no frame wait in it.

⭐ Ruling D24 (docs/notebook/NOTEBOOK-10-OF-10-PLAN.md, decisions table; controller,
owner-delegated 2026-10-01) settled which row the 16 ms line binds: `typing_busy_per_char` p95,
for sizes up to the budget's paragraph limit, is now the typing budget's VERDICT -- a breach
there is a breach, exactly like `note_open`'s p95 against its own line. `typing_per_char`
(wall-clock) is still produced on every run and still written to the JSON and the markdown, but
with `budget_ms: None` ("n/a") and a note that it is not the budget's reading. Without a `--busy`
pass, or with one run alongside `--attribute` (whose wrappers load in the same context and make
the trace unclean -- `run_live`'s own caveat in `errors`), the typing budget has NO reading at
all: that is INCONCLUSIVE, with a message to rerun with `--busy` alone -- never a silent pass,
and never a breach decided on the wall-clock row.

Budgets: read from docs/notebook/perf-budgets.json, key "editor" (never retyped here):
  * note open p95 < 300 ms for notes up to 1,000 paragraphs
  * typing < 16 ms per character up to 2,000 paragraphs -- read on the `--busy` pass's
    `typing_busy_per_char` p95 (ruling D24); with no clean `--busy` pass the typing budget is
    INCONCLUSIVE, never decided on `typing_per_char`
    (G-035's 71 ms/char at the SIZE CAP stays as the owner ruled; the budget stops at 2,000)

What is measured, exactly:
  * NOTE OPEN: an IN-APP open, not a page load. The app is already booted on the Notebook.
    The note is opened the way a click does it: `history.pushState` to
    `/journal/notebook?note=<id>` plus a `popstate` event, so React Router routes it. The
    clock stops when the editor holds the note's LAST paragraph. A small note is opened in
    between, so each timed open is a real switch and never a re-render of the same note.
  * TYPING: main-thread cost per keystroke. A capture-phase `keydown` stamps t0. The editor's
    `input` event then posts a MessageChannel message, and its handler stamps t1. That
    handler runs after the current task and its microtasks: ProseMirror's transaction, the
    synchronous React commit, and every plugin's `view.update`. It does NOT wait for vsync.
    ⚠️ It DOES include one rendering frame: measured in Chromium (wave 10, lane 10A), the
    browser runs the frame the keystroke produced (style, layout, paint of the changed note)
    BEFORE the probe's message task in 80 of 80 keystrokes -- keydown -> frame 10.6 ms p50,
    frame -> sample 2.7 ms p50 at 2,000 paragraphs on a loaded box (perf-budgets.md §7). So a
    sample is "keystroke to its frame on the main thread", not script time alone. The caret
    sits at the END of the note, where a member appends.
    ⛔ A keystroke Playwright delivers but the editor never sees yields NO sample. The run
    compares the sample count with the characters sent and reports INCONCLUSIVE on a
    shortfall. It never reports a p95 over the keys that happened to land.

Sandbox (never C:\\data): `--boot` starts `scripts/hub_sandbox_boot.py --data-dir <dir>
--port <port>`. That launcher owns every env pin and the shared-root tripwire. Pass the
data dir from PowerShell or single-quoted: a Windows path through the Bash tool loses its
backslash and turns into a drive-relative directory (CLAUDE.md, 2026-09-12). The harness
refuses a data dir that resolves inside C:\\data or /data. It refuses a busy port too, and
never kills whatever holds it. `--base` measures an already-running sandbox instead, and
needs `--integrity-log` (that sandbox's own snapshot log) for the reason below.

⛔ `--base` WRITES NOTHING UNTIL THE SERVER PROVES WHO IT IS (tooling review M-3). A port is
not an identity: a stale non-sandbox backend on that port resolves every path to C:\\data,
and the sign-up, comp and seed writes would land in the owner's live auth.db while the run
read some other sandbox's clean log. The launcher writes a per-run nonce into its integrity
log and serves it at `sandbox_identity.IDENTITY_PATH`; before `--base` sends one request that
writes, `sandbox_identity.verify(--base, --integrity-log)` must find the SAME nonce in both
places (`scripts/sandbox_identity.py`). Otherwise the run is REFUSED (exit 3) with a sentence
naming what was checked. `--boot` starts its own launcher on a port it proved free.

⛔ THE SANDBOX'S SNAPSHOT VERDICT IS THIS HARNESS'S FIRST OUTPUT LINE (CLAUDE.md: "every
sandbox or staging boot reports the snapshot-compare result as its first line"). The
launcher hashes the shared data root before boot, at +15 s, at +120 s and at SHUTDOWN, and
appends each checkpoint to its integrity log. The harness therefore:
  * stops the launcher GRACEFULLY, never by TerminateProcess first. The shutdown checkpoint
    is written by the launcher's own `finally`, and a hard kill skips it. See `_SHIM` for
    the one extra step Windows needs.
  * does not stop it before the +15 s checkpoint has been written (a short run waits for it);
    `--hold-past-prewarm` also waits for +120 s.
  * reads the integrity log, prints `SANDBOX INTEGRITY: ...` first, and WITHHOLDS every
    timing when the log is missing, a checkpoint is absent, or any checkpoint is not CLEAN.
    That holds in BOTH modes: `--base` needs pre-boot, +15 s AND shutdown CLEAN in its
    `--integrity-log` too, so after its run it waits (`--shutdown-wait`, default 300 s) for
    the operator to stop that sandbox and its shutdown checkpoint to land.
  * a sign-in, comp or seed failure is not a measurement: the first line reads
    `SANDBOX INTEGRITY: NOT RUN (<reason>)` (still followed by the sandbox's own checkpoints)
    and the exit is 3, never 1 ("a budget breached").
Where this run's files go: next to `--json` when given, else into a fresh temp directory --
never the cwd, and a `--boot` run leaves NO file in the repo. The launcher writes its integrity
log under the repo's `docs/plans/joystick/sandbox-runs/` (`data_root_snapshot.log_path_for` has
no override); a `--boot` run's log is this run's own, so once the launcher has stopped it is
MOVED beside the launcher's output (`<stem>.integrity.md`). A `--base` run's log belongs to its
operator's sandbox and is copied, never moved. ⚰️ This said the logs never land in the cwd
while `--boot` left the launcher's integrity log in the repo (tooling review M-9).

Accounts: it signs up the sandbox admin (the launcher's ADMIN_EMAILS default,
hubtest@local.dev) and a perf account, comps the perf account through
POST /api/auth/admin/comp-access (the same door the wave-6 walk uses), then seeds its
notes through POST /api/j2/notes. Nothing is written except through the app's own doors.

    python tools/notebook_perf_harness.py --boot --data-dir 'C:\\data-w7perf' --port 8095 \\
        --json docs/notebook/perf-runs/editor-<sha>.json --md -
    python tools/notebook_perf_harness.py --dry-run            # no browser, no sandbox

Exit: 0 = within budget; 1 = a budget breached; 2 = INCONCLUSIVE (nothing trustworthy was
measured, including every run whose sandbox integrity did not close CLEAN, AND every run whose
typing reading has no verdict -- no `--busy` pass, or one run alongside `--attribute`, ruling
D24); 3 = refused or not run (bad args, a data dir in the shared root, a busy port, or the
measurement could not start: sign-in, comp or seeding failed).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
# Read at call time by `Sandbox.start`, never bound as a default argument, so a test can point
# it at a stand-in launcher (CLAUDE.md: "A DEFAULT ARGUMENT IS BOUND AT IMPORT").
BOOT_SCRIPT = REPO / "scripts" / "hub_sandbox_boot.py"

# The launcher's checkpoint labels. They are the launcher's words, not this file's:
# tests/test_notebook_perf_harness.py asserts each one is a string literal in
# scripts/hub_sandbox_boot.py, so a rename there reds here instead of silently making every
# run read INCOMPLETE.
PRE_BOOT = "pre-boot (baseline)"
POST_BOOT = "post-boot (+15s)"
PREWARM = "post-prewarm (+120s)"
SHUTDOWN = "shutdown"
# How long a --boot run waits for the launcher's +15 s / +120 s checkpoints before stopping it,
# and how long a --base run waits for its sandbox's shutdown checkpoint by default. Read at call
# time, so a rail can shorten them.
POST_BOOT_WAIT_S = 60.0
PREWARM_WAIT_S = 200.0
BASE_SHUTDOWN_WAIT_S = 300.0
ADMIN_EMAIL, ADMIN_PW = "hubtest@local.dev", "LocalTest2026!"
PERF_EMAIL, PERF_PW = "w7perf@local.dev", "LocalTest2026!"
SHARED_ROOTS = ("c:\\data", "/data")
BUDGETS = REPO / "docs" / "notebook" / "perf-budgets.json"


def _editor_budget() -> dict:
    """The "editor" budget from the committed budget file -- the ONE place the numbers live."""
    spec = json.loads(BUDGETS.read_text(encoding="utf-8"))["editor"]
    return {"open_ms": float(spec["open_p95_ms_max"]), "open_up_to": int(spec["open_up_to_paragraphs"]),
            "typing_ms": float(spec["typing_p95_ms_per_char_max"]),
            "typing_up_to": int(spec["typing_up_to_paragraphs"])}


_B = _editor_budget()
OPEN_BUDGET_MS = _B["open_ms"]
OPEN_UP_TO = _B["open_up_to"]
TYPING_BUDGET_MS = _B["typing_ms"]
TYPING_UP_TO = _B["typing_up_to"]

# ── the page scripts (run inside the app's own page) ─────────────────────────────────────

OPEN_NOTE_JS = """
async ({ id, marker, timeoutMs }) => {
  const t0 = performance.now()
  history.pushState({}, '', '/journal/notebook?note=' + encodeURIComponent(id))
  window.dispatchEvent(new PopStateEvent('popstate', { state: {} }))
  return await new Promise((resolve) => {
    const tick = () => {
      const pm = document.querySelector('.ProseMirror')
      if (pm && pm.textContent.includes(marker)) return resolve({ ok: true, ms: performance.now() - t0 })
      if (performance.now() - t0 > timeoutMs) return resolve({ ok: false, ms: performance.now() - t0 })
      requestAnimationFrame(tick)
    }
    tick()
  })
}
"""

INSTALL_TYPING_PROBE_JS = """
() => {
  const pm = document.querySelector('.ProseMirror')
  if (!pm) return false
  window.__w7Typing = { samples: [], pending: null }
  const st = window.__w7Typing
  window.addEventListener('keydown', () => { st.pending = performance.now() }, true)
  pm.addEventListener('input', () => {
    const t0 = st.pending
    if (t0 == null) return
    st.pending = null
    const ch = new MessageChannel()
    ch.port1.__w10probe = true   // the attribution pass must not count THIS port as React's scheduler
    ch.port1.onmessage = () => { st.samples.push(performance.now() - t0) }
    queueMicrotask(() => ch.port2.postMessage(0))
  })
  // caret at the very end of the document
  pm.focus()
  const sel = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(pm)
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
  return true
}
"""

READ_TYPING_JS = "() => (window.__w7Typing ? window.__w7Typing.samples.slice() : null)"

# ── wave 10 (lane 10A): attribution -- WHERE a keystroke's main-thread time goes ──────────
# Installed BEFORE the app loads (an init script): React's scheduler runs its render + commit
# work in MessageChannel tasks, so every `port.onmessage` handler is timed (the typing probe's
# own port is marked and skipped), and a minimal DevTools hook counts React commits. Inert until
# `on` is set, so the uninstrumented timing pass is unaffected by anything but the wrapper call.
ATTRIBUTION_INIT_JS = r"""
(() => {
  const S = window.__w10Sched = { on: false, ms: 0, n: 0, commits: 0 }
  const d = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage')
  if (d && d.set) {
    Object.defineProperty(MessagePort.prototype, 'onmessage', {
      configurable: true, enumerable: d.enumerable,
      get() { return d.get.call(this) },
      set(fn) {
        if (typeof fn !== 'function') return d.set.call(this, fn)
        const port = this
        d.set.call(this, function (ev) {
          if (!S.on || port.__w10probe) return fn.call(this, ev)
          const t = performance.now()
          try { return fn.call(this, ev) } finally { S.ms += performance.now() - t; S.n += 1 }
        })
      },
    })
  }
  if (!window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    let id = 0
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true, isDisabled: false, renderers: new Map(),
      inject(r) { id += 1; this.renderers.set(id, r); return id },
      onCommitFiberRoot() { if (S.on) S.commits += 1 },
      onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, onScheduleFiberRoot() {},
      setStrictMode() {}, checkDCE() {},
    }
  }
})()
"""

# Wraps, IN PLACE, every piece of the editor a transaction runs through, named by its
# ProseMirror plugin key: each plugin's state field (`config.fields[].apply`), its view's
# `update`, its `decorations` / text-input props and its `appendTransaction`; plus the view's
# `dispatch` and `updateState`, and TipTap's `emit` per event. Time is summed per name while
# `on`. Nested buckets overlap by design (`dispatch (total)` contains the rest).
INSTALL_ATTRIBUTION_JS = r"""
() => {
  const pm = document.querySelector('.ProseMirror')
  const editor = pm && pm.editor
  if (!editor || !editor.view) return { ok: false, why: 'no TipTap editor on .ProseMirror' }
  const view = editor.view
  const S = window.__w10Sched
  const A = window.__w10Attr = { on: false, buckets: {} }
  const add = (k, dt) => { const b = A.buckets[k] || (A.buckets[k] = { ms: 0, n: 0 }); b.ms += dt; b.n += 1 }
  const wrap = (obj, key, label) => {
    const fn = obj && obj[key]
    if (typeof fn !== 'function' || fn.__w10) return 0
    const w = function (...args) {
      if (!A.on) return fn.apply(this, args)
      const t = performance.now()
      try { return fn.apply(this, args) } finally { add(label, performance.now() - t) }
    }
    w.__w10 = true
    obj[key] = w
    return 1
  }
  let wrapped = 0
  for (const f of view.state.config.fields || []) wrapped += wrap(f, 'apply', 'state.apply ' + f.name)
  const withView = view.state.plugins.filter(p => p.spec && p.spec.view)
  ;(view.pluginViews || []).forEach((pv, i) => {
    const p = withView[i]
    wrapped += wrap(pv, 'update', 'view.update ' + (p ? p.key : '#' + i))
  })
  for (const p of view.state.plugins) {
    const props = p.props || {}
    for (const k of ['decorations', 'handleTextInput', 'handleKeyDown', 'handleKeyPress', 'nodeViews'])
      if (typeof props[k] === 'function') wrapped += wrap(props, k, k + ' ' + p.key)
    if (p.spec) wrapped += wrap(p.spec, 'appendTransaction', 'appendTransaction ' + p.key)
  }
  wrapped += wrap(view, 'dispatch', 'dispatch (total)')
  wrapped += wrap(view, 'updateState', 'view.updateState (DOM, decorations, plugin views)')
  const emit = editor.emit
  if (typeof emit === 'function' && !emit.__w10) {
    const e = function (name, ...args) {
      if (!A.on) return emit.call(this, name, ...args)
      const t = performance.now()
      try { return emit.call(this, name, ...args) } finally { add('tiptap emit ' + name, performance.now() - t) }
    }
    e.__w10 = true
    editor.emit = e
    wrapped += 1
  }
  return { ok: true, wrapped, plugins: view.state.plugins.map(p => p.key), sched: !!S }
}
"""

ATTRIBUTION_ON_JS = """
() => {
  const S = window.__w10Sched, A = window.__w10Attr
  if (S) { S.ms = 0; S.n = 0; S.commits = 0; S.on = true }
  if (A) { A.buckets = {}; A.on = true }
  return !!A
}
"""

ATTRIBUTION_READ_JS = """
() => {
  const S = window.__w10Sched, A = window.__w10Attr
  if (S) S.on = false
  if (A) A.on = false
  return { buckets: A ? A.buckets : {}, sched: S ? { ms: S.ms, n: S.n, commits: S.commits } : null }
}
"""


def summarize_attribution(raw: dict, keys: int) -> list[dict]:
    """Per-keystroke milliseconds by piece, largest first. `keys` is the number of timed
    keystrokes the pass produced (never the characters sent: a key the editor never saw did no
    work). React's scheduler tasks (render + commit) and the commit count ride along."""
    rows = []
    for name, b in (raw.get("buckets") or {}).items():
        rows.append({"piece": name, "ms_per_key": round(b["ms"] / keys, 4) if keys else None,
                     "calls_per_key": round(b["n"] / keys, 2) if keys else None})
    sched = raw.get("sched")
    if sched:
        rows.append({"piece": "React scheduler tasks (render + commit)",
                     "ms_per_key": round(sched["ms"] / keys, 4) if keys else None,
                     "calls_per_key": round(sched["n"] / keys, 2) if keys else None,
                     "react_commits_per_key": round(sched["commits"] / keys, 2) if keys else None})
    rows.sort(key=lambda r: -(r["ms_per_key"] or 0))
    return rows


#: The timeline categories the attribution pass records. `devtools.timeline` carries the
#: renderer's phases (EventDispatch per event type, UpdateLayoutTree, Layout, Paint, FunctionCall,
#: RunMicrotasks, GC); `toplevel` carries the task boundaries they nest in.
TRACE_CATEGORIES = ["devtools.timeline", "disabled-by-default-devtools.timeline", "toplevel", "v8"]


def _trace_label(e: dict) -> str:
    name = e.get("name", "?")
    data = (e.get("args") or {}).get("data") or {}
    if name == "EventDispatch" and data.get("type"):
        return f"EventDispatch {data['type']}"
    return name


def summarize_trace(trace, keys: int, top: int = 25) -> dict:
    """SELF time per phase on the renderer main thread(s), per timed keystroke, largest first.
    Complete (`X`) events are nested by time on each thread and a parent's self time excludes
    its children, so the rows ADD UP to the thread's busy time (`busy_ms_per_key`)."""
    data = json.loads(trace) if isinstance(trace, (bytes, bytearray, str)) else trace
    events = data.get("traceEvents", []) if isinstance(data, dict) else list(data)
    mains = _renderer_main_threads(events)
    threads: dict[tuple, list[dict]] = {}
    for e in events:
        if e.get("ph") == "X" and "dur" in e and (e.get("pid"), e.get("tid")) in mains:
            threads.setdefault((e["pid"], e["tid"]), []).append(e)
    self_us: dict[str, float] = {}
    count: dict[str, int] = {}

    def close(item):
        lab = item["label"]
        self_us[lab] = self_us.get(lab, 0.0) + max(0.0, item["dur"] - item["child"])
        count[lab] = count.get(lab, 0) + 1

    for evs in threads.values():
        evs.sort(key=lambda e: (e["ts"], -e["dur"]))
        stack: list[dict] = []
        for e in evs:
            while stack and stack[-1]["end"] <= e["ts"]:
                close(stack.pop())
            item = {"label": _trace_label(e), "dur": float(e["dur"]), "end": e["ts"] + e["dur"], "child": 0.0}
            if stack:
                stack[-1]["child"] += min(item["dur"], max(0.0, stack[-1]["end"] - e["ts"]))
            stack.append(item)
        while stack:
            close(stack.pop())
    busy = sum(self_us.values())
    rows = [{"phase": k, "self_ms_per_key": round(v / 1000.0 / keys, 4) if keys else None,
             "count_per_key": round(count[k] / keys, 2) if keys else None}
            for k, v in self_us.items()]
    rows.sort(key=lambda r: -(r["self_ms_per_key"] or 0))
    return {"threads": len(threads), "busy_ms_per_key": round(busy / 1000.0 / keys, 3) if keys else None,
            "rows": rows[:top]}


def _renderer_main_threads(events: list[dict]) -> set[tuple]:
    """(pid, tid) pairs for the renderer's main thread(s) -- the same question
    `summarize_trace` asks, factored out so the keystroke-busy reading below asks it
    identically rather than restating it."""
    return {(e.get("pid"), e.get("tid")) for e in events
            if e.get("ph") == "M" and e.get("name") == "thread_name"
            and (e.get("args") or {}).get("name") == "CrRendererMain"}


def _top_level_spans(events: list[dict], mains: set[tuple]) -> dict[tuple, list[tuple[float, float]]]:
    """Per renderer main thread, the [start, end) spans of TOP-LEVEL complete (`X`) events --
    nothing else on that thread was running outside of one of these spans, and nothing nested
    inside one starts or ends outside it (a well-formed trace's own invariant). The SAME nesting
    technique `summarize_trace` uses (sort by start, track what is currently open), but kept at
    the top-level-task granularity rather than per-label self time: a parent's duration is
    already self-inclusive of every child running inside it, so top-level spans never overlap
    each other, and summing them is the thread's busy time with no double counting -- the
    identical total `summarize_trace`'s per-label self-time rows would add up to, because
    clipping a span to a window and clipping its self-time pieces to the same window and
    re-summing produce the same number (clipping distributes over a disjoint partition of time)."""
    by_thread: dict[tuple, list[dict]] = {}
    for e in events:
        if e.get("ph") == "X" and "dur" in e and (e.get("pid"), e.get("tid")) in mains:
            by_thread.setdefault((e["pid"], e["tid"]), []).append(e)
    out: dict[tuple, list[tuple[float, float]]] = {}
    for key, evs in by_thread.items():
        evs = sorted(evs, key=lambda e: (e["ts"], -e["dur"]))
        spans: list[tuple[float, float]] = []
        cur_start: float | None = None
        cur_end: float | None = None
        for e in evs:
            start, end = float(e["ts"]), float(e["ts"]) + float(e["dur"])
            if cur_end is not None and start < cur_end:
                cur_end = max(cur_end, end)  # nested inside the open top-level span
                continue
            if cur_end is not None:
                spans.append((cur_start, cur_end))
            cur_start, cur_end = start, end
        if cur_end is not None:
            spans.append((cur_start, cur_end))
        out[key] = spans
    return out


def _keydown_dispatch_times(events: list[dict], mains: set[tuple]) -> list[float]:
    """Start timestamps (trace `ts`, microseconds) of every `EventDispatch keydown` on a
    renderer main thread, sorted. These are real keydown dispatches the browser itself
    recorded -- not a JS-side `performance.now()` stamp -- so there is no second clock to align
    with the trace's own timestamps."""
    out = []
    for e in events:
        if (e.get("ph") == "X" and e.get("name") == "EventDispatch"
                and (e.get("pid"), e.get("tid")) in mains
                and ((e.get("args") or {}).get("data") or {}).get("type") == "keydown"):
            out.append(float(e["ts"]))
    return sorted(out)


def keystroke_busy_ms(trace) -> list[float]:
    """Per-keystroke main-thread BUSY time, in ms -- one sample per complete keydown-to-keydown
    window. This is the quantity the typing budget is meant to bind ("a keystroke's work fits
    in one frame"), as distinct from `typing_per_char`'s wall-clock sample: that sample's tail
    is bounded below by the ~16.7 ms display-frame interval once a keystroke is fast, and near
    the 16 ms budget line it can no longer tell a fast editor from a slow one (the control
    reading in docs/notebook/perf-runs/ty-floor/README.md; `typing_per_char` itself is NOT
    changed by this function -- it stays exactly what it was).

    MUST be read from a TRACE-ONLY pass: no attribution wrappers installed (`ATTRIBUTION_INIT_JS`
    / `INSTALL_ATTRIBUTION_JS`), because the wrappers add their own cost to the very thing being
    measured. Chrome's own trace is what is read here; nothing about the editor is touched.

    A window is `[keydown_i, keydown_{i+1})`. The LAST keydown in a trace never closes a window
    (nothing bounds its end) and is dropped, the same way the typing probe's own first-open
    warm-up is dropped. Fewer than two keydowns -> no windows -> `[]`.

    What counts as busy, exactly: the portion of every TOP-LEVEL task's span
    (`_top_level_spans`) that overlaps the window. A task that straddles a window boundary is
    SPLIT at the boundary -- the portion before the boundary counts in the earlier window, the
    portion at or after counts in the later one. It is never attributed whole to one side (that
    would overstate one window and understate its neighbour) and never counted in both (that
    would double count the straddling portion). The idle gap between tasks, and the harness's
    own inter-key delay, are wall-clock time with NOTHING running on the main thread; they are
    never added in -- a window's busy time can be, and usually is, less than its wall width.

    What this does NOT count: GPU rasterization and compositor work happen off the renderer
    main thread and carry no `CrRendererMain` events in this trace's categories (TRACE_CATEGORIES
    is devtools-timeline / toplevel / v8, all main-thread), so they are invisible to this
    reading by construction. This is a MAIN-THREAD busy number, not a frame number -- it does not
    answer "did the frame land", only "was the main thread doing this keystroke's work"."""
    data = json.loads(trace) if isinstance(trace, (bytes, bytearray, str)) else trace
    events = data.get("traceEvents", []) if isinstance(data, dict) else list(data)
    mains = _renderer_main_threads(events)
    keydowns = _keydown_dispatch_times(events, mains)
    if len(keydowns) < 2:
        return []
    spans: list[tuple[float, float]] = []
    for thread_spans in _top_level_spans(events, mains).values():
        spans.extend(thread_spans)
    spans.sort()
    out = []
    for i in range(len(keydowns) - 1):
        w0, w1 = keydowns[i], keydowns[i + 1]
        busy_us = 0.0
        for s0, s1 in spans:
            if s1 <= w0 or s0 >= w1:
                continue
            busy_us += min(s1, w1) - max(s0, w0)
        out.append(busy_us / 1000.0)
    return out


def summarize_busy(busy_ms: dict[int, list[float]]) -> list[dict]:
    """Pure: per-size keystroke-busy samples -> REPORTED rows (`typing_busy_per_char`), carrying
    the typing budget (ruling D24, docs/notebook/NOTEBOOK-10-OF-10-PLAN.md decisions table: the
    16 ms line binds THIS row's p95, for sizes up to the budget's paragraph limit) exactly the
    way `note_open`'s rows carry theirs. This function does not itself raise a breach or an
    INCONCLUSIVE entry -- it is the per-size reading; `summarize()` is what turns these numbers
    (re-derived from the same raw samples, so a caller of `summarize()` alone needs no separate
    call here) into breaches, gated on whether a clean `--busy` pass ran at all."""
    rows = []
    for n, samples in sorted(busy_ms.items()):
        if not samples:
            continue
        rows.append({"measure": "typing_busy_per_char", "paragraphs": n, "samples": len(samples),
                     "p50_ms": round(percentile(samples, 50), 2),
                     "p95_ms": round(percentile(samples, 95), 2),
                     "budget_ms": TYPING_BUDGET_MS if n <= TYPING_UP_TO else None})
    return rows


def percentile(samples: list[float], pct: float) -> float:
    if not samples:
        raise ValueError("no samples")
    s = sorted(samples)
    return s[max(1, math.ceil(pct / 100.0 * len(s))) - 1]


def paragraphs_doc(n: int, tag: str) -> tuple[dict, str]:
    """A TipTap doc of n paragraphs; the LAST one carries a unique marker the open waits for."""
    content = [{"type": "paragraph", "content": [{"type": "text", "text":
               f"{tag} paragraph {i}: price reclaimed the 20 EMA on rising volume, stop under the swing low."}]}
               for i in range(n - 1)]
    marker = f"{tag}-END-{n}"
    content.append({"type": "paragraph", "content": [{"type": "text", "text": marker}]})
    return {"type": "doc", "content": content}, marker


def refuse_shared_root(data_dir: str) -> str | None:
    """Why `data_dir` is refused, or None. Resolves it first: a relative or drive-relative
    spelling must not slip past a string compare."""
    if not data_dir:
        return "no --data-dir"
    resolved = os.path.normcase(os.path.abspath(data_dir))
    for root in SHARED_ROOTS:
        r = os.path.normcase(os.path.abspath(root))
        if resolved == r or resolved.startswith(r.rstrip("\\/") + os.sep):
            return f"{data_dir!r} resolves to {resolved!r}, inside the shared data root {root!r}"
    return None


def port_busy(port: int) -> bool:
    """connect() succeeding is proof somebody is there (bind() succeeding proves nothing on
    Windows -- CLAUDE.md). A timeout is treated as NOT busy only because the launcher then
    runs its own refusal on the same port."""
    s = socket.socket()
    s.settimeout(1.0)
    try:
        return s.connect_ex(("127.0.0.1", port)) == 0
    finally:
        s.close()


def summarize(open_ms: dict[int, list[float]], typing_ms: dict[int, list[float]],
              typed_chars: dict[int, int], busy_ms: dict[int, list[float]] | None = None, *,
              busy_requested: bool = False, trace_clean: bool = True) -> dict:
    """Pure: raw samples -> the verdict rows. Kept separate so --dry-run can exercise it.

    Note open: unchanged -- the 300 ms line is read on `note_open`'s wall-clock p95, up to the
    budget's paragraph limit, exactly as before.

    Typing (ruling D24, docs/notebook/NOTEBOOK-10-OF-10-PLAN.md decisions table): the 16 ms line
    is read on `typing_busy_per_char` p95 -- `busy_ms`, from a TRACE-ONLY `--busy` pass, with no
    attribution wrappers loaded in the same browser context (`trace_clean`; `run_live` cannot
    keep a reading clean once `--attribute` shares its context, and says so in `errors`). The
    wall-clock `typing_per_char` rows (from `typing_ms`) are still produced here on every call,
    with `budget_ms: None` and a `note` saying they are not the budget's reading -- they are
    REPORTED, never a verdict. When no `--busy` pass ran (`busy_requested` False), or one ran but
    was not clean, the typing budget has NO reading at all: that is INCONCLUSIVE, with a message
    telling the caller to rerun with `--busy` -- never a silent pass, and never a breach decided
    on the wall-clock row.
    """
    rows = []
    breaches, inconclusive = [], []
    for n, samples in sorted(open_ms.items()):
        if not samples:
            inconclusive.append(f"note open at {n:,} paragraphs: no successful open")
            continue
        p95 = percentile(samples, 95)
        rows.append({"measure": "note_open", "paragraphs": n, "samples": len(samples),
                     "p50_ms": round(percentile(samples, 50), 1), "p95_ms": round(p95, 1),
                     "budget_ms": OPEN_BUDGET_MS if n <= OPEN_UP_TO else None})
        if n <= OPEN_UP_TO and p95 >= OPEN_BUDGET_MS:
            breaches.append(f"note open p95 {p95:.1f} ms >= {OPEN_BUDGET_MS:.0f} ms at {n:,} paragraphs")
    for n, samples in sorted(typing_ms.items()):
        sent = typed_chars.get(n, 0)
        if len(samples) < sent:
            inconclusive.append(f"typing (wall-clock) at {n:,} paragraphs: {len(samples)} samples "
                                f"for {sent} keys sent")
            continue
        p95 = percentile(samples, 95)
        rows.append({"measure": "typing_per_char", "paragraphs": n, "samples": len(samples),
                     "p50_ms": round(percentile(samples, 50), 2), "p95_ms": round(p95, 2),
                     "budget_ms": None,
                     "note": "wall-clock; not the budget's reading (ruling D24) -- see "
                             "typing_busy_per_char"})
    # The typing budget's actual reading (D24) -- never the loop above.
    if not busy_requested:
        inconclusive.append("typing budget: no reading -- rerun with --busy (ruling D24: the "
                             "16 ms line binds typing_busy_per_char, never the wall-clock "
                             "typing_per_char row)")
    elif not trace_clean:
        inconclusive.append("typing budget: the --busy pass was not a clean no-wrapper trace (it "
                             "ran alongside --attribute) -- no reading; rerun with --busy alone")
    else:
        for n, samples in sorted((busy_ms or {}).items()):
            if not samples:
                inconclusive.append(f"typing budget at {n:,} paragraphs: no busy windows were captured")
                continue
            p95 = percentile(samples, 95)
            if n <= TYPING_UP_TO and p95 >= TYPING_BUDGET_MS:
                breaches.append(f"typing (busy) p95 {p95:.2f} ms/char >= {TYPING_BUDGET_MS:.0f} ms "
                                f"at {n:,} paragraphs")
    return {"rows": rows, "breaches": breaches, "inconclusive": inconclusive}


def markdown_rows(summary: dict, sha: str | None) -> str:
    lines = ["| measure | paragraphs | samples | p50 | p95 | budget | tree |", "|---|---:|---:|---:|---:|---:|---|"]
    for r in summary["rows"]:
        b = f"< {r['budget_ms']:g} ms" if r["budget_ms"] else "n/a"
        tree = f"`{(sha or '?')[:9]}`"
        if r.get("note"):
            tree += f" ({r['note']})"
        lines.append(f"| {r['measure']} | {r['paragraphs']:,} | {r['samples']} | {r['p50_ms']} ms | "
                     f"{r['p95_ms']} ms | {b} | {tree} |")
    for i in summary["inconclusive"]:
        lines.append(f"| INCONCLUSIVE | | | | | | {i} |")
    return "\n".join(lines)


# ── the live run ──────────────────────────────────────────────────────────────────────────

# ── the sandbox's integrity log ───────────────────────────────────────────────────────────

# One checkpoint line, exactly as scripts/data_root_snapshot.py::append_log writes it:
#   - `2026-09-25 10:00:00`  **post-boot (+15s)** — C:\data, 61 db files — CLEAN
# The parser is railed against that writer itself (the test writes lines with append_log),
# so the two cannot drift apart unnoticed.
_CHECKPOINT_RE = re.compile(
    r"^- `(?P<at>[^`]+)`\s+\*\*(?P<label>.+?)\*\* \u2014 (?P<root>.*), "
    r"(?P<count>\d+) db files \u2014 (?P<verdict>.+?)\s*$")
_INTEGRITY_PATH_RE = re.compile(r"\[pre-boot\] integrity log: (?P<path>.+?)\s*$")


def read_integrity(path: str | os.PathLike | None, required: list[str]) -> dict:
    """Pure: the launcher's integrity log -> a verdict. CLEAN only when the file exists, every
    `required` checkpoint is present, and EVERY checkpoint in it reads CLEAN. A missing file,
    a missing checkpoint and a dirty one are three different statuses, never one."""
    out = {"path": str(path) if path else None, "required": list(required), "checkpoints": []}
    if not path or not Path(path).is_file():
        return {**out, "status": "MISSING", "clean": False,
                "why": "the launcher's integrity log was never found"}
    for line in Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
        m = _CHECKPOINT_RE.match(line)
        if m:
            out["checkpoints"].append({"label": m["label"], "at": m["at"], "root": m["root"],
                                       "db_files": int(m["count"]), "verdict": m["verdict"]})
    labels = [c["label"] for c in out["checkpoints"]]
    dirty = [f'{c["label"]}: {c["verdict"]}' for c in out["checkpoints"] if c["verdict"] != "CLEAN"]
    missing = [r for r in required if r not in labels]
    if dirty:
        return {**out, "status": "NOT CLEAN", "clean": False, "why": "; ".join(dirty)}
    if missing:
        return {**out, "status": "INCOMPLETE", "clean": False,
                "why": "no checkpoint " + ", ".join(repr(m) for m in missing)}
    return {**out, "status": "CLEAN", "clean": True, "why": ""}


def integrity_line(integ: dict, note: str = "", not_run: str | None = None) -> str:
    """The harness's FIRST output line. Names every checkpoint it saw, and the ones it did not.
    `not_run` (the measurement never started) leads the line, and the sandbox's own checkpoints
    still follow it: a sandbox that booted still owes its snapshot verdict (CLAUDE.md)."""
    seen = ", ".join(f'{c["label"]} {c["verdict"]}' for c in integ["checkpoints"]) or "no checkpoints"
    files = sorted({c["db_files"] for c in integ["checkpoints"]})
    parts = [f"SANDBOX INTEGRITY: NOT RUN ({not_run}) -- the sandbox's checkpoints: "
             f"{integ['status']} -- {seen}" if not_run else f"SANDBOX INTEGRITY: {integ['status']} -- {seen}"]
    if files:
        parts.append(f"{'/'.join(str(f) for f in files)} db files hashed")
    if integ.get("why"):
        parts.append(integ["why"])
    labels = {c["label"] for c in integ["checkpoints"]}
    if integ["checkpoints"] and PREWARM not in labels and PREWARM not in integ["required"]:
        parts.append(f"{PREWARM} not reached: the run ended before it "
                     "(--hold-past-prewarm waits for it)")
    if note:
        parts.append(note)
    parts.append(f"log: {integ['path'] or '(none)'}")
    return "; ".join(parts)


# ── the sandbox process ───────────────────────────────────────────────────────────────────

# The launcher is started through this shim, never directly. uvicorn 0.41 captures SIGINT /
# SIGTERM / SIGBREAK, shuts the server down gracefully, then RESTORES the original handlers and
# RE-RAISES the signal it caught. For SIGBREAK the original handler is SIG_DFL, so the re-raise
# kills the process (exit 3) before the launcher's `finally` writes its shutdown checkpoint.
# Measured with a stand-in uvicorn app, 2026-09-25: without a SIGBREAK handler, rc 3 and the
# `finally` never ran; with one, rc 0 and it did. The shim installs that handler as a no-op
# FIRST, so the re-raise lands on it and the launcher's own `finally` runs. On POSIX the stop
# is SIGINT, whose default handler raises KeyboardInterrupt up through that `finally`; the shim
# swallows it at the top so the exit is clean.
_SHIM = (
    "import runpy, signal, sys\n"
    "if hasattr(signal, 'SIGBREAK'):\n"
    "    signal.signal(signal.SIGBREAK, lambda *a: None)\n"
    "sys.argv = sys.argv[1:]\n"
    "try:\n"
    "    runpy.run_path(sys.argv[0], run_name='__main__')\n"
    "except KeyboardInterrupt:\n"
    "    pass\n"
)


class Sandbox:
    """One launcher process: started through `_SHIM` in its own process group, stopped by the
    signal the launcher already handles, and only then read for its integrity verdict."""

    def __init__(self, data_dir: str, port: int, log_path: Path):
        self.data_dir, self.port, self.log_path = data_dir, port, Path(log_path)
        self.proc: subprocess.Popen | None = None
        self.stop_how: str | None = None

    def start(self) -> None:
        cmd = [sys.executable, "-u", "-c", _SHIM, str(BOOT_SCRIPT), "--data-dir", self.data_dir,
               "--port", str(self.port), "--host", "127.0.0.1"]
        kw = ({"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt"
              else {"start_new_session": True})
        # The child inherits its own copy of the handle; ours is closed when the block ends.
        with open(self.log_path, "w", encoding="utf-8") as fh:
            self.proc = subprocess.Popen(cmd, cwd=str(REPO), stdout=fh, stderr=subprocess.STDOUT, **kw)

    def alive(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def integrity_path(self) -> str | None:
        """The path the launcher printed, read from its own output (unbuffered via `-u`)."""
        try:
            text = self.log_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return None
        for line in text.splitlines():
            m = _INTEGRITY_PATH_RE.search(line)
            if m:
                return m["path"]
        return None

    def labels(self) -> list[str]:
        path = self.integrity_path()
        if not path or not Path(path).is_file():
            return []
        return [c["label"] for c in read_integrity(path, [])["checkpoints"]]

    def wait_healthy(self, base: str, timeout_s: float) -> bool:
        import urllib.request
        end = time.time() + timeout_s
        while time.time() < end and self.alive():
            try:
                with urllib.request.urlopen(base + "/api/health", timeout=3) as r:
                    if r.status == 200:
                        return True
            except Exception:  # noqa: BLE001 -- not up yet
                pass
            time.sleep(0.5)
        return False

    def wait_checkpoint(self, label: str, timeout_s: float) -> bool:
        end = time.time() + timeout_s
        while time.time() < end and self.alive():
            if label in self.labels():
                return True
            time.sleep(0.5)
        return label in self.labels()

    def stop(self, grace_s: float = 120.0, exit_after_checkpoint_s: float = 30.0) -> str:
        """Ask the launcher to stop the way it already handles, and wait for its shutdown
        checkpoint. A hard kill is the LAST resort and is recorded as such: a run stopped that
        way has no shutdown checkpoint, so its integrity reads INCOMPLETE and its timings are
        withheld -- the failure direction is silence, never a clean-looking number."""
        if self.proc is None:
            self.stop_how = "never-started"
            return self.stop_how
        if self.proc.poll() is not None:
            self.stop_how = f"exited-on-its-own (rc {self.proc.returncode})"
            return self.stop_how
        try:
            self.proc.send_signal(signal.CTRL_BREAK_EVENT if os.name == "nt" else signal.SIGINT)
        except (OSError, ValueError) as e:
            # No console to deliver CTRL_BREAK to (a scheduled task, pythonw): the graceful stop
            # cannot even be asked for. Without this the raise would leave `finally` before any
            # kill and orphan the launcher on its port. Fall through to the last resort, said so
            # in the verdict line; the run then has no shutdown checkpoint and is withheld.
            self.proc.terminate()
            try:
                self.proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait()
            self.stop_how = (f"FORCED: the stop signal could not be delivered "
                             f"({type(e).__name__}: {e}); terminated")
            return self.stop_how
        end, checkpoint_at = time.time() + grace_s, None
        while time.time() < end:
            rc = self.proc.poll()
            if rc is not None:
                # rc 0 is the launcher returning through its `finally`; anything else is a
                # process that ended some other way, and the integrity log says which.
                self.stop_how = "graceful (rc 0)" if rc == 0 else f"exited on the stop request, rc {rc}"
                return self.stop_how
            if checkpoint_at is None and SHUTDOWN in self.labels():
                checkpoint_at = time.time()
            if checkpoint_at is not None and time.time() - checkpoint_at > exit_after_checkpoint_s:
                # The checkpoint is on disk; something (a non-daemon thread) is holding the
                # interpreter open after it. Nothing is lost by ending it now.
                self.proc.kill()
                self.proc.wait()
                self.stop_how = "graceful to the shutdown checkpoint, then forced exit"
                return self.stop_how
            time.sleep(0.25)
        self.proc.kill()
        self.proc.wait()
        self.stop_how = f"FORCED after {grace_s:.0f} s without a graceful exit"
        return self.stop_how


class SetupFailed(Exception):
    """The measurement could not start (sign-in, comp or seeding failed). An ordinary
    exception, never SystemExit: main() must still stop the sandbox, print the integrity
    line first, and exit 3 (not run), never 1 (a budget breached)."""


def _signup_or_login(req, base: str, email: str, pw: str, name: str) -> None:
    r = req.post(base + "/api/auth/signup", data={"email": email, "password": pw, "display_name": name})
    if r.status not in (200, 201):
        r = req.post(base + "/api/auth/login", data={"email": email, "password": pw})
    if r.status not in (200, 201):
        raise SetupFailed(f"could not sign in {email}: HTTP {r.status}")


def _provision(admin_req, member_req, base: str, *, member: tuple[str, str, str] | None = None) -> None:
    """The wave-6 walk's recipe (tools/notebook_wave6_walk.py): admin in its OWN context,
    the member comped AND email-verified (AuthGuard sends an unverified member to
    /verify-pending whatever the plan), then /api/auth/me must say paid-equivalent.

    `member` is (email, password, display name); None is this harness's own perf account. Wave 9
    (lane 9A) added it so the benchmark runner provisions ITS account through this one recipe
    instead of a copy; with no `member` the behaviour is unchanged."""
    email, pw, name = member or (PERF_EMAIL, PERF_PW, "w7perf")
    _signup_or_login(admin_req, base, ADMIN_EMAIL, ADMIN_PW, "hubtest")
    _signup_or_login(member_req, base, email, pw, name)
    c = admin_req.post(base + "/api/auth/admin/comp-access", data={"email": email, "action": "grant"})
    v = admin_req.post(base + "/api/auth/admin/verify-email", data={"email": email})
    me = member_req.get(base + "/api/auth/me").json()
    if not me.get("paid_equiv"):
        who = "perf account" if member is None else email
        raise SetupFailed(f"{who} is not paid-equivalent (comp HTTP {c.status}, verify HTTP {v.status}) "
                         "-- every notebook route would redirect and every number would be a redirect")


def _seed(req, base: str, sizes: list[int], run: str) -> dict[int, tuple[str, str]]:
    out = {}
    for n in sizes + [3]:
        doc, marker = paragraphs_doc(n, f"{run}-{n}")
        r = req.post(base + "/api/j2/notes", data={"title": f"perf {run} {n}", "bodyJson": doc})
        if r.status not in (200, 201):
            raise SetupFailed(f"seeding a {n}-paragraph note failed: HTTP {r.status} {r.text()[:200]}")
        out[n] = (r.json()["note"]["id"], marker)
    return out


_INTRO_DIALOG_SEL = 'div[role="dialog"][aria-label="Welcome"]'


def _dismiss_intro(pg) -> None:
    """The Welcome intro (IntroAnimation.jsx) plays once per tab and sits over the page.
    Same recipe as tools/notebook_wave6_walk.py: wait for it, Escape, then wait until it
    has actually DETACHED (it renders null once finished) -- never a blind sleep."""
    dialog = pg.locator(_INTRO_DIALOG_SEL)
    try:
        dialog.first.wait_for(state="visible", timeout=4000)
    except Exception:  # noqa: BLE001 -- it did not play in this tab
        return
    pg.keyboard.press("Escape")
    try:
        dialog.first.wait_for(state="detached", timeout=8000)
    except Exception:  # noqa: BLE001
        pg.get_by_role("button", name="Skip intro", exact=True).click(timeout=2000)
        dialog.first.wait_for(state="detached", timeout=8000)


def run_live(base: str, sizes: list[int], opens: int, chars: int,
             attribution: dict | None = None, busy: dict | None = None) -> tuple[dict, dict, dict, list[str]]:
    """`attribution`, when given a dict, is filled with each size's per-keystroke breakdown
    (`summarize_attribution`), taken in a SECOND typing pass after the timed one, so the
    budget reading never runs through the wrappers.

    `busy`, when given a dict, is filled with each size's per-keystroke main-thread busy-time
    samples (`keystroke_busy_ms`), taken in its OWN traced pass with no instrumentation
    installed at all -- not even the typing probe's keydown/MessageChannel listeners, since the
    window boundaries come from the trace's own keydown-dispatch events, not a JS-side stamp.
    ⚠️ Leave `attribution` as `None` (CLI: do not pass `--attribute`) when a clean `busy` reading
    matters: `ATTRIBUTION_INIT_JS` is a context-level init script, installed once at context
    creation whenever `attribution` is given, and it stays loaded (inert but not costless -- it
    wraps `MessagePort.prototype.onmessage`) for every page in that context for the rest of the
    run, including the busy pass. Requesting both is recorded as a caveat in `errors`, never
    silently accepted as clean."""
    from playwright.sync_api import sync_playwright
    errors: list[str] = []
    if busy is not None and attribution is not None:
        errors.append("--busy was requested alongside --attribute: the attribution init script "
                      "is loaded in this context for every page even while inert, so this run's "
                      "typing_busy_per_char reading is not from a clean no-wrapper trace -- rerun "
                      "with --busy alone for a reading this caveat does not apply to")
    run = time.strftime("r%H%M%S")
    open_ms: dict[int, list[float]] = {n: [] for n in sizes}
    typing_ms: dict[int, list[float]] = {}
    typed: dict[int, int] = {}
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin_ctx = br.new_context()
        ctx = br.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce")
        if attribution is not None:
            ctx.add_init_script(ATTRIBUTION_INIT_JS)
        _provision(admin_ctx.request, ctx.request, base)
        notes = _seed(ctx.request, base, sizes, run)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
        small_id, small_marker = notes[3]
        pg.goto(f"{base}/journal/notebook?note={small_id}")
        _dismiss_intro(pg)
        pg.wait_for_selector(".ProseMirror", timeout=30000)
        for n in sizes:
            nid, marker = notes[n]
            for _ in range(opens + 1):  # the first open is a warm-up and is not counted
                pg.evaluate(OPEN_NOTE_JS, {"id": small_id, "marker": small_marker, "timeoutMs": 15000})
                got = pg.evaluate(OPEN_NOTE_JS, {"id": nid, "marker": marker, "timeoutMs": 15000})
                if got["ok"]:
                    open_ms[n].append(got["ms"])
            open_ms[n] = open_ms[n][1:]
            # typing, at the end of this note
            pg.evaluate(OPEN_NOTE_JS, {"id": nid, "marker": marker, "timeoutMs": 15000})
            if not pg.evaluate(INSTALL_TYPING_PROBE_JS):
                errors.append(f"typing probe could not find the editor at {n} paragraphs")
                continue
            pg.keyboard.type("x" * chars, delay=25)
            pg.wait_for_timeout(300)
            samples = pg.evaluate(READ_TYPING_JS) or []
            typing_ms[n] = samples
            typed[n] = chars
            if busy is not None:
                # TRACE-ONLY: no wrappers, not even the typing probe's own keydown/MessageChannel
                # listeners -- the window boundaries are read back out of the trace itself.
                br.start_tracing(page=pg, categories=TRACE_CATEGORIES)
                pg.keyboard.type("z" * chars, delay=25)
                pg.wait_for_timeout(300)
                btrace = br.stop_tracing()
                busy[n] = keystroke_busy_ms(btrace)
                if not busy[n]:
                    errors.append(f"keystroke-busy trace at {n} paragraphs: fewer than two "
                                  "keydown dispatches were captured -- no complete window")
            if attribution is not None:
                inst = pg.evaluate(INSTALL_ATTRIBUTION_JS)
                if not inst.get("ok"):
                    errors.append(f"attribution could not install at {n} paragraphs: {inst.get('why')}")
                    continue
                before = len(pg.evaluate(READ_TYPING_JS) or [])
                br.start_tracing(page=pg, categories=TRACE_CATEGORIES)
                pg.evaluate(ATTRIBUTION_ON_JS)
                pg.keyboard.type("y" * chars, delay=25)
                pg.wait_for_timeout(300)
                raw = pg.evaluate(ATTRIBUTION_READ_JS)
                trace = br.stop_tracing()
                inst_samples = (pg.evaluate(READ_TYPING_JS) or [])[before:]
                keys = len(inst_samples)
                attribution[n] = {"keys": keys, "wrapped": inst.get("wrapped"),
                                  "plugins": inst.get("plugins"),
                                  "instrumented_p50_ms": round(percentile(inst_samples, 50), 3) if inst_samples else None,
                                  "rows": summarize_attribution(raw, keys),
                                  "trace": summarize_trace(trace, keys)}
        br.close()
    return open_ms, typing_ms, typed, errors


def dry_run() -> int:
    """No browser, no sandbox: parse the page scripts, and run the pure halves against
    stub samples, including one that must breach and one that must be INCONCLUSIVE."""
    import re
    for name, js in (("OPEN_NOTE_JS", OPEN_NOTE_JS), ("INSTALL_TYPING_PROBE_JS", INSTALL_TYPING_PROBE_JS),
                     ("ATTRIBUTION_INIT_JS", ATTRIBUTION_INIT_JS), ("INSTALL_ATTRIBUTION_JS", INSTALL_ATTRIBUTION_JS),
                     ("ATTRIBUTION_ON_JS", ATTRIBUTION_ON_JS), ("ATTRIBUTION_READ_JS", ATTRIBUTION_READ_JS)):
        opens, closes = js.count("{"), js.count("}")
        assert opens == closes, f"{name}: unbalanced braces ({opens} vs {closes})"
        assert re.search(r"=>", js), f"{name}: not a function"
    # wave 10: the attribution summary is per TIMED keystroke, largest first, React row included
    att = summarize_attribution({"buckets": {"a": {"ms": 10.0, "n": 5}, "b": {"ms": 30.0, "n": 5}},
                                 "sched": {"ms": 20.0, "n": 10, "commits": 5}}, 5)
    assert [r["piece"] for r in att] == ["b", "React scheduler tasks (render + commit)", "a"], att
    assert att[0]["ms_per_key"] == 6.0 and att[1]["react_commits_per_key"] == 1.0, att
    assert all(r["ms_per_key"] is None for r in summarize_attribution({"buckets": {"a": {"ms": 1.0, "n": 1}}}, 0))
    # wave 10: the trace summary is SELF time -- a parent's children come out of it, rows add up
    tr = summarize_trace({"traceEvents": [
        {"ph": "M", "name": "thread_name", "pid": 1, "tid": 7, "args": {"name": "CrRendererMain"}},
        {"ph": "X", "name": "RunTask", "pid": 1, "tid": 7, "ts": 0, "dur": 10000},
        {"ph": "X", "name": "EventDispatch", "pid": 1, "tid": 7, "ts": 1000, "dur": 6000,
         "args": {"data": {"type": "keydown"}}},
        {"ph": "X", "name": "Layout", "pid": 1, "tid": 7, "ts": 2000, "dur": 4000},
        {"ph": "X", "name": "Layout", "pid": 2, "tid": 9, "ts": 0, "dur": 99000}]}, 2)
    got = {r["phase"]: r["self_ms_per_key"] for r in tr["rows"]}
    assert got == {"Layout": 2.0, "EventDispatch keydown": 1.0, "RunTask": 2.0}, got
    assert tr["busy_ms_per_key"] == 5.0 and tr["threads"] == 1, tr
    # lane TY4: keystroke-busy windows are read from the trace's OWN keydown-dispatch events --
    # no JS-side stamp needed. Three keydowns -> two complete windows [0,10000) and
    # [10000,25000). Busy time only (idle gaps excluded), and a task that straddles the boundary
    # (8000..14000, spanning the keydown at 10000) is SPLIT at the boundary: 2000us before it
    # counts in the earlier window, 4000us at-or-after counts in the later one.
    busy = keystroke_busy_ms({"traceEvents": [
        {"ph": "M", "name": "thread_name", "pid": 1, "tid": 7, "args": {"name": "CrRendererMain"}},
        {"ph": "X", "name": "EventDispatch", "pid": 1, "tid": 7, "ts": 0, "dur": 100,
         "args": {"data": {"type": "keydown"}}},                       # keystroke 0's dispatch
        {"ph": "X", "name": "RunTask", "pid": 1, "tid": 7, "ts": 2000, "dur": 3000},  # work, all in window 0
        # idle gap, 5000..8000: nothing on the main thread -- must not be counted as busy
        {"ph": "X", "name": "RunTask", "pid": 1, "tid": 7, "ts": 8000, "dur": 6000},  # straddles the boundary
        {"ph": "X", "name": "EventDispatch", "pid": 1, "tid": 7, "ts": 10000, "dur": 50,
         "args": {"data": {"type": "keydown"}}},                       # keystroke 1's dispatch, nested inside it
        {"ph": "X", "name": "RunTask", "pid": 1, "tid": 7, "ts": 16000, "dur": 2000},  # work, all in window 1
        {"ph": "X", "name": "EventDispatch", "pid": 1, "tid": 7, "ts": 25000, "dur": 50,
         "args": {"data": {"type": "keydown"}}},                       # closes window 1; opens no window 2
    ]})
    assert len(busy) == 2, busy
    assert abs(busy[0] - 5.1) < 1e-9, busy    # 100 (kd0) + 3000 (work) + 2000 (straddle's share) us
    assert abs(busy[1] - 6.0) < 1e-9, busy    # 4000 (straddle's share) + 2000 (work) us
    assert busy[0] < 10.0 and busy[1] < 15.0, busy  # each window's busy < its wall width -- idle excluded
    assert keystroke_busy_ms({"traceEvents": [
        {"ph": "M", "name": "thread_name", "pid": 1, "tid": 7, "args": {"name": "CrRendererMain"}},
        {"ph": "X", "name": "EventDispatch", "pid": 1, "tid": 7, "ts": 0, "dur": 100,
         "args": {"data": {"type": "keydown"}}}]}) == [], "one keydown closes no window"
    busy_rows = summarize_busy({1000: busy, 2000: []})
    assert len(busy_rows) == 1 and busy_rows[0]["measure"] == "typing_busy_per_char", busy_rows
    # ruling D24: a busy row up to the budget's paragraph limit now CARRIES the typing budget --
    # it is the budget's reading, same as note_open's rows carry theirs.
    assert busy_rows[0]["paragraphs"] == 1000 and busy_rows[0]["budget_ms"] == TYPING_BUDGET_MS, busy_rows
    assert busy_rows[0]["p50_ms"] == 5.1 and busy_rows[0]["p95_ms"] == 6.0, busy_rows
    above_cap_busy_rows = summarize_busy({3000: [999.0, 999.0]})
    assert above_cap_busy_rows[0]["budget_ms"] is None, above_cap_busy_rows
    doc, marker = paragraphs_doc(1000, "dry")
    assert len(doc["content"]) == 1000 and doc["content"][-1]["content"][0]["text"] == marker
    # a clean, --busy-backed run: nothing breaches, nothing is inconclusive.
    ok = summarize({1000: [100.0] * 20, 2000: [400.0] * 20}, {1000: [3.0] * 60, 2000: [9.0] * 60},
                   {1000: 60, 2000: 60}, busy_ms={1000: [5.0] * 20, 2000: [10.0] * 20},
                   busy_requested=True, trace_clean=True)
    assert ok["breaches"] == [] and ok["inconclusive"] == [], ok
    # no --busy at all: the note-open breach still fires, but typing raises no breach off the
    # wall-clock row -- only an INCONCLUSIVE telling the caller to rerun with --busy.
    bad = summarize({1000: [350.0] * 20}, {2000: [20.0] * 60}, {2000: 60})
    assert len(bad["breaches"]) == 1 and "note open" in bad["breaches"][0], bad
    assert any("rerun with --busy" in m for m in bad["inconclusive"]), bad
    short = summarize({1000: []}, {1000: [1.0] * 10}, {1000: 60})
    assert not short["rows"], short
    # note-open shortfall, typing wall-clock shortfall, AND the no-busy typing-budget entry: 3.
    assert len(short["inconclusive"]) == 3, short
    # ── ruling D24, lane TY6: the typing verdict's rules, pinned here as pure-function cases ──
    # 1) busy p95 over budget at 2,000 paragraphs is a breach.
    d24_breach = summarize({}, {}, {}, busy_ms={1000: [5.0] * 20, 2000: [20.0] * 20},
                           busy_requested=True, trace_clean=True)
    assert len(d24_breach["breaches"]) == 1 and "2,000" in d24_breach["breaches"][0], d24_breach
    # 2) the D24 case itself: busy UNDER budget while wall-clock is OVER it -> NO breach, and the
    #    wall-clock row is still present, with no budget of its own and a note naming why.
    d24_case = summarize({}, {1000: [20.0] * 60}, {1000: 60}, busy_ms={1000: [9.0] * 20},
                         busy_requested=True, trace_clean=True)
    assert d24_case["breaches"] == [] and d24_case["inconclusive"] == [], d24_case
    wc_row = d24_case["rows"][0]
    assert wc_row["measure"] == "typing_per_char" and wc_row["budget_ms"] is None, wc_row
    assert "D24" in wc_row["note"] and "typing_busy_per_char" in wc_row["note"], wc_row
    # 3) no --busy pass at all -> typing is INCONCLUSIVE with the rerun message, never a pass and
    #    never a breach, whatever the wall-clock row says.
    d24_no_busy = summarize({}, {1000: [1.0] * 60}, {1000: 60})
    assert d24_no_busy["breaches"] == [], d24_no_busy
    assert any("rerun with --busy" in m for m in d24_no_busy["inconclusive"]), d24_no_busy
    # 4) --busy ran but alongside --attribute (an unclean, wrapper-sharing trace) -> INCONCLUSIVE,
    #    never a pass, even though the busy sample itself is wildly over budget.
    d24_unclean = summarize({}, {}, {}, busy_ms={1000: [999.0] * 20}, busy_requested=True,
                            trace_clean=False)
    assert d24_unclean["breaches"] == [], d24_unclean
    assert any("not a clean" in m for m in d24_unclean["inconclusive"]), d24_unclean
    # 5) a size above the budget's paragraph limit never breaches, however bad its p95.
    d24_above_cap = summarize({}, {}, {}, busy_ms={3000: [999.0] * 20}, busy_requested=True,
                              trace_clean=True)
    assert d24_above_cap["breaches"] == [] and d24_above_cap["inconclusive"] == [], d24_above_cap
    # In THIS platform's spelling: `C:\data` is a relative name on POSIX, which is not the root
    # this box would write to there (PR #196 CI ran the dry run on ubuntu and it failed here).
    home = r"C:\data" if os.name == "nt" else "/data"
    assert refuse_shared_root(home) and refuse_shared_root(os.path.join(home, "sub"))
    assert refuse_shared_root(home + "-w7perf") is None
    assert (OPEN_BUDGET_MS, OPEN_UP_TO, TYPING_BUDGET_MS, TYPING_UP_TO) == (300.0, 1000, 16.0, 2000), \
        "the editor budget in perf-budgets.json is not the brief's"
    # the integrity reader, against lines written by the launcher's own writer
    sys.path.insert(0, str(REPO / "scripts"))
    import data_root_snapshot as drs
    with tempfile.TemporaryDirectory(prefix="w7perf-dry-") as d:
        log = os.path.join(d, "integrity.md")
        drs.append_log(log, PRE_BOOT, r"C:\data", 3, [])
        drs.append_log(log, POST_BOOT, r"C:\data", 3, [])
        assert read_integrity(log, [PRE_BOOT, POST_BOOT, SHUTDOWN])["status"] == "INCOMPLETE"
        drs.append_log(log, SHUTDOWN, r"C:\data", 3, [])
        assert read_integrity(log, [PRE_BOOT, POST_BOOT, SHUTDOWN])["status"] == "CLEAN"
        drs.append_log(log, SHUTDOWN, r"C:\data", 3, [("CHANGED", "auth.db", "sha differs")])
        assert read_integrity(log, [PRE_BOOT, POST_BOOT, SHUTDOWN])["status"] == "NOT CLEAN"
    assert read_integrity(None, [PRE_BOOT])["status"] == "MISSING"
    print(markdown_rows(ok, "dryrun"))
    print("DRY RUN: page scripts parse, the verdict logic breaches and goes INCONCLUSIVE when it must, "
          "the typing verdict follows ruling D24 (busy p95 decides, wall-clock never does, no "
          "--busy or an unclean trace is INCONCLUSIVE, the paragraph cap is honoured), "
          "the integrity reader tells CLEAN, INCOMPLETE, NOT CLEAN and MISSING apart, and "
          "keystroke-busy windows sum top-level task time with idle gaps excluded and a "
          "boundary-straddling task split correctly")
    return 0


def _sandbox_identity():
    """`scripts/sandbox_identity.py`, the launcher's identity marker (M-3). Imported at call
    time from the launcher's own directory, so this module stays importable anywhere."""
    scripts = str(REPO / "scripts")
    if scripts not in sys.path:
        sys.path.insert(0, scripts)
    import sandbox_identity
    return sandbox_identity


def _keep_integrity_log(integ: dict, dest: Path, *, own: bool) -> None:
    """Keep the sandbox's integrity log beside this run's other files (review M-9).

    `own` (a `--boot` run: this harness started the launcher, and it has stopped): the log is
    MOVED -- it was written under the repo's `docs/plans/joystick/sandbox-runs/`, and a run must
    leave the repo as it found it; `integ["path"]` then names where it is now, and the first line
    says so. A move that fails falls back to a copy and says why. Not `own` (a `--base` run): the
    operator's sandbox owns that log, so it is copied."""
    src = integ.get("path")
    if not src or not Path(src).is_file():
        return
    integ["copy"] = str(dest)
    if not own:
        shutil.copyfile(src, dest)
        return
    try:
        shutil.move(src, dest)
    except OSError as e:
        shutil.copyfile(src, dest)
        integ["move_failed"] = f"{type(e).__name__}: {e}"
        return
    integ["moved_from"] = src
    integ["path"] = str(dest)


def _log_home(json_path: str | None) -> tuple[Path, str]:
    """Where this run's own files go: beside --json when given, else a fresh temp directory.
    Never the current directory (the old default left a stray perf.sandbox.log wherever the
    harness happened to be run from)."""
    if json_path:
        p = Path(json_path).resolve()
        p.parent.mkdir(parents=True, exist_ok=True)
        return p.parent, p.stem
    return Path(tempfile.mkdtemp(prefix="w7perf-")), "perf"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--boot", action="store_true", help="start scripts/hub_sandbox_boot.py first")
    ap.add_argument("--base", default=None, help="an already-running sandbox, e.g. http://127.0.0.1:8095")
    ap.add_argument("--data-dir", default=None)
    ap.add_argument("--port", type=int, default=8095)
    ap.add_argument("--sizes", default="1000,2000")
    ap.add_argument("--opens", type=int, default=20)
    ap.add_argument("--chars", type=int, default=60)
    ap.add_argument("--json", dest="json_path", default=None)
    ap.add_argument("--md", default=None, help="write the markdown rows here ('-' = stdout)")
    ap.add_argument("--integrity-log", default=None,
                    help="with --base: that sandbox's own integrity log (docs/plans/joystick/sandbox-runs/*.md)")
    ap.add_argument("--hold-past-prewarm", action="store_true",
                    help="with --boot: also wait for the launcher's +120 s checkpoint before stopping it")
    ap.add_argument("--shutdown-wait", type=float, default=None,
                    help="with --base: seconds to wait, after the run, for that sandbox's shutdown "
                         f"checkpoint (default {BASE_SHUTDOWN_WAIT_S:.0f}); stop the sandbox to supply it")
    ap.add_argument("--attribute", action="store_true",
                    help="after each size's timed typing pass, type the same characters again with "
                         "every plugin piece, the view's dispatch/updateState, TipTap's events and "
                         "React's scheduler tasks timed; report ms per keystroke by piece (wave 10)")
    ap.add_argument("--busy", action="store_true",
                    help="a TRACE-ONLY pass (no wrappers) typing the same characters again; reports "
                         "typing_busy_per_char, the renderer main thread's busy time per keystroke "
                         "(keydown-dispatch to next keydown-dispatch, from the trace itself) -- "
                         "ruling D24 makes this the typing budget's VERDICT (its p95 against the "
                         "16 ms line, up to 2,000 paragraphs); without --busy the typing budget is "
                         "INCONCLUSIVE. For a clean reading do not combine with --attribute -- "
                         "combined, the trace is not clean and the typing verdict is also "
                         "INCONCLUSIVE (TY4 brief; D24)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    if args.dry_run:
        return dry_run()
    attr: dict | None = {} if args.attribute else None
    busy: dict | None = {} if args.busy else None
    live_kw = {}
    if attr is not None:
        live_kw["attribution"] = attr
    if busy is not None:
        live_kw["busy"] = busy
    try:
        sizes = [int(x) for x in args.sizes.split(",") if x.strip()]
    except ValueError:
        print(f"bad --sizes {args.sizes!r}")
        return 3
    if bool(args.boot) == bool(args.base):
        print("pass exactly one of --boot (with --data-dir) or --base")
        return 3
    if args.base and not args.integrity_log:
        print("REFUSED: --base needs --integrity-log (the running sandbox's own snapshot log); "
              "a run with no integrity verdict reports no timings")
        return 3
    home, stem = _log_home(args.json_path)
    base = args.base
    live, failure, not_run = None, None, None
    if args.boot:
        why = refuse_shared_root(args.data_dir or "")
        if why:
            print(f"REFUSED: {why}")
            return 3
        if port_busy(args.port):
            print(f"REFUSED: port {args.port} already has a listener; find it with "
                  f"`Get-NetTCPConnection -LocalPort {args.port}` -- this harness never kills it")
            return 3
        box = Sandbox(args.data_dir, args.port, home / f"{stem}.sandbox.log")
        base = f"http://127.0.0.1:{args.port}"
        box.start()
        try:
            if not box.wait_healthy(base, 240):
                failure = "the sandbox never answered /api/health"
            else:
                try:
                    live = run_live(base, sizes, args.opens, args.chars, **live_kw)
                except SetupFailed as e:
                    not_run = str(e)[:300]
                except Exception as e:  # noqa: BLE001 -- recorded, and the sandbox is still stopped
                    failure = f"the live run raised {type(e).__name__}: {str(e)[:300]}"
                # Never stop the launcher before its +15 s checkpoint: a short run waits for it.
                box.wait_checkpoint(POST_BOOT, POST_BOOT_WAIT_S)
                if args.hold_past_prewarm:
                    box.wait_checkpoint(PREWARM, PREWARM_WAIT_S)
        finally:
            box.stop()
        required = [PRE_BOOT, POST_BOOT, SHUTDOWN] + ([PREWARM] if args.hold_past_prewarm else [])
        integ = read_integrity(box.integrity_path(), required)
        note = f"stop: {box.stop_how}; launcher output: {box.log_path}"
    else:
        # M-3: prove the server at --base IS the sandbox that writes --integrity-log BEFORE the
        # first request that writes (sign-up, comp, seed). Looked up at call time.
        identity = _sandbox_identity().verify(base, args.integrity_log)
        if not identity.ok:
            print(f"REFUSED: {identity.sentence}")
            return 3
        try:
            live = run_live(base, sizes, args.opens, args.chars, **live_kw)
        except SetupFailed as e:
            not_run = str(e)[:300]
        except Exception as e:  # noqa: BLE001
            failure = f"the live run raised {type(e).__name__}: {str(e)[:300]}"
        # The same three checkpoints as --boot (review N-4): a sandbox this harness did not
        # start has not written its shutdown line yet, so wait for its operator to stop it.
        # Only a run with numbers to release waits; a failed or unstarted one is withheld anyway.
        wait_s = BASE_SHUTDOWN_WAIT_S if args.shutdown_wait is None else args.shutdown_wait
        labels = lambda: [c["label"] for c in read_integrity(args.integrity_log, [])["checkpoints"]]  # noqa: E731
        if (live is not None and not failure and wait_s > 0 and Path(args.integrity_log).is_file()
                and SHUTDOWN not in labels()):
            print(f"(waiting up to {wait_s:.0f} s for the shutdown checkpoint in {args.integrity_log}: "
                  "stop that sandbox now; no timing is reported without it)", file=sys.stderr)
            end = time.time() + wait_s
            while time.time() < end and SHUTDOWN not in labels():
                time.sleep(1.0)
        required = [PRE_BOOT, POST_BOOT, SHUTDOWN] + ([PREWARM] if args.hold_past_prewarm else [])
        integ = read_integrity(args.integrity_log, required)
        note = ("--base: the sandbox was started and stopped by its operator, not by this harness; "
                f"identity: {identity.sentence}")
    _keep_integrity_log(integ, home / f"{stem}.integrity.md", own=bool(args.boot))
    first = integrity_line(integ, note, not_run=not_run)
    print(first)  # ⛔ FIRST, before any number (CLAUDE.md, sandbox boots)
    sha = subprocess.run(["git", "-C", str(REPO), "rev-parse", "HEAD"], capture_output=True,
                         text=True).stdout.strip() or None
    out = {"tool": "tools/notebook_perf_harness.py", "git_head": sha, "base": base,
           "sizes": sizes, "opens": args.opens, "chars": args.chars, "integrity": integ}
    if not_run:
        # Not a measurement at all, so not INCONCLUSIVE (2) and never "a budget breached" (1).
        out.update({"timings": "WITHHELD", "not_run": not_run})
        if args.json_path:
            Path(args.json_path).write_text(json.dumps(out, indent=1), encoding="utf-8")
        print(f"VERDICT: NOT RUN -- the measurement could not start: {not_run}")
        return 3
    if not integ["clean"] or failure or live is None:
        why = "; ".join([f"sandbox integrity is {integ['status']}"] * (not integ["clean"])
                        + [failure] * bool(failure)) or "nothing was measured"
        out["timings"] = "WITHHELD"
        out["why"] = why
        if args.json_path:
            Path(args.json_path).write_text(json.dumps(out, indent=1), encoding="utf-8")
        print(f"VERDICT: INCONCLUSIVE -- timings withheld: {why}")
        return 2
    open_ms, typing_ms, typed, errors = live
    # Ruling D24: the typing budget's reading is the busy pass's p95, never the wall-clock row.
    # `busy_requested` is whether `--busy` ran at all; `trace_clean` is false exactly when
    # `--attribute` shared the same browser context (the same condition `run_live` itself checks
    # before appending its caveat to `errors`), which makes the trace not a clean no-wrapper one.
    busy_requested = busy is not None
    trace_clean = not (busy is not None and attr is not None)
    summary = summarize(open_ms, typing_ms, typed, busy, busy_requested=busy_requested,
                        trace_clean=trace_clean)
    # `busy_rows` are the REPORTED typing_busy_per_char rows (display only) -- `summary` above
    # already read the same raw `busy` samples for the verdict, so the two can never disagree.
    busy_rows = summarize_busy(busy) if busy is not None else []
    raw = {"open_ms": open_ms, "typing_ms": typing_ms}
    if busy is not None:
        raw["busy_ms"] = busy
    out.update({"page_errors": errors, "raw": raw, **summary})
    if busy_rows:
        out["rows"] = summary["rows"] + busy_rows
        for row in busy_rows:
            print(f"typing busy at {row['paragraphs']:,} paragraphs: {row['samples']} windows, "
                  f"p50 {row['p50_ms']} ms/key, p95 {row['p95_ms']} ms/key "
                  "(renderer main-thread busy time, trace-only pass)")
    if attr is not None:
        out["attribution"] = attr
        for n, a in sorted(attr.items()):
            print(f"attribution at {n:,} paragraphs: {a['keys']} keys, instrumented p50 "
                  f"{a['instrumented_p50_ms']} ms/key, {a['wrapped']} pieces wrapped")
            for r in a["rows"][:18]:
                extra = f"  ({r['react_commits_per_key']} React commits/key)" if "react_commits_per_key" in r else ""
                print(f"  {r['ms_per_key']:8.3f} ms/key  {r['calls_per_key']:6.2f} calls/key  {r['piece']}{extra}")
            tr = a.get("trace") or {}
            print(f"  renderer main thread, traced: {tr.get('busy_ms_per_key')} ms/key busy "
                  f"({tr.get('threads')} thread(s)); self time by phase:")
            for r in (tr.get("rows") or [])[:18]:
                print(f"  {r['self_ms_per_key']:8.3f} ms/key  {r['count_per_key']:6.2f} /key  {r['phase']}")
    if args.json_path:
        Path(args.json_path).write_text(json.dumps(out, indent=1), encoding="utf-8")
    # The markdown table gets the REPORTED busy rows too (display only); the verdict checks
    # below still read `summary` untouched.
    md = markdown_rows({"rows": out.get("rows", summary["rows"]), "inconclusive": summary["inconclusive"]}, sha)
    if args.md == "-":
        print(md)
    elif args.md:
        Path(args.md).write_text(f"> {first}\n\n{md}\n", encoding="utf-8")
    if summary["inconclusive"] and not summary["rows"]:
        print("VERDICT: INCONCLUSIVE --", "; ".join(summary["inconclusive"]))
        return 2
    if summary["breaches"]:
        print("VERDICT: BUDGET BREACH --", "; ".join(summary["breaches"]))
        return 1
    if summary["inconclusive"]:
        print("VERDICT: INCONCLUSIVE (partial) --", "; ".join(summary["inconclusive"]))
        return 2
    print("VERDICT: PASS -- note open and typing within budget")
    return 0


if __name__ == "__main__":
    sys.exit(main())
