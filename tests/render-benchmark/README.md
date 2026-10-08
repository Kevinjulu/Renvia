# Render benchmark: structure preservation strategies

Decides which rendering strategy enforces source geometry best, **before** the production engine, prompts or credit pricing change. Nothing here modifies product code.

## Approaches compared (same elevation + same reference per case)

| Id | Strategy |
| --- | --- |
| A | Production today: FLUX 3 edit with the reference image (exact production prompt and input builder, Strict mode) |
| B | Kontext Pro, source only, finishes as a text material specification |
| C1 / C2 | FLUX General img2img + Canny EasyControl, strength 0.60 / 0.85, text material specification |
| CIP | Probe: C1 + IP-Adapter carrying the reference. fal may reject it; that is a finding |

B, C1, C2 use a hand-written `materialSpec` from `manifest.json`. That deliberately isolates *"does the renderer hold structure?"* from *"can we extract a good spec from a photo?"*, which is a separate later test.

## Running

```powershell
node tests/render-benchmark/run.mjs --selftest            # free: sanity-check the metrics on saved renders
node tests/render-benchmark/run.mjs                       # free: dry run, prints plan, prompt, estimated cost
node tests/render-benchmark/run.mjs --live --max-usd 2    # PAID: refuses if the estimate exceeds the cap
```

Options: `--cases BM-01,BM-02`, `--approaches A,B,C1`, `--seed 12345`. FAL_KEY comes from the environment or `apps/api/.dev.vars`.

Output goes to `results/<timestamp>/` (git-ignored): images, `run.json` (model, full input, seed, request id, timings, errors, metrics) and `report.html`.

## What is measured

| Criterion | How |
| --- | --- |
| Roof, openings, proportions, no added elements, material accuracy, realism | Human rubric (0/1/2) in `report.html`. This is the authority. |
| Structural signal | `lift`, `recall`, `precision` from `metrics.mjs` (see its header). Ranks approaches; does not prove fidelity. |
| Palette signal | Histogram match against the reference with vegetation and sky excluded. Auxiliary only. |
| Execution time | Wall-clock from submit to completion, plus run time once started. |
| Cost | Registry estimate. **Reconcile against the fal dashboard**; fal does not return billed cost in the result. |

## Decision rule

Choose the cheapest configuration that has no structural rubric failure (roof, openings, proportions, no added elements) on all four cases, including both adverse-reference cases, and whose material accuracy is at least partial. If none qualifies, the next step is the two-stage design, not more prompt wording.

## Known limits

- One seed per approach per case. Re-run the best two with different seeds before deciding.
- A is not seedable (FLUX 3 has no seed input), so it cannot be reproduced.
- Edge metrics are weak on dense hatching and on landscaping added around the building.
