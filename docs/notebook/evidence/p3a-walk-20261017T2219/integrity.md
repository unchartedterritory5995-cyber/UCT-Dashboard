tip under test: d63309c05d3c239aaf81842d0d89153710d5e2f2

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-17 22:19:47`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-p3awalk-r3; identity = 81d7cbad4ab1f1b6b74ffe5997df89a4
- `2026-10-17 22:20:20`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-17 22:22:12`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-17 22:24:08`  **shutdown** — C:\data, 62 db files — CLEAN
