"""The head-to-head benchmark's UCT column, automated, on a sandbox.

Wave 9, lane 9A, item A3. It drives the UCT Notebook the way docs/notebook/benchmark/protocol.md
tells a person to -- a real click on the note's card, typing into the sidebar search box,
Control+K and the title, real keys at the end of a note, a real Control+V -- and times every op
with the SAME probe file the owner pastes into Notion, Evernote and Obsidian
(tools/bench_probes/bench_probe.js, evaluated unchanged through Playwright's add_init_script so it
survives reloads). Its dumps have the hand dumps' schema (`app: "uct-sandbox-auto"`).

⛔ A LANE ACCEPTANCE AND PER-RELEASE CROSS-CHECK, NEVER THE UCT COLUMN OF THE HEAD-TO-HEAD
(ruling D-9A3). A loopback sandbox has no network, so it would make UCT look faster than any cloud
app for a reason that is not the product. The UCT column is the owner's hand run on the production
bench account; this row sits beside it and is never ratioed against it.

Run, local only (Playwright is a local install, as for the perf harness):

    python tools/notebook_bench_uct.py --boot --data-dir 'C:\\data-w9bench' --port 8096 \\
        --corpus <a corpus dir from tools/notebook_bench_corpus.py> --json <out>/uct-auto.json
    python tools/notebook_bench_uct.py --dry-run           # no browser, no sandbox, no lock

Pass the data dir from PowerShell or single-quoted: a Windows path through the Bash tool loses its
backslash (CLAUDE.md, 2026-09-12).

In order, and each step refuses by name:
  1. arguments; the data dir never inside C:\\data (`notebook_perf_harness.refuse_shared_root`);
     the port has no listener (`port_busy`, never kills the holder);
  2. THE BOX FIRST: `gate_box_lock.status()` -- a live holder refuses the run, naming it
     (`gate_box_lock.describe`); `Memory\\Available MBytes` (the performance counter, never WMI free
     memory -- CLAUDE.md) must be at or above MEMORY_FLOOR_MB, which is the owner-ruled 4.5 GB floor
     for heavy runs on this box (`gate_box_sampler.FREE_MEMORY_FLOOR_GB`, read, never retyped);
  3. the corpus directory re-verifies against its own manifest (`notebook_bench_corpus.verify`);
  4. `gate_box_lock.acquire` for the whole run, `release` in `finally`;
  5. the sandbox (`notebook_perf_harness.Sandbox`: `scripts/hub_sandbox_boot.py`, stopped
     gracefully, its integrity log read) -- whose verdict is this run's FIRST output line;
  6. its OWN accounts (`w9bench@local.dev`; the sandbox admin comps it through the harness's
     `_provision` recipe), seeding the A1 payload through POST /api/j2/notes/import/confirm batch
     by batch, and the note count confirmed through the app (the list's total AND the page's own
     "Showing N of M notes" line) before anything is timed;
  7. R-HON, step 0: `selfTest()` in Chromium -- a failure withholds EVERY timing (exit 2); every
     reload re-runs it, so every dump carries a passing reading;
  8. the ops of `notebook_bench_report.OPS`, in order, each dump written to disk the moment it is
     taken (R-RAW), then the summary.
⛔ If the clipboard write fails, H8 is INCONCLUSIVE -- never a synthetic ClipboardEvent.
⛔ H8 clicks '+ New note' only once the page has gone quiet, and a click that opens no note is
INCONCLUSIVE with that sentence (`_Traffic`: a click ~50 ms after Back opened nothing).

Selectors, all read in the product at this tree: the note card `[data-note-card-id]`
(NoteCard.jsx:126), the sidebar Search tab (role tab, name "Search notes", FolderSidebar.jsx:1282-1287),
its box "Search your notes" (FolderSidebar.jsx:1310; Escape clears it, :1312), the palette's input
"Search a security, company, or note" (CommandPalette.jsx:534; Control+K, :150), the "+ New note"
button `[data-tour="new-note"]` (NotebookTab.jsx:1894), the editor `.ProseMirror`.

Exit: 0 every op measured · 2 INCONCLUSIVE (the integrity is not CLEAN, the selfTest failed, or
an op is INCONCLUSIVE with its sentence) · 3 refused or not run (bad arguments, a shared-root data
dir, a busy port, a held lock, memory below the floor, a corpus that does not verify, setup failed).
There is no "breach" exit: this is a benchmark, not a budget.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO / "tools") not in sys.path:
    sys.path.insert(0, str(REPO / "tools"))
import gate_box_lock  # noqa: E402
import gate_box_sampler  # noqa: E402
import notebook_bench_corpus as corpus_tool  # noqa: E402
import notebook_bench_report as rep  # noqa: E402
import notebook_perf_harness as h  # noqa: E402

BENCH_EMAIL, BENCH_PW, BENCH_NAME = "w9bench@local.dev", "LocalTest2026!", "w9bench"
MEMBER = (BENCH_EMAIL, BENCH_PW, BENCH_NAME)
AUTO_APP = rep.AUTO_APP
PROBE_FILE = rep.PROBE_FILE
MEMORY_FLOOR_MB = gate_box_sampler.FREE_MEMORY_FLOOR_GB * 1024
COMMITTED_MANIFEST = REPO / "docs" / "notebook" / "benchmark" / "corpus-manifest.json"
REP_TIMEOUT_S = 30.0          # one rep, from the gesture, before the op is called INCONCLUSIVE
# The GRID card. The sidebar's "Recently updated" rows and folder rows carry the SAME
# `data-note-card-id` (FolderSidebar.jsx:219, :772) and a `title` attribute; the grid card
# (NoteCard.jsx:126) has none. Run 1 (evidence wave9-9a-a156318cb/run1) died on the strict-mode
# "resolved to 2 elements" for exactly this reason.
GRID_CARD = 'button[data-note-card-id]:not([title])'


def card_selector(note_id: str) -> str:
    return f'button[data-note-card-id="{note_id}"]:not([title])'
PROBE_TIMEOUT_MS = 15000      # the probe's own not-in-dom timeout
TYPE_DELAY_MS = 25            # notebook_perf_harness.py:556
SEARCH_KEY_DELAY_MS = 40
# H8's setup pace (never inside a timed span: a paste's t0 is its own Control+V). Before each
# '+ New note' the page must have had no request in flight for QUIET_MS (at most QUIET_TIMEOUT_S),
# and the click must open a note -- the URL names it -- within CREATE_TIMEOUT_S, or the op is
# INCONCLUSIVE with that sentence. See _Traffic for the run that named this.
QUIET_MS = 400
QUIET_TIMEOUT_S = 15.0
CREATE_TIMEOUT_S = 15.0
# Read at call time, never bound as defaults (CLAUDE.md: "A DEFAULT ARGUMENT IS BOUND AT IMPORT"),
# so a rail can turn the PowerShell load probe off.
LOAD_PROBE = True


# ── the box ───────────────────────────────────────────────────────────────────────────────────

def available_mbytes() -> float | None:
    """`\\Memory\\Available MBytes`, from typeperf. None when the counter cannot be read -- which
    refuses the run: an unread counter is not a quiet box."""
    try:
        out = subprocess.run(["typeperf", r"\Memory\Available MBytes", "-sc", "1"], capture_output=True,
                             text=True, encoding="utf-8", errors="replace", timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    for line in out.splitlines():
        m = re.match(r'^"[^"]*","([\d.]+)"\s*$', line.strip())
        if m:
            return float(m.group(1))
    return None


def box_status() -> dict:
    return gate_box_lock.status(load=LOAD_PROBE)


def refusal(reason: str) -> int:
    print(f"SANDBOX INTEGRITY: NOT RUN (refused: {reason}) -- no sandbox was started")
    print(f"VERDICT: REFUSED -- {reason}")
    return 3


# ── the plan (pure) ──────────────────────────────────────────────────────────────────────────

def plan(manifest: dict) -> list[dict]:
    """Every op of rep.OPS with the corpus markers it needs. Pure: the dry run prints it."""
    timed, markers = manifest["timed_notes"], manifest["markers"]
    out = []
    for op in rep.OPS:
        p = dict(op)
        tgt = timed.get(op["target"]) if op["target"] else None
        if op["kind"] == "open":
            p["note_key"] = tgt["key"]
            p["marker"] = tgt["first_marker"] if op["mode"] == "first" else tgt["last_marker"]
            p["anchor"] = tgt["first_marker"]
        elif op["kind"] == "search":
            p["expected_title"] = tgt["title"]
            # ⛔ H5 types a unique PREFIX (the first two words) and waits for the FULL title. Typing
            # the whole title lets any echo of the query count as the result: the palette renders
            # `No matches for "<query>"` (CommandPalette.jsx:569), and run 1 timed that echo at 1 ms.
            p["query"] = tgt["term"] if op["target"] == "rare" else " ".join(tgt["title"].split()[:2])
        elif op["kind"] == "typing":
            p["note_key"] = tgt["key"]
            p["last_marker"] = tgt["last_marker"]
        elif op["kind"] == "paste":
            p["end_marker"] = markers["paste_end"]
        out.append(p)
    return out


def arm_options(step: dict) -> dict | None:
    """The probe's arm() options for one op round -- the ONE source for both this runner and the
    console lines the owner pastes (`--dry-run --corpus DIR` prints them). None for cold."""
    kind = step["kind"]
    if kind == "open":
        o = {"marker": step["marker"], "mode": step["mode"], "reps": step["reps_per_round"],
             "timeoutMs": PROBE_TIMEOUT_MS}
        if step["mode"] == "full":
            o["anchor"] = step["anchor"]
        return o
    if kind == "search":
        return {"expectedTitle": step["expected_title"], "reps": step["reps_per_round"], "timeoutMs": PROBE_TIMEOUT_MS}
    if kind == "typing":
        return {"expectKeys": step["chars_per_round"]}
    if kind == "paste":
        return {"endMarker": step["end_marker"], "reps": step["reps_per_round"], "timeoutMs": PROBE_TIMEOUT_MS}
    return None


def console_lines(step: dict) -> list[str]:
    """What the owner types in DevTools for one round of this op, in order."""
    opts = arm_options(step)
    guard = {"open": step.get("marker"), "search": step.get("expected_title"),
             "paste": step.get("end_marker")}.get(step["kind"])
    lines = ["await __uctBench.selfTest()"]
    if guard:
        lines.append(f"__uctBench.check({json.dumps(guard)})    // must print: absent")
    if step["kind"] == "cold":
        lines = ["await __uctBench.arm('cold')    // FIRST, before any click in the page", "await __uctBench.selfTest()"]
    else:
        lines.append(f"__uctBench.arm('{step['kind']}', {json.dumps(opts)})")
    lines.append("// ...close DevTools, do the reps, reopen DevTools...")
    lines.append(f"copy(__uctBench.dump('<app>', '{step['id']}'))    // save as <app>__{step['id']}__r<round>.json")
    return lines


def summarize_op(op: dict, dumps: list[dict], failure: str | None = None, paths: list[str] | None = None) -> dict:
    """One per-op record in A5's SUMMARY_OP_KEYS. Pure."""
    samples = [x for d in dumps for x in d.get("samples", [])]
    invalid: dict[str, int] = {}
    for d in dumps:
        for r in d.get("invalid", []):
            invalid[r] = invalid.get(r, 0) + 1
    rec = {"op": op["id"], "kind": op["kind"], "n": len(samples), "p50_ms": None, "p95_ms": None,
           "status": "INCONCLUSIVE", "reason": None, "dumps": list(paths or []), "invalid": invalid}
    if failure:
        rec["reason"] = failure
        return rec
    if op["kind"] == "typing":
        short = [d for d in dumps if len(d.get("samples", [])) < (d.get("expectKeys") or op["chars_per_round"])]
        if short or len(dumps) < op["rounds"]:
            got = sum(len(d.get("samples", [])) for d in dumps)
            rec["reason"] = (f"typing short of keys: {got} samples for {op['rounds'] * op['chars_per_round']} keys "
                             f"sent over {len(dumps)} of {op['rounds']} rounds -- never a p95 over the keys that landed")
            return rec
    if not samples:
        what = "; ".join(f"{k} ×{v}" for k, v in sorted(invalid.items())) or "no attempt completed"
        rec["reason"] = f"no sample: {what}"
        return rec
    rec.update(status="MEASURED", p50_ms=round(h.percentile(samples, 50), 3),
               p95_ms=round(h.percentile(samples, 95), 3))
    return rec


