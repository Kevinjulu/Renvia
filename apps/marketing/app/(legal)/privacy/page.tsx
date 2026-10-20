import type { Metadata } from "next";
import type { ReactNode } from "react";
import { brand } from "@renvia/brand";
import { Footer } from "@/components/footer/Footer";
import { Navbar } from "@/components/nav/Navbar";

/** Where privacy requests go. Change it here if the mailbox moves. */
const PRIVACY_EMAIL = "privacy@ramahstudio.com";
const LAST_UPDATED = "20 October 2026";

export const metadata: Metadata = {
  title: `Privacy Notice | ${brand.name}`,
  description: `How ${brand.name} collects, uses, shares and protects personal data, and the rights you have over it.`,
};

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-32 border-t border-hairline pt-10">
      <h2 className="font-display text-2xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-4 space-y-4 text-base leading-relaxed text-muted [&_strong]:font-medium [&_strong]:text-primary [&_li]:pl-1">{children}</div>
    </section>
  );
}

const SECTIONS = [
  ["who-we-are", "Who we are"],
  ["what-we-collect", "What we collect"],
  ["why", "Why we use it, and on what basis"],
  ["free-credits", "Free credits and fraud prevention"],
  ["sharing", "Who we share it with"],
  ["transfers", "Transfers outside Kenya"],
  ["retention", "How long we keep it"],
  ["rights", "Your rights"],
  ["cookies", "Cookies and browser storage"],
  ["security", "Security"],
  ["children", "Children"],
  ["changes", "Changes and contact"],
] as const;

