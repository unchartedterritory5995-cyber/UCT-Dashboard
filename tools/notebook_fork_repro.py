"""Reproduce the single-tab '(conflicted copy)' fork seen by the 2026-10-11 discoverability audit.

Shape (from the audit, member 4): a note made through the notes API, opened in ONE tab ~40 min
later (here: immediately, or after --age seconds), `/checklist` + text typed, and a navigation to
the notes list ~1.5 s after the last keystroke. Every request on /api/j2/notes* is captured at SEND
time and again at its RESPONSE (status, revision fields, body) or its FAILURE (an aborted request is
recorded as such -- an unanswered request is not an answered one). CLAUDE.md: requests without
responses cannot establish a causal chain. Raw evidence is written per run BEFORE any summary (R-RAW).

The way back to the list, as a member meets it (adapted from the brief, which guessed a link):
  --nav click   1280: the folder panel's "All notes" row ([data-all-notes-row]); 390: the phone's
                "Back to notes" button ([data-nb-phone-back]). An in-app navigation: the editor
                UNMOUNTS (its unmount flush runs) while the page lives on.
  --nav goto    a full document navigation to /journal/notebook. The page is torn down: no unmount
                cleanup runs, and any PUT still on the wire is aborted by the browser.

Precondition: a sandbox from this tree is serving, e.g. (PowerShell, data dir single-quoted)
    python tools/notebook_fin_walk.py --config c2 --data-root '<dir>' --port 8132 --out '<dir>' --tip <sha> --serve-only
Usage:
    python tools/notebook_fork_repro.py --base http://127.0.0.1:8132 --out docs/notebook/evidence --runs 10 --nav-ms 1500
    ... --age 2400   create every run's note first, wait once, then open them (the audit's 40-minute age)
Exit: 0 no fork in any run, 1 a fork reproduced, 2 INCONCLUSIVE (setup failed / nothing measured).
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
from playwright.sync_api import sync_playwright  # noqa: E402

NOTE_RE = re.compile(r"/api/j2/notes(/|\?|$)")
TITLE = "My trading rules"
BODY = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Rule one."}]}]}


def _path(url: str) -> str:
    return re.sub(r"^https?://[^/]+", "", url)[:240]


def _revisions(text: str) -> dict:
    """The revision fields a pair is read by, pulled out of a JSON body (never inferred)."""
    out: dict = {}
    try:
        j = json.loads(text)
    except Exception:  # noqa: BLE001
        return out
    if not isinstance(j, dict):
        return out
    if "baseUpdatedAt" in j:
        out["baseUpdatedAt"] = j.get("baseUpdatedAt")
    note = j.get("note") if isinstance(j.get("note"), dict) else (j if "updatedAt" in j else None)
    if isinstance(note, dict):
        out["updatedAt"] = note.get("updatedAt")
        out["title"] = note.get("title")
        out["id"] = note.get("id")
    if "title" in j and "title" not in out:
        out["title"] = j.get("title")
    if "detail" in j:
        out["detail"] = str(j.get("detail"))[:300]
    return out


class Capture:
    """Every /api/j2/notes* request, in SEND order, completed by its response or its failure."""

    def __init__(self, ctx):
        self.pairs: list[dict] = []
        self._by_req: dict[int, dict] = {}
        self.console: list[str] = []
        ctx.on("request", self._on_request)
        ctx.on("response", self._on_response)
        ctx.on("requestfailed", self._on_failed)
        ctx.on("requestfinished", self._on_finished)
        ctx.on("page", lambda pg: pg.on("console", self._on_console))

    def _on_console(self, m):
        try:
            if m.type in ("error", "warning"):
                self.console.append(f"{round(time.time(), 3)} {m.type}: {m.text[:400]}")
        except Exception:  # noqa: BLE001
            pass

    def _on_request(self, req):
        try:
            if not NOTE_RE.search(req.url):
                return
            body = req.post_data or ""
            row = {"i": len(self.pairs), "t_sent": round(time.time(), 3), "method": req.method,
                   "url": _path(req.url), "request": body[:6000], "request_rev": _revisions(body),
                   "status": None, "t_done": None, "response": None, "response_rev": {}, "failure": None}
            self.pairs.append(row)
            self._by_req[id(req)] = row
        except Exception:  # noqa: BLE001 -- a handler must never raise into the run
            pass

    def _on_response(self, r):
        try:
            row = self._by_req.get(id(r.request))
            if row is not None:
                row["status"] = r.status
                row["t_resp"] = round(time.time(), 3)
                row["_resp"] = r
        except Exception:  # noqa: BLE001
            pass

    def _on_finished(self, req):
        try:
            row = self._by_req.get(id(req))
            if row is None:
                return
            row["t_done"] = round(time.time(), 3)
            r = row.pop("_resp", None)
            if r is None:
                return
            try:
                text = r.text() or ""
                row["response"] = text[:6000]
                row["response_rev"] = _revisions(text)
            except Exception as e:  # noqa: BLE001
                row["response"] = f"(unreadable: {type(e).__name__})"   # NOT empty: unknown != none
        except Exception:  # noqa: BLE001
            pass

    def _on_failed(self, req):
        try:
            row = self._by_req.get(id(req))
            if row is not None:
                row["t_done"] = round(time.time(), 3)
                row.pop("_resp", None)
                row["failure"] = str(req.failure or "failed")[:200]
        except Exception:  # noqa: BLE001
            pass

    def rows(self) -> list[dict]:
        return [{k: v for k, v in r.items() if not k.startswith("_")} for r in self.pairs]


def make_member(browser, admin, base: str, idx: int, vp: str):
    ctx, email, _me = C.member(browser, admin.request, base, f"fk{idx}", vp)
    r = ctx.request.post(base + "/api/j2/notes", data={"title": TITLE, "bodyJson": BODY})
    if r.status not in (200, 201):
        raise h.SetupFailed(f"create failed HTTP {r.status} {r.text()[:300]}")
    note = r.json().get("note") or r.json()
    return ctx, email, note


IDB_DUMP_JS = r"""
async () => {
  // The durable layer's own stores, read AFTER the run: what is still owed (outbox), what the
  // working copy holds (notes), and the in-flight marker / landed ring (meta). Read-only.
  const out = {}
  const dbs = indexedDB.databases ? await indexedDB.databases() : []
  for (const d of dbs) {
    if (!d.name || !d.name.includes('otebook')) continue
    out[d.name] = await new Promise((resolve) => {
      const req = indexedDB.open(d.name)
      req.onerror = () => resolve({ error: String(req.error) })
      req.onsuccess = () => {
        const db = req.result, res = {}
        const names = [...db.objectStoreNames].filter((n) => ['outbox', 'notes', 'meta'].includes(n))
        if (!names.length) { db.close(); resolve(res); return }
        const tx = db.transaction(names, 'readonly')
        let left = names.length
        for (const n of names) {
          const g = tx.objectStore(n).getAll()
          g.onsuccess = () => { res[n] = g.result; if (--left === 0) { db.close(); resolve(res) } }
          g.onerror = () => { res[n] = String(g.error); if (--left === 0) { db.close(); resolve(res) } }
        }
      }
    })
  }
  return out
}
"""


def go_back(pg, base: str, vp: str, nav: str) -> str:
    if nav == "goto":
        pg.goto(base + "/journal/notebook", wait_until="domcontentloaded", timeout=60000)
        return "goto /journal/notebook"
    sel = "[data-nb-phone-back]" if vp == "390" else "[data-all-notes-row]"
    pg.locator(sel).first.click(timeout=10000)
    return f"click {sel}"


def one_run(browser, admin, base: str, nav_ms: int, idx: int, vp: str, nav: str, prepared=None,
            type_delay: int | None = None, menu_pause_ms: int = 0, latency_ms: int = 0, settle_s: int = 8) -> dict:
    t0 = time.time()
    if prepared is None:
        ctx, email, note = make_member(browser, admin, base, idx, vp)
    else:
        ctx, email, note = prepared
    cap = Capture(ctx)
    nid = note.get("id")
    created_rev = note.get("updatedAt")
    pg = ctx.new_page()
    if latency_ms:
        # Real round-trip latency on EVERY request of this page (Chromium's own throttle, so order
        # is the network's, not a script's). Labelled in the run file; 0 = the loopback as it is.
        cdp = ctx.new_cdp_session(pg)
        cdp.send("Network.enable")
        cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": latency_ms,
                                                      "downloadThroughput": -1, "uploadThroughput": -1})
    C.goto(pg, base, f"/journal/notebook?note={nid}", wait=".ProseMirror")
    # The caret goes to the END of the last paragraph, as a member clicking after "Rule one."
    # (a bare click + Control+End left it at the start of the document on Chromium/Windows).
    pg.wait_for_timeout(600)   # the editor is rebuilt once when the note hydrates; click after that
    pg.locator(".ProseMirror p").last.click()
    pg.keyboard.press("End")
    pg.keyboard.press("Enter")
    pg.keyboard.type("/checklist", delay=40 if type_delay is None else type_delay)
    if menu_pause_ms:
        pg.wait_for_timeout(menu_pause_ms)   # a script waiting for the slash menu: the autosave fires
    pg.keyboard.press("Enter")
    pg.keyboard.type("Never move a stop down", delay=30 if type_delay is None else type_delay)
    t_last_key = round(time.time(), 3)
    pg.wait_for_timeout(nav_ms)
    t_nav = round(time.time(), 3)
    how = go_back(pg, base, vp, nav)
    pg.wait_for_timeout(settle_s * 1000)  # let any outbox drain land (latency runs need longer)
    try:
        idb = pg.evaluate(IDB_DUMP_JS)
    except Exception as e:  # noqa: BLE001
        idb = {"error": f"{type(e).__name__}: {str(e)[:200]}"}   # unreadable is not empty
    r = ctx.request.get(base + "/api/j2/notes?limit=500")
    body = r.json()
    rows = (body.get("notes") or body.get("items") or []) if isinstance(body, dict) else body
    forked = any("(conflicted copy)" in (n.get("title") or "") for n in rows)
    server = ctx.request.get(f"{base}/api/j2/notes/{nid}").json().get("note") or {}
    out = {"run": idx, "email_domain": email.split("@")[-1], "note_id": nid, "created_updatedAt": created_rev,
           "viewport": vp, "nav": nav, "nav_how": how, "nav_ms": nav_ms, "type_delay": type_delay,
           "menu_pause_ms": menu_pause_ms, "latency_ms": latency_ms,
           "created_at_epoch": note.get("createdAt"), "t_run_start": round(t0, 3), "t_last_key": t_last_key,
           "t_nav": t_nav, "forked": forked,
           "notes_after": [{"id": n.get("id"), "title": n.get("title"), "updatedAt": n.get("updatedAt"),
                            "tags": n.get("tags")} for n in rows],
           "server_note_after": {"updatedAt": server.get("updatedAt"), "title": server.get("title"),
                                 "body": json.dumps(server.get("bodyJson"))[:3000]},
           "settle_s": settle_s, "idb_after": idb,
           "console": cap.console[:60],
           "pairs": cap.rows()}
    ctx.close()
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--runs", type=int, default=10)
    ap.add_argument("--nav-ms", type=int, default=1500)
    ap.add_argument("--nav", choices=["click", "goto"], default="click")
    ap.add_argument("--viewport", choices=["1280", "390"], default="1280")
    ap.add_argument("--age", type=int, default=0, help="seconds between creating the notes and opening them")
    ap.add_argument("--type-delay", type=int, default=None, help="ms between keystrokes (default: 40 / 30, the brief's)")
    ap.add_argument("--menu-pause-ms", type=int, default=0, help="pause after typing /checklist, before Enter")
    ap.add_argument("--latency-ms", type=int, default=0, help="Chromium network latency added to every request")
    ap.add_argument("--settle-s", type=int, default=8, help="seconds to wait after the navigation before reading")
    a = ap.parse_args(argv)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = Path(a.out) / f"fork-repro-{stamp}"
    out.mkdir(parents=True, exist_ok=False)
    params = {"runs": a.runs, "nav_ms": a.nav_ms, "nav": a.nav, "viewport": a.viewport, "age": a.age,
              "type_delay": a.type_delay, "menu_pause_ms": a.menu_pause_ms, "latency_ms": a.latency_ms,
              "settle_s": a.settle_s,
              "base": a.base, "started": stamp}
    (out / "params.json").write_text(json.dumps(params, indent=1), encoding="utf-8", newline="\n")
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        admin = browser.new_context()
        h._signup_or_login(admin.request, a.base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest")
        prepared: dict = {}
        if a.age > 0:
            # ONE member owns every aged note (the audit's member 4 held several notes). Each run
            # still opens in a FRESH browser context carrying only the session cookie, so no run
            # inherits another's IndexedDB working copy or outbox. One signup, not --runs of them
            # (signup is rate-limited per minute).
            owner, email, _me = C.member(browser, admin.request, a.base, "fkage", a.viewport)
            state = owner.storage_state()
            for i in range(a.runs):
                try:
                    r = owner.request.post(a.base + "/api/j2/notes", data={"title": TITLE, "bodyJson": BODY})
                    if r.status not in (200, 201):
                        raise h.SetupFailed(f"create failed HTTP {r.status} {r.text()[:300]}")
                    note = r.json().get("note") or r.json()
                    prepared[i] = (C.new_ctx(browser, a.viewport, storage=state), email, note)
                except Exception as e:  # noqa: BLE001
                    prepared[i] = e
            print(f"created {a.runs} notes; waiting {a.age}s", flush=True)
            time.sleep(a.age)
        for i in range(a.runs):
            try:
                prep = prepared.get(i)
                if isinstance(prep, Exception):
                    raise prep
                res = one_run(browser, admin, a.base, a.nav_ms, i, a.viewport, a.nav, prep,
                              type_delay=a.type_delay, menu_pause_ms=a.menu_pause_ms, latency_ms=a.latency_ms,
                              settle_s=a.settle_s)
            except Exception as e:  # noqa: BLE001
                res = {"run": i, "error": f"{type(e).__name__}: {str(e)[:400]}"}
            results.append(res)
            (out / f"run-{i:02d}.json").write_text(json.dumps(res, indent=1), encoding="utf-8", newline="\n")
            print(f"run {i}: forked={res.get('forked')} error={res.get('error')}", flush=True)
        browser.close()
    measured = [r for r in results if "forked" in r]
    forks = [r["run"] for r in measured if r["forked"]]
    summary = {**params, "measured": len(measured), "forked_runs": forks,
               "errors": [r["run"] for r in results if "error" in r]}
    (out / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8", newline="\n")
    print(json.dumps(summary))
    if not measured:
        return 2
    return 1 if forks else 0


if __name__ == "__main__":
    sys.exit(main())
