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
import json
import os
import sqlite3
import subprocess
import sys
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
    """⭐ THERE ARE NONE LEFT, AND ZERO IS NOW THE FLOOR.

    A pin needs an env var and some literals had none; the tripwire was their
    only cover, and a tripwire fires on a DAEMON THREAD as an invisible raise
    while the spawning test passes green. So the set was printed by name and
    ratcheted: 8, then 7 when `SSETF_DB_PATH` was declared in
    `EXPLICIT_ENV_PINS` (X18), and 0 after W9j.1 gave the last eight paths an
    env override whose DEFAULT is the literal that was already there.

    ⛔ THE RATCHET IS FINISHED, SO THIS IS NO LONGER A CEILING. A number with
    slack under it has stopped measuring: `<= 7` sitting over a real 0 would
    have let seven regressions in silently. Any literal that reappears here is
    a regression, and this fails BY NAME.

    ⚠️ The literal totals that used to be written into this docstring are gone
    on purpose: the invariant is `unpinnable == literals - pinned`, asserted
    below, and it does not drift. A count beside it is one more number to go
    stale every time a path is added.
    """
    literals = set(rootconf.SHARED_DATA_LITERALS)
    unpinnable = set(rootconf.UNPINNABLE_SHARED_LITERALS)
    pinned = set(rootconf.SHARED_DATA_ENV_PINS.values())
    assert unpinnable == literals - pinned

    # ⭐ THE CONTROL COMES FIRST. "Zero unpinnable" is also exactly what a
    # census that had gone blind would report, so prove the subtraction can
    # still expose something: drop one real pin and the literal it covered has
    # to come back by name, on its own.
    victim = "SCREENER_DB_PATH"
    covered = rootconf.SHARED_DATA_ENV_PINS[victim]
    assert covered in literals, f"{victim} pins {covered}, which no file names"
    assert literals - (pinned - {covered}) == {covered}, (
        "the unpinnable derivation stopped discriminating — dropping "
        f"{victim} did not leave {covered} exposed on its own")

    assert not unpinnable, (
        "🔴 ZERO IS THE FLOOR AND IT REGRESSED. These product paths are "
        "again unreachable by any env override, so the tripwire — which fires "
        "invisibly on a daemon thread — is all that stands between a test and "
        "the owner's live files:\n  " + "\n  ".join(sorted(unpinnable)))


def test_every_hand_declared_env_pin_is_STILL_REAL():
    """⛔ ANTI-ROT. A declared exception that has quietly stopped being true is
    a lie the next reader inherits.

    `EXPLICIT_ENV_PINS` exists for pairings the census is *correct* to miss —
    derivation (B) demands the env var and the literal share a word, because a
    looser version once pinned a DIRECTORY var to a FILE. Its one entry was
    `SSETF_DB_PATH` <-> `/data/single_stock_etfs.db` (X18): an abbreviation,
    with the read and the literal in two separate statements, invisible to
    both derivations and plain to a reader.

    ⭐ THE MAP IS EMPTY NOW, AND THAT IS THE GOAL STATE. W9j.1 reshaped
    `_resolve_db_path` so the literal is that env read's DEFAULT — the one
    shape derivation (A) pairs with no shared word needed — so the census
    owns the pairing and the hand declaration became a SECOND AUTHORITY over
    it. The rule the shape taught still stands: when a heuristic is right to
    be conservative, do not loosen it; declare what it cannot see, rail the
    declarations, and delete a declaration the moment it stops being needed.

    🔴 An empty map makes a per-entry loop VACUOUSLY GREEN, so the mechanism
    is proven directly below instead: `_explicit_pin_is_still_real` must be
    able to answer YES and NO. A checker stuck on one answer would read as a
    clean bill of health the day someone needs it again.
    """
    for var, literal in rootconf.EXPLICIT_ENV_PINS.items():
        assert rootconf._explicit_pin_is_still_real(var, literal), (
            f"{var} -> {literal} is declared in EXPLICIT_ENV_PINS but no file "
            "under api/ still reads that var and names that literal. Delete the "
            "declaration rather than leaving a false claim behind.")
        assert rootconf.SHARED_DATA_ENV_PINS.get(var) == literal, (
            f"{var} is declared but did not reach SHARED_DATA_ENV_PINS")

    # ⭐ BOTH CONTROLS, because the loop above is empty and proves nothing.
    # YES: a var that really is read beside its literal. Derived from the
    # census, never typed — a hand-typed literal here could agree with a copy
    # of itself while the product moved.
    assert rootconf._explicit_pin_is_still_real(
        "SSETF_DB_PATH", rootconf.SHARED_DATA_ENV_PINS["SSETF_DB_PATH"]), (
        "the checker can no longer see a pairing that is plainly in the tree "
        "— api/services/single_stock_etfs.py reads SSETF_DB_PATH and names "
        "its literal in the same file")
    # NO: a var nothing reads. Without this, a function that returned True
    # unconditionally would read as a clean bill of health.
    assert not rootconf._explicit_pin_is_still_real(
        "A_VAR_THAT_IS_NOT_READ_ANYWHERE", "/data/no_such_file.db")


