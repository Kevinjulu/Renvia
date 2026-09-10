import Image from "next/image";
import { Logo } from "@/components/brand/Logo";
import { STUDIO_URL } from "@/lib/config";

const views: Array<[string, string, string]> = [
  ["1", "Front View", "/studio/elevation-front.jpg"],
  ["2", "Right View", "/studio/elevation-side-a.jpg"],
  ["3", "Back View", "/studio/elevation-rear.jpg"],
  ["4", "Left View", "/studio/elevation-side-b.jpg"],
];

function StudioFrame(){return <div className="overflow-hidden rounded-xl border border-hairline bg-white shadow-[0_30px_70px_-38px_rgba(0,0,0,.38)]">
  <div className="flex h-[440px] sm:h-[520px]">
    <aside className="hidden w-12 shrink-0 flex-col items-center border-r border-hairline py-4 sm:flex"><Logo wordmarkClassName="hidden"/><span className="mt-10 grid h-7 w-7 place-items-center rounded-md bg-primary text-xs text-white">✦</span>{['□','○','◇'].map(x=><span key={x} className="mt-4 text-xs text-faint">{x}</span>)}</aside>
    <aside className="w-[132px] shrink-0 border-r border-hairline p-3 sm:w-[180px]"><div className="flex items-center justify-between"><Logo wordmarkClassName="text-[9px]"/><span className="text-[10px] text-faint">Project ↕</span></div><p className="mt-7 text-[9px] font-semibold uppercase tracking-wide text-faint">Render from</p><div className="mt-2 rounded-lg border border-blueprint/20 bg-blueprint-soft p-3 text-[10px] text-blueprint">▧ &nbsp; Upload image</div><p className="mt-6 text-[9px] font-semibold uppercase tracking-wide text-faint">Style</p><div className="mt-2 rounded-md border border-hairline p-2 text-[10px]">🌄 Photorealistic</div><p className="mt-5 text-[9px] font-semibold uppercase tracking-wide text-faint">Resolution</p><div className="mt-2 flex gap-1">{['1K','2K','4K'].map((x,i)=><span key={x} className={`flex-1 rounded border p-1 text-center text-[9px] ${i===0?'border-blueprint text-blueprint':'border-hairline text-faint'}`}>{x}</span>)}</div><div className="mt-5 rounded-lg border border-hairline p-2 text-[9px] leading-4 text-muted">Create a modern house with wood accents and warm natural light.</div><div className="mt-5 rounded-md bg-primary py-2 text-center text-[10px] text-white">✦ Generate</div></aside>
    <div className="grid flex-1 grid-cols-1 gap-2 bg-[#fafafa] p-3 sm:grid-cols-2 sm:p-4">{views.map(([n,title,src])=><div key={n} className="relative overflow-hidden rounded-lg border border-hairline bg-white"><span className="absolute left-3 top-2 z-10 text-[9px] font-medium">{n}&nbsp; {title}</span><Image src={src} alt={title} fill sizes="(min-width:1024px) 30vw,50vw" className="object-contain p-5 pt-7"/></div>)}</div>
  </div>
  </div>}

export function StudioShowcase(){return <section className="px-5 pb-24 sm:px-8 sm:pb-32"><div className="mx-auto grid max-w-[1240px] items-center gap-12 lg:grid-cols-[1.45fr_.65fr] lg:gap-16"><StudioFrame/><div><h2 className="font-display text-4xl font-semibold leading-[.98] tracking-[-.05em] sm:text-5xl">A studio that<br/>feels like yours.</h2><p className="mt-5 text-sm leading-6 text-muted">A clean, infinite canvas to explore ideas, test materials, and visualize every angle. Designed for architects, interior designers, and creators who move fast.</p><ul className="mt-6 space-y-3 text-sm text-secondary">{['Upload up to 4 building views','AI-powered, photorealistic renders','Edit, compare, and iterate in one place','Export in high resolution'].map(x=><li key={x}>✓&nbsp;&nbsp;{x}</li>)}</ul><a href={STUDIO_URL} className="mt-7 inline-flex rounded-lg border border-hairline-strong bg-white px-5 py-3 text-xs font-medium shadow-sm">Explore Renvia Studio&nbsp; →</a></div></div></section>}
