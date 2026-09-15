"""The four Wisdom ban rails (W1 §0.4a/b/d/i, Part 10; CONTRACTS §6.2).

STANDARD LIBRARY ONLY. core/bans.py is loaded by path and nothing from api.* is imported,
because .github/workflows/wisdom-rails.yml runs this file with nothing installed but
pytest (and --noconftest: the repo conftests import the product).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a Wisdom module importing the Substack publisher or a Sunday Scans publish/run/promo
   module, in any import form, or naming the saved Substack login or a drafts path;
2. a Wisdom module importing Journal / J2 / Notebook / broker-sync code, or naming their
   tables, paths or API;
3. any module under api/ or tools/wisdom other than the three owners reaching the
   owner-private store, by import, relative import, attribute, getattr or string;
4. a program branch whose diff (commits, working tree or untracked files) touches an
   off-limits path.
FOR EACH, THE CONTROLS: a banned name in a comment or a docstring is not a violation, a
planted one fails by path, and the real scan saw enough files (and the named sentinel
files) to count as a measurement. The diff rail's git plumbing is proven on a hermetic
repository, because an empty diff reads exactly like a clean branch.
"""
from __future__ import annotations

import ast
import importlib.util
import os
import pathlib
import shutil
import subprocess
import sys
import textwrap

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
BANS_PATH = REPO / "api" / "services" / "wisdom" / "core" / "bans.py"
CLI_PATH = REPO / "tools" / "wisdom" / "core_check_bans.py"


