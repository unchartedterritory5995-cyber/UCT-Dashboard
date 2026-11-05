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
    ... --late-s 90  read the account again 90 s after the navigation (the outbox is sampled meanwhile)
    ... --control    POSITIVE CONTROL: a real second writer forks the note through the product; every run
                     must report forked=true, or the detector is broken and every "0 forks" is void
Detection is two signals, reported separately: the "(conflicted copy)" title and the "sync-conflict"
tag, both of which BOTH product fork doors set (NoteEditorPage reconcileConflict, useOutboxDrain
forkConflictedCopy).
Exit: 0 no fork in any run, 1 a fork reproduced, 2 INCONCLUSIVE (setup failed / nothing measured).
      With --control: 0 every run forked (detector proven), 1 a control run did NOT fork.
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


# The product's own marks on a preserved copy (read from the code, both fork doors):
#   NoteEditorPage.jsx reconcileConflict -> createNoteViaApi({title: "<title> (conflicted copy)", tags: ['sync-conflict']})
#   useOutboxDrain.js forkConflictedCopy -> createNoteViaApi({title: "<title> (conflicted copy)", tags: ['sync-conflict']})
# Two signals, reported SEPARATELY: a copy that carries one and not the other is itself a finding.
FORK_TITLE = "(conflicted copy)"
FORK_TAG = "sync-conflict"
CONTROL_BODY = {"type": "doc", "content": [{"type": "paragraph", "content": [
    {"type": "text", "text": "A second writer rewrote this paragraph."}]}]}


def read_notes(ctx, base: str, nid: str) -> dict:
    """One read of what the member's account holds, with both fork signals computed from it."""
    r = ctx.request.get(base + "/api/j2/notes?limit=500")
    body = r.json()
    rows = (body.get("notes") or body.get("items") or []) if isinstance(body, dict) else body
    by_title = [n.get("id") for n in rows if FORK_TITLE in (n.get("title") or "")]
    by_tag = [n.get("id") for n in rows if FORK_TAG in (n.get("tags") or [])]
    server = ctx.request.get(f"{base}/api/j2/notes/{nid}").json().get("note") or {}
    return {"t": round(time.time(), 3), "list_status": r.status,
            "fork_by_title": bool(by_title), "fork_by_tag": bool(by_tag),
            "fork_ids_by_title": by_title, "fork_ids_by_tag": by_tag,
            "notes": [{"id": n.get("id"), "title": n.get("title"), "updatedAt": n.get("updatedAt"),
                       "tags": n.get("tags")} for n in rows],
            "server_note": {"updatedAt": server.get("updatedAt"), "title": server.get("title"),
                            "body": json.dumps(server.get("bodyJson"))[:3000]}}


def idb_dump(pg) -> dict:
    try:
        return pg.evaluate(IDB_DUMP_JS)
    except Exception as e:  # noqa: BLE001
        return {"error": f"{type(e).__name__}: {str(e)[:200]}"}   # unreadable is not empty


def outbox_len(idb) -> int | None:
    """Queued entries across the account's notebook databases; None when the dump is unreadable."""
    if not isinstance(idb, dict) or "error" in idb or not idb:
        return None
    total = 0
    for v in idb.values():
        if not isinstance(v, dict) or not isinstance(v.get("outbox"), list):
            return None
        total += len(v["outbox"])
    return total


