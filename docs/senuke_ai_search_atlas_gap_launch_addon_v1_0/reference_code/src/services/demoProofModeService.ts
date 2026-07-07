export function createDemoProject(template: 'existing_site_seo'|'local_business'|'new_business_launch'|'agency_client'|'ecommerce_export') {
  return {
    template,
    isDemo: true,
    warning: 'Sample data only. Do not present as real client results.',
    includedAssets: ['sample audit', 'sample strategy', 'sample execution plan', 'sample report', 'before/after page example'],
  };
}