@pytest.fixture(scope="module")
def bans():
    spec = importlib.util.spec_from_file_location("wisdom_core_bans_under_test", BANS_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _tree(root: pathlib.Path, files: dict) -> pathlib.Path:
    for rel, body in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(textwrap.dedent(body), encoding="utf-8")
    return root


def _paths(result) -> set:
    return {v.path for v in result.violations}


# ── the rails themselves stay runnable in CI ─────────────────────────────────

@pytest.mark.parametrize("rel", [
    "api/services/wisdom/core/bans.py",
    "tools/wisdom/core_check_bans.py",
    "tools/wisdom/core_journal_exclusion_grep.py",
    "tests/test_wisdom_bans.py",
])
def test_the_rails_import_only_the_standard_library(rel):
    tree = ast.parse((REPO / rel).read_text(encoding="utf-8"))
    tops = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            tops.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            tops.add(node.module.split(".")[0])
    assert tops, f"{rel}: the import walk saw nothing"
    outside = tops - set(sys.stdlib_module_names) - {"pytest"}
    assert not outside, f"{rel} imports outside the standard library: {sorted(outside)}"


def test_the_string_exemption_is_exactly_the_ban_checks_and_they_exist(bans):
    assert bans.BAN_CHECK_FILES == {
        "api/services/wisdom/core/bans.py",
        "tools/wisdom/core_check_bans.py",
        "tools/wisdom/core_journal_exclusion_grep.py",
    }
    for rel in bans.BAN_CHECK_FILES:
        assert (REPO / rel).is_file(), rel


def test_an_exempt_ban_check_file_still_has_its_imports_checked(bans):
    planted = "import substack\nfrom api.services.journal_two import db\n"
    violations = bans.scan_source("tools/wisdom/core_check_bans.py", planted, ("substack", "journal"))
    assert {v.rail for v in violations} == {"substack", "journal"}


@pytest.mark.parametrize("rail", ["substack", "journal", "private_store"])
def test_the_real_repo_passes_and_the_scan_was_a_measurement(bans, rail):
    result = bans.run_source_rail(rail, REPO)
    floor, sentinels = bans.SCOPE_FLOORS[rail]
    assert result.inconclusive is None, result.inconclusive
    assert result.files_scanned >= floor
    assert not result.violations, "\n".join(v.render() for v in result.violations)


def test_an_unparseable_file_is_a_violation_not_a_pass(bans, tmp_path):
    root = _tree(tmp_path, {"api/services/wisdom/broken.py": "def (:\n"})
    result = bans.run_source_rail("journal", root, enforce_floor=False)
    assert _paths(result) == {"api/services/wisdom/broken.py"}


def test_a_scan_below_its_floor_is_inconclusive(bans, tmp_path):
    root = _tree(tmp_path, {"api/services/wisdom/only.py": "X = 1\n"})
    result = bans.run_source_rail("substack", root)
    assert result.violations == () and result.inconclusive
    text, code = bans.format_report([result])
    assert code == 2 and "INCONCLUSIVE" in text


# ── rail substack ────────────────────────────────────────────────────────────

SUBSTACK_PLANTED = {
    "import substack": "import substack\n",
    "import substack.client": "import substack.client\n",
    "from substack import Api": "from substack import Api\n",
    "from sunday_scan import publish": "from sunday_scan import publish\n",
    "import sunday_scan.run": "import sunday_scan.run\n",
    "from sunday_scan.promo import build": "from sunday_scan.promo import build\n",
    "from sunday_scan import *": "from sunday_scan import *\n",
    "importlib.import_module": "import importlib\nimportlib.import_module('sunday_scan.publish')\n",
    "__import__": "__import__('substack')\n",
    "saved login path": "LOGIN = 'C:/Users/owner/uct-sunday-scan/storage_state.json'\n",
    "drafts path": "DRAFTS = r'C:\\Users\\owner\\uct-sunday-scan\\sunday_scan\\drafts'\n",
}


@pytest.mark.parametrize("place", [
    "api/services/wisdom/sources/planted.py", "api/routers/wisdom_sources.py",
    "tools/wisdom/sources_planted.py", "tools/wisdom_planted.py",
])
@pytest.mark.parametrize("label", sorted(SUBSTACK_PLANTED))
def test_a_planted_substack_reach_fails_by_path(bans, tmp_path, place, label):
    root = _tree(tmp_path, {place: SUBSTACK_PLANTED[label]})
    result = bans.run_source_rail("substack", root, enforce_floor=False)
    assert result.files_scanned == 1
    assert _paths(result) == {place}, label


def test_substack_names_in_comments_docstrings_and_the_allowed_modules_pass(bans, tmp_path):
    body = '''\
        """Never `import substack`; never storage_state.json; never sunday_scan/drafts."""
        # import substack
        # from sunday_scan import publish
        from sunday_scan import prep_sheet, roster, boilerplate, corpus, etf_walk, facts


        class Reader:
            """from sunday_scan import promo"""

            def read(self):
                """storage_state.json"""
                return prep_sheet
        '''
    root = _tree(tmp_path, {"api/services/wisdom/sources/clean.py": body})
    result = bans.run_source_rail("substack", root, enforce_floor=False)
    assert result.files_scanned == 1 and result.violations == ()


def test_the_substack_rail_reads_only_program_paths(bans, tmp_path):
    root = _tree(tmp_path, {"api/services/substack_poller.py": "import substack\n",
                            "api/services/wisdom/x.py": "X = 1\n"})
    result = bans.run_source_rail("substack", root, enforce_floor=False)
    assert result.files_scanned == 1 and result.violations == ()


# ── rail journal ─────────────────────────────────────────────────────────────

JOURNAL_PLANTED = {
    "import journal_two": "import api.services.journal_two.db\n",
    "from journal_two import": "from api.services.journal_two import notes\n",
    "from services import journal_two": "from api.services import journal_two\n",
    "broker router": "from api.routers import broker_sync\n",
    "note sync router": "import api.routers.note_sync\n",
    "journal router": "from api.routers.journal_two import router\n",
    "journal service": "from api.services.journal_service import list_trades\n",
    "journal_insights": "import api.services.journal_insights\n",
    "notes_search": "from api.services.journal_two import notes_search\n",
    "relative journal_two": "from ...journal_two import db\n",
    "import_module broker": "import importlib\nimportlib.import_module('api.services.journal_two.broker.sync')\n",
    "j2 table": "SQL = 'SELECT * FROM j2_notes WHERE user_id = ?'\n",
    "broker table": "TABLE = 'j2_broker_activities'\n",
    "journal_entries": "SQL = 'select * from journal_entries'\n",
    "daily_journals": "TABLE = 'daily_journals'\n",
    "journal-2-0 path": "PAGE = 'app/src/pages/journal-2-0/NotebookTab.jsx'\n",
    "lib/offline path": "OFFLINE = 'app/src/pages/journal-2-0/lib/offline/outbox.js'\n",
    "j2 api": "URL = '/api/j2/notes'\n",
}


@pytest.mark.parametrize("label", sorted(JOURNAL_PLANTED))
def test_a_planted_journal_reach_fails_by_path(bans, tmp_path, label):
    place = "api/services/wisdom/extract/planted.py"
    root = _tree(tmp_path, {place: JOURNAL_PLANTED[label]})
    result = bans.run_source_rail("journal", root, enforce_floor=False)
    assert result.files_scanned == 1
    assert _paths(result) == {place}, label


def test_journal_names_in_comments_docstrings_and_near_misses_pass(bans, tmp_path):
    body = '''\
        """No Journal, J2, Notebook or broker data: never j2_notes, journal_entries, /api/j2."""
        # from api.services.journal_two import db
        # SQL = "SELECT * FROM j2_trades"
        NEAR_MISSES = ("journal of record", "tj2_x", "reconcile discord messages", "gap fills",
                       "api/services/journaling_notes_elsewhere", "/api/j2x")


        def f():
            """daily_journals and lib/offline are off limits."""
            return NEAR_MISSES
        '''
    root = _tree(tmp_path, {"api/services/wisdom/evals/clean.py": body})
    result = bans.run_source_rail("journal", root, enforce_floor=False)
    assert result.files_scanned == 1 and result.violations == ()


# ── rail private_store ───────────────────────────────────────────────────────

PRIVATE_FORMS = {
    "import": "import api.services.wisdom.core.private\n",
    "from package": "from api.services.wisdom.core import private\n",
    "from module": "from api.services.wisdom.core.private import get_private\n",
    "attribute": "from api.services.wisdom import core\ncore.private.get_private('r')\n",
    "aliased getattr": "import api.services.wisdom.core as c\ngetattr(c, 'private')\n",
    "import_module": "import importlib\nimportlib.import_module('api.services.wisdom.core.private')\n",
    "relative import_module": "import importlib\nimportlib.import_module('.private', package='api.services.wisdom.core')\n",
    "path string": "SPEC = 'api/services/wisdom/core/private.py'\n",
}
PRIVATE_PLACES = (
    "api/services/wisdom/publish/adapters/brainkb.py",
    "api/services/wisdom/publish/report.py",
    "api/services/ai_search_dossier.py",
    "api/routers/ai_search.py",
    "api/services/ticker_mentions.py",
    "api/services/wisdom/registry.py",
    "api/main.py",
    "tools/wisdom/publish_kb_sync.py",
)


@pytest.mark.parametrize("place", PRIVATE_PLACES)
@pytest.mark.parametrize("form", sorted(PRIVATE_FORMS))
def test_a_planted_private_store_reach_fails_by_path(bans, tmp_path, place, form):
    root = _tree(tmp_path, {place: PRIVATE_FORMS[form]})
    result = bans.run_source_rail("private_store", root, enforce_floor=False)
    assert _paths(result) == {place}, form


def test_relative_reaches_from_core_siblings_are_caught(bans, tmp_path):
    files = {
        "api/services/wisdom/core/vocab.py": "from . import private\n",
        "api/services/wisdom/core/entities.py": "from .private import put_private\n",
        "api/services/wisdom/evals/outcomes.py": "from ..core import private\n",
        "api/services/wisdom/evals/replay.py": "from .. import core\ncore.private.put_private('a', 'size_shares', 1, 'l')\n",
    }
    root = _tree(tmp_path, files)
    result = bans.run_source_rail("private_store", root, enforce_floor=False)
    assert _paths(result) == set(files)


def test_the_three_owners_may_reach_the_private_store(bans, tmp_path):
    body = "from api.services.wisdom.core import private\nfrom api.services.wisdom.core.private import put_private\n"
    root = _tree(tmp_path, {place: body for place in bans.PRIVATE_ALLOWED_IMPORTERS})
    result = bans.run_source_rail("private_store", root, enforce_floor=False)
    assert result.files_scanned == 3 and result.violations == ()


def test_the_real_router_does_reach_the_store_so_its_allowance_is_load_bearing(bans):
    text = (REPO / "api" / "routers" / "wisdom_core.py").read_text(encoding="utf-8")
    assert bans.scan_source("api/routers/wisdom_core.py", text, ("private_store",)) == []
    moved = bans.scan_source("api/routers/wisdom_publish.py", text, ("private_store",))
    assert moved and all(v.rail == "private_store" for v in moved)


def test_private_store_names_in_comments_and_docstrings_pass(bans, tmp_path):
    body = '''\
        """Must never import api.services.wisdom.core.private (see core/bans.py)."""
        # from api.services.wisdom.core import private
        from api.services.wisdom.core import store  # a sibling that is not the private store
        PRIVATE_NOTE = "the owner-private store lives elsewhere"
        '''
    root = _tree(tmp_path, {"api/services/wisdom/publish/report.py": body})
    result = bans.run_source_rail("private_store", root, enforce_floor=False)
    assert result.files_scanned == 1 and result.violations == ()


# ── rail offlimits ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("path", [
    "app/src/pages/journal-2-0/NotebookTab.jsx",
    "app/src/pages/journal-2-0/lib/offline/outbox.js",
    "app/lib/offline/sw.js",
    "lib/offline/queue.js",
    "app/src/pages/OptionsFlow.jsx",
    "app/src/pages/optionsFlow/OptionsFlow.jsx",
    "docs/discord-render/checkpoint.md",
    "services/chart_renderer/server.js",
    "app/src/pages/BreadthCharts.jsx",
    "app/src/pages/breadth/PresetRow.jsx",
    "app/src/pages/breadth/MetricReadout.jsx",
])
def test_every_off_limits_path_is_named(bans, path):
    assert [v.path for v in bans.offlimits_violations([path])] == [path]


