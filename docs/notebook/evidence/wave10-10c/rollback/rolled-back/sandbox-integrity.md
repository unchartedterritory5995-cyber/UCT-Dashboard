# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 19:47:46`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10c; identity = 11326532ff6f9a897fbd0461cf3e10f0
- `2026-09-26 19:48:34`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 19:50:24`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 19:50:29`  **shutdown** — C:\data, 62 db files — CLEAN
