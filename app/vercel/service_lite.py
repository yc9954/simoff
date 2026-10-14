"""The slice of service.py the serverless functions need, without numpy or pandas (copied to lib/service.py at build).

chat.py, decide_chat.py and world.py import `service` for the language-model helpers, the store's plan list and
the single-visit model answer; this module gives them the same names.
"""
import json
from pathlib import Path

import decide_core
from llm import _http_error, _log_usage, has_llm, llm_model, llm_text  # noqa: F401

HERE = Path(__file__).resolve().parent


def plans():
    return json.loads((HERE / 'plans.json').read_text())


def decide(inp):
    return decide_core.decide(inp)


def decide_products():
    return decide_core.product_list()
