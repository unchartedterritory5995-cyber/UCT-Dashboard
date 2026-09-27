# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 19:28:47`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10c; identity = 6fc93e0b301655d4571eacc1000bcf66
- `2026-09-26 19:29:31`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 19:31:23`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 19:31:32`  **shutdown** — C:\data, 62 db files — CLEAN
