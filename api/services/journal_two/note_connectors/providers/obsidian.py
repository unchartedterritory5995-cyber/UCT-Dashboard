"""Obsidian push-transport provider — the architectural crux of the
2026-09-02 Obsidian-ingest-server plan.

Obsidian is local-first: there is no remote API for this provider to poll.
Instead, the plugin PUSHES markdown bodies into `j2_obsidian_staging` and,
on a `final` push, replaces `j2_obsidian_manifest` with the vault's complete
file list (`note_connectors/obsidian_staging.py::ingest_batch`, Task 3). This
module is the seam that makes that push transport LOOK like an ordinary PULL
provider to the sync engine: `list_changed`/`fetch`/`fetch_many` read the
staging table exactly like a provider's own change-feed, and
`list_present_refs` hands the engine the manifest as the "complete remote
set" hook it already knows how to use for delete detection. Nothing about
`engine.py` needed to change for this to work — that is the point.

── Pre-flight verification against the LIVE engine.py (read before touching
   the cursor logic below) ──────────────────────────────────────────────────

1. `list_present_refs` is OPTIONAL and resolved via
   `getattr(provider, "list_present_refs", None)` in `_do_sync`, at the SAME
   spot `list_deleted` is resolved immediately below it (engine.py ~L412,
   ~L460). Signature: `async def list_present_refs(self, credentials:
   dict[str, Any]) -> list[RemoteRef]` — confirmed against
   `OneNoteProvider.list_present_refs` (`providers/onenote.py` ~L545), the
   only other provider implementing this hook, and against
   `test_note_connectors_engine_present_refs.py`, which drives the hook via
   `provider.list_present_refs = async def(credentials): ...` on a bare
   fake. It returns the COMPLETE current remote set (ids + a best-effort
   timestamp); the engine feeds it into BOTH `_run_delete_detection` and
   `_touch_remote_index` as `index_refs` on a `full=True` pass ONLY, while
   `list_changed`'s own result keeps driving `_fetch_remote_notes`
   unchanged. A raising hook (or no hook at all) falls back to
   `index_refs = refs` — today's Roam/Craft/Notion/Dropbox/OneDrive
   behavior — with a named `item_failures` entry, never aborting the sync.

2. Cursor consequence (engine.py ~L406-439, the "Fix-round-1 Important #1 /
   Finding B" comment block): because THIS provider defines
   `list_present_refs`, `_do_sync` will NEVER reset `list_changed`'s cursor
   to `None` on a full pass — it hands back whatever is stored on
   `source["cursor"]`, exactly like an incremental pass. The `cursor is
   None` full-reset branch is reserved for providers WITHOUT the hook
   (their `list_changed` is the ONLY completeness signal, so a full pass
   must force it to re-enumerate everything). This provider's own
   `list_changed` is a plain "rows newer than cursor" filter — cheap to
   re-run in full, but there is no need to: `list_present_refs` already
   supplies delete-detection completeness independently, so a full pass
   here still only asks `list_changed` for what changed since last time
   (exactly like an incremental pass would), and delete detection still
   sees everything via the manifest. Concretely: `list_changed` MUST NOT
   assume `cursor is None` means "this is a full/complete listing" the way
   Dropbox/Roam do — for this provider `cursor is None` means ONLY "no
   sync has ever completed yet," never "this is a nightly full pass." The
   implementation below never branches on `full` at all (it isn't even
   visible to a provider — `list_changed`'s signature has no `full` param
   in any provider), which is the only correct shape given the above: it
   always returns "staged rows whose SERVER-assigned `received_at` is newer
   than `cursor`," full pass or not — see item 3 for why `received_at`, not
   `updated_at`.

3. ⛔⛔ SECURITY (2026-09-02 review, C1) — the cursor is NEVER built from the
   client-supplied `updated_at` column. It used to be: `engine.py`'s default
   cursor-advance derives `max(ref.updated_at for ref in refs)` from
   whatever `list_changed` returns, and `RemoteRef.updated_at` came straight
   from `j2_obsidian_staging.updated_at` — the plugin's own filesystem mtime,
   forwarded with no validation (measured: `obsidian_staging.ingest_batch`
   stored it verbatim). One staged row with a garbled/absurd mtime (a bad
   mtime is an ORDINARY failure mode, no attacker required) became a cursor
   floor no genuine future timestamp could ever clear — and because item 1/2
   above deliberately keep the engine from resetting this provider's cursor
   on a full pass (correct for OneNote's bounded drain; this provider has no
   such drain to protect), there was no self-heal: the vault's sync just
   silently stopped, forever, reporting `status: ok`. Fixed at TWO layers,
   neither a substitute for the other: `obsidian_staging.ingest_batch`
   clamps an implausible `updated_at` at write time (see that module's own
   C1 section), and — independently, so a gap in that clamp can't reproduce
   this — `list_changed` below cursors on `received_at`, a column ONLY this
   server ever writes (`obsidian_staging._now_iso()`), and publishes it via
   `self.opaque_cursor` (`base.py`'s Dropbox-precedent extension point):
   the engine persists that value VERBATIM instead of deriving one from
   `refs`. `RemoteRef.updated_at` (this method's return value) is UNCHANGED
   — it still carries the note's own (now-clamped) `updated_at` for
   display/conflict purposes; only the CURSOR moved off of it.

── Conversion — reuses the existing converter, never a second one ──────────

`convert.md_to_tiptap` (Task 5, `convert/mddoc.py`) already turns CommonMark
+ GFM tables/strikethrough + task-list checkboxes into TipTap JSON — task
lists in particular need NO extra work here (`mdit_py_plugins.tasklists`
already fires on plain `- [ ] x` / `- [x] x` syntax, which is valid
CommonMark-adjacent markdown `md_to_tiptap` already parses natively).

What IS missing server-side, per the task brief, is Obsidian's own
wiki-syntax, which `md_to_tiptap`'s markdown-it-py token stream has no
notion of at all (`[[...]]` and `==...==` are not markdown-it tokens; a raw
`[[Target]]` simply tokenizes as literal bracket text, and `==x==` as
literal equals signs). The wizard's client-side twin
(`app/src/pages/journal-2-0/lib/importer/adapters/obsidian.js`,
`preprocessWikiSyntax`) solves this with a text-level pre-pass BEFORE
`mdToHtml`, applied only outside fenced/inline code. This module ports that
idea — NOT that implementation, which targets an HTML intermediate this
server-side path doesn't have — as a markdown-to-markdown pre-pass run
before `md_to_tiptap`, mirroring exactly how `DropboxProvider` already does
its OWN connector-specific pre/post-processing around the shared converter
(`_resolve_relative_media_markdown`, `_promote_md_attachments` in
`providers/dropbox.py`) rather than teaching `convert/mddoc.py` a
provider-specific grammar. Two syntaxes, two decisions:

  - `[[Target]]` / `[[Target|alias]]` / `![[Target]]` — resolved against the
    UNION of this vault's manifest + staging vault_paths (the closest
    server-side equivalent of the JS adapter's whole-batch `vfiles` array),
    using the SAME rule (`_resolve_in`/`_pick` here, `resolveTarget`/`pick`
    in `obsidian.js`; parity fixture `15-dotted-names` pins both). A resolved plain wikilink becomes a real CommonMark link
    `[display](<import-link://{import_key}>)` — `import_key` comes from
    `self.import_key(self.vault_id, resolved_path)`, the SAME method
    `engine.py::_touch_remote_index`/`_import_remote_notes` use to compute
    every OTHER note's import_key, so a link that resolves today points at
    exactly the row that note will land under once it syncs (this repo's
    own "derive, never restate" rule — `lesson_a_second_authority_over_one_
    value`). `md_to_tiptap` already turns that literal markdown link syntax
    into a real `link` mark and records the target in `links` (see
    `_is_allowed_link_href`'s `LINK_PREFIX` branch) — no new code needed
    there. An embed (`![[...]]`) whose target is an image becomes ordinary
    markdown image syntax with the UNRESOLVED vault-relative path as its
    literal src (deliberately NOT wrapped in `REF_PREFIX` — `_image_node`
    registers any non-`REF_PREFIX`, non-`data:` src as a normal media
    reference), so it flows through the engine's ordinary media-upload path
    and reaches THIS provider's own `fetch_media` — which honestly raises
    `NoteConnUnsupported` for it (a bare vault path names no staged bytes).
    ⭐ Plan C Task 3: since plugin 0.2.0 an embed the plugin sent a REF for
    never reaches this branch -- the attachment pass (`_apply_attachment_refs`,
    see the "Attachments" section below) swaps it first for a staged-blob
    image, a file chip or a visible notice. An unresolved IMAGE embed degrades to plain text, never a
    broken image. ⭐ Plan A Task 13 (O-4): an unresolved wikilink (or note
    embed) keeps the member's text under a PENDING mark,
    `import-link://name:obsidian:<vault_id>/<target, lowercased>`, which
    `link_keys.resolve_link_keys` resolves with this module's own
    `_resolve_target` once the note exists -- so a link written before its
    note heals on a later sync without the linking note being re-pushed.
    ⚰️ It used to become plain text (the JS adapter still does; the parity
    rail reports `name:` links under `pending`, server-only). Task 13 also
    resolves relative `.md` links (`_relative_href_resolver`, through
    `md_to_tiptap(resolve_href=...)`), this vault's `obsidian://open` deep
    links, `#Heading` anchors in display text, callouts, raw `<img>`/`<a>`,
    and duplicate names (same folder, then shortest path) -- see
    `convert_obsidian_markdown`.

    ⛔ Parity-rail finding (2026-09-02, `obsidianParity.contract.test.js` +
    `obsidian_parity_fixtures_gen.py`): the CommonMark link/image destination
    `(resolved)`/`(import-link://{key})` above MUST be angle-bracket-wrapped
    (`(<resolved>)`/`(<import-link://{key}>)`) — a bare destination
    containing a space is NOT valid CommonMark and markdown-it-py degrades
    the WHOLE construct to literal visible text (`[disp](a b.md)` renders as
    the seven characters `[disp](a b.md)`, not a link). Since Obsidian's own
    default note-naming convention is "Title Case With Spaces.md", this was
    a near-guaranteed real-world failure on the sync lane while the SAME
    vault imported correctly via the client drag-in lane (which builds an
    `<a data-import-link="...">` HTML attribute directly — HTML attribute
    values tolerate spaces natively, so the client lane never hit this).
    Found and fixed by the parity rail itself, the day it was built — see
    the rail's own report for the RED reproduction. `md_to_tiptap` /
    markdown-it-py percent-encodes the destination when parsing the
    angle-bracket form (`Target Note.md` -> `href` ending `...Target%20Note.
    md`); the parity rail's normalizer un-quotes this back to the literal
    path before comparing lanes, since the encoding is a markdown-parser
    artifact, not a semantic difference from the client lane's unencoded
    `href`.
  - `==highlight==` — a HIGHLIGHT MARK, the same as the file importer.
    Since wave 5 the schema registers one (`NotebookHighlight`,
    `tiptap.js`), and `adapters/obsidian.js` emits `<mark>…</mark>`, which
    `generateJSON` parses into it. This pass emits the same `<mark>` (inner
    text HTML-escaped exactly as the JS lane's `escapeHtml` does), and
    `md_to_tiptap`'s inline walker turns a `<mark>`/`</mark>` `html_inline`
    pair into the `highlight` mark (see `_inline_nodes`); any OTHER raw
    inline HTML still degrades to visible text. ⚰️ Until 2026-09-24 this
    stripped the delimiters to bare text, on the grounds that the schema had
    no highlight mark -- stale since the schema gained one, so the same vault
    read one way through sync and another through the file importer (review
    N5). The parity rail's summary now carries the highlight runs, so the two
    lanes cannot drift apart on it again.

Both passes run only OUTSIDE fenced (```) and inline (`) code spans, mirroring
`obsidian.js::transformOutsideCode` — code content must never be
rewritten.

Escaping caveat (accepted, bounded limitation, mirrors precedent in
`providers/dropbox.py`'s own relative-link module docstring): unresolved
wikilink/embed fallback text is inserted back into the markdown stream
byte-for-byte. A vault filename containing markdown-significant characters
(`_`, `*`, a stray `` ` ``) could theoretically pick up unintended emphasis
from neighboring text. This is a pre-existing class of risk this pre-pass
does not introduce (any hand-authored markdown has the same property) and
is left unescaped rather than adding a bespoke markdown-escaper here. The
angle-bracket destination wrapping added for the space-in-path fix above
carries the same accepted-risk shape one level further: a vault filename
containing a literal `<`, `>`, or backslash could in principle break the
angle-bracket destination form. Vault paths originate from the plugin's own
filesystem walk, not free-text user input, so this is judged as remote as
the existing markdown-significant-character risk above, and is accepted on
the same terms rather than adding a bespoke escaper.

── Deliberately duplicated, kept honest by a rail — NOT an oversight ───────

This provider and `adapters/obsidian.js` are two independent, hand-written
implementations of the same Obsidian grammar (`[[wikilinks]]`,
`==highlight==`, task lists, embeds) for two different transports (this
provider: the plugin's persistent per-vault PUSH sync; the JS adapter: a
member dragging an exported vault into the file importer, a one-shot local
batch). That duplication was accepted deliberately — providers owning their
own format quirks matches the Dropbox precedent, and porting Obsidian's
grammar into the shared `convert/` layer conflicted with a concurrency
constraint at the time this was built. "One grammar, two hand-written
copies" drifts silently unless something watches both copies agree, so
**do not "fix" the duplication by merging the two lanes** — instead:

  - `convert/obsidian_parity_fixtures_gen.py` (Python, the fixture
    generator/authority for this rail — mirrors `convert/fixtures_gen.py`'s
    shape) runs THIS provider's pre-pass + the real converter over a shared
    set of committed markdown fixtures (`convert/obsidian_fixtures_in/`) and
    reduces the result to a semantic summary (resolved link targets, image
    targets, task-checked states, plain text).
  - `app/.../lib/importer/obsidianParity.contract.test.js` (JS, vitest)
    loads those committed summaries, re-derives the SAME summary by running
    `adapters/obsidian.js` + the real client `htmlToNote` pipeline over the
    identical inputs, and asserts equality. **This is the rail that goes red
    the moment either lane's pre-pass silently stops handling a construct
    the other still does** — see that file's own docstring for the
    RED/GREEN proof this was built against (the space-in-path bug above was
    found BY this rail, not discovered separately and then encoded into it).
  - `test_obsidian_parity_fixtures.py` (Python, pytest) is the drift
    detector on the Python side alone, mirroring
    `test_note_convert_fixtures.py`: it fails if the committed fixtures
    under `__fixtures__/obsidian_parity/` are stale relative to what
    `obsidian_parity_fixtures_gen.py` would produce today.

If you are reading this because you noticed the duplication and are
tempted to delete one copy: don't, without first checking whether the two
rails above are still green, and if you DO intentionally change what one
lane accepts, regenerate the fixtures and expect (and read) a RED
`obsidianParity.contract.test.js` naming exactly what moved.

Tenant scoping is structural, not credential-derived: every query below
filters on `(self.user_id, self.vault_id)`, both bound at CONSTRUCTION time
(mirrors `DropboxProvider(folder_path=...)`'s source-aware-construction
precedent, `registry.py::_build_dropbox` reading `source["remoteId"]`) —
`credentials` is accepted (per the `NoteProvider` contract) but never read
for scoping, so nothing in the request/credential path can smuggle a
cross-tenant read the way `j2_obsidian_devices`'s bare `id` PK cannot stop
one on its own (Task 3's own module docstring names this as the constraint
most likely to bite).

Spec: docs/superpowers/specs/2026-09-02-obsidian-ingest-server-design.md
Brief: .superpowers/sdd/2026-09-02-obsidian-ingest-server/task-4-brief.md
"""

