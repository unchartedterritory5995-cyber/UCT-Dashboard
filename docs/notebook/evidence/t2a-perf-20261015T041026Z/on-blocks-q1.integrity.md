# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-15 03:16:10`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-typing-on-blocks-q1; identity = 91e32d1da2837f1d0bcb9ca6aba04152
- `2026-10-15 03:16:52`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 03:17:15`  **shutdown** — C:\data, 62 db files — CLEAN
