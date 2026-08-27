"""`argRoles` was DOCUMENTATION, and two entries shipped depending on it.

⭐⭐ THE MEASURED DEFECT THIS FILE EXISTS FOR. `closedTable.json` declares, per
function, an `args` list of NODE kinds (`series` / `int`) and an `argRoles` list
of NAMES. `_functions_arg_roles` says in as many words that a role is NOT a
requirement — `atr`'s slot 0 is called `high` because that is what an untranslated
call means, not because it must be the `high` series — and that is right for every
role that names a COLUMN. It is wrong for a role that names a KIND.

`barssince(cond, n)` and `valuewhen(cond, src, n)` landed 2026-08-26 declaring
`argRoles[0] = condition` over an `args[0]` that says only `series`. Nothing read
the second half, so on 40 synthetic bars:

    barssince(close, 100)        -> 0.0 on EVERY bar
    valuewhen(close, high, 5)    -> high on EVERY bar
    barssince(close > high, 100) -> None            (correct usage, correct answer)

⛔ A COLUMN THAT IS PLAUSIBLE ON EVERY BAR AND WRONG ON EVERY BAR is the failure
shape `pine.js::PINE_INEXPRESSIBLE` refuses whole families to avoid — and a member
could build one, save it, screen on it and arm an alert on it.

⭐ THE FIX IS DATA PLUS ONE GUARD PER LANE. `closedTable.json` gained
`_functions_arg_role_kinds` — role name to the `yields` kind the argument's tree
must settle to — and each lane asks its OWN single `yields` resolver
(`scan_definition.is_boolean_tree` here, `sentence.js::yieldsOf` there) rather
than growing a third copy of "which trees are conditions".

⛔ THIS FILE RAILS THE PYTHON LANE. `argRoles.test.js` rails the JS one, on its
own, against the same manifest — `lesson_rail_the_mirror_not_just_the_lane`: a
mirrored architecture needs the fix railed in EACH lane separately, or the twin
stays green and unguarded. One case here crosses the lanes, and it is about the
GUARD NAME agreeing, never about one lane's column being the other's oracle.
"""
from __future__ import annotations

import json
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(ROOT / "tools"))

import ast_conformance as ac  # noqa: E402

from api.services import ast_interpret, ast_table, scan_definition  # noqa: E402

NUM = lambda v: {"type": "num", "value": v}                        # noqa: E731
SER = lambda n: {"type": "series", "name": n}                      # noqa: E731
OP = lambda n, *a: {"type": "op", "name": n, "args": list(a)}      # noqa: E731
CALL = lambda n, *a: {"type": "call", "name": n, "args": list(a)}  # noqa: E731

FUNCTIONS = ast_table.TABLE[ast_table.FUNCTIONS_SECTION]

#: The guard both lanes refuse with. STRUCTURE — pinned to the declaration below.
GUARD = "resolve:condition"


def _bars(n: int = 60):
    """Bars whose up/down pattern makes a real condition fire REPEATEDLY.

    ⛔ NOT A MONOTONE RAMP. On an always-up series `close > open` is true on every
    bar, `barssince` is 0 everywhere, and a column of zeroes is exactly what the
    DEFECT produces — the fixture would be unable to tell the correct answer from
    the wrong one. `test_the_fixture_can_TELL_THEM_APART` is the control.
    """
    out = []
    for i in range(n):
        up = (i % 7) in (0, 3)
        o = 100.0 + i * 0.1
        c = o + (0.8 if up else -0.5)
        out.append({"t": 1780000000 + i * 300, "o": o, "h": max(o, c) + 0.4,
                    "l": min(o, c) - 0.4, "c": c, "v": 1000.0 + i})
    return out


BARS = _bars()

#: A bar field (a PRICE — the table declares no `yields` for one, so it is a
#: number), a second one to carry, and a condition that ACTUALLY FIRES.
#:
#: ⛔ `close > high` IS THE TRAP AND IT IS WHY THIS IS SPELLED OUT. It is a
#: perfectly legal condition and it is NEVER TRUE — a bar's close cannot exceed
#: its high — so `valuewhen` under it answers nothing on every bar and the
#: "correct usage still works" direction passes vacuously. `close > open` is the
#: up-bar test a member actually writes, and `_bars` makes it fire repeatedly.
PRICE = "close"
SOURCE = "high"
A_CONDITION = OP(">", SER("close"), SER("open"))