def test_the_pin_behind_a_MEASURED_write_still_moves_off_the_shared_root():
    """🔴 A pin that is recorded but not APPLIED protects nothing.

    This is the half that matters at runtime: `SSETF_DB_PATH` must resolve
    inside the sandbox, not `C:\\data`. Before X18 it was unset, so
    `single_stock_etfs._resolve_db_path()` fell through to
    `os.path.isdir("/data")` — which is TRUE on this box — and a screener-warm
    DAEMON THREAD wrote to the real file while the spawning test passed green.

    ⭐ It used to reach that var by iterating `EXPLICIT_ENV_PINS`. That map is
    empty now (the census derives the pairing), and iterating an empty map is
    how a rail with a real incident behind it goes vacuously green — so it
    names the var, and asserts the var is still a pin the census knows.
    """
    import os

    var = "SSETF_DB_PATH"
    assert var in rootconf.SHARED_DATA_ENV_PINS, \
        f"{var} dropped out of the derived pin map"
    value = os.environ.get(var)
    assert value, f"{var} is a pin but is not set in the environment"
    norm = rootconf._norm(value)
    for root in rootconf.SHARED_DATA_ROOTS:
        assert not (norm == root or norm.startswith(root + os.sep)), (
            f"{var} still points inside the shared root: {value}")


# ─── W9j.1: the eight paths that had no env override at all ─────────────────

#: ⭐ A DECLARED ROSTER WITH A REASON PER ENTRY — never a count. A count froze a
#: population at ONE on this branch and three false premises grew out of the
#: scarcity everyone then read back as a fact.
#:
#: `env var -> (module, the expression the module ACTUALLY USES, why that is the
#: value that matters)`. `module is None` means the read is call-time inside a
#: function and there is no module constant to look at.
#:
#: ⛔ THE LITERAL IS NEVER TYPED HERE. Every expected default is read from
#: `rootconf.SHARED_DATA_ENV_PINS[var]`, so this roster cannot drift from the
#: census and cannot pass by agreeing with a copy of itself.
NEWLY_PINNED_PATHS = {
    "AVATARS_DIR": (
        "api.routers.avatar", "AVATAR_DIR",
        "module-level Path; every upload/serve/delete handler joins onto it"),
    "CONTRACT_HISTORY_FILE": (
        "api.daily_tracker", "HISTORY_FILE",
        "module-level; `_save()` rewrites it on the 4:30pm ET snapshot job"),
    "SSETF_DB_PATH": (
        "api.services.single_stock_etfs", "_resolve_db_path()",
        "resolved PER CALL — the X18 daemon thread went through this function, "
        "so reading a module constant would grade the wrong thing"),
    "SUPPORT_ATTACHMENTS_DIR": (
        "api.services.support_attachments", "ATTACH_DIR",
        "module-level Path; `_dir()` mkdirs it and touches a `.writable` marker "
        "on first use, so merely serving a ticket page writes"),
    "THEME_PERFORMANCE_FILE": (
        "api.services.theme_performance", "_PERSIST_FILE",
        "module-level; the background compute writes it and that compute starts "
        "ON BOOT — this is the one that made merely STARTING a local backend "
        "unsafe against the owner's live files"),
    "TOP_FLOW_PICKS_FILE": (
        "api.top_flow_tracker", "PICKS_FILE",
        "module-level; `_save()` rewrites it whenever new Top Flow CSV lands"),
    "WATCHLISTS_FILE": (
        "api.watchlist_tracker", "WATCHLIST_FILE",
        "module-level, and the WRITER owns the path: `api/routers/auth.py` reads "
        "the same file and now imports THIS constant instead of restating the "
        "literal, so one file has exactly one authority"),
    "TRADES_FILE": (
        None, "api/routers/auth.py::export_user_data::trades_file",
        "no module constant — the read is call-time inside the endpoint, so the "
        "child executes that function's OWN assignment statement, lifted out by "
        "AST rather than retyped"),
}

