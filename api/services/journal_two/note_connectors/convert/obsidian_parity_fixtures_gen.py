"""Cross-LANE parity-rail fixture generator for the Obsidian pre-passes.

── The risk this closes ────────────────────────────────────────────────────

Obsidian markdown is pre-processed in TWO places, for two different
transports of the same format: `app/src/pages/journal-2-0/lib/importer/
adapters/obsidian.js` (the CLIENT lane — a member drags an exported vault
into the file importer) and `api/services/journal_two/note_connectors/
providers/obsidian.py` (the SERVER lane — the Obsidian plugin pushes a vault
through the sync engine). Both hand-implement the same Obsidian-specific
grammar (`[[wikilinks]]`, `==highlight==`, task lists, embeds); neither knows
the other exists. That placement is DELIBERATE (providers own their format
quirks — the Dropbox precedent — and porting it into the shared `convert/`
layer conflicted with a concurrency constraint at the time this was built),
but "one grammar, two hand-written copies" drifts silently unless something
watches both copies agree. This module + `obsidianParity.contract.test.js`
(the JS half) are that guard. Do NOT merge the two lanes to "fix" this —
the guard is the fix.

── Shape — mirrors `fixtures_gen.py` exactly ───────────────────────────────

  - Python-owned, committed raw inputs under `obsidian_fixtures_in/*.md`,
    each with a `<stem>.vault.json` sidecar: `{vault_id, self_path,
    vault_paths, attachments?}`. `vault_paths` is the REAL vault listing,
    markdown AND binaries: that is what the CLIENT lane sees when a member
    drags the folder in. The SERVER lane is given only the `.md` entries as
    its staging paths, because production staging never holds a binary path
    (the plugin stages notes; it sends files as the note's attachment refs),
    plus `attachments` as the note's refs (Plan C Task 4). A sidecar with no
    `attachments` is a note that references no file, as a >=0.2.0 plugin
    sends it: an empty list. ⚰️ Until Plan C Task 4 the server lane was
    handed the binaries as staging paths too, which production never does,
    so the rail compared an image path production could not produce.
  - This module runs the REAL server-side conversion
    (`ObsidianProvider._convert_row` -> `providers.obsidian.convert_obsidian_markdown`:
    the pre-pass, the REAL shared converter `convert.mddoc.md_to_tiptap` with the
    vault's relative-link resolver, and callouts) — never a second, hand-rolled
    copy — then reduces the resulting TipTap doc to a SEMANTIC summary. Node/
    mark SHAPE validity is already covered by the schema-contract rail
    (`fixtures_gen.py` / `serverConvert.contract.test.js`); this rail checks
    a narrower, cross-LANE claim: do the client adapter's wiki-syntax
    pre-passes and this provider's agree on what a wikilink/highlight/embed/
    task item MEANS.
  - The summary is deliberately NORMALIZED past each lane's own identity-
    encoding scheme. Server link hrefs look like
    `import-link://obsidian:{vault_id}/{path}`; the client adapter has no
    multi-vault concept (one drag-in batch is implicitly one vault), so its
    hrefs look like `import-link://obsidian:{path}` — no vault_id segment.
    That is a legitimate consequence of two DIFFERENT transports (a one-shot
    local batch vs. a persistent per-vault sync), not a divergence this rail
    should ever flag, so both sides strip down to the bare resolved
    vault-relative path before comparing. See `_normalize_link_href`/
    `_normalize_image_src` here and their JS mirrors in
    `obsidianParity.contract.test.js::normalizeLinkHref`/`normalizeImageSrc`.
    Image `src` values need no such stripping — both lanes emit the same
    `import-ref://{path}` shape (`_image_node` in mddoc.py adds that prefix
    the same way `transformEmbeds` does in obsidian.js) — the code strips it
    anyway, for readability, since both sides agree it is safe to.
  - Written to `app/src/pages/journal-2-0/lib/importer/__fixtures__/
    obsidian_parity/<stem>.json` (sibling of `server_convert/`).
    `obsidianParity.contract.test.js` (the JS half of this rail) loads every
    one of those, re-derives the SAME summary by running the CLIENT adapter
    (`adapters/obsidian.js::obsidianAdapter.parse` + `importer/
    convert.js::htmlToNote` — the exact path `ImportWizard.jsx` uses in
    production) over the fixture's own `input_markdown`/`vault_paths`, and
    asserts the two summaries are equal. A pre-pass that silently stops
    handling a construct on EITHER side moves that lane's summary and turns
    the JS test red — not a silent runtime divergence the next time a member
    drags in the same vault the plugin already synced.
  - `test_obsidian_parity_fixtures.py` is the OTHER half of the drift
    detector, on the Python side only (mirrors
    `test_note_convert_fixtures.py`): it asserts regenerating into a temp
    dir reproduces the COMMITTED fixtures byte-for-byte, so an uncommitted
    regeneration here is caught even before the JS rail runs.

Determinism: `ObsidianProvider._convert_row` (pre-pass + `md_to_tiptap`) is
deterministic per input (see `fixtures_gen.py`'s own note on this). This
module adds `sort_keys=True` + a fixed `indent`/newline convention on top,
same as `fixtures_gen.py`.

Runnable directly:
    python -m api.services.journal_two.note_connectors.convert.obsidian_parity_fixtures_gen
"""

