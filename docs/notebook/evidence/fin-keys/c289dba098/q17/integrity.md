# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 08:57:43`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-clicks\keys-q17; identity = 26ab3d883d1d3f26ee2834591b0b581d
- `2026-10-07 08:58:21`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 09:00:15`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 09:04:00`  **shutdown** — C:\data, 62 db files — CLEAN