#: The bar key `SOURCE` reads, off the manifest — so the carried-value assertion
#: below names a COLUMN rather than a letter somebody typed.
SOURCE_FIELD = ast_table.TABLE[ast_table.SERIES_SECTION][SOURCE]["field"]


def run(tree, bars=None):
    col = ast_interpret.interpret(tree, list(bars if bars is not None else BARS), {})
    return [None if (v is None or v != v) else v for v in col]


def refusal(tree, bars=None):
    with pytest.raises(ast_interpret.TableRefusal) as exc:
        run(tree, bars)
    return exc.value


def enforced_slots():
    """Every `(function, slot, role, want)` the manifest makes a REQUIREMENT.

    ⛔ DERIVED. A roster typed here would stop covering the day a third entry
    declares a condition — which is the exact shape of the defect above, one
    level up.
    """
    wanted = scan_definition.arg_role_kinds()
    out = []
    for name in sorted(FUNCTIONS):
        roles = tuple(FUNCTIONS[name].get("argRoles") or ())
        for i, role in enumerate(roles):
            if role in wanted:
                out.append((name, i, role, wanted[role]))
    return out


def call_with(name: str, slot: int, arg):
    """A legal call to `name` with `arg` in `slot` and a plain filler elsewhere."""
    kinds = tuple(FUNCTIONS[name]["args"])
    args = [NUM(5) if k == "int" else SER(PRICE) for k in kinds]
    args[slot] = arg
    return CALL(name, *args)


# ═══ 1. the declaration exists, and it says what the guard's sentence says ═══

def test_the_manifest_DECLARES_a_role_kind_and_ENTRIES_actually_use_it():
    """⛔ NON-VACUITY FIRST. Every case below is derived from this declaration, so
    an empty roster would make the whole file pass by measuring nothing."""
    kinds = scan_definition.arg_role_kinds()
    assert kinds, (
        "closedTable.json declares no `_functions_arg_role_kinds`. Every case in "
        "this file derives its subject from that section, so an empty one turns "
        "the whole file green by having nothing to check.")
    slots = enforced_slots()
    assert len(slots) >= 2, (
        f"only {len(slots)} argument slot(s) carry an enforced role; the two this "
        "guard was built for are `barssince`'s condition and `valuewhen`'s")
    # …and the roster covers the two measured entries, BY NAME, because those are
    # the columns that were wrong on every bar.
    named = {name for name, _, _, _ in slots}
    assert {"barssince", "valuewhen"} <= named, sorted(named)


def test_EVERY_declared_kind_is_the_BOOLEAN_one_because_the_SENTENCE_says_so():
    """⚠️ ANTI-ROT, AND IT IS A ROSTER WITH A REASON RATHER THAN A COUNT.

    The refusal reads *"a condition argument must be a 0/1 column"* — plain words
    naming ONE kind. A role declared as `num` would still be ENFORCED correctly by
    the guard and would be refused by a sentence describing the wrong kind, which
    is a refusal that names the wrong cause — worse than a vague one. So the day
    somebody declares one, this lands RED and the sentence gets re-derived first.
    """
    kinds = scan_definition.arg_role_kinds()
    unexpected = {r: k for r, k in kinds.items() if k != scan_definition._KIND_BOOL}
    assert not unexpected, (
        f"{unexpected} declares a non-boolean argument kind. The guard handles it, "
        f"but {GUARD}'s sentence names a 0/1 column in plain words and would "
        "describe the wrong kind. Re-derive the sentence, then widen this rail.")


# ═══ 2. BOTH DIRECTIONS, on the two entries that shipped the defect ═════════

def test_a_PRICE_where_the_manifest_declares_a_CONDITION_is_refused_BY_NAME():
    """⛔ AND THE REFUSAL NAMES THE FUNCTION, THE POSITION, THE ROLE AND THE FIX.

    A refusal that says only "invalid argument" costs the member the whole
    derivation again; `lesson_rail_the_sentence_not_just_the_guard` is why the
    wording is asserted here and not left to the guard name alone.
    """
    for tree, fn, slot in (
        (CALL("barssince", SER(PRICE), NUM(10)), "barssince", 0),
        (CALL("valuewhen", SER(PRICE), SER(SOURCE), NUM(5)), "valuewhen", 0),
    ):
        exc = refusal(tree)
        assert exc.guard == GUARD, (fn, exc.guard)
        msg = str(exc)
        assert ast_interpret.REFUSALS[GUARD] in msg
        assert fn in msg, msg
        assert f"argument {slot}" in msg, msg
        assert "condition" in msg, msg
        # what would fix it — the same words the scan gate already uses
        assert "compare it to something" in msg, msg


