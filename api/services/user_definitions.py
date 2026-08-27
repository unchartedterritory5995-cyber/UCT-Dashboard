"""USER-AUTHORED INDICATOR DEFINITIONS — its own store, append-only, and an
edit that CALLS Phase C's force-migration.

⭐ THE ONE SENTENCE: a user's formula is user-authored CONTENT with pins pointing
at it, so it gets its own SQLite file, every save APPENDS a version, and a save
that changes the MATHS bumps `rev` and force-migrates every alert bound to it
through the mechanism Phase C already built.

────────────────────────────────────────────────────────────────────────────────
WHY NOT `chart_settings` — MEASURED, NOT ASSUMED
────────────────────────────────────────────────────────────────────────────────
`mergeChartSettings` (`app/src/components/chart/chartDefaults.js:336`) is a HARD
ALLOW-LIST: its return is an object literal, and a key absent from that literal
is DESTROYED ON EVERY READ. That is not an accident of the implementation — it is
the mechanism B5 Task 9 used on purpose to delete fourteen legacy sections, and
the mechanism that deleted `engineEnabled` at seven sites. A user definition
stored under a new `chart_settings` key would therefore survive exactly until the
next read, and NOTHING would say so.

`tests/test_user_definitions.py` proves that by RUNNING the shipped function
under node and asserting the key is gone while a sibling key survives — a control
that keeps "the key is gone" from being satisfied by a merge that ran on nothing.

────────────────────────────────────────────────────────────────────────────────
WHY NOT `user_preferences` — ALSO MEASURED
────────────────────────────────────────────────────────────────────────────────
`user_preferences` has NO SIZE LIMIT and NO DELETE ROUTE. A store for content a
user can author in a loop needs both, and inheriting neither is how a table
becomes unbounded quietly. This store names its caps (`MAX_DEFINITION_BYTES`,
`MAX_DEFINITIONS_PER_USER`) and ships a delete.

────────────────────────────────────────────────────────────────────────────────
THE PRECEDENT IT IS MODELLED ON
────────────────────────────────────────────────────────────────────────────────
`api/services/charts_layout_service.py` — the shipped store for user-authored
content: its own file, WAL, `_WRITE_LOCK` on writes, `contextlib.closing` on
every connection (Windows teardown holds WAL sidecars open otherwise), and a
`UNIQUE(scope, user_id, name)` that makes the identity a property of the schema.
This file keeps that shape and changes exactly one thing: the UNIQUE key carries
`version`, because this store never replaces a row.

────────────────────────────────────────────────────────────────────────────────
APPEND-ONLY, AND WHAT MAKES THE CLAIM TOTAL
────────────────────────────────────────────────────────────────────────────────
Spec §3.1: alerts, screens and the ledger pin `defId@version` freely. A pin is
only free if the row it points at CANNOT CHANGE UNDER ITS HOLDER. So:

  * every save INSERTs a new `version`; no statement in this module UPDATEs a
    `user_definitions` row, and that is asserted by an AST walk over this
    module's own source rather than by grep (this docstring says the word
    "UPDATE" three times on purpose);
  * `soft_delete` APPENDS A TOMBSTONE VERSION rather than stamping `deleted_at`
    on the rows already written. A delete that rewrote history would be the one
    UPDATE, and it would land on exactly the rows a pin points at;
  * there are NO TRIGGERS. `sqlite_master` is read and asserted trigger-free, so
    "nothing rewrote the row" is a property of the file and not of this module's
    good behaviour.

────────────────────────────────────────────────────────────────────────────────
`version` vs `rev` — TWO NUMBERS, AND THE SECOND ONE IS THE DANGEROUS ONE
────────────────────────────────────────────────────────────────────────────────
`version` is PRESENTATION and increments on EVERY save (a rename, a colour, a
tooltip). `rev` is MATHS and increments IFF `ast_hash` moved. Deriving `rev` from
the hash removes an entire class of "the user forgot to bump it", and it is one
assertion in both directions.

⭐ AND A `rev` BUMP CALLS PHASE C, IT DOES NOT REBUILD IT. `save()` calls
`alert_rev_migration.migrate_bindings_to_rev` — the same function, the same
`last_value` reset, the same notification, the same first-cycle suppression.
Phase C's own record notes that path *"has no population to act on today"*; a
user editing their own formula IS its first real population, and it arrives with
no deploy to hang it on.

⚠️ THE SUPPRESSION IS THE LOAD-BEARING HALF AND IT IS NOT INTERCHANGEABLE WITH
THE RESET. The reset covers the crossings (`cross_*` needs a `prev`, and a NULL
`prev` returns False). It does NOT cover `above`/`below`, which never read `prev`
at all — so without `suppress_first_cycle`, every level binding on the edited
definition fires at once on the first cycle after the edit and the user is told a
level was crossed BECAUSE THE ANCHOR MOVED.

⛔ THE MIGRATION RUNS BEFORE THE APPEND, AND THE ORDER IS THE SAFE DIRECTION.
Over-migrating costs one eaten cycle and one notice. Under-migrating fabricates a
crossing, which is the harm the whole mechanism exists to prevent. So if only one
of the two can land, it must be the migration. In practice the window is a local
SQLite INSERT and `migrate_bindings_to_rev` does not raise on a failed notice (it
COUNTS it), so the ordering is a statement about the failure direction rather
than about a likely event.

────────────────────────────────────────────────────────────────────────────────
`repaint` IS STORED, NOT RECOMPUTED AT READ TIME
────────────────────────────────────────────────────────────────────────────────
The badge a user was SHOWN when they saved, and the badge an alert was admitted
under, must be the SAME FACT. Recomputing at read time means a linter improvement
silently re-badges a definition somebody already armed, and the receipts claim
becomes a moving target. A linter change therefore requires an explicit re-lint
pass with its own notification — a Phase-E problem, named here so it is not
discovered there.

⭐ THAT PASS EXISTS NOW, AND IT IS `api/services/user_definition_relint.py`.
Run it after ANY change to `ast_lint` or to `closedTable.json`:

    python -m api.services.user_definition_relint [--dry-run]

It heals only the direction that is safe (a stored badge STRICTER than the
linter now is — nothing was ever admitted under a looser claim), reports the
dangerous direction with the armed alert ids rather than flipping it, and
touches only the newest live row. ⛔ It is a COMMAND, never a hook: nothing in
this module imports it, and nothing may. The paragraph above is the reason.

⚠️ AND THE ONE ESCAPE A MEMBER MIGHT TRY DOES NOT WORK — a byte-identical
re-save returns before the append carrying the PREVIOUS row's `repaint`, so a
user cannot re-save their way out of a stale badge. That is correct for growth
and it is why the pass has to exist.

────────────────────────────────────────────────────────────────────────────────
WHAT BOUNDS THIS STORE'S GROWTH — AND WHAT DOES NOT
────────────────────────────────────────────────────────────────────────────────
BOUNDED, by refusal:
  * one row: `MAX_DEFINITION_BYTES` (64 KiB) on the canonical JSON. Above it the
    save RAISES; nothing is stored truncated.
  * live definitions per user: `MAX_DEFINITIONS_PER_USER` (50). A 51st CREATE
    raises; an edit of an existing one never does (an editor that could not save
    because the user is at the cap is a data-loss bug wearing a quota costume).
  * a byte-identical re-save appends NOTHING and returns the existing version.
    That is the one growth class an autosaving editor actually produces, and it
    is closed by construction rather than by a prune.

NOT BOUNDED, stated plainly: **the number of VERSIONS of one definition.** Nothing
in this module prunes, and nothing outside it does either. Worst case per user is
`MAX_DEFINITIONS_PER_USER × MAX_DEFINITION_BYTES × (distinct edits)` = 3.2 MB per
edit-generation, unbounded in the third factor.

⛔ AND THE PRUNE IS DELIBERATELY NOT WRITTEN HERE, because a version cap is not a
retention policy — it is a way to break a pin. `defId@version` is pinned by
alerts, screens and the ledger, and none of them are enumerable from this module.
A retention policy needs to know which versions are REACHABLE, and that registry
does not exist yet. `stats()` exists so the growth is OBSERVABLE while it is
unbounded, which is the honest interim: two tables in this lane already grow
unbounded with nobody watching them.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from typing import Any, Optional

# ─── caps ────────────────────────────────────────────────────────────────────

#: One definition's canonical JSON, in bytes. 64 KiB is ~1,000 lines of formula
#: and plot metadata; the point of the number is that there IS one, because the
#: store this replaced (`user_preferences`) has none.
MAX_DEFINITION_BYTES = 64 * 1024

#: Live (non-tombstoned) definitions per user.
MAX_DEFINITIONS_PER_USER = 50

#: ⭐ THE ID NAMESPACE, AND THE SHAPE IS FORCED, NOT CHOSEN.
#:
#: `defSchema.ID_RE` is `/^[A-Za-z0-9][A-Za-z0-9_-]*$/` — NO DOTS, because plots
#: are addressed `defId.plotKey` and a dot in an id makes that address
#: ambiguous. `u_` + 12 hex is inside that grammar, is fixed-width, and carries
#: 48 bits of entropy.
#:
#: ⛔ THE PREFIX'S NON-COLLISION IS ASSERTED AGAINST THE LIVE REGISTRY, NEVER
#: AGAINST A TYPED LIST OF IDS. A typed list of ids is exactly the probe-name
#: class that produced four false alarms in one session
#: ([[lesson_probe_names_must_be_derived_not_typed]]) — so the test imports
#: `nativeRegistry.listDefinitions()` through node and reads the ids off it.
DEF_ID_PREFIX = "u_"
DEF_ID_RE = re.compile(r"^u_[0-9a-f]{12}$")

#: The revision a definition's maths starts at. Same number, same meaning, as
#: `alert_rev_migration.DEFAULT_REV` — asserted equal in the tests rather than
#: imported, because importing it would make a divergence invisible.
FIRST_REV = 1

_DB_PATH = os.environ.get("USER_DEFINITIONS_DB_PATH", "/data/user_definitions.db")
_WRITE_LOCK = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS user_definitions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT    NOT NULL,
  def_id       TEXT    NOT NULL,
  version      INTEGER NOT NULL,
  rev          INTEGER NOT NULL,
  ast_hash     TEXT    NOT NULL,
  definition   TEXT    NOT NULL,
  repaint      TEXT    NOT NULL,
  deleted_at   INTEGER,
  created_at   INTEGER NOT NULL,
  UNIQUE(user_id, def_id, version)
);
CREATE INDEX IF NOT EXISTS idx_user_definitions_owner
  ON user_definitions(user_id, def_id, version DESC);
"""


