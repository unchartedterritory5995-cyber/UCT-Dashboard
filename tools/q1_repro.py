"""⛔⛔ R-10 — INSTRUMENTED REPRODUCTION OF THE WAVE Q1 SELF-FORK (ROUND 3).

⚰️ WHY THIS EXISTS. jsdom cannot construct the ordering. The rail that mounts the
real editor AND the real drain together — the first in this repo to do so — is
green on current code and STILL green with round 2's `|| saved` defect
reintroduced (`doorsThroughTheEditor.property.test.jsx`). A fixture that cannot
tell fixed code from broken code is not a rail, so the reproduction has to happen
on the instrument that actually caught this three times: a real browser, on the
real deployed bundle, against a real account.

⛔⛔ THIS TOOL WRITES. It creates a note on the canary account, types into it,
fires a metadata door, and reconnects. It is NOT the daily check — the scheduled
task stays on `--no-canary` reads-only until the fix is live (owner ruling R-10).
Nothing here touches a member account, and the account it does touch is the rig's
own.

⭐ ONE ORDERING PER RUN, NAMED. A run that varies three things at once cannot say
which one mattered. The orderings are R-10's list, in its order:

    canary          the canary's own ordering, no Restore          (baseline)
    canary-restore  the same, but the draft banner is RESTORED     (control)
    unmount         the member navigates away while sends are up
    inflight-N      N body sends already on the wire when the door lands (1..5)

⛔ THE RED IS THE SENTENCE, NOT THE STEP. Every ordering asks exactly one
question: is the sentence this run typed OFFLINE, IN THE BODY, present in the
server's body afterwards — and did the note count stay put. "The server holds
text" is satisfied by the words typed online and reads green through the exact
failure this hunts; it is not asked here.

⛔ ARTIFACTS ARE PRESERVED ON A FINDING. A run that goes red leaves its note, its
conflicted copy and its JSON record alone. Only a clean run cleans up
(`should_clean_up`, shared with the daily check so the two cannot disagree).

Usage:
    python tools/q1_repro.py --ordering canary
    python tools/q1_repro.py --ordering inflight-3
    python tools/q1_repro.py --all            # every ordering, stops on the first red
    python tools/q1_repro.py --self-check     # no browser, no writes
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import window_check as wc  # noqa: E402  the rig machinery has ONE owner

OUT = pathlib.Path(__file__).resolve().parents[1] / "docs" / "notebook" / "wave-q1-repro"

ORDERINGS = ("canary", "canary-restore", "unmount",
             "inflight-1", "inflight-2", "inflight-3", "inflight-4", "inflight-5")


def inflight_count(ordering: str) -> int:
    """How many body sends this ordering puts on the wire before the door.

    ⛔ Derived from the name, never typed twice — `inflight-3` and "3" disagreeing
    is the second-authority defect this repo keeps paying for."""
    if not ordering.startswith("inflight-"):
        return 0
    try:
        return int(ordering.split("-", 1)[1])
    except (ValueError, IndexError):
        return 0


def wants_restore(ordering: str) -> bool:
    return ordering == "canary-restore"


def wants_unmount(ordering: str) -> bool:
    return ordering == "unmount"


class Repro:
    """One ordering's record. Everything measured, nothing inferred."""

    def __init__(self, ordering: str):
        self.ordering = ordering
        self.started = wc.utc_now()
        self.sentence = wc.offline_sentence(self.started)
        self.note_id = None
        self.door = None
        self.steps: list[dict] = []
        self.findings: list[str] = []
        self.revisions: list[dict] = []      # every server revision this run saw
        self.puts: list[dict] = []           # every PUT, with body and headers
        self.layers: dict = {}               # outbox/record/draft at each phase
        self.landed = None                   # THE question
        self.notes_before = None
        self.notes_after = None
        self.error = None
        # ⛔ R-13: correlate each response to ITS request. An instrument that
        # records requests without responses cannot establish a causal chain —
        # "which PUT landed and which 409'd" was pure inference on the first
        # reproduction, and inference is not evidence.
        self._by_request = {}

    def step(self, name: str, ok: bool, detail: str = "") -> None:
        self.steps.append({"step": name, "ok": bool(ok), "detail": detail})
        print(f"  {'ok  ' if ok else 'RED '} {name}" + (f" — {detail}" if detail else ""), flush=True)

    @property
    def red(self) -> bool:
        return bool(self.findings) or self.landed is False or self.error is not None

    def to_json(self) -> dict:
        return {
            "ordering": self.ordering, "started": self.started, "sentence": self.sentence,
            "noteId": self.note_id, "door": self.door, "landed": self.landed,
            "notesBefore": self.notes_before, "notesAfter": self.notes_after,
            "steps": self.steps, "findings": self.findings,
            "revisions": self.revisions, "puts": self.puts, "layers": self.layers,
            "error": self.error,
        }


