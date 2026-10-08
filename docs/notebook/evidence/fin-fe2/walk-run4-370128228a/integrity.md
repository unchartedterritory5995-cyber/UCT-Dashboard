# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 13:27:11`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-fe\fe2-4; identity = 202d1f60915d1d654f1772863c659576
- `2026-10-07 13:27:46`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 13:29:38`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 13:32:10`  **shutdown** — C:\data, 62 db files — CLEAN
