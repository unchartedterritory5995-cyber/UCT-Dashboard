"""Rails on the shared-production-data-root guard in the repo-root conftest.

The defect this guards is not hypothetical and it is not one file:

* `C:\\data\\auth.db` reached **1.01 GB / 20,640 users** because ~40
  `monkeypatch.setenv("AUTH_DB_PATH", …)` calls isolated nothing — six product
  modules read that variable ONCE, at import.
* `C:\\data\\screener.db` gained ticker `A` stamped `2026-08-08` because
  `POST /api/screener/refresh` hands the real builder to a **daemon thread**,
  the test returned, `monkeypatch` unset `SCREENER_DB_PATH`, and the thread
  resolved the path AFTERWARDS. One row then made the member-facing screener
  label 3,583 month-old rows as "today" (`e86ad6d5`).

⭐ Every rail here goes red on the tree as it shipped, and the two that matter
most watch the guard actually FIRE — on a throwaway probe directory, never on
`C:\\data`. A guard nobody has seen fire is not a guard.
"""
import ast
import os
import sqlite3
import threading

import pytest

import conftest as rootconf

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# `tests/__init__.py` makes `tests/` a package, so the bare name `conftest`
# resolves to the repo-root one. Asserted, not assumed: if that ever stops being
# true these rails would grade a conftest that is not the one in force.
assert os.path.realpath(rootconf.__file__) == \
    os.path.realpath(os.path.join(_REPO, "conftest.py")), \
    f"imported the wrong conftest: {rootconf.__file__}"


# ─── the census: derived here INDEPENDENTLY, then compared ──────────────────

def _independent_literal_scan():
    """Re-derive the `/data…` literal census without reusing conftest's walker.

    Deliberately a second implementation. A rail that calls the function it is
    grading proves only that the function is deterministic — the point is that
    two derivations of the same fact agree.
    """
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    found = {}
    for dirpath, dirnames, filenames in os.walk(os.path.join(root, "api")):
        dirnames[:] = [d for d in dirnames
                       if d not in ("__pycache__", "node_modules")]
        for name in filenames:
            if not name.endswith(".py"):
                continue
            if name.startswith("test_") or name.endswith("_test.py"):
                continue
            path = os.path.join(dirpath, name)
            try:
                tree = ast.parse(open(path, encoding="utf-8",
                                      errors="replace").read(), path)
            except (OSError, SyntaxError):
                continue
            for node in ast.walk(tree):
                if not isinstance(node, ast.Constant):
                    continue
                if not isinstance(node.value, str):
                    continue
                slashed = node.value.replace("\\", "/").lower()
                if slashed == "/data" or slashed.startswith("/data/"):
                    found.setdefault(node.value.replace("\\", "/"), []).append(
                        f"{os.path.relpath(path, root)}:{node.lineno}")
    return found


def test_the_census_names_every_shared_root_literal_the_product_contains():
    """Fails BY LITERAL when a new `/data…` path appears that the census misses.

    ⛔ Not by COUNT. A count says "something moved"; a name says which file is
    now one import away from the owner's live data.
    """
    mine = set(_independent_literal_scan())
    theirs = set(rootconf.SHARED_DATA_LITERALS)
    assert mine == theirs, (
        f"census disagrees with an independent AST scan\n"
        f"  missing from conftest : {sorted(mine - theirs)}\n"
        f"  extra in conftest     : {sorted(theirs - mine)}"
    )
    assert len(theirs) >= 50, f"the census collapsed to {len(theirs)} literals"


def test_the_census_is_not_padded_with_a_literal_no_source_file_contains():
    """A census that looks healthy and guards nothing is the failure mode here.

    `_fetch_naaim`'s no-network guard went vacuously green the day its list
    moved out of the function it read. Every entry must be traceable to a real
    `file:line` that really contains that text.
    """
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for literal, sites in rootconf.SHARED_DATA_LITERALS.items():
        assert sites, f"{literal} is claimed by nothing"
        rel, lineno = sites[0].rsplit(":", 1)
        path = os.path.join(root, rel)
        line = open(path, encoding="utf-8",
                    errors="replace").read().splitlines()[int(lineno) - 1]
        assert literal.replace("/", os.sep) in line or literal in line, (
            f"{literal} claims {sites[0]}, which reads: {line.strip()!r}")


# ─── the redirect ───────────────────────────────────────────────────────────

