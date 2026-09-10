"use client";

import Image from "next/image";
import { useState } from "react";
import { CompareSlider } from "@/components/compare-slider/CompareSlider";
import { SIGNUP_URL } from "@/lib/config";

const stories = [
  {
    id: "riverside",
    number: "01",
    tab: "Riverside House",
    title: "Quiet modernism, warmed by the landscape.",
    brief: "Turn a precise architectural drawing into an inviting waterside home without softening the original design intent.",
    before: "/hero/lakeside-house-drawing-clean.png",
    after: "/hero/lakeside-house.jpg",
    position: "center",
    beforeTransform: "scaleY(.9) translateY(6%)",
    changed: ["Natural timber", "Golden-hour light", "Native planting"],
    preserved: ["Roofline", "Window rhythm", "Building footprint"],
  },
  {
    id: "villa",
    number: "02",
    tab: "Courtyard Villa",
    title: "A raw model becomes a place you can feel.",
    brief: "Give a minimal villa depth, atmosphere, and material character while keeping every architectural proportion intact.",
    before: "/hero/renvia-villa-sketch-clean.png",
    after: "/hero/renvia-villa-premium.png",
    position: "center",
    beforeTransform: "scale(.88) translate(2%, 4%)",
    changed: ["Textured stone", "Warm interiors", "Mediterranean garden"],
    preserved: ["Exact massing", "Openings", "Circulation"],
  },
];

export function TransformationGallery() {
  const [activeId, setActiveId] = useState(stories[0]!.id);
  const story = stories.find((item) => item.id === activeId) ?? stories[0]!;

  return (
    <section className="overflow-hidden border-t border-hairline px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-[1240px]">
        <div className="grid gap-7 lg:grid-cols-[1.15fr_.85fr] lg:items-end lg:gap-16">
          <h2 className="max-w-[720px] font-display text-[42px] font-semibold leading-[.96] tracking-[-.055em] sm:text-[58px]">
            Same architecture.
            <span className="block text-[#aaa9a5]">A completely new feeling.</span>
          </h2>
          <p className="max-w-[480px] text-sm leading-7 text-muted sm:text-[15px]">A render should do more than look impressive. It should help someone understand the idea, feel the atmosphere, and say yes to the design.</p>
        </div>

        <div className="mt-12 flex flex-wrap gap-2 border-b border-hairline pb-4">
          {stories.map((item) => {
            const active = item.id === story.id;
            return <button key={item.id} type="button" onClick={() => setActiveId(item.id)} aria-pressed={active} className={`flex items-center gap-3 rounded-full px-4 py-2.5 text-xs transition ${active ? "bg-primary text-white shadow-[0_8px_20px_-12px_rgba(0,0,0,.8)]" : "bg-surface text-muted hover:bg-surface-2"}`}><span className={`font-mono text-[8px] ${active ? "text-white/50" : "text-faint"}`}>{item.number}</span>{item.tab}</button>;
          })}
          <span className="ml-auto hidden items-center gap-2 text-[9px] uppercase tracking-[.14em] text-faint sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-[#69be8a]"/> Real project studies</span>
        </div>

        <div key={story.id} className="mt-5 grid overflow-hidden rounded-[22px] border border-hairline bg-[#f6f5f2] shadow-[0_34px_90px_-54px_rgba(20,20,18,.55)] lg:grid-cols-[1.45fr_.55fr]">
          <div className="min-h-[380px] bg-white sm:min-h-[560px] lg:min-h-[650px]">
            <CompareSlider
              before={<div className="relative h-full w-full bg-white"><Image src={story.before} alt={`${story.tab} original architectural drawing`} fill sizes="(min-width:1024px) 850px,100vw" className="object-cover" style={{ objectPosition: story.position, transform: story.beforeTransform }} /></div>}
              after={<div className="relative h-full w-full"><Image src={story.after} alt={`${story.tab} photorealistic Renvia visualization`} fill sizes="(min-width:1024px) 850px,100vw" className="object-cover" style={{ objectPosition: story.position }} /></div>}
              beforeLabel="Original design"
              afterLabel="Renvia vision"
              initialPosition={43}
              fill
            />
          </div>

          <div className="flex flex-col p-6 sm:p-8 lg:p-9">
            <div className="flex items-center justify-between"><span className="font-mono text-[9px] text-faint">STORY / {story.number}</span><span className="rounded-full border border-hairline-strong bg-white px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[.12em] text-faint">Exterior study</span></div>
            <h3 className="mt-10 font-display text-2xl font-semibold leading-[1.05] tracking-[-.04em] sm:text-[30px]">{story.title}</h3>
            <p className="mt-4 text-xs leading-6 text-muted">{story.brief}</p>

            <div className="mt-9 border-t border-hairline pt-6">
              <p className="text-[9px] font-semibold uppercase tracking-[.14em] text-faint">The creative direction</p>
              <div className="mt-3 flex flex-wrap gap-2">{story.changed.map((item) => <span key={item} className="rounded-full bg-white px-3 py-2 text-[10px] text-secondary shadow-sm">+ {item}</span>)}</div>
            </div>

            <div className="mt-7 border-t border-hairline pt-6">
              <p className="text-[9px] font-semibold uppercase tracking-[.14em] text-faint">What Renvia protected</p>
              <ul className="mt-3 space-y-2.5">{story.preserved.map((item) => <li key={item} className="flex items-center gap-2.5 text-[11px] text-secondary"><span className="grid h-4 w-4 place-items-center rounded-full border border-[#9ecbad] bg-[#eef8f1] text-[8px] text-[#388356]">✓</span>{item}</li>)}</ul>
            </div>

            <div className="mt-auto pt-10"><p className="font-display text-lg font-semibold tracking-[-.025em]">New expression.<br/>Same design intent.</p><a href={SIGNUP_URL} className="group mt-5 inline-flex items-center gap-3 text-xs font-semibold">Explore your own direction <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-white transition-transform group-hover:translate-x-1">→</span></a></div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between text-[9px] text-faint"><span>Drag the divider to reveal the transformation</span><span className="hidden sm:inline">Structure preserved by default</span></div>
      </div>
    </section>
  );
}
