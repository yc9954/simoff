"""Run the Von experiments on Modal GPUs; results land in sim/eval/results.

The container gets the decision table (data/rows.parquet, products.parquet), sim.py and these scripts; Von is
installed from its repo at the commit tested locally. Von's weights are cached in one Modal volume and the
fine-tuned checkpoints are kept in another, so scoring can run after training without retraining.

  modal run sim/eval/scripts/von_modal.py --mode grid    # 18 vs 3 weeks x 3 seeds, sample evaluation (result 6)
  modal run sim/eval/scripts/von_modal.py --mode train   # 18 weeks x 3 seeds, checkpoints kept in the volume
  modal run sim/eval/scripts/von_modal.py --mode probe   # scoring speed on 20,000 rows
  modal run sim/eval/scripts/von_modal.py --mode score   # every weeks 45-53 row (+ shelf counterfactuals), 3 seeds
  modal run sim/eval/scripts/von_modal.py --mode smoke   # 20 training steps: checks the pipeline
"""
import json
from pathlib import Path

import modal

HERE = Path(__file__).resolve().parent
SIM = HERE.parents[1] if modal.is_local() else Path('/root/sim')  # inside the container this file sits at /root
VON_COMMIT = '9319ced'
SEEDS = (0, 1, 2)

image = (modal.Image.debian_slim(python_version='3.12')
         .apt_install('git')
         .pip_install(f'von-sdk @ git+https://github.com/wfzyx/von@{VON_COMMIT}', 'pandas==2.3.3', 'numpy==2.4.4',
                      'scikit-learn==1.8.0', 'scipy', 'pyarrow', 'huggingface_hub')
         .env({'HF_HOME': '/hf', 'VON_DEVICE': 'cuda', 'VON_NOUL_DECISION': 'raw', 'VON_FT_DIR': '/ckpt'})
         .add_local_file(SIM / 'sim.py', '/root/sim/sim.py')
         .add_local_file(SIM / 'data' / 'rows.parquet', '/root/sim/data/rows.parquet')
         .add_local_file(SIM / 'data' / 'products.parquet', '/root/sim/data/products.parquet')
         .add_local_file(HERE / 'von_common.py', '/root/sim/eval/scripts/von_common.py')
         .add_local_file(HERE / 'von_finetune.py', '/root/sim/eval/scripts/von_finetune.py')
         .add_local_file(HERE / 'von_score.py', '/root/sim/eval/scripts/von_score.py'))
hf = modal.Volume.from_name('von-hf-cache', create_if_missing=True)
ckpt = modal.Volume.from_name('von-ft-ckpt', create_if_missing=True)
app = modal.App('offline-api-von-ft', image=image)
SCRIPTS = '/root/sim/eval/scripts'


@app.function(gpu='L40S', volumes={'/hf': hf, '/ckpt': ckpt}, timeout=2 * 3600)
def finetune(tag: str, cli: list[str]) -> dict:
    import subprocess
    res_dir = Path('/root/sim/eval/results'); res_dir.mkdir(parents=True, exist_ok=True)
    p = subprocess.run(['python', 'von_finetune.py', '--tag', tag, *cli], cwd=SCRIPTS, capture_output=True, text=True)
    hf.commit(); ckpt.commit()
    log = (p.stdout + p.stderr)[-6000:]
    if p.returncode:
        return {'tag': tag, 'error': log}
    return {'tag': tag, 'log': log, 'results': (res_dir / f'von_ft_{tag}_results.json').read_text(),
            'answers': (res_dir / f'von_ft_{tag}_answers.parquet').read_bytes()}


@app.function(gpu='L40S', volumes={'/hf': hf, '/ckpt': ckpt}, timeout=2 * 3600)
def score(tag: str, shard: int, nshards: int, limit: int = 0) -> dict:
    import subprocess
    ckpt.reload()
    out = f'/tmp/{tag}_{shard}.npy'
    p = subprocess.run(['python', 'von_score.py', '--ckpt', f'/ckpt/{tag}/option_marker.pt', '--shard', str(shard), '--nshards', str(nshards),
                        '--limit', str(limit), '--out', out], cwd=SCRIPTS, capture_output=True, text=True)
    hf.commit()
    log = (p.stdout + p.stderr)[-3000:]
    if p.returncode:
        return {'tag': tag, 'shard': shard, 'error': log}
    return {'tag': tag, 'shard': shard, 'log': log, 'logits': Path(out).read_bytes()}


GRID = [(f'{name}_s{seed}', ['--weeks', *w, '--epochs', ep, '--neg-ratio', '4', '--train-layers', '28', '--seed', str(seed)])
        for name, w, ep in [('gpu18w', ('27', '44'), '2'), ('gpu3w', ('42', '44'), '4')] for seed in SEEDS]
TRAIN = [(f'full18_s{seed}', ['--weeks', '27', '44', '--epochs', '2', '--neg-ratio', '4', '--train-layers', '28', '--seed', str(seed)]) for seed in SEEDS]
NSHARDS = 4


@app.local_entrypoint()
def main(mode: str = 'grid'):
    out = SIM / 'eval' / 'results'
    if mode in ('grid', 'train', 'smoke'):
        jobs = {'grid': GRID, 'train': TRAIN,
                'smoke': [('smoke', ['--weeks', '42', '44', '--epochs', '1', '--train-layers', '28', '--max-steps', '20'])]}[mode]
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
        return
    if mode == 'probe':
        r = score.remote('full18_s0', 0, NSHARDS, 20000)
        print(r.get('error') or r['log'])
        return
    if mode == 'score':
        full = out / 'von_full'; full.mkdir(exist_ok=True)
        jobs = [(f'full18_s{seed}', k, NSHARDS) for seed in SEEDS for k in range(NSHARDS)]
        for r in score.starmap(jobs):
            if 'error' in r:
                print(f"== {r['tag']} shard {r['shard']} FAILED\n{r['error']}")
                continue
            (full / f"{r['tag']}_{r['shard']}of{NSHARDS}.npy").write_bytes(r['logits'])
            print(f"== {r['tag']} shard {r['shard']}: {r['log'].strip().splitlines()[-1]}")