# ── the live run ──────────────────────────────────────────────────────────────────────────────

def provision(admin_req, member_req, base: str) -> None:
    """This runner's OWN account through the harness's one recipe (never its perf account)."""
    h._provision(admin_req, member_req, base, member=MEMBER)


def seed(req, base: str, corpus_dir: Path, manifest: dict) -> dict[str, str]:
    """Every batch through the import door; returns importKey -> note id."""
    ids: dict[str, str] = {}
    for f in sorted((corpus_dir / "uct").glob("import-batch-*.json")):
        batch = json.loads(f.read_text(encoding="utf-8"))
        r = req.post(base + "/api/j2/notes/import/confirm", data=batch, timeout=180000)
        if r.status != 200:
            raise h.SetupFailed(f"import/confirm {f.name}: HTTP {r.status} {r.text()[:200]}")
        body = r.json()
        if body.get("failed"):
            raise h.SetupFailed(f"import/confirm {f.name}: {len(body['failed'])} note(s) failed, first "
                                f"{json.dumps(body['failed'][0])[:200]}")
        for item in body.get("created", []) + body.get("updated", []) + body.get("skipped", []):
            ids[item["importKey"]] = item["id"]
    want = manifest["counts"]["total_notes"]
    if len(ids) != want:
        raise h.SetupFailed(f"the import returned {len(ids)} note ids for {want} notes")
    return ids


