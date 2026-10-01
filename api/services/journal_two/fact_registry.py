"""Wave F — Financial Fact / Snapshot Ledger. Fact-type registry.

One entry per supported fact_type: which value column it uses, its unit,
temporal mode, source, and rights class (entry checkpoint decisions 6/18/27).
Adding a new fact type is a registry entry (+ a current-value resolver
function if it's `live_and_snapshot`) -- never a schema change. `active=False`
means the type is fully architected but reachable from no frontend capture
path (checkpoint decision 23/28) -- the registry itself never gates a read
(an already-captured fact of an inactive type, e.g. from before it was
deactivated, still resolves normally), only `note_facts.create_fact_observation`
gates writes against it.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

ValueColumn = Literal["value_number", "value_text"]
TemporalMode = Literal["live", "snapshot", "live_and_snapshot", "reference_only"]
Source = Literal["user", "uct_derived", "massive", "fmp"]
# `conditional` carries a DISPLAY obligation once a type is activated, not
# just a write gate: it is genuinely new vendor-value persistence with no
# prior precedent in this codebase, and the owner's external legal clearance
# for it (VENDOR-TERMS-2026-09-23.md §5, L5/L2 -- FMP licensing approved
# directly 2026-09-25) covers SHOWING the vendor's data to members, not
# hiding whose it is. `FinancialFactView.jsx` reads `rightsClass` off the
# resolved fact and renders a "Source: {SOURCE}" attribution line for
# exactly this class -- never for `independent` (UCT's own bars, or the
# member's own text, need no vendor credit).
RightsClass = Literal["independent", "conditional", "blocked"]


@dataclass(frozen=True)
class FactTypeDef:
    key: str
    label: str
    value_column: ValueColumn
    unit: str
    temporal_mode: TemporalMode
    source: Source
    rights_class: RightsClass
    active: bool
    needs_period: bool = False


FACT_TYPES: dict[str, FactTypeDef] = {
    "price": FactTypeDef(
        key="price", label="Price", value_column="value_number", unit="usd_per_share",
        temporal_mode="live_and_snapshot", source="massive", rights_class="independent",
        active=True,
    ),
    "user_note": FactTypeDef(
        key="user_note", label="Note", value_column="value_text", unit="text",
        temporal_mode="snapshot", source="user", rights_class="independent",
        active=True,
    ),
    # ACTIVE since G-062 (owner ruling 2026-09-25: FMP licensing approved
    # directly -- docs/notebook/VENDOR-TERMS-2026-09-23.md §5 L5/L2). Was
    # "architected, INACTIVE" through checkpoint decision 23/28, proving the
    # registry/resolver/storage generalized to a genuinely rights-conditional,
    # vendor-derived fact type before persistent vendor-value storage was
    # legally cleared -- that clearance is now in hand, not waived, so the
    # gate in `note_facts.create_fact_observation` opens for this key.
    # `rights_class="conditional"` still applies and still means something:
    # see the DISPLAY note on `RightsClass` above. `snapshot` (never
    # `live_and_snapshot`) is deliberate -- a consensus has no historical
    # re-query source, so it is captured once and never re-derived (G-061's
    # own finding; financial-temporal-semantics.md's Rights section).
    "analyst_price_target_consensus": FactTypeDef(
        key="analyst_price_target_consensus", label="Analyst Price Target (Consensus)",
        value_column="value_number", unit="usd_per_share",
        temporal_mode="snapshot", source="fmp", rights_class="conditional",
        active=True,
    ),
}


def get_fact_type(key: str) -> Optional[FactTypeDef]:
    return FACT_TYPES.get(key)


def is_active(key: str) -> bool:
    d = FACT_TYPES.get(key)
    return bool(d and d.active)
