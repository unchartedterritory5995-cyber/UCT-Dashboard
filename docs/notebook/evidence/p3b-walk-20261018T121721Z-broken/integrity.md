tip under test: 7b521d75a3

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-18 07:17:28`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-p3bwalk-broken; identity = 8bcf92e52e1e0c28c5c92c3596755635
- `2026-10-18 07:18:00`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 07:19:51`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 07:19:58`  **shutdown** — C:\data, 62 db files — CLEAN
