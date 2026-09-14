"""Cross-stream seams for the extractor (stream S-D).

S-B (core/vocab.py, core/entities.py, core/private.py, core/aliases.py) and S-C
(sources) build in parallel with this stream, so their modules may not exist in
the base this package was written against. Every call into them goes through
seam(): importlib.util.find_spec first, then the attribute, and None when either
is missing. Each caller names its fallback beside the call.

SEAMS is the full list; the admin /gate route and the final report print it, so
"which fallback is running" is a reading, never an assumption.

⛔ ONE SEAM IS NOT IN THIS TABLE, ON PURPOSE: the owner-private store. W1 §0.4d
says only core/private.py, extract/writer.py and api/routers/wisdom_core.py may
REACH it, and a table entry here is a reach — seam_report() calls seam() on every
row, and seam() does importlib.import_module. Naming it here made
`tests/test_wisdom_bans.py::...[private_store]` RED, and the rail was right: the
admin /gate route imported core.private through this module. The row is declared
by its owner instead (writer.private_seam_row) and appended at report time, so the
import happens inside a module §0.4d allows. Renaming the string to dodge the rail
would have kept the reach and lost the alarm.
"""
from __future__ import annotations

import importlib
import importlib.util
import logging
from typing import Callable, Optional

log = logging.getLogger(__name__)

# (module, attribute, what happens when it is absent)
SEAMS: tuple[tuple[str, str, str], ...] = (
    ("api.services.wisdom.core.vocab", "list_for_prompt",
     "vocabulary names come from docs/wisdom/vocabulary/setup-vocabulary-v0.draft.json"),
    ("api.services.wisdom.core.vocab", "record_candidate",
     "no candidate row is written; setup_name_raw stays on the record so S-B can backfill"),
    ("api.services.wisdom.core.entities", "resolve",
     "no resolver: every CALL is downgraded to MENTION with a counted reason (W1 §4.2)"),
    # (the owner-private store's row is declared by writer.private_seam_row — see the module docstring)
    ("api.services.wisdom.core.bars", "session_range",
     "no bar source: an INFERRED ticker cannot pass the §8a.4 bar-range check, so every one is "
     "stored as a MENTION with entity_id NULL and a review item, verdict no_bar_source"),
    ("api.services.wisdom.core.aliases", "apply_aliases",
     "no ASR alias hints are added to transcript prompts"),
    ("api.services.wisdom.sources", "segment_payload",
     "transcripts load through education_service.get_transcript_cues; other streams read raw_r2_key"),
)


def seam(module: str, attr: str) -> Optional[Callable]:
    """The callable `module.attr`, or None when the module or name is absent."""
    try:
        spec = importlib.util.find_spec(module)
    except (ImportError, ValueError):
        return None
    if spec is None:
        return None
    try:
        mod = importlib.import_module(module)
    except Exception:
        log.exception("[wisdom-extract] seam %s exists but failed to import", module)
        return None
    fn = getattr(mod, attr, None)
    return fn if callable(fn) else None


def seam_report() -> list[dict]:
    """Every seam and whether it is present — including the private store's, which is
    read from its owner (§0.4d) rather than probed from here."""
    from api.services.wisdom.extract import writer   # local: writer imports this module

    rows = [
        {"module": module, "attr": attr, "present": seam(module, attr) is not None, "fallback": fallback}
        for module, attr, fallback in SEAMS
    ]
    rows.append(writer.private_seam_row())
    return rows
