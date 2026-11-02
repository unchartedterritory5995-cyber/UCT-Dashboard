"""Upload a local MP4 through the Desk pipeline's own YouTubeClient (imported by path),
then set the thumbnail. Creds come from env (YT_OAUTH_*), set by the caller.
Usage: python upload.py <mp4> <title_file> <desc_file> <thumb_jpg> <privacy>"""
import importlib.util, json, os, sys, time
mp4, title_f, desc_f, thumb, privacy = sys.argv[1:6]
spec = importlib.util.spec_from_file_location("youtube_client", os.path.join(os.path.dirname(__file__), "thumb", "youtube_client.py"))
yc = importlib.util.module_from_spec(spec); spec.loader.exec_module(yc)
title = open(title_f, encoding="utf-8").read().strip()
desc = open(desc_f, encoding="utf-8").read().strip()
assert len(title) <= 100, f"title too long: {len(title)}"
c = yc.YouTubeClient()
t0 = time.time()
vid = c.upload(mp4, title, description=desc, privacy=privacy)
print(f"UPLOADED id={vid} in {time.time()-t0:.0f}s")
try:
    c.set_thumbnail(vid, open(thumb, "rb").read()); print("THUMBNAIL set")
except Exception as e:
    print(f"THUMBNAIL FAILED (non-fatal): {e}")
json.dump({"youtube_id": vid, "title": title}, open("upload_result.json", "w"))