def _wait_attempts(pg, n: int) -> None:
    pg.wait_for_function("n => window.__uctBench && window.__uctBench.status().attempts >= n",
                         arg=n, timeout=REP_TIMEOUT_S * 1000)


class _Traffic:
    """The page's requests in flight, long-lived streams left out (an EventSource never finishes).

    Why it exists: in runs 1 and 3 and experiments 2 and 4 H8 died waiting for the editor, and
    experiment 5's Playwright API log (docs/notebook/evidence/wave9-9a-7f8d9791c/experiment5,
    exp-stderr.log, section W1) shows what happened: rep 1 created, pasted and went Back; rep 2's
    '+ New note' click was performed ~50 ms after the grid card was visible again, and the app made
    no create request at all (the sandbox log holds one POST /api/j2/notes for W1). A person does
    not click that fast after Back. So before every create the runner waits for the page to go
    quiet, the way a person pauses -- and then checks that the click opened a note."""

    def __init__(self, pg):
        self.inflight = 0
        self.last = time.monotonic()
        pg.on("request", self._start)
        pg.on("requestfinished", self._end)
        pg.on("requestfailed", self._end)

    @staticmethod
    def long_lived(req) -> bool:
        return req.resource_type in ("eventsource", "websocket") or "/api/stream/" in req.url

    def _start(self, req) -> None:
        if not self.long_lived(req):
            self.inflight += 1
            self.last = time.monotonic()

    def _end(self, req) -> None:
        if not self.long_lived(req):
            self.inflight = max(0, self.inflight - 1)
            self.last = time.monotonic()

    def quiet(self, pg, quiet_ms: float | None = None, timeout_s: float | None = None) -> bool:
        """True once nothing short-lived has been in flight for quiet_ms; False at timeout_s (the
        caller goes on, and the create check that follows is what decides). There is no Playwright
        waiter for "no fetch since X" on a single-page app -- wait_for_load_state('networkidle')
        answers for the DOCUMENT, which settled long ago -- so this polls, and each poll is a
        wait_for_timeout, which is also what delivers the request events to the handlers above."""
        quiet_ms = QUIET_MS if quiet_ms is None else quiet_ms
        timeout_s = QUIET_TIMEOUT_S if timeout_s is None else timeout_s
        deadline = time.monotonic() + timeout_s
        while True:
            if self.inflight == 0 and (time.monotonic() - self.last) * 1000 >= quiet_ms:
                return True
            if time.monotonic() >= deadline:
                return False
            pg.wait_for_timeout(50)


