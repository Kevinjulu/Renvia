export function renderRouteFor(settings) {
    if (settings.upscale)
        return "upscale";
    const hasReferences = (settings.referenceImageUrls?.length ?? 0) > 0;
    if (settings.edit)
        return hasReferences ? "edit-references" : "edit";
    if (hasReferences && settings.fidelity?.mode === "strict")
        return "fidelity";
    return hasReferences ? "references" : (settings.sourceType ?? "photo");
}
/**
 * Customer-visible base credit price for a render action. The operator's
 * `creditsPerImage` setting multiplies image-generation routes, while upscales carry
 * their own explicit cost. Keep this shared so the Studio quote and API debit agree.
 */
export function baseCreditCostForRender(settings) {
    if (settings.upscale)
        return settings.upscale.target === "8k" ? 2 : 1;
    const hasReferences = (settings.referenceImageUrls?.length ?? 0) > 0;
    if (!settings.edit && hasReferences && settings.fidelity?.mode === "strict")
        return 2;
    return 1;
}
/** Every model currently costs ~$0.04 per image, so credits map 1:1 to images. */
export const CREDITS_PER_IMAGE = 1;
/** Credits for one automatic selection (click or text) while editing a render. */
export const CREDITS_PER_SELECTION = 1;
//# sourceMappingURL=index.js.map