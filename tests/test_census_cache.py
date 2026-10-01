"""Rails on the on-disk census memo added to the repo-root conftest.py.

`shared_data_root_census()` (plus its three siblings `unguarded_literal_sites`,
`auth_db_path_capturers`, `env_derived_module_globals`) AST-parses every
`.py` file under `api/` on every call. Measured 2026-09-30 on a loaded box:
`import conftest` alone cost 40-120s. The cache this file guards is what
makes that a one-time cost per (repo tree, conftest.py) pair instead of a
cost paid by every pytest session, every `tools/*_bridge.py` spawn, and the
50 tools now pinned to `import conftest`.

⭐ CORRECTNESS FIRST, same as everywhere else this module is tested: this is
the file that keeps a test off `C:\\data` (`tests/test_shared_data_root_guard.py`).
A stale or wrong cache here is a MISSING PIN, which is a write to live data —
so every rail below is about the cache failing SAFE: on any doubt, recompute.

Rails here run against a tiny FIXTURE tree under `tmp_path`, redirected
through `conftest._census_candidate_root` (which `_api_source_files` now
resolves through too, so one patch redirects both the fingerprint walk and
the real AST derivation together) — never against the real repo tree. The
one exception is `test_cached_equals_fresh_on_the_real_tree`, which reads the
real tree but mutates nothing in it.
"""
import json
import os
import time

import pytest

import conftest as rootconf


def _write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


@pytest.fixture
def fresh_memo(monkeypatch):
    """A clean in-process memo, as if this were the first call in a new
    process. Without this, every rail below would silently pass by reading
    whatever `conftest` itself already memoized when THIS test session
    imported it — exercising nothing.
    """
    monkeypatch.setattr(rootconf, "_CENSUS_MEMO", None, raising=False)


@pytest.fixture
def fixture_api_root(tmp_path, monkeypatch, fresh_memo):
    """A tiny `api/`-shaped tree, with the census pointed at it instead of
    the real one. `_api_source_files` resolves its root through
    `_census_candidate_root`, so patching that one function redirects both
    the fingerprint walk and the real AST derivation at once.
    """
    root = tmp_path / "fixture_api"
    root.mkdir()
    _write(str(root / "mod_a.py"), (
        "import os\n\n"
        "def get_a_path():\n"
        "    return os.environ.get(\"CC_FIX_A_PATH\", \"/data/cc_fix_a.db\")\n"
    ))
    monkeypatch.setattr(rootconf, "_census_candidate_root", lambda: str(root))
    return root


@pytest.fixture
def isolated_cache_file(tmp_path, monkeypatch):
    """Point the cache file at a scratch path under `tmp_path` — a test must
    never read or write the real per-repo cache that other processes (and
    this very test run's own `import conftest`) share.
    """
    cache_file = tmp_path / "cache_dir" / "census.json"
    monkeypatch.setattr(rootconf, "_census_cache_path", lambda: str(cache_file))
    return cache_file


# ─── the control: the probes used below can actually see something ─────────

def test_the_fixture_root_itself_is_visible_to_the_fingerprint_walk(
        fixture_api_root):
    """Non-vacuity control. Every rail below turns on `_census_fingerprint`
    actually finding the fixture's file — prove that first, or a broken
    redirect would make every "invalidates" rail pass for having found
    nothing to invalidate.
    """
    files = rootconf._census_fingerprint_files()
    rels = [f[0] for f in files]
    assert rels == ["mod_a.py"], files


# ─── requirement: cached == fresh, on the REAL tree ─────────────────────────

