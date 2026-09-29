# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 17:24:38`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10rb; identity = 15d36e98dbd53e5062fe4320022fbd74
- `2026-09-28 17:25:30`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 17:27:21`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 17:27:28`  **shutdown** — C:\data, 62 db files — CLEAN
