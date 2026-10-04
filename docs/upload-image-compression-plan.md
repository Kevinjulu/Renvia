# Upload image compression plan

## Status

**Planned — not implemented.** Studio currently uploads the original PNG, JPEG or WebP bytes to `POST /api/uploads`. The API checks type and size, then stores those bytes unchanged. `sharp` is already installed in the API and is used elsewhere for image manipulation, but not yet on the general upload route.

## Goal

Reduce upload time, storage use and render-input transfer without visibly degrading an architectural source elevation or a prototype reference image.

## Chosen approach

Use two stages:

1. **Studio pre-upload compression:** add `browser-image-compression` and run it with a Web Worker before the existing XHR upload. This reduces the bytes sent over the user's connection without blocking the Studio UI.
2. **API normalisation:** use the existing `sharp` dependency as a safety net after upload. It should correct orientation, reject unsafe/invalid pixel dimensions, cap oversized images and produce a consistent stored format.

Client-side compression is what makes the upload itself faster. Server-side Sharp processing cannot reduce the time taken to send an original large file to the API, but it protects storage and covers older clients or direct API calls.

## Quality policy

| Input | Target | Rule |
| --- | --- | --- |
| Photo / prototype reference | WebP or JPEG, 88–92 quality | Cap the longest edge at 2560px; do not enlarge. |
| CAD / line elevation | Keep small PNGs unchanged; otherwise near-lossless WebP | Preserve thin lines, openings and roof edges. Do not aggressively JPEG-compress. |
| Transparent image | WebP with alpha or PNG | Never flatten transparency to a coloured background. |

Always preserve the source aspect ratio and embedded orientation. The original client file should remain available locally until a successful upload has completed; the stored version may be compressed.

## Implementation sketch

1. Add `browser-image-compression` to `apps/studio`.
2. Create one shared Studio helper used by elevation uploads, reference uploads, Assets and account-photo uploads.
3. Skip compression when a supported input is already below the target dimension and byte budget.
4. Show the existing progress control as two understandable stages: “Optimising image” then “Uploading”.
5. In `apps/api/src/routes/uploads.ts`, use Sharp to inspect dimensions and normalise only as needed.
6. Record original and stored byte sizes in development telemetry so the compression policy can be tuned using evidence.

## Acceptance checks

- A 10–20 MB phone photo uploads materially faster on a typical mobile connection and stays visually indistinguishable in Studio.
- A high-contrast elevation retains crisp lines, window openings and dimensions after compression.
- PNG transparency remains correct.
- A file that does not benefit from compression is not made larger.
- The existing source-fidelity regression cases still pass after the compressed image is sent to the renderer.

## Explicit non-goals

- Do not replace a line elevation with lossy JPEG by default.
- Do not use a WASM codec with heavy startup cost for every interactive upload.
- Do not delete source files from the user's device or hide compression failures.
