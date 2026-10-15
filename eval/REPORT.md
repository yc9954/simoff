# SimOff · first measured evaluation

2026-10-11 · dunnhumby Complete Journey (84.51°) · top 25 cold-cereal products

## One-line conclusion

**The calibrated decision model predicted real purchases in weeks it had never seen. The persona agents inflated purchase probability 14–192×, and Jev used without training inflated it 40–256×; both saw the endcap effect as smaller than the actual range.**
Jev got the probability level wrong, but among the language-model engines it got the ranking of "who is more likely to buy" most right. The point of this result is that calibration comes not from the model but from that domain's data.
Of the three success criteria set in advance, two were clearly passed; the third (picking the top plan) was passed by every engine, so it did not separate the engines.

## What was done

| Item | Detail |
|---|---|
| Data | 2,469 households · 1 year · 1,469,307 transaction lines · 20,940,529 display/flyer records (per the R package documentation, real transactions from the 84.51° Customer Journey study) |
| Unit | 1 store visit × 1 cereal product → did that visit buy that product (1,996,300 rows) |
| Conditions (what the store did) | A front endcap (display code 3) · B flyer only · C secondary display · as usual |
| Time split | Weeks 1–26: used only to compute household state · weeks 27–44 training · weeks 45–47 calibration · **weeks 48–53 test (never seen by the model)** · plus a three-window validation adding test windows at weeks 36–41 and 42–47 |
| Engines | ① Calibrated decision model (gradient boosting + isotonic calibration) ② As-usual prediction (no condition information) ③ Average lift (product base purchase rate × overall average lift) ④ Persona agents (OpenAI gpt-6.1-sol, codex CLI) — demographics only / demographics + purchase history |
| Persona sample | 80 household-product pairs with household information × 4 conditions = 320 questions each (the basic version has 312 because one batch failed) |

## Result 1 · Predicting individual purchases in unseen weeks

Test window weeks 48–53 · 438,325 rows · 684 actual purchases

| Engine | Log loss ↓ | AUC ↑ | Calibration error (ECE) ↓ | Mean prediction / actual |
|---|---|---|---|---|
| **Calibrated model** | **0.01050** | **0.781** | **0.00027** | 0.141% / 0.156% |
| As-usual prediction | 0.01132 | 0.699 | 0.00041 | 0.138% / 0.156% |
| Average lift | 0.01138 | 0.655 | 0.00041 | 0.194% / 0.156% |

In all three test windows the calibrated model had lower log loss and higher AUC than both baselines (AUC 0.801 / 0.805 / 0.781).

Calibration curve (test window, by predicted-probability bin · %):

| Predicted | 0.015 | 0.034 | 0.038 | 0.048 | 0.071 | 0.12 | 0.21 | 0.90 |
|---|---|---|---|---|---|---|---|---|
| Actual | 0.021 | 0.062 | 0.082 | 0.069 | 0.099 | 0.13 | 0.25 | 0.84 |

It under-predicts slightly in the low bins, but the order of predictions matches the order of actuals.

## Result 2 · Decision effects (the most important question)

Displays are not random (stores display a product when it is selling well). So the actual effect was estimated by **comparing stores that displayed and stores that did not, within the same product and the same week**. Pooled over the three test windows; 95% range by product-week bootstrap.

| Condition | Actual effect | 95% range | Calibrated model | Average lift | As usual | Persona basic | Persona + history |
|---|---|---|---|---|---|---|---|
| A front endcap | **3.99×** | 2.48 – 8.56 | 2.52× ✅ | 5.61× ✅ | 1.00 ❌ | 1.51× ❌ | 1.93× ❌ |
| C secondary display | **1.64×** | 1.23 – 2.40 | 2.25× ✅ | 3.03× ❌ | 1.00 ❌ | 1.37× ✅ | 1.55× ✅ |
| B flyer only | Cannot be determined | — | 1.61× | 1.84× | 1.00 | 1.35× | 1.53× |

- **Only the calibrated model** lands within range on both conditions.
- Flyers run chain-wide in the same week, so there are no same-week control stores. The flyer effect cannot be validated with this data.
- The calibrated model sees the endcap effect as lower than actual (2.5 vs 4.0). It is within range, but close to the lower bound.
- On the 80 persona pairs, the calibrated model's effects were 2.98× for the endcap (within range) and 2.95× for secondary display (**out of range, overestimated**). The sample is small, so these numbers are unstable.

