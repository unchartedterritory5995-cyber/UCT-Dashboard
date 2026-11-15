"""QA F-11 (agent-lead, turn.py `_row_actions`): a stored outcome row that does not name its `actions` cannot show
it carried no local-only result, so history treats it as local (fail closed) — unless its kind is one of the
browser's own action-less notes (undo, clarify, refusal, cancel), whose text is UCT's fixed wording."""
from __future__ import annotations

import pathlib
import re

import pytest

from api.services.uct_agent import turn

SECRET = "987.654"
ROOT = pathlib.Path(__file__).resolve().parents[1]


def _history(outcome_data):
    rows = [{"role": "member", "text": "q", "data": {}},
            {"role": "outcome", "text": f"rating {SECRET}", "data": outcome_data}]
    return str(turn.history_messages(rows))


@pytest.mark.parametrize("data", [
    {"kind": "answered"},                    # the F-11 shape
    {"kind": "applied"},
    {"kind": "something-new"},               # an unknown kind without actions
    {},                                      # no kind at all
    {"kind": "answered", "actions": None},   # unreadable actions
    {"kind": "answered", "actions": [1]},
])
def test_a_row_that_cannot_show_its_actions_is_never_replayed(data):
    out = _history(data)
    assert SECRET not in out


@pytest.mark.parametrize("kind", sorted(turn.ACTIONLESS_OUTCOME_KINDS))
def test_the_browsers_action_less_notes_still_replay(kind):
    assert SECRET in _history({"kind": kind})


def test_a_row_naming_ordinary_actions_still_replays():
    assert SECRET in _history({"kind": "answered", "actions": ["stock.profile"]})


def test_a_row_naming_a_local_only_action_is_never_replayed():
    assert SECRET not in _history({"kind": "answered", "actions": ["breadth.show"]})


# Kinds the browser no longer records but stored conversations still hold, so they stay listed and keep replaying. Each
# needs its reason. "unsupported": the Multi Chart refusal, the only path that wrote it, went when the Agent began working there.
LEGACY_OUTCOME_KINDS = {"unsupported"}


# --- The rail's reader: a brace-balanced parse of every `outcomeData: { ... }` object literal in the browser source. ---
# The old reader was a regex that stopped at the first `}`, so key ORDER changed what it saw: PR #1112 put
# `...(cond ? { reason: 'x' } : {})` before `actions` and a row WITH actions read as action-less (false red). The
# worse failure is the reverse (false green: a real action-less row read as carrying actions), so the rule is:
#   * `kind` counts only as a top-level `kind: '<literal>'`; a computed kind (`{ kind }`) is not checked (as before).
#   * a row carries actions only if `actions` is a TOP-LEVEL key of that object (`actions: ...` or shorthand
#     `actions`), or a key of an UNCONDITIONAL spread of an object literal (`...{ actions: x }`): those always land.
#   * a conditional spread (`...(c ? { actions } : {})`), a spread of a name (`...extra`) and the word `actions`
#     inside a nested object, string, template or comment do NOT count: none proves every such row names its
#     actions, so the row stays action-less and its kind must be decided on purpose (fail closed).
# Strings ('…', "…", `…` with nested ${…}), comments and nested {} () [] are skipped whole. Regex literals are not
# recognised (a `/` is division unless it starts a comment); a regex holding a quote or bracket inside an
# outcomeData literal would need this reader taught (it then raises or mis-splits loudly in the unit cases below).
_CLOSE = {"{": "}", "(": ")", "[": "]"}


def _skip_string(s, i):
    q = s[i]
    i += 1
    while i < len(s):
        c = s[i]
        if c == "\\":
            i += 2
            continue
        if q == "`" and s.startswith("${", i):
            i = _skip_group(s, i + 1)
            continue
        if c == q:
            return i + 1
        i += 1
    raise ValueError("unterminated string")


def _skip_comment(s, i):
    if s.startswith("//", i):
        j = s.find("\n", i)
        return len(s) if j < 0 else j + 1
    j = s.find("*/", i + 2)
    if j < 0:
        raise ValueError("unterminated comment")
    return j + 2


def _skip_atom(s, i):
    """If s[i] starts a string, comment or bracket group, the index just past it; else None."""
    c = s[i]
    if c in "'\"`":
        return _skip_string(s, i)
    if s.startswith("//", i) or s.startswith("/*", i):
        return _skip_comment(s, i)
    if c in _CLOSE:
        return _skip_group(s, i)
    return None


def _skip_group(s, i):
    """s[i] is an opener; the index just past its matching closer."""
    close = _CLOSE[s[i]]
    i += 1
    while i < len(s):
        if s[i] == close:
            return i + 1
        if s[i] in ")]}":
            raise ValueError(f"mismatched {s[i]!r} at {i}")
        j = _skip_atom(s, i)
        i = j if j is not None else i + 1
    raise ValueError("unbalanced group")


def _strip_comments(s):
    out, i = [], 0
    while i < len(s):
        if s.startswith("//", i) or s.startswith("/*", i):
            i = _skip_comment(s, i)
            out.append(" ")
        elif s[i] in "'\"`":
            j = _skip_string(s, i)
            out.append(s[i:j])
            i = j
        else:
            out.append(s[i])
            i += 1
    return "".join(out).strip()


