tip under test: 27d6289b75 (configuration verifygrip)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-09 17:38:50`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-verify-grip\verifygrip; identity = fccedbcc13088e41326671492e913d6e
- `2026-10-09 17:39:20`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-09 17:41:10`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-09 17:44:41`  **shutdown** — C:\data, 62 db files — CLEAN