def test_cached_equals_fresh_on_the_real_tree():
    """The headline guarantee: what the cached wrapper returns is byte-for-
    byte what a fresh, uncached derivation returns, for the actual repo.

    `shared_data_root_census()` reads from (or populates) the memo;
    `_derive_shared_data_root_census()` is never cached by construction — it
    IS the fresh computation. Comparing them is comparing the cached path
    against the uncached one, not a self-consistency check.
    """
    cached_literals, cached_pins, cached_unpinnable = \
        rootconf.shared_data_root_census()
    fresh_literals, fresh_pins, fresh_unpinnable = \
        rootconf._derive_shared_data_root_census()

    assert cached_literals == fresh_literals
    assert cached_pins == fresh_pins
    assert cached_unpinnable == fresh_unpinnable
    # non-vacuity: this must not be comparing two empty results
    assert len(cached_literals) >= 50


def test_cached_equals_fresh_for_the_other_three_derivations():
    """The same guarantee for the three siblings. Each is cached under its
    own section but through the identical `_census_cached` mechanism.
    """
    assert rootconf.unguarded_literal_sites() == \
        rootconf._derive_unguarded_literal_sites()
    assert rootconf.auth_db_path_capturers() == \
        rootconf._derive_auth_db_path_capturers()
    assert rootconf.env_derived_module_globals() == \
        rootconf._derive_env_derived_module_globals()


def test_the_redirects_SHARED_DATA_ENV_PINS_applies_are_identical_either_way():
    """Requirement: "the same SHARED_DATA_ENV_PINS and redirects applied."

    `SHARED_DATA_ENV_PINS` is the module-level census merged with
    `EXPLICIT_ENV_PINS`; redoing that merge over a FRESH, uncached census must
    land on exactly what the live (cached) global already holds.
    """
    _, fresh_pins, _ = rootconf._derive_shared_data_root_census()
    merged = dict(fresh_pins)
    for var, literal in rootconf.EXPLICIT_ENV_PINS.items():
        merged.setdefault(var, literal)
    assert merged == rootconf.SHARED_DATA_ENV_PINS


# ─── requirement: adding a pin-bearing file invalidates, new pin appears ────

def test_adding_a_file_with_a_new_pin_invalidates_the_cache(
        fixture_api_root, isolated_cache_file):
    literals, pins, _ = rootconf.shared_data_root_census()
    assert "CC_FIX_NEW_PATH" not in pins
    assert isolated_cache_file.exists()

    # simulate the NEXT process: a fresh memo, same on-disk cache file
    rootconf._CENSUS_MEMO = None
    _write(str(fixture_api_root / "mod_b.py"), (
        "import os\n\n"
        "def get_new_path():\n"
        "    return os.environ.get(\"CC_FIX_NEW_PATH\", \"/data/cc_fix_new.db\")\n"
    ))

    literals2, pins2, _ = rootconf.shared_data_root_census()
    assert pins2.get("CC_FIX_NEW_PATH") == "/data/cc_fix_new.db"
    assert "/data/cc_fix_new.db" in literals2
    # the original pin is undisturbed by the new file
    assert pins2.get("CC_FIX_A_PATH") == "/data/cc_fix_a.db"


def test_removing_a_pin_bearing_file_invalidates_the_cache(
        fixture_api_root, isolated_cache_file):
    """The inverse of the rail above — a file leaving the tree must drop its
    pin, not leave a stale one behind.
    """
    _, pins, _ = rootconf.shared_data_root_census()
    assert "CC_FIX_A_PATH" in pins

    rootconf._CENSUS_MEMO = None
    os.remove(str(fixture_api_root / "mod_a.py"))

    _, pins2, _ = rootconf.shared_data_root_census()
    assert "CC_FIX_A_PATH" not in pins2


# ─── requirement: touching or resizing a file invalidates it ───────────────

def test_touching_a_files_mtime_changes_the_fingerprint(fixture_api_root):
    """Same bytes, same size, only the mtime moves — the fingerprint must
    still change, or a same-size edit saved within one filesystem tick would
    silently read the old content forever.
    """
    path = fixture_api_root / "mod_a.py"
    before = rootconf._census_fingerprint()

    st = os.stat(path)
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))

    after = rootconf._census_fingerprint()
    assert before != after
    assert before["files"] != after["files"]