export default function PrivacyPage() {
  const mail = <a href={`mailto:${PRIVACY_EMAIL}`} className="font-medium text-primary underline underline-offset-2">{PRIVACY_EMAIL}</a>;
  return (
    <>
      <Navbar />
      <main className="px-6 pb-24 pt-36">
        <div className="mx-auto max-w-3xl">
          <header>
            <p className="text-sm text-faint">Last updated {LAST_UPDATED}</p>
            <h1 className="mt-3 font-display text-5xl font-semibold tracking-[-0.045em]">Privacy Notice</h1>
            <p className="mt-6 text-lg leading-relaxed text-muted">
              This notice explains what personal data {brand.name} collects when you use our website and Studio, why we use it, who we share it with, how long we keep it, and the rights you have under Kenya&apos;s Data Protection Act, 2019.
            </p>
            <nav aria-label="On this page" className="mt-8 rounded-2xl border border-hairline bg-white p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-faint">On this page</p>
              <ol className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
                {SECTIONS.map(([id, title], index) => (
                  <li key={id}><a href={`#${id}`} className="text-muted hover:text-primary">{index + 1}. {title}</a></li>
                ))}
              </ol>
            </nav>
          </header>

          <div className="mt-12 space-y-10">
            <Section id="who-we-are" title="1. Who we are">
              <p>
                {brand.legalName} (&ldquo;{brand.name}&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;), formerly known as Renvia, provides an online studio for turning architectural drawings and photos into rendered images. We are the data controller for the personal data described here. For anything about your data, contact us at {mail}.
              </p>
            </Section>

            <Section id="what-we-collect" title="2. What we collect">
              <ul className="list-disc space-y-2 pl-5">
                <li><strong>Account details:</strong> your email address and whether it has been verified, and your name and profile picture if you sign in with Google. Passwords are held by our sign-in provider, never by us.</li>
                <li><strong>Your work:</strong> the images you upload, the prompts and settings you use, the projects you create, and the images we generate for you.</li>
                <li><strong>Credits, plans and payments:</strong> your plan, your credit balance and its history, and records of purchases and refunds. Card and mobile-money details are entered with our payment providers; we never receive or store them.</li>
                <li><strong>Usage and technical data:</strong> when you were last active, error reports from the Studio, and request logs kept by our hosting provider.</li>
                <li><strong>Fraud-prevention signals</strong> (see section 4): a random identifier our Studio keeps in your browser, and the network your connection comes from (only the first part of your IP address). We store both only in a scrambled, one-way form.</li>
                <li><strong>Beta testing:</strong> if you join a beta programme, the feedback, screenshots and annotations you send us.</li>
                <li><strong>Messages:</strong> anything you send us by email or through support.</li>
              </ul>
            </Section>

            <Section id="why" title="3. Why we use it, and on what basis">
              <ul className="list-disc space-y-2 pl-5">
                <li><strong>To provide the Studio</strong>, run your renders and keep your projects: necessary to perform our contract with you.</li>
                <li><strong>To bill you and keep accurate credit records:</strong> necessary for the contract, and to meet our accounting and tax obligations.</li>
                <li><strong>To keep the service secure and prevent abuse</strong>, including people creating many accounts to collect free credits: our legitimate interest in protecting the service and keeping free credits available to genuine users.</li>
                <li><strong>To fix problems and improve the Studio</strong> from error reports and usage: our legitimate interest in a reliable product.</li>
                <li><strong>To contact you</strong> about your account, beta programmes you join, or important changes: the contract, or your consent where the law requires it.</li>
              </ul>
              <p>We do not sell your personal data, and we do not use it for advertising.</p>
            </Section>

            <Section id="free-credits" title="4. Free credits and fraud prevention">
              <p>
                Free-plan accounts receive a monthly allowance of credits. To keep that allowance for genuine users, we may check whether an account is eligible before granting it. The checks look at:
              </p>
              <ul className="list-disc space-y-2 pl-5">
                <li>whether your email address is verified;</li>
                <li>whether the same mailbox (ignoring dots and &ldquo;+&rdquo; labels) already received free credits on another account;</li>
                <li>whether the email comes from a disposable-inbox service;</li>
                <li>whether the same browser was used by other accounts that received free credits;</li>
                <li>whether an unusual number of new accounts appeared from the same network in a short time.</li>
              </ul>
              <p>
                The browser identifier is a random value our Studio creates and keeps in your browser&apos;s local storage; it says nothing about you or your device. For the network, we use only the first part of your IP address (for example 41.90.12.x). Both are converted with a secret key into a code that cannot be turned back into the original, and only that code is stored.
              </p>
              <p>
                <strong>What the checks can do.</strong> An account the checks flag is asked to complete a quick human check (Cloudflare Turnstile) or waits for a person on our team to review it. The checks never refuse free credits by themselves: only a staff member can deny them, and only after reviewing the account. A decision affects only the Free plan&apos;s monthly credits. It never removes credits you already have, credits you bought, a paid plan or your work, and it never stops you using the account. Shared networks such as offices, universities and mobile operators are normal, so network evidence alone never sends an account to review.
              </p>
              <p>
                <strong>Your say.</strong> If you think a decision about your free credits is wrong, email {mail}. A person will review it and can reverse it.
              </p>
            </Section>

            <Section id="sharing" title="5. Who we share it with">
              <p>We use service providers who process data on our behalf, only to run the service:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li><strong>Clerk</strong>: sign-in and account security.</li>
                <li><strong>Vercel</strong>: hosting of our website, Studio and servers.</li>
                <li><strong>Neon</strong>: our database.</li>
                <li><strong>Cloudflare</strong>: storage of your images (R2) and the human check (Turnstile).</li>
                <li><strong>fal.ai</strong>: the AI models that generate renders. Your images and prompts are sent to it to produce your results.</li>
                <li><strong>PayPal and Paystack</strong>: payments, when you buy a plan or credits.</li>
              </ul>
              <p>We may also disclose data where the law requires it, or to protect our rights, our users or the public.</p>
            </Section>

            <Section id="transfers" title="6. Transfers outside Kenya">
              <p>
                Our providers store and process data outside Kenya, including in the United States and the European Union. We use providers that commit to protecting personal data, and we transfer only what each needs to provide its service.
              </p>
            </Section>

            <Section id="retention" title="7. How long we keep it">
              <ul className="list-disc space-y-2 pl-5">
                <li><strong>Account, projects and images:</strong> for as long as your account is open. Uploads that nothing uses any more are deleted after a few days, and images you remove from your history are deleted after about a week.</li>
                <li><strong>Browser and network codes:</strong> network codes are deleted 30 days, and browser codes 180 days, after we last saw them, and straight away when you delete your account.</li>
                <li><strong>Credit and payment records:</strong> kept as long as needed for accounting, tax and dispute purposes.</li>
                <li><strong>Free-credit eligibility records and your email history:</strong> kept after you delete your account, so that free credits can&apos;t be claimed again simply by re-registering. You can ask us to review this.</li>
                <li><strong>Beta feedback:</strong> screenshots are deleted after the programme&apos;s housekeeping period; written feedback is kept to improve the product.</li>
              </ul>
            </Section>

            <Section id="rights" title="8. Your rights">
              <p>Under the Data Protection Act, 2019, you have the right to:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>be told how your personal data is used (this notice);</li>
                <li>access the personal data we hold about you;</li>
                <li>object to our use of it, including for fraud prevention;</li>
                <li>have inaccurate or misleading data corrected;</li>
                <li>have data deleted where we no longer have a reason to keep it;</li>
                <li>not be subject to a decision based solely on automated processing that significantly affects you.</li>
              </ul>
              <p>
                To use any of these rights, email {mail}. We will reply within a reasonable time and may ask you to confirm your identity. If you are not satisfied, you can complain to the Office of the Data Protection Commissioner (ODPC) at <a href="https://www.odpc.go.ke" className="font-medium text-primary underline underline-offset-2">odpc.go.ke</a>.
              </p>
            </Section>

            <Section id="cookies" title="9. Cookies and browser storage">
              <p>
                We use cookies and similar storage that the service needs: our sign-in provider&apos;s session cookies, which keep you signed in; the random browser identifier described in section 4; and small settings the Studio remembers, such as layout preferences. The human check is provided by Cloudflare Turnstile, which may use its own storage to tell people from bots. We do not use advertising or tracking cookies.
              </p>
            </Section>

            <Section id="security" title="10. Security">
              <p>
                Connections to our services are encrypted. Images are stored privately and shared only through links that expire. Staff access to accounts is limited by role, and every change staff make is recorded. No system is perfectly secure, but we work to protect your data and will tell you and the authorities about a breach where the law requires it.
              </p>
            </Section>

            <Section id="children" title="11. Children">
              <p>Our services are for professionals and are not directed at children under 18. We do not knowingly collect data from children.</p>
            </Section>

            <Section id="changes" title="12. Changes and contact">
              <p>
                We will update this notice when our practices change and show the date at the top; for significant changes we will also tell you in the Studio or by email. Questions or requests: {mail}.
              </p>
            </Section>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
