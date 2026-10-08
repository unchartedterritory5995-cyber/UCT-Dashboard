# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 13:52:23`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-fe\off1; identity = f78f8d04c018016d77d5d52e4f74a5d9
- `2026-10-07 13:53:07`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 13:53:31`  **shutdown** — C:\data, 62 db files — CLEAN
