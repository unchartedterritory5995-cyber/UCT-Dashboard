# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-15 04:35:49`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-typing-off-plain-f1; identity = c2a5c3cb78220f948c7aad5c1a2c3b92
- `2026-10-15 04:36:28`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 04:36:55`  **shutdown** — C:\data, 62 db files — CLEAN