def _dump(pg, op_id: str, rnd: int, dumps_dir: Path) -> tuple[dict, str]:
    """Take the dump and write it at once (R-RAW), before anything reads it."""
    text = pg.evaluate("([app, op]) => window.__uctBench.dump(app, op)", [AUTO_APP, op_id])
    name = f"{AUTO_APP}__{op_id}__r{rnd}.json"
    (dumps_dir / name).write_text(text + "\n", encoding="utf-8")
    return json.loads(text), name


def run_live(base: str, corpus_dir: Path, manifest: dict, dumps_dir: Path) -> dict:
    from playwright.sync_api import sync_playwright
    out: dict = {"self_tests": [], "ops": {}, "page_errors": [], "count": {}}
    steps = plan(manifest)
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        out["chromium"] = br.version
        admin_ctx = br.new_context()
        ctx = br.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce")
        provision(admin_ctx.request, ctx.request, base)
        ids = seed(ctx.request, base, corpus_dir, manifest)
        api_total = ctx.request.get(base + "/api/j2/notes?limit=1").json().get("total")
        ctx.add_init_script(path=str(PROBE_FILE))
        clipboard_error = None
        try:
            ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=base)
        except Exception as e:  # noqa: BLE001 -- recorded; H8 then reads INCONCLUSIVE
            clipboard_error = f"clipboard permissions could not be granted: {type(e).__name__}: {str(e)[:200]}"
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: out["page_errors"].append(str(e)[:300]))
        traffic = _Traffic(pg)                    # for the page's whole life, so no request is missed

        def grid() -> None:
            pg.goto(base + "/journal/notebook?view=all")
            h._dismiss_intro(pg)
            pg.locator(GRID_CARD).first.wait_for(state="visible", timeout=60000)

        def self_test(where: str) -> dict:
            r = pg.evaluate("() => window.__uctBench.selfTest()")
            r = dict(r, where=where)
            out["self_tests"].append(r)
            if not r.get("ok"):
                raise SelfTestFailed(f"selfTest {where}: {r.get('ms')} ms, outside {r.get('window')}")
            return r

        grid()
        shown = pg.get_by_text(re.compile(r"Showing \d+ of \d+ notes?")).first
        shown.wait_for(state="visible", timeout=60000)
        m = re.search(r"of (\d+) note", shown.inner_text())
        ui_total = int(m.group(1)) if m else None
        out["count"] = {"manifest": manifest["counts"]["total_notes"], "api_total": api_total, "ui_total": ui_total}
        if api_total != manifest["counts"]["total_notes"] or ui_total != manifest["counts"]["total_notes"]:
            raise h.SetupFailed(f"note count: the manifest says {manifest['counts']['total_notes']}, the API says "
                                f"{api_total}, the page says {ui_total}")
        out["self_test"] = self_test("step 0, before any timing (R-HON)")

        for step in steps:
            op_dumps: list[dict] = []
            names: list[str] = []
            failure = None
            try:
                if step["kind"] == "paste" and clipboard_error:
                    raise OpInconclusive(clipboard_error)
                for rnd in range(1, step["rounds"] + 1):
                    d, name = _drive(pg, step, rnd, ids, corpus_dir, grid, self_test, dumps_dir, traffic=traffic)
                    op_dumps.append(d)
                    names.append(name)
            except OpInconclusive as e:
                failure = str(e)
            except SelfTestFailed as e:
                failure = f"withheld: {e}"
            except Exception as e:  # noqa: BLE001 -- the op is INCONCLUSIVE with its sentence; the run goes on
                failure = f"the op raised {type(e).__name__}: {_first_lines(e)}"
                _shot(pg, dumps_dir / f"{step['id']}-failure.png")
            # No print here: the sandbox's integrity verdict must be this run's FIRST output line,
            # and it cannot be known until the sandbox has stopped. Progress goes to stderr.
            out["ops"][step["id"]] = {"dumps": op_dumps, "names": names, "failure": failure}
            print(f"  [{step['id']}] {len(op_dumps)} dump(s)" + (f" -- {failure}" if failure else ""),
                  file=sys.stderr, flush=True)
        br.close()
    return out


