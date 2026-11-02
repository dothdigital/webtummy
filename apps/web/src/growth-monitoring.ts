export function monitoringGuide(source: { key: string; status: string; restrictionReason: string | null; skipReason: string | null; recordCount: number }, projectId: string) {
 const query=`projectId=${encodeURIComponent(projectId)}`;
 const performance=`/projects/${projectId}/website/performance`;
 const guides:Record<string,[string,string,string,string]>={
  analytics:['Website visitors','Check that website tracking is connected and receiving visits.','Check visitor tracking',performance],
  search_console:['Google search traffic','Connect Google Search Console and allow its first results to arrive.','Check Search Console',performance+'#search-performance'],
  google_business_profile:['Google Business Profile','Connect your business profile and check that its details have been imported.','Check business profile',`/local-seo?${query}`],
  local_visibility:['Local search positions','Choose the location and search term you want to check, then review or run a local ranking scan.','Check local rankings',`/local-seo?${query}`],
  rankings:['Search positions','Choose the search terms and locations to track, then run their first ranking check.','Set up ranking checks',`/keywords?${query}`],
  reviews:['Customer reviews','Check the connected business profile and whether its reviews are available.','Check review source',`/local-seo?${query}`],
  ai_visibility:['Mentions in AI answers','Choose questions customers might ask and check whether AI answers mention your business.','Check AI mentions',`/ai-citations?${query}`],
  backlinks:['Links from other websites','Check your backlink connection and collect the first report.','Check website links',`/backlinks?${query}`],
  competitors:['Competing websites','Run keyword research for your market to identify competing websites.','Review competitor research',`/keywords?${query}`],
  conversions:['Enquiries and sign-ups','Check that your form or sign-up events are tracked, then make a test enquiry.','Check enquiry tracking',performance],
  content_decay:['Pages losing traffic','Connect search and visitor data. This check needs results from different dates before it can compare pages.','Check traffic data',performance],
  measurement_checkpoints:['Scheduled results reviews','Review your active growth experiments and their measurement dates.','Review results schedule',`/growth?${query}&tab=tracker`],
  publish_verification:['Published changes','Open the saved website publication and check its live result.','Check publication',`/site-architect?${query}`],
  technical_health:['Website health','Run a website check and review any problems it finds.','Check website health',`/site-analysis?${query}`],
  website_crawl:['Website page check','Run a website check so the system can read your live pages.','Check website pages',`/site-analysis?${query}`],
 };
 const [title,instruction,button,url]=guides[source.key]??[source.key.replaceAll('_',' '),'Review the saved check and its requirements.','Review growth tasks',`/growth?${query}&tab=execution`];
 const waiting=source.status==='skipped'&&/not due/i.test(source.skipReason??'');
 const done=['completed','available'].includes(source.status);
 const missing=['restricted','unavailable','not_run'].includes(source.status);
 const label=waiting?'Waiting for next check':done?'Checked':missing?'Needs setup or data':['failed','error'].includes(source.status)?'Check failed':source.status==='limited'?'More data needed':'Check in progress';
 return {title,label,url,button,needsAction:missing||['failed','error','limited'].includes(source.status),instruction:waiting?'Nothing to do now. This check will run again on its saved schedule.':done?`The check saved ${source.recordCount} result${source.recordCount===1?'':'s'}. A completed check does not mean every issue is fixed.`:instruction};
}
