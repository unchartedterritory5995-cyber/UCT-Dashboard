# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 12:57:26`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-clicks\stall-tip1; identity = 6b7d86e289050dab9db3a74486bde748
- `2026-10-07 12:58:03`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 12:59:54`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 13:02:47`  **shutdown** — C:\data, 62 db files — CLEAN