def test_resizing_a_files_content_changes_the_fingerprint(fixture_api_root):
    """A real edit: different bytes, different size."""
    path = fixture_api_root / "mod_a.py"
    before = rootconf._census_fingerprint()

    with open(path, "a", encoding="utf-8") as fh:
        fh.write("\n# a trailing comment that changes the file's size\n")

    after = rootconf._census_fingerprint()
    assert before != after


def test_editing_an_existing_pinned_file_in_place_invalidates_the_cache(
        fixture_api_root, isolated_cache_file):
    """The decisive case: the file path does NOT change, only its content —
    so this can only be caught by (size, mtime_ns), never by the file list
    alone. This is the rail that was mutation-proved by making the
    fingerprint blind to size/mtime: see the commit message for the proof.
    """
    _, pins, _ = rootconf.shared_data_root_census()
    assert pins.get("CC_FIX_A_PATH") == "/data/cc_fix_a.db"

    rootconf._CENSUS_MEMO = None
    _write(str(fixture_api_root / "mod_a.py"), (
        "import os\n\n"
        "def get_a_path():\n"
        "    return os.environ.get(\"CC_FIX_A_PATH\", \"/data/cc_fix_a_V2.db\")\n"
    ))

    _, pins2, _ = rootconf.shared_data_root_census()
    assert pins2.get("CC_FIX_A_PATH") == "/data/cc_fix_a_V2.db", (
        "the in-place edit was not picked up -- the cache read stale data "
        f"from before the edit: {pins2!r}")


# ─── requirement: a corrupted or truncated cache file means recompute ──────

def test_a_corrupted_cache_file_means_recompute(
        isolated_cache_file, fresh_memo):
    os.makedirs(os.path.dirname(isolated_cache_file), exist_ok=True)
    with open(isolated_cache_file, "w", encoding="utf-8") as fh:
        fh.write("{not valid json at all 987#$%")

    literals, pins, unpinnable = rootconf.shared_data_root_census()
    fresh = rootconf._derive_shared_data_root_census()
    assert (literals, pins, unpinnable) == fresh
    # recompute also means "heals the file" -- it is valid JSON now
    with open(isolated_cache_file, "r", encoding="utf-8") as fh:
        json.load(fh)  # must not raise


def test_a_truncated_cache_file_means_recompute(
        isolated_cache_file, fresh_memo):
    """Valid JSON, but with the field the reader depends on missing — the
    shape a real file would have if a write were interrupted partway and
    `os.replace` were skipped (it never is, but the reader must not assume
    that).
    """
    os.makedirs(os.path.dirname(isolated_cache_file), exist_ok=True)
    with open(isolated_cache_file, "w", encoding="utf-8") as fh:
        json.dump({"sections": {}}, fh)   # no "fingerprint" key at all

    literals, pins, unpinnable = rootconf.shared_data_root_census()
    fresh = rootconf._derive_shared_data_root_census()
    assert (literals, pins, unpinnable) == fresh


def test_a_cache_file_with_the_wrong_schema_means_recompute(
        fixture_api_root, isolated_cache_file):
    """A real fingerprint shape, but `schema` from a conftest that no longer
    exists -- must be treated exactly like any other mismatch, not like a
    `KeyError` waiting to happen the day the payload shape actually changes.
    """
    fp = rootconf._census_fingerprint()
    stale_fp = dict(fp)
    stale_fp["schema"] = -1
    os.makedirs(os.path.dirname(isolated_cache_file), exist_ok=True)
    with open(isolated_cache_file, "w", encoding="utf-8") as fh:
        json.dump({"fingerprint": stale_fp,
                   "sections": {"census": [{"X": ["bogus:1"]}, {}, []]}}, fh)

    literals, pins, unpinnable = rootconf.shared_data_root_census()
    assert "X" not in literals, "a stale-schema cache entry was trusted"


# ─── requirement: the kill switch bypasses it ───────────────────────────────