from __future__ import annotations

import asyncio
import bisect
import json
import posixpath
import re
from typing import Any
from urllib.parse import parse_qs, quote, unquote, urlsplit

import httpx

from api.services.auth_db import get_connection
from api.services.journal_two import import_notice
from api.services.journal_two.import_provenance import edited_since_import

from .. import errors, obsidian_attachments, obsidian_link
from ..convert import LINK_PREFIX, REF_PREFIX, md_to_tiptap
from ..convert.mddoc import _get_md
from ..convert.placeholders import map_image_nodes
from ..link_keys import OBSIDIAN_NAME_KIND
from .base import AccountInfo, NoteProvider, RemoteNote, RemoteRef, fetch_content_url, media_http_client

# ---------------------------------------------------------------------------
# Wiki-syntax pre-pass (markdown -> markdown, run before md_to_tiptap)
# ---------------------------------------------------------------------------

# Fence alternative first, mirroring `obsidian.js::CODE_RE` exactly — at a
# run of 3+ backticks it must win over the inline-span alternative or the
# inline pattern would consume just the fence's opening backticks.
# Fix round 1 (M-4): a `~~~` fence is code too (CommonMark), and its contents are never
# rewritten. ⚠️ The client lane's `CODE_RE` still knows only backtick fences.
# Indented (4-space) code is NOT split out here: a regex cannot tell it from a nested
# list's continuation lines, and skipping those would stop resolving wikilinks inside
# nested lists. The callout pass cannot touch indented code (it allows <= 3 spaces).
_FENCE_SRC = r"```[\s\S]*?```|~~~[\s\S]*?~~~"
_CODE_RE = re.compile(_FENCE_SRC + r"|`[^`\n]*`")

# One combined regex for both wikilinks and embeds — an optional leading `!`
# distinguishes them (group 1). `[^\]|]+` stops at the first `|` or `]`,
# same as `obsidian.js`'s `WIKILINK_RE`/`EMBED_RE`: for a wikilink the
# optional group after `|` is an ALIAS; for an embed it is Obsidian's
# `|width` sizing suffix and is deliberately ignored (mirrors
# `transformEmbeds`'s `rawTarget.split('|')[0]`).
# ⛔ A target or alias never runs across a `[[` (D2 item 3, then D2 fix round 3): in
# `[[![[img.png]]]]` the match is the inner embed, never a wikilink to a note named
# `![[img.png`. ⛔ And it is what keeps these patterns LINEAR: a target that could take
# `[` scanned the rest of a line of `[` at every one of them, so a 20 KB line of `[` cost
# ~13 s per sync (~20 s on an old-plugin row). Obsidian itself refuses `[` and `]` in a
# file name, so no real target holds `[[`.
_WIKI_TARGET = r"(?:(?!\[\[)[^\]|])+"
_WIKI_ALIAS = r"(?:(?!\[\[)[^\]])+"
_WIKI_EMBED = rf"!\[\[{_WIKI_TARGET}(?:\|{_WIKI_ALIAS})?\]\]"
_WIKI_RE = re.compile(rf"(!)?\[\[({_WIKI_TARGET})(?:\|({_WIKI_ALIAS}))?\]\]")
# D2 fix round 1 (e): an embed in ALIAS position, `[[Plan|![[img.png]]]]` (or the attachment
# pass's markdown for that embed inside one). It reads as the embed, then the link to the
# note as a plain `[[Plan]]` would read -- both kept. ⚰️ The alias pattern took `![[img.png`
# as the alias: raw brackets around the image, and the link lost. The client lane writes
# the same (`obsidian.js::transformWikiLinks`).
_ALIAS_EMBED_RE = re.compile(
    rf"\[\[({_WIKI_TARGET})\|({_WIKI_EMBED}|!\[\]\(<[^<>\n]*>\))\]\]")
#: The same link as an original cut off at the embed's own `]]` (D2 fix round 3, N-I3).
_CUT_ALIAS_EMBED_RE = re.compile(rf"\[\[({_WIKI_TARGET})\|({_WIKI_EMBED})")
# D2 item 3: an embed wrapped in a wikilink, `[[![[img.png]]]]` / `[[![[img.png|300]]|alias]]`,
# or the attachment pass's markdown for that embed (`![](<obsidian-att:...>)`) inside one.
# Without an alias it reads as the embed; with one, as the alias alone (item 4). Mirrors
# what the client's held markup does (`obsidian.js::preprocessWikiSyntax`).
_NESTED_EMBED_RE = re.compile(
    rf"\[\[({_WIKI_EMBED}|!\[\]\(<[^<>\n]*>\))(?:\|({_WIKI_ALIAS}))?\]\]")
# ⛔ A trader's prose is full of `==` COMPARISONS ("if rsi == 30 and macd == 0").
# The old `==([^=\n]+)==` read the span between two comparisons as a highlight and
# deleted both operators. A highlight now needs a non-space just inside each `==`,
# and neither marker may touch a word character or another `=` on its outside.
# ⚠️ This is NOT the editor's typed rule (`textColor.js::HIGHLIGHT_FIND`), and it
# is looser on purpose. Typing needs start-of-text, a space or an opening bracket
# before the `==`, and fires only when a space or punctuation is typed after the
# closing `==`, because an input rule fires MID-keystroke and must never fire on
# `==` a member is still typing inside a word. An import reads FINISHED text, so
# it only has to rule out comparisons and word-internal `==`: any character that
# is not `=` or a word character may sit outside the markers. So `"==risk=="` is
# a highlight on import and not when typed. The client lane
# (`adapters/obsidian.js`) mirrors THIS rule; the parity fixture `08-comparisons`
# pins both.
_HIGHLIGHT_RE = re.compile(r"(^|[^=\w])==(?=\S)([^=\n]*?\S)==(?![=\w])")
_IMAGE_EXT_RE = re.compile(r"\.(png|jpe?g|gif|webp|svg|bmp|heic)$", re.IGNORECASE)


def _strip_ext(path: str) -> str:
    idx = path.rfind(".")
    return path[:idx] if idx > 0 else path


def _basename(path: str) -> str:
    return path.rsplit("/", 1)[-1]


def _basename_sans_ext(path: str) -> str:
    return _strip_ext(_basename(path))


def _strip_fragment(target: str) -> str:
    """Drops a trailing `#Heading` / `#^blockId` anchor before resolution —
    mirrors `obsidian.js::stripFragment`. The anchor has no equivalent here;
    the target NOTE still resolves, the finer-grained anchor is dropped."""
    idx = target.find("#")
    return (target[:idx] if idx != -1 else target).strip()


