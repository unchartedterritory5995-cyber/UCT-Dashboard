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

from .mddoc import md_to_tiptap
from .rewrite import rewrite_body

__all__ = ["md_to_tiptap", "rewrite_body"]
