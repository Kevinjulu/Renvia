import sharp from "sharp";
import { schema } from "@renvia/db";
import type { SampleCategory, StockReference } from "@renvia/types";
import type { Env } from "../index.js";
import { signedUploadUrl } from "./storage.js";

/** What an admin may upload before re-encoding; the stored copy is far smaller. */
export const MAX_STOCK_UPLOAD_BYTES = 15 * 1024 * 1024;
/** Every sample is shown to every user, so each stays small: R2's free tier is 10 GB. */
const MAX_STOCK_BYTES = 600 * 1024;
const MAX_STOCK_EDGE = 1600;

export class StockImageTooLargeError extends Error {
  constructor() {
    super("That image can't be made small enough");
  }
}

/**
 * Re-encodes a sample as WebP at most MAX_STOCK_EDGE px on its long edge and MAX_STOCK_BYTES,
 * stepping the quality down until it fits. Re-encoding also drops any metadata the file carried.
 */
export async function compressStockImage(input: ArrayBuffer): Promise<Buffer> {
  const resized = sharp(Buffer.from(input), { limitInputPixels: 50_000_000 })
    .rotate()
    .resize({ width: MAX_STOCK_EDGE, height: MAX_STOCK_EDGE, fit: "inside", withoutEnlargement: true });
  for (const quality of [82, 70, 58, 45]) {
    const output = await resized.clone().webp({ quality }).toBuffer();
    if (output.byteLength <= MAX_STOCK_BYTES) return output;
  }
  throw new StockImageTooLargeError();
}

export function stockReferenceKey(category: SampleCategory): string {
  return `stock/${category}/${crypto.randomUUID()}.webp`;
}

type StockRow = typeof schema.stockReferences.$inferSelect;

/** Samples aren't model output, so one signed link works for every viewer, free or paid. */
export async function presentStockReference(env: Env, origin: string, row: StockRow): Promise<StockReference> {
  return { id: row.id, category: row.category, url: await signedUploadUrl(env, origin, row.key), caption: row.caption };
}
