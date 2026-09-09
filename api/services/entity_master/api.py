"""Entity Master primitives — reads (Checkpoint 2) + writes (Checkpoint 3).

Concrete signatures per entity-master-spec.md §6.

Never raises onto a caller. Matches this codebase's dominant "never raise,
return a sentinel" idiom for a service of this shape
(`delisted_registry.resolve()` -> Optional[dict]; `cap_universe.symbols()`
-> "Never raises... a missing file yields an empty set" — both read in full
during Checkpoint 1).
"""
import datetime
import json
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


# ─── Checkpoint 3 — write path ──────────────────────────────────────────────

@dataclass(frozen=True)
class ApplyResult:
    accepted: bool
    reason: Optional[str] = None
    entity_id: Optional[str] = None


_VALID_EVENT_TYPES = {
    "new_entity", "alias_added", "alias_retired", "delisted", "renamed", "relation_added",
}
_VALID_RELATION_KINDS = {"successor", "predecessor", "share_class"}


def apply_event(
    event_type: str, payload: dict, dedup_key: str, source: str, *, db_path: str | None = None
) -> ApplyResult:
    """Submit one identity-change event (spec §4.3's typed contract) — the
    only way `entities`/`entity_aliases`/`entity_relations` are ever
    written. Never a raw INSERT from a caller (delisted-registry-style
    "provider-specific data mapping INTO canonical identity, not silently
    BECOMING it" — this function is the sole gate that decides whether a
    proposed identity change is actually recorded).

    Idempotent on `dedup_key` (AC-5): a second call with the same
    `dedup_key` returns the SAME result without touching any table a second
    time (`store.get_event_by_dedup_key` short-circuits before any domain
    mutation). Rejects a collision with a named reason on the
    `entity_events` row, never silently drops or silently accepts it
    (spec §8.4 / PRD §13.1) — the write-time invariant guard runs inside
    `store._WRITE_LOCK` alongside every other domain mutation, matching
    `bars_sqlite.py`'s own single-writer contract.
    """
    if event_type not in _VALID_EVENT_TYPES:
        return ApplyResult(accepted=False, reason=f"unknown event_type '{event_type}'")
    payload = payload or {}

    with store._WRITE_LOCK:
        existing = store.get_event_by_dedup_key(dedup_key, db_path)
        if existing is not None:
            _id, ent_id, _etype, rejected_reason = existing
            return ApplyResult(accepted=rejected_reason is None, reason=rejected_reason, entity_id=ent_id)

        entity_id, reason = _validate_and_resolve_entity_id(event_type, payload, db_path)
        accepted = reason is None
        payload_json = json.dumps(payload, sort_keys=True)

        if not accepted:
            store.record_event(dedup_key, entity_id, event_type, payload_json, source, reason, db_path)
            store._conn(db_path).commit()
            return ApplyResult(accepted=False, reason=reason, entity_id=entity_id)

        event_id = store.record_event(dedup_key, entity_id, event_type, payload_json, source, None, db_path)
        _apply_domain_mutation(event_type, entity_id, payload, event_id, db_path)
        store._conn(db_path).commit()

    if event_type in ("new_entity", "alias_added", "alias_retired", "renamed") and not store._BULK_MODE:
        store.rebuild_cache(db_path)
    return ApplyResult(accepted=True, entity_id=entity_id)


