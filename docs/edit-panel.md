# Edit panel: methods, environment and two-pass edits

## Purpose

The Studio's Edit tab used to repeat the Render tab's controls: the same reference bar, the same prompt, the same advanced settings, with the edit's intent guessed from whichever inputs happened to be filled. It is now a tool for refining a finished render, built around three explicit ways to edit, an optional selected area, and scene-wide environment changes.

This document records the implementation delivered in commits `2e6eb5c` (API and shared types) and `743e3ce` (Studio).

## What users see

Edits only work on a finished render open in the viewer. With none open, the panel offers **Edit this render** for the view's latest render, or asks the user to generate one first. Editing the original upload and the **Edit the canvas image instead** link are gone.

From top to bottom:

1. **How do you want to edit?** A three-way switch:
   - **Describe**: type the change.
   - **Reference**: one image; the render takes on its look. No text box.
   - **Both**: one image plus what to take from it. Quick picks (Windows, Roof, Doors, Pillars, Outdoors, Exterior) fill in the instruction, e.g. "Make the windows match the reference".
2. **Reference image** (Reference and Both only). One image, kept separate from the Render tab's reference list.
3. **Describe the change / What should it take from the reference?** (Describe and Both only).
4. **Apply to**: **Whole image** or **Selected area**. Painting, drawing or auto-selecting on the render switches to Selected area; the panel then shows "Area selected — only it changes" with a clear button.
5. **Environment** (folded by default): six one-line dropdowns, each starting on **Keep as is**: time of day, season, weather, architectural look, facade material, facade colour. The folded header shows what was picked, e.g. "Dusk · Winter".
6. **What will happen**: the edit in plain words, e.g.
   > 1. "Make the windows match the reference", using the reference, in the selected area.
   > 2. Then, over the whole image: dusk, winter.
7. **Advanced settings**: Edit strength and Keep the same look, unchanged.

**Apply edit** stays disabled until the edit is complete, with the reason shown beneath it. The cost line reads `2 steps · 2 credits` when the environment pass will run.

The Add / Remove / Change chips were removed; the text itself carries the verb. Older edit jobs that recorded an action still build their prompt from it.

## The edit contract

All of this lives in `packages/types/src/index.ts`, shared by the Studio and the API.

```ts
type EditMethod = "prompt" | "reference" | "reference-prompt";

interface EditEnvironment {
  timeOfDay?: "morning" | "midday" | "golden-hour" | "dusk" | "night";
  season?: "spring" | "summer" | "autumn" | "winter";
  weather?: "clear" | "overcast" | "rain" | "snow" | "fog";
  style?: "modern" | "minimalist" | "scandinavian" | "mediterranean" | "farmhouse" | "industrial" | "tropical" | "classic";
  facadeMaterial?: "brick" | "stone" | "stucco" | "timber" | "concrete" | "metal" | "glass";
  facadeColor?: string; // a colour name, at most 40 characters
}

interface RenderEditSettings {
  mode: EditMode;                // still recorded for older readers
  method?: EditMethod;
  action?: EditAction;           // older jobs only
  maskImageUrl?: string;
  environment?: EditEnvironment;
  intermediateImageUrl?: string; // set by the API, never the client
}
```

The option lists (`EDIT_TIMES_OF_DAY`, `EDIT_SEASONS`, `EDIT_WEATHER`, `EDIT_STYLES`, `FACADE_MATERIALS`) are exported so the API's zod schema and the Studio's dropdowns cannot drift. **Style** means architectural look: it restyles finishes and details (cladding, trim, frames, railings), never the building's form. Render style (Photorealistic, Watercolour…) is chosen at render time and is kept by every edit.

Facade colours are sent by name. Image models follow "sage green" far better than a hex value.

Settings are stored in the existing `renders.settings` jsonb column; no migration was needed.

### Shared helpers

| Helper | Purpose |
| --- | --- |
| `editMethodFor(edit, { hasReferences, hasPrompt })` | The edit's method, derived for older jobs that only recorded `mode`. |
| `hasEnvironmentChange(environment)` | True when any environment field is set. |
| `editPassCount(edit)` | `2` for a selection plus an environment change, else `1`. |
| `editRequestProblem({ edit, prompt, referenceCount })` | Why an edit can't run, or `null`. |
| `baseCreditCostForRender(settings)` | For edits, one credit per pass. |

### Validation

`POST /api/renders` refuses an incomplete edit with `422 { code: "invalid_edit", error }`. The Studio shows the same message before the request is sent, because both use `editRequestProblem`:

| Situation | Message |
| --- | --- |
| More than one reference | Edits use one reference image. |
| Selected area with no prompt or reference | Describe the change for the selected area, or clear the selection to change only the environment. |
| Describe with no prompt and no environment change | Describe the change or pick an environment change. |
| Reference or Both with no reference | Add a reference image. |
| Both with no prompt | Describe what to take from the reference. |
| No method (older clients) and nothing at all | Describe an edit, attach a reference or pick an environment change. |

An environment change on its own is a complete edit.

## Prompts

`buildEditPrompt()` in `apps/api/src/lib/prompts.ts` composes the main pass from separate parts:

