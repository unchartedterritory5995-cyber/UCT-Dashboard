# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-27 20:03:59`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10f5; identity = 6df35cae12b1579da603fbafe1678b99
- `2026-09-27 20:04:37`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-27 20:06:28`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-27 20:28:42`  **shutdown** — C:\data, 62 db files — CLEAN
