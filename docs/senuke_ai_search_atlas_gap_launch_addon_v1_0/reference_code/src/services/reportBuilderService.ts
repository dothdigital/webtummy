export async function generateWhiteLabelReport(input: any) {
  if (!input.approvedSectionsOnly) throw new Error('Client-facing reports must use approved sections only.');
  return {
    title: `${input.clientName} SEO Opportunity Report`,
    sections: [
      'Executive Summary',
      'Top Opportunities',
      'SEO Fix Queue Summary',
      'Local SEO / AI Visibility / Authority Findings',
      'Prioritized Execution Plan',
      'Next 30 Days',
    ],
    exportFormats: ['pdf', 'docx'],
  };
}
