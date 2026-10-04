# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 21:47:33`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w13h4charts8; identity = 6f621937bd57798cb526034e3c07d8eb
- `2026-10-03 21:49:02`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 21:49:19`  **shutdown** — C:\data, 62 db files — CLEAN
