# SEnuke AI Competitive SEO and Growth Intelligence Add-On v1.0

This reference code package shows how to implement competitive SEO/growth intelligence as hidden services that feed the SEnuke AI Execution Engine.

Core ideas:
- Do not add every capability as a separate UI module.
- Run intelligence services behind plain actions such as "Improve This Page" or "Find My Next Growth Opportunity".
- Require readiness checks, credits checks, output review/versioning, and approval before execution.

Files:
- db/schema.sql
- src/featureRegistry.ts
- src/services/scoring.ts
- src/services/intelligenceRouter.ts
- src/services/recommendationToTask.ts
- src/routes/competitiveIntelligenceRoutes.ts
- src/components/ImprovePagePanel.tsx
- src/components/IntelligenceDetailsDrawer.tsx
