import type { MetadataRoute } from "next";
import { brand, brandColors } from "@renvia/brand";

export const dynamic = "force-static";

/** Name and icons when the site is installed or pinned. Icons come from @renvia/brand's export. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: brand.name,
    short_name: brand.shortName,
    description: "Turn your architectural models and sketches into photoreal visualizations while keeping your original geometry intact.",
    start_url: "/",
    display: "standalone",
    background_color: "#FAFAFA",
    theme_color: brandColors.charcoal,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
