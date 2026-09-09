export function DashboardHero({ onCreate }: { onCreate: () => void }) {
  return <section className="dashboard-hero">
    <div className="dashboard-hero-copy"><p>FROM SKETCH TO REALITY</p><h2>Visualize a better tomorrow</h2><span>Upload your sketch, model, or photo and let Renvia transform it into photorealistic renders — preserving your design, just enhancing the possibilities.</span><div><button type="button" className="dashboard-primary-button" onClick={onCreate}><b>＋</b> Create new project</button><button type="button" className="dashboard-secondary-button"><b>▷</b> Watch how it works</button></div></div>
    <div className="dashboard-hero-visual" aria-label="Architectural sketch compared with a photorealistic render"><img src="/dashboard/lakeside-house-sketch.png" alt="Modern house architectural sketch" className="dashboard-hero-sketch"/><img src="/dashboard/lakeside-house.jpg" alt="Photorealistic modern house render" className="dashboard-hero-render"/><span className="dashboard-compare-handle">‹ ›</span><em>Ideas become reality</em></div>
  </section>;
}
