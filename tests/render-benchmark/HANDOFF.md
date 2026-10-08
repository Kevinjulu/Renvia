# Handoff: render fidelity investigation (resume here)

Last updated: 2026-10-08. **Resume: 2026-10-09** (start with section 5, step 1: review the Phase 4 results). Nothing in this investigation has changed production routing, pricing, credits, database schema, Studio settings or refund logic. All work lives in `tests/render-benchmark/` and is **not yet committed**.

## 1. The product goal

Renvia should behave like an architectural visualisation tool. A user uploads an elevation (the design) and a reference image. The render must keep the elevation's geometry, massing, roof, openings and camera, and borrow only the reference's colours, textures and finishes. Nothing that exists only in the reference (columns, extra rooms, a different building type) may appear. Edit-tab behaviour must keep working. Four elevations of one project should share one material specification.

## 2. What the investigation found (short)

| Topic | Finding | Evidence |
| --- | --- | --- |
| Strict mode | Has had **no technical enforcement** since commit `0220c0e` (Canny route removed, Oct 5), yet still bills 2 credits and the docs still describe Canny. | `apps/api/src/lib/models.ts`, `docs/strict-source-fidelity.md` |
| FLUX 3 edit (production references route) | No seed, strength or structure control. | fal API page |
| Long Strict prompt | Keeps geometry well but can suppress photorealism and finish transfer. A short prompt (AL) fixed realism. | Round 1/2/3 |
| Automatic structure extraction | Stable but **not accurate**: reported 15 fins (true 10) with "high" confidence, twice. Cheap model reports zero uncertainty. | Phase 3 |
| Verifier (model) | Catches large failures, noisy on small ones; **uncalibrated**. | Phase 3 |
| No single winner | AL and BA2 each passed 5/7 on the model gate; their failures barely overlap. The "6/7 best-of-two" is an oracle number, not evidence the verifier can choose. | REPORT.md |
| White to cream | Text colour instructions did not fix it; the reference image carried white better. | Phase 3 |
| Measured end-to-end latency | "8x faster" applies to the render step only; end to end is about 1-2.5x. | REPORT.md section 6 |

Full detail: [REPORT.md](REPORT.md). Spend so far across all rounds: about $4 of fal credit (estimates; fal does not return billed cost, reconcile on the dashboard).

## 3. Where Phase 4 (swatch boards) stands

**Question:** do visual material swatches improve Kontext colour/texture fidelity without leaking reference architecture?

Built:
- `swatches.mjs`: builds shape-free swatch boards from the real reference (homogeneous crops, no strong edges, measured chip colours, vector labels, duplicate and object-fragment rejection).
- `phase4.mjs`: variants BA2n (text spec, fixed lighting), SW0 (control: multi-image endpoint, source only), SW1 (source + unlabelled board), SW2 (labelled board), SW3 (labelled board + text + structure inventory). Same seed 12345, same guidance 5, same fixed lighting and landscape in all.
- `metrics.mjs`: CIEDE2000 (verified against published test values), SAM-masked wall colour with lighting normalisation (lit half of masked pixels, shadows ignored), chromatic-only dE00, b* shift for cream drift.
- Endpoint: `fal-ai/flux-pro/kontext/multi` (experimental, max 2 images, $0.04, supports seed). It is a **different endpoint** from production's Kontext Pro, hence the SW0 control.

State: the live run was executed with a $2.40 cap. Results are in `results/phase4-*/phase4.json` and `report.html` (the newest folder that contains `phase4.json`). **The images have not yet been reviewed by me, and no conclusion has been written.**

Preliminary numbers (wall colour error vs reference, lower is better, from the run log; not yet checked against images):
- BM-04: BA2n 14.6, SW0 14.6, SW1 28.0, SW2 30.2, SW3 16.0
- BM-05: BA2n 10.8, SW0 8.7, SW1 34.2, SW2 27.4, SW3 9.4
- BM-06: BA2n 14.3, SW0 13.5, SW1 10.1, SW2 14.2