def _first_lines(e: Exception, n: int = 4) -> str:
    """The error's first lines, the Playwright call log included (it names the locator that
    waited). Run 1 kept one line and could not say which wait timed out."""
    return " | ".join(x.strip() for x in str(e).splitlines() if x.strip())[:600] if n else ""


def _shot(pg, path: Path) -> None:
    try:
        pg.screenshot(path=str(path))
    except Exception:  # noqa: BLE001 -- a missing screenshot never hides the failure it illustrates
        pass


class OpInconclusive(Exception):
    """This op cannot be measured honestly (its sentence says why); the run goes on."""


class SelfTestFailed(Exception):
    """R-HON: a failed selfTest withholds what it underwrites."""


def _drive(pg, step: dict, rnd: int, ids: dict, corpus_dir: Path, grid, self_test, dumps_dir: Path,
           traffic: _Traffic | None = None):
    kind = step["kind"]
    if kind == "cold":
        pg.goto(pg.url.split("?")[0] + "?view=all")
        pg.locator(GRID_CARD).first.wait_for(state="visible", timeout=60000)
        pg.evaluate("() => window.__uctBench.arm('cold')")          # BEFORE any input finalises LCP
        self_test(f"{step['id']} round {rnd}, after the reload")
        d = _dump(pg, step["id"], rnd, dumps_dir)
        h._dismiss_intro(pg)
        return d
    grid()
    self_test(f"{step['id']} round {rnd}")
    if kind == "open":
        card = pg.locator(card_selector(ids[step["note_key"]]))
        card.wait_for(state="visible", timeout=30000)
        if pg.evaluate("m => window.__uctBench.has(m)", step["marker"]):
            raise OpInconclusive(f"the marker is in the page before the first rep ({step['marker']})")
        pg.evaluate("o => window.__uctBench.arm('open', o)", arm_options(step))
        for k in range(1, step["reps_per_round"] + 1):
            card.click()
            _wait_attempts(pg, k)
            pg.go_back()
            card.wait_for(state="visible", timeout=30000)
        return _dump(pg, step["id"], rnd, dumps_dir)
    if kind == "search":
        pg.evaluate("o => window.__uctBench.arm('search', o)", arm_options(step))
        if step["target"] == "rare":
            pg.get_by_role("tab", name="Search notes").click()
            box = pg.get_by_label("Search your notes")
            for k in range(1, step["reps_per_round"] + 1):
                box.click()
                pg.keyboard.type(step["query"], delay=SEARCH_KEY_DELAY_MS)
                _wait_attempts(pg, k)
                pg.keyboard.press("Escape")                              # clears the query
                pg.wait_for_function("t => !window.__uctBench.has(t)", arg=step["expected_title"], timeout=30000)
        else:
            for k in range(1, step["reps_per_round"] + 1):
                pg.keyboard.press("Control+K")
                pg.get_by_label("Search a security, company, or note").wait_for(state="visible", timeout=15000)
                pg.keyboard.type(step["query"], delay=SEARCH_KEY_DELAY_MS)
                _wait_attempts(pg, k)
                pg.keyboard.press("Escape")                              # closes the palette
                pg.wait_for_function("t => !window.__uctBench.has(t)", arg=step["expected_title"], timeout=30000)
        return _dump(pg, step["id"], rnd, dumps_dir)
    if kind == "typing":
        pg.locator(card_selector(ids[step["note_key"]])).click()
        pg.wait_for_function("m => window.__uctBench.has(m)", arg=step["last_marker"], timeout=60000)
        pg.locator(".ProseMirror p").first.click()
        pg.keyboard.press("Control+End")                                 # the caret at the end: a real key
        pg.evaluate("o => window.__uctBench.arm('typing', o)", arm_options(step))
        pg.keyboard.type("x" * step["chars_per_round"], delay=TYPE_DELAY_MS)
        try:
            pg.wait_for_function("n => window.__uctBench.status().samples >= n", arg=step["chars_per_round"],
                                 timeout=5000)
        except Exception:  # noqa: BLE001 -- a shortfall is recorded by the dump as INCONCLUSIVE
            pass
        d = _dump(pg, step["id"], rnd, dumps_dir)
        pg.go_back()
        return d
    if kind == "paste":
        html = (corpus_dir / "paste-payload.html").read_text(encoding="utf-8")
        plain = (corpus_dir / "paste-payload.txt").read_text(encoding="utf-8")
        pg.bring_to_front()
        wrote = pg.evaluate("""async ([html, plain]) => {
            try {
              await navigator.clipboard.write([new ClipboardItem({
                'text/html': new Blob([html], {type: 'text/html'}),
                'text/plain': new Blob([plain], {type: 'text/plain'})})])
              const items = await navigator.clipboard.read()
              return items.some((i) => i.types.includes('text/html')) ? 'ok' : 'written, but no text/html read back'
            } catch (e) { return String(e && (e.name + ': ' + e.message) || e) }
        }""", [html, plain])
        if wrote != "ok":
            raise OpInconclusive(f"the clipboard write failed ({wrote}); never a synthetic ClipboardEvent")
        pg.evaluate("o => window.__uctBench.arm('paste', o)", arm_options(step))
        traffic = traffic or _Traffic(pg)
        for k in range(1, step["reps_per_round"] + 1):
            traffic.quiet(pg)                                            # a person's pause (_Traffic)
            before = pg.url
            pg.locator('[data-tour="new-note"]').first.click()
            try:
                pg.wait_for_url(lambda url: url != before and "note=" in url, timeout=CREATE_TIMEOUT_S * 1000)
            except Exception as e:  # noqa: BLE001 -- the sentence below is the finding
                raise OpInconclusive(f"rep {k}: '+ New note' was clicked and no note opened within "
                                     f"{CREATE_TIMEOUT_S:g} s (the URL stayed {before.split('?')[-1]!r}); "
                                     f"nothing was pasted") from e
            pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
            pg.locator(".ProseMirror").first.click()
            pg.keyboard.press("Control+V")
            _wait_attempts(pg, k)
            pg.go_back()
            pg.locator(GRID_CARD).first.wait_for(state="visible", timeout=30000)
        return _dump(pg, step["id"], rnd, dumps_dir)
    raise OpInconclusive(f"no driver for kind {kind!r}")


