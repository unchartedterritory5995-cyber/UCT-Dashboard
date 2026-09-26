"""Wave 7 live walk -- the Playwright script that produces
docs/notebook/gate-runs/wave7/walk-<sha>.json. Kept in tools/ so the evidence is
reproducible; it is NOT a pytest rail. Derived from tools/notebook_wave6_walk.py:
its harness (`@guarded`, `record`, the partial dump, `dismiss_intro`,
`open_note`, the self-provisioning accounts) is kept verbatim where it could be,
and every change to a wave-6 check is marked "wave 7:" in place.

⛔ READ THIS HEADER AND WAVE 6's / WAVE 5's BEFORE CHANGING A LINE. Their three
traps bit real attempts, and they are still preconditions 1-3 (a fourth, the
server's identity, arrived with the wave-7 whole-branch fix round):

  1. A SANDBOX FROM THE TIP, on :8094, and C:\\data CLEAN at every checkpoint.
     Boot it from a `git archive` export of the tip in YOUR SCRATCH, never from
     the shared worktree: `scripts/hub_sandbox_boot.py` writes its integrity
     log under ITS OWN repo root (`docs/plans/joystick/sandbox-runs/<ts>.md`,
     `data_root_snapshot.log_path_for`, no override), so booting from the
     export keeps that log out of `docs/` (wave-7 brief: "Sandbox-run integrity
     logs go to your scratch, never into docs/plans/joystick/"). Boot it from
     POWERSHELL, or single-quote the path: through the Bash tool
     `C:\\data-w7walk` becomes the drive-relative `data-w7walk/` INSIDE the cwd
     (measured in wave 6; the launcher's guard held, but the run is void):

        # PowerShell, in the export's root
        $env:NOTEBOOK_PERSONAL_API_ENABLED='1'
        $env:NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED='1'
        $env:J2_OCR_ENABLED='1'
        $env:TESSERACT_BINARY='C:\\Program Files\\Tesseract-OCR\\tesseract.exe'
        $env:NOTEBOOK_WRITING_HELP_ENABLED='1'
        $env:NOTEBOOK_INBOUND_EMAIL_ENABLED='1'
        $env:NOTEBOOK_INBOUND_EMAIL_SECRET='<a sandbox-only random value>'
        $env:ANTHROPIC_API_KEY=''; $env:OPENAI_API_KEY=''     # NO model key, stated
        Remove-Item Env:NOTEBOOK_SEMANTIC_SEARCH_ENABLED -EA SilentlyContinue
        Remove-Item Env:COMPASS_NOTES_TOOL_ENABLED -EA SilentlyContinue
        python scripts\\hub_sandbox_boot.py --data-dir 'C:\\data-w7walk' --port 8094 *> <scratch>\\launcher.log

     Every gate name above was read off its read site, never typed from the
     brief: `note_personal_api.PERSONAL_API_GATE`,
     `document_extraction.IMAGE_DOCX_GATE`, `document_ocr_tesseract.FLAG`
     (exactly "1") + `binary_path()`'s `TESSERACT_BINARY` (tesseract is
     installed on this box but NOT on PATH -- without it OCR reads "no
     engine"), `writing_help.WRITING_HELP_GATE`, `inbound_email.INBOUND_GATE`
     / `SECRET_ENV` (also named in docs/notebook/email-in-setup.md and the
     Cloudflare worker), `note_semantic` and `coach_chat_tools.NOTES_TOOL_GATE`
     (left UNSET: the walk checks their DARK behaviour). Run THIS script from
     the same PowerShell session, so the secret reaches both processes.

  2. THE WALK ACCOUNT MUST BE PAID on that data dir, or AuthGuard sends every
     notebook route to /morning-wire and every check reads "the page never
     rendered" (wave 5's lesson). Self-provisioning, as wave 6: the sandbox
     admin (ADMIN_EMAILS = hubtest@local.dev) is signed up if missing, every
     member account this walk uses is signed up, comped
     (POST /api/auth/admin/comp-access) and verified
     (POST /api/auth/admin/verify-email); SystemExit(2) if /api/auth/me is not
     paid-equivalent for the primary account.

  3. app/dist REBUILT FROM THE TIP (`npm run build` in the export's app/, with
     a node_modules junction to notebook-k's install, removed afterwards with a
     NON-recursive `cmd /c rmdir`). `api/main.py` serves `<its repo>/app/dist`.

  4. THE SERVER PROVES IT IS THIS RUN'S SANDBOX (tooling review M-3; wave 7
     phase 2). The launcher mints a per-run nonce, writes it on its pre-boot
     line (`identity = <hex>`) and serves it at `/__uct_sandbox_identity`.
     Before the walk sends ONE request, `scripts/sandbox_identity.verify(--base,
     --integrity-log)` must find the same nonce in both, or the walk prints
     `REFUSED: <what was checked>` and exits 3 having written nothing. So
     `--integrity-log` is REQUIRED, and it must be the log of the sandbox on
     `--base` -- a port is not an identity.

    python tools/notebook_wave7_walk.py docs/notebook/gate-runs/wave7/walk-<sha>.json \\
        --tip <sha> --base http://127.0.0.1:8094 --data-dir 'C:\\data-w7walk' \\
        --launcher-log <scratch>\\launcher.log \\
        --integrity-log <export>\\docs\\plans\\joystick\\sandbox-runs\\<ts>.md \\
        --dist <export>\\app\\dist

`--only W14,W15` runs a subset (provisioning always runs) -- a SHAKE-OUT
convenience; an evidence run runs everything.

W13 IS DECIDED AFTER THE SANDBOX STOPS (tooling review I-2). When the rows are
done the walk closes its browser and waits `--shutdown-wait` seconds (default
the harness's 300) for the launcher's SHUTDOWN checkpoint: stop the sandbox
then, gracefully (CTRL_BREAK to its process group, the harness's `_SHIM` path;
never TerminateProcess, which skips the `finally` that writes that line). The
log is read with `tools/notebook_perf_harness.read_integrity`; W13 is PASS only
when pre-boot, +15 s and shutdown are all present and every checkpoint is
CLEAN, INCONCLUSIVE when one is missing (or no log was given), FAIL when one is
not CLEAN.

Real Chromium (Playwright), synthetic accounts. Desktop 1280x800 unless noted.
Each check records what the DOM or the API said; nothing is inferred.
Selectors come ONLY from committed components and their own test files -- the
test file behind each one is named beside it. `--data-dir` is read (never
written, `mode=ro`) for two facts no HTTP route exposes by design: the email-in
drop counter (`j2_inbound_drops`) and the embeddings table (`j2_note_embeddings`).

  W1-W13  wave 6's checks, as regression rows (the tree moved under them)
  W12b    two tabs, one note: a clean rebase vs a conflicted copy, read from the DOM
  W14     G4: an image through Insert image -> an OCR'd document -> searchable
  W15     G1: a token minted in PersonalApiCard; create / append / daily append
          with the bearer; 423 on a locked note; refused at capture and /me
  W16     G3: signed email-in with attachments; unsigned is a bare 401; the
          per-address limit drops AND records (a fresh member per run, whose
          address is made by pressing "Create my address" -- the GET never mints)
  W17     H1 on the touch tier: Scan -> a hidden rear-camera picker; the mic and
          /Dictate; the sentence when the microphone is denied
  W18     H2 with no model key: the failure sentence in the preview, the note
          byte-identical after dismissing, the 60/day counter untouched (a fresh
          member per run: the count is durable in auth.db since ruling D-H5b)
  W19     H3 dark: a natural-language query gets the lexical list only; no
          embeddings; the sweep is registered
  W20     H4 dark: search_my_notes is never offered (INCONCLUSIVE by the brief's
          own rule -- no endpoint exposes the text chat's tools)
  W21     I3 lazy views: ?view=tasks cold; a code block plain first, highlighted
          after the highlighter lands; no route-level error boundary anywhere
  W22     I1 at 1k: GET /notes?q=<common> and the search box's relevance request,
          p50/p95 over 20 reps, REPORTED against perf-budgets.json, never enforced
  W23     J: the saved-view row nests no control in a button and is keyboard
          reachable; a " javascript:" href is refused through every mddoc door

⛔ WHERE THE PRODUCT DISAGREES WITH THE BRIEF -- measured against the product,
recorded in the JSON (`brief_mismatches`), never silently "fixed":
  * W12b: the conflict classifier is NOT block-aware (serverChange.js:12-28,
    F5-frozen). ANY prose change on the server is BODY_REWRITE and forks,
    whichever block it touched; only a METADATA-ONLY move (tags/folder/ticker/
    hero) or a server-appended widgetEmbed/financialFact/documentExcerpt
    reconciles without a fork. So the clean branch is driven by a metadata
    write from tab 1 (a tag, through the editor's tag door), the fork branch by
    prose on the same block, and prose on ANOTHER block is recorded as a third
    row against the product's own contract (a fork), not the brief's model.
  * W16: an unsigned body is a BARE 401 with NO body (router: "a caller without
    the secret learns nothing"; rail G3-E5 pins b''), not "401 with a sentence".
  * W18: no fake provider mode exists in writing_help.py, so Accept cannot be
    driven without a model (recorded INCONCLUSIVE on that half); after a
    failure the panel's dismiss button is labelled "Cancel" (the ready state's
    "Discard" and it call the same `discard`).
  * W20: no endpoint exposes the text chat's tool list.
  * W22: perf-budgets.json declares no 1k tier (50k `search`, 10k
    `search_ci`); readings are reported against the 100 ms line both declare.
  * W23: markdown cannot carry " javascript:" into an href (markdown-it trims
    the destination and refuses the scheme before a link exists); the
    leading-space href reaches mddoc's check through HTML, which is J6's own
    rail -- so the doors are driven with both.
"""
import argparse
import base64
import io
import json
import math
import os
import re
import sqlite3
import sys
import time as _t
import traceback
import urllib.error
import urllib.parse
import urllib.request

from playwright.sync_api import sync_playwright

# ─────────────────────────────────────────────────────────────────────────────
# THE IMPORTABLE PART (wave 7 phase 2). Everything above `ARGS = _ap.parse_args()`
# runs with no argv, no browser and no sandbox: tests/test_notebook_wave7_walk.py
# executes exactly this prefix (cut by AST at that assignment) to rail W13's
# verdict and the --base identity gate. Nothing here reads ARGS or sends a request
# except the identity check, through the launcher's own helper.
# ─────────────────────────────────────────────────────────────────────────────
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO not in sys.path:
    sys.path.insert(0, REPO)
from tools import notebook_perf_harness as _harness  # noqa: E402  (ONE integrity-log reader, review I-2)
sys.path.insert(0, os.path.join(REPO, "scripts"))
import sandbox_identity  # noqa: E402  (the launcher's identity marker, tooling review M-3)


def require_sandbox_identity(base, integrity_log, *, sink=None, verify=None):
    """⛔ A PORT IS NOT AN IDENTITY (tooling review M-3, the walk's half). The walk signs
    up, comps and seeds through whatever answers `--base`; a stale non-sandbox backend
    on that port resolves every path to C:\\data, and those writes would land in the
    owner's live auth.db while W13 read some other sandbox's clean log. So BEFORE THE
    FIRST REQUEST, `sandbox_identity.verify(base, integrity_log)` (scripts/, the
    launcher's own helper, reused -- never a second one) must find the SAME per-run
    nonce in the integrity log and at the server's `/__uct_sandbox_identity`.

    The verdict goes into `sink` (the walk's JSON) either way. Refused: prints
    `REFUSED: <the helper's sentence, naming what was checked>` and exits 3 (the perf
    harness's "refused / not run"). `verify` is a seam, looked up at call time."""
    check = verify if verify is not None else sandbox_identity.verify
    verdict = check(base, integrity_log)
    if sink is not None:
        sink["sandbox_identity"] = {"ok": verdict.ok, "sentence": verdict.sentence, "nonce": verdict.nonce,
                                    "base": base, "integrity_log": integrity_log}
    if not verdict.ok:
        if sink is not None:
            sink["REFUSED"] = verdict.sentence
        print("REFUSED: " + verdict.sentence, flush=True)
        raise SystemExit(3)
    print("SANDBOX IDENTITY: " + verdict.sentence, flush=True)
    return verdict

# W13 needs the launcher's pre-boot, +15 s AND shutdown checkpoints -- the harness's
# labels, which are the launcher's own words (railed against scripts/hub_sandbox_boot.py
# by tests/test_notebook_perf_harness.py). +120 s is not required (a walk that ends
# early has not reached it), but read_integrity still judges it when it is present.
W13_REQUIRED = (_harness.PRE_BOOT, _harness.POST_BOOT, _harness.SHUTDOWN)


def wait_for_shutdown_checkpoint(path, wait_s, *, poll_s=1.0):
    """Wait, bounded by `wait_s`, for the sandbox's SHUTDOWN checkpoint to land in its
    integrity log; the seconds waited. ⛔ WHY (tooling review I-2): the launcher hashes
    C:\\data at pre-boot, +15 s, +120 s and shutdown, and the shutdown line is the ONLY
    one taken after the walk's own writes -- a leak from a door the walk drives shows
    there and nowhere else. It exists only once the sandbox has stopped, so the operator
    stops it (gracefully, the SIGBREAK path) while this waits. Nothing to wait for (no
    log, a zero budget, a shutdown line already there) returns at once."""
    def has_shutdown():
        return any(c["label"] == _harness.SHUTDOWN for c in _harness.read_integrity(path, [])["checkpoints"])
    if not path or not os.path.isfile(path) or not wait_s or wait_s <= 0 or has_shutdown():
        return 0.0
    print(f"(W13: waiting up to {wait_s:.0f} s for the shutdown checkpoint in {path} -- stop the "
          "sandbox now, gracefully; W13 is INCONCLUSIVE without it)", file=sys.stderr, flush=True)
    start = _t.time()
    while _t.time() - start < wait_s and not has_shutdown():
        _t.sleep(poll_s)
    return round(_t.time() - start, 2)


def integrity_log_named_in(launcher_text):
    """The path the launcher printed on its `[pre-boot] integrity log:` line (the harness's
    own pattern), or None."""
    for line in (launcher_text or "").splitlines():
        m = _harness._INTEGRITY_PATH_RE.search(line)
        if m:
            return m["path"].strip()
    return None


def w13_integrity(path, launcher_text=None):
    """The launcher's integrity log, read by the HARNESS's reader against W13_REQUIRED
    (never a second parser), plus the review's cross-check: is `path` the log the launcher
    itself named in its output? None = no launcher output to ask."""
    integ = _harness.read_integrity(path, list(W13_REQUIRED))
    named = integrity_log_named_in(launcher_text)
    integ["launcher_log_names"] = named
    integ["launcher_log_agrees"] = (None if not (named and path) else
                                    os.path.normcase(os.path.abspath(named)) == os.path.normcase(os.path.abspath(path)))
    return integ


def w13_verdict(integ, genuine_errors):
    """(verdict, reason) for W13. PASS needs EVIDENCE: every required checkpoint present
    and every checkpoint CLEAN, in the log the launcher named, with no unforced page error.
      * a checkpoint that is NOT CLEAN -> FAIL (the shared data root changed);
      * an unforced page error -> FAIL;
      * no log, or a required checkpoint missing (above all SHUTDOWN) -> INCONCLUSIVE;
      * a log the launcher did not name -> INCONCLUSIVE.
    ⚰️ It was `leak = all_clean is False` -> PASS: no `--integrity-log` was a PASS, the
    shutdown line was never read, and a log holding only pre-boot read clean (review I-2)."""
    if integ.get("status") == "NOT CLEAN":
        return "FAIL", "the shared data root changed: " + (integ.get("why") or "")
    if genuine_errors:
        return "FAIL", f"{len(genuine_errors)} unforced page error(s) during the walk"
    if not integ.get("clean"):
        return "INCONCLUSIVE", f"sandbox integrity is {integ.get('status')}: {integ.get('why')}"
    if integ.get("launcher_log_agrees") is False:
        return "INCONCLUSIVE", ("--integrity-log is not the log the launcher named on its "
                                f"`[pre-boot] integrity log:` line ({integ.get('launcher_log_names')})")
    return "PASS", None


def _signup_or_login(request_ctx, base, email, pw, name, *, sleep=None, window_s=61.0, tries=3):
    """Sign up, or sign in when the account already exists; the last answer.

    ⛔ A 429 IS NOT "THIS ACCOUNT EXISTS" (wave 7 phase 2, found by the evidence run on
    96fa5ca2a). The app limits sign-up to 3 a minute and sign-in to 5 a minute per client
    (api/routers/auth.py `@limiter.limit("3/minute")` / `("5/minute")`), and answers a
    refusal 429 with no Retry-After header. The walk makes more sign-up attempts than that
    in a minute: every call tries sign-up first, and an existing account answers 409. So
    any non-200 used to fall through to sign-in. A 429 for a NEW member therefore became a
    401 sign-in for an account that was never made. W22's member never existed; its 1,000
    seeded notes all answered 401, and its page opened on /login.
    Now a 429 waits out the limiter's one-minute window and asks again (bounded by
    `tries`); only a non-429 refusal of sign-up (409: it exists) goes on to sign-in."""
    sleep = sleep or _t.sleep

    def ask(path, data):
        for attempt in range(tries):
            r = request_ctx.post(base + path, data=data)
            if r.status != 429:
                return r
            if attempt + 1 < tries:
                sleep(window_s)
        return r

    r = ask("/api/auth/signup", {"email": email, "password": pw, "display_name": name})
    if r.status in (200, 201):
        return r
    return ask("/api/auth/login", {"email": email, "password": pw})


_ap = argparse.ArgumentParser(description="Wave 7 live walk (see the module header).")
_ap.add_argument("out", nargs="?", default="wave7_walk.json")
_ap.add_argument("--base", default="http://127.0.0.1:8094")
_ap.add_argument("--tip", default=None, help="the SHA the sandbox was booted from")
_ap.add_argument("--data-dir", default=r"C:\data-w7walk",
                 help="the sandbox data dir, READ ONLY (drops + embeddings tables)")
_ap.add_argument("--launcher-log", default=None,
                 help="the sandbox launcher's captured stdout/stderr")
_ap.add_argument("--integrity-log", default=None,
                 help="the launcher's own integrity log (<export>/docs/plans/joystick/sandbox-runs/<ts>.md)")
_ap.add_argument("--shutdown-wait", type=float, default=_harness.BASE_SHUTDOWN_WAIT_S,
                 help="seconds to wait, after the rows, for the sandbox's SHUTDOWN checkpoint "
                      f"(default {_harness.BASE_SHUTDOWN_WAIT_S:.0f}, the harness's); stop the sandbox "
                      "to supply it -- W13 is INCONCLUSIVE without it")
_ap.add_argument("--dist", default=None, help="the app/dist the sandbox serves (for .vite/manifest.json)")
_ap.add_argument("--only", default=None, help="comma list of check prefixes, e.g. W14,W15 (shake-out only)")
ARGS = _ap.parse_args()

BASE = ARGS.base.rstrip("/")
ADMIN_EMAIL, ADMIN_PW = "hubtest@local.dev", "LocalTest2026!"
EMAIL, PW = "w7walk@local.dev", "LocalTest2026!"        # primary walk account
EMAIL2, PW2 = "w7walkb@local.dev", "LocalTest2026!"      # second member (W3)
OUT = ARGS.out
P = lambda t: {"type": "paragraph", "content": [{"type": "text", "text": t}]}
RUN = _t.strftime("r%H%M%S")   # unique per run: repeat runs never match an older run's notes
# A letters-only twin of RUN (OCR reads letters more reliably than digits, and
# FTS treats it as one word): r134501 -> "wrbdefab".
# ⛔ INSTRUMENT FIX (shake-out 3, 2026-09-25): the map was "abcdefghij", and
# Tesseract read the run word's final J as ")" (`PELICAN WRBEEEF)` for
# "wrbeeefj"), so W14 failed on the instrument's own glyph choice while the
# product had OCR'd the page correctly. I and J (and L, O) are the confusable
# glyphs; 8 and 9 now map to K and M.
RUNWORD = "w" + "".join("abcdefghkm"[int(c)] if c.isdigit() else c for c in RUN)
FORCED_ERROR_MARKER = "wave7 walk forced error"

# Gate names, each read off its read site (see the header). The walk records
# what ITS OWN process holds for each (the same shell booted the sandbox) AND
# what the sandbox answers -- only the second is evidence about the sandbox.
GATES_ARMED = (
    "NOTEBOOK_PERSONAL_API_ENABLED", "NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED", "J2_OCR_ENABLED",
    "NOTEBOOK_WRITING_HELP_ENABLED", "NOTEBOOK_INBOUND_EMAIL_ENABLED",
)
GATES_DARK = ("NOTEBOOK_SEMANTIC_SEARCH_ENABLED", "COMPASS_NOTES_TOOL_ENABLED")
KEYS_BLANK = ("ANTHROPIC_API_KEY", "OPENAI_API_KEY")
INBOUND_SECRET = os.environ.get("NOTEBOOK_INBOUND_EMAIL_SECRET") or ""

res = {
    "errors": [], "checks": {},
    "tip": ARGS.tip, "base": BASE, "port": int(BASE.rsplit(":", 1)[-1]) if BASE.rsplit(":", 1)[-1].isdigit() else None,
    "run": RUN, "only": ARGS.only,
    "brief_mismatches": [], "instrument_notes": [],
}


def wanted(key):
    """`--only` filter (shake-out). An evidence run passes no --only."""
    if not ARGS.only:
        return True
    return any(key.startswith(p.strip()) for p in ARGS.only.split(",") if p.strip())

# ⛔ A crash must never discard what was already measured -- dump the partial
# `res` on ANY exit, and record the exception itself in it (wave5's own rule).
import atexit  # noqa: E402


def _dump_partial():
    try:
        with open(OUT, "w", encoding="utf-8") as fh:
            json.dump(res, fh, indent=1, ensure_ascii=False, default=str)
    except Exception as e:  # noqa: BLE001
        print("partial dump failed:", e)


atexit.register(_dump_partial)
_orig_hook = sys.excepthook


def _hook(t, v, tb):
    res["errors"].append("UNHANDLED: " + "".join(traceback.format_exception(t, v, tb))[-1500:])
    res["INCOMPLETE"] = True
    _orig_hook(t, v, tb)


sys.excepthook = _hook


def record(key, verdict, **facts):
    """One check = one JSON key, PASS/FAIL/INCONCLUSIVE + the measured facts."""
    entry = {"verdict": verdict}
    entry.update(facts)
    res["checks"][key] = entry
    print(f"[{verdict}] {key}: " + json.dumps(facts, default=str)[:300])
    return entry


def guarded(key):
    """Decorator: never let one check's exception stop the rest of the walk.

    wave 7: a check `--only` leaves out is skipped WITHOUT a record -- an
    absent key says "not run", never a verdict."""
    def wrap(fn):
        def inner(*a, **kw):
            if not wanted(key):
                return
            try:
                fn(*a, **kw)
            except Exception as e:  # noqa: BLE001
                tb = traceback.format_exc()[-1200:]
                record(key, "INCONCLUSIVE", reason=f"exception: {e}", traceback=tb)
        return inner
    return wrap


def signup_or_login(request_ctx, email, pw, name):
    return _signup_or_login(request_ctx, BASE, email, pw, name)


_INTRO_DIALOG_SEL = 'div[role="dialog"][aria-label="Welcome"]'


def dismiss_intro(pg, appear_timeout=2500, detach_timeout=6000):
    """Dismiss the Welcome intro overlay (IntroAnimation.jsx) if it appears on
    this page/tab, and WAIT for it to actually detach before returning.

    ⛔ Coordinator directive, this round: the old body here was a blind
    `wait_for_timeout(1200); keyboard.press("Escape"); wait_for_timeout(600)`
    -- it never checked whether the dialog was ever actually present, and
    never waited for it to actually be GONE before the caller went on to
    interact with the page underneath it. W8b's own Playwright retry trace
    named `<div class="_revealScene_...">` from this exact dialog as the
    pointer-event interceptor behind a `.click()` timeout.

    'Detached' is a real, verifiable signal here, not a guess: the component
    is `if (phase !== 'playing') return null` (IntroAnimation.jsx:82), so once
    its own `finish()` fires (Escape/Enter/Space, capture-phase, or the Skip
    button) the whole `<div role="dialog">` subtree is removed from the DOM,
    not merely hidden or mid-transition.

    It plays once per browser TAB's sessionStorage
    (`introStorage.hasSeenIntroThisSession`), so a `page.goto()` on a page
    that has already dismissed it this tab is a fast no-op here (the dialog
    never appears within `appear_timeout` and this returns False) -- the cost
    only lands on a genuinely fresh browsing context (every `ctx.new_page()`)."""
    dialog = pg.locator(_INTRO_DIALOG_SEL)
    try:
        dialog.first.wait_for(state="visible", timeout=appear_timeout)
    except Exception:  # noqa: BLE001
        return False  # never appeared this tab -- nothing to dismiss
    try:
        pg.keyboard.press("Escape")
    except Exception:  # noqa: BLE001
        pass
    try:
        dialog.first.wait_for(state="detached", timeout=detach_timeout)
        return True
    except Exception:  # noqa: BLE001
        pass
    # Escape is captured at window level (IntroAnimation.jsx:69-80) but the
    # component's OWN comment documents a hazard where a focused input can
    # also own Escape -- fall back to the explicit Skip button, which
    # stopPropagation()s and calls finish() directly (line ~111).
    try:
        pg.get_by_role("button", name="Skip intro", exact=True).click(timeout=1500)
    except Exception:  # noqa: BLE001
        pass
    try:
        dialog.first.wait_for(state="detached", timeout=detach_timeout)
        return True
    except Exception:  # noqa: BLE001
        return False


