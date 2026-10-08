# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 07:17:04`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-a11y; identity = 4178f542b93ef492325e7e4a12ee505b
- `2026-10-07 07:17:46`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 07:19:41`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 07:21:25`  **shutdown** — C:\data, 62 db files — CLEAN
