import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))
from vercel_handler import make  # noqa: E402
import decide_chat  # noqa: E402

class handler(make(lambda b: decide_chat.chat(b.get('history') or []))):
    pass