## Result 3 · Persona agents

| | Actual | Calibrated model | Persona basic | Persona + history |
|---|---|---|---|---|
| Purchase probability under the as-usual condition | 0.108% | 0.091% | **20.7%** (192×) | 1.5% (14×) |
| 1,000 real test visits of the 80 pairs → predicted purchases | **1** | 0.87 | **209** | 13 |
| Spread across households (coefficient of variation, as-usual condition) | — | 1.42 | 0.55 | 0.84 |
| Rank correlation with actual purchase history | — | 0.27 | 0.19 | 0.11 |
| Endcap effect | 3.99× | 2.98× | 1.51× | 1.93× |

How to read it:
1. **They do not know the level.** Asked "would you buy this product on this shopping trip", the personas answered around 20%. The actual rate is 0.1%. Running the simulation as-is would inflate sales nearly 200×. Even with purchase history given as numbers, it is 14×.
2. **They flatten the differences between conditions.** Endcap, flyer and secondary display all converge on a similar "buys a bit more" (1.4–1.9×). They underestimated the actual endcap effect (4×) to outside the range. The user's hypothesis, "regression toward the predictable answer", was confirmed in this form.
3. **The differences between people are narrow.** Under the same condition, the spread of per-household probabilities is much smaller than the calibrated model's (0.55 vs 1.42). This points the same way as the "narrow spread" of Bisbee et al. (2024).
4. Conversely, there are things the personas got right. The secondary-display effect was within range, and they got the ranking of conditions (endcap > secondary display) right.

## Result 4 · Jev (TypeSafe, jev-1.13.0, without training)

The public documentation has no endpoint for training on user data, so it was tested without training. The same 80 pairs × 4 conditions, one state per request, probability of a yes/no (`noul`) question. 640 calls, 0 failures.

- **Jev·text**: the same demographic description as the personas, as the state
- **Jev·state**: numeric state computed from the endpoint (visits over 26 weeks, share of visits that bought cereal, times this product was bought, product base purchase rate, etc.) as JSON

| | Actual | Calibrated model | Jev·state | Jev·text | Persona | Persona+history |
|---|---|---|---|---|---|---|
| Purchase probability under the as-usual condition | 0.108% | 0.091% | 4.3% (40×) | 27.7% (256×) | 20.7% (192×) | 1.5% (14×) |
| 1,000 real visits → predicted purchases (actual: 1) | | 0.87 | 44 | 265 | 209 | 13 |
| Endcap effect (actual 3.99, 2.48–8.56) | | 2.98 ✓ | 1.25 ✗ | 0.86 ✗ wrong direction | 1.51 ✗ | 1.93 ✗ |
| Secondary-display effect (actual 1.64, 1.23–2.40) | | 2.95 ✗ | 1.25 ✓ | 1.01 ✗ | 1.37 ✓ | 1.55 ✓ |
| Spread across households (coefficient of variation) | | 1.42 | 0.54 | 0.52 | 0.55 | 0.84 |
| Rank correlation with purchase history | | 0.27 | **0.31** | 0.11 | 0.19 | 0.11 |

(The calibrated-model effects in this table are on the 80 pairs. On the full test window they are 2.52 / 2.25, from Result 2.)

How to read it:
1. Jev's RLCD calibration is confidence-accuracy agreement on the tasks Jev was trained on. It did not carry over to the purchase rate of this store's shoppers. Given the numeric state it overestimated 40×; given text, 256×.
2. Jev outputs probabilities in steps of 0.01 (observed minimum 0.03). A rare event such as 0.1% cannot be expressed at all.
3. On the other hand, Jev given the numeric state ranked households best (0.31). **Using Jev as the ranking engine and calibrating its probabilities on our data** is the candidate for the next experiment. This time there were only 320 labelled rows (1 actual purchase), so a calibration layer could not be trained.
4. Jev given the demographics as text answered that people buy *less* on an endcap (0.86×).

## Result 5 · Jev + calibration on store data (case-control sample, 6,497 calls, about $0.13)

Question: if Jev (numeric state) does the ranking and only the probabilities are calibrated on actual purchases from weeks 45–47 (isotonic regression), does it predict as well as the calibrated model?

Sample: for calibration, all 313 actual purchases in weeks 45–47 + 1,500 non-purchases / for test, all 684 actual purchases in weeks 48–53 + 750 non-purchases per condition. Non-purchases were reweighted back to their original proportion for evaluation.

