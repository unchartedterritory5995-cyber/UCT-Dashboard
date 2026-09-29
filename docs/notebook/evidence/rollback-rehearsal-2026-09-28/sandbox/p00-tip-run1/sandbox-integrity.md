# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 16:40:14`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10rb; identity = 74ab9269391188c5fafd89b2e8163ec9
- `2026-09-28 16:40:58`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 16:42:51`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 16:42:58`  **shutdown** — C:\data, 62 db files — CLEAN
