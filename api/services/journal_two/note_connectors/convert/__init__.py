"""Server-side markdown -> TipTap conversion + placeholder rewrite.

Connectors run in background jobs (no browser), so the wizard's client-side
pipeline (markdown-it + TipTap `generateJSON`, in
`app/src/pages/journal-2-0/lib/importer/`) is unreachable there. This package
is its server-side counterpart:

  - `mddoc.md_to_tiptap` — markdown-it-py token walk -> TipTap JSON directly
    (no DOM/HTML intermediate step). Ports the node vocabulary + placeholder
    conventions (`import-ref://`, `import-link://`) the wizard's converter
    uses, per `tiptap.js::buildExtensions`.
  - `rewrite.rewrite_body` — a pure Python port of `commit.js`'s
    `rewriteBody`: resolves import-time media/link placeholders into their
    real, post-confirm values once uploads/imports have completed.

Spec: docs/superpowers/specs/2026-08-11-note-connectors-design.md §4.
"""

from __future__ import annotations

# Single Python authority for the two placeholder prefixes both `mddoc.py`
# and `rewrite.py` need — previously each module defined its own copy. Must
# be bound BEFORE the submodule imports below: `mddoc`/`rewrite` import these
# back from this package (`from . import REF_PREFIX, LINK_PREFIX`), and at
# that point this module is only partially initialized — the names below are
# already attributes of this module object, so the submodule import succeeds;
# reordering these two lines after the submodule imports would break it.
# (The JS twin's own `REF_PREFIX`/`LINK_PREFIX` in commit.js stay as-is —
# cross-language parity there is the schema-validation rail's job, not this
# package's.)
REF_PREFIX = "import-ref://"
LINK_PREFIX = "import-link://"
# A THIRD, generic placeholder prefix (added for the Dropbox connector's
# `.html` attachment support, task-10 review round): marks an `<a href>` a
# connector has ALREADY resolved to a real file attachment (as opposed to a
# normal link, which uses `LINK_PREFIX`, or an image reference, which uses
# `REF_PREFIX` on `src`) — `mddoc.py`'s HTML walker recognizes it generically
# and emits a block-level `attachmentChip` node directly (mirrors the
# `REF_PREFIX`-on-`src` "already a connector-supplied placeholder" rule
# `_html_image_node`/`_image_node` both already implement). Provider-agnostic
# by design, like `REF_PREFIX`/`LINK_PREFIX` — Dropbox is simply the first
# connector to use it.
ATTACHMENT_REF_PREFIX = "import-attachment-ref://"

from .mddoc import html_to_tiptap, md_to_tiptap, txt_to_tiptap
from .rewrite import rewrite_body

__all__ = [
    "REF_PREFIX", "LINK_PREFIX", "ATTACHMENT_REF_PREFIX",
    "md_to_tiptap", "html_to_tiptap", "txt_to_tiptap", "rewrite_body",
]