def notebook_url(note_id=None, extra=""):
    if note_id:
        return f"{BASE}/journal/notebook?note={note_id}{extra}"
    return f"{BASE}/journal/notebook{extra}"


# wave 7: wave 6 carried a "CRITICAL_FINDING" block here about
# `NoteEditorPage.jsx:2448` (`editor?.view?.dom`, a throwing getter that sent
# about half of all note-opens to the route ErrorBoundary). That defect is
# FIXED in this tree: the effect now returns on `editor.isDestroyed` before it
# reads `editor.view` (NoteEditorPage.jsx:2583 at e6bb581a5, with the history
# in the comment above it), so it is NOT carried forward as a claim.
#
# ⛔ THE RETRY BELOW STAYS, BUT IT NO LONGER HIDES ANYTHING. It exists so one
# failed mount cannot take every later check with it; every route-level
# fallback it sees is recorded in ERROR_BOUNDARY["sightings"], and W13/W21
# read that list. A retry that absorbs a crash silently would turn the exact
# failure W21 exists to catch into a green row.
ERROR_BOUNDARY = {"sightings": [], "attempts_log": []}
ROUTE_FALLBACK_TEXT = "Something went wrong on this page"   # AppErrorFallback.jsx

# ⭐ EVENT-DRIVEN, NOT SAMPLED: `components/ErrorBoundary.jsx` reports every
# catch through the error beacon as `{kind: 'boundary'}`, and
# `lib/errorBeacon.js` reports window.onerror / unhandledrejection the same way
# (`POST /api/client-errors`). A context-level request listener sees every one,
# from every page of that context, whenever it happens -- a DOM sample can only
# see the instant it looks.
BEACONS = []
FORCED_BEACONS = {"from": None, "to": None}   # W11d's deliberate throw, fenced by index


def unforced_beacons():
    lo, hi = FORCED_BEACONS["from"], FORCED_BEACONS["to"]
    if lo is None or hi is None:
        return list(BEACONS)
    return BEACONS[:lo] + BEACONS[hi:]


def watch_beacons(ctx, label):
    def _on_request(req):
        if req.method == "POST" and req.url.endswith("/api/client-errors"):
            try:
                body = json.loads(req.post_data or "{}")
            except Exception:  # noqa: BLE001
                body = {"unparsed": (req.post_data or "")[:300]}
            BEACONS.append({"context": label, "kind": body.get("kind") if isinstance(body, dict) else None,
                            "body": body})
    ctx.on("request", _on_request)
    return ctx


def _route_fallback_visible(pg):
    try:
        return pg.get_by_text(ROUTE_FALLBACK_TEXT).count() > 0
    except Exception:  # noqa: BLE001
        return False


def _note_fallback(url, attempt, where):
    ERROR_BOUNDARY["sightings"].append({"url": url, "attempt": attempt, "where": where})
    ERROR_BOUNDARY["attempts_log"].append({"url": url, "attempt": attempt, "outcome": "route_fallback:" + where})


def _fresh_page(ctx, old_pg=None):
    if old_pg is not None:
        try:
            old_pg.close()
        except Exception:  # noqa: BLE001
            pass
    npg = ctx.new_page()
    npg.on("pageerror", lambda e: res["errors"].append(str(e)[:300]))
    return npg


def _wait_mount_or_fallback(pg, timeout):
    """ONE waiter for either outcome -- the editor or the route fallback --
    never a sleep followed by a sample (wave 7: wave 6 slept 300 ms and then
    looked, which misses a fallback that renders at 301 ms)."""
    either = pg.locator(".ProseMirror").or_(pg.get_by_text(ROUTE_FALLBACK_TEXT))
    either.first.wait_for(state="attached", timeout=timeout)
    return "fallback" if _route_fallback_visible(pg) else "editor"


def open_note(ctx, url, page=None, max_tries=8, prosemirror_timeout=15000, extra_listeners=None):
    """Navigate (hard nav) to a note URL; returns the page whose editor mounted.

    wave 6's fresh-page-per-retry discipline is kept (a retry on the SAME page
    compounded in wave 6). Callers MUST reassign: `page = open_note(ctx, url, page)`.
    The `page` passed in is BORROWED and never closed here; only pages this
    function creates for retries 2+ are owned and recycled. Raises after
    `max_tries` so the caller's @guarded wrapper reports INCONCLUSIVE."""
    pg = page if page is not None else _fresh_page(ctx)
    owns_pg = page is None
    for event, handler in (extra_listeners or []):
        pg.on(event, handler)
    for attempt in range(1, max_tries + 1):
        if attempt > 1:
            pg = _fresh_page(ctx, pg if owns_pg else None)
            owns_pg = True
            for event, handler in (extra_listeners or []):
                pg.on(event, handler)
        pg.goto(url)
        dismiss_intro(pg)
        try:
            outcome = _wait_mount_or_fallback(pg, prosemirror_timeout)
        except Exception:  # noqa: BLE001
            ERROR_BOUNDARY["attempts_log"].append({"url": url, "attempt": attempt, "outcome": "neither_within_timeout"})
            continue
        if outcome == "fallback":
            _note_fallback(url, attempt, "open_note")
            pg.wait_for_timeout(1500 * attempt)   # backoff before a FRESH page, not a sample
            continue
        return pg
    if owns_pg:
        try:
            pg.close()
        except Exception:  # noqa: BLE001
            pass
    raise RuntimeError(
        f"note editor never mounted after {max_tries} attempts, each on a FRESH page -- "
        f"route fallbacks seen so far: {len(ERROR_BOUNDARY['sightings'])} -- url={url}")


def reload_note(ctx, page, max_tries=8, prosemirror_timeout=15000):
    """Same discipline as open_note, re-fetching an already-open note."""
    url = page.url
    pg = page
    owns_pg = False
    for attempt in range(1, max_tries + 1):
        if attempt == 1:
            pg.reload()
        else:
            pg = _fresh_page(ctx, pg if owns_pg else None)
            owns_pg = True
            pg.goto(url)
        dismiss_intro(pg)
        try:
            outcome = _wait_mount_or_fallback(pg, prosemirror_timeout)
        except Exception:  # noqa: BLE001
            ERROR_BOUNDARY["attempts_log"].append({"url": url, "attempt": attempt, "outcome": "neither_within_timeout(reload)"})
            continue
        if outcome == "fallback":
            _note_fallback(url, attempt, "reload_note")
            pg.wait_for_timeout(1500 * attempt)
            continue
        return pg
    if owns_pg:
        try:
            pg.close()
        except Exception:  # noqa: BLE001
            pass
    raise RuntimeError(f"note editor never remounted after {max_tries} reloads -- url={url}")


def type_by_walk(node):
    """Walk a bodyJson-shaped dict/list and count node types."""
    counts = {}

    def walk(n):
        if isinstance(n, dict):
            t = n.get("type")
            if t:
                counts[t] = counts.get(t, 0) + 1
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)

    walk(node)
    return counts


PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


# ─────────────────────────────────────────────────────────────────────────────
# wave 7 helpers
# ─────────────────────────────────────────────────────────────────────────────
import hashlib  # noqa: E402
import hmac  # noqa: E402

FONT_PATH = os.path.join(REPO, "api", "services", "desk_assets", "DejaVuSans-Bold.ttf")


def http(method, path, *, body=None, raw=None, headers=None, timeout=90):
    """One request with NO cookie jar (urllib), answering (status, bytes, headers).

    ⛔ WHY NOT THE PLAYWRIGHT CONTEXT: `require_capture_scope` -- the personal
    API's resolver -- is SESSION-FIRST (notebook_personal_api.py header), so a
    bearer sent from a signed-in context is answered by the COOKIE and the
    token path never runs. And the email-in signature is over the exact body
    bytes, which a client that re-serialises would break."""
    data = raw if raw is not None else (json.dumps(body).encode("utf-8") if body is not None else None)
    req = urllib.request.Request(BASE + path, data=data, method=method)
    hdrs = dict(headers or {})
    if data is not None and "Content-Type" not in hdrs:
        hdrs["Content-Type"] = "application/json"
    for k, v in hdrs.items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers or {})


def jdecode(raw):
    try:
        return json.loads((raw or b"").decode("utf-8") or "null")
    except Exception:  # noqa: BLE001
        return None


SIGNATURES_SENT = []   # every X-UCT-Signature this run has sent, in order


def signed_email(payload, *, secret, ts=None, bad_signature=False):
    """POST one email exactly as the Cloudflare worker does
    (cloudflare/inbound-email-worker/src/sign.js): compact JSON, then hex
    HMAC-SHA256 over `<timestamp>.<raw body>` in X-UCT-Signature.

    wave 7 phase 2 (whole-branch M-6, `57bcd2551`): a signature is DELIVERED ONCE
    -- a replay answers 202, makes nothing and spends no allowance
    (`inbound_email.claim_delivery`, keyed on a hash of the signature). Every
    message this walk sends has its own subject, so its own bytes and its own
    signature; W16 records `signatures_distinct` so a replay drop can never be
    read as a product failure."""
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ts = ts or str(int(_t.time()))
    sig = hmac.new(secret.encode("utf-8"), ts.encode("ascii") + b"." + body, hashlib.sha256).hexdigest()
    if bad_signature:
        sig = ("0" if sig[0] != "0" else "1") + sig[1:]
    SIGNATURES_SENT.append(sig)
    return http("POST", "/api/j2/inbound-email", raw=body,
                headers={"Content-Type": "application/json", "X-UCT-Timestamp": ts, "X-UCT-Signature": sig})


def png_with_text(lines, size=(1700, 560), font_px=104):
    """A plain black-on-white PNG a real OCR engine can read (Pillow, the
    font the app itself ships)."""
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGB", size, "white")
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT_PATH, font_px)
    y = 70
    for line in lines:
        draw.text((70, y), line, fill="black", font=font)
        y += int(font_px * 1.6)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def tiny_pdf():
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (200, 120), "white").save(buf, "PDF")
    return buf.getvalue()


def sandbox_db(sql, params=()):
    """READ-ONLY (`mode=ro`) against the SANDBOX's auth.db, for the two facts
    no HTTP route exposes by design (the email-in drop counter, the embeddings
    table). ⛔ Refuses outright if --data-dir is, or sits inside, the shared
    data root: even a read-only open of a WAL database rewrites its -shm."""
    d = os.path.normcase(os.path.abspath(ARGS.data_dir))
    for shared in (r"C:\data", "/data"):
        s = os.path.normcase(os.path.abspath(shared))
        if d == s or d.startswith(s + os.sep):
            raise RuntimeError(f"refusing to read {d}: it is inside the shared data root {s}")
    path = os.path.join(ARGS.data_dir, "auth.db")
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    conn = sqlite3.connect("file:/" + os.path.abspath(path).replace("\\", "/") + "?mode=ro", uri=True, timeout=5)
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def _py_constant(relpath, name):
    """A module-level string constant read off its SOURCE by AST (wave 7 phase 2) -- never
    by importing `api.*`, whose module-level paths would resolve to C:\\data from this
    process. A name that is not a plain string there is a LookupError, never a guess."""
    import ast
    tree = ast.parse(open(os.path.join(REPO, relpath), encoding="utf-8").read())
    for node in tree.body:
        if (isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets)
                and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str)):
            return node.value.value
    raise LookupError(f"{name} is not a module-level string constant in {relpath}")


def percentile(samples, pct):
    """Nearest rank, no interpolation -- the SAME definition as
    tools/notebook_scale_benchmark.py::percentile, so the two can be compared."""
    s = sorted(samples)
    rank = max(1, math.ceil(pct / 100.0 * len(s)))
    return s[rank - 1]


def read_text_any(path):
    """A launcher log captured by PowerShell may be UTF-16 or UTF-8."""
    raw = open(path, "rb").read()
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff") or raw[1:2] == b"\x00":
        return raw.decode("utf-16", errors="replace")
    return raw.decode("utf-8", errors="replace")


def launcher_lines(pattern):
    """Lines of the launcher's output matching `pattern`; None = no log given."""
    if not ARGS.launcher_log or not os.path.exists(ARGS.launcher_log):
        return None
    rx = re.compile(pattern)
    return [ln.strip() for ln in read_text_any(ARGS.launcher_log).splitlines() if rx.search(ln)]


def manifest_file(src_key):
    """The built chunk for a source module, from the build's OWN
    .vite/manifest.json (vite.config.js `manifest: true`) -- a chunk name is
    derived, never guessed from a filename pattern."""
    if not ARGS.dist:
        return None
    path = os.path.join(ARGS.dist, ".vite", "manifest.json")
    if not os.path.exists(path):
        return None
    entry = json.load(open(path, encoding="utf-8")).get(src_key)
    return entry.get("file") if isinstance(entry, dict) else None


def find_key(obj, key):
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for v in obj.values():
            hit = find_key(v, key)
            if hit is not None:
                return hit
    elif isinstance(obj, list):
        for v in obj:
            hit = find_key(v, key)
            if hit is not None:
                return hit
    return None


# TipTap's UNICODE_WHITESPACE_PATTERN (@tiptap/extension-link, isAllowedUri),
# the characters a browser ignores inside a scheme -- mddoc's link_href_as_read
# strips the same class (J6). The instrument keeps its OWN copy on purpose: a
# walk that imported the product's normaliser would agree with any bug in it.
_HREF_INVISIBLE = re.compile("[\u0000-\u0020\u00a0\u1680\u180e\u2000-\u2029\u205f\u3000]")
_SCRIPT_SCHEMES = ("javascript:", "vbscript:", "data:text/html")


def href_is_script(href):
    return _HREF_INVISIBLE.sub("", str(href or "")).lower().startswith(_SCRIPT_SCHEMES)


def link_hrefs(node):
    """Every link mark's href in a bodyJson tree."""
    out = []

    def walk(n):
        if isinstance(n, dict):
            for m in n.get("marks") or []:
                if isinstance(m, dict) and m.get("type") == "link":
                    out.append((m.get("attrs") or {}).get("href"))
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(node)
    return out


def body_text(node):
    parts = []

    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "text":
                parts.append(n.get("text") or "")
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(node)
    return " ".join(parts)


def provision_member(browser, actx, email, name, **ctx_kwargs):
    """A signed-up, comped, VERIFIED member in its own context (wave 6's
    provisioning, per account) -- used for the per-run accounts W16 and W22
    need so their windows and counts start at zero every run."""
    opts = {"viewport": {"width": 1280, "height": 800}}
    opts.update(ctx_kwargs)
    c = watch_beacons(browser.new_context(**opts), email)
    signup_or_login(c.request, email, PW, name)
    comp = actx.request.post(BASE + "/api/auth/admin/comp-access", data={"email": email, "action": "grant"})
    ver = actx.request.post(BASE + "/api/auth/admin/verify-email", data={"email": email})
    me_r = c.request.get(BASE + "/api/auth/me")
    me = me_r.json() if me_r.ok else {}
    facts = {"comp": comp.status, "verify": ver.status, "me": me_r.status, "paid_equiv": me.get("paid_equiv"),
             "user_id": (me.get("user") or {}).get("id")}
    # ⛔ A row must never measure through a member that does not exist (wave 7 phase 2:
    # W22 seeded 1,000 notes into 401s and read /login). Refuse here, loudly; the row's
    # @guarded wrapper records it INCONCLUSIVE with these facts as the reason.
    if not facts["paid_equiv"] or not facts["user_id"]:
        raise RuntimeError(f"provisioning {email} did not produce a signed-in, paid member: {facts}")
    return c, facts


def select_box(pg, title):
    """The all-notes list row for a note: its checkbox is named `Select <title>`
    (NotebookTab.bulk.test.jsx:197, `name: \\`Select ${title}\\``)."""
    return pg.get_by_role("checkbox", name=f"Select {title}", exact=True)


def open_list(pg):
    pg.goto(notebook_url(None, "?view=all"))
    dismiss_intro(pg)


def wait_list_row(pg, title, timeout=30000):
    """Waits for the row (a waiter, never a sample); True/False."""
    try:
        select_box(pg, title).first.wait_for(state="attached", timeout=timeout)
        return True
    except Exception:  # noqa: BLE001
        return False


def mismatch(check, brief_says, product_does, source):
    res["brief_mismatches"].append({"check": check, "brief": brief_says, "product": product_does, "source": source})


# ⛔ NOTHING IS SENT TO --base UNTIL IT PROVES IT IS THIS RUN'S SANDBOX (tooling review M-3):
# the same nonce in --integrity-log and at the server, or the walk refuses (exit 3) with the
# helper's sentence and writes nothing. Everything below -- provisioning first -- sends.
require_sandbox_identity(BASE, ARGS.integrity_log, sink=res)