class _VaultIndex(dict):
    """A vault's paths, indexed ONCE for every lookup the link rules make (fix round 1,
    I-1/I-2). As a dict it is the basename map: lowercased, extension-stripped basename
    -> EVERY full vault path with that name, in the order seen (`_resolve_in` filters and
    picks among them, so a lookup costs the number of same-named files, never the vault).
    `by_lower` maps a lowercased path -> the first such path (relative links).
    Built in O(V). ⛔ Never rebuilt per note or per key: a fetch builds one for the batch
    and the heal builds one per vault per resolve call. ⚰️ Before this, the relative
    resolver rebuilt a path dict for EVERY note and the path-qualified rule scanned every
    path for every key -- O(notes x paths) on a first sync, on the loop. ⚰️ D1 fix round 2:
    the `exact`/`suffix` maps (each path with AND without its extension) are gone; a
    stripped form let `[[Notes/Plan]]` open `Notes/Plan.md.bak`."""

    def __init__(self, paths: list[str]) -> None:
        super().__init__()
        self.paths = list(paths)
        self.by_lower: dict[str, str] = {}
        for path in self.paths:
            self.setdefault(_basename_sans_ext(path).lower(), []).append(path)
            self.by_lower.setdefault(path.lower(), path)


def _build_basename_map(paths: list[str]) -> _VaultIndex:
    """THE index of a vault's paths -- see `_VaultIndex`. Build it once per batch."""
    return _VaultIndex(paths)


def _index_of(paths: list[str], basename_map: Any) -> _VaultIndex:
    return basename_map if isinstance(basename_map, _VaultIndex) else _VaultIndex(paths)


def _dir_of(path: str) -> str:
    return path.rsplit("/", 1)[0] if "/" in path else ""


def _note_file_of(target: str) -> str:
    """The note file a wikilink target names, lowercased: `<target>.md`, or the target itself
    when it already ends in `.md`. ⛔ Every dot is part of the note's name: `[[Dr.Smith]]`,
    `[[Q3.Review]]`, `[[v1.2 notes]]` and even `[[Brief.txt]]` name `Dr.Smith.md`,
    `Q3.Review.md`, `v1.2 notes.md` and `Brief.txt.md`. That note, when staged, ALWAYS wins
    (Obsidian's own order); only when it is absent does `[[report.pdf]]` mean the file.
    ⚰️ The bare-name rule used to strip `.Smith` as if it were an extension and look up `Dr`,
    so those links stayed pending forever, or opened `Dr.md`. Mirrors
    `obsidian.js::noteFileOf`."""
    lower = target.lower()
    return lower if _NOTE_EXT_RE.search(lower) else f"{lower}.md"


def _pick(candidates: list[str], from_dir: str | None) -> str | None:
    """THE tie-break among same-named paths (both runtimes; `obsidian.js::pick` mirrors it):
    the one in the linking note's folder (bare names only: `from_dir` is None for a
    path-qualified target), else the shortest path (fewest folders), else the
    lexicographically first path, so the answer never depends on listing order."""
    if not candidates:
        return None
    if from_dir is not None:
        here = from_dir.lower()
        beside = [c for c in candidates if _dir_of(c).lower() == here]
        if beside:
            candidates = beside
    return min(candidates, key=lambda c: (c.count("/"), c))


def _ends_at(form: str, want: str) -> bool:
    """`form` is `want`, or ends in it at a folder boundary (`Vault/Setups/VCP.md` ends at
    `setups/vcp.md`). Both lowercased."""
    return form == want or form.endswith("/" + want)


def _resolve_in(target: str, index: _VaultIndex, from_dir: str | None) -> str | None:
    """The wikilink rule over an index; `from_dir` is the linking note's folder. A target
    with a `/` is matched against the end of each path at a folder boundary; a bare one
    against the file name. First, a target holding a `#` (an anchor, or part of a NAME:
    `my chart #1 (v2).png`) that EXACTLY names a vault file opens that file; only
    otherwise is the anchor split off (Plan C Task 4 fix round 1). Then, in order:
      1. the exact note `_note_file_of(target)` names (`[[Dr.Smith]]` -> `Dr.Smith.md`,
         `[[report.pdf]]` -> `report.pdf.md`), always first;
      2. a file whose full name IS the target (`[[report.pdf]]` -> `report.pdf`).
    Each step compares a candidate's FULL name, never an extension-stripped form. So
    `[[Dr.Smith]]` never opens `Dr.md` or `Dr.Smith.csv`, `[[report.pdf]]` never
    `report.pdf.png`, `[[Notes/Plan]]` never `Notes/Plan.md.bak`: a wrong file is worse
    than a visible pending link. ⚰️ A third step stem-matched a dot-less name to a file
    (`[[chart]]` -> `chart.png`). Obsidian assumes `.md` for a link with no extension, so
    `[[chart]]` names `chart.md` only; the step is gone (Plan C Task 4 fix round 1).
    Same-named candidates go through `_pick`. Mirrors `obsidian.js::resolveTarget`."""
    whole = target.strip()
    if "#" in whole:
        hit = _resolve_steps(whole, index, from_dir, exact_file_only=True)
        if hit is not None:
            return hit
    target = _strip_fragment(target)
    if not target:
        return None
    return _resolve_steps(target, index, from_dir)


def _resolve_steps(target: str, index: _VaultIndex, from_dir: str | None, *,
                   exact_file_only: bool = False) -> str | None:
    """Steps 1 and 2 of `_resolve_in` over an anchor-free `target` (`exact_file_only`:
    step 2 alone, the full-name check a `#`-holding target gets first)."""
    lower = target.lower()
    note_file = _note_file_of(target)
    name = _basename(lower)
    near = None if "/" in lower else from_dir
    steps = [] if exact_file_only else [(_basename_sans_ext(note_file), note_file)]
    steps.append((_strip_ext(name), lower))
    for key, want in steps:
        hits = [c for c in index.get(key) or [] if _ends_at(c.lower(), want)]
        if hits:
            return _pick(hits, near)
    return None


def _resolve_target(
    raw_target: str, paths: list[str], basename_map: Any,
    *, from_path: str | None = None,
) -> str | None:
    """The vault path a link target names, else None. THE wikilink rules, used at
    conversion time AND by the later heal (`resolve_pending_target`). A bare name with
    several candidates (Plan A Task 13, Obsidian's own order): the one in `from_path`'s
    folder, else the shortest path (fewest folders), else the first path in sort order."""
    return _resolve_in(raw_target, _index_of(paths, basename_map),
                       _dir_of(from_path) if from_path is not None else None)


def _escapes_root(path: str) -> bool:
    return path == ".." or path.startswith("../")


def _resolve_relative(path: str, from_dir: str, index: _VaultIndex) -> str | None:
    """THE relative-link rule (O-5), for conversion and heal alike: `path` beside the
    linking note's folder, then from the vault root, then by the wikilink rules."""
    joined = posixpath.normpath(posixpath.join(from_dir, path)) if from_dir else posixpath.normpath(path)
    rooted = posixpath.normpath(path.lstrip("/"))
    for candidate in (joined, rooted):
        if not _escapes_root(candidate):
            found = index.by_lower.get(candidate.lower())
            if found:
                return found
    return _resolve_in(path, index, from_dir)


#: The marker field of a pending RELATIVE-link key (`_name_key`).
_REL_FIELD = "rel"


def resolve_pending_target(rest: str, index: _VaultIndex) -> str | None:
    """The vault path a pending key's `<target>[|<from dir>[|rel]]` names NOW, by the
    very rule conversion used (fix round 1, M-1): a wikilink by `_resolve_in` with its
    note's folder, a relative link by `_resolve_relative`."""
    parts = rest.split("|")
    target = parts[0]
    from_dir = parts[1] if len(parts) > 1 else ""
    if len(parts) > 2 and parts[2] == _REL_FIELD:
        return _resolve_relative(target, from_dir, index)
    return _resolve_in(target, index, from_dir)


def _pct(path: str) -> str:
    """A destination spliced into the markdown BEFORE it is parsed. A literal `%` must
    survive the ONE decode in `mddoc._destination_as_written`, so it is written as `%25`;
    and a `|` (the field separator of a pending key, `_name_key`) as `%7C`, because inside a
    GFM table a bare `|` ends the CELL (fix round 2: `| [[Ghost]] | x |` in a sub-folder
    note split into broken cells and lost the link). The one decode restores both, so the
    key stored in the doc is the key `links` reports and the heal matches."""
    return path.replace("%", "%25").replace("|", "%7C")


def _name_key(vault_id: str, target: str, from_path: str | None = None, *,
              relative: bool = False) -> str:
    """The pending key of a link whose note is not in the vault YET (Plan A Task 13,
    O-4): `name:obsidian:<vault_id>/<target as written, fragment stripped, lowercased>`,
    then -- fix round 1, M-1, so the heal applies the SAME rule conversion did --
    `|<the linking note's folder, lowercased>` when it is not the vault root, and
    `|<folder>|rel` for a relative `.md` link. `|` cannot appear in an Obsidian file
    name, so the fields never collide with a target. `link_keys.resolve_link_keys`
    resolves it with `resolve_pending_target` once the note exists."""
    key = f"{OBSIDIAN_NAME_KIND}{vault_id}/{_strip_fragment(target).lower()}"
    from_dir = _dir_of(from_path).lower() if from_path else ""
    if relative:
        return f"{key}|{from_dir}|{_REL_FIELD}"
    return f"{key}|{from_dir}" if from_dir else key


def _pending_link(display: str, vault_id: str, target: str, from_path: str | None) -> str:
    """A wikilink-shaped link to a note that may arrive later: the member's text, and a
    `name:` key the heal pass can resolve. Plain text when there is no name to wait for."""
    if not _strip_fragment(target):
        return display
    return f"[{display}](<{LINK_PREFIX}{_pct(_name_key(vault_id, target, from_path))}>)"


def _wikilink_display(raw_target: str) -> str:
    """What a wikilink with no alias shows, as Obsidian shows it: `Note#Risk` reads
    `Note > Risk`; a block reference (`Note#^abc123`) reads just `Note` (its id is
    not text anyone wrote); `[[#Risk]]` (this note's own heading) reads `Risk`."""
    idx = raw_target.find("#")
    if idx == -1:
        return raw_target
    note = raw_target[:idx].strip()
    anchor = raw_target[idx + 1:].strip()
    if anchor.startswith("^") or not anchor:
        return note or raw_target
    return f"{note} > {anchor}" if note else anchor


_NOTE_EXT_RE = re.compile(r"\.md$", re.IGNORECASE)


def _transform_wiki_and_embeds(
    segment: str, paths: list[str], basename_map: dict[str, list[str]],
    vault_id: str, import_key_fn: Any, *, from_path: str | None = None,
) -> str:
    def repl(m: "re.Match[str]") -> str:
        is_embed = m.group(1) == "!"
        raw_target = m.group(2).strip()
        # `[[Note\|alias]]` inside a table cell: the backslash escapes the pipe
        # from the table, it is not part of the name.
        if raw_target.endswith("\\"):
            raw_target = raw_target[:-1].rstrip()
        raw_alias = m.group(3)
        resolved = _resolve_target(raw_target, paths, basename_map, from_path=from_path)

        if is_embed:
            if resolved is None:
                # An embed of a NOTE not in the vault yet waits like a wikilink does
                # (Task 13), dotted name or not (`![[Dr.Smith]]` names `Dr.Smith.md`, D1).
                # Only a known attachment extension makes it a missing FILE -> plain text
                # of the target, never a broken <img> or a phantom media entry (mirrors
                # obsidian.js's own unresolvable-embed fallback).
                bare = _unresolved_bare_target(raw_target)
                if bare and (_NOTE_EXT_RE.search(bare)
                             or _ext_of(_basename(bare)) not in _UNSENT_ATTACHMENT_EXTS):
                    return _pending_link(_NOTE_EXT_RE.sub("", bare), vault_id, raw_target,
                                         from_path)
                return raw_target
            if _IMAGE_EXT_RE.search(resolved):
                # Ordinary, UNPREFIXED markdown image syntax -> md_to_tiptap
                # registers this as a normal media ref (see module
                # docstring); this provider's own fetch_media honestly
                # refuses it (no attachment bytes are ever pushed).
                # Angle-bracket destination form (`(<...>)`) -- see the
                # module docstring's "Parity-rail finding" note: a bare
                # `(resolved)` destination containing a space (Obsidian's
                # own default note-naming convention) is not a valid
                # CommonMark link destination and degrades the whole embed
                # to LITERAL VISIBLE TEXT, never an image.
                return f"![{_basename(resolved)}](<{_pct(resolved)}>)"
            # A resolved non-image embed (another note, a PDF, ...) has no
            # transclusion/attachment-chip support here (out of this task's
            # scope) -- degrade to an ordinary link, the most useful thing
            # this converter CAN represent. A note reads by its name, never
            # `Other note.md` (Task 13).
            key = import_key_fn(vault_id, resolved)
            return f"[{_NOTE_EXT_RE.sub('', _basename(resolved))}](<import-link://{_pct(key)}>)"

        if resolved is None and _unresolved_bare_target(raw_target) != _strip_fragment(raw_target):
            # A missing FILE whose name holds `#` (`[[report #2.pdf]]`): its name as text,
            # like the embed branch and the client, never a pending link to a note
            # `report` (Task 4 review R3, the full-text-first rule of ruling 1).
            return (raw_alias or "").strip() or raw_target
        display = (raw_alias or "").strip() or _wikilink_display(raw_target)
        if resolved is None:
            # Not in the vault yet: the member's text, under a key that heals when
            # the note arrives (Task 13, O-4). ⚰️ It used to become plain text, so a
            # link written before its note never became a link.
            return _pending_link(display, vault_id, raw_target, from_path)
        key = import_key_fn(vault_id, resolved)
        # Angle-bracket destination form -- same space-safety fix as above.
        return f"[{display}](<import-link://{_pct(key)}>)"

    def nested(m: "re.Match[str]") -> str:
        # The alias is all `[[![[img.png]]|alias]]` shows: no link (an embed names no
        # note), and no image, so no media entry uploads a file nothing shows (item 4).
        alias = (m.group(2) or "").strip()
        if alias:
            return alias
        inner = m.group(1)
        return _WIKI_RE.sub(repl, inner) if inner.startswith("![[") else inner

    def alias_embed(m: "re.Match[str]") -> str:
        inner = m.group(2)
        embed = _WIKI_RE.sub(repl, inner) if inner.startswith("![[") else inner
        return embed + _WIKI_RE.sub(repl, f"[[{m.group(1)}]]")

    segment = _ALIAS_EMBED_RE.sub(alias_embed, segment)
    return _WIKI_RE.sub(repl, _NESTED_EMBED_RE.sub(nested, segment))


def _escape_html(text: str) -> str:
    """`adapters/obsidian.js::escapeHtml`, character for character (`&`, `<`,
    `>`): the inner text of a `<mark>` must reach the markdown parser exactly
    as the client lane's does."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _transform_highlights(segment: str) -> str:
    """`==text==` -> `<mark>text</mark>`, the client lane's own output (see
    the module docstring's "Conversion" section); `md_to_tiptap` reads the
    pair as a `highlight` mark. The markdown links and images the wikilink pass wrote
    inside it (`==[[Plan]]==`) are kept as written, so the run stays a link AND a
    highlight; only the text around them is escaped. ⚰️ Escaping the whole span turned the
    `<import-link://...>` destination into `&lt;...&gt;` and the link was lost (D1 fix
    round 3, N2). Mirrors the client's held markup (`obsidian.js::holdMarkup`)."""
    return _HIGHLIGHT_RE.sub(
        lambda m: f"{m.group(1)}<mark>{_escape_outside_links(m.group(2))}</mark>", segment)


def _escape_outside_links(text: str) -> str:
    out: list[str] = []
    last = 0
    for m in _MD_LINK_OR_IMAGE_RE.finditer(text):
        out.append(_escape_html(text[last:m.start()]))
        out.append(m.group(0))
        last = m.end()
    out.append(_escape_html(text[last:]))
    return "".join(out)


def _transform_outside_code(text: str, fn: Any) -> str:
    """Splits `text` on fenced/inline code spans and runs `fn` over each
    non-code segment only; code segments pass through byte-for-byte
    untouched. Mirrors `obsidian.js::transformOutsideCode` exactly."""
    out: list[str] = []
    last = 0
    for m in _CODE_RE.finditer(text):
        out.append(fn(text[last:m.start()]))
        out.append(m.group(0))
        last = m.end()
    out.append(fn(text[last:]))
    return "".join(out)


# ── Attachments (connector fidelity Plan C, Task 3) ──────────────────────────
#
# Since plugin 0.2.0 the plugin resolves each note's attachment references with Obsidian's
# own resolver and sends them as `attachments` (stored as `j2_obsidian_staging.
# attachments_json`): `{original, embed, path, size, sha256, status}`, `original` being the
# exact substring of the note. `_apply_attachment_refs` swaps each `original` for markdown
# image syntax under one of three schemes of this provider, before any other pass:
#   * `obsidian-att:<sha256>/<quoted name>`    an image the note shows inline (stays `image`);
#   * `obsidian-file:<sha256>/<quoted name>`   any other file (becomes an `attachmentChip`);
#   * `obsidian-notice:<reason>/<quoted name>` something that did not come over (becomes an
#                                              `importNotice` with that reason, never media).
# Image syntax borrows `md_to_tiptap`'s block hoisting and media registration (the Dropbox
# precedent); `_promote_obsidian_placeholders` then gives each node its real type. The bytes
# of `att`/`file` refs come from the staged blob store (`fetch_media` -> `read_blob`).
# A row with NO list (a 0.1.x plugin, or 0.2.0 in legacy mode) says so in the note: every
# local attachment reference becomes a notice, `obsidian-plugin-outdated` when the device's
# plugin is older than 0.2.0 (or unknown), else `obsidian-attachments-unavailable`.
ATT_SCHEME = "obsidian-att:"
FILE_SCHEME = "obsidian-file:"
NOTICE_SCHEME = "obsidian-notice:"
OUTDATED_REASON = "obsidian-plugin-outdated"
UNAVAILABLE_REASON = "obsidian-attachments-unavailable"
_ATT_IMAGE_EXTS = frozenset("png jpg jpeg gif webp bmp svg heic heif tif tiff avif".split())
#: A ref's non-ok status -> the notice reason written into `importNotice.attrs.reason`.
_STATUS_REASONS = {
    "too-large": "too-large", "missing": "not-found", "off": "sync-off",
    "storage-limit": "storage-limit",
}
#: `_convert_row`'s default: no attachment pass at all (a caller that has no refs to give,
#: like the parity fixture generator until Plan C Task 4). Production always passes the
#: row's refs, a list or None.
NO_ATTACHMENT_PASS: Any = object()
_MiB = 1024 * 1024
_SHA_RE = re.compile(r"[0-9a-f]{64}")


def _q(text: str) -> str:
    return quote(text, safe="")


def _ext_of(name: str) -> str:
    idx = name.rfind(".")
    return name[idx + 1:].lower() if idx > 0 else ""


def _notice_markdown(reason: str, name: str) -> str:
    return f"![](<{NOTICE_SCHEME}{reason}/{_q(name)}>)"


#: D2 item 6: a file chip's LABEL rides its placeholder as a fragment, `obsidian-file:<sha>/
#: <quoted name>#label=<quoted label>`, from `_ref_markdown` to `_promote_obsidian_placeholders`,
#: which takes it off again: the stored href and the media ref never carry it. The name and
#: the label are both fully quoted, so this mark is the only `#` in the placeholder.
_LABEL_MARK = "#label="


def _ref_label(original: Any, name: str) -> str | None:
    """The member's own words for a file link (D2 item 6): the text of `[the report](...)`
    or the alias of `[[q3 report.pdf|the report]]`, when it is not just the file's name. An
    embed has no words of its own, so no label."""
    if not isinstance(original, str):
        return None
    text = None
    md = _MD_LINK_OR_IMAGE_RE.fullmatch(original)
    if md is not None and md.group(1) != "!":
        text = md.group(2)
    else:
        wiki = _WIKI_RE.fullmatch(original)
        if wiki is not None and wiki.group(1) != "!":
            text = wiki.group(3)
    text = _rendered_text(text or "").strip()
    return text if text and text != name else None


def _rendered_text(markdown: str) -> str:
    """What inline markdown READS as (D2 fix round 1, I2): `**the** report` -> `the report`,
    `the\\_x` -> `the_x`. Text and code spans keep their text, a line break is a space, raw
    HTML tags and images add nothing -- the client takes the label from the rendered link's
    `textContent`, which is the same thing. ⚰️ The raw markdown was the label, so a synced
    chip showed literal asterisks and backslashes."""
    if not markdown:
        return ""
    # D2 fix round 2, N3: an Obsidian `==highlight==` reads as its words (CommonMark has no
    # highlight; the client's markdown does), by this provider's own highlight rule.
    markdown = _HIGHLIGHT_RE.sub(lambda m: m.group(1) + m.group(2), markdown)
    out: list[str] = []
    for token in _get_md().parseInline(markdown):
        for child in token.children or []:
            if child.type in ("text", "code_inline"):
                out.append(child.content)
            elif child.type in ("softbreak", "hardbreak"):
                out.append(" ")
    return "".join(out)


def _split_label(ref: str) -> tuple[str, str | None]:
    """`obsidian-file:<sha>/<name>#label=<label>` -> (the ref without the label, the label)."""
    base, mark, label = ref.partition(_LABEL_MARK)
    return base, (unquote(label) or None) if mark else None


