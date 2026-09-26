"""Seam S8-1 (wave 8) -- ONE parse for every Notebook capability flag.

⚰️ WHY THIS FILE EXISTS. Before wave 8 the same question -- "is this Notebook
gate on?" -- had THREE answers in the server:

  * the auth payload (`auth._notebook_flags`) accepted `1/true/yes/on`;
  * `note_shares.enabled()` accepted `"1"` ONLY;
  * writing help carried a third copy of the truthy set.

Put `J2_SHARE_LINKS_ENABLED` on the payload with the old parse and a value of
`true` would show a member a Share button whose every request answered 404: the
payload said ON and the route said OFF, for the same variable, in the same
process. `api/services/notebook_flags.flag_on` is now the one parse, and this
file is what keeps it the only one.

THREE RAILS, and they fail for different reasons:

  (a) NO SECOND READ. By AST over every tree a deployed gate can live in, no
      `os.environ.get` / `os.getenv` / `os.environ[...]` names a NOTEBOOK_FLAGS
      variable -- directly or through a module-level constant. A second read is
      a second parse, whatever it looks like on the day it is written.
  (b) THE PAYLOAD IS THE GATE. For every flag that has a server gate, across a
      value table that includes the spellings the old parses disagreed on, the
      payload value equals the gate's answer AND both equal the declared truth
      table (so the rail is not satisfied by two sides agreeing on a wrong value).
  (c) `flag_on` IS ONLY FOR PAYLOAD FLAGS. Every literal `flag_on("NAME", ...)`
      call names a NOTEBOOK_FLAGS key. The feature-flag index finds these gates
      through that TABLE; a `flag_on` read of a name outside it would be a gate
      the index cannot see -- the "fifth form" hole
      (`tests/test_notebook_flag_table_form.py`) reopened by a new idiom.

Each derivation carries a non-vacuity control (rule 14): a scan that returns
nothing passes every assertion over it.

⛔ D-B9: `J2_SHARE_LINKS_ENABLED` and `NOTEBOOK_PUBLISH_ENABLED` stay OFF. The
default-OFF assertions below are part of that ruling, not decoration.
"""
from __future__ import annotations

import ast
import os
from pathlib import Path

import pytest

from api.routers import auth as auth_router
from api.services import feature_flag_index as ffi
from api.services import notebook_flags
from api.services.journal_two import note_shares
from api.services.journal_two import writing_help

REPO = Path(__file__).resolve().parents[1]
ONE_PARSE = "api/services/notebook_flags.py"

# The three flags seam S8-1 put on the payload (wave 8). ⛔ Named here only to
# pin THEIR defaults (D-B9); every other assertion iterates NOTEBOOK_FLAGS.
WAVE8_FLAGS = ("J2_SHARE_LINKS_ENABLED", "NOTEBOOK_PUBLISH_ENABLED", "NOTEBOOK_ONBOARDING_ENABLED")

# The value table: the spellings the old parses disagreed on, plus the typo that
# must take the default. ⛔ "true"/"TRUE"/"yes"/"on" read ON on the payload and
# OFF on the old `== "1"` share gate -- that disagreement is this file's reason.
VALUES = (None, "", "0", "1", "true", "TRUE", "yes", "on", "off", "flase", " 1 ")
_ON = {"1", "true", "yes", "on"}
_OFF = {"0", "false", "no", "off"}


def expected(raw, default: bool) -> bool:
    """The declared truth table, written out rather than imported from the code
    under test -- a rail that asks `flag_on` what `flag_on` should say is a
    mirror, not a rail."""
    if raw is None:
        return default
    v = raw.strip().lower()
    if v in _OFF:
        return False
    if v in _ON:
        return True
    return default   # ⛔ unrecognised takes the DEFAULT, never its opposite


# ── the one parse, on its own ────────────────────────────────────────────────

@pytest.mark.parametrize("raw", VALUES)
@pytest.mark.parametrize("default", [True, False])
def test_flag_on_is_the_declared_truth_table(monkeypatch, raw, default):
    name = "NOTEBOOK_FLAG_PARSE_PROBE_ON"
    if raw is None:
        monkeypatch.delenv(name, raising=False)
    else:
        monkeypatch.setenv(name, raw)
    assert notebook_flags.flag_on(name, default) is expected(raw, default)


