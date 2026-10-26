tip under test: 5cdeba87ee
phase: w9off-resume1
(copied from the launcher log docs/plans/joystick/sandbox-runs/2026-10-25T17-00-40.md)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-25 17:00:45`  **pre-boot (baseline)** — C:\data, 63 db files — CLEAN
    - sandbox = C:\data-nbw-walk; identity = c2f5c1bdeb30b9d2d9f4bc4b64eeaa44
- `2026-10-25 17:01:14`  **post-boot (+15s)** — C:\data, 63 db files — CLEAN
- `2026-10-25 17:03:04`  **post-prewarm (+120s)** — C:\data, 63 db files — CLEAN
- `2026-10-25 17:03:10`  **shutdown** — C:\data, 63 db files — CLEAN