def _ref_markdown(ref: dict[str, Any]) -> str | None:
    """The markdown one ref's `original` becomes (the rewrite table), or None when the ref
    names nothing this pass can write (its original then stays as written)."""
    path = ref.get("path")
    if not isinstance(path, str) or not path:
        return None
    name = _basename(path)
    if not name:
        # Fix round 1 (M4): `att/` names no file -- never a chip or notice with an empty
        # name. The ref is ignored; its original stays as the member wrote it.
        return None
    status = ref.get("status")
    if status == "ok":
        sha = ref.get("sha256")
        if not isinstance(sha, str) or not sha:
            return None
        image = ref.get("embed") is True and _ext_of(name) in _ATT_IMAGE_EXTS
        if image:
            return f"![](<{ATT_SCHEME}{sha}/{_q(name)}>)"
        label = _ref_label(ref.get("original"), name)
        tail = f"{_LABEL_MARK}{_q(label)}" if label else ""
        return f"![](<{FILE_SCHEME}{sha}/{_q(name)}{tail}>)"
    reason = _STATUS_REASONS.get(status)
    if reason is None:
        return None
    if status == "too-large":
        size = ref.get("size")
        if isinstance(size, int) and not isinstance(size, bool) and size >= 0:
            name = f"{name} ({size / _MiB:.1f} MB)"
    return _notice_markdown(reason, name)


#: THE extensions a row with no attachment list reads as a FILE (fix round 1, I1): the image
#: set above plus the documents, sheets, archives, audio and video a trading vault holds,
#: and Obsidian's own canvas. Anything else with a dot (`[[Dr.Smith]]`, `[[Q3.Review]]`,
#: `[[Drawing.excalidraw]]`) is a NOTE name and keeps its link. ⚰️ Any `.<letters>` used to
#: count, and those links became "update your plugin" notices.
_UNSENT_ATTACHMENT_EXTS = _ATT_IMAGE_EXTS | frozenset((
    "pdf doc docx xls xlsx ppt pptx odt ods odp rtf csv tsv txt json xml "
    "zip 7z rar gz tar "
    "mp3 m4a wav ogg flac aac opus "
    "mp4 mov m4v webm mkv avi "
    "canvas epub").split())
_MD_LINK_OR_IMAGE_RE = re.compile(
    r"(!?)\[((?:[^\[\]\n]|\[[^\[\]\n]*\])*)\]\(\s*(<[^<>\n]*>|[^\s()<>]+)"
    r"(?:\s+(?:\"[^\"\n]*\"|'[^'\n]*'))?\s*\)")


def _is_attachment_path(path: str) -> bool:
    """A vault path that names a FILE, not a note: its extension is in
    `_UNSENT_ATTACHMENT_EXTS`."""
    return _ext_of(_basename(path)) in _UNSENT_ATTACHMENT_EXTS


def _unresolved_bare_target(target: str) -> str:
    """The name an UNRESOLVED wiki target stands for, for the fallbacks that ask "is this a
    file?": the FULL text when it holds a `#` and its own extension is an attachment's
    (`my chart #1 (v2).png` is a file NAME), else the target with its anchor split off.
    The same full-text-first rule `_resolve_in` applies (Task 4 fix round 1, ruling 1;
    review M2). ⚰️ The fallbacks split first, so `![[my chart #1 (v2).png]]` read as a
    note `my chart` and became a pending note link, not the update notice."""
    whole = target.strip()
    if "#" in whole and _is_attachment_path(whole):
        return whole
    return _strip_fragment(target)


def _mark_unsent_attachments(
    segment: str, reason: str, *, paths: list[str] = (), basename_map: Any = None,
    from_path: str | None = None,
) -> str:
    """A row whose plugin sent no attachment list: every LOCAL attachment reference (a wiki
    embed or link to a known file type, a markdown image or file link with no URL scheme)
    becomes a notice with `reason`. Note links and web addresses are left for the passes
    after this one. A wiki target that names a staged NOTE (`[[Plan.pdf]]` beside
    `Plan.pdf.md`) is a note link whatever its extension (fix round 1, I1)."""

    def is_note(bare: str) -> bool:
        if not paths:
            return False
        for candidate in (bare, f"{bare}.md"):
            hit = _resolve_target(candidate, paths, basename_map, from_path=from_path)
            if hit is not None and _NOTE_EXT_RE.search(hit):
                return True
        return False

    def wiki(m: "re.Match[str]") -> str:
        target = m.group(2).strip()
        if target.endswith("\\"):
            target = target[:-1].rstrip()
        bare = _unresolved_bare_target(target)
        if not bare or not _is_attachment_path(bare) or is_note(bare):
            return m.group(0)
        return _notice_markdown(reason, _basename(bare))

    def markdown(m: "re.Match[str]") -> str:
        dest = m.group(3)
        if dest.startswith("<"):
            dest = dest[1:-1]
        dest = dest.strip()
        if (not dest or dest.startswith(("#", "//")) or _SCHEME_RE.match(dest)):
            return m.group(0)
        path = unquote(re.split(r"[#?]", dest, maxsplit=1)[0])
        if not path or not _is_attachment_path(path):
            return m.group(0)
        return _notice_markdown(reason, _basename(path))

    return _sub_clear_of_code(_MD_LINK_OR_IMAGE_RE, markdown,
                              _sub_clear_of_code(_WIKI_RE, wiki, segment))


# ── Code spans and the attachment pass (D2 fix round 2, N-I1) ───────────────
#
# The attachment pass runs over the WHOLE body, before the code split, because an original
# may hold a code span (`` [`q3` deck](q.pdf) ``): split first, it was cut at its code span,
# never found, and the file never came over -- silently, on both the ref and the no-list
# branch. Code stays protected: a match may CONTAIN whole code spans (fenced or inline, the
# same `_CODE_RE` `_transform_outside_code` splits on), but may never start, end or sit
# inside one.

def _code_spans(text: str) -> list[tuple[int, int]]:
    return [(m.start(), m.end()) for m in _CODE_RE.finditer(text)]


def _clear_of_code(at: int, end: int, code: list[tuple[int, int]], code_starts: list[int]) -> bool:
    """`[at, end)` cuts no code span and lies inside none; it may contain whole ones."""
    j = bisect.bisect_right(code_starts, at) - 1
    k = max(j, 0)
    while k < len(code) and code[k][0] < end:
        cs, ce = code[k]
        if ce > at and not (at <= cs and ce <= end and (cs, ce) != (at, end)):
            return False
        k += 1
    return True


def _sub_clear_of_code(rx: "re.Pattern[str]", fn: Any, text: str) -> str:
    """`rx.sub(fn, text)`, taking only matches `_clear_of_code`; a refused match is left as
    written and the scan resumes one character after its start."""
    code = _code_spans(text)
    code_starts = [c[0] for c in code]
    out: list[str] = []
    last = pos = 0
    while (m := rx.search(text, pos)) is not None:
        if _clear_of_code(m.start(), m.end(), code, code_starts):
            out.append(text[last:m.start()])
            out.append(fn(m))
            last = pos = m.end()
        else:
            pos = m.start() + 1
    out.append(text[last:])
    return "".join(out)


_SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.\-]*:")


def _apply_attachment_refs(
    segment: str, refs: list[dict] | None, plugin_supports: bool, *,
    paths: list[str] = (), basename_map: Any = None, from_path: str | None = None,
) -> str:
    """Markdown -> markdown: each ref's `original` (exact substring, every occurrence) becomes
    its attachment, file chip or notice (`_ref_markdown`). LONGEST originals first, so
    `[[a.png]]` can never rewrite the inside of `![[a.png]]`. Matching is by POSITION in
    the member's own text: each original claims the spans it occupies that no longer one
    claimed, and the output is written once from those spans, so no replacement is ever
    matched again and nothing the member wrote can be mistaken for one.
    ⚰️ D2 item 2: this wrote `\\x00obsidian-ref-N\\x00` tokens into the text and then
    replaced every occurrence of each, so member text already holding that form (NUL
    characters included) was swapped for an attachment. ⛔ Not a longer sentinel either
    (the client's held-markup idea): an original is any string the plugin sends, and one
    could straddle a token's edge; a span cannot be straddled. `refs is None` (the plugin
    sent no list): `_mark_unsent_attachments`, outdated unless `plugin_supports`;
    `paths`/`basename_map` are the vault's, so a link to a staged note is never read as a
    file."""
    if refs is None:
        return _mark_unsent_attachments(
            segment, UNAVAILABLE_REASON if plugin_supports else OUTDATED_REASON,
            paths=paths, basename_map=basename_map, from_path=from_path)
    table: dict[str, str] = {}
    for ref in refs:
        original = ref.get("original") if isinstance(ref, dict) else None
        if not isinstance(original, str) or not original or original in table:
            continue
        written = _ref_markdown(ref)
        if written is not None:
            table[original] = written
    # D2 fix round 2, N4: a file link whose alias is an embed (`[[q.pdf|![[img.png]]]]`) sent
    # as ONE ref is the embed (its own ref's rewrite, or the embed as written for the passes
    # after) and then the file's chip, as the client writes it and as `_ALIAS_EMBED_RE` reads
    # a note link. ⚰️ The whole link claimed the text first, so the image vanished silently.
    for original, written in list(table.items()):
        m = _ALIAS_EMBED_RE.fullmatch(original)
        if m is not None and m.group(2).startswith("![["):
            table[original] = table.get(m.group(2), m.group(2)) + written
            continue
        # D2 fix round 3, N-I3: the link's original may END at the embed's own `]]`
        # (`[[q.pdf|![[img.png]]`, as a link cache that stops at the first `]]` would cut
        # it) while the note goes on with `]]`. Where that whole form is in the note, it is
        # read as the whole form; the cut-off one stays as it was for anywhere else.
        cut = _CUT_ALIAS_EMBED_RE.fullmatch(original)
        whole = f"{original}]]"
        if cut is not None and whole not in table and whole in segment:
            table[whole] = table.get(cut.group(2), cut.group(2)) + written
    code = _code_spans(segment)
    code_starts = [c[0] for c in code]
    starts: list[int] = []  # sorted; spans[i] starts at starts[i]
    spans: list[tuple[int, int, str]] = []
    for original in sorted(table, key=len, reverse=True):
        at = segment.find(original)
        while at != -1:
            end = at + len(original)
            i = bisect.bisect_right(starts, at)
            if ((i and spans[i - 1][1] > at) or (i < len(spans) and spans[i][0] < end)
                    or not _clear_of_code(at, end, code, code_starts)):
                # inside a longer original's span, or inside / across a code span
                at = segment.find(original, at + 1)
                continue
            starts.insert(i, at)
            spans.insert(i, (at, end, table[original]))
            at = segment.find(original, end)
    out: list[str] = []
    last = 0
    for start, end, written in spans:
        out.append(segment[last:start])
        out.append(written)
        last = end
    out.append(segment[last:])
    return "".join(out)


def _ref_name(ref: str) -> str:
    """The file name an `obsidian-att:`/`obsidian-file:` ref carries, decoded exactly once."""
    return unquote(ref.rsplit("/", 1)[-1])