def _connect() -> sqlite3.Connection:
    """A connection with the web pod's settings, and NOT a longer timeout.

    ⚠️ THE WEB POD IS ONE UVICORN PROCESS with a 64-slot anyio threadpool, and
    `auth.db`'s `busy_timeout` is deliberately 2 s: a high value compounds with
    the retry loop and saturates the pool. A scale review measured ZERO
    SQLITE_BUSY under a 5,000-alert cycle with short transactions + WAL, so this
    file copies that posture exactly — short transactions, WAL, 2 s, and no
    network call inside a write.
    """
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=2000")
    return conn


def _init_db() -> None:
    parent = os.path.dirname(_DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with contextlib.closing(_connect()) as c:
        c.executescript(_SCHEMA)
        c.commit()


def _ensure(c: sqlite3.Connection) -> None:
    c.executescript(_SCHEMA)


# ─── the hash that decides a rev bump ────────────────────────────────────────
#
# ⭐ THE PYTHON HALF OF A NUMBER AUTHORED IN JAVASCRIPT. `astHash` lives in
# `app/src/components/chart/engine/ast/parse.js` and Phase D Task 3 shipped it
# with NO CALLER — the number that decides a `compute.rev` bump was proven stable
# and never used. This is its first real caller, and the store needs it
# server-side, so the algorithm is mirrored here and PINNED to the JS lane by
# running both over the same corpus (`test_the_python_ast_hash_IS_the_js_one`).
#
# ⛔ IT IS A MIRROR, NOT A SECOND DESIGN. A second hash would be a second
# vocabulary for the one number a migration keys on.

_CANONICAL_KEYS: dict[str, tuple[str, ...]] = {
    "num": ("type", "value"),
    "series": ("type", "name"),
    "op": ("type", "name", "args"),
    "call": ("type", "name", "args"),
    # ⭐ THE BOUNDED BACKWARD OFFSET — `EXPR[N]`. ⚠️ NO `name`: an offset is not
    # a named thing, the bar count IS the node. Without this row the STORE is
    # the door that refuses the feature: `assert_canonical` runs on every save,
    # so a definition containing `close[1]` would parse, lint, evaluate and read
    # back correctly in both lanes and then fail to persist — the "built, tested,
    # green and connected to nothing" shape, one door further along than usual.
    "offset": ("type", "value", "args"),
}
NODE_TYPES = tuple(_CANONICAL_KEYS)


def assert_canonical(ast: Any) -> Any:
    """The tree really is one of the four shapes, with exactly its own keys.

    Iterative, never recursive: the hash is taken of a PERSISTED artifact — a
    blob that arrived over a wire or out of a database — and a deep tree must
    fail on its shape, never inside the checker.
    """
    stack = [ast]
    while stack:
        node = stack.pop()
        if not isinstance(node, dict):
            raise ValueError(f"astHash: not a canonical node: {node!r}")
        expected = _CANONICAL_KEYS.get(node.get("type"))
        if not expected:
            raise ValueError(
                f"astHash: node type {node.get('type')!r} is not one of "
                f"{', '.join(NODE_TYPES)}")
        keys = sorted(node)
        want = sorted(expected)
        if keys != want:
            raise ValueError(
                f"astHash: a {node['type']} node must carry exactly [{','.join(want)}] "
                f"— got [{','.join(keys)}]")
        if "args" in node:
            if not isinstance(node["args"], list):
                raise ValueError("astHash: `args` must be an array")
            stack.extend(node["args"])
    return ast


def stable_stringify(value: Any) -> str:
    """Canonical JSON: keys SORTED, no whitespace, and NOTHING optional.

    ⛔ `type(v) is bool` IS CHECKED BEFORE `int`, AND THAT IS NOT PEDANTRY.
    `True == 1`, `isinstance(True, int)` is True, and `True in (0, 1)` is True —
    a bool sails through every obvious numeric guard (Phase D Task 5 measured
    exactly this trap). JS has no bool branch in `stableStringify` either: a
    boolean falls through to the throw. Same refusal, same reason.

    ⚠️ AND AN INTEGRAL FLOAT SERIALISES AS AN INTEGER, because JS has one number
    type: `JSON.stringify(20.0)` is `"20"` while `json.dumps(20.0)` is `"20.0"`.
    Without this line the two lanes disagree on a hash the moment a caller hands
    Python a float — which is what a JSON round-trip through a form field does.
    """
    if isinstance(value, list):
        return "[" + ",".join(stable_stringify(v) for v in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(
            f"{json.dumps(k, ensure_ascii=False)}:{stable_stringify(value[k])}"
            for k in sorted(value)) + "}"
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if type(value) is bool:
        raise ValueError(
            "astHash: a canonical tree carries strings, finite numbers, arrays "
            "and objects only — got a boolean")
    if isinstance(value, (int, float)):
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError(
                f"astHash: {value} has no JSON form; a canonical tree carries "
                "finite numbers only")
        if isinstance(value, float) and value.is_integer():
            return json.dumps(int(value))
        return json.dumps(value)
    raise ValueError(
        "astHash: a canonical tree carries strings, finite numbers, arrays and "
        f"objects only — got {type(value).__name__}")


def ast_hash(ast: Any) -> str:
    """`'sha256:<64 hex>'` over the canonical JSON of a canonical tree.

    ⭐ THIS HASH DECIDES WHETHER AN EDIT BUMPS `rev`, and a rev bump
    force-migrates every binding, resets `last_value` and eats a cycle. An
    UNSTABLE hash migrates a user's alerts on a save that changed nothing; a
    hash that MISSES a change fabricates a crossing. Both directions are pinned.
    """
    assert_canonical(ast)
    return "sha256:" + hashlib.sha256(
        stable_stringify(ast).encode("utf-8")).hexdigest()


# ─── definition v2: MANY TREES, ONE SCAN ─────────────────────────────────────
#
# ⭐ THE ADDITIVE HALF OF A DEFINITION'S IDENTITY. `compute.fn` stays
# `ast_hash(compute.ast)` — the SCAN tree — so `scan_definition.def_hash`, every
# `scan_hits` key and every alert binding are byte-identical to what they were
# before multi-plot existed. `treesHash` is the SECOND identity, over every
# plot's tree, and it exists for change detection and the `compute.rev`
# migration; it never replaces the first.
#
# ⛔ THIS IS A MIRROR, AND THE ONLY HONEST TEST OF A MIRROR IS THE OTHER LANE.
# `app/src/components/chart/engine/ast/trees.js` (`assertTrees`, `treesHash`) and
# `engine/defSchema.js` (`validateTrees`, `validateTreesAgainstPlots`) are the
# browser halves; the sentences below are theirs, not paraphrases, because a
# member who is refused in the editor and again at the API must read one
# sentence. `tests/fixtures/ast/multi_tree_parity.json` pins ONE `treesHash`
# string and `tests/test_ast_multi_tree_parity.py` runs the SHIPPED `trees.js`
# under node to hold both lanes to it — so a drift in either hasher goes red,
# from either side.
#
# ⚠️ ONE ASYMMETRY, NAMED RATHER THAN HIDDEN: the browser also re-parses every
# `compute.sources[k]` and checks it hashes to `trees[k]`. There is exactly one
# parser and it is in JS (D-A1), so this lane CANNOT do that and does not
# pretend to. What it checks instead is everything that is decidable without a
# parser, which is every rule but that one.

_PLOT_KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")

#: The v2 keys. A single-tree document carries NONE of them — a rule with a
#: refusal behind it, mirroring `defSchema.V2_COMPUTE_KEYS`.
_V2_COMPUTE_KEYS = ("trees", "treesHash", "scanPlot", "sources")


def _assert_trees(trees: Any) -> list:
    """The plot keys, SORTED — `trees.js::assertTrees`, sentence for sentence.

    ⛔ `None` IS REFUSED, NEVER READ AS "ABSENT". Python collapses `undefined` and
    `null` onto one value, so presence must be asked with `in` at the call site
    (`validate_v2` does) and a `trees` that IS `None` arrives here to be refused
    by name. Reading it as absent would validate a document carrying `scanPlot`,
    `treesHash` and `sources` as if it were single-tree, and the refusal a member
    finally saw would name the wrong field.

    ⛔ AND A ONE-KEY MAP IS LEGAL HERE. That rule belongs to `validate_v2` (and to
    `defSchema.validateTrees`), not to the shape check: `trees_hash` calls this,
    and refusing a one-key map here would make this lane decline to hash a map the
    browser hashes happily — two identities disagreeing about a legal input.
    """
    if not isinstance(trees, dict):
        got = ("null" if trees is None
               else "an array" if isinstance(trees, (list, tuple))
               else type(trees).__name__)
        raise ValueError(
            f"compute.trees: expected an object of plotKey → canonical tree, got {got}")
    keys = sorted(trees)
    if not keys:
        raise ValueError("compute.trees: an empty trees map names no plot")
    for k in keys:
        if not isinstance(k, str) or not _PLOT_KEY_RE.match(k):
            raise ValueError(
                f"compute.trees: {json.dumps(k, ensure_ascii=False)} is not a legal plot "
                f"key ({_PLOT_KEY_RE.pattern})")
    return keys


def trees_hash(trees: Any) -> str:
    """``'sha256:<hex>'`` over ``"<key>":<ast_hash(tree)>`` pairs, keys sorted, comma-joined.

    Byte for byte what ``engine/ast/trees.js::treesHash`` computes, and the shared
    fixture pins one string both lanes reproduce. Two facts make the two lanes
    agree without a collation rule or a second serialiser: each pair carries
    ``ast_hash``'s FULL ``'sha256:<hex>'`` value (the prefix is INSIDE the hashed
    text), and `_PLOT_KEY_RE` keeps every key ASCII, so JS's UTF-16 sort and
    Python's ``sorted()`` order them identically.

    ⛔ IT IS NOT ``ast_hash([[key, tree], …])``: ``ast_hash`` asserts a canonical
    NODE and a pair list is not one. The map is hashed THROUGH ``ast_hash`` so
    neither lane needs a second ``stable_stringify``.
    """
    keys = _assert_trees(trees)
    pairs = []
    for k in keys:
        try:
            h = ast_hash(trees[k])
        except ValueError as exc:
            # The JS wrapper's sentence, verbatim — a member reads WHICH tree.
            raise ValueError(f"compute.trees.{k}: {exc}") from exc
        pairs.append(f"{json.dumps(k, ensure_ascii=False)}:{h}")
    return "sha256:" + hashlib.sha256(",".join(pairs).encode("utf-8")).hexdigest()


def validate_v2(definition: dict) -> None:
    """The rules `defSchema.validateAstCompute` / `validateTrees` /
    `validateTreesAgainstPlots` apply in the browser, applied again at the LAST
    door before a sweep files results under this name.

    ⛔ IT IS NOT BELT-AND-BRACES. A definition arrives here as a blob over a wire;
    the browser's validation is a property of one client at one version, and the
    thing being protected — a results table keyed on `def_hash` — is shared by
    every member. A document whose stored `fn` disagreed with its tree would file
    one formula's answers under another formula's name, silently, forever.

    Raises ``ValueError`` whose FIRST TOKEN is the field path, because that is
    what a member reads: `lesson_rail_the_sentence_not_just_the_guard` — a test
    that only asserts something raised is green on a refusal that names the wrong
    cause, and naming the wrong cause is worse than being vague.
    """
    compute = definition.get("compute") or {}
    own_hash = ast_hash(compute.get("ast"))

    # ⚠️ WIDENED, NOT DROPPED: an EMPTY or absent `fn` is not checked here. The
    # browser requires a non-empty `fn` on every `ast` document; this lane has
    # shipped documents without one (`scan_definition.def_hash` has always
    # tolerated it), so the rule enforced here is the one that matters —
    # a handle that is PRESENT and DISAGREES.
    fn = compute.get("fn")
    if isinstance(fn, str) and fn and fn != own_hash:
        raise ValueError(
            f"compute.fn: an 'ast' definition's compute handle IS its astHash — expected "
            f"{own_hash!r}, got {fn!r}. The tree is the implementation, so there is no third "
            "thing for the handle to name; a stored handle that disagrees files this formula's "
            "answers under another name")

    # ⛔ `in`, NEVER `.get()` — see `_assert_trees`. `{"trees": None}` is a
    # MULTI-TREE document with a broken map, not a single-tree one.
    if "trees" not in compute:
        for k in _V2_COMPUTE_KEYS:
            if k == "trees" or k not in compute:
                continue
            raise ValueError(
                f"compute.{k}: only a multi-tree document (one carrying compute.trees) may "
                f"declare it — got {compute[k]!r} beside no trees. A single-tree document is "
                "byte-identical to a schema-1 one on purpose, so no v2 key may ride on it alone")
        return

    trees = compute["trees"]
    keys = _assert_trees(trees)
    if len(keys) == 1:
        raise ValueError(
            f"compute.trees: one tree is compute.ast — a single-tree document carries no trees "
            f"map (it is byte-identical to a schema-1 document on purpose), so drop "
            f"trees/treesHash/scanPlot/sources or add a second plot. Got the one key {keys[0]!r}")

    hashes = {}
    for k in keys:
        try:
            hashes[k] = ast_hash(trees[k])
        except ValueError as exc:
            raise ValueError(
                f"compute.trees.{k}: not a canonical tree ({exc}) — every plot's tree is "
                "persisted in the same four-shape form as compute.ast") from exc

    scan = compute.get("scanPlot")
    if not isinstance(scan, str) or scan not in hashes:
        raise ValueError(
            f"compute.scanPlot: must name one key of compute.trees ({', '.join(keys)}) — the plot "
            f"whose tree IS compute.ast — got {scan!r}")
    if own_hash != hashes[scan]:
        raise ValueError(
            f"compute.ast: must BE compute.trees.{scan} — the scan tree is an ALIAS of the plot "
            f"scanPlot names, which is what keeps def_hash still; here compute.ast hashes to "
            f"{own_hash} and trees.{scan} to {hashes[scan]}")

    expected = trees_hash(trees)
    if compute.get("treesHash") != expected:
        raise ValueError(
            f"compute.treesHash: expected {expected!r} (sha256 over the sorted \"key\":astHash "
            f"pairs — ast/trees.js), got {compute.get('treesHash')!r}. The hash is checked, never "
            "trusted, for the same reason compute.fn is")

    # ── the plots, in BOTH directions, and duplicates on their own ───────────
    plots = definition.get("plots") or []
    data = [str(p.get("key")) for p in plots
            if isinstance(p, dict) and p.get("style") != "hlines"
            and isinstance(p.get("key"), str) and p.get("key")]
    # ⛔ THE DUPLICATE GETS ITS OWN SENTENCE. A set-vs-set comparison cannot see
    # it at all, and the two directional sentences below would name the wrong
    # cause ("a plot with no tree") for a document whose every plot HAS a tree.
    # The browser refuses it a field earlier, at `plots[i].key`, because it
    # validates the plots array; this lane does not, so the rule lands here.
    dupes = sorted({k for k in data if data.count(k) > 1})
    if dupes:
        raise ValueError(
            f"plots: duplicate data-bearing plot key(s) {', '.join(dupes)} — a plot key NAMES a "
            "compute column, so a second plot under the same key draws the first one's column "
            "and the definition renders one fewer series than it declares")
    for k in data:
        if k not in hashes:
            raise ValueError(
                f"plots: data-bearing plot {k!r} has no tree in compute.trees "
                f"({', '.join(keys)}) — a plot with no tree is a key nothing ever fills")
    for k in keys:
        if k not in data:
            raise ValueError(
                f"compute.trees.{k}: names no data-bearing plot (plots: {', '.join(data) or 'none'}) "
                "— a tree with no plot is computed for nobody")

    # ── the sources ──────────────────────────────────────────────────────────
    # REQUIRED and COMPLETE, for the reason `compute.source` is required at all:
    # a tree the sheet cannot print back is a formula no author can ever reopen.
    sources = compute.get("sources")
    if "sources" not in compute or sources is None:
        raise ValueError(
            "compute.sources: a multi-tree document must carry the source text of EVERY tree "
            "({plotKey: source}) — compute.source is one string, the scan tree's, and a tree "
            "with no text is a formula no author can ever reopen")
    if not isinstance(sources, dict):
        raise ValueError(
            f"compute.sources: expected an object of plotKey → source text, got {sources!r}")
    for k in keys:
        if k not in sources:
            raise ValueError(
                f"compute.sources.{k}: missing — every tree carries the text the member edits "
                f"(trees: {', '.join(keys)})")
    for k in sorted(sources):
        if k not in hashes:
            raise ValueError(
                f"compute.sources.{k}: names no tree (trees: {', '.join(keys)})")
        if not isinstance(sources[k], str) or not sources[k].strip():
            raise ValueError(
                f"compute.sources.{k}: expected the source text the member edits, got "
                f"{sources[k]!r}")
    if sources.get(scan) != compute.get("source"):
        raise ValueError(
            f"compute.sources.{scan}: must equal compute.source — one text for the scan tree, "
            "never two that agree today")


# ─── the linter verdict, stored at save time ─────────────────────────────────

def lint_verdict(definition: dict) -> dict:
    """`{plotKey: mode}` from the SHIPPED linter — per plot, per the owner's ruling.

    ⛔ CALLED, NOT REIMPLEMENTED. `ast_lint.lint_definition` is the measurement
    (Phase D Task 7); this stores what it says. Per PLOT rather than per
    definition because that is the granularity the owner ruled on and the shape
    `lint_definition` already returns.
    """
    from api.services import ast_lint
    rows = ast_lint.lint_definition(definition)["plots"]
    return {r["plotKey"]: r["mode"] for r in rows}


# ─── ids ─────────────────────────────────────────────────────────────────────

def new_def_id() -> str:
    """A fresh `u_<12 hex>` id."""
    return DEF_ID_PREFIX + secrets.token_hex(6)


def _check_def_id(def_id: str) -> str:
    if not isinstance(def_id, str) or not DEF_ID_RE.match(def_id):
        raise ValueError(
            f"def_id {def_id!r} is not in the user namespace — a user definition "
            f"id is {DEF_ID_PREFIX}<12 hex>, which is dot-free so `defId.plotKey` "
            "stays unambiguous")
    return def_id


# ─── rows ────────────────────────────────────────────────────────────────────

def _row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "user_id": row["user_id"],
        "def_id": row["def_id"],
        "version": row["version"],
        "rev": row["rev"],
        "ast_hash": row["ast_hash"],
        "definition": json.loads(row["definition"]),
        "repaint": json.loads(row["repaint"]),
        "deleted_at": row["deleted_at"],
        "created_at": row["created_at"],
    }


def _newest(c: sqlite3.Connection, user_id: Any, def_id: str) -> Optional[sqlite3.Row]:
    return c.execute(
        "SELECT * FROM user_definitions WHERE user_id=? AND def_id=? "
        "ORDER BY version DESC LIMIT 1",
        (str(user_id), def_id),
    ).fetchone()


def _live_def_count(c: sqlite3.Connection, user_id: Any) -> int:
    """Definitions whose NEWEST version is not a tombstone."""
    return c.execute(
        "SELECT COUNT(*) FROM ("
        "  SELECT def_id, deleted_at FROM user_definitions u"
        "   WHERE user_id=? AND version = ("
        "     SELECT MAX(version) FROM user_definitions v"
        "      WHERE v.user_id=u.user_id AND v.def_id=u.def_id)"
        ") WHERE deleted_at IS NULL",
        (str(user_id),),
    ).fetchone()[0]


# ─── the write path ──────────────────────────────────────────────────────────

def save(user_id: Any, def_id: str, definition: dict,
         limits: Any = None) -> dict:
    """Append a version. Bump `rev` iff the maths moved, and MIGRATE if it did.

    Returns ``{def_id, version, rev, rev_bumped, migrated, notified, ast_hash,
    repaint, appended}``.

    ⭐ `limits` IS THE CALLER'S TOOLKIT (`entitlements.Limits`), AND IT DECIDES THE
    COUNT CAP. ``None`` means "the default toolkit", whose `max_definitions` IS
    `MAX_DEFINITIONS_PER_USER` — so an un-wired caller behaves exactly as this
    store always has, and the day the owner sets a real number the only thing that
    changes is which `Limits` the route hands in.

    ⛔ THE CAP IS AN ENTITLEMENT DECISION NOW, NOT A LOCAL CONSTANT COMPARISON, AND
    THAT IS A CATEGORY CHANGE RATHER THAN A REFACTOR. `MAX_DEFINITIONS_PER_USER` is
    a CAPACITY bound — ops may tune it. A toolkit's `max_definitions` is a BILLING
    CONTRACT. They are the same number today on purpose (see
    `entitlements.TOOLKITS`), and the test that a DOWNGRADE actually shrinks the
    answer is what makes this an entitlement rather than a constant with a new
    spelling.

    ⛔ THERE IS NO INJECTION POINT FOR THE MIGRATION OR THE NOTIFIER, ON PURPOSE.
    `lesson_injected_dependency_hides_the_fetch`: 996 green tests shipped a
    feature that ran in 0 of 24 charts because every test handed in a fake. The
    migration is imported and called by name; the notifier is Phase C's own
    production transport. A test that wants to observe a notice spies the
    TRANSPORT (`watchlist_alert_service.deliver_alert_payload`), which is the
    same thing a real delivery goes through.
    """
    from api.services import alert_rev_migration
    # ⚠️ FUNCTION-LOCAL, AND IT IS THE CYCLE, NOT A STYLE. `entitlements.TOOLKITS`
    # reads `MAX_DEFINITIONS_PER_USER` off THIS module at import, so a top-level
    # import here would break whichever of the two is imported second.
    from api.services import entitlements

    _check_def_id(def_id)
    if not isinstance(definition, dict):
        raise ValueError(f"definition: expected an object, got {type(definition).__name__}")
    if definition.get("id") not in (None, def_id):
        raise ValueError(
            f"definition.id is {definition.get('id')!r} but it is being stored at "
            f"{def_id!r} — an address that disagrees with the document it names "
            "makes `defId.plotKey` resolve to two different things")

    compute = definition.get("compute")
    if not isinstance(compute, dict) or compute.get("kind") != "ast":
        raise ValueError(
            "definition: a user definition is a FORMULA — compute.kind must be "
            f"'ast', got {(compute or {}).get('kind')!r}")

    # The hash comes off the tree BEFORE anything is written, so a tree this
    # lane cannot hash is refused rather than stored with a hash nobody can
    # reproduce. `assert_canonical` runs inside `ast_hash`.
    new_hash = ast_hash(compute.get("ast"))

    # ⭐ THE LAST DOOR, AND IT IS NOT THE BROWSER'S. `validate_v2` re-applies
    # `defSchema`'s compute rules here because the browser's validation is a
    # property of one client at one version, while `def_hash` keys a results
    # table every member shares. It runs on EVERY document: on a v1 one it
    # checks the `fn`/tree agreement and that no v2 key rides alone, which is
    # why it is placed here rather than behind a `if trees` branch.
    validate_v2(definition)

    blob = json.dumps(definition, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False)
    size = len(blob.encode("utf-8"))
    if size > MAX_DEFINITION_BYTES:
        raise ValueError(
            f"definition exceeds {MAX_DEFINITION_BYTES} bytes ({size}) — this "
            "store names its caps rather than inheriting `user_preferences`', "
            "which has none")

    repaint = json.dumps(lint_verdict(definition), sort_keys=True,
                         separators=(",", ":"))
    now = int(time.time())

    # ── phase 1: decide. Short, locked, no network. ──────────────────────────
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        _ensure(c)
        prev = _newest(c, user_id, def_id)

        # ⚠️ THE CAP IS CHECKED WHENEVER A SAVE WOULD MAKE A DEFINITION LIVE THAT
        # IS NOT LIVE NOW — a create OR a RESURRECT. Checking only `prev is None`
        # leaves the cap trivially bypassable: delete fifty, create fifty, then
        # re-save the fifty tombstones and stand at a hundred.
        if prev is None or prev["deleted_at"] is not None:
            # ⛔ THE COUNT IS READ INSIDE THE LOCK AND THE VERDICT IS THE
            # TOOLKIT'S. `check_definition_count` RAISES a `ToolkitLimitExceeded`,
            # which IS a `ValueError`, so the router's `_save_or_400` turns it into
            # the same 400 carrying the store's own sentence.
            entitlements.check_definition_count(
                _live_def_count(c, user_id), limits)

        if prev is None:
            prev_version = prior_rev = None
            version, rev, rev_bumped = 1, FIRST_REV, False
        else:
            # ⚠️ A BYTE-IDENTICAL RE-SAVE IS NOT AN EDIT. An autosaving editor is
            # the one growth class that actually runs away, and it is closed
            # here rather than by a prune that would break a pin.
            if prev["definition"] == blob and prev["deleted_at"] is None:
                return {
                    "def_id": def_id, "version": prev["version"], "rev": prev["rev"],
                    "rev_bumped": False, "migrated": 0, "notified": 0,
                    "bindings_on_this_tree": 0,
                    "ast_hash": prev["ast_hash"], "repaint": json.loads(prev["repaint"]),
                    "appended": False,
                }
            prev_version = prev["version"]
            prior_rev = prev["rev"]
            version = prev["version"] + 1
            rev_bumped = prev["ast_hash"] != new_hash
            rev = prev["rev"] + 1 if rev_bumped else prev["rev"]

    # ── phase 2: MIGRATE — outside the lock, because it delivers ─────────────
    #
    # ⭐ PHASE C'S MECHANISM, CALLED — AND BEFORE THE APPEND.
    #
    # Over-migrating costs one eaten cycle and one notice; under-migrating
    # fabricates a crossing. If only one of the two writes can land it must be
    # this one. `migrate_bindings_to_rev` is idempotent, so a retry of the same
    # edit re-runs it as a no-op.
    #
    # ⛔ AND IT IS OUTSIDE `_WRITE_LOCK` BECAUSE IT SENDS EMAIL AND DISCORD.
    # `deliver_alert_payload` is synchronous multi-channel I/O; holding a
    # process-wide store lock across it would serialise every other user's save
    # behind one member's outbound network.
    #
    # 🔴 `def_hash` AND `prior_rev` ARE WHAT MAKE THIS A RECONCILIATION RATHER
    # THAN A TRANSITION, AND THE GAP THEY CLOSE WAS REAL AND NAMED TWICE BEFORE
    # IT WAS SHUT.
    #
    # `rev` is `prev["rev"] + 1` — derived from the STORED predecessor. So if this
    # migration lands and the append in phase 3 then FAILS, the predecessor does
    # not move, and the user's NEXT edit — a completely different formula —
    # computes the SAME `rev`. Keyed on the number alone, the migration read that
    # as "already migrated", skipped it, and the second edit reached every binding
    # with no `last_value` reset and no first-cycle suppression: the fabricated
    # crossing, arriving through the mechanism built to prevent it. Passing the
    # tree's own `ast_hash` makes the question *"are these bindings already on
    # THIS tree"* instead of *"on this NUMBER"*.
    #
    # `prior_rev` is the other side of the same gap. A binding created AFTER a
    # migration has no `indicator_alert_rev` row, so `from_rev` fell back to
    # `DEFAULT_REV` and the notice told its owner "revision 1 → 4" about an alert
    # armed at revision 3. `prev["rev"]` is that binding's true arm-time revision:
    # every rev bump migrates, and a migration records every binding that existed,
    # so an unrecorded binding can only have been created since the last bump.
    migrated = notified = 0
    if rev_bumped:
        result = alert_rev_migration.migrate_bindings_to_rev(
            def_id, rev,
            notify=alert_rev_migration.deliver_migration_notice,
            def_hash=new_hash,
            prior_rev=prior_rev,
        )
        migrated = result["migrated"]
        notified = result["notified"]

    # ── phase 3: append. Short, locked, no network. ──────────────────────────
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        _ensure(c)
        # ⚠️ RE-READ, because the lock was released for the delivery. A version
        # that moved under us means a concurrent save; the refusal is VISIBLE
        # rather than an INSERT computed against a stale predecessor.
        now_prev = _newest(c, user_id, def_id)
        seen = None if now_prev is None else now_prev["version"]
        if seen != prev_version:
            raise ValueError(
                f"{def_id} was saved concurrently (expected version {prev_version}, "
                f"found {seen}) — retry the edit against the current version")
        c.execute(
            "INSERT INTO user_definitions "
            "(user_id, def_id, version, rev, ast_hash, definition, repaint, "
            " deleted_at, created_at) VALUES (?,?,?,?,?,?,?,NULL,?)",
            (str(user_id), def_id, version, rev, new_hash, blob, repaint, now),
        )
        c.commit()

    # ── phase 4: FORGET. The registry holds a CAPTURED tree; this row replaces it.
    #
    # 🔴 THIS CALL DID NOT EXIST, AND `alert_user_series.forget` HAD NO PRODUCTION
    # CALL SITE AT ALL (AST-verified over `api/**`, `tools/**`, `tests/**`: every
    # caller was a test). `_make_value_fn` CAPTURES the tree and `USER_FUNCS` is
    # keyed `(user_id, address)` with NO version in the key, so after an edit the
    # registry kept serving the SAME FUNCTION OBJECT — measured end to end:
    # `rev_bumped=True`, the migration notice delivered, and then `sma20` still
    # reading rev-1's 112.685 instead of rev-2's 111.4522, forever, until the pod
    # restarted. A member is told *"you have been switched to new maths"* and then
    # evaluated on the old. `user_value_function`'s own docstring already asserted
    # this call happened (*"gets a new `ast_hash`, a `compute.rev` bump and a
    # `forget`"*); it is true now.
    #
    # ⛔ ON EVERY APPEND, NOT ONLY ON A `rev` BUMP — and that is a MEASURED
    # widening of the one-line fix, not a flourish. What is captured is the whole
    # `definition`, and `_inputs_for` reads `definition["inputs"]` out of that
    # capture on every evaluation. `ast_hash` covers `compute.ast` ONLY, so
    # changing an input's DEFAULT moves what the formula computes and bumps
    # nothing — the identical staleness with no rev to hang it on. A byte-identical
    # re-save returns above without reaching here, which is the one case that must
    # not forget.
    #
    # ⛔ AND AFTER THE APPEND, NOT BEFORE IT. Forgetting first opens a window in
    # which a concurrent read rebuilds from the row still in the table — i.e.
    # re-caches the OLD tree — and the staleness survives its own fix. After the
    # commit the worst case is a reader that caches the NEW tree a moment before
    # this drops it and rebuilds the same thing.
    #
    # ⚠️ THIS IS A DE-ADMISSION, AND THE SENTENCE THAT STOOD HERE UNDERSOLD IT.
    # It said: *"THIS IS A CACHE DROP, NOT A DE-ADMISSION. `user_value_function`
    # rebuilds a miss from the store through the four deterministic gates, so an
    # armed alert does not go quiet."* True, and the reason it was DANGEROUS: the
    # rebuild ran FOUR gates and the fifth — the 1e-9 cross-lane equality — was
    # not among them, so the tree this line makes current was served under a proof
    # taken against the tree it replaced. An entry in `USER_FUNCS` is now a proof
    # receipt with exactly one writer, and dropping one obliges the alert seam
    # (`alert_user_series.value_function_for_alert`) to RE-ENTER the arm path on
    # the alert's own bars — re-proven on the tree it will actually evaluate, or
    # refused with a gate name. The alert still does not go quiet: a refusal is
    # attributable through `refusal_for_alert`, which a silence never is.
    from api.services import alert_user_series
    alert_user_series.forget(user_id)

    # ── phase 5: RECONCILE — read the bindings back out of the side table ────
    #
    # ⭐ `migrated` COUNTS WHAT THIS CALL DID. `bindings_on_this_tree` COUNTS
    # WHAT IS TRUE, read from `indicator_alert_rev` AFTER the append, against the
    # tree that actually got stored. The two differ exactly when an earlier
    # attempt half-landed: retrying an edit whose migration succeeded and whose
    # append failed correctly skips (the bindings are already on this tree) and
    # reports `migrated=0` — and a caller with only that number tells the member
    # "0 alerts updated" about alerts that were all updated.
    #
    # ⛔ IT IS A REPORT, NOT A SECOND MIGRATION. Re-migrating anything found "off
    # the tree" here would eat a cycle on every save for every binding that has
    # never been migrated at all — which is every binding on a definition still
    # at its first revision, and which is running the stored tree correctly.
    bindings_on_this_tree = 0
    if rev_bumped:
        bindings_on_this_tree = sum(
            1 for b in alert_rev_migration.bindings_on(def_id)
            if b["def_rev"] == rev and b["def_hash"] == new_hash)

    return {
        "def_id": def_id, "version": version, "rev": rev,
        "rev_bumped": rev_bumped, "migrated": migrated, "notified": notified,
        "bindings_on_this_tree": bindings_on_this_tree,
        "ast_hash": new_hash, "repaint": json.loads(repaint), "appended": True,
    }


def soft_delete(user_id: Any, def_id: str) -> bool:
    """Append a TOMBSTONE version. Returns False when there was nothing live.

    ⛔ IT APPENDS RATHER THAN STAMPING. Stamping `deleted_at` on the rows already
    written would be this module's one UPDATE, and it would land on exactly the
    rows a `defId@version` pin points at. A tombstone is a new version: history
    stays byte-identical and `get(..., version=N)` keeps answering.
    """
    _check_def_id(def_id)
    now = int(time.time())
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        _ensure(c)
        prev = _newest(c, user_id, def_id)
        if prev is None or prev["deleted_at"] is not None:
            return False
        c.execute(
            "INSERT INTO user_definitions "
            "(user_id, def_id, version, rev, ast_hash, definition, repaint, "
            " deleted_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (str(user_id), def_id, prev["version"] + 1, prev["rev"],
             prev["ast_hash"], prev["definition"], prev["repaint"], now, now),
        )
        c.commit()
    return True


