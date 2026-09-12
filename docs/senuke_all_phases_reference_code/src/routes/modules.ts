import { Router } from 'express';
import { OpportunityService } from '../modules/opportunity/OpportunityService.js';
import { StrategyService } from '../modules/strategy/StrategyService.js';
import { KeywordResearchService } from '../modules/keyword/KeywordResearchService.js';
import { SiteAnalysisService } from '../modules/siteAnalysis/SiteAnalysisService.js';
import { SiteArchitectService } from '../modules/siteArchitect/SiteArchitectService.js';
import { LeadMagnetService } from '../modules/leadMagnet/LeadMagnetService.js';
import { DomainService } from '../modules/domain/DomainService.js';
import { PublishingService } from '../modules/publishing/PublishingService.js';
import { SocialMediaService } from '../modules/social/SocialMediaService.js';
import { AgencyService } from '../modules/agency/AgencyService.js';
import { RankTrackingService } from '../modules/rank/RankTrackingService.js';
import { SEOOptimizerService } from '../modules/seo/SEOOptimizerService.js';

export const modulesRouter = Router();

modulesRouter.post('/:projectId/opportunities/generate', async (req, res, next) => {
  try { res.json(await OpportunityService.generate(req.params.projectId)); } catch (error) { next(error); }
});

modulesRouter.post('/:projectId/opportunities/:opportunityId/select', async (req, res, next) => {
  try { res.json(await OpportunityService.selectOpportunity(req.params.projectId, req.params.opportunityId)); } catch (error) { next(error); }
});

modulesRouter.post('/:projectId/strategy/generate', async (req, res, next) => {
  try { res.json(await StrategyService.generate(req.params.projectId)); } catch (error) { next(error); }
});

modulesRouter.post('/:projectId/strategy/:strategyId/approve', async (req, res, next) => {
  try { res.json(await StrategyService.approve(req.params.projectId, req.params.strategyId)); } catch (error) { next(error); }
});

modulesRouter.post('/:projectId/keywords/automated', async (req, res, next) => {
  try { res.json(await new KeywordResearchService().runAutomated(req.params.projectId, req.body.seedKeywords ?? [], req.body.location)); } catch (error) { next(error); }
});

modulesRouter.post('/:projectId/keywords/manual', async (req, res, next) => {
  try { res.json(await new KeywordResearchService().importManual(req.params.projectId, req.body.keywords ?? [])); } catch (error) { next(error); }
});

modulesRouter.post('/:projectId/site-analysis/analyze', async (req, res, next) => {
  try { res.json(await new SiteAnalysisService().analyze(req.params.projectId, req.body.websiteUrl)); } catch (error) { next(error); }
});

modulesRouter.post('/:projectId/site-architecture/generate', async (req, res, next) => {
  try { res.json(await SiteArchitectService.generateArchitecture(req.params.projectId)); } catch (error) { next(error); }
});

modulesRouter.post('/:projectId/pages/generate', async (req, res, next) => {
  try { res.json(await SiteArchitectService.generatePage(req.params.projectId, req.body)); } catch (error) { next(error); }
});

modulesRouter.post('/:projectId/lead-magnet/generate', async (req, res, next) => {
  try { res.json(await LeadMagnetService.generate(req.params.projectId)); } catch (error) { next(error); }
});

modulesRouter.post('/:projectId/domains/recommend', async (req, res, next) => {
  try { res.json(await new DomainService().recommendDomains(req.params.projectId)); } catch (error) { next(error); }
});

modulesRouter.post('/:projectId/domains/register', async (req, res, next) => {
  try { res.json(await new DomainService().registerApprovedDomain(req.params.projectId, req.body.domain, req.body.contactProfileId)); } catch (error) { next(error); }
});

modulesRouter.post('/:projectId/publishing/export-zip', async (req, res, next) => {
  try { res.json(await new PublishingService().exportZip(req.params.projectId)); } catch (error) { next(error); }
});

modulesRouter.post('/:projectId/publishing/static', async (req, res, next) => {
  try { res.json(await new PublishingService().publishStatic(req.params.projectId)); } catch (error) { next(error); }
});

modulesRouter.post('/:projectId/social/generate', async (req, res, next) => {
  try { res.json(await SocialMediaService.generatePosts(req.params.projectId, req.body.platforms ?? [], req.body.topic)); } catch (error) { next(error); }
});

modulesRouter.post('/:projectId/social/schedule', async (req, res, next) => {
  try { res.json(await SocialMediaService.scheduleApprovedPosts(req.params.projectId, req.body.timezone)); } catch (error) { next(error); }
});

modulesRouter.post('/:projectId/social/mentions/monitor', async (req, res, next) => {
  try { res.json(await SocialMediaService.monitorMentions(req.params.projectId)); } catch (error) { next(error); }
});

modulesRouter.post('/:projectId/agency/report', async (req, res, next) => {
  try { res.json(await AgencyService.generateClientReport(req.params.projectId, req.body.clientId)); } catch (error) { next(error); }
});


modulesRouter.post('/:projectId/rank/check', async (req, res, next) => {
  try { res.json(await new RankTrackingService().checkProjectKeywords(req.params.projectId, req.body.targetDomain, req.body.location)); } catch (error) { next(error); }
});

modulesRouter.post('/:projectId/seo/page-plan', async (req, res, next) => {
  try { res.json(await SEOOptimizerService.generatePagePlan(req.params.projectId)); } catch (error) { next(error); }
});