def _promote_obsidian_placeholders(converted: dict[str, Any]) -> dict[str, Any]:
    """`md_to_tiptap`'s output with this provider's placeholders made real (see the section
    comment above): an `obsidian-file:` image is an `attachmentChip`, an `obsidian-notice:`
    image is an `importNotice` (and its media entry is dropped: there is nothing to fetch),
    an `obsidian-att:` image stays an image. Every `att`/`file` media entry is named by its
    decoded file name, and a `file` entry is `kind="file"`. Never mutates `converted`."""
    file_src = f"{REF_PREFIX}{FILE_SCHEME}"
    notice_src = f"{REF_PREFIX}{NOTICE_SCHEME}"

    def promote(node: dict[str, Any]) -> dict[str, Any]:
        src = (node.get("attrs") or {}).get("src") or ""
        if src.startswith(file_src):
            ref, label = _split_label(src[len(REF_PREFIX):])
            attrs = {"href": f"{REF_PREFIX}{ref}", "name": _ref_name(ref)}
            if label:
                attrs["label"] = label  # D2 item 6: absent, not null, when there is none
            return {"type": "attachmentChip", "attrs": attrs}
        if src.startswith(notice_src):
            reason, _, quoted = src[len(notice_src):].partition("/")
            return import_notice.notice_node(
                reason, name=unquote(quoted), source_url=None, ref=None, attempts=0)
        return node

    media: list[dict[str, Any]] = []
    seen: set[str] = set()
    for m in converted["media"]:
        ref = m.get("ref") or ""
        if ref.startswith(NOTICE_SCHEME):
            continue
        if ref.startswith((ATT_SCHEME, FILE_SCHEME)):
            ref = _split_label(ref)[0]
            if ref in seen:
                continue  # the same file under another label: one upload
            seen.add(ref)
            m = {**m, "ref": ref, "name": _ref_name(ref)}
            if ref.startswith(FILE_SCHEME):
                m["kind"] = "file"
        media.append(m)
    return {**converted, "doc": map_image_nodes(converted["doc"], promote), "media": media}


def _blob_sha(ref: str) -> str | None:
    """The sha of an `obsidian-att:`/`obsidian-file:` ref, else None."""
    for scheme in (ATT_SCHEME, FILE_SCHEME):
        if ref.startswith(scheme):
            sha = ref[len(scheme):].split("/", 1)[0]
            return sha if _SHA_RE.fullmatch(sha) else None
    return None


def _retry_refs(body_json: Any) -> set[str]:
    """The refs a media retry of this stored body would fetch again (fix round 1, I2): the
    `ref` of every notice the engine retries (`fetch_failed` with attempts left, and its own
    `storage_limit`, which carries a ref; a plugin-decided notice carries none), and every
    real `import-ref://` placeholder NODE (an `image` src or `attachmentChip` href; text that
    merely contains the prefix is not one). A body that cannot be read has none."""
    try:
        doc = json.loads(body_json) if isinstance(body_json, (str, bytes)) else body_json
    except (TypeError, ValueError):
        return set()
    out: set[str] = set()
    stack = [doc]
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
            continue
        if not isinstance(node, dict):
            continue
        attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
        kind = node.get("type")
        if kind == import_notice.IMPORT_NOTICE_TYPE:
            ref = attrs.get("ref")
            if isinstance(ref, str) and ref and (
                    import_notice.is_retryable(attrs) or attrs.get("reason") == "storage_limit"):
                out.add(ref)
        else:
            value = attrs.get({"image": "src", "attachmentChip": "href"}.get(kind, ""))
            if isinstance(value, str) and value.startswith(REF_PREFIX) and value[len(REF_PREFIX):]:
                out.add(value[len(REF_PREFIX):])
        if isinstance(node.get("content"), list):
            stack.extend(node["content"])
    return out


def _retry_can_progress(ref: str, staged: set[str]) -> bool:
    """A retry of `ref` can succeed now: its staged blob exists, or it is not a staged-blob
    ref at all (an http(s) hotlink keeps plan A's retry exactly as before). A blob ref the
    plugin has not uploaded yet, or a malformed one, waits."""
    if ref.startswith((ATT_SCHEME, FILE_SCHEME)):
        sha = _blob_sha(ref)
        return sha is not None and sha in staged
    return True


def _refs_from_row(raw: Any) -> list[dict] | None:
    """`attachments_json` -> the refs list, or None for "the plugin sent no list" (NULL). A
    value that is not a JSON list (never written by the ingest route) reads as None too."""
    if not raw:
        return None
    try:
        refs = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(refs, list):
        return None
    return [r for r in refs if isinstance(r, dict)]


def _preprocess_obsidian_markdown(
    body_md: str, paths: list[str], basename_map: dict[str, list[str]],
    vault_id: str, import_key_fn: Any, *, from_path: str | None = None,
    vault_label: str | None = None, refs: Any = NO_ATTACHMENT_PASS,
    plugin_supports: bool = False,
) -> str:
    if refs is not NO_ATTACHMENT_PASS:
        # Over the WHOLE body, code spans protected, never per code-split segment: an
        # original may hold a code span (D2 fix round 2, N-I1; see `_clear_of_code`).
        body_md = _apply_attachment_refs(body_md, refs, plugin_supports, paths=paths,
                                         basename_map=basename_map, from_path=from_path)

    def fn(segment: str) -> str:
        segment = _transform_wiki_and_embeds(
            segment, paths, basename_map, vault_id, import_key_fn, from_path=from_path)
        segment = _transform_obsidian_uris(
            segment, paths, basename_map, vault_id, import_key_fn,
            from_path=from_path, vault_label=vault_label)
        segment = _transform_highlights(segment)
        return segment

    return _split_callout_titles(_transform_outside_code(body_md, fn))


# ── Obsidian deep links (Plan A Task 13) ─────────────────────────────────────
#
# `[x](obsidian://open?vault=<name>&file=<path>)` names a note by its VAULT NAME and its
# path. The engine's one link policy (`linkify.resolve_href`) turns an `obsidian:` deep
# link into text, because on its own it cannot say which imported note it means. This
# provider can, for its OWN vault: the plugin sends the vault's name as the device
# label (`obsidian-plugin/src/main.ts`, `vault.getName()`), so a deep link whose `vault`
# is this vault's label (or its id) is rewritten, before parsing, to the note's
# `import-link://` key -- or, when that note is not here yet, to the same pending
# `name:` key a wikilink waits under. A deep link into ANY other vault is left exactly
# as written, for that policy to make text.
# ⛔ An IMAGE whose src is a deep link (`![x](obsidian://...)`) is left exactly as written
# (fix round 1, M-2): it is not a link, and rewriting it made an image whose src was an
# `import-link://` key. Unchanged, it reaches `fetch_media`, which refuses a non-web
# reference by name, so the member sees the engine's notice, never a silent drop.
_OBSIDIAN_URI_LINK_RE = re.compile(
    r"(!?)\[((?:[^\[\]\n]|\[[^\[\]\n]*\])*)\]\(\s*<?(obsidian://[^\s()<>]+)>?\s*\)",
    re.IGNORECASE)


def _transform_obsidian_uris(
    segment: str, paths: list[str], basename_map: dict[str, list[str]],
    vault_id: str, import_key_fn: Any, *, from_path: str | None, vault_label: str | None,
) -> str:
    def repl(m: "re.Match[str]") -> str:
        if m.group(1) == "!":
            return m.group(0)  # an image, never rewritten (M-2)
        try:
            parts = urlsplit(m.group(3))
            query = parse_qs(parts.query, keep_blank_values=True)
        except ValueError:
            return m.group(0)
        if parts.netloc.lower() != "open":
            return m.group(0)
        vault = (query.get("vault") or [""])[0].strip()
        target = (query.get("file") or [""])[0].strip()
        names = {vault_id.lower(), *([vault_label.strip().lower()] if vault_label else [])}
        if not target or (vault and vault.lower() not in names):
            return m.group(0)
        resolved = _resolve_target(target, paths, basename_map, from_path=from_path)
        key = (import_key_fn(vault_id, resolved) if resolved
               else _name_key(vault_id, target, from_path))
        return f"[{m.group(2)}](<{LINK_PREFIX}{_pct(key)}>)"

    return _OBSIDIAN_URI_LINK_RE.sub(repl, segment)


# ── Callouts (Plan A Task 13) ────────────────────────────────────────────────
#
# `> [!warning] Size` opens an Obsidian callout. Markdown has no callout, so this is two
# halves around the shared converter: before it, the marker line is split from the
# callout's body with an empty quote line (otherwise markdown-it folds title and body
# into ONE paragraph and the title can no longer be told apart); after it,
# `_callouts_in_doc` turns each blockquote that opens with a marker into the editor's
# own `callout` node, its variant one of `GALLERY_CALLOUT_VARIANTS`. ⚰️ The marker used
# to stay as literal `[!warning]` text in a blockquote. Fenced code is never touched.
_FENCE_RE = re.compile(_FENCE_SRC)
_CALLOUT_LINE_RE = re.compile(r"^([ \t]{0,3}(?:>[ \t]?)+)\[!([A-Za-z0-9_-]+)\][+-]?(.*)$")
_QUOTE_PREFIX_RE = re.compile(r"^[ \t]{0,3}>")
_CALLOUT_MARK_RE = re.compile(r"^\[!([A-Za-z0-9_-]+)\][+-]?[ \t]*")
#: Obsidian's callout types -> the editor's five (`calloutNode.js::CALLOUT_VARIANTS`,
#: `public_note_payload.GALLERY_CALLOUT_VARIANTS`). Any other type is a `note`.
_CALLOUT_VARIANTS = {
    "note": "note", "info": "info", "success": "success", "warning": "warning",
    "danger": "danger", "tip": "success", "caution": "warning", "important": "warning",
    "bug": "danger", "failure": "danger",
}


def _split_callout_titles(body_md: str) -> str:
    def lines_pass(text: str) -> str:
        lines = text.split("\n")
        out: list[str] = []
        for i, line in enumerate(lines):
            out.append(line)
            m = _CALLOUT_LINE_RE.match(line)
            opens_quote = i == 0 or not _QUOTE_PREFIX_RE.match(lines[i - 1])
            if m and opens_quote and i + 1 < len(lines) and _QUOTE_PREFIX_RE.match(lines[i + 1]):
                out.append(m.group(1).rstrip())
        return "\n".join(out)

    out: list[str] = []
    last = 0
    for m in _FENCE_RE.finditer(body_md):
        out.append(lines_pass(body_md[last:m.start()]))
        out.append(m.group(0))
        last = m.end()
    out.append(lines_pass(body_md[last:]))
    return "".join(out)


