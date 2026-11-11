"""Plan F: repair notes members already imported.

Finds known-broken link and image shapes in stored note bodies and fixes them. Never touches
a note edited since import, every write is timestamp-neutral, dry run first, never deletes.

The four note classes a stored imported note falls into are below; the runner assigns them.
"""
from __future__ import annotations

FILE = "file"
CONNECTOR_LIVE = "connector_live"
CONNECTOR_RELIST = "connector_relist"
CONNECTOR_ORPHANED = "connector_orphaned"
NOTE_CLASSES = (FILE, CONNECTOR_LIVE, CONNECTOR_RELIST, CONNECTOR_ORPHANED)