def test_flag_on_is_read_PER_CALL_not_captured(monkeypatch):
    name = "NOTEBOOK_FLAG_PARSE_PROBE_ON"
    monkeypatch.setenv(name, "1")
    assert notebook_flags.flag_on(name, False) is True
    monkeypatch.setenv(name, "0")                      # no reimport between these
    assert notebook_flags.flag_on(name, False) is False


# ── (b) the payload is the gate ─────────────────────────────────────────────

def _server_gates() -> dict:
    """{env_name: zero-arg callable} -- the SERVER's own answer for each flag.

    ⛔ The routes' real gate functions where one exists, so a route that grows a
    private parse goes red here. Publish and onboarding have no route yet (lanes
    8B/8C build them, and their briefs require `flag_on(<name>, False)`); until
    then their gate IS that call, and the truth-table half of (b) is what keeps
    the comparison from being a mirror.
    """
    return {
        "J2_SHARE_LINKS_ENABLED": note_shares.enabled,
        "NOTEBOOK_WRITING_HELP_ENABLED": writing_help.writing_help_enabled,
        "NOTEBOOK_PUBLISH_ENABLED": lambda: notebook_flags.flag_on("NOTEBOOK_PUBLISH_ENABLED", False),
        "NOTEBOOK_ONBOARDING_ENABLED": lambda: notebook_flags.flag_on("NOTEBOOK_ONBOARDING_ENABLED", False),
    }


def test_the_wave8_flags_are_on_the_table_and_default_OFF():
    # ⛔ D-B9: nothing S8-1 writes may default either sharing gate on. Onboarding
    # is an enablement gate over a dark feature for the same reason.
    for name in WAVE8_FLAGS:
        assert name in auth_router.NOTEBOOK_FLAGS, f"{name} is not on the payload table"
        assert auth_router.NOTEBOOK_FLAGS[name] is False, f"{name} must default OFF (D-B9)"
    # Every gate compared below is a real table row (a typo'd name would be skipped).
    assert set(_server_gates()) <= set(auth_router.NOTEBOOK_FLAGS)


@pytest.mark.parametrize("raw", VALUES)
@pytest.mark.parametrize("env_name", sorted(_server_gates()))
def test_the_payload_value_EQUALS_the_server_gate(monkeypatch, env_name, raw):
    if raw is None:
        monkeypatch.delenv(env_name, raising=False)
    else:
        monkeypatch.setenv(env_name, raw)
    key = auth_router._notebook_flag_key(env_name)
    payload = auth_router._access_payload({"role": "member"}, "free")[key]
    gate = _server_gates()[env_name]()
    want = expected(raw, auth_router.NOTEBOOK_FLAGS[env_name])
    assert (payload, gate) == (want, want), (
        f"{env_name}={raw!r}: payload says {payload}, the route's gate says {gate}, "
        f"the table says {want}. A member would see a door the server refuses (or the reverse).")


# ── (a) no second read ──────────────────────────────────────────────────────

def _direct_reads(tree: ast.AST) -> list[tuple[int, str]]:
    """Every env read in `tree` whose NAME is visible -- a literal, or a
    module-level constant. Reuses the feature-flag index's own reader
    (`_env_name`), so this rail and the ledger can never disagree about what a
    read looks like."""
    os_names = ffi._os_aliases(tree)
    consts = ffi._module_str_consts(tree)
    out = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.Call, ast.Subscript)):
            name = ffi._env_name(node, os_names, consts)
            if name:
                out.append((node.lineno, name))
    return out


def _scan(roots) -> dict[str, list[tuple[int, str]]]:
    found = {}
    for root in roots:
        for p in sorted(Path(root).rglob("*.py")):
            if "__pycache__" in p.parts:
                continue
            try:
                tree = ast.parse(p.read_text(encoding="utf-8", errors="ignore"))
            except SyntaxError:
                continue
            reads = _direct_reads(tree)
            if reads:
                found[p.relative_to(REPO).as_posix()] = reads
    return found


def test_NO_notebook_flag_is_read_outside_the_one_parse():
    names = set(auth_router.NOTEBOOK_FLAGS)
    reads = _scan(ffi.repo_roots(REPO))
    # ⭐ NON-VACUITY: the scan saw real reads, including one this file KNOWS is
    # there (auth.py reads the hub kill switch by literal). An empty walk passes
    # the assertion below over nothing.
    assert len(reads) > 50, f"the env-read scan collapsed to {len(reads)} files"
    assert any(n == "HUB_PREVIEW_ENABLED" for _, n in reads.get("api/routers/auth.py", [])), (
        "the scan no longer sees auth.py's literal HUB_PREVIEW_ENABLED read -- the reader is broken")
    offenders = sorted(
        f"{path}:{line}  {name}"
        for path, rs in reads.items() if path != ONE_PARSE
        for line, name in rs if name in names)
    assert offenders == [], (
        "these read a Notebook capability flag with their OWN parse. Call "
        "api.services.notebook_flags.flag_on(<name>, <default>) instead -- a second "
        "parse is how the payload and the route came to disagree:\n  " + "\n  ".join(offenders))