from __future__ import annotations

import json
import pathlib
import urllib.parse
from typing import Any

from api.services.journal_two.notes import extract_plain_text

from ..link_keys import OBSIDIAN_NAME_KIND
from ..providers.obsidian import (
    ATT_SCHEME,
    FILE_SCHEME,
    ObsidianProvider,
    _build_basename_map,
)

_HERE = pathlib.Path(__file__).resolve().parent
FIXTURES_IN_DIR = _HERE / "obsidian_fixtures_in"

# api/services/journal_two/note_connectors/convert/obsidian_parity_fixtures_gen.py
#   -> convert -> note_connectors -> journal_two -> services -> api -> <repo root>
_REPO_ROOT = _HERE.parents[4]
FIXTURES_OUT_DIR = (
    _REPO_ROOT
    / "app"
    / "src"
    / "pages"
    / "journal-2-0"
    / "lib"
    / "importer"
    / "__fixtures__"
    / "obsidian_parity"
)


def _normalize_link_href(href: str, vault_id: str) -> str:
    """Strips this lane's identity-encoding down to the bare resolved vault
    path -- see the module docstring's "Shape" section. Mirrors
    `obsidianParity.contract.test.js::normalizeLinkHref`, minus the
    vault_id segment the client lane never had in the first place.

    The rail compares the STORED hrefs byte-for-byte: it removes the prefix
    and nothing else. It used to `urllib.parse.unquote` the remainder, which
    hid the very defect it exists to catch (a wikilink to a name with a space
    stored `%20` and never resolved). The one decode now lives in
    `mddoc._destination_as_written`."""
    prefix = f"import-link://obsidian:{vault_id}/"
    return href[len(prefix):] if href.startswith(prefix) else href


def _normalize_image_src(src: str, refs: list[dict] | None = None) -> str:
    """Mirrors `obsidianParity.contract.test.js::normalizeImageSrc`. Same
    byte-for-byte rule as `_normalize_link_href` above.

    Plan C Task 4: an attachment the plugin sent is stored as
    `obsidian-att:<sha256>/<quoted name>` (or `obsidian-file:`), this lane's
    OWN deterministic encoding of a staged blob. It maps to the `path` of the
    sidecar ref with that sha, the vault path the client lane names it by.
    That strips our own encoding and nothing else: no percent-decoding of
    anything, and an unknown sha stays as written so the rail shows it."""
    prefix = "import-ref://"
    bare = src[len(prefix):] if src.startswith(prefix) else src
    for scheme in (ATT_SCHEME, FILE_SCHEME):
        if bare.startswith(scheme):
            sha = bare[len(scheme):].split("/", 1)[0]
            for ref in refs or ():
                if ref.get("sha256") == sha and isinstance(ref.get("path"), str):
                    return ref["path"]
    return bare


_PENDING_PREFIX = f"import-link://{OBSIDIAN_NAME_KIND}"


