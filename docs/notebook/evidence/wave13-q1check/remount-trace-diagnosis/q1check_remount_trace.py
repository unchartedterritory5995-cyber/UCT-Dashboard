"""Wave 13, lane 13Q-Q1check -- controller follow-up.

Controller's alternative hypothesis: the editor (or the focused element) is
REPLACED/REMOUNTED or focus is independently stolen back (a sheet/list/picker
returning focus to its trigger) moments after the product's own focus() call
lands -- NOT a CDP-automation artifact. If true, document.activeElement would
show a focusin into .ProseMirror FOLLOWED by a focusout/removal, which this
lane's existing diagnosis (reading activeElement at fixed checkpoints, never
instrumenting the window in between) could not see.

This installs a recorder via page.add_init_script (so it runs as ordinary page
script, present from load, before any app code) that keeps a timeline of:
  - every focusin/focusout on document (capture phase), with a descriptor of
    target + relatedTarget and performance.now()
  - every .ProseMirror DOM node added/removed, via a MutationObserver on
    document.body (subtree), each tagged with a stable per-node id so a
    create-then-destroy of the SAME vs. a DIFFERENT node is distinguishable
  - document.hasFocus()/visibilityState at the end, for cross-reference

NO focus()/click of any kind from this script after the note is created --
identical discipline to the formal step-1 measurement. 5 reps x 2 widths,
headless (this box has no interactive display), a fresh context per rep with
bring_to_front(), matching the formal protocol exactly.

R-RAW: raw dump written and committed before any interpretation.
"""
import json
import os
import sys
import time
from pathlib import Path

REPO = Path(r"C:\Users\Patrick\uct-worktrees\notebook-w13q1check")
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402
import notebook_w13q_clicks as w13q  # noqa: E402

