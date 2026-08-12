"""Note-connector provider implementations (spec §7).

Each module here (`roam.py`, and — built concurrently by another agent —
`craft.py`, plus the dark `notion.py`/`dropbox.py` of later tasks) implements
`base.NoteProvider`. Providers are import-inert: importing (or constructing)
one with no env credentials configured must never raise — only `validate()`
is allowed to fail closed on a missing/bad credential, and only via the
shared `note_connectors.errors` taxonomy (never a raw httpx/SDK exception).
"""

from __future__ import annotations
