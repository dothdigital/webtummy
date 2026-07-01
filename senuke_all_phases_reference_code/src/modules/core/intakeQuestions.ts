import type { ProjectType } from './types.js';

export interface IntakeQuestion {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'multi_select' | 'url' | 'number';
  required: boolean;
  options?: string[];
}

const universalQuestions: IntakeQuestion[] = [
  { key: 'business_name', label: 'Business or project name', type: 'text', required: true },
  { key: 'website_url', label: 'Website URL if one exists', type: 'url', required: false },
  { key: 'niche', label: 'Industry, niche, or market', type: 'text', required: true },
  { key: 'target_location', label: 'Target country, region, or city', type: 'text', required: false },
  { key: 'primary_goal', label: 'Main goal for this project', type: 'textarea', required: true },
  { key: 'budget_level', label: 'Available monthly budget', type: 'select', required: true, options: ['none', 'low', 'moderate', 'high'] },
  { key: 'skill_level', label: 'Technical skill level', type: 'select', required: true, options: ['beginner', 'intermediate', 'advanced'] },
  { key: 'preferred_publishing_method', label: 'Preferred publishing method', type: 'select', required: true, options: ['senuke_static', 'html_zip', 'wordpress', 'shopify', 'own_developer'] }
];

const pathSpecificQuestions: Record<ProjectType, IntakeQuestion[]> = {
  new_business: [
    { key: 'skills_and_experience', label: 'Relevant skills and experience', type: 'textarea', required: true },
    { key: 'business_model_preference', label: 'Preferred business model', type: 'select', required: false, options: ['affiliate', 'lead_generation', 'service', 'digital_product', 'ecommerce', 'not_sure'] },
    { key: 'time_available', label: 'Hours available per week', type: 'number', required: true }
  ],
  existing_website: [
    { key: 'current_problem', label: 'What is not working on the current site?', type: 'textarea', required: true },
    { key: 'known_keywords', label: 'Known target keywords', type: 'textarea', required: false },
    { key: 'competitors', label: 'Competitor URLs', type: 'textarea', required: false }
  ],
  agency_client: [
    { key: 'client_name', label: 'Client name', type: 'text', required: true },
    { key: 'services_to_propose', label: 'Services to propose or deliver', type: 'multi_select', required: true, options: ['SEO', 'Website', 'Lead generation', 'Social media', 'Authority building', 'AI citation optimization'] },
    { key: 'report_branding', label: 'Use agency white-label branding?', type: 'select', required: true, options: ['yes', 'no'] }
  ],
  ecommerce: [
    { key: 'product_type', label: 'Product type', type: 'text', required: true },
    { key: 'platform_preference', label: 'Platform preference', type: 'select', required: true, options: ['shopify', 'woocommerce', 'static_catalog', 'not_sure'] },
    { key: 'fulfillment_model', label: 'Fulfillment model', type: 'select', required: false, options: ['own_inventory', 'dropship', 'print_on_demand', 'digital', 'not_sure'] }
  ]
};

export function getIntakeQuestions(projectType: ProjectType): IntakeQuestion[] {
  return [...universalQuestions, ...pathSpecificQuestions[projectType]];
}
