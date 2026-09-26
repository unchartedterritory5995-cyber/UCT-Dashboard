"""Rails for the wave-8 live walk's own instrument (tools/notebook_wave8_walk.py).

The walk is a Playwright script, not a module: it parses argv and drives a browser at
import. What these rails exercise is its IMPORTABLE PART -- every top-level statement
above `ARGS = _ap.parse_args()`, cut by AST and executed on its own, so the code under
test is the file's own bytes (a mutation to the file reaches the rail; there is no copy
of it here). Derived from tests/test_notebook_wave7_walk.py; wave 8's additions are marked.

W11 (wave 7's W13, renamed): decided by the perf harness's own reader (`read_integrity`)
against pre-boot, +15 s AND shutdown, after a bounded wait for the shutdown line. The logs
below are written by the launcher's own writer (`data_root_snapshot.append_log`).

`--base` identity (tooling review M-3): the walk refuses, before the first request, unless
`scripts/sandbox_identity.verify` finds the same per-run nonce in `--integrity-log` and at
`/__uct_sandbox_identity`. The rails drive the REAL helper against a real local server.

wave 8: the verdict helpers (fences, leak search, the axe bar, the file name a
Content-Disposition names, the .docx reader, the block-once route handler) and the SOURCE
READERS the walk compares against -- each proved to still find, in the committed files,
the sentence or title it exists to read.
"""
from __future__ import annotations

import ast
import contextlib
import io
import json
import sys
import threading
import time
import types
import zipfile
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
WALK = REPO / "tools" / "notebook_wave8_walk.py"
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))

import data_root_snapshot as drs  # noqa: E402  (the launcher's own log writer)
import sandbox_identity as sid  # noqa: E402  (the launcher's own identity marker)
from tools import notebook_perf_harness as h  # noqa: E402

W11_ROW = "W11_integrity"


def _tree() -> ast.Module:
    return ast.parse(WALK.read_text(encoding="utf-8"), filename=str(WALK))


def _args_cut(tree: ast.Module) -> int:
    for i, node in enumerate(tree.body):
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "ARGS"
                                                for t in node.targets):
            return i
    raise AssertionError("the walk has no top-level `ARGS = ...` -- the importable part has no boundary")


@contextlib.contextmanager
def _playwright_importable():
    """The importable part imports `playwright.sync_api` at top level and never CALLS it above
    `ARGS = ...`. Without a real install, a stub that REFUSES to be called stands in for the
    import only, and is removed again so no other test ever sees it (wave 7, PR #196)."""
    try:
        import playwright.sync_api  # noqa: F401
    except ModuleNotFoundError:
        pass
    else:
        yield
        return

    def _refuse(*_a, **_k):
        raise AssertionError("the walk's importable part must never start a browser")

    pkg, sub = types.ModuleType("playwright"), types.ModuleType("playwright.sync_api")
    sub.sync_playwright, pkg.sync_api = _refuse, sub
    sys.modules["playwright"], sys.modules["playwright.sync_api"] = pkg, sub
    try:
        yield
    finally:
        sys.modules.pop("playwright.sync_api", None)
        sys.modules.pop("playwright", None)


@pytest.fixture(scope="module")
def walk() -> dict:
    """The walk's importable part, executed from its source."""
    tree = _tree()
    ns: dict = {"__file__": str(WALK), "__name__": "notebook_wave8_walk__importable"}
    with _playwright_importable():
        exec(compile(ast.Module(body=tree.body[:_args_cut(tree)], type_ignores=[]), str(WALK), "exec"), ns)
    return ns


def _log(tmp_path: Path, labels, *, dirty=(), name="integrity.md") -> str:
    path = tmp_path / name
    for label in labels:
        diffs = [("CHANGED", "auth.db", "sha differs")] if label in dirty else []
        drs.append_log(str(path), label, r"C:\data", 61, diffs)
    return str(path)


ALL_THREE = (h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN)


