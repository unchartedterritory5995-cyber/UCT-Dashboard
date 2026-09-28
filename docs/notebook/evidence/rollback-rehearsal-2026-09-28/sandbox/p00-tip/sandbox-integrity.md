# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 17:28:18`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10rb; identity = 36e9c99cb1ddd08f1ff65eadfed1f62a
- `2026-09-28 17:29:09`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 17:31:00`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 17:31:07`  **shutdown** — C:\data, 62 db files — CLEAN
