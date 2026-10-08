# Render-fidelity regression pack

This pack protects the rule established by the client feedback: the first image owns the building and the camera; prototype images supply visual treatment only.

## Run before a render comparison

```powershell
pnpm test:render-fixtures
```

The command validates that the source, prototype images and legacy examples are the exact approved files. It does not judge a generated image automatically: architectural structure must still be reviewed by a person.

## Execute every case

For each case in `manifest.json`:

1. Create a fresh Studio project.
2. Upload the manifest source image first, then attach its prototype images in the listed order.
3. Select **Drawing**, attach the references, switch **Source fidelity** to **Strict**, and review the protected source geometry.
4. Paste the recorded prompt and use **Polish prompt**. The preview must not retain any request to change a roof, opening, massing, or camera. Apply it, then run once at **Strong (3)** and once at **Maximum (4)** with fresh seeds.
5. Save each output, returned seed, model route and settings in a dated review folder. Re-run the worst result with its returned seed.

## Review rule

Each structural item under `mustKeep` must pass and every item under `mustNeverAdd` must be absent. Any structural failure fails the case, even if the materials look good. The current model route has a source-first contract but not a deterministic geometry proof; strict mode is therefore an acceptance gate and review record, not a claim that the model is mathematically locked.

The files in `tests/render-fidelity/fixtures/Rendered Results` are historical examples only. They are useful for a before/after comparison but cannot validate the new safeguards until the cases have been re-run against the updated application.

Open `client-comparison.html` for the ready-to-review side-by-side sheet. It intentionally labels historical outputs and leaves the new-output slot pending until the updated deployed application has been tested.
