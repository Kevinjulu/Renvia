const FAQS = [
  {
    question: "How does Renvia preserve my geometry?",
    answer:
      "Renvia treats your uploaded source as the architectural authority. Strict source fidelity adds Canny guidance and protected geometry controls for silhouette, roof, openings, massing, and camera. AI output still needs a final design review before client delivery.",
  },
  {
    question: "What file formats can I upload?",
    answer:
      "PNG, JPEG, and WEBP elevations, sketches, model screenshots, and site photos. Export CAD or 3D work to one of those image formats before uploading.",
  },
  {
    question: "Can I use AutoCAD exports?",
    answer:
      "Yes — export the drawing as PNG, JPEG, or WEBP, then upload it as the source image. Native DWG, OBJ, FBX, and glTF import are not available yet.",
  },
  {
    question: "How do rendering credits work?",
    answer:
      "New accounts receive 25 one-time welcome credits. Standard renders and edits use 1 credit; Strict source-fidelity renders use 2. Failed renders are refunded. Paid credit packs and subscriptions will be available once checkout is connected.",
  },
  {
    question: "Can I generate multiple variations?",
    answer:
      "Yes — choose how many variations to generate at once and compare them side by side on the canvas before picking a favorite.",
  },
];

export function FAQ() {
  return (
    <section id="faq" className="border-t border-hairline px-6 py-20 sm:py-24">
      <div className="mx-auto max-w-content">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-4 lg:gap-6">
          <div>
            <h2 className="font-display text-3xl font-semibold tracking-tight text-primary sm:text-4xl">
              Frequently
              <br />
              asked questions.
            </h2>
          </div>

          <div className="lg:col-span-3">
            {FAQS.map((faq) => (
              <details key={faq.question} className="group border-t border-hairline py-5 first:border-t-0">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-left">
                  <span className="text-sm font-medium text-primary">{faq.question}</span>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    className="shrink-0 text-secondary transition-transform duration-200 group-open:rotate-45"
                    aria-hidden="true"
                  >
                    <path d="M7 1V13M1 7H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </summary>
                <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-muted">{faq.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
