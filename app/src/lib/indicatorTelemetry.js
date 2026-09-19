/**
 * The CLIENT half of indicator-journey telemetry — Phase One Track C.
 *
 * Only `import_submitted`/`compile_finished` are posted from here; the other
 * three events in the five-event minimum (`import_accepted`,
 * `delivery_configured`, `execution_finished`) are server-derived only — see
 * `api/services/indicator_telemetry.py`'s module docstring for why a client
 * must never be able to assert one of those about its own unconfirmed input.
 *
 * ⛔ NEVER pass the pasted script/thinkScript/PCF text (or any of it) in
 * `props`. This function does not enforce that — it is a thin POST — so the
 * discipline belongs to every call site. `props` is for SHAPE: dialect,
 * success/failure, a stage/gate name.
 *
 * Best-effort: a telemetry failure must never surface to the member or block
 * whatever product action it is observing. Every failure is swallowed.
 */
export async function logIndicatorTelemetry(event, { importId, dialect, props } = {}) {
  if (!importId) return
  try {
    await fetch('/api/indicator-telemetry/event', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, import_id: importId, dialect: dialect || null, props: props || null }),
    })
  } catch {
    // best-effort — see module docstring
  }
}

/** A fresh, per-import correlation id. One per attempt, threaded through
 * `import_submitted` -> `compile_finished` -> (on Save) `import_accepted`. */
export function newImportId() {
  return crypto.randomUUID()
}