with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---- Provisioning: admin, walk account, second member -----------------
    actx = watch_beacons(browser.new_context(), "admin")
    signup_or_login(actx.request, ADMIN_EMAIL, ADMIN_PW, "hubtest")
    res["admin_login_ok"] = True

    ctx = watch_beacons(browser.new_context(viewport={"width": 1280, "height": 800}), "walk")
    signup_or_login(ctx.request, EMAIL, PW, "w7walk")
    api = ctx.request

    ctx2 = watch_beacons(browser.new_context(viewport={"width": 1280, "height": 800}), "member2")
    signup_or_login(ctx2.request, EMAIL2, PW2, "w7walkb")
    api2 = ctx2.request

    for email in (EMAIL, EMAIL2):
        c = actx.request.post(BASE + "/api/auth/admin/comp-access",
                               data={"email": email, "action": "grant"})
        res.setdefault("comp_status", {})[email] = c.status
        # A non-admin signup starts email_verified=False, and AuthGuard sends an
        # unverified member to /verify-pending regardless of plan -- every
        # notebook route redirects there, reading as "the editor never
        # rendered" if missed (the same class of trap wave 5's own header warns
        # about for the PAID gate). Admin-only door: POST /admin/verify-email.
        v = actx.request.post(BASE + "/api/auth/admin/verify-email", data={"email": email})
        res.setdefault("verify_email_status", {})[email] = v.status

    me = api.get(BASE + "/api/auth/me").json()
    res["account"] = {"role": (me.get("user") or {}).get("role"), "plan": me.get("plan"),
                       "paid_equiv": me.get("paid_equiv")}
    if not me.get("paid_equiv"):
        res["INCOMPLETE"] = True
        res["errors"].append(
            "ABORT: walk account is not paid (paid_equiv false) -- comp-access did not take; "
            "re-run after confirming admin_login_ok and comp_status above")
        raise SystemExit(2)

    me2 = api2.get(BASE + "/api/auth/me").json()
    res["account2_paid_equiv"] = me2.get("paid_equiv")
    WALK_USER_ID = (me.get("user") or {}).get("id")

    # ---- wave 7: the gate values, and what the SANDBOX says about each -------
    # ⛔ The walk process's own environment is NOT evidence about the sandbox
    # (a different process); it is recorded because the header's procedure
    # boots both from one shell. What the sandbox ANSWERS is the evidence:
    # a dark route is FastAPI's own 404, an armed one is not.
    obs = {}
    obs["GET /api/j2/personal/tokens"] = api.get(BASE + "/api/j2/personal/tokens").status
    # Since whole-branch M-10 this GET never mints (an armed route answers 200 with
    # {"address": null} until the member creates one), so reading it here writes nothing.
    obs["GET /api/j2/inbound-email/address"] = api.get(BASE + "/api/j2/inbound-email/address").status
    obs["auth_me.notebook_writing_help_enabled"] = find_key(me, "notebook_writing_help_enabled")
    obs["launcher: j2-ocr fingerprint"] = launcher_lines(r"\[startup\] j2-ocr:")
    obs["launcher: semantic sweep registration"] = launcher_lines(r"notebook semantic sweep regist")
    res["gates"] = {
        "walk_process_env": {n: os.environ.get(n) for n in GATES_ARMED + GATES_DARK},
        "walk_process_keys_blank": {k: os.environ.get(k) in (None, "") for k in KEYS_BLANK},
        "walk_process_inbound_secret_present": bool(INBOUND_SECRET),
        "observed_from_sandbox": obs,
        "not_observable_over_http": {
            "NOTEBOOK_SEMANTIC_SEARCH_ENABLED": "no route of its own; W19 reads its dark BEHAVIOUR",
            "COMPASS_NOTES_TOOL_ENABLED": "no endpoint exposes the text chat's tools; W20",
            "NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED": "no route of its own; W14 reads whether an image becomes a document",
        },
    }

    page = ctx.new_page()
    page.on("pageerror", lambda e: res["errors"].append(str(e)[:300]))
    # Consistent with every other navigation in this file (and with the fixed
    # W3 second-member check above) -- a bare notebook_url() lands on a
    # different initial layout than the Notebook list view.
    page.goto(notebook_url(None, "?view=all"))
    dismiss_intro(page)

    # =========================================================================
    # W1 -- lock / unlock
    # =========================================================================
    @guarded("W1_lock_unlock")
    def check_w1():
        global page
        note = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W1 lock {RUN}",
            "bodyJson": {"type": "doc", "content": [P("Original body.")]},
        }).json()["note"]
        nid = note["id"]
        page = open_note(ctx, notebook_url(nid), page)
        page.wait_for_timeout(400)

        menu = page.get_by_role("group", name="Organise this note")
        menu.wait_for(state="visible", timeout=8000)

        lock_req = {}
        def on_req(req):
            if req.method == "PATCH" and re.search(rf"/api/j2/notes/{nid}/lock$", req.url):
                try:
                    lock_req["body"] = json.loads(req.post_data or "{}")
                except Exception:
                    lock_req["body"] = req.post_data
        page.on("request", on_req)

        with page.expect_response(lambda r: r.url.endswith(f"/api/j2/notes/{nid}/lock")) as resp_info:
            menu.get_by_role("button", name="Lock", exact=True).click()
        lock_resp = resp_info.value
        lock_body = lock_resp.json()

        page.wait_for_timeout(300)
        editable_attr = page.locator(".ProseMirror").get_attribute("contenteditable")

        # Unlock -> a keystroke -> the autosave PUT
        put_bodies = []
        def on_put(req):
            if req.method == "PUT" and re.search(rf"/api/j2/notes/{nid}$", req.url):
                try:
                    put_bodies.append(json.loads(req.post_data or "{}"))
                except Exception:
                    pass
        page.on("request", on_put)

        with page.expect_response(lambda r: r.url.endswith(f"/api/j2/notes/{nid}/lock")) as unlock_info:
            menu.get_by_role("button", name="Unlock", exact=True).click()
        unlock_resp = unlock_info.value
        page.wait_for_timeout(400)
        editable_after_unlock = page.locator(".ProseMirror").get_attribute("contenteditable")

        page.locator(".ProseMirror").click()
        page.keyboard.press("End")
        page.keyboard.type(" and more.", delay=20)
        try:
            page.wait_for_function(
                "(n) => window.__uctPutCount === undefined || true", timeout=1)
        except Exception:
            pass
        page.wait_for_timeout(1600)   # autosave debounce window

        # ⛔ FIX (this run): this used to scan the member's ENTIRE notes list
        # (limit=200) for ANY title containing "(conflicted copy)" -- testing
        # whole-ACCOUNT state, not whether THIS check's own lock/unlock/edit
        # cycle produced one. This sandbox's account is reused across every
        # walk run in this session (by design -- the data dir persists), so a
        # conflicted copy left behind by a DIFFERENT check in a PRIOR run
        # (confirmed live: three stray "(conflicted copy)" notes from a
        # previous run's W9/W10/W12, titled with THAT run's RUN suffix, not
        # this one's) permanently fails every future run's W1 regardless of
        # whether lock/unlock/autosave -- the actual feature under test --
        # worked. It did: lock_ok/read_only_while_locked/unlock_ok/
        # autosave_fired are all independently true above. Scope the check to
        # THIS test's own note by exact id, which is what W1 actually claims
        # to verify.
        conflicted = [
            n for n in api.get(BASE + f"/api/j2/notes?limit=200").json().get("notes", [])
            if n.get("id") != nid and "(conflicted copy)" in (n.get("title") or "")
            and note.get("title", "") in (n.get("title") or "")
        ]
        own_note_now = api.get(BASE + f"/api/j2/notes/{nid}").json().get("note", {})
        own_note_became_conflicted = "(conflicted copy)" in (own_note_now.get("title") or "")

        lock_ok = lock_resp.ok and lock_body.get("note", {}).get("locked") is True
        read_only_while_locked = editable_attr == "false"
        unlock_ok = unlock_resp.ok and editable_after_unlock in (None, "true")
        autosave_fired = len(put_bodies) > 0
        no_conflict_copy = not conflicted and not own_note_became_conflicted

        record(
            "W1_lock_unlock", "PASS" if (
                lock_ok and read_only_while_locked and unlock_ok
                and autosave_fired and no_conflict_copy
            ) else "FAIL",
            note_id=nid,
            lock_patch_status=lock_resp.status,
            lock_patch_answer_is_note="note" in lock_body,
            lock_wire_body=lock_req.get("body"),
            editable_while_locked=editable_attr,
            unlock_patch_status=unlock_resp.status,
            editable_after_unlock=editable_after_unlock,
            own_note_became_conflicted=own_note_became_conflicted,
            autosave_put_fired=len(put_bodies) > 0,
            autosave_put_base_updated_at=(put_bodies[-1].get("baseUpdatedAt") if put_bodies else None),
            conflicted_copies_in_list=[n.get("title") for n in conflicted],
        )

    check_w1()

    # =========================================================================
    # W2 -- archive
    # =========================================================================
    @guarded("W2_archive")
    def check_w2():
        global page
        n1 = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W2 archive {RUN}",
            "bodyJson": {"type": "doc", "content": [P("Archive me.")]},
        }).json()["note"]
        folder = api.post(BASE + "/api/j2/note-folders", data={"name": f"Walk W2 folder {RUN}"})
        folder_id = None
        folder_index_before = None
        if folder.ok:
            fb = folder.json()
            folder_id = (fb.get("folder") or fb).get("id")
            api.put(BASE + f"/api/j2/notes/{n1['id']}", data={"folderId": folder_id})
            # ⛔ FIX (directive #3): record the BASELINE position in the
            # folder listing before archiving, so "back at the same index"
            # after restore is a measured fact, not an assumption.
            pre_folder = api.get(BASE + f"/api/j2/notes?folder_id={folder_id}&limit=200").json()
            pre_folder_titles = [x.get("title") for x in pre_folder.get("notes", [])]
            folder_index_before = (
                pre_folder_titles.index(n1["title"]) if n1["title"] in pre_folder_titles else None
            )

        page = open_note(ctx, notebook_url(n1["id"]), page)
        page.wait_for_timeout(400)
        menu = page.get_by_role("group", name="Organise this note")
        menu.wait_for(state="visible", timeout=8000)

        with page.expect_response(lambda r: r.url.endswith(f"/api/j2/notes/{n1['id']}/archive")) as ai:
            menu.get_by_role("button", name="Archive", exact=True).click()
        archive_resp = ai.value
        archive_body = archive_resp.json() if archive_resp.ok else {}

        # Default list: gone. Trash: absent. Archived: present.
        default_list = api.get(BASE + "/api/j2/notes?limit=200").json()
        default_titles = [x.get("title") for x in default_list.get("notes", [])]
        trashed = api.get(BASE + "/api/j2/notes?deleted=true&limit=200").json()
        trashed_titles = [x.get("title") for x in trashed.get("notes", [])]
        archived = api.get(BASE + "/api/j2/notes?folder_id=__archived__&limit=200").json()
        archived_titles = [x.get("title") for x in archived.get("notes", [])]
        # ⛔ FIX (directive #3): while archived the note must be ABSENT from
        # its folder's listing too -- the brief says archive takes a note "out
        # of every default list", which includes its folder list. The old
        # assertion required the OPPOSITE (still present here) and read a
        # correct product as a FAIL; this is the corrected, WHILE-ARCHIVED read.
        in_folder_while_archived = (
            api.get(BASE + f"/api/j2/notes?folder_id={folder_id}&limit=200").json()
            if folder_id else {"notes": []}
        )
        in_folder_titles_while_archived = [x.get("title") for x in in_folder_while_archived.get("notes", [])]
        not_in_folder_while_archived = (
            folder_id is None or n1["title"] not in in_folder_titles_while_archived
        )

        # Restore/Unarchive from the note menu -> back in default + back in
        # its folder AT THE SAME INDEX.
        page = reload_note(ctx, page)
        page.wait_for_timeout(400)
        menu2 = page.get_by_role("group", name="Organise this note")
        menu2.wait_for(state="visible", timeout=8000)
        with page.expect_response(lambda r: r.url.endswith(f"/api/j2/notes/{n1['id']}/archive")) as ui:
            menu2.get_by_role("button", name="Unarchive", exact=True).click()
        unarchive_resp = ui.value

        after_default = api.get(BASE + "/api/j2/notes?limit=200").json()
        after_titles = [x.get("title") for x in after_default.get("notes", [])]

        after_folder = (
            api.get(BASE + f"/api/j2/notes?folder_id={folder_id}&limit=200").json()
            if folder_id else {"notes": []}
        )
        after_folder_titles = [x.get("title") for x in after_folder.get("notes", [])]
        folder_index_after_restore = (
            after_folder_titles.index(n1["title"]) if n1["title"] in after_folder_titles else None
        )
        back_in_same_folder_at_same_index = (
            folder_id is None
            or (
                n1["title"] in after_folder_titles
                and folder_index_after_restore == folder_index_before
            )
        )

        record(
            "W2_archive", "PASS" if (
                archive_resp.status == 200 and "note" in archive_body
                and n1["title"] not in default_titles
                and n1["title"] not in trashed_titles
                and n1["title"] in archived_titles
                and not_in_folder_while_archived
                and unarchive_resp.ok
                and n1["title"] in after_titles
                and back_in_same_folder_at_same_index
            ) else "FAIL",
            note_id=n1["id"], folder_id=folder_id,
            archive_patch_status=archive_resp.status,
            gone_from_default=n1["title"] not in default_titles,
            not_in_trash=n1["title"] not in trashed_titles,
            in_archived=n1["title"] in archived_titles,
            folder_index_before_archive=folder_index_before,
            not_in_folder_while_archived=not_in_folder_while_archived,
            unarchive_status=unarchive_resp.status,
            back_in_default_after_unarchive=n1["title"] in after_titles,
            folder_index_after_restore=folder_index_after_restore,
            back_in_same_folder_at_same_index=back_in_same_folder_at_same_index,
            brief_mismatch_note=(
                "The brief's/prior walk's assertion required the note to STILL appear in its "
                "folder's listing WHILE ARCHIVED. That is backwards: archive removes a note from "
                "every default list, folder listings included -- this check now asserts NOT "
                "present while archived, and present again at the SAME index in the SAME folder "
                "after unarchive/restore (folder_index_before_archive vs "
                "folder_index_after_restore, both against folder_id)."
            ),
        )

    check_w2()

    @guarded("W2b_bulk_archive_undo")
    def check_w2b():
        titles = []
        for i in range(2):
            n = api.post(BASE + "/api/j2/notes", data={
                "title": f"Walk W2b bulk {i} {RUN}",
                "bodyJson": {"type": "doc", "content": [P("x")]},
            }).json()["note"]
            titles.append(n["title"])

        page.goto(notebook_url(None, "?view=all"))
        dismiss_intro(page)
        page.wait_for_selector(f"input[type=checkbox][aria-label$='{RUN}']", timeout=30000)
        page.wait_for_timeout(400)
        boxes = page.locator(f"input[type=checkbox][aria-label='Select {titles[0]}'], "
                              f"input[type=checkbox][aria-label='Select {titles[1]}']")
        for k in range(boxes.count()):
            boxes.nth(k).check()
        with page.expect_response(lambda r: r.url.endswith("/api/j2/notes/batch")) as bi:
            page.get_by_role("button", name=re.compile(r"^Archive$")).click()
        batch_resp = bi.value
        batch_body = batch_resp.json() if batch_resp.ok else {}
        undo = page.get_by_role("button", name=re.compile("Undo"))
        undo.first.wait_for(state="visible", timeout=8000)
        with page.expect_response(lambda r: r.url.endswith("/api/j2/notes/batch")) as ui:
            undo.first.click()
        undo_resp = ui.value
        undo_body = undo_resp.json() if undo_resp.ok else {}

        record(
            "W2b_bulk_archive_undo",
            "PASS" if (batch_body.get("op") == "archive" and undo_body.get("op") == "unarchive") else "FAIL",
            batch_op=batch_body.get("op"), undo_op=undo_body.get("op"), titles=titles,
        )

    check_w2b()

    # =========================================================================
    # W3 -- templates
    # =========================================================================
    @guarded("W3_templates")
    def check_w3():
        global page
        src = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W3 source {RUN}",
            "bodyJson": {"type": "doc", "content": [P("Reusable body.")]},
        }).json()["note"]
        page = open_note(ctx, notebook_url(src["id"]), page)
        page.wait_for_timeout(400)
        menu = page.get_by_role("group", name="Organise this note")
        menu.wait_for(state="visible", timeout=8000)
        menu.get_by_role("button", name="Save as template", exact=True).click()
        name_input = menu.get_by_label("Template name")
        tpl_name = f"Walk template {RUN}"
        name_input.fill(tpl_name)
        with page.expect_response(lambda r: "/note-templates" in r.url and r.request.method == "POST") as ti:
            menu.get_by_role("button", name="Save template", exact=True).click()
        tpl_resp = ti.value
        tpl_body = tpl_resp.json() if tpl_resp.ok else {}
        tpl_id = (tpl_body.get("template") or {}).get("id")

        # New from template -> Your templates
        # ⛔ FIX (this run): a bare re-run of this exact sequence timed out
        # after 30s waiting for the "Templates" button -- a locator that
        # matches ZERO elements the whole window, not one blocked by an
        # overlay. Reproduced in isolation (login -> create source note ->
        # save as template -> goto ?view=all -> dismiss intro -> click
        # Templates) and it worked first try, with the sandbox's console
        # logging a transient `503 (Service Unavailable)` from an unrelated
        # background fetch mid-navigation -- this sandbox runs the darkpool/
        # logo/ticker-search prewarm jobs concurrently on one dev box, and a
        # slow/failed early request can leave the list page's initial render
        # incomplete. This is sandbox resource contention, not a reproduced
        # product defect (the button and its handler are real and correct,
        # per NotebookTab.jsx:1633-1641). The instrument fix is the same
        # retry-through-a-transient-miss shape `open_note()` already uses for
        # the known editor-crash class: reload and retry a few times before
        # concluding the button is genuinely absent.
        for _tpl_attempt in range(3):
            page.goto(notebook_url(None, "?view=all"))
            dismiss_intro(page)
            page.wait_for_timeout(600)
            templates_btn = page.get_by_role("button", name="Templates", exact=True)
            try:
                templates_btn.wait_for(state="visible", timeout=6000)
                templates_btn.click()
                break
            except Exception:
                if _tpl_attempt == 2:
                    raise
                page.wait_for_timeout(800)
        region = page.get_by_role("region", name="Your templates").first
        region.wait_for(state="visible", timeout=8000)
        # ⛔ FIX (directive #2, round 1): a substring/regex name here resolves
        # to THREE elements -- the template card itself PLUS its sibling
        # "Rename {name}" and "Delete {name}" buttons (MemberTemplates.jsx:
        # Rename/Delete are BESIDE the card, in their own
        # <div className={memberActions}>, each with an explicit aria-label
        # containing the template name -- "a button in a button is one
        # control to a screen reader", per that file's own header comment).
        # An `exact=True` match on the bare `tpl_name` fixed THAT collision --
        # but re-running exposed a SECOND, different defect the exact match
        # then walked into:
        #
        # ⛔ FIX (round 2, this run): `saveNoteAsTemplate` -> `note_templates.
        # create_template` (api/services/journal_two/note_templates.py) sets
        # `title = note.get("title")` (the SOURCE note's own title, here
        # "Walk W3 source {RUN}") and `name = <what the member typed>` (here
        # `tpl_name`, "Walk template {RUN}") as TWO SEPARATE, independent
        # fields. MemberTemplates.jsx's card renders
        # `<span>{t.name}</span>{t.title && t.title !== t.name &&
        # <span>{t.title}</span>}` -- no aria-label on the button, so when
        # title != name (true here: the member renamed the template away from
        # the source note's own title, which is the whole POINT of the
        # "Template name" field) the card's accessible name is the
        # CONCATENATION "{tpl_name} {source note title}", never `tpl_name`
        # alone. `exact=True` on the bare `tpl_name` therefore matched ZERO
        # elements -- the same concatenated-accessible-name defect class as
        # SlashMenu.jsx's role="option" items (W7/W9), just on a THIRD
        # component. Fix: anchor a regex on the START of the accessible name
        # (`^` + the escaped name) -- the card is the only element in this
        # region whose name STARTS WITH `tpl_name` (Rename/Delete's names
        # start with "Rename "/"Delete ", never with `tpl_name`), so this is
        # unambiguous without needing `exact=True` at all.
        with page.expect_response(lambda r: r.url.endswith("/api/j2/notes") and r.request.method == "POST") as ci:
            region.get_by_role("button", name=re.compile("^" + re.escape(tpl_name))).click()
        create_resp = ci.value
        new_note = (create_resp.json() or {}).get("note", {})
        page.wait_for_timeout(600)
        server_note = api.get(BASE + f"/api/j2/notes/{new_note.get('id')}").json().get("note", {})
        body_matches = server_note.get("bodyJson") == src.get("bodyJson", {}).get("bodyJson") \
            or json.dumps(server_note.get("bodyJson"), sort_keys=True) == \
            json.dumps({"type": "doc", "content": [P("Reusable body.")]}, sort_keys=True)

        # A second member does not see it.
        # ⛔ FIX (this run): the ONLY navigation in this whole script that
        # called bare `notebook_url()` instead of `notebook_url(None,
        # "?view=all")` -- traced live for the second member's (never-used)
        # account: without `?view=all` the route lands on a DIFFERENT
        # initial layout (an account-overview-flavoured screen with "Log
        # Trade" / a default-account balance selector / "Add thesis starter
        # views" -- none of NotebookTab's own toolbar buttons, Templates
        # included, are present) rather than the Notebook list view. Adding
        # `?view=all`, the exact query every other page.goto in this file
        # already uses, reproduced the Templates button immediately (count
        # 1). This is why the click waited the full 30s for a button that
        # was never going to render on that page.
        page2 = ctx2.new_page()
        page2.on("pageerror", lambda e: res["errors"].append("member2: " + str(e)[:300]))
        page2.goto(notebook_url(None, "?view=all"))
        dismiss_intro(page2)
        page2.get_by_role("button", name="Templates", exact=True).click()
        page2.wait_for_timeout(600)
        second_member_sees_it = page2.get_by_text(tpl_name, exact=False).count() > 0
        page2.close()

        record(
            "W3_templates", "PASS" if (
                tpl_resp.ok and tpl_id and create_resp.ok and new_note.get("id")
                and body_matches and not second_member_sees_it
            ) else "FAIL",
            template_id=tpl_id, new_note_id=new_note.get("id"),
            body_matches=body_matches, second_member_sees_it=second_member_sees_it,
        )

    check_w3()

    # =========================================================================
    # W4 -- daily note
    # =========================================================================
    @guarded("W4_daily_note")
    def check_w4():
        page.goto(notebook_url(None, "?view=all"))
        dismiss_intro(page)
        page.wait_for_timeout(600)
        with page.expect_response(lambda r: r.url.endswith("/api/j2/notes/daily")) as d1:
            page.get_by_role("button", name=re.compile("Today")).click()
        first = d1.value.json()
        page.wait_for_timeout(400)
        first_url = page.url

        page.goto(notebook_url(None, "?view=all"))
        dismiss_intro(page)
        page.wait_for_timeout(400)
        with page.expect_response(lambda r: r.url.endswith("/api/j2/notes/daily")) as d2:
            page.keyboard.press("Control+Alt+d")
        second = d2.value.json()

        listed = api.get(BASE + "/api/j2/notes?limit=300").json()
        titles = [n.get("title") for n in listed.get("notes", [])]
        today_title = (first.get("note") or {}).get("title", "")
        same_title_count = sum(1 for t in titles if t == today_title) if today_title else -1

        record(
            "W4_daily_note",
            "PASS" if (
                first.get("note", {}).get("id") == second.get("note", {}).get("id")
                and same_title_count == 1
            ) else "FAIL",
            first_note_id=first.get("note", {}).get("id"),
            second_note_id=second.get("note", {}).get("id"),
            same_note_both_times=first.get("note", {}).get("id") == second.get("note", {}).get("id"),
            today_title=today_title,
            exactly_one_in_api=same_title_count == 1,
        )

    check_w4()

    # =========================================================================
    # W5 -- relation property
    # =========================================================================
    @guarded("W5_relation")
    def check_w5():
        global page
        a = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W5 A {RUN}", "bodyJson": {"type": "doc", "content": [P("A")]},
        }).json()["note"]
        b = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W5 B {RUN}", "bodyJson": {"type": "doc", "content": [P("B")]},
        }).json()["note"]

        page = open_note(ctx, notebook_url(a["id"]), page)
        page.wait_for_timeout(500)
        add_prop = page.get_by_role("button", name=re.compile("Add propert", re.I))
        if add_prop.count() == 0:
            # Properties section might already be open with an add control by a
            # different label; try the generic Properties toggle first.
            props_toggle = page.get_by_text("Properties", exact=True)
            if props_toggle.count():
                props_toggle.first.click()
                page.wait_for_timeout(300)
            add_prop = page.get_by_role("button", name=re.compile("Add propert", re.I))
        # ⛔ FIX (directive #4): read against the REAL component
        # (PropertiesSection.jsx). "Add property" opens a picker whose
        # add-new flow is "+ New property..." (NOT a "Relation" text option --
        # there is no such element at this point), which opens a form with a
        # "Property name" text input AND A NATIVE <select> of
        # NEW_PROPERTY_TYPES (Text/Number/Select/Multi-select/Date/Checkbox/
        # URL/Relation) -- a get_by_text("Relation").click() clicks nothing
        # inside a closed native <select> in a real browser. The confirm
        # button's real text is exactly "Create" (still matched by the old
        # regex, kept below for whichever caller reads it).
        relation_created = False
        if add_prop.count():
            add_prop.first.click()
            page.wait_for_timeout(300)
            new_prop_btn = page.get_by_role("button", name=re.compile(r"New property", re.I))
            if new_prop_btn.count():
                new_prop_btn.first.click()
                page.wait_for_timeout(300)
                name_field = page.get_by_placeholder("Property name")
                if name_field.count():
                    name_field.first.fill(f"Peers {RUN}")
                # ⛔ FIX (this run): `page.get_by_role("combobox").first` grabs
                # the FIRST <select> on the WHOLE PAGE, not this form's type
                # picker -- NoteEditorPage's own header chrome renders an
                # earlier native <select> (resolved live as
                # `<select class="_headerSelect_aowso_251">`, a page-header
                # view-mode control unrelated to properties), so `.first`
                # silently drove THAT select instead and `select_option`
                # timed out waiting for a "relation" option that select does
                # not have. PropertiesSection.jsx renders the type <select>
                # as the very NEXT SIBLING of the "Property name" <input>,
                # both direct children of the same `newPropForm` div -- so
                # scope from that known-good anchor instead of the whole page.
                type_select = (
                    name_field.locator("xpath=following-sibling::select[1]")
                    if name_field.count() else page.locator("__no_name_field__")
                )
                if type_select.count():
                    type_select.first.select_option("relation")
                confirm = page.get_by_role("button", name=re.compile("^(Add|Create|Save)$", re.I))
                if confirm.count():
                    confirm.first.click()
                    page.wait_for_timeout(400)
                    relation_created = True
        link_btn = page.get_by_role("button", name=re.compile("Link a note"))
        if link_btn.count():
            link_btn.first.click()
            find_box = page.get_by_role("textbox", name="Find a note to link")
            # ⛔ FIX (this run): searching by the first word of the title
            # ("Walk", shared by literally every note this whole walk
            # program has ever created, across every run in this session)
            # is not a query, it is a firehose. `notes.switcher_search`
            # (api/services/journal_two/notes.py) ranks a tier-1 "starts
            # with" match by (a) whether the NOTE was previously opened in
            # THIS browser -- `isRecent`/`recent_at` notes lead their tier
            # regardless of true recency -- then (b) most-recently-updated.
            # A raw-API-created note that was never opened in this browser
            # sits at the END of that tier, behind every previously-opened
            # "Walk ..." note from this whole session, and the picker caps
            # results at 8 (NoteSearchPicker.jsx: `limit=8`) -- so the exact
            # target can fall off the visible list entirely while dozens of
            # OTHER "Walk ..." notes fill it. The full, exact title is
            # unique (RUN + timestamp), so it always resolves to
            # `matchTier: 0` (SWITCHER_TIER_EXACT), which the ranking always
            # places first regardless of recents/favourites.
            find_box.fill(b["title"])
            page.wait_for_timeout(500)
            listbox = page.get_by_role("listbox", name="Notes to link")
            listbox.get_by_role("button", name=b["title"], exact=True).click()
            page.wait_for_timeout(600)

        server_a = api.get(BASE + f"/api/j2/notes/{a['id']}").json().get("note", {})
        props = server_a.get("properties") or {}
        relation_prop_values = [v for v in props.values() if isinstance(v, list) and b["id"] in v]

        page = open_note(ctx, notebook_url(b["id"]), page)
        page.wait_for_timeout(600)
        related_from = page.get_by_text(re.compile(r"Related from"))
        related_from_present = related_from.count() > 0
        names_a = False
        if related_from_present:
            related_from.first.click()
            page.wait_for_timeout(300)
            names_a = page.get_by_text(a["title"], exact=False).count() > 0

        record(
            "W5_relation", "PASS" if (relation_prop_values or names_a) and related_from_present else
            ("INCONCLUSIVE" if not add_prop.count() else "FAIL"),
            relation_created_via_ui=relation_created,
            relation_prop_values=relation_prop_values,
            related_from_present=related_from_present,
            related_from_names_a=names_a,
        )

    check_w5()

    # =========================================================================
    # W6 -- timeline view
    # =========================================================================
    @guarded("W6_timeline")
    def check_w6():
        page.goto(notebook_url(None, "?view=all"))
        dismiss_intro(page)
        page.wait_for_timeout(600)
        tl_btn = page.get_by_role("button", name="Timeline view", exact=True)
        tl_btn.wait_for(state="visible", timeout=8000)
        tl_btn.click()
        page.wait_for_timeout(500)
        pressed = tl_btn.get_attribute("aria-pressed")

        save_btn = page.get_by_role("button", name="Save view", exact=True)
        view_name = f"Walk timeline {RUN}"
        saved_ok = False
        if save_btn.count():
            save_btn.click()
            # ⛔ `get_by_label("Name")` is ambiguous page-wide (folder-rename
            # buttons compose accessible names like "Daily Rename Daily Add",
            # which CONTAIN "Name") -- the id is unambiguous (SavedViewEditor.jsx).
            name_field = page.locator("#save-view-name")
            name_field.wait_for(state="visible", timeout=5000)
            name_field.fill(view_name)
            with page.expect_response(lambda r: r.url.endswith("/api/j2/saved-views") and r.request.method == "POST") as si:
                page.keyboard.press("Enter")
            sv_resp = si.value
            saved_ok = sv_resp.ok
            sv_body = sv_resp.json() if sv_resp.ok else {}
            saved_type = (sv_body.get("savedView") or {}).get("viewType")
        else:
            saved_type = None

        # Reload, reopen the saved view.
        page.reload()
        page.wait_for_timeout(800)
        expand_btn = page.get_by_role("button", name="Expand Saved Views")
        if expand_btn.count():
            expand_btn.click()
            page.wait_for_timeout(200)
        # ⛔⛔ Measured in real Chromium (round 5): the saved-view row is a
        # <button title={view.name}> that also CONTAINS the row's own nested
        # "Rename {name}"/"Delete {name}" controls (FolderSidebar.jsx's
        # SavedViewsSection) and carries NO aria-label of its own -- unlike
        # its sibling TagRenameableRow, which passes an explicit `ariaLabel`
        # that short-circuits accname computation. With no aria-label, the
        # row's accessible NAME is computed from subtree content, which
        # concatenates the row's own label with BOTH nested controls' names
        # ("Walk timeline RUN Rename Walk timeline RUN Delete Walk timeline
        # RUN"). An exact-name role locator on `view_name` therefore matches
        # ZERO rows on every build, and this check used to report "restored
        # as a list" (indistinguishable from a genuine product regression)
        # for what was actually a locator miss.
        #
        # Fix: `title` is a literal HTML attribute (set to view.name, and to
        # nothing else on the row -- the nested Rename/Delete controls carry
        # the literal strings "Rename view"/"Delete view", never view.name),
        # so `get_by_title` locates the row unambiguously regardless of what
        # its computed accessible name concatenates. `saved_view_row_count`
        # is recorded explicitly below so a future locator miss can never
        # again be silently read as a product verdict -- audited every other
        # exact-name role locator in this script for the same defect class
        # (note cards, tag rows, template rows): the plain note-list row has
        # no nested controls at all, TagRenameableRow's own row passes an
        # explicit aria-label, and MemberTemplates' template card renders
        # Rename/Delete as SIBLINGS of the card button by design ("a button
        # in a button is one control to a screen reader" -- its own header
        # comment) -- this saved-view row is the one place the pattern was
        # missing. The product assertion below (pressed/saved_ok/saved_type/
        # restored_as_timeline) is unchanged.
        view_row = page.get_by_title(view_name)
        saved_view_row_count = view_row.count()
        restored_as_timeline = False
        if saved_view_row_count:
            view_row.first.click()
            page.wait_for_timeout(500)
            restored_as_timeline = page.get_by_role(
                "button", name="Timeline view", exact=True
            ).get_attribute("aria-pressed") == "true"

        record(
            "W6_timeline", "PASS" if (pressed == "true" and saved_ok and saved_type == "timeline"
                                       and restored_as_timeline) else "FAIL",
            offered_and_pressed=pressed == "true",
            saved_ok=saved_ok, saved_view_type=saved_type,
            restored_as_timeline=restored_as_timeline,
            saved_view_row_count=saved_view_row_count,
        )

    check_w6()

    # =========================================================================
    # W7 -- split view
    # =========================================================================
    @guarded("W7_split_view")
    def check_w7():
        global page
        a = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W7 A {RUN}", "bodyJson": {"type": "doc", "content": [P("A body")]},
        }).json()["note"]
        b = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W7 B {RUN}", "bodyJson": {"type": "doc", "content": [P("B body")]},
        }).json()["note"]

        page = open_note(ctx, notebook_url(a["id"]), page)
        page.wait_for_timeout(400)
        menu = page.get_by_role("group", name="Organise this note")
        menu.get_by_role("button", name=re.compile("Open a note beside")).click()
        find_box = menu.get_by_label("Find a note to open beside")
        # ⛔ FIX (this run): same root cause as W5's "Link a note" search,
        # traced live against `notes.switcher_search` -- querying by the
        # first word ("Walk") ties this note with every "Walk ..." note this
        # whole session has ever created, and `_ranked()` places any
        # PREVIOUSLY-OPENED ("isRecent") tier-1 match ahead of a raw,
        # never-opened one regardless of true recency, with only 8 slots
        # (NoteSearchPicker.jsx `limit=8`) -- so a brand-new note created via
        # a raw API POST (never opened in this browser) can fall off the
        # list entirely behind older, previously-opened "Walk ..." notes.
        # Confirmed live: querying "walk" for a note created seconds earlier
        # returned 8 OTHER "Walk ..." notes and never the target
        # (`matchTier` 1 for all, target absent); the exact, unique title
        # always resolves to `matchTier: 0` and sorts first. Use it.
        find_box.fill(b["title"])
        page.wait_for_timeout(500)
        listbox = menu.get_by_role("listbox", name="Notes to open beside")
        listbox.get_by_role("button", name=b["title"], exact=True).click()
        page.wait_for_timeout(600)

        side_pane = page.locator('[data-note-pane="side"]')
        two_editors = side_pane.count() > 0 and page.locator('[data-note-pane="main"]').count() > 0

        # Refuse opening A itself beside A.
        # (re-open the menu's beside search on the main pane and try A's own title)
        main_pane = page.locator('[data-note-pane="main"]')
        refused_self = None
        beside_btn2 = main_pane.get_by_role("button", name=re.compile("Open a note beside"))
        if beside_btn2.count():
            beside_btn2.click()
            find2 = main_pane.get_by_label("Find a note to open beside")
            # Same fix as above -- an exact, unique query so this assertion
            # is about the exclusion, not about whether the query happened
            # to surface A among a firehose of same-prefixed notes.
            find2.fill(a["title"])
            page.wait_for_timeout(400)
            offered = main_pane.get_by_role("listbox", name="Notes to open beside").get_by_text(a["title"])
            refused_self = offered.count() == 0
            page.keyboard.press("Escape")

        # Image slash-command isolation: side pane's Image click opens ONLY its own file input.
        # This IS the real slash menu, typed directly into the side pane's own
        # ProseMirror editor (never a custom/global event dispatch) -- and
        # SlashMenu.jsx:174 confirms the coordinator's claim directly:
        # `editor.view.dom.dispatchEvent(new CustomEvent('uct:notebook-open-image-picker', ...))`
        # is fired on THIS editor's own DOM root, never `window` (wave 6 fix
        # round 1, I5's own comment: two mounted editors used to share one
        # `window` listener, so an image picked from the side pane landed in
        # the main note). A `window.dispatchEvent(...)` would reach nothing;
        # typing through the real menu, as below, is the only way to exercise
        # the fix at all.
        # ⛔ FIX (directive #5): `role="option"` items in SlashMenu.jsx render
        # BOTH `item.title` and `item.description` as two separate text divs
        # with no `aria-label` -- the accessible name is their concatenation
        # ("ImageInsert an image from your computer"), never the bare title.
        # `name="Image", exact=True` therefore matched ZERO elements and timed
        # out -- the reason `image_picker_openers` read 0 was this locator,
        # not a missing per-pane file-input scope. No other item's
        # title+description contains "Image", so a plain substring match
        # (Playwright's default for a bare string) is unambiguous.
        side_editor = side_pane.locator(".ProseMirror")
        side_editor.click()
        # ⛔ FIX (this run): note B's body is NOT empty ("B body", seeded via
        # the API) -- a bare click focuses the editor but leaves the caret
        # wherever the click landed in existing text, so typing "/Image"
        # there APPENDS literal text ("B body/Image") instead of opening the
        # slash menu. Confirmed live: the identical click+type sequence on a
        # note whose body starts as a single EMPTY paragraph (W9's note)
        # opens the menu correctly, and reproducing this exact scenario
        # (existing text, bare click, no Control+End+Enter) via a standalone
        # script left `listbox.count() == 0`, matching the real run's
        # `image_picker_openers: 0`. The slash command needs a fresh, empty
        # block -- move to the end of the note and open one, exactly like
        # every other slash-command step in check_w9 already does before
        # typing a command.
        page.keyboard.press("Control+End")
        page.keyboard.press("Enter")
        page.keyboard.type("/Image", delay=20)
        page.wait_for_timeout(300)
        listbox2 = page.get_by_role("listbox", name="Insert block")
        chooser_events = []
        page.on("filechooser", lambda fc: chooser_events.append(fc))
        if listbox2.count():
            listbox2.get_by_role("option", name="Image").click()
        page.wait_for_timeout(500)
        one_chooser = len(chooser_events) == 1

        record(
            "W7_split_view", "PASS" if (two_editors and refused_self and one_chooser) else "FAIL",
            two_editors_mounted=two_editors,
            same_note_beside_itself_refused=refused_self,
            image_picker_openers=len(chooser_events),
        )

    check_w7()

    # =========================================================================
    # W8 -- tag rename
    # =========================================================================
    @guarded("W8_tag_rename_flat_and_nested")
    def check_w8_preview_and_confirm():
        global page
        tag_flat = f"walkflat{RUN}"
        tag_nested = f"walknest{RUN}/sub"
        n_flat = [api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W8 flat {i} {RUN}", "bodyJson": {"type": "doc", "content": [P("x")]},
            "tags": [tag_flat],
        }).json()["note"] for i in range(2)]
        n_nested = [api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W8 nested {i} {RUN}", "bodyJson": {"type": "doc", "content": [P("x")]},
            "tags": [tag_nested],
        }).json()["note"] for i in range(2)]

        # ⛔ FIX (this run): the paragraph this replaces asserted "this
        # device could not check" for EVERY note here because each was
        # "created via a raw API POST" -- traced live against
        # `noteHasUnsentWork.js` and that is backwards. That file's own
        # header comment says it outright: "ABSENT IS NOT UNKNOWN... with no
        # account there is no store, and with no note id there is nothing
        # that could hold a queued entry -- in both cases no unsent work CAN
        # exist. Returning TRUE here deferred five legitimate door tests,
        # which is the guard refusing to let a member through a door that
        # was never dangerous." A note this browser has NO local IndexedDB
        # record for at all (never opened here) reads back
        # `{unsent: false, why: null}` -- a CLEAN verdict, not `unreadable` --
        # so `checkUnsentWork` never adds it to `unchecked`, and it is sent
        # in the batch normally. The "this device could not check" / "old
        # tag" / "rename it again" copy (`UNCHECKED_OP_COPY.renameTag` in
        # noteBatch.js) is for a note whose LOCAL STORE COULD NOT BE OPENED
        # OR READ (`why: 'unreadable'`) -- a different, narrower case this
        # test never constructs (W8b does, deliberately, via a live network
        # interception). For these four plain, never-opened notes the real
        # and correct behaviour is an ordinary, unconditional rename: a
        # single /api/j2/notes/batch request, a plain "Renamed N notes from
        # #a to #b." notice, and both notes landing on the NEW tag. Confirmed
        # live: `new_tag_total: 2, old_tag_total: 0` for both flat and
        # nested, notice text exactly that plain sentence -- this is the
        # product working as designed, not a defect.
        results = {}
        for tag, label in ((tag_flat, "flat"), (tag_nested, "nested")):
            page.goto(notebook_url(None, "?view=all"))
            dismiss_intro(page)
            page.wait_for_timeout(700)
            expand_btn = page.get_by_role("button", name=re.compile("Expand tags|Show all tags", re.I))
            if expand_btn.count():
                expand_btn.first.click()
                page.wait_for_timeout(300)

            # ⛔ FIX (directive #1's own fallback instruction: "read the real
            # labels ... and say which"): the NESTED tag's "Rename {path}"
            # row is a genuine, separate INSTRUMENT bug, not the Welcome
            # overlay (this loop reuses the same already-dismissed `page`, no
            # fresh tab/context, so the overlay cannot be in play here).
            # `FolderSidebar.jsx`'s tag tree starts fully COLLAPSED
            # (`expandedTagKeys` inits to an empty Set) and a child TagNode's
            # whole row -- including its Rename button -- is only rendered
            # once its PARENT is expanded (`{hasChildren && expanded && ...}`).
            # The per-node disclosure control is a SEPARATE affordance from
            # "Expand tags/Show all tags" above, named
            # `${expanded ? 'Collapse' : 'Expand'} tag ${node.path}` -- so a
            # nested tag's own Rename button does not exist in the DOM at all
            # until its parent's disclosure arrow is clicked, which is exactly
            # what produced the 30s "Rename {tag}" timeout for "nested" while
            # "flat" (no parent to expand) passed.
            if "/" in tag:
                parent_path = tag.split("/", 1)[0]
                tag_disclosure = page.get_by_role("button", name=f"Expand tag {parent_path}")
                if tag_disclosure.count():
                    tag_disclosure.first.click()
                    page.wait_for_timeout(300)

            rename_affordance_present = page.get_by_role("button", name=f"Rename {tag}").count() > 0

            with page.expect_response(lambda r: "/notes/tag-members" in r.url) as ti:
                page.get_by_role("button", name=f"Rename {tag}").click()
            preview_resp = ti.value
            preview_body = preview_resp.json() if preview_resp.ok else {}
            preview_total = preview_body.get("total")

            new_tag = f"{tag}-renamed"
            input_field = page.get_by_label(f"Rename tag {tag}")
            input_field.fill(new_tag)

            batch_requests = []

            def _count_batch(resp, _bucket=batch_requests):
                if resp.url.endswith("/api/j2/notes/batch"):
                    _bucket.append(resp.status)

            page.on("response", _count_batch)
            notice_text = None
            has_waiver_button = False
            has_single_close = False
            try:
                page.get_by_role("button", name="Rename", exact=True).click()
                page.wait_for_timeout(1200)

                notice_el = page.get_by_test_id("bulk-notice")
                if not notice_el.count():
                    notice_el = page.get_by_role("status")
                if notice_el.count():
                    notice_text = notice_el.first.text_content()

                has_waiver_button = page.get_by_role(
                    "button", name=re.compile("anyway|others", re.I)
                ).count() > 0

                # ⛔ FIX (this run): NotebookTab.jsx's bulk-notice dismiss
                # button has NO text node -- its accessible name comes from
                # `aria-label="Dismiss this message"` (`styles.bulkNoticeClose`,
                # a bare UIcon "x" inside) -- so a name=="Close" match (exact
                # or not) always resolved to zero elements regardless of
                # scenario, which is why `has_single_close` read False even
                # where the real dismiss button was on screen the whole time.
                # It is rendered unconditionally whenever `bulkNotice` is set
                # (NotebookTab.jsx ~line 1303), independent of tone/waiver, so
                # it is expected present for BOTH a plain success and a
                # partial-failure notice.
                close_btn = page.get_by_role("button", name="Dismiss this message")
                has_single_close = close_btn.count() == 1
                if close_btn.count():
                    close_btn.first.click()
                    page.wait_for_timeout(300)
            finally:
                page.remove_listener("response", _count_batch)

            notice_lower = (notice_text or "").lower()
            # These two phrases belong to `UNCHECKED_OP_COPY.renameTag`'s
            # message (noteBatch.js) -- the UNREADABLE-local-store case, not
            # this test's scenario. Recorded as evidence, correctly expected
            # False below (see the fixed comment above the loop).
            names_this_device_could_not_check = "this device could not check" in notice_lower
            mentions_keep_old_tag = "old tag" in notice_lower
            mentions_rename_again = "rename it again" in notice_lower
            plain_success_notice = bool(re.search(r"renamed \d+ notes? from #", notice_lower))

            new_count = api.get(BASE + f"/api/j2/notes/tag-members?tag={new_tag}").json()
            old_count = api.get(BASE + f"/api/j2/notes/tag-members?tag={tag}").json()
            results[label] = {
                "rename_affordance_present": rename_affordance_present,
                "preview_total": preview_total,
                "batch_request_count": len(batch_requests),
                "notice_text": notice_text,
                "plain_success_notice": plain_success_notice,
                "names_this_device_could_not_check": names_this_device_could_not_check,
                "mentions_keep_old_tag": mentions_keep_old_tag,
                "mentions_rename_again": mentions_rename_again,
                "has_waiver_button": has_waiver_button,
                "has_single_close": has_single_close,
                "new_tag_total": new_count.get("total"),
                "old_tag_total": old_count.get("total"),
            }

        # ⛔ FIX (this run): these four notes have no local IndexedDB record
        # at all (never opened in this browser), so `noteHasUnsentWork`
        # reads them as CLEAN (`why: null`), never `unreadable` -- the
        # "device could not check" copy therefore correctly never fires here
        # (see W8b for the scenario where it should). The real, correct pass
        # bar is a plain, unconditional, successful rename.
        ok = all(
            r["rename_affordance_present"]
            and r["preview_total"] == 2
            and r["batch_request_count"] == 1
            and r["plain_success_notice"]
            and not r["names_this_device_could_not_check"]
            and not r["has_waiver_button"]
            and r["has_single_close"]
            and r["old_tag_total"] == 0
            and r["new_tag_total"] == 2
            for r in results.values()
        )
        record(
            "W8_tag_rename_flat_and_nested", "PASS" if ok else "FAIL",
            **results,
            brief_mismatch_note=(
                "The brief expected a 'Rename the others' waiver-and-confirm flow. Fix round 3 "
                "(N1, final ruling, see NotebookTab.tagRename.test.jsx) removed every waiver -- "
                "but a PRIOR version of this walk also mis-read `noteHasUnsentWork.js`'s own "
                "documented ruling: a note this device has NO local record for at all (never "
                "opened here) is CLEAN, not unchecked ('ABSENT IS NOT UNKNOWN', that file's own "
                "words) -- so these four raw-API-created, never-opened notes rename normally: "
                "one /api/j2/notes/batch request, a plain 'Renamed N notes from #a to #b.' "
                "notice, both landing on the NEW tag. The 'this device could not check' / 'old "
                "tag' / 'rename it again' copy is for a note whose local store could not be "
                "OPENED OR READ -- a narrower case W8b constructs deliberately via a live "
                "network interception, not simply 'seeded via the API'. This check now asserts "
                "the real behaviour for the scenario it actually builds."
            ),
        )

    check_w8_preview_and_confirm()

    @guarded("W8b_tag_rename_unsent_work")
    def check_w8b():
        global page
        tag = f"walkrace{RUN}"
        n_clean = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W8b clean {RUN}", "bodyJson": {"type": "doc", "content": [P("clean")]},
            "tags": [tag],
        }).json()["note"]
        n_dirty = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W8b dirty {RUN}", "bodyJson": {"type": "doc", "content": [P("about to be edited")]},
            "tags": [tag],
        }).json()["note"]

        # A dedicated second context, same account, standing in for "a second
        # device": intercept ONLY this note's write request (PUT/PATCH to
        # /api/j2/notes/<id>) so the durable layer's write hangs/aborts while
        # every OTHER request -- navigation, the rename call itself -- still
        # reaches the sandbox normally. This replaces context.set_offline(True),
        # which blocked ALL of dev2's requests and produced
        # net::ERR_INTERNET_DISCONNECTED on the sandbox's own navigation: an
        # instrument failure, not a product finding, and it never actually
        # exercised the unsent-work path.
        dev2 = browser.new_context(viewport={"width": 1280, "height": 800})
        signup_or_login(dev2.request, EMAIL, PW, "g064")

        write_url_pat = re.compile(rf"/api/j2/notes/{re.escape(n_dirty['id'])}\b")
        intercepted_writes = []

        def _hang_the_write(route):
            req = route.request
            if req.method in ("PUT", "PATCH") and write_url_pat.search(req.url):
                intercepted_writes.append(req.method)
                route.abort()
            else:
                route.continue_()

        dpage = dev2.new_page()
        dpage.on("pageerror", lambda e: res["errors"].append("dev2: " + str(e)[:300]))
        dpage.route("**/*", _hang_the_write)
        dpage = open_note(dev2, notebook_url(n_dirty["id"]), dpage)
        dpage.wait_for_timeout(500)
        dpage.locator(".ProseMirror").click()
        dpage.keyboard.press("End")
        dpage.keyboard.type(" queued via intercepted write.", delay=15)
        dpage.wait_for_timeout(1500)   # let the durable layer attempt (and fail) its write

        # Run the rename from a SECOND page in the SAME context, so it reads
        # the same shared local durable store (IndexedDB) that still marks
        # n_dirty as unsynced -- dpage stays open, holding the pending write.
        rpage = dev2.new_page()
        rpage.on("pageerror", lambda e: res["errors"].append("dev2b: " + str(e)[:300]))
        rpage.goto(notebook_url(None, "?view=all"))
        dismiss_intro(rpage)
        rpage.wait_for_timeout(700)
        try:
            rpage.get_by_role("button", name=re.compile("Expand tags|Show all tags", re.I)).click(timeout=1000)
        except Exception:
            pass

        rename_fired = False
        notice_text = None
        batch_requests = []

        def _count_batch(resp, _bucket=batch_requests):
            if resp.url.endswith("/api/j2/notes/batch"):
                _bucket.append(resp.status)

        rpage.on("response", _count_batch)
        try:
            rpage.get_by_role("button", name=f"Rename {tag}").click(timeout=5000)
            rpage.get_by_label(f"Rename tag {tag}").fill(f"{tag}-renamed")
            rpage.get_by_role("button", name="Rename", exact=True).click()
            rename_fired = True
            rpage.wait_for_timeout(1200)
            notice_el = rpage.get_by_test_id("bulk-notice")
            if not notice_el.count():
                notice_el = rpage.get_by_role("status")
            if notice_el.count():
                notice_text = notice_el.first.text_content()
        except Exception as e:  # noqa: BLE001
            notice_text = f"could not drive the rename UI: {e}"
        finally:
            rpage.remove_listener("response", _count_batch)

        notice_lower = (notice_text or "").lower()
        names_dirty_note = bool(notice_text) and n_dirty["title"] in (notice_text or "")
        # ⛔ FIX (this run): traced live against noteHasUnsentWork.js +
        # noteBatch.js. n_dirty has a QUEUED/DIRTY local record with a
        # READABLE store (dpage's intercepted PUT never reached the server,
        # so `dirty`/`queued` is true) -- that reads back
        # `{unsent: true, why: 'dirty'|'queued'|'both'}`, which
        # `checkUnsentWork` buckets as UNSENT, never UNCHECKED.
        # "this device could not check" is `UNCHECKED_OP_COPY.renameTag`'s
        # copy for the DIFFERENT, narrower `unreadable` case (the local
        # store itself could not be opened/read) -- this scenario instead
        # produces `FAILURE_WORDS.unsent`, "is still syncing -- try again in
        # a moment" (noteBatch.js:201), confirmed live in `notice_text`
        # above ("...still syncing — try again in a moment."). Assert the
        # phrase this scenario actually produces; W8 (not W8b) is the one
        # that legitimately expects "this device could not check" to be
        # ABSENT, and does.
        names_this_device_could_not_check = "this device could not check" in notice_lower
        notes_still_syncing = "still syncing" in notice_lower
        has_waiver_button = rpage.get_by_role("button", name=re.compile("anyway|others", re.I)).count() > 0

        try:
            dpage.unroute("**/*", _hang_the_write)
        except Exception:
            pass
        rpage.close()
        dpage.close()
        dev2.close()

        verdict = "PASS" if (
            rename_fired
            and names_dirty_note
            and notes_still_syncing
            and not has_waiver_button
            and len(batch_requests) == 1
        ) else "INCONCLUSIVE"
        record(
            "W8b_tag_rename_unsent_work", verdict,
            rename_fired=rename_fired, notice_text=notice_text,
            names_the_unsent_note=names_dirty_note,
            names_this_device_could_not_check=names_this_device_could_not_check,
            notes_still_syncing=notes_still_syncing,
            has_waiver_button=has_waiver_button,
            batch_request_count=len(batch_requests),
            intercepted_write_methods=intercepted_writes,
            note_on_instrument_change=(
                "Replaced context.set_offline(True) (blocked ALL of dev2's requests, produced "
                "net::ERR_INTERNET_DISCONNECTED on the sandbox's own navigation -- an instrument "
                "failure) with a route interception scoped to ONLY this note's write endpoint "
                "(PUT/PATCH /api/j2/notes/<id>), so the durable layer's write hangs/aborts while "
                "every other request -- including the rename itself, run from a second page in "
                "the same context -- reaches the sandbox normally."
            ),
            note_on_brief_mismatch=(
                "The brief expects a 'Rename the others' waiver button; wave 6 fix round 3 "
                "(N1, final ruling, see NotebookTab.tagRename.test.jsx) REMOVED that waiver "
                "entirely -- the unsent note now gets no waiver of any kind, only a named "
                "notice and a single Close, and exactly one /api/j2/notes/batch request is "
                "issued. ⛔ FIX (this run): a PRIOR version of this walk also asserted the wrong "
                "wording here -- a note with a queued/dirty but READABLE local record is UNSENT "
                "(noteHasUnsentWork.js: why='dirty'/'queued'/'both'), not UNCHECKED "
                "(why='unreadable'); noteBatch.js's UNSENT case renders FAILURE_WORDS.unsent "
                "('is still syncing — try again in a moment'), never "
                "UNCHECKED_OP_COPY.renameTag's 'this device could not check' sentence -- that "
                "sentence belongs to W8's scenario (an unreadable store), which this check "
                "confirms is correctly ABSENT here (`names_this_device_could_not_check` is "
                "recorded but not required). This check now asserts the real behaviour."
            ),
            reason=None if verdict == "PASS" else (
                "the race did not reproduce (the intercepted write may have been retried/"
                "flushed before the rename ran), or the rename UI could not be driven, or the "
                "notice text did not match the expected 'still syncing' phrasing -- see "
                "notice_text"
            ),
        )

    check_w8b()

    # =========================================================================
    # W9 -- editor nodes survive a reload
    # =========================================================================
    @guarded("W9_editor_nodes_reload")
    def check_w9():
        global page
        note = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W9 nodes {RUN}",
            "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]},
        }).json()["note"]
        nid = note["id"]
        page = open_note(ctx, notebook_url(nid), page)
        page.wait_for_timeout(500)
        ed = page.locator(".ProseMirror")
        ed.click()

        # 1. two columns
        # ⛔ FIX: SlashMenu.jsx renders each option as title+description in two
        # separate text divs with no aria-label, so the accessible name is the
        # CONCATENATION ("2 columnsTwo side-by-side columns -- they stack on a
        # phone"), never the bare title -- `exact=True` matched nothing and
        # was the real cause of this step (and W7's identical pattern) never
        # firing. No other item's title+description contains "2 columns".
        page.keyboard.type("/2 col", delay=15)
        page.wait_for_timeout(300)
        lb = page.get_by_role("listbox", name="Insert block")
        if lb.count():
            lb.get_by_role("option", name="2 columns").click()
        page.wait_for_timeout(400)
        page.keyboard.type("left column text", delay=10)

        # 2. date mention (@today )
        page.keyboard.press("Control+End")
        page.keyboard.press("Enter")
        page.keyboard.type("Due @today ", delay=15)
        page.wait_for_timeout(400)

        # 3. table of contents
        page.keyboard.press("Control+End")
        page.keyboard.press("Enter")
        page.keyboard.type("/toc", delay=15)
        page.wait_for_timeout(300)
        lb2 = page.get_by_role("listbox", name="Insert block")
        if lb2.count():
            # Same concatenated-name fix as "2 columns" above -- no exact=True.
            lb2.get_by_role("option", name="Table of contents").click()
        page.wait_for_timeout(400)

        # a heading, so the TOC has something to list
        page.keyboard.press("Control+End")
        page.keyboard.press("Enter")
        page.keyboard.type("## A section heading", delay=10)
        page.keyboard.press("Enter")

        # 4. image + caption
        page.keyboard.type("/Image", delay=15)
        page.wait_for_timeout(300)
        lb3 = page.get_by_role("listbox", name="Insert block")
        image_uploaded = False
        if lb3.count():
            # Same concatenated-name fix -- no exact=True (see W7's identical
            # SlashMenu.jsx "Image" option comment above).
            with page.expect_file_chooser() as fci:
                lb3.get_by_role("option", name="Image").click()
            fc = fci.value
            import tempfile, os as _os
            tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
            tmp.write(PNG_1PX)
            tmp.close()
            # ⛔ FIX (this run): `tempfile.NamedTemporaryFile` exposes the
            # path as `.name`, never `.path` -- `_io.BufferedRandom` (what
            # `.close()` leaves behind) has no `.path` attribute at all,
            # which is why this raised `AttributeError` before
            # `set_files`/`unlink` ever ran. A pure instrument bug: nothing
            # about the product was exercised.
            fc.set_files(tmp.name)
            page.wait_for_timeout(1200)
            image_uploaded = page.locator(".ProseMirror img").count() > 0
            _os.unlink(tmp.name)
            if image_uploaded:
                # ⛔ FIX (this run): a real resize-handle overlay
                # (`<span class="_handle_1ywux_121 _hSE_1ywux_139">`, the
                # image node view's south-east resize grip) sits exactly at
                # the img element's default click point and intercepts
                # pointer events there -- Playwright's actionability check
                # correctly refuses a click that would land on a DIFFERENT
                # element and retries for the full 30s. This is real product
                # UI (a resizable image), not a bug: selecting the image to
                # reveal its caption toolbar doesn't need to land inside the
                # handle's hit area, so `force=True` (bypass the
                # interception check, same as clicking a corner the handle
                # doesn't cover) is the correct instrument fix.
                page.locator(".ProseMirror img").first.click(force=True)
                toolbar = page.get_by_role("toolbar")
                add_caption = toolbar.get_by_text("Add caption", exact=False)
                if add_caption.count():
                    add_caption.first.click()
                    page.wait_for_timeout(300)
                    page.keyboard.type("a tiny caption", delay=15)

        page.wait_for_timeout(1800)   # autosave debounce

        before = api.get(BASE + f"/api/j2/notes/{nid}").json().get("note", {})
        before_counts = type_by_walk(before.get("bodyJson"))

        page = reload_note(ctx, page)
        page.wait_for_timeout(800)
        not_blank = page.locator(".ProseMirror").inner_text().strip() != ""
        toc_nav = page.locator("nav.uctToc")
        toc_present_after_reload = toc_nav.count() > 0
        toc_jump_worked = False
        if toc_present_after_reload:
            link = toc_nav.locator("button.uctTocLink").first
            if link.count():
                link.click()
                page.wait_for_timeout(300)
                toc_jump_worked = True   # a click that did not throw; caret move is internal state

        after = api.get(BASE + f"/api/j2/notes/{nid}").json().get("note", {})
        after_counts = type_by_walk(after.get("bodyJson"))

        wanted = ["columns", "dateMention", "tableOfContents"]
        survived = all(after_counts.get(t, 0) >= before_counts.get(t, 0) and after_counts.get(t, 0) > 0
                        for t in wanted)
        image_survived = (not image_uploaded) or after_counts.get("imageFigure", 0) > 0 or after_counts.get("image", 0) > 0

        record(
            "W9_editor_nodes_reload", "PASS" if (not_blank and survived and image_survived) else "FAIL",
            note_id=nid,
            before_counts=before_counts, after_counts=after_counts,
            not_blank_after_reload=not_blank,
            toc_present_after_reload=toc_present_after_reload,
            toc_jump_worked=toc_jump_worked,
            image_uploaded=image_uploaded, image_survived=image_survived,
        )

    check_w9()

    # =========================================================================
    # W10 -- link paste
    # =========================================================================
    @guarded("W10_link_paste")
    def check_w10():
        global page
        note = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W10 link {RUN}",
            "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]},
        }).json()["note"]
        page = open_note(ctx, notebook_url(note["id"]), page)
        page.wait_for_timeout(500)
        ctx.grant_permissions(["clipboard-read", "clipboard-write"])
        page.locator(".ProseMirror").click()

        def paste(url):
            page.evaluate("(t) => navigator.clipboard.writeText(t)", url)
            page.keyboard.press("Control+v")
            page.wait_for_timeout(600)

        paste("https://www.wikipedia.org")
        offer_bar = page.get_by_role("toolbar", name="Pasted link")
        offer_appeared = offer_bar.count() > 0
        preview_offered = False
        preview_card_appeared = False
        if offer_appeared:
            preview_btn = offer_bar.get_by_role("button", name="Preview card")
            preview_offered = preview_btn.count() > 0
            if preview_offered:
                preview_btn.click()
                page.wait_for_timeout(2500)
                preview_card_appeared = page.locator("[data-type='link-preview-card'], .uctLinkPreview").count() > 0

        # A 200 non-JSON answer -- point at this sandbox's own JSON health route,
        # which is 200 but not parseable HTML with an <title>/OG tag.
        page.keyboard.press("Control+End")
        page.keyboard.press("Enter")
        paste(f"{BASE}/api/health")
        offer_bar2 = page.get_by_role("toolbar", name="Pasted link")
        no_card_case_offered = offer_bar2.count() > 0
        no_card_after = None
        if no_card_case_offered:
            pv = offer_bar2.get_by_role("button", name="Preview card")
            if pv.count():
                pv.click()
                page.wait_for_timeout(2500)
                no_card_after = page.locator("[data-type='link-preview-card'], .uctLinkPreview").count() == 0
            else:
                no_card_after = True   # not even offered for a non-HTML target

        verdict = "PASS" if (offer_appeared and preview_offered) else "FAIL"
        record(
            "W10_link_paste", verdict,
            offer_appeared=offer_appeared, preview_offered=preview_offered,
            preview_card_appeared=preview_card_appeared,
            plain_text_url_no_card=no_card_after,
            lookalike_host_check="INCONCLUSIVE",
            lookalike_reason=(
                "the server only computes/shows a domain AFTER a successful HTTPS fetch of "
                "real HTML (api/routers/notebook_link_preview.py:206-219, IDNA-encode-or-omit); "
                "a homoglyph domain that both resolves publicly and returns parseable HTML was "
                "not available to this walk. Read, not exercised."
            ),
        )

    check_w10()

    # =========================================================================
    # W11 -- lane F (unlinked mentions, tasks, telemetry, error beacon)
    # =========================================================================
    @guarded("W11_unlinked_mentions")
    def check_w11a():
        global page
        target_title = f"Cup and handle walk {RUN}"
        target = api.post(BASE + "/api/j2/notes", data={
            "title": target_title, "bodyJson": {"type": "doc", "content": [P("thesis body")]},
        }).json()["note"]
        mentioner = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W11 mentioner {RUN}",
            "bodyJson": {"type": "doc", "content": [P(f"NVDA formed a {target_title} on the daily.")]},
        }).json()["note"]

        server_check = api.get(BASE + f"/api/j2/notes/{mentioner['id']}/unlinked-mentions").json()

        page = open_note(ctx, notebook_url(target["id"]), page)
        page.wait_for_timeout(700)
        section = page.get_by_text(re.compile(r"Unlinked mentions \(\d+\)"))
        section_present = section.count() > 0
        open_only = None
        if section_present:
            section.first.click()
            page.wait_for_timeout(300)
            list_el = page.get_by_role("list", name="Notes that mention this one")
            buttons = list_el.get_by_role("button")
            texts = [buttons.nth(i).text_content().strip() for i in range(buttons.count())]
            open_only = all(t == "Open" for t in texts) and len(texts) > 0
            link_it_present = page.get_by_role("button", name=re.compile(r"link it|add link", re.I)).count() > 0
        else:
            link_it_present = False

        record(
            "W11_unlinked_mentions", "PASS" if (section_present and open_only and not link_it_present) else "FAIL",
            server_count=server_check.get("count"),
            section_present=section_present, open_only=open_only,
            link_it_affordance_present=link_it_present,
            note_on_brief_mismatch=(
                "The brief expects a 'link this' affordance; the shipped UnlinkedMentions "
                "component deliberately offers Open ONLY (see UnlinkedMentions.test.jsx: "
                "'offers Open ONLY -- no Link it, and nothing here ever writes'). This check "
                "verifies the REAL current behaviour."
            ),
        )

    check_w11a()

    @guarded("W11_tasks_across_notes")
    def check_w11b():
        due_today = _t.strftime("%Y-%m-%d")
        note = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W11 tasks {RUN}",
            "bodyJson": {"type": "doc", "content": [
                {"type": "taskList", "content": [
                    {"type": "taskItem", "attrs": {"checked": False}, "content": [
                        {"type": "paragraph", "content": [
                            {"type": "text", "text": "Walk task "},
                            {"type": "dateMention", "attrs": {"date": due_today}},
                        ]},
                    ]},
                ]},
            ]},
        }).json()["note"]

        api_tasks = api.get(BASE + "/api/j2/notes/tasks?status=open").json()
        found = [t for t in api_tasks.get("tasks", []) if t.get("noteId") == note["id"]]
        api_ok = bool(found) and found[0].get("due") == due_today

        # UI half -- NoteTasksView.jsx was mounted in 44aba6944, AFTER this
        # walk's earlier reads correctly reported it unreachable (against a
        # dist built before that commit). It is reachable at ?view=tasks on
        # this tip. Drive it for real on the re-run rather than re-asserting
        # the earlier, now-stale, zero-importers finding.
        global page
        ui_reachable = False
        ui_checkbox_found = False
        ui_check_reflected_in_api = None
        ui_error = None
        try:
            page.goto(notebook_url(None, "?view=tasks"))
            # wave 7: the Tasks view is a LAZY chunk now (lane I3), so wave 6's
            # 700 ms sleep-then-sample could read "unreachable" for a view that
            # mounted at 701 ms. A waiter instead (CLAUDE.md, "sampling where a
            # waiter was available"); the ceiling is generous, not the wait.
            row = page.get_by_text(re.compile("Walk task", re.I))
            try:
                row.first.wait_for(state="visible", timeout=20000)
            except Exception:  # noqa: BLE001
                pass
            ui_reachable = row.count() > 0
            if row.count():
                container = row.first.locator(
                    "xpath=ancestor-or-self::*[self::li or self::div][1]"
                )
                checkbox = container.get_by_role("checkbox")
                if not checkbox.count():
                    checkbox = page.locator(
                        f"[data-task-note-id='{note['id']}'] input[type='checkbox'], "
                        f"[data-note-id='{note['id']}'] input[type='checkbox']"
                    )
                if checkbox.count():
                    ui_checkbox_found = True
                    checkbox.first.click()
                    page.wait_for_timeout(800)
                    after = api.get(BASE + "/api/j2/notes/tasks?status=open").json()
                    still_open = [t for t in after.get("tasks", []) if t.get("noteId") == note["id"]]
                    ui_check_reflected_in_api = len(still_open) == 0
        except Exception as e:  # noqa: BLE001
            ui_error = str(e)[:300]

        verdict = "PASS" if api_ok else "FAIL"
        record(
            "W11_tasks_across_notes", verdict,
            note_id=note["id"], found_via_api=api_ok,
            due_matches=found[0].get("due") == due_today if found else None,
            ui_reachable=ui_reachable,
            ui_checkbox_found=ui_checkbox_found,
            ui_check_reflected_in_api=ui_check_reflected_in_api,
            ui_error=ui_error,
            ui_reachability=(
                "NoteTasksView.jsx was mounted in 44aba6944 and is reachable at ?view=tasks -- "
                "this run drove the UI directly (see ui_reachable / ui_checkbox_found / "
                "ui_check_reflected_in_api above) rather than re-asserting the earlier "
                "zero-importers finding, which was correct against the dist that tip predates "
                "but is now stale."
            ),
        )

    check_w11b()

    @guarded("W11_reminders")
    def check_w11c():
        record(
            "W11_reminders", "INCONCLUSIVE",
            reason=(
                "the daily reminder is a scheduled server-side pass "
                "(api/services/journal_two/note_tasks.py: run_task_reminders at 07:00 and 09:00 "
                "ET, plus a boot catch-up gated on the wall-clock ET hour) with no admin/manual "
                "HTTP trigger reachable from a live walk (grep-confirmed: run_task_reminders / "
                "catch_up_task_reminders have zero callers outside the scheduler + their own "
                "tests). Firing it for real would require the sandbox to boot at/after 07:00 ET "
                "with the task already due, which this walk's own note-seeding cannot arrange."
            ),
        )

    check_w11c()

    @guarded("W11_telemetry_and_error_beacon")
    def check_w11d():
        global page
        note = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W11 telemetry {RUN}",
            "bodyJson": {"type": "doc", "content": [P("x")]},
        }).json()["note"]

        telemetry_seen = {"body": None}
        def on_tel(req):
            if req.method == "POST" and req.url.endswith("/api/j2/telemetry"):
                try:
                    b = json.loads(req.post_data or "{}")
                    if b.get("event") == "note_open_ms":
                        telemetry_seen["body"] = b
                except Exception:
                    pass
        # ⛔ attached via open_note's extra_listeners, not page.on() directly --
        # a retry inside open_note swaps to a FRESH page object, and a listener
        # bound only to the original page would never see the telemetry POST
        # fired by whichever page actually ends up mounting the editor.
        page = open_note(ctx, notebook_url(note["id"]), page, extra_listeners=[("request", on_tel)])
        page.wait_for_timeout(1500)

        error_beacon_seen = {"body": None}
        def on_err(req):
            if req.method == "POST" and req.url.endswith("/api/client-errors"):
                try:
                    error_beacon_seen["body"] = json.loads(req.post_data or "{}")
                except Exception:
                    error_beacon_seen["body"] = req.post_data
        page.on("request", on_err)
        # wave 7: the beacon SCRUBS the message (errorBeacon.js: an unrecognised
        # message is sent as `<Name>: <unrecognized #hash>`), so the marker text
        # cannot identify this deliberate throw later. The beacons it causes are
        # fenced by index instead, so W13/W21 exclude exactly these and no other.
        FORCED_BEACONS["from"] = len(BEACONS)
        try:
            with page.expect_event("request", lambda r: r.method == "POST" and r.url.endswith("/api/client-errors"),
                                   timeout=10000):
                page.evaluate("(m) => { setTimeout(() => { throw new Error(m) }, 0) }", FORCED_ERROR_MARKER)
        except Exception:  # noqa: BLE001
            pass   # no beacon: `error_beacon_seen` stays None and the row says FAIL
        page.wait_for_timeout(500)   # a second beacon for the same throw, if any, lands inside the fence
        FORCED_BEACONS["to"] = len(BEACONS)

        record(
            "W11_telemetry_and_error_beacon",
            "PASS" if (telemetry_seen["body"] and error_beacon_seen["body"]) else "FAIL",
            note_open_telemetry=telemetry_seen["body"],
            error_beacon_body_present=bool(error_beacon_seen["body"]),
        )

    check_w11d()

    # =========================================================================
    # W12 -- two real tabs, one note (Web Locks)
    # =========================================================================
    @guarded("W12_two_tabs_one_note")
    def check_w12():
        note = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W12 locks {RUN}",
            "bodyJson": {"type": "doc", "content": [P("shared")]},
        }).json()["note"]
        nid = note["id"]

        tab1 = ctx.new_page()
        tab1.on("pageerror", lambda e: res["errors"].append("tab1: " + str(e)[:300]))
        tab1 = open_note(ctx, notebook_url(nid), tab1)
        tab1.wait_for_timeout(600)

        tab2 = ctx.new_page()
        tab2.on("pageerror", lambda e: res["errors"].append("tab2: " + str(e)[:300]))
        tab2 = open_note(ctx, notebook_url(nid), tab2)
        tab2.wait_for_timeout(600)

        puts_from = {"tab1": 0, "tab2": 0}

        def track(tag):
            def _(req):
                if req.method == "PUT" and req.url.endswith(f"/api/j2/notes/{nid}"):
                    puts_from[tag] += 1
            return _
        tab1.on("request", track("tab1"))
        tab2.on("request", track("tab2"))

        tab1.locator(".ProseMirror").click()
        tab1.keyboard.press("End")
        tab1.keyboard.type(" from tab one.", delay=15)
        tab1.wait_for_timeout(1500)
        tab1_first = puts_from["tab1"] > 0 and puts_from["tab2"] == 0

        # ⛔ FIX (directive #6, part 2): exhaustive case-insensitive grep of the
        # WHOLE app/src tree for "owns this note", "another tab", "other tab"
        # and "in another window" finds ZERO rendered JSX text/props -- every
        # match is a code comment or a test description string
        # (outboxDrain.js:33's `SKIPPED = 'skipped'  // the open editor owns
        # this note right now` is an internal status constant, never
        # displayed; NoteEditorPage.jsx's own "owns this note"/"another tab"
        # comments have no nearby member-facing copy either). The product
        # shows NO visible notice to a non-owning tab, BY DESIGN -- ownership
        # is a silent Web Locks leader election + outbox-drain skip
        # (noteOwnerLock.js). These two checks are therefore expected to read
        # False on a healthy product; recorded as PASS facts below, not
        # treated as a missing feature.
        notice = tab2.get_by_text(re.compile("another tab", re.I))
        owner_notice_on_tab2 = notice.count() > 0

        tab1.close()
        # ⛔ FIX (this run, supersedes directive #6, part 1): the wait-two-
        # sweep-periods fix (60s x2 + margin) was aimed at the WRONG
        # mechanism, traced live against useOutboxDrain.js's own header
        # comment: "AND THE OPEN NOTE IS NOT THE SWEEP'S. The editor owns
        # saving the note it has open, with its own backoff; this drains
        # everything else." tab2 has THIS note open for the entire check and
        # never typed anything, so it has NOTHING queued in ANY outbox --
        # neither the background sweep (which explicitly excludes the open
        # note) nor the editor's own live-save (which never fires without an
        # edit). Waiting through any number of 60s sweeps could never
        # produce a PUT from tab2 here; that was true by design, not a
        # product defect, and the original 130s wait was measuring a
        # mechanism this scenario never engages.
        #
        # The real question W12 asks -- does the surviving tab become a
        # working sole writer once the other tab's ownership lock releases --
        # is answered by having tab2 make its OWN edit now and confirming
        # ITS editor-owned save (the same direct-PUT path that made
        # `tab1_first` true above) reaches the server.
        tab2.locator(".ProseMirror").click()
        tab2.keyboard.press("End")
        tab2.keyboard.type(" from tab two after tab one closed.", delay=15)
        tab2.wait_for_timeout(1500)
        tab2_drains_after_close = puts_from["tab2"] > 0

        # bfcache / pagehide: navigate tab2 away and back.
        tab2.goto(BASE + "/dashboard")
        tab2.wait_for_timeout(800)
        tab2.go_back()
        try:
            if _wait_mount_or_fallback(tab2, 15000) == "fallback":
                _note_fallback(tab2.url, 1, "W12 go_back")
                tab2 = reload_note(ctx, tab2)
        except Exception:  # noqa: BLE001
            tab2 = reload_note(ctx, tab2)
        tab2.wait_for_timeout(600)
        stuck_notice = tab2.get_by_text(re.compile("another tab owns this note", re.I)).count() > 0

        record(
            "W12_two_tabs_one_note", "PASS" if (
                tab1_first and tab2_drains_after_close and not stuck_notice
            ) else "FAIL",
            puts_while_both_open=dict(puts_from),
            tab1_sole_writer_while_open=tab1_first,
            owner_notice_seen_on_tab2=owner_notice_on_tab2,
            tab2_writes_successfully_after_tab1_closes=tab2_drains_after_close,
            stuck_owner_notice_after_bfcache_nav=stuck_notice,
            outbox_drain_sweep_interval_ms=60000,
            notice_design_note=(
                "Exhaustive grep of app/src for 'owns this note' / 'another tab' / "
                "'other tab' / 'in another window' finds zero rendered JSX text -- only code "
                "comments and test descriptions (outboxDrain.js:33's SKIPPED constant is "
                "internal, never displayed). The product shows NO visible notice to a "
                "non-owning tab by design -- ownership is a silent Web Locks leader election "
                "+ outbox-drain skip (noteOwnerLock.js). owner_notice_seen_on_tab2 and "
                "stuck_owner_notice_after_bfcache_nav reading False is therefore the expected, "
                "correct PASS state, not a product gap -- searched strings listed above."
            ),
            instrument_fix_note=(
                "⛔ FIX (this run): field renamed from 'tab2_drains_after_tab1_closes' -- the "
                "prior version waited 2x the 60s outbox-drain sweep period "
                "(useOutboxDrain.js RETRY_INTERVAL_MS) hoping tab2 would eventually emit a PUT "
                "on its own, but that file's own header comment rules this out by design: "
                "'the OPEN NOTE IS NOT THE SWEEP'S... the editor owns saving the note it has "
                "open, with its own backoff; this drains everything else.' tab2 had this note "
                "open the whole time and never typed anything, so it had nothing queued in any "
                "outbox to drain -- no wait, however long, could have produced a PUT. This run "
                "instead has tab2 make its own edit after tab1 closes and checks THAT lands, "
                "which is the real test of single-writer hand-off."
            ),
        )
        tab2.close()

    check_w12()

    # =========================================================================
    # W12b -- two tabs, one note: a clean rebase vs a conflicted copy
    # =========================================================================
    # ⛔ READ THE CLASSIFIER BEFORE CHANGING THIS (serverChange.js:12-28,
    # F5-frozen). A stale second write is reconciled by what the SERVER'S copy
    # changed relative to the writer's base: METADATA_ONLY rebases, APPEND_ONLY
    # (widgetEmbed/financialFact/documentExcerpt only) merges, and ANYTHING ELSE
    # -- any prose, in any block -- is BODY_REWRITE and forks. The brief's
    # "rebases cleanly" branch is therefore driven by a metadata write (a tag
    # through the editor's tag door, NoteEditorPage.tags.test.jsx:73), and its
    # "stale on the same block" branch by prose in the same paragraph. Prose in
    # ANOTHER paragraph is recorded as its own row, judged against the
    # product's documented contract (a fork), since the brief's block-level
    # model and the classifier disagree there.
    #
    # ⛔ "NEVER SAW TAB 1's REVISION" IS MEASURED, NOT ASSUMED: tab 2's first
    # PUT must carry the ORIGINAL revision as `baseUpdatedAt` and be answered
    # 409. If it carries tab 1's revision, tab 2 learned it (the two tabs share
    # one IndexedDB) and the row is INCONCLUSIVE -- the precondition was not
    # constructed, so nothing about the product was measured.
    #
    # The conflict marker is read from the DOM: the all-notes list's row
    # checkbox is named `Select <title>` (NotebookTab.bulk.test.jsx:197), and a
    # fork is a real note titled `<title> (conflicted copy)`
    # (NoteEditorPage.jsx forkConflictedCopy/createNoteViaApi, tagged
    # `sync-conflict`). Never from IndexedDB.
    if wanted("W12b"):
        mismatch(
            "W12b",
            "a second write stale on a DIFFERENT block rebases cleanly; stale on the SAME block forks",
            "the classifier is not block-aware: any server-side prose change forks; only a metadata-only "
            "change (tags/folder/ticker/hero) or a server-appended embed reconciles without a fork",
            "app/src/pages/journal-2-0/lib/offline/serverChange.js:12-28 (F5-frozen)")

    def _put_is(nid, r):
        return r.request.method == "PUT" and r.url.split("?", 1)[0].endswith(f"/api/j2/notes/{nid}")

    def _record_notes_traffic(tab, nid, sink):
        def on_req(req):
            path = req.url.split(BASE, 1)[-1].split("?", 1)[0]
            if not path.startswith("/api/j2/notes"):
                return
            entry = {"t": round(_t.time(), 3), "dir": "req", "method": req.method, "path": path}
            try:
                body = json.loads(req.post_data or "{}") if req.post_data else {}
            except Exception:  # noqa: BLE001
                body = {}
            if req.method == "PUT" and path == f"/api/j2/notes/{nid}":
                entry["baseUpdatedAt"] = body.get("baseUpdatedAt")
            if req.method == "POST" and path == "/api/j2/notes":
                entry["title"] = body.get("title")
            sink.append(entry)

        def on_resp(resp):
            path = resp.url.split(BASE, 1)[-1].split("?", 1)[0]
            if path.startswith("/api/j2/notes"):
                sink.append({"t": round(_t.time(), 3), "dir": "resp", "method": resp.request.method,
                             "path": path, "status": resp.status})
        tab.on("request", on_req)
        tab.on("response", on_resp)

    def _wait_quiet(sink, quiet_s=1.5, ceiling_s=15.0):
        """Returns once `sink` has not grown for `quiet_s` -- derived from the
        traffic itself, not a fixed sleep; bounded by `ceiling_s`."""
        start = _t.time()
        n, since = len(sink), _t.time()
        while _t.time() - start < ceiling_s:
            _t.sleep(0.25)
            if len(sink) != n:
                n, since = len(sink), _t.time()
            elif _t.time() - since >= quiet_s:
                return True
        return False

    def _api_note(nid):
        return api.get(BASE + f"/api/j2/notes/{nid}").json().get("note") or {}

    def _wait_body_contains(nid, text, ceiling_s=20.0):
        end = _t.time() + ceiling_s
        while _t.time() < end:
            if text in body_text(_api_note(nid).get("bodyJson")):
                return True
            _t.sleep(0.4)
        return False

    def _type_in_paragraph(tab, index, words):
        tab.locator(".ProseMirror p").nth(index).click()
        tab.keyboard.press("End")
        tab.keyboard.type(words, delay=15)

    def _w12b_case(case):
        title = f"Walk W12b {case} {RUNWORD}"
        tab1_words, tab2_words = f" one{case}{RUNWORD}", f" two{case}{RUNWORD}"
        tag = f"w12b{case}{RUNWORD}".lower()
        note = api.post(BASE + "/api/j2/notes", data={
            "title": title,
            "bodyJson": {"type": "doc", "content": [P(f"Alpha paragraph {case}."), P(f"Omega paragraph {case}.")]},
        }).json()["note"]
        nid, u0 = note["id"], note["updatedAt"]

        tab1 = open_note(ctx, notebook_url(nid), _fresh_page(ctx))
        tab2 = open_note(ctx, notebook_url(nid), _fresh_page(ctx))
        t1_log, t2_log = [], []
        _record_notes_traffic(tab1, nid, t1_log)
        _record_notes_traffic(tab2, nid, t2_log)

        # ---- tab 1 writes, and the write LANDS --------------------------------
        if case == "clean":
            combo = tab1.get_by_role("combobox", name="Add a tag to this note")
            with tab1.expect_response(lambda r: r.request.method == "PATCH"
                                      and r.url.split("?", 1)[0].endswith(f"/api/j2/notes/{nid}/tags"),
                                      timeout=20000) as t1r:
                combo.fill(tag)
                combo.press("Enter")
            tab1_status = t1r.value.status
        else:
            para = 0 if case == "same_block" else 1
            with tab1.expect_response(lambda r: _put_is(nid, r) and r.status == 200, timeout=30000) as t1r:
                _type_in_paragraph(tab1, para, tab1_words)
            tab1_status = t1r.value.status
            _wait_body_contains(nid, tab1_words.strip())
        _wait_quiet(t1_log)
        u1 = _api_note(nid).get("updatedAt")

        # ---- tab 2 (opened on u0, never refreshed) types and lands -------------
        decisive = {"event": None}

        def _decides(r):
            if _put_is(nid, r) and r.status == 200:
                decisive["event"] = "put_200"
                return True
            if (r.request.method == "POST" and r.url.split("?", 1)[0].endswith("/api/j2/notes")
                    and "(conflicted copy)" in (r.request.post_data or "")):
                decisive["event"] = "fork_post"
                return True
            return False
        try:
            with tab2.expect_response(_decides, timeout=45000):
                _type_in_paragraph(tab2, 0, tab2_words)
        except Exception as e:  # noqa: BLE001
            decisive["event"] = f"none within 45 s ({str(e)[:120]})"
        _wait_quiet(t2_log, quiet_s=2.0, ceiling_s=20.0)

        t2_puts = [e for e in t2_log if e["dir"] == "req" and e["method"] == "PUT"]
        t2_put_statuses = [e["status"] for e in t2_log if e["dir"] == "resp" and e["method"] == "PUT"]
        first_base = t2_puts[0].get("baseUpdatedAt") if t2_puts else None
        stale_proven = bool(t2_puts) and first_base == u0 and bool(t2_put_statuses) and t2_put_statuses[0] == 409
        tab2_saw_tab1 = bool(t2_puts) and first_base == u1

        # ---- the DOM read: the list rows, from a page that has not written ------
        lp = _fresh_page(ctx)
        open_list(lp)
        base_row_seen = wait_list_row(lp, title)
        copy_title = f"{title} (conflicted copy)"
        if case != "clean":
            wait_list_row(lp, copy_title, timeout=8000)   # absent is a legitimate answer
        dom_exact = select_box(lp, title).count()
        dom_copies = select_box(lp, copy_title).count()
        lp.close()

        # ---- what the server holds -------------------------------------------
        final = _api_note(nid)
        final_text = body_text(final.get("bodyJson"))
        listed = api.get(BASE + f"/api/j2/notes?q={RUNWORD}&limit=100").json().get("notes", [])
        copies = [n for n in listed if (n.get("title") or "") == copy_title]
        copy_texts = [body_text(_api_note(c["id"]).get("bodyJson")) for c in copies]
        copy_tags = [(_api_note(c["id"]).get("tags") or []) for c in copies]
        for tb in (tab1, tab2):
            try:
                tb.close()
            except Exception:  # noqa: BLE001
                pass
        return {
            "note_id": nid, "title": title, "u0": u0, "u1_after_tab1": u1,
            "tab1_write": "tag via the editor's tag door" if case == "clean" else f"prose in paragraph {0 if case == 'same_block' else 1}",
            "tab1_status": tab1_status,
            "tab2_first_put_base": first_base, "tab2_put_statuses": t2_put_statuses,
            "tab2_stale_proven": stale_proven, "tab2_saw_tab1_revision": tab2_saw_tab1,
            "tab2_decisive_event": decisive["event"],
            "tab2_traffic": t2_log[:40],
            "dom_base_row_seen": base_row_seen,
            "dom_rows_with_exact_title": dom_exact, "dom_rows_conflicted_copy": dom_copies,
            "api_copies": len(copies), "copy_tags": copy_tags,
            "tab1_words_in_note": (tab1_words.strip() in final_text) if case != "clean" else None,
            "tag_on_note": (tag in [str(t).lower() for t in (final.get("tags") or [])]) if case == "clean" else None,
            "tab2_words_in_note": tab2_words.strip() in final_text,
            "tab2_words_in_a_copy": any(tab2_words.strip() in t for t in copy_texts),
            "tab1_words_in_a_copy": any(tab1_words.strip() in t for t in copy_texts),
        }

    @guarded("W12b_clean_rebase_metadata_only")
    def check_w12b_clean():
        f = _w12b_case("clean")
        if not f["tab2_stale_proven"]:
            verdict, why = "INCONCLUSIVE", ("tab 2's first write was not a stale 409 -- the precondition "
                                            "(tab 2 never saw tab 1's revision) was not constructed")
        else:
            ok = (f["dom_rows_with_exact_title"] == 1 and f["dom_rows_conflicted_copy"] == 0
                  and f["api_copies"] == 0 and f["tab2_words_in_note"] and f["tag_on_note"])
            verdict, why = ("PASS" if ok else "FAIL"), None
        record("W12b_clean_rebase_metadata_only", verdict, reason=why, **f)

    @guarded("W12b_conflicted_copy_same_block")
    def check_w12b_fork():
        f = _w12b_case("same_block")
        if not f["tab2_stale_proven"]:
            verdict, why = "INCONCLUSIVE", "tab 2's first write was not a stale 409 -- precondition not constructed"
        else:
            ok = (f["dom_rows_with_exact_title"] == 1 and f["dom_rows_conflicted_copy"] == 1
                  and f["api_copies"] == 1 and f["tab1_words_in_note"] and f["tab2_words_in_a_copy"])
            verdict, why = ("PASS" if ok else "FAIL"), None
        record("W12b_conflicted_copy_same_block", verdict, reason=why, **f)

    @guarded("W12b_other_block_prose")
    def check_w12b_other():
        f = _w12b_case("other_block")
        lost = not (f["tab1_words_in_note"] or f["tab1_words_in_a_copy"]) or \
            not (f["tab2_words_in_note"] or f["tab2_words_in_a_copy"])
        forked_once = f["dom_rows_with_exact_title"] == 1 and f["dom_rows_conflicted_copy"] == 1
        if not f["tab2_stale_proven"]:
            verdict, why = "INCONCLUSIVE", "tab 2's first write was not a stale 409 -- precondition not constructed"
        elif lost:
            verdict, why = "FAIL", "a writer's words are in neither the note nor a conflicted copy"
        elif forked_once:
            verdict, why = "PASS", None
        else:
            verdict, why = "INCONCLUSIVE", ("no words lost, but the outcome is not the product's documented "
                                            "contract for prose in another block (a fork) -- needs a human look")
        record("W12b_other_block_prose", verdict, reason=why,
               expected_by_product_contract="fork (serverChange.js BODY_REWRITE: 'prose changed' in ANY block)",
               brief_model="a clean rebase (block-level merge) -- not what the frozen classifier does", **f)

    check_w12b_clean()
    check_w12b_fork()
    check_w12b_other()

    # =========================================================================
    # W14 -- G4: an image through Insert image becomes an OCR'd, searchable document
    # =========================================================================
    @guarded("W14_image_ocr_document")
    def check_w14():
        global page
        import tempfile
        phrase = RUNWORD
        png = png_with_text([f"PELICAN {phrase.upper()}", "QUARTZ HARBOR LEDGER"])
        tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
        tmp.write(png)
        tmp.close()
        note = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W14 ocr {RUN}", "bodyJson": {"type": "doc", "content": [P("An image goes below.")]},
        }).json()["note"]
        nid = note["id"]
        page = open_note(ctx, notebook_url(nid), page)
        page.locator(".ProseMirror").click()
        page.keyboard.press("Control+End")
        # Insert image: `getByLabelText('Insert image')` (NoteEditorPage.rails.test.jsx:115) clicks
        # the hidden `input[aria-label="Upload image"]` (imagePickerTarget.test.jsx:58) -- the
        # SAME handleImageInsert the Scan door feeds (dictation.test.jsx "SAME image upload").
        with page.expect_response(lambda r: r.request.method == "POST"
                                  and r.url.split("?", 1)[0].endswith(f"/api/j2/notes/{nid}/images"),
                                  timeout=30000) as up:
            with page.expect_file_chooser(timeout=10000) as fc:
                page.get_by_label("Insert image", exact=True).click()
            fc.value.set_files(tmp.name)
        t0 = _t.time()
        upload_status = up.value.status
        try:
            upload_url = (up.value.json() or {}).get("url")
        except Exception:  # noqa: BLE001
            upload_url = None
        os.unlink(tmp.name)
        try:
            page.locator(".ProseMirror img").first.wait_for(state="attached", timeout=15000)
            img_in_editor = True
        except Exception:  # noqa: BLE001
            img_in_editor = False

        # The server processes asynchronously and exposes no event: this is a bounded
        # poll of the SERVER's own list (GET /notes/{id}/documents), which is the brief's
        # instrument; a status transition is recorded the moment it is seen.
        statuses, row, deadline = [], None, _t.time() + 180
        while _t.time() < deadline:
            docs = api.get(BASE + f"/api/j2/notes/{nid}/documents").json().get("documents", [])
            imgs = [d for d in docs if d.get("kind") == "image"]
            if imgs:
                row = imgs[0]
                seen = (row.get("status"), row.get("pagesWithText"), row.get("pagesFromOcr"))
                if not statuses or statuses[-1]["state"] != list(seen):
                    statuses.append({"at_s": round(_t.time() - t0, 2), "state": list(seen)})
                if (row.get("pagesWithText") or 0) >= 1 or row.get("status") in ("no_text", "processing_failed"):
                    break
            _t.sleep(1.0)
        t_text = round(_t.time() - t0, 2) if row and (row.get("pagesWithText") or 0) >= 1 else None

        page_text, text_origin = None, None
        if row and (row.get("pagesWithText") or 0) >= 1:
            pt = api.get(BASE + f"/api/j2/notes/documents/{row['id']}/pages/1/text").json()
            page_text, text_origin = pt.get("text"), pt.get("textOrigin")
        phrase_in_text = bool(page_text) and phrase.lower() in page_text.lower()

        api_hit, t_search = None, None
        if row and phrase_in_text:
            end = _t.time() + 60
            while _t.time() < end:
                hits = api.get(BASE + f"/api/j2/notes/documents/search?q={phrase}").json().get("results", [])
                api_hit = next((h for h in hits if h.get("documentId") == row["id"]), None)
                if api_hit:
                    t_search = round(_t.time() - t0, 2)
                    break
                _t.sleep(1.0)

        # The member's search: FolderSidebar's search mode (`Search notes`, placeholder
        # /search notes/i -- FolderSidebar.test.jsx:1039/1066); a document page hit is
        # titled `<name> · p.<n>` (searchResultLabel.js), and an image row is named "Image".
        # ⛔ INSTRUMENT FIX (shake-out 2, 2026-09-25): an EXACT text match missed a
        # real hit -- an OCR'd row also carries a "Scanned text" badge, which is why
        # FolderSidebar.test.jsx:1840 itself matches the title with a regex
        # (`/filing\.pdf · p\.12/`). Same shape here; the badge (line 1821) is
        # recorded as its own fact. ⛔ And NO `\b` after the page number (a second
        # instrument error, shake-out 4): the badge's text follows the page with
        # no space ("p.1Scanned text"), so `p\.1\b` can never match -- a probe of
        # the running sandbox showed the hit rendered and the test's own shape
        # finding exactly one element.
        ui_hit, scanned_badge = None, None
        if api_hit:
            open_list(page)
            page.get_by_label("Search notes", exact=True).click()
            page.get_by_placeholder(re.compile("search notes", re.I)).fill(phrase)
            try:
                page.get_by_text(re.compile(r"Image · p\.1")).first.wait_for(state="visible", timeout=20000)
                ui_hit = True
                scanned_badge = page.get_by_text("Scanned text", exact=True).count() > 0
            except Exception:  # noqa: BLE001
                ui_hit = False

        ocr_line = launcher_lines(r"\[startup\] j2-ocr:")
        engine_absent = bool(row and row.get("ocrUnavailable")) or bool(
            ocr_line and any("active=False" in ln for ln in ocr_line))
        if row is None:
            verdict, why = "FAIL", "no documents row of kind 'image' within 180 s of the upload"
        elif (row.get("pagesWithText") or 0) < 1 and engine_absent:
            verdict, why = "INCONCLUSIVE", "the sandbox has no usable OCR engine (see ocr_fingerprint) -- environment"
        else:
            ok = img_in_editor and phrase_in_text and bool(api_hit) and ui_hit is True
            verdict, why = ("PASS" if ok else "FAIL"), None
        record("W14_image_ocr_document", verdict, reason=why,
               note_id=nid, upload_status=upload_status, upload_url=upload_url, img_in_editor=img_in_editor,
               document=row, status_transitions=statuses, ocr_text=(page_text or "")[:400], text_origin=text_origin,
               phrase=phrase, phrase_in_ocr_text=phrase_in_text,
               api_search_hit=api_hit, sidebar_search_shows_image_page=ui_hit,
               sidebar_hit_marked_scanned_text=scanned_badge,
               seconds_upload_to_text=t_text, seconds_upload_to_searchable=t_search,
               ocr_fingerprint=ocr_line)

    check_w14()

    # =========================================================================
    # W15 -- G1: the personal API, token minted in the Settings card
    # =========================================================================
    LOCKED_SENTENCE = "This note is locked — unlock it in the Notebook first"   # ruling D-G1(d), verbatim

    @guarded("W15_personal_api")
    def check_w15():
        label = f"Walk W15 {RUN}"
        page.goto(BASE + "/settings?section=connections")   # Settings.jsx:1674-1677 (?section=)
        dismiss_intro(page)
        name_box = page.get_by_role("textbox", name="Token name")          # PersonalApiCard.test.jsx
        try:
            name_box.wait_for(state="visible", timeout=20000)
        except Exception:  # noqa: BLE001
            st = api.get(BASE + "/api/j2/personal/tokens").status
            record("W15_personal_api", "INCONCLUSIVE" if st == 404 else "FAIL",
                   reason=("the Personal API card is absent and GET /api/j2/personal/tokens is 404 -- "
                           "the gate is dark on the sandbox (instrument/environment)") if st == 404 else
                   "the card never rendered though the route answers", tokens_status=st)
            return
        name_box.fill(label)
        page.get_by_role("button", name="Make a token", exact=True).click()
        box = page.get_by_test_id("personal-api-new-token")
        box.wait_for(state="visible", timeout=15000)
        token = box.get_by_role("textbox", name="Your new Personal API token").input_value()
        warned = box.get_by_text("Copy it now. For your security it will not be shown again.", exact=True).count() == 1
        box.get_by_role("button", name="Done", exact=True).click()
        box.wait_for(state="detached", timeout=10000)
        token_still_on_page = page.evaluate(
            "(t) => document.body.innerHTML.includes(t) || [...document.querySelectorAll('input')].some(i => i.value === t)",
            token)
        bearer = {"Authorization": f"Bearer {token}"}

        c_st, c_raw, _ = http("POST", "/api/j2/personal/notes", headers=bearer, body={
            "title": f"Walk W15 created {RUN}", "markdown": f"Created through the personal API {RUNWORD}."})
        created = (jdecode(c_raw) or {}).get("note") or {}
        a_st, a_raw, _ = http("POST", f"/api/j2/personal/notes/{created.get('id')}/append", headers=bearer,
                              body={"markdown": f"Appended line {RUNWORD}."})
        d_st, d_raw, _ = http("POST", "/api/j2/personal/daily/append", headers=bearer,
                              body={"markdown": f"Daily line {RUNWORD}."})
        daily = jdecode(d_raw) or {}

        locked = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W15 locked {RUN}", "bodyJson": {"type": "doc", "content": [P("Locked body.")]}}).json()["note"]
        lk = api.patch(BASE + f"/api/j2/notes/{locked['id']}/lock", data={"locked": True})
        l_st, l_raw, _ = http("POST", f"/api/j2/personal/notes/{locked['id']}/append", headers=bearer,
                              body={"markdown": "must not land"})
        locked_after = api.get(BASE + f"/api/j2/notes/{locked['id']}").json().get("note") or {}
        api.patch(BASE + f"/api/j2/notes/{locked['id']}/lock", data={"locked": False})

        cap_st, cap_raw, _ = http("POST", "/api/j2/capture", headers=bearer, body={})
        me_st, _me_raw, _ = http("GET", "/api/auth/me", headers=bearer)
        no_tok_st, no_tok_raw, _ = http("POST", "/api/j2/personal/notes", body={"title": "x"})

        created_body = body_text((api.get(BASE + f"/api/j2/notes/{created.get('id')}").json().get("note") or {}).get("bodyJson"))
        daily_note = daily.get("note") or {}
        daily_body = body_text((api.get(BASE + f"/api/j2/notes/{daily_note.get('id')}").json().get("note") or {}).get("bodyJson"))

        open_list(page)
        created_in_ui = wait_list_row(page, created.get("title") or "")
        daily_in_ui = wait_list_row(page, daily_note.get("title") or "") if daily_note.get("title") else False

        # Revoke through the card (`Revoke <label>`, PersonalApiCard.test.jsx), then the bearer is dead.
        page.goto(BASE + "/settings?section=connections")
        dismiss_intro(page)
        revoke = page.get_by_role("button", name=f"Revoke {label}", exact=True)
        revoke.wait_for(state="visible", timeout=15000)
        revoke.click()
        page.get_by_test_id("personal-api-token").filter(has_text=label).first.wait_for(state="detached", timeout=15000)
        r_st, _r_raw, _ = http("POST", "/api/j2/personal/daily/append", headers=bearer, body={"markdown": "after revoke"})

        ok = (bool(token) and warned and not token_still_on_page
              and c_st == 200 and a_st == 200 and d_st == 200
              and f"Appended line {RUNWORD}." in created_body and f"Daily line {RUNWORD}." in daily_body
              and created_in_ui and daily_in_ui
              and l_st == 423 and (jdecode(l_raw) or {}).get("detail") == LOCKED_SENTENCE
              and "must not land" not in body_text(locked_after.get("bodyJson"))
              and cap_st == 403 and me_st in (401, 403) and no_tok_st == 401 and r_st == 401)
        record("W15_personal_api", "PASS" if ok else "FAIL",
               token_minted=bool(token), token_prefix=(token or "")[:7], warned_not_shown_again=warned,
               token_still_on_page_after_done=token_still_on_page,
               create_status=c_st, created_note=created, append_status=a_st, daily_status=d_st,
               daily_answer={k: daily.get(k) for k in ("created", "day")}, daily_note=daily_note,
               appended_text_in_body=f"Appended line {RUNWORD}." in created_body,
               daily_text_in_body=f"Daily line {RUNWORD}." in daily_body,
               created_row_in_ui_list=created_in_ui, daily_row_in_ui_list=daily_in_ui,
               lock_patch_status=lk.status, locked_append_status=l_st, locked_append_body=jdecode(l_raw),
               locked_sentence_expected=LOCKED_SENTENCE,
               capture_with_personal_token_status=cap_st, capture_body=jdecode(cap_raw),
               auth_me_with_personal_token_status=me_st,
               no_token_status=no_tok_st, no_token_body=jdecode(no_tok_raw),
               after_revoke_status=r_st)

    check_w15()

    # =========================================================================
    # W16 -- G3: email-in, signed like the Cloudflare worker
    # =========================================================================
    @guarded("W16_email_in")
    def check_w16():
        mismatch("W16", "an unsigned body is 401 with a sentence",
                 "an unsigned (or badly signed) body is a BARE 401 with NO body, so a caller without the "
                 "secret learns nothing about which check failed",
                 "api/routers/notebook_inbound_email.py receive_email; rail G3-E5 pins b''")
        if not INBOUND_SECRET:
            record("W16_email_in", "INCONCLUSIVE",
                   reason="NOTEBOOK_INBOUND_EMAIL_SECRET is not in the walk's environment, so it cannot sign "
                          "(instrument) -- boot and walk from the same shell (header)")
            return
        # ⛔ A FRESH MEMBER PER RUN: the per-address window (20 an hour) and the
        # per-member one (40 an hour, every address they have had) are DURABLE in
        # auth.db, so a member reused across runs would start this check already
        # at its limit and read as a product failure.
        email = f"w7mail{RUN}@local.dev"
        mctx, prov = provision_member(browser, actx, email, "w7mail")
        uid = prov["user_id"]
        mpage = _fresh_page(mctx)
        mpage.goto(BASE + "/settings?section=connections")
        dismiss_intro(mpage)
        # wave 7 phase 2 (whole-branch M-10, `0ac0a3cb1` + the card half `f77915669`): the
        # address is created on INTENT. GET /api/j2/inbound-email/address answers
        # {"address": null} and never mints; the card offers "Create my address" until it is
        # pressed, then shows the address. This member is new, so it has none: the walk
        # presses Create -- the member's own door -- and reads what that made.
        addr_box = mpage.get_by_role("textbox", name="Your Notebook email address")   # InboundEmailCard.test.jsx:46
        create_btn = mpage.get_by_role("button", name="Create my address", exact=True)  # InboundEmailCard.test.jsx:69
        try:
            create_btn.or_(addr_box).first.wait_for(state="visible", timeout=20000)
        except Exception:  # noqa: BLE001
            st = mctx.request.get(BASE + "/api/j2/inbound-email/address").status
            record("W16_email_in", "INCONCLUSIVE" if st == 404 else "FAIL", provision=prov, address_status=st,
                   reason="the Email to Notebook card is absent and the address route is 404 -- the gate is "
                          "dark on the sandbox" if st == 404 else
                          "neither 'Create my address' nor the address rendered, though the route answers")
            return
        # What the server holds AFTER the card has mounted and made its own GET: nothing
        # (M-10 -- viewing Settings must not leave a live address nobody asked for).
        pre = mctx.request.get(BASE + "/api/j2/inbound-email/address")
        address_before_create = pre.json() if pre.ok else {"status": pre.status}
        create_status = None
        if create_btn.count():
            with mpage.expect_response(lambda r: r.request.method == "POST"
                                       and r.url.split("?", 1)[0].endswith("/api/j2/inbound-email/address"),
                                       timeout=20000) as made:
                create_btn.click()
            create_status = made.value.status
        addr_box.wait_for(state="visible", timeout=20000)
        address = addr_box.input_value()
        post = mctx.request.get(BASE + "/api/j2/inbound-email/address")
        address_after_create = (post.json() or {}).get("address") if post.ok else None
        created_ok = (address_before_create == {"address": None} and create_status is not None
                      and 200 <= create_status < 300 and bool(address) and address_after_create == address)

        unsigned_st, unsigned_body, _ = http("POST", "/api/j2/inbound-email", raw=b'{"to":"x"}',
                                             headers={"Content-Type": "application/json"})
        base_payload = {"to": address, "from": "walker@example.com", "text": "", "html": "", "attachments": []}
        bad_st, bad_body, _ = signed_email({**base_payload, "subject": "bad"}, secret=INBOUND_SECRET, bad_signature=True)
        old_st, old_body, _ = signed_email({**base_payload, "subject": "old"}, secret=INBOUND_SECRET,
                                           ts=str(int(_t.time()) - 3600))

        subject = f"Walk W16 mail {RUNWORD}"
        first = {**base_payload, "subject": subject, "text": f"Email body line {RUNWORD}.",
                 "attachments": [
                     {"name": "walk.png", "content_type": "image/png",
                      "base64": base64.b64encode(png_with_text(["W16"], size=(320, 140), font_px=60)).decode()},
                     {"name": "walk.pdf", "content_type": "application/pdf",
                      "base64": base64.b64encode(tiny_pdf()).decode()}]}
        s1, b1, _ = signed_email(first, secret=INBOUND_SECRET)
        answers = [s1]
        for i in range(2, 21):     # messages 2..20 fill the address's hour
            s, _b, _h = signed_email({**base_payload, "subject": f"Walk W16 filler {i:02d} {RUNWORD}",
                                      "text": f"filler {i}"}, secret=INBOUND_SECRET)
            answers.append(s)
        over = []
        for i in (21, 22):         # the FIRST and SECOND message over the per-address limit
            s, b, _h = signed_email({**base_payload, "subject": f"Walk W16 over {i:02d} {RUNWORD}",
                                     "text": f"over {i}"}, secret=INBOUND_SECRET)
            over.append({"n": i, "status": s, "body": jdecode(b)})

        listed = mctx.request.get(BASE + f"/api/j2/notes?q={RUNWORD}&limit=100").json().get("notes", [])
        mail_note = next((n for n in listed if n.get("title") == subject), None)
        fillers = [n for n in listed if (n.get("title") or "").startswith("Walk W16 filler")]
        overs = [n for n in listed if (n.get("title") or "").startswith("Walk W16 over")]
        body = (mctx.request.get(BASE + f"/api/j2/notes/{mail_note['id']}").json().get("note") or {}) if mail_note else {}
        kinds = type_by_walk(body.get("bodyJson"))
        folders = mctx.request.get(BASE + "/api/j2/note-folders").json()
        folder_list = folders.get("folders", folders) if isinstance(folders, dict) else folders
        folder_name = next((f.get("name") for f in (folder_list or []) if isinstance(f, dict)
                            and f.get("id") == body.get("folderId")), None)

        ui_row = ui_img = ui_chip = None
        if mail_note:
            open_list(mpage)
            ui_row = wait_list_row(mpage, subject)
            mpage = open_note(mctx, notebook_url(mail_note["id"]), mpage)
            ui_img = mpage.locator(".ProseMirror img").count() > 0
            # attachmentChip renders `a[data-type="attachmentChip"]` (lib/attachmentChip.js:31)
            ui_chip = mpage.locator('.ProseMirror a[data-type="attachmentChip"]').count() > 0

        drops, drops_error = None, None
        try:
            drops = {r[0]: r[1] for r in sandbox_db(
                "SELECT reason, SUM(count) FROM j2_inbound_drops WHERE user_id = ? GROUP BY reason", (uid,))}
        except Exception as e:  # noqa: BLE001
            drops_error = f"{type(e).__name__}: {e}"
        drop_log = launcher_lines(rf"\[inbound-email\] dropped for {re.escape(uid or '?')}: ")

        core_ok = (created_ok and unsigned_st == 401 and unsigned_body == b"" and bad_st == 401 and bad_body == b""
                   and old_st == 401 and all(a == 202 for a in answers) and all(o["status"] == 202 for o in over)
                   and mail_note is not None and kinds.get("image", 0) >= 1 and kinds.get("attachmentChip", 0) >= 1
                   and folder_name == "Inbox" and ui_row and ui_img and ui_chip
                   and len(fillers) == 19 and len(overs) == 0)
        if not core_ok:
            verdict, why = "FAIL", None
        elif drops is None:
            verdict, why = "INCONCLUSIVE", f"the drop record could not be read from the sandbox's auth.db ({drops_error})"
        else:
            verdict, why = ("PASS" if drops.get("address_rate") == 2 else "FAIL"), None
        record("W16_email_in", verdict, reason=why, provision=prov, address=address,
               address_before_create=address_before_create, create_status=create_status,
               address_after_create=address_after_create, address_created_on_intent=created_ok,
               signatures_distinct=len(set(SIGNATURES_SENT)) == len(SIGNATURES_SENT),
               unsigned_status=unsigned_st, unsigned_body_bytes=len(unsigned_body),
               bad_signature_status=bad_st, bad_signature_body_bytes=len(bad_body),
               stale_timestamp_status=old_st,
               first_message_status=s1, first_message_body=jdecode(b1), statuses_messages_1_to_20=answers,
               over_limit=over, mail_note_id=(mail_note or {}).get("id"), body_node_counts=kinds,
               folder=folder_name, ui_row_in_list=ui_row, ui_image_in_editor=ui_img, ui_attachment_chip=ui_chip,
               fillers_created=len(fillers), over_limit_notes_created=len(overs),
               drops_by_reason=drops, drops_read_from="the sandbox's auth.db j2_inbound_drops, read-only "
               "(no HTTP surface by design -- inbound_email.py: 'no oracle')", drop_log_lines=drop_log)

    check_w16()

    # =========================================================================
    # W17 -- H1 on the TOUCH tier: Scan, the mic, /Dictate, a denied microphone
    # =========================================================================
    @guarded("W17_mic_and_scan_touch_tier")
    def check_w17():
        global page
        note = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W17 touch {RUN}", "bodyJson": {"type": "doc", "content": [P("Touch tier body.")]},
        }).json()["note"]
        nid = note["id"]
        tctx = watch_beacons(browser.new_context(viewport={"width": 820, "height": 1180}, has_touch=True,
                                                 is_mobile=True, device_scale_factor=2), "touch")
        signup_or_login(tctx.request, EMAIL, PW, "w7walk")
        # The first-run dictation hint is dismissed the way VoiceInputButton.test.jsx's own
        # beforeEach does it (the one `voice.dictation.hintSeen` flag), so it cannot cover the mic.
        tctx.add_init_script("try { localStorage.setItem('voice.dictation.hintSeen', '1') } catch (e) {}")
        tpg = open_note(tctx, notebook_url(nid), _fresh_page(tctx))
        media = tpg.evaluate("() => ({innerWidth, touchTier: matchMedia('(max-width: 1024px)').matches, "
                             "coarse: matchMedia('(pointer: coarse)').matches, "
                             "secure: window.isSecureContext})")

        # Scan (NoteEditorPage.dictation.test.jsx, "the camera Scan door")
        scan = tpg.get_by_role("button", name="Scan a document with the camera", exact=True)
        scan_visible = scan.is_visible()
        scan_box = scan.bounding_box()
        inp = tpg.get_by_label("Scan a document with the camera — photo", exact=True)
        inp_attrs = inp.evaluate("e => ({type: e.getAttribute('type'), accept: e.getAttribute('accept'), "
                                 "capture: e.getAttribute('capture'), display: getComputedStyle(e).display})")
        chooser, chooser_attrs, chooser_error = False, None, None
        try:
            with tpg.expect_file_chooser(timeout=8000) as fc:
                scan.click()
            chooser = True
            chooser_attrs = fc.value.element.evaluate(
                "e => ({accept: e.getAttribute('accept'), capture: e.getAttribute('capture'), "
                "label: e.getAttribute('aria-label')})")
        except Exception as e:  # noqa: BLE001
            chooser_error = str(e)[:200]

        # The mic (`Start voice input`, inside the toolbar -- dictation.test.jsx; the real
        # VoiceInputButton names itself the same, VoiceInputButton.jsx:353).
        mic = tpg.get_by_role("button", name="Start voice input", exact=True)
        mic_present = mic.count() > 0
        mic_in_toolbar = mic.first.evaluate("e => !!e.closest('[role=\"toolbar\"]')") if mic_present else False
        mic_enabled = mic.first.is_enabled() if mic_present else None

        # /Dictate in the slash menu (SlashMenu.jsx: title 'Dictate')
        tpg.locator(".ProseMirror").click()
        tpg.keyboard.press("Control+End")
        tpg.keyboard.press("Enter")
        tpg.keyboard.type("/Dictate", delay=20)
        lb = tpg.get_by_role("listbox", name="Insert block")
        try:
            lb.wait_for(state="visible", timeout=8000)
            dictate_offered = lb.get_by_role("option", name="Dictate").count() > 0
        except Exception:  # noqa: BLE001
            dictate_offered = False
        tpg.keyboard.press("Escape")

        # A denied microphone: nothing is granted to this context, so getUserMedia rejects
        # and the editor's mic (holdOnFailure) must SAY so (holdOnFailure.test.jsx, "a blocked
        # microphone says so instead of doing nothing").
        alert_text, perm_state = None, None
        if mic_present:
            mic.first.click()
            alert = tpg.get_by_role("alert").filter(has_text="Couldn't use the microphone")
            try:
                alert.first.wait_for(state="visible", timeout=15000)
                alert_text = alert.first.inner_text()
            except Exception:  # noqa: BLE001
                perm_state = tpg.evaluate(
                    "async () => { try { return (await navigator.permissions.query({name: 'microphone'})).state } "
                    "catch (e) { return 'unqueryable: ' + e } }")
        tpg.close()
        tctx.close()

        # CONTROL: on the desktop tier the same Scan button exists but is display:none
        # (`.scanBtn`, NoteEditorPage.module.css, shown only at max-width 1024px).
        page = open_note(ctx, notebook_url(nid), page)
        desk_scan = page.get_by_role("button", name="Scan a document with the camera", exact=True, include_hidden=True)
        desk_display = desk_scan.first.evaluate("e => getComputedStyle(e).display") if desk_scan.count() else None

        ok = (media["touchTier"] and scan_visible and bool(scan_box) and chooser
              and inp_attrs["type"] == "file" and inp_attrs["accept"] == "image/*"
              and inp_attrs["capture"] == "environment"
              and mic_present and mic_in_toolbar and mic_enabled and dictate_offered
              and bool(alert_text) and desk_display == "none")
        record("W17_mic_and_scan_touch_tier", "PASS" if ok else ("INCONCLUSIVE" if mic_present and not alert_text and perm_state else "FAIL"),
               reason=None if ok or not (mic_present and not alert_text and perm_state) else
               "no microphone sentence within 15 s; the permission state is recorded -- the instrument cannot "
               "tell a pending prompt from a product that says nothing",
               viewport="820x1180 has_touch is_mobile", media=media,
               scan_visible_on_touch=scan_visible, scan_box=scan_box, scan_input=inp_attrs,
               scan_click_opened_a_file_chooser=chooser, chooser_input=chooser_attrs, chooser_error=chooser_error,
               mic_present=mic_present, mic_in_toolbar=mic_in_toolbar, mic_enabled=mic_enabled,
               dictate_slash_item_offered=dictate_offered,
               denied_microphone_sentence=alert_text, microphone_permission_state=perm_state,
               desktop_scan_display=desk_display)

    check_w17()

    # =========================================================================
    # W18 -- H2 with NO model key: the failure sentence, the note untouched
    # =========================================================================
    FAILED_SENTENCE = "Something went wrong writing that. Nothing was changed in your note."   # writing_help.py
    BUDGET_SENTENCE = "You've used today's writing help — it resets at midnight ET"            # writing_help.py

    @guarded("W18_writing_help_no_key")
    def check_w18():
        mismatch("W18", "Discard leaves the document byte-identical",
                 "after a FAILED draft the panel offers 'Write it' and 'Cancel'; 'Cancel' calls the same "
                 "`discard` the ready state's 'Discard' does", "WritingHelpPanel.jsx footer (status 'error')")
        mismatch("W18", "if a fake provider mode exists, drive Accept",
                 "no fake provider mode exists (writing_help.py streams through note_ask._async_client only), "
                 "so Accept cannot be driven without a model", "api/services/journal_two/writing_help.py")
        # ⛔ A FRESH MEMBER PER RUN (wave 7 phase 2, ruling D-H5b, `ce95a2717`): the 60/day
        # count is DURABLE in auth.db (`daily_usage_counters`, one row per scope, member and
        # ET day -- api/services/daily_counters.py). It no longer resets when the sandbox
        # restarts, so an account reused across runs on one ET day would carry an earlier
        # run's charges into this probe. A member made for this run starts at zero by
        # construction -- the same reason W16 makes one.
        hctx, prov = provision_member(browser, actx, f"w7help{RUN}@local.dev", "w7help")
        hapi, uid = hctx.request, prov["user_id"]
        passage = "I sold NVDA early because I was scared."
        note = hapi.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W18 help {RUN}",
            "bodyJson": {"type": "doc", "content": [P(f"Keep this. {passage} Keep that.")]},
        }).json()["note"]
        nid = note["id"]
        before = hapi.get(BASE + f"/api/j2/notes/{nid}").json()["note"]
        hpage = open_note(hctx, notebook_url(nid))
        wh = hpage.get_by_role("button", name="Writing help", exact=True)   # NoteEditorPage.writingHelp.test.jsx
        if wh.count() == 0:
            flag = find_key(hapi.get(BASE + "/api/auth/me").json(), "notebook_writing_help_enabled")
            record("W18_writing_help_no_key", "INCONCLUSIVE" if flag is not True else "FAIL",
                   reason="no Writing help entry; the auth payload's flag is " + repr(flag), flag=flag,
                   provision=prov)
            return
        # select the paragraph's text (the member's selection is what the panel works on)
        hpage.locator(".ProseMirror p").first.click()
        hpage.keyboard.press("Home")
        hpage.keyboard.press("Shift+End")
        wh.click()
        dialog = hpage.get_by_role("dialog")
        dialog.wait_for(state="visible", timeout=15000)
        scope_selection = dialog.get_by_text(re.compile(r"^Working on your selection")).count() > 0
        dialog.get_by_role("button", name="Rewrite shorter", exact=True).click()
        with hpage.expect_response(lambda r: r.url.split("?", 1)[0].endswith(f"/api/j2/notes/{nid}/writing-help/stream"),
                                   timeout=60000) as sr:
            dialog.get_by_role("button", name="Write it", exact=True).click()
        stream_status = sr.value.status
        try:
            events = [json.loads(ln[5:]) for ln in sr.value.text().splitlines() if ln.startswith("data:")]
        except Exception:  # noqa: BLE001
            events = None
        alert = dialog.get_by_role("alert")
        alert.wait_for(state="visible", timeout=30000)
        alert_text = alert.inner_text().strip()
        dialog.get_by_role("button", name="Cancel", exact=True).click()
        dialog.wait_for(state="detached", timeout=10000)
        hpage.wait_for_timeout(3000)   # past the autosave debounce: a save, if any, would have fired by now
        after = hapi.get(BASE + f"/api/j2/notes/{nid}").json()["note"]
        byte_identical = (json.dumps(before.get("bodyJson"), sort_keys=True) == json.dumps(after.get("bodyJson"), sort_keys=True)
                          and before.get("updatedAt") == after.get("updatedAt"))

        # ⛔ THE 60/DAY COUNT IS READ TWO WAYS (wave 7 phase 2: ruling D-H5b removed the
        # per-process `note_ask._writing_help_by_user` this comment used to name).
        # (1) Through the product's own refusal. Every FAILED request is refunded
        # (`note_ask.refund_due`: a server-side failure, or nothing sent), so 61 more
        # failures must never meet the 429 whose sentence is the member's budget -- were a
        # failure charged, request 60 or 61 of this batch would. With no key the SDK refuses
        # locally before any request is sent (anthropic 0.83.0 `_validate_headers`: "Could
        # not resolve authentication method").
        # (2) From the durable counter itself (below), read-only.
        statuses, budget_refusals, tails = {}, 0, set()
        for _ in range(61):
            r = hapi.post(BASE + f"/api/j2/notes/{nid}/writing-help/stream",
                          data={"action": "rewrite", "style": "shorter", "scope": "selection", "text": passage})
            statuses[r.status] = statuses.get(r.status, 0) + 1
            try:
                body = r.text()
            except Exception:  # noqa: BLE001
                body = ""
            if r.status == 429 and BUDGET_SENTENCE in body:
                budget_refusals += 1
            evs = [json.loads(ln[5:]) for ln in body.splitlines() if ln.startswith("data:")] if r.status == 200 else []
            if evs:
                tails.add(evs[-1].get("type"))

        # (2) THE DURABLE COUNT, read-only from the sandbox's auth.db (no HTTP surface shows
        # it). Its table and scope are read off their source (`_py_constant`), never typed.
        # ⛔ A WAITER, NOT A SAMPLE: a refund is fire-and-forget on a worker thread (ruling
        # D-H11), so the member's rows are re-read until every one is back at zero, bounded.
        counter_rows, counter_error, counter_settled = None, None, False
        try:
            wh_table = _py_constant("api/services/daily_counters.py", "TABLE")
            wh_scope = _py_constant("api/services/note_ask.py", "SCOPE_WRITING_HELP")
        except Exception as e:  # noqa: BLE001
            wh_table = wh_scope = None
            counter_error = f"{type(e).__name__}: {e}"
        settle_end = _t.time() + 20.0
        while wh_table and wh_scope:
            try:
                counter_rows = [{"day": d, "value": v} for d, v in sandbox_db(
                    f"SELECT day, value FROM {wh_table} WHERE scope = ? AND subject = ? ORDER BY day",
                    (wh_scope, str(uid)))]
                counter_error = None
            except Exception as e:  # noqa: BLE001
                counter_rows, counter_error = None, f"{type(e).__name__}: {e}"
            counter_settled = counter_rows is not None and all(abs(r["value"]) < 1e-9 for r in counter_rows)
            if counter_settled or _t.time() >= settle_end:
                break
            _t.sleep(0.5)

        probe_ok = (stream_status == 200 and scope_selection and alert_text == FAILED_SENTENCE and byte_identical
                    and budget_refusals == 0 and statuses.get(200, 0) == 61)
        # The refusal probe decides alone when the counter cannot be read (it is independent
        # evidence of the same fact); a readable counter left above zero is a charged failure.
        ok = probe_ok and (counter_rows is None or counter_settled)
        record("W18_writing_help_no_key", "PASS" if ok else "FAIL",
               provision=prov, note_id=nid, scope_says_selection=scope_selection, stream_status=stream_status,
               stream_events=events, alert_text=alert_text, expected_sentence=FAILED_SENTENCE,
               note_byte_identical_after_cancel=byte_identical,
               counter_probe={"requests": 61, "statuses": statuses, "budget_refusals": budget_refusals,
                              "last_event_types": sorted(t for t in tails if t)},
               durable_counter={"table": wh_table, "scope": wh_scope, "subject": uid, "rows": counter_rows,
                                "settled_at_zero": counter_settled, "read_error": counter_error,
                                "read_from": "the sandbox's auth.db, read-only, after 62 failed drafts "
                                             "(1 from the panel + 61 direct)"},
               accept_path="INCONCLUSIVE -- no fake provider mode exists, so Accept cannot be driven without a model")

    check_w18()

    # =========================================================================
    # W19 -- H3 dark: a natural-language query gets the LEXICAL list only
    # =========================================================================
    @guarded("W19_semantic_dark")
    def check_w19():
        query = f"why did my breakout trades fail {RUNWORD}"
        api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W19 lexical {RUN}",
            "bodyJson": {"type": "doc", "content": [P(f"Why did my breakout trades fail {RUNWORD}? A review.")]},
        })
        direct = api.get(BASE + "/api/j2/notes?q=" + urllib.parse.quote(query) + "&limit=50").json()
        d_rows = direct.get("notes", [])
        # the member's search box (FolderSidebar search mode, sort=relevance -- FolderSidebar.test.jsx:884)
        open_list(page)
        page.get_by_label("Search notes", exact=True).click()
        with page.expect_response(lambda r: "/api/j2/notes?" in r.url and "q=" in r.url and "sort=relevance" in r.url,
                                  timeout=20000) as sb:
            page.get_by_placeholder(re.compile("search notes", re.I)).fill(query)
        box_rows = (sb.value.json() or {}).get("notes", [])
        meaning = [r.get("id") for r in d_rows + box_rows if r.get("matchKind") == "meaning"]
        table, rows, db_error = None, None, None
        try:
            table = bool(sandbox_db("SELECT 1 FROM sqlite_master WHERE type='table' AND name='j2_note_embeddings'"))
            rows = sandbox_db("SELECT COUNT(*) FROM j2_note_embeddings")[0][0] if table else 0
        except Exception as e:  # noqa: BLE001
            db_error = f"{type(e).__name__}: {e}"
        reg = launcher_lines(r"notebook semantic sweep registered")
        semantic_log = launcher_lines(r"\[note-semantic\]")
        if db_error or reg is None:
            verdict = "INCONCLUSIVE" if not meaning else "FAIL"
            why = "; ".join(x for x in (
                f"embeddings table unreadable ({db_error})" if db_error else None,
                "no --launcher-log, so the sweep registration line cannot be read" if reg is None else None) if x)
        else:
            verdict = "PASS" if (not meaning and not rows and bool(reg) and not semantic_log) else "FAIL"
            why = None
        record("W19_semantic_dark", verdict, reason=why, query=query, query_tokens=len(query.split()),
               direct_rows=len(d_rows), search_box_rows=len(box_rows), search_box_request=sb.value.url.split(BASE, 1)[-1],
               meaning_rows=meaning, lexical_rows_present=bool(d_rows or box_rows),
               embeddings_table_exists=table, embeddings_rows=rows,
               sweep_registration_lines=reg, note_semantic_log_lines=semantic_log,
               no_embedding_call_evidence="0 rows (or no table) in j2_note_embeddings after the searches; "
               "the sandbox's request log is not per-call, so the table is the instrument")

    check_w19()

    # =========================================================================
    # W20 -- H4 dark: search_my_notes is never offered
    # =========================================================================
    @guarded("W20_compass_notes_tool_dark")
    def check_w20():
        mismatch("W20", "read the tools list the chat endpoint exposes",
                 "no endpoint exposes the TEXT chat's tool registry; GET .../coach/chat/status returns "
                 "{enabled, rate_limit_remaining, conversation_message_count, onboarded, onboarding_mode}",
                 "api/services/journal_two/coach_chat.py get_chat_status")
        voice = {}
        for context in ("global", "journal", "notebook"):
            r = api.get(BASE + f"/api/voice/tools?context={context}")
            names = []
            if r.ok:
                tools = (r.json() or {}).get("tools") or []
                names = sorted({(t.get("name") or (t.get("function") or {}).get("name")) for t in tools if isinstance(t, dict)} - {None})
            voice[context] = {"status": r.status, "tool_count": len(names), "has_search_my_notes": "search_my_notes" in names}
        record("W20_compass_notes_tool_dark", "INCONCLUSIVE",
               reason="the text chat's tool list is not exposed by any endpoint (it reaches only the model, "
                      "server-side, and the sandbox has no model key) -- the brief's own rule: INCONCLUSIVE",
               voice_catalog_by_context=voice,
               voice_note="the VOICE catalog is a different registry (search_my_notes is text-chat only, "
                          "ruling D-H4); it is recorded as a fact, not as the text chat's answer")

    check_w20()

    # =========================================================================
    # W21 -- I3: the lazy views and the lazy highlighter, in a COLD browser
    # =========================================================================
    @guarded("W21_lazy_views")
    def check_w21():
        tasks_file = manifest_file("src/pages/journal-2-0/components/notebook/NoteTasksView.jsx")
        hl_file = manifest_file("src/pages/journal-2-0/lib/codeHighlight.js")

        # (a) ?view=tasks, cold: a brand-new context has no chunk in memory or cache.
        cctx = watch_beacons(browser.new_context(viewport={"width": 1280, "height": 800}), "cold-tasks")
        signup_or_login(cctx.request, EMAIL, PW, "w7walk")
        cpg = _fresh_page(cctx)
        chunk_at = {}
        cpg.on("response", lambda r: chunk_at.setdefault("t", _t.time()) if tasks_file and r.url.endswith(tasks_file) else None)
        t_nav = _t.time()
        cpg.goto(notebook_url(None, "?view=tasks"))
        dismiss_intro(cpg)
        mounted = cpg.get_by_text("To tick a task off, open its note.").or_(cpg.get_by_text(re.compile(r"^No open tasks")))
        mounted.first.wait_for(state="visible", timeout=30000)   # a waiter, never a sleep
        t_mount = _t.time()
        heading = cpg.get_by_role("heading", name=re.compile("tasks", re.I)).count() > 0
        pressed = cpg.get_by_role("button", name="Tasks view", exact=True).get_attribute("aria-pressed")
        cpg.close()
        cctx.close()

        # (b) a code block renders plain <pre> first, highlighted after the highlighter lands.
        code_note = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W21 code {RUN}",
            "bodyJson": {"type": "doc", "content": [P("setup"), {"type": "codeBlock", "attrs": {"language": "python"},
                         "content": [{"type": "text", "text": "def total(xs):\n    return sum(xs)"}]}]},
        }).json()["note"]
        hctx = watch_beacons(browser.new_context(viewport={"width": 1280, "height": 800}), "cold-code")
        signup_or_login(hctx.request, EMAIL, PW, "w7walk")
        hpg = _fresh_page(hctx)
        held = []
        plain_first = highlighted_after = None
        hl_requested = False
        if hl_file:
            # CONTEXT-level, so the hold survives open_note swapping to a fresh page
            hctx.route(f"**/{hl_file}", lambda route: held.append(route))
        hpg = open_note(hctx, notebook_url(code_note["id"]), hpg)
        hpg.locator(".ProseMirror pre").first.wait_for(state="attached", timeout=15000)
        if hl_file:
            if not held:
                try:
                    hpg.wait_for_event("request", lambda r: r.url.endswith(hl_file), timeout=10000)
                except Exception:  # noqa: BLE001
                    pass
            hl_requested = bool(held)
            pre_text = hpg.locator(".ProseMirror pre").first.inner_text()
            spans_while_held = hpg.locator('.ProseMirror [class*="hljs-"]').count()
            plain_first = hl_requested and spans_while_held == 0 and "def total" in pre_text
            for route in held:
                route.continue_()
        try:
            # codeBlockNode.lazyHighlighter.test.js: `[class*="hljs-"]`, a keyword span once it lands
            hpg.locator('.ProseMirror [class*="hljs-keyword"]').first.wait_for(state="attached", timeout=20000)
            highlighted_after = True
        except Exception:  # noqa: BLE001
            highlighted_after = False
        hpg.close()
        hctx.close()

        tasks_ok = heading and pressed == "true" and (not tasks_file or "t" in chunk_at)
        code_ok = bool(highlighted_after) and (plain_first is True)
        if not hl_file or not tasks_file:
            verdict, why = "INCONCLUSIVE", ("no --dist manifest, so the chunk names cannot be DERIVED "
                                            "(they are never guessed) -- instrument")
        else:
            verdict, why = ("PASS" if tasks_ok and code_ok else "FAIL"), None
        record("W21_lazy_views", verdict, reason=why,
               tasks_chunk=tasks_file, tasks_chunk_fetched="t" in chunk_at,
               tasks_chunk_before_mount=("t" in chunk_at and chunk_at["t"] <= t_mount),
               seconds_nav_to_mount=round(t_mount - t_nav, 2), tasks_heading=heading, tasks_view_pressed=pressed,
               highlighter_chunk=hl_file, highlighter_requested=hl_requested,
               plain_pre_while_highlighter_held=plain_first, highlighted_after_release=highlighted_after)

    check_w21()

    # =========================================================================
    # W22 -- I1 at the sandbox's scale: 1,000 notes, REPORTED against the budget file
    # =========================================================================
    @guarded("W22_search_at_1k")
    def check_w22():
        budgets = json.load(open(os.path.join(REPO, "docs", "notebook", "perf-budgets.json"), encoding="utf-8"))
        tiers = sorted({v.get("tier") for v in budgets.values() if isinstance(v, dict) and v.get("tier")})
        mismatch("W22", "record p50/p95 against the 1k tier in docs/notebook/perf-budgets.json",
                 f"the file declares tiers {tiers} and no 1k tier; the readings are reported against the "
                 "100 ms p95 line both `search` (50k) and `search_ci` (10k) declare",
                 "docs/notebook/perf-budgets.json")
        # A FRESH member per run, so the tier is exactly 1,000 notes, whatever earlier runs left behind.
        sctx, prov = provision_member(browser, actx, f"w7scale{RUN}@local.dev", "w7scale")
        sapi = sctx.request
        t_seed, failures = _t.time(), 0
        for i in range(1000):
            extra = f" {RUNWORD}rare" if i % 250 == 0 else ""
            r = sapi.post(BASE + "/api/j2/notes", data={
                "title": f"Scale {i:04d}", "bodyJson": {"type": "doc", "content": [
                    P(f"Breakout setup {i}: volume dried up into the pivot, then expanded.{extra}")]}})
            failures += 0 if r.ok else 1
        seed_s = round(_t.time() - t_seed, 1)
        total = sapi.get(BASE + "/api/j2/notes?limit=1").json().get("total")

        spage = _fresh_page(sctx)
        open_list(spage)
        spage.get_by_label("Search notes", exact=True).click()
        with spage.expect_request(lambda r: "/api/j2/notes?" in r.url and "sort=relevance" in r.url, timeout=20000) as rq:
            spage.get_by_placeholder(re.compile("search notes", re.I)).fill("breakout")
        box_path = rq.value.url.split(BASE, 1)[-1]
        spage.close()

        def timed(path, reps=20, warm=2):
            samples, statuses = [], set()
            for k in range(warm + reps):
                t0 = _t.perf_counter()
                r = sapi.get(BASE + path)
                dt = (_t.perf_counter() - t0) * 1000
                statuses.add(r.status)
                if k >= warm:
                    samples.append(dt)
            return {"path": path, "reps": reps, "warmups": warm, "statuses": sorted(statuses),
                    "p50_ms": round(percentile(samples, 50), 1), "p95_ms": round(percentile(samples, 95), 1),
                    "max_ms": round(max(samples), 1)}

        ops = {
            "GET /notes q=common (list+count)": timed("/api/j2/notes?q=breakout"),
            "GET /notes q=common, relevance (search box)": timed(box_path),
            "GET /notes q=rare (list+count) [informational]": timed(f"/api/j2/notes?q={RUNWORD}rare"),
        }
        line = budgets.get("search_ci", {}).get("p95_ms_max")
        for o in ops.values():
            o["under_100ms_p95_line"] = (o["p95_ms"] < line) if line else None
        measured = failures == 0 and total == 1000 and all(o["statuses"] == [200] for o in ops.values())
        record("W22_search_at_1k", "PASS" if measured else "INCONCLUSIVE",
               reason=None if measured else "the tier or a request did not come out as seeded -- see the facts",
               enforced=False, verdict_means="the measurement was taken (REPORT, never enforce -- the 50k local gate is the verdict)",
               provision=prov, seeded=1000, seed_failures=failures, seed_seconds=seed_s, notes_total=total,
               ops=ops, budget_line_p95_ms=line, budget_tiers_declared=tiers,
               instrument="client wall clock around a real HTTP request on this box (auth + routing + JSON "
                          "included), not the benchmark's in-process function timing -- comparable in "
                          "direction only")

    check_w22()

    # =========================================================================
    # W23 -- J: the saved-view row, and " javascript:" through every mddoc door
    # =========================================================================
    @guarded("W23_saved_view_row_and_mddoc_links")
    def check_w23():
        global page
        mismatch("W23", "import a crafted markdown whose link href is ' javascript:alert(1)'",
                 "markdown cannot carry a leading-space href: markdown-it trims the destination and refuses "
                 "`javascript:` before a link exists, so the leading-space href reaches mddoc's check only "
                 "through HTML (J6's own rail); both shapes are driven",
                 "api/services/journal_two/test_note_convert_mddoc.py J6 rails")
        # ---- (1) the saved-view row: FolderSidebar.test.jsx, J5 ----------------
        view_name = f"Walk J5 {RUNWORD}"
        sv = api.post(BASE + "/api/j2/saved-views", data={"name": view_name, "viewType": "list", "spec": {}})
        view_id = ((sv.json() if sv.ok else {}) or {}).get("savedView", {}).get("id")
        open_list(page)
        exp = page.get_by_role("button", name="Expand Saved Views", exact=True)
        if exp.count():
            exp.click()
        select_btn = page.get_by_role("button", name=view_name, exact=True)
        select_btn.wait_for(state="visible", timeout=15000)
        nested = page.get_by_text("Saved Views", exact=True).first.evaluate("""(el) => {
            const section = el.closest('div').parentElement
            const buttons = [...section.querySelectorAll('button')]
            const nested = buttons.filter((b) => b.querySelector(
              'button, a[href], input, select, textarea, [role="button"], [tabindex], [aria-label]'))
            return {buttons: buttons.length, nested: nested.map((b) => b.getAttribute('title') || b.textContent)}
        }""")
        rows = api.get(BASE + "/api/j2/saved-views").json().get("savedViews", [])
        select_btn.focus()
        page.keyboard.press("Tab")
        after_tab = page.evaluate("() => document.activeElement && document.activeElement.getAttribute('aria-label')")
        page.keyboard.press("Enter")
        field = page.evaluate("(n) => [...document.querySelectorAll('input')].some((i) => i.value === n)", view_name)
        page.keyboard.press("Escape")
        page.get_by_role("button", name=view_name, exact=True).focus()
        page.keyboard.press("Tab")
        page.keyboard.press("Tab")
        after_two_tabs = page.evaluate("() => document.activeElement && document.activeElement.getAttribute('aria-label')")
        # ⛔ wave 7 phase 2 (instrument, found by the 96fa5ca2a run): "Delete <view>" does
        # not delete on its own and raises no native confirm(). Since UX #1 (`ac88fadc5`)
        # it opens the app's own ConfirmModal, `Delete view "<name>"?` (NotebookTab.jsx;
        # NotebookTab.test.jsx:616), which focuses its "Delete" button on mount
        # (ConfirmModal.jsx `confirmRef.current?.focus()`). So the KEYBOARD path is Enter
        # on the row's Delete, then Enter on the modal's focused Delete. The native
        # `dialog` listener stays, so a return to confirm() is still recorded.
        dialogs = []
        page.once("dialog", lambda d: (dialogs.append(d.message), d.accept()))
        url_before = page.url
        page.keyboard.press("Enter")
        confirm = page.get_by_role("dialog", name=f'Delete view "{view_name}"?')
        confirm_seen, confirm_focus = False, None
        try:
            confirm.wait_for(state="visible", timeout=10000)
            confirm_seen = True
            confirm_focus = page.evaluate("() => document.activeElement && document.activeElement.textContent.trim()")
            page.keyboard.press("Enter")
        except Exception:  # noqa: BLE001 -- recorded below; `gone` is the measured outcome
            pass
        gone = False
        end = _t.time() + 10
        while _t.time() < end:
            left = [v for v in api.get(BASE + "/api/j2/saved-views").json().get("savedViews", []) if v.get("id") == view_id]
            if not left:
                gone = True
                break
            _t.sleep(0.4)
        row_ok = (not nested["nested"] and nested["buttons"] >= 1 + 3 * max(1, len(rows))
                  and after_tab == f"Rename {view_name}" and field
                  and after_two_tabs == f"Delete {view_name}" and gone)

        # ---- (2) the mddoc doors ---------------------------------------------
        md = (f"Links {RUNWORD}: [md space]( javascript:alert(1)) then [md entity](java&#9;script:alert(1)) "
              f"then <a href=\" javascript:alert(1)\">html space</a> then [control](https://example.com/w23-{RUNWORD})")
        html = ('<p><a href=" javascript:alert(1)">html space</a> and <a href="java&#9;script:alert(1)">'
                f'html entity</a> and <a href="https://example.com/w23-{RUNWORD}">control</a></p>')
        doors = {}

        def judge(door, note_id):
            n = api.get(BASE + f"/api/j2/notes/{note_id}").json().get("note") or {}
            hrefs = link_hrefs(n.get("bodyJson"))
            nonlocal_page = open_note(ctx, notebook_url(note_id), page)
            dom = nonlocal_page.locator(".ProseMirror a[href]").evaluate_all("els => els.map((e) => e.getAttribute('href'))")
            doors[door] = {
                "note_id": note_id, "stored_hrefs": hrefs, "rendered_hrefs": dom,
                "script_hrefs_stored": [h for h in hrefs if href_is_script(h)],
                "script_hrefs_rendered": [h for h in dom if href_is_script(h)],
                "control_link_kept": any(f"example.com/w23-{RUNWORD}" in (h or "") for h in hrefs),
                "words_kept": ("space" in body_text(n.get("bodyJson"))),
            }
            return nonlocal_page

        # (a) the personal API's markdown (session-first: the walk's own session is enough)
        r = api.post(BASE + "/api/j2/personal/notes", data={"title": f"Walk W23 mddoc api {RUN}", "markdown": md})
        if r.ok:
            page = judge("personal_api_markdown", r.json()["note"]["id"])
        else:
            doors["personal_api_markdown"] = {"status": r.status, "undriven": True}
        # (b) email-in's HTML body, to the WALK account's own address (one message a run).
        # wave 7 phase 2 (whole-branch M-10): the GET never mints -- it answers
        # {"address": null} until the member makes one -- so a null answer is followed by the
        # member's own create (POST, what the card's "Create my address" sends). An address
        # that already exists is used as it is: a second POST would ROTATE it.
        addr = api.get(BASE + "/api/j2/inbound-email/address")
        to_addr = (addr.json() or {}).get("address") if addr.ok else None
        address_source, create_status = ("existing" if to_addr else None), None
        if addr.ok and not to_addr:
            made = api.post(BASE + "/api/j2/inbound-email/address")
            create_status = made.status
            to_addr = (made.json() or {}).get("address") if made.ok else None
            address_source = "created by POST" if to_addr else None
        if to_addr and INBOUND_SECRET:
            subj = f"Walk W23 mddoc email {RUNWORD}"
            s, _b, _h = signed_email({"to": to_addr, "from": "walker@example.com", "subject": subj,
                                      "text": "", "html": html, "attachments": []}, secret=INBOUND_SECRET)
            hit = next((n for n in api.get(BASE + f"/api/j2/notes?q={RUNWORD}&limit=100").json().get("notes", [])
                        if n.get("title") == subj), None)
            if s == 202 and hit:
                page = judge("email_in_html", hit["id"])
                doors["email_in_html"]["address_source"] = address_source
            else:
                doors["email_in_html"] = {"status": s, "note_found": bool(hit), "address_source": address_source,
                                          "undriven": True}
        else:
            doors["email_in_html"] = {"status": addr.status, "create_status": create_status,
                                      "address_source": address_source, "secret": bool(INBOUND_SECRET),
                                      "undriven": True}
        # (c) the member-facing Import (client-side converter, lib/importer/convert.js):
        # NotebookTab.test.jsx:264 `getAllByRole('button', {name: /import/i})[0]` -> the
        # wizard's Sheet dialog -> ImportWizard.test.jsx testid import-file-input -> /1 note/i
        # -> button /^import$/i -> the "Import complete" step title (ImportWizard.jsx).
        import_door = None
        try:
            import tempfile
            imp_dir = tempfile.mkdtemp(prefix="w7walk-")
            md_path = os.path.join(imp_dir, f"walk-w23-{RUNWORD}.md")
            with io.open(md_path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(f"# Walk W23 import {RUNWORD}\n\n{md}\n")
            open_list(page)
            # The header button's text is exactly "Import" (NotebookTab.jsx:1662-1670); the
            # test's own `/import/i` could also match an "Imported ..." folder row in the
            # sidebar, so the exact name is tried first and the fallback is recorded.
            imp_btn = page.get_by_role("button", name="Import", exact=True)
            import_door = "exact 'Import'" if imp_btn.count() else "the test's /import/i, first"
            (imp_btn if imp_btn.count() else page.get_by_role("button", name=re.compile("import", re.I))).first.click()
            # ⛔ wave 7 phase 2 (instrument, found by the 96fa5ca2a run): `data-testid=
            # "import-wizard"` exists ONLY on NotebookTab.test.jsx's shallow MOCK of the
            # wizard (:55); the real ImportWizard.jsx carries no such id, so waiting on it
            # could never succeed. The real wizard is a Sheet (role="dialog") whose title is
            # its step's (ImportWizard.jsx `sheetTitle`: "Import notes" -> "Review your
            # import" -> "Importing…" -> "Import complete"), and whose file input is
            # `data-testid="import-file-input"` (ImportWizard.jsx:924, ImportWizard.test.jsx
            # :110) -- a HIDDEN input, so it is waited on as attached, not visible.
            wiz = page.get_by_role("dialog").filter(
                has_text=re.compile(r"Import notes|Review your import|Importing|Import complete"))
            file_input = page.get_by_test_id("import-file-input")
            file_input.wait_for(state="attached", timeout=20000)
            file_input.set_input_files(md_path)
            wiz.get_by_text(re.compile(r"1 note", re.I)).first.wait_for(state="visible", timeout=20000)
            wiz.get_by_role("button", name=re.compile(r"^import$", re.I)).click()   # ImportWizard.test.jsx:172
            wiz.get_by_text("Import complete", exact=True).wait_for(state="visible", timeout=30000)
            imported = next((n for n in api.get(BASE + f"/api/j2/notes?q={RUNWORD}&limit=100").json().get("notes", [])
                             if "W23 import" in (n.get("title") or "") or f"walk-w23-{RUNWORD}" in (n.get("title") or "")), None)
            if imported:
                page = judge("import_wizard_markdown", imported["id"])
            else:
                doors["import_wizard_markdown"] = {"note_found": False, "undriven": True}
            doors.setdefault("import_wizard_markdown", {})["opened_by"] = import_door
        except Exception as e:  # noqa: BLE001 -- one door's failure must not erase the others
            doors["import_wizard_markdown"] = {"undriven": True, "error": str(e)[:300], "opened_by": import_door}

        driven = {k: v for k, v in doors.items() if not v.get("undriven")}
        doors_ok = all(not v["script_hrefs_stored"] and not v["script_hrefs_rendered"] and v["control_link_kept"]
                       for v in driven.values())
        if not row_ok or (driven and not doors_ok):
            verdict = "FAIL"
        elif len(driven) < len(doors):
            verdict = "INCONCLUSIVE"
        else:
            verdict = "PASS"
        record("W23_saved_view_row_and_mddoc_links", verdict,
               reason=None if verdict != "INCONCLUSIVE" else "a door could not be driven -- see doors",
               saved_view={"id": view_id, "buttons_in_section": nested["buttons"], "nested_controls": nested["nested"],
                           "tab_from_select_reaches": after_tab, "enter_opened_rename_field": field,
                           "two_tabs_reach": after_two_tabs, "enter_deleted": gone, "confirm_dialogs": dialogs,
                           "confirm_modal_seen": confirm_seen, "confirm_modal_focus_on": confirm_focus,
                           "url_unchanged_by_delete": page.url == url_before},
               doors=doors)

    check_w23()

    # =========================================================================
    # W21's boundary row, then W13 -- errors + sandbox integrity (regression row)
    # =========================================================================
    genuine_errors = [e for e in res["errors"] if FORCED_ERROR_MARKER not in e]
    deliberate_test_errors = [e for e in res["errors"] if FORCED_ERROR_MARKER in e]
    beacons = unforced_beacons()
    boundary_beacons = [b for b in beacons if b.get("kind") == "boundary"]

    if wanted("W21"):
        record(
            "W21_no_route_error_boundary",
            "PASS" if not ERROR_BOUNDARY["sightings"] and not boundary_beacons else "FAIL",
            route_fallback_sightings=ERROR_BOUNDARY["sightings"],
            boundary_beacons=boundary_beacons[:20],
            attempts_log=ERROR_BOUNDARY["attempts_log"][-40:],
            note=("every ErrorBoundary catch posts a beacon of kind 'boundary' (ErrorBoundary.jsx:20); the "
                  "beacon cannot say whether it was the ROUTE boundary, so any boundary report fails this row "
                  "conservatively and is listed; `route_fallback_sightings` are the route fallback's own text "
                  "(AppErrorFallback) seen by a mount waiter"),
        )

    # ⛔ W13 IS JUDGED LAST, AFTER THE BROWSER HAS CLOSED (tooling review I-2). The shutdown
    # checkpoint is the only one the launcher takes AFTER this walk's writes, and it exists
    # only once the sandbox has stopped. So nothing of the walk's is left talking to the
    # server, then it waits `--shutdown-wait` for the operator's graceful stop to write that
    # line, then reads the log with the harness's reader: pre-boot, +15 s AND shutdown, all
    # CLEAN, or W13 is not a PASS.
    browser.close()
    shutdown_waited_s = (wait_for_shutdown_checkpoint(ARGS.integrity_log, ARGS.shutdown_wait)
                         if wanted("W13") else None)
    launcher_text = (read_text_any(ARGS.launcher_log)
                     if ARGS.launcher_log and os.path.exists(ARGS.launcher_log) else None)
    integrity = w13_integrity(ARGS.integrity_log, launcher_text)
    integrity["shutdown_waited_s"] = shutdown_waited_s
    res["sandbox_integrity"] = integrity
    res["launcher_excerpts"] = {
        "startup_gate_lines": launcher_lines(r"\[startup\] (j2-ocr|notebook )"),
        "shared_root_blocked": launcher_lines(r"SHARED-ROOT WRITE BLOCKED"),
        "integrity_lines": launcher_lines(r"shared data root (CLEAN|baseline)|\[post-boot\]|\[shutdown\]"),
    }
    if wanted("W13"):
        w13_v, w13_why = w13_verdict(integrity, genuine_errors)
        record(
            "W13_errors_and_sandbox_integrity", w13_v, reason=w13_why,
            pageerror_count=len(genuine_errors), pageerrors=genuine_errors[:20],
            deliberate_test_errors_excluded=len(deliberate_test_errors),
            client_error_beacons_unforced=len(beacons), beacon_kinds=sorted({str(b.get("kind")) for b in beacons}),
            beacons=beacons[:20], forced_beacon_fence=FORCED_BEACONS,
            sandbox_integrity_status=integrity["status"],
            sandbox_integrity_checkpoints=[f'{c["label"]}: {c["verdict"]}' for c in integrity["checkpoints"]],
            sandbox_integrity_required=integrity["required"], sandbox_integrity_log=integrity["path"],
            launcher_log_names=integrity["launcher_log_names"], shutdown_waited_s=shutdown_waited_s,
        )

json.dump(res, open(OUT, "w", encoding="utf-8"), indent=1, ensure_ascii=False, default=str)
print(json.dumps({"checks": {k: v.get("verdict") for k, v in res["checks"].items()}}, indent=1))
