# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-15 04:42:17`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-typing-off-plain-f2; identity = ae322c0416a680d2c3f78cc53fdc1c16
- `2026-10-15 04:42:56`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 04:43:37`  **shutdown** — C:\data, 62 db files — CLEAN
