"""Screenshots for the README: walks the app on a running local server and saves docs/img/*.jpg.

  python3 app/server.py &           # or any running copy
  python3 docs/shoot.py [http://localhost:8790]

Two steps call Claude (the landing chat and Try the model), so a key in app/.env makes them real answers.
"""
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8790').rstrip('/')
OUT = Path(__file__).resolve().parent / 'img'
OUT.mkdir(parents=True, exist_ok=True)
W, H = 1440, 900


def save(page, name):
    page.screenshot(path=str(OUT / f'{name}.jpg'), type='jpeg', quality=84)
    print('  ', name)


def goto(page, view, wait=3.5):
    page.evaluate(f"location.hash = '#{view}'")
    time.sleep(wait)


with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'])
    ctx = browser.new_context(viewport={'width': W, 'height': H}, device_scale_factor=2)
    page = ctx.new_page()

    # the landing, with our own case typed in
    page.goto(f'{BASE}/#start')
    time.sleep(3)
    save(page, '01-landing')

    # press Enter: the agent builds the real store
    page.click('[data-act="send"]')
    page.wait_for_selector('.msg.ai [data-slot="space"] canvas', timeout=120_000)
    time.sleep(5)
    page.evaluate("document.querySelector('.msg.ai .body').scrollIntoView({block: 'start'}); scrollBy(0, -90)")
    time.sleep(2)
    save(page, '02-build-the-space')

    # connect the sample records
    goto(page, 'connect')
    page.click('[data-act="sample"]')
    page.wait_for_selector('.cn-job .tag', timeout=180_000)
    time.sleep(3)
    save(page, '03-connect-records')

    goto(page, 'plans', 5)
    save(page, '04-plans-to-test')

    page.evaluate("location.hash = '#run?go=1'")
    page.wait_for_selector('.best-badge', timeout=120_000)
    time.sleep(2.5)
    save(page, '05-run')

    goto(page, 'layout', 6)
    save(page, '06-final-layout')
    goto(page, 'report', 5)
    save(page, '07-report')
    goto(page, 'verify', 4)
    save(page, '08-model-check')

    # Try the model: the first example is typed in
    goto(page, 'try', 3)
    page.click('[data-act="send"]')
    page.wait_for_selector('.pg-big', timeout=240_000)
    time.sleep(2)
    save(page, '09-try-the-model')

    # another business: an archetype space the agent edits
    page2 = browser.new_context(viewport={'width': W, 'height': H}, device_scale_factor=2).new_page()
    page2.goto(f'{BASE}/#start')
    time.sleep(2.5)
    page2.fill('[data-k="ask"]', "I'm opening a 1,200 sq ft café in Brooklyn. Before we open I want to see whether the pickup counter works better by the entrance.")
    page2.click('[data-act="send"]')
    page2.wait_for_selector('.msg.ai [data-slot="space"] canvas', timeout=150_000)
    time.sleep(6)
    page2.evaluate("document.querySelector('.msg.ai [data-slot=\"space\"]').scrollIntoView({block: 'center'})")
    time.sleep(2)
    save(page2, '10-cafe-space')
    browser.close()
