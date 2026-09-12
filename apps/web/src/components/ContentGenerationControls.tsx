import type { ContentGenerationMode } from "../content-generation.js";

const OPTIONS: Array<{ value: ContentGenerationMode; title: string; description: string }> = [
  {
    value: "seo",
    title: "SEO-focused",
    description: "Search intent, keyword coverage, metadata, headings, links, FAQ, schema, and local relevance.",
  },
  {
    value: "general",
    title: "General website",
    description: "Clear brand messaging, audience value, service explanation, trust, and conversion.",
  },
  {
    value: "custom",
    title: "Custom",
    description: "Set your own priority while SENuke keeps the approved page structure and factual safeguards.",
  },
];

const SUGGESTIONS = [
  "Use plain language for a non-technical buyer",
  "Make the opening more direct and conversion-focused",
  "Add stronger local relevance without repeating city names",
  "Include useful buyer questions and concise answers",
];

export default function ContentGenerationControls({
  mode,
  instruction,
  onModeChange,
  onInstructionChange,
  compact = false,
  showInstruction = true,
}: {
  mode: ContentGenerationMode;
  instruction: string;
  onModeChange: (mode: ContentGenerationMode) => void;
  onInstructionChange: (instruction: string) => void;
  compact?: boolean;
  showInstruction?: boolean;
}) {
  const addSuggestion = (suggestion: string) => {
    if (instruction.toLowerCase().includes(suggestion.toLowerCase())) return;
    onInstructionChange([instruction.trim(), suggestion].filter(Boolean).join(". "));
  };

  return (
    <section className={`rounded-xl border border-cyan-200 bg-gradient-to-br from-cyan-50/80 via-white to-indigo-50/60 ${compact ? "p-4" : "p-5"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-cyan-700">Content direction</div>
          <h3 className="mt-1 text-base font-black text-slate-950">What should AI prioritize?</h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">SEO-focused is recommended. Your selection and instructions are attached to the generation request.</p>
        </div>
        {mode === "seo" && <span className="rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-black uppercase text-emerald-800">Recommended</span>}
      </div>

      <div className={`mt-4 grid gap-2 ${compact ? "md:grid-cols-3" : "lg:grid-cols-3"}`}>
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onModeChange(option.value)}
            className={`rounded-lg border p-3 text-left transition ${mode === option.value ? "border-cyan-500 bg-white shadow-sm ring-2 ring-cyan-100" : "border-slate-200 bg-white/70 hover:border-cyan-300"}`}
          >
            <span className="flex items-center gap-2 text-sm font-black text-slate-900">
              <span className={`grid h-4 w-4 place-items-center rounded-full border ${mode === option.value ? "border-cyan-600 bg-cyan-600" : "border-slate-300"}`}>
                {mode === option.value && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
              {option.title}
            </span>
            <span className="mt-1.5 block pl-6 text-[11px] leading-4 text-slate-500">{option.description}</span>
          </button>
        ))}
      </div>

      {showInstruction && <><label className="mt-4 block">
        <span className="text-xs font-black text-slate-800">{mode === "custom" ? "Your content instructions" : "Additional instructions (optional)"}</span>
        <textarea
          value={instruction}
          onChange={(event) => onInstructionChange(event.target.value)}
          rows={compact ? 3 : 4}
          maxLength={2000}
          className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
          placeholder={mode === "seo"
            ? "Example: Focus on Super Visa insurance in Brampton. Explain eligibility, required documents, coverage choices, and the next step. Do not make unsupported approval or price claims."
            : mode === "general"
              ? "Example: Use a reassuring, family-friendly tone and keep each section concise."
              : "Describe exactly what this content should cover, how it should sound, and anything AI must avoid."}
        />
        <span className="mt-1 block text-right text-[10px] font-semibold text-slate-400">{instruction.length}/2000</span>
      </label>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((suggestion) => (
          <button key={suggestion} type="button" onClick={() => addSuggestion(suggestion)} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-600 hover:border-cyan-300 hover:text-cyan-800">
            + {suggestion}
          </button>
        ))}
      </div></>}

      {mode === "seo" && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-cyan-100 pt-3 text-[10px] font-bold text-slate-600">
          <span>✓ One primary intent</span>
          <span>✓ One H1</span>
          <span>✓ Unique title & meta</span>
          <span>✓ FAQ & schema</span>
          <span>✓ No keyword stuffing</span>
          <span>✓ No invented claims</span>
        </div>
      )}
    </section>
  );
}
