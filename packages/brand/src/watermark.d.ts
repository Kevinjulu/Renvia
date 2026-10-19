/** Types for watermark.js, kept by hand so the package needs no build step. */

/** One watermark unit: a white SVG fragment drawn on a width x height box. */
export interface WatermarkMark {
  readonly width: number;
  readonly height: number;
  readonly svg: string;
}

export declare const renviaWatermarkMark: WatermarkMark;
export declare const ramahWatermarkMark: WatermarkMark;
export declare const watermarkMark: WatermarkMark;
