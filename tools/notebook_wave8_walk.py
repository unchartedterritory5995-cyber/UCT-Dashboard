"""Wave 8 live walk -- the Playwright script that produces
docs/notebook/gate-runs/wave8/walk-<sha>.json. Kept in tools/ so the evidence is
reproducible; it is NOT a pytest rail. Derived from tools/notebook_wave7_walk.py:
its harness (`@guarded`, `record`, the partial dump, `dismiss_intro`,
`open_note`, the self-provisioning accounts, `require_sandbox_identity`, the
integrity verdict decided AFTER the sandbox stops) is kept verbatim where it
could be, and every change is marked "wave 8:" in place.

⛔ READ THIS HEADER AND WAVE 7's BEFORE CHANGING A LINE. Their traps bit real
attempts, and they are still preconditions 1-4:

  1. A SANDBOX FROM THE TIP, on its own port, and C:\\data CLEAN at every
     checkpoint. Boot it from a `git archive` export of the tip in YOUR SCRATCH,
     never from the shared worktree (the launcher writes its integrity log under
     ITS OWN repo root, `docs/plans/joystick/sandbox-runs/<ts>.md`), through the
     SIGBREAK shim in its own process group (`tools/notebook_perf_harness._SHIM`),
     from POWERSHELL or with the data dir single-quoted -- through the Bash tool
     `C:\\data-w8walk` becomes the drive-relative `data-w8walk/` inside the cwd.
     The sandbox's environment, every name read off its read site:

        J2_SHARE_LINKS_ENABLED=1        note_shares.enabled() -> notebook_flags.flag_on
        NOTEBOOK_PUBLISH_ENABLED=1      note_publish.enabled() -> notebook_flags.flag_on
        NOTEBOOK_ONBOARDING_ENABLED=1   notebook_onboarding._enabled() -> notebook_flags.flag_on
        ANTHROPIC_API_KEY='' OPENAI_API_KEY=''       NO model key, stated
        NOTE_EXPORT_MAX_ATTACHMENT_BYTES=<small>     notes_export._attachment_cap_bytes (W4's
                                                     WebP Word export meets the cap; unset
                                                     = the 200 MiB default, read from source)

     Those three are the wave-8 gates `docs/feature_flags.json` names; wave 7's gates
     stay unset (no wave-8 row needs one). Run THIS script with the same environment
     (the walk records what its own process holds; only what the sandbox ANSWERS is
     evidence about the sandbox).

  2. THE WALK ACCOUNTS ARE PAID on that data dir, or AuthGuard sends every notebook
     route elsewhere. Self-provisioning, as waves 6-7: the sandbox admin
     (ADMIN_EMAILS = hubtest@local.dev, the launcher's --test-email) is signed up if
     missing; every member this walk uses is signed up, comped
     (POST /api/auth/admin/comp-access) and verified (POST /api/auth/admin/verify-email).
     wave 8: the password is a TEST VALUE the operator generates and hands in through
     `W8WALK_PASSWORD` (it is never in this file, the JSON or a log); without it the walk
     makes one for this run, and a re-run on the same data dir then cannot sign in.

  3. app/dist REBUILT FROM THE TIP (`npm run build` in the export's app/, through a
     node_modules junction removed afterwards with a NON-recursive `cmd /c rmdir`).

  4. THE SERVER PROVES IT IS THIS RUN'S SANDBOX before one request is sent:
     `scripts/sandbox_identity.verify(--base, --integrity-log)` must find the same
     per-run nonce in both, or the walk prints `REFUSED: ...` and exits 3.

    python tools/notebook_wave8_walk.py docs/notebook/gate-runs/wave8/walk-<sha>.json \\
        --tip <sha> --base http://127.0.0.1:<port> --data-dir 'C:\\data-w8walk' \\
        --launcher-log <scratch>\\launcher.log \\
        --integrity-log <export>\\docs\\plans\\joystick\\sandbox-runs\\<ts>.md \\
        --dist <export>\\app\\dist --axe <worktree>\\app\\node_modules\\axe-core\\axe.min.js

`--only W2_,W3_` runs a subset (provisioning always runs) -- a SHAKE-OUT convenience;
an evidence run runs everything.

W11 IS DECIDED AFTER THE SANDBOX STOPS (wave 7's W13, renamed). When the rows are done
the walk closes its browser and waits `--shutdown-wait` seconds for the launcher's
SHUTDOWN checkpoint: stop the sandbox then, gracefully (CTRL_BREAK to its process
group). PASS only when pre-boot, +15 s and shutdown are all present and CLEAN.

Real Chromium (Playwright), synthetic accounts. Desktop 1280x800 unless noted. Each
check records what the DOM or the API said; nothing is inferred. Every sentence the walk
compares against is READ from the committed source (`js_string`, `py_string`,
`tour_steps`, ...), never typed; rails: tests/test_notebook_wave8_walk.py.

  W1  onboarding: tour auto-start / every step / Done + Dismiss persist / help link /
      collapsed sidebar; the sample notebook in and out; the 409 (API and UI)
  W2  share links: a Massive chart + an FMP figure; a stranger's view; headers; revoke;
      trash stops it, restore brings it back
  W3  publish: a note and a folder; noindex / nosniff; an in-app link card and a pasted
      in-app link show no note id; unpublish
  W4  per-note export md / html / json / docx; the saved name from filename*; the
      autosave-window word (FE M-9); a WebP-heavy Word export inside the cap (BE I-2)
  W5  axe in the page (the repo's pinned axe-core, injected) on five surfaces; focus on
      open / new / Create link / Revoke / Escape
  W6  offline with onboarding on (FE I-2)
  W7  the lazyChunk in-place retry in a real engine
  W8  (wave 5) trash + favorite notices at 1200/820/390; bulk trash of 40 and Undo
  W9  the daily-note template preference survives a reload (notebook_daily_template)
  W10 touch EMULATION at 390: opening an existing note leaves no focused field (FE I-1)
  W11 integrity, after the sandbox stops

⛔ WHERE THE PRODUCT DISAGREES WITH THE BRIEF -- measured against the product, recorded
in `brief_mismatches`, never silently "fixed":
  * W2: no FMP or Finnhub FACT can exist in a note today. `fact_registry.FACT_TYPES`
    holds exactly one FMP type, `analyst_price_target_consensus`, with `active=False`
    (capture refuses it), and no Finnhub type at all. The FMP figure a note CAN hold is
    the fundamentals widget (`public_note_payload.MARKET_DATA_VENDORS` -> fmp -> SHOWN),
    carrying its archived image; that is what W2 puts on the page.
  * W3: a link CARD for an in-app page cannot be made through the paste door here: the
    card is fetched by the SANDBOX server from the pasted address, and the only address
    the reducer treats as in-app is the production host (`_OWN_HOSTS`), which this walk
    never contacts. The card is stored through the API in the card's own shape; the
    pasted in-app LINK is driven for real, through the clipboard.
  * W6: "reload -> the Notebook renders from the durable copy" cannot happen in any
    browser: index.html is served `no-store` and the app registers no caching service
    worker (main.jsx; CLAUDE.md "THERE IS NO SERVICE WORKER"), so an offline document
    reload is the browser's own offline page by construction. It is MEASURED and recorded;
    the verdict rests on the reachable paths -- offline navigation inside a loaded
    Notebook, Journal -> Notebook offline, and a first-run member whose tour chunk fails.
"""
import argparse
import ast
import base64
import hashlib
import html as _html
import io
import json
import operator
import os
import re
import secrets
import sys
import time as _t
import traceback
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import xml.etree.ElementTree as ET

from playwright.sync_api import sync_playwright

# ─────────────────────────────────────────────────────────────────────────────
# THE IMPORTABLE PART (wave 7 phase 2). Everything above `ARGS = _ap.parse_args()`
# runs with no argv, no browser and no sandbox: tests/test_notebook_wave8_walk.py
# executes exactly this prefix (cut by AST at that assignment) to rail W11's
# verdict, the --base identity gate and wave 8's verdict helpers and source readers.
# Nothing here reads ARGS or sends a request except the identity check, through the
# launcher's own helper.
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
    owner's live auth.db while W11 read some other sandbox's clean log. So BEFORE THE
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

# W11 needs the launcher's pre-boot, +15 s AND shutdown checkpoints -- the harness's
# labels, which are the launcher's own words (railed against scripts/hub_sandbox_boot.py
# by tests/test_notebook_perf_harness.py). +120 s is not required (a walk that ends
# early has not reached it), but read_integrity still judges it when it is present.
# wave 8: wave 7's W13 is this wave's W11 -- the names follow the row.
W11_REQUIRED = (_harness.PRE_BOOT, _harness.POST_BOOT, _harness.SHUTDOWN)


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
    # wave 8: the operator's cue names W11 (the driver waits for exactly this line).
    print(f"(W11: waiting up to {wait_s:.0f} s for the shutdown checkpoint in {path} -- stop the "
          "sandbox now, gracefully; W11 is INCONCLUSIVE without it)", file=sys.stderr, flush=True)
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


def w11_integrity(path, launcher_text=None):
    """The launcher's integrity log, read by the HARNESS's reader against W11_REQUIRED
    (never a second parser), plus the review's cross-check: is `path` the log the launcher
    itself named in its output? None = no launcher output to ask."""
    integ = _harness.read_integrity(path, list(W11_REQUIRED))
    named = integrity_log_named_in(launcher_text)
    integ["launcher_log_names"] = named
    integ["launcher_log_agrees"] = (None if not (named and path) else
                                    os.path.normcase(os.path.abspath(named)) == os.path.normcase(os.path.abspath(path)))
    return integ


def w11_verdict(integ, genuine_errors):
    """(verdict, reason) for W11. PASS needs EVIDENCE: every required checkpoint present
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


# ─────────────────────────────────────────────────────────────────────────────
# wave 8: the verdict helpers -- pure, so the rails can hold each to its rule.
# ─────────────────────────────────────────────────────────────────────────────

def unfenced(items, fences):
    """`items` minus those whose INDEX falls inside a deliberate-failure fence. A fence is
    `[lo, hi)`; `hi` None means "to the end". wave 8: wave 7 fenced ONE forced throw with a
    marker string; this wave has several deliberate failures (a blocked tour chunk, a
    chunk aborted once, an offline reload), each fenced by index while it runs."""
    def inside(i):
        return any(lo <= i < (len(items) if hi is None else hi) for lo, hi in fences)
    return [x for i, x in enumerate(items) if not inside(i)]


def find_leaks(text, needles):
    """Every needle (an id, an email, a name...) that appears in `text`, sorted. Empty
    needles are ignored: an empty string is in every text and would read as a leak."""
    t = text or ""
    return sorted({str(n) for n in needles if n and str(n) in t})


SERIOUS = ("serious", "critical")


def serious_violations(violations):
    """The axe violations W5 judges: impact serious or critical (the brief's bar). The
    rest are recorded beside them, never dropped."""
    return [v for v in (violations or []) if isinstance(v, dict) and v.get("impact") in SERIOUS]


def disposition_filename(header):
    """The file name a Content-Disposition names: RFC 5987 `filename*=UTF-8''...` first,
    then `filename="..."`; None when neither. ⛔ The instrument keeps its OWN copy on
    purpose (the product's is `exportFormats.js::filenameFromDisposition`): a walk that
    imported the product's parser would agree with any bug in it."""
    value = header or ""
    star = re.search(r"filename\*\s*=\s*UTF-8''([^;]+)", value, re.IGNORECASE)
    if star:
        try:
            return urllib.parse.unquote(star.group(1).strip(), errors="strict")
        except UnicodeDecodeError:
            pass
    plain = re.search(r'filename="([^"]+)"', value)
    return plain.group(1) if plain else None


def public_api_headers_ok(headers):
    """(ok, facts) for a PUBLIC API answer: `nosniff` and `no-store` (the brief's W2 pair).
    Header names are compared case-insensitively."""
    h = {str(k).lower(): str(v) for k, v in (headers or {}).items()}
    facts = {"x-content-type-options": h.get("x-content-type-options"), "cache-control": h.get("cache-control")}
    ok = ("nosniff" in (facts["x-content-type-options"] or "").lower()
          and "no-store" in (facts["cache-control"] or "").lower())
    return ok, facts


#: The heading the Word writer puts above what a .docx could not hold
#: (api/services/journal_two/notes_export_formats.py, `_run("Not included in this export")`
#: inside the Word builder; the rail checks the string is still there).
DOCX_NOT_INCLUDED = "Not included in this export"


def docx_facts(blob):
    """What a .docx holds, read with the standard library: its members, every part parsing
    as XML, the embedded media and their sizes, each paragraph's text, and the lines listed
    under DOCX_NOT_INCLUDED."""
    zf = zipfile.ZipFile(io.BytesIO(blob))
    names = zf.namelist()
    media = {n: zf.getinfo(n).file_size for n in names if n.startswith("word/media/")}
    bad_xml = []
    for n in names:
        if n.endswith(".xml") or n.endswith(".rels"):
            try:
                ET.fromstring(zf.read(n))
            except ET.ParseError:
                bad_xml.append(n)
    doc = zf.read("word/document.xml").decode("utf-8") if "word/document.xml" in names else ""
    paras = []
    for p in re.findall(r"<w:p(?=[\s>]).*?</w:p>", doc, flags=re.S):
        paras.append(_html.unescape("".join(re.findall(r"<w:t(?:\s[^>]*)?>([^<]*)</w:t>", p))))
    listed = paras[paras.index(DOCX_NOT_INCLUDED) + 1:] if DOCX_NOT_INCLUDED in paras else []
    return {"members": names, "bad_xml": bad_xml, "media": media, "media_count": len(media),
            "media_total": sum(media.values()), "paragraphs": paras, "not_included": listed}


def make_block_once():
    """A Playwright route handler that ABORTS the first request it sees and lets every later
    one through, and the counts it keeps. W7 uses it: one lost fetch, then the network is
    fine -- the case the in-place retry exists for."""
    state = {"calls": 0, "aborted": 0, "continued": 0}

    def handler(route):
        state["calls"] += 1
        if state["aborted"] == 0:
            state["aborted"] += 1
            route.abort("failed")
        else:
            state["continued"] += 1
            route.continue_()
    return handler, state


#: Two sentences the walk waits on that are JSX text, not constants -- typed ONCE here, and
#: the rail proves each is still in the component it names.
ROUTE_FALLBACK_TEXT = "Something went wrong on this page"   # components/AppErrorFallback.jsx
NOTE_LOAD_ERROR = "Couldn't load this note."                 # components/notebook/NoteEditorPage.jsx


def takes_text(info):
    """Whether the focused element (as FOCUS_JS describes it) accepts typed text: a field,
    or anything contenteditable. FE I-1's bar: an existing note's open must land on none."""
    if not info:
        return False
    return bool(info.get("editable")) or info.get("tag") in ("INPUT", "TEXTAREA", "SELECT")


# ─────────────────────────────────────────────────────────────────────────────
# wave 8: SOURCE READERS -- every sentence and title the walk compares against is read
# from the committed file, never typed (a typed copy is a second authority that drifts).
# Above the cut so the rails can prove each still finds what it looks for.
# ─────────────────────────────────────────────────────────────────────────────
TOUR_STEPS_JS = "app/src/pages/journal-2-0/components/notebook/onboarding/tourSteps.js"
TOUR_COPY_JS = "app/src/pages/journal-2-0/components/notebook/onboarding/tourCopy.js"
SAMPLE_JS = "app/src/pages/journal-2-0/components/notebook/onboarding/sampleNotebook.js"
SAMPLE_PY = "api/services/journal_two/sample_notebook.py"
SAMPLE_JSON = "api/services/journal_two/sample_notebook.json"
PUBLIC_PAYLOAD_PY = "api/services/journal_two/public_note_payload.py"
NOTES_EXPORT_PY = "api/services/journal_two/notes_export.py"
NOTES_EXPORT_FORMATS_PY = "api/services/journal_two/notes_export_formats.py"
SHARED_PAGE_JSX = "app/src/pages/journal-2-0/SharedNotePage.jsx"
PUBLISHED_PAGE_JSX = "app/src/pages/journal-2-0/PublishedPage.jsx"
SUPPORT_JSX = "app/src/pages/Support.jsx"
FACT_REGISTRY_PY = "api/services/journal_two/fact_registry.py"


def repo_text(relpath):
    with open(os.path.join(REPO, relpath), encoding="utf-8") as fh:
        return fh.read()


def py_string(relpath, name):
    """A module-level string constant read off its SOURCE by AST -- never by importing
    `api.*`, whose module-level paths would resolve to C:\\data from this process. A name
    that is not a plain string there is a LookupError, never a guess. (wave 7's
    `_py_constant`, moved above the cut so the rails reach it.)"""
    tree = ast.parse(repo_text(relpath))
    for node in tree.body:
        if (isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets)
                and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str)):
            return node.value.value
    raise LookupError(f"{name} is not a module-level string constant in {relpath}")