# ─── the read path ───────────────────────────────────────────────────────────

def get(user_id: Any, def_id: str, version: Optional[int] = None) -> Optional[dict]:
    """One definition. ``version=None`` is the live newest; a pinned version is
    served even after a later edit or a delete — that is the whole point."""
    _check_def_id(def_id)
    with contextlib.closing(_connect()) as c:
        _ensure(c)
        if version is None:
            row = _newest(c, user_id, def_id)
            if row is None or row["deleted_at"] is not None:
                return None
        else:
            row = c.execute(
                "SELECT * FROM user_definitions WHERE user_id=? AND def_id=? AND version=?",
                (str(user_id), def_id, int(version)),
            ).fetchone()
            if row is None:
                return None
    return _row_to_dict(row)


def list_for_user(user_id: Any) -> list[dict]:
    """Every live definition's newest version, oldest def first."""
    with contextlib.closing(_connect()) as c:
        _ensure(c)
        rows = c.execute(
            "SELECT * FROM user_definitions u WHERE user_id=? AND version = ("
            "  SELECT MAX(version) FROM user_definitions v"
            "   WHERE v.user_id=u.user_id AND v.def_id=u.def_id)"
            " ORDER BY u.id",
            (str(user_id),),
        ).fetchall()
    return [_row_to_dict(r) for r in rows if r["deleted_at"] is None]