def _validate_and_resolve_entity_id(
    event_type: str, payload: dict, db_path: str | None
) -> tuple[Optional[str], Optional[str]]:
    """Runs every check BEFORE any write — validation + the collision guard
    (spec §8.4). Returns (entity_id, rejected_reason); rejected_reason is
    None iff the event is accepted. `entity_id` is resolved here even on
    acceptance (for `new_entity`, a fresh id is generated in Python via
    `store.new_entity_id()` — a ULID needs no DB round-trip to exist, so
    `entity_events.entity_id` is never actually written NULL-then-backfilled
    despite the schema comment's "pre-assignment" phrasing describing the
    conceptual moment before generation, not a required two-step write)."""
    if event_type == "new_entity":
        entity_type = payload.get("entity_type")
        alias = (payload.get("initial_alias") or "").strip().upper()
        valid_from = payload.get("initial_alias_valid_from")
        if not entity_type or not alias or not valid_from:
            return None, "new_entity requires entity_type, initial_alias, initial_alias_valid_from"
        collisions = store.colliding_entity_ids(alias, valid_from, None, None, db_path)
        if collisions:
            return None, f"alias '{alias}' collides with existing entity {collisions[0]}"
        return store.new_entity_id(), None

    entity_id = payload.get("entity_id")
    if not entity_id:
        return None, f"{event_type} requires entity_id"
    if not store.entity_exists(entity_id, db_path):
        return entity_id, f"entity {entity_id} does not exist"

    if event_type == "alias_added":
        alias = (payload.get("alias") or "").strip().upper()
        valid_from = payload.get("valid_from")
        if not alias or not valid_from:
            return entity_id, "alias_added requires alias, valid_from"
        collisions = store.colliding_entity_ids(alias, valid_from, None, entity_id, db_path)
        if collisions:
            return entity_id, f"alias '{alias}' collides with existing entity {collisions[0]}"
        return entity_id, None

    if event_type == "alias_retired":
        alias = (payload.get("alias") or "").strip().upper()
        valid_to = payload.get("valid_to")
        if not alias or not valid_to:
            return entity_id, "alias_retired requires alias, valid_to"
        if not store.has_open_alias(entity_id, alias, db_path):
            return entity_id, f"no open alias '{alias}' found for entity {entity_id}"
        return entity_id, None

    if event_type == "delisted":
        if not payload.get("lifecycle_since"):
            return entity_id, "delisted requires lifecycle_since"
        return entity_id, None

    if event_type == "renamed":
        old_alias = (payload.get("old_alias") or "").strip().upper()
        old_valid_to = payload.get("old_alias_valid_to")
        new_alias = (payload.get("new_alias") or "").strip().upper()
        new_valid_from = payload.get("new_alias_valid_from")
        if not all((old_alias, old_valid_to, new_alias, new_valid_from)):
            return entity_id, "renamed requires old_alias, old_alias_valid_to, new_alias, new_alias_valid_from"
        if not store.has_open_alias(entity_id, old_alias, db_path):
            return entity_id, f"no open alias '{old_alias}' found for entity {entity_id}"
        collisions = store.colliding_entity_ids(new_alias, new_valid_from, None, entity_id, db_path)
        if collisions:
            return entity_id, f"alias '{new_alias}' collides with existing entity {collisions[0]}"
        return entity_id, None

    if event_type == "relation_added":
        related_entity_id = payload.get("related_entity_id")
        kind = payload.get("kind")
        if not related_entity_id or kind not in _VALID_RELATION_KINDS:
            return entity_id, "relation_added requires related_entity_id and a valid kind"
        if entity_id == related_entity_id:
            return entity_id, "relation_added: entity_id and related_entity_id must differ"
        if not store.entity_exists(related_entity_id, db_path):
            return entity_id, f"related entity {related_entity_id} does not exist"
        return entity_id, None

    return entity_id, f"unhandled event_type '{event_type}'"  # unreachable: gated by _VALID_EVENT_TYPES