| Engine | Log loss ↓ | AUC ↑ | Calibration error ↓ | Mean prediction (actual 0.156%) | Endcap effect (actual 3.99, 2.48–8.56) |
|---|---|---|---|---|---|
| Jev as-is | 0.0644 | 0.714 | 0.0567 | 5.83% | 1.35 ✗ |
| Jev + store-data calibration | 0.0135 | 0.714 | 0.0013 | 0.156% | 2.24 ✗ (just below the lower bound) |
| Calibrated model | **0.0103** | **0.784** | **0.0006** | 0.125% | 2.52 ✓ |
| As-usual prediction | 0.0112 | 0.700 | 0.0006 | 0.130% | 1.00 ✗ |

How to read it:
1. **Calibrating on store data removed Jev's level error.** Mean prediction went from 5.83% to exactly 0.156%, and log loss from 0.064 to 0.0135. This directly shows that calibration to the rates of human behaviour comes from the data, not from the model.
2. **Even so, the model trained from scratch on the endpoint data is better.** Calibration does not change the ranking, so AUC stays at 0.714 (calibrated model 0.784). Log loss is worse even than the as-usual prediction, which ignores conditions (0.0112).
3. Jev ranking best on the 80 pairs (0.31) was a small-sample result. On the full test sample the calibrated model's ranking is more accurate.
4. On per-condition levels, Jev+calibration was closer to actual than the calibrated model (0.36%, 0.30%) for the endcap (0.48% vs actual 0.68%) and secondary display (0.38% vs 0.41%). For flyers (0.16% vs 0.35%), however, both are low.
5. The top bin of the isotonic calibration (Jev 0.32 or higher → nearly 100%) is overfitted to a handful of cases in the calibration sample. A real service would need to merge bins or use logistic calibration.

Summary: **Jev, calibrated by RLCD, was not calibrated to human purchase rates either. Adding one layer on store data fixes the level, but the ranking and effect sizes that decide between plans are more accurate from a model trained on the endpoint data.**

## Result 6 · Von: RLCD training of an open-weight decision model on this store's data (2026-10-14)

Question: Jev could not be trained. If the decision model has published weights, does training it on this store's receipts with the RLCD objective get the ranking and effect sizes right as well?

