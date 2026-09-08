// Mirrors vcpilot_api.py's Pydantic models (VCPilotReport and friends).
// Every field rendered by the dashboard or the PDF comes from here, i.e.
// straight off the analysis API response -- nothing is derived or invented.

export type Competitor = {
  name: string;
  description: string;
  similarity: string;
  source_url?: string | null;
};

export type MarketSizeValidation = {
  deck_claim: string;
  assessment: string;
  explanation: string;
};

export type Report = {
  report_id: string;
  created_at: string;
  // The upstream API still reports which language it produced. VCynic only
  // ever requests English (see app/api/analyze/route.ts).
  language: string;
  document: {
    page_count: number;
    raw_characters: number;
    clean_characters: number;
    warnings: string[];
  };
  business_analysis: {
    executive_summary: string; problem: string; solution: string; target_customer: string;
    product: string; business_model: string; revenue_model: string; traction: string;
    go_to_market: string; team: string; funding_ask: string;
    market_claims: string[]; financial_claims: string[]; key_assumptions: string[];
    evidence_gaps: string[]; source_quotes: string[];
  };
  market_research: {
    market_definition: string; direct_competitors: Competitor[]; adjacent_alternatives: Competitor[];
    market_size_validation: MarketSizeValidation[]; claim_assessment: string;
    differentiation_risks: string[]; research_limitations: string[];
  };
  vc_assessment: {
    investment_decision: "invest" | "conditional_invest" | "pass";
    decision_rationale: string; strengths: string[]; critical_risks: string[];
    unit_economics_review: string; market_and_competition_review: string;
    traction_review: string; team_review: string;
    diligence_questions: string[]; required_changes: string[];
    investment_score: number; confidence: string; harsh_vc_memo: string;
  };
  disclaimer: string;
  processing_warnings: string[];
};

export const DECISION_LABEL: Record<Report["vc_assessment"]["investment_decision"], string> = {
  invest: "Invest",
  conditional_invest: "Conditional invest",
  pass: "Pass",
};

/** The API leaves unknown fields empty or as "not stated"; both mean "no data". */
export function hasValue(value: string | null | undefined): boolean {
  const v = (value || "").trim();
  return v.length > 0 && v.toLowerCase() !== "not stated";
}
