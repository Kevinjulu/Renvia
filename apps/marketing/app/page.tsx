import { Navbar } from "@/components/nav/Navbar";
import { Hero } from "@/components/hero/Hero";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { StudioShowcase } from "@/components/studio-showcase/StudioShowcase";
import { Pricing } from "@/components/sections/Pricing";
import { FAQ } from "@/components/sections/FAQ";
import { Footer } from "@/components/footer/Footer";
import { TransformationGallery } from "@/components/sections/TransformationGallery";

export default function HomePage() {
  return (
    <main>
      <Navbar />
      <Hero />
      <HowItWorks />
      <StudioShowcase />
      <TransformationGallery />
      <Pricing />
      <FAQ />
      <Footer />
    </main>
  );
}
