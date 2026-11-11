"""The coach's knowledge base: docs/agent/coach/concepts/*.md, parsed once (W3-1).

Each file: a `---` front matter (id, title, aliases, observe) and the four sections `## What it is`,
`## What to look for`, `## Common mistakes`, `## Uncertainty` (docs/agent/coach/README.md). A file that does not
parse is SKIPPED and logged (never a 500): the coach then simply does not know that concept.

`concept_for(words)` matches the member's words to exactly ONE concept by title or alias (whole phrase, or the
phrase contained in the words with word boundaries). Several matches -> the longest alias wins; none -> None.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[4]
CONCEPTS_DIR = REPO_ROOT / "docs" / "agent" / "coach" / "concepts"
SECTIONS = ("What it is", "What to look for", "Common mistakes", "Uncertainty")
OBSERVE = ("ma", "volume", "none")
MIN_CONCEPTS = 12

_ID = re.compile(r"^[a-z][a-z0-9-]{1,60}$")
_FRONT = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.S)


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", str(s or "").lower().replace("’", "'")).strip()


def parse_concept(text: str, *, file_id: str | None = None) -> dict:
    """One file's text -> {id, title, aliases, observe, sections, text}. ValueError when it is not in the format."""
    m = _FRONT.match(text.replace("\r\n", "\n"))
    if not m:
        raise ValueError("no front matter")
    meta: dict[str, str] = {}
    for line in m.group(1).splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        k, _, v = line.partition(":")
        meta[k.strip().lower()] = v.strip()
    cid = meta.get("id", "")
    if not _ID.match(cid):
        raise ValueError("bad id")
    if file_id is not None and file_id != cid:
        raise ValueError("id does not match the file name")
    title = meta.get("title", "").strip()
    if not title:
        raise ValueError("no title")
    observe = (meta.get("observe") or "none").strip().lower()
    if observe not in OBSERVE:
        raise ValueError("bad observe")
    aliases = [_norm(a) for a in meta.get("aliases", "").split(",")]
    aliases = [a for a in aliases if a]
    body = m.group(2)
    parts = re.split(r"^## +(.+?)\s*$", body, flags=re.M)
    # parts: [preamble, heading, text, heading, text, ...]
    sections: dict[str, str] = {}
    for i in range(1, len(parts) - 1, 2):
        sections[parts[i].strip()] = re.sub(r"\s+", " ", parts[i + 1]).strip()
    for s in SECTIONS:
        if not sections.get(s):
            raise ValueError(f"missing section {s!r}")
    return {"id": cid, "title": title, "aliases": aliases, "observe": observe,
            "sections": {s: sections[s] for s in SECTIONS}}


def concept_text(c: dict) -> str:
    """The text the member reads / the model is given: the four sections, labelled, in order."""
    s = c["sections"]
    return (f"{c['title']}. {s['What it is']}\n\n"
            f"What to look for: {s['What to look for']}\n\n"
            f"Common mistakes: {s['Common mistakes']}\n\n"
            f"Uncertainty: {s['Uncertainty']}")


_CACHE: list[dict] | None = None


def load(directory: Path | None = None, *, force: bool = False) -> list[dict]:
    """Every concept in the directory (sorted by id); a malformed file is skipped and logged."""
    global _CACHE
    if directory is None and _CACHE is not None and not force:
        return _CACHE
    d = directory or CONCEPTS_DIR
    out: list[dict] = []
    try:
        files = sorted(d.glob("*.md"))
    except OSError:
        files = []
    for f in files:
        try:
            c = parse_concept(f.read_text(encoding="utf-8"), file_id=f.stem)
        except (OSError, ValueError) as e:
            log.warning("[uct-agent] coach concept skipped file=%s reason=%s", f.name, e)
            continue
        c["text"] = concept_text(c)
        out.append(c)
    out.sort(key=lambda c: c["id"])
    if directory is None:
        _CACHE = out
    return out


def _reset_for_tests() -> None:
    global _CACHE
    _CACHE = None


def all_concepts() -> list[dict]:
    return load()


def by_id(cid: str) -> dict | None:
    return next((c for c in load() if c["id"] == cid), None)


def concept_for(words: str, concepts: list[dict] | None = None) -> dict | None:
    """The ONE concept the words name (title or alias, whole or contained at word boundaries), else None."""
    w = _norm(words)
    if not w or len(w) > 200:
        return None
    best: tuple[int, dict] | None = None
    for c in concepts if concepts is not None else load():
        for name in [_norm(c["title"]), *c["aliases"]]:
            if not name:
                continue
            if w == name or re.search(r"(?<![a-z0-9])" + re.escape(name) + r"(?![a-z0-9])", w):
                if best is None or len(name) > best[0]:
                    best = (len(name), c)
    return best[1] if best else None


def public_rows() -> list[dict]:
    """What the browser is served: id, title, aliases, observe, text, sections (no paths)."""
    return [{"id": c["id"], "title": c["title"], "aliases": list(c["aliases"]), "observe": c["observe"],
             "text": c["text"], "sections": dict(c["sections"])} for c in load()]
