# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-15 03:10:32`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-typing-off-plain-q2; identity = 990b72e35acf07e04c55602848d2ae5a
- `2026-10-15 03:11:12`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 03:11:33`  **shutdown** — C:\data, 62 db files — CLEAN
