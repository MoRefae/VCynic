# VCynic

VCynic is a Next.js application for investor-readiness analysis. It includes a polished marketing site, functional sign-up/login screens, and a dashboard that accepts a narrative or pitch-file selection and returns a deterministic mock multi-agent briefing.

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` when connecting PostgreSQL.
3. Install dependencies: `npm install`.
4. Generate the database client (optional for the mock analysis mode): `npx prisma generate`.
5. Create database tables: `npx prisma migrate dev --name init`.
6. Start the app: `npm run dev`.

Open `http://localhost:3000`.

## Architecture

- `app/page.tsx`: marketing homepage and product narrative
- `app/dashboard/page.tsx`: client-side pitch input and live analysis UI
- `app/api/analyze/route.ts`: validated server API that returns the mock agent briefing
- `app/{pricing,how-it-works,contact,login,signup}`: supporting product pages
- `prisma/schema.prisma`: PostgreSQL schema for users and saved analyses

The analysis endpoint validates input with Zod. Replace its deterministic response with your job queue / LLM orchestration, then persist the returned briefing against `Analysis.result`.

## Production notes

Use a managed PostgreSQL service, object storage for uploaded decks, an authenticated server session, rate limiting, and an asynchronous worker queue before processing real sensitive decks. The current sign-up and login forms are intentional placeholder authentication flows.