def test_a_REAL_condition_STILL_COMPUTES_and_the_column_is_not_constant():
    """⛔ THE OTHER HALF. A guard that refuses everything passes half the test you
    care about, and it would be invisible: nobody files a bug for a formula that
    was always going to be refused (`lesson_an_over_refusal_is_invisible`)."""
    since = run(CALL("barssince", A_CONDITION, NUM(10)))
    when = run(CALL("valuewhen", A_CONDITION, SER(SOURCE), NUM(5)))
    for label, col in (("barssince", since), ("valuewhen", when)):
        answered = [v for v in col if v is not None]
        assert answered, f"{label} answered nothing at all — the guard ate it"
        assert len(set(answered)) > 1, (
            f"{label} answered the SAME value on every bar it answered "
            f"({answered[0]}), which is the defect's own signature — this fixture "
            "cannot tell the fix from the bug")


def test_the_fixture_can_TELL_THEM_APART():
    """⛔ THE CONTROL FOR THE CONTROL. On a monotone series `close > open` is true
    on every bar and the correct `barssince` is 0 everywhere — identical to what
    the DEFECT produces. Assert the fixture is not that series."""
    ups = sum(1 for b in BARS if b["c"] > b["o"])
    assert 0 < ups < len(BARS), (ups, len(BARS))
    correct = run(CALL("barssince", A_CONDITION, NUM(10)))
    assert set(v for v in correct if v is not None) != {0.0}, correct[:12]


# ═══ 3. TOTALITY — every enforced slot, both directions ════════════════════

@pytest.mark.parametrize("name,slot,role,want", enforced_slots(),
                         ids=lambda v: str(v))
def test_EVERY_enforced_slot_refuses_a_price_and_accepts_a_condition(
        name, slot, role, want):
    """Derived from the manifest, so a third entry declaring a condition is
    covered — in both directions — the day it lands."""
    assert want == scan_definition._KIND_BOOL, (name, role, want)
    exc = refusal(call_with(name, slot, SER(PRICE)))
    assert exc.guard == GUARD, (name, slot, exc.guard)
    assert role in str(exc), str(exc)
    # …and the correctly-cast call is untouched.
    col = run(call_with(name, slot, A_CONDITION))
    assert any(v is not None for v in col), (name, slot)


def test_an_entry_with_NO_enforced_role_is_UNTOUCHED():
    """⛔ THE BLAST RADIUS, MEASURED. The guard reads a per-function declaration;
    an entry that declares none must not acquire one by being nearby."""
    enforced = {n for n, _, _, _ in enforced_slots()}
    free = [n for n in sorted(FUNCTIONS)
            if n not in enforced and tuple(FUNCTIONS[n]["args"]) == ("series", "int")]
    assert free, "no free (series, int) entry left to prove the guard is scoped"
    for name in free:
        col = run(CALL(name, SER(PRICE), NUM(5)))
        assert any(v is not None for v in col), name


# ═══ 4. DELETE THE BRANCH — twice, once per half of the guard ══════════════

BOGUS = {
    "barssince": CALL("barssince", SER(PRICE), NUM(10)),
    "valuewhen": CALL("valuewhen", SER(PRICE), SER(SOURCE), NUM(5)),
}


def _survives(monkeypatch, which: str):
    """Run every bogus tree with ONE half of the guard removed."""
    if which == "wire":
        monkeypatch.setattr(ast_interpret, "_assert_arg_roles",
                            lambda node, spec: None)
    else:
        monkeypatch.setattr(scan_definition, "arg_role_violation",
                            lambda node, spec, table=None: None)
    return {k: run(t) for k, t in BOGUS.items()}


