# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 14:44:00`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10k2; identity = 2e5f9cbfc76871deeee6a80545aa9633
- `2026-09-28 14:44:43`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 14:46:37`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 15:00:16`  **shutdown** — C:\data, 62 db files — CLEAN
