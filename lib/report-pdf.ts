import type { Report, Competitor, MarketSizeValidation } from "./report";
import { DECISION_LABEL, hasValue } from "./report";

/*
 * Builds the downloadable review PDF. Every string written here is read off
 * the API response object -- this module adds section headings and layout,
 * never content.
 *
 * Sizes are deliberately large (12pt body, 15/19/26pt headings) so the file
 * stays readable when it is shared or printed.
 */

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 56;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;

const INK: [number, number, number] = [19, 32, 29];
const BODY: [number, number, number] = [55, 68, 63];
const MUTED: [number, number, number] = [98, 110, 105];
const GREEN: [number, number, number] = [93, 141, 24];
const RULE: [number, number, number] = [214, 221, 212];

const SIZE = { title: 26, section: 19, heading: 15, body: 12, label: 10, score: 46 };
const LEADING = 1.45;

type Doc = import("jspdf").jsPDF;

class Writer {
  private y = MARGIN;
  constructor(private doc: Doc) {}

  private room(height: number) {
    if (this.y + height <= PAGE.height - MARGIN) return;
    this.doc.addPage();
    this.y = MARGIN;
  }

  gap(height: number) {
    this.y += height;
  }

  text(
    value: string,
    opts: { size?: number; color?: [number, number, number]; bold?: boolean; indent?: number } = {}
  ) {
    const size = opts.size ?? SIZE.body;
    const color = opts.color ?? BODY;
    const indent = opts.indent ?? 0;
    const lineHeight = size * LEADING;
    this.doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    this.doc.setFontSize(size);
    this.doc.setTextColor(color[0], color[1], color[2]);
    const lines = this.doc.splitTextToSize(value, CONTENT_WIDTH - indent) as string[];
    for (const line of lines) {
      this.room(lineHeight);
      this.doc.setFont("helvetica", opts.bold ? "bold" : "normal");
      this.doc.setFontSize(size);
      this.doc.setTextColor(color[0], color[1], color[2]);
      this.doc.text(line, MARGIN + indent, this.y + size);
      this.y += lineHeight;
    }
  }

  /** Small tracked uppercase label, used for field names. */
  label(value: string) {
    this.gap(4);
    this.text(value.toUpperCase(), { size: SIZE.label, color: MUTED, bold: true });
    this.gap(2);
  }

  sectionTitle(value: string) {
    this.room(SIZE.section * 3);
    this.gap(18);
    this.rule();
    this.gap(12);
    this.text(value, { size: SIZE.section, color: INK, bold: true });
    this.gap(8);
  }

  heading(value: string) {
    this.room(SIZE.heading * 3);
    this.gap(14);
    this.text(value, { size: SIZE.heading, color: INK, bold: true });
    this.gap(4);
  }

  rule() {
    this.room(1);
    this.doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
    this.doc.setLineWidth(0.75);
    this.doc.line(MARGIN, this.y, PAGE.width - MARGIN, this.y);
    this.y += 1;
  }

  /** A labelled block; skipped entirely when the API gave us nothing. */
  field(label: string, value: string) {
    if (!hasValue(value)) return;
    this.label(label);
    this.text(value);
  }

  list(items: string[], ordered = true) {
    items.forEach((item, i) => {
      const marker = ordered ? String(i + 1).padStart(2, "0") + "." : "•";
      this.room(SIZE.body * LEADING);
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(SIZE.body);
      this.doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
      this.doc.text(marker, MARGIN, this.y + SIZE.body);
      this.text(item, { indent: 26 });
      this.gap(6);
    });
  }

  listField(label: string, items: string[], ordered = true) {
    if (items.length === 0) return;
    this.label(label);
    this.list(items, ordered);
  }

  score(value: number, decision: string, confidence: string) {
    const lineHeight = SIZE.score * 1.1;
    this.room(lineHeight + 40);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(SIZE.score);
    this.doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
    this.doc.text(String(value), MARGIN, this.y + SIZE.score);
    const scoreWidth = this.doc.getTextWidth(String(value));
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(SIZE.heading);
    this.doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    this.doc.text("/100", MARGIN + scoreWidth + 4, this.y + SIZE.score);
    this.y += lineHeight;
    this.gap(6);
    this.text("Decision: " + decision, { size: SIZE.heading, color: INK, bold: true });
    this.text("Confidence: " + confidence, { size: SIZE.heading, color: INK, bold: true });
  }

  competitor(c: Competitor) {
    this.gap(10);
    this.text(c.name, { size: SIZE.heading, color: INK, bold: true });
    if (hasValue(c.description)) this.text(c.description);
    if (hasValue(c.similarity)) this.text(c.similarity, { color: MUTED });
    if (c.source_url) this.text(c.source_url, { size: SIZE.label, color: MUTED });
    this.gap(6);
  }

  marketClaim(m: MarketSizeValidation) {
    this.gap(8);
    if (hasValue(m.deck_claim)) this.text(m.deck_claim, { size: SIZE.heading, color: INK, bold: true });
    if (hasValue(m.assessment)) this.text(m.assessment, { color: MUTED });
    if (hasValue(m.explanation)) this.text(m.explanation);
    this.gap(4);
  }
}

function pageNumbers(doc: Doc) {
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(SIZE.label);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(i + " / " + total, PAGE.width - MARGIN, PAGE.height - MARGIN + 22, { align: "right" });
    doc.text("VCynic pitch deck review", MARGIN, PAGE.height - MARGIN + 22);
  }
}

/** True when the API gave us at least one value for a group of fields. */
function anyContent(values: string[] = [], lists: unknown[][] = []): boolean {
  return values.some(hasValue) || lists.some((l) => l.length > 0);
}

export async function buildReportPdf(res: Report): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const w = new Writer(doc);
  const { vc_assessment: vc, business_analysis: ba, market_research: mr } = res;

  w.text("Pitch deck review", { size: SIZE.title, color: INK, bold: true });
  w.gap(6);
  const created = res.created_at ? new Date(res.created_at) : null;
  const createdLabel =
    created && !Number.isNaN(created.getTime())
      ? created.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
      : res.created_at;
  w.text(
    ["Report " + res.report_id, createdLabel, res.document.page_count + " pages"]
      .filter(Boolean)
      .join("  ·  "),
    { size: SIZE.body, color: MUTED }
  );

  // --- Overview -----------------------------------------------------------
  w.sectionTitle("Overview");
  w.label("Investor readiness score");
  w.score(vc.investment_score, DECISION_LABEL[vc.investment_decision], vc.confidence);
  w.field("Reviewer memo", vc.harsh_vc_memo);

  // --- Analysis (no competitor content; that has its own section) ----------
  w.sectionTitle("Analysis");
  w.field("Executive summary", ba.executive_summary);
  w.field("Decision rationale", vc.decision_rationale);

  if (anyContent([ba.problem, ba.solution, ba.product, ba.target_customer])) {
    w.heading("Company");
    w.field("Problem", ba.problem);
    w.field("Solution", ba.solution);
    w.field("Product", ba.product);
    w.field("Target customer", ba.target_customer);
  }
  if (anyContent([ba.business_model, ba.revenue_model, ba.go_to_market, ba.funding_ask, vc.unit_economics_review])) {
    w.heading("Business model");
    w.field("Business model", ba.business_model);
    w.field("Revenue model", ba.revenue_model);
    w.field("Go to market", ba.go_to_market);
    w.field("Funding ask", ba.funding_ask);
    w.field("Unit economics review", vc.unit_economics_review);
  }
  if (anyContent([mr.market_definition, mr.claim_assessment], [mr.market_size_validation])) {
    w.heading("Market opportunity");
    w.field("Market definition", mr.market_definition);
    w.field("Claim assessment", mr.claim_assessment);
    if (mr.market_size_validation.length > 0) {
      w.label("Market size validation");
      mr.market_size_validation.forEach((m) => w.marketClaim(m));
    }
  }
  if (anyContent([ba.traction, vc.traction_review, ba.team, vc.team_review])) {
    w.heading("Traction and team");
    w.field("Traction", ba.traction);
    w.field("Traction review", vc.traction_review);
    w.field("Team", ba.team);
    w.field("Team review", vc.team_review);
  }
  if (anyContent([], [ba.market_claims, ba.financial_claims, ba.key_assumptions, ba.source_quotes])) {
    w.heading("Claims and assumptions");
    w.listField("Market claims", ba.market_claims);
    w.listField("Financial claims", ba.financial_claims);
    w.listField("Key assumptions", ba.key_assumptions);
    w.listField("Source quotes", ba.source_quotes, false);
  }
  if (anyContent([], [vc.strengths, vc.critical_risks, ba.evidence_gaps, vc.required_changes, vc.diligence_questions])) {
    w.heading("Assessment");
    w.listField("Strengths", vc.strengths);
    w.listField("Critical risks", vc.critical_risks);
    w.listField("Evidence gaps", ba.evidence_gaps);
    w.listField("Required changes", vc.required_changes);
    w.listField("Diligence questions", vc.diligence_questions);
  }

  // --- Competitors ---------------------------------------------------------
  w.sectionTitle("Competitors");
  w.field("Market and competition review", vc.market_and_competition_review);
  if (mr.direct_competitors.length > 0) {
    w.heading("Direct competitors");
    mr.direct_competitors.forEach((c) => w.competitor(c));
  }
  if (mr.adjacent_alternatives.length > 0) {
    w.heading("Adjacent alternatives");
    mr.adjacent_alternatives.forEach((c) => w.competitor(c));
  }
  if (mr.direct_competitors.length === 0 && mr.adjacent_alternatives.length === 0) {
    w.text("The analysis service returned no competitors for this deck.", { color: MUTED });
  }
  w.listField("Differentiation risks", mr.differentiation_risks);
  w.listField("Research limitations", mr.research_limitations, false);

  const notes = [...res.document.warnings, ...res.processing_warnings];
  if (notes.length > 0) {
    w.sectionTitle("Processing notes");
    w.list(notes, false);
  }

  w.gap(18);
  w.rule();
  w.gap(10);
  w.text(res.disclaimer, { size: SIZE.label, color: MUTED });

  pageNumbers(doc);
  return doc.output("blob");
}

export function reportFilename(res: Report): string {
  const id = (res.report_id || "report").replace(/[^a-zA-Z0-9-_]/g, "");
  return "vcynic-pitch-review-" + (id || "report") + ".pdf";
}
