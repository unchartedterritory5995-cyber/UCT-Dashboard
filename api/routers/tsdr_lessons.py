"""#tsdr video lessons: the door for transcripts of linked YouTube videos.

YouTube refuses captions to the web pod's address, so a lesson that came from
a YouTube link is first posted as a plain clip under its title. The operator's
own machine can read those captions; `tools/tsdr_link_transcripts.py` lists
the linked videos still missing a transcript here, fetches the captions, and
posts each one back. The next tick rewrites that lesson as a full recap.
Both routes take the PUSH_SECRET bearer and nothing else.
"""
from __future__ import annotations

import hmac
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from api.services import tsdr_lessons

router = APIRouter(prefix="/api/tsdr-lessons", tags=["tsdr-lessons"])


def require_push_secret(request: Request) -> None:
    """The PUSH_SECRET bearer, compared in constant time. A blank or unset
    secret refuses everybody, so `Bearer ` with nothing after it never matches.
    A named Depends, so the route auth census can read it off the route."""
    secret = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("Authorization", "")
    if not secret or not hmac.compare_digest(auth.encode("utf-8", "ignore"),
                                             f"Bearer {secret}".encode("utf-8", "ignore")):
        raise HTTPException(status_code=401, detail="Unauthorized")


class LinkTranscript(BaseModel):
    video_id: str
    transcript: str


@router.get("/links-needing-transcript", dependencies=[Depends(require_push_secret)])
def links_needing_transcript():
    # A plain `def`: it reads SQLite, so it runs on the threadpool, not the loop.
    return {"videos": tsdr_lessons.links_needing_transcript()}


@router.post("/link-transcript", dependencies=[Depends(require_push_secret)])
def link_transcript(body: LinkTranscript):
    result = tsdr_lessons.store_link_transcript(body.video_id, body.transcript)
    if result == "unknown":
        raise HTTPException(status_code=404, detail="no lesson for that video")
    return {"result": result}