SCRATCH = Path(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad")
DATA_DIR = SCRATCH / "q1check-remount-data"
OUT = SCRATCH / "q1check-remount-out"
PORT = 8645  # 8625-8629 are this box's other worktrees' sandboxes (e.g. notebook-w13q4 on 8627) -- never share a port
MEMBER = ("w13q1remount@local.dev", "LocalTest2026!", "w13q1remount")
REPS = 5
SETTLE_S = 3.0

DATA_DIR.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

os.environ.update(w13q.SANDBOX_FLAGS)
os.environ.setdefault("FMP_API_KEY", "")
os.environ.setdefault("FINNHUB_API_KEY", "")
os.environ.setdefault("ALPHAVANTAGE_API_KEY", "")

WIDTHS = {
    "1200": {"width": 1200, "height": 900},
    "390": {"width": 390, "height": 844},
}

# Installed via add_init_script -- runs as ordinary page JS, present from the
# very first paint, well before React/TipTap load. No product internals
# touched; it only reads document.activeElement / DOM mutations, both public
# platform APIs.
INIT_SCRIPT = r"""
(() => {
  window.__q1trace = { events: [], t0: performance.now() };
  let nodeCounter = 0;
  const nodeIds = new WeakMap();
  function idFor(el) {
    if (!nodeIds.has(el)) { nodeCounter += 1; nodeIds.set(el, nodeCounter); }
    return nodeIds.get(el);
  }
  function descr(el) {
    if (!el) return null;
    try {
      let isPM = false, inPM = false;
      if (el.classList && el.classList.contains('ProseMirror')) isPM = true;
      if (el.closest) { try { inPM = !!el.closest('.ProseMirror'); } catch (e) {} }
      return {
        tag: el.tagName || null,
        isBody: el === document.body,
        isPM: isPM,
        inPM: inPM,
        pmId: (isPM || inPM) ? idFor(isPM ? el : (el.closest ? el.closest('.ProseMirror') : null)) : null,
        testid: (el.getAttribute && el.getAttribute('data-testid')) || null,
        noteTitle: !!(el.hasAttribute && el.hasAttribute('data-note-title')),
        noteLandmark: (el.getAttribute && el.getAttribute('data-note-landmark')) || null,
        cls: (typeof el.className === 'string') ? el.className.slice(0, 100) : null,
      };
    } catch (e) { return { error: String(e && e.message || e) }; }
  }
  function push(ev) {
    ev.t = Math.round((performance.now() - window.__q1trace.t0) * 10) / 10;
    window.__q1trace.events.push(ev);
  }
  document.addEventListener('focusin', (e) => {
    push({ k: 'focusin', target: descr(e.target), related: descr(e.relatedTarget) });
  }, true);
  document.addEventListener('focusout', (e) => {
    push({ k: 'focusout', target: descr(e.target), related: descr(e.relatedTarget) });
  }, true);
  function scanNode(node, kind) {
    if (!node || node.nodeType !== 1) return;
    if (node.classList && node.classList.contains('ProseMirror')) {
      push({ k: 'pm-' + kind, pmId: idFor(node), testid: node.getAttribute('data-testid') || null });
    }
    if (node.querySelectorAll) {
      const found = node.querySelectorAll('.ProseMirror');
      for (const pm of found) {
        push({ k: 'pm-' + kind, pmId: idFor(pm), testid: pm.getAttribute('data-testid') || null });
      }
    }
  }
  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) scanNode(node, 'added');
      for (const node of m.removedNodes) scanNode(node, 'removed');
    }
  });
  function arm() {
    if (document.body) {
      mo.observe(document.body, { childList: true, subtree: true });
      push({ k: 'observer-armed' });
    } else {
      requestAnimationFrame(arm);
    }
  }
  arm();
})();
"""

DUMP_JS = """() => {
  return {
    events: window.__q1trace ? window.__q1trace.events : null,
    hasFocusDoc: document.hasFocus(),
    visibilityState: document.visibilityState,
    activeElementTag: document.activeElement ? document.activeElement.tagName : null,
    activeElementInPM: !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('.ProseMirror')),
  };
}"""


def main():
    box = h.Sandbox(str(DATA_DIR), PORT, OUT / "sandbox.log")
    base = f"http://127.0.0.1:{PORT}"
    box.start()
    rows = []
    try:
        healthy = box.wait_healthy(base, 300)
        if not healthy:
            raise SystemExit("sandbox never became healthy")
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            br = pw.chromium.launch(headless=True)
            admin = br.new_context()
            seedctx = br.new_context()
            h._provision(admin.request, seedctx.request, base, member=MEMBER)
            state = seedctx.storage_state()

            for width_key, vp in WIDTHS.items():
                for rep in range(1, REPS + 1):
                    row = {"width": width_key, "rep": rep}
                    ctx = br.new_context(viewport=vp, has_touch=(width_key == "390"),
                                         is_mobile=(width_key == "390"), storage_state=state)
                    # Installed BEFORE any navigation -- present from the very first
                    # document, survives every client-side route change thereafter
                    # (this is an SPA; there is no second real page load).
                    ctx.add_init_script(INIT_SCRIPT)
                    pg = ctx.new_page()
                    errors = []
                    pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
                    try:
                        pg.bring_to_front()
                        pg.goto(base + "/journal/notebook?view=all", wait_until="domcontentloaded", timeout=60000)
                        h._dismiss_intro(pg)
                        pg.wait_for_timeout(500)
                        btn = pg.locator('[data-tour="new-note"]').filter(visible=True)
                        btn.first.wait_for(state="visible", timeout=20000)
                        btn.first.click()
                        pg.wait_for_url("**/journal/notebook?*note=*", timeout=20000)
                        url = pg.url
                        note_id = url.split("note=", 1)[1].split("&", 1)[0] if "note=" in url else None
                        row["note_id"] = note_id
                        # WAIT ONLY -- no focus()/click of any kind. 3s settle per the
                        # controller's ask.
                        pg.wait_for_timeout(int(SETTLE_S * 1000))
                        dump = pg.evaluate(DUMP_JS)
                        row["trace"] = dump
                        row["page_errors"] = errors
                    except Exception as e:  # noqa: BLE001
                        row["driver_error"] = f"{type(e).__name__}: {str(e)[:400]}"
                        try:
                            row["trace"] = pg.evaluate(DUMP_JS)
                        except Exception:  # noqa: BLE001
                            pass
                    finally:
                        try:
                            name = f"remount-{width_key}-r{rep}.png"
                            pg.screenshot(path=str(OUT / name))
                            row["screenshot"] = name
                        except Exception:  # noqa: BLE001
                            pass
                        ctx.close()
                    n_ev = len(row.get("trace", {}).get("events") or []) if isinstance(row.get("trace"), dict) else 0
                    print(f"{width_key} rep{rep}: note={row.get('note_id')} events={n_ev} "
                          f"activeInPM={row.get('trace', {}).get('activeElementInPM')}", flush=True)
                    rows.append(row)
    finally:
        stop_how = box.stop()
        out_path = OUT / "results.json"
        out_path.write_text(json.dumps({"meta": {"settle_s": SETTLE_S, "stop_how": stop_how},
                                         "rows": rows}, indent=2, default=str), encoding="utf-8")
        print("WROTE", out_path, flush=True)


if __name__ == "__main__":
    main()
