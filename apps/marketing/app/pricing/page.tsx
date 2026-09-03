import { Navbar } from "@/components/nav/Navbar";
import { Pricing } from "@/components/sections/Pricing";
import { FAQ } from "@/components/sections/FAQ";
import { Footer } from "@/components/footer/Footer";

export default function PricingPage() {
  return (
    <main>
      <Navbar />
      <div className="pt-24">
        <Pricing />
      </div>
      <FAQ />
      <Footer />
    </main>
  );
}