def _apply_domain_mutation(
    event_type: str, entity_id: str, payload: dict, event_id: int, db_path: str | None
) -> None:
    """The actual table writes, run only after `_validate_and_resolve_entity_id`
    has already accepted the event. Called while holding `_WRITE_LOCK`."""
    if event_type == "new_entity":
        alias = payload["initial_alias"].strip().upper()
        store.create_entity(entity_id, payload["entity_type"], db_path)
        store.add_alias(entity_id, alias, payload["initial_alias_valid_from"], event_id, db_path)
        cik = payload.get("cik")
        composite_figi = payload.get("composite_figi")
        if composite_figi or cik:
            store.upsert_figi(entity_id, composite_figi, None, "massive_reference", db_path)
    elif event_type == "alias_added":
        alias = payload["alias"].strip().upper()
        store.add_alias(entity_id, alias, payload["valid_from"], event_id, db_path)
    elif event_type == "alias_retired":
        alias = payload["alias"].strip().upper()
        store.close_open_alias(entity_id, alias, payload["valid_to"], db_path)
    elif event_type == "delisted":
        store.set_lifecycle_state(entity_id, "delisted", payload["lifecycle_since"], db_path)
    elif event_type == "renamed":
        old_alias = payload["old_alias"].strip().upper()
        new_alias = payload["new_alias"].strip().upper()
        store.close_open_alias(entity_id, old_alias, payload["old_alias_valid_to"], db_path)
        store.add_alias(entity_id, new_alias, payload["new_alias_valid_from"], event_id, db_path)
    elif event_type == "relation_added":
        # spec §4.3's relation_added payload shape omits valid_from despite
        # entity_relations.valid_from being NOT NULL — a genuine gap between
        # the documented payload and the DDL. Resolved here (Checkpoint 3)
        # by defaulting to the event's own application date; recorded as a
        # deviation in the implementation log per "evidence wins, record
        # the deviation" rather than silently working around it unnoted.
        valid_from = payload.get("valid_from") or _today()
        store.add_relation(entity_id, payload["related_entity_id"], payload["kind"], valid_from, event_id, db_path)


# ─── Provider-data write helpers ────────────────────────────────────────────
# NOT part of apply_event's event vocabulary (spec §4.2's event_type column
# lists no vendor/FIGI event) — these are the seed script's (Checkpoint 4)
# and reconciliation job's direct write path into entity_vendor_symbols/
# entity_figi. Structurally incapable of touching entities/entity_aliases:
# neither function accepts anything but an existing entity_id, a vendor
# name, and vendor-sourced values — "provider data maps INTO canonical
# identity, never silently BECOMES it."
#
# Boundary (Checkpoint 5): Entity Master owns the canonical mapping FROM an
# entity TO a provider's symbol for that provider — enough for any caller to
# resolve a provider record back to canonical identity. It does NOT own
# broader provider routing, request construction, response normalization,
# rate limiting, or failover — that is the not-yet-built Provider
# Abstraction Layer's job (D1, product-architecture.md §4.2), which this
# build does not implement. `vendor` here is an opaque string key (matches
# whatever D1's eventual adapter registry will use — spec §4.2's own
# comment: "D1's adapter registry keys") — Entity Master does not validate
# it against a fixed provider list, since owning that list is D1's job too.

@dataclass(frozen=True)
class MappingResult:
    written: bool
    conflict: bool = False  # vendor_symbol only: a DIFFERENT value already existed at this exact key
    changed: bool = False   # figi only: an existing value was replaced by a genuinely different one


def set_vendor_symbol(
    entity_id: str, vendor: str, vendor_symbol: str, valid_from: str, source: str,
    *, db_path: str | None = None,
) -> MappingResult:
    """Idempotent on an identical repeat. A genuine value conflict at the
    same (entity_id, vendor, valid_from) is REJECTED (the original value is
    kept — `entity_vendor_symbols` is a dated history, spec §8.1's "no
    update-in-place on a historical fact"; a real correction needs a NEW
    valid_from). Never silently applies either the old or the new value on
    conflict without telling the caller which happened."""
    with store._WRITE_LOCK:
        written, conflict = store.upsert_vendor_symbol(entity_id, vendor, vendor_symbol, valid_from, source, db_path)
        store._conn(db_path).commit()
    return MappingResult(written=written, conflict=conflict)


def set_figi(
    entity_id: str, composite_figi: Optional[str], share_class_figi: Optional[str], source: str,
    *, db_path: str | None = None,
) -> MappingResult:
    """`entity_figi` is a current-snapshot table (PK on entity_id, no dated
    history) — unlike vendor symbols above, a new value legitimately
    OVERWRITES the old one (that is the point of the table). `changed`
    reports whether this call actually replaced a different prior value, so
    a caller/log can distinguish a real FIGI update from a no-op re-run."""
    with store._WRITE_LOCK:
        written, changed = store.upsert_figi(entity_id, composite_figi, share_class_figi, source, db_path)
        store._conn(db_path).commit()
    return MappingResult(written=written, changed=changed)
