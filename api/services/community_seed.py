# api/services/community_seed.py
"""Desk → Community bridge: publish/insights hooks upsert a Mentor Desk thread
per education video. Idempotent by threads.desk_content_id == edu_videos.id.
Best-effort by design — a seeding failure must NEVER break a Desk publish."""
import json

from api.services import community_store


def _tiptap_doc(headline, bullets, youtube_id):
    content = []
    if headline:
        content.append({"type": "paragraph", "content": [
            {"type": "text", "marks": [{"type": "bold"}], "text": str(headline)}]})
    if bullets:
        content.append({"type": "bulletList", "content": [
            {"type": "listItem", "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": str(b)}]}]}
            for b in bullets if str(b).strip()]})
    if youtube_id:
        content.append({"type": "paragraph", "content": [
            {"type": "text",
             "marks": [{"type": "link", "attrs":
                        {"href": f"https://www.youtube.com/watch?v={youtube_id}"}}],
             "text": "Watch the session"}]})
    if not content:
        content = [{"type": "paragraph", "content": [
            {"type": "text", "text": "Recap coming soon — discuss below."}]}]
    return json.dumps({"type": "doc", "content": content})


def upsert_desk_thread(video_id):
    """Create or refresh the Mentor Desk thread for an education video.
    Returns thread id, or None on any failure (never raises)."""
    try:
        from api.services import education_service
        video = education_service.get_video(int(video_id))
        if not video:
            return None
        try:
            ins = education_service.get_insights(int(video_id)) or {}
        except Exception:
            ins = {}
        body = _tiptap_doc(ins.get("headline"), ins.get("summary") or [],
                           video.get("youtube_id"))
        existing = community_store.get_thread_by_desk_id(int(video_id))
        if existing:
            community_store.update_thread(existing["id"],
                                          title=video.get("title") or existing["title"],
                                          body=body)
            return existing["id"]
        return community_store.create_thread(
            "mentor-desk", None, video.get("title") or "Desk Session",
            body=body, desk_content_id=int(video_id))
    except Exception as e:
        print(f"[community-seed] upsert failed for video {video_id} (non-fatal): {e}")
        return None


def seed_for_youtube_id(youtube_id):
    try:
        from api.services import education_service
        row = education_service.get_video_by_youtube_id(youtube_id)
        if not row:
            return None
        return upsert_desk_thread(row["id"])
    except Exception as e:
        print(f"[community-seed] seed_for_youtube_id failed (non-fatal): {e}")
        return None