# ── the list above is not the contract; CONTRACTS §1 is ──────────────────────
#
# ⛔ The parametrize above enumerates paths the CODE already names, so it can never go red on
# an omission — it agrees with `bans.py` by construction. S-B reviewer finding F2, 2026-09-13:
# the rail enforced 8 of the ~20 paths CONTRACTS §1 "Never edit" lists, and this test was
# incapable of noticing. The checks below DERIVE the expected set from the contract instead.

def _contract_never_edit(repo_root) -> list[str]:
    """The '**Never edit:** …' paragraph of CONTRACTS §1, as written."""
    import re as _re
    text = (repo_root / "docs" / "wisdom" / "CONTRACTS.md").read_text(encoding="utf-8")
    match = _re.search(r"\*\*Never edit:\*\*(.+?)\n\n", text, _re.S)
    assert match, "CONTRACTS.md has no '**Never edit:**' paragraph — the probe is broken, not the rail"
    return [_re.sub(r"\s+", " ", item).strip() for item in
            _re.findall(r"`([^`]+)`", match.group(1))]


#: One representative real path per contract entry. The KEY is the contract's own spelling, so
#: a new entry there with no representative here fails `test_every_contract_entry_is_enforced`.
_CONTRACT_REPRESENTATIVE = {
    "app/src/pages/journal-2-0/**": "app/src/pages/journal-2-0/NotebookTab.jsx",
    "**/lib/offline/**": "app/src/pages/journal-2-0/lib/offline/outbox.js",
    "OptionsFlow.jsx": "app/src/pages/OptionsFlow.jsx",
    "docs/discord-render/**": "docs/discord-render/checkpoint.md",
    "services/chart_renderer/**": "services/chart_renderer/server.js",
    "app/src/pages/BreadthCharts.jsx": "app/src/pages/BreadthCharts.jsx",
    "app/src/pages/breadth/PresetRow.jsx": "app/src/pages/breadth/PresetRow.jsx",
    "app/src/pages/breadth/MetricReadout.jsx": "app/src/pages/breadth/MetricReadout.jsx",
    "api/services/alert_taxonomy/**": "api/services/alert_taxonomy/registry.py",
    "api/services/data_sync.py": "api/services/data_sync.py",
    "api/services/llm_batch.py": "api/services/llm_batch.py",
    "api/services/buzz_*.py": "api/services/buzz_store.py",
    "api/services/tweet_store.py": "api/services/tweet_store.py",
    "api/services/zoom_client.py": "api/services/zoom_client.py",
    "api/routers/auth.py": "api/routers/auth.py",
    "api/services/auth_db.py": "api/services/auth_db.py",
    "api/flow_worker_main.py": "api/flow_worker_main.py",
    "docs/runbooks/deploy-windows.md": "docs/runbooks/deploy-windows.md",
    "app/src/components/tiles/CatalystTable.jsx": "app/src/components/tiles/CatalystTable.jsx",
    "app/src/hub/**": "app/src/hub/registry.js",
}