def _w11(walk, path, errors=(), launcher_text=None):
    return walk["w11_verdict"](walk["w11_integrity"](path, launcher_text), list(errors))


# ── non-vacuity: the prefix really holds the code under test ────────────────────────────

def test_the_importable_part_defines_W11s_code_and_reuses_the_harness_reader(walk):
    for name in ("w11_verdict", "w11_integrity", "wait_for_shutdown_checkpoint", "integrity_log_named_in"):
        assert callable(walk.get(name)), f"{name} is not above `ARGS = ...` in the walk"
    assert walk["_harness"] is h
    assert tuple(walk["W11_REQUIRED"]) == ALL_THREE
    tree = _tree()
    defs = {n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
    assert "read_integrity" not in defs


# ── W11's verdicts ──────────────────────────────────────────────────────────────────────

def test_all_three_checkpoints_CLEAN_is_PASS(tmp_path, walk):
    assert _w11(walk, _log(tmp_path, ALL_THREE)) == ("PASS", None)


def test_a_log_missing_the_shutdown_checkpoint_is_INCONCLUSIVE(tmp_path, walk):
    verdict, why = _w11(walk, _log(tmp_path, (h.PRE_BOOT, h.POST_BOOT, h.PREWARM)))
    assert verdict == "INCONCLUSIVE"
    assert "INCOMPLETE" in why and repr(h.SHUTDOWN) in why


def test_a_checkpoint_that_is_NOT_CLEAN_is_FAIL(tmp_path, walk):
    verdict, why = _w11(walk, _log(tmp_path, ALL_THREE, dirty=(h.SHUTDOWN,)))
    assert verdict == "FAIL"
    assert "shared data root changed" in why and h.SHUTDOWN in why


@pytest.mark.parametrize("path", [None, "", "does/not/exist.md"])
def test_no_integrity_log_is_INCONCLUSIVE_never_PASS(tmp_path, walk, path):
    verdict, why = _w11(walk, path)
    assert verdict == "INCONCLUSIVE" and "MISSING" in why


def test_an_unforced_page_error_fails_on_a_clean_log(tmp_path, walk):
    verdict, why = _w11(walk, _log(tmp_path, ALL_THREE), errors=["TypeError: x is undefined"])
    assert verdict == "FAIL" and "1 unforced page error" in why


def test_the_log_must_be_the_one_the_launcher_named(tmp_path, walk):
    path = _log(tmp_path, ALL_THREE)
    other = _log(tmp_path, ALL_THREE, name="another-run.md")
    said = lambda p: f"  [pre-boot] shared data root CLEAN\r\n  [pre-boot] integrity log: {p}\r\n"  # noqa: E731
    assert _w11(walk, path, launcher_text=said(path)) == ("PASS", None)
    verdict, why = _w11(walk, path, launcher_text=said(other))
    assert verdict == "INCONCLUSIVE" and "another-run.md" in why
    assert _w11(walk, path, launcher_text=None) == ("PASS", None)


def test_the_wait_returns_once_the_shutdown_line_lands(tmp_path, walk):
    path = _log(tmp_path, (h.PRE_BOOT, h.POST_BOOT))
    timer = threading.Timer(0.6, lambda: drs.append_log(path, h.SHUTDOWN, r"C:\data", 61, []))
    timer.start()
    try:
        waited = walk["wait_for_shutdown_checkpoint"](path, 20, poll_s=0.05)
    finally:
        timer.cancel()
    assert 0.5 <= waited < 10
    assert _w11(walk, path) == ("PASS", None)


def test_the_wait_is_bounded_and_then_W11_is_INCONCLUSIVE(tmp_path, walk, capsys):
    path = _log(tmp_path, (h.PRE_BOOT, h.POST_BOOT))
    t0 = time.time()
    waited = walk["wait_for_shutdown_checkpoint"](path, 0.4, poll_s=0.05)
    assert 0.35 <= waited and time.time() - t0 < 5
    assert _w11(walk, path)[0] == "INCONCLUSIVE"
    # the operator's (and the driver's) cue names W11
    assert "(W11: waiting" in capsys.readouterr().err


# ── wiring: the row the walk records IS this verdict, after the wait ─────────────────────

def _main_block(tree: ast.Module) -> ast.With:
    withs = [n for n in tree.body[_args_cut(tree):] if isinstance(n, ast.With)]
    assert len(withs) == 1, "expected the walk's one top-level `with sync_playwright()` block"
    return withs[0]


def _calls(node, name):
    return [c for c in ast.walk(node) if isinstance(c, ast.Call)
            and ((isinstance(c.func, ast.Name) and c.func.id == name)
                 or (isinstance(c.func, ast.Attribute) and c.func.attr == name))]


def _is_args(node, attr):
    return (isinstance(node, ast.Attribute) and node.attr == attr
            and isinstance(node.value, ast.Name) and node.value.id == "ARGS")


def test_W11_is_recorded_from_w11_verdict_after_the_browser_closes_and_the_wait():
    main = _main_block(_tree())
    records = [c for c in _calls(main, "record")
               if c.args and isinstance(c.args[0], ast.Constant) and c.args[0].value == W11_ROW]
    assert len(records) == 1, "W11 must be recorded exactly once"
    rec = records[0]
    verdict_name = rec.args[1].id
    binds = [n for n in ast.walk(main) if isinstance(n, ast.Assign) and isinstance(n.value, ast.Call)
             and isinstance(n.value.func, ast.Name) and n.value.func.id == "w11_verdict"
             and any(isinstance(t, ast.Tuple) and t.elts and isinstance(t.elts[0], ast.Name)
                     and t.elts[0].id == verdict_name for t in n.targets)]
    assert len(binds) == 1
    waits = _calls(main, "wait_for_shutdown_checkpoint")
    assert len(waits) == 1 and _is_args(waits[0].args[0], "integrity_log") \
        and _is_args(waits[0].args[1], "shutdown_wait")
    reads = _calls(main, "w11_integrity")
    assert len(reads) == 1 and _is_args(reads[0].args[0], "integrity_log")
    closes = [c for c in _calls(main, "close") if isinstance(c.func, ast.Attribute)
              and isinstance(c.func.value, ast.Name) and c.func.value.id == "browser"]
    assert closes
    assert (closes[-1].lineno < waits[0].lineno < reads[0].lineno
            < binds[0].lineno <= rec.lineno), "W11 must be judged after the browser closed and the wait"


def test_W11_judges_only_the_UNFENCED_errors():
    """wave 8: deliberate failures are fenced; W11's errors are `unfenced(res["errors"], ...)`."""
    main = _main_block(_tree())
    binds = [n for n in ast.walk(main) if isinstance(n, ast.Assign)
             and any(isinstance(t, ast.Name) and t.id == "genuine_errors" for t in n.targets)]
    assert len(binds) == 1
    call = binds[0].value
    assert isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == "unfenced"
    assert ast.unparse(call.args[0]) == "res['errors']" and ast.unparse(call.args[1]) == "ERROR_FENCES"


def test_every_row_the_brief_names_is_recorded():
    main = _main_block(_tree())
    keys = {c.args[0].value for c in _calls(main, "guarded")
            if c.args and isinstance(c.args[0], ast.Constant)}
    keys |= {W11_ROW}
    prefixes = {k.split("_", 1)[0] for k in keys}
    assert prefixes == {f"W{i}" for i in range(1, 12)}, sorted(prefixes)


# ── --base identity (M-3): the walk writes nothing to a server it cannot identify ─────────

@contextlib.contextmanager
def _server(routes: dict):
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    seen: list = []

    class Handler(BaseHTTPRequestHandler):
        def _answer(self):
            seen.append((self.command, self.path))
            code, ctype, out = routes.get(self.path, (404, "application/json", b'{"detail": "Not Found"}'))
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)

        do_GET = do_POST = _answer  # noqa: N815

        def log_message(self, *a):
            pass

    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{srv.server_address[1]}", seen
    finally:
        srv.shutdown()
        srv.server_close()


