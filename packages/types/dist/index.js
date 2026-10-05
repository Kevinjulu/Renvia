/**
 * A short prompt can clearly describe one local change even when it was typed into the
 * full-render field. Keep this shared between Studio's safe handoff and the API guard so an
 * older client cannot spend a credit on a whole-building re-render by accident.
 */
export function suggestedEditPartForPrompt(prompt) {
    const normalized = prompt.toLowerCase();
    if (/\b(whole|entire|all)\s+(house|building|facade|façade|image)\b/.test(normalized))
        return null;
    if (!/\b(change|make|turn|paint|recolor|recolour|replace|update)\b/.test(normalized))
        return null;
    if (/\b(window|windows|window\s*frames?|frames?)\b/.test(normalized))
        return "windows";
    if (/\bdoors?\b/.test(normalized))
        return "doors";
    if (/\b(roof|roofline|tiles?)\b/.test(normalized))
        return "roof";
    if (/\b(walls?|facade|façade|cladding)\b/.test(normalized))
        return "walls";
    if (/\b(balcony|balconies|railings?)\b/.test(normalized))
        return "balconies";
    if (/\b(columns?|pillars?)\b/.test(normalized))
        return "columns";
    if (/\b(garage|garage door)\b/.test(normalized))
        return "garage";
    if (/\b(fence|gate)\b/.test(normalized))
        return "fence";
    if (/\b(landscap|plants?|trees?|grass|paving)\b/.test(normalized))
        return "landscaping";
    if (/\bsky\b/.test(normalized))
        return "sky";
    return null;
}
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