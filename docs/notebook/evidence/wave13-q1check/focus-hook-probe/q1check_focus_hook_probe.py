"""Wave 13, lane 13Q-Q1check -- controller's SECOND follow-up.

Hypothesis under test (controller, verbatim): NoteEditorPage's 'body' openFocus
useLayoutEffect (the PARENT) may fire BEFORE @tiptap/react's EditorContent (the
CHILD, a class component whose componentDidMount/componentDidUpdate attaches
editor.view.dom into the real container) has attached the editor's DOM to the
document -- so the product's own editor.commands.focus('end') call would target
a node with isConnected===false, which is a silent no-op, explaining BODY
staying focused with no CDP theory required.

Read @tiptap/react's source (node_modules/@tiptap/react/dist/index.js) first:
PureEditorContent attaches in componentDidMount/componentDidUpdate (class
lifecycle, same commit PHASE as useLayoutEffect), gated on
`editor.view.dom?.parentNode` already existing. React's commit order for one
phase is child-before-parent, so in the ordinary case EditorContent's attach
SHOULD fire before NoteEditorPage's own useLayoutEffect -- but "should" is a
prediction from reading source, not a measurement, and this file is the
measurement.

Technique (controller's second option, chosen because it touches ZERO product
code): hook HTMLElement.prototype.focus via page.add_init_script (ordinary page
script, installed before navigation) and log, for every call during the run:
isConnected, className, tagName, contenteditable attribute, document.hasFocus(),
and whether document.activeElement actually became `this` afterward. With no
harness help (no Playwright .focus(), no instrument compensation) every
.focus() call seen in this window can only come from the product's own code.
Combined with the existing MutationObserver .ProseMirror add/remove tracking so
the focus-call timing can be read against the DOM lifecycle in ONE trace.

5 reps x 2 widths, real "+ New note" click, no focus()/click help. Against the
CURRENT branch tip (the remount fix is already shipped and verified; this
probes the SEPARATE effect that survived it).
"""
import json
import os
import sys
from pathlib import Path

REPO = Path(r"C:\Users\Patrick\uct-worktrees\notebook-w13q1check")
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402
import notebook_w13q_clicks as w13q  # noqa: E402

SCRATCH = Path(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad")
DATA_DIR = SCRATCH / "q1check-focushook-data"
OUT = SCRATCH / "q1check-focushook-out"
PORT = 8648  # distinct from every port used earlier in this lane
MEMBER = ("w13q1focushook@local.dev", "LocalTest2026!", "w13q1focushook")
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

INIT_SCRIPT = r"""
(() => {
  window.__q1probe = { events: [], t0: performance.now() };
  let nodeCounter = 0;
  const nodeIds = new WeakMap();
  function idFor(el) {
    if (!nodeIds.has(el)) { nodeCounter += 1; nodeIds.set(el, nodeCounter); }
    return nodeIds.get(el);
  }
  function push(ev) {
    ev.t = Math.round((performance.now() - window.__q1probe.t0) * 10) / 10;
    window.__q1probe.events.push(ev);
  }
  function describe(el) {
    if (!el) return null;
    let isPM = false;
    try { isPM = !!(el.classList && el.classList.contains('ProseMirror')); } catch (e) {}
    return {
      tag: el.tagName || null,
      isPM: isPM,
      isConnected: !!el.isConnected,
      contenteditable: (el.getAttribute && el.getAttribute('contenteditable')) || null,
      cls: (typeof el.className === 'string') ? el.className.slice(0, 120) : null,
      testid: (el.getAttribute && el.getAttribute('data-testid')) || null,
      pmId: isPM ? idFor(el) : null,
    };
  }

  // 1. Hook every .focus() call on any element, from the page's OWN JS realm
  //    (never Playwright/CDP -- none is used in this run). This is the
  //    product's own focus() calls and nothing else.
  const origFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (...args) {
    const before = describe(this);
    const hadFocusBefore = document.hasFocus();
    const r = origFocus.apply(this, args);
    const becameActive = document.activeElement === this;
    push({
      k: 'focus-call',
      target: before,
      hadFocusBefore: hadFocusBefore,
      hasFocusAfter: document.hasFocus(),
      becameActiveElementSync: becameActive,
    });
    return r;
  };

  // 2. Same .ProseMirror add/remove tracking as the earlier remount trace, so
  //    the focus-call timing can be read against the DOM lifecycle directly.
  function scanNode(node, kind) {
    if (!node || node.nodeType !== 1) return;
    if (node.classList && node.classList.contains('ProseMirror')) {
      push({ k: 'pm-' + kind, pmId: idFor(node), isConnected: !!node.isConnected });
    }
    if (node.querySelectorAll) {
      for (const pm of node.querySelectorAll('.ProseMirror')) {
        push({ k: 'pm-' + kind, pmId: idFor(pm), isConnected: !!pm.isConnected });
      }
    }
  }
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const node of m.addedNodes) scanNode(node, 'added');
      for (const node of m.removedNodes) scanNode(node, 'removed');
    }
  });
  function arm() {
    if (document.body) { mo.observe(document.body, { childList: true, subtree: true }); push({ k: 'observer-armed' }); }
    else requestAnimationFrame(arm);
  }
  arm();

  // 3. document focusin, for cross-reference against the focus-call hook --
  //    a focus() call that does NOT produce a focusin is the detached-node
  //    no-op the hypothesis predicts.
  document.addEventListener('focusin', (e) => {
    push({ k: 'focusin', target: describe(e.target) });
  }, true);
})();
"""

DUMP_JS = """() => {
  const el = document.activeElement;
  return {
    events: window.__q1probe ? window.__q1probe.events : null,
    activeElementTag: el ? el.tagName : null,
    activeElementInPM: !!(el && el.closest && el.closest('.ProseMirror')),
    docHasFocus: document.hasFocus(),
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
                        note_id = pg.url.split("note=", 1)[1].split("&", 1)[0] if "note=" in pg.url else None
                        row["note_id"] = note_id
                        pg.wait_for_timeout(int(SETTLE_S * 1000))
                        row["dump"] = pg.evaluate(DUMP_JS)
                        row["page_errors"] = errors
                    except Exception as e:  # noqa: BLE001
                        row["driver_error"] = f"{type(e).__name__}: {str(e)[:400]}"
                        try:
                            row["dump"] = pg.evaluate(DUMP_JS)
                        except Exception:  # noqa: BLE001
                            pass
                    finally:
                        try:
                            name = f"focushook-{width_key}-r{rep}.png"
                            pg.screenshot(path=str(OUT / name))
                            row["screenshot"] = name
                        except Exception:  # noqa: BLE001
                            pass
                        ctx.close()
                    n_focus = len([e for e in (row.get("dump", {}).get("events") or []) if e.get("k") == "focus-call"])
                    print(f"{width_key} rep{rep}: note={row.get('note_id')} "
                          f"focus_calls={n_focus} activeInPM={row.get('dump', {}).get('activeElementInPM')}",
                          flush=True)
                    rows.append(row)
    finally:
        stop_how = box.stop()
        out_path = OUT / "results.json"
        out_path.write_text(json.dumps({"meta": {"settle_s": SETTLE_S, "stop_how": stop_how},
                                         "rows": rows}, indent=2, default=str), encoding="utf-8")
        print("WROTE", out_path, flush=True)


if __name__ == "__main__":
    main()
