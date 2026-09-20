export function renderRouteFor(settings) {
    const hasReferences = (settings.referenceImageUrls?.length ?? 0) > 0;
    if (settings.edit)
        return hasReferences ? "edit-references" : "edit";
    return hasReferences ? "references" : (settings.sourceType ?? "photo");
}
/** Every model currently costs ~$0.04 per image, so credits map 1:1 to images. */
export const CREDITS_PER_IMAGE = 1;
/** Credits for one automatic selection (click or text) while editing a render. */
export const CREDITS_PER_SELECTION = 1;
//# sourceMappingURL=index.js.map