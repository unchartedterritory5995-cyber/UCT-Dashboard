"""STANDING RAIL: production code does not call the Schwab API or import a Schwab client.

Schwab's market-data API was retired from the product on 2026-11-17 by the owner's instruction
(verbatim: "Move it, fix the status and remove schwab from everything"). Its saved login had
expired: the web log carried "Token refresh failed ... Refresh token is invalid, expired or
revoked" every minute while GET /api/schwab/status still answered "Connected". Every feature that
read Schwab reads Massive (or its next existing source) now, and the client, the token handling,
the login routes and the two source switches are gone.

This file fails if any of it comes back. "Production code" is every non-test file under `api/`
and `app/src/`. What it looks for, in the code (comments and docstrings are prose and never count):

  1. a module named `schwab_*` on disk, or an import of one;
  2. the Schwab API host in a string;
  3. a `SCHWAB_*` environment variable name;
  4. the vendor key "schwab" used as a value (a source mode, a `src` label, a provider lookup);
  5. a route that operates a Schwab login.

THE ALLOW-LIST IS SHORT AND EACH ENTRY SAYS WHY:

  * `api/schwab_router.py` and the URL prefix `/api/schwab/*`: HISTORICAL NAMES. The Options Flow
    page (partner-owned) and saved clients call those paths; nothing under them reads Schwab.
  * `SCHWAB_NARRATIVE_MODEL`, `SCHWAB_NARRATIVE_COST_CAP_DAILY`, `SCHWAB_NARRATIVE_LLM_TIMEOUT_SECS`:
    settings of the AI market summary at /api/schwab/market-narrative, named after the URL. They
    configure an Anthropic call, not Schwab; renaming one would drop a value set in production.
  * `api/services/provider_licensing_class.py`: the four RETIRED register rows keyed ("schwab", ...),
    kept as the historical record of each data class's licensing class.
  * the member brokerage code (`api/services/journal_two/`, `api/routers/broker_sync.py`): there
    "Schwab" is a MEMBER'S BROKER (SnapTrade sync, CSV import presets), not this app's data vendor.
  * `api/services/uct_agent/marketdata/flow_top_picks.py`: it READS the `src` label of Top Flow daily
    prices recorded before November 2026 (absent or "schwab" = recorded from Schwab then). One file,
    by its full path; the other Agent adapters are not allowed the key.

The checker is a pure function over {path: source}, so the rails at the bottom drive it with
sources that MUST fail. A checker that cannot fail proves nothing.
"""
from __future__ import annotations

import ast
import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parents[1]

HOST = "schwab" + "api.com"                      # built by concatenation so this file is not a hit
ALLOWED_MODULE = "schwab_router"
ALLOWED_ENV = frozenset({"SCHWAB_NARRATIVE_MODEL", "SCHWAB_NARRATIVE_COST_CAP_DAILY",
                         "SCHWAB_NARRATIVE_LLM_TIMEOUT_SECS"})
VENDOR_KEY_ALLOWED = ("api/services/provider_licensing_class.py",     # the retired register rows
                      "api/schwab_router.py",                         # the router's historical tag
                      "api/services/journal_two/",                    # a member's broker, not our vendor
                      # reads the `src` LABEL of Top Flow prices recorded before November 2026 (absent or
                      # "schwab" = recorded from Schwab then); it calls nothing
                      "api/services/uct_agent/marketdata/flow_top_picks.py",
                      "api/routers/broker_sync.py")
LOGIN_ROUTE = re.compile(r"/api/schwab/(login|callback|refresh|status)\b|schwab-token")
_ENV_NAME = re.compile(r"SCHWAB_[A-Z0-9_]+\Z")
_MODULE = re.compile(r"(?:^|\.)(schwab_\w+)")
_DOTTED_MODULE = re.compile(r"api(?:\.\w+)*\.(schwab_\w+)")
_JS_SUFFIXES = (".js", ".jsx", ".ts", ".tsx", ".mjs")


def _is_test(rel: str) -> bool:
    name = rel.rsplit("/", 1)[-1]
    return (name.startswith("test_") or name == "conftest.py" or ".test." in name or ".spec." in name
            or "/tests/" in f"/{rel}" or "/__tests__/" in rel or "/__fixtures__/" in rel
            or "/__mocks__/" in rel)


def production_sources() -> dict:
    out = {}
    for root, suffixes in (("api", (".py",)), ("app/src", _JS_SUFFIXES)):
        for path in (REPO / root).rglob("*"):
            rel = path.relative_to(REPO).as_posix()
            if (not path.is_file() or path.suffix not in suffixes or "node_modules" in rel
                    or "__pycache__" in rel or _is_test(rel)):
                continue
            out[rel] = path.read_text(encoding="utf-8", errors="replace")
    return out


def _docstring_nodes(tree: ast.AST) -> set:
    """ids of the Constant nodes that are bare string statements (docstrings, prose)."""
    return {id(n.value) for n in ast.walk(tree)
            if isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant) and isinstance(n.value.value, str)}


