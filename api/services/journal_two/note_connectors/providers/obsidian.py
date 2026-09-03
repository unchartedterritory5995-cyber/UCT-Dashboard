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
    using the SAME basename-map + path-qualified-suffix-match algorithm
    (`resolveTarget`/`buildBasenameMap`/`resolvePathQualified` in
    `obsidian.js`). A resolved plain wikilink becomes a real CommonMark link
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
    `NoteConnUnsupported` for it (see that method's docstring: the plugin
    never pushes attachment bytes, only markdown text, so there is nothing
    to fetch). An unresolved target (either syntax) degrades to plain text
    (the alias, or the target itself) — matching the JS adapter's own
    unresolved fallback — never a broken link or a crash.

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
  - `==highlight==` — the target TipTap schema (`tiptap.js::buildExtensions`,
    verified against the installed `@tiptap/starter-kit@3.23.6` +
    `app/package.json`) has NO highlight/mark extension registered at all;
    the JS adapter's own `<mark>` output is schema-invisible once it reaches
    `generateJSON` (an unrecognized tag's children still parse, the tag
    itself contributes no mark — text survives, styling doesn't). Injecting
    a raw `<mark>` HTML tag into the markdown text here would be STRICTLY
    WORSE than that: `md_to_tiptap`'s inline walker has no DOM/schema
    forgiveness for unrecognized `html_inline` tokens — it degrades them to
    VISIBLE LITERAL TEXT (see `_inline_nodes`'s `html_inline` branch), so
    the note would show the literal characters `<mark>`/`</mark>`. The
    faithful server-side port of this pre-pass's ACTUAL end-to-end effect
    (text preserved, styling silently dropped) is therefore to strip the
    `==...==` delimiters and keep the inner text bare — not to inject HTML
    this converter cannot represent.

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

import re
from typing import Any
from urllib.parse import urlsplit

import httpx

from api.services.auth_db import get_connection

from .. import errors
from ..convert import md_to_tiptap
from .base import AccountInfo, NoteProvider, RemoteNote, RemoteRef, guarded_media_get

# ---------------------------------------------------------------------------
# Wiki-syntax pre-pass (markdown -> markdown, run before md_to_tiptap)
# ---------------------------------------------------------------------------

# Fence alternative first, mirroring `obsidian.js::CODE_RE` exactly — at a
# run of 3+ backticks it must win over the inline-span alternative or the
# inline pattern would consume just the fence's opening backticks.
_CODE_RE = re.compile(r"```[\s\S]*?```|`[^`\n]*`")

# One combined regex for both wikilinks and embeds — an optional leading `!`
# distinguishes them (group 1). `[^\]|]+` stops at the first `|` or `]`,
# same as `obsidian.js`'s `WIKILINK_RE`/`EMBED_RE`: for a wikilink the
# optional group after `|` is an ALIAS; for an embed it is Obsidian's
# `|width` sizing suffix and is deliberately ignored (mirrors
# `transformEmbeds`'s `rawTarget.split('|')[0]`).
_WIKI_RE = re.compile(r"(!)?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")
_HIGHLIGHT_RE = re.compile(r"==([^=\n]+)==")
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


def _build_basename_map(paths: list[str]) -> dict[str, str]:
    """Lowercased, extension-stripped basename -> full vault path, first
    occurrence wins — byte-for-byte the same ambiguity rule as
    `obsidian.js::buildBasenameMap` (accepted for v1: two same-named files
    in different folders resolve to whichever was seen first)."""
    out: dict[str, str] = {}
    for path in paths:
        key = _basename_sans_ext(path).lower()
        out.setdefault(key, path)
    return out


def _resolve_path_qualified(target: str, paths: list[str]) -> str | None:
    """Mirrors `obsidian.js::resolvePathQualified`: an exact match (with or
    without extension) wins immediately; otherwise the first `/`-boundary
    suffix match is used, so `Setups/VCP` resolves against
    `Vault/Setups/VCP.md` even though `Vault/` isn't written in the link."""
    lower = target.lower()
    suffix_match: str | None = None
    for path in paths:
        p_lower = path.lower()
        p_sans_ext = _strip_ext(p_lower)
        if p_lower == lower or p_sans_ext == lower:
            return path
        if suffix_match is None and (
            p_lower.endswith("/" + lower) or p_sans_ext.endswith("/" + lower)
        ):
            suffix_match = path
    return suffix_match


def _resolve_target(
    raw_target: str, paths: list[str], basename_map: dict[str, str],
) -> str | None:
    target = _strip_fragment(raw_target)
    if not target:
        return None
    if "/" in target:
        return _resolve_path_qualified(target, paths)
    return basename_map.get(_strip_ext(target).lower())


def _transform_wiki_and_embeds(
    segment: str, paths: list[str], basename_map: dict[str, str],
    vault_id: str, import_key_fn: Any,
) -> str:
    def repl(m: "re.Match[str]") -> str:
        is_embed = m.group(1) == "!"
        raw_target = m.group(2).strip()
        raw_alias = m.group(3)
        resolved = _resolve_target(raw_target, paths, basename_map)

        if is_embed:
            if resolved is None:
                # Unresolvable embed -> plain text of the target, never a
                # broken <img> or a phantom media entry (mirrors
                # obsidian.js's own unresolvable-embed fallback).
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
                return f"![{_basename(resolved)}](<{resolved}>)"
            # A resolved non-image embed (another note, a PDF, ...) has no
            # transclusion/attachment-chip support here (out of this task's
            # scope) -- degrade to an ordinary link, the most useful thing
            # this converter CAN represent.
            key = import_key_fn(vault_id, resolved)
            return f"[{_basename(resolved)}](<import-link://{key}>)"

        display = (raw_alias or raw_target).strip() or raw_target
        if resolved is None:
            return display  # unresolved wikilink -> plain text, never a dead link
        key = import_key_fn(vault_id, resolved)
        # Angle-bracket destination form -- same space-safety fix as above.
        return f"[{display}](<import-link://{key}>)"

    return _WIKI_RE.sub(repl, segment)


def _transform_highlights(segment: str) -> str:
    """`==text==` -> bare `text` — see the module docstring's "Conversion"
    section for why this (not an injected `<mark>`) is the faithful
    server-side port given the installed schema has no highlight mark."""
    return _HIGHLIGHT_RE.sub(lambda m: m.group(1), segment)


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


def _preprocess_obsidian_markdown(
    body_md: str, paths: list[str], basename_map: dict[str, str],
    vault_id: str, import_key_fn: Any,
) -> str:
    def fn(segment: str) -> str:
        segment = _transform_wiki_and_embeds(segment, paths, basename_map, vault_id, import_key_fn)
        segment = _transform_highlights(segment)
        return segment

    return _transform_outside_code(body_md, fn)


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
            self._client = httpx.AsyncClient(timeout=30.0)
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
        finally:
            conn.close()
        if rows:
            self.opaque_cursor = max(r["received_at"] for r in rows)
        elif cursor:
            self.opaque_cursor = cursor
        return [RemoteRef(remote_id=r["vault_path"], updated_at=r["updated_at"]) for r in rows]

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
                      basename_map: dict[str, str]) -> dict[str, Any]:
        pre = _preprocess_obsidian_markdown(
            body_md or "", known_paths, basename_map, self.vault_id, self.import_key,
        )
        return md_to_tiptap(pre)

    def _note_from_row(self, row: Any, known_paths: list[str], basename_map: dict[str, str]) -> RemoteNote:
        converted = self._convert_row(row["vault_path"], row["body_md"], known_paths, basename_map)
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
                "SELECT vault_path, body_md, updated_at FROM j2_obsidian_staging "
                "WHERE user_id = ? AND vault_id = ? AND vault_path = ?",
                (self.user_id, self.vault_id, ref.remote_id),
            ).fetchone()
            known_paths = self._known_paths(conn)
        finally:
            conn.close()
        if row is None:
            raise errors.NoteConnUnsupported(
                f"Obsidian staged note {ref.remote_id!r} is no longer present for this vault",
                reason="Note content is no longer staged",
            )
        return self._note_from_row(row, known_paths, _build_basename_map(known_paths))

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
                "SELECT vault_path, body_md, updated_at FROM j2_obsidian_staging "
                f"WHERE user_id = ? AND vault_id = ? AND vault_path IN ({placeholders})",
                (self.user_id, self.vault_id, *[r.remote_id for r in refs]),
            ).fetchall()
            known_paths = self._known_paths(conn)
        finally:
            conn.close()
        by_path = {r["vault_path"]: r for r in rows}
        basename_map = _build_basename_map(known_paths)
        notes: list[RemoteNote] = []
        for ref in refs:
            row = by_path.get(ref.remote_id)
            if row is None:
                raise errors.NoteConnUnsupported(
                    f"Obsidian staged note {ref.remote_id!r} is no longer present for this vault",
                    reason="Note content is no longer staged",
                )
            notes.append(self._note_from_row(row, known_paths, basename_map))
        return notes

    async def fetch_media(self, credentials: dict[str, Any], ref: str) -> tuple[bytes, str]:
        """The push transport has no remote to fetch attachment bytes from
        — the plugin only ever pushes markdown TEXT (`j2_obsidian_staging.
        body_md`), never binary files. The one case this CAN honor is a
        genuine external `https://` reference already embedded in a note's
        own markdown (an ordinary `![alt](https://...)` image, or an
        Obsidian embed whose target happens to be a full URL) — resolved
        exactly like every other provider's content-controlled-URL fallback
        (`guarded_media_get`, the shared SSRF guard). Anything else — in
        practice, every LOCAL vault embed this provider's own pre-pass
        turns into a plain (unfetchable) media ref — is refused honestly
        rather than pretending to succeed."""
        parsed = urlsplit(ref)
        if (parsed.scheme or "").lower() == "https":
            client = await self._get_client()
            response = await guarded_media_get(client, ref, what="Obsidian media")
            if response.status_code >= 400:
                raise errors.NoteConnTransient(
                    f"Failed to download media ({response.status_code})",
                    status=response.status_code,
                )
            content_type = response.headers.get("content-type", "application/octet-stream")
            return response.content, content_type
        raise errors.NoteConnUnsupported(
            f"Obsidian push sync does not transfer vault attachments ({ref!r}) — "
            "only note text is pushed by the plugin. Use a public https link for "
            "any image/file that must sync.",
            reason="Local vault attachments are not synced by the Obsidian push transport",
        )
