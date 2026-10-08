# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 12:24:36`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-clicks\keys2-q6; identity = 2e923208da153672ba2fe52a09ebdb64
- `2026-10-07 12:25:11`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 12:27:03`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 12:28:04`  **shutdown** — C:\data, 62 db files — CLEAN
