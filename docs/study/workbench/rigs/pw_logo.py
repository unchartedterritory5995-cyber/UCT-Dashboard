import time
from playwright.sync_api import sync_playwright
OUT = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\show"
with sync_playwright() as p:
    b = p.chromium.launch(); page = b.new_context(viewport={"width": 1366, "height": 960}, device_scale_factor=2).new_page()
    page.goto("http://127.0.0.1:5232/lab.html?piece=52", wait_until="load"); time.sleep(5)
    page.locator("[class*=coinStage]").first.screenshot(path=OUT + r"\logo_stage.png")
    b.close()
print("ok")
