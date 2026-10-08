# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 21:42:47`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w13h4charts7; identity = be4ea0524ffa94fe9d9beb79a19d235b
- `2026-10-03 21:44:14`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 21:45:02`  **shutdown** — C:\data, 62 db files — CLEAN
