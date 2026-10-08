# Human calibration protocol for the render fidelity verifier

Purpose: find out whether the experimental model verifier (and any future automatic gate) agrees with trained human judgement closely enough to drive rejection, retry or refund decisions. **Until this protocol has been completed and passed, no automated verdict may reject, retry or refund a customer render.** Model verifier output is a hypothesis under test, never ground truth.

## 1. What is being calibrated

The checks in `vision.mjs` (`verifyFidelity`): roof kept, camera kept, elements added, photorealism, plus the derived "would reject" decision. Colour is calibrated separately against the deterministic CIEDE2000 wall measurement.

## 2. Materials

`node tests/render-benchmark/calibration/pack.mjs` builds `results/calibration-pack/`:

- 30 unique renders plus 10 repeats (shown again under new blind ids) = 40 items.
- Stratified across all cases and approaches; every approach appears at least once.
- Annotators see `annotate.html`, `images/`, `sources/`, `refs/` only. **`key.json` stays private** (it maps blind ids to approach and holds the verifier's judgement). Approach names, model names and prompts must never be shown.

## 3. Annotators

- Two independent annotators, each with architectural or building-visualisation experience. They must not discuss items before both have exported.
- One adjudicator (a third person, or the two annotators together once both exports are saved).
- Annotators record their id; the export file is `annotations-<id>.json`.

## 4. Annotation instructions

Judge every render against the SOURCE drawing (the design) and the REFERENCE (finishes only). Work in a calibrated, neutral-lit screen at 100% zoom where needed. Decide each field independently before the verdict.

| Field | Rule |
| --- | --- |
| Roof | `changed` if the roof form, ridge/edge line, overhang or pitch differs from the source. Roof *colour* is not structure. |
| Camera | `changed` if the viewpoint, framing or perspective differs materially (more than a modest crop). |
| Openings wrong (count) | Count windows, doors, glazed walls that are moved, merged, missing, resized or of a different type. A new opening counts here **and** in "added". |
| Added architectural elements (count + text) | Count architectural elements absent from the source: porch, columns, balcony, chimney, dormer, pitched roof, extra window, carport. **Do not count** landscape, sky, furniture, vehicles, plants or lighting fixtures. |
| Guardrail | `kept` only if the type matches (glass panels stay glass; thin rails stay thin rails). `not applicable` if the source has none. |
| Photograph | `yes` only if it reads as a photograph of a real building. A coloured line drawing, a flat diagram or a clearly synthetic illustration is `no`. |
| Wall colour vs reference | Compare the paint colour of the main walls, ignoring shadows and the colour of the light. `same`, `slightly off`, `clearly off`. Also name both wall colours (white / off-white / cream-beige / grey / other); this directly records white-to-cream drift. |
| Materials on right surfaces | Walls, window frames, doors and cladding each carry the reference's matching finish. |
| Verdict | `accept` = you would hand it to an architect as a faithful render of the source. `reject` otherwise. |
| Confidence | 1 unsure, 2 fairly sure, 3 certain. Annotate unsure items anyway; do not skip. |

Ambiguity rules: when two readings are plausible, choose the stricter one and record 1 in confidence. Never infer what a model "intended". If the source is too low-resolution to decide, write "source unclear" in notes and choose `kept`.

## 5. Disagreement handling

1. Compute agreement with `score.mjs annotations-A.json annotations-B.json`.
2. Any item where the two annotators differ on a failure check is listed for adjudication.
3. The adjudicator reviews the item with both labels and notes visible, decides, and writes the final label with a one-line reason. Reasons are kept; recurring reasons trigger a wording fix in section 4 and a re-annotation of the affected field.
4. If kappa for a check is below 0.70, that check is not used to calibrate anything until its instructions are clarified and the affected items re-labelled.
5. The adjudicated file is saved as `final.json` (same format as an annotation export) and is the ground truth for scoring.

## 6. Acceptance criteria

All criteria are measured on the adjudicated labels. Positive class = failure present.

| Criterion | Threshold |
| --- | --- |
| Inter-annotator kappa on roof, camera, added elements, photograph, verdict | >= 0.70 each |
| Intra-annotator consistency on the 10 repeats | >= 9/10 identical verdicts |
| Verifier recall on roof changed, camera changed, added elements, not-photographic | >= 0.90 each |
| Verifier false-alarm rate on the same checks | <= 0.15 each |
| Verifier "would reject" recall / false-alarm | >= 0.90 / <= 0.15 |
| Colour: share of renders where CIEDE2000 chromatic wall error <= 6 agrees with the human "same / slightly off" judgement | >= 85% |

A pass on 30 renders only justifies running a larger set (at least 100 renders, at least 15 distinct sources); it does not justify release. Confidence intervals on 30 items are wide and must be reported.

## 7. Outputs

- `final.json` (adjudicated labels) and the disagreement log with reasons.
- The `score.mjs` table and kappa values.
- A short note listing any systematic verifier blind spots found (for example, small elements in dark renders).

## 8. Hygiene

- The pack and all exports are git-ignored; do not commit renders or labels without review of file size and content.
- Re-run `pack.mjs` with a different `--seed` for a second, independent set when the generator, prompt or model changes.
