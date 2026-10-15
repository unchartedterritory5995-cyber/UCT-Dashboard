# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-14 23:23:52`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-typing-off-plain-r1; identity = df52d7cdf90e5028dc3355d7dab3fcde
- `2026-10-14 23:24:47`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-14 23:26:24`  **shutdown** — C:\data, 62 db files — CLEAN
- `2026-10-14 23:26:40`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
