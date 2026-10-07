# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-06 22:14:12`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-nav; identity = bccdc891abf29134940ec5a1edfd5df8
- `2026-10-06 22:14:48`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-06 22:15:39`  **shutdown** — C:\data, 62 db files — CLEAN
