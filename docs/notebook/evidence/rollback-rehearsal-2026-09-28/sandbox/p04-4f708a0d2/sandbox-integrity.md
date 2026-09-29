# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 16:56:49`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10rb; identity = 8f971ead8c1e59eb2a69d65b84123da0
- `2026-09-28 16:57:47`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 16:59:38`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 16:59:45`  **shutdown** — C:\data, 62 db files — CLEAN
