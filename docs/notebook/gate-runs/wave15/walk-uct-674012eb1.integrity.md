# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-04 10:30:50`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w15uct4; identity = 65f7a5d90e69c1a9f14ee6eb1609cfd1
- `2026-10-04 10:31:45`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-04 10:33:38`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-04 10:33:46`  **shutdown** — C:\data, 62 db files — CLEAN
