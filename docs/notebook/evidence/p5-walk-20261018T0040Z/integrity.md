tip under test: 13ee489ef7

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-18 19:38:43`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-p5walk; identity = 3d9214a4f6a4b13ed092f9a917fde5f2
- `2026-10-18 19:39:35`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 19:41:27`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 19:41:35`  **shutdown** — C:\data, 62 db files — CLEAN
