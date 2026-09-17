"""RIG-SIDE write trace for the Notebook's durable store. ZERO product code.

⛔⛔ WHY IT IS INJECTED AND NOT BUILT IN. The question is "which writer clears the
durable record while an outbox entry is still queued" (Q1,
`docs/notebook/q1-red-cells-investigation.md`). A store-level trace answers it —
but shipping trace code to members to answer a debugging question is a cost they
did not ask for, and a flag that must never be on in production is a flag someone
eventually turns on. The rig already controls Chrome, so the trace is installed as
a page init script and exists only for the life of that browser.

⭐ THE INTENT MAY BE ENOUGH ON ITS OWN. `putNoteWithIntent(db, noteRecord,
outboxEntry)` writes the record and, separately, either writes or clears the outbox
entry. The SHAPE of each write — which store, whether an intent accompanied it,
whether `dirty` moved, whether the body still holds the sentence — plus the stack
is what resolves a write to one of the 31 candidate sites enumerated in the
checkpoint. Stack is the fallback key, not the primary one.

⛔ NON-VACUITY IS NOT OPTIONAL HERE. A tracer that records nothing looks exactly
like a write that never happened, and this programme has already published two
findings from instruments that were quietly recording nothing. `--self-check`
plants a write and requires it to appear in the ring, with a stack, before any
window is spent on this.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]

#: Installed with `page.add_init_script` BEFORE any navigation, so it is in place
#: ahead of the app bundle. IDBObjectStore is wrapped on the prototype, so every
#: store handle the offline layer obtains is already instrumented.
INIT_JS = r"""
(() => {
  if (window.__uctWriteRing) return;            // idempotent: one install per page
  window.__uctWriteRing = [];
  const RING_MAX = 500;

  // ⛔ The sentence the rig plants. Kept as a prefix match so a stamped variant
  // still counts — an exact-match check would answer "absent" for the right words
  // with the wrong timestamp.
  const SENTINEL = 'F5-MATRIX';

  const bodyHasSentence = (v) => {
    try {
      const j = v && v.bodyJson;
      if (!j) return false;
      return JSON.stringify(j).indexOf(SENTINEL) >= 0;
    } catch (e) { return null; }     // null = COULD NOT READ, never false
  };

  const describe = (storeName, method, key, value) => {
    let rec = null;
    try {
      rec = {
        // ⭐ The fields that decide Q1. `dirty` is the flag whose flip we are
        // hunting; `intent` is present only on an outbox row.
        dirty: (value && typeof value === 'object') ? (value.dirty ?? null) : null,
        noteId: (value && typeof value === 'object') ? (value.noteId ?? null) : null,
        mutationId: (value && typeof value === 'object') ? (value.mutationId ?? null) : null,
        kind: (value && typeof value === 'object') ? (value.kind ?? null) : null,
        baseUpdatedAt: (value && typeof value === 'object') ? (value.baseUpdatedAt ?? null) : null,
        sessionId: (value && typeof value === 'object') ? (value.sessionId ?? null) : null,
        sentence_in_body: bodyHasSentence(value),
      };
    } catch (e) { rec = { readError: String(e) }; }
    return {
      ts: Date.now(),
      store: storeName,
      method,
      key: (typeof key === 'string' || typeof key === 'number') ? key : null,
      rec,
      // ⛔ The stack is the FALLBACK key. Production is minified, so this is
      // symbolicated offline against a local build of the same commit; the shape
      // of the write usually resolves it first.
      stack: (new Error()).stack || null,
    };
  };

  const wrap = (method) => {
    const orig = IDBObjectStore.prototype[method];
    if (!orig || orig.__uctWrapped) return;
    const patched = function (...args) {
      try {
        if (window.__uctWriteRing.length < RING_MAX) {
          const val = (method === 'delete') ? null : args[0];
          const key = (method === 'delete') ? args[0] : args[1];
          window.__uctWriteRing.push(describe(this.name, method, key, val));
        }
      } catch (e) { /* ⛔ never break the app to observe it */ }
      return orig.apply(this, args);
    };
    patched.__uctWrapped = true;
    IDBObjectStore.prototype[method] = patched;
  };

  ['put', 'add', 'delete'].forEach(wrap);
  window.__uctWriteRingInstalled = true;
})();
"""

READ_JS = "() => ({ installed: !!window.__uctWriteRingInstalled, ring: window.__uctWriteRing || [] })"


def install(page) -> None:
    """⛔ BEFORE navigation. After it, the bundle has already taken its handles."""
    page.add_init_script(INIT_JS)


def read_ring(page) -> dict:
    try:
        return page.evaluate(READ_JS)
    except Exception as e:  # noqa: BLE001
        return {"installed": None, "ring": [], "err": str(e)}


def summarise(ring: list) -> dict:
    """The one question this exists for: which write flipped `dirty` to false
    while an outbox row for that note still existed?"""
    notes = [w for w in ring if w.get("store") == "notes"]
    outbox = [w for w in ring if w.get("store") == "outbox"]
    flips = []
    last_dirty = {}
    for w in notes:
        nid = (w.get("rec") or {}).get("noteId")
        d = (w.get("rec") or {}).get("dirty")
        prev = last_dirty.get(nid)
        if prev in (1, True) and d in (0, False):
            flips.append(w)
        if nid is not None:
            last_dirty[nid] = d
    # ⛔⛔ THE SENTENCE CAN LEAVE THE RECORD WHILE IT IS STILL DIRTY, AND THAT IS A
    # DIFFERENT EVENT FROM THE DIRTY FLIP. Measured 2026-09-15: the store trail read
    #   [(1, True, '47', True), (1, True, '39', False), (0, False, None, False)]
    # so the words left at t1->t2 while the record was STILL dirty and an entry was
    # STILL queued — and the dirty flip at t2->t3 carried sentence_in_body TRUE.
    # The first version of this summary surfaced ONLY the flips, so it recorded the
    # decisive write and then hid it. A summary that drops the evidence it was built
    # to find is the same defect as an instrument that never recorded it.
    losses = []
    last_sentence = {}
    for w in notes:
        nid = (w.get("rec") or {}).get("noteId")
        s = (w.get("rec") or {}).get("sentence_in_body")
        prev = last_sentence.get(nid)
        if prev is True and s is False:
            losses.append(w)
        if nid is not None and s is not None:
            last_sentence[nid] = s
    return {
        "writes_total": len(ring),
        "notes_writes": len(notes),
        "outbox_writes": len(outbox),
        "dirty_flips_true_to_false": flips,
        "sentence_lost_writes": losses,
        # ⛔ THE WHOLE RING IS KEPT. Summarising at capture time is what cost a
        # window: the answer was in the ring and the summary threw it away.
        "ring": ring,
    }


def self_check(profile=None) -> int:
    """⛔ Prove the ring RECORDS, against a real browser, before a window is spent.

    A tracer that records nothing is indistinguishable from a product that never
    wrote. Plant a write; require it back with a stack.
    """
    sys.path.insert(0, str(REPO / "tools"))
    import window_check as wc  # noqa: PLC0415
    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    # ⛔ ALWAYS EXPLICIT. resolve_profile(None) defaults to THIS worktree's
    # .worktrees/, which is not the rig — the guard refuses rather than creating a
    # signed-out profile, and that refusal has now fired three times in this
    # programme. Pass the canonical path.
    wc.use_profile(wc.resolve_profile(profile))
    if not pathlib.Path(wc.PROFILE).exists():
        print(f"⛔ no rig profile at {wc.PROFILE} — nothing was checked")
        return 3
    proc, endpoint, ver = wc.spawn_rig()
    if ver is None:
        print("⛔ the rig browser never answered on CDP — nothing was checked")
        return 4
    try:
        with sync_playwright() as pw:
            b = pw.chromium.connect_over_cdp(endpoint)
            ctx = b.contexts[0]
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            install(page)
            page.goto("https://uctintelligence.com/api/health", wait_until="domcontentloaded")

            planted = page.evaluate("""async () => {
              const db = await new Promise((res, rej) => {
                const r = indexedDB.open('__uct_trace_selfcheck', 1);
                r.onupgradeneeded = () => r.result.createObjectStore('notes', {keyPath: 'noteId'});
                r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
              });
              const tx = db.transaction('notes', 'readwrite');
              tx.objectStore('notes').put({noteId: 'probe-1', dirty: 1,
                bodyJson: {t: 'F5-MATRIX planted'}});
              await new Promise((res) => { tx.oncomplete = res; });
              const tx2 = db.transaction('notes', 'readwrite');
              tx2.objectStore('notes').put({noteId: 'probe-1', dirty: 0, bodyJson: {t: 'server'}});
              await new Promise((res) => { tx2.oncomplete = res; });
              db.close();
              indexedDB.deleteDatabase('__uct_trace_selfcheck');
              return true;
            }""")
            got = read_ring(page)
            b.close()
    finally:
        try:
            wc.teardown(proc)
        except Exception:  # noqa: BLE001
            import subprocess
            subprocess.run(["powershell", "-NoProfile", "-Command",
                            "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | "
                            "Where-Object { $_.CommandLine -like '*canary-chrome-profile-persistent*' } "
                            "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force "
                            "-ErrorAction SilentlyContinue }"], capture_output=True)

    ring = got.get("ring") or []
    s = summarise(ring)
    print(f"  planted: {planted}  installed: {got.get('installed')}")
    print(f"  ring: {s['writes_total']} write(s), {s['notes_writes']} to `notes`")
    print(f"  dirty flips true->false: {len(s['dirty_flips_true_to_false'])}")
    fails = []
    if not got.get("installed"):
        fails.append("the init script did not install")
    if s["notes_writes"] < 2:
        fails.append(f"expected >= 2 planted writes to `notes`, saw {s['notes_writes']}")
    if len(s["dirty_flips_true_to_false"]) != 1:
        fails.append("the planted dirty 1->0 flip was not detected exactly once")
    if s["dirty_flips_true_to_false"]:
        w = s["dirty_flips_true_to_false"][0]
        if not w.get("stack"):
            fails.append("the flip carries no stack — the fallback key is missing")
        if (w.get("rec") or {}).get("sentence_in_body") is not False:
            fails.append("sentence_in_body should be False on the server-shaped write")
    # ⛔ THE CONTROL: the detector must not answer yes to everything.
    if summarise([w for w in ring if (w.get("rec") or {}).get("dirty") in (1, True)]
                 )["dirty_flips_true_to_false"]:
        fails.append("a dirty-only ring reported a flip — the detector cannot distinguish")

    for f in fails:
        print("  ⛔", f)
    print("  SELF-CHECK", "PASS — the ring records, and the flip detector discriminates"
          if not fails else "FAIL")
    return 1 if fails else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--profile", default=None)
    args = ap.parse_args()
    if args.self_check:
        return self_check(args.profile)
    print(json.dumps({"init_js_bytes": len(INIT_JS)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
