# Simulator validation · six unseen weeks (weeks 48–53)

17,533 real visits · 2,123 households · 109 stores · 438,325 visit×product decisions · 684 real visits with a sale. Store conditions are kept exactly as they really were; shopper luck is varied with 200 draws. The 90% range captures shopper luck only, not model error.

## 1. Totals · by week

| Engine | Actual | Simulated expectation | 90% range | Actual within range | Weeks within range (of 6) | Store rank correlation | AUC |
|---|---|---|---|---|---|---|---|
| Calibrated model | 684 | 616.7 | 581–657 | ✗ | 3 | 0.71 | 0.781 |
| As-usual prediction | 684 | 606.5 | 560–648 | ✗ | 2 | 0.72 | 0.699 |
| Average lift | 684 | 849.4 | 806–900 | ✗ | 1 | 0.57 | 0.655 |

Calibrated model, by week:

| Week | Visits | Actual | Expected | 90% range |
|---|---|---|---|---|
| 48 | 3,044 | 69 | 103.7 | 87–118 ✗ |
| 49 | 2,858 | 90 | 84.8 | 70–102 ✓ |
| 50 | 2,887 | 166 | 112.2 | 98–130 ✗ |
| 51 | 2,902 | 122 | 108.5 | 92–128 ✓ |
| 52 | 3,321 | 129 | 119.3 | 102–137 ✓ |
| 53 | 2,521 | 108 | 88.2 | 74–104 ✗ |

## 2. By condition (calibrated model)

| Condition | Decisions | Actual | Expected |
|---|---|---|---|
| As usual | 383,847 | 415 | 447.5 |
| Front endcap | 19,483 | 133 | 80.5 |
| Flyer | 13,721 | 48 | 20.9 |
| Secondary display | 21,274 | 88 | 67.8 |

## 3. By household segment (calibrated model)

| Household segment | Decisions | Actual | Expected |
|---|---|---|---|
| Households that have bought this product before | 20,579 | 186 | 213.1 |
| Households that have never bought this product | 417,746 | 498 | 403.6 |
| Frequent cereal buyers (top third) | 146,275 | 393 | 395.5 |
| Infrequent cereal buyers (bottom third) | 146,550 | 100 | 74.2 |
| Discount-sensitive (top third) | 146,525 | 263 | 212.6 |
| Less discount-sensitive (bottom third) | 146,200 | 182 | 177.7 |

## 4. Reproducing the report number

On the 19,483 decisions that really were on a front endcap, simulating with the endcap removed vs. kept, with the same shoppers and the same luck: per 1,000 decisions **0.94 → 3.45** (report: 0.94 → 3.45), ×3.66.

## 5. Effect size · simulator vs. actual (same product, same week, weeks 48–53 only)

| Condition | Actual effect | 95% range | Calibrated model | As-usual prediction | Average lift |
|---|---|---|---|---|---|
| Front endcap | 3.18 | 1.91–15.70 | 3.66 ✓ | 1.00 ✗ | 5.69 ✓ |
| Secondary display | 2.27 | 1.55–3.60 | 2.59 ✓ | 1.00 ✗ | 3.41 ✓ |
| Flyer | — | Cannot be determined | 1.68 ✗ | 1.00 ✗ | 1.89 ✗ |

## Caveats when reading

- The actual-effect range is measured on a single period (weeks 48–53) only, so it can be wider than, or differ from, the report's value pooled over three periods (3.99×, 2.48–8.56).
- Flyers run chain-wide in the same week, so there are almost no same-week control stores. Even when a range comes out, the sample is small.
- The sales count is "the number of visits that bought that product". It is not quantity.
- The 90% range reflects only shopper luck at the same probabilities. The possibility that the model is wrong is checked only by the comparison with actuals above.