def _entries(s, i):
    """s[i] == '{': the top-level entries of that object literal, comments removed."""
    body = s[i + 1:_skip_group(s, i) - 1]
    out, start, k = [], 0, 0
    while k < len(body):
        if body[k] == ",":
            out.append(body[start:k])
            start = k = k + 1
            continue
        j = _skip_atom(body, k)
        k = j if j is not None else k + 1
    out.append(body[start:])
    return [e for e in (_strip_comments(x) for x in out) if e]


_KEY = re.compile(r"""^(?:([A-Za-z_$][\w$]*)|'([^']*)'|"([^"]*)")\s*(:|$)""", re.S)


def _keys(entries):
    """{key: value source} for an object's top-level entries; unconditional `...{ }` literals merge in."""
    keys = {}
    for e in entries:
        if e.startswith("..."):
            rest = e[3:].strip()
            if rest.startswith("{") and _skip_group(rest, 0) == len(rest):
                keys.update(_keys(_entries(rest, 0)))
            continue  # a conditional or named spread never proves a key is present
        m = _KEY.match(e)
        if m:
            name = m.group(1) or m.group(2) or m.group(3)
            keys[name] = e[m.end():].strip() if m.group(4) == ":" else name
    return keys


_KIND = re.compile(r"^'([a-z-]+)'$")


def outcome_records(text):
    """[(kind, has_actions)] for every `outcomeData: { ... }` literal in `text` whose kind is a string literal."""
    found = []
    for m in re.finditer(r"\boutcomeData\s*:\s*\{", text):
        keys = _keys(_entries(text, m.end() - 1))
        km = _KIND.match(keys.get("kind", ""))
        if km:
            found.append((km.group(1), "actions" in keys))
    return found


@pytest.mark.parametrize("src, want", [
    # (a) the #1112 shape: a spread holding `}` BEFORE `actions` -> still read as carrying actions
    ("record({ outcomeData: { kind: 'x', ...(why ? { reason: 'r}' } : {}), actions }, telemetry: {} })", [("x", True)]),
    ("record({ outcomeData: { kind: 'x', ...{ lines: [1] }, actions: ops.map(o => ({ a: o })) } })", [("x", True)]),
    ("record({ outcomeData: { kind: 'x', ...{ actions: ['a'] } } })", [("x", True)]),  # an unconditional spread lands
    # (b) a real action-less row naming actions only where it may not land -> still action-less (false-green guard)
    ("record({ outcomeData: { kind: 'x', ...(c ? { actions } : {}) } })", [("x", False)]),
    ("record({ outcomeData: { kind: 'x', ...extra, note: { actions: [] } } })", [("x", False)]),
    ("record({ outcomeData: { kind: 'x', why: 'no actions: here', t: `${actions}` }, telemetry: { actions } })",
     [("x", False)]),
    ("record({ outcomeData: { kind: 'x', of: f({ actions: 1 }), list: [{ actions: 2 }] } })", [("x", False)]),
    # (c) nested template strings and comments holding `}` don't end the object early
    ("record({ outcomeData: { kind: 'x', t: `a } ${ `b } ${ { y: '}' }.y }` } }`, /* } actions */ n: 1, // }\n"
     " actions } })", [("x", True)]),
    ("record({ outcomeData: { kind: 'x', t: `} ${'}'}`, // actions }\n n: 1 } })", [("x", False)]),
    # a computed kind is not checked (as before); quoted keys still count
    ("record({ outcomeData: { kind }, z: 1 }); record({ outcomeData: { 'kind': 'y', \"actions\": [] } })",
     [("y", True)]),
])
def test_the_rail_reader_parses_record_literals(src, want):
    assert outcome_records(src) == want


def test_the_action_less_list_matches_what_the_browser_records():
    """Rail: a new browser outcome kind recorded WITHOUT `actions` must be added here on purpose (it then
    replays) — otherwise it stays fail-closed. A listed kind the browser no longer records is stale.
    Read by `outcome_records` (brace-balanced, key-order independent). Its mutants, pinned by
    `test_the_rail_reader_parses_record_literals`: (a) the #1112 spread holding `}` before `actions` still reads as
    carrying actions; (b) `actions` only inside a conditional/named spread, nested object, string or template keeps a
    row action-less (false-green guard); (c) nested templates and comments holding `}` don't end the object early.
    On master 7a24a31edc it yields the same kind set as the old first-`}` regex."""
    src = ROOT / "app" / "src" / "agent"
    seen = set()
    for p in src.rglob("*.js*"):
        if ".test." in p.name:
            continue
        text = p.read_text(encoding="utf-8")
        for kind, has_actions in outcome_records(text):
            if not has_actions:
                seen.add(kind)
    assert seen, "found no outcome records: the rail would check nothing"
    assert seen <= turn.ACTIONLESS_OUTCOME_KINDS, f"decide these: {sorted(seen - turn.ACTIONLESS_OUTCOME_KINDS)}"
    stale = turn.ACTIONLESS_OUTCOME_KINDS - seen - LEGACY_OUTCOME_KINDS
    assert not stale, f"stale: {sorted(stale)}"
    assert LEGACY_OUTCOME_KINDS <= turn.ACTIONLESS_OUTCOME_KINDS, "a legacy kind must stay listed: stored rows hold it"
    assert not (LEGACY_OUTCOME_KINDS & seen), f"recorded again, no longer legacy: {sorted(LEGACY_OUTCOME_KINDS & seen)}"