#: The child program. It runs in a FRESH interpreter because seven of the eight
#: resolutions happen at IMPORT, and a value captured at import is exactly the
#: shape of an inert knob — `monkeypatch.setenv` in this process would move the
#: variable and not the value.
#:
#: ⛔ It imports `conftest` FIRST, so the redirect and the tripwire are armed
#: before any product module loads. That is what makes the UNSET direction safe
#: to run at all: the modules resolve `/data/…` as a STRING, and if any of them
#: went on to touch it the tripwire records a violation, which the parent
#: asserts is zero.
_RESOLVE_PROBE = r'''
import ast
import importlib
import json
import os
import pathlib
import sys

sys.path.insert(0, os.getcwd())
import conftest as rootconf          # arms the redirect AND the tripwire first

spec = json.loads(sys.argv[1])
for name, value in spec["env"].items():
    if value is None:
        os.environ.pop(name, None)
    else:
        os.environ[name] = value

values = {}
for var, (module, expr) in spec["targets"].items():
    try:
        if module is None:
            rel, func, name = expr.split("::")
            source = open(os.path.join(os.getcwd(), rel), encoding="utf-8").read()
            stmt = None
            for fn in ast.walk(ast.parse(source, rel)):
                if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                if fn.name != func:
                    continue
                for node in ast.walk(fn):
                    if isinstance(node, ast.Assign) and any(
                            isinstance(t, ast.Name) and t.id == name
                            for t in node.targets):
                        if stmt is not None:
                            raise LookupError(
                                "two assignments to %s in %s" % (name, func))
                        stmt = node
            if stmt is None:
                raise LookupError("no assignment to %s in %s" % (name, func))
            ns = {"os": os, "pathlib": pathlib}
            exec(compile(ast.Module(body=[stmt], type_ignores=[]), rel, "exec"), ns)
            values[var] = str(ns[name])
        else:
            mod = importlib.import_module(module)
            values[var] = str(getattr(mod, expr[:-2])() if expr.endswith("()")
                              else getattr(mod, expr))
    except Exception as exc:
        values[var] = "ERROR %s: %s" % (type(exc).__name__, exc)

print("RESULT " + json.dumps(
    {"values": values, "violations": len(rootconf.SHARED_ROOT_VIOLATIONS)}))
'''


