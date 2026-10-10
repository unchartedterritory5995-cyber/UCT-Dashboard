"""notebook_crawl.py -- press every control the Notebook shows, at desktop and phone width.

    python tools/notebook_crawl.py --base http://127.0.0.1:8143 --data-dir <sandbox data dir> \
        --out docs/notebook/evidence/crawl-<stamp> [--viewports 1280,390]

The authored walks press the controls someone thought of. This presses the ones that EXIST: in
each Notebook state it enumerates every visible interactive element (buttons, links, tabs, menu
items, toggles, inputs, selects), reloads the state, and operates that one element -- click, or
type into a field, or pick a select's second option. When the action opens a dialog, menu or
sheet, every control inside it is then operated too, one level deep, each from a fresh reload.

Per action it records an outcome class, the same vocabulary as tools/mobile_crawl.py:
  ok           something visible changed and nothing went wrong
  noop         nothing observable changed (a dead-control CANDIDATE, for review)
  error        a page error, a console error or a 5xx happened during the action
  error-screen an error boundary ("Something went wrong") is on screen afterwards
  left         the page left the Notebook (fine for a link; listed so a stray one is seen)
  overflow     the page scrolls sideways afterwards (at phone width this is a defect)
  skipped      account-level destructive controls (sign out, delete account, empty trash)
  driver       the crawler itself could not operate the element (it moved, it detached)

The crawl member is created inside the sandbox by notebook_swarm's provisioning child, and its
notebook is seeded through the API (a rich note, folders, tags, tasks, a trashed note) so every
view has something to show. Raw rows go to ledger.jsonl BEFORE the report is computed (R-RAW).
Exit: 0 no error/error-screen, 1 any, 2 not measured.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import notebook_swarm as sw  # noqa: E402  -- provisioning child, doc helpers

SKIP = re.compile(r"sign out|log ?out|delete (my )?account|empty trash|delete forever|permanently|"
                  r"delete all|cancel subscription|manage billing", re.I)
INTERACTIVE = ("button, a[href], [role=button], [role=tab], [role=menuitem], [role=menuitemcheckbox], "
               "[role=menuitemradio], [role=switch], [role=checkbox], [role=option], [role=treeitem], "
               "input:not([type=hidden]), select, textarea, summary")
ERROR_TEXT = ("Something went wrong", "This section failed", "Unexpected Application Error")

ENUM_JS = r"""
(sel) => {
  const scope = document.querySelector('[role=dialog][aria-modal=true], [role=menu], [role=listbox]') || document;
  const out = [];
  const seen = new Set();
  for (const el of scope.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
    if (r.bottom < 0 || r.top > innerHeight * 3) continue;
    const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.value ||
                  el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const type = el.getAttribute('type') || '';
    const sig = role + '|' + type + '|' + name;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({sig, name, role, type, tag: el.tagName.toLowerCase(), inDialog: scope !== document});
  }
  return out;
}
"""

FIND_JS = r"""
([sel, sig]) => {
  const scope = document.querySelector('[role=dialog][aria-modal=true], [role=menu], [role=listbox]') || document;
  for (const el of scope.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.value ||
                  el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const s = (el.getAttribute('role') || el.tagName.toLowerCase()) + '|' + (el.getAttribute('type') || '') + '|' + name;
    if (s === sig) { el.setAttribute('data-crawl-target', '1'); return true; }
  }
  return false;
}
"""

FINGERPRINT_JS = r"""
() => {
  const d = document.querySelectorAll('[role=dialog], [role=menu], [role=listbox], [role=alert], [role=status]').length;
  return location.pathname + location.search + '|' + d + '|' + document.body.innerText.length;
}
"""


class Crawl:
    def __init__(self, browser, base: str, token: str, width: int, out: Path, ledger):
        self.base, self.width, self.out, self.ledger = base, width, out, ledger
        height = 900 if width > 1024 else 844
        self.ctx = browser.new_context(viewport={"width": width, "height": height}, has_touch=width < 1025,
                                       is_mobile=width < 1025, reduced_motion="reduce")
        host = base.split("//", 1)[1].split(":")[0]
        self.ctx.add_cookies([{"name": "uct_session", "value": token, "domain": host, "path": "/"}])
        self.pg = self.ctx.new_page()
        self.events: list[str] = []
        self.pg.on("pageerror", lambda e: self.events.append(f"pageerror: {str(e)[:300]}"))
        self.pg.on("console", lambda m: m.type == "error" and self.events.append(f"console: {m.text[:300]}"))
        self.pg.on("response", lambda r: r.status >= 500 and self.events.append(f"http {r.status} {r.url}"))
        self.pg.on("dialog", lambda d: d.dismiss())
        self.counts = Counter()

    def load(self, state: dict):
        self.pg.goto(self.base + state["url"], wait_until="domcontentloaded", timeout=60000)
        self.pg.wait_for_timeout(1800)
        for _ in range(2):
            self.pg.keyboard.press("Escape")
        self.pg.wait_for_timeout(300)
        for step in state.get("then", []):
            b = self.pg.get_by_role("button", name=step, exact=True).first
            if b.count():
                b.click()
                self.pg.wait_for_timeout(900)

    def overflow(self) -> bool:
        return bool(self.pg.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"))

    def screen_error(self) -> str:
        try:
            txt = self.pg.locator("body").inner_text(timeout=5000)
        except Exception:  # noqa: BLE001
            return ""
        return next((t for t in ERROR_TEXT if t in txt), "")

    def operate(self, state: dict, el: dict, opener: dict | None = None) -> str:
        self.load(state)
        path = []
        if opener:
            if not self.pg.evaluate(FIND_JS, [INTERACTIVE, opener["sig"]]):
                return self.row(state, el, "driver", "the opener was not found after reload", opener)
            self.pg.locator("[data-crawl-target]").first.click(timeout=5000)
            self.pg.evaluate("() => document.querySelectorAll('[data-crawl-target]').forEach(e => e.removeAttribute('data-crawl-target'))")
            self.pg.wait_for_timeout(700)
            path.append(opener["name"])
        if SKIP.search(el["name"] or ""):
            return self.row(state, el, "skipped", "account-level destructive control", opener)
        if not self.pg.evaluate(FIND_JS, [INTERACTIVE, el["sig"]]):
            return self.row(state, el, "driver", "the element was not found after reload", opener)
        before = self.pg.evaluate(FINGERPRINT_JS)
        self.events.clear()
        loc = self.pg.locator("[data-crawl-target]").first
        try:
            if el["tag"] == "select":
                opts = loc.locator("option").all_inner_texts()
                if len(opts) > 1:
                    loc.select_option(index=1, timeout=5000)
            elif el["tag"] in ("input", "textarea") and el["type"] not in ("checkbox", "radio", "button", "submit", "file", "color", "range"):
                loc.fill("crawl test 42", timeout=5000)
                self.pg.keyboard.press("Enter")
            elif el["type"] == "file":
                return self.row(state, el, "skipped", "file picker (exercised by the authored walks)", opener)
            else:
                loc.click(timeout=5000)
        except Exception as e:  # noqa: BLE001
            return self.row(state, el, "driver", f"{type(e).__name__}: {str(e)[:160]}", opener)
        self.pg.wait_for_timeout(900)
        after_url = self.pg.url
        after = self.pg.evaluate(FINGERPRINT_JS)
        errs = [e for e in self.events if not e.startswith("console: Failed to load resource: the server responded with a status of 4")]
        se = self.screen_error()
        if se:
            return self.row(state, el, "error-screen", se + (" | " + " || ".join(errs[:3]) if errs else ""), opener)
        if errs:
            return self.row(state, el, "error", " || ".join(errs[:4]), opener)
        if "/journal" not in after_url:
            return self.row(state, el, "left", after_url, opener)
        if self.width <= 640 and self.overflow():
            return self.row(state, el, "overflow", f"scrollWidth > clientWidth after the action", opener)
        return self.row(state, el, "ok" if after != before else "noop", "", opener)

    def row(self, state, el, outcome, detail, opener=None) -> str:
        self.counts[outcome] += 1
        rec = {"w": self.width, "state": state["name"], "opener": (opener or {}).get("name"), "control": el["name"],
               "role": el["role"], "outcome": outcome, "detail": detail}
        self.ledger.write(json.dumps(rec) + "\n")
        self.ledger.flush()
        return outcome

    def crawl_state(self, state: dict, max_controls: int):
        self.load(state)
        if self.screen_error():
            self.row(state, {"name": "(state load)", "role": "-"}, "error-screen", self.screen_error())
            return
        if self.width <= 640 and self.overflow():
            self.row(state, {"name": "(state load)", "role": "-"}, "overflow", "the state itself scrolls sideways")
        controls = self.pg.evaluate(ENUM_JS, INTERACTIVE)[:max_controls]
        print(f"  [{self.width}] {state['name']}: {len(controls)} controls", flush=True)
        for el in controls:
            out = self.operate(state, el)
            # one level deeper: whatever the action opened
            if out == "ok" and not SKIP.search(el["name"] or ""):
                inner = [c for c in self.pg.evaluate(ENUM_JS, INTERACTIVE) if c["inDialog"]][:max_controls]
                for child in inner:
                    self.operate(state, child, opener=el)

    def close(self):
        self.ctx.close()


def seed(base: str, token: str) -> dict:
    import httpx
    c = httpx.Client(base_url=base, cookies={"uct_session": token}, timeout=60)
    rich = {"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "NVDA thesis"}]},
        {"type": "paragraph", "content": [{"type": "text", "text": "Base breakout above 120 with volume. "},
                                          {"type": "text", "marks": [{"type": "bold"}], "text": "Stop under 112."}]},
        {"type": "bulletList", "content": [{"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Earnings in two weeks"}]}]}]},
        {"type": "taskList", "content": [{"type": "taskItem", "attrs": {"checked": False}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Set the alert at 121"}]}]}]},
        {"type": "blockquote", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Trade the plan."}]}]},
    ]}
    f = c.post("/api/j2/note-folders", json={"name": "Theses"}).json().get("folder") or {}
    ids = []
    for title, body, extra in (("NVDA thesis", rich, {"ticker": "NVDA", "tags": ["thesis", "semis"], "folderId": f.get("id")}),
                               ("Weekly review", sw.doc("Two asks for next week. Label every trade."), {"tags": ["review"]}),
                               ("TSLA notes", sw.doc("Watching the 200-day."), {"ticker": "TSLA"}),
                               ("Old idea", sw.doc("Discarded."), {})):
        n = c.post("/api/j2/notes", json={"title": title, "bodyJson": body, **extra}).json().get("note") or {}
        ids.append(n.get("id"))
    c.delete(f"/api/j2/notes/{ids[-1]}")
    c.post(f"/api/j2/notes/{ids[0]}/favorite")
    return {"note": ids[0], "folder": f.get("id")}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--viewports", default="1280,390")
    ap.add_argument("--max-controls", type=int, default=120)
    args = ap.parse_args(argv)
    if args.base.split("//", 1)[-1].split(":")[0] not in ("127.0.0.1", "localhost"):
        print("REFUSED: local sandbox only")
        return 2
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    acct = sw.provision(args.data_dir, 1, "crawler", out / "provision.log")[0]
    s = seed(args.base, acct["token"])
    views = ["List view", "Table view", "Board view", "Calendar view", "Graph view", "Timeline view", "Tasks view"]
    states = ([{"name": "home", "url": "/journal/notebook"}]
              + [{"name": v, "url": "/journal/notebook", "then": [v]} for v in views[1:]]
              + [{"name": "editor (rich note)", "url": f"/journal/notebook?note={s['note']}"}])
    from playwright.sync_api import sync_playwright
    ledger = open(out / "ledger.jsonl", "w", encoding="utf-8", newline="\n")
    totals = Counter()
    t0 = time.time()
    with sync_playwright() as p:
        br = p.chromium.launch()
        for w in [int(x) for x in args.viewports.split(",")]:
            cr = Crawl(br, args.base, acct["token"], w, out, ledger)
            for st in states:
                try:
                    cr.crawl_state(st, args.max_controls)
                except Exception as e:  # noqa: BLE001
                    cr.row(st, {"name": "(state)", "role": "-"}, "driver", f"{type(e).__name__}: {str(e)[:200]}")
            totals.update({f"{w}:{k}": v for k, v in cr.counts.items()})
            cr.close()
        br.close()
    ledger.close()
    rows = [json.loads(x) for x in (out / "ledger.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
    if len(rows) < 30:
        print(f"NOT MEASURED: only {len(rows)} actions")
        return 2
    bad = [r for r in rows if r["outcome"] in ("error", "error-screen")]
    lines = [f"# Notebook crawl, {time.strftime('%Y-%m-%d %H:%M')} ({round((time.time() - t0) / 60, 1)} min)", "",
             f"- actions: **{len(rows)}**; " + ", ".join(f"{k} {v}" for k, v in sorted(Counter(r['outcome'] for r in rows).items())),
             f"- by viewport: " + ", ".join(f"{k} {v}" for k, v in sorted(totals.items())), "",
             "## Errors and error screens", ""]
    lines += [f"- [{r['w']}] {r['state']} > {r.get('opener') or ''} > **{r['control']}** ({r['role']}): {r['detail']}" for r in bad] or ["none"]
    for kind in ("overflow", "noop", "left", "driver"):
        rs = [r for r in rows if r["outcome"] == kind]
        lines += ["", f"## {kind} ({len(rs)})", ""]
        lines += [f"- [{r['w']}] {r['state']} > {r.get('opener') or ''} > {r['control']} ({r['role']}) {r['detail']}" for r in rs[:80]]
    (out / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print("\n".join(lines[:4]))
    print(f"VERDICT: {'FAIL' if bad else 'PASS'} ({len(bad)} error action(s))")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
