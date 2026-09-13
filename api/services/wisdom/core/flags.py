"""Every Wisdom Loop gate, read in one place (docs/wisdom/CONTRACTS.md §4).

Each function reads ONE literal env name with a literal default, so
api/services/feature_flag_index.py can see the gate and the ledger rail can pair
it with its docs/feature_flags.json entry. A helper taking the name as a
parameter would be invisible to that index. Everything defaults OFF and is read
per call, so turning a gate off takes effect on the next tick or request.

Member-visible gates are the owner's to flip (W1 §0.4c). They are marked True
in GATES.
"""
from __future__ import annotations

import os

_TRUE = ("1", "true", "yes", "on")


def _truthy(raw: str) -> bool:
    return raw.strip().lower() in _TRUE


# ── internal ingest / compute (integrator arms after the W1 merges) ─────────

def ingest_enabled() -> bool:
    return _truthy(os.environ.get("WISDOM_INGEST_ENABLED", "0"))


def capture_enabled() -> bool:
    return _truthy(os.environ.get("WISDOM_CAPTURE_ENABLED", "0"))


def x_backfill_enabled() -> bool:
    return _truthy(os.environ.get("WISDOM_X_BACKFILL_ENABLED", "0"))


def vocab_autopromote_enabled() -> bool:
    return _truthy(os.environ.get("WISDOM_VOCAB_AUTOPROMOTE_ENABLED", "0"))


def discord_listener_enabled() -> bool:
    return _truthy(os.environ.get("WISDOM_DISCORD_LISTENER_ENABLED", "0"))


def sources_ingest_enabled() -> bool:
    return _truthy(os.environ.get("WISDOM_SOURCES_INGEST_ENABLED", "0"))


def extract_enabled() -> bool:
    return _truthy(os.environ.get("WISDOM_EXTRACT_ENABLED", "0"))


def vision_enabled() -> bool:
    return _truthy(os.environ.get("WISDOM_VISION_ENABLED", "0"))


def extract_audit_enabled() -> bool:
    return _truthy(os.environ.get("WISDOM_EXTRACT_AUDIT_ENABLED", "0"))


def outcomes_enabled() -> bool:
    return _truthy(os.environ.get("WISDOM_OUTCOMES_ENABLED", "0"))


def context_snapshot_enabled() -> bool:
    return _truthy(os.environ.get("WISDOM_CONTEXT_SNAPSHOT_ENABLED", "0"))


def replay_enabled() -> bool:
    return _truthy(os.environ.get("WISDOM_REPLAY_ENABLED", "0"))


def metrics_enabled() -> bool:
    return _truthy(os.environ.get("WISDOM_METRICS_ENABLED", "0"))


def retrieval_index_enabled() -> bool:
    return _truthy(os.environ.get("WISDOM_RETRIEVAL_INDEX_ENABLED", "0"))


def weekly_report_enabled() -> bool:
    return _truthy(os.environ.get("WISDOM_WEEKLY_REPORT_ENABLED", "0"))


# ── member-visible consumers (owner flips) ───────────────────────────────────

def brainkb_publish_enabled() -> bool:
    return _truthy(os.environ.get("WISDOM_BRAINKB_PUBLISH_ENABLED", "0"))


def askai_retrieval_enabled() -> bool:
    return _truthy(os.environ.get("ASKAI_WISDOM_RETRIEVAL_ENABLED", "0"))


def desk_markers_enabled() -> bool:
    return _truthy(os.environ.get("WISDOM_DESK_MARKERS_ENABLED", "0"))


def badges_enabled() -> bool:
    return _truthy(os.environ.get("WISDOM_BADGES_ENABLED", "0"))


def pv_examples_enabled() -> bool:
    return _truthy(os.environ.get("WISDOM_PV_EXAMPLES_ENABLED", "0"))


def modelbook_drafts_enabled() -> bool:
    return _truthy(os.environ.get("WISDOM_MODELBOOK_DRAFTS_ENABLED", "0"))


def voice_profile_enabled() -> bool:
    return _truthy(os.environ.get("WISDOM_VOICE_PROFILE_ENABLED", "0"))


def dossier_enabled() -> bool:
    return _truthy(os.environ.get("WISDOM_DOSSIER_ENABLED", "0"))


def level_alerts_enabled() -> bool:
    return _truthy(os.environ.get("WISDOM_LEVEL_ALERTS_ENABLED", "0"))


def lookalike_enabled() -> bool:
    return _truthy(os.environ.get("WISDOM_LOOKALIKE_ENABLED", "0"))


# (env name, reader, member_visible) — the admin status page and the ledger rail read this.
GATES = (
    ("WISDOM_INGEST_ENABLED", ingest_enabled, False),
    ("WISDOM_CAPTURE_ENABLED", capture_enabled, False),
    ("WISDOM_X_BACKFILL_ENABLED", x_backfill_enabled, False),
    ("WISDOM_VOCAB_AUTOPROMOTE_ENABLED", vocab_autopromote_enabled, False),
    ("WISDOM_DISCORD_LISTENER_ENABLED", discord_listener_enabled, False),
    ("WISDOM_SOURCES_INGEST_ENABLED", sources_ingest_enabled, False),
    ("WISDOM_EXTRACT_ENABLED", extract_enabled, False),
    ("WISDOM_VISION_ENABLED", vision_enabled, False),
    ("WISDOM_EXTRACT_AUDIT_ENABLED", extract_audit_enabled, False),
    ("WISDOM_OUTCOMES_ENABLED", outcomes_enabled, False),
    ("WISDOM_CONTEXT_SNAPSHOT_ENABLED", context_snapshot_enabled, False),
    ("WISDOM_REPLAY_ENABLED", replay_enabled, False),
    ("WISDOM_METRICS_ENABLED", metrics_enabled, False),
    ("WISDOM_RETRIEVAL_INDEX_ENABLED", retrieval_index_enabled, False),
    ("WISDOM_WEEKLY_REPORT_ENABLED", weekly_report_enabled, False),
    ("WISDOM_BRAINKB_PUBLISH_ENABLED", brainkb_publish_enabled, True),
    ("ASKAI_WISDOM_RETRIEVAL_ENABLED", askai_retrieval_enabled, True),
    ("WISDOM_DESK_MARKERS_ENABLED", desk_markers_enabled, True),
    ("WISDOM_BADGES_ENABLED", badges_enabled, True),
    ("WISDOM_PV_EXAMPLES_ENABLED", pv_examples_enabled, True),
    ("WISDOM_MODELBOOK_DRAFTS_ENABLED", modelbook_drafts_enabled, True),
    ("WISDOM_VOICE_PROFILE_ENABLED", voice_profile_enabled, True),
    ("WISDOM_DOSSIER_ENABLED", dossier_enabled, True),
    ("WISDOM_LEVEL_ALERTS_ENABLED", level_alerts_enabled, True),
    ("WISDOM_LOOKALIKE_ENABLED", lookalike_enabled, True),
)
