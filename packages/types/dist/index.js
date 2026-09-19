export function renderRouteFor(settings) {
    const hasReferences = (settings.referenceImageUrls?.length ?? 0) > 0;
    if (settings.edit)
        return hasReferences ? "edit-references" : "edit";
    return hasReferences ? "references" : (settings.sourceType ?? "photo");
}
//# sourceMappingURL=index.js.map