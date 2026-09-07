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
    # Architected, INACTIVE (checkpoint decision 23/28): no frontend capture
    # path reaches this. Proves the registry/resolver/storage generalize to a
    # genuinely rights-conditional, vendor-derived fact type without silently
    # turning on persistent vendor-value storage.
    "analyst_price_target_consensus": FactTypeDef(
        key="analyst_price_target_consensus", label="Analyst Price Target (Consensus)",
        value_column="value_number", unit="usd_per_share",
        temporal_mode="snapshot", source="fmp", rights_class="conditional",
        active=False,
    ),
}


def get_fact_type(key: str) -> Optional[FactTypeDef]:
    return FACT_TYPES.get(key)


def is_active(key: str) -> bool:
    d = FACT_TYPES.get(key)
    return bool(d and d.active)