def _marker(nonce: str):
    body = sid.payload(nonce, data_dir=r"C:\data-w8walk", integrity_log="its-own.md", pid=1, started_at="t")
    return (200, "application/json", json.dumps(body).encode("utf-8"))


def _identity_log(tmp_path: Path, nonce: str) -> str:
    path = tmp_path / "sandbox-run.md"
    drs.append_log(str(path), h.PRE_BOOT, r"C:\data", 61, [], extra=sid.log_extra(r"C:\data-w8walk", nonce))
    return str(path)


def test_this_runs_sandbox_is_admitted_and_the_verdict_recorded(tmp_path, walk, capsys):
    nonce = sid.mint()
    log = _identity_log(tmp_path, nonce)
    sink: dict = {}
    with _server({sid.IDENTITY_PATH: _marker(nonce)}) as (base, seen):
        verdict = walk["require_sandbox_identity"](base, log, sink=sink)
    assert verdict.ok and verdict.nonce == nonce
    assert sink["sandbox_identity"]["ok"] is True and seen == [("GET", sid.IDENTITY_PATH)]
    assert capsys.readouterr().out.startswith("SANDBOX IDENTITY: ")


@pytest.mark.parametrize("server", ["another sandbox", "a stale backend (JSON 404)", "nothing listening"])
def test_any_other_server_is_refused(tmp_path, walk, capsys, server):
    nonce = sid.mint()
    log = _identity_log(tmp_path, nonce)
    routes = {"another sandbox": {sid.IDENTITY_PATH: _marker(sid.mint())},
              "a stale backend (JSON 404)": {"/api/health": (200, "application/json", b'{"status": "ok"}')},
              "nothing listening": None}[server]
    sink: dict = {}
    with contextlib.ExitStack() as stack:
        base = "http://127.0.0.1:1" if routes is None else stack.enter_context(_server(routes))[0]
        with pytest.raises(SystemExit) as exit_info:
            walk["require_sandbox_identity"](base, log, sink=sink)
    assert exit_info.value.code == 3
    out = capsys.readouterr().out
    assert out.startswith("REFUSED: ") and sink["sandbox_identity"]["ok"] is False