- **Image roles** for reference edits: "Image 1 is the building image to edit. Image 2 is the reference." For a selection that is sent as a close-up crop, image 1 is named as that close-up.
- **The instruction**, by method:
  - *Describe*: the user's words, or an action verb built around them for older jobs.
  - *Reference, whole image*: apply image 2's materials, finishes, colours and detailing to the matching surfaces of image 1; never copy its building, layout or viewpoint.
  - *Reference, selected area*: the selected element takes on the matching element's design, shape details, material, colour and finish, in its current position, size and perspective.
  - *Both*: take from image 2 only what the instruction asks for, applied to the corresponding elements of image 1 in their current positions and sizes.
- **Environment sentences**, one per change, in a fixed order: architectural look, facade (material and colour as one instruction), time of day, season, weather.
- **The form lock** whenever a reference or environment change is involved: the building's geometry, proportions, roof shape, window and door positions, camera angle and framing stay exactly as they are.
- **Keep the rest**, and a hint to keep a non-photoreal render's style.

With a selected area, the environment is left out of the main prompt. Only the selected area of that pass is kept, so an environment change there would be thrown away. It is applied by its own pass instead, using `buildEnvironmentPrompt()`.

## Two-pass edits

A selected area plus an environment change runs as one render with two fal passes.

1. **Selection pass.** Submitted as before: the selected area is cropped and edited, then composited back onto the source.
2. **Hand-off.** When the selection pass completes, `startEnvironmentPass()` in `apps/api/src/lib/engine.ts`:
   - stores the composite at `renders/<id>-selection.<ext>` and records it as `settings.edit.intermediateImageUrl`;
   - claims the render with a conditional update on the first pass's `falRequestId` (also switching `model` and clearing `falRequestId`), so a racing poll and fal webhook submit the second pass only once;
   - submits the environment pass on the whole composite with the single-image edit model, `aspect_ratio` auto, and the same seed and edit strength.
3. **Environment pass.** Its result is stored as the final image without re-applying the mask. The render stays `processing` throughout, so the Studio shows one job.

While `intermediateImageUrl` is set, the engine treats the render as being in its environment pass: no mask is applied, and failures are accounted as below.

### Cost and budget

| Edit | Passes | Credits | Budget reserved and recorded |
| --- | --- | --- | --- |
| Whole image, any method, with or without environment | 1 | 1 | the route's model |
| Selected area, no environment change | 1 | 1 | the route's model |
| Selected area plus environment change | 2 | 2 | the route's model + the `edit` route's model |

In production the `edit` route is FLUX Kontext Pro ($0.04) and the `edit-references` route is FLUX 3 Edit ($0.048).

### Failures

- A failure in the second pass (fal error, timeout, cancellation) refunds **all** the user's credits: they did not get the edit they paid for.
- The render's `costMicros` keeps the first pass's cost, because fal billed it. `failurePatchFor()` handles this.
- If the request dies between claiming the hand-off and submitting the second pass, the render has `intermediateImageUrl` but no `falRequestId`. The usual timeout (10 minutes, also run by the stale-render sweep) fails and refunds it.
- If operators switch the engine to mock mode mid-flight, the selection pass's result is returned as the final image.

## Studio implementation

| File | Role |
| --- | --- |
| `apps/studio/src/shell/panel/EditTabBody.tsx` | The panel. |
| `apps/studio/src/canvas/hooks/useEditDraft.ts` | Turns the Edit tab's state into the request, with its problem, pass count and cost settings. The summary and the Apply button both read it. |
| `apps/studio/src/shell/panel/editEnvironmentOptions.ts` | Labels for the environment dropdowns. |
| `apps/studio/src/canvas/hooks/useGenerationSettingsStore.ts` | Edit-only state: `editMethod`, `editReferenceUrl`, `editScope`, `editEnvironment`. Replaces the old `editMode` inference and `editAction`. |
| `apps/studio/src/shell/panel/ReferenceBar.tsx` | Now takes `urls`, `onChange` and `maxReferences` as props, so the Render tab keeps its list and the Edit tab gets a single slot. |
| `apps/studio/src/shell/panel/AdvancedSection.tsx` | Takes an optional title, storage key and icon; Environment reuses it. |
| `apps/studio/src/shell/panel/GenerateBar.tsx` | Submits the draft, uploads the mask only for Selected area, and adds the second pass to the admin dollar estimate. |

**Use prompt and settings** on a past edit restores its method, reference, apply-to choice and environment into the Edit tab and leaves the Render tab untouched. A restored Selected area needs the area painted again; masks are not restored.

## Tests

- `packages/types/src/editContract.test.mjs` (`pnpm --filter @renvia/types test`): methods, pass counts, credits and every validation rule.
- `apps/api/test/editPrompt.pure.test.ts`: the prompt for each method, environment wording, and that a selection leaves the environment to its own pass.
- `apps/api/test/editPasses.test.ts`: fal and storage mocked against a real Postgres. Covers the full two-pass flow (the intermediate changes only inside the selection; the final image is the environment result over the whole picture), the poll/webhook race, a failed second pass (full refund, first pass's cost kept), and a selection without environment staying one pass.

## Known gaps

- The panel has not yet been checked end to end in the running Studio.
- Reference edits have not been checked in prod mode; the dev engine ignores reference images, so only prod shows their effect.
- In prod, FLUX 3 Edit is not sent the seed or guidance value, so **Edit strength** and **Keep the same look** have no effect on reference edits.
