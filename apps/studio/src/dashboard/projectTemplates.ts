import type { AspectRatio } from "@renvia/types";

export type TemplateCategory = "Photorealistic" | "Vector sketch" | "Watercolor sketch" | "Watercolor collage";

export interface ProjectTemplate {
  id: string;
  label: string;
  description: string;
  thumb: string;
  category: TemplateCategory;
  aspectRatio: AspectRatio;
  /** 1 (subtle) - 4 (maximum), matches the Render tab's own scale. */
  styleInfluence: number;
  /** Dropped straight into the prompt box — a starting point, not locked in. */
  prompt: string;
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "photoreal-daylight",
    label: "Daylight exterior",
    description: "Bright midday sun, crisp shadows, a landscaped foreground.",
    thumb: "/style-thumbs/photorealistic.jpg",
    category: "Photorealistic",
    aspectRatio: "4:3",
    styleInfluence: 3,
    prompt: "Bright midday sunlight with a clear blue sky, crisp cast shadows, and a landscaped garden in the foreground.",
  },
  {
    id: "photoreal-dusk",
    label: "Dusk exterior",
    description: "Warm dusk light, glowing windows, realistic glass reflections.",
    thumb: "/dashboard/house-dark.jpg",
    category: "Photorealistic",
    aspectRatio: "16:9",
    styleInfluence: 3,
    prompt: "Warm dusk lighting with glowing interior windows, a soft ambient sky, and realistic reflections on the glazing.",
  },
  {
    id: "photoreal-lakeside",
    label: "Lakeside living",
    description: "Low horizontal profile, reflective water, timber and stone.",
    thumb: "/dashboard/lakeside-house.jpg",
    category: "Photorealistic",
    aspectRatio: "16:9",
    styleInfluence: 3,
    prompt: "A low horizontal profile facing reflective water, with natural timber cladding and stone accents.",
  },
  {
    id: "photoreal-minimal",
    label: "Warm minimal residence",
    description: "Natural timber, quiet stone, generous daylight, few details.",
    thumb: "/dashboard/house-exterior.jpg",
    category: "Photorealistic",
    aspectRatio: "4:3",
    styleInfluence: 2,
    prompt: "Natural timber cladding with quiet stone accents, generous daylight, and restrained, minimal detailing.",
  },
  {
    id: "vector-line-study",
    label: "Architectural line study",
    description: "Clean black-and-white linework for early design review.",
    thumb: "/style-thumbs/vector-sketch.jpg",
    category: "Vector sketch",
    aspectRatio: "auto",
    styleInfluence: 2,
    prompt: "A clean black-and-white architectural line drawing with minimal shading and precise linework.",
  },
  {
    id: "watercolor-concept",
    label: "Watercolor concept",
    description: "Loose brushwork, pastel palette, atmospheric presentation mood.",
    thumb: "/style-thumbs/watercolor-sketch.jpg",
    category: "Watercolor sketch",
    aspectRatio: "auto",
    styleInfluence: 3,
    prompt: "A soft, hand-painted watercolor wash with loose brush strokes, a pastel palette, and an atmospheric mood.",
  },
  {
    id: "watercolor-collage",
    label: "Material collage",
    description: "Layered painted textures, mixed-media, expressive color.",
    thumb: "/style-thumbs/watercolor-collage.jpg",
    category: "Watercolor collage",
    aspectRatio: "4:3",
    styleInfluence: 3,
    prompt: "Layered painted material textures in a mixed-media collage feel, with expressive color blocking.",
  },
];

export const TEMPLATE_CATEGORIES: TemplateCategory[] = ["Photorealistic", "Vector sketch", "Watercolor sketch", "Watercolor collage"];
