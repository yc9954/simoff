"""Shared POST handler for the serverless functions: JSON in, JSON out, the same shapes as the local server."""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))


def _clip(history):     # a public demo: keep each request small
    return [{'role': h.get('role'), 'text': str(h.get('text') or '')[:2000]} for h in (history or [])[-12:] if h.get('role') in ('user', 'assistant')]


def make(fn):
    class handler(BaseHTTPRequestHandler):
        def do_POST(self):
            try:
                n = int(self.headers.get('content-length') or 0)
                if n > 200_000:
                    raise ValueError('request too large')
                body = json.loads(self.rfile.read(n) or b'{}')
                if 'history' in body:
                    body['history'] = _clip(body['history'])
                out, code = fn(body), 200
            except KeyError as e:
                out, code = {'error': f'not found: {e}'}, 404
            except Exception as e:  # noqa: BLE001
                out, code = {'error': str(e)[:300]}, 500
            data = json.dumps(out, ensure_ascii=False, default=float).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)
    return handler
