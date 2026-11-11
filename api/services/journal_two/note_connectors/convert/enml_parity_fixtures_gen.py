"""Cross-LANE parity-rail fixture generator for Evernote ENML (connector fidelity Plan E Task 4).

── The risk this closes ────────────────────────────────────────────────────

An Evernote note reaches the Notebook by two hand-written implementations of one grammar:
`app/src/pages/journal-2-0/lib/importer/adapters/evernote.js` (the CLIENT lane: a member drops an
`.enex` export) and `convert/enml.py` (the SERVER lane: the live sync reads ENML from Evernote's
MCP server). Neither knows the other. This module and `enmlParity.contract.test.js` keep them
saying the same thing about every note. Do NOT merge the two lanes to fix a red: the rail is the fix.

── Shape (mirrors `obsidian_parity_fixtures_gen.py`) ───────────────────────

  - Committed inputs: `enml_fixtures_in/<stem>.enml` (a note's ENML, prolog included) and
    `<stem>.note.json` = `{guid, title, created, notebook, sourceUrl?, resources: [{hash, mime,
    name, data_b64}], notes: {<guid>: <title>}}`. `notes` names every note a link targets; the JS
    half puts each in the `.enex` as its own `<note>` so the client can resolve the link by title.
  - This module runs the REAL server lane, `enml.enml_to_tiptap`, then `linkify.finalize_links`
    (the engine's `_finalize_remote_doc`: what is stored), and reduces the doc to
    `semantic_summary`. It writes `__fixtures__/enml_parity/<stem>.json` = `{id, enml, note,
    server}`; the JS half rebuilds the `.enex` from `enml` + `note`, runs the client production
    path (`parseImport(evernoteAdapter)` + `htmlToNote`) and compares.
  - The summary normalises the two lanes' IDENTITY encodings and nothing else (spec section 4's
    anti-goal): an image ref becomes the bare md5 (server `evernote-res://<guid>/<md5>`, client
    `<md5>`), a web hotlink its URL; a note link becomes `note:<target title>` (server: GUID ->
    title through `notes`, or the `evernote-title:` key; client: the importKey it resolved -> that
    note's title); a web link its href.
  - `test_enml_parity_fixtures.py` is the Python half of the drift detector: the committed JSON
    must equal `render_all()`.

── Decisions this rail forced (Step 3: the client is the reference except where it loses content)

  - Code blocks: the client had no rule and flattened `-en-codeblock` to paragraphs. Decided up
    front (pre-flight ruling 5): the client gains the server's rule 9 (`<pre><code>`, lines
    verbatim, media found inside placed after the block). `07-codeblock` pins both lanes.
  - A `javascript:`/`vbscript:`/`file:` `<img>` (or a forged placeholder) in ENML: the server
    writes an `unsafe` notice; the client read `unresolvable_src`. The client adapter now refuses
    it as `unsafe` too (Task 3 carry-in). A `data:image/*` `<img>` is uploaded by both lanes
    (controller ruling "content wins", after Task 4; it was a named gap until then); the summary
    names it `data:<md5 of its bytes>`. `10-foreign-images`.
  - A raster typed `application/octet-stream` (Task 9 fix round 1, concern 5): content wins on
    both lanes. The client sniffs the resource bytes at parse time; the server decides in the
    engine's media stage, after download, and this generator applies that same decision from the
    sidecar's bytes. Raster signatures only (PNG, JPEG, GIF, WebP): an SVG stays a file.
    `12-octet-stream-raster`.
  - A leading space on a later line (Task 3 re-review R4): the client is the reference. An ENML
    line `<div>` has no parse rule, so the editor adds its text at the container level, where a
    later line keeps one leading space and the first line does not; a real `<p>` always loses
    it. The server ports that (`enml._trim_block_edges(later_line=)`). `11-formatting-and-whitespace`.
  - A to-do (or any block) first in a list item: the client's editor closes the item with an
    empty paragraph and moves the block up a level; the list's later items continue in a new
    bulletList. A to-do after the item's own text stays nested. The server ports that repair
    (`mddoc.repair_list_items`), replacing Task 3 m4's one-level guess. `01-todo`.

Runnable directly:
    python -m api.services.journal_two.note_connectors.convert.enml_parity_fixtures_gen
"""

from __future__ import annotations

import base64
import hashlib
import json
import pathlib
import urllib.parse
from typing import Any

from api.services.journal_two.media_policy import raster_signature
from api.services.journal_two.notes import extract_plain_text

from . import REF_PREFIX
from .enml import EVERNOTE_RES_SCHEME, EVERNOTE_TITLE_KIND, LIVE_KEY_PREFIX, enml_to_tiptap
from .linkify import finalize_links
from .mddoc import DATA_URI_RE
from .rewrite import chips_to_images

_HERE = pathlib.Path(__file__).resolve().parent
FIXTURES_IN_DIR = _HERE / "enml_fixtures_in"
_REPO_ROOT = _HERE.parents[4]
FIXTURES_OUT_DIR = (_REPO_ROOT / "app" / "src" / "pages" / "journal-2-0" / "lib" / "importer"
                    / "__fixtures__" / "enml_parity")

_LINK_PREFIX = "import-link://"


def _data_key(data_uri: str) -> str:
    """`data:<md5 of the decoded bytes>`: the identity both lanes give an uploaded data image
    (client ref `data-<md5>`, server ref `md-img-N` carrying the URI)."""
    match = DATA_URI_RE.match(data_uri)
    if match is None:
        return data_uri
    payload = match.group("payload")
    if ";base64" in match.group("params").lower():
        raw = base64.b64decode("".join(payload.split()))
    else:
        raw = urllib.parse.unquote_to_bytes(payload)
    return f"data:{hashlib.md5(raw).hexdigest()}"


