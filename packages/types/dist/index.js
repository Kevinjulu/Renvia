export function renderRouteFor(settings) {
    const hasReferences = (settings.referenceImageUrls?.length ?? 0) > 0;
    if (settings.edit) {
        if (settings.edit.maskImageUrl)
            return hasReferences ? "inpaint-reference" : "inpaint";
        return hasReferences ? "edit-references" : "edit";
    }
    return hasReferences ? "references" : (settings.sourceType ?? "photo");
}
export function estimateImageCostUsd(price, megapixels) {
    return price.perMegapixel ? price.usd * Math.max(1, Math.ceil(megapixels)) : price.usd;
}
//# sourceMappingURL=index.js.map