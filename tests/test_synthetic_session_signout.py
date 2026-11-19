"""RAIL: every live tool that signs in as a synthetic account signs OUT, through ONE helper.

⚰️ 2026-11-17: `smoke@uctintelligence.internal` held 301 live sessions created since 2026-10-23,
each a working bearer login to a production ADMIN account. The tools that sign in as a synthetic
account POSTed `/api/auth/login` and almost none POSTed `/api/auth/logout`.

What this rail holds, over every file under `tools/` and `scripts/` (CODE only: comments and
docstrings are stripped first -- a sentence ABOUT the login is not a login):

  * A Python file that reads a synthetic credential (`SMOKE_PASSWORD`, `BENCH_PASSWORD`,
    `MEMBER_SMOKE_PASSWORD`, `FREE_SMOKE_PASSWORD`) must import `tools/synthetic_session.py` and
    call it, and NO Python file may POST `/api/auth/login` itself: the helper is the only sign-in,
    and the helper's every session is signed out (tests/test_synthetic_session.py).
  * A `.mjs` / `.js` / `.ps1` file that POSTs `/api/auth/login` must POST `/api/auth/logout`
    from a `finally` (the same guarantee, in its own language: least code).

Named exemptions, each with its reason, and each re-proved below so it cannot go stale:

  * `tools/archive/**` and `docs/**/evidence/**` -- historical records, not tools anyone runs
    (the evidence scripts are outside `tools/` and `scripts/`, so they are never scanned).
  * ENV_HYDRATION_ONLY -- launchers that copy the credential env-var NAMES into the process
    for the session they start; they never sign in (proved: no login in their code).
  * LOCAL_FIXTURE_SIGN_IN -- Python tools that sign in only as a throwaway LOCAL account
    (`@local.dev` and friends) on a local sandbox; they read no synthetic credential (proved).
    A session they leave lives in a throwaway auth.db, not in production.
"""
from __future__ import annotations

import io
import re
import tokenize
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCOPE_DIRS = ("tools", "scripts")
SUFFIXES = (".py", ".mjs", ".js", ".ps1")
HELPER = "tools/synthetic_session.py"
EXEMPT_PREFIXES = {
    "tools/archive/": "historical records, not tools anyone runs",
}
# docs/**/evidence/** -- historical records; outside SCOPE_DIRS, named here so the exemption is visible.
EVIDENCE_NOTE = "docs/**/evidence/** is never scanned: historical records, not tools anyone runs"

_HYDRATE = "copies the credential env-var NAMES from User scope into the process for the session it starts; never signs in"
ENV_HYDRATION_ONLY = {
    "scripts/rth-open.ps1": _HYDRATE,
    "scripts/rth-close.ps1": _HYDRATE,
}

_SANDBOX = "signs in only as a throwaway @local.dev account on a loopback sandbox it (or its launcher) owns"
_ARG = "signs in with --email/--password or tool-specific env (local defaults); a loopback sandbox audit"
LOCAL_FIXTURE_SIGN_IN = {
    "tools/agent_live_chain.py": _SANDBOX,
    "tools/ask_browser_audit.py": _ARG,
    "tools/breadth_charts_shots.py": _SANDBOX,
    "tools/c0_visual_journey.py": _ARG,
    "tools/capture_extension_audit.py": _ARG,
    "tools/capture_phone_audit.py": _ARG,
    "tools/coldstart_repro.py": _ARG,
    "tools/golden_journey_pine_thinkscript_pcf.py": _SANDBOX,
    "tools/hub_critique_capture.py": _ARG,
    "tools/intraday_repro.py": _ARG,
    "tools/iphone_walk.py": _ARG,
    "tools/member_pane_probe.py": _SANDBOX,
    "tools/mobile_crawl.py": _ARG,
    "tools/mobile_deep_probe.py": _SANDBOX,
    "tools/mobile_discovery.py": _ARG,
    "tools/modal_phone_check.py": _ARG,
    "tools/nav_placement_probe.py": _SANDBOX,
    "tools/notebook_campaign/run_campaign.py": _SANDBOX,
    "tools/notebook_fin_walk_features.py": _SANDBOX,
    "tools/notebook_fin_walk_keyed.py": _SANDBOX,
    "tools/notebook_fin_walk_keyed_ai.py": _SANDBOX,
    "tools/notebook_g62_consensus_walk.py": _SANDBOX,
    "tools/notebook_layout_library_walk.py": _SANDBOX,
    "tools/notebook_p5_walk.py": _SANDBOX,
    "tools/notebook_perf_harness.py": _SANDBOX,
    "tools/notebook_proof_walk.py": _SANDBOX,
    "tools/notebook_verify_walk.py": _SANDBOX,
    "tools/notebook_w12d_walk.py": _SANDBOX,
    "tools/notebook_w14_onboarding_walk.py": _SANDBOX,
    "tools/notebook_wave5_walk.py": _SANDBOX,
    "tools/notebook_wave6_walk.py": _SANDBOX,
    "tools/notebook_wave7_walk.py": _SANDBOX,
    "tools/notebook_wave8_walk.py": _SANDBOX,
    "tools/notebook_widgets_p2_walk.py": _SANDBOX,
    "tools/pane_gesture_audit.py": _ARG,
    "tools/pine_coverage/host_lane_browser_probe.py": _SANDBOX + "; any other base is refused unless --synthetic, "
                                                      "which signs in through tools/synthetic_session.py",
    "tools/pine_member_pane_capture.py": _SANDBOX,
    "tools/r1_toolbar_probe.py": _SANDBOX,
    "tools/review_feed_frame_probe.py": _SANDBOX,
    "tools/review_feed_probe.py": _SANDBOX,
    "tools/rs_walkthrough/capture.py": _ARG + "; refuses any @uctintelligence.internal address",
    "tools/sandbox_account.py": _SANDBOX,
    "tools/screener_ui_stress.py": _SANDBOX,
    "tools/share_target_phone_audit.py": _ARG,
    "tools/ssetf_e2e_check.py": _ARG,
    "tools/tweet_import_smoke.py": _SANDBOX,
    "tools/wave_l_e2e.py": _ARG,
    "tools/wave_n_e2e.py": _ARG,
    "tools/wave_n_mobile_a11y.py": _ARG,
    "tools/wave_n_perf.py": _ARG,
    "tools/wave_o6_e2e.py": _ARG,
    "tools/wave_o6_mobile_a11y.py": _ARG,
    "tools/wave_o6_perf.py": _ARG,
    "tools/wave_o_e2e.py": _ARG,
    "tools/wave_o_mobile_a11y.py": _ARG,
    "tools/wave_o_perf.py": _ARG,
    "tools/wave_p5_lifecycle_audit.py": _SANDBOX,
    "tools/wave_p5_ocr_load.py": _SANDBOX,
}

SYNTH_VAR = re.compile(r"\b(?:MEMBER_|FREE_)?(?:SMOKE|BENCH)_PASSWORD\b")
LOGIN = re.compile(r"/api/auth/login(?![\w/-])")
LOGOUT = re.compile(r"/api/auth/logout\b")
HELPER_IMPORT = re.compile(r"(?m)^\s*(?:from\s+tools\s+import\s+synthetic_session\b"
                           r"|import\s+synthetic_session\b"
                           r"|from\s+(?:tools\s*\.\s*)?synthetic_session\s+import\b)")
HELPER_CALL = re.compile(r"\b(?:sign_in_urllib|sign_in_playwright|sign_in_client|http_session"
                         r"|adopt_playwright|has_credentials|env_credentials)\s*\(")


# ── CODE, NEVER PROSE ────────────────────────────────────────────────────────────────────────

def python_code(text: str) -> str:
    """Token stream minus comments and docstrings (a string that is a whole statement)."""
    skip = {tokenize.NL, tokenize.COMMENT, tokenize.ENCODING}
    toks = [t for t in tokenize.generate_tokens(io.StringIO(text).readline)]
    out, prev = [], None
    starts = {tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT, None}
    for i, t in enumerate(toks):
        if t.type in skip:
            continue
        if t.type == tokenize.STRING and (prev is None or prev.type in starts):
            nxt = next((u for u in toks[i + 1:] if u.type not in skip), None)
            if nxt is None or nxt.type in (tokenize.NEWLINE, tokenize.ENDMARKER):
                prev = t
                continue                     # a docstring / bare string statement: prose
        out.append("\n" if t.type == tokenize.NEWLINE else t.string + " ")
        prev = t
    return "".join(out)


def js_code(text: str) -> str:
    """Drop // and /* */ comments outside '...', "..." and `...` literals."""
    out, i, n, quote = [], 0, len(text), None
    while i < n:
        c = text[i]
        if quote:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if c == quote:
                quote = None
            i += 1
            continue
        if c in "'\"`":
            quote = c
            out.append(c)
            i += 1
        elif text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


def ps1_code(text: str) -> str:
    """Drop <# #> blocks and # comments outside '...' and "..." literals."""
    out, i, n, quote = [], 0, len(text), None
    while i < n:
        c = text[i]
        if quote:
            out.append(c)
            if c == quote:
                quote = None
            i += 1
            continue
        if c in "'\"":
            quote = c
            out.append(c)
            i += 1
        elif text.startswith("<#", i):
            j = text.find("#>", i + 2)
            i = n if j < 0 else j + 2
        elif c == "#":
            j = text.find("\n", i)
            i = n if j < 0 else j
        else:
            out.append(c)
            i += 1
    return "".join(out)


def code_of(rel: str, text: str) -> str:
    if rel.endswith(".py"):
        return python_code(text)
    if rel.endswith(".ps1"):
        return ps1_code(text)
    return js_code(text)


def _block(code: str, start: int) -> str:
    """The brace-balanced `{...}` starting at the first `{` at or after `start`."""
    i = code.find("{", start)
    if i < 0:
        return ""
    depth = 0
    for j in range(i, len(code)):
        depth += {"{": 1, "}": -1}.get(code[j], 0)
        if depth == 0:
            return code[i:j + 1]
    return code[i:]


def signs_out_in_finally(code: str) -> bool:
    """A `finally { ... }` block that POSTs /api/auth/logout, directly or by calling a function
    whose own body does (`signOut = async () => { ... logout ... }`, `function signOut() {...}`).
    ⛔ Any other `finally` in the file does not count: the mutation that dropped the sign-out's
    `finally` survived a bare `\\bfinally\\b` check, because the same file has an unrelated one."""
    logout_fns = set()
    for m in re.finditer(r"(?:\bfunction\s+([A-Za-z_$][\w$]*)\s*\(|\b([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?"
                         r"(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>\s*)", code):
        if LOGOUT.search(_block(code, m.end())):
            logout_fns.add(m.group(1) or m.group(2))
    for m in re.finditer(r"\bfinally\s*\{", code):
        body = _block(code, m.end() - 1)
        if LOGOUT.search(body) or any(re.search(rf"(?<![\w$]){re.escape(f)}\s*\(", body) for f in logout_fns):
            return True
    return False


def violations(rel: str, text: str) -> tuple[bool, list[str]]:
    """-> (triggered, violations) for one file's text, exemptions applied."""
    code = code_of(rel, text)
    uses_synth, posts_login = bool(SYNTH_VAR.search(code)), bool(LOGIN.search(code))
    if not (uses_synth or posts_login):
        return False, []
    bad = []
    if rel in ENV_HYDRATION_ONLY:
        if posts_login:
            bad.append(f"{rel}: exempt as env-hydration-only, but it POSTs /api/auth/login")
        return True, bad
    if rel.endswith(".py"):
        if posts_login and rel not in LOCAL_FIXTURE_SIGN_IN:
            bad.append(f"{rel}: POSTs /api/auth/login itself -- sign in through tools/synthetic_session.py")
        if uses_synth and not (HELPER_IMPORT.search(code) and HELPER_CALL.search(code)):
            bad.append(f"{rel}: reads a synthetic credential but does not import AND call tools/synthetic_session.py")
        if uses_synth and rel in LOCAL_FIXTURE_SIGN_IN:
            bad.append(f"{rel}: exempt as a local-fixture sign-in, but it reads a synthetic credential")
    else:
        if posts_login and not signs_out_in_finally(code):
            bad.append(f"{rel}: POSTs /api/auth/login without a POST /api/auth/logout in a `finally`")
        if uses_synth and not posts_login:
            bad.append(f"{rel}: reads a synthetic credential; sign in with a guaranteed sign-out or "
                       "name it in ENV_HYDRATION_ONLY with the reason")
    return True, bad


def in_scope() -> list[str]:
    files = []
    for d in SCOPE_DIRS:
        for p in sorted((REPO / d).rglob("*")):
            rel = p.relative_to(REPO).as_posix()
            if p.suffix not in SUFFIXES or not p.is_file() or rel == HELPER:
                continue
            if any(rel.startswith(x) for x in EXEMPT_PREFIXES) or "/node_modules/" in rel:
                continue
            files.append(rel)
    return files


def _scan():
    triggered, bad = [], []
    for rel in in_scope():
        hit, v = violations(rel, (REPO / rel).read_text(encoding="utf-8", errors="replace"))
        if hit:
            triggered.append(rel)
        bad += v
    return triggered, bad


# ── the rail ─────────────────────────────────────────────────────────────────────────────────

def test_every_synthetic_sign_in_goes_through_the_helper_or_signs_out_in_finally():
    triggered, bad = _scan()
    assert not bad, "a tool can leave a live synthetic session behind:\n  " + "\n  ".join(bad)


def test_NON_VACUITY_the_scan_sees_the_tools_it_governs():
    """A scan that read nothing would pass. These files sign in as synthetic accounts today, in
    each language; the scan must see every one of them as a sign-in it governs."""
    triggered, _ = _scan()
    must_see = {"tools/hub_nav_smoke.py", "tools/smoke_reset.py", "tools/smoke_login_link.py",
                "tools/notebook_personal_api_walk.py", "tools/flow_cold_paint_rig.py",
                "tools/t12_smoke_runner.py", "tools/resolve_client_error.mjs",
                "scripts/rth-preflight.ps1"}
    assert must_see <= set(triggered), sorted(must_see - set(triggered))
    assert len(triggered) >= 70, len(triggered)


def test_every_exemption_is_still_true():
    """An exemption list drifts like any other artifact: each entry must still exist, still be
    the kind of file its reason says, and never read a synthetic credential."""
    stale = []
    for rel in list(ENV_HYDRATION_ONLY) + list(LOCAL_FIXTURE_SIGN_IN):
        p = REPO / rel
        if not p.is_file():
            stale.append(f"{rel}: listed but missing")
            continue
        code = code_of(rel, p.read_text(encoding="utf-8", errors="replace"))
        if rel in ENV_HYDRATION_ONLY and not SYNTH_VAR.search(code):
            stale.append(f"{rel}: no longer touches a synthetic credential -- drop it from the list")
        if rel in LOCAL_FIXTURE_SIGN_IN and not LOGIN.search(code):
            stale.append(f"{rel}: no longer signs in -- drop it from the list")
        if rel in LOCAL_FIXTURE_SIGN_IN and SYNTH_VAR.search(code):
            stale.append(f"{rel}: reads a synthetic credential -- it must use tools/synthetic_session.py")
    assert not stale, "\n".join(stale)
    assert (REPO / "tools" / "archive").is_dir(), "the archive exemption names a directory that is gone"


# ── CONTROLS: the scan sees a real offender, and a sentence is not one ───────────────────────

RAW_PY = '''import os, json
def login(page, base):
    r = page.request.post(f"{base}/api/auth/login",
                          data=json.dumps({"email": os.environ["SMOKE_EMAIL"],
                                           "password": os.environ["SMOKE_PASSWORD"]}))
    return r.ok
'''

PROSE_PY = '''"""Signs in by POSTing /api/auth/login with SMOKE_PASSWORD (historical note)."""
# r = page.request.post(base + "/api/auth/login")   # SMOKE_PASSWORD
def f():
    """MEMBER_SMOKE_PASSWORD and /api/auth/login, in a docstring."""
    return 1
'''

GOOD_PY = '''def login(page, base):
    try:
        from tools import synthetic_session as S
    except ImportError:
        import synthetic_session as S
    return S.sign_in_playwright(page, base, "smoke").ok
'''


@pytest.mark.parametrize("rel,text,expect_bad", [
    ("tools/x_raw.py", RAW_PY, 2),                    # raw login AND credential without the helper
    ("tools/x_prose.py", PROSE_PY, 0),                # comments and docstrings are prose
    ("tools/x_good.py", GOOD_PY, 0),
    ("tools/x_imports_but_posts.py", GOOD_PY + 'requests.post(BASE + "/api/auth/login")\n', 1),
    ("tools/x_reads_only.py", 'import os\npw = os.environ["BENCH_PASSWORD"]\n', 1),
    ("tools/x.mjs", "const r = await fetch(`${SITE}/api/auth/login`, {method: 'POST'})\n", 1),
    ("tools/x.mjs", "try { await fetch(`${S}/api/auth/login`) } finally { await fetch(`${S}/api/auth/logout`) }\n", 0),
    ("tools/x.mjs", "let out = async () => { await fetch(`${S}/api/auth/logout`, {method: 'POST'}) }\n"
                    "try { await fetch(`${S}/api/auth/login`) } finally { await out() }\n", 0),
    # a logout that exists and a `finally` that exists -- but that finally does not sign out
    ("tools/x.mjs", "let out = async () => { await fetch(`${S}/api/auth/logout`) }\n"
                    "try { await fetch(`${S}/api/auth/login`); await out() } finally { cleanup() }\n", 1),
    ("tools/x.mjs", "// await fetch(`${SITE}/api/auth/login`)  SMOKE_PASSWORD\n", 0),
    ("tools/x.mjs", "const u = 'https://x//api/auth/login'\n", 1),   # `//` inside a string is code
    ("scripts/x.ps1", "Invoke-WebRequest -Uri 'https://x/api/auth/login' -Method Post\n", 1),
    ("scripts/x.ps1", "# Invoke-WebRequest -Uri 'https://x/api/auth/login'\n<# SMOKE_PASSWORD #>\n", 0),
    ("scripts/x.ps1", "$p = $env:MEMBER_SMOKE_PASSWORD\n", 1),
])
def test_CONTROL_the_scan_tells_offenders_from_prose(rel, text, expect_bad):
    _hit, bad = violations(rel, text)
    assert len(bad) == expect_bad, bad


def test_CONTROL_an_exemption_does_not_cover_a_synthetic_sign_in():
    rel = "tools/wave_o_e2e.py"
    assert rel in LOCAL_FIXTURE_SIGN_IN
    _hit, bad = violations(rel, RAW_PY)
    assert any("reads a synthetic credential" in b for b in bad), bad
    _hit, bad = violations("scripts/rth-open.ps1",
                           "Invoke-WebRequest -Uri 'https://x/api/auth/login' # $env:SMOKE_PASSWORD\n")
    assert bad, "an env-hydration exemption must not hide a login"
