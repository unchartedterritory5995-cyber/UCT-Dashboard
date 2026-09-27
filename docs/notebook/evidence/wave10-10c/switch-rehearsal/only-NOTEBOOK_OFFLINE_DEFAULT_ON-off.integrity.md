# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 19:22:20`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10c; identity = 8a2bdddadb4d7d5c22f8cb3ee02be094
- `2026-09-26 19:23:02`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 19:24:52`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 19:24:58`  **shutdown** — C:\data, 62 db files — CLEAN
