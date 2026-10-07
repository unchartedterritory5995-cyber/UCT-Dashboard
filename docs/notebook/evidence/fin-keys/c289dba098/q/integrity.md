# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 08:24:48`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-clicks\keys-q; identity = d0fec5ee03fbeec740825802f5264c52
- `2026-10-07 08:25:37`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 08:27:29`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 08:56:54`  **shutdown** — C:\data, 62 db files — CLEAN
