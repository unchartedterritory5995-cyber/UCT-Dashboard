# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-14 23:30:50`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-typing-on-blocks-r1; identity = b7d2e5c670fdb6865e2cb82ce96a4e73
- `2026-10-14 23:31:35`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-14 23:32:51`  **shutdown** — C:\data, 62 db files — CLEAN
