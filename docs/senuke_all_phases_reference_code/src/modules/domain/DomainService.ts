import { one } from '../../db/db.js';
import { AIService } from '../ai/AIService.js';
import { ExecutionService } from '../execution/ExecutionService.js';

export interface DomainAvailability {
  domain: string;
  available: boolean;
  price?: number;
  registrarProvider: string;
}

export interface DomainProvider {
  checkAvailability(domain: string): Promise<DomainAvailability>;
  registerDomain(domain: string, contactProfileId: string): Promise<{ orderId: string; status: string }>;
  configureDns(domain: string, records: Array<{ type: string; name: string; value: string }>): Promise<{ status: string }>;
}

export class MockDomainProvider implements DomainProvider {
  async checkAvailability(domain: string): Promise<DomainAvailability> {
    return { domain, available: !domain.includes('taken'), price: 12.99, registrarProvider: 'mock' };
  }
  async registerDomain(domain: string): Promise<{ orderId: string; status: string }> {
    return { orderId: `mock-${Date.now()}-${domain}`, status: 'registered' };
  }
  async configureDns(): Promise<{ status: string }> {
    return { status: 'configured' };
  }
}

/**
 * Phase 5: Domain recommendations, availability checks, registration approval, and DNS connection.
 * Domain purchases must always require explicit user approval.
 */
export class DomainService {
  constructor(private provider: DomainProvider = new MockDomainProvider()) {}

  async recommendDomains(projectId: string) {
    const strategy = await one<any>('SELECT * FROM strategy_plans WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1', [projectId]);
    const ai = new AIService();
    const output = await ai.generateAndLog<{ domains: Array<{ name: string; reason: string; score: number }> }>(projectId, {
      moduleName: 'Domain Recommendation',
      promptVersion: 'domain-v1',
      system: 'Return JSON with domain name ideas. Prefer short, brandable, relevant names. Do not claim availability.',
      user: JSON.stringify({ strategy }, null, 2),
      jsonSchemaHint: { domains: [] }
    });

    const saved = [];
    for (const candidate of output.domains ?? []) {
      const domain = candidate.name.includes('.') ? candidate.name : `${candidate.name}.com`;
      const availability = await this.provider.checkAvailability(domain);
      saved.push(await one<any>(
        `INSERT INTO domain_candidates(project_id, domain_name, tld, score, availability_status, estimated_price, registrar_provider, reason)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [projectId, domain, domain.split('.').pop(), candidate.score, availability.available ? 'available' : 'unavailable', availability.price ?? null, availability.registrarProvider, candidate.reason]
      ));
    }

    await ExecutionService.createTasksFromRecommendations(projectId, 'Domain Automation', [
      { title: 'Review domain recommendations', description: 'Choose the best available domain for the project.', action: 'Review Domains', automationLevel: 'manual_guided' },
      { title: 'Approve domain registration', description: 'Register selected domain only after explicit approval.', action: 'Approve Registration', automationLevel: 'execute_with_approval' },
      { title: 'Connect domain to site', description: 'Configure DNS automatically where possible or show manual DNS instructions.', action: 'Connect Domain', automationLevel: 'execute_through_integration' }
    ]);

    return saved;
  }

  async registerApprovedDomain(projectId: string, domain: string, contactProfileId: string) {
    // Controller must ensure the frontend showed final price and received explicit approval.
    const result = await this.provider.registerDomain(domain, contactProfileId);
    return one<any>(
      `INSERT INTO domain_registrations(project_id, domain_name, registrar_provider, registration_status, registration_order_id)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [projectId, domain, 'mock', result.status, result.orderId]
    );
  }
}