# ── the PUT recorder — body AND headers, which the daily check does not keep ──
def _record_put(rec: Repro, r) -> None:
    if r.method != "PUT" or "/api/j2/notes/" not in r.url:
        return
    try:
        body = r.post_data
    except Exception:  # noqa: BLE001
        body = None
    parsed = None
    if body:
        try:
            parsed = json.loads(body)
        except Exception:  # noqa: BLE001
            parsed = {"unparseable": True}
    entry = {
        "seq": len(rec.puts),
        "at": wc.utc_now(),
        "url": r.url,
        # ⛔ The BODY question, per key: did this PUT carry a body at all, and did
        # it carry a baseline? The three metadata doors carry neither, which is
        # the whole mechanism under suspicion.
        "keys": sorted(parsed.keys()) if isinstance(parsed, dict) else None,
        "carriedBody": isinstance(parsed, dict) and "bodyJson" in parsed,
        "baseUpdatedAt": (parsed or {}).get("baseUpdatedAt", "<absent>") if isinstance(parsed, dict) else "<unread>",
        "sentenceInPut": bool(body and rec.sentence in body),
        # filled in by the response handler; `None` means the response never
        # arrived, which is itself a fact worth keeping.
        "status": None, "responseUpdatedAt": None, "responseDetail": None,
    }
    rec._by_request[r] = entry
    rec.puts.append(entry)


def _record_response(rec: Repro, resp) -> None:
    """⛔ R-13 — the other half of the wire. Status decides whether a PUT LANDED
    or 409'd, and the response's `updatedAt` is the revision it produced. Without
    both, the chain "door lands (T2) → body PUT on T1 → 409 → what the client did
    with it" is a story rather than a measurement."""
    entry = rec._by_request.get(resp.request)
    if entry is None:
        return
    entry["status"] = resp.status
    try:
        body = resp.json()
    except Exception:  # noqa: BLE001
        body = None
    if isinstance(body, dict):
        note = body.get("note") if isinstance(body.get("note"), dict) else body
        if isinstance(note, dict) and isinstance(note.get("updatedAt"), str):
            entry["responseUpdatedAt"] = note["updatedAt"]
        # a refusal explains itself in `detail`; keep it, it is not member content
        if isinstance(body.get("detail"), str):
            entry["responseDetail"] = body["detail"][:200]


