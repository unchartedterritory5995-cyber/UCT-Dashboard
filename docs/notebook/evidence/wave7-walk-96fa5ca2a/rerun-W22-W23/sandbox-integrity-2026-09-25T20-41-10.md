# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-25 20:41:15`  **pre-boot (baseline)** — C:\data, 61 db files — CLEAN
    - sandbox = C:\data-w7walk; identity = ad18ed757b7606f4b62e3a60b192463b
- `2026-09-25 20:41:52`  **post-boot (+15s)** — C:\data, 61 db files — CLEAN
- `2026-09-25 20:43:41`  **post-prewarm (+120s)** — C:\data, 61 db files — CLEAN
- `2026-09-25 20:44:42`  **shutdown** — C:\data, 61 db files — CLEAN