def test_the_contract_paragraph_is_readable_and_non_trivial(bans):
    """Non-vacuity. If the regex stopped matching, every derived check below would assert
    over an empty list and pass (`an empty result is a failed invocation`)."""
    entries = _contract_never_edit(bans.REPO_ROOT)
    assert len(entries) >= 15, f"only parsed {len(entries)} entries from CONTRACTS §1: {entries}"
    assert "api/routers/auth.py" in entries


def test_every_contract_entry_has_a_representative(bans):
    """A new '**Never edit:**' entry must be given a real path to test with — it cannot be
    silently skipped."""
    entries = set(_contract_never_edit(bans.REPO_ROOT))
    missing = sorted(e for e in entries if e not in _CONTRACT_REPRESENTATIVE)
    assert not missing, (
        "CONTRACTS §1 names paths this test has no representative for, so their enforcement is "
        f"unverified: {missing}")


@pytest.mark.parametrize("entry", sorted(_CONTRACT_REPRESENTATIVE))
def test_every_contract_entry_is_enforced(bans, entry):
    """The check F2 was missing: the CONTRACT decides what is off limits, not bans.py."""
    path = _CONTRACT_REPRESENTATIVE[entry]
    assert bans.offlimits_reason(path), (
        f"CONTRACTS §1 says never edit {entry!r}, but {path!r} passes the off-limits rail")


def test_the_flow_worker_watch_list_is_derived_not_retyped(bans):
    """CONTRACTS §1 says 'every flow-worker watched file'. That list lives in one place and is
    read from it — a second hand-typed copy is exactly the defect F2 was."""
    watched = bans.flow_worker_watched()
    assert watched, "derived nothing; offlimits_rail_limitations must say so rather than pass"
    assert bans.offlimits_rail_limitations() == ()
    assert "api/flow_worker_main.py" in watched
    for path in sorted(watched):
        assert bans.offlimits_reason(path), f"watched by flow-worker but not off limits: {path}"


def test_an_unreadable_watch_list_is_reported_not_silently_empty(bans, monkeypatch):
    """Control: an empty derived list must never read as 'nothing is watched, all clear'."""
    monkeypatch.setattr(bans, "flow_worker_watched", lambda: frozenset())
    assert bans.offlimits_rail_limitations(), "an underivable watch list must be reported"


@pytest.mark.parametrize("path", [
    "app/src/pages/journal-2-0-notes.md",
    "docs/discord-render-notes.md",
    "app/src/pages/OptionsFlowHelp.jsx",
    "app/src/pages/BreadthCharts.module.css",
    "app/src/lib/offlineness/x.js",
    "docs/wisdom/methodology/rails-v1.md",
    "services/chart_renderer_notes.md",
])
def test_a_near_miss_path_is_not_off_limits(bans, path):
    assert bans.offlimits_violations([path]) == []


@pytest.mark.parametrize("branch,applies", [
    ("feat/wisdom-loop", True), ("wisdom/w1-b-rails", True), ("wisdom/x/y", True),
    ("feat/wisdom-loop-extra", False), ("master", False), ("", False), ("HEAD", False),
    ("notwisdom/x", False), ("wisdom", False), ("wisdom/", False),
])
def test_the_diff_rail_fires_only_on_program_branches(bans, branch, applies):
    assert bans.rail_applies_to_branch(branch) is applies


def test_branch_identity_prefers_ci_variables_over_a_detached_checkout(bans, tmp_path):
    assert bans.branch_identity(tmp_path, {"GITHUB_HEAD_REF": "wisdom/w1-b-rails",
                                           "GITHUB_REF_NAME": "12/merge"}) == ("wisdom/w1-b-rails", "GITHUB_HEAD_REF")
    assert bans.branch_identity(tmp_path, {"GITHUB_REF_NAME": "feat/wisdom-loop"})[0] == "feat/wisdom-loop"
    assert bans.branch_identity(tmp_path, {"GITHUB_REF_NAME": "12/merge"})[1].startswith("git rev-parse")


@pytest.fixture
def hermetic_repo(tmp_path):
    if shutil.which("git") is None:
        pytest.skip("git is not on PATH")
    config = tmp_path / "isolated.gitconfig"
    config.write_text("", encoding="utf-8")
    env = {k: v for k, v in os.environ.items() if not k.startswith(("GIT_", "GITHUB_"))}
    env.update(GIT_CONFIG_GLOBAL=str(config), GIT_CONFIG_NOSYSTEM="1",
               GIT_AUTHOR_NAME="rail-fixture", GIT_AUTHOR_EMAIL="rail@example.test",
               GIT_COMMITTER_NAME="rail-fixture", GIT_COMMITTER_EMAIL="rail@example.test")
    repo = tmp_path / "repo"
    repo.mkdir()

    def run(*args):
        return subprocess.run([shutil.which("git"), "-C", str(repo), *args], env=env, check=True,
                              capture_output=True, text=True)

    run("init", "-q")
    run("symbolic-ref", "HEAD", "refs/heads/master")
    (repo / "README.md").write_text("base\n", encoding="utf-8")
    run("add", "README.md")
    run("commit", "-q", "-m", "base")
    return repo, env, run


def test_the_diff_rail_measures_a_real_diff_and_names_an_off_limits_touch(bans, hermetic_repo):
    repo, env, run = hermetic_repo
    run("checkout", "-q", "-b", "wisdom/demo")
    (repo / "docs").mkdir()
    (repo / "docs" / "note.md").write_text("allowed\n", encoding="utf-8")
    run("add", "docs/note.md")
    run("commit", "-q", "-m", "allowed change")

    clean = bans.run_offlimits_rail(repo, env=env)
    assert clean.skipped is None and clean.inconclusive is None
    assert clean.files_scanned == 1 and clean.violations == ()  # NON-VACUITY: the diff returned the file

    page = repo / "app" / "src" / "pages" / "journal-2-0"
    page.mkdir(parents=True)
    (page / "Foo.jsx").write_text("x\n", encoding="utf-8")
    run("add", "app/src/pages/journal-2-0/Foo.jsx")
    run("commit", "-q", "-m", "forbidden change")
    offline = repo / "lib" / "offline"
    offline.mkdir(parents=True)
    (offline / "untracked.js").write_text("y\n", encoding="utf-8")

    dirty = bans.run_offlimits_rail(repo, env=env)
    assert {v.path for v in dirty.violations} == {"app/src/pages/journal-2-0/Foo.jsx", "lib/offline/untracked.js"}

    run("checkout", "-q", "-b", "feature/not-the-program")
    other = bans.run_offlimits_rail(repo, env=env)
    assert other.violations == () and "feature/not-the-program" in (other.skipped or "")


def test_the_diff_rail_on_this_checkout_either_measures_or_says_why_not(bans):
    result = bans.run_offlimits_rail(REPO)
    if result.skipped:
        assert "branch" in result.skipped
        return
    assert result.inconclusive is None, result.inconclusive
    assert not result.violations, "\n".join(v.render() for v in result.violations)


