# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 13:32:04`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-clicks\keys3-q; identity = a5a99a409e126fa4261a30d8638ddae4
- `2026-10-07 13:32:45`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 13:34:38`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 14:01:55`  **shutdown** — C:\data, 62 db files — CLEAN