def test_every_pinned_env_var_now_resolves_outside_the_shared_root():
    """The redirect half, asserted on `os.environ` as it stands mid-run."""
    offenders = []
    for var in rootconf.SHARED_DATA_ENV_PINS:
        value = os.environ.get(var)
        if value is None:
            offenders.append(f"{var} is UNSET — the product default wins")
            continue
        if rootconf._shared_root_hit(value) is not None:
            offenders.append(f"{var}={value}")
    assert not offenders, "env vars still pointing into C:\\data:\n  " + \
        "\n  ".join(offenders)


def test_the_pins_reach_the_env_vars_that_name_the_measured_disasters():
    """The two files that have already cost real damage are pinned by name.

    Derived from the census rather than typed: each is asserted to be a key of
    the pin map AND to resolve somewhere that is not the shared root.
    """
    for var in ("SCREENER_DB_PATH", "AUTH_DB_PATH", "FLOW_DB_PATH"):
        assert var in rootconf.SHARED_DATA_ENV_PINS, \
            f"{var} dropped out of the derived pin map"
        assert rootconf._shared_root_hit(os.environ[var]) is None


def test_the_screener_default_would_still_name_the_live_database(monkeypatch):
    """The pin is load-bearing: remove it and the product resolves production.

    This is the control for the rail above — without it, "pinned outside the
    root" could be true because the product never named the root in the first
    place.
    """
    from api.services.screener import snapshot_db

    monkeypatch.delenv("SCREENER_DB_PATH", raising=False)
    unisolated = snapshot_db.get_db_path()           # resolution only, no write
    assert rootconf._shared_root_hit(unisolated) is not None, (
        f"expected the un-pinned resolution to name the shared root, "
        f"got {unisolated!r}")


def test_the_literals_no_env_var_can_move_are_named_not_forgotten():
    """The tripwire is the ONLY cover for these — so they are printed by name.

    A pin needs an env var; 8 of the 55 literals have none (`/data/trades.json`,
    `/data/avatars`, `/data/watchlists.json`, …). Growing that set silently is
    how the next `C:\\data` write gets in, so this rail fails when it grows and
    names the newcomer.
    """
    unpinnable = set(rootconf.UNPINNABLE_SHARED_LITERALS)
    pinned = set(rootconf.SHARED_DATA_ENV_PINS.values())
    assert unpinnable == set(rootconf.SHARED_DATA_LITERALS) - pinned
    assert len(unpinnable) <= 8, (
        "more product paths are now unreachable by any env override:\n  "
        + "\n  ".join(sorted(unpinnable)))


# ─── the tripwire: watched firing, on a probe directory ─────────────────────

def test_no_shared_root_literal_sits_in_a_function_that_reads_no_env_var():
    """🔴 A LITERAL BEING PINNED SOMEWHERE ≠ EVERY SITE OF IT BEING REACHABLE.

    This rail exists because the pin map lied by omission and the guard caught
    it in a full run. `FLOW_DB_PATH` was pinned from twenty modules, and TWO
    functions still carried `db_path="/data/flow.db"` as a DEFAULT ARGUMENT with
    no env read anywhere inside them:

        api/flow_db.py:132   FlowDB.__init__   ← called from `massive-ws-consumer`
        api/baselines.py:97  init_db           ← called at import of liveflow_worker

    A pin moves an env READ; neither had one; both wrote to `C:\\data\\flow.db`.
    Both are fixed, and this fails BY `file:line:function` if a third appears.

    ⚠️ The remaining entries are ALLOWED and enumerated, not silenced: the bare
    `/data` probes (`os.path.isdir("/data")` inside a status handler) create
    nothing, and `api/main.py` + `api/routers/auth.py` are owned elsewhere.
    Growing this list is what fails.
    """
    sites = rootconf.UNGUARDED_SHARED_LITERAL_SITES
    named_files = {s[0] for s in sites}
    # The CONTROL, first: an "X must not appear" rail passes trivially against a
    # census that finds nothing, so prove it still finds the sites that are
    # genuinely there before asking whether the two fixed ones are gone.
    assert len(sites) >= 8, f"the site census went blind — it found {len(sites)}"
    assert "api/routers/auth.py" in named_files, \
        "export_user_data still spells two bare /data literals; a census that " \
        "misses them is not looking"
    assert "api/flow_db.py" not in named_files, \
        "FlowDB.__init__ is carrying a bare /data default again"
    assert "api/baselines.py" not in named_files, \
        "baselines is carrying a bare /data default again"
    assert len(sites) <= 10, (
        "a new /data literal now sits in a function that reads no env var — "
        "the redirect cannot reach it:\n  "
        + "\n  ".join(f"{f}:{ln} {fn}() -> {v}" for f, ln, fn, v in sites))


