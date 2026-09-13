"""C-13: the render token must never reach a log line or a response body.

The renderer logged the token 142 times in 14 days — Playwright's call log prints the URL it failed
on, and that URL carries `?token=`. The fix (2.3) was `scrub()` plus logging only `url_path()`. This
file is the rail that keeps it fixed: it reads the renderer's AST and fails if any logging call is
handed something URL-bearing without passing it through `scrub` or `url_path` first.

⛔ AST, never a text search. A `grep` for `log.*url` matches the prose in a docstring explaining why
the token must not be logged — the instrument would report its own comment as the defect
(CLAUDE.md: "CODE, NEVER PROSE").
"""
from __future__ import annotations

import ast
import pathlib

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
RENDERER = REPO / "services" / "chart_renderer" / "app.py"
SAFE = {"scrub", "url_path", "scrub_text"}
# Names that carry a full URL (and therefore the token) if logged raw.
URLISH = {"url", "page_url", "req.url", "request.url"}


def _logging_calls(tree: ast.AST):
    """Every `log.<level>(...)` / `logger.<level>(...)` call node."""
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and isinstance(node.func.value, ast.Name) and node.func.value.id in ("log", "logger", "logging")
                and node.func.attr in ("debug", "info", "warning", "error", "exception", "critical")):
            yield node


def _arg_source(node: ast.AST) -> str:
    return ast.unparse(node)


def _unsafe_args(call: ast.Call) -> list[str]:
    """Arguments that name a URL without a sanitising call wrapped around them."""
    bad = []
    for arg in call.args[1:] + [kw.value for kw in call.keywords]:
        src = _arg_source(arg)
        if isinstance(arg, ast.Call) and isinstance(arg.func, ast.Name) and arg.func.id in SAFE:
            continue
        if isinstance(arg, ast.Call) and isinstance(arg.func, ast.Attribute) and arg.func.attr in SAFE:
            continue
        if any(u in src for u in URLISH) and not any(f"{s}(" in src for s in SAFE):
            bad.append(src)
    return bad


def test_the_renderer_never_logs_a_url_without_scrubbing_it():
    tree = ast.parse(RENDERER.read_text(encoding="utf-8"))
    calls = list(_logging_calls(tree))
    assert len(calls) >= 5, f"only {len(calls)} logging calls found — the AST walk did not run"
    offenders = []
    for call in calls:
        for src in _unsafe_args(call):
            offenders.append(f"line {call.lineno}: {src}")
    assert not offenders, (
        "a logging call passes a URL straight through — the render token travels in that URL "
        "(C-13, 142 leaked lines in 14 days). Wrap it in scrub() or log url_path() instead:\n  "
        + "\n  ".join(offenders))


def test_the_rail_can_see_a_planted_violation():
    """⛔ NON-VACUITY. Without this, the test above passes for a walk that finds nothing."""
    planted = ast.parse('log.warning("render failed for %s", req.url)\n')
    calls = list(_logging_calls(planted))
    assert len(calls) == 1
    assert _unsafe_args(calls[0]) == ["req.url"]


def test_the_rail_accepts_the_sanitised_forms():
    for safe_src in ('log.warning("failed for %s", url_path(req.url))\n',
                     'log.error("render failed cid=%s path=%s", cid, url_path(req.url))\n',
                     'log.warning("probe failed for %s: %s", url_path(req.url), scrub(e))\n'):
        call = next(_logging_calls(ast.parse(safe_src)))
        assert _unsafe_args(call) == [], safe_src


@pytest.mark.parametrize("module", ["api/services/discord_chart_house.py", "api/services/buzz_image.py"])
def test_the_web_senders_never_log_the_page_url_either(module):
    """Web builds the token-bearing URL; it must log the symbol and the status, never the URL."""
    tree = ast.parse((REPO / module).read_text(encoding="utf-8"))
    offenders = [f"line {c.lineno}: {s}" for c in _logging_calls(tree) for s in _unsafe_args(c)]
    assert not offenders, f"{module} logs a token-bearing URL:\n  " + "\n  ".join(offenders)


def test_scrub_removes_a_token_from_a_real_playwright_error():
    """End to end on the renderer's own scrub, with the shape that actually leaked."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("cr_app_scrub", RENDERER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    token = "aVeryRealLookingRenderToken12345"
    raw = ('TimeoutError: Page.goto: Timeout 21000ms exceeded.\nCall log:\nnavigating to '
           f'"https://uctintelligence.com/r/chart?sym=FIZZ&tf=D&token={token}", waiting until "load"')
    assert token in raw, "control: the fixture carries the token"
    assert token not in mod.scrub(raw)
    assert "/r/chart" in mod.scrub(raw), "scrub must keep the path — it is how a render is diagnosed"
