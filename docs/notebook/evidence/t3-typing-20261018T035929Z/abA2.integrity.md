# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-17 23:12:13`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t3typing-abA2; identity = 2c3c1af25571e0e1a50e0824ed7fb00c
- `2026-10-17 23:12:46`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-17 23:13:06`  **shutdown** — C:\data, 62 db files — CLEAN
