# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 07:25:38`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-clicks\final-s; identity = 820537491c193a5c5a13593f5f124a8e
- `2026-10-07 07:26:28`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 07:28:24`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 07:33:40`  **shutdown** — C:\data, 62 db files — CLEAN
