import type { KeywordIdea } from "../types.js";

export default function KeywordEvidenceTable({ ideas }: { ideas: KeywordIdea[] }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-sm">
    <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-500"><tr>{["Keyword / evidence", "Search intent", "Relevance", "Verified monthly volume", "Organic difficulty", "Current ranking", "Growth opportunity", "Trend", "Recommended use", "Paid details"].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
    <tbody>{ideas.map(idea => <tr key={idea.id} className="border-t border-charcoal-100 align-top">
      <td className="px-4 py-3"><strong>{idea.keyword}</strong><div className="mt-1 text-xs text-brand-700">{idea.classification ?? "Strategic Supporting Topic"}</div><div className="mt-1 text-xs text-charcoal-500">{idea.evidence?.provider ?? "No verified source"} · {idea.evidence?.market ?? "Market unverified"} · {idea.evidence?.language ?? "Language unverified"}<br />{idea.evidence?.checkedAt ? new Date(idea.evidence.checkedAt).toLocaleString() : "Date unverified"}</div></td>
      <td className="px-4 py-3">{idea.intent ?? "Unclassified"}</td>
      <td className="px-4 py-3">{idea.relevance ?? "Needs review"}</td>
      <td className="px-4 py-3">{idea.avgMonthlySearches == null ? "No verified data" : idea.avgMonthlySearches.toLocaleString()}</td>
      <td className="px-4 py-3">{idea.competitionIndex ?? "No verified data"}<div className="text-xs text-charcoal-500">{idea.evidence?.difficultyMarket}</div></td>
      <td className="px-4 py-3">{idea.currentRanking == null ? "Not available" : `${idea.currentRanking.toFixed(1)} (GSC average)`}</td>
      <td className="px-4 py-3">{idea.growthOpportunity == null ? "Not scored" : `${idea.growthOpportunity}/100`}</td>
      <td className="px-4 py-3">{idea.trend?.length ? <details><summary>Monthly history</summary>{idea.trend.map((month, index) => <div key={index}>{month.year}-{month.month}: {month.search_volume == null ? "No verified data" : month.search_volume.toLocaleString()}</div>)}</details> : "Not available"}</td>
      <td className="px-4 py-3">{idea.recommendedUse ?? "Review supporting topic"}</td>
      <td className="px-4 py-3"><details><summary className="cursor-pointer">Paid metrics</summary><div>CPC: {idea.cpc == null ? "No verified data" : `${idea.currency ?? ""} ${idea.cpc.toFixed(2)}`}</div><div>Paid competition: {idea.competition ?? "No verified data"}</div></details></td>
    </tr>)}</tbody>
  </table>{!ideas.length && <p className="p-5 text-sm text-charcoal-600">No relevant provider keywords were returned. Review the seed and business facts before researching again.</p>}</div>;
}
