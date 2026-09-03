"""S7 (Alerts & Monitoring) — the shared alert taxonomy.

Authorized first slice only (owner authorization, 2026-09-03): the taxonomy
package/schema plus `document-arrival` as the first live trigger type. The
seven already-working alert subsystems (price alerts, indicator alerts,
awareness engine, catalyst alerts, ...) are explicitly OUT OF SCOPE and are
untouched by this package — see PRD-S7 §18 / SPEC-S7 §17's own step 3-6,
deliberately not started here.
"""
