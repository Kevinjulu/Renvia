/** The stored image a link points at: its path, minus the signature and the watermarked/ copy prefix. */
function imageKey(url: string): string {
  try {
    return new URL(url, window.location.href).pathname.replace("/watermarked/", "/");
  } catch {
    return url;
  }
}

/**
 * True when two links show the same stored image. The API signs every link it hands out, with
 * its own expiry, and a free plan gets the watermarked copy, so the same render arrives under
 * a different link in every response and the links themselves never compare equal.
 */
export function isSameImage(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a === b || imageKey(a) === imageKey(b);
}
