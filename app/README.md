# SimOff · app

**Decision model for offline world simulation.** Any place people walk through — a shop, a pop-up, an event, an exhibition — is raised in 3D, filled with people, and the decision model calibrated on that place's own records tests a change before the doors open. The supermarket cereal case below is one worked example, not the product's scope.

## Build the space (the entry screen)

`#start`: the person describes the business in a line (plus area and, optionally, record files). `world.py` runs five visible steps, all on rules, with a language model only reading the description when a key works (Anthropic → OpenAI → Gemini, each failure falls through):

1. **Read the business** — business words, area (㎡ or pyeong), what they worry about (checkout lines · seating · promo displays · photo zones · ordering). No match → it asks for a category instead of guessing.
2. **Suggest a space** — three of the 27 archetype spaces from the private `yc9954/consumer-jev` repo (white-model GLB, metric `space.json`), scored on business words, same family, area and the features asked for; each card says why.
3. **Fit the space** — fixture-level edits only: add a station to a counter, duplicate a seat / photo zone / counter into the nearest free spot on a 0.5 m grid, mark the display nearest the entrance as the promo slot. Every edit is checked against the floor outline, the space's minimum aisle, other fixtures and the door apron; what fails is reported, not applied.
4. **Add people** — visitors from area × a per-family density (stated as an assumption), walking a 0.5 m A* grid from the main door to weighted booth access points and the checkout.
5. **Decisions to test** — questions the space can test, each with its metric and the records it needs. Numbers come only from a model calibrated on that place's records; without them the screen links to the calibrated example.

`static/space3d.js` loads the GLB, applies the edits to the real nodes (GLB `userData` keeps fixture id, kind, booth, role), and shows labels and a hover card (after 21st.dev's contribution-skyline: the object lifts, gets an outline, and a dark card rides it; click pins, Esc clears). The 27 spaces are **not committed** (this repo is public, consumer-jev is private): `app/fetch_spaces.sh` pulls them into `static/spaces/` for anyone with access.

## The worked example (supermarket cereal)

The storyboard's screens as a working app on top of the simulator. One Python process (stdlib HTTP, no framework) serves the screens and the JSON they read.

```bash
pip install -r requirements.txt
python app/server.py                 # http://localhost:8790 (PORT overrides)
OPENAI_API_KEY=... python app/server.py   # optional: brief structuring + live persona answers (OPENAI_MODEL, default gpt-5-mini)
```

The first start loads the decision table (2M rows) and fits or loads the models (`data/engines.pkl`), about 5 s once cached, then runs one full plan run in the background. Results that cost more than a second (catalog counts, store maps, layouts, runs) are cached in `app/cache/` (not committed).

| Screen | Route | What runs |
|---|---|---|
| Decision brief (legacy screen) | `POST /api/brief` | one line → plans + metric; OpenAI when the key is set, rules otherwise. Plans are only conditions the data saw |
| Endpoints (legacy screen) | `/api/catalog`, `/api/replay` | event counts over the whole year from the parquet files; one real visit replayed as events |
| Store world (legacy screen) | `/api/world` | store map (`spacemap.build_map`) in 3D + the households that visited in weeks 48–53. Walking figures are a representation, there is no path data |
| Engine comparison (legacy screen) | `/api/household`, `/api/persona` | calibrated / no-promo / average-lift models live; persona and Jev are the stored evaluation answers; persona live with OpenAI |
| Plans to test · Run | `/api/plans`, `POST /api/run` | 4 plans × every held-out visit (438,325 decisions), same customers and same random numbers for every plan; ~3 s after the first run. Run shows the storyboard's three engines; the two baselines (as-usual prediction, average lift) sit folded underneath |
| Model check | `/api/validation` | `results/validation.json` + `eval/results` |
| Final layout | `/api/layout` | optimizer under the store's display capacity, same-luck ledger, store-level check against real sales |
| Report | `/api/report` | report numbers; partner inputs (experiment weeks, weekly visits) stay in the browser |
| Connect records | `POST /api/connect`, `/api/job`, `/api/sample` | CSV text → column mapping → `cycle.py --data` in the background → report + 3D layout. "Example file" exports store 367 as a POS file |

Jev runs only from stored answers: this build has no Jev key. Everything labelled "Computed now" is computed on request; "Saved evaluation" marks the stored ones.

## Front end

No build step. `static/index.html` is the shell (the storyboard's sidebar); `static/app.js` routes on the hash (`#brief`, `#layout?store=367`, …).

- **Screens are the storyboard boards' own markup.** `static/screens/<id>.html` is each board's `<main>` copied as-is. `app.js` fetches the template and fills three kinds of hook: `data-k` (one value), `data-slot` (a list or block regenerated from data) and `img[data-shot]` (a live 3D render of the store, see below). To change a screen's look, edit its template; to change its numbers, edit its `VIEWS.<id>` function.
- **Styles.** `static/kit.css` is the union of the boards' `<style>` blocks; `static/app.css` is only what the app adds (shell, tooltip, loading states, phone layout under 760px). Fonts are in `static/fonts/`.
- **Gradients.** Every decorative surface (brief hero (legacy screen), endpoint cards (legacy screen), engine cards (legacy screen), the dark stat cards on Model check and Report, the Connect records card and panel) uses one class, `.grad` in `app.css`: the endpoint card's mint · lavender · blue gradient with its blurred white flow as an inline SVG. Add `.ink` and white text on it turns dark, except inside `.glass-dark`.
- **3D store.** `static/store3d.js` on three.js 0.180 (`static/vendor/three/`, ESM, MIT). The shopper (walk / browse / reach / pay animations) and checkout-terminal models in `static/assets/` come from gs2500, the same team's Blender work. The store is a meter-scale template — department gondolas, a cooler wall at the back, glass storefront, four checkouts, a flyer stand at the entrance — and only the aisles, department weights, display slots and cereal positions come from data; the data has no floor plan. Views: `store`, `cereal` (close-up), `plan` (top-down), `follow` (one shopper), `card`. `snapshots()` renders the card images off-screen once per page load (about 10 s the first time, cached afterwards).
