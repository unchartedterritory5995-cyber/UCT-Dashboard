"""The 13A walk's sandbox is set up to reach its graceful SHUTDOWN checkpoint (wave 14 OPS).

Two of 13A's three walks never wrote the launcher's shutdown checkpoint (`FORCED after 120 s
without a graceful exit`; docs/notebook/wave13-13a.md section 7). The change is contained in the
walk tool: the sandbox env 13X already used (provider keys blanked) plus the logo prewarm's own
off flag, and a longer, recorded stop grace. These rails keep it honest:

  * every env name the walk sets has a REAL read site in api/ -- an invented kill switch is
    indistinguishable from a working one (CLAUDE.md, the 2026-09-08 sandbox incident);
  * the stop grace actually reaches `Sandbox.stop` (an argparse default nobody passes is decor).
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
WALK = REPO / "tools" / "notebook_w13a_plan_grade_walk.py"


def _sandbox_env() -> dict:
    tree = ast.parse(WALK.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "SANDBOX_ENV" for t in node.targets):
            return ast.literal_eval(node.value)
    raise AssertionError("SANDBOX_ENV not found at module level")


def _read_sites(name: str) -> list[str]:
    pat = re.compile(r"""(environ\.get|getenv|environ\[)\(?\s*["']%s["']""" % re.escape(name))
    hits = []
    for p in (REPO / "api").rglob("*.py"):
        if pat.search(p.read_text(encoding="utf-8", errors="replace")):
            hits.append(str(p.relative_to(REPO)))
    return hits


def test_every_sandbox_env_name_has_a_real_read_site():
    env = _sandbox_env()
    assert "TICKER_LOGOS_PREWARM_DISABLED" in env and env["TICKER_LOGOS_PREWARM_DISABLED"] == "1"
    missing = [k for k in env if not _read_sites(k)]
    assert not missing, f"names nothing in api/ reads (invented flags): {missing}"


def test_the_read_site_search_can_say_no_CONTROL():
    assert _read_sites("UCT_NO_SUCH_FLAG_W14") == []
    assert _read_sites("TICKER_LOGOS_PREWARM_DISABLED"), "control: a known name must be found"


def test_the_stop_grace_reaches_Sandbox_stop():
    src = WALK.read_text(encoding="utf-8")
    assert re.search(r"sb\.stop\(\s*grace_s\s*=\s*args\.stop_grace_s\s*\)", src)
    assert "--stop-grace-s" in src
    assert "os.environ.update(SANDBOX_ENV)" in src
    # applied BEFORE the sandbox starts, or the Popen never inherits it
    assert src.index("os.environ.update(SANDBOX_ENV)") < src.index("sb.start()")
