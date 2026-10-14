"""Offline API server: the screens in static/ and the JSON they read, on one port.

  python app/server.py            # http://localhost:8790  (PORT env overrides; Replit sets it)

Routes (all GET unless noted):
  /api/health                      data loaded? LLM configured?
  /api/catalog                     S1 endpoints and event counts (whole year)
  /api/replay?basket=              S1 one real visit as an event stream
  /api/stores                      stores with display records, busiest first (weeks 48-53)
  /api/world?store=                S2 store map + who visited
  /api/household?id=&product=      S3 one household, every engine, four conditions
  /api/persona?id=&product=        S3 ask the persona engine live (OPENAI_API_KEY)
  /api/plans                       S4 the plans the data can test
  POST /api/brief {question}       S0 one line -> testable decision
  POST /api/run                    S5 every plan x every engine on the held-out weeks
  /api/validation                  S6
  /api/layout?store=               final layout for one store (optimizer + same-luck ledger)
  /api/report                      S7
  POST /api/connect {transactions, products?, placements?}   S8 CSV text -> full cycle in the background
  /api/job?id=                     S8 progress
"""
import json
import math
import mimetypes
import os
import sys
import threading
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import service  # noqa: E402

STATIC = Path(__file__).resolve().parent / 'static'


def _clean(o):
    """NaN and Infinity are not JSON; the browser would refuse the whole response."""
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if hasattr(o, 'item'):
        return _clean(o.item())
    return o


def _json(o):
    return json.dumps(_clean(o), ensure_ascii=False, default=str).encode()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(STATIC), **k)

    def log_message(self, fmt, *args):
        if '/api/' in (args[0] if args else ''):
            sys.stderr.write('%s\n' % (fmt % args))

    def send(self, code, body, ctype='application/json; charset=utf-8'):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def route(self, method):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        body = {}
        if method == 'POST':
            n = int(self.headers.get('Content-Length') or 0)
            body = json.loads(self.rfile.read(n) or b'{}')
        p = u.path
        S = service
        table = {
            ('GET', '/api/health'): lambda: {'ok': True, 'loaded': bool(S._state), 'llm': S.has_openai(), 'model': S.openai_model() if S.has_openai() else None},
            ('GET', '/api/catalog'): S.catalog,
            ('GET', '/api/replay'): lambda: S.replay_basket(q.get('basket')),
            ('GET', '/api/stores'): S.stores,
            ('GET', '/api/world'): lambda: S.world(q.get('store') or S.stores()[0]['store_id']),
            ('GET', '/api/household'): lambda: S.household(q.get('id', '1804'), q.get('product')),
            ('GET', '/api/pairs'): S.stored_pairs,
            ('GET', '/api/persona'): lambda: S.persona_live(q['id'], q['product']),
            ('GET', '/api/plans'): S.plans,
            ('POST', '/api/brief'): lambda: S.brief(body.get('question', '')),
            ('POST', '/api/run'): lambda: S.run_plans(draws=int(body.get('draws', 100)), seed=int(body.get('seed', 42))),
            ('GET', '/api/run/latest'): S.latest_run,
            ('GET', '/api/validation'): S.validation,
            ('GET', '/api/layout'): lambda: S.layout(q.get('store') or S.stores()[0]['store_id'], q.get('objective', 'revenue')),
            ('GET', '/api/report'): S.report,
            ('POST', '/api/connect'): lambda: S.connect({k: (body.get(k) or '').encode() or None for k in ['transactions', 'products', 'placements']}),
            ('GET', '/api/job'): lambda: S.JOBS[q['id']],
            ('GET', '/api/sample'): lambda: S.sample_files(q.get('store', '367')),
        }
        fn = table.get((method, p))
        if fn is None:
            return False
        try:
            self.send(200, _json(fn()))
        except KeyError as e:
            self.send(404, _json({'error': str(e).strip("'")}))
        except Exception as e:
            traceback.print_exc()
            self.send(500, _json({'error': f'{type(e).__name__}: {e}'}))
        return True

    def do_GET(self):
        if self.path.startswith('/api/'):
            if not self.route('GET'):
                self.send(404, _json({'error': 'no such route'}))
            return
        if urlparse(self.path).path in ('', '/'):
            self.path = '/index.html'
        super().do_GET()

    def do_POST(self):
        if not self.route('POST'):
            self.send(404, _json({'error': 'no such route'}))


def main():
    mimetypes.add_type('text/javascript', '.js')
    port = int(os.environ.get('PORT', 8790))
    def warm():                                                      # load data + models while the page opens
        service.state()
        if service.latest_run() is None:
            service.run_plans(draws=100)
    threading.Thread(target=warm, daemon=True).start()
    srv = ThreadingHTTPServer(('0.0.0.0', port), Handler)
    print(f'Offline API on http://localhost:{port}')
    srv.serve_forever()


if __name__ == '__main__':
    main()