_SENDS = {"http", "signup_or_login", "provision_member", "urlopen", "sync_playwright"}


def test_the_walk_checks_identity_before_its_first_request():
    tree = _tree()
    cut = _args_cut(tree)
    gate = [i for i, n in enumerate(tree.body) if isinstance(n, ast.Expr) and isinstance(n.value, ast.Call)
            and isinstance(n.value.func, ast.Name) and n.value.func.id == "require_sandbox_identity"]
    assert len(gate) == 1
    call = tree.body[gate[0]].value
    assert (isinstance(call.args[0], ast.Name) and call.args[0].id == "BASE"
            and _is_args(call.args[1], "integrity_log")
            and any(k.arg == "sink" and isinstance(k.value, ast.Name) and k.value.id == "res"
                    for k in call.keywords))
    main = _main_block(tree)
    assert cut < gate[0] < tree.body.index(main)
    for stmt in tree.body[cut:gate[0]]:
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        sends = {c.func.id if isinstance(c.func, ast.Name) else c.func.attr
                 for c in ast.walk(stmt) if isinstance(c, ast.Call)
                 and isinstance(c.func, (ast.Name, ast.Attribute))} & _SENDS
        assert not sends, f"line {stmt.lineno} sends ({sends}) before the identity check"


# ── sign-up vs the app's rate limiter (wave 7, found by the 96fa5ca2a evidence run) ───────

class _FakeRequests:
    def __init__(self, answers):
        self.answers = list(answers)
        self.calls: list = []

    def post(self, url, data=None):
        self.calls.append(url.rsplit("/api/auth/", 1)[-1])
        status = self.answers.pop(0)
        return type("R", (), {"status": status, "ok": 200 <= status < 300})()