Reading so far: swatch-only variants (SW1, SW2) look **worse** on wall colour than the text baseline in several cases; SW3 (swatches plus text and inventory) is close to baseline. SW1 on BM-05 was flagged by the model verifier as adding brick cladding and changing the roof (a possible leakage signal that must be checked by eye). If this holds, swatches alone do not help and the plan's fallback applies: targeted colour correction or material-region compositing rather than more prompt rewriting. **Do not state this as a result until the images and `phase4.json` are reviewed.**

## 4. How to resume tomorrow

```powershell
# 1. look at the Phase 4 report (newest phase4-* folder that has phase4.json)
#    tests/render-benchmark/results/phase4-<timestamp>/report.html

# 2. rebuild the blind calibration pack so Phase 4 renders are included
node tests/render-benchmark/calibration/pack.mjs --count 30

# 3. free checks any time
node tests/render-benchmark/run.mjs --selftest
node tests/render-benchmark/phase4.mjs --boards          # builds swatch boards only, no spend
```

Paid scripts always need `--live` and a cap: `run.mjs`, `phase3.mjs`, `phase4.mjs`. They read `FAL_KEY` from the environment or `apps/api/.dev.vars` and never print it. Requires Node 24 (runs the `.ts` prompt/model builders directly).

## 5. Next steps, in order

1. **Review Phase 4** (`report.html` and `phase4.json`): view every case; separate *measured* results from *model-verifier* claims; write the Phase 4 section of `REPORT.md`. Specific questions:
   - Did swatches improve white (BM-02, BM-04, BM-05, BM-07) without adding reference shapes?
   - Is the SW1/SW2 deterioration real, or a lighting/segmentation artefact? BM-01's reference is a dusk photo, so its measured "white" carries a blue cast.
   - Is SW0 (endpoint control) equal to BA2n? If not, the endpoint, not the swatch, explains differences.
2. **Human calibration**: give `results/calibration-pack/` (without `key.json`) to two annotators; follow `CALIBRATION_PROTOCOL.md`; score with `calibration/score.mjs`. Needed before any automatic reject/retry/refund.
3. **If swatches fail:** test targeted colour correction (sample the SAM wall region, shift towards the measured reference colour) and material-region compositing.
4. **Consensus extraction** (two models; unconfirmed elements become "unknown" and are surfaced for user edit) and a **larger corpus** (at least 15 sources including real flat CAD elevations).
5. Only after the above: design the migration (see REPORT.md section 10).
6. **Independent of the experiments:** fix the Strict honesty problem (label, price, `docs/strict-source-fidelity.md`). That is a product decision for you.

## 6. Decisions still open (yours)

- Do we fix the Strict label/price now, or wait for the investigation?
- Who annotates the 30-render calibration set (two annotators plus an adjudicator)?
- Budget for the next rounds (so far about $1 per round, Phase 4 closer to $2).
- Whether lighting should be a user setting defaulting to neutral daylight (current evidence says yes).

## 7. Cautions

- Do not declare BP, BA2 or AL a production winner. No approach has met both architectural fidelity and material accuracy on a human-validated set.
- Never pass numeric counts above 3 from automatic extraction to a renderer.
- Model verifier output is experimental. Report human observations and verifier judgements separately.
- Known composer bugs were fixed (contradictory "never add" lists, roof recolouring, 3,000+ character prompts), but prompts are still long.
- `results/` (images, analysis cache, calibration pack) is git-ignored by design.

## 8. File map

| File | Purpose |
| --- | --- |
| `README.md` | Round 1/2 runner usage |
| `REPORT.md` | Evidence, recommendation, migration plan with acceptance criteria (through Phase 3) |
| `HANDOFF.md` | This file |
| `manifest.json`, `cases3.json` | The 7 benchmark cases |
| `run.mjs` | Round 1/2 (approaches A, B, C1, C2, CIP, AL, BP, CP) |
| `phase3.mjs`, `vision.mjs`, `schemas.mjs`, `compose.mjs` | Automatic structure/material analysis, prompt composition, verifier |
| `swatches.mjs`, `phase4.mjs` | Phase 4 swatch experiment |
| `metrics.mjs` | Edge agreement, photo coverage, CIEDE2000, masked wall colour |
| `CALIBRATION_PROTOCOL.md`, `calibration/pack.mjs`, `calibration/score.mjs` | Human calibration set, annotation tool and verifier scoring |