def run_ordering(ordering: str, keep_open: bool = False, run_index: int = 0) -> Repro:
    from playwright.sync_api import sync_playwright

    rec = Repro(ordering)
    print(f"\n══ ordering `{ordering}` ══  sentence: {rec.sentence}", flush=True)

    proc, endpoint, version = wc.spawn_rig()
    if not version:
        rec.error = "CDP endpoint never answered"
        rec.step("rig", False, rec.error)
        wc.teardown()
        return rec
    rec.step("rig", True, f"PID {proc.pid} · {version['Browser']}")

    page = None
    opted_in = False
    try:
        with sync_playwright() as pw:
            b = pw.chromium.connect_over_cdp(endpoint)
            ctx = b.contexts[0]
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            cdp = page.context.new_cdp_session(page)
            cdp.send("Network.enable")
            offline = wc._offliner(cdp)
            offline(False)

            page.goto(wc.PROD + "/journal/notebook", wait_until="domcontentloaded")
            page.wait_for_timeout(6000)
            me = page.evaluate(wc.AUTH_JS)
            if me.get("status") != 200 or me.get("id") != wc.ACCOUNT_ID:
                ok, detail = wc.reauthenticate(page)
                page.goto(wc.PROD + "/journal/notebook", wait_until="domcontentloaded")
                page.wait_for_timeout(5000)
                me = page.evaluate(wc.AUTH_JS)
            if me.get("status") != 200 or me.get("id") != wc.ACCOUNT_ID:
                rec.error = f"/api/auth/me returned {me.get('status')} — SIGN-IN REQUIRED (H5)"
                rec.step("signed in", False, rec.error)
                return rec
            rec.step("signed in", True, f"account {me.get('id')}")

            # ⛔⛔ OPT IN, OR THE WHOLE RUN IS VACUOUS. The layer ships DARK
            # (`OFFLINE_DEFAULT_ON = false`) and the rig opts itself back out at
            # the end of every run, so a browser arriving here is opted OUT: no
            # durable record, no outbox, nothing for a door to invalidate.
            # ⚰️ The first run of this tool skipped this and the non-vacuity gate
            # caught it — `outbox 0 · dirty None` — rather than reporting a green.
            # ⭐ FLAG_KEY, never the string spelled a second time: window_check
            # already paid for two authorities over this one value.
            page.evaluate("(k) => localStorage.setItem(k, '1')", wc.FLAG_KEY)
            rec.step("opted in", True, f"{wc.FLAG_KEY} = '1'")
            opted_in = True

            page.on("request", lambda r: _record_put(rec, r))
            page.on("response", lambda resp: _record_response(rec, resp))

            nt0 = page.evaluate(wc.NOTES_JS)
            rec.notes_before = nt0.get("total") if isinstance(nt0, dict) else None
            # ⛔⛔ THE FORKS THAT WERE ALREADY THERE ARE NOT THIS RUN'S.
            # ⚰️ The first armed run reported a fork and it was the PRESERVED
            # ROUND-3 EVIDENCE (`…00:00:56Z (conflicted copy)`), deliberately kept
            # on this account by owner ruling. A detector that counts the evidence
            # of the last finding reports a finding on every run forever, which is
            # a rail that cannot distinguish — the exact defect this wave keeps
            # paying for. Baseline the set, and report only what THIS run added.
            forks_before = set(nt0.get("conflicts") or []) if isinstance(nt0, dict) else set()
            rec.layers["forksBefore"] = sorted(forks_before)

            created = page.evaluate("""async (t) => {
                const r = await fetch('/api/j2/notes', {method:'POST', credentials:'include',
                  headers:{'Content-Type':'application/json'},
                  body: JSON.stringify({title: t, bodyJson: {type:'doc', content:[]}})});
                if (!r.ok) return {ok:false, status:r.status};
                const b = await r.json();
                return {ok:true, id: b.note?.id ?? b.id};
            }""", f"{wc.SENTINEL} repro {ordering} {rec.started}")
            if not created.get("ok"):
                rec.error = f"could not create the note ({created.get('status')})"
                rec.step("create a fresh note", False, rec.error)
                return rec
            rec.note_id = created["id"]
            rec.step("create a fresh note", True, rec.note_id)

            page.goto(f"{wc.PROD}/journal/notebook?note={rec.note_id}", wait_until="domcontentloaded")
            page.wait_for_timeout(6000)

            # ── 1. online words, so the queued entry has a real baseline ──────
            pm = page.query_selector(".ProseMirror")
            if pm:
                pm.click()
                page.keyboard.type(f"{wc.SENTINEL} typed online.")
            page.wait_for_timeout(6000)
            online_puts = len(rec.puts)
            rec.step("one CAS PUT while online", online_puts >= 1, f"{online_puts} PUT(s)")

            # ── 2. offline, and the sentence goes in the BODY ────────────────
            offline(True)
            page.wait_for_timeout(1000)
            probe = page.evaluate(wc.PROBE)
            rec.step("offline is real", probe.startswith("FAILED"), probe)
            pm = page.query_selector(".ProseMirror")
            if pm:
                pm.click()
                page.keyboard.press("End")
                page.keyboard.type(" " + rec.sentence)
            page.wait_for_timeout(6000)
            rec.layers["offline"] = page.evaluate(wc.LAYERS_JS, {"acct": wc.ACCOUNT_ID, "id": rec.note_id})

            ob = wc._as_list(rec.layers["offline"].get("outbox"))
            dirty = (rec.layers["offline"].get("record") or {}).get("dirty")
            # ⛔ NON-VACUITY. If nothing is queued and nothing is dirty there is no
            # work for a door to discard, and every assertion after this is an
            # assertion over an empty set.
            rec.step("there IS queued work for the door to invalidate",
                     bool(ob) or bool(dirty), f"outbox {len(ob)} · dirty {dirty}")
            if not (ob or dirty):
                rec.error = "VACUOUS: nothing queued and nothing dirty before the door"
                return rec

            # ── 3. back online; put N body sends on the wire if asked ────────
            offline(False)
            n = inflight_count(ordering)
            for i in range(n):
                pm = page.query_selector(".ProseMirror")
                if pm:
                    pm.click()
                    page.keyboard.press("End")
                    page.keyboard.type(f" s{i}")
                page.wait_for_timeout(200)      # deliberately INSIDE the debounce
            if n:
                rec.step(f"{n} body send(s) put on the wire", True, "typed inside the debounce window")

            # ── 4. THE DOOR ─────────────────────────────────────────────────
            # ⛔ R-18: the door rotates across RUNS, not within one. It was
            # `door_for(len(rec.steps))`, and the step count is the same every
            # run, so three "independent" reproductions all fired `ticker` and
            # I reported them as a rate. A sample that never varies the variable
            # it claims to sample is one observation repeated.
            rec.door = wc.door_for(run_index)
            sends_before = len(rec.puts) - online_puts
            dr = page.evaluate(wc.DOOR_JS, {"id": rec.note_id, "patch": wc.DOOR_PATCH[rec.door]})
            if not isinstance(dr, dict):
                dr = {"status": None, "before": None, "after": None}
            moved = (dr.get("status") == 200 and isinstance(dr.get("after"), str)
                     and dr.get("after") != dr.get("before"))
            rec.step(f"door `{rec.door}` moved the baseline", moved,
                     f"{dr.get('before')} → {dr.get('after')} · sends that beat it: {sends_before}")
            rec.revisions.append({"phase": "door", **dr, "sendsBeforeDoor": sends_before})

            # ── 5. the ordering's own twist ─────────────────────────────────
            if wants_unmount(ordering):
                # the note leaves excludeNoteId while work is on the wire
                page.goto(wc.PROD + "/journal/notebook", wait_until="domcontentloaded")
                rec.step("navigated away while sends were up", True, "note left excludeNoteId")

            page.wait_for_timeout(1500)
            page.goto(f"{wc.PROD}/journal/notebook?note={rec.note_id}", wait_until="domcontentloaded")
            page.wait_for_timeout(8000)

            if wants_restore(ordering):
                # ⭐ THE CONTROL. `restoreDraft` is the OTHER save path, and it is
                # the one carrying `captureLocalState() || ackedNow`. If the
                # baseline ordering is green and this one is red, the restore path
                # is where the defect lives.
                clicked = page.evaluate("""() => {
                    const b = [...document.querySelectorAll('button')]
                      .find(x => /restore/i.test(x.textContent || ''));
                    if (!b) return false; b.click(); return true;
                }""")
                rec.step("draft banner RESTORED", bool(clicked),
                         "clicked" if clicked else "no Restore button was offered")
                page.wait_for_timeout(6000)

            rec.layers["reload"] = page.evaluate(wc.LAYERS_JS, {"acct": wc.ACCOUNT_ID, "id": rec.note_id})

            # ── 6. let the drain settle, then ask the ONE question ──────────
            page.goto(wc.PROD + "/journal/notebook", wait_until="domcontentloaded")
            page.wait_for_timeout(12000)
            settled = page.evaluate(wc.LAYERS_JS, {"acct": wc.ACCOUNT_ID, "id": rec.note_id})
            rec.layers["settled"] = settled
            srv = settled.get("server") if isinstance(settled.get("server"), dict) else {}
            rec.revisions.append({"phase": "settled", "updatedAt": srv.get("updatedAt")})

            rec.landed = rec.sentence in wc._doc_text(srv.get("bodyJson"))
            rec.step("⛔ THE SENTENCE IS IN THE SERVER BODY", rec.landed,
                     "" if rec.landed else "THE OFFLINE SENTENCE IS GONE — round 3 reproduced")
            if not rec.landed:
                rec.findings.append(
                    f"`{ordering}` — the server body does not contain the offline sentence "
                    f"(door `{rec.door}`, {sends_before} send(s) beat it)")

            nt1 = page.evaluate(wc.NOTES_JS)
            rec.notes_after = nt1.get("total") if isinstance(nt1, dict) else None
            forks_after = set(nt1.get("conflicts") or []) if isinstance(nt1, dict) else set()
            new_forks = sorted(forks_after - forks_before)
            if new_forks:
                rec.findings.append(f"`{ordering}` — a single-writer session forked: {new_forks}")
            rec.step("no NEW single-writer fork", not new_forks,
                     f"{len(forks_before)} pre-existing (preserved evidence) · {len(new_forks)} new")

    except Exception as e:  # noqa: BLE001
        rec.error = f"{type(e).__name__}: {e}"
        rec.step("run completed", False, rec.error)
    finally:
        # ⛔ EVERY exit opts back out: the happy path, the early returns, and any
        # exception on its way through. Preserving evidence and staying opted in
        # are two different decisions — the note and the stores are evidence and
        # survive; the browser's opt-in is RIG STATE, and leaving it set silently
        # changes what the next run measures.
        if opted_in and page is not None:
            try:
                ok, got = wc.opt_out(page)
                # ⛔ THE READ-BACK IS NOT THE AUTHORITY, and treating it as one
                # raised a false alarm on the first armed run: it read
                # `ERR: Error` (the page was mid-navigation) while the value had
                # in fact reached disk — `window_check --no-canary` then read the
                # key back as '0'. window_check's own comment says so: the
                # authority is teardown's on-disk check with Chrome DEAD.
                # So this REPORTS rather than finds, and names how to settle it.
                rec.step("opted back out", ok,
                         f"read back {got!r}" if ok else
                         f"read back {got!r} — in-memory only; confirm with `window_check.py --no-canary`")
                rec.layers["optOutReadBack"] = got
            except Exception as e:  # noqa: BLE001
                rec.findings.append(f"opt-out failed: {type(e).__name__}")
        if not keep_open:
            wc.teardown()
    return rec


