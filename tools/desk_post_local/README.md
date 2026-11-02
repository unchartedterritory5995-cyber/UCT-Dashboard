# desk_post_local — post a NON-Zoom (locally recorded) video through the Desk pipeline

Proven 2026-09-24 on video 368 / YouTube 5ySAzv4fJKI. Untracked scratch tools; the
pipeline modules are imported BY PATH from a `thumb/` folder exported from origin/master:
    git show origin/master:api/services/{desk_thumbnail,desk_creative,youtube_client}.py
    + api/services/desk_assets/* into thumb/desk_assets/

1. transcribe.py   ffmpeg -> audio16k.wav -> faster_whisper small/int8 (~250s for 10 min)
2. write title.txt, chapters.json [{t,title}], description_body.txt; compose description with
   desk_daily_session._chapters_block + _LINKS_FOOTER (exec'd from the source, no api.* import)
3. cover.py        desk_creative.render_cover with EXPLICIT ctx (this_sessions_* facts) — stubs
                   api.services.engine (_get_anthropic_client/_anthropic_text/_parse_json_block)
4. upload.py       YouTubeClient.upload(path,title,desc,privacy) + set_thumbnail; keys via
                   `railway variables --service web --json` set inline in PowerShell
5. Desk record     POST /api/education/videos needs an ADMIN SESSION (Chrome) — by-youtube
                   returns 200 {"video":null} for unknown ids, never 404
6. insights        POST /videos/{id}/insights-store (PUSH_SECRET) with transcript in the stored
                   "[h:mm:ss] text" block form + chapters/headline/summary/ticker_moments,
                   then POST /videos/{id}/generate-poster
