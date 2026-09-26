# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 18:45:26`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10b; identity = ec328006fd4bfce6472d519227f7bc14
- `2026-09-26 18:46:10`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 18:48:01`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 18:48:53`  **shutdown** — C:\data, 62 db files — CLEAN
