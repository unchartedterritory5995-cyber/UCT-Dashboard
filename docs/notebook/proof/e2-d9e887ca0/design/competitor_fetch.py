"""Lane 10E-2 -- the competitor side of the design review (clause 6a), from PUBLIC material only.

Amendment 1 (controller, 2026-09-27): no purchase, no sign-in, no install. Each page below is an
official help-centre page, product page or template gallery, fetched in a real (headless)
Chromium. For each: the URL asked, the URL landed on, the HTTP status, the fetch date, the page
title and first heading, the official product image the page itself publishes (`og:image`, by URL
only -- no third-party image is copied into this repository), and at most three short verbatim
excerpts (<= 13 words each) found by the surface's keywords. Nothing is paraphrased here; the
review that reads this record says which excerpt supports which comparison.

    python competitor_fetch.py <out.jsonl>
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sys

from playwright.sync_api import sync_playwright

PAGES = [
    # (product, surface, url, keywords)
    ("Notion", "sidebar", "https://www.notion.com/help/navigate-with-the-sidebar", ["sidebar", "favorites", "teamspace"]),
    ("Notion", "editor", "https://www.notion.com/help/writing-and-editing-basics", ["block", "/", "drag"]),
    ("Notion", "views", "https://www.notion.com/help/views-filters-and-sorts", ["board", "calendar", "timeline", "table"]),
    ("Notion", "shortcuts", "https://www.notion.com/help/keyboard-shortcuts", ["cmd/ctrl", "search"]),
    ("Notion", "publish", "https://www.notion.com/help/public-pages-and-web-publishing", ["publish", "web", "link"]),
    ("Notion", "templates", "https://www.notion.com/templates", ["template", "notes"]),
    ("Notion", "mobile", "https://www.notion.com/mobile", ["mobile", "phone", "app"]),
    ("Obsidian", "home", "https://obsidian.md/help/", ["notes", "vault"]),
    ("Obsidian", "sidebar", "https://obsidian.md/help/plugins/file-explorer", ["folder", "file explorer"]),
    ("Obsidian", "graph", "https://obsidian.md/help/plugins/graph", ["graph", "notes", "links"]),
    ("Obsidian", "views", "https://obsidian.md/help/bases", ["table", "cards", "view"]),
    ("Obsidian", "templates", "https://obsidian.md/help/plugins/templates", ["template"]),
    ("Obsidian", "publish", "https://obsidian.md/help/publish", ["publish", "site"]),
    ("Obsidian", "product", "https://obsidian.md/", ["notes", "private"]),
    ("Evernote", "templates", "https://evernote.com/templates", ["template"]),
    ("Evernote", "product", "https://evernote.com/", ["notes", "organize"]),
    ("Evernote", "features", "https://evernote.com/features", ["search", "notes", "tasks"]),
]

EXTRACT_JS = r"""(kws) => {
  const og = (document.querySelector('meta[property="og:image"]') || {}).content || null;
  const h1 = (document.querySelector('h1') || {}).textContent || '';
  const text = Array.from(document.querySelectorAll('main p, main li, article p, article li, p, li'))
      .map(e => e.textContent.replace(/\s+/g, ' ').trim()).filter(t => t.length > 25 && t.length < 400);
  const hits = [];
  for (const t of text) {
    const low = t.toLowerCase();
    if (kws.some(k => low.includes(k.toLowerCase())) && !hits.includes(t)) hits.push(t);
    if (hits.length >= 3) break;
  }
  return {og, h1: h1.trim().slice(0, 120), hits, paragraphs: text.length};
}"""


def clip(sentence: str, words: int = 13) -> str:
    w = sentence.split()
    return " ".join(w[:words])


def main() -> int:
    out = sys.argv[1]
    today = dt.date.today().isoformat()
    rows = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1280, "height": 900}, locale="en-US")
        for product, surface, url, kws in PAGES:
            pg = ctx.new_page()
            row = {"product": product, "surface": surface, "url": url, "fetched": today,
                   "via": "Playwright headless Chromium, no sign-in (lane 10E-2)"}
            try:
                resp = pg.goto(url, wait_until="domcontentloaded", timeout=45000)
                pg.wait_for_timeout(2500)
                row["status"] = resp.status if resp else None
                row["final_url"] = pg.url
                row["title"] = pg.title()[:140]
                ex = pg.evaluate(EXTRACT_JS, kws)
                row["h1"] = ex["h1"]
                row["og_image_url"] = ex["og"]
                row["quotes"] = [clip(h) for h in ex["hits"]]
                row["paragraphs_seen"] = ex["paragraphs"]
            except Exception as e:  # noqa: BLE001 -- recorded, never hidden
                row["error"] = f"{type(e).__name__}: {str(e)[:160]}"
            rows.append(row)
            print(json.dumps({k: row.get(k) for k in ("product", "surface", "status", "title", "error")}), flush=True)
            pg.close()
        b.close()
    with open(out, "w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