# ── the pre-merge CLI ────────────────────────────────────────────────────────

def _cli(root: pathlib.Path, *extra: str) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GITHUB_")}
    return subprocess.run([sys.executable, str(CLI_PATH), "--root", str(root), *extra], capture_output=True,
                          text=True, encoding="utf-8", errors="replace", env=env)


def test_the_cli_exits_one_and_names_a_violation(tmp_path):
    root = _tree(tmp_path, {"api/services/wisdom/x.py": "import substack\n"})
    proc = _cli(root, "--no-floor", "--rail", "substack")
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "api/services/wisdom/x.py" in proc.stdout


def test_the_cli_exits_zero_clean_and_two_when_it_could_not_measure(tmp_path):
    root = _tree(tmp_path, {"api/services/wisdom/x.py": "X = 1\n"})
    passed = _cli(root, "--no-floor", "--rail", "substack", "--rail", "journal")
    assert passed.returncode == 0, passed.stdout + passed.stderr
    below_floor = _cli(root, "--rail", "substack")
    assert below_floor.returncode == 2 and "INCONCLUSIVE" in below_floor.stdout


# ── the W1 §10.5 journal-exclusion grep (a reading aid with a --strict gate) ──

GREP_PATH = REPO / "tools" / "wisdom" / "core_journal_exclusion_grep.py"

GREP_TREE = {
    "api/services/wisdom/extract/reader.py": '''\
        """Reads Sunday Scans. Nothing from the Journal, ever (W1 Part 10)."""
        # never the Journal: J2 is deferred (D16b)
        import sqlite3


        def run(conn):
            conn.execute("PRAGMA journal_mode=WAL")
            return conn.execute("SELECT * FROM j2_trades")  # never
        ''',
    "docs/wisdom/plan.md": "D16 reconciles owner J2 trades in W3.\n",
}
PLANTED_LINE = 8


@pytest.fixture(scope="module")
def jgrep():
    spec = importlib.util.spec_from_file_location("wisdom_journal_grep_under_test", GREP_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _grep_cli(root: pathlib.Path, *extra: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(GREP_PATH), "--root", str(root), *extra], capture_output=True,
                          text=True, encoding="utf-8", errors="replace")


def test_the_grep_tells_prose_from_code_and_sqlite_from_the_journal(jgrep, tmp_path):
    root = _tree(tmp_path, GREP_TREE)
    hits = {(h["path"], h["line"]): h for h in jgrep.grep(root)}
    reader = "api/services/wisdom/extract/reader.py"
    assert hits[(reader, 1)]["class"] == "ruling-text"            # docstring stating the ban
    assert hits[(reader, 2)]["class"] == "ruling-text"            # comment-only line stating it
    pragma = hits[(reader, 7)]
    assert (pragma["class"], pragma["sense"]) == ("live-reference", "other")
    planted = hits[(reader, PLANTED_LINE)]                         # a trailing comment is not prose
    assert (planted["class"], planted["sense"], planted["kind"]) == ("live-reference", "journal", "code")
    doc = hits[("docs/wisdom/plan.md", 1)]
    assert (doc["class"], doc["sense"], doc["kind"]) == ("live-reference", "journal", "doc")


def test_the_grep_strict_fails_on_a_live_journal_reference_in_code_and_only_there(tmp_path):
    root = _tree(tmp_path, GREP_TREE)
    dirty = _grep_cli(root, "--no-floor", "--strict")
    assert dirty.returncode == 1, dirty.stdout + dirty.stderr
    assert f"api/services/wisdom/extract/reader.py:{PLANTED_LINE}" in dirty.stdout
    reader = root / "api" / "services" / "wisdom" / "extract" / "reader.py"
    reader.write_text(reader.read_text(encoding="utf-8").replace("j2_trades", "sunday_scans"), encoding="utf-8")
    clean = _grep_cli(root, "--no-floor", "--strict")      # the doc line and the pragma remain
    assert clean.returncode == 0, clean.stdout + clean.stderr
    assert "(code: 0, doc: 1)" in clean.stdout


