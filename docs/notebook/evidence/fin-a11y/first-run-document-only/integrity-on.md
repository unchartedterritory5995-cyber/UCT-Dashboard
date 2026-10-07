# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 07:03:49`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-a11y; identity = 1b3f89835396344eb7115ac81fa04271
- `2026-10-07 07:04:31`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 07:06:24`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 07:08:11`  **shutdown** — C:\data, 62 db files — CLEAN
