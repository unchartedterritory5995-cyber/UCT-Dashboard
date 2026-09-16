"""R56 — the persisted-runs root resolves onto the VOLUME, and can never be CWD-relative again.

⛔⛔ THE FAILURE THIS GUARDS, and it is not "a wrong directory". `reconcile.DEFAULT_ROOT` was
`pathlib.Path("data") / "wisdom" / "gate-runs"` — a bare CWD-relative literal with no override and
no way for the chain to pass one (`chain.py` calls every step as `fn(ctx)`). On the pod the CWD is
`/app`, so it resolved to `/app/data/wisdom/gate-runs`: an EPHEMERAL IMAGE LAYER, destroyed on
every redeploy, and excluded from the image by `.gitignore`'s `data/` in the first place.

⭐ `MIN_RUNS = 3` needs three passes to COEXIST. Under the old default a chain-side N-pass would
have accumulated nothing, forever, while every chain step reported `ok` — a silent no-op wearing
a success. That is why this file exists and why the CWD mutation below is the load-bearing one.

⛔ And there were TWO definitions of the path — one in the module that WRITES runs and one in the
module that DISCOVERS them. Two authorities over one value is how a writer and a reader come to
point at different directories with both reporting success.
"""
from __future__ import annotations

import ast
import importlib
import pathlib
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))


@pytest.fixture()
def reconcile(monkeypatch):
    from api.services.wisdom.extract import reconcile as mod

    for env in (mod.GATE_RUNS_DIR_ENV, "DATA_DIR"):
        monkeypatch.delenv(env, raising=False)
    return mod


# ── resolution ───────────────────────────────────────────────────────────────

def test_the_default_derives_from_DATA_DIR_and_is_anchored(reconcile, monkeypatch):
    """⛔ ANCHORED, tested via `.root` — NOT via `is_absolute()`.

    ⚰️ The first version of this test asserted `got.is_absolute()` and went RED on a correct
    implementation: on Windows a path needs a DRIVE to be absolute, so `WindowsPath('/data/...')`
    reports False even though the same string is absolute on the Linux pod this is about. That is
    the instrument reporting a property of the box it runs on as a property of the code. `.root`
    is truthy for `/data/...` on both platforms and empty for a bare `data/...`, which is exactly
    the distinction the ruling cares about.
    """
    monkeypatch.setenv("DATA_DIR", "/data")
    got = reconcile.gate_runs_root()
    assert got == pathlib.Path("/data") / "wisdom" / "gate-runs"
    assert got.root, "the root must never be relative to a working directory"
    # control: the predicate can tell the two apart
    assert not pathlib.Path("data/wisdom/gate-runs").root


def test_DATA_DIR_defaults_to_the_volume_when_unset(reconcile, monkeypatch):
    monkeypatch.delenv("DATA_DIR", raising=False)
    assert reconcile.gate_runs_root() == pathlib.Path("/data") / "wisdom" / "gate-runs"


