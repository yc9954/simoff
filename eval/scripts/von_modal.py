"""Run von_finetune.py on Modal GPUs, several configurations at once; results land in sim/eval/results.

The container gets the decision table (data/rows.parquet, products.parquet), sim.py and these scripts; Von is
installed from its repo at the commit tested locally. Von's weights are cached in a Modal volume so only the
first container downloads them.

  modal run sim/eval/scripts/von_modal.py               # the full grid
  modal run sim/eval/scripts/von_modal.py --smoke       # 20 steps, one config: checks the pipeline
"""
import json
from pathlib import Path

import modal

HERE = Path(__file__).resolve().parent
SIM = HERE.parents[1] if modal.is_local() else Path('/root/sim')  # inside the container this file sits at /root
VON_COMMIT = '9319ced'

image = (modal.Image.debian_slim(python_version='3.12')
         .apt_install('git')
         .pip_install(f'von-sdk @ git+https://github.com/wfzyx/von@{VON_COMMIT}', 'pandas==2.3.3', 'numpy==2.4.4',
                      'scikit-learn==1.8.0', 'scipy', 'pyarrow', 'huggingface_hub')
         .env({'HF_HOME': '/hf', 'VON_DEVICE': 'cuda', 'VON_NOUL_DECISION': 'raw', 'VON_FT_DIR': '/tmp/von-ft'})
         .add_local_file(SIM / 'sim.py', '/root/sim/sim.py')
         .add_local_file(SIM / 'data' / 'rows.parquet', '/root/sim/data/rows.parquet')
         .add_local_file(SIM / 'data' / 'products.parquet', '/root/sim/data/products.parquet')
         .add_local_file(HERE / 'von_common.py', '/root/sim/eval/scripts/von_common.py')
         .add_local_file(HERE / 'von_finetune.py', '/root/sim/eval/scripts/von_finetune.py'))
hf = modal.Volume.from_name('von-hf-cache', create_if_missing=True)
app = modal.App('offline-api-von-ft', image=image)


@app.function(gpu='L40S', volumes={'/hf': hf}, timeout=2 * 3600)
def finetune(tag: str, cli: list[str]) -> dict:
    import subprocess
    res_dir = Path('/root/sim/eval/results'); res_dir.mkdir(parents=True, exist_ok=True)
    p = subprocess.run(['python', 'von_finetune.py', '--tag', tag, *cli], cwd='/root/sim/eval/scripts', capture_output=True, text=True)
    hf.commit()
    log = (p.stdout + p.stderr)[-6000:]
    if p.returncode:
        return {'tag': tag, 'error': log}
    return {'tag': tag, 'log': log, 'results': (res_dir / f'von_ft_{tag}_results.json').read_text(),
            'answers': (res_dir / f'von_ft_{tag}_answers.parquet').read_bytes()}


GRID = [(f'{name}_s{seed}', ['--weeks', *w, '--epochs', ep, '--neg-ratio', '4', '--train-layers', '28', '--seed', str(seed)])
        for name, w, ep in [('gpu18w', ('27', '44'), '2'), ('gpu3w', ('42', '44'), '4')] for seed in (0, 1, 2)]


@app.local_entrypoint()
def main(smoke: bool = False):
    jobs = [('smoke', ['--weeks', '42', '44', '--epochs', '1', '--train-layers', '28', '--max-steps', '20'])] if smoke else GRID
    out = SIM / 'eval' / 'results'
    for r in finetune.starmap(jobs):
        if 'error' in r:
            print(f"== {r['tag']} FAILED\n{r['error']}")
            continue
        (out / f"von_ft_{r['tag']}_results.json").write_text(r['results'])
        (out / f"von_ft_{r['tag']}_answers.parquet").write_bytes(r['answers'])
        e = json.loads(r['results'])
        print(f"== {r['tag']}: kept epoch {e['kept_epoch']} · {e['minutes']} min · "
              + ' · '.join(f"{k} AUC {v['auc']:.3f} LL {v['log_loss']:.5f}" for k, v in e['engines'].items())
              + f" · endcap {e['endcap_lift']['von_ft']:.2f}")
