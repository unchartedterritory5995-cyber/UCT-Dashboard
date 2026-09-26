# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 11:49:10`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w8walk; identity = 21b2c4884b09fb7320cd93d62ced2cfd
- `2026-09-26 11:50:05`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 11:52:03`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 11:54:18`  **shutdown** — C:\data, 62 db files — CLEAN
