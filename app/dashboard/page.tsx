"use client";
import { useState } from "react";
import Link from "next/link";
import { Arrow, Spark } from "../ui";
import { DECISION_LABEL, hasValue, type Competitor, type MarketSizeValidation, type Report } from "../../lib/report";
import { buildReportPdf, reportFilename } from "../../lib/report-pdf";

type SectionId = "overview" | "analyses" | "competitors" | "reports";

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "analyses", label: "Analyses" },
  { id: "competitors", label: "Competitors" },
  { id: "reports", label: "Reports" },
];

export default function Dashboard() {
  const [file, setFile] = useState<File | null>(null);
  const [load, setLoad] = useState(false);
  const [res, setRes] = useState<Report | null>(null);
  const [err, setErr] = useState("");
  const [section, setSection] = useState<SectionId>("overview");

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setErr("Select a PDF pitch deck first.");
      return;
    }
    setLoad(true);
    setErr("");
    setRes(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const x = await fetch("/api/analyze", { method: "POST", body: formData });
      const d = await x.json();
      if (!x.ok) throw new Error(d.error || "Unable to analyze this deck.");
      setRes(d as Report);
      setSection("overview");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unable to analyze this deck.");
    } finally {
      setLoad(false);
    }
  }

  return (
    <main className="app-shell">
      <aside>
        <Link href="/" className="brand"><span className="brand-mark">V</span>VCYNIC</Link>
        <div className="workspace"><small>WORKSPACE</small><b>Your workspace</b></div>
        <nav aria-label="Workspace">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className={section === s.id ? "active" : undefined}
              aria-current={section === s.id ? "page" : undefined}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="side-bottom"><div><b>Live analysis</b><small>Decks are sent to our AI for review</small></div></div>
      </aside>
      <section className="dash-main">
        <div className="dash-header">
          <div><small>PITCH DECK REVIEW</small><h1>Pitch workspace</h1></div>
          <Link href="/" className="exit">Exit workspace <Arrow /></Link>
        </div>
        <p className="preview-note">
          Your PDF is sent to our AI analysis service to generate this report. Only upload decks you have the right to share, and avoid including personal data you would not want processed by a third-party AI model.
        </p>
        <div className="dash-grid">
          <section className="new-analysis">
            <div className="section-label">NEW ANALYSIS</div>
            <h2>Review your<br />pitch deck.</h2>
            <form onSubmit={run}>
              <label className="drop">
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                <span>↥</span>
                <b>{file ? file.name : "Select a PDF deck"}</b>
                <small>PDF only. Your file is uploaded for analysis.</small>
              </label>
              <button className="button primary" disabled={load || !file}>
                {load ? "Analyzing your deck…" : "Analyze deck"} <Arrow />
              </button>
              {err && <p className="error" role="alert">{err}</p>}
            </form>
          </section>
          <section className="analysis-view" aria-live="polite">
            {load ? (
              <div className="working">
                <Spark />
                <div className="section-label">ANALYSIS IN PROGRESS</div>
                <h2>Reviewing your deck.</h2>
                <p>This can take a minute or two while our AI reads the deck, checks the market, and stress-tests the pitch.</p>
              </div>
            ) : res ? (
              <SectionView section={section} res={res} />
            ) : (
              <div className="empty">
                <div className="empty-icon"><Spark /></div>
                <h2>Your review<br />will appear here.</h2>
                <p>Upload a PDF pitch deck to see a full investor-style review.</p>
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

function SectionView({ section, res }: { section: SectionId; res: Report }) {
  if (section === "analyses") return <Analyses res={res} />;
  if (section === "competitors") return <Competitors res={res} />;
  if (section === "reports") return <Reports res={res} />;
  return <Overview res={res} />;
}

/* ---------------------------------------------------------------------------
 * Shared field primitives. Every one of them renders nothing when the API did
 * not supply a value, so a sparse report never shows an empty or invented row.
 * ------------------------------------------------------------------------ */

function Field({ label, value }: { label: string; value: string }) {
  if (!hasValue(value)) return null;
  return (
    <div className="field">
      <h4>{label}</h4>
      <p>{value}</p>
    </div>
  );
}

function ListField({ label, items, ordered = true }: { label: string; items: string[]; ordered?: boolean }) {
  if (items.length === 0) return null;
  const List = ordered ? "ol" : "ul";
  return (
    <div className="field">
      <h4>{label}</h4>
      <List className={ordered ? "step-list" : "bullet-list"}>
        {items.map((item) => <li key={item}>{item}</li>)}
      </List>
    </div>
  );
}

/**
 * A titled group of fields. Renders nothing when the API supplied no values
 * for any of them, so a sparse report never shows a heading over blank space.
 */
function Group({
  title,
  values = [],
  lists = [],
  children,
}: {
  title: string;
  values?: string[];
  lists?: unknown[][];
  children: React.ReactNode;
}) {
  const hasContent = values.some(hasValue) || lists.some((l) => l.length > 0);
  if (!hasContent) return null;
  return (
    <>
      <h3>{title}</h3>
      {children}
    </>
  );
}

function SectionHead({ label, title, note }: { label: string; title: string; note?: string }) {
  // A <div>, not a <header>: globals.css styles the bare `header` element as
  // the fixed-height site nav bar, which would clamp and tint this block.
  return (
    <div className="view-head">
      <div className="section-label">{label}</div>
      <h2>{title}</h2>
      {note && <p>{note}</p>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="none">{children}</p>;
}

/* --- Overview: condensed snapshot, score first ---------------------------- */

function Overview({ res }: { res: Report }) {
  const vc = res.vc_assessment;
  const counts: [string, number][] = [
    ["Critical risks", vc.critical_risks.length],
    ["Required changes", vc.required_changes.length],
    ["Evidence gaps", res.business_analysis.evidence_gaps.length],
    ["Competitors found", res.market_research.direct_competitors.length + res.market_research.adjacent_alternatives.length],
  ];
  return (
    <div className="results">
      <SectionHead label="OVERVIEW" title="Investor readiness" />
      <div className="score-block">
        <p className="score">{vc.investment_score}<small>/100</small></p>
        <dl className="verdict-meta">
          <div><dt>Decision</dt><dd>{DECISION_LABEL[vc.investment_decision]}</dd></div>
          <div><dt>Confidence</dt><dd>{vc.confidence}</dd></div>
          <div><dt>Deck pages</dt><dd>{res.document.page_count}</dd></div>
        </dl>
      </div>
      <Field label="Reviewer memo" value={vc.harsh_vc_memo} />
      <ul className="count-grid">
        {counts.map(([label, n]) => (
          <li key={label}><b>{n}</b><span>{label}</span></li>
        ))}
      </ul>
      <p className="hint">Open <b>Analyses</b> for the full breakdown, <b>Competitors</b> for the market map, or <b>Reports</b> to download the PDF.</p>
      <Disclaimer res={res} />
    </div>
  );
}

/* --- Analyses: deep company analysis, deliberately no competitor content --- */

function Analyses({ res }: { res: Report }) {
  const { business_analysis: ba, market_research: mr, vc_assessment: vc } = res;
  return (
    <div className="results">
      <SectionHead label="ANALYSES" title="Full deck analysis" />
      <Field label="Executive summary" value={ba.executive_summary} />
      <Field label="Decision rationale" value={vc.decision_rationale} />

      <Group title="Company" values={[ba.problem, ba.solution, ba.product, ba.target_customer]}>
        <Field label="Problem" value={ba.problem} />
        <Field label="Solution" value={ba.solution} />
        <Field label="Product" value={ba.product} />
        <Field label="Target customer" value={ba.target_customer} />
      </Group>

      <Group
        title="Business model"
        values={[ba.business_model, ba.revenue_model, ba.go_to_market, ba.funding_ask, vc.unit_economics_review]}
      >
        <Field label="Business model" value={ba.business_model} />
        <Field label="Revenue model" value={ba.revenue_model} />
        <Field label="Go to market" value={ba.go_to_market} />
        <Field label="Funding ask" value={ba.funding_ask} />
        <Field label="Unit economics review" value={vc.unit_economics_review} />
      </Group>

      <Group
        title="Market opportunity"
        values={[mr.market_definition, mr.claim_assessment]}
        lists={[mr.market_size_validation]}
      >
        <Field label="Market definition" value={mr.market_definition} />
        <Field label="Claim assessment" value={mr.claim_assessment} />
        {mr.market_size_validation.length > 0 && (
          <div className="field">
            <h4>Market size validation</h4>
            {mr.market_size_validation.map((m: MarketSizeValidation) => (
              <article className="claim" key={m.deck_claim + m.assessment}>
                {hasValue(m.deck_claim) && <b>{m.deck_claim}</b>}
                {hasValue(m.assessment) && <span>{m.assessment}</span>}
                {hasValue(m.explanation) && <p>{m.explanation}</p>}
              </article>
            ))}
          </div>
        )}
      </Group>

      <Group title="Traction and team" values={[ba.traction, vc.traction_review, ba.team, vc.team_review]}>
        <Field label="Traction" value={ba.traction} />
        <Field label="Traction review" value={vc.traction_review} />
        <Field label="Team" value={ba.team} />
        <Field label="Team review" value={vc.team_review} />
      </Group>

      <Group
        title="Claims and assumptions"
        lists={[ba.market_claims, ba.financial_claims, ba.key_assumptions, ba.source_quotes]}
      >
        <ListField label="Market claims" items={ba.market_claims} />
        <ListField label="Financial claims" items={ba.financial_claims} />
        <ListField label="Key assumptions" items={ba.key_assumptions} />
        <ListField label="Source quotes" items={ba.source_quotes} ordered={false} />
      </Group>

      <Group
        title="Assessment"
        lists={[vc.strengths, vc.critical_risks, ba.evidence_gaps, vc.required_changes, vc.diligence_questions]}
      >
        <ListField label="Strengths" items={vc.strengths} />
        <ListField label="Critical risks" items={vc.critical_risks} />
        <ListField label="Evidence gaps" items={ba.evidence_gaps} />
        <ListField label="Required changes" items={vc.required_changes} />
        <ListField label="Diligence questions" items={vc.diligence_questions} />
      </Group>

      <Notices res={res} />
      <Disclaimer res={res} />
    </div>
  );
}

/* --- Competitors: competitor data only ------------------------------------ */

function CompetitorList({ items }: { items: Competitor[] }) {
  return (
    <ul className="comp-list">
      {items.map((c) => (
        <li key={c.name}>
          <b>{c.name}</b>
          {hasValue(c.description) && <p>{c.description}</p>}
          {hasValue(c.similarity) && <small>{c.similarity}</small>}
          {c.source_url && (
            <a href={c.source_url} target="_blank" rel="noreferrer noopener">{c.source_url}</a>
          )}
        </li>
      ))}
    </ul>
  );
}

function Competitors({ res }: { res: Report }) {
  const mr = res.market_research;
  const none = mr.direct_competitors.length === 0 && mr.adjacent_alternatives.length === 0;
  return (
    <div className="results">
      <SectionHead label="COMPETITORS" title="Market map" />
      <Field label="Market and competition review" value={res.vc_assessment.market_and_competition_review} />

      <h3>Direct competitors</h3>
      {mr.direct_competitors.length > 0
        ? <CompetitorList items={mr.direct_competitors} />
        : <Empty>The analysis returned no direct competitors for this deck.</Empty>}

      <h3>Adjacent alternatives</h3>
      {mr.adjacent_alternatives.length > 0
        ? <CompetitorList items={mr.adjacent_alternatives} />
        : <Empty>The analysis returned no adjacent alternatives for this deck.</Empty>}

      <ListField label="Differentiation risks" items={mr.differentiation_risks} />
      <ListField label="Research limitations" items={mr.research_limitations} ordered={false} />
      {none && <Empty>No competitor data was returned by the analysis service.</Empty>}
      <Disclaimer res={res} />
    </div>
  );
}

/* --- Reports: PDF download ------------------------------------------------ */

function Reports({ res }: { res: Report }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setBusy(true);
    setError("");
    try {
      const blob = await buildReportPdf(res);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = reportFilename(res);
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on the next tick so the download has picked the blob up.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error("PDF generation failed:", e);
      setError("The PDF could not be generated. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="results">
      <SectionHead
        label="REPORTS"
        title="Download your review"
        note="A single PDF containing the overview, the full analysis, and the competitor map, set in large type for reading and sharing."
      />
      <ul className="bullet-list contents-list">
        <li>Overview &mdash; investor readiness score, decision, confidence, reviewer memo</li>
        <li>Analysis &mdash; company, business model, market opportunity, traction, team, claims, assessment</li>
        <li>Competitors &mdash; direct competitors, adjacent alternatives, differentiation risks</li>
      </ul>
      <button className="button primary" onClick={download} disabled={busy}>
        {busy ? "Preparing PDF…" : "Download PDF"} <Arrow />
      </button>
      {error && <p className="error" role="alert">{error}</p>}
      <dl className="verdict-meta report-meta">
        <div><dt>Report</dt><dd>{res.report_id}</dd></div>
        <div><dt>Score</dt><dd>{res.vc_assessment.investment_score}/100</dd></div>
      </dl>
      <Disclaimer res={res} />
    </div>
  );
}

/* --- Shared footers ------------------------------------------------------- */

function Notices({ res }: { res: Report }) {
  const notes = [...res.document.warnings, ...res.processing_warnings];
  if (notes.length === 0) return null;
  return (
    <div className="notice" role="note">
      <b>Some sections of this deck needed attention</b>
      <p>{notes.join(" ")}</p>
    </div>
  );
}

function Disclaimer({ res }: { res: Report }) {
  if (!hasValue(res.disclaimer)) return null;
  return <p className="disclaimer">{res.disclaimer}</p>;
}