def test_the_tripwire_refuses_every_write_primitive_under_a_probe_root(tmp_path):
    """sqlite3 / open / makedirs / mkdir / rename / replace / remove.

    ⛔ Run against a PROBE directory, never `C:\\data`: the real roots are
    swapped OUT for the block, so this can neither touch production nor be
    quietly satisfied by production's absence.
    """
    probe = tmp_path / "probe_data"
    probe.mkdir()
    outside = tmp_path / "elsewhere"
    outside.mkdir()

    attempts = [
        ("sqlite3.connect", lambda: sqlite3.connect(str(probe / "x.db"))),
        ("open(w)", lambda: open(probe / "x.json", "w")),
        ("open(a)", lambda: open(probe / "x.json", "a")),
        ("os.makedirs", lambda: os.makedirs(str(probe / "sub" / "deep"))),
        ("os.mkdir", lambda: os.mkdir(str(probe / "sub2"))),
        ("os.remove", lambda: os.remove(str(probe / "x.json"))),
        ("os.rename", lambda: os.rename(str(outside / "a"), str(probe / "b"))),
        ("os.replace", lambda: os.replace(str(probe / "b"), str(outside / "a"))),
    ]
    with rootconf.pretend_shared_root(probe), \
            rootconf.captured_shared_root_attempts() as taken:
        for label, call in attempts:
            with pytest.raises(rootconf.SharedDataRootWrite):
                call()
        # the CONTROL, in the same block: identical calls one directory over
        # must sail through, or "refuses everything" would pass the rail above.
        sqlite3.connect(str(outside / "ok.db")).close()
        open(outside / "ok.json", "w").close()
        os.makedirs(str(outside / "sub"))

    assert len(taken["writes"]) == len(attempts)
    assert not list(probe.iterdir()), \
        f"the guard raised but something still landed: {list(probe.iterdir())}"
    assert (outside / "ok.db").exists() and (outside / "ok.json").exists()


def test_an_explicit_read_only_sqlite_uri_is_recorded_but_allowed(tmp_path):
    """`mode=ro` creates nothing. It is still a dependency on a mutable file,
    so it is RECORDED — but refusing it would break the one honest way to look
    at production (E-1 read the live screener DB exactly like this)."""
    probe = tmp_path / "probe_data"
    probe.mkdir()
    sqlite3.connect(str(probe / "real.db")).close()   # roots not swapped yet

    with rootconf.pretend_shared_root(probe), \
            rootconf.captured_shared_root_attempts() as taken:
        uri = f"file:{(probe / 'real.db').as_posix()}?mode=ro"
        sqlite3.connect(uri, uri=True).close()

        # …and the carve-out is for `mode=ro` ONLY. A URI is the easiest way to
        # smuggle a WRITE past a check that just looks for the substring
        # "file:", so the two writable URI spellings are asserted refused in the
        # same block — otherwise "unwrap the URI" could be implemented as
        # "assume every URI is read-only" and every rail here would stay green.
        for writable in (f"file:{(probe / 'real.db').as_posix()}?mode=rwc",
                         f"file:{(probe / 'real.db').as_posix()}"):
            with pytest.raises(rootconf.SharedDataRootWrite):
                sqlite3.connect(writable, uri=True)

    assert len(taken["writes"]) == 2
    assert len(taken["reads"]) == 1
    assert "mode=ro" in taken["reads"][0]["op"]


# ─── 🔴 THE HARD CASE: the patch is already gone when the write happens ─────

