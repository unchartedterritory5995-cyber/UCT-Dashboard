# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-29 18:24:59`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10r1d; identity = 84d1d2ebcfa05f918bd5df6ef8768094
- `2026-09-29 18:26:54`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 18:28:48`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 18:29:01`  **shutdown** — C:\data, 62 db files — CLEAN