def _run(walk, answers, **kw):
    fake, slept = _FakeRequests(answers), []
    r = walk["_signup_or_login"](fake, "http://sandbox", "m@local.dev", "pw", "m", sleep=slept.append, **kw)
    return r.status, fake.calls, slept


def test_a_rate_limited_signup_is_never_read_as_an_existing_account(walk):
    assert _run(walk, [429, 200]) == (200, ["signup", "signup"], [61.0])


def test_an_existing_account_signs_in_without_waiting(walk):
    assert _run(walk, [409, 200]) == (200, ["signup", "login"], [])


def test_the_walk_refuses_an_unprovisioned_member():
    fns = {n.name: n for n in ast.walk(_tree()) if isinstance(n, ast.FunctionDef)}
    prov = fns["provision_member"]
    guarded = [n for n in ast.walk(prov) if isinstance(n, ast.If)
               and "paid_equiv" in ast.unparse(n.test) and any(isinstance(x, ast.Raise) for x in ast.walk(n))]
    assert guarded, "provision_member must refuse a member that is not signed in and paid"


def test_no_password_is_typed_into_the_walk():
    """wave 8: the sandbox password is a generated TEST value handed in by environment
    (`W8WALK_PASSWORD`), never a literal in the committed file (wave 7 typed one)."""
    src = WALK.read_text(encoding="utf-8")
    assert "LocalTest2026!" not in src
    assert 'os.environ.get("W8WALK_PASSWORD")' in src and "secrets.token_urlsafe" in src


# ── selectors come from COMPONENTS, never from a test's mock (wave 7) ────────────────────

_TEST_FILE = __import__("re").compile(r"\.(test|spec)\.[jt]sx?$")


def _component_testids() -> set:
    import re as _re
    found = set()
    for path in (REPO / "app" / "src").rglob("*"):
        if path.suffix not in (".jsx", ".js", ".tsx", ".ts") or _TEST_FILE.search(path.name):
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        found.update(_re.findall(r"""data-testid\s*=\s*\{?\s*["'`]([A-Za-z0-9_\-]+)["'`]""", text))
    return found


def test_every_test_id_the_walk_waits_on_is_rendered_by_a_real_component():
    used = {c.args[0].value for c in _calls(_tree(), "get_by_test_id")
            if c.args and isinstance(c.args[0], ast.Constant) and isinstance(c.args[0].value, str)}
    assert {"shared-note", "shared-note-gone", "published-page-gone", "bulk-undo-notice"} <= used, \
        "non-vacuity: the walk's known test ids were not read"
    known = _component_testids()
    assert "shared-note" in known, "non-vacuity: no component test ids were found"
    missing = sorted(used - known)
    assert not missing, f"the walk waits on test ids no real component renders: {missing}"


# ── wave 8: the verdict helpers ─────────────────────────────────────────────────────────

def test_unfenced_drops_exactly_the_fenced_indexes(walk):
    items = list("abcdefg")
    assert walk["unfenced"](items, []) == items
    assert walk["unfenced"](items, [[1, 3]]) == ["a", "d", "e", "f", "g"]
    assert walk["unfenced"](items, [[1, 3], [5, None]]) == ["a", "d", "e"]
    # an empty fence (opened and closed with nothing inside) removes nothing
    assert walk["unfenced"](items, [[4, 4]]) == items


def test_find_leaks_names_every_needle_found_and_ignores_empty_ones(walk):
    text = '<a href="/p/x">note</a> 3f2a-id and walker@local.dev'
    assert walk["find_leaks"](text, ["3f2a-id", "walker@local.dev", "absent", "", None]) == \
        ["3f2a-id", "walker@local.dev"]
    assert walk["find_leaks"](None, ["x"]) == []


def test_the_axe_bar_is_serious_or_critical_only(walk):
    vs = [{"id": "a", "impact": "minor"}, {"id": "b", "impact": "moderate"},
          {"id": "c", "impact": "serious"}, {"id": "d", "impact": "critical"}, "junk"]
    assert [v["id"] for v in walk["serious_violations"](vs)] == ["c", "d"]
    assert walk["serious_violations"](None) == []


