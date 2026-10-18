# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-17 23:49:05`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t3walk-r1; identity = e44f0fcbda06056c3ee997589e2894c3
- `2026-10-17 23:49:57`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-17 23:51:51`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-17 23:53:52`  **shutdown** — C:\data, 62 db files — CLEAN
