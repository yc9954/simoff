"""Language-model helpers with the standard library only: which model answers, one text call, usage log, readable errors.

Shared by the local server (service.py re-exports them) and the serverless functions, which cannot import pandas.
"""
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path


USAGE_LOG = Path(__file__).resolve().parent / 'cache' / 'llm_usage.jsonl'


def llm_model():
    """The model that answers: Claude when ANTHROPIC_API_KEY is set (app/.env), otherwise OpenAI."""
    if os.environ.get('ANTHROPIC_API_KEY'):
        return os.environ.get('ANTHROPIC_MODEL', 'claude-sonnet-5-5')
    return os.environ.get('OPENAI_MODEL', 'gpt-5-mini')


def has_llm():
    return bool(os.environ.get('ANTHROPIC_API_KEY') or os.environ.get('OPENAI_API_KEY'))


def _log_usage(provider, model, purpose, inp, out):
    """One line per call, so spend can be added up later: app/cache/llm_usage.jsonl."""
    try:
        USAGE_LOG.parent.mkdir(exist_ok=True)
        with open(USAGE_LOG, 'a') as f:
            f.write(json.dumps({'at': time.strftime('%Y-%m-%d %H:%M:%S'), 'provider': provider, 'model': model, 'purpose': purpose,
                                'input_tokens': inp, 'output_tokens': out}) + '\n')
    except OSError:
        pass


def _http_error(who, e):
    try:
        err = json.loads(e.read()).get('error') or {}
    except Exception:
        err = {}
    # OpenAI's 429 is either a spent balance or a rate limit; only the body says which
    return RuntimeError(f"{who} HTTP {e.code} {err.get('code') or err.get('type') or ''}: {(err.get('message') or e.reason)[:160]}".strip())


def llm_text(prompt, json_mode=False, system=None, purpose='app'):
    """Claude first (ANTHROPIC_API_KEY), OpenAI otherwise. json_mode asks for a bare JSON object and returns its text."""
    if not has_llm():
        raise RuntimeError('no language model key (ANTHROPIC_API_KEY or OPENAI_API_KEY)')
    if os.environ.get('ANTHROPIC_API_KEY'):
        model = llm_model()
        body = {'model': model, 'max_tokens': 1024,
                'messages': [{'role': 'user', 'content': prompt + ('\n\nReturn one JSON object only, no prose, no code fence.' if json_mode else '')}]}
        if system:
            body['system'] = system
        req = urllib.request.Request('https://api.anthropic.com/v1/messages', data=json.dumps(body).encode(),
                                     headers={'x-api-key': os.environ['ANTHROPIC_API_KEY'], 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                d = json.loads(r.read())
        except urllib.error.HTTPError as e:
            raise _http_error('Claude', e) from None
        u = d.get('usage') or {}
        _log_usage('anthropic', model, purpose, u.get('input_tokens'), u.get('output_tokens'))
        txt = ''.join(c.get('text', '') for c in d.get('content', []) if c.get('type') == 'text')
        if json_mode:
            m = re.search(r'\{.*\}', txt, re.S)
            txt = m.group(0) if m else txt
        return txt
    model = llm_model()
    body = {'model': model, 'messages': ([{'role': 'system', 'content': system}] if system else []) + [{'role': 'user', 'content': prompt}]}
    if json_mode:
        body['response_format'] = {'type': 'json_object'}
    req = urllib.request.Request(os.environ.get('OPENAI_BASE_URL', 'https://api.openai.com/v1') + '/chat/completions', data=json.dumps(body).encode(),
                                 headers={'Authorization': f"Bearer {os.environ['OPENAI_API_KEY']}", 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            d = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise _http_error('OpenAI', e) from None
    u = d.get('usage') or {}
    _log_usage('openai', model, purpose, u.get('prompt_tokens'), u.get('completion_tokens'))
    return d['choices'][0]['message']['content']
