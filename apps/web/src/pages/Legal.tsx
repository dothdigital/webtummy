import { Link } from "react-router-dom";
import { LogoMark } from "../components/Logo.js";

type LegalKind = "terms" | "privacy";

const effectiveDate = "June 22, 2026";

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-charcoal-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-3">
            <LogoMark size={36} />
            <span className="text-lg font-bold tracking-tight text-charcoal-900">Web<span className="text-brand-600">tummy</span></span>
          </Link>
          <Link to="/login" className="text-sm font-medium text-brand-700 hover:underline">Sign in</Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-charcoal-950">{title}</h1>
          <p className="mt-2 text-sm text-charcoal-500">Effective date: {effectiveDate}</p>
        </div>
        <article className="space-y-8 rounded-lg border border-slate-200 bg-white p-6 leading-7 shadow-sm sm:p-8">
          {children}
        </article>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-bold text-charcoal-950">{title}</h2>
      <div className="space-y-3 text-sm text-charcoal-650">{children}</div>
    </section>
  );
}

export default function Legal({ kind }: { kind: LegalKind }) {
  if (kind === "privacy") {
    return (
      <Shell title="Privacy Policy">
        <Section title="1. Who We Are">
          <p>Webtummy is an SEO and AI-search audit platform operated by Dot H Digital. This Privacy Policy explains how we collect, use, disclose, and protect information when you use the Webtummy website, dashboard, crawler, reports, billing flows, and related services.</p>
          <p>Contact: info@dothdigital.com.</p>
        </Section>

        <Section title="2. Information We Collect">
          <p>We collect account information such as name, company name, email address, password hash, role, account status, plan, billing identifiers, and login timestamps.</p>
          <p>We collect client project information you provide or generate, including domains, URLs, crawl configuration, crawl results, technical SEO issues, page metadata, keyword and content inputs, generated content, reports, and usage counters.</p>
          <p>We collect operational data such as IP address, device/browser metadata, security logs, request logs, error logs, and approximate usage activity needed to operate and secure the service.</p>
        </Section>

        <Section title="3. How We Use Information">
          <p>We use information to provide the dashboard, crawl websites, generate audits and reports, manage users and client accounts, process billing, prevent abuse, improve service reliability, and communicate account or security notices.</p>
          <p>We may use aggregated or de-identified information to understand product performance, diagnose issues, and improve our SEO and AI-search audit capabilities.</p>
        </Section>

        <Section title="4. Website Crawling and Client Data">
          <p>When you submit a website or URL, Webtummy may crawl publicly accessible pages and assets to identify SEO, performance, content, schema, link, and AI-search readiness issues. You are responsible for ensuring you have the authority to crawl and analyze submitted websites.</p>
          <p>Audit results may include page titles, metadata, headings, page text excerpts, URLs, links, structured data, response data, and recommendations derived from those pages.</p>
        </Section>

        <Section title="5. Third-Party Services">
          <p>We use selected service providers to operate Webtummy, including hosting and infrastructure providers, email delivery providers, Stripe for billing and invoices, Google reCAPTCHA v3 for abuse prevention, Google or other performance APIs where configured, keyword and SERP data providers where configured, and OpenAI for AI-assisted content or analysis features.</p>
          <p>These providers process information according to their own terms and privacy policies. We share only the information needed for the relevant feature or operational purpose.</p>
        </Section>

        <Section title="6. Cookies, Local Storage, and reCAPTCHA">
          <p>Webtummy uses browser storage for authentication tokens, active client context, and dashboard state. Google reCAPTCHA v3 may analyze browser and interaction signals to determine whether registration activity appears legitimate.</p>
          <p>Use of reCAPTCHA is subject to Google&apos;s Privacy Policy and Terms of Service.</p>
        </Section>

        <Section title="7. Billing and Invoices">
          <p>Payments, subscriptions, customer portals, and invoices are handled through Stripe. We store billing-related identifiers, subscription status, plan information, and invoice links or metadata, but we do not store full payment card numbers on Webtummy servers.</p>
        </Section>

        <Section title="8. Security and Retention">
          <p>We use reasonable technical and organizational safeguards designed to protect account and client data. No online service can guarantee absolute security.</p>
          <p>We retain information for as long as needed to provide the service, comply with legal or accounting obligations, resolve disputes, maintain security, and enforce our agreements. You may request deletion or export of account data by contacting us.</p>
        </Section>

        <Section title="9. Your Choices">
          <p>You may update account and project information in the dashboard where available. You may request access, correction, deletion, or restriction of personal information by contacting info@dothdigital.com. Some requests may be limited by security, billing, legal, or backup retention requirements.</p>
        </Section>

        <Section title="10. Changes">
          <p>We may update this Privacy Policy as Webtummy changes. The updated version will be posted with a new effective date. Continued use of the service after changes means you accept the updated policy.</p>
        </Section>
      </Shell>
    );
  }

  return (
    <Shell title="Terms and Conditions">
      <Section title="1. Agreement">
        <p>These Terms and Conditions govern access to and use of Webtummy, an SEO and AI-search audit platform operated by Dot H Digital. By creating an account, signing in, or using the service, you agree to these Terms.</p>
        <p>If you use Webtummy for a company or client, you confirm that you have authority to bind that organization and to submit websites, data, and content for analysis.</p>
      </Section>

      <Section title="2. Service Overview">
        <p>Webtummy helps crawl websites, identify technical and content issues, generate keyword and SEO insights, score AI-search readiness, and prepare reports. Results are informational and decision-support tools, not guarantees of search ranking, indexing, traffic, revenue, or legal compliance.</p>
      </Section>

      <Section title="3. Accounts and Access">
        <p>You must provide accurate account information and keep login credentials secure. You are responsible for activity under your account and for promptly notifying us of unauthorized access.</p>
        <p>Administrators are responsible for managing users, permissions, plan access, billing access, and client project data inside their organization.</p>
      </Section>

      <Section title="4. Acceptable Use">
        <p>You may only crawl, audit, or analyze websites and content that you own, manage, or are authorized to assess. You must not use Webtummy to attack, overload, scrape unlawfully, bypass access controls, collect sensitive personal data without authority, or violate third-party rights.</p>
        <p>We may suspend or limit access if we believe use is abusive, unlawful, risky to infrastructure, or inconsistent with these Terms.</p>
      </Section>

      <Section title="5. Client Content and Reports">
        <p>You retain ownership of websites, inputs, uploaded or entered content, and client materials you provide. You grant Webtummy permission to process that information to provide audits, reports, AI-assisted outputs, billing, support, security, and service improvements.</p>
        <p>You are responsible for reviewing generated recommendations, AI-assisted content, metadata, schema, reports, and exports before publishing or relying on them.</p>
      </Section>

      <Section title="6. AI and Third-Party Data">
        <p>Some features may use third-party APIs, AI models, keyword providers, search data providers, billing processors, email providers, reCAPTCHA, and infrastructure services. Their availability, output, and accuracy may vary.</p>
        <p>AI-generated content and automated audit results can be incomplete or inaccurate. You are responsible for human review and professional judgment before acting on recommendations.</p>
      </Section>

      <Section title="7. Plans, Billing, and Invoices">
        <p>Paid plan access, subscription status, quotas, and invoice downloads may be managed through Webtummy and Stripe. Fees are billed according to the selected plan and Stripe checkout or portal terms shown at purchase.</p>
        <p>Unless otherwise stated, fees are non-refundable except where required by law or expressly agreed in writing. We may change plans, quotas, or pricing with notice where required.</p>
      </Section>

      <Section title="8. Availability and Changes">
        <p>We aim to keep Webtummy reliable, but the service may be unavailable because of maintenance, updates, incidents, third-party outages, crawler limitations, website blocking, API limits, or events outside our control.</p>
        <p>We may add, change, suspend, or discontinue features as the product evolves.</p>
      </Section>

      <Section title="9. Intellectual Property">
        <p>Webtummy, its software, user interface, workflows, branding, and platform technology are owned by Dot H Digital or its licensors. These Terms do not transfer ownership of the platform to you.</p>
        <p>You may use reports and outputs generated for your authorized client work, subject to these Terms and your responsibility to review them.</p>
      </Section>

      <Section title="10. Disclaimers and Limitation of Liability">
        <p>Webtummy is provided on an “as is” and “as available” basis. To the maximum extent permitted by law, we disclaim warranties of merchantability, fitness for a particular purpose, non-infringement, and uninterrupted or error-free operation.</p>
        <p>To the maximum extent permitted by law, Dot H Digital will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, lost rankings, lost traffic, lost data, or business interruption.</p>
      </Section>

      <Section title="11. Termination">
        <p>You may stop using Webtummy at any time. We may suspend or terminate access for non-payment, security risk, abuse, legal risk, or breach of these Terms. Some obligations, including payment, confidentiality, intellectual property, disclaimers, and limitations of liability, survive termination.</p>
      </Section>

      <Section title="12. Contact">
        <p>Questions about these Terms can be sent to info@dothdigital.com.</p>
      </Section>
    </Shell>
  );
}