def write_artifact(rec: Repro) -> pathlib.Path:
    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / f"{rec.started.replace(':', '-')}-{rec.ordering}.json"
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(rec.to_json(), indent=2), encoding="utf-8")
    tmp.replace(p)
    return p


def self_check() -> int:
    bad = 0

    def case(name, ok):
        nonlocal bad
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
        bad += 0 if ok else 1

    case("every ordering name is recognised", all(
        o == "canary" or o == "canary-restore" or o == "unmount" or inflight_count(o) > 0
        for o in ORDERINGS))
    case("inflight-N derives N from its own name, never a second table",
         [inflight_count(f"inflight-{i}") for i in range(1, 6)] == [1, 2, 3, 4, 5])
    case("a non-inflight ordering puts nothing on the wire", inflight_count("canary") == 0)
    case("⛔ a malformed inflight name reports 0 rather than guessing",
         inflight_count("inflight-") == 0 and inflight_count("inflight-x") == 0)
    case("restore is the control, and only the control",
         wants_restore("canary-restore") and not wants_restore("canary"))
    case("unmount is its own ordering", wants_unmount("unmount") and not wants_unmount("canary"))

    r = Repro("canary")
    case("a run with no finding and a landed sentence is GREEN",
         (setattr(r, "landed", True), not r.red)[1])
    r2 = Repro("canary")
    r2.landed = False
    case("⛔ a sentence that did not land is RED even with no other finding", r2.red)
    r3 = Repro("canary")
    r3.landed = True
    r3.findings.append("a fork")
    case("⛔ a fork is RED even when the sentence landed", r3.red)
    r4 = Repro("canary")
    r4.landed = True
    r4.error = "boom"
    case("⛔ an errored run is RED, never quietly green", r4.red)

    case("the shared cleanup rule is the daily check's, not a second copy",
         wc.should_clean_up([]) and not wc.should_clean_up(["a finding"]))
    print("self-check:", "PASS" if not bad else f"FAIL ({bad})")
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ordering", choices=ORDERINGS)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--keep-open", action="store_true")
    # ⛔ R-15: the defect is a RACE — the identical ordering ran green at
    # 02:55:10Z and red at 02:57:30Z. A single green run proves nothing.
    ap.add_argument("--repeat", type=int, default=1,
                    help="run the ordering up to N times, stopping on the first red")
    ap.add_argument("--sample", action="store_true",
                    help="keep going after a red — measure the RATE, do not stop at evidence")
    a = ap.parse_args()

    if a.self_check or (not a.ordering and not a.all):
        return self_check()

    todo = list(ORDERINGS) if a.all else [a.ordering] * max(1, a.repeat)
    reds = []
    greens = 0
    run_i = 0
    for o in todo:
        run_i += 1
        rec = run_ordering(o, keep_open=a.keep_open, run_index=run_i)
        p = write_artifact(rec)
        print(f"  artifact: {p}", flush=True)
        if rec.red:
            reds.append(o)
            print(f"\n⛔ `{o}` WENT RED — artifacts preserved, nothing cleaned.", flush=True)
            for f in rec.findings:
                print(f"   · {f}", flush=True)
            # ⛔ STOP ON THE FIRST RED. It is the jsdom rail's target (R-10), and
            # a second ordering run afterwards would write over the account state
            # that explains the first.
            if not a.sample:
                break
        greens += 1
        print(f"  `{o}` green — sentence landed, no fork. ({greens} green so far)", flush=True)

    # ⛔ REPORT THE DENOMINATOR. "green" over an unstated number of runs is
    # the shape that let a race look fixed three times.
    total = greens + len(reds)
    msg = f"{len(reds)} red / {total} run(s)"
    msg += ("  —  RED: " + ", ".join(reds)) if reds else "  —  no finding in this sample"
    print("", flush=True)
    print(msg, flush=True)
    return 1 if reds else 0


if __name__ == "__main__":
    raise SystemExit(main())