def test_the_marker_and_the_prose_rules_are_exact(jgrep):
    refusal = 'PREFIXES = ("j2", "journal")'
    assert jgrep.classify("api/services/wisdom/core/private.py", refusal) == "live-reference"
    assert jgrep.classify("api/services/wisdom/core/private.py", refusal + "  # journal-exclusion guard") == "ban-check"
    assert jgrep.python_prose_lines('X = "j2_a"  # never\n# never\n') == {2}
    assert jgrep.python_prose_lines("def (:\n# never j2\n") == set()   # unparseable: nothing is prose
    assert jgrep.sense_of("PRAGMA journal_mode=WAL; SELECT * FROM j2_trades") == "journal"


def _inconclusive_verdict_lines(stdout: str) -> list:
    """The rail's OWN verdict, told apart from a source line it merely echoed.

    ⚰️ The grep prints each hit as `<class> <sense> <kind> <path>:<line> [token] <the source>`, so
    any file in the tree that happens to contain the word INCONCLUSIVE — a three-exit-code tool
    printing its own verdict, for instance — lands that word in this output verbatim. A bare
    substring search then reports "the rail could not measure" because of a string in the material
    it measured: the instrument reporting a property of ITSELF
    (CLAUDE.md, "CODE, NEVER PROSE", which lists six earlier instances of exactly this).

    The verdict is emitted by `print(f"INCONCLUSIVE: {inconclusive}")` and is therefore the only
    thing that can START a line with it.
    """
    return [line for line in stdout.splitlines() if line.startswith("INCONCLUSIVE")]


def test_the_grep_below_its_floor_is_inconclusive(tmp_path):
    root = _tree(tmp_path, GREP_TREE)
    proc = _grep_cli(root)
    assert proc.returncode == 2 and "INCONCLUSIVE" in proc.stdout, proc.stdout + proc.stderr
    # ⭐ THE CONTROL for the line-anchored reading below: a real verdict must still be seen by it,
    # or the anchoring silently turns the check opposite this one into a no-op.
    assert _inconclusive_verdict_lines(proc.stdout), proc.stdout


def test_the_grep_on_this_checkout_measures_and_finds_no_live_journal_reference_in_code():
    proc = _grep_cli(REPO, "--strict")
    assert proc.returncode == 0, proc.stdout[-4000:] + proc.stderr
    assert not _inconclusive_verdict_lines(proc.stdout), proc.stdout[-2000:]
    assert "(code: 0," in proc.stdout


def test_the_foreign_journal_carve_out_cannot_swallow_a_real_journal_reference(jgrep):
    """`wire_journal` is the MORNING WIRE's ledger, not the Journal — and a carve-out with
    no control is how an instrument goes blind.

    ⚰️ `wire_inputs.py` names `morning-wire data/{wire_journal,...}` in a dict of PC-only
    sources Wisdom declares it does NOT read, so flagging that line reported the opposite of
    what was true. The fix strips the exact spelling before the sense test — the same shape
    as the `journal_mode` carve-out that was already there.

    ⛔ What this test exists to catch is the carve-out getting WIDER. Stripping by occurrence
    keeps a mixed line honest; stripping by line (or matching a looser pattern like
    `\w*journal`) would silently exempt every real reference that shares a line with a
    morning-wire one, and nothing else in the suite would notice.
    """
    sense_of = jgrep.sense_of

    # the carve-out fires on exactly what it is for
    assert sense_of('"wire_journal_and_ledgers": "morning-wire data/{wire_journal,open_book}"') == "other"
    assert sense_of("conn.execute('PRAGMA journal_mode=WAL')") == "other"

    # ...and on nothing else. Each of these MUST still read as journal sense.
    assert sense_of("wire_journal and the J2 journal") == "journal", "occurrence-scoped, not line-scoped"
    assert sense_of("from api.services.journal_two import db") == "journal"
    assert sense_of("read wire_journal, then j2_trades") == "journal"
    assert sense_of("wire_journal beside a notebook import") == "journal"
    assert sense_of("broker fills") == "journal"
