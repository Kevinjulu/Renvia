# Client render fidelity validation

## Purpose

Validate that Renvia transfers a prototype's visual language without replacing the source design. This is the acceptance baseline for the two client recommendations dated 30 September 2026.

## Non-negotiable rule

The source image owns the building and the view. Reference images own only the visual treatment.

| Must remain from the source | May be adopted from prototypes |
| --- | --- |
| Camera angle, framing and perspective | Material palette and finish |
| Massing, footprint and proportions | Facade texture and cladding pattern |
| Roof configuration and roof edges | Colour, lighting and atmosphere |
| Window, door, balcony and garage placement | Paving, planting and setting |
| Existing architectural elements, including the left-side gazebo | Non-structural surface details |

## Test cases

### CF-01 - Similar camera angle, classical prototype

| Field | Setup |
| --- | --- |
| Source | Two-storey sketch/elevation supplied in `1ST RECOMMENDATION.pdf` |
| Prototype | Front-facing white classical residence in the same PDF |
| Mode | Drawing |
| Preserve structure | On |
| Influence levels | Strong (3) and Maximum (4) |
| Prompt | `Photorealistic architectural render. Apply the prototype's white facade, dark roof materials, trim and finishes while preserving the source design exactly.` |

Pass only if the source roof form, front window, door configuration, side elements and approximately front-facing view remain recognisably unchanged. A result fails if it introduces a large wooden door in place of the source window, changes the roof form, or adds side architecture absent from the sketch.

### CF-02 - Deliberately mismatched camera angles, two prototypes

| Field | Setup |
| --- | --- |
| Source | The same two-storey sketch/elevation supplied in `2SECOND RECOMMENADATION.pdf` |
| Prototypes | Classical oblique-view residence and modern oblique-view residence from that PDF |
| Mode | Drawing |
| Preserve structure | On |
| Influence levels | Strong (3) and Maximum (4) |
| Prompt | `Photorealistic architectural render. Use the prototypes for finish only: add their facade material character, paving, landscape and a restrained amount of red Decra roofing where it maps to the source roof. Keep the source's front-facing geometry, garage and left-side gazebo exactly as drawn.` |

Pass only if the output retains the source's camera/view, roof configuration, openings, proportions, right-side garage and left-side gazebo. It may borrow paving, stone finish, colour, roof material and landscape; it must not adopt either prototype's perspective or massing.

## Scoring rubric

Score each criterion as pass, partial or fail. Any fail in a structural criterion fails the case regardless of the styling score.

| Category | Criteria | Acceptance threshold |
| --- | --- | --- |
| Structural fidelity | Camera, massing/proportions, roof, openings, existing side elements | All pass |
| Prototype transfer | Materials, colours, facade finish, paving/landscape when requested | At least 3 of 4 pass |
| Colour fidelity | White remains white; requested colour accents are retained without warming the facade brown/cream | Pass |
| Reproducibility | Retain input order, settings, prompt, model route and returned seed for every run | Complete evidence |

## Baseline run matrix

Run each configuration once with a fresh seed, then run the strongest configuration a second time with its returned seed. This separates normal model variance from an instruction-following defect.

| Run | Case | Influence | Seed | Required evidence |
| --- | --- | --- | --- | --- |
| B1 | CF-01 | Strong | Fresh | Output, returned seed, settings and scorecard |
| B2 | CF-01 | Maximum | Fresh | Output, returned seed, settings and scorecard |
| B3 | CF-02 | Strong | Fresh | Output, returned seed, settings and scorecard |
| B4 | CF-02 | Maximum | Fresh | Output, returned seed, settings and scorecard |
| B5 | Worst B1-B4 result | Same returned seed | Reused | Confirm whether the drift is reproducible |

## Current constraints and expected evidence

- References must be attached after the source image; the API sends the source first and prototypes after it.
- Current local `FAL_MODE` is `mock`, which returns the source image and cannot test visual fidelity.
- A real test must use the deployed or a controlled real-render environment, with the rendered model, seed and reference ordering recorded.
- Do not alter prompts, reference order or source image between Strong and Maximum comparison runs.

## Baseline outcome log

Not run. The client PDFs provide historical evidence of failure, but are not a run against the current checked-out revision.

## Phase 3 and 4 safeguards applied locally

- The API now forces the source-structure lock whenever one or more prototypes are supplied. A saved job, older browser tab or direct request cannot turn it off.
- The prompt explicitly assigns roles: first image = fixed building and camera; later images = surface-style swatches only. The source contract is repeated after the user's scene prompt.
- Strong and Maximum influence can increase surface styling only. They now instruct the renderer to omit a prototype feature if it would require a different roof, volume, opening, wall, column, balcony or camera position.
- The Studio automatically enables the structure lock when a prototype is attached and shows it as a disabled, reference-safe control.

These changes address the composition and façade drift shown in the client feedback. They still require the controlled real-render matrix above before being considered proven in production.

## Repeatable regression pack

The checked-in Lakeside fixture pack at [`tests/render-fidelity`](../tests/render-fidelity/README.md) turns the source-preservation requirement into two repeatable cases:

- a compatible modern prototype, which must transfer only material and scene treatment; and
- deliberately mismatched pitched-roof prototypes, which must never introduce a gable, porch, columns, a new opening or a different viewpoint.

Run `pnpm test:render-fixtures` before each visual review to verify that the source, reference and historical-comparison files have not changed. Use [`client-review-template.md`](../tests/render-fidelity/client-review-template.md) for the final before/after review and client sign-off.
