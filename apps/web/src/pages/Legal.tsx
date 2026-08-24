import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../components/Logo.js";
import privacyDocument from "../legal/privacy.html?raw";
import termsDocument from "../legal/terms.html?raw";
import { sanitizeHtml } from "../sanitize-html.js";

type LegalKind = "terms" | "privacy";

const LEGAL_PAGE = {
  privacy: {
    title: "Privacy Policy",
    eyebrow: "Privacy",
    description: "How SEnuke AI collects, uses, discloses and protects personal information across our website, software, AI workflows, integrations and subscription services.",
    canonical: "https://www.senuke.com/privacy",
    source: privacyDocument,
  },
  terms: {
    title: "Terms and Conditions",
    eyebrow: "Legal",
    description: "Terms governing access to and use of SEnuke AI, including subscriptions, AI Capacity, workspaces, agency use, AI-generated outputs and third-party integrations.",
    canonical: "https://www.senuke.com/terms",
    source: termsDocument,
  },
} as const;

function extractMain(documentSource: string) {
  return documentSource.match(/<main>([\s\S]*?)<\/main>/i)?.[1] ?? "";
}

export default function Legal({ kind }: { kind: LegalKind }) {
  const page = LEGAL_PAGE[kind];
  const legalContent = sanitizeHtml(extractMain(page.source));

  useEffect(() => {
    const previousTitle = document.title;
    const descriptionMeta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = descriptionMeta?.content;
    const existingCanonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const previousCanonical = existingCanonical?.href;
    const canonical = existingCanonical ?? document.head.appendChild(document.createElement("link"));

    canonical.rel = "canonical";
    canonical.href = page.canonical;
    document.title = `${page.title} | SEnuke AI`;
    if (descriptionMeta) descriptionMeta.content = page.description;

    return () => {
      document.title = previousTitle;
      if (descriptionMeta && previousDescription !== undefined) descriptionMeta.content = previousDescription;
      if (!existingCanonical) canonical.remove();
      else if (previousCanonical) existingCanonical.href = previousCanonical;
    };
  }, [page.canonical, page.description, page.title]);

  return (
    <div className="min-h-screen bg-[#07111f] text-slate-100">
      <header className="sticky top-0 z-20 border-b border-[#203754] bg-[#07111f]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-6">
          <Link to="/" aria-label="SEnuke AI home"><Logo size={36} /></Link>
          <nav aria-label="Legal navigation" className="flex items-center gap-4 text-sm text-slate-300">
            <Link className="transition hover:text-white" to="/privacy">Privacy</Link>
            <Link className="transition hover:text-white" to="/terms">Terms</Link>
            <Link className="rounded-lg border border-cyan-400/40 px-3 py-2 font-semibold text-cyan-300 transition hover:bg-cyan-400/10" to="/login">Sign in</Link>
          </nav>
        </div>
      </header>

      <main>
        <div className="border-b border-[#203754] bg-gradient-to-b from-[#07111f] to-[#09182a]">
          <div className="mx-auto max-w-5xl px-5 py-14 sm:px-6 sm:py-20">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">{page.eyebrow}</p>
            <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-white sm:text-6xl">{page.title}</h1>
            <p className="mt-5 max-w-3xl text-base leading-7 text-slate-400 sm:text-lg">{page.description}</p>
            <p className="mt-5 text-sm text-slate-400">
              <strong className="text-slate-200">Effective:</strong> September 8, 2026
              <span className="mx-2" aria-hidden="true">•</span>
              <strong className="text-slate-200">Last Updated:</strong> August 19, 2026
            </p>
          </div>
        </div>

        <article
          className="mx-auto max-w-5xl px-5 py-10 text-[15px] leading-7 text-slate-300 sm:px-6 sm:py-14
            [&_.notice]:mb-10 [&_.notice]:rounded-2xl [&_.notice]:border [&_.notice]:border-cyan-400/25 [&_.notice]:bg-cyan-400/[0.07] [&_.notice]:px-5 [&_.notice]:py-4
            [&_a]:font-medium [&_a]:text-cyan-300 [&_a]:underline [&_a]:decoration-cyan-500/50 [&_a]:underline-offset-4 [&_a:hover]:text-cyan-200
            [&_h2]:mb-4 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:leading-tight [&_h2]:text-white sm:[&_h2]:text-2xl
            [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-white
            [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_p+p]:mt-4 [&_section]:border-t [&_section]:border-[#203754] [&_section]:py-8
            [&_strong]:font-semibold [&_strong]:text-slate-100 [&_ul]:mt-4 [&_ul]:space-y-2"
          dangerouslySetInnerHTML={{ __html: legalContent }}
        />
      </main>

      <footer className="border-t border-[#203754]">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 px-5 py-7 text-sm text-slate-500 sm:px-6">
          <span>© 2026 SEnuke.com</span>
          <span>SEnuke AI — The AI Growth Operating System</span>
        </div>
      </footer>
    </div>
  );
}
