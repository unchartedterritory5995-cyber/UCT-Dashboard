# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 19:31:39`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10l3; identity = 7dc59ba77bb2022542371a47fd7f5531
- `2026-09-28 19:32:24`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 19:34:20`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 19:41:00`  **shutdown** — C:\data, 62 db files — CLEAN
