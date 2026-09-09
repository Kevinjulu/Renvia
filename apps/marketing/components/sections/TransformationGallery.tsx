import Image from "next/image";
import { CompareSlider } from "@/components/compare-slider/CompareSlider";

const cards = [
  { title: "Riverside House", before: "/hero/lakeside-house-drawing-clean.png", after: "/hero/lakeside-house.jpg", position: "center", beforeTransform: "scaleY(.9) translateY(6%)" },
  { title: "Modern Villa", before: "/hero/renvia-villa-sketch-clean.png", after: "/hero/renvia-villa-premium.png", position: "center", beforeTransform: "scale(.88) translate(2%, 4%)" },
  { title: "Urban Residence", before: "/hero/renvia-villa-sketch-clean.png", after: "/hero/renvia-villa-premium.png", position: "58% center", beforeTransform: "scale(.88) translate(2%, 4%)" },
  { title: "Natural Retreat", before: "/hero/renvia-villa-sketch-clean.png", after: "/hero/renvia-villa-premium.png", position: "38% center", beforeTransform: "scale(.88) translate(2%, 4%)" },
];

export function TransformationGallery() {
  return (
    <section className="border-t border-hairline px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-[1240px]">
        <div className="flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
          <div>
            <span className="rounded-full border border-hairline bg-surface px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[.16em] text-faint">Real transformations</span>
            <h2 className="mt-5 font-display text-4xl font-semibold leading-[.98] tracking-[-.05em] sm:text-5xl">Same structure.<br/>Different stories.</h2>
            <p className="mt-4 max-w-[330px] text-sm leading-6 text-muted">From modern minimalism to warm natural tones — see how a single design can take on entirely new lives.</p>
          </div>
          <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
            {['All','Modern','Minimal','Natural','Industrial'].map((x,i) => <button key={x} className={`whitespace-nowrap rounded-full border px-4 py-2 text-xs ${i===0?'border-primary bg-primary text-white':'border-hairline bg-white text-muted'}`}>{x}</button>)}
          </div>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((card) => (
            <article key={card.title} className="overflow-hidden rounded-xl border border-hairline bg-white shadow-[0_18px_45px_-34px_rgba(0,0,0,.4)]">
              <div className="aspect-[1.12/1] bg-white">
                <CompareSlider
                  before={<div className="relative h-full w-full bg-white"><Image src={card.before} alt={`${card.title} sketch`} fill sizes="25vw" className="object-cover" style={{ objectPosition: card.position, transform: card.beforeTransform }} /></div>}
                  after={<div className="relative h-full w-full"><Image src={card.after} alt={`${card.title} render`} fill sizes="25vw" className="object-cover" style={{ objectPosition: card.position }} /></div>}
                  beforeLabel=""
                  afterLabel=""
                  initialPosition={50}
                  fill
                />
              </div>
              <div className="p-4"><h3 className="text-sm font-semibold">{card.title}</h3><p className="mt-1 text-[10px] text-faint">Sketch&nbsp; → &nbsp;Render</p></div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
