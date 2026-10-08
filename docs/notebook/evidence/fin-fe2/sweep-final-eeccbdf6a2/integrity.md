# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 14:10:16`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-fe\sw4; identity = 0ccc5bfbd9566aa65c9e681b17336863
- `2026-10-07 14:10:50`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 14:11:39`  **shutdown** — C:\data, 62 db files — CLEAN