@pytest.mark.parametrize("header,name", [
    ("attachment; filename=\"Walk W4 _ export _ r1-20260926.md\"; "
     "filename*=UTF-8''Walk%20W4%20%E2%80%94%20export%20%F0%9F%93%88%20r1-20260926.md",
     "Walk W4 \u2014 export \U0001F4C8 r1-20260926.md"),
    ('attachment; filename="plain.md"', "plain.md"),
    ("attachment", None),
    (None, None),
])
def test_the_file_name_is_read_from_filename_star_first(walk, header, name):
    assert walk["disposition_filename"](header) == name


def test_the_public_header_pair_is_nosniff_and_no_store(walk):
    ok, facts = walk["public_api_headers_ok"]({"Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff"})
    assert ok and facts["cache-control"] == "no-store, private"
    assert not walk["public_api_headers_ok"]({"cache-control": "no-store"})[0]
    assert not walk["public_api_headers_ok"]({"x-content-type-options": "nosniff", "cache-control": "no-cache"})[0]


def _docx(paragraphs, media):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types/>')
        body = "".join(f'<w:p><w:pPr/><w:r><w:t xml:space="preserve">{t}</w:t></w:r></w:p>' for t in paragraphs)
        zf.writestr("word/document.xml", f'<?xml version="1.0"?><w:document xmlns:w="w"><w:body>{body}'
                                         '<w:sectPr/></w:body></w:document>')
        for name, size in media.items():
            zf.writestr(f"word/media/{name}", b"x" * size)
    return buf.getvalue()


def test_docx_facts_reads_media_sizes_and_the_not_included_list(walk):
    heading = walk["DOCX_NOT_INCLUDED"]
    blob = _docx(["Title", "body &amp; more", heading, "img3 -- left out: cap", "img4 -- left out: cap"],
                 {"image1.png": 10, "image2.png": 32})
    d = walk["docx_facts"](blob)
    assert d["media_count"] == 2 and d["media_total"] == 42 and not d["bad_xml"]
    assert d["paragraphs"][1] == "body & more"
    assert d["not_included"] == ["img3 -- left out: cap", "img4 -- left out: cap"]
    assert walk["docx_facts"](_docx(["only text"], {}))["not_included"] == []


def test_the_not_included_heading_is_still_what_the_word_writer_writes():
    import re
    src = (REPO / "api/services/journal_two/notes_export_formats.py").read_text(encoding="utf-8")
    assert re.search(r'_run\("Not included in this export"\)', src), \
        "the Word writer's heading moved: DOCX_NOT_INCLUDED reads nothing"


class _Route:
    def __init__(self, log):
        self.log = log

    def abort(self, why):
        self.log.append(("abort", why))

    def continue_(self):
        self.log.append(("continue",))


def test_block_once_aborts_the_first_request_only(walk):
    handler, state = walk["make_block_once"]()
    log: list = []
    for _ in range(3):
        handler(_Route(log))
    assert log == [("abort", "failed"), ("continue",), ("continue",)]
    assert state == {"calls": 3, "aborted": 1, "continued": 2}


def test_takes_text_is_a_field_or_anything_editable(walk):
    assert walk["takes_text"]({"tag": "INPUT", "editable": False})
    assert walk["takes_text"]({"tag": "DIV", "editable": True})
    assert not walk["takes_text"]({"tag": "H2", "editable": False})
    assert not walk["takes_text"](None)


# ── wave 8: the source readers find what they read, in the committed files ──────────────

def test_the_tour_steps_are_read_in_order_with_every_title(walk):
    steps = walk["tour_steps"]()
    assert [s["id"] for s in steps][:2] == ["first-run", "sidebar"], "non-vacuity: the order is the file's"
    assert len(steps) >= 6 and all(s["title"] for s in steps), steps
    assert any(s["file"].endswith("FolderSidebar.jsx") for s in steps)
    assert steps[0]["title"] == "Welcome to your Notebook"