- **Model:** [Von](https://github.com/wfzyx/von) 1.3 (395M, ModernBERT encoder, Apache-2.0, commit `9319ced`). It has the same format as Jev (state + yes/no question → probability), so the same states and questions were fed in unchanged.
- **"RLCD" in the Von repository:** it is not reinforcement learning. `training/train_rlcd.py` and `train_option_marker.py` do supervised learning with cross-entropy on option probabilities + 0.5 × Brier loss, and fit a single temperature at the end. The same loss was used.
- **Training:** all 2,220 purchases from weeks 27–44 + 4 non-purchases per purchase. All 28 layers; 18 weeks for 2 epochs / 3 weeks (weeks 42–44) for 4 epochs, 3 seeds each. Probabilities were corrected back for the under-sampling of non-purchases with a prior correction (log of the sampling ratio). The checkpoint to keep was chosen by log loss on weeks 45–47 (choosing by accuracy gives "always no" at 99.8%). Modal L40S, 4–10 minutes per experiment, about 45 minutes in total for the 6.
- **Test:** a sample with the same design as Result 5 (684 purchases in weeks 48–53 + 750 non-purchases per condition, actual proportions restored by weights). The endcap effect is the ratio from asking about 500 test rows that were on an endcap twice, once as endcap and once as regular shelf.

| Engine | AUC ↑ | Log loss ↓ | Calibration error ↓ | Mean prediction (actual 0.156%) | Endcap-visit level (actual 0.68%) | Endcap effect |
|---|---|---|---|---|---|---|
| Von as-is | 0.553 | 0.4971 | 0.390 | 39.1% (250×) | 38.9% | 0.99 |
| Von as-is + isotonic calibration | 0.578 | 0.0114 | 0.0024 | 0.144% | 0.13% | 0.99 |
| Jev as-is / + calibration (Result 5) | 0.714 | 0.0644 / 0.0135 | 0.057 / 0.0013 | 5.83% / 0.156% | 6.9% / 0.48% | 1.35 / 2.24 |
| **Von + RLCD training · 18 weeks** (3 seeds) | **0.774–0.791** (mean 0.785) | 0.0107–0.0109 | 0.0003–0.0010 | 0.145–0.186% | **0.46–0.79%** (mean 0.62%) | 4.6–5.8 |
| Calibrated model · 18 weeks (simulator) | 0.777 | **0.0104** | 0.0009 | 0.127% | 0.36% | 4.35 |
| Von + RLCD training · 3 weeks (3 seeds) | 0.755–0.774 | 0.0109–0.0111 | 0.0005–0.0006 | 0.108–0.116% | 0.15–0.33% | 1.7 / 2.0 / 4.6 |
| Calibrated model · 3 weeks | 0.765 | 0.0107 | 0.0006 | 0.125% | 0.18% | 1.83 |

Actual endcap effect: 3.99× pooled over three windows (2.48–8.56), 3.18× for weeks 48–53 only (1.91–15.70).

How to read it:
1. **Before training, Von was unusable on this task.** It answered a purchase probability of 39% (250× actual), its ranking was nearly random (AUC 0.553), and it did not respond to the endcap (0.99×). It is worse than Jev. Adding isotonic calibration only fixes the level; everything else stays the same.
2. **RLCD training of the same model on this store's data turned it into a decision model.** Ranking is on the same level as the calibrated model (seed mean 0.785 vs 0.777, seeds within 0.02 of each other), and the probability level was right from training alone (calibration error 0.001 or lower, with no separate calibration layer). Its endcap effect of 4.6–5.8× is within the actual range.
3. **On per-condition levels, the trained Von is closer to actual.** The probability of a sale on visits that were on an endcap is 0.68% actual, 0.62% Von mean, 0.36% calibrated model. This fills exactly the weakness the simulator showed in validation (it saw sales on endcap visits as low: expected 79 against an actual 133). For flyers too: Von 0.19–0.24% vs calibrated model 0.14% (actual 0.35%).
4. **On log loss the calibrated model is still better** (0.0104 vs 0.0107–0.0109). Boosting captures overall probability precision better; Von captures the level differences between display conditions better.
5. **With only three weeks of labels, Von had no advantage.** Its ranking is similar to the calibrated model's, and its endcap effect swung between 1.7 and 4.6× depending on the seed (calibrated model 1.83×). The hypothesis that pretraining makes up for few labels was not confirmed in this experiment.
6. Adding isotonic calibration again on top of the trained Von made some seeds worse (log loss 0.0139). Training already did the calibration, so there is no need to add it.

Summary: **RLCD-style training worked. But the gain did not come from the RLCD calibration the model originally had; it came from training on this store's actual purchases.** Before training, neither Von nor Jev knew the purchase rate of this store's shoppers; the trained Von matched the simulator's calibrated model on ranking and level, and was more accurate on per-display-condition levels. To use it as a simulator engine, the next steps are an ensemble of the two models (boosting's precision + Von's response to conditions) and an evaluation on the full test window (430,000 rows).

Limitations: the test sample is case-control (3,684 rows), so AUC carries a sampling error of about ±0.01. Von was tested with only 3 seeds and a single non-purchase ratio, 1:4. The state is roughly 9 numbers, so there was almost no room for Von's ability to read text to be used.

## Result 7 · Calibrated model + Von on the full test window (2026-10-14)

Result 6 was a case-control sample (3,684 rows). This time the trained Von (18 weeks, 3 seeds) scored **every row in weeks 48–53 (438,325 rows, 684 actual purchases)** and weeks 45–47 (12 Modal L40S machines), and rows that were on display were asked once more as regular shelf to measure the effect size. Von's probabilities are averaged over the 3 seeds.

| Engine | AUC ↑ | Log loss ↓ | Calibration error ↓ | Expected sales (actual 684) | Endcap (actual 133) | Flyer (actual 48) | Secondary display (actual 88) | As usual (actual 415) | Endcap effect | Secondary-display effect |
|---|---|---|---|---|---|---|---|---|---|---|
| Calibrated model | 0.774 | 0.01056 | 0.00032 | 616 | 79 | 20 | 69 | 448 | 4.51 | 2.70 |
| Von (RLCD-trained, seed mean) | 0.785 | 0.01062 | 0.00053 | 726 | 119 | 32 | 86 | 489 | 5.41 | 3.21 |
| Combined · fitted on weeks 45–47 | 0.785 | 0.01055 | 0.00035 | 614 | 78 | 20 | 68 | 447 | 4.48 | 2.69 |
| Combined · simple logit average | 0.795 | 0.01044 | 0.00034 | 608 | 86 | 23 | 69 | 429 | 4.79 | 2.95 |
| Combined · cross-fitted on the test window | 0.794 | 0.01042 | 0.00029 | 702 | 95 | 26 | 78 | 502 | 4.63 | 2.87 |

Actual effects in the same period (same product, same week comparison): endcap 3.18× (1.91–15.70), secondary display 2.27× (1.55–3.60). Flyer cannot be determined because there are no same-week control stores.

How to read it:
1. **What the sample showed held on the full data.** Von is better than the calibrated model on ranking (AUC 0.785 vs 0.774) and on per-display-condition levels (sales on endcap visits 119 vs 79, actual 133); the calibrated model is better on probability precision (log loss) and on the as-usual level. Von sees the as-usual condition as high and overestimates the total by 6%.
2. **The combination fitted on weeks 45–47 was not fair.** Those are the weeks the calibrated model used for its isotonic calibration, so the calibrated model looks perfect there, and the weights tilted to 0.98 on the calibrated model and 0.01 on Von.
3. **Simply averaging the logits, without fitting, beats both.** AUC 0.795 and log loss 0.01044, better than either model alone. The combination cross-fitted on two halves of the test window is at the same level (0.794 / 0.01042), and is closest to actual on the total (701 / 684) and on the endcap level (95 / 133).
4. **Every engine sees effect sizes as larger than actual** (endcap 4.5–5.4× vs actual 3.18×, though all within the 95% range). The actual effect for this period alone came out lower than the three-period pooled value (3.99×).

Summary: **The calibrated model and Von are good at different things. Averaging the two beats any single model on this data.** As a simulator engine, the logit average is the simplest and needs no data to fit. The remaining problem is the compute Von needs to be asked again for every plan inside the simulator (438K rows × 4 plans, about 15 minutes on GPU), so the right way to put it in the simulator is to pre-score the per-plan probabilities.

## Success criteria set in advance

| Criterion | Result |
|---|---|
| 1. The calibrated model is more accurate than the as-usual prediction | ✅ Ahead on log loss and AUC in all three windows; on decision effects the as-usual prediction is out of range |
| 2. The calibrated model is more accurate than the personas | ✅ Level (0.84× vs 14–192×), predicted purchases (0.87 vs 13–209, actual 1), endcap effect (in range vs out of range) |
| 3. Picks the actual top plan as top | ✅ However, every engine except the as-usual prediction got it right, so it does not distinguish the engines |

## Limitations (state these first in a presentation)

- **The flyer effect could not be validated.** There is no same-week control group.
- **Discounts were left out of the conditions.** The discount amount appears only on the receipts of people who bought, so the price on visits that did not buy is unknown.
- **Even the within-product, within-week comparison is incomplete as causal estimation.** The criteria a store uses to choose display placement (store size, neighbourhood) remain. This is one reason the endcap range is wide (2.5–8.6).
- **The persona sample is small.** 80 pairs × 4 conditions, 1 actual purchase. Level comparisons were made against the actual purchase rate over the full test window (380,000 rows).
- **The personas were asked in batches of 8 at a time.** This was for cost. The batching may have made the answers resemble each other.
- **Jev was tested only without training.** A training endpoint is not in the documentation. Because the sample was 80 pairs, the experiment of putting a calibration layer on top of Jev has not been done yet.
- The data is from a single US supermarket chain, labelled 2017. There is not yet any basis for generalising to Korean stores.

## How to re-run

In order, under `scripts/`: `build.py` → `model_eval.py` → `robust.py` → `persona.py` (requires a codex CLI login) → `jev.py` (TypeSafe key in `.jev_key` in the working folder) → `persona_eval.py`. Result JSON goes to `results/`.

Result 6 (Von) runs on top of `sim/data/rows.parquet`. In a virtual environment with `von-sdk` installed: `scripts/von_zeroshot.py` (local, about 6 minutes on Apple silicon), `modal run scripts/von_modal.py` (6 runs of `von_finetune.py` in parallel on Modal GPUs, about 10 minutes), `python3 scripts/gbdt_weeks.py 42 44` (3-week calibrated-model baseline). Result 7: `modal run scripts/von_modal.py --mode train` → `--mode score` → `python3 scripts/von_ensemble.py`. Von's official training script was not used because by default it uploads results to someone else's S3 bucket (`von_finetune.py` implements the same loss directly).
