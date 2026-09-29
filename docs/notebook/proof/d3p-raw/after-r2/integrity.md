# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-29 00:50:34`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10d3p; identity = fc8f6f25ddcfb251e690b8349f37baf7
- `2026-09-29 00:51:35`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 00:53:29`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 00:59:09`  **shutdown** — C:\data, 62 db files — CLEAN