def _image_ref(src: str, data_refs: dict[str, str]) -> str:
    ref = src[len(REF_PREFIX):] if src.startswith(REF_PREFIX) else src
    if ref.startswith(EVERNOTE_RES_SCHEME):
        return ref.rsplit("/", 1)[-1]  # the bare md5
    if ref in data_refs:
        return data_refs[ref]  # an uploaded data image
    return ref  # a web hotlink: its URL


def _link_target(href: str, notes: dict[str, str]) -> str:
    if not href.startswith(_LINK_PREFIX):
        return href
    key = href[len(_LINK_PREFIX):]
    if key.startswith(EVERNOTE_TITLE_KIND):
        return f"note:{key[len(EVERNOTE_TITLE_KIND):]}"
    if key.startswith(LIVE_KEY_PREFIX) and key[len(LIVE_KEY_PREFIX):] in notes:
        return f"note:{notes[key[len(LIVE_KEY_PREFIX):]]}"
    return key


def _walk(node: Any, notes: dict[str, str], out: dict[str, list],
          data_refs: dict[str, str]) -> None:
    """Mirrors `enmlParity.contract.test.js::summarize`'s walk (document order)."""
    if not isinstance(node, dict):
        return
    ntype = node.get("type")
    attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
    if ntype == "text":
        link = next((m for m in node.get("marks") or []
                     if isinstance(m, dict) and m.get("type") == "link"), None)
        if link is not None:
            out["links"].append({"text": node.get("text", ""),
                                 "target": _link_target((link.get("attrs") or {}).get("href", ""), notes)})
    elif ntype == "taskItem":
        out["task_checked"].append(bool(attrs.get("checked")))
    elif ntype == "image":
        out["images"].append(_image_ref(attrs.get("src", ""), data_refs))
    elif ntype == "attachmentChip":
        out["chips"].append(attrs.get("name"))
    elif ntype == "importNotice":
        out["notices"].append(attrs.get("reason"))
    for child in node.get("content") or []:
        _walk(child, notes, out, data_refs)


def semantic_summary(doc: dict[str, Any], notes: dict[str, str],
                     media: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Ordered top-level blocks (type + text), task checked flags, image refs (bare md5 or URL),
    attachment chip names, notice reasons and link targets. `text` reuses
    `notes.extract_plain_text`, pinned in lockstep with the client's `extractPlainText`."""
    out: dict[str, list] = {"blocks": [], "task_checked": [], "images": [], "chips": [],
                            "notices": [], "links": []}
    data_refs = {m["ref"]: _data_key(m["data_uri"]) for m in media or [] if m.get("data_uri")}
    for block in doc.get("content") or []:
        out["blocks"].append({"type": block.get("type"),
                              "text": extract_plain_text({"type": "doc", "content": [block]})})
        _walk(block, notes, out, data_refs)
    return out


def server_doc(enml_text: str, note: dict[str, Any]) -> tuple[dict[str, Any], list[dict]]:
    """The server lane exactly as the sync stores it: the converter, then the engine's finalize.
    Returns the doc and the converter's media list."""
    resources = [{"id": str(i), "hash": r["hash"], "mime": r["mime"], "name": r.get("name"),
                  "sizeBytes": 0} for i, r in enumerate(note.get("resources") or [])]
    result = enml_to_tiptap(enml_text, resources or None, note_guid=note["guid"],
                            source_url=note.get("sourceUrl"))
    # The engine's media stage (Task 9 fix round 1, concern 5): a file whose bytes are a raster
    # is stored as an image and its chip becomes an image (Evernote declares
    # `promote_raster_files`). Applied here from the fixture's own bytes, the same decision
    # (`media_policy.raster_signature`) through the same helper (`rewrite.chips_to_images`).
    data_by_hash = {r["hash"]: base64.b64decode(r["data_b64"]) for r in note.get("resources") or []}
    promoted = {m["ref"] for m in result["media"] if m.get("kind") != "image"
                and raster_signature(data_by_hash.get(m["ref"].rsplit("/", 1)[-1], b""))}
    doc = chips_to_images(result["doc"], promoted) if promoted else result["doc"]
    return finalize_links(doc), result["media"]


def _doc_and_notes(enml_text: str, note: dict[str, Any]) -> tuple:
    doc, media = server_doc(enml_text, note)
    return doc, note.get("notes") or {}, media


def _render(obj: dict[str, Any]) -> str:
    return json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def render_all(in_dir: pathlib.Path = FIXTURES_IN_DIR) -> dict[str, str]:
    """`{<stem>.json: text}` for every `*.enml` + sidecar pair under `in_dir`."""
    out: dict[str, str] = {}
    for enml_path in sorted(in_dir.glob("*.enml")):
        note = json.loads((in_dir / f"{enml_path.stem}.note.json").read_text(encoding="utf-8"))
        enml_text = enml_path.read_text(encoding="utf-8").replace("\r\n", "\n").rstrip("\n")
        fixture = {
            "id": enml_path.stem,
            "enml": enml_text,
            "note": note,
            "server": semantic_summary(*_doc_and_notes(enml_text, note)),
        }
        out[f"{enml_path.stem}.json"] = _render(fixture)
    return out


def generate(out_dir: pathlib.Path = FIXTURES_OUT_DIR,
             in_dir: pathlib.Path = FIXTURES_IN_DIR) -> list[pathlib.Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[pathlib.Path] = []
    for name, text in render_all(in_dir).items():
        path = out_dir / name
        path.write_text(text, encoding="utf-8", newline="\n")
        written.append(path)
    return written


if __name__ == "__main__":
    for path in generate():
        print(f"wrote {path}")