_NUM_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.FloorDiv: operator.floordiv}


def _num(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _NUM_OPS:
        return _NUM_OPS[type(node.op)](_num(node.left), _num(node.right))
    raise LookupError("not a numeric constant expression")


def py_number(relpath, name):
    """A module-level NUMBER, read off its source: a literal or constant arithmetic
    (`200 * 1024 * 1024`). Anything else is a LookupError."""
    tree = ast.parse(repo_text(relpath))
    for node in tree.body:
        targets = node.targets if isinstance(node, ast.Assign) else (
            [node.target] if isinstance(node, ast.AnnAssign) and node.value is not None else [])
        if any(isinstance(t, ast.Name) and t.id == name for t in targets):
            return _num(node.value)
    raise LookupError(f"{name} is not a module-level numeric constant in {relpath}")


# The quote is a NAMED group: embedded after other groups (tour_steps), a numbered `\1`
# would point at the wrong group and match nothing (the rail caught exactly that).
_JS_STR = r"""(?P<q>['"])((?:\\.|(?!(?P=q)).)*)(?P=q)"""


def _js_unescape(s):
    return re.sub(r"\\(.)", r"\1", s)


def js_string(relpath, key):
    """The FIRST `key: '...'` (an object property) or `const key = '...'` string in a JS
    file, quotes either kind; a LookupError when there is none."""
    text = repo_text(relpath)
    k = re.escape(key)
    m = re.search(r"(?:(?<![\w$])" + k + r"\s*:|\bconst\s+" + k + r"\s*=)\s*" + _JS_STR, text)
    if not m:
        raise LookupError(f"no string `{key}` in {relpath}")
    return _js_unescape(m.group(2))


def tour_steps():
    """The tour's steps IN ORDER (`tourSteps.js`), each with its anchor, the file carrying
    the anchor and its title (`tourCopy.js`): [{id, anchor, file, title}]."""
    steps = re.findall(r"step\(\s*'([\w-]+)'\s*,\s*'([\w-]+)'\s*,\s*'([^']+)'\s*\)", repo_text(TOUR_STEPS_JS))
    titles = {}
    for m in re.finditer(r"(?:'([\w-]+)'|(?<![\w$'])([A-Za-z][\w]*))\s*:\s*Object\.freeze\(\{\s*title:\s*" + _JS_STR,
                         repo_text(TOUR_COPY_JS)):
        titles[m.group(1) or m.group(2)] = _js_unescape(m.group(4))
    return [{"id": i, "anchor": a, "file": f, "title": titles.get(i)} for i, a, f in steps]


def gone_sentence(relpath):
    """The dead-link sentence a public page renders (`<h1 className={styles.goneTitle}>`)."""
    m = re.search(r"className=\{styles\.goneTitle\}>([^<]+)</h1>", repo_text(relpath))
    if not m:
        raise LookupError(f"no goneTitle heading in {relpath}")
    return m.group(1).strip()


def help_question_with_tour_link():
    """The help article (Support.jsx FAQS) whose answer carries `<TourLink />` -- its `q`."""
    text = repo_text(SUPPORT_JSX)
    at = text.find("<TourLink />")              # a USE (the definition is `function TourLink()`)
    qs = [m for m in re.finditer(r"\bq:\s*" + _JS_STR, text) if m.start() < at] if at >= 0 else []
    if not qs:
        raise LookupError("no FAQ answer carries <TourLink />")
    return _js_unescape(qs[-1].group(2))


def link_mark_hrefs(node):
    """Every link MARK's href in a bodyJson tree (node attributes such as a card's `url`
    are not marks and are not read here)."""
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


_ap = argparse.ArgumentParser(description="Wave 8 live walk (see the module header).")
_ap.add_argument("out", nargs="?", default="wave8_walk.json")
_ap.add_argument("--base", default="http://127.0.0.1:8228")
_ap.add_argument("--tip", default=None, help="the SHA the sandbox was booted from")
_ap.add_argument("--data-dir", default=r"C:\data-w8walk",
                 help="the sandbox data dir (recorded; wave 8 reads nothing from it)")
_ap.add_argument("--launcher-log", default=None,
                 help="the sandbox launcher's captured stdout/stderr")
_ap.add_argument("--integrity-log", default=None,
                 help="the launcher's own integrity log (<export>/docs/plans/joystick/sandbox-runs/<ts>.md)")
_ap.add_argument("--shutdown-wait", type=float, default=_harness.BASE_SHUTDOWN_WAIT_S,
                 help="seconds to wait, after the rows, for the sandbox's SHUTDOWN checkpoint "
                      f"(default {_harness.BASE_SHUTDOWN_WAIT_S:.0f}, the harness's); stop the sandbox "
                      "to supply it -- W11 is INCONCLUSIVE without it")
_ap.add_argument("--dist", default=None, help="the app/dist the sandbox serves (for .vite/manifest.json)")
# wave 8: axe-core is the repo's exact-pinned devDependency (ruling D-A1); the export has no
# node_modules of its own, so the operator names the installed copy.
_ap.add_argument("--axe", default=None, help="axe.min.js (default: <repo>/app/node_modules/axe-core/axe.min.js)")
_ap.add_argument("--artifacts", default=None, help="a directory for downloads and screenshots (optional)")
_ap.add_argument("--only", default=None, help="comma list of check prefixes, e.g. W2_,W3_ (shake-out only)")
ARGS = _ap.parse_args()

BASE = ARGS.base.rstrip("/")
# wave 8: one generated TEST password for every sandbox account (header, precondition 2).
_PW_FROM_ENV = bool(os.environ.get("W8WALK_PASSWORD"))
PW = os.environ.get("W8WALK_PASSWORD") or secrets.token_urlsafe(18)
ADMIN_EMAIL = "hubtest@local.dev"          # the launcher's --test-email; ADMIN_EMAILS in the sandbox
EMAIL = "w8walk@local.dev"                 # primary walk account (persists across runs on one data dir)
NAME = "Walker Eight"                      # its display name -- a needle W2/W3 search the public page for
OUT = ARGS.out
P = lambda t: {"type": "paragraph", "content": [{"type": "text", "text": t}]}  # noqa: E731
DOC = lambda *nodes: {"type": "doc", "content": list(nodes)}  # noqa: E731
RUN = _t.strftime("r%H%M%S")   # unique per run: repeat runs never match an older run's notes
# A letters-only twin of RUN (FTS treats it as one word): r134501 -> "wrbdefab".
RUNWORD = "w" + "".join("abcdefghkm"[int(c)] if c.isdigit() else c for c in RUN)
AXE_PATH = ARGS.axe or os.path.join(REPO, "app", "node_modules", "axe-core", "axe.min.js")
ART = ARGS.artifacts
if ART:
    os.makedirs(ART, exist_ok=True)

# Gate names, each read off its read site (see the header). The walk records what ITS OWN
# process holds for each (the same environment booted the sandbox) AND what the sandbox
# answers -- only the second is evidence about the sandbox.
GATES_ARMED = ("J2_SHARE_LINKS_ENABLED", "NOTEBOOK_PUBLISH_ENABLED", "NOTEBOOK_ONBOARDING_ENABLED")
KEYS_BLANK = ("ANTHROPIC_API_KEY", "OPENAI_API_KEY")


def _sha256_file(path):
    try:
        with open(path, "rb") as fh:
            return hashlib.sha256(fh.read()).hexdigest()
    except OSError:
        return None


res = {
    "wave": 8, "errors": [], "checks": {},
    "tip": ARGS.tip, "base": BASE, "port": int(BASE.rsplit(":", 1)[-1]) if BASE.rsplit(":", 1)[-1].isdigit() else None,
    "run": RUN, "only": ARGS.only, "data_dir": ARGS.data_dir,
    "instrument": {"file": os.path.relpath(os.path.abspath(__file__), REPO), "sha256": _sha256_file(__file__)},
    "brief_mismatches": [], "instrument_notes": [],
    "password_source": "W8WALK_PASSWORD" if _PW_FROM_ENV else "generated for this run (never written)",
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
    print(f"[{verdict}] {key}: " + json.dumps(facts, default=str, ensure_ascii=True)[:300], flush=True)
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

    'Detached' is a real, verifiable signal here, not a guess: the component
    is `if (phase !== 'playing') return null` (IntroAnimation.jsx:82), so once
    its own `finish()` fires (Escape/Enter/Space, capture-phase, or the Skip
    button) the whole `<div role="dialog">` subtree is removed from the DOM,
    not merely hidden or mid-transition. It plays once per browser TAB's
    sessionStorage, so on a page that already dismissed it this is a fast no-op.
    wave 8: it also plays on the PUBLIC pages (/share/n, /p), so a stranger's page
    is dismissed through here too before anything is read or scanned."""
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


# ⛔ THE RETRY IN open_note STAYS, BUT IT HIDES NOTHING (wave 7). Every route-level
# fallback it sees is recorded in ERROR_BOUNDARY["sightings"], and the rows read that list.
ERROR_BOUNDARY = {"sightings": [], "attempts_log": []}
# wave 8: ROUTE_FALLBACK_TEXT moved above the cut (the rail proves it is still the fallback's)

# ⭐ EVENT-DRIVEN, NOT SAMPLED (wave 7): every ErrorBoundary catch and every
# window.onerror posts a client-error beacon; a context-level request listener sees each.
BEACONS = []
# wave 8: deliberate failures are FENCED by index while they run (see `unfenced`): one list
# for page errors, one for beacons. A fence is [lo, hi); hi None until the window closes.
ERROR_FENCES = []
BEACON_FENCES = []


def fence_open(why):
    ERROR_FENCES.append([len(res["errors"]), None])
    BEACON_FENCES.append([len(BEACONS), None])
    res.setdefault("fences", []).append({"why": why, "errors_from": len(res["errors"]), "beacons_from": len(BEACONS)})


def fence_close():
    for fences, n in ((ERROR_FENCES, len(res["errors"])), (BEACON_FENCES, len(BEACONS))):
        if fences and fences[-1][1] is None:
            fences[-1][1] = n
    res["fences"][-1].update({"errors_to": len(res["errors"]), "beacons_to": len(BEACONS)})


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


# wave 8: every preference write, with the key it sent and the server's status -- W1 and W9
# are about whether a preference ANSWERS 200 (the 2026-09-26 H14 was a 400 nobody saw).
PREF_WRITES = []


def watch_prefs(ctx, label):
    def _on_response(r):
        try:
            if r.request.method == "POST" and r.url.endswith("/api/auth/preferences"):
                body = json.loads(r.request.post_data or "{}")
                PREF_WRITES.append({"who": label, "key": body.get("key"), "value": body.get("value"),
                                    "status": r.status, "t": round(_t.time(), 3)})
        except Exception as e:  # noqa: BLE001 -- the instrument's own failure is recorded, never swallowed
            res["instrument_notes"].append(f"pref listener ({label}): {e}")
    ctx.on("response", _on_response)
    return ctx


def watch(ctx, label):
    return watch_prefs(watch_beacons(ctx, label), label)


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
    never a sleep followed by a sample."""
    either = pg.locator(".ProseMirror").or_(pg.get_by_text(ROUTE_FALLBACK_TEXT))
    either.first.wait_for(state="attached", timeout=timeout)
    return "fallback" if _route_fallback_visible(pg) else "editor"


def open_note(ctx, url, page=None, max_tries=8, prosemirror_timeout=15000, extra_listeners=None):
    """Navigate (hard nav) to a note URL; returns the page whose editor mounted.

    wave 6's fresh-page-per-retry discipline is kept. Callers MUST reassign:
    `page = open_note(ctx, url, page)`. The `page` passed in is BORROWED and never
    closed here; only pages this function creates for retries 2+ are owned and
    recycled. Raises after `max_tries` so the caller's @guarded wrapper reports
    INCONCLUSIVE."""
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


PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)
FONT_PATH = os.path.join(REPO, "api", "services", "desk_assets", "DejaVuSans-Bold.ttf")


def http(method, path, *, body=None, raw=None, headers=None, timeout=90):
    """One request with NO cookie jar (urllib), answering (status, bytes, headers). wave 8:
    a stranger's read of a public route, with nothing that could identify the owner."""
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


def png_with_text(lines, size=(1700, 560), font_px=104):
    """A plain black-on-white PNG (Pillow, the font the app itself ships)."""
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


def noise_webp(side=600, quality=80):
    """wave 8: a WebP of random noise -- small stored, large once converted to PNG for Word
    (the BE I-2 case: the cap must be charged at the EMBEDDED size)."""
    from PIL import Image
    buf = io.BytesIO()
    Image.frombytes("RGB", (side, side), os.urandom(side * side * 3)).save(buf, "WEBP", quality=quality)
    return buf.getvalue()


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
    """The built chunk for a source module, from the build's OWN .vite/manifest.json -- a
    chunk name is derived, never guessed from a filename pattern."""
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


def provision_member(browser, actx, email, name, **ctx_kwargs):
    """A signed-up, comped, VERIFIED member in its own context (wave 6's provisioning, per
    account). wave 8: the context also carries the preference watch and accepts downloads."""
    opts = {"viewport": {"width": 1280, "height": 800}, "accept_downloads": True}
    opts.update(ctx_kwargs)
    c = watch(browser.new_context(**opts), email)
    signup_or_login(c.request, email, PW, name)
    comp = actx.request.post(BASE + "/api/auth/admin/comp-access", data={"email": email, "action": "grant"})
    ver = actx.request.post(BASE + "/api/auth/admin/verify-email", data={"email": email})
    me_r = c.request.get(BASE + "/api/auth/me")
    me = me_r.json() if me_r.ok else {}
    facts = {"comp": comp.status, "verify": ver.status, "me": me_r.status, "paid_equiv": me.get("paid_equiv"),
             "user_id": (me.get("user") or {}).get("id")}
    # ⛔ A row must never measure through a member that does not exist (wave 7 phase 2).
    if not facts["paid_equiv"] or not facts["user_id"]:
        raise RuntimeError(f"provisioning {email} did not produce a signed-in, paid member: {facts}")
    return c, facts


def clone_session(src_ctx, label, **ctx_kwargs):
    """wave 8: a NEW browser context signed in as `src_ctx`'s member, by its cookies
    (`storage_state`) -- a fresh module map, HTTP cache and IndexedDB, and no second sign-in
    against the app's 5/minute login limit."""
    opts = {"viewport": {"width": 1280, "height": 800}, "accept_downloads": True,
            "storage_state": src_ctx.storage_state()}
    opts.update(ctx_kwargs)
    return watch(browser.new_context(**opts), label)


def select_box(pg, title):
    """The list row's checkbox is named `Select <title>` (NoteCard.jsx)."""
    return pg.get_by_role("checkbox", name=f"Select {title}", exact=True)


def open_list(pg, extra="?view=all"):
    pg.goto(notebook_url(None, extra))
    dismiss_intro(pg)


def mismatch(check, brief_says, product_does, source):
    res["brief_mismatches"].append({"check": check, "brief": brief_says, "product": product_does, "source": source})


def shot(pg, name):
    """A screenshot into --artifacts (optional); its file name, or None."""
    if not ART:
        return None
    path = os.path.join(ART, f"{RUN}-{name}.png")
    try:
        pg.screenshot(path=path)
        return os.path.basename(path)
    except Exception as e:  # noqa: BLE001
        return f"screenshot failed: {e}"


def mk_note(api, title, body, **extra):
    r = api.post(BASE + "/api/j2/notes", data={"title": title, "bodyJson": body, **extra})
    if not r.ok:
        raise RuntimeError(f"POST /api/j2/notes {r.status}: {r.text()[:300]}")
    return r.json()["note"]


def mk_folder(api, name):
    r = api.post(BASE + "/api/j2/note-folders", data={"name": name})
    if not r.ok:
        raise RuntimeError(f"POST /api/j2/note-folders {r.status}: {r.text()[:300]}")
    b = r.json()
    return (b.get("folder") or b)["id"]


def upload_image(api, note_id, name, mime, data):
    r = api.post(BASE + f"/api/j2/notes/{note_id}/images",
                 multipart={"file": {"name": name, "mimeType": mime, "buffer": data}})
    if not r.ok:
        raise RuntimeError(f"image upload {r.status}: {r.text()[:300]}")
    return r.json()


def pref_value(api, key):
    """The stored preference (the server keeps a TEXT column; a JSON value is parsed)."""
    r = api.get(BASE + "/api/auth/preferences")
    prefs = r.json() if r.ok else {}
    raw = prefs.get(key) if isinstance(prefs, dict) else None
    try:
        return json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        return raw


# The focused element, as W5 / W10 / FE I-1 read it.
FOCUS_JS = """() => { const a = document.activeElement
  if (!a || a === document.body) return null
  return { tag: a.tagName, editable: a.isContentEditable, landmark: a.hasAttribute('data-note-landmark'),
           noteTitle: a.hasAttribute('data-note-title'), text: (a.textContent || '').trim().slice(0, 80),
           label: a.getAttribute('aria-label'), popup: a.getAttribute('aria-haspopup'),
           role: a.getAttribute('role'), inPane: !!a.closest('[data-note-pane]') } }"""

MARK_ALIVE_JS = "() => { window.__w8walkAlive = 'alive'; return true }"
IS_ALIVE_JS = "() => window.__w8walkAlive === 'alive'"


# ⛔ NOTHING IS SENT TO --base UNTIL IT PROVES IT IS THIS RUN'S SANDBOX (tooling review M-3).
require_sandbox_identity(BASE, ARGS.integrity_log, sink=res)

with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---- Provisioning: admin and the primary walk account ------------------
    # wave 8: wave 7's second member (W3's cross-member template check) is not provisioned;
    # no wave-8 row reads through a second standing member. Per-row members are made by
    # `provision_member` with a RUN-unique address, so their state starts at zero.
    actx = watch(browser.new_context(), "admin")
    signup_or_login(actx.request, ADMIN_EMAIL, PW, "hubtest")
    res["admin_login_ok"] = actx.request.get(BASE + "/api/auth/me").ok

    ctx = watch(browser.new_context(viewport={"width": 1280, "height": 800}, accept_downloads=True), "walk")
    signup_or_login(ctx.request, EMAIL, PW, NAME)
    api = ctx.request
    c = actx.request.post(BASE + "/api/auth/admin/comp-access", data={"email": EMAIL, "action": "grant"})
    res.setdefault("comp_status", {})[EMAIL] = c.status
    # A non-admin signup starts email_verified=False, and AuthGuard sends an unverified
    # member to /verify-pending regardless of plan (wave 6's trap). Admin-only door.
    v = actx.request.post(BASE + "/api/auth/admin/verify-email", data={"email": EMAIL})
    res.setdefault("verify_email_status", {})[EMAIL] = v.status

    me = api.get(BASE + "/api/auth/me").json()
    res["account"] = {"role": (me.get("user") or {}).get("role"), "plan": me.get("plan"),
                      "paid_equiv": me.get("paid_equiv")}
    if not me.get("paid_equiv"):
        res["INCOMPLETE"] = True
        res["errors"].append(
            "ABORT: walk account is not paid (paid_equiv false) -- comp-access did not take; "
            "re-run after confirming admin_login_ok and comp_status above")
        raise SystemExit(2)
    WALK_USER_ID = (me.get("user") or {}).get("id")

    # ---- wave 8: the gate values, and what the SANDBOX says about each -------
    obs = {k: find_key(me, k) for k in ("j2_share_links_enabled", "notebook_publish_enabled",
                                         "notebook_onboarding_enabled")}
    obs["GET /api/j2/onboarding/sample-notebook"] = api.get(BASE + "/api/j2/onboarding/sample-notebook").status
    obs["GET /api/j2/share/links"] = api.get(BASE + "/api/j2/share/links").status
    obs["GET /api/j2/publish"] = api.get(BASE + "/api/j2/publish").status
    obs["launcher: startup lines naming notebook"] = launcher_lines(r"\[startup\].*notebook")
    try:
        default_cap = py_number(NOTES_EXPORT_PY, "_DEFAULT_ATTACHMENT_CAP_BYTES")
    except LookupError as e:
        default_cap = None
        res["instrument_notes"].append(str(e))
    cap_env = os.environ.get("NOTE_EXPORT_MAX_ATTACHMENT_BYTES")
    EXPORT_CAP = int(cap_env) if (cap_env or "").isdigit() else default_cap
    res["gates"] = {
        "walk_process_env": {n: os.environ.get(n) for n in GATES_ARMED},
        "walk_process_keys_blank": {k: os.environ.get(k) in (None, "") for k in KEYS_BLANK},
        "observed_from_sandbox": obs,
    }
    res["config"] = {
        "export_cap_bytes": EXPORT_CAP, "export_cap_source": "NOTE_EXPORT_MAX_ATTACHMENT_BYTES (walk env)"
        if cap_env else "notes_export._DEFAULT_ATTACHMENT_CAP_BYTES (source)",
        "axe_path": AXE_PATH, "axe_sha256": _sha256_file(AXE_PATH),
    }
    try:
        res["config"]["axe_pinned"] = json.load(open(os.path.join(REPO, "app", "package.json"),
                                                     encoding="utf-8")).get("devDependencies", {}).get("axe-core")
    except Exception as e:  # noqa: BLE001
        res["instrument_notes"].append(f"package.json: {e}")

    page = ctx.new_page()
    page.on("pageerror", lambda e: res["errors"].append(str(e)[:300]))
    open_list(page)

    SHARED = {}   # facts one row leaves for another (a live share token for W5's public page)

    # =========================================================================
    # W1 -- onboarding: the tour, the sample notebook, the refusal
    # =========================================================================
    TOUR_CARD = 'div[role="dialog"][aria-modal="true"][aria-describedby]'
    ACTIVE_ANCHOR_JS = """() => {
      const el = document.querySelector('[data-tour-active="true"]')
      if (!el) return null
      const r = el.getBoundingClientRect()
      const inView = r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight
      let hit = false
      if (inView) {
        const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1)
        const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1)
        // the browser's own hit test: a clipped or covered-by-clip anchor is not in this list
        hit = document.elementsFromPoint(x, y).some((e) => e === el || el.contains(e))
      }
      return { anchor: el.getAttribute('data-tour'), inView, hit,
               box: [r.left, r.top, r.width, r.height].map(Math.round) }
    }"""

    def tour_card(pg):
        return pg.locator(TOUR_CARD).filter(has=pg.locator("h2"))

    def pref_post(key, state=None):
        """A predicate for the POST that writes preference `key` (and, for the tour, the
        `state` inside its value)."""
        def pred(r):
            if r.request.method != "POST" or not r.url.endswith("/api/auth/preferences"):
                return False
            try:
                body = json.loads(r.request.post_data or "{}")
            except ValueError:
                return False
            val = body.get("value")
            if isinstance(val, str):
                try:     # the tour's value is JSON; the daily template's is a bare id (shake-out 2)
                    val = json.loads(val)
                except ValueError:
                    pass
            return body.get("key") == key and (state is None or (isinstance(val, dict) and val.get("state") == state))
        return pred

    def walk_tour(pg, ui, finish="done"):
        """Step through the open tour with its own Next button, one step at a time, reading
        each step's title, its progress line and its outlined anchor. `finish` = 'done'
        presses Done at the end.

        ⛔ INSTRUMENT (shake-out 1): each step's preference write is AWAITED before the next
        press. The tour records every step with a fire-and-forget POST; pressing Next as fast
        as a script can (milliseconds) put three writes in flight at once, the server
        committed them in its own order, and the value read after Done was an earlier
        step's -- a race no member's hand makes. One write in flight at a time is the pace
        of a person reading a card."""
        card = tour_card(pg)
        seen = []
        for _ in range(20):
            title = card.locator("h2").inner_text(timeout=5000)
            progress = card.locator("p").first.inner_text(timeout=5000)
            seen.append({"title": title, "progress": progress, "anchor": pg.evaluate(ACTIVE_ANCHOR_JS)})
            nxt = card.get_by_role("button", name=ui["next"], exact=True)
            if nxt.count():
                with pg.expect_response(pref_post("notebook_tour", "started"), timeout=15000):
                    nxt.click()
                pg.wait_for_function("([sel, t]) => { const h = document.querySelector(sel + ' h2');"
                                     " return h && h.textContent !== t }", arg=[TOUR_CARD, title], timeout=8000)
                continue
            if finish == "done":
                with pg.expect_response(pref_post("notebook_tour", "done"), timeout=15000):
                    card.get_by_role("button", name=ui["done"], exact=True).click()
            break
        return seen

    def tour_absent_after_reload(pg, home_title):
        """Reload, wait for the first-run screen, then give the tour its auto-start delay and
        a margin as a BOUNDED waiter: a card appearing at any instant inside it is caught."""
        pg.reload()
        dismiss_intro(pg)
        pg.get_by_role("heading", name=home_title).first.wait_for(state="visible", timeout=20000)
        try:
            tour_card(pg).first.wait_for(state="visible", timeout=5000)
            return False
        except Exception:  # noqa: BLE001 -- the wait running out IS the measurement
            return True

    @guarded("W1_onboarding")
    def check_w1():
        steps = tour_steps()
        ui = {k: js_string(TOUR_COPY_JS, k) for k in ("next", "done", "skip", "help")}
        copy = {k: js_string(SAMPLE_JS, k) for k in ("add", "tour", "refused", "strip", "remove", "removed")}
        server_refusal = py_string(SAMPLE_PY, "REFUSED_SENTENCE")
        sample = json.loads(repo_text(SAMPLE_JSON))
        welcome_title = next(n["title"] for n in sample["notes"] if n["key"] == sample["welcome"])
        sidebar_titles = [s["title"] for s in steps if s["file"].endswith("FolderSidebar.jsx")]
        home_title = steps[0]["title"]                    # the first-run step's own title
        facts = {"tour_steps_in_source": [s["title"] for s in steps], "sidebar_step_titles": sidebar_titles}

        tour_email = f"w8tour{RUN}@local.dev"
        tctx, facts["provision_tour_member"] = provision_member(browser, actx, tour_email, "Tour Walker")
        tapi = tctx.request
        pg = _fresh_page(tctx)
        # (a) the tour auto-starts once for an empty, paid member, and walks every step to Done
        #     (its opening write awaited, as every later one is -- see walk_tour)
        with pg.expect_response(pref_post("notebook_tour", "started"), timeout=30000):
            pg.goto(notebook_url())
            dismiss_intro(pg)
            tour_card(pg).first.wait_for(state="visible", timeout=20000)
        facts["tour_shot"] = shot(pg, "w1-tour-step1")
        walked = walk_tour(pg, ui)
        tour_card(pg).first.wait_for(state="detached", timeout=8000)
        titles = [s["title"] for s in walked]
        # the progress line is upper-cased by CSS, and inner_text reads what is RENDERED
        totals = {int(m.group(1)) for s in walked for m in [re.search(r"of (\d+)", s["progress"] or "", re.I)] if m}
        available = [s["title"] for s in steps if s["title"] in titles]
        facts["auto_start"] = {"titles": titles, "progress": [s["progress"] for s in walked],
                               "anchors": [s["anchor"] for s in walked],
                               "every_available_step_in_order": titles == available,
                               "progress_total_matches": totals == {len(titles)},
                               "every_anchor_on_screen": all((s["anchor"] or {}).get("hit") for s in walked)}
        facts["pref_after_done"] = pref_value(tapi, "notebook_tour")
        facts["absent_after_reload_done"] = tour_absent_after_reload(pg, home_title)

        # (b) "Take the tour" reopens it; Escape dismisses; the dismissal persists too
        take = pg.get_by_role("button", name=copy["tour"], exact=True)
        with pg.expect_response(pref_post("notebook_tour", "started"), timeout=15000):
            take.click()
            tour_card(pg).first.wait_for(state="visible", timeout=10000)
        facts["reopened_at"] = tour_card(pg).locator("h2").inner_text()
        with pg.expect_response(pref_post("notebook_tour", "dismissed"), timeout=15000):
            pg.keyboard.press("Escape")
        tour_card(pg).first.wait_for(state="detached", timeout=8000)
        try:   # recorded, not judged (the brief does not ask): where focus went back to
            pg.wait_for_function("() => document.activeElement && document.activeElement !== document.body",
                                 timeout=3000)
        except Exception:  # noqa: BLE001
            pass
        facts["focus_after_escape"] = pg.evaluate(FOCUS_JS)
        facts["pref_after_dismiss"] = pref_value(tapi, "notebook_tour")
        facts["absent_after_reload_dismiss"] = tour_absent_after_reload(pg, home_title)

        # (c) the sidebar collapsed: no sidebar step outlines an anchor nobody can see (FE M-7)
        pg.get_by_role("button", name="Hide folders panel", exact=True).click()
        pg.get_by_role("button", name="Show folders panel", exact=True).wait_for(state="visible", timeout=8000)
        with pg.expect_response(pref_post("notebook_tour", "started"), timeout=15000):
            pg.get_by_role("button", name=copy["tour"], exact=True).click()
            tour_card(pg).first.wait_for(state="visible", timeout=10000)
        collapsed = walk_tour(pg, ui)
        tour_card(pg).first.wait_for(state="detached", timeout=8000)
        ctitles = [s["title"] for s in collapsed]
        facts["collapsed_sidebar"] = {
            "titles": ctitles, "anchors": [s["anchor"] for s in collapsed],
            "sidebar_steps_skipped": not any(t in ctitles for t in sidebar_titles),
            "sidebar_steps_shown_when_open": all(t in titles for t in sidebar_titles),
            "every_anchor_on_screen": all((s["anchor"] or {}).get("hit") for s in collapsed)}
        pg.get_by_role("button", name="Show folders panel", exact=True).click()

        # (d) help -> "Take the tour" opens it on the Notebook (FE M-7, the other direction)
        q = help_question_with_tour_link()
        pg.goto(f"{BASE}/support")
        dismiss_intro(pg)
        pg.get_by_role("button", name=q, exact=True).first.click(timeout=15000)
        link = pg.get_by_role("link", name=copy["tour"], exact=True).first
        link.wait_for(state="visible", timeout=10000)
        try:
            with pg.expect_response(pref_post("notebook_tour", "started"), timeout=20000):
                link.click()
                pg.wait_for_url(re.compile(r"/journal/notebook"), timeout=15000)
                tour_card(pg).first.wait_for(state="visible", timeout=10000)
            help_opened = tour_card(pg).locator("h2").inner_text()
        except Exception:  # noqa: BLE001 -- recorded as "did not open"; the verdict reads it
            help_opened = None
        facts["help_take_the_tour"] = {"question": q, "url": pg.url, "opened_at": help_opened}
        if help_opened:
            with pg.expect_response(pref_post("notebook_tour", "dismissed"), timeout=15000):
                pg.keyboard.press("Escape")
            tour_card(pg).first.wait_for(state="detached", timeout=8000)

        tour_writes = [w for w in PREF_WRITES if w["who"] == tour_email and w["key"] == "notebook_tour"]
        facts["notebook_tour_writes"] = {"count": len(tour_writes), "statuses": sorted({w["status"] for w in tour_writes}),
                                         "states": [(json.loads(w["value"]) if isinstance(w["value"], str) else w["value"] or {}).get("state")
                                                    for w in tour_writes]}

        # (e) Add a sample notebook -> the sample folder and the welcome note open
        pg.goto(notebook_url())
        dismiss_intro(pg)
        add_btn = pg.get_by_role("button", name=copy["add"], exact=True)
        add_btn.wait_for(state="visible", timeout=20000)
        with pg.expect_response(lambda r: r.url.endswith("/api/j2/onboarding/sample-notebook")
                                and r.request.method == "POST", timeout=30000) as ai:
            add_btn.click()
        added = ai.value
        added_body = added.json() if added.ok else {}
        pg.locator(".ProseMirror").first.wait_for(state="attached", timeout=30000)
        pg.wait_for_function("(t) => [...document.querySelectorAll('input')].some((i) => i.value === t)",
                             arg=welcome_title, timeout=20000)
        folder_visible = pg.get_by_text(sample["folder"], exact=True).first.is_visible()
        status = tapi.get(BASE + "/api/j2/onboarding/sample-notebook").json()
        facts["sample_added"] = {"status": added.status, "welcomeNoteId": added_body.get("welcomeNoteId"),
                                 "url_opens_welcome": f"note={added_body.get('welcomeNoteId')}" in pg.url,
                                 "folder_visible": folder_visible, "ids": len(status.get("ids", [])),
                                 "active": len(status.get("activeIds", []))}
        facts["sample_shot"] = shot(pg, "w1-sample-welcome")

        # (f) the strip shows; Remove it -> the notes are in Trash and the strip is gone
        pg.goto(notebook_url())
        dismiss_intro(pg)
        strip = pg.get_by_text(copy["strip"], exact=False).first
        strip.wait_for(state="visible", timeout=20000)
        pg.get_by_role("button", name=copy["remove"], exact=True).click()
        pg.get_by_text(copy["removed"], exact=True).first.wait_for(state="visible", timeout=20000)
        strip_gone = True
        try:
            pg.get_by_text(copy["strip"], exact=False).first.wait_for(state="detached", timeout=10000)
        except Exception:  # noqa: BLE001
            strip_gone = False
        after = tapi.get(BASE + "/api/j2/onboarding/sample-notebook").json()
        trash = tapi.get(BASE + "/api/j2/notes?deleted=true&limit=200").json().get("notes", [])
        trashed_ids = {n.get("id") for n in trash}
        facts["sample_removed"] = {"strip_gone": strip_gone, "active_after": after.get("activeIds"),
                                   "ids": len(after.get("ids", [])),
                                   "all_in_trash": bool(after.get("ids")) and set(after.get("ids", [])) <= trashed_ids}

        # (g) the refusal for an account with notes: the API's 409 sentence ...
        r409 = tapi.post(BASE + "/api/j2/onboarding/sample-notebook")
        facts["refusal_api"] = {"status": r409.status, "detail": (r409.json() or {}).get("detail") if r409.status < 500 else None,
                                "is_server_sentence": r409.status == 409 and (r409.json() or {}).get("detail") == server_refusal}
        SHARED["tour_member_ctx"] = tctx
        pg.close()

        # ... and the UI's own sentence for it (FE M-13), in a race: the first-run screen is
        # open, a note lands from elsewhere, THEN the member presses Add.
        rctx, facts["provision_race_member"] = provision_member(browser, actx, f"w8race{RUN}@local.dev", "Race Walker")
        rpg = _fresh_page(rctx)
        rpg.goto(notebook_url())
        dismiss_intro(rpg)
        tour_card(rpg).first.wait_for(state="visible", timeout=20000)   # a new member: the tour starts
        rpg.keyboard.press("Escape")
        tour_card(rpg).first.wait_for(state="detached", timeout=8000)
        rpg.get_by_role("button", name=copy["add"], exact=True).wait_for(state="visible", timeout=15000)
        mk_note(rctx.request, f"Written elsewhere {RUN}", DOC(P("elsewhere")))
        rpg.get_by_role("button", name=copy["add"], exact=True).click()
        alert = rpg.get_by_role("alert").filter(has_text=copy["refused"][:20]).first
        try:
            alert.wait_for(state="visible", timeout=15000)
            ui_text = alert.inner_text().strip()
        except Exception:  # noqa: BLE001
            ui_text = [a.strip() for a in rpg.get_by_role("alert").all_inner_texts()]
        facts["refusal_ui"] = {"text": ui_text, "is_client_sentence": ui_text == copy["refused"]}
        rpg.close()
        rctx.close()

        ok = (facts["auto_start"]["every_available_step_in_order"] and facts["auto_start"]["progress_total_matches"]
              and facts["auto_start"]["every_anchor_on_screen"] and len(titles) >= 2
              and (facts["pref_after_done"] or {}).get("state") == "done" and facts["absent_after_reload_done"]
              and (facts["pref_after_dismiss"] or {}).get("state") == "dismissed" and facts["absent_after_reload_dismiss"]
              and facts["notebook_tour_writes"]["count"] > 0 and facts["notebook_tour_writes"]["statuses"] == [200]
              and facts["collapsed_sidebar"]["sidebar_steps_skipped"]
              and facts["collapsed_sidebar"]["sidebar_steps_shown_when_open"]
              and facts["collapsed_sidebar"]["every_anchor_on_screen"]
              and bool(facts["help_take_the_tour"]["opened_at"])
              and facts["sample_added"]["status"] == 200 and facts["sample_added"]["url_opens_welcome"]
              and facts["sample_added"]["folder_visible"] and facts["sample_added"]["active"] == facts["sample_added"]["ids"] > 0
              and facts["sample_removed"]["strip_gone"] and facts["sample_removed"]["active_after"] == []
              and facts["sample_removed"]["all_in_trash"]
              and facts["refusal_api"]["is_server_sentence"] and facts["refusal_ui"]["is_client_sentence"])
        record("W1_onboarding", "PASS" if ok else "FAIL", **facts)

    check_w1()

    # =========================================================================
    # W2 -- share links: a stranger's view of a note holding market data
    # =========================================================================
    def public_facts(pctx, url, testid, needles, resp_filter):
        """A stranger opens `url` in `pctx` (no cookie): the page's text and full HTML, the
        HTML response's headers, and every /api/ answer the page fetched -- each searched
        for the needles."""
        pg = _fresh_page(pctx)
        seen = []
        pg.on("response", lambda r: seen.append(r))
        doc_resp = pg.goto(url)
        dismiss_intro(pg)
        pg.get_by_test_id(testid).first.wait_for(state="visible", timeout=30000)
        text = pg.locator("body").inner_text()
        html_doc = pg.content()
        payloads = []
        for r in seen:
            if "/api/" not in r.url:
                continue
            try:
                body = r.text() if "image" not in (r.headers.get("content-type") or "") else ""
            except Exception:  # noqa: BLE001 -- a body the browser no longer holds
                body = ""
            payloads.append({"url": r.url.replace(BASE, ""), "status": r.status,
                             "headers": {k: v for k, v in r.headers.items() if k in (
                                 "cache-control", "x-content-type-options", "x-robots-tag",
                                 "referrer-policy", "content-security-policy", "content-type")},
                             "leaks": find_leaks(body, needles), "matched": resp_filter(r.url)})
        return pg, {
            "url": url.replace(BASE, ""), "html_status": doc_resp.status if doc_resp else None,
            "html_headers": {k: v for k, v in (doc_resp.headers if doc_resp else {}).items()
                             if k in ("x-robots-tag", "referrer-policy", "cache-control")},
            "meta": pg.evaluate("() => ({robots: document.querySelector('meta[name=robots]')?.content || null,"
                                " referrer: document.querySelector('meta[name=referrer]')?.content || null})"),
            "dom_leaks": find_leaks(html_doc, needles), "text": text,
            "payloads": payloads,
        }

    @guarded("W2_share_links")
    def check_w2():
        global page
        neutral = py_string(PUBLIC_PAYLOAD_PY, "NEUTRAL_LINE")
        gone = gone_sentence(SHARED_PAGE_JSX)
        mismatch("W2", "a note holding an FMP/Finnhub figure (a financial fact)",
                 "no FMP or Finnhub FACT can be captured today: fact_registry holds one FMP type, "
                 "analyst_price_target_consensus, with active=False, and no Finnhub type; the FMP figure a "
                 "note can hold is the fundamentals widget (vendor fmp, SHOWN), with its archived image",
                 f"{FACT_REGISTRY_PY} FACT_TYPES; {PUBLIC_PAYLOAD_PY} MARKET_DATA_VENDORS")
        other = mk_note(api, f"Walk W2 other {RUN}", DOC(P("the note it links to")))
        tag, trade = f"w8secret{RUNWORD}", f"trade-{RUNWORD}"
        n = mk_note(api, f"Walk W2 share {RUN}", DOC(P("placeholder")), tags=[tag], ticker="ZZWE")
        img = upload_image(api, n["id"], "fundamentals.png", "image/png", png_with_text(["FUNDAMENTALS", RUNWORD.upper()]))
        body = DOC(
            P(f"Public thesis {RUNWORD}."),
            {"type": "paragraph", "content": [{"type": "text", "text": "See "},
                                              {"type": "noteLink", "attrs": {"noteId": other["id"]}}]},
            {"type": "widgetEmbed", "attrs": {"v": 1, "widgetId": "chart", "mode": "snapshot",
                                              "capturedAt": "2026-09-01T12:00:00Z", "params": {"symbol": "AMD", "tf": "D"},
                                              "tradeRef": trade, "searchText": "[chart: AMD D]"}},
            {"type": "widgetEmbed", "attrs": {"v": 1, "widgetId": "fundamentals", "mode": "snapshot",
                                              "capturedAt": "2026-09-01T12:00:00Z",
                                              "params": {"symbol": "AAPL", "view": "quarterly"},
                                              "fallback": {"url": img["url"], "w": 1700, "h": 560}}},
        )
        put = api.put(BASE + f"/api/j2/notes/{n['id']}", data={"bodyJson": body})
        if not put.ok:
            raise RuntimeError(f"PUT body {put.status}: {put.text()[:200]}")
        needles = [n["id"], other["id"], WALK_USER_ID, EMAIL, NAME, tag, trade, "ZZWE"]

        # the owner's Share door, in the editor
        ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=BASE)
        page = open_note(ctx, notebook_url(n["id"]), page)
        page.get_by_role("button", name="Share", exact=True).click()
        dialog = page.get_by_role("dialog", name="Share this note")
        dialog.get_by_role("button", name="Create link", exact=True).click(timeout=20000)
        dialog.get_by_text(re.compile(r"^Share link created")).wait_for(state="visible", timeout=20000)
        share_url = dialog.get_by_label("Share link address").input_value()
        token = share_url.rstrip("/").split("/")[-1]

        sctx = watch_beacons(browser.new_context(viewport={"width": 1280, "height": 900}), "stranger-w2")
        is_api = lambda u: f"/api/j2/shared/{token}" in u  # noqa: E731
        sp, live = public_facts(sctx, share_url, "shared-note", needles, is_api)
        img_ok = False
        try:
            sp.wait_for_function(
                "(t) => [...document.querySelectorAll('img')].some((i) => i.src.includes('/api/j2/shared/' + t + '/att/')"
                " && i.complete && i.naturalWidth > 0)", arg=token, timeout=20000)
            img_ok = True
        except Exception:  # noqa: BLE001
            pass
        live["fmp_image_rendered"] = img_ok
        live["shot"] = shot(sp, "w2-stranger-share")
        api_json = [x for x in live["payloads"] if x["matched"] and "/att/" not in x["url"]]
        img_resp = [x for x in live["payloads"] if x["matched"] and "/att/" in x["url"]]
        api_ok, api_hdr = public_api_headers_ok(api_json[0]["headers"]) if api_json else (False, None)
        img_hdr_ok = bool(img_resp) and all(
            public_api_headers_ok(x["headers"])[0] and "default-src 'none'" in (x["headers"].get("content-security-policy") or "")
            for x in img_resp)
        text = live.pop("text")
        live.update({
            "title_rendered": n["title"] in text, "own_words_rendered": f"Public thesis {RUNWORD}." in text,
            "massive_is_neutral_line": neutral in text, "massive_symbol_in_text": "AMD" in text,
            "linked_note_text": "linked note" in text,
            "payload_leaks": sorted({l for x in live["payloads"] for l in x["leaks"]}),
            "api_headers_ok": api_ok, "api_headers": api_hdr, "image_headers_ok": img_hdr_ok,
        })
        sp.close()

        # revoke -> the dead-link sentence
        dialog.get_by_role("button", name="Revoke link", exact=True).click()
        dialog.get_by_text(re.compile(r"^Link revoked")).wait_for(state="visible", timeout=20000)
        sp2 = _fresh_page(sctx)
        sp2.goto(share_url)
        dismiss_intro(sp2)
        sp2.get_by_test_id("shared-note-gone").wait_for(state="visible", timeout=20000)
        revoked = {"sentence": sp2.get_by_test_id("shared-note-gone").locator("h1").inner_text().strip(),
                   "api": http("GET", f"/api/j2/shared/{token}")[0]}
        revoked["is_dead_sentence"] = revoked["sentence"] == gone
        sp2.close()
        page.keyboard.press("Escape")

        # trash stops a live link; restore brings it back (settled behaviour, the help article says so)
        page.goto(notebook_url(None, "?view=all"))
        r2 = api.post(BASE + f"/api/j2/notes/{n['id']}/share", data={})
        token2 = (r2.json().get("share") or {}).get("token") if r2.ok else None
        before = http("GET", f"/api/j2/shared/{token2}")[0] if token2 else None
        api.delete(BASE + f"/api/j2/notes/{n['id']}")
        trashed = http("GET", f"/api/j2/shared/{token2}") if token2 else (None, b"", {})
        sp3 = _fresh_page(sctx)
        sp3.goto(f"{BASE}/share/n/{token2}")
        dismiss_intro(sp3)
        try:
            sp3.get_by_test_id("shared-note-gone").wait_for(state="visible", timeout=20000)
            trashed_page_gone = True
        except Exception:  # noqa: BLE001
            trashed_page_gone = False
        sp3.close()
        api.post(BASE + f"/api/j2/notes/{n['id']}/restore")
        restored = http("GET", f"/api/j2/shared/{token2}")[0] if token2 else None
        sctx.close()
        SHARED["live_share_token"] = token2 if restored == 200 else None
        lifecycle = {"mint_again": r2.status, "live_before_trash": before, "after_trash": trashed[0],
                     "after_trash_detail": (jdecode(trashed[1]) or {}).get("detail"),
                     "trashed_page_shows_gone": trashed_page_gone, "after_restore": restored}

        ok = (live["title_rendered"] and live["own_words_rendered"] and live["massive_is_neutral_line"]
              and not live["massive_symbol_in_text"] and live["fmp_image_rendered"]
              and not live["dom_leaks"] and not live["payload_leaks"]
              and live["api_headers_ok"] and live["image_headers_ok"]
              and revoked["is_dead_sentence"] and revoked["api"] == 404
              and lifecycle["live_before_trash"] == 200 and lifecycle["after_trash"] == 404
              and lifecycle["trashed_page_shows_gone"] and lifecycle["after_restore"] == 200)
        record("W2_share_links", "PASS" if ok else "FAIL", note_id=n["id"], token=token, public=live,
               revoke=revoked, trash_restore=lifecycle, needles_searched=len([x for x in needles if x]))

    check_w2()

    # =========================================================================
    # W3 -- publish: a note and a folder; an in-app link card and a pasted in-app link
    # =========================================================================
    @guarded("W3_publish")
    def check_w3():
        global page
        gone = gone_sentence(PUBLISHED_PAGE_JSX)
        mismatch("W3", "an in-app ?note=<id> link CARD pasted into the note",
                 "a card is fetched by the SANDBOX server from the pasted address, and the only address the "
                 "reducer treats as in-app is the production host (_OWN_HOSTS); this walk contacts no production "
                 "host, so the card is stored through the API in the card's own shape, and the pasted in-app "
                 "LINK is driven for real through the clipboard",
                 f"{PUBLIC_PAYLOAD_PY} _OWN_HOSTS / _kept_urls; LinkPasteMenu.jsx 'Preview card'")
        res["instrument_notes"].append(
            "W3: the in-app address is the production URL shape (https://uctintelligence.com/journal/notebook"
            "?note=<id>) written as TEXT into sandbox data; nothing fetches it (the 'Preview card' press is never made)")
        folder_name = f"Walk W3 folder {RUN}"
        fid = mk_folder(api, folder_name)
        other = mk_note(api, f"Walk W3 elsewhere {RUN}", DOC(P("a note outside the folder")))
        in_app = f"https://uctintelligence.com/journal/notebook?note={other['id']}"
        card = {"type": "linkPreview", "attrs": {"url": in_app, "title": f"In-app card {RUNWORD}",
                                                 "description": "an in-app page", "image": None,
                                                 "siteName": "UCT Intelligence"}}
        n = mk_note(api, f"Walk W3 publish {RUN}", DOC(P(f"Published words {RUNWORD}."), card, P("end")),
                    folderId=fid)
        sib = mk_note(api, f"Walk W3 sibling {RUN}", DOC(P("the sibling")), folderId=fid)
        needles = [n["id"], other["id"], sib["id"], fid, WALK_USER_ID, EMAIL, NAME]

        # the pasted in-app link, through the member's own door (the clipboard)
        ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=BASE)
        page = open_note(ctx, notebook_url(n["id"]), page)
        page.locator(".ProseMirror").click()
        page.keyboard.press("Control+End")
        page.evaluate("(t) => navigator.clipboard.writeText(t)", in_app)
        page.keyboard.press("Control+v")
        offer = page.get_by_role("toolbar", name="Pasted link")
        offer_seen = False
        try:
            offer.wait_for(state="visible", timeout=8000)
            offer_seen = True
            page.keyboard.press("Escape")   # keep it as a link (never "Preview card": no fetch)
        except Exception:  # noqa: BLE001
            pass
        saved_link = False
        body = None
        end = _t.time() + 25
        while _t.time() < end:   # the autosave lands in its own time; a bounded poll of the server's copy
            body = (api.get(BASE + f"/api/j2/notes/{n['id']}").json().get("note") or {}).get("bodyJson")
            # ⛔ a LINK MARK with the address -- the card already carries it in an attribute
            if any(other["id"] in (h or "") for h in link_mark_hrefs(body)):
                saved_link = True
                break
            _t.sleep(0.5)
        types_saved = sorted({x for x in re.findall(r'"type": "(\w+)"', json.dumps(body))})

        # publish the note and its folder from the Share door
        page.get_by_role("button", name="Share", exact=True).click()
        dialog = page.get_by_role("dialog", name="Share this note")
        dialog.get_by_role("button", name="Publish this note", exact=True).click(timeout=20000)
        dialog.get_by_text(re.compile(r"^Published\.")).wait_for(state="visible", timeout=20000)
        pub_url = dialog.get_by_label("Published page address").input_value()
        dialog.get_by_role("button", name=f'Publish folder "{folder_name}"', exact=True).click()
        dialog.get_by_text(re.compile(r'^Published "')).wait_for(state="visible", timeout=20000)
        folder_url = dialog.get_by_label(f"Published folder address, {folder_name}").input_value()

        sctx = watch_beacons(browser.new_context(viewport={"width": 1280, "height": 900}), "stranger-w3")
        is_pub = lambda u: "/api/j2/published/" in u  # noqa: E731
        sp, note_page = public_facts(sctx, pub_url, "published-page", needles, is_pub)
        text = note_page.pop("text")
        # where an id on the page comes from: a live anchor, or the words of a link whose mark went
        note_page["anchors_naming_other_note"] = sp.evaluate(
            "(id) => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => h.includes(id))",
            other["id"])
        note_page.update({"own_words_rendered": f"Published words {RUNWORD}." in text,
                          "card_title_shown": f"In-app card {RUNWORD}" in text,
                          "pasted_url_text_shown": in_app in text,
                          "other_note_id_in_visible_text": other["id"] in text,
                          "payload_leaks": sorted({l for x in note_page["payloads"] for l in x["leaks"]}),
                          "shot": shot(sp, "w3-stranger-note")})
        pub_api = [x for x in note_page["payloads"] if x["matched"]]
        note_page["api_headers_ok"] = bool(pub_api) and all(public_api_headers_ok(x["headers"])[0] for x in pub_api)
        sp.close()
        sp, folder_page = public_facts(sctx, folder_url, "published-page", needles, is_pub)
        ftext = folder_page.pop("text")
        folder_page.update({"lists_note": n["title"] in ftext and sib["title"] in ftext,
                            "payload_leaks": sorted({l for x in folder_page["payloads"] for l in x["leaks"]})})
        sp.close()

        # unpublish both from the door -> both pages are gone
        dialog.get_by_role("button", name="Unpublish", exact=True).click()
        dialog.get_by_text(re.compile(r"^Unpublished")).wait_for(state="visible", timeout=20000)
        dialog.get_by_role("button", name="Unpublish folder", exact=True).click()
        dialog.get_by_role("button", name=f'Publish folder "{folder_name}"', exact=True).wait_for(state="visible", timeout=20000)
        page.keyboard.press("Escape")
        after = {}
        for label, url in (("note", pub_url), ("folder", folder_url)):
            gp = _fresh_page(sctx)
            gp.goto(url)
            dismiss_intro(gp)
            gp.get_by_test_id("published-page-gone").wait_for(state="visible", timeout=20000)
            after[label] = gp.get_by_test_id("published-page-gone").locator("h1").inner_text().strip()
            gp.close()
        sctx.close()

        def noindex(pg_facts):
            return ("noindex" in (pg_facts["html_headers"].get("x-robots-tag") or "")
                    and "noindex" in (pg_facts["meta"].get("robots") or ""))

        ok = (note_page["own_words_rendered"] and not note_page["card_title_shown"]
              and not note_page["dom_leaks"] and not note_page["payload_leaks"]
              and noindex(note_page) and note_page["api_headers_ok"]
              and folder_page["lists_note"] and not folder_page["dom_leaks"] and not folder_page["payload_leaks"]
              and noindex(folder_page)
              and after.get("note") == gone and after.get("folder") == gone)
        record("W3_publish", "PASS" if ok else "FAIL", note_id=n["id"], folder_id=fid,
               paste={"offer_seen": offer_seen, "saved_as_link_in_body": saved_link, "node_types_saved": types_saved},
               note_page=note_page, folder_page=folder_page, after_unpublish=after, dead_sentence=gone)

    check_w3()

    # =========================================================================
    # W4 -- per-note export in four formats; the autosave window; a WebP-heavy Word file
    # =========================================================================
    FORMAT_IDS = ("md", "html", "json", "docx")   # the labels are read from exportFormats.js (js_string_menu)

    def export_via_menu(pg, note_id, fmt, label, timeout=120000):
        """The member's own door: the editor's Export menu. Returns (response, download)."""
        pg.locator('button[aria-haspopup="menu"]', has_text="Export").first.click()
        menu = pg.get_by_role("menu", name="Export this note as")
        menu.wait_for(state="visible", timeout=8000)
        with pg.expect_response(lambda r: f"/api/j2/export/notes/{note_id}" in r.url and f"format={fmt}" in r.url,
                                timeout=timeout) as ri:
            with pg.expect_download(timeout=timeout) as di:
                menu.get_by_role("menuitem", name=label, exact=True).click()
        return ri.value, di.value

    def download_bytes(dl):
        path = dl.path()
        data = open(path, "rb").read()
        if ART:
            dl.save_as(os.path.join(ART, f"{RUN}-{dl.suggested_filename}"))
        return data

    @guarded("W4_export_formats")
    def check_w4():
        global page
        # formats are read from the member's own list (exportFormats.js), never typed twice
        fmt_labels = [(f, js_string_menu(f)) for f in FORMAT_IDS]
        title = f"Walk W4 \u2014 export \U0001F4C8 {RUN}"
        n = mk_note(api, title, DOC(P(f"Export body {RUNWORD}."), P("A second paragraph.")))
        page = open_note(ctx, notebook_url(n["id"]), page)
        per = {}
        for fmt, label in fmt_labels:
            resp, dl = export_via_menu(page, n["id"], fmt, label)
            data = download_bytes(dl)
            header = resp.headers.get("content-disposition")
            named = disposition_filename(header)
            per[fmt] = {"status": resp.status, "bytes": len(data), "saved_as": dl.suggested_filename,
                        "disposition_name": named, "saved_is_disposition": dl.suggested_filename == named,
                        "saved_starts_with_title": dl.suggested_filename.startswith(title),
                        "ext_ok": dl.suggested_filename.endswith("." + fmt)}
            if fmt == "html":
                per[fmt]["html_has_text"] = f"Export body {RUNWORD}." in data.decode("utf-8", errors="replace")
            if fmt == "docx":
                d = docx_facts(data)
                per[fmt]["docx_valid"] = not d["bad_xml"] and "word/document.xml" in d["members"]
        names_ok = all(v["status"] == 200 and v["saved_is_disposition"] and v["saved_starts_with_title"]
                       and v["ext_ok"] for v in per.values())

        # FE M-9: a word typed inside the autosave window reaches the export
        word = f"typed{RUNWORD}"
        order = []
        page.on("request", lambda r: order.append(("PUT" if r.method == "PUT" else "GET", r.url))
                if (r.method == "PUT" and r.url.endswith(f"/api/j2/notes/{n['id']}"))
                or "/api/j2/export/notes/" in r.url else None)
        page.locator(".ProseMirror").click()
        page.keyboard.press("Control+End")
        page.keyboard.type(" " + word, delay=5)
        t0 = _t.time()
        resp, dl = export_via_menu(page, n["id"], "json", js_string_menu("json"))
        typed = download_bytes(dl).decode("utf-8", errors="replace")
        first_export = next((i for i, (k, u) in enumerate(order) if "/api/j2/export/" in u), None)
        put_before = any(k == "PUT" for k, _u in order[:first_export or 0])
        m9 = {"word_in_export": word in typed, "seconds_last_keystroke_to_file_saved": round(_t.time() - t0, 2),
              "put_before_export": put_before, "request_order": [k for k, _u in order][:10], "status": resp.status}

        # BE I-2: a Word file of a note with several WebP images completes, inside the cap
        wn = mk_note(api, f"Walk W4 webp {RUN}", DOC(P("four WebP images")))
        imgs = [upload_image(api, wn["id"], f"noise{i}.webp", "image/webp", noise_webp()) for i in range(4)]
        api.put(BASE + f"/api/j2/notes/{wn['id']}", data={"bodyJson": DOC(
            P("four WebP images"), *[{"type": "image", "attrs": {"src": im["url"], "alt": f"noise {i}"}}
                                      for i, im in enumerate(imgs)])})
        page = open_note(ctx, notebook_url(wn["id"]), page)
        t1 = _t.time()
        resp, dl = export_via_menu(page, wn["id"], "docx", js_string_menu("docx"), timeout=180000)
        blob = download_bytes(dl)
        d = docx_facts(blob)
        cap_sentence = py_string(NOTES_EXPORT_PY, "_CAP_REACHED")
        webp = {"status": resp.status, "seconds": round(_t.time() - t1, 2), "bytes": len(blob),
                "media_count": d["media_count"], "media_total": d["media_total"],
                "cap": EXPORT_CAP, "within_cap": EXPORT_CAP is not None and d["media_total"] <= EXPORT_CAP,
                "docx_valid": not d["bad_xml"], "not_included": d["not_included"],
                "left_out_for_cap": sum(1 for x in d["not_included"] if cap_sentence in x)}
        ok = names_ok and per["html"].get("html_has_text") and per["docx"].get("docx_valid") \
            and m9["word_in_export"] and webp["status"] == 200 and webp["docx_valid"] and webp["within_cap"] \
            and webp["media_count"] >= 1
        record("W4_export_formats", "PASS" if ok else "FAIL", title=title, per_format=per, autosave_window=m9,
               webp_word=webp)

    def js_string_menu(fmt):
        """The Export menu's label for `fmt`, read from exportFormats.js's ONE list."""
        text = repo_text("app/src/pages/journal-2-0/components/notebook/export/exportFormats.js")
        m = re.search(r"id:\s*'" + re.escape(fmt) + r"'.*?menuLabel:\s*" + _JS_STR, text, flags=re.S)
        if not m:
            raise LookupError(f"no menuLabel for {fmt}")
        return _js_unescape(m.group(2))

    check_w4()

    # =========================================================================
    # W5 -- accessibility in a real engine (axe injected) and where focus lands
    # =========================================================================
    WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
    AXE_RUN = """async ({ scoped, tags }) => {
      let ctx = document
      if (scoped) {
        const els = [...document.querySelectorAll('[data-w8-axe]')]
        if (!els.length) return { error: 'the scope matched nothing' }
        ctx = { include: els }
      }
      const r = await window.axe.run(ctx, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] })
      return { version: window.axe.version, theme: document.documentElement.dataset.theme || null,
               violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
                 targets: v.nodes.slice(0, 6).map((n) => n.target.join(' ')) })) }
    }"""

    def axe_scan(pg, locators=None):
        """axe-core (the repo's pinned copy) in the page, scoped to `locators` (each element
        marked, scanned, unmarked) or the whole document; the violations, all of them."""
        if not pg.evaluate("() => typeof window.axe !== 'undefined'"):
            pg.add_script_tag(path=AXE_PATH)
        marked = 0
        for loc in locators or []:
            for i in range(loc.count()):
                loc.nth(i).evaluate("(el) => el.setAttribute('data-w8-axe', '1')")
                marked += 1
        try:
            out = pg.evaluate(AXE_RUN, {"scoped": bool(locators), "tags": WCAG_TAGS})
        finally:
            pg.evaluate("() => document.querySelectorAll('[data-w8-axe]').forEach((e) => e.removeAttribute('data-w8-axe'))")
        out["scoped_elements"] = marked
        out["serious"] = serious_violations(out.get("violations"))
        return out

    def wait_focus(pg, predicate_js, timeout=10000):
        try:
            pg.wait_for_function(predicate_js, timeout=timeout)
            return True
        except Exception:  # noqa: BLE001
            return False

    @guarded("W5_accessibility")
    def check_w5():
        global page
        fid = mk_folder(api, f"Walk W5 folder {RUN}")
        n5 = mk_note(api, f"Walk W5 note {RUN}", DOC(P(f"Accessibility body {RUNWORD}.")), folderId=fid)
        mk_note(api, f"Walk W5 second {RUN}", DOC(P("second")), folderId=fid)
        scans, focus = {}, {}
        notebook_scope = lambda pg: [pg.locator("#notebook-pane").locator("xpath=.."), pg.locator('[role="dialog"]')]  # noqa: E731

        # the note list
        open_list(page, f"?folder={fid}")
        page.locator(f'[data-note-card-id="{n5["id"]}"]').first.wait_for(state="visible", timeout=30000)
        scans["note_list"] = axe_scan(page, notebook_scope(page))

        # an EXISTING note, opened from the list: its heading takes focus, never a field (FE I-1)
        page.locator(f'[data-note-card-id="{n5["id"]}"]').first.click()
        page.locator(".ProseMirror").first.wait_for(state="attached", timeout=30000)
        landed = wait_focus(page, "() => document.activeElement && document.activeElement.hasAttribute('data-note-landmark')")
        info = page.evaluate(FOCUS_JS)
        focus["existing_note_open"] = {"on_heading": landed, "active": info, "takes_text": takes_text(info)}
        scans["editor"] = axe_scan(page, notebook_scope(page))

        # a NEW note: its title takes focus (typing it is the next act). The door is the list
        # pane's own "+ New note" (focusFlows.test.jsx drives it from the list, as here).
        open_list(page, f"?folder={fid}")
        page.get_by_role("button", name="+ New note", exact=True).first.click(timeout=20000)
        landed_new = wait_focus(page, "() => document.activeElement && document.activeElement.hasAttribute('data-note-title')")
        focus["new_note"] = {"on_title": landed_new, "active": page.evaluate(FOCUS_JS)}

        # the share sheet: Create link -> Copy link; Revoke -> Create link; Escape -> Share (FE M-1)
        page = open_note(ctx, notebook_url(n5["id"]), page)
        share_btn = page.get_by_role("button", name="Share", exact=True)
        share_btn.click()
        dialog = page.get_by_role("dialog", name="Share this note")
        dialog.get_by_role("button", name="Create link", exact=True).click(timeout=20000)
        focus["create_link"] = {"to_copy_link": wait_focus(
            page, "() => document.activeElement && document.activeElement.textContent.trim() === 'Copy link'"),
            "active": page.evaluate(FOCUS_JS)}
        scans["share_sheet"] = axe_scan(page, [page.locator('[role="dialog"]')])
        dialog.get_by_role("button", name="Revoke link", exact=True).click()
        focus["revoke"] = {"to_create_link": wait_focus(
            page, "() => document.activeElement && document.activeElement.textContent.trim() === 'Create link'"),
            "active": page.evaluate(FOCUS_JS)}
        page.keyboard.press("Escape")
        closed = True
        try:
            dialog.wait_for(state="hidden", timeout=8000)
        except Exception:  # noqa: BLE001
            closed = False
        back = wait_focus(page, "() => { const a = document.activeElement; return !!a && a.getAttribute('aria-haspopup') === 'dialog'"
                                " && a.textContent.trim() === 'Share' }")
        focus["escape"] = {"sheet_closed": closed, "to_opener": back, "active": page.evaluate(FOCUS_JS)}

        # Settings -> Sharing & publishing
        page.goto(f"{BASE}/settings?section=connections")
        dismiss_intro(page)
        card = page.get_by_role("region", name="Sharing & publishing")
        card.first.wait_for(state="visible", timeout=30000)
        scans["settings_sharing_card"] = axe_scan(page, [card.first])

        # a public page, as a stranger
        token = SHARED.get("live_share_token")
        if not token:
            r = api.post(BASE + f"/api/j2/notes/{n5['id']}/share", data={})
            token = (r.json().get("share") or {}).get("token") if r.ok else None
        sctx = watch_beacons(browser.new_context(viewport={"width": 1280, "height": 900}), "stranger-w5")
        sp = _fresh_page(sctx)
        sp.goto(f"{BASE}/share/n/{token}")
        dismiss_intro(sp)
        sp.get_by_test_id("shared-note").first.wait_for(state="visible", timeout=30000)
        scans["public_page"] = axe_scan(sp)
        sp.close()
        sctx.close()

        errors = {k: v.get("error") for k, v in scans.items() if v.get("error")}
        serious = {k: [(v["id"], v["impact"], v["nodes"]) for v in s["serious"]] for k, s in scans.items()}
        focus_ok = (focus["existing_note_open"]["on_heading"] and not focus["existing_note_open"]["takes_text"]
                    and focus["new_note"]["on_title"] and focus["create_link"]["to_copy_link"]
                    and focus["revoke"]["to_create_link"] and focus["escape"]["to_opener"])
        if errors:
            verdict = "INCONCLUSIVE"
        else:
            verdict = "PASS" if focus_ok and not any(serious.values()) else "FAIL"
        record("W5_accessibility", verdict, reason=(f"axe could not scan: {errors}" if errors else None),
               serious_by_surface=serious, scans=scans, focus=focus)

    check_w5()

    # =========================================================================
    # W6 -- offline with onboarding on (FE I-2)
    # =========================================================================
    @guarded("W6_offline_onboarding")
    def check_w6():
        tour_file = manifest_file("src/pages/journal-2-0/components/notebook/onboarding/NotebookTour.jsx")
        if not tour_file:
            record("W6_offline_onboarding", "INCONCLUSIVE",
                   reason="no --dist manifest, so the tour chunk cannot be DERIVED (never guessed) -- instrument")
            return
        mismatch("W6", "offline, reload -> the Notebook renders (served from the durable copy)",
                 "index.html is served no-store and the app registers no caching service worker, so an "
                 "offline DOCUMENT reload is the browser's own offline page by construction; it is measured "
                 "and recorded. And an offline note opens from what the TAB already read (useJ2Note is an "
                 "SWR read with no store behind it; the durable copy supplies unsent words on top of a server "
                 "copy, never a note by itself), so after any document load a note unread in that tab shows "
                 "its own load-error card. The verdict rests on the reachable paths",
                 "api/main.py spa_index_response; app/src/main.jsx; hooks/useJ2Notes.js useJ2Note; "
                 "NoteEditorPage.jsx `if (!note)`")
        facts = {"tour_chunk": tour_file}

        # (a) a member WITH notes: the tour chunk is never requested; offline navigation inside
        #     a loaded Notebook, and Journal -> Notebook, render with no reload and no error screen
        # ⛔ INSTRUMENT (shake-outs 1-2): an offline note opens from what THIS TAB already read
        # (useJ2Note is an SWR read; after a document load nothing is held), so the note is
        # opened online, the member goes BACK in the tab (a history move, no document load),
        # then offline, then opens it again. A note this tab never read is opened offline too,
        # and must say so in the note pane -- never the route's error screen. A reload is
        # detected by a window marker, never by `framenavigated` (Playwright fires that for
        # same-document history moves too).
        banner = js_string("app/src/pages/journal-2-0/lib/offline/unsyncedCopy.js", "OFFLINE_VIEWING_BANNER")
        octx = clone_session(ctx, "walk-offline")
        tour_reqs = []
        octx.on("request", lambda r: tour_reqs.append(r.url) if r.url.endswith(tour_file) else None)
        opg = _fresh_page(octx)
        opg.goto(notebook_url(None, "?view=all"))
        dismiss_intro(opg)
        rows = opg.locator("[data-note-card-id]")
        rows.first.wait_for(state="visible", timeout=30000)
        first_id = rows.nth(0).get_attribute("data-note-card-id")
        unread_id = rows.nth(1).get_attribute("data-note-card-id") if rows.count() > 1 else None
        opg.evaluate(MARK_ALIVE_JS)
        opg.locator(f'[data-note-card-id="{first_id}"]').first.click()
        opg.locator(".ProseMirror").first.wait_for(state="attached", timeout=30000)
        opg.go_back()
        opg.locator(f'[data-note-card-id="{first_id}"]').first.wait_for(state="visible", timeout=30000)
        octx.set_offline(True)
        opg.locator(f'[data-note-card-id="{first_id}"]').first.click()
        opened_offline = True
        try:
            opg.locator(".ProseMirror").first.wait_for(state="attached", timeout=20000)
        except Exception:  # noqa: BLE001
            opened_offline = False
        inside = {"note_id": first_id, "note_opened": opened_offline,
                  "offline_banner_shown": opg.get_by_text(banner, exact=True).count() > 0,
                  "editor_text": (opg.locator(".ProseMirror").first.inner_text()[:120] if opened_offline else None)}
        if unread_id:
            opg.go_back()
            opg.locator(f'[data-note-card-id="{unread_id}"]').first.wait_for(state="visible", timeout=20000)
            opg.locator(f'[data-note-card-id="{unread_id}"]').first.click()
            try:
                opg.get_by_role("alert").filter(has_text=NOTE_LOAD_ERROR).first.wait_for(state="visible", timeout=20000)
                inside["unread_note_says_so_in_the_pane"] = True
            except Exception:  # noqa: BLE001
                inside["unread_note_says_so_in_the_pane"] = False
        inside.update({"no_reload": opg.evaluate(IS_ALIVE_JS), "no_route_fallback": not _route_fallback_visible(opg)})
        octx.set_offline(False)
        # Journal -> Notebook while offline, the chunks warm in this context's HTTP cache
        opg.goto(f"{BASE}/journal")
        dismiss_intro(opg)
        nav = opg.get_by_role("navigation", name="Journal sections")
        nav.first.wait_for(state="visible", timeout=30000)
        opg.evaluate(MARK_ALIVE_JS)
        octx.set_offline(True)
        failed = []
        opg.on("requestfailed", lambda r: failed.append(r.url.replace(BASE, "")))
        nav.first.get_by_role("link", name="Notebook", exact=True).click()
        rendered = True
        try:
            opg.locator("#notebook-pane").first.wait_for(state="attached", timeout=20000)
        except Exception:  # noqa: BLE001
            rendered = False
        opg.wait_for_timeout(1500)   # settle: a reload scheduled by a failed chunk lands inside this
        try:
            alive = opg.evaluate(IS_ALIVE_JS)
        except Exception:  # noqa: BLE001 -- an offline error page may refuse the evaluation
            alive = False
        journal_to_nb = {"rendered": rendered, "no_reload": alive,
                         "no_route_fallback": not _route_fallback_visible(opg),
                         "failed_chunk_requests": [u for u in failed if "/assets/" in u][:10],
                         "failed_api_requests": len([u for u in failed if "/api/" in u])}
        # the brief's literal step, measured: a document reload while offline
        fence_open("W6: an offline document reload (deliberate)")
        try:
            opg.reload(timeout=15000)
            reload_outcome = {"threw": None}
        except Exception as e:  # noqa: BLE001
            reload_outcome = {"threw": str(e)[:200]}
        reload_outcome.update({"url": opg.url, "notebook_present": opg.locator("#notebook-pane").count() > 0})
        fence_close()
        octx.set_offline(False)
        facts.update({"member_with_notes": {"tour_chunk_requests": len(tour_reqs), "inside_notebook": inside,
                                            "journal_to_notebook": journal_to_nb, "offline_reload": reload_outcome}})
        octx.close()

        # (b) a first-run member whose tour chunk FAILS: the Notebook stays, nothing reloads
        dctx, facts["provision_first_run_member"] = provision_member(browser, actx, f"w8chunk{RUN}@local.dev", "Chunk Walker")
        attempts = []

        def refuse(route):
            attempts.append(_t.time())
            route.abort("internetdisconnected")
        dctx.route(f"**/{tour_file}", refuse)
        dpg = _fresh_page(dctx)
        fence_open("W6: a first-run member's tour chunk refused (deliberate)")
        dpg.goto(notebook_url())
        dismiss_intro(dpg)
        home = tour_steps()[0]["title"]
        dpg.get_by_role("heading", name=home).first.wait_for(state="visible", timeout=30000)
        dpg.evaluate(MARK_ALIVE_JS)
        end = _t.time() + 15
        while _t.time() < end and len(attempts) < 2:   # the gate's one in-place retry, if the engine makes it
            dpg.wait_for_timeout(250)
        dpg.wait_for_timeout(1500)   # settle: a reload or a boundary lands inside this
        chunk_fail = {"attempts": len(attempts), "no_reload": dpg.evaluate(IS_ALIVE_JS),
                      "first_run_screen_still_shown": dpg.get_by_role("heading", name=home).first.is_visible(),
                      "no_route_fallback": not _route_fallback_visible(dpg), "no_tour_card": dpg.locator(TOUR_CARD).count() == 0}
        fence_close()
        dctx.close()
        facts["first_run_tour_chunk_fails"] = chunk_fail

        ok = (facts["member_with_notes"]["tour_chunk_requests"] == 0
              and inside["note_opened"] and inside["no_reload"] and inside["no_route_fallback"]
              and inside.get("unread_note_says_so_in_the_pane", True)
              and journal_to_nb["rendered"] and journal_to_nb["no_reload"] and journal_to_nb["no_route_fallback"]
              and chunk_fail["attempts"] >= 1 and chunk_fail["no_reload"] and chunk_fail["first_run_screen_still_shown"]
              and chunk_fail["no_route_fallback"] and chunk_fail["no_tour_card"])
        record("W6_offline_onboarding", "PASS" if ok else "FAIL", **facts)

    check_w6()

    # =========================================================================
    # W7 -- the lazyChunk in-place retry, in a real engine
    # =========================================================================
    @guarded("W7_lazy_chunk_retry")
    def check_w7():
        tasks_file = manifest_file("src/pages/journal-2-0/components/notebook/NoteTasksView.jsx")
        if not tasks_file:
            record("W7_lazy_chunk_retry", "INCONCLUSIVE",
                   reason="no --dist manifest, so the chunk cannot be DERIVED (never guessed) -- instrument")
            return
        bctx = clone_session(ctx, "walk-chunk")
        handler, state = make_block_once()
        bctx.route(f"**/{tasks_file}", handler)
        requests_seen, console_errors, loads = [], [], []
        bctx.on("request", lambda r: requests_seen.append(round(_t.time(), 3)) if r.url.endswith(tasks_file) else None)
        bpg = _fresh_page(bctx)
        bpg.on("console", lambda m: console_errors.append(m.text[:240]) if m.type == "error" else None)
        bpg.on("load", lambda _p: loads.append(round(_t.time(), 3)))   # one per DOCUMENT load
        open_list(bpg)
        bpg.locator("[data-note-card-id]").first.wait_for(state="visible", timeout=30000)
        bpg.evaluate(MARK_ALIVE_JS)
        loads_before = len(loads)
        fence_open("W7: one lazy chunk aborted once (deliberate)")
        t_click = _t.time()
        bpg.get_by_role("button", name="Tasks view", exact=True).click()
        mounted = bpg.get_by_text("To tick a task off, open its note.").or_(bpg.get_by_text(re.compile(r"^No open tasks")))
        recovered = True
        try:
            mounted.first.wait_for(state="visible", timeout=30000)
        except Exception:  # noqa: BLE001
            recovered = False
        bpg.wait_for_timeout(800)
        fence_close()
        facts = {"chunk": tasks_file, "route_calls": state["calls"], "aborted": state["aborted"],
                 "let_through": state["continued"], "chunk_requests_seen": len(requests_seen),
                 "view_mounted": recovered, "no_reload": bpg.evaluate(IS_ALIVE_JS),
                 "document_loads_after_click": len(loads) - loads_before,
                 # >= the retry wait (lazyChunk.RETRY_WAIT_MS) means the in-place retry ran and
                 # asked again WITHOUT a request (the chunk was requested once), then the reload
                 "ms_click_to_reload": (round((loads[loads_before] - t_click) * 1000) if len(loads) > loads_before else None),
                 "reload_flag_after": bpg.evaluate("() => { try { return sessionStorage.getItem('uct.chunk-reload-attempted') }"
                                                   " catch (e) { return 'unreadable' } }"),
                 "url_after": bpg.url.replace(BASE, ""), "console_errors": console_errors[:8],
                 "no_route_fallback": not _route_fallback_visible(bpg),
                 "pressed": bpg.get_by_role("button", name="Tasks view", exact=True).get_attribute("aria-pressed")}
        bctx.close()
        # "recovers BY ITS RETRY": the chunk asked for twice, the view up, and no document reload
        ok = (facts["view_mounted"] and facts["aborted"] == 1 and facts["let_through"] >= 1
              and facts["no_reload"] and facts["no_route_fallback"])
        record("W7_lazy_chunk_retry", "PASS" if ok else "FAIL", **facts)

    check_w7()

    # =========================================================================
    # W8 -- (wave 5) trash + favorite notices at three widths; bulk trash of 40 and Undo
    # =========================================================================
    NOTICE_JS = """() => {
      const stack = document.querySelector('[data-testid="bulk-notice-stack"]')
      if (!stack) return { stack: false }
      const kids = [...stack.children].map((c) => c.getAttribute('data-testid'))
      const undo = [...stack.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Undo')
      const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom } }
      const s = rect(stack)
      let undoFacts = null
      if (undo) {
        const u = rect(undo)
        const hit = document.elementFromPoint((u.l + u.r) / 2, (u.t + u.b) / 2)
        undoFacts = { inViewport: u.t >= 0 && u.b <= innerHeight && u.l >= 0 && u.r <= innerWidth,
                      hitsItself: !!hit && (hit === undo || undo.contains(hit)),
                      hitWhat: hit ? hit.tagName + '.' + String(hit.className || '').slice(0, 50) : null }
      }
      const hub = document.querySelector('[data-testid="hub-root"]')
      let hubShowing = false, overlap = null
      if (hub) {
        const cs = getComputedStyle(hub)
        const pad = hub.querySelector('[data-testid="hub-pad"]') || hub
        const h = rect(pad)
        hubShowing = !hub.hidden && cs.display !== 'none' && (h.r - h.l) > 0 && (h.b - h.t) > 0
        if (hubShowing) overlap = !(h.r <= s.l || h.l >= s.r || h.b <= s.t || h.t >= s.b)
      }
      return { stack: true, notices: kids, undo: undoFacts, hubShowing, stackOverlapsHub: overlap,
               stackBox: [s.l, s.t, s.r, s.b].map(Math.round), w: innerWidth }
    }"""

    def notice_check(pg, api_ctx, folder_id, titles):
        pg.goto(notebook_url(None, f"?folder={folder_id}"))
        dismiss_intro(pg)
        select_box(pg, titles[0]).first.wait_for(state="attached", timeout=30000)
        bar = pg.get_by_role("group", name="Actions for the selected notes")
        select_box(pg, titles[0]).first.check()
        bar.get_by_role("button", name="Move to Trash").first.click()
        pg.get_by_test_id("bulk-undo-notice").first.wait_for(state="visible", timeout=20000)
        select_box(pg, titles[1]).first.check()
        bar.get_by_role("button", name="Favorite").first.click()
        pg.get_by_test_id("bulk-notice").first.wait_for(state="visible", timeout=20000)
        out = pg.evaluate(NOTICE_JS)
        try:
            pg.get_by_test_id("bulk-undo-notice").get_by_role("button", name="Undo", exact=True).click(timeout=8000)
            out["undo_click"] = "ok"
        except Exception as e:  # noqa: BLE001 -- the measurement above is kept either way
            out["undo_click"] = str(e)[:300]
        restored = False
        end = _t.time() + 20
        while _t.time() < end:   # the server's copy, polled with a ceiling: the Undo lands in its own time
            listed = api_ctx.get(BASE + f"/api/j2/notes?folder_id={folder_id}&limit=50").json().get("notes", [])
            if titles[0] in [x.get("title") for x in listed]:
                restored = True
                break
            _t.sleep(0.4)
        out["undo_restored"] = restored
        return out

    @guarded("W8_notices_and_bulk_trash")
    def check_w8():
        global page
        fid = mk_folder(api, f"Walk W8 notices {RUN}")
        titles = [f"Walk W8 n{i} {RUN}" for i in range(3)]
        for t in titles:
            mk_note(api, t, DOC(P(t)), folderId=fid)
        widths = {}
        for w, h in ((1200, 800), (820, 1180)):
            page.set_viewport_size({"width": w, "height": h})
            widths[str(w)] = notice_check(page, api, fid, titles)
        page.set_viewport_size({"width": 1280, "height": 800})
        # 390: a touch phone. The joystick shows for an ADMIN at rollout stage 1, so the phone
        # case is walked as the sandbox admin -- the only account for which there IS a hub to
        # overlap (a member's stack is still offset, from the hub's own eligibility answer).
        adm = actx.request
        ame = adm.get(BASE + "/api/auth/me").json()
        if not ame.get("paid_equiv"):
            adm.post(BASE + "/api/auth/admin/comp-access", data={"email": ADMIN_EMAIL, "action": "grant"})
        afid = mk_folder(adm, f"Walk W8 phone {RUN}")
        atitles = [f"Walk W8 p{i} {RUN}" for i in range(3)]
        for t in atitles:
            mk_note(adm, t, DOC(P(t)), folderId=afid)
        mctx = clone_session(actx, "admin-phone", viewport={"width": 390, "height": 844}, has_touch=True,
                             is_mobile=True, device_scale_factor=2)
        mpg = _fresh_page(mctx)
        widths["390-touch-admin"] = notice_check(mpg, adm, afid, atitles)
        mctx.close()

        # bulk trash of 40, timed, and one Undo that restores all 40
        bfid = mk_folder(api, f"Walk W8 bulk {RUN}")
        btitles = [f"Walk W8 bulk {i:02d} {RUN}" for i in range(40)]
        bids = [mk_note(api, t, DOC(P(t)), folderId=bfid)["id"] for t in btitles]
        page.goto(notebook_url(None, f"?folder={bfid}"))
        dismiss_intro(page)
        select_box(page, btitles[0]).first.wait_for(state="attached", timeout=30000)
        select_box(page, btitles[0]).first.check()
        bar = page.get_by_role("group", name="Actions for the selected notes")
        bar.get_by_role("button", name=re.compile(r"^Select all \d+ shown$")).click()
        bar.get_by_text(f"{len(bids)} selected").wait_for(state="visible", timeout=10000)
        t0 = _t.time()
        bar.get_by_role("button", name="Move to Trash").first.click()
        page.get_by_test_id("bulk-undo-notice").first.wait_for(state="visible", timeout=60000)
        to_notice = round((_t.time() - t0) * 1000)
        trashed = {x.get("id") for x in api.get(BASE + "/api/j2/notes?deleted=true&limit=500").json().get("notes", [])}
        in_trash = sum(1 for i in bids if i in trashed)
        t1 = _t.time()
        page.get_by_test_id("bulk-undo-notice").get_by_role("button", name="Undo", exact=True).click()
        back = 0
        end = _t.time() + 60
        while _t.time() < end:
            listed = {x.get("id") for x in api.get(BASE + f"/api/j2/notes?folder_id={bfid}&limit=100").json().get("notes", [])}
            back = sum(1 for i in bids if i in listed)
            if back == 40:
                break
            _t.sleep(0.5)
        bulk = {"selected": 40, "ms_to_undo_notice": to_notice, "in_trash": in_trash, "restored": back,
                "ms_undo_to_all_restored": round((_t.time() - t1) * 1000)}

        def notices_ok(m):
            return (m.get("stack") and "bulk-notice" in (m.get("notices") or [])
                    and "bulk-undo-notice" in (m.get("notices") or [])
                    and (m.get("undo") or {}).get("hitsItself") and (m.get("undo") or {}).get("inViewport")
                    and m.get("undo_click") == "ok" and m.get("undo_restored")
                    and m.get("stackOverlapsHub") in (False, None))
        phone = widths["390-touch-admin"]
        ok = all(notices_ok(m) for m in widths.values()) and bulk["in_trash"] == 40 and bulk["restored"] == 40
        record("W8_notices_and_bulk_trash", "PASS" if ok else "FAIL", widths=widths, bulk_trash_40=bulk,
               phone_hub_showing=phone.get("hubShowing"),
               note=("the phone case is the admin's (the joystick shows at rollout stage 1 for admins only); "
                     "`stackOverlapsHub` null means no hub was showing to overlap"))

    check_w8()

    # =========================================================================
    # W9 -- the daily-note template preference survives a reload
    # =========================================================================
    @guarded("W9_daily_template_pref")
    def check_w9():
        global page
        pref_key = js_string("app/src/pages/journal-2-0/lib/dailyNote.js", "DAILY_TEMPLATE_PREF")
        src = mk_note(api, f"Walk W9 daily source {RUN}", DOC(P("A daily template body.")))
        tr = api.post(BASE + "/api/j2/note-templates", data={"noteId": src["id"], "name": f"Walk daily {RUN}"})
        tpl = (tr.json() or {}).get("template") or {}
        open_list(page)
        page.get_by_role("button", name="Templates", exact=True).click(timeout=20000)
        pick = page.get_by_label("Daily notes start from")
        pick.wait_for(state="visible", timeout=15000)
        with page.expect_response(pref_post(pref_key), timeout=15000) as pi:
            pick.select_option(tpl.get("id"))
        written = pi.value
        try:   # read NOW: after the reload below the browser no longer holds the body
            written_body = written.json()
        except Exception as e:  # noqa: BLE001
            written_body = f"unreadable: {e}"[:200]
        page.reload()
        dismiss_intro(page)
        page.get_by_role("button", name="Templates", exact=True).click(timeout=20000)
        pick = page.get_by_label("Daily notes start from")
        pick.wait_for(state="visible", timeout=15000)
        shown = pick.input_value()
        stored = pref_value(api, pref_key)
        page.keyboard.press("Escape")
        ok = written.status == 200 and shown == tpl.get("id") and stored == tpl.get("id")
        record("W9_daily_template_pref", "PASS" if ok else "FAIL", pref_key=pref_key, template_id=tpl.get("id"),
               template_status=tr.status, write_status=written.status, write_body=written_body,
               select_after_reload=shown, stored_value=stored)

    check_w9()

    # =========================================================================
    # W10 -- touch EMULATION at 390: opening an existing note leaves no focused field (FE I-1)
    # =========================================================================
    @guarded("W10_touch_emulation_open")
    def check_w10():
        fid = mk_folder(api, f"Walk W10 folder {RUN}")
        n = mk_note(api, f"Walk W10 note {RUN}", DOC(P("read me on a phone")), folderId=fid)
        tctx10 = clone_session(ctx, "walk-touch", viewport={"width": 390, "height": 844}, has_touch=True,
                               is_mobile=True, device_scale_factor=2)
        tp = _fresh_page(tctx10)
        tp.goto(notebook_url(None, f"?folder={fid}"))
        dismiss_intro(tp)
        row = tp.locator(f'[data-note-card-id="{n["id"]}"]').first
        row.wait_for(state="visible", timeout=30000)
        row.tap()
        tp.locator(".ProseMirror").first.wait_for(state="attached", timeout=30000)
        tp.wait_for_timeout(1200)   # settle: a late programmatic focus() lands inside this
        info = tp.evaluate(FOCUS_JS)
        tctx10.close()
        ok = not takes_text(info)
        record("W10_touch_emulation_open", "PASS" if ok else "FAIL",
               label="EMULATION (Chromium touch emulation) -- NOT a device result; the real Android/iOS "
                     "check (no soft keyboard on open) stays an owner-device item",
               focused=info, takes_text=takes_text(info))

    check_w10()

    # =========================================================================
    # W11 -- errors + sandbox integrity, decided AFTER the sandbox stops
    # =========================================================================
    genuine_errors = unfenced(res["errors"], ERROR_FENCES)
    fenced_errors = [e for e in res["errors"] if e not in genuine_errors]
    beacons = unfenced(BEACONS, BEACON_FENCES)
    boundary_beacons = [b for b in beacons if b.get("kind") == "boundary"]

    # ⛔ W11 IS JUDGED LAST, AFTER THE BROWSER HAS CLOSED (tooling review I-2). The shutdown
    # checkpoint is the only one the launcher takes AFTER this walk's writes, and it exists
    # only once the sandbox has stopped. So nothing of the walk's is left talking to the
    # server, then it waits `--shutdown-wait` for the operator's graceful stop to write that
    # line, then reads the log with the harness's reader: pre-boot, +15 s AND shutdown, all
    # CLEAN, or W11 is not a PASS.
    browser.close()
    shutdown_waited_s = (wait_for_shutdown_checkpoint(ARGS.integrity_log, ARGS.shutdown_wait)
                         if wanted("W11") else None)
    launcher_text = (read_text_any(ARGS.launcher_log)
                     if ARGS.launcher_log and os.path.exists(ARGS.launcher_log) else None)
    integrity = w11_integrity(ARGS.integrity_log, launcher_text)
    integrity["shutdown_waited_s"] = shutdown_waited_s
    res["sandbox_integrity"] = integrity
    res["launcher_excerpts"] = {
        "startup_gate_lines": launcher_lines(r"\[startup\].*notebook"),
        "shared_root_blocked": launcher_lines(r"SHARED-ROOT WRITE BLOCKED"),
        "integrity_lines": launcher_lines(r"shared data root (CLEAN|baseline)|\[post-boot\]|\[shutdown\]"),
    }
    res["pref_writes"] = PREF_WRITES
    if wanted("W11"):
        w11_v, w11_why = w11_verdict(integrity, genuine_errors)
        record(
            "W11_integrity", w11_v, reason=w11_why,
            pageerror_count=len(genuine_errors), pageerrors=genuine_errors[:20],
            deliberate_window_errors_excluded=len(fenced_errors), fences=res.get("fences", []),
            client_error_beacons_unforced=len(beacons), beacon_kinds=sorted({str(b.get("kind")) for b in beacons}),
            boundary_beacons_unforced=boundary_beacons[:20], route_fallback_sightings=ERROR_BOUNDARY["sightings"],
            sandbox_integrity_status=integrity["status"],
            sandbox_integrity_checkpoints=[f'{c["label"]}: {c["verdict"]}' for c in integrity["checkpoints"]],
            sandbox_integrity_required=integrity["required"], sandbox_integrity_log=integrity["path"],
            launcher_log_names=integrity["launcher_log_names"], shutdown_waited_s=shutdown_waited_s,
        )

json.dump(res, open(OUT, "w", encoding="utf-8"), indent=1, ensure_ascii=False, default=str)
print(json.dumps({"checks": {k: v.get("verdict") for k, v in res["checks"].items()}}, indent=1))