def test_the_sentences_the_walk_compares_against_are_read_from_source(walk):
    js, py = walk["js_string"], walk["py_string"]
    sample_js = walk["SAMPLE_JS"]
    assert js(sample_js, "refused").startswith("You already have notes")
    assert js(sample_js, "add") == "Add a sample notebook"
    assert js(sample_js, "remove") == "Remove it"            # never the `removeAnyway`/`removed` keys
    assert js(sample_js, "removed").startswith("The sample notes are in Trash")
    assert js(walk["TOUR_COPY_JS"], "next") == "Next" and js(walk["TOUR_COPY_JS"], "done") == "Done"
    assert py(walk["SAMPLE_PY"], "REFUSED_SENTENCE").startswith("You already have notes")
    assert py(walk["PUBLIC_PAYLOAD_PY"], "NEUTRAL_LINE").endswith("public pages.")
    assert walk["py_number"](walk["NOTES_EXPORT_PY"], "_DEFAULT_ATTACHMENT_CAP_BYTES") == 200 * 1024 * 1024
    assert "left out" in py(walk["NOTES_EXPORT_PY"], "_CAP_REACHED")
    assert walk["gone_sentence"](walk["SHARED_PAGE_JSX"]).startswith("This link is no longer")
    assert walk["gone_sentence"](walk["PUBLISHED_PAGE_JSX"]).startswith("This page is no longer")
    assert walk["help_question_with_tour_link"]().endswith("?")
    with pytest.raises(LookupError):
        js(sample_js, "no_such_key_anywhere")
    with pytest.raises(LookupError):
        py(walk["SAMPLE_PY"], "NO_SUCH_CONSTANT")


def test_the_two_typed_sentences_are_still_in_their_components(walk):
    fallback = (REPO / "app/src/components/AppErrorFallback.jsx").read_text(encoding="utf-8")
    editor = (REPO / "app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx").read_text(encoding="utf-8")
    assert walk["ROUTE_FALLBACK_TEXT"] in fallback
    assert walk["NOTE_LOAD_ERROR"] in editor


def _literal_ui_names() -> set:
    """Every LITERAL accessible name / label / text the walk hands a Playwright locator."""
    names = set()
    for c in ast.walk(_tree()):
        if not isinstance(c, ast.Call) or not isinstance(c.func, ast.Attribute):
            continue
        if c.func.attr == "get_by_role":
            for k in c.keywords:
                if k.arg == "name" and isinstance(k.value, ast.Constant) and isinstance(k.value.value, str):
                    names.add(k.value.value)
        elif c.func.attr in ("get_by_label", "get_by_text") and c.args \
                and isinstance(c.args[0], ast.Constant) and isinstance(c.args[0].value, str):
            names.add(c.args[0].value)
    return names


def test_every_literal_name_the_walk_looks_for_is_in_a_real_component():
    """The walk's typed selectors come from components (wave 7's rule, extended to names): a
    renamed button is a red here, not a 30-second timeout in an evidence run."""
    names = _literal_ui_names()
    assert {"Share this note", "Create link", "Hide folders panel", "Tasks view"} <= names, \
        "non-vacuity: the walk's known names were not read"
    corpus = "\n".join(p.read_text(encoding="utf-8", errors="replace") for p in (REPO / "app" / "src").rglob("*")
                       if p.suffix in (".jsx", ".js") and not _TEST_FILE.search(p.name))
    missing = sorted(n for n in names if n not in corpus)
    assert not missing, f"names no component carries: {missing}"


def test_link_mark_hrefs_reads_marks_never_node_attributes(walk):
    body = {"type": "doc", "content": [
        {"type": "linkPreview", "attrs": {"url": "https://x/card"}},
        {"type": "paragraph", "content": [{"type": "text", "text": "t",
                                           "marks": [{"type": "link", "attrs": {"href": "https://x/mark"}}]}]}]}
    assert walk["link_mark_hrefs"](body) == ["https://x/mark"]