def one_run(browser, admin, base: str, nav_ms: int, idx: int, vp: str, nav: str, prepared=None,
            type_delay: int | None = None, menu_pause_ms: int = 0, latency_ms: int = 0, settle_s: int = 8,
            late_s: int = 0, control: bool = False) -> dict:
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
    control_write = None
    if control:
        # THE POSITIVE CONTROL: a REAL second writer, through the product's own route. The editor
        # holds unsent typing (its 800 ms autosave has not fired yet), and the same account PUTs a
        # DIFFERENT body on the revision the editor opened on. The editor's autosave then goes out
        # on that stale base, the server answers 409, and `reconcileConflict` classifies the
        # server copy against its base: a rewritten paragraph is BODY_REWRITE, which forks
        # (`ownerReconcilePlan`). The detector must see that copy, or every "0 forks" is void.
        cw = ctx.request.put(f"{base}/api/j2/notes/{nid}", data={
            "title": TITLE, "bodyJson": CONTROL_BODY, "baseUpdatedAt": created_rev})
        try:
            cw_text = cw.text() or ""
        except Exception as e:  # noqa: BLE001
            cw_text = f"(unreadable: {type(e).__name__})"
        control_write = {"t_sent": round(time.time(), 3), "status": cw.status,
                         "baseUpdatedAt": created_rev, "response_rev": _revisions(cw_text)}
    pg.wait_for_timeout(nav_ms)
    t_nav = round(time.time(), 3)
    how = go_back(pg, base, vp, nav)
    pg.wait_for_timeout(settle_s * 1000)  # let any outbox drain land (latency runs need longer)
    idb = idb_dump(pg)
    read_early = read_notes(ctx, base, nid)
    read_late, idb_late, outbox_samples, drained_at = None, None, [], None
    if late_s:
        # ONE READ IS NOT THE END OF A RUN. The leader re-drains every RETRY_INTERVAL_MS (60 s), so
        # a fork can land after the early read. Sample the outbox until the late deadline, note when
        # it was first seen empty, and read the account again AT the deadline either way.
        deadline = t_nav + late_s
        while time.time() < deadline:
            n = outbox_len(idb_dump(pg))
            outbox_samples.append([round(time.time() - t_nav, 1), n])
            if n == 0 and drained_at is None:
                drained_at = round(time.time() - t_nav, 1)
            left = deadline - time.time()
            if left > 0:
                pg.wait_for_timeout(int(min(5.0, left) * 1000) + 1)
        idb_late = idb_dump(pg)
        read_late = read_notes(ctx, base, nid)
    reads = [read_early] + ([read_late] if read_late else [])
    forked = any(r["fork_by_title"] or r["fork_by_tag"] for r in reads)
    out = {"run": idx, "email_domain": email.split("@")[-1], "note_id": nid, "created_updatedAt": created_rev,
           "viewport": vp, "nav": nav, "nav_how": how, "nav_ms": nav_ms, "type_delay": type_delay,
           "menu_pause_ms": menu_pause_ms, "latency_ms": latency_ms, "control": control,
           "control_write": control_write,
           "created_at_epoch": note.get("createdAt"), "t_run_start": round(t0, 3), "t_last_key": t_last_key,
           "t_nav": t_nav, "forked": forked,
           "fork_at_early": {"by_title": read_early["fork_by_title"], "by_tag": read_early["fork_by_tag"]},
           "fork_at_late": ({"by_title": read_late["fork_by_title"], "by_tag": read_late["fork_by_tag"]}
                            if read_late else None),
           "notes_after": read_early["notes"],
           "server_note_after": read_early["server_note"],
           "settle_s": settle_s, "late_s": late_s, "idb_after": idb,
           "read_early": read_early, "read_late": read_late, "idb_late": idb_late,
           "outbox_samples": outbox_samples, "outbox_first_empty_s": drained_at,
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
    ap.add_argument("--late-s", type=int, default=0,
                    help="also read again this many seconds after the navigation (outbox sampled meanwhile)")
    ap.add_argument("--control", action="store_true",
                    help="POSITIVE CONTROL: a second writer PUTs the note on the stale base while the editor "
                         "holds unsent typing; every run MUST report forked=true or the detector is broken")
    a = ap.parse_args(argv)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = Path(a.out) / f"fork-repro-{stamp}"
    out.mkdir(parents=True, exist_ok=False)
    params = {"runs": a.runs, "nav_ms": a.nav_ms, "nav": a.nav, "viewport": a.viewport, "age": a.age,
              "type_delay": a.type_delay, "menu_pause_ms": a.menu_pause_ms, "latency_ms": a.latency_ms,
              "settle_s": a.settle_s, "late_s": a.late_s, "control": a.control,
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
                              settle_s=a.settle_s, late_s=a.late_s, control=a.control)
            except Exception as e:  # noqa: BLE001
                res = {"run": i, "error": f"{type(e).__name__}: {str(e)[:400]}"}
            results.append(res)
            (out / f"run-{i:02d}.json").write_text(json.dumps(res, indent=1), encoding="utf-8", newline="\n")
            print(f"run {i}: forked={res.get('forked')} early={res.get('fork_at_early')} "
                  f"late={res.get('fork_at_late')} outbox_first_empty_s={res.get('outbox_first_empty_s')} "
                  f"control_write={(res.get('control_write') or {}).get('status')} error={res.get('error')}",
                  flush=True)
        browser.close()
    measured = [r for r in results if "forked" in r]
    forks = [r["run"] for r in measured if r["forked"]]

    def _runs(when: str, sig: str) -> list:
        return [r["run"] for r in measured if (r.get(when) or {}).get(sig)]

    summary = {**params, "measured": len(measured), "forked_runs": forks,
               "forked_early_by_title": _runs("fork_at_early", "by_title"),
               "forked_early_by_tag": _runs("fork_at_early", "by_tag"),
               "late_read_runs": [r["run"] for r in measured if r.get("fork_at_late") is not None],
               "forked_late_by_title": _runs("fork_at_late", "by_title"),
               "forked_late_by_tag": _runs("fork_at_late", "by_tag"),
               "errors": [r["run"] for r in results if "error" in r]}
    if a.control:
        # ⛔ A CONTROL THAT DID NOT FORK VOIDS THE DETECTOR, not the hypothesis. Said in the file.
        missed = [r["run"] for r in measured if not r["forked"]]
        summary["control_verdict"] = ("DETECTOR SEES A REAL FORK in every measured run" if measured and not missed
                                      else f"CONTROL FAILED: no fork seen in runs {missed} -- every '0 forks' is void")
    (out / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8", newline="\n")
    print(json.dumps(summary))
    if not measured:
        return 2
    if a.control:
        return 0 if not [r for r in measured if not r["forked"]] else 1
    return 1 if forks else 0


if __name__ == "__main__":
    sys.exit(main())
