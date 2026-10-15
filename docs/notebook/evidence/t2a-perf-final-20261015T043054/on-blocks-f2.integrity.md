# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-15 04:46:56`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-typing-on-blocks-f2; identity = 338c564aeaf5bbb18d53cceca64a2e9f
- `2026-10-15 04:47:35`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 04:48:15`  **shutdown** — C:\data, 62 db files — CLEAN
