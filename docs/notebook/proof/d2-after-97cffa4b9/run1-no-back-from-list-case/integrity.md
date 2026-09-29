# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 12:49:35`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10d2; identity = 4d321766e578094a0a94af5bcfc5b769
- `2026-09-28 12:50:20`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 12:52:11`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 12:52:17`  **shutdown** — C:\data, 62 db files — CLEAN
