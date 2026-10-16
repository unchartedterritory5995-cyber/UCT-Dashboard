"""Diagnostic instrument: name the writer behind the single-tab "(conflicted copy)" fork seen by the
Tier 2 part B walk #2 (docs/notebook/evidence/t2b-walk2-20261015T234317/c2/walk.json, followup.reminder).

It changes NO product code. It drives the walk's own `/remind` flow (or the by-hand task flow) in ONE
tab against an already-held sandbox, and records, before any interpretation (R-RAW):

  * every non-GET request to /api/j2/notes* AT THE MOMENT THE PAGE CALLS fetch / XHR / sendBeacon, with
    `new Error().stack` (V8 async frames included) -- an `add_init_script` wrapper, logged through a
    context-level exposed function so a record survives the page being torn down by a navigation;
  * every IndexedDB write/delete to the notebook db's `outbox`, `notes` and `meta` stores, with the stack and
    a digest of the value (mutationId, base, dirty flag, text) -- who queued the entry that is later sent;
  * page lifecycle (pagehide / beforeunload / visibilitychange / freeze), framenavigated, and the
    Playwright-side view of the same requests (send time, status, response time, failure);
  * the server's own account AFTER the run (the list of notes, the fork signals by title AND by tag),
    never only the wire.

Cells (docs: the brief):
  A  --flow remind   the walk's /remind flow exactly, then navigate to ?view=tasks
  B  --flow task     type `[ ] Follow up `, then `@`, pick the first date with TAB, same wait/poll/navigate
  D  --flow remind --no-nav   flow A, no navigation: wait 10 s on the editor, then read
(Cell C is flow B against a sandbox booted from the merge-base tree; the driver is this same file.)

Precondition: a sandbox is serving, e.g. (PowerShell, data dir single-quoted)
    python tools/notebook_fin_walk.py --config c2 --data-root 'C:/data-forkdiag-A' --port 8141 --out '<dir>' --tip <sha> --serve-only
Usage:
    python tools/notebook_forkdiag.py --base http://127.0.0.1:8141 --out <evidence dir> --cell A --flow remind --runs 5
Exit: 0 no fork in any run, 1 a fork in at least one run, 2 INCONCLUSIVE (no result file / setup failed).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import notebook_fin_walk as C  # noqa: E402
import notebook_perf_harness as h  # noqa: E402
import notebook_fork_repro as FR  # noqa: E402  -- Capture, idb_dump, read_notes (the detector the control proves)
from playwright.sync_api import sync_playwright  # noqa: E402

INIT_JS = r"""
(() => {
  if (window.__fkInstalled) return
  window.__fkInstalled = true
  try { Error.stackTraceLimit = 60 } catch (e) {}
  const T = () => performance.timeOrigin + performance.now()
  const log = (o) => { try { window.__fkLog(Object.assign({ pt: T(), href: location.pathname + location.search }, o)) } catch (e) {} }
  const stk = () => {
    try { return (new Error().stack || '').split('\n').slice(2).map((s) => s.trim()).filter((s) => !/__fk|init-script/.test(s)).slice(0, 40) } catch (e) { return [] }
  }
  const texts = (n, out) => {
    if (!n || typeof n !== 'object') return out
    if (Array.isArray(n)) { n.forEach((c) => texts(c, out)); return out }
    if (n.type === 'dateMention') out.push('<D:' + (n.attrs && n.attrs.date) + '>')
    else if (typeof n.text === 'string') out.push(n.text)
    if (n.content) texts(n.content, out)
    if (n.type === 'paragraph' || n.type === 'taskItem') out.push('|')
    return out
  }
  const dig = (v) => {
    try {
      if (v == null || typeof v !== 'object') return v
      const body = v.bodyJson || (v.patch && v.patch.bodyJson) || null
      const d = { keys: Object.keys(v).slice(0, 30) }
      for (const k of ['mutationId', 'noteId', 'kind', 'baseUpdatedAt', 'dirty', 'generation', 'sessionId', 'queuedAt', 'localSavedAt', 'name']) if (k in v) d[k] = v[k]
      if (v.patch) { d.patchKeys = Object.keys(v.patch); d.patchTitle = v.patch.title }
      if (body) d.text = texts(body, []).join('').slice(0, 240)
      if (v.value && typeof v.value === 'object') d.valueKeys = Object.keys(v.value).slice(0, 12)
      return d
    } catch (e) { return { digestError: String(e) } }
  }
  const bodyDig = (b) => {
    try {
      if (typeof b !== 'string') return { nonString: Object.prototype.toString.call(b) }
      const j = JSON.parse(b)
      const d = { keys: Object.keys(j).sort(), baseUpdatedAt: j.baseUpdatedAt }
      if ('title' in j) d.title = j.title
      if (j.bodyJson) d.text = texts(j.bodyJson, []).join('').slice(0, 240)
      return d
    } catch (e) { return { raw: String(b).slice(0, 200) } }
  }
  const NOTES = /\/api\/j2\/notes/
  const of = window.fetch
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input)
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase()
      if (NOTES.test(url) && method !== 'GET') {
        log({ k: 'fetch', method, url: url.replace(/^https?:\/\/[^/]+/, ''), keepalive: !!(init && init.keepalive),
              body: bodyDig(init && init.body), stack: stk() })
      }
    } catch (e) {}
    return of.apply(this, arguments)
  }
  const ox = XMLHttpRequest.prototype.send, oo = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (m, u) { this.__fk = { m: String(m).toUpperCase(), u: String(u) }; return oo.apply(this, arguments) }
  XMLHttpRequest.prototype.send = function (b) {
    try { if (this.__fk && NOTES.test(this.__fk.u) && this.__fk.m !== 'GET') log({ k: 'xhr', method: this.__fk.m, url: this.__fk.u, body: bodyDig(b), stack: stk() }) } catch (e) {}
    return ox.apply(this, arguments)
  }
  if (navigator.sendBeacon) {
    const ob = navigator.sendBeacon.bind(navigator)
    navigator.sendBeacon = function (u, d) { try { if (NOTES.test(String(u))) log({ k: 'beacon', url: String(u), stack: stk() }) } catch (e) {} return ob(u, d) }
  }
  window.__fkTexts = (j) => texts(j, []).join('').slice(0, 240)
  window.__fkLogRaw = log
  try {
    const osi = Storage.prototype.setItem
    Storage.prototype.setItem = function (k, v) {
      try {
        if (this === window.localStorage && typeof v === 'string' && v.indexOf('bodyJson') !== -1) {
          let d = null
          try { const j = JSON.parse(v); d = { keys: Object.keys(j).slice(0, 12), text: texts(j.bodyJson || (j.state && j.state.bodyJson) || j, []).join('').slice(0, 240), baseUpdatedAt: j.baseUpdatedAt } } catch (e) { d = { unparsed: v.length } }
          log({ k: 'draft', key: k, d, stack: stk().slice(0, 8) })
        }
      } catch (e) {}
      return osi.apply(this, arguments)
    }
  } catch (e) {}
  const watch = ['outbox', 'notes', 'meta', 'conflicts']
  const wrap = (proto, name, kind) => {
    const o = proto[name]
    proto[name] = function () {
      try {
        const sn = this.name || (this.source && this.source.name)
        if (watch.includes(sn)) {
          const a0 = arguments[0]
          log({ k: 'idb', op: kind, store: sn, db: (this.transaction && this.transaction.db && this.transaction.db.name) || null,
                arg: (a0 && typeof a0 === 'object' && !(a0 instanceof IDBKeyRange)) ? dig(a0) : (a0 instanceof IDBKeyRange ? 'range' : a0), stack: stk() })
        }
      } catch (e) {}
      return o.apply(this, arguments)
    }
  }
  try {
    wrap(IDBObjectStore.prototype, 'put', 'put'); wrap(IDBObjectStore.prototype, 'add', 'add')
    wrap(IDBObjectStore.prototype, 'delete', 'delete'); wrap(IDBObjectStore.prototype, 'clear', 'clear')
    const oc = IDBCursor.prototype.delete
    IDBCursor.prototype.delete = function () {
      try { const sn = this.source && (this.source.objectStore ? this.source.objectStore.name : this.source.name); if (watch.includes(sn)) log({ k: 'idb', op: 'cursor.delete', store: sn, arg: dig(this.value), stack: stk() }) } catch (e) {}
      return oc.apply(this, arguments)
    }
  } catch (e) {}
  for (const ev of ['pagehide', 'beforeunload', 'unload', 'visibilitychange', 'freeze']) {
    window.addEventListener(ev, () => log({ k: 'life', ev, vis: document.visibilityState }), true)
  }
  log({ k: 'init' })
})()
"""

FORK_TITLE = "(conflicted copy)"


def now() -> float:
    return round(time.time(), 3)


def walk_nodes(n):
    if isinstance(n, dict):
        yield n
        for c in n.get("content") or []:
            yield from walk_nodes(c)
    elif isinstance(n, list):
        for c in n:
            yield from walk_nodes(c)


def new_line(p):
    p.locator(".ProseMirror > p").first.click()
    p.keyboard.press("End")
    p.keyboard.press("Enter")


def one_run(browser, admin, base: str, idx: int, flow: str, nav: bool, vp: str, hold_s: int, nav_path: str,
            followup_nav: bool = False, dwell_ms: int = 0) -> dict:
    t0 = now()
    ctx, email, _me = C.member(browser, admin.request, base, f"fd{idx}", vp)
    title = f"Reminder walk {vp}"
    nbody = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": title}]}]}
    r = ctx.request.post(base + "/api/j2/notes", data={"title": title, "bodyJson": nbody})
    if r.status not in (200, 201):
        raise h.SetupFailed(f"create failed HTTP {r.status} {r.text()[:300]}")
    n = r.json().get("note") or r.json()
    nid = n["id"]
    created_rev = n.get("updatedAt")
    events: list[dict] = []
    ctx.expose_function("__fkLog", lambda o: events.append({"t_recv": now(), **(o if isinstance(o, dict) else {"raw": str(o)})}))
    ctx.add_init_script(INIT_JS)
    cap = FR.Capture(ctx)
    marks: dict = {"t_run_start": t0, "note_created_rev": created_rev}
    pg = ctx.new_page()
    pg.on("framenavigated", lambda f: events.append({"t_recv": now(), "k": "framenavigated", "url": f.url[-120:], "main": f == pg.main_frame}))
    C.goto(pg, base, f"/journal/notebook?note={nid}", wait=".ProseMirror")
    marks["t_editor_ready"] = now()
    new_line(pg)
    step: dict = {}
    pg.wait_for_timeout(300)
    step["tr_hook"] = pg.evaluate("""() => {
        const el = document.querySelector('.ProseMirror'); const ed = el && el.editor
        if (!ed) return 'no editor on element'
        const L = (k, o) => window.__fkLogRaw(Object.assign({ k }, o))
        ed.on('transaction', ({ transaction: tr }) => L('tr', { docChanged: tr.docChanged, steps: tr.steps.length,
          meta: Object.keys(tr.meta || {}), text: window.__fkTexts(ed.getJSON()) }))
        ed.on('update', () => L('ed.update', { text: window.__fkTexts(ed.getJSON()) }))
        return 'hooked'
    }""")
    if flow == "remind":
        pg.keyboard.type("/remind", delay=40)
        opt = pg.get_by_role("option", name=re.compile(r"^Reminder"))
        offered = C.vis_loc(opt, 10000)
        if offered:
            pg.keyboard.press("Enter")
        lst = pg.locator('#uct-date-suggest [role="option"]')
        listed = offered and C.vis_loc(lst, 10000)
        if listed:
            pg.keyboard.press("ArrowDown")
            pg.wait_for_timeout(200)
            step["chosen"] = [re.sub(r"\s+", " ", t).strip() for t in pg.locator('#uct-date-suggest [role="option"][aria-selected="true"]').all_inner_texts()]
            marks["t_pick_key"] = now()
            pg.keyboard.press("Enter")
            pg.wait_for_timeout(600)
        step.update({"option_offered": offered, "date_list": listed})
    else:   # task: by hand, then @, Tab
        pg.keyboard.type("[ ] Follow up ", delay=40)
        step["task_items_before_at"] = pg.locator('.ProseMirror [data-type="taskItem"]').count()
        pg.keyboard.type("@", delay=40)
        lst = pg.locator('#uct-date-suggest [role="option"]')
        listed = C.vis_loc(lst, 10000)
        step["date_list"] = listed
        if listed:
            step["chosen"] = [re.sub(r"\s+", " ", t).strip() for t in pg.locator('#uct-date-suggest [role="option"][aria-selected="true"]').all_inner_texts()]
            if dwell_ms:
                pg.wait_for_timeout(dwell_ms)   # a member reading the list before choosing (flow task only)
            marks["t_pick_key"] = now()
            pg.keyboard.press("Tab")
            pg.wait_for_timeout(600)
    step["mentions"] = pg.evaluate("""() => { const ms = [...document.querySelectorAll('.ProseMirror [data-type="date-mention"]')];
        return { n: ms.length, inTask: ms.filter(e => e.closest('[data-type="taskItem"]')).length } }""") if step.get("date_list") else {"n": 0, "inTask": 0}
    marks["t_after_pick"] = now()

    def note_json():
        rr = ctx.request.get(f"{base}/api/j2/notes/{nid}")
        return (rr.json().get("note") or {}) if rr.status == 200 else {}

    saved = False
    for _ in range(60):
        if any(x.get("type") == "dateMention" for x in walk_nodes(note_json().get("bodyJson") or {})):
            saved = True
            break
        pg.wait_for_timeout(500)
    marks["t_save_seen"] = now()
    step["save_landed"] = saved
    tr = ctx.request.get(base + "/api/j2/notes/tasks?status=open")
    tb = tr.json() if tr.status == 200 else {}
    mine = [t for t in (tb.get("tasks") or []) if t.get("noteId") == nid]
    step["open_tasks_mine"] = mine
    marks["t_tasks_read"] = now()
    idb_before = FR.idb_dump(pg)
    marks["t_idb_before_nav"] = now()
    if nav:
        marks["t_goto_start"] = now()
        C.goto(pg, base, nav_path)
        marks["t_goto_returned"] = now()
        row = pg.get_by_role("button", name=re.compile(r"^Follow up.*Reminder walk " + vp))
        step["tasks_view_row"] = C.vis_loc(row, 30000)
        marks["t_row_wait_done"] = now()
        pg.wait_for_timeout(8000)
    else:
        marks["t_hold_start"] = now()
        pg.wait_for_timeout(hold_s * 1000)
    marks["t_settled"] = now()
    idb_after = FR.idb_dump(pg)
    read = FR.read_notes(ctx, base, nid)
    marks["t_read"] = now()
    followup = None
    if followup_nav and not nav:
        # LABELLED SEPARATELY from the cell's own result (cell D is the no-navigation read above): after the
        # 10 s read, leave the page the way the walk does and read the account again.
        marks["t_followup_goto_start"] = now()
        C.goto(pg, base, nav_path)
        pg.wait_for_timeout(10000)
        marks["t_followup_settled"] = now()
        fr = FR.read_notes(ctx, base, nid)
        followup = {"idb": FR.idb_dump(pg), "fork_by_title": fr["fork_by_title"], "fork_by_tag": fr["fork_by_tag"],
                    "notes": fr["notes"], "server_note": fr["server_note"]}
    forks = [x for x in read["notes"] if FORK_TITLE in (x.get("title") or "")]
    out = {"run": idx, "flow": flow, "nav": nav, "viewport": vp, "note_id": nid, "email_domain": email.split("@")[-1],
           "marks": marks, "step": step, "forked": bool(read["fork_by_title"] or read["fork_by_tag"]),
           "fork_notes": forks, "notes_after": read["notes"], "server_note_after": read["server_note"],
           "put_statuses": [p["status"] for p in cap.pairs if p["method"] == "PUT"],
           "idb_before_nav": idb_before, "idb_after": idb_after,
           "followup_after_leaving": followup,
           "flow_complete": bool(step.get("date_list") and step.get("save_landed") and (step.get("mentions") or {}).get("n") == 1),
           "wire": cap.rows(), "events": events, "console": cap.console[:60]}
    ctx.close()
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--cell", required=True)
    ap.add_argument("--flow", choices=["remind", "task"], required=True)
    ap.add_argument("--no-nav", action="store_true")
    ap.add_argument("--runs", type=int, default=5)
    ap.add_argument("--viewport", default="1280")
    ap.add_argument("--hold-s", type=int, default=10)
    ap.add_argument("--nav-path", default="/journal/notebook?view=tasks")
    ap.add_argument("--code", default="", help="label only: the tree the sandbox serves")
    ap.add_argument("--dwell-ms", type=int, default=0, help="flow task: pause between the date list appearing and the Tab that picks")
    ap.add_argument("--followup-nav", action="store_true", help="with --no-nav: after the cell's own read, leave the page and read again (recorded separately)")
    ap.add_argument("--max-attempts", type=int, default=0, help="stop after this many attempts (default 2 x --runs); --runs counts runs whose FLOW completed")
    a = ap.parse_args(argv)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = Path(a.out) / f"cell-{a.cell}-{stamp}"
    out.mkdir(parents=True, exist_ok=False)
    params = {**vars(a), "started": stamp, "tool": "tools/notebook_forkdiag.py"}
    (out / "params.json").write_text(json.dumps(params, indent=1), encoding="utf-8", newline="\n")
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        admin = browser.new_context()
        h._signup_or_login(admin.request, a.base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest")
        cap_n = a.max_attempts or a.runs * 2
        i = 0
        while sum(1 for r in results if r.get("flow_complete")) < a.runs and i < cap_n:
            try:
                res = one_run(browser, admin, a.base, i, a.flow, not a.no_nav, a.viewport, a.hold_s, a.nav_path, a.followup_nav, a.dwell_ms)
            except Exception as e:  # noqa: BLE001
                import traceback
                res = {"run": i, "error": f"{type(e).__name__}: {str(e)[:400]}", "traceback": traceback.format_exc()[-1500:]}
            (out / f"run-{i:02d}.json").write_text(json.dumps(res, indent=1, default=str), encoding="utf-8", newline="\n")
            results.append(res)
            print(f"run {i}: " + (res.get("error") or f"flow_complete={res['flow_complete']} forked={res['forked']} puts={res['put_statuses']}"), flush=True)
            i += 1
        admin.close()
        browser.close()
    done = [r for r in results if "error" not in r]
    valid = [r for r in done if r["flow_complete"]]
    summary = {"cell": a.cell, "flow": a.flow, "no_nav": a.no_nav, "valid_runs_asked": a.runs, "attempts": len(results),
               "valid_runs": len(valid), "incomplete_flow_runs": [r["run"] for r in done if not r["flow_complete"]],
               "forks_in_valid_runs": sum(1 for r in valid if r["forked"]),
               "forks_in_all_runs": sum(1 for r in done if r["forked"]),
               "put_statuses_valid": [r["put_statuses"] for r in valid],
               "followup_forks": ([bool(r["followup_after_leaving"]["fork_by_title"]) for r in valid if r.get("followup_after_leaving")] or None),
               "errors": [r.get("error") for r in results if "error" in r]}
    (out / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8", newline="\n")
    print(json.dumps(summary), flush=True)
    if not valid:
        return 2
    return 1 if summary["forks_in_valid_runs"] else 0


if __name__ == "__main__":
    sys.exit(main())