def _callouts_in_doc(node: Any) -> Any:
    """Every blockquote whose first paragraph opens with `[!type]` -> a `callout` node:
    `{"variant"}` from `_CALLOUT_VARIANTS`, the title (or the type, capitalised, as
    Obsidian shows an untitled one and as the client lane writes it) as a bold first
    paragraph, then the rest of the quote. Pure; returns a new tree."""
    if not isinstance(node, dict):
        return node
    content = node.get("content")
    if isinstance(content, list):
        node = {**node, "content": [_callouts_in_doc(c) for c in content]}
    if node.get("type") != "blockquote":
        return node
    blocks = node.get("content") or []
    first = blocks[0] if blocks else None
    runs = (first or {}).get("content") or []
    if not (isinstance(first, dict) and first.get("type") == "paragraph" and runs
            and runs[0].get("type") == "text" and not runs[0].get("marks")):
        return node
    m = _CALLOUT_MARK_RE.match(runs[0].get("text") or "")
    if m is None:
        return node
    kind = m.group(1)
    rest = (runs[0]["text"])[m.end():]
    title_runs = ([{**runs[0], "text": rest}] if rest else []) + list(runs[1:])
    if not any((r.get("text") or "").strip() for r in title_runs if r.get("type") == "text"):
        title_runs = [{"type": "text", "text": kind[:1].upper() + kind[1:]}]
    bold = [
        {**r, "marks": [*(r.get("marks") or []), {"type": "bold"}]}
        if r.get("type") == "text" and not any(mk.get("type") == "bold" for mk in r.get("marks") or [])
        else r
        for r in title_runs
    ]
    return {
        "type": "callout",
        "attrs": {"variant": _CALLOUT_VARIANTS.get(kind.lower(), "note")},
        "content": [{"type": "paragraph", "content": bold}, *blocks[1:]],
    }


# ── Relative markdown links (Plan A Task 13, O-5) ────────────────────────────

def _relative_href_resolver(
    from_path: str, index: _VaultIndex, vault_id: str, import_key_fn: Any,
) -> Any:
    """`md_to_tiptap`'s `resolve_href` for one note: a relative `.md` link
    (`[x](Other%20note.md)`, `[x](../Notes/Other.md)`, `[x](<Other note.md#Heading>)`)
    -> the note's `import-link://` key by `_resolve_relative` (beside the linking note,
    then from the vault root, then by the name rules). A `.md` link to a note not here
    yet waits under a relative `name:` key, which the heal resolves by that same rule.
    Anything that is not a `.md` path answers None and keeps the engine's one link
    policy (Task 10): a relative href is never resolved against uctintelligence.com.
    ⛔ O(1) to build: it closes over the batch's ONE `_VaultIndex` (fix round 1, I-1)."""
    here = _dir_of(from_path)
    def resolve(dest: str) -> str | None:
        path = re.split(r"[#?]", dest, maxsplit=1)[0].strip()
        if not _NOTE_EXT_RE.search(path):
            return None
        resolved = _resolve_relative(path, here, index)
        if resolved is not None:
            return f"{LINK_PREFIX}{import_key_fn(vault_id, resolved)}"
        return f"{LINK_PREFIX}{_name_key(vault_id, path, from_path, relative=True)}"

    return resolve


def convert_obsidian_markdown(
    body_md: str, *, vault_path: str, paths: list[str], basename_map: dict[str, list[str]],
    vault_id: str, import_key_fn: Any, vault_label: str | None = None,
    refs: Any = NO_ATTACHMENT_PASS, plugin_supports: bool = False,
) -> dict[str, Any]:
    """THE Obsidian conversion, `{doc, media, links}`: the attachment pass (`refs`, Plan C
    Task 3), the wiki-syntax pre-pass, the shared converter with this vault's relative-link
    resolver, the attachment placeholders made real, then callouts. What
    `ObsidianProvider._convert_row` runs and what the parity rail summarises -- one
    function, so the rail can never watch a different pipeline from the one that syncs."""
    index = _index_of(paths, basename_map)  # the caller's batch index; built only if absent
    pre = _preprocess_obsidian_markdown(
        body_md or "", paths, index, vault_id, import_key_fn,
        from_path=vault_path, vault_label=vault_label,
        refs=refs, plugin_supports=plugin_supports,
    )
    out = md_to_tiptap(pre, resolve_href=_relative_href_resolver(
        vault_path, index, vault_id, import_key_fn), unsafe_image_notice=True)
    out = _promote_obsidian_placeholders(out)
    return {**out, "doc": _callouts_in_doc(out["doc"])}


def _title_from_doc(doc: dict[str, Any], fallback: str) -> str:
    """The first top-level `heading` (level 1)'s text, else `fallback` —
    the server-side equivalent of `obsidian.js`'s `extractH1Title(html) ||
    filenameSansExt(basename(path))`, operating on the TipTap doc directly
    since there is no HTML intermediate here."""
    for node in doc.get("content") or []:
        if node.get("type") == "heading" and (node.get("attrs") or {}).get("level") == 1:
            text = "".join(
                c.get("text", "") for c in (node.get("content") or []) if c.get("type") == "text"
            ).strip()
            if text:
                return text
    return fallback


def _folder_path_of(vault_path: str) -> list[str]:
    if "/" not in vault_path:
        return []
    return vault_path.rsplit("/", 1)[0].split("/")


