# the signed-out path: no login, open Blitz and Boss, expect the sign-in card; then sign in from the card and expect the bank
import time, json, re
from playwright.sync_api import sync_playwright
ENV = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\sandbox_env.json"
OUT = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\show"
env = json.load(open(ENV))
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1366, "height": 960}); page = ctx.new_page()
    page.goto("http://127.0.0.1:5232/lab.html?piece=54", wait_until="load"); time.sleep(6)
    txt = page.evaluate("() => document.body.innerText"); print("boss signed out shows:", "Signed out" in txt, "| button:", re.findall(r"(SIGN IN|FACE THE BOSS|LOADING THE BANK)", txt)[:2])
    page.screenshot(path=OUT + r"\pc_0_signedout.png")
    page.fill("input[type=email]", env["EMAIL"]); page.fill("input[type=password]", env["UCT_SANDBOX_PASSWORD"]); page.get_by_role("button", name=re.compile("Sign in")).click(); time.sleep(6)
    txt = page.evaluate("() => document.body.innerText"); print("after sign-in button reads:", re.findall(r"(FACE THE BOSS|LOADING THE BANK|NO CHARTS CAME BACK)", txt)[:1])
    b.close()
