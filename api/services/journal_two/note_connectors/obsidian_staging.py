"""Staging writes for the Obsidian push transport (Task 3 of the
2026-09-02-obsidian-ingest-server plan).

Obsidian is local-first, so the plugin PUSHES; the sync engine only PULLS
from providers. Staging is the seam: this module writes `j2_obsidian_staging`
(and, on a `final` push, `j2_obsidian_manifest`), and Task 4's provider reads
those SAME tables and satisfies the ordinary `NoteProvider` contract, so the
engine's convert -> upsert -> conflict -> media path and its delete detection
are INHERITED here, never re-implemented.

⛔ This module NEVER writes `j2_notes`. See the router docstring
(`api/routers/note_sync.py::obsidian_ingest`) for why that shortcut is
forbidden -- writing notes directly would duplicate the conflict ratchet,
delete detection, media phase and import-hash logic, and the copies would
drift apart silently.

Cross-tenant safety: every function here takes `user_id`/`vault_id` as
explicit keyword parameters that the ROUTER must source from the
authenticated device (`obsidian_link.authenticate_device`), never from the
request body. Task 1's review carried this forward as the constraint most
likely to bite here: `j2_obsidian_devices`'s bare `id` primary key does not
stop a cross-tenant read/write on its own, so every query in this module
filters on both `user_id` AND `vault_id` explicitly -- there is no code path
that lets a value from the request body pick which tenant's rows get touched.

⛔⛔ SECURITY (2026-09-02 review, C1): `note["updated_at"]` is CLIENT INPUT --
the plugin's own filesystem mtime read, forwarded here through the router
with no validation at all. A garbled/corrupt mtime is an ORDINARY failure
mode, no attacker required, and the review measured its blast radius: one
staged row with `updated_at="9999-12-31T23:59:59Z"` used to become
`max(ref.updated_at for ref in refs)` in `engine.py`'s cursor derivation --
a floor no real future timestamp could ever clear, silently freezing that
vault's sync forever (`status: ok`, no error, no self-heal, because
`list_present_refs` deliberately keeps the engine from resetting this
provider's cursor -- see `providers/obsidian.py`'s own docstring). Two
independent layers now guard against this, neither a substitute for the
other:
  1. `_sanitize_updated_at` (below) CLAMPS a malformed or implausibly-future
     `updated_at` to this call's own `received_at` before it is ever stored
     -- the note still syncs, under a timestamp the SERVER can vouch for,
     rather than being silently dropped or stored raw into a later string
     comparison.
  2. `providers/obsidian.py::list_changed` no longer cursors on `updated_at`
     AT ALL -- it publishes `received_at` (this module's own
     server-assigned, monotonically-increasing column, never touched by an
     unchanged re-push -- see the no-op branch below) via the engine's
     `opaque_cursor` extension point, so a gap in layer 1 could never
     reproduce this defect: the cursor simply never reads a client-supplied
     value, structurally.

Spec: .superpowers/sdd/2026-09-02-obsidian-ingest-server/task-3-brief.md
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from api.services.auth_db import get_connection

from . import errors

# How far into the future a plugin-reported `updated_at` is still treated as
# an honest clock, not a garbled/corrupt mtime -- generous enough to absorb
# real client clock skew (this is a member's own machine, not a server we
# control) while catching the failure mode the security review measured
# (a multi-THOUSAND-year skew). Not tunable via env: this is a data-integrity
# clamp, not an operational knob.
_MAX_FUTURE_SKEW = timedelta(days=1)

# I7 (2026-09-02 review): "no rate limit, no staging/manifest caps, no
# global body middleware." A leaked/malicious device token is bounded to
# exactly one (user_id, vault_id) pair -- no cross-tenant reach, see this
# module's own docstring -- but the shared SQLite volume backs 20+
# databases on ONE single-replica pod, so unbounded growth from a SINGLE
# vault is an outage for every member, not just this token's owner. All
# five bounds below are checked BEFORE any write in `ingest_batch`, so a
# rejected batch never lands partially. Deliberately generous -- these
# exist to bound a runaway/malicious client, not to constrain a real vault
# (even a very large personal knowledge base is nowhere close to these).
_MAX_NOTES_PER_BATCH = 2_000
_MAX_MANIFEST_ENTRIES = 50_000
_MAX_STAGING_ROWS_PER_VAULT = 50_000
_MAX_VAULT_PATH_LEN = 1024
_MAX_BODY_MD_LEN = 1_500_000


def _now_iso() -> str:
    # `timespec="microseconds"` pins the fractional-second width so every
    # value this function ever produces sorts identically under a plain
    # lexicographic string compare (SQLite's `>` on TEXT, and Python's own
    # `max()`) -- without it, `datetime.isoformat()` silently DROPS the
    # fractional part whenever microsecond happens to land on exactly 0,
    # which would otherwise let that one-in-a-million row sort as though it
    # were LATER than a same-second neighbour with a nonzero fraction.
    # `received_at` is now load-bearing for cursor correctness (see the
    # module docstring's C1 section), so this format guarantee is no longer
    # cosmetic.
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _sanitize_updated_at(raw: Any, *, received_at: str) -> str:
    """Returns `raw` unchanged if it parses as a well-formed, timezone-aware
    ISO-8601 timestamp no more than `_MAX_FUTURE_SKEW` past "now" --
    otherwise returns `received_at` (this ingest call's own server-assigned
    timestamp) instead. See the module docstring's C1 section for why this
    clamps rather than rejects the note outright: the note still syncs and
    still displays a plausible "last modified," just not one the client
    cannot be trusted to have reported honestly. A naive (no-tzinfo) value
    is treated as malformed rather than guessed-at -- an ambiguous timezone
    is exactly the class of "garbage mtime" this function exists to defuse,
    not a case worth silently assuming UTC for."""
    if isinstance(raw, str):
        text = raw.strip()
        if text.endswith("Z") or text.endswith("z"):
            text = text[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            parsed = None
        if parsed is not None and parsed.tzinfo is not None:
            if parsed <= datetime.now(timezone.utc) + _MAX_FUTURE_SKEW:
                return raw
    return received_at


def ingest_batch(
    *,
    user_id: str,
    vault_id: str,
    notes: list[dict[str, Any]],
    manifest: list[str] | None,
    final: bool,
) -> dict[str, Any]:
    """Writes `notes` into `j2_obsidian_staging` for `(user_id, vault_id)`,
    then -- only when `final` is true AND a `manifest` was actually supplied
    -- atomically replaces `j2_obsidian_manifest` for the same pair. Returns
    `{"written": int, "skipped": int, "manifestReplaced": bool}`. Raises
    `errors.NoteConnValidationError` (mapped to HTTP 400 by the router) and
    writes NOTHING for the whole batch when a bound below is violated --
    this module deliberately does not silently truncate/filter a bad
    payload, since a padded or oversized batch is exactly evidence an
    honest plugin would never produce (see I3/I4/I7 below).

    No-op on an unchanged hash: an existing row whose stored `content_hash`
    already equals the pushed one is neither rewritten nor its `received_at`
    bumped -- a plugin's routine re-push of untouched files must never
    manufacture fake activity for that path.

    Manifest atomicity: the DELETE + INSERT for the manifest run in the SAME
    transaction as the note writes -- one `commit()` at the end, one
    `rollback()` on any failure -- so the table is never observably empty
    between the delete and the re-insert. A partial push must never leave a
    truncated manifest: Task 4 hands this table to the engine's
    `list_present_refs` hook as the COMPLETE remote set, and a truncated one
    would read as "the member deleted every file not in this batch." A
    NON-final push, or a final push that sends no `manifest` field at all
    (`manifest is None`), never touches this table.

    ⛔⛔ I3 (2026-09-02 review, MEASURED): the engine's own delete-detection
    guard (`engine.py:~636`, `len(seen_ids) < prev_count*0.5`) checks
    CARDINALITY, not overlap -- 200 fabricated paths against 100 real
    tracked notes sailed straight past it (200 > 50) while overlapping NONE
    of the 100, and both were tagged `source-deleted` over two nightly
    passes. `engine.py` is shared by Notion/Dropbox/OneNote/OneDrive/Roam/
    Craft and is off limits for this fix, so the guard belongs HERE, at the
    one place that knows something the engine never gets to see: every path
    THIS vault has ever actually pushed body content for. A manifest
    asserting a path exists that was never staged -- not in this batch, not
    in any prior one -- is not something an honest plugin produces (the
    plugin can only list files it read off disk, and reading a file is
    exactly what puts it in `notes`); it is refused outright, not silently
    filtered, so a manifest that is PART honest and part padded still
    leaves the previous (trustworthy) manifest untouched rather than
    accepting the honest paths and hoping the padding is harmless. This
    does not weaken the legitimate case Task 3 protects: a vault file that
    exists but was not re-sent in THIS batch (unchanged content_hash, or
    staged by an earlier batch of a multi-batch push) is still `known` --
    the check is against every vault_path ever staged for this
    (user_id, vault_id), not against this call's `notes` alone.

    ⛔ I4 (2026-09-02 review): `manifest: [], final: true` used to sail
    through (`[] is not None`) and wipe the table -- the ONLY thing that
    stopped it mass-deleting downstream was the engine's inherited <50%
    guard, which is exactly the "relying on a downstream guard for
    something we can reject at the boundary" mistake I3 made too. An empty
    manifest is the plugin asserting "this vault has zero files" -- not a
    claim worth accepting from a client at face value (a failed filesystem
    walk produces the identical signal), and a vault with genuinely zero
    notes has nothing worth syncing in the first place, so refusing this
    outright costs a real member nothing.
    """
    if len(notes) > _MAX_NOTES_PER_BATCH:
        raise errors.NoteConnValidationError(
            f"batch of {len(notes)} notes exceeds the {_MAX_NOTES_PER_BATCH}-note-per-push cap"
        )
    for note in notes:
        vault_path = note.get("vault_path") or ""
        if len(vault_path) > _MAX_VAULT_PATH_LEN:
            raise errors.NoteConnValidationError(
                f"vault_path exceeds {_MAX_VAULT_PATH_LEN} characters"
            )
        body_md = note.get("body_md") or ""
        if len(body_md) > _MAX_BODY_MD_LEN:
            raise errors.NoteConnValidationError(
                f"body_md for {vault_path!r} exceeds {_MAX_BODY_MD_LEN} characters"
            )
    if manifest is not None and len(manifest) > _MAX_MANIFEST_ENTRIES:
        raise errors.NoteConnValidationError(
            f"manifest of {len(manifest)} entries exceeds the {_MAX_MANIFEST_ENTRIES}-entry cap"
        )

    received_at = _now_iso()
    written = 0
    skipped = 0
    conn = get_connection()
    try:
        existing_paths = {
            r["vault_path"] for r in conn.execute(
                "SELECT vault_path FROM j2_obsidian_staging WHERE user_id = ? AND vault_id = ?",
                (user_id, vault_id),
            ).fetchall()
        }
        incoming_paths = {note["vault_path"] for note in notes}
        new_path_count = len(incoming_paths - existing_paths)
        if len(existing_paths) + new_path_count > _MAX_STAGING_ROWS_PER_VAULT:
            # I7 -- checked BEFORE any write, off a query run inside this
            # same transaction/connection, so nothing partially lands.
            raise errors.NoteConnValidationError(
                f"this vault would exceed the {_MAX_STAGING_ROWS_PER_VAULT}-staged-file cap "
                f"({len(existing_paths)} already known + {new_path_count} new in this batch)"
            )

        for note in notes:
            vault_path = note["vault_path"]
            content_hash = note["content_hash"]
            existing = conn.execute(
                "SELECT content_hash FROM j2_obsidian_staging "
                "WHERE user_id = ? AND vault_id = ? AND vault_path = ?",
                (user_id, vault_id, vault_path),
            ).fetchone()
            if existing is not None and existing["content_hash"] == content_hash:
                skipped += 1
                continue
            safe_updated_at = _sanitize_updated_at(note["updated_at"], received_at=received_at)
            conn.execute(
                "INSERT OR REPLACE INTO j2_obsidian_staging "
                "(user_id, vault_id, vault_path, content_hash, body_md, updated_at, received_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    user_id, vault_id, vault_path, content_hash,
                    note["body_md"], safe_updated_at, received_at,
                ),
            )
            written += 1

        manifest_replaced = False
        if final and manifest is not None:
            if len(manifest) == 0:
                # I4 -- refused outright; see the docstring above.
                raise errors.NoteConnValidationError(
                    "an empty manifest cannot legitimately assert a vault has zero files -- refused"
                )
            # I3 -- the complete set of paths this vault has EVER actually
            # staged body content for, including everything just written
            # (or no-op'd as unchanged) above in THIS call.
            known_paths = existing_paths | incoming_paths
            fabricated = sorted(set(manifest) - known_paths)
            if fabricated:
                raise errors.NoteConnValidationError(
                    f"manifest lists {len(fabricated)} path(s) never pushed to staging for "
                    f"this vault (e.g. {fabricated[0]!r}) -- refused"
                )
            conn.execute(
                "DELETE FROM j2_obsidian_manifest WHERE user_id = ? AND vault_id = ?",
                (user_id, vault_id),
            )
            recorded_at = _now_iso()
            conn.executemany(
                "INSERT INTO j2_obsidian_manifest (user_id, vault_id, vault_path, recorded_at) "
                "VALUES (?, ?, ?, ?)",
                [(user_id, vault_id, path, recorded_at) for path in manifest],
            )
            manifest_replaced = True

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return {"written": written, "skipped": skipped, "manifestReplaced": manifest_replaced}