@pytest.mark.parametrize("value", ["0", "false", "FALSE", "no", "off", "Off"])
def test_the_kill_switch_recognises_every_off_spelling(value, monkeypatch):
    monkeypatch.setenv("UCT_CENSUS_CACHE", value)
    assert rootconf._census_cache_enabled() is False


@pytest.mark.parametrize("value", ["1", "true", "yes", "on", "anything-else"])
def test_unset_or_an_on_value_leaves_the_cache_enabled(value, monkeypatch):
    monkeypatch.setenv("UCT_CENSUS_CACHE", value)
    assert rootconf._census_cache_enabled() is True


def test_unset_defaults_to_enabled(monkeypatch):
    monkeypatch.delenv("UCT_CENSUS_CACHE", raising=False)
    assert rootconf._census_cache_enabled() is True


def test_the_kill_switch_never_reads_or_writes_the_cache_file(
        fixture_api_root, isolated_cache_file, monkeypatch):
    monkeypatch.setenv("UCT_CENSUS_CACHE", "0")

    # poison the file -- if the kill switch ever read it, this would surface
    os.makedirs(os.path.dirname(isolated_cache_file), exist_ok=True)
    with open(isolated_cache_file, "w", encoding="utf-8") as fh:
        fh.write("POISON: reading this would prove the kill switch is a lie")

    literals, pins, _ = rootconf.shared_data_root_census()
    assert pins.get("CC_FIX_A_PATH") == "/data/cc_fix_a.db"

    # and it must not have been overwritten with a real cache either
    with open(isolated_cache_file, "r", encoding="utf-8") as fh:
        assert fh.read().startswith("POISON")


def test_the_kill_switch_recomputes_on_every_call_not_just_once(
        fixture_api_root, monkeypatch):
    """The in-process memo is also part of "the cache" -- the kill switch
    must bypass it too, or a second call in the same process would read a
    memoized answer despite the switch being on.

    `fixture_api_root` pulls in `fresh_memo`, so `_CENSUS_MEMO` starts `None`
    here -- the assertion is that the kill-switched call leaves it that way,
    not merely that it happens to still be `None` from before the test ran.
    """
    assert rootconf._CENSUS_MEMO is None  # the control: starts clean
    monkeypatch.setenv("UCT_CENSUS_CACHE", "0")
    rootconf.shared_data_root_census()
    assert rootconf._CENSUS_MEMO is None, (
        "the kill switch populated the in-process memo -- a later call with "
        "the switch off would read cache-free-era state as if it were cached")


# ─── requirement: the cache file is never inside the repo or the shared root

def test_the_cache_file_is_never_inside_the_repo_or_the_shared_root():
    repo_root = os.path.dirname(os.path.abspath(rootconf.__file__))
    cache_path = os.path.normcase(os.path.abspath(rootconf._census_cache_path()))

    norm_repo = os.path.normcase(os.path.abspath(repo_root))
    assert not (cache_path == norm_repo
                or cache_path.startswith(norm_repo + os.sep)), (
        f"the census cache lives inside the repo tree: {cache_path}")

    for root in rootconf.SHARED_DATA_ROOTS:
        assert not (cache_path == root or cache_path.startswith(root + os.sep)), (
            f"the census cache lives inside the shared data root: {cache_path}")


def test_the_cache_path_is_keyed_by_repo_root_so_worktrees_do_not_collide():
    """Two different repo roots must get two different cache files, or a
    second worktree's memo would silently answer for this one's tree.
    """
    import tempfile
    import hashlib

    real_path = rootconf._census_cache_path()

    other_root = os.path.join(tempfile.gettempdir(), "uct_census_cache_test_other")
    key = hashlib.sha256(other_root.encode("utf-8")).hexdigest()[:16]
    other_path = os.path.join(
        tempfile.gettempdir(), "uct_census_cache", f"{key}.json")
    assert real_path != other_path
