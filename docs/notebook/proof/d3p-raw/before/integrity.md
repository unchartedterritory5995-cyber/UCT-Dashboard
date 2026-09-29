# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 21:40:56`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10d3p; identity = b88f90ad5c1eb80f923c2d4f6091135c
- `2026-09-28 21:42:23`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 21:44:23`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 21:51:30`  **shutdown** — C:\data, 62 db files — CLEAN
