"""The README's moving picture: the real store from the landing chat, turning, with shoppers walking.

  python3 docs/spin_gif.py [http://localhost:8790]     # needs ffmpeg; writes docs/img/store-spin.gif
"""
import json
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8790').rstrip('/')
OUT = Path(__file__).resolve().parent / 'img' / 'store-spin.gif'
plans = json.loads(urllib.request.urlopen(f'{BASE}/api/plans').read())
chat = {'turns': [{'user': "We're opening a 20,000 sq ft neighborhood supermarket.", 'reply': 'Built from a real supermarket (Store 367).',
                   'artifacts': [{'type': 'mart', 'store': '367', 'plans': plans, 'business': 'supermarket'}]}]}
tmp = Path(tempfile.mkdtemp())
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    page = b.new_page(viewport={'width': 1280, 'height': 860}, device_scale_factor=1)
    page.add_init_script(f"sessionStorage.setItem('oa:chat', {json.dumps(json.dumps(chat))})")
    page.goto(f'{BASE}/#start')
    page.wait_for_selector('.msg.ai [data-slot="space"] canvas', timeout=60_000)
    time.sleep(4)
    stage = page.locator('.msg.ai [data-slot="space"]').first
    stage.scroll_into_view_if_needed()
    time.sleep(1)
    for i in range(80):                        # 10 s at 8 fps
        stage.screenshot(path=str(tmp / f'f{i:03d}.png'))
        time.sleep(0.125)
    b.close()
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '8', '-i', str(tmp / 'f%03d.png'),
                '-vf', 'scale=760:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
                '-loop', '0', str(OUT)], check=True)
shutil.rmtree(tmp)
print(OUT, OUT.stat().st_size // 1024, 'KB')
