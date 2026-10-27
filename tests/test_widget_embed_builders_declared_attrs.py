"""W11-R84 m-1: every server builder that writes a widgetEmbed emits only the attributes the editor declares.

`journal_styles.with_editor_attrs` (W11-R84) keeps, at the styled-create insert, ONLY the attributes in
WIDGET_EMBED_ATTR_DEFAULTS (the table railed equal to the editor's schema, lib/widgetEmbedAttrDefaults.test.js), so a
builder's undeclared attribute is dropped there, silently. Today the one undeclared key any builder writes is
`tradeRefType`, always None (the editor drops it too). This rail makes a NEW undeclared key, or a non-null
`tradeRefType`, red by name before it can vanish: until the editor declares `tradeRefType`, a builder may only write
it as the literal None.

Derived from the source each run (an AST walk of every module under api/services/journal_two): each
`{"type": "widgetEmbed", "attrs": {...}}` literal is checked key by key. A widgetEmbed whose `attrs` is not a literal
dict (built elsewhere, or with `**` spread) must be named in NON_LITERAL with what it is, so a new one is looked at.
"""
from __future__ import annotations

import ast
import pathlib

from api.services.journal_two.journal_styles import WIDGET_EMBED_ATTR_DEFAULTS

ROOT = pathlib.Path(__file__).resolve().parents[1]
PKG = ROOT / "api" / "services" / "journal_two"
DECLARED = frozenset(WIDGET_EMBED_ATTR_DEFAULTS)
#: undeclared keys a builder may still write, and the only value each may have
TOLERATED = {"tradeRefType": None}

#: modules whose widgetEmbed `attrs` is not a literal dict here, and what they are
NON_LITERAL = {
    "api/services/journal_two/chart_plan.py": "a chart plan doc from the client's own attrs (not a compose builder)",
    "api/services/journal_two/notes.py": "the import / capture append door: attrs from the caller, through notes' own checks",
    "api/services/journal_two/sample_examples.py": "the bundled example notes (never a member's composed note)",
    "api/services/journal_two/public_note_payload.py": "the public / gallery reduction of an existing note (never stored)",
}


def _const(node):
    return node.value if isinstance(node, ast.Constant) else ...


def _embeds():
    """[(module, lineno, attrs node)] for every dict literal with "type": "widgetEmbed" and an "attrs" key."""
    out = []
    for p in sorted(PKG.rglob("*.py")):
        rel = p.relative_to(ROOT).as_posix()
        if p.name.startswith("test_") or "/tests/" in rel:
            continue
        tree = ast.parse(p.read_text(encoding="utf-8"), filename=rel)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Dict):
                continue
            keys = {_const(k): v for k, v in zip(node.keys, node.values) if k is not None}
            if _const(keys.get("type", ast.Constant(None))) == "widgetEmbed" and "attrs" in keys:
                out.append((rel, node.lineno, keys["attrs"]))
    return out


def _problems(embeds):
    bad = []
    for rel, line, attrs in embeds:
        if not isinstance(attrs, ast.Dict) or any(k is None for k in attrs.keys):
            if rel not in NON_LITERAL:
                bad.append(f"{rel}:{line}: widgetEmbed attrs are not a literal dict (name it in NON_LITERAL)")
            continue
        for k, v in zip(attrs.keys, attrs.values):
            name = _const(k)
            if name in DECLARED:
                continue
            if name in TOLERATED:
                if not (isinstance(v, ast.Constant) and v.value is TOLERATED[name]):
                    bad.append(f"{rel}:{line}: `{name}` may only be written as {TOLERATED[name]!r} until the editor declares it")
                continue
            bad.append(f"{rel}:{line}: `{name}` is not an attribute the editor declares (it would be dropped)")
    return bad


def test_every_server_widget_embed_builder_writes_only_declared_attributes():
    embeds = _embeds()
    literal = [e for e in embeds if isinstance(e[2], ast.Dict)]
    # non-vacuity: the compose builders are seen (slot_fill x2, trader_blocks x2, journal_styles x2 at least)
    seen = {rel for rel, _l, _a in literal}
    for mod in ("slot_fill.py", "trader_blocks.py", "journal_styles.py"):
        assert any(r.endswith(mod) for r in seen), mod
    assert len(literal) >= 6
    assert _problems(embeds) == []


def test_the_rail_can_fail_both_ways():
    """CONTROL: a planted undeclared key, a non-null tradeRefType and an unnamed spread are each reported by name."""
    src = (
        'a = {"type": "widgetEmbed", "attrs": {"widgetId": "x", "brandNew": 1}}\n'
        'b = {"type": "widgetEmbed", "attrs": {"widgetId": "x", "tradeRefType": "equity_trade"}}\n'
        'c = {"type": "widgetEmbed", "attrs": {**base, "widgetId": "x"}}\n'
        'd = {"type": "widgetEmbed", "attrs": {"widgetId": "x", "tradeRefType": None, "fallback": None}}\n'
    )
    tree = ast.parse(src)
    embeds = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Dict):
            keys = {_const(k): v for k, v in zip(node.keys, node.values) if k is not None}
            if _const(keys.get("type", ast.Constant(None))) == "widgetEmbed" and "attrs" in keys:
                embeds.append(("planted.py", node.lineno, keys["attrs"]))
    got = _problems(embeds)
    assert len(got) == 3
    assert any("brandNew" in g for g in got) and any("tradeRefType" in g for g in got) and any("NON_LITERAL" in g for g in got)
