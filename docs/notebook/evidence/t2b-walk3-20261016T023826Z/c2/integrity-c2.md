tip under test: 00703930aa (configuration c2)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-15 21:38:57`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2b-walk3\c2; identity = a74fb5ab9854d1ab8363b61ab54ceb7c
- `2026-10-15 21:40:20`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 21:42:16`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 21:44:22`  **shutdown** — C:\data, 62 db files — CLEAN
