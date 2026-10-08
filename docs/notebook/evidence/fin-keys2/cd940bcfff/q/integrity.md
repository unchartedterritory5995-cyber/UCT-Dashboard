# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 14:32:37`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-clicks\keys4-q; identity = c453fdaff1b7af26f4fa8b1ff4ac3f09
- `2026-10-07 14:33:12`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 14:35:04`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 15:00:52`  **shutdown** — C:\data, 62 db files — CLEAN
