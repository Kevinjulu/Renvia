import { Navbar } from "@/components/nav/Navbar";
import { Hero } from "@/components/hero/Hero";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { CapabilityGrid } from "@/components/sections/CapabilityGrid";
import { StudioShowcase } from "@/components/studio-showcase/StudioShowcase";
import { Pricing } from "@/components/sections/Pricing";
import { FAQ } from "@/components/sections/FAQ";
import { Footer } from "@/components/footer/Footer";

export default function HomePage() {
  return (
    <main>
      <Navbar />
      <Hero />
      <HowItWorks />
      <CapabilityGrid />
      <StudioShowcase />
      <Pricing />
      <FAQ />
      <Footer />
    </main>
  );
}