def test_CONTROL_the_reader_sees_every_shape_of_a_second_read():
    """A reader that misses a shape passes the rail above for that shape forever.
    Each form the index knows, planted, must be seen."""
    src = (
        "import os\n"
        "import os as _os\n"
        "GATE = 'NOTEBOOK_WRITING_HELP_ENABLED'\n"
        "def a(): return os.environ.get('J2_SHARE_LINKS_ENABLED', '0') == '1'\n"
        "def b(): return os.environ.get(GATE)\n"
        "def c(): return _os.getenv('NOTEBOOK_PUBLISH_ENABLED')\n"
        "def d(): return os.environ['NOTEBOOK_ONBOARDING_ENABLED']\n"
        "def e(): return os.environ.get('SOMETHING_ELSE_ENABLED')\n"
    )
    seen = {name for _, name in _direct_reads(ast.parse(src))}
    assert {"J2_SHARE_LINKS_ENABLED", "NOTEBOOK_WRITING_HELP_ENABLED",
            "NOTEBOOK_PUBLISH_ENABLED", "NOTEBOOK_ONBOARDING_ENABLED"} <= seen
    # …and the one-parse itself reads through a PARAMETER, which is invisible here
    # by construction -- that is what lets it be the only reader.
    one = ast.parse((REPO / ONE_PARSE).read_text(encoding="utf-8"))
    assert not {n for _, n in _direct_reads(one)} & set(auth_router.NOTEBOOK_FLAGS)


# ── (c) flag_on is only for payload flags ───────────────────────────────────

def _flag_on_literals(tree: ast.AST) -> list[tuple[int, str]]:
    out = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and node.args):
            continue
        f = node.func
        called = f.attr if isinstance(f, ast.Attribute) else (f.id if isinstance(f, ast.Name) else None)
        a0 = node.args[0]
        if called == "flag_on" and isinstance(a0, ast.Constant) and isinstance(a0.value, str):
            out.append((node.lineno, a0.value))
    return out


def test_every_flag_on_call_names_a_payload_flag():
    names = set(auth_router.NOTEBOOK_FLAGS)
    calls = {}
    for root in ffi.repo_roots(REPO):
        for p in sorted(Path(root).rglob("*.py")):
            if "__pycache__" in p.parts:
                continue
            try:
                tree = ast.parse(p.read_text(encoding="utf-8", errors="ignore"))
            except SyntaxError:
                continue
            for line, name in _flag_on_literals(tree):
                calls.setdefault(p.relative_to(REPO).as_posix(), []).append((line, name))
    # ⭐ NON-VACUITY: the share gate reads through flag_on, and this scan must see it.
    assert ("J2_SHARE_LINKS_ENABLED" in {n for _, n in calls.get(
        "api/services/journal_two/note_shares.py", [])}), (
        f"the flag_on scan did not see note_shares' gate; it saw {sorted(calls)}")
    strays = sorted(f"{path}:{line}  {name}" for path, cs in calls.items()
                    for line, name in cs if name not in names)
    assert strays == [], (
        "flag_on() reads a name that is not in auth.NOTEBOOK_FLAGS -- a gate the "
        "feature-flag index cannot see and the payload does not carry. Add the row "
        "to NOTEBOOK_FLAGS (and the ledger), or read it another way:\n  " + "\n  ".join(strays))


def test_CONTROL_the_flag_on_scan_sees_both_call_shapes():
    src = (
        "from api.services.notebook_flags import flag_on\n"
        "from api.services import notebook_flags\n"
        "a = flag_on('NOT_A_PAYLOAD_FLAG_ENABLED', False)\n"
        "b = notebook_flags.flag_on('J2_SHARE_LINKS_ENABLED', False)\n"
    )
    assert [n for _, n in _flag_on_literals(ast.parse(src))] == [
        "NOT_A_PAYLOAD_FLAG_ENABLED", "J2_SHARE_LINKS_ENABLED"]
