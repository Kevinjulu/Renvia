export interface ImageSize {
  width: number;
  height: number;
}

/** Reads pixel dimensions from PNG, JPEG or WebP header bytes; null for anything else. */
export function readImageSize(bytes: Uint8Array): ImageSize | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // PNG: signature, then the IHDR chunk carries big-endian width/height at offset 16.
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  // JPEG: walk the marker segments to the first start-of-frame.
  if (bytes.length >= 4 && view.getUint16(0) === 0xffd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1]!;
      const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isStartOfFrame) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      offset += 2 + view.getUint16(offset + 2);
    }
    return null;
  }

  // WebP: RIFF container with a VP8 (lossy), VP8L (lossless) or VP8X (extended) chunk.
  if (bytes.length >= 30 && view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250) {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === "VP8 ") {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    if (chunk === "VP8L") {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") {
      const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
      const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
      return { width, height };
    }
  }

  return null;
}

/**
 * Scales to the same aspect ratio at just under one megapixel, in multiples of 16 —
 * megapixel-billed models round up, so this keeps each render in the 1 MP price tier.
 */
export function fitToOneMegapixel({ width, height }: ImageSize): ImageSize {
  const scale = Math.sqrt(1_000_000 / (width * height));
  const snap = (value: number) => Math.max(256, Math.floor((value * scale) / 16) * 16);
  return { width: snap(width), height: snap(height) };
}
