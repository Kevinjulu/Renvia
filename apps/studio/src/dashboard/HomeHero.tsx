import { useNavigate } from "react-router-dom";
import { PlayIcon, PlusIcon } from "./icons";

interface HomeHeroProps {
  onCreate: () => void;
  isCreating?: boolean;
}

/**
 * The Home banner. The image half is the product's own before/after: the elevation
 * line drawing on the left, the render Renvia made from it on the right.
 */
export function HomeHero({ onCreate, isCreating }: HomeHeroProps) {
  const navigate = useNavigate();

  return (
    <div className="flex overflow-hidden rounded-xl border border-hairline bg-white">
      <div className="flex flex-1 flex-col justify-center bg-gradient-to-b from-white to-surface-muted px-8 py-7">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-faint">From sketch to reality</p>
        <h2 className="mt-2.5 font-display text-[27px] font-semibold leading-8 tracking-[-0.015em] text-primary">
          Visualize a better tomorrow
        </h2>
        <p className="mt-2 max-w-[330px] text-[13px] leading-[19px] text-muted">
          Upload four elevations and Renvia renders every side photorealistically — preserving the design, enhancing the
          possibilities.
        </p>

        <div className="mt-5 flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={onCreate}
            disabled={isCreating}
            className="flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full bg-primary px-[18px] text-sm font-medium text-white transition-all duration-150 hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
          >
            <PlusIcon />
            {isCreating ? "Creating…" : "Create new project"}
          </button>
          <button
            type="button"
            onClick={() => navigate("/help/getting-started")}
            className="flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full border border-hairline-strong bg-white px-[18px] text-sm font-medium text-primary transition-colors hover:bg-surface-muted"
          >
            <PlayIcon />
            Watch how it works
          </button>
        </div>
      </div>

      <div className="relative hidden w-[400px] shrink-0 2xl:flex">
        <div className="flex-1 overflow-hidden bg-surface-2">
          <img src="/hero/elevation-sketch.jpg" alt="An elevation line drawing" className="h-full w-full object-cover" />
        </div>
        <div className="flex-1 overflow-hidden border-l border-white">
          <img
            src="/hero/elevation-render.jpg"
            alt="The photorealistic render Renvia produced from that elevation"
            className="h-full w-full object-cover"
          />
        </div>

        <span
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 flex h-[34px] -translate-x-1/2 -translate-y-1/2 items-center rounded-full bg-white px-1 text-primary shadow-[0_2px_10px_rgba(20,20,20,0.18)]"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="mx-1.5">
            <path d="M7 2.5 3.5 6 7 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="h-3.5 w-px bg-hairline" />
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="mx-1.5">
            <path d="M5 2.5 8.5 6 5 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
    </div>
  );
}
