export function CompetitiveGapDashboard() {
  const cards = [
    ['SEO Fix Queue', 'Approval-based SEO fixes'],
    ['WordPress Publish', 'Draft/update approved content'],
    ['Local SEO v1', 'GBP checklist, citations, local pages'],
    ['AI Visibility', 'Credit-based query tracking'],
    ['Safe Authority', 'Risk-scored opportunities'],
    ['Reports + Demo', 'White-label and proof mode'],
  ];
  return <div className="grid grid-cols-3 gap-4">{cards.map(([title, body]) => <div className="card" key={title}><h3>{title}</h3><p>{body}</p><button>View next action</button></div>)}</div>;
}
