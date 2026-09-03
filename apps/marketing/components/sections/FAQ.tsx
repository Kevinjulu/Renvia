const FAQS = [
  {
    question: "How does Renvia preserve my geometry?",
    answer:
      "Renvia treats your uploaded geometry as a fixed constraint. Generation only changes materials, lighting, and surrounding context — walls, window positions, and proportions are never redrawn or reinterpreted.",
  },
  {
    question: "What file formats can I upload?",
    answer:
      "Common 3D export formats (OBJ, FBX, glTF), flat sketches, and PNG, JPEG, or WEBP photos of physical models or elevations. If Renvia can read the geometry, it can render on top of it.",
  },
  {
    question: "Can I use AutoCAD exports?",
    answer:
      "Yes — export your AutoCAD drawing as a flat image or a supported 3D format and upload it directly. Renvia locks onto the exported geometry the same way it does with any other source.",
  },
  {
    question: "How do rendering credits work?",
    answer:
      "Each render variation uses one credit. Your plan includes a monthly credit allowance, and unused credits don't roll over — upgrade any time if you need more.",
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
            <p className="text-xs font-medium uppercase tracking-wide text-secondary">FAQ</p>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-primary sm:text-4xl">
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
