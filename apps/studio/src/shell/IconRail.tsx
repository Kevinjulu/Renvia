import { Link, useLocation } from "react-router-dom";

const nav = [["Home", "/dashboard", "home"], ["Projects", "/dashboard", "folder"], ["Studio", "", "spark"], ["Templates", "/templates", "grid"], ["Assets", "/assets", "image"], ["AI Tools", "/ai-tools", "wand"]] as const;

function Icon({ name }: { name: string }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", "aria-hidden": true } as const;
  if (name === "home") return <svg {...common}><path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></svg>;
  if (name === "folder") return <svg {...common}><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z" /></svg>;
  if (name === "spark" || name === "wand") return <svg {...common}><path d="m12 2 1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5Z" /><path d="m18 15 .8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8Z" /></svg>;
  if (name === "grid") return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>;
  return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="9" r="2" /><path d="m3 17 5-5 4 4 3-3 6 6" /></svg>;
}

export function IconRail() {
  const location = useLocation();
  return <aside className="studio-sidebar">
    <div className="studio-brand"><span>R E N V I A</span><b>Studio</b></div>
    <nav>{nav.map(([label, href, icon]) => {
      const active = label === "Studio" || Boolean(href && location.pathname === href);
      const content = <><Icon name={icon} /><span>{label}</span></>;
      return href ? <Link key={label} className={active ? "active" : ""} to={href}>{content}</Link> : <button key={label} className="active" type="button">{content}</button>;
    })}<i /><Link to="/team"><Icon name="folder" /><span>Team</span></Link><Link to="/settings"><Icon name="grid" /><span>Settings</span></Link></nav>
    <div className="studio-upgrade"><strong><span>◆</span> Upgrade to Pro</strong><p>Faster renders, higher resolution and more team features.</p><button type="button">Upgrade <span>→</span></button></div>
    <div className="studio-profile"><span>KJ</span><p><strong>Kevin Julu</strong><small>Free plan</small></p><button type="button">⌄</button></div>
  </aside>;
}
