"""Follow-up probe (13Q-3): v1 showed Tab from "Insert widget" (dialog open, 390px) landing
on "Format toggle" -- BEFORE Insert widget in DOM -- instead of into the dialog. This probe
reads document.activeElement's actual DOM identity/position and the toolbarRow's own
data-format-open attribute at each step, plus checks whether the dialog's node is really a
sibling of toolbarRow as the source implies.
"""
import os
import sys
from pathlib import Path

REPO = Path(r"C:\Users\Patrick\uct-worktrees\notebook-w13q3")
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402
import notebook_w13q_clicks as w13q  # noqa: E402

DATA_DIR = Path(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\q20-dialog-diagnosis\data3")
PORT = 8628
OUT = Path(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\q20-dialog-diagnosis\out3")
DATA_DIR.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

os.environ.update(w13q.SANDBOX_FLAGS)
os.environ.update({"FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": ""})

box = h.Sandbox(str(DATA_DIR), PORT, OUT / "sandbox.log")
base = f"http://127.0.0.1:{PORT}"
box.start()
log = []


def say(line):
    print(line)
    log.append(str(line))


DESC_JS = """() => {
  const el = document.activeElement;
  if (!el) return null;
  const run = el.closest('[data-format-run]');
  const row = el.closest('.toolbarRow, [role=toolbar]');
  const dlg = el.closest('[role=dialog]');
  return {
    tag: el.tagName, name: (el.getAttribute('aria-label')||el.innerText||'').slice(0,40),
    inFormatRun: run ? run.id : null,
    inToolbar: !!row,
    inDialog: !!dlg,
    dataFormatOpenOnRow: row ? row.getAttribute('data-format-open') : null,
    disabled: !!el.disabled,
    tabIndex: el.tabIndex,
  }
}"""

try:
    if not box.wait_healthy(base, 300):
        say("SANDBOX NEVER HEALTHY")
        sys.exit(1)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin = br.new_context()
        seedctx = br.new_context(viewport={"width": 1200, "height": 900})
        req = seedctx.request
        h._provision(admin.request, req, base, member=w13q.MEMBER)
        r = req.post(base + "/api/j2/notes", data={"title": "Q20 dialog diag v2", "ticker": "NVDA",
                     "bodyJson": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "x"}]}]}})
        nid = r.json()["note"]["id"]
        state = seedctx.storage_state()

        vp = {"width": 390, "height": 844}
        ctx = br.new_context(viewport=vp, has_touch=True, is_mobile=True,
                             reduced_motion="reduce", storage_state=state)
        pg = ctx.new_page()
        pg.bring_to_front()
        pg.goto(base + f"/journal/notebook?note={nid}", wait_until="domcontentloaded", timeout=60000)
        h._dismiss_intro(pg)
        try:
            pg.get_by_role("button", name="Got it", exact=True).first.click(timeout=2500)
        except Exception:
            pass
        pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=60000)
        pg.wait_for_timeout(600)
        pg.evaluate("() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur();"
                    " window.scrollTo(0, 0) }")

        fmt = pg.get_by_role("button", name="Format").filter(visible=True)
        fmt.first.click()
        pg.wait_for_timeout(300)
        # dump the full list of focusable nodes IN DOM ORDER, right now (format open, dialog closed)
        nodes_before = pg.evaluate("""() => {
          const all = [...document.querySelectorAll(
            'button:not([disabled]), input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])')];
          return all.map((el,i) => ({i, tag: el.tagName, name: (el.getAttribute('aria-label')||el.innerText||'').slice(0,30)}));
        }""")
        say(f"focusable nodes in DOM order, format open, dialog CLOSED ({len(nodes_before)} total):")
        for n in nodes_before:
            say(f"    {n}")

        ins = pg.get_by_role("button", name="Insert widget").filter(visible=True)
        ins.first.click()
        dlg = pg.get_by_role("dialog", name="Insert widget")
        dlg.wait_for(state="visible", timeout=10000)
        pg.wait_for_timeout(300)

        nodes_after = pg.evaluate("""() => {
          const all = [...document.querySelectorAll(
            'button:not([disabled]), input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])')];
          return all.map((el,i) => ({i, tag: el.tagName, name: (el.getAttribute('aria-label')||el.innerText||'').slice(0,30),
            inDialog: !!el.closest('[role=dialog]')}));
        }""")
        say(f"\nfocusable nodes in DOM order, dialog OPEN ({len(nodes_after)} total):")
        for n in nodes_after:
            say(f"    {n}")

        say(f"\nactiveElement now: {pg.evaluate(DESC_JS)}")
        pg.keyboard.press("Tab")
        say(f"after 1 real Tab: {pg.evaluate(DESC_JS)}")
        ctx.close()
        br.close()
finally:
    box.stop(grace_s=60)

(OUT / "RESULT.txt").write_text("\n".join(log), encoding="utf-8")
say(f"\nwritten to {OUT / 'RESULT.txt'}")
