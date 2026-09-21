import type { CreateSegmentationRequest, CreateSegmentationResponse } from "@renvia/types";

export type SegmentFn = (body: CreateSegmentationRequest) => Promise<CreateSegmentationResponse>;

/**
 * Selections already paid for, keyed by image and part. Re-selecting the windows of the
 * same render costs nothing the second time — the mask can't change, and each fresh call
 * would charge another credit. Bounded because the masks are full-size PNG data URLs.
 */
const MAX_ENTRIES = 12;
const masks = new Map<string, string>();
/** Masks already uploaded for an edit, so a repeat apply skips the upload too. */
const uploaded = new Map<string, string>();

function keyFor(imageUrl: string, term: string): string {
  return `${imageUrl}\n${term}`;
}

function remember<T>(store: Map<string, T>, key: string, value: T) {
  store.delete(key);
  store.set(key, value);
  if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value as string);
}

export interface PartSelection {
  /** White-on-black PNG data URL, or null when nothing matched. */
  maskDataUrl: string | null;
  objectCount: number;
  /** True when it came from an earlier selection, so no credit was spent. */
  cached: boolean;
}

/** Selects a named part of an image, reusing an earlier selection of the same part. */
export async function selectPart(segment: SegmentFn, imageUrl: string, term: string): Promise<PartSelection> {
  const key = keyFor(imageUrl, term);
  const cached = masks.get(key);
  if (cached) {
    remember(masks, key, cached);
    return { maskDataUrl: cached, objectCount: 1, cached: true };
  }

  const result = await segment({ imageUrl, prompt: term });
  if (result.objectCount > 0 && result.maskDataUrl) remember(masks, key, result.maskDataUrl);
  return { maskDataUrl: result.maskDataUrl || null, objectCount: result.objectCount, cached: false };
}

export function uploadedPartMask(imageUrl: string, term: string): string | null {
  return uploaded.get(keyFor(imageUrl, term)) ?? null;
}

export function rememberUploadedPartMask(imageUrl: string, term: string, url: string) {
  remember(uploaded, keyFor(imageUrl, term), url);
}