def python_violations(rel: str, src: str) -> list:
    found = []
    name = rel.rsplit("/", 1)[-1]
    if name.startswith("schwab_") and name != f"{ALLOWED_MODULE}.py":
        found.append(f"{rel}: a Schwab module exists again")
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return found + [f"{rel}: could not be parsed"]
    prose = _docstring_nodes(tree)
    for node in ast.walk(tree):
        modules = []
        if isinstance(node, ast.Import):
            modules = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ""
            modules = [base] + [f"{base}.{a.name}" for a in node.names]
        for mod in modules:
            for hit in _MODULE.findall(mod):
                if hit != ALLOWED_MODULE:
                    found.append(f"{rel}:{node.lineno}: imports {mod} (a Schwab client)")
        if not (isinstance(node, ast.Constant) and isinstance(node.value, str)) or id(node) in prose:
            continue
        text = node.value
        if HOST in text.lower():
            found.append(f"{rel}:{node.lineno}: the Schwab API host is in a string")
        if _ENV_NAME.match(text) and text not in ALLOWED_ENV:
            found.append(f"{rel}:{node.lineno}: reads or names the environment variable {text}")
        if text.lower() == "schwab" and not rel.startswith(VENDOR_KEY_ALLOWED):
            found.append(f"{rel}:{node.lineno}: uses the vendor key 'schwab' as a value")
        if LOGIN_ROUTE.search(text) or (rel.endswith(f"{ALLOWED_MODULE}.py")
                                        and text in ("/login", "/callback", "/refresh", "/status")):
            found.append(f"{rel}:{node.lineno}: a Schwab login route ({text})")
        dotted = _DOTTED_MODULE.fullmatch(text)      # importlib.import_module("api.schwab_service")
        if dotted and dotted.group(1) != ALLOWED_MODULE:
            found.append(f"{rel}:{node.lineno}: names the module {text} (a Schwab client)")
    return found


_JS_COMMENT = re.compile(r"/\*.*?\*/|(?<![:\"'`\\])//[^\n]*", re.S)


def js_violations(rel: str, src: str) -> list:
    code = _JS_COMMENT.sub("", src)
    found = []
    if HOST in code.lower():
        found.append(f"{rel}: the Schwab API host is in the code")
    for m in LOGIN_ROUTE.finditer(code):
        found.append(f"{rel}: calls a Schwab login route ({m.group(0)})")
    return found


def violations(sources: dict) -> list:
    found = []
    for rel, src in sorted(sources.items()):
        found += python_violations(rel, src) if rel.endswith(".py") else js_violations(rel, src)
    return found


# ── the rail ──────────────────────────────────────────────────────────────────

def test_no_production_code_calls_schwab_or_imports_a_schwab_client():
    sources = production_sources()
    assert len(sources) > 1000, len(sources)                     # non-vacuity: the tree was really read
    assert "api/schwab_router.py" in sources and "api/gex_service.py" in sources
    assert any(rel.startswith("app/src/pages/") for rel in sources)
    found = violations(sources)
    assert not found, (
        "Schwab was retired from the product on 2026-11-17 (owner: \"Move it, fix the status and remove "
        "schwab from everything\"). These bring it back. Read the options data from Massive instead "
        "(api/massive_oi_snapshots.py, api/services/flow_market_data.py); if this is a reader of entries "
        "recorded from Schwab in the past, add its path to VENDOR_KEY_ALLOWED with the reason:\n  "
        + "\n  ".join(found))


def test_the_schwab_files_are_gone_and_stay_unimportable():
    import importlib.util
    for rel in ("api/schwab_service.py", "api/schwab_token_replica.py",
                "api/services/schwab_token_push.py", "api/services/schwab_oauth_state.py"):
        assert not (REPO / rel).exists(), rel
    for mod in ("api.schwab_service", "api.schwab_token_replica",
                "api.services.schwab_token_push", "api.services.schwab_oauth_state"):
        assert importlib.util.find_spec(mod) is None, mod
    assert importlib.util.find_spec("api.schwab_router") is not None     # control: a present sibling is found


def test_the_historical_prefix_serves_data_routes_and_no_login_route():
    from api.schwab_router import router
    paths = {r.path for r in router.routes}
    assert not paths & {"/api/schwab/login", "/api/schwab/callback", "/api/schwab/refresh", "/api/schwab/status"}
    # the paths the Options Flow page, the Dark Pool page and saved clients call are all still served
    assert {"/api/schwab/options-quotes", "/api/schwab/options-quote", "/api/schwab/market-summary",
            "/api/schwab/contract-history", "/api/schwab/mktcap-batch", "/api/schwab/ytd-performance",
            "/api/schwab/oi-change-batch", "/api/schwab/backfill-contract", "/api/schwab/market-narrative",
            "/api/schwab/chart-ohlc", "/api/schwab/chart-bounds", "/api/schwab/chart-proxy",
            "/api/schwab/earnings", "/api/schwab/track-contracts", "/api/schwab/snapshot-now"} <= paths
    head = (REPO / "api" / "schwab_router.py").read_text(encoding="utf-8")[:1200]
    assert "THE NAME IS HISTORICAL. NOTHING UNDER THIS PREFIX READS SCHWAB." in head
    flow_router = (REPO / "api" / "flow_router.py").read_text(encoding="utf-8")
    assert "schwab" not in flow_router.lower()                           # the token install + status routes


def test_the_jobs_that_operated_the_login_are_gone_from_startup():
    main = (REPO / "api" / "main.py").read_text(encoding="utf-8")
    for needle in ("start_auto_refresh", "schwab_token_replica_push", "schwab_token_push"):
        assert needle not in main, needle
    assert "from api.schwab_router import router as schwab_router" in main      # the data routes stay mounted
    worker = (REPO / "api" / "flow_worker_main.py").read_text(encoding="utf-8")
    assert "if _massive_oi.MASSIVE_API_KEY:" in worker                          # the OI cron's gate, was SCHWAB_APP_KEY
    assert 'getenv("SCHWAB_APP_KEY")' not in worker


def test_no_frontend_screen_reads_a_schwab_connection():
    front = {rel: src for rel, src in production_sources().items() if rel.startswith("app/src/")}
    assert len(front) > 500
    callers = sorted(rel for rel, src in front.items() if "/api/schwab/" in src)
    assert "app/src/pages/OptionsFlow.jsx" in callers                    # control: the scan sees the data calls
    assert not [rel for rel, src in front.items() if LOGIN_ROUTE.search(_JS_COMMENT.sub("", src))]


# ── the checker can fail ──────────────────────────────────────────────────────

BAD_PYTHON = {
    "from-import of the client": "from api import schwab_service\n",
    "import of the client": "import api.schwab_service as schwab\n",
    "from the client import a name": "from api.schwab_service import get_batch_option_quotes\n",
    "lazy import inside a function": "async def f():\n    from api.services import schwab_token_push\n",
    "a module name handed to importlib": "import importlib\nm = importlib.import_module('api.schwab_service')\n",
    "the API host": f"URL = 'https://api.{HOST}/marketdata/v1/chains'\n",
    "the API host in an f-string": f"def u(s):\n    return f'https://api.{HOST}/v1/{{s}}'\n",
    "an environment variable": "import os\nKEY = os.getenv('SCHWAB_APP_KEY', '')\n",
    "a refresh gate": "import os\nON = os.environ.get('SCHWAB_AUTO_REFRESH_ENABLED') == '1'\n",
    "a source mode": "SOURCES = ('massive', 'schwab')\n",
    "a src label": "entry = {'price': 1.0, 'src': 'schwab'}\n",
    "a login route": "PATH = '/api/schwab/login'\n",
    "the token route": "PATH = '/schwab-token/install'\n",
}


def test_the_checker_FAILS_on_every_way_schwab_could_come_back():
    for label, src in BAD_PYTHON.items():
        assert python_violations("api/some_module.py", src), label
    assert python_violations("api/schwab_service.py", "x = 1\n")                       # the file itself
    assert python_violations("api/services/schwab_quotes.py", "x = 1\n")
    assert python_violations("api/schwab_router.py", "@router.get('/status')\ndef s():\n    return {}\n")
    assert js_violations("app/src/pages/Settings.jsx", "fetch('/api/schwab/status').then(r => r.json())\n")
    assert js_violations("app/src/lib/x.js", f"const U = 'https://api.{HOST}/v1/oauth/token'\n")


def test_the_checker_PASSES_the_allow_list_and_prose_so_it_is_not_just_a_word_ban():
    ok = {
        "api/main.py": "from api.schwab_router import router as schwab_router\n",
        "api/schwab_router.py": ("import os\nMODEL = os.environ.get('SCHWAB_NARRATIVE_MODEL', 'x')\n"
                                 "router = APIRouter(prefix='/api/schwab', tags=['schwab'])\n"
                                 "@router.get('/market-summary')\ndef m():\n    return {}\n"),
        "api/services/provider_licensing_class.py": "ROWS = {('schwab', 'option_chains'): 'LA'}\n",
        "api/services/journal_two/csv_import.py": "PRESETS = {'schwab': 'Charles Schwab'}\n",
        "api/gex_service.py": ('"""Until 2026-11-17 this read Schwab /chains."""\n'
                               "# Schwab was retired; see api.schwab_service in git history\n"
                               "def to_schwab_shape(rows):\n    return rows\n"),
        "app/src/pages/OptionsFlow.jsx": ("// the old Schwab login lived at /api/schwab/status\n"
                                          "fetch('/api/schwab/options-quotes', {method: 'POST'})\n"),
    }
    assert violations(ok) == []
    # and the same vendor key outside the allow-list is caught
    assert python_violations("api/top_flow_tracker.py", "ROWS = {('schwab', 'option_chains'): 'LA'}\n")