def test_the_env_override_wins(reconcile, monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", "/data")
    monkeypatch.setenv(reconcile.GATE_RUNS_DIR_ENV, str(tmp_path / "elsewhere"))
    assert reconcile.gate_runs_root() == tmp_path / "elsewhere"


def test_a_blank_override_is_not_an_override(reconcile, monkeypatch):
    """⛔ `WISDOM_GATE_RUNS_DIR=""` must not resolve the root to the current directory."""
    monkeypatch.setenv("DATA_DIR", "/data")
    monkeypatch.setenv(reconcile.GATE_RUNS_DIR_ENV, "   ")
    assert reconcile.gate_runs_root() == pathlib.Path("/data") / "wisdom" / "gate-runs"


def test_resolution_happens_per_call_not_at_import(reconcile, monkeypatch, tmp_path):
    """⛔⛔ THE SECOND-ORDER TRAP. A module-level constant, or a default ARGUMENT bound to one,
    freezes the environment as it stood at import — so a rehearsal that pins DATA_DIR afterwards
    is silently ignored. That is the same bug as the CWD literal in different clothes."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "first"))
    first = reconcile.gate_runs_root()
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "second"))
    assert reconcile.gate_runs_root() != first, "the root was frozen at import"

    import inspect

    sig = inspect.signature(reconcile.score_silently)
    assert sig.parameters["root"].default is None, (
        "score_silently's root is a bound default again — it must resolve per call")


# ── the CWD literal can never come back ──────────────────────────────────────

def _string_constants(path: pathlib.Path) -> list:
    """Every string literal in the module that is NOT a docstring or a comment.

    ⛔ CODE, NEVER PROSE — this file's own explanation of the bug contains the very literal it
    hunts, so a text scan would match the explanation and be "fixed" by deleting it.
    """
    tree = ast.parse(path.read_text(encoding="utf-8"))
    docs = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            if ast.get_docstring(node, clean=False) is not None:
                docs.add(id(node.body[0].value))
    return [n for n in ast.walk(tree)
            if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in docs]


def test_no_module_builds_the_root_from_a_bare_relative_literal():
    """⛔⛔ THE LOAD-BEARING ONE. Fails if `Path("data") / "wisdom" / ...` returns anywhere."""
    for rel in ("api/services/wisdom/extract/reconcile.py", "tools/wisdom/gate_records.py"):
        path = REPO / rel
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            fn = node.func
            name = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", "")
            if name != "Path" or not node.args:
                continue
            first = node.args[0]
            if isinstance(first, ast.Constant) and first.value == "data":
                pytest.fail(f'{rel}:{node.lineno} builds a path from a bare relative "data" — '
                            "that is the /app/data defect returning")


def test_the_root_has_exactly_one_definition():
    """⛔ Two authorities over one path is how the writer and the reader diverge in silence."""
    src = (REPO / "tools" / "wisdom" / "gate_records.py").read_text(encoding="utf-8")
    assert "DEFAULT_ROOT" not in src, "gate_records defines a second root again"
    from api.services.wisdom.extract import reconcile as mod
    assert not hasattr(mod, "DEFAULT_ROOT"), (
        "reconcile.DEFAULT_ROOT is back as a constant — it binds the environment at import")


def test_the_pc_tools_local_root_is_absolute_and_repo_anchored():
    """The PC-side tool deliberately does NOT use the chain root — but it must still be absolute."""
    sys.path.insert(0, str(REPO / "tools" / "wisdom"))
    gate_records = importlib.import_module("gate_records")
    assert gate_records.LOCAL_ROOT.is_absolute()
    assert gate_records.LOCAL_ROOT == REPO / "data" / "wisdom" / "gate-runs"


# ── the chain and the discovery agree ────────────────────────────────────────

def test_discovery_reads_the_same_root_the_chain_resolves(reconcile, monkeypatch, tmp_path):
    """A writer and a reader pointing at different directories both report success."""
    root = tmp_path / "runs"
    monkeypatch.setenv(reconcile.GATE_RUNS_DIR_ENV, str(root))
    for rid in ("20260915T000001Z", "20260915T000002Z"):
        d = root / rid
        d.mkdir(parents=True)
        (d / reconcile.RECORDS_FILE).write_text("", encoding="utf-8")
    assert reconcile.discover(reconcile.gate_runs_root()) == ["20260915T000001Z", "20260915T000002Z"]


def test_score_silently_skips_cleanly_when_the_volume_root_is_empty(reconcile, monkeypatch, tmp_path):
    """⭐ What production does tonight: a clean skip naming the shortfall, never a failure."""
    monkeypatch.setenv(reconcile.GATE_RUNS_DIR_ENV, str(tmp_path / "absent"))
    out = reconcile.score_silently(object())
    assert "skipped" in out and out["runs"] == 0
    assert "need 3" in out["skipped"]
