# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 13:26:49`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10d2; identity = 37c9eca92fb4267fa355fd47007d0cf9
- `2026-09-28 13:27:33`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 13:29:25`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 13:29:31`  **shutdown** — C:\data, 62 db files — CLEAN
