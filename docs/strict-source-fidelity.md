# Strict source fidelity and prompt repair

## Purpose

Renvia uses a source image as the authoritative architectural design and optional reference images as visual-treatment inputs. The system must preserve the source building's geometry and viewpoint while allowing references to influence compatible materials, colours, lighting, planting, and paving.

This document records the implementation delivered in commits `4de75d2`, `74c2485`, `fabf980`, and `1ddd3e9`.

## The source-design contract

For a reference render:

- Image 1 is the source building or elevation. It owns silhouette, footprint, massing, floor count, roof, ridges, eaves, openings, doors, windows, terraces, side elements, camera angle, and framing.
- Later images are style references only. They may supply compatible finishes, colours, lighting, landscape, and paving. They must not supply a building layout, roof shape, perspective, opening pattern, or composition.
- If a requested visual feature conflicts with the source design, the renderer must retain the source and omit the conflicting feature.

The contract is present in `apps/api/src/lib/prompts.ts` and is repeated after the user direction so an enthusiastic free-text prompt cannot override it.

## Prompt repair

### What users see

The Render panel provides **Polish prompt**. With references attached it previews a repaired brief and identifies directions left out because they would redesign the source.

Example:

```text
User: Add a pitched roof and copy the reference house layout. Use warm stone and dusk lighting.
Result: Use warm stone and dusk lighting
Kept out: Add a pitched roof · copy the reference house layout
```

Users may apply the repaired text or dismiss the preview.

### Server enforcement

The preview endpoint is authenticated:

```text
POST /api/renders/repair-prompt
{ "prompt": "...", "sourceLocked": true }
```

It returns:

```ts
interface PromptRepairResponse {
  prompt: string;
  repairs: string[];
  blocked: string[];
}
```

The important protection is server-side: `buildEnginePrompt()` runs `repairReferencePrompt()` for every reference render. A direct API caller, an older Studio client, or a user who does not press **Polish prompt** therefore cannot send a structural redesign request through the reference route.

The deterministic repairer intentionally removes only sentences that ask to add, remove, move, replace, resize, redesign, or copy structural features. It retains non-structural direction such as material, colour, light, landscape, or paving.

## Strict source fidelity mode

### User controls

After a reference image is attached, the Advanced panel exposes **Source fidelity**:

- **Strict** is the default for new reference work.
- **Standard** keeps the source-first prompt contract but uses the normal multi-image reference model.
- In Strict mode the user can mark the protected source features: **Silhouette**, **Roof**, **Openings**, **Massing**, and **Camera**.
- **Review protected source geometry** records the review time. Changing the mode or protected-feature list clears that confirmation.

The selection is stored in `RenderGenerationSettings.fidelity`, so past renders retain the exact source contract that governed them:

```ts
{
  mode: "strict" | "standard",
  protectedFeatures: ["silhouette", "roof", "openings", "massing", "camera"],
  reviewedAt?: string
}
```

## Rendering routes

### Standard reference route

`references` continues to use `blackforestlabs/flux-3/edit-image`:

- source image is first;
- reference images follow;
- prompt expansion is disabled;
- source and references have explicitly different roles in the prompt.

This remains the quality-first fallback for ordinary reference rendering.

### Strict route

`renderRouteFor()` selects the `fidelity` route only when references exist and `fidelity.mode` is `strict`.

The production `fidelity` model is `fal-ai/flux-general/image-to-image`. It uses:

- the source image as the image-to-image base at low denoise (`strength: 0.25`);
- fal EasyControl with `canny` and `image_control_type: "spatial"` against that same source image;
- the first reference image as the separately conditioned `reference_image_url` at `reference_strength: 0.65`;
- a strict source contract and only the user-selected protected features in the prompt.