def _resolve_in_child(tmp_path, env):
    """`{var: what the module resolves to}`, in a fresh interpreter under `env`.

    `env` maps a variable to a value, or to None meaning "unset it".
    """
    script = tmp_path / "w9j_resolve_probe.py"
    script.write_text(_RESOLVE_PROBE, encoding="utf-8")
    spec = {"env": env,
            "targets": {v: (mod, expr)
                        for v, (mod, expr, _why) in NEWLY_PINNED_PATHS.items()}}
    proc = subprocess.run(
        [sys.executable, str(script), json.dumps(spec)],
        cwd=_REPO, capture_output=True, text=True,
        env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    assert proc.returncode == 0, (
        f"probe exited {proc.returncode}\nSTDOUT:\n{proc.stdout}\n"
        f"STDERR:\n{proc.stderr}")
    marked = [ln for ln in proc.stdout.splitlines() if ln.startswith("RESULT ")]
    assert marked, (f"the probe printed no RESULT line\nSTDOUT:\n{proc.stdout}\n"
                    f"STDERR:\n{proc.stderr}")
    payload = json.loads(marked[-1][len("RESULT "):])
    assert payload["violations"] == 0, (
        "the probe itself touched the shared root — "
        f"{payload['violations']} violation(s) recorded")
    broken = {v: r for v, r in payload["values"].items()
              if str(r).startswith("ERROR ")}
    assert not broken, "the probe could not resolve:\n  " + "\n  ".join(
        f"{v}: {r}" for v, r in sorted(broken.items()))
    return payload["values"]


#: ⛔ THE ONE THING THE CENSUS CANNOT TELL YOU: whether a default CHANGED.
#:
#: Everything else in this section derives its expected value from
#: `rootconf.SHARED_DATA_ENV_PINS`, which derives from the tree as it stands.
#: That is right for "does the module use the pinned path" and useless for "is
#: the pinned path still the one production has always written", because both
#: sides move together. MEASURED, not assumed: mutating
#: `os.environ.get("AVATARS_DIR", "/data/avatars")` to `"/data/avatars_moved"`
#: left all twenty rails in this file GREEN.
#:
#: So these eight strings are declared BY HAND, on purpose — a second
#: derivation of one fact, the same shape `_independent_literal_scan` uses
#: above. They are the literals the product shipped with before W9j.1 gave each
#: one an env override, and W9j.1 changed the SHAPE of those reads and nothing
#: about their destinations. A red here is not a nit: it means a Railway volume
#: path moved, which is a migration, not an edit.
FROZEN_SHARED_DEFAULTS = {
    "AVATARS_DIR": "/data/avatars",
    "CONTRACT_HISTORY_FILE": "/data/contract_history.json",
    "SSETF_DB_PATH": "/data/single_stock_etfs.db",
    "SUPPORT_ATTACHMENTS_DIR": "/data/support_attachments",
    "THEME_PERFORMANCE_FILE": "/data/theme_performance.json",
    "TOP_FLOW_PICKS_FILE": "/data/top_flow_picks.json",
    "TRADES_FILE": "/data/trades.json",
    "WATCHLISTS_FILE": "/data/watchlists.json",
}


def test_the_eight_defaults_are_the_SAME_STRINGS_the_product_shipped_with():
    """⭐ The only rail here that can see a default DRIFT rather than an inert one.

    Two independent statements of one fact must agree: the hand declaration
    above, and what `conftest`'s AST census finds sitting in each env read's
    default slot. Neither is computed from the other.

    ⚠️ The roster and the frozen map are asserted to cover the same eight vars,
    because a var quietly dropped from one side would take its own check with
    it — a hole that is invisible from the green.
    """
    assert set(FROZEN_SHARED_DEFAULTS) == set(NEWLY_PINNED_PATHS), (
        "the two declarations disagree about WHICH vars W9j.1 added:\n  "
        f"only frozen : {sorted(set(FROZEN_SHARED_DEFAULTS) - set(NEWLY_PINNED_PATHS))}\n  "
        f"only roster : {sorted(set(NEWLY_PINNED_PATHS) - set(FROZEN_SHARED_DEFAULTS))}")

    drifted = []
    for var, frozen in sorted(FROZEN_SHARED_DEFAULTS.items()):
        derived = rootconf.SHARED_DATA_ENV_PINS.get(var)
        if derived != frozen:
            drifted.append(f"{var}: shipped {frozen!r}, the tree now says {derived!r}")
    assert not drifted, (
        "🔴 A PRODUCTION DEFAULT MOVED. With nothing set, these vars no longer "
        "resolve where the product has always written:\n  " + "\n  ".join(drifted))


def test_every_newly_pinned_path_is_paired_by_DERIVATION_not_by_hand():
    """⭐ The pairing has to be one `conftest` finds ON ITS OWN.

    A well-chosen name plus the literal sitting in the env read's DEFAULT slot
    is derivation (A), and (A) needs no shared word. Anything else would have
    to be declared in `EXPLICIT_ENV_PINS` — a hand-written second authority
    over a pairing, which is what W9j.1 emptied that map to remove.

    So: for each of the eight, some file under `api/` must literally contain
    `os.environ.get(VAR, <the census's literal for VAR>)`. Asserted from the AST
    of the shipped tree, not from the name.
    """
    wanted = {var: rootconf.SHARED_DATA_ENV_PINS.get(var)
              for var in NEWLY_PINNED_PATHS}
    missing_pin = [v for v, lit in wanted.items() if lit is None]
    assert not missing_pin, (
        "not a derived pin at all: " + ", ".join(sorted(missing_pin)))

    seen = set()
    for path in rootconf._api_source_files():
        try:
            source = open(path, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        if "/data" not in source:
            continue
        try:
            tree = ast.parse(source, path)
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            var = rootconf._env_read_name(node)
            if var not in wanted:
                continue
            if rootconf._env_read_default(node) == wanted[var]:
                seen.add(var)

    unseen = sorted(set(wanted) - seen)
    assert not unseen, (
        "these vars are pins, but NOT because the literal is their env read's "
        "default — so the census is pairing them some looser way, or a hand "
        "declaration is doing it:\n  "
        + "\n  ".join(f"{v} -> {wanted[v]}" for v in unseen))

    # ⭐ AND THE ROSTER POINTS AT THE RIGHT MODULE. Without this the roster
    # could name any module that happens to resolve the same string, and the
    # two resolution rails below would grade the wrong file while staying green.
    misplaced = []
    for var, (module, expr, _why) in sorted(NEWLY_PINNED_PATHS.items()):
        owner = (module.replace(".", "/") + ".py") if module \
            else expr.split("::")[0]
        sites = rootconf.SHARED_DATA_LITERALS[wanted[var]]
        if not any(s.rsplit(":", 1)[0] == owner for s in sites):
            misplaced.append(f"{var}: roster says {owner}, census says {sites}")
    assert not misplaced, (
        "the roster names a module that does not spell that literal:\n  "
        + "\n  ".join(misplaced))


def test_each_newly_pinned_path_still_resolves_to_ITS_OLD_LITERAL_when_unset(tmp_path):
    """⭐ THE NO-OP HALF: production, with nothing set, must not move an inch.

    Every expected value is `rootconf.SHARED_DATA_ENV_PINS[var]` — the census's
    own record of the literal sitting in that env read's default slot — so
    nothing here is hand-typed.

    ⚠️ `normpath` on both sides because two of the eight wrap the literal in
    `pathlib.Path`, and `Path("/data/avatars")` prints `\\data\\avatars` on
    Windows. That is a property those modules already had; this change did not
    introduce it, and comparing raw strings would grade `pathlib`, not the
    default.

    ⛔ Nothing here points at a live path: the child arms the tripwire before it
    imports anything, resolution is a string, and `_resolve_in_child` asserts
    the recorded violation count is zero.
    """
    values = _resolve_in_child(tmp_path, {v: None for v in NEWLY_PINNED_PATHS})

    wrong, not_load_bearing = [], []
    for var, (_mod, _expr, _why) in sorted(NEWLY_PINNED_PATHS.items()):
        literal = rootconf.SHARED_DATA_ENV_PINS[var]
        got = values[var]
        if os.path.normpath(got) != os.path.normpath(literal):
            wrong.append(f"{var}: unset resolves {got!r}, literal was {literal!r}")
        # ⭐ CONTROL — the pin has to be LOAD-BEARING. "Resolves to the literal"
        # would also be true of a path that never named the shared root, and
        # then the override would be protecting nothing.
        if rootconf._shared_root_hit(got) is None:
            not_load_bearing.append(f"{var}: {got!r}")

    assert not wrong, (
        "an override CHANGED THE PRODUCTION DEFAULT — with nothing set the "
        "product must resolve exactly what the bare literal did:\n  "
        + "\n  ".join(wrong))
    assert not not_load_bearing, (
        "unset, these do not even name the shared root, so their pin guards "
        "nothing:\n  " + "\n  ".join(not_load_bearing))


def test_each_newly_pinned_path_MOVES_when_its_env_var_is_set(tmp_path):
    """🔴 THE HALF THAT MATTERS: a knob read once and then ignored is INERT.

    This repo has shipped one (`max_stop_pct`, whose consumer skipped the stage
    that read it), so "the variable exists" is not the claim. The claim is that
    the value the module USES moves.

    Each var gets a DISTINCT destination, and the destinations are asserted
    distinct on the way out: with one shared temp path, a module that read its
    neighbour's variable — or a roster entry that pointed at the wrong module —
    would pass.
    """
    dest = {var: str(tmp_path / f"moved_{i}_{var.lower()}")
            for i, var in enumerate(sorted(NEWLY_PINNED_PATHS))}
    values = _resolve_in_child(tmp_path, dest)

    wrong = []
    for var in sorted(NEWLY_PINNED_PATHS):
        got, want = values[var], dest[var]
        if os.path.normpath(got) != os.path.normpath(want):
            wrong.append(f"{var}: set to {want!r} but the module uses {got!r}")
    assert not wrong, (
        "INERT KNOB — the variable moved and the value did not:\n  "
        + "\n  ".join(wrong))

    resolved = [os.path.normpath(values[v]) for v in sorted(NEWLY_PINNED_PATHS)]
    assert len(set(resolved)) == len(resolved), (
        "two of the eight resolved to the SAME path, so at least one is not "
        f"reading its own variable: {resolved}")


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

    ⚠️ The remaining entries are ALLOWED and enumerated, not silenced: they
    are all bare `/data` probes (`os.path.isdir("/data")` inside a status
    handler), which create nothing, plus `api/main.py`'s two `_flow_*`
    helpers, which are owned elsewhere. Growing this list is what fails.

    ⭐ `api/routers/auth.py` USED to be on the allowed side: `export_user_data`
    spelled two bare literals, `/data/trades.json` and `/data/watchlists.json`.
    W9j.1 closed both — the first through a `TRADES_FILE` read in the function
    itself, the second by importing `watchlist_tracker.WATCHLIST_FILE` instead
    of restating the path — so it is asserted GONE below, the same way
    `flow_db` and `baselines` are.
    """
    sites = rootconf.UNGUARDED_SHARED_LITERAL_SITES
    named_files = {s[0] for s in sites}
    # The CONTROL, first: an "X must not appear" rail passes trivially against a
    # census that finds nothing, so prove it still finds the sites that are
    # genuinely there before asking whether the fixed ones are gone.
    assert len(sites) >= 8, f"the site census went blind — it found {len(sites)}"
    assert "api/main.py" in named_files, \
        "_flow_plan/_flow_optimize still carry a bare /data/flow.db and the " \
        "census no longer sees them; it is not looking"
    assert "api/routers/auth.py" not in named_files, \
        "export_user_data is spelling a bare /data literal again — the " \
        "redirect cannot reach a literal in a function that reads no env var"
    assert "api/flow_db.py" not in named_files, \
        "FlowDB.__init__ is carrying a bare /data default again"
    assert "api/baselines.py" not in named_files, \
        "baselines is carrying a bare /data default again"
    assert len(sites) <= 8, (
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
