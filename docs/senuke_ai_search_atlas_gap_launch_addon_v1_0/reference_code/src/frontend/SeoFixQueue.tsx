export function SeoFixQueue({ items }: { items: any[] }) {
  return <section>
    <h2>SEO Fix Queue</h2>
    <p>Review and approve the highest-impact fixes first.</p>
    {items.map(item => <div className="fix-row" key={item.id}>
      <strong>{item.issueType}</strong><span>{item.affectedUrl}</span><span>{item.severity}</span><span>{item.riskLevel}</span>
      <button>Review Fix</button>
    </div>)}
  </section>;
}
