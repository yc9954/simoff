# SimOff · app

**Decision model for offline world simulation.** Any place people walk through — a shop, a pop-up, an event, an exhibition — is raised in 3D, filled with people, and the decision model calibrated on that place's own records tests a change before the doors open. The supermarket cereal case below is one worked example, not the product's scope.

## 시작 (the entry screen)

`#start`: the person describes the business in a line (plus area and, optionally, record files). `world.py` runs five visible steps, all on rules, with a language model only reading the description when a key works (Anthropic → OpenAI → Gemini, each failure falls through):

1. **업종 이해** — business words, area (㎡ or 평), what they worry about (계산 줄 · 좌석 · 행사 진열 · 포토존 · 주문). No match → it asks for a category instead of guessing.
2. **맵 추천** — three of the 27 archetype spaces from the private `yc9954/consumer-jev` repo (white-model GLB, metric `space.json`), scored on business words, same family, area and the features asked for; each card says why.
3. **맵 맞추기** — fixture-level edits only: add a station to a counter, duplicate a seat / photo zone / counter into the nearest free spot on a 0.5 m grid, mark the display nearest the entrance as the promo slot. Every edit is checked against the floor outline, the space's minimum aisle, other fixtures and the door apron; what fails is reported, not applied.
4. **사람 배치** — visitors from area × a per-family density (stated as an assumption), walking a 0.5 m A* grid from the main door to weighted booth access points and the checkout.
5. **시험할 결정** — questions the space can test, each with its metric and the records it needs. Numbers come only from a model calibrated on that place's records; without them the screen links to the calibrated example.

`static/space3d.js` loads the GLB, applies the edits to the real nodes (GLB `userData` keeps fixture id, kind, booth, role), and shows labels and a hover card (after 21st.dev's contribution-skyline: the object lifts, gets an outline, and a dark card rides it; click pins, Esc clears). The 27 spaces are **not committed** (this repo is public, consumer-jev is private): `app/fetch_spaces.sh` pulls them into `static/spaces/` for anyone with access.

## The worked example (마트 시리얼)

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
- **Gradients.** Every decorative surface (brief hero, endpoint cards, engine cards, the dark stat cards on 검증 and 리포트, the 매장 연결 card and panel) uses one class, `.grad` in `app.css`: the endpoint card's mint · lavender · blue gradient with its blurred white flow as an inline SVG. Add `.ink` and white text on it turns dark, except inside `.glass-dark`.
- **3D store.** `static/store3d.js` on three.js 0.180 (`static/vendor/three/`, ESM, MIT). The shopper (walk / browse / reach / pay animations) and checkout-terminal models in `static/assets/` come from gs2500, the same team's Blender work. The store is a meter-scale template — department gondolas, a cooler wall at the back, glass storefront, four checkouts, a flyer stand at the entrance — and only the aisles, department weights, display slots and cereal positions come from data; the data has no floor plan. Views: `store`, `cereal` (close-up), `plan` (top-down), `follow` (one shopper), `card`. `snapshots()` renders the card images off-screen once per page load (about 10 s the first time, cached afterwards).
