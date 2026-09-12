export type SenukeFieldGuideOption = { value: string; label?: string; description?: string };

export type SenukeFieldGuideContent = {
  key: string;
  label: string;
  meaning: string;
  whatToEnter: string;
  usedFor: string;
  required?: boolean;
  value?: string;
  options?: SenukeFieldGuideOption[];
};

const fieldKnowledge: Record<string, Pick<SenukeFieldGuideContent, "meaning" | "whatToEnter" | "usedFor">> = {
  project_name: { meaning: "The internal campaign name used throughout the workspace.", whatToEnter: "Use a short, recognizable name that the team and client will understand.", usedFor: "Project navigation, reports, tasks, notifications, approvals, and activity history." },
  business_name: { meaning: "The public name of the business represented by this project or client.", whatToEnter: "Use the official customer-facing business name.", usedFor: "Generated content, reports, proposals, business identity, and local signals." },
  website_url: { meaning: "The primary website connected to this work.", whatToEnter: "Enter the full live URL, including https://. It is required for an Existing Website.", usedFor: "Site Analysis, page mapping, keyword gaps, technical findings, publishing, and reporting." },
  website_status: { meaning: "Defines whether a live site exists and which website workflow applies.", whatToEnter: "Choose the option matching the website’s actual current state.", usedFor: "Determines whether crawling is required and whether SEnuke prioritizes analysis or new-site planning." },
  industry_niche: { meaning: "The commercial category, specialty, or market the business operates in.", whatToEnter: "Be specific about what the business sells and the audience it serves.", usedFor: "Opportunities, competitors, keyword themes, content ideas, Strategy, and execution priorities." },
  business_location: { meaning: "The business’s primary physical location, separate from where it wants to rank.", whatToEnter: "Provide the accurate country, state/province, city, and optional address details.", usedFor: "Business identity, Local SEO, Google Business Profile, citations, and reports." },
  target_location: { meaning: "The markets where the project wants to rank, advertise, or acquire customers.", whatToEnter: "Add every relevant city, region, state/province, or country. Multiple markets are supported.", usedFor: "Localized keywords, competitors, content, landing pages, Local SEO, Strategy, and execution." },
  primary_goal: { meaning: "The single main outcome that defines success for this project.", whatToEnter: "Choose exactly one goal that should take priority over all other outcomes.", usedFor: "Recommendation scoring, keyword intent, Strategy, Next Best Action, tasks, KPIs, and reports." },
  secondary_goals: { meaning: "Supporting outcomes that influence the plan without replacing the Primary Goal.", whatToEnter: "Select any additional outcomes that genuinely matter to this project.", usedFor: "Strategy depth, execution priorities, recommendations, and reporting context." },
  target_audience: { meaning: "The people or organizations most likely to need and buy the offer.", whatToEnter: "Describe who they are, where they are, their problem, and what decision they are trying to make.", usedFor: "Opportunity fit, search intent, keyword suggestions, messaging, content, funnels, and Strategy." },
  products_services: { meaning: "The products, services, or solutions this project will promote.", whatToEnter: "List clear customer-facing offers rather than broad capabilities.", usedFor: "Commercial keywords, opportunity recommendations, page plans, content, CTAs, and execution tasks." },
  current_offer_cta: { meaning: "The action or offer presented to a prospective customer.", whatToEnter: "Describe the offer and the action users should take, such as book, call, request a quote, or buy.", usedFor: "Conversion recommendations, landing pages, lead magnets, content, and funnel planning." },
  known_competitors: { meaning: "Businesses competing for the same audience, demand, or search visibility.", whatToEnter: "Add recognizable company names or domains, separated by commas.", usedFor: "Competitive analysis, content gaps, keyword gaps, authority opportunities, and Strategy." },
  current_target_keywords: { meaning: "Keywords already important to the business or currently being targeted.", whatToEnter: "Add relevant phrases only; SEnuke will validate intent, demand, difficulty, and duplication later.", usedFor: "Keyword Intelligence, cannibalization checks, content mapping, and Strategy." },
  tone_preference: { meaning: "The voice and communication style generated content should follow.", whatToEnter: "Describe the tone in practical terms, such as professional, clear, friendly, or authoritative.", usedFor: "AI content, proposals, reports, lead magnets, social content, and publishing." },
  preferred_output: { meaning: "The deliverables the project expects SEnuke to help produce.", whatToEnter: "Select the assets that are actually required for this project.", usedFor: "Workflow planning, Strategy scope, task generation, and delivery expectations." },
  publishing_preference: { meaning: "The preferred platform or method for delivering approved content and changes.", whatToEnter: "Choose the real publishing environment, or select a manual workflow if no integration is available.", usedFor: "Integration guidance, approval requirements, validation, publishing, and verification." },
  cms_platform: { meaning: "The content management or ecommerce platform used by the website.", whatToEnter: "Enter the platform currently in use, such as WordPress, Shopify, Webflow, or a custom site.", usedFor: "Integration recommendations, implementation instructions, publishing, and technical tasks." },
  client_name: { meaning: "The main contact associated with the Agency client.", whatToEnter: "Enter the person’s real name so invitations, approvals, and communication are clear.", usedFor: "Client communication, access, approvals, reports, proposals, and activity history." },
  client_email: { meaning: "The client contact’s primary email address.", whatToEnter: "Use a monitored business email address.", usedFor: "Invitations, report delivery, approval requests, and client notifications." },
  client_goals: { meaning: "The outcomes the Agency client expects from the engagement.", whatToEnter: "Capture measurable expectations and important business priorities in the client’s language.", usedFor: "Project defaults, proposals, Strategy, reporting, approvals, and recommendations." },
  primary_competitors: { meaning: "Businesses competing with this client for customers or visibility.", whatToEnter: "Add names or domains separated by commas or new lines.", usedFor: "Inherited project competitor research, opportunity scoring, keyword gaps, and Strategy." },
  primary_keywords: { meaning: "Important phrases already known by the client or agency.", whatToEnter: "Add relevant phrases as starting evidence; they will still be analyzed before approval.", usedFor: "Inherited Keyword Intelligence context and project recommendations." },
  preferred_language: { meaning: "The default language used for client deliverables and recommendations.", whatToEnter: "Choose the language the target audience and client team primarily use.", usedFor: "Keyword research, AI output, reports, content, and publishing." },
  time_zone: { meaning: "The client’s operating time zone.", whatToEnter: "Choose the time zone used for deadlines, notifications, reports, and scheduled activity.", usedFor: "Scheduling, due dates, notifications, reports, and team coordination." },
};