def _walk_semantic(node: Any, vault_id: str, out: dict[str, list],
                   refs: list[dict] | None = None) -> None:
    """Recursive doc walk collecting the three cross-lane-comparable facts a
    wikilink/embed/task-list pre-pass can get wrong: what a link resolved
    to, what an embed resolved to, and which task items are checked. Mirrors
    `obsidianParity.contract.test.js::walkSemantic` exactly (document order,
    same node-type dispatch)."""
    if not isinstance(node, dict):
        return
    ntype = node.get("type")
    attrs = node.get("attrs")
    if not isinstance(attrs, dict):
        attrs = {}
    if ntype == "text":
        marks = node.get("marks") or []
        link_mark = next(
            (m for m in marks if isinstance(m, dict) and m.get("type") == "link"), None,
        )
        if link_mark is not None:
            href = (link_mark.get("attrs") or {}).get("href", "")
            if href.startswith(_PENDING_PREFIX):
                # Plan A Task 13: a link waiting for its note (a `name:` key) is NOT a
                # resolved link, so it is never counted under `links`. It has its own
                # list, which the JS rail treats as server-only: the client lane has no
                # later heal, and shows the same text with no link.
                out["pending"].append({"text": node.get("text", ""),
                                       "key": href[len("import-link://"):]})
            else:
                out["links"].append({
                    "text": node.get("text", ""),
                    "target": _normalize_link_href(href, vault_id),
                })
        # N5 (wave 5 review): a `==x==` highlight is a MARK in both lanes now.
        # The run's text AND its colour (null = the default highlight) -- so
        # neither lane can drop the mark, or invent a colour, unseen.
        hl_mark = next(
            (m for m in marks if isinstance(m, dict) and m.get("type") == "highlight"), None,
        )
        if hl_mark is not None:
            out["highlights"].append({
                "text": node.get("text", ""),
                "color": (hl_mark.get("attrs") or {}).get("color"),
            })
    elif ntype == "image":
        out["images"].append(_normalize_image_src(attrs.get("src", ""), refs))
    elif ntype == "attachmentChip":
        # Plan C Task 4: a non-image file is a chip in both lanes. Its NAME, in
        # document order -- what the member reads on the chip.
        out["files"].append(attrs.get("name"))
    elif ntype == "callout":
        # Plan A Task 13: an Obsidian callout is the editor's callout node, by variant.
        out["callouts"].append(attrs.get("variant"))
    elif ntype == "taskItem":
        out["task_checked"].append(bool(attrs.get("checked")))
    for child in node.get("content") or []:
        _walk_semantic(child, vault_id, out, refs)


def semantic_summary(doc: dict[str, Any], vault_id: str,
                     refs: list[dict] | None = None) -> dict[str, Any]:
    """The cross-lane comparison unit this whole rail is built around.
    `text` reuses `notes.extract_plain_text` — the SAME function that is
    already pinned in lockstep with the client's `lib/tiptap.js::
    extractPlainText` for the notebook search index — rather than a fourth
    hand-rolled text walker. Mirrors `obsidianParity.contract.test.js::
    semanticSummary`."""
    out: dict[str, list] = {"links": [], "images": [], "task_checked": [], "highlights": [],
                            "pending": [], "callouts": [], "files": []}
    _walk_semantic(doc, vault_id, out, refs)
    return {"text": extract_plain_text(doc), **out}


def _render(obj: dict[str, Any]) -> str:
    return json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def generate(
    out_dir: pathlib.Path = FIXTURES_OUT_DIR,
    in_dir: pathlib.Path = FIXTURES_IN_DIR,
) -> list[pathlib.Path]:
    """Regenerates every fixture JSON under `out_dir` from every `*.md` +
    `<stem>.vault.json` pair under `in_dir`. Returns the sorted list of
    paths written. `out_dir` is created if missing; existing files not
    matching a current input stem are left alone (mirrors
    `fixtures_gen.generate`'s own contract)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[pathlib.Path] = []
    for md_path in sorted(in_dir.glob("*.md")):
        manifest_path = in_dir / f"{md_path.stem}.vault.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        vault_id = manifest["vault_id"]
        self_path = manifest["self_path"]
        vault_paths = manifest["vault_paths"]
        attachments = manifest.get("attachments", [])
        body_md = md_path.read_text(encoding="utf-8")

        # Production truth: staging holds notes only; files arrive as refs.
        server_paths = [p for p in vault_paths if p.endswith(".md")]
        basename_map = _build_basename_map(server_paths)
        # A throwaway provider instance purely to reuse the REAL
        # `import_key` formatting (no DB access — `import_key` is pure
        # string formatting; see `providers/base.py::NoteProvider.import_key`)
        # rather than hand-typing the `obsidian:{vault_id}/{path}` format a
        # second time.
        provider = ObsidianProvider(user_id="fixture-user", vault_id=vault_id)
        # The provider's OWN conversion (`_convert_row`: pre-pass, the shared converter
        # with the vault's relative-link resolver, callouts) -- the pipeline that syncs.
        result = provider._convert_row(self_path, body_md, server_paths, basename_map,
                                       vault_label=manifest.get("vault_label"),
                                       refs=attachments)

        fixture = {
            "id": md_path.stem,
            "input_markdown": body_md,
            "self_path": self_path,
            "vault_id": vault_id,
            "vault_paths": vault_paths,
            "server": semantic_summary(result["doc"], vault_id, attachments),
        }
        out_path = out_dir / f"{md_path.stem}.json"
        out_path.write_text(_render(fixture), encoding="utf-8", newline="\n")
        written.append(out_path)
    return written


if __name__ == "__main__":
    for path in generate():
        print(f"wrote {path}")
