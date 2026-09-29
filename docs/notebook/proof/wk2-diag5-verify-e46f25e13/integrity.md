# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-29 16:42:37`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10wk3b; identity = b192d023a77eec7767656ddd0964e74c
- `2026-09-29 16:44:30`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 16:46:26`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 16:48:55`  **shutdown** — C:\data, 62 db files — CLEAN