def test_a_daemon_thread_that_outlives_monkeypatch_is_CAUGHT(tmp_path):
    """The exact shape of the screener leak, reproduced end to end.

    A `monkeypatch` env override lives for the test. A daemon thread does not.
    The worker below deliberately resolves its path only AFTER the override has
    unwound — which is when the real one resolved `/data/screener.db` — and the
    tripwire has to catch a write that happens on a thread the test is no longer
    watching.

    ⚠️ The raise alone is NOT the proof. An exception on a daemon thread goes to
    `threading.excepthook` and vanishes; the test that spawned it passes. So the
    assertions are on the RECORD and on the filesystem, not on the traceback.
    """
    probe = tmp_path / "probe_data"
    probe.mkdir()
    scratch = tmp_path / "scratch.db"

    seen = {}
    may_resolve, finished = threading.Event(), threading.Event()

    def worker():
        may_resolve.wait(10)
        # ── the resolution happens HERE, after teardown ──
        seen["resolved"] = os.environ.get("E5_ESCAPING_DB_PATH") \
            or str(probe / "screener.db")
        try:
            conn = sqlite3.connect(seen["resolved"])
            conn.execute("CREATE TABLE screener_rows (ticker TEXT)")
            conn.close()
            seen["wrote"] = True
        except BaseException as exc:               # noqa: BLE001 — recorded
            seen["raised"] = exc
        finished.set()

    with rootconf.pretend_shared_root(probe), \
            rootconf.captured_shared_root_attempts() as taken:
        mp = pytest.MonkeyPatch()
        mp.setenv("E5_ESCAPING_DB_PATH", str(scratch))
        thread = threading.Thread(target=worker, daemon=True,
                                  name="e5-escaping-writer")
        thread.start()
        mp.undo()                                  # ← teardown, thread still live
        may_resolve.set()
        assert finished.wait(20), "the worker never finished"
        thread.join(5)

    assert seen["resolved"] != str(scratch), (
        "the reproduction is broken: the thread still saw the test's override, "
        "so nothing about a post-teardown resolution was exercised")
    assert seen.get("wrote") is not True, "the escaping write was NOT stopped"
    assert isinstance(seen.get("raised"), rootconf.SharedDataRootWrite)
    assert len(taken["writes"]) == 1
    record = taken["writes"][0]
    assert record["thread"] == "e5-escaping-writer", \
        "the record must name the thread — that is how the next one gets found"
    assert not (probe / "screener.db").exists()


def test_the_real_screener_resolver_on_a_background_thread_lands_in_the_sandbox():
    """The same escape, through the PRODUCT's own resolver, with nothing stubbed.

    `snapshot_db.get_db_path()` is what the leaked `screener-refresh` thread
    called. Here it is called from a background thread after the test's override
    is gone, and the two facts that matter are asserted:

      1. it does NOT name `C:\\data\\screener.db` any more — the conftest pin is
         standing in for the vanished override;
      2. point the tripwire at where it DOES land and the same call is refused —
         so the coverage is real, not an accident of the redirect.
    """
    from api.services.screener import snapshot_db

    resolved, refused = {}, {}
    may_resolve, finished = threading.Event(), threading.Event()

    def worker():
        may_resolve.wait(10)
        resolved["path"] = snapshot_db.get_db_path()
        try:
            snapshot_db.init_db()
            refused["raised"] = None
        except BaseException as exc:               # noqa: BLE001 — recorded
            refused["raised"] = exc
        finished.set()

    mp = pytest.MonkeyPatch()
    mp.setenv("SCREENER_DB_PATH", os.path.join(
        rootconf.SANDBOX_DATA_ROOT, "a_test_of_its_own.db"))
    thread = threading.Thread(target=worker, daemon=True, name="screener-refresh")
    thread.start()
    mp.undo()                                      # ← the override is gone

    sandbox_db = os.path.join(rootconf.SANDBOX_DATA_ROOT, "screener.db")
    with rootconf.pretend_shared_root(sandbox_db), \
            rootconf.captured_shared_root_attempts() as taken:
        may_resolve.set()
        assert finished.wait(20)
        thread.join(5)

    assert rootconf._shared_root_hit_against(
        resolved["path"], rootconf.SHARED_DATA_ROOTS) is None, (
        f"the post-teardown resolution still names production: "
        f"{resolved['path']!r}")
    assert os.path.normcase(resolved["path"]) == os.path.normcase(sandbox_db)
    assert isinstance(refused["raised"], rootconf.SharedDataRootWrite)
    assert taken["writes"] and taken["writes"][0]["thread"] == "screener-refresh"


def _run_probe(tmp_path, nodeid):
    """Run one `_e5_sessionfail_probe` case in a real subprocess.

    ⛔ The verdict comes back as `proc.returncode` off the process object — this
    is the fact both rails below turn on, and a pipe would launder it.
    """
    import subprocess
    import sys

    env = dict(os.environ)
    env["E5_PROBE_ROOT"] = str(tmp_path / "probe_data")
    env["UCT_TEST_SHARED_ROOT_GUARD"] = "enforce"
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
         "--no-header", "-W", "ignore::DeprecationWarning", nodeid],
        cwd=_REPO, env=env, capture_output=True, text=True, timeout=300)
    return proc.stdout + proc.stderr, proc


