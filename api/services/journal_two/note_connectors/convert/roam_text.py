"""Roam wiki-syntax pre-passes — ported from the Obsidian adapter's proven
regex order (`app/src/pages/journal-2-0/lib/importer/adapters/obsidian.js`)
applied to Roam's own wiki-syntax dialect, per spec §7.

`providers/roam.py` assembles one page's pulled block tree into a plain
markdown STRING (bullet/heading lines, indentation for nesting — see
`_children_to_lines` there) with each block's RAW `:block/string` content
untouched, and hands the whole thing to `convert_roam_markdown()` below,
which rewrites Roam-specific syntax into markdown `md_to_tiptap` already
understands. Passes run in this FIXED order, outside fenced (```) AND inline
(`) code (protected FIRST — same technique as the Obsidian adapter: a
combined regex tried fence-alternative-first, so a triple-backtick run is
never mis-split at its first single backtick; code segments pass through
byte-for-byte untouched):

  1. `{{[[TODO]]}}` at the head of a bullet line -> unchecked task syntax
     (`- [ ]`, recognized by mddoc's tasklists plugin) — BEFORE the generic
     `[[link]]` pass runs, or the literal text "TODO" inside the double-brace
     token would be mistaken for a page-link target.
  2. `{{[[DONE]]}}` -> checked task syntax (`- [x]`), same reasoning.
  3. `[[Page Link]]` -> `[Page Link](import-link://roam:{graph}/{uid})` when
     the title resolves via `title_to_uid` (built from a FULL graph
     enumeration — see `RoamProvider.list_changed`, which populates it
     before any `fetch()` — not just the incrementally-changed subset, since
     a link can point at an unchanged page) else plain display text (the
     brackets are dropped, not the words).
  4. `((block-ref))` -> the referenced block's own string, resolved via
     `uid_to_string` (built from the SAME page's pulled tree only — a
     cross-page block reference is out of scope for v1 and, like an
     unresolved same-page uid, degrades to the literal `((uid))` text rather
     than being dropped).
  5. Bare Firebase Storage image URLs (`firebasestorage.googleapis.com`,
     Roam's image-hosting backend) not already wrapped in markdown image/link
     syntax -> `![](url)`, so `md_to_tiptap` picks them up as an image and
     registers a `media` entry (an ALREADY-wrapped `![...](url)` is left
     alone — no double-wrapping).
  6. `^^highlight^^` -> `==highlight==` (Roam's own highlight syntax mapped
     to the nearest markdown convention). NOTE: `md_to_tiptap` (as of Task 4)
     declares no highlight mark in its vocabulary and has no special
     handling for `==...==` — this currently surfaces as VISIBLE literal
     `==text==` in the note rather than a rendered highlight, matching the
     "degrade to visible text, never silently drop" principle used
     throughout the importer rather than inventing a TipTap node the real
     editor schema doesn't declare (which would fail the JS-side schema
     contract rail, Task 5). Forward-compatible: if a highlight mark is
     added to the schema + mddoc later, this pass needs no change.
  7. `attr:: value` lines (Roam's page-attribute block syntax, which has no
     TipTap equivalent) -> plain `attr: value` text.

No module-level/global state anywhere in this file: `title_to_uid` and
`uid_to_string` are ALWAYS explicit parameters, scoped by the caller to one
sync's enumeration and one page's pulled tree respectively — never cached or
memoized here. `providers/roam.py` owns their lifetime (see the docstring on
`RoamProvider._title_to_uid`).
"""

from __future__ import annotations

import re
from collections.abc import Callable

# Fence alternative MUST come first — at a run of 3+ backticks it has to win
# over the inline-span alternative, or the inline pattern would consume just
# the fence's opening backticks and mis-split its content. Identical to the
# Obsidian adapter's `CODE_RE`.
_CODE_RE = re.compile(r"```[\s\S]*?```|`[^`\n]*`")

# Bullet-line-anchored: only a `{{[[TODO]]}}`/`{{[[DONE]]}}` token sitting
# right after a bullet marker (Roam's own convention — the token IS the
# block, not incidental text mid-sentence) is rewritten. `re.MULTILINE` so
# `^` matches after every `\n` within a code-protected segment.
_TODO_RE = re.compile(r"^([ \t]*-[ \t]+)\{\{\[\[TODO\]\]\}\}[ \t]*", re.MULTILINE)
_DONE_RE = re.compile(r"^([ \t]*-[ \t]+)\{\{\[\[DONE\]\]\}\}[ \t]*", re.MULTILINE)