# ── the summary ───────────────────────────────────────────────────────────────────────────────

def build_summary(*, git_head, base, corpus_info, machine, integrity, live, failure=None) -> dict:
    per_op = {}
    if live is not None:
        for op in rep.OPS:
            got = live["ops"].get(op["id"], {"dumps": [], "names": [], "failure": "never reached"})
            paths = [f"{live['dumps_rel']}/{n}" for n in got["names"]]
            per_op[op["id"]] = summarize_op(op, got["dumps"], got["failure"], paths)
    st = (live or {}).get("self_test") or {}
    return {
        "tool": "tools/notebook_bench_uct.py", "git_head": git_head, "base": base,
        "app": AUTO_APP, "certifying": False,
        "note": ("a lane acceptance run and per-release cross-check: NOT certification evidence and NOT the "
                 "UCT column of the head-to-head (ruling D-9A3)"),
        "corpus": corpus_info, "machine": machine, "integrity": integrity,
        "self_test": {"ok": bool(st.get("ok")), "ms": st.get("ms"),
                      "readings": [{"ok": r.get("ok"), "ms": r.get("ms"), "where": r.get("where")}
                                   for r in (live or {}).get("self_tests", [])]},
        "count": (live or {}).get("count"), "chromium": (live or {}).get("chromium"),
        "page_errors": (live or {}).get("page_errors", []),
        "failure": failure,
        "per_op": per_op,
    }


def _measure(args, manifest: dict, corpus_dir: Path, home: Path, stem: str):
    """Boot, run, stop. Returns (integrity, live, failure, not_run, note). Late-bound for the rails."""
    box = h.Sandbox(args.data_dir, args.port, home / f"{stem}.sandbox.log")
    base = f"http://127.0.0.1:{args.port}"
    live, failure, not_run = None, None, None
    dumps_dir = home / f"{stem}-dumps"
    dumps_dir.mkdir(parents=True, exist_ok=True)
    box.start()
    try:
        if not box.wait_healthy(base, 240):
            failure = "the sandbox never answered /api/health"
        else:
            try:
                live = run_live(base, corpus_dir, manifest, dumps_dir)
                live["dumps_rel"] = dumps_dir.name
            except h.SetupFailed as e:
                not_run = str(e)[:300]
            except SelfTestFailed as e:
                failure = f"R-HON: {e} -- every timing is withheld"
            except Exception as e:  # noqa: BLE001 -- recorded; the sandbox is still stopped
                failure = f"the live run raised {type(e).__name__}: {str(e).splitlines()[0][:300]}"
            box.wait_checkpoint(h.POST_BOOT, h.POST_BOOT_WAIT_S)
    finally:
        box.stop()
    integ = h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
    note = f"stop: {box.stop_how}; launcher output: {box.log_path}"
    return integ, live, failure, not_run, note