def live_definitions() -> list[dict]:
    """Every live definition's newest version, ACROSS EVERY MEMBER, oldest first.

    ⭐ THE SWEEP'S DOOR, AND IT LIVES HERE FOR ONE REASON: *"whose newest version
    is not a tombstone"* is a fact about THIS table's shape, and it is already
    spelled twice in this file (`_live_def_count`, `list_for_user`). A background
    job that wrote its own copy of that subquery would be a third authority over
    which row is live, and the day a tombstone rule changed the job would go on
    sweeping deleted formulas with every test green.

    ⚠️ IT IS THE ONLY MEMBER-SHAPED READ THE SWEEP MAKES, and the sweep collapses
    it immediately: results are keyed on the MATHS (`ast_hash`), never on the
    member, so two people who typed the same formula cost the pod one evaluation.
    """
    with contextlib.closing(_connect()) as c:
        _ensure(c)
        rows = c.execute(
            "SELECT * FROM user_definitions u WHERE version = ("
            "  SELECT MAX(version) FROM user_definitions v"
            "   WHERE v.user_id=u.user_id AND v.def_id=u.def_id)"
            " ORDER BY u.id",
        ).fetchall()
    return [_row_to_dict(r) for r in rows if r["deleted_at"] is None]


def history(user_id: Any, def_id: str) -> list[dict]:
    """Every version of one definition, oldest first — tombstones included."""
    _check_def_id(def_id)
    with contextlib.closing(_connect()) as c:
        _ensure(c)
        rows = c.execute(
            "SELECT * FROM user_definitions WHERE user_id=? AND def_id=? ORDER BY version",
            (str(user_id), def_id),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def stats(user_id: Any = None) -> dict:
    """Growth, as a number somebody can watch.

    The version count is the UNBOUNDED dimension (see the module docstring), so
    it is the one this reports. A store that grows unbounded and is not
    observable is the shape two tables in this lane already have.
    """
    where, args = "", ()
    if user_id is not None:
        where, args = " WHERE user_id=?", (str(user_id),)
    with contextlib.closing(_connect()) as c:
        _ensure(c)
        row = c.execute(
            "SELECT COUNT(*) AS versions, COUNT(DISTINCT user_id||'/'||def_id) AS definitions, "
            "COALESCE(SUM(LENGTH(definition)), 0) AS bytes FROM user_definitions" + where,
            args,
        ).fetchone()
    return {"versions": row["versions"], "definitions": row["definitions"],
            "bytes": row["bytes"],
            "max_definition_bytes": MAX_DEFINITION_BYTES,
            "max_definitions_per_user": MAX_DEFINITIONS_PER_USER,
            "versions_are_pruned": False}
