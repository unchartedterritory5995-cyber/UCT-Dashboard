# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 09:07:01`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-clicks\keys-q17b; identity = ba2fb028d1ce3134d73ef6d1ad1963b3
- `2026-10-07 09:07:44`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 09:09:38`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 09:10:44`  **shutdown** — C:\data, 62 db files — CLEAN
