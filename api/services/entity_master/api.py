"""Entity Master primitives — Checkpoint 2 (read path only).

Concrete signatures per entity-master-spec.md §6. `apply_event` (the write
primitive) is added in Checkpoint 3 — not present in this module yet, by
design, so this checkpoint's diff is reviewable on its own.

Never raises onto a caller. Matches this codebase's dominant "never raise,
return a sentinel" idiom for a service of this shape
(`delisted_registry.resolve()` -> Optional[dict]; `cap_universe.symbols()`
-> "Never raises... a missing file yields an empty set" — both read in full
during Checkpoint 1).
"""
import datetime
from dataclasses import dataclass, field
from typing import Literal, Optional

from api.services.entity_master import store


@dataclass(frozen=True)
class Entity:
    entity_id: str
    entity_type: str
    lifecycle_state: str
    lifecycle_since: Optional[str]


@dataclass(frozen=True)
class AliasRecord:
    alias: str
    valid_from: str
    valid_to: Optional[str]


@dataclass(frozen=True)
class ResolveResult:
    status: Literal["resolved", "not_found", "ambiguous"]
    entity: Optional[Entity] = None
    candidates: tuple[str, ...] = field(default_factory=tuple)  # entity_ids, only when ambiguous


def _today() -> str:
    return datetime.datetime.now(datetime.UTC).date().isoformat()


def _row_to_entity(row) -> Entity:
    entity_id, entity_type, lifecycle_state, lifecycle_since = row
    return Entity(
        entity_id=entity_id,
        entity_type=entity_type,
        lifecycle_state=lifecycle_state,
        lifecycle_since=lifecycle_since,
    )


def _load_entity(entity_id: str, db_path: str | None = None) -> Optional[Entity]:
    conn = store._conn(db_path)
    row = conn.execute(
        "SELECT entity_id, entity_type, lifecycle_state, lifecycle_since "
        "FROM entities WHERE entity_id = ?",
        (entity_id,),
    ).fetchone()
    return _row_to_entity(row) if row else None


def resolve(alias: str, as_of: str | None = None, *, db_path: str | None = None) -> ResolveResult:
    """Resolve a ticker string to its owning entity. `as_of=None` means
    "as of right now" (spec §6) — a plain UTC-date read; S3 has no
    dependency on a market-clock system for this date-granularity query
    (spec §6's explicit reasoning).

    Never picks an arbitrary first match on a genuine collision — that
    outcome is `status="ambiguous"` with every candidate entity_id, per the
    Checkpoint 2 authorization's explicit "do not hide ambiguity" condition.
    """
    a = (alias or "").strip().upper()
    if not a:
        return ResolveResult(status="not_found")

    if as_of is None:
        candidates = store.open_alias_candidates(a, db_path)
    else:
        candidates = store.alias_candidates_as_of(a, as_of, db_path)

    if not candidates:
        return ResolveResult(status="not_found")
    if len(candidates) > 1:
        return ResolveResult(status="ambiguous", candidates=tuple(candidates))

    entity = _load_entity(candidates[0], db_path)
    if entity is None:
        # An alias row pointing at a nonexistent entity is a data-integrity
        # defect, not a normal NotFound — surfaced as ambiguous-shaped
        # emptiness would be misleading, so this is the one place a
        # genuinely unexpected state degrades to NotFound rather than
        # raising (never raise onto a caller), but it is the single case
        # this module cannot happen from application code (apply_event,
        # once it exists in Checkpoint 3, always creates the entity row
        # before or alongside its first alias row).
        return ResolveResult(status="not_found")
    return ResolveResult(status="resolved", entity=entity)


def aliases(entity_id: str, as_of: str | None = None, *, db_path: str | None = None) -> list[AliasRecord]:
    """The alias history for one entity.

    `as_of=None` returns the FULL history (every alias row ever recorded for
    this entity, ordered oldest-first) — required so a closed/retired alias
    is never dropped (AC-2: "aliases() never drops the closed row") and so a
    caller doing historical-roster rendering (PRD UC-4) can render every
    name era from one call. `as_of=<a date>` filters to the alias record(s)
    whose window covers that date — per spec §4.4's "the single alias valid
    at that time" framing; still a list because a genuine collision must
    stay visible rather than being silently collapsed to one row.
    """
    conn = store._conn(db_path)
    if as_of is None:
        rows = conn.execute(
            "SELECT alias, valid_from, valid_to FROM entity_aliases "
            "WHERE entity_id = ? ORDER BY valid_from ASC",
            (entity_id,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT alias, valid_from, valid_to FROM entity_aliases "
            "WHERE entity_id = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?) "
            "ORDER BY valid_from ASC",
            (entity_id, as_of, as_of),
        ).fetchall()
    return [AliasRecord(alias=r[0], valid_from=r[1], valid_to=r[2]) for r in rows]


def vendor_symbol(entity_id: str, vendor: str, as_of: str | None = None, *, db_path: str | None = None) -> Optional[str]:
    """The vendor-native symbol for one entity/vendor pair, or None if this
    vendor has never carried this entity (a valid outcome, not an error —
    spec §9.2). When more than one row's window covers `as_of` (should not
    happen under the write-time guard, but this primitive does not assume
    the guard was honored — e.g. a directly-seeded fixture), the
    most-recently-started row wins deterministically; `vendor_symbol`'s
    return type (`Optional[str]`) has no ambiguous-status slot the way
    `resolve()` does, so a documented deterministic tie-break is used here
    instead of silently picking whichever row SQLite returns first."""
    as_of = as_of or _today()
    conn = store._conn(db_path)
    row = conn.execute(
        "SELECT vendor_symbol FROM entity_vendor_symbols "
        "WHERE entity_id = ? AND vendor = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?) "
        "ORDER BY valid_from DESC LIMIT 1",
        (entity_id, vendor, as_of, as_of),
    ).fetchone()
    return row[0] if row else None


def related_to(
    entity_id: str,
    kind: Literal["successor", "predecessor", "share_class"],
    *,
    db_path: str | None = None,
) -> list[Entity]:
    """Entities related to `entity_id` by `kind` (e.g. the other half of a
    share-class pair). Empty list if none — never raises, never None."""
    conn = store._conn(db_path)
    rows = conn.execute(
        "SELECT e.entity_id, e.entity_type, e.lifecycle_state, e.lifecycle_since "
        "FROM entity_relations r JOIN entities e ON e.entity_id = r.related_entity_id "
        "WHERE r.entity_id = ? AND r.kind = ?",
        (entity_id, kind),
    ).fetchall()
    return [_row_to_entity(r) for r in rows]
