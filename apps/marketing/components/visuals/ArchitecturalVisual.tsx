import Image from "next/image";

export type Treatment =
  | "geometry"
  | "render"
  | "concrete"
  | "wood"
  | "stone"
  | "elevation-front"
  | "elevation-rear"
  | "elevation-side-a"
  | "elevation-side-b";

const TREATMENT_SOURCES: Record<Treatment, { src: string; alt: string }> = {
  geometry: { src: "/hero/lakeside-house-sketch.png", alt: "Original CAD geometry, uploaded model" },
  render: { src: "/hero/lakeside-house.jpg", alt: "Photoreal render, warm evening lighting" },
  concrete: { src: "/materials/concrete.jpg", alt: "Photoreal render, concrete and black metal finish" },
  wood: { src: "/materials/wood.jpg", alt: "Photoreal render, timber cladding finish" },
  stone: { src: "/materials/stone.jpg", alt: "Photoreal render, natural stone finish" },
  "elevation-front": { src: "/studio/elevation-front.jpg", alt: "Front elevation, warm evening lighting" },
  "elevation-rear": { src: "/studio/elevation-rear.jpg", alt: "Rear elevation facing the lake" },
  "elevation-side-a": { src: "/studio/elevation-side-a.jpg", alt: "Left side elevation" },
  "elevation-side-b": { src: "/studio/elevation-side-b.jpg", alt: "Right side elevation" },
};

interface ArchitecturalVisualProps {
  treatment?: Treatment;
  alt?: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
}

export function ArchitecturalVisual({
  treatment = "render",
  alt,
  className = "",
  sizes = "(min-width: 1024px) 50vw, 100vw",
  priority = false,
}: ArchitecturalVisualProps) {
  const source = TREATMENT_SOURCES[treatment];

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <Image
        src={source.src}
        alt={alt || source.alt}
        fill
        sizes={sizes}
        priority={priority}
        className="object-cover"
      />
    </div>
  );
}