class ObsidianProvider(NoteProvider):
    """Reads `j2_obsidian_staging`/`j2_obsidian_manifest` for one
    (user_id, vault_id) pair and satisfies the ordinary `NoteProvider`
    contract over them — see the module docstring for the full design.

    `user_id`/`vault_id` are bound at CONSTRUCTION (mirrors
    `DropboxProvider(folder_path=...)`'s source-aware-construction
    precedent) — a future registry wiring would build this as
    `ObsidianProvider(user_id=source["userId"], vault_id=source["remoteId"])`,
    the same shape `registry.py::_build_dropbox` already uses for
    `source["remoteId"]`. `credentials` is accepted on every method (the
    abstract contract requires it) but never read — there is nothing in it
    this provider needs, and reading it for scoping would reopen exactly
    the cross-tenant hazard binding at construction closes.
    """

    name = "obsidian"

    def __init__(
        self, *, user_id: str, vault_id: str, client: httpx.AsyncClient | None = None,
    ) -> None:
        self.user_id = user_id
        self.vault_id = vault_id
        self._client = client
        self._owns_client = client is None

    async def aclose(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = media_http_client(timeout=30.0)   # its media hops ride it: no env proxy
        return self._client

    # ── vault-path knowledge (for wikilink/embed resolution) ────────────

    def _known_paths(self, conn: Any = None) -> list[str]:
        """The UNION of this vault's manifest + staging vault_paths — the
        closest server-side equivalent of the JS adapter's whole-batch
        `vfiles` array (see module docstring). Scoped to
        `(self.user_id, self.vault_id)` exactly like every other query in
        this class."""
        owned = conn is None
        conn = conn or get_connection()
        try:
            manifest_rows = conn.execute(
                "SELECT vault_path FROM j2_obsidian_manifest WHERE user_id = ? AND vault_id = ?",
                (self.user_id, self.vault_id),
            ).fetchall()
            staging_rows = conn.execute(
                "SELECT vault_path FROM j2_obsidian_staging WHERE user_id = ? AND vault_id = ?",
                (self.user_id, self.vault_id),
            ).fetchall()
        finally:
            if owned:
                conn.close()
        paths = {r["vault_path"] for r in manifest_rows} | {r["vault_path"] for r in staging_rows}
        return sorted(paths)

    # ── NoteProvider contract ───────────────────────────────────────────

    async def validate(self, credentials: dict[str, Any]) -> AccountInfo:
        """There is no remote endpoint to ping (push transport) — this
        confirms the vault is actually known (a real device row exists for
        it) and surfaces the member's own device label, rather than
        fabricating a generic "connected" message."""
        conn = get_connection()
        try:
            row = conn.execute(
                "SELECT label FROM j2_obsidian_devices WHERE user_id = ? AND vault_id = ?",
                (self.user_id, self.vault_id),
            ).fetchone()
        finally:
            conn.close()
        label = (row["label"] if row is not None else None) or f"Obsidian vault ({self.vault_id})"
        return AccountInfo(label=label, raw={"vaultId": self.vault_id})

    async def list_changed(
        self, credentials: dict[str, Any], cursor: str | None = None,
    ) -> list[RemoteRef]:
        """Staged rows whose SERVER-assigned `received_at` is strictly newer
        than `cursor` (`cursor=None` -> everything staged so far). See the
        module docstring's "Cursor consequence" section (items 2 and 3) for
        why this NEVER branches on a full-vs-incremental distinction, and
        for why the filter/cursor column is `received_at` rather than the
        client-supplied `updated_at` (C1, 2026-09-02 security review).

        Publishes `self.opaque_cursor` (`base.py`'s Dropbox-precedent
        extension point) so the engine persists that value VERBATIM instead
        of deriving one from `RemoteRef.updated_at` -- the cursor this
        method hands back can never be poisoned by a client value, even one
        `obsidian_staging`'s own ingest-time clamp somehow missed. When no
        row is newer than `cursor`, the SAME `cursor` is republished
        (rather than left at the class-level `None` default) so the
        engine's unconditional `update_cursor` call is a harmless no-op
        instead of silently reverting this source to "no sync has ever
        completed" on its next full pass."""
        conn = get_connection()
        try:
            if cursor:
                rows = conn.execute(
                    "SELECT vault_path, updated_at, received_at FROM j2_obsidian_staging "
                    "WHERE user_id = ? AND vault_id = ? AND received_at > ? "
                    "ORDER BY received_at ASC, vault_path ASC",
                    (self.user_id, self.vault_id, cursor),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT vault_path, updated_at, received_at FROM j2_obsidian_staging "
                    "WHERE user_id = ? AND vault_id = ? "
                    "ORDER BY received_at ASC, vault_path ASC",
                    (self.user_id, self.vault_id),
                ).fetchall()
            retry_rows = self._media_retry_rows(conn, {r["vault_path"] for r in rows})
        finally:
            conn.close()
        if rows:
            self.opaque_cursor = max(r["received_at"] for r in rows)
        elif cursor:
            self.opaque_cursor = cursor
        return [RemoteRef(remote_id=r["vault_path"], updated_at=r["updated_at"])
                for r in [*rows, *retry_rows]]

    def _media_retry_rows(self, conn: Any, listed: set[str]) -> list[Any]:
        """Plan C Task 3: staged rows NOT newer than the cursor whose synced note still waits
        on media (`import_media_pending = 1`: a placeholder, or a "retrying" notice with
        attempts left), so the engine's media retry (plan A's I-7) runs again for them. This
        is how a note pushed before its blob heals once the blob is staged, with no change to
        the note itself: a pull provider re-lists the note on its next full pass, but this
        one's `list_changed` only ever returns what was pushed since the cursor.

        ⛔ Fix round 1 (I2): re-listed ONLY when a retry can succeed NOW
        (`_retry_can_progress`): the note holds a retryable item whose staged blob exists
        now, or a retryable item that is not a staged blob at all (an http(s) hotlink, today's
        behaviour). A note waiting on a blob the plugin has not uploaded yet is left alone,
        so the passes in between (the hourly tick, another push's sync, the nightly pass)
        never spend its `MEDIA_RETRY_MAX_ATTEMPTS`. ⚰️ It used to be re-listed on every pass:
        three passes before the plugin's next upload made the notice final, and the plugin
        never re-pushes an unchanged note, so the image could not come back. The same gate
        drops a plugin-decided `storage-limit` notice (no ref: only a re-push clears it; it
        used to be re-written every other pass, M1) and literal `import-ref://` TEXT (no
        placeholder node, M3).

        Also left out: a note the member has EDITED since its import (`edited_since_import`,
        the engine's own conflict predicate; the engine never re-writes it), and every
        `#remote` conflict sibling (M2): the engine touches a sibling only when the remote
        changed, and then the row is listed as changed anyway. These rows never move the
        cursor (the caller computes it from `rows` alone)."""
        prefix = self.import_key(self.vault_id, "")
        keys = conn.execute(
            "SELECT import_key, updated_at, imported_at, body_json FROM j2_notes"
            " WHERE user_id = ? AND deleted_at IS NULL AND import_media_pending = 1"
            " AND substr(import_key, 1, ?) = ?",
            (self.user_id, len(prefix), prefix),
        ).fetchall()
        candidates: list[tuple[str, set[str]]] = []
        for k in keys:
            key = k["import_key"]
            if key.endswith("#remote") or edited_since_import(k["updated_at"], k["imported_at"]):
                continue
            path = key[len(prefix):]
            retry_refs = _retry_refs(k["body_json"])
            if path and path not in listed and retry_refs:
                candidates.append((path, retry_refs))
        staged = self._staged_shas(conn, {
            _blob_sha(r) for _p, refs in candidates for r in refs if _blob_sha(r)})
        paths: list[str] = []
        for path, refs in candidates:
            if path not in paths and any(_retry_can_progress(r, staged) for r in refs):
                paths.append(path)
        out: list[Any] = []
        for i in range(0, len(paths), 500):
            part = paths[i:i + 500]
            marks = ",".join("?" * len(part))
            out.extend(conn.execute(
                "SELECT vault_path, updated_at, received_at FROM j2_obsidian_staging"
                f" WHERE user_id = ? AND vault_id = ? AND vault_path IN ({marks})"
                " ORDER BY received_at ASC, vault_path ASC",
                (self.user_id, self.vault_id, *part),
            ).fetchall())
        return out

    def _staged_shas(self, conn: Any, shas: set[str]) -> set[str]:
        """Which of `shas` have a staged blob row for THIS member and vault, now."""
        wanted = sorted(shas)
        have: set[str] = set()
        for i in range(0, len(wanted), 500):
            part = wanted[i:i + 500]
            marks = ",".join("?" * len(part))
            have.update(r[0] for r in conn.execute(
                "SELECT sha256 FROM j2_obsidian_attachments WHERE user_id = ? AND vault_id = ?"
                f" AND sha256 IN ({marks})", (self.user_id, self.vault_id, *part)))
        return have

    async def list_present_refs(self, credentials: dict[str, Any]) -> list[RemoteRef]:
        """The manifest's COMPLETE path set for this vault — this is the
        line that buys delete detection for free (see module docstring,
        item 1). `updated_at` is best-effort: the manifest only records one
        `recorded_at` per push, not a per-file modified time, so every ref
        in one call shares that same timestamp. Harmless — delete detection
        only reads `remote_id` set membership (`_run_delete_detection`'s
        `seen_ids`), and `_touch_remote_index`'s use of this value is pure
        bookkeeping metadata, never merged into an actually-imported note's
        own `updated_at` (that only ever comes from `fetch()`/`fetch_many()`
        for rows `list_changed` actually returned).

        ⛔⛔ THE CONTRACT THIS PLACES ON THE PLUGIN, stated here because the
        plugin lives in another repo and nothing can enforce it across that
        boundary. Because absence from the manifest IS the delete signal, a
        client must manifest every path that still EXISTS in the vault —
        including paths it deliberately did not push in this session.
        The case that matters: a note that synced fine once and has since
        grown past the size ceiling. Its `j2_obsidian_staging` row still
        holds the last good content, and the member's note in the Notebook
        is fine — merely stale. If the plugin dropped that path from the
        manifest the moment it started failing, delete detection would tag
        that healthy note `source-deleted` after two passes, and the member
        would watch a note vanish because their FILE GOT BIGGER. Keep it
        manifested; a real deletion still registers, because a deleted file
        stops being enumerated at all.
        Restated: the manifest answers "what exists in the vault", NOT "what
        I successfully pushed". Those two sets differ exactly when something
        is failing — which is precisely when getting it wrong hurts most."""
        conn = get_connection()
        try:
            rows = conn.execute(
                "SELECT vault_path, recorded_at FROM j2_obsidian_manifest "
                "WHERE user_id = ? AND vault_id = ?",
                (self.user_id, self.vault_id),
            ).fetchall()
        finally:
            conn.close()
        return [RemoteRef(remote_id=r["vault_path"], updated_at=r["recorded_at"]) for r in rows]

    def _convert_row(self, vault_path: str, body_md: str, known_paths: list[str],
                      basename_map: dict[str, list[str]], *,
                      vault_label: str | None = None, refs: Any = NO_ATTACHMENT_PASS,
                      plugin_supports: bool = False) -> dict[str, Any]:
        return convert_obsidian_markdown(
            body_md or "", vault_path=vault_path, paths=known_paths,
            basename_map=basename_map, vault_id=self.vault_id,
            import_key_fn=self.import_key, vault_label=vault_label,
            refs=refs, plugin_supports=plugin_supports,
        )

    def _plugin_supports_attachments(self) -> bool:
        """Whether this vault's device runs a plugin that sends attachment lists (>= 0.2.0).
        Read ONCE per fetch call: it only decides which notice a row with no list gets."""
        version = obsidian_link.plugin_versions_for_user(self.user_id).get(self.vault_id)
        return obsidian_link.plugin_version_supports_attachments(version)

    def _vault_label(self, conn: Any) -> str | None:
        """The vault's NAME, as the plugin sent it at connect (`vault.getName()`) --
        what an `obsidian://open?vault=<name>` deep link names it by."""
        row = conn.execute(
            "SELECT label FROM j2_obsidian_devices WHERE user_id = ? AND vault_id = ?",
            (self.user_id, self.vault_id),
        ).fetchone()
        return row["label"] if row is not None else None

    def _note_from_row(self, row: Any, known_paths: list[str], basename_map: dict[str, list[str]],
                       vault_label: str | None = None, plugin_supports: bool = False) -> RemoteNote:
        converted = self._convert_row(row["vault_path"], row["body_md"], known_paths, basename_map,
                                      vault_label=vault_label,
                                      refs=_refs_from_row(row["attachments_json"]),
                                      plugin_supports=plugin_supports)
        fallback_title = _basename_sans_ext(row["vault_path"])
        return RemoteNote(
            remote_id=row["vault_path"],
            title=_title_from_doc(converted["doc"], fallback_title),
            doc=converted["doc"],
            media=converted["media"],
            links=converted["links"],
            tags=[],
            folder_path=_folder_path_of(row["vault_path"]),
            created_at=None,  # staging carries no distinct "created" concept
            updated_at=row["updated_at"],
        )

    async def fetch(self, credentials: dict[str, Any], ref: RemoteRef) -> RemoteNote:
        conn = get_connection()
        try:
            row = conn.execute(
                "SELECT vault_path, body_md, updated_at, attachments_json FROM j2_obsidian_staging "
                "WHERE user_id = ? AND vault_id = ? AND vault_path = ?",
                (self.user_id, self.vault_id, ref.remote_id),
            ).fetchone()
            known_paths = self._known_paths(conn)
            label = self._vault_label(conn)
        finally:
            conn.close()
        if row is None:
            raise errors.NoteConnUnsupported(
                f"Obsidian staged note {ref.remote_id!r} is no longer present for this vault",
                reason="Note content is no longer staged",
            )
        return self._note_from_row(row, known_paths, _build_basename_map(known_paths), label,
                                   plugin_supports=self._plugin_supports_attachments())

    async def fetch_many(
        self, credentials: dict[str, Any], refs: list[RemoteRef],
    ) -> list[RemoteNote]:
        """Batched over one query (`vault_path IN (...)`), returned in the
        SAME order as `refs` — a per-vault_path lookup dict, not reliance on
        SQL row order. Raises on any missing row (mirrors
        `DropboxProvider.fetch_many`'s "ALL-OR-NOTHING batch" contract) so
        the engine's own `_fetch_remote_notes` falls back to a per-ref
        `fetch()` loop, isolating one bad ref to one named failure."""
        if not refs:
            return []
        conn = get_connection()
        try:
            placeholders = ",".join("?" for _ in refs)
            rows = conn.execute(
                "SELECT vault_path, body_md, updated_at, attachments_json FROM j2_obsidian_staging "
                f"WHERE user_id = ? AND vault_id = ? AND vault_path IN ({placeholders})",
                (self.user_id, self.vault_id, *[r.remote_id for r in refs]),
            ).fetchall()
            known_paths = self._known_paths(conn)
            label = self._vault_label(conn)
        finally:
            conn.close()
        by_path = {r["vault_path"]: r for r in rows}
        basename_map = _build_basename_map(known_paths)
        supports = self._plugin_supports_attachments()
        notes: list[RemoteNote] = []
        for ref in refs:
            row = by_path.get(ref.remote_id)
            if row is None:
                raise errors.NoteConnUnsupported(
                    f"Obsidian staged note {ref.remote_id!r} is no longer present for this vault",
                    reason="Note content is no longer staged",
                )
            notes.append(self._note_from_row(row, known_paths, basename_map, label,
                                             plugin_supports=supports))
        return notes

    async def fetch_media(self, credentials: dict[str, Any], ref: str) -> tuple[bytes, str]:
        """Plan C Task 3: an `obsidian-att:`/`obsidian-file:` ref is a blob the plugin
        staged (`obsidian_attachments.read_blob`, scoped to this member and vault), served
        as `(data, declared mime or application/octet-stream)`. A blob not staged (yet) is
        `NoteConnTransient(status=404)`: the engine's notice says "retrying" and a later
        sync tries again (plan A's I-7), which is how a note pushed before its blob heals.

        A genuine external `http(s)://` reference already in a note's markdown is copied
        in exactly like every other provider's content-controlled-URL fallback (the shared
        SSRF guard). Anything else (a local vault path the plugin sent no ref for) is
        refused honestly rather than pretending to succeed."""
        for scheme in (ATT_SCHEME, FILE_SCHEME):
            if ref.startswith(scheme):
                sha = ref[len(scheme):].split("/", 1)[0]
                if not _SHA_RE.fullmatch(sha):
                    # Fix round 1 (N1): only reachable by typing it; final, never "retrying".
                    raise errors.NoteConnUnsupported(
                        f"not a staged Obsidian attachment ({ref!r})",
                        reason="This attachment reference is not valid")
                staged = await asyncio.to_thread(
                    obsidian_attachments.read_blob, self.user_id, self.vault_id, sha)
                if staged is None:
                    raise errors.NoteConnTransient("attachment not staged yet", status=404)
                data, mime = staged
                return data, mime or "application/octet-stream"
        parsed = urlsplit(ref)
        if (parsed.scheme or "").lower() in ("http", "https"):
            # Plan A Task 9 (I-5): a hotlink is copied in -- http allowed for the download only.
            client = await self._get_client()
            return await fetch_content_url(client, ref, what="Obsidian media")
        raise errors.NoteConnUnsupported(
            f"Obsidian push sync does not transfer vault attachments ({ref!r}) — "
            "only note text is pushed by the plugin. Use a public https link for "
            "any image/file that must sync.",
            reason="Local vault attachments are not synced by the Obsidian push transport",
        )
