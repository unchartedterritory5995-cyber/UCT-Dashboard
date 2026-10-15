# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-14 23:43:26`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-typing-on-alert-r2; identity = d04c58c778d6ea9ca97ed287712939f2
- `2026-10-14 23:44:17`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-14 23:44:37`  **shutdown** — C:\data, 62 db files — CLEAN
