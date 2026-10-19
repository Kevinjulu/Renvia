/** Types for index.js, kept by hand so the package needs no build step. */

export declare const brand: {
  readonly legalName: "RAMAH STUDIO INTERNATIONAL";
  readonly displayName: "RAMAH STUDIO";
  readonly subtitle: "international";
  readonly shortName: "Ramah Studio";
  readonly name: "Ramah Studio International";
};

export declare const brandColors: {
  readonly charcoal: string;
  readonly gold: string;
  readonly ivory: string;
};

export type LogoVariant = "wordmark" | "official" | "symbol";

export interface LogoLayer {
  /** "ink": charcoal on light backgrounds, ivory or currentColor on dark. "gold": always gold. */
  readonly tone: "ink" | "gold";
  /** Filled path data; draw with fill-rule="evenodd". */
  readonly d: string;
}

export interface LogoArt {
  readonly viewBox: string;
  readonly layers: readonly LogoLayer[];
}

export declare const logoArt: { readonly [V in LogoVariant]: LogoArt };

export declare function logoSvg(variant: LogoVariant, options?: { tone?: "dark" | "light"; scale?: number }): string;

export declare function iconSvg(options?: { rounded?: boolean; size?: number }): string;
