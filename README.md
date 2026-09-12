<div align="center">

# 📊 VCynic (Investor-Readiness Pitch Deck Review)

**Upload a pitch deck. Get the review an investor would write.**

![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=next.js&logoColor=white)

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)

![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)

![Report](https://img.shields.io/badge/Report-PDF%20export-5D8D18)

</div>

---

## ✨ Features

- **Investor Readiness Score** — a single 0–100 metric with the decision (invest / conditional invest / pass), a confidence level, and the reviewer memo behind it.
- **Four workspace sections** — *Overview* for the snapshot, *Analyses* for the deep read (problem, solution, business model, market opportunity, traction, team, claims, assessment), *Competitors* for the market map, and *Reports* for the download.
- **API-sourced only** — every value on screen comes straight from the analysis API. The frontend adds headings and layout, never content. Fields the API leaves empty or returns as `"not stated"` are omitted rather than filled in.
- **PDF export** — the full review as a single A4 document, set in large type (12pt body, up to 46pt for the score) so it stays readable when shared or printed.
- **English only** — one language, one report format, no locale switching.
- **Secure Document Ingestion** — ensures strict data privacy, ensuring that proprietary startup information is never used to train external public language models[cite: 1].
- **Autonomous Market Research** — deploys web-scraping agents to search the internet for direct and indirect competitors, ensuring the founder has not overlooked major market threats[cite: 1].
- **Financial Stress-Testing** — analyzes projected financials and unit economics (including CAC, LTV, gross margin, burn, runway, revenue logic, and valuation) to test for realistic metrics and flag evidence gaps[cite: 1].

---

## ⚙️ Prerequisites

- **Node.js 20** or newer.
- A running **VCPilot analysis API** — VCynic is the frontend; it calls `POST /api/v1/analyze-pitch-deck` on that service and renders what comes back. Without it, the site works but deck analysis returns a 503.
- *(Optional)* **PostgreSQL**, only if you intend to persist reports. A Prisma schema for `User` and `Analysis` is included but no application code reads from it yet.

---

## 🚀 How to Run

1. **Clone the repository**
   ```bash
   git clone https://github.com/MoRefae/VCynic.git
   cd VCynic
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure the environment**
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` and set `VCPILOT_API_URL` and `VCPILOT_API_KEY` to match your analysis service. These are read **server-side only** — never rename them with a `NEXT_PUBLIC_` prefix, or the key ships to every visitor's browser.

4. *(Optional)* **Set up the database** — only needed if you are wiring up persistence.
   ```bash
   npx prisma generate
   npx prisma migrate dev --name init
   ```

5. **Start the dev server**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000), then go to **/dashboard** to upload a deck.

For a production build, use `npm run build` followed by `npm start`.

---

## 🗂️ Project Layout

| Path | Purpose |
| --- | --- |
| `app/page.tsx` | Marketing homepage |
| `app/dashboard/page.tsx` | The workspace: upload form and the four report sections |
| `app/api/analyze/route.ts` | Server route that proxies the deck to the VCPilot API |
| `app/api/contact/route.ts` | Contact form endpoint, validated with Zod |
| `lib/report.ts` | The API response contract, mirrored as TypeScript types |
| `lib/report-pdf.ts` | Builds the downloadable PDF with jsPDF |
| `prisma/schema.prisma` | PostgreSQL schema for users and saved analyses |

---

## 🧠 The AI Multi-Agent Engine

VCynic utilizes distinct agents with specialized roles orchestrated via CrewAI to evaluate pitch decks for business accelerators, tech incubators, and startup founders[cite: 1]:

- **The Extractor Agent:** Pulls raw text and financial claims directly from the uploaded document[cite: 1].
- **The Researcher Agent:** Queries live search engines to validate market size and identify active competitors[cite: 1].
- **The Cynic Agent:** Synthesizes the extracted data and the web research to generate the final critical report[cite: 1].

The application proxies the uploaded file to a separate Python analysis service (VCPilot), which uses the OpenAI API (default: `openai/gpt-4o-mini`) while keeping credentials server-side[cite: 1].

---

## 🗺️ Future Roadmap

- **Live Data Benchmarking:** Automated API connections to Crunchbase and PitchBook for real-time benchmarking[cite: 1].
- **Financial Model Auditing:** Structured Excel/CSV ingestion for automated financial model auditing[cite: 1].
- **Media Analysis:** Expanding beyond static documents to analyze founder presentation video and audio dynamics[cite: 1].

---

## 👥 Team

- **Abdulqader Deawaly:** Project Leader, AI Systems (CrewAI agents, market research, JSON outputs, and FastAPI integration)[cite: 1].
- **Mohammed Refae:** FullStack development (Frontend and backend AI-directed code generation, and iterative validation)[cite: 1].
- **Mohammed Alqahtani:** UI/UX Design, Project Documentation, and Technical Presentation[cite: 1].

---

## ⚠️ Disclaimer

> VCynic produces an **AI-assisted preliminary analysis** — not investment, legal, or financial advice. Output can be incomplete or wrong, and no automated review should stand in for real diligence.
>
> The sign-up and login screens are **intentional placeholders** with no real authentication behind them. Before handling anyone else's confidential deck, add authenticated sessions, object storage for uploads, rate limiting, and an asynchronous worker queue.
>
> Built for **educational and portfolio purposes**.