@pytest.mark.parametrize("half", ["wire", "resolution"])
def test_DELETING_the_guard_lets_the_bogus_tree_compute_a_confident_column(
        monkeypatch, half):
    """⛔ THE MEASUREMENT, NOT THE ASSERTION. With the guard in place both trees
    refuse; with ONE half removed both COMPUTE. The differing count is recorded
    because `0 differing` means the fixture cannot see the branch and the rail
    proves nothing.

    ⚠️ TWO HALVES, SEPARATELY. `_assert_arg_roles` is the WIRE (ast_interpret) and
    `arg_role_violation` is the RESOLUTION (scan_definition); deleting either one
    alone re-opens the door, so a rail that only killed the pair could pass with
    one half already dead (`lesson_mutations_can_cancel_each_other`).
    """
    for tree in BOGUS.values():
        assert refusal(tree).guard == GUARD

    survived = _survives(monkeypatch, half)
    differing = sorted(k for k in BOGUS if survived[k])
    assert len(differing) == 2, (
        f"deleting the {half} changed {len(differing)} case(s); both bogus trees "
        "must go from REFUSED to computed, or this rail is blind to that half")

    # ⛔ AND HERE IS WHAT IT SAYS — the confident-wrong-number, spelled out.
    since = survived["barssince"]
    assert set(since) == {0.0}, (
        f"barssince over a price answered {sorted(set(since))[:5]}; the recorded "
        "defect is 0.0 on EVERY bar, because a price is never zero")
    when = survived["valuewhen"]
    assert when == [b[SOURCE_FIELD] for b in BARS], (
        "valuewhen over a price handed back its SOURCE column on every bar")


def test_the_defect_is_INVISIBLE_in_the_COMPARISON_TOO(monkeypatch):
    """⚠️ ASSERT ON THE TRUTHINESS, NOT ONLY ON THE COLUMN.

    This branch has already measured a guard whose deletion left a column
    byte-identical while flipping the comparison built on it. Here the direction
    is the reverse and worse: the bogus column is a plausible run of zeroes, and
    every SCAN spelling of it — `!= 0`, `> 0`, `== 0` — is a CONSTANT over the
    whole universe. A screen on it returns nothing, or everything.
    """
    monkeypatch.setattr(ast_interpret, "_assert_arg_roles", lambda node, spec: None)
    bogus_gt = run(OP(">", BOGUS["barssince"], NUM(0)))
    bogus_eq = run(OP("==", BOGUS["barssince"], NUM(0)))
    assert set(bogus_gt) == {0.0}, sorted(set(bogus_gt))[:5]
    assert set(bogus_eq) == {1.0}, sorted(set(bogus_eq))[:5]

    good_gt = run(OP(">", CALL("barssince", A_CONDITION, NUM(10)), NUM(0)))
    assert len(set(good_gt)) > 1, (
        "the correct tree's comparison is constant too — this case cannot "
        "distinguish the defect from the fix")
    differing = sum(1 for a, b in zip(bogus_gt, good_gt) if a != b)
    assert differing >= 20, (
        f"only {differing} of {len(BARS)} bars differ between the bogus and the "
        "correct comparison; a rail that cannot see the difference proves nothing")


# ═══ 5. the roster is DATA, and the guard reads it ═════════════════════════

def test_the_ROLE_ROSTER_is_DATA_and_the_guard_actually_READS_it():
    """⭐ THE DERIVATION PROOF. Plant a role into a COPY of the manifest and the
    resolver must enforce it on an entry that is free today; empty the roster and
    it must enforce nothing. A hard-coded `if role == "condition"` passes the
    first half of this file and fails both halves of this case."""
    free = next(n for n in sorted(FUNCTIONS)
                if tuple(FUNCTIONS[n]["args"]) == ("series", "int")
                and not (set(scan_definition.arg_role_kinds())
                         & set(FUNCTIONS[n].get("argRoles") or ())))
    spec = FUNCTIONS[free]
    role = tuple(spec["argRoles"])[0]
    node = CALL(free, SER(PRICE), NUM(5))

    assert scan_definition.arg_role_violation(node, spec) is None, (
        f"{free} is enforced against the SHIPPED table; pick a free entry")

    planted = dict(ast_table.TABLE)
    planted["_functions_arg_role_kinds"] = {role: scan_definition._KIND_BOOL}
    bad = scan_definition.arg_role_violation(node, spec, planted)
    assert bad == {"index": 0, "role": role, "want": scan_definition._KIND_BOOL,
                   "got": scan_definition._KIND_NUM}, bad
    # …and the correctly-cast call is clean under the SAME planted table.
    ok = CALL(free, A_CONDITION, NUM(5))
    assert scan_definition.arg_role_violation(ok, spec, planted) is None

    emptied = dict(ast_table.TABLE)
    emptied["_functions_arg_role_kinds"] = {}
    assert scan_definition.arg_role_violation(
        CALL("barssince", SER(PRICE), NUM(10)),
        FUNCTIONS["barssince"], emptied) is None, (
        "with an empty roster the resolver still found a violation — it is "
        "reading something other than the manifest")