const optionMeaning: Record<string, string> = {
  "Existing Website": "A live website exists, so Site Analysis and page-level evidence can be used.",
  "New Website Required": "No live site is required; SEnuke prioritizes keywords, architecture, pages, content, and launch planning.",
  "Website Planned": "A website is expected later, so planning continues without requiring a crawl.",
  "No Website Required": "The project can proceed through relevant non-website channels and deliverables.",
  Beginner: "Provides more explanation and guided manual steps.",
  Intermediate: "Balances guidance with faster execution choices.",
  Advanced: "Assumes stronger domain knowledge and surfaces more detailed controls.",
};

export function normalizeFieldGuideKey(label: string) {
  const normalized = label.toLowerCase().replace(/\([^)]*\)/g, "").replace(/\*/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const aliases: Record<string, string> = {
    project_name: "project_name", business_name: "business_name", contact_name: "client_name", email_address: "client_email",
    website_url: "website_url", industry_niche: "industry_niche", business_location: "business_location", target_markets: "target_location",
    primary_business_goal: "primary_goal", business_description: "business_description", target_audience: "target_audience",
    main_products_services: "products_services", primary_competitors: "primary_competitors", primary_keywords: "primary_keywords",
    brand_voice_tone: "tone_preference", preferred_language: "preferred_language", time_zone: "time_zone",
  };
  return aliases[normalized] ?? normalized;
}

export function createFieldGuide(input: { key?: string; label: string; help?: string; required?: boolean; value?: string; options?: (string | SenukeFieldGuideOption)[] }): SenukeFieldGuideContent {
  const key = input.key || normalizeFieldGuideKey(input.label);
  const known = fieldKnowledge[key];
  const options = input.options?.map((option) => typeof option === "string" ? { value: option, description: optionMeaning[option] } : option);
  return {
    key,
    label: input.label.replace(/\s*\*\s*$/, ""),
    meaning: known?.meaning ?? input.help ?? "This information becomes part of the saved project or client context.",
    whatToEnter: known?.whatToEnter ?? "Enter the most accurate information currently available. Avoid guesses that could weaken later recommendations.",
    usedFor: known?.usedFor ?? "Relevant recommendations, AI guidance, workflow decisions, tasks, and reporting.",
    required: input.required,
    value: input.value,
    options,
  };
}

export default function SenukeFieldGuide({ guide, contextLabel, onSelectOption }: { guide: SenukeFieldGuideContent; contextLabel?: string; onSelectOption?: (value: string) => void }) {
  return (
    <aside className="h-fit overflow-hidden rounded-xl border border-brand-100 bg-white shadow-sm xl:sticky xl:top-20">
      <div className="border-b border-brand-100 bg-gradient-to-br from-brand-50 via-white to-emerald-50 px-5 py-4">
        <div className="text-xs font-black uppercase tracking-[0.12em] text-brand-700">SEnuke field guide</div>
        <div className="mt-1 flex items-center gap-2"><h2 className="font-black text-slate-950">{guide.label}</h2>{guide.required && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-700">Required</span>}</div>
        {contextLabel && <p className="mt-1 text-xs font-semibold text-slate-500">{contextLabel}</p>}
      </div>
      <div className="space-y-4 p-5 text-sm leading-6 text-slate-600">
        <section><div className="text-[11px] font-black uppercase tracking-wide text-slate-400">What this field means</div><p className="mt-1">{guide.meaning}</p></section>
        <section className="rounded-xl border border-amber-100 bg-amber-50 p-3"><div className="text-[11px] font-black uppercase tracking-wide text-amber-700">What to enter</div><p className="mt-1 text-amber-950">{guide.whatToEnter}</p></section>
        <section><div className="text-[11px] font-black uppercase tracking-wide text-brand-700">How SEnuke uses it</div><p className="mt-1">{guide.usedFor}</p></section>
        {guide.value?.trim() && <section className="rounded-lg bg-slate-50 p-3"><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Current value</div><div className="mt-1 break-words font-bold text-slate-800">{guide.value}</div></section>}
        {guide.options && guide.options.length > 0 && <section><div className="text-[11px] font-black uppercase tracking-wide text-slate-400">Available options</div><div className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">{guide.options.map((option) => <button key={option.value} type="button" disabled={!onSelectOption} onClick={() => onSelectOption?.(option.value)} className={`block w-full rounded-lg border p-3 text-left ${guide.value === option.value ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white"}`}><span className="text-xs font-bold text-slate-900">{option.label || option.value}</span>{option.description && <span className="mt-1 block text-[11px] leading-5 text-slate-500">{option.description}</span>}</button>)}</div></section>}
      </div>
    </aside>
  );
}
