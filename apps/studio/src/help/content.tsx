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
    title: "The Studio workspace",
    summary: "Where elevations, direction, Generate, and past renders sit — and how to inspect the layout.",
    image: "/auth/sign-in.jpg",
    accent: "blueprint",
    readTime: "2 min read",
    sections: [
      "The four elevation slots",
      "Prompt, references, and style",
      "Generate",
      "The canvas and filmstrip",
      "Past renders",
      "Edit",
      "The in-studio guide",
    ],
    Body: function GettingStartedBody() {
      return (
        <>
          <P>
            The Studio is built around elevation slots and three supporting panels: controls on the left,
            the canvas in the centre, and past renders on the right.
          </P>

          <H2>The four elevation slots</H2>
          <P>
            Front, right, back, and left are always available. Upload only the sides you have — Generate
            renders each uploaded elevation and skips empty slots. Untick an elevation to leave it out of the
            next Generate, or Remove its image altogether. You can add extra views such as a roof or
            isometric if you need them.
          </P>

          <H2>Prompt, references, and style</H2>
          <P>
            Direction is optional. A short prompt sets atmosphere and materials. Reference images are stronger:
            the model blends them with your elevation so cladding, landscape, and lighting follow what you show.
            Style and aspect ratio sit above the prompt — Auto keeps the source image's own shape. Source type
            tells the model whether it is looking at a photo / 3D view or a line drawing.
          </P>
          <Callout label="Preserve structure" accent="blueprint">
            Leave this on for client elevations. The model may change finish and colour, but it should not
            invent new openings or reshape the massing.
          </Callout>

          <H2>Generate</H2>
          <P>
            Generate renders every uploaded elevation. The number beside the button is variations per elevation. Credits
            are shown underneath. If you only uploaded a front elevation, you get that one render.
          </P>

          <H2>The canvas and filmstrip</H2>
          <P>
            The stage shows the active elevation. Drop a file onto an empty canvas, or use the filmstrip under the
            stage to switch sides and fill missing elevations. Scroll to zoom; Fit in the top bar resets the view.
          </P>

          <H2>Past renders</H2>
          <P>
            The panel on the right keeps every generate and edit. Open one full-size, download it, reuse its
            prompt and settings, set it as the new base elevation, or start a regional edit from it.
          </P>

          <H2>Edit</H2>
          <P>
            Switch to Edit after you have a render. Element / texture borrows a finish, Whole building follows a
            reference house, and Prompt edit describes the change in a sentence. Auto select finds the region;
            Manual lets you draw it on the canvas.
          </P>

          <H2>The in-studio guide</H2>
          <P>
            The first time you open a project, a short tour names each region. Press Guide in the top bar to
            inspect the layout anytime, or the small question marks on Source, Style influence, Preserve
            structure, and Selection mode.
          </P>
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