# ═══ 6. the twin lane refuses the SAME tree with the SAME guard ════════════

_JS_ROLE_DRIVER = r"""
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
register('./jsonhook.mjs', import.meta.url)

let raw = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) raw += chunk
const payload = JSON.parse(raw)

const mod = await import(pathToFileURL(payload.interpreter).href)
const out = {}
for (const c of payload.cases) {
  try {
    const col = Array.from(mod.interpret(c.ast, payload.bars, {}),
      (v) => (v === null || v === undefined || Number.isNaN(v) ? null : v))
    out[c.id] = { outcome: 'computed', answered: col.filter((v) => v !== null).length }
  } catch (e) {
    out[c.id] = { outcome: 'refused', guard: e && e.guard, message: String(e && e.message) }
  }
}
process.stdout.write(JSON.stringify({ ok: true, results: out }))
"""


@pytest.mark.skipif(not ac.js_lane_available(), reason="no node / no JS interpreter")
def test_the_JS_LANE_refuses_the_SAME_TREE_with_the_SAME_GUARD():
    """⛔ NOT A COLUMN EQUALITY — A DOOR EQUALITY.

    `test_ast_interpret.py` already pins the two `REFUSALS` TABLES byte-for-byte,
    which proves the SENTENCES agree and nothing about whether the twin's guard
    ever fires. This offers the same trees to `interpret.js` and requires the same
    verdict, so a lane whose wire was never connected cannot hide behind the
    other's rail (`lesson_rail_the_mirror_not_just_the_lane`).
    """
    cases = [{"id": f"bogus::{k}", "ast": t} for k, t in sorted(BOGUS.items())]
    cases += [
        {"id": "good::barssince", "ast": CALL("barssince", A_CONDITION, NUM(10))},
        {"id": "good::valuewhen",
         "ast": CALL("valuewhen", A_CONDITION, SER(SOURCE), NUM(5))},
    ]
    payload = {"interpreter": ac.JS_INTERPRET_PATH, "bars": BARS, "cases": cases}
    js = ac._node_run(_JS_ROLE_DRIVER, payload)["results"]

    for cid in (c["id"] for c in cases if c["id"].startswith("bogus::")):
        assert js[cid]["outcome"] == "refused", (cid, js[cid])
        assert js[cid]["guard"] == GUARD, (cid, js[cid])
        assert ast_interpret.REFUSALS[GUARD] in js[cid]["message"], js[cid]
    for cid in (c["id"] for c in cases if c["id"].startswith("good::")):
        assert js[cid]["outcome"] == "computed", (cid, js[cid])
        assert js[cid]["answered"] > 0, (cid, js[cid])


# ═══ 7. the conformance corpus still says what it said ═════════════════════

def test_NO_CONFORMANCE_CORPUS_ROW_IS_REFUSED_BY_THIS_GUARD():
    """⛔ THE REGRESSION DIRECTION NOBODY WOULD NOTICE. `--check` compares hashes;
    a corpus row this guard started refusing would move a hash and read as a
    numerical divergence. Ask the question directly instead."""
    corpus = json.loads(
        (ROOT / "tests" / "fixtures" / "ast" / "corpus.json").read_text(encoding="utf-8"))
    rows = corpus["cases"] if isinstance(corpus, dict) else corpus
    checked = 0
    for row in rows:
        tree = row.get("ast")
        if not isinstance(tree, dict):
            continue
        checked += 1
        for node in ast_interpret._flatten(tree):
            if node.get("type") != "call":
                continue
            spec = ast_table.TABLE[ast_table.FUNCTIONS_SECTION].get(node.get("name"))
            if not spec:
                continue
            bad = scan_definition.arg_role_violation(node, spec)
            assert bad is None, (
                f"corpus row {row.get('id')!r} would now be refused by {GUARD}: "
                f"{bad}. A recorded case that stopped computing is a moved hash "
                "wearing a numerical divergence's clothes.")
    assert checked > 50, f"the corpus walk read only {checked} rows"