def test_a_thread_violation_FAILS_THE_RUN_even_when_every_test_PASSES(tmp_path):
    """🔴 The half that makes this a guard instead of a redirect.

    An exception on a daemon thread goes to `threading.excepthook`; the test
    that spawned it passes; the suite reports green. That is EXACTLY how ticker
    `A` reached `C:\\data\\screener.db` under 11,000 passing tests. So the run
    has to fail on the session tally, not on a test.

    Measured in a real subprocess — `1 passed`, exit code 1 — with the verdict
    read off `proc.returncode`, never a pipe.
    """
    blob, proc = _run_probe(
        tmp_path,
        "tests/_e5_sessionfail_probe.py"
        "::test_the_test_itself_passes_while_a_thread_writes_into_the_probe_root")
    probe = tmp_path / "probe_data"

    assert "1 passed" in blob, f"the probe test did not pass:\n{blob[-3000:]}"
    assert proc.returncode == 1, (
        f"every test passed and the run reported success — the session tally "
        f"is not failing the run.\nrc={proc.returncode}\n{blob[-3000:]}")
    assert "SHARED PRODUCTION DATA ROOT" in blob
    assert "e5-probe-escapee" in blob, \
        "the report must name the thread; that is how the next one is found"
    assert not probe.exists() or not (probe / "escaped.db").exists()


def test_a_SWALLOWED_write_on_the_test_s_own_thread_fails_that_test(tmp_path):
    """The per-test half, and the reason raising alone is not enough.

    Half this repo's stores are opened inside a `try/except` that logs and
    carries on, so a raise is not by itself something anybody sees. The autouse
    fixture has to turn a caught-and-discarded violation into a red test — and
    name it, rather than leaving it to a summary 11,000 tests later.
    """
    blob, proc = _run_probe(
        tmp_path,
        "tests/_e5_sessionfail_probe.py"
        "::test_a_SWALLOWED_main_thread_write_is_still_failed_by_the_fixture")
    assert proc.returncode == 1
    # The fixture raises at TEARDOWN, so pytest files it as an error on that
    # node rather than as an assertion failure inside it. Either way it is red
    # and it carries the node id, which is the property that matters.
    assert "1 error" in blob or "1 failed" in blob, \
        f"the swallowed write was not caught:\n{blob[-3000:]}"
    assert "wrote inside the shared production data root" in blob
    assert "test_a_SWALLOWED_main_thread_write_is_still_failed_by_the_fixture" in blob
    assert not (tmp_path / "probe_data" / "swallowed.db").exists()


def test_the_guard_is_actually_installed_on_every_primitive_it_claims():
    """Fails when a wrapper is removed — the way a guard quietly stops guarding.

    Checked by identity against the captured originals rather than by calling
    them, so it cannot be satisfied by a wrapper that forwards without checking.
    """
    import builtins
    import io

    installed = {
        "sqlite3.connect": sqlite3.connect,
        "sqlite3.dbapi2.connect": __import__("sqlite3.dbapi2",
                                             fromlist=["connect"]).connect,
        "builtins.open": builtins.open,
        "io.open": io.open,
        "os.makedirs": os.makedirs,
        "os.mkdir": os.mkdir,
        "os.remove": os.remove,
        "os.unlink": os.unlink,
        "os.rename": os.rename,
        "os.replace": os.replace,
    }
    originals = {
        "sqlite3.connect": rootconf._real_sqlite_connect,
        "sqlite3.dbapi2.connect": rootconf._real_sqlite_connect,
        "builtins.open": rootconf._real_open,
        "io.open": rootconf._real_io_open,
        "os.makedirs": rootconf._real_makedirs,
        "os.mkdir": rootconf._real_mkdir,
        "os.remove": rootconf._real_remove,
        "os.unlink": rootconf._real_unlink,
        "os.rename": rootconf._real_rename,
        "os.replace": rootconf._real_replace,
    }
    unguarded = [name for name, fn in installed.items()
                 if fn is originals[name]]
    assert not unguarded, f"tripwire missing on: {unguarded}"


def test_nothing_in_this_session_has_written_to_the_shared_root():
    """The session tally, read mid-run. `pytest_sessionfinish` is the real gate;
    this makes the same fact visible as a named test rather than as an exit
    code, and fails the FILE that is running when a straggler lands."""
    assert rootconf.SHARED_ROOT_VIOLATIONS == [], "\n".join(
        f"{v['op']} -> {v['path']}  [test={v['test']} thread={v['thread']}]"
        for v in rootconf.SHARED_ROOT_VIOLATIONS)