def dry_run(corpus_dir: Path | None = None) -> int:
    """No browser, no sandbox, no lock. With --corpus, also print the exact console lines the owner
    pastes for that corpus (the same arm_options this runner uses)."""
    version = rep.probe_version()
    src = PROBE_FILE.read_text(encoding="utf-8")
    assert "window.__uctBench" in src and not re.search(r"^\s*(import|export)\s", src, re.M), "the probe is not self-contained"
    mpath = (corpus_dir / corpus_tool.MANIFEST_NAME) if corpus_dir else COMMITTED_MANIFEST
    manifest = json.loads(mpath.read_text(encoding="utf-8"))
    steps = plan(manifest)
    if corpus_dir:
        print(f"CONSOLE LINES for the corpus at {corpus_dir} (probe {version}):")
        for s in steps:
            what = f"; type: {s['query']}" if s["kind"] == "search" else ""
            print(f"\n## {s['id']} -- {s['what']}{what}")
            for line in console_lines(s):
                print(f"    {line}")
        print("")
    assert [s["id"] for s in steps] == [o["id"] for o in rep.OPS]
    for s in steps:
        need = {"open": ("marker", "anchor", "note_key"), "search": ("expected_title", "query"),
                "typing": ("note_key", "last_marker"), "paste": ("end_marker",), "cold": ()}[s["kind"]]
        assert all(s.get(k) for k in need), f"{s['id']}: the plan lacks {need}"
        print(f"  {s['id']:<8} {s['kind']:<6} {s['rounds']} round(s) x "
              f"{s.get('reps_per_round') or s.get('chars_per_round')}  {s['what']}")
    stub = {"samples": [10.0 + i for i in range(20)], "invalid": [], "expectKeys": 60}
    live = {"ops": {}, "dumps_rel": "dry-dumps", "self_test": {"ok": True, "ms": 201.0}, "self_tests": []}
    for op in rep.OPS:
        n = op["rounds"]
        if op["kind"] == "typing":
            dumps = [dict(stub, samples=[5.0] * 60) for _ in range(n)]
        else:
            dumps = [dict(stub) for _ in range(n)]
        live["ops"][op["id"]] = {"dumps": dumps, "names": [f"x__{op['id']}__r{i}.json" for i in range(n)], "failure": None}
    live["ops"]["H8"]["failure"] = "the clipboard write failed (dry run); never a synthetic ClipboardEvent"
    live["ops"]["H7"]["dumps"][1] = dict(stub, samples=[5.0] * 58)
    summary = build_summary(git_head="dry", base="dry", corpus_info={}, machine={},
                            integrity={"status": "CLEAN"}, live=live)
    problems = rep.validate_summary(summary)
    assert problems == [], problems
    assert summary["per_op"]["H1"]["status"] == "MEASURED"
    assert summary["per_op"]["H8"]["status"] == "INCONCLUSIVE" and summary["per_op"]["H8"]["p50_ms"] is None
    assert summary["per_op"]["H7"]["status"] == "INCONCLUSIVE" and "short of keys" in summary["per_op"]["H7"]["reason"]
    home = r"C:\data" if os.name == "nt" else "/data"
    assert h.refuse_shared_root(home) and h.refuse_shared_root(home + "-w9bench") is None
    assert MEMORY_FLOOR_MB == gate_box_sampler.FREE_MEMORY_FLOOR_GB * 1024
    print(f"DRY RUN: probe {version}; {len(steps)} ops planned from the committed manifest; the summary "
          "validates against the report's schema; a short typing round and a failed clipboard read INCONCLUSIVE")
    return 0


