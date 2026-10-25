tip under test: 5cdeba87ee
phase: on
(copied from the launcher log docs/plans/joystick/sandbox-runs/2026-10-25T16-37-10.md)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-25 16:37:15`  **pre-boot (baseline)** — C:\data, 63 db files — CLEAN
    - sandbox = C:\data-nbw-walk; identity = 54f7055a4ed042cbe8782a93f9a07bd3
- `2026-10-25 16:37:47`  **post-boot (+15s)** — C:\data, 63 db files — CLEAN
- `2026-10-25 16:39:40`  **post-prewarm (+120s)** — C:\data, 63 db files — CLEAN
- `2026-10-25 16:52:14`  **shutdown** — C:\data, 63 db files — CLEAN
