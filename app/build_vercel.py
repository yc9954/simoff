"""Build sim/deploy for Vercel: the static app, every read-only API answer precomputed, and three small Python functions.

The local server needs numpy, pandas, pyarrow and scikit-learn; a serverless function cannot carry them. So:
  - GET endpoints the app reads (catalog, layout, grid, validation, report, ...) are computed here, once, into
    public/static-api/<slug>.json, and app.js reads them when it is not on localhost;
  - the run's "run again" reuses the precomputed grid (per-1,000 numbers do not depend on the seed);
  - connecting the sample records returns the finished calibration job computed here;
  - the two chats and the single-visit model answer run as stdlib-only functions (api/chat, api/decide_chat,
    api/decide) on SimOff-1 exported to JSON (simoff_model.py), with the same JSON shapes as the local server.

  python3 sim/app/build_vercel.py          # then: cd sim/deploy && vercel deploy --prod
"""
import json
import math
import re
import shutil
import sys
import time
from pathlib import Path

APP = Path(__file__).resolve().parent
OUT = APP.parent / 'deploy'
sys.path.insert(0, str(APP))
sys.path.insert(0, str(APP.parent))

LIB = ['world.py', 'chat.py', 'decide_chat.py', 'decision_models.py', 'simoff_model.py', 'decide_core.py', 'llm.py',
       'model.json', 'decide_products.json']


KO_EN = {'앞쪽 엔드캡': 'Front endcap', '기타 진열': 'Secondary display', '전단': 'Flyer', '평소대로': 'As usual', '보정 모델': 'Calibrated model',
         '평소대로 예측': 'As-usual prediction', '평균 효과': 'Average effect', '이 상품을 산 적 있는 가구': 'Households that bought it before',
         '이 상품을 산 적 없는 가구': 'Households that never bought it', '산 적 없는 가구': 'Households that never bought it',
         '시리얼 자주 사는 가구 (상위 1/3)': 'Frequent cereal buyers (top third)', '시리얼 자주 삼 (상위 1/3)': 'Frequent cereal buyers (top third)',
         '시리얼 드물게 사는 가구 (하위 1/3)': 'Rare cereal buyers (bottom third)', '시리얼 드물게 삼 (하위 1/3)': 'Rare cereal buyers (bottom third)',
         '할인 민감 가구 (상위 1/3)': 'Discount-sensitive (top third)', '할인 민감 (상위 1/3)': 'Discount-sensitive (top third)',
         '할인 덜 민감 (하위 1/3)': 'Less discount-sensitive (bottom third)', '제안 배치': 'Proposed layout', '53주 배치 고정': 'Week-53 layout kept'}


def slug(path):          # must match staticPath() in app.js
    return re.sub(r'[^A-Za-z0-9]+', '_', path).strip('_')


def main():
    import decide_core
    import decision_models
    import service as S
    import simoff_model

    link = None
    if (OUT / '.vercel').exists():           # keep the Vercel project link across rebuilds
        link = OUT.parent / '.vercel-link'
        shutil.rmtree(link, ignore_errors=True)
        shutil.move(OUT / '.vercel', link)
    if OUT.exists():
        shutil.rmtree(OUT)
    # static site
    shutil.copytree(APP / 'static', OUT / 'public', ignore=shutil.ignore_patterns('.omc', '.DS_Store', '__pycache__'))
    if link:
        shutil.move(link, OUT / '.vercel')
    # functions and what they import
    (OUT / 'lib' / 'static').mkdir(parents=True)
    for f in LIB:
        shutil.copy(APP / f, OUT / 'lib' / f)
    shutil.copy(APP / 'vercel' / 'service_lite.py', OUT / 'lib' / 'service.py')
    shutil.copy(APP / 'vercel' / 'lib_src' / 'vercel_handler.py', OUT / 'lib' / 'vercel_handler.py')
    (OUT / 'lib' / 'static' / 'spaces').mkdir()
    for f in (APP / 'static' / 'spaces').glob('*.space.json'):
        shutil.copy(f, OUT / 'lib' / 'static' / 'spaces' / f.name)
    shutil.copytree(APP / 'vercel' / 'api', OUT / 'api')
    shutil.copy(APP / 'vercel' / 'vercel.json', OUT / 'vercel.json')
    (OUT / 'requirements.txt').write_text('')
    (OUT / 'lib' / 'plans.json').write_text(json.dumps(S.plans(), ensure_ascii=False))

    # read-only answers
    api = OUT / 'public' / 'static-api'
    api.mkdir()

    def clean(x):                            # JSON has no NaN/Infinity; the local server sends null for them too
        if isinstance(x, float) and not math.isfinite(x):
            return None
        if isinstance(x, dict):
            return {k: clean(v) for k, v in x.items()}
        if isinstance(x, (list, tuple)):
            return [clean(v) for v in x]
        return x

    def put(path, value):
        text = json.dumps(clean(json.loads(json.dumps(value, default=float))), ensure_ascii=False, allow_nan=False)
        for ko, en in KO_EN.items():         # stored evaluation results keep their original Korean labels
            text = text.replace(f'"{ko}"', json.dumps(en))
        (api / f'{slug(path)}.json').write_text(text)
        print(f'  {path}')

    put('health', {'ok': True, 'loaded': True, 'llm': True, 'model': 'claude'})
    put('models', {'models': decision_models.MODELS, 'default': decision_models.DEFAULT})
    put('catalog', S.catalog())
    put('stores', S.stores())
    put('validation', S.validation())
    put('report', S.report())
    put('run/latest', S.latest_run())
    put('decide/products', decide_core.product_list())
    for m in ('simoff_retail', 'jev_raw', 'persona'):
        put(f'grid/latest?model={m}', S.run_grid(m))
    for st in S.stores():
        put(f"layout?store={st['store_id']}", S.layout(st['store_id']))
    sample = S.sample_files('367')
    put('sample?store=367', sample)
    job = S.connect({k: sample[k].encode() for k in ('transactions', 'products', 'placements')})
    while job['status'] in ('running', 'mapping'):
        time.sleep(2)
        job = S.JOBS[job['id']]
    job = {'id': job['id'], 'status': job['status'], 'mapping': job['mapping'], 'layout': job.get('layout'), 'error': None,
           'log': ['Calibrated SimOff-1 on the sample store records']}     # only what the page reads (no local paths, no notebook)
    put('connect', job)
    put(f"job?id={job['id']}", job)
    assert simoff_model.predict([{k: 0 for k in simoff_model.FEATURES}])
    print('built', OUT)


if __name__ == '__main__':
    main()