_WIKILINK_RE = re.compile(r"\[\[([^\[\]]+)\]\]")
_BLOCKREF_RE = re.compile(r"\(\(([^()]+)\)\)")

# A Firebase Storage URL not already preceded by `(` (i.e. not already the
# target of `[text](url)` or `![](url)`) gets wrapped into image syntax.
_FIREBASE_IMAGE_RE = re.compile(r"(?<!\()(https://firebasestorage\.googleapis\.com/\S+)")

_HIGHLIGHT_RE = re.compile(r"\^\^([^\^\n]+)\^\^")

# Anchored at the start of a bullet/heading's content: `key:: value` (Roam's
# page-attribute syntax) -> `key: value`. The key is kept intentionally
# narrow (word chars, spaces, `/`, `-`) so an unrelated `::` inside prose
# text (rare, but possible) doesn't get misread as an attribute.
_ATTR_LINE_RE = re.compile(
    r"^([ \t]*(?:[-*][ \t]+|#{1,3}[ \t]+)?)([A-Za-z][\w /-]{0,60}?)::[ \t]*(.*)$",
    re.MULTILINE,
)


def _replace_todo(match: "re.Match[str]") -> str:
    return f"{match.group(1)}[ ] "


def _replace_done(match: "re.Match[str]") -> str:
    return f"{match.group(1)}[x] "


def _replace_wikilink(
    match: "re.Match[str]", graph: str, title_to_uid: dict[str, str],
) -> str:
    target = match.group(1).strip()
    uid = title_to_uid.get(target)
    if uid is None:
        return target  # unresolved -> plain display text, brackets dropped
    return f"[{target}](import-link://roam:{graph}/{uid})"


def _replace_blockref(match: "re.Match[str]", uid_to_string: dict[str, str]) -> str:
    uid = match.group(1).strip()
    resolved = uid_to_string.get(uid)
    if resolved is None:
        return match.group(0)  # unresolved -> literal `((uid))`, never dropped
    return resolved


def _replace_firebase_image(match: "re.Match[str]") -> str:
    return f"![]({match.group(1)})"


def _replace_highlight(match: "re.Match[str]") -> str:
    return f"=={match.group(1)}=="


def _replace_attr(match: "re.Match[str]") -> str:
    prefix, key, value = match.group(1), match.group(2), match.group(3)
    return f"{prefix}{key}: {value}" if value else f"{prefix}{key}:"


def _transform_outside_code(text: str, fn: Callable[[str], str]) -> str:
    """Splits `text` on fenced (```) AND inline (`) code and runs `fn` over
    each NON-code segment only; code segments pass through untouched,
    byte-for-byte. Mirrors the Obsidian adapter's `transformOutsideCode`."""
    result = []
    last_index = 0
    for m in _CODE_RE.finditer(text):
        result.append(fn(text[last_index:m.start()]))
        result.append(m.group(0))
        last_index = m.end()
    result.append(fn(text[last_index:]))
    return "".join(result)


def convert_roam_markdown(
    text: str,
    *,
    graph: str,
    title_to_uid: dict[str, str] | None = None,
    uid_to_string: dict[str, str] | None = None,
) -> str:
    """Applies every pre-pass (module docstring order) to `text`, outside
    code. `title_to_uid`/`uid_to_string` default to empty (never `None`
    internally) — every `[[link]]`/`((ref))` then simply degrades to its
    documented unresolved behavior rather than raising."""
    title_to_uid = title_to_uid or {}
    uid_to_string = uid_to_string or {}

    def _transform(segment: str) -> str:
        out = segment
        out = _TODO_RE.sub(_replace_todo, out)
        out = _DONE_RE.sub(_replace_done, out)
        out = _WIKILINK_RE.sub(lambda m: _replace_wikilink(m, graph, title_to_uid), out)
        out = _BLOCKREF_RE.sub(lambda m: _replace_blockref(m, uid_to_string), out)
        out = _FIREBASE_IMAGE_RE.sub(_replace_firebase_image, out)
        out = _HIGHLIGHT_RE.sub(_replace_highlight, out)
        out = _ATTR_LINE_RE.sub(_replace_attr, out)
        return out

    return _transform_outside_code(text, _transform)
