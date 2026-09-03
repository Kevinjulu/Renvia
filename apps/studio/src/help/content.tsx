import type { ReactNode } from "react";
import type { AuthAccent } from "../components/auth/BlueprintPanel";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function H2({ children }: { children: string }) {
  return (
    <h2 id={slugify(children)} className="mt-10 scroll-mt-24 font-display text-lg font-semibold text-primary first:mt-0">
      {children}
    </h2>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-sm leading-relaxed text-secondary">{children}</p>;
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-secondary">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

const CALLOUT_ACCENT: Record<AuthAccent, string> = {
  blueprint: "border-blueprint bg-blueprint-soft",
  glow: "border-glow bg-glow-soft",
};

export function Callout({ label, children, accent = "blueprint" }: { label: string; children: ReactNode; accent?: AuthAccent }) {
  return (
    <div className={`mt-4 rounded-lg border-l-2 px-4 py-3 text-sm leading-relaxed text-primary ${CALLOUT_ACCENT[accent]}`}>
      <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">{label}</p>
      <p className="mt-1">{children}</p>
    </div>
  );
}

export interface HelpArticle {
  slug: string;
  eyebrow: string;
  title: string;
  summary: string;
  image: string;
  accent: AuthAccent;
  readTime: string;
  sections: string[];
  Body: () => JSX.Element;
}

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "getting-started",
    eyebrow: "Guide — Interface",
    title: "Uploading your four elevations",
    summary: "Where the elevation slots, material area, and render tools sit.",
    image: "/auth/sign-in.jpg",
    accent: "blueprint",
    readTime: "2 min read",
    sections: [
      "The four elevation slots",
      "Material space and the cluster",
      "Editing tools",
      "Regional selection",
      "Past renders",
      "Rendering and exporting",
    ],
    Body: function GettingStartedBody() {
      return (
        <>
          <P>
            The Studio interface is built around four fixed image slots and three supporting panels. This is
            where everything sits and what each one does.
          </P>

          <H2>The four elevation slots</H2>
          <P>
            Insert one image per side: front, left, back, and right elevation. Each slot holds a single source
            image, and all four stay visible at once so you can compare sides while you edit.
          </P>

          <H2>Material space and the cluster</H2>
          <P>
            The material area has two parts. Material space is where you browse and pick textures. Cluster space
            sits at the bottom of the panel and holds the materials you've chosen.
          </P>
          <Callout label="Before it settles in" accent="blueprint">
            Every material gets a name before it drops into the cluster, so "white paint" and "brown paint" don't
            end up looking the same in the list later.
          </Callout>

          <H2>Editing tools</H2>
          <P>Three ways to bring a reference into a render:</P>
          <List
            items={[
              "A text prompt describing the change directly.",
              "A building image reference, pulled from Pinterest, Google, or a file on your computer.",
              "A texture cluster reference, sourced the same way.",
            ]}
          />

          <H2>Regional selection</H2>
          <P>
            The manual regional rendering tool lets you mark the exact area you want changed before you render, so
            the rest of the elevation is left alone.
          </P>

          <H2>Past renders</H2>
          <P>
            The panel on the right keeps a running list of rendered images and imported sketches, so earlier
            attempts stay within reach while you keep working.
          </P>

          <H2>Rendering and exporting</H2>
          <P>Click Render to generate the elevation. Finished renders can be downloaded and exported one at a time.</P>
        </>
      );
    },
  },
  {
    slug: "regional-editing",
    eyebrow: "Guide — Regional editing",
    title: "Three ways to change one part of a building",
    summary: "Texture, whole-building, and prompt modes, plus automatic vs. manual selection.",
    image: "/auth/sign-up.jpg",
    accent: "glow",
    readTime: "2 min read",
    sections: [
      "Texture and material reference",
      "Whole-building reference",
      "Prompt-based editing",
      "Automatic vs. manual selection",
      "Generating",
    ],
    Body: function RegionalEditingBody() {
      return (
        <>
          <P>
            The editing screen splits in two: the image you're changing sits on the left, and a reference image
            sits on the right. From there, a change can come in three different ways.
          </P>

          <H2>Texture and material reference</H2>
          <P>
            Borrow a specific material or finish from an image, such as a paint colour, a roofing material like
            Decra tiles, a floor finish, or any single component, and apply it to the target. This is how you
            repaint a wall, swap a roof finish, or update a floor without touching anything else on the building.
          </P>

          <H2>Whole-building reference</H2>
          <P>
            Upload a full house photo instead of a swatch. Pick the features you want from it, such as roof tiles,
            floor finish, windows, or doors, then select where each one lands on the target image.
          </P>

          <H2>Prompt-based editing</H2>
          <P>
            Describe the change in a sentence instead, for example "change roof to brown decra tile," and the
            system locates the area on its own.
          </P>

          <H2>Automatic vs. manual selection</H2>
          <P>
            Automatic selection groups similar elements by region rather than grabbing the whole building. On a
            Decra-tile roof, it can select just a portion of it.
          </P>
          <Callout label="Why this matters" accent="glow">
            A door isn't one selectable piece. Automatic selection tells the frame, the leaf, and the hardware
            apart, so you can edit one without dragging the rest along. Manual selection is still there for when
            you want to draw the exact area yourself.
          </Callout>

          <H2>Generating</H2>
          <P>Once your selection or prompt is set, click Generate to apply it.</P>
        </>
      );
    },
  },
  {
    slug: "consistent-results",
    eyebrow: "Guide — Best practices",
    title: "Keeping all four sides consistent",
    summary: "Style transfer intensity, what the AI won't change, and setting a background.",
    image: "/auth/forgot-password.jpg",
    accent: "blueprint",
    readTime: "2 min read",
    sections: [
      "Upload all four elevations together",
      "Style transfer intensity",
      "What stays fixed",
      "Setting the background",
      "Why this matters",
    ],
    Body: function ConsistentResultsBody() {
      return (
        <>
          <P>
            Rendering four elevations one at a time can leave them looking like four different buildings. These
            settings keep them matching.
          </P>

          <H2>Upload all four elevations together</H2>
          <P>
            Bring in front, back, left, and right at once, then apply a single reference image across all of them.
            The same materials, textures, colours, and facade treatment carry to every side, so a brick reference
            doesn't turn into brick on the front and stucco on the back.
          </P>

          <H2>Style transfer intensity</H2>
          <P>Four levels control how far the reference image is allowed to push the result:</P>
          <List
            items={[
              <>
                <strong className="font-medium text-primary">Level 1, minimal:</strong> light material or colour
                cues only.
              </>,
              <>
                <strong className="font-medium text-primary">Level 2, moderate:</strong> visible borrowing of
                facade elements, textures, and finishes.
              </>,
              <>
                <strong className="font-medium text-primary">Level 3, strong:</strong> window treatments, cladding
                patterns, and detailing carry over clearly.
              </>,
              <>
                <strong className="font-medium text-primary">Level 4, full:</strong> the closest match to the
                reference the system will produce.
              </>,
            ]}
          />

          <H2>What stays fixed</H2>
          <P>The AI can restyle a building, but it can't redesign it.</P>
          <Callout label="Structural integrity" accent="blueprint">
            Window and door counts stay the same, no new openings appear, and elements like roofs, balconies, or
            columns aren't added anywhere they weren't already present. Only material, texture, colour, and finish
            change. The layout underneath stays yours.
          </Callout>

          <H2>Setting the background</H2>
          <P>
            Upload a separate background reference to place the building in a setting, such as a street, a
            waterfront, or a garden, and the render picks up the lighting and surroundings that go with it.
          </P>

          <H2>Why this matters</H2>
          <P>
            The same camera angle and consistent lighting across all four renders is what makes them read as one
            building, not four separate images.
          </P>
        </>
      );
    },
  },
];

export function getHelpArticle(slug: string | undefined): HelpArticle | undefined {
  return HELP_ARTICLES.find((article) => article.slug === slug);
}