def _git_head() -> str | None:
    return subprocess.run(["git", "-C", str(REPO), "rev-parse", "HEAD"], capture_output=True,
                          text=True).stdout.strip() or None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--boot", action="store_true", help="start scripts/hub_sandbox_boot.py (the only mode)")
    ap.add_argument("--data-dir", default=None)
    ap.add_argument("--port", type=int, default=8096)
    ap.add_argument("--corpus", default=None, help="a corpus directory written by tools/notebook_bench_corpus.py")
    ap.add_argument("--json", dest="json_path", default=None, help="the summary JSON; dumps go beside it")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    if args.dry_run:
        return dry_run(Path(args.corpus) if args.corpus else None)
    if not args.boot or not args.data_dir or not args.corpus or not args.json_path:
        return refusal("pass --boot, --data-dir, --corpus and --json (or --dry-run)")
    why = h.refuse_shared_root(args.data_dir)
    if why:
        return refusal(why)
    if h.port_busy(args.port):
        return refusal(f"port {args.port} already has a listener; find it with "
                       f"`Get-NetTCPConnection -LocalPort {args.port}` -- this runner never kills it")
    # ⛔ THE BOX FIRST. A live holder is somebody's measurement; a low box measures the box.
    st = box_status()
    if st.get("state") == "HELD":
        return refusal(f"the box is held: {gate_box_lock.describe(st['holder'])}")
    mb = available_mbytes()
    if mb is None:
        return refusal("Memory\\Available MBytes could not be read (typeperf); an unread counter is not a quiet box")
    if mb < MEMORY_FLOOR_MB:
        return refusal(f"Memory\\Available MBytes is {mb:.0f}, below the floor of {MEMORY_FLOOR_MB:.0f} MB "
                       "(gate_box_sampler.FREE_MEMORY_FLOOR_GB, the owner-ruled floor for heavy runs)")
    corpus_dir = Path(args.corpus)
    problems = corpus_tool.verify(corpus_dir)
    if problems:
        return refusal(f"the corpus at {corpus_dir} does not verify: {problems[0]}")
    manifest = json.loads((corpus_dir / corpus_tool.MANIFEST_NAME).read_text(encoding="utf-8"))
    run_id = f"notebook-bench-uct-{time.strftime('%Y%m%dT%H%M%S')}"
    try:
        lock = gate_box_lock.acquire(run_id, load=LOAD_PROBE)
    except gate_box_lock.LockHeld as e:
        return refusal(f"the box is held: {e}")
    p = Path(args.json_path).resolve()
    p.parent.mkdir(parents=True, exist_ok=True)
    home, stem = p.parent, p.stem
    machine = {"available_mbytes_before": mb, "floor_mbytes": MEMORY_FLOOR_MB,
               "box_state": st.get("state"), "box_load": gate_box_sampler.describe_load(st.get("load")),
               "lock": {"acquired": lock.get("acquired"), "path": lock.get("path"), "run_id": run_id,
                        "reclaimed": lock.get("reclaimed")},
               "hostname": socket.gethostname(), "python": sys.version.split()[0]}
    try:
        integ, live, failure, not_run, note = _measure(args, manifest, corpus_dir, home, stem)
    except Exception as e:  # noqa: BLE001 -- still reported, and the lock is still released
        integ = h.read_integrity(None, [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
        live, failure, not_run, note = None, f"the run raised {type(e).__name__}: {str(e)[:300]}", None, ""
    finally:
        released = gate_box_lock.release()
    machine["available_mbytes_after"] = available_mbytes()
    machine["lock"]["released"] = released
    h._keep_integrity_log(integ, home / f"{stem}.integrity.md", own=True)
    print(h.integrity_line(integ, note, not_run=not_run))            # ⛔ FIRST, before any number
    corpus_info = {"dir": str(corpus_dir), "generator_version": manifest.get("generator_version"),
                   "seed": manifest.get("seed"), "total_notes": manifest["counts"]["total_notes"], "verified": True}
    withheld = (not_run is not None) or (not integ["clean"]) or bool(failure) or live is None
    summary = build_summary(git_head=_git_head(), base=f"http://127.0.0.1:{args.port}", corpus_info=corpus_info,
                            machine=machine, integrity=integ, live=None if withheld else live,
                            failure=not_run or failure)
    if withheld:
        summary["timings"] = "WITHHELD"
    p.write_text(json.dumps(summary, indent=1) + "\n", encoding="utf-8")
    if not_run:
        print(f"VERDICT: NOT RUN -- the measurement could not start: {not_run}")
        return 3
    if withheld:
        why = "; ".join([f"sandbox integrity is {integ['status']}"] * (not integ["clean"])
                        + [failure] * bool(failure)) or "nothing was measured"
        print(f"VERDICT: INCONCLUSIVE -- every timing withheld: {why}")
        return 2
    rows = summary["per_op"]
    for op_id, rec in rows.items():
        line = (f"{rec['n']:>4} samples  p50 {rec['p50_ms']} ms  p95 {rec['p95_ms']} ms" if rec["status"] == "MEASURED"
                else f"INCONCLUSIVE -- {rec['reason']}")
        print(f"  {op_id:<8} {line}")
    bad = [k for k, v in rows.items() if v["status"] != "MEASURED"]
    if bad:
        print(f"VERDICT: INCONCLUSIVE -- {len(bad)} of {len(rows)} op(s): {', '.join(bad)} (summary: {p})")
        return 2
    print(f"VERDICT: MEASURED -- all {len(rows)} ops (summary: {p}); a lane acceptance run, not the "
          "head-to-head's UCT column (D-9A3)")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except AttributeError:
        pass
    sys.exit(main())
