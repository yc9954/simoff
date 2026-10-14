# Offline API · app

The storyboard's screens as a working app on top of the simulator. One Python process (stdlib HTTP, no framework) serves the screens and the JSON they read.

```bash
pip install -r requirements.txt
python app/server.py                 # http://localhost:8790 (PORT overrides)
OPENAI_API_KEY=... python app/server.py   # optional: brief structuring + live persona answers (OPENAI_MODEL, default gpt-5-mini)
```

The first start loads the decision table (2M rows) and fits or loads the models (`data/engines.pkl`), about 5 s once cached, then runs one full plan run in the background. Results that cost more than a second (catalog counts, store maps, layouts, runs) are cached in `app/cache/` (not committed).

| Screen | Route | What runs |
|---|---|---|
| 결정 브리프 | `POST /api/brief` | one line → plans + metric; OpenAI when the key is set, rules otherwise. Plans are only conditions the data saw |
| 엔드포인트 | `/api/catalog`, `/api/replay` | event counts over the whole year from the parquet files; one real visit replayed as events |
| 매장 월드 | `/api/world` | store map (`spacemap.build_map`) in 3D + the households that visited in weeks 48–53. Walking figures are a representation, there is no path data |
| 엔진 비교 | `/api/household`, `/api/persona` | calibrated / no-promo / average-lift models live; persona and Jev are the stored evaluation answers; persona live with OpenAI |
| 결정 안 · 실행 | `/api/plans`, `POST /api/run` | 4 plans × every held-out visit (438,325 decisions), same customers and same random numbers for every plan; ~3 s after the first run. 실행 shows the storyboard's three engines; the two baselines (평소대로 예측, 평균 효과) sit folded underneath |
| 검증 | `/api/validation` | `results/validation.json` + `eval/results` |
| 최종 배치 | `/api/layout` | optimizer under the store's display capacity, same-luck ledger, store-level check against real sales |
| 리포트 | `/api/report` | report numbers; partner inputs (experiment weeks, weekly visits) stay in the browser |
| 매장 연결 | `POST /api/connect`, `/api/job`, `/api/sample` | CSV text → column mapping → `cycle.py --data` in the background → report + 3D layout. "예시 파일" exports store 367 as a POS file |

Jev runs only from stored answers: this build has no Jev key. Everything labelled 지금 계산 is computed on request; 저장된 평가 marks the stored ones.

## Front end

No build step. `static/index.html` is the shell (the storyboard's sidebar); `static/app.js` routes on the hash (`#brief`, `#layout?store=367`, …).

- **Screens are the storyboard boards' own markup.** `static/screens/<id>.html` is each board's `<main>` copied as-is. `app.js` fetches the template and fills three kinds of hook: `data-k` (one value), `data-slot` (a list or block regenerated from data) and `img[data-shot]` (a live 3D render of the store, see below). To change a screen's look, edit its template; to change its numbers, edit its `VIEWS.<id>` function.
- **Styles.** `static/kit.css` is the union of the boards' `<style>` blocks; `static/app.css` is only what the app adds (shell, tooltip, loading states, phone layout under 760px). Fonts are in `static/fonts/`.
- **Shader backgrounds.** `static/vendor/obolus-fx.js` is the storyboard's own Obolus bundle (React + three shaders, no network calls), loaded lazily for any `[data-fx]` element.
- **3D store.** `static/store3d.js` on three.js 0.180 (`static/vendor/three/`, ESM, MIT). The shopper (walk / browse / reach / pay animations) and checkout-terminal models in `static/assets/` come from gs2500, the same team's Blender work. The store is a meter-scale template — department gondolas, a cooler wall at the back, glass storefront, four checkouts, a flyer stand at the entrance — and only the aisles, department weights, display slots and cereal positions come from data; the data has no floor plan. Views: `store`, `cereal` (close-up), `plan` (top-down), `follow` (one shopper), `card`. `snapshots()` renders the card images off-screen once per page load (about 10 s the first time, cached afterwards).