This makes geometry conditioning and visual-reference conditioning separate inputs instead of competing as a single image instruction. fal documents Canny EasyControl, separate reference-image conditioning, and the image-to-image endpoint at [FLUX General API](https://fal.ai/models/fal-ai/flux-general/api) and [FLUX General image-to-image](https://fal.ai/models/fal-ai/flux-general/image-to-image).

The strict route is priced in the model registry at `$0.075` per generated image because fal bills the endpoint per rounded-up megapixel. A Studio render requests one image. Maintain that conservative estimate when changing size or output count.

### Reference-image limitation in Strict mode

The strict route presently uses the first attached reference for separate conditioning. Additional reference images still inform the source-locked prompt contract, but are not separate image-conditioning inputs in this route. Put the most important material/style reference first.

## Notifications and onboarding

Two lightweight notices expose the feature without permanently covering the workspace:

1. When a user attaches their first reference, the Render panel shows a dismissible, once-per-browser announcement: **New: strict source fidelity**. Browser storage prevents repeated interruption.
2. The side-rail **Start here / Upload elevation** cue is visible for one second on mount, then unmounts. The upload button remains available at all times.

The first announcement is in `RenderTabBody.tsx`; the short upload cue is in `IconRail.tsx`.

## Benchmark and review process

The source-fidelity regression pack lives in [`tests/render-fidelity`](../tests/render-fidelity/README.md).

It contains two adverse-reference cases built around the Lakeside elevation:

- a compatible modern prototype;
- deliberately mismatched pitched-roof prototypes.

Both now prescribe Strict mode and protect silhouette, roof, openings, massing, and camera. Each case defines `mustKeep` and `mustNeverAdd` criteria. A render fails the review if any structural invariant changes, regardless of material quality.

Before a review, run:

```powershell
pnpm test:render-fixtures
```

This verifies the fixture files with SHA-256 checksums. It does **not** grade generated architecture. For each case:

1. Upload the source first and references in manifest order.
2. Select **Drawing**, attach references, select **Strict**, and review protected geometry.
3. Use **Polish prompt** and confirm structural requests are not retained.
4. Generate with Strong and Maximum influence using fresh seeds.
5. Save source, reference order, prompt, model route, settings, returned seed, and result for review.
6. Compare every `mustKeep` and `mustNeverAdd` rule; rerun the worst output with its returned seed.

Historical render examples under `tests/render-fidelity/fixtures/Rendered Results` are comparison aids only. They are not proof for a newer model or deployment.

## Verification completed for this implementation

- Studio TypeScript check passed after the strict-fidelity and notification changes.
- `pnpm test:render-fixtures` passed: 6/6 fixture files verified.
- Git whitespace checks passed before each focused commit.
- Commits were pushed to `origin/main`.

The local API-wide typecheck was not used as a release signal because this checkout currently has unresolved workspace dependency links for existing packages such as Hono, Zod, Sharp, and the shared config. That is an environment/dependency-link issue, not a passing API validation. A clean dependency install or deployment build must validate the API route before releasing it.

## What is not yet a hard guarantee

Strict mode is a materially stronger generation path, but image models can still drift. The following items remain necessary before claiming a deterministic, automatic geometry guarantee:

1. **Live model proof:** deploy the strict route and run the two benchmark cases plus additional elevations against real fal output.
2. **Automated evaluator:** compare source and result geometry using a calibrated structural/vision score. A simple raw pixel or edge score is not sufficient for line elevation-to-photoreal comparison.
3. **Bounded retry accounting:** if the evaluator fails, retry at most three times with adjusted control strengths; store every attempt and charge/reserve budget accurately.
4. **Fail-closed release gate:** do not promote a model or control-strength change unless the benchmark acceptance rate improves or at least does not regress.
5. **CAD/vector import:** accept vector/CAD geometry as a first-class protected source so source edges can be generated deterministically rather than inferred from a raster elevation.

Until these are complete, product copy must say **source fidelity** or **strict source contract**, never “100% guaranteed geometry lock.”

## Code map

| Area | Location |
| --- | --- |
| Shared fidelity types and route selection | `packages/types/src/index.ts` |
| Strict model registry and price | `apps/api/src/lib/models.ts` |
| Prompt contract and deterministic repairer | `apps/api/src/lib/prompts.ts` |
| Prompt-repair API and request validation | `apps/api/src/routes/renders.ts` |
| Prompt construction at submission | `apps/api/src/lib/engine.ts` |
| Studio state/persistence payload | `apps/studio/src/canvas/hooks/useGenerationSettingsStore.ts`, `GenerateBar.tsx` |
| Prompt-polish and strict-mode UI | `apps/studio/src/shell/panel/RenderTabBody.tsx` |
| Feature announcement styles | `apps/studio/src/styles/control-panel.css` |
| Upload cue timeout | `apps/studio/src/shell/IconRail.tsx` |
| Regression fixtures | `tests/render-fidelity/` |

