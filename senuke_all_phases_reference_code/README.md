# SEnuke AI - All Phases Reference Implementation

This package is a developer handoff/reference implementation for the SEnuke AI MVP and post-MVP phases. It is intentionally modular so the team can adapt it into the existing application stack.

## What this code includes

- Express API skeleton
- PostgreSQL schema
- AI provider abstraction with mock and OpenAI adapter
- Execution Engine task system
- Project/intake/business profile foundation
- Opportunity Finder and Strategy Engine services
- Keyword research with manual and automated provider interfaces
- One-click site analysis workflow with optimization tasks
- Backlink intelligence and Authority Builder scaffolding
- AI Citation Optimization scaffolding
- Site Architect, Lead Magnet, Domain, Publishing, Social Media, Agency modules
- React reference components for the main screens

## What developers must replace

The mock providers are intentionally safe defaults. Replace them with production providers after legal, cost, permission, and API reviews:

- AI provider
- Keyword volume/difficulty provider
- Rank tracking provider
- Backlink provider
- Domain registrar provider
- Static hosting provider
- Social publishing/monitoring provider

## Local setup

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:init
npm run dev
```

## Development order

Follow the phase documents in `docs/phases` and the master DOCX supplied with this package. Do not build modules as disconnected tools. Every output must create execution tasks and next actions.

## Additional module notes

- `src/modules/rank` stores rank snapshots and creates ranking-improvement tasks.
- `src/modules/seo` converts keyword research and site findings into SEO page plans and optimization actions.
