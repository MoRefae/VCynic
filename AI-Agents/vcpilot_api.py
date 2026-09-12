"""VCPilot: secure AI-assisted PDF pitch-deck diligence API."""
from __future__ import annotations

import json
import logging
import os
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ValidationError

load_dotenv()
# CrewAI imports initialise a local database immediately. Keep it project-local
# even when a caller imports a helper function directly instead of the API.
DEFAULT_CREWAI_STORAGE_DIR = Path(__file__).resolve().parent / ".crewai_storage"
os.environ.setdefault("CREWAI_STORAGE_DIR", str(DEFAULT_CREWAI_STORAGE_DIR))
# The API does not need CrewAI tracing. Disabling it avoids unrelated outbound
# telemetry requests and keeps uploaded-deck workflows private by default.
os.environ.setdefault("CREWAI_TRACING_ENABLED", "false")
os.environ.setdefault("OTEL_SDK_DISABLED", "true")
logger = logging.getLogger("vcpilot")


class VCPilotError(Exception):
    def __init__(self, code: str, message: str, status_code: int):
        self.code, self.message, self.status_code = code, message, status_code
        super().__init__(message)


@dataclass(frozen=True)
class Settings:
    openai_api_key: str | None
    openai_model: str
    max_pdf_mb: int
    max_pdf_pages: int
    max_text_chars: int
    llm_timeout_seconds: int
    crewai_storage_dir: Path
    allowed_origins: list[str] = field(default_factory=list)
    mock_mode: bool = False
    api_key: str | None = None

    @classmethod
    def from_env(cls) -> "Settings":
        origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
        return cls(
            openai_api_key=os.getenv("OPENAI_API_KEY"),
            openai_model=os.getenv("OPENAI_MODEL", "openai/gpt-4o-mini"),
            max_pdf_mb=int(os.getenv("MAX_PDF_MB", "50")),
            max_pdf_pages=int(os.getenv("MAX_PDF_PAGES", "40")),
            max_text_chars=int(os.getenv("MAX_TEXT_CHARS", "100000")),
            llm_timeout_seconds=int(os.getenv("LLM_TIMEOUT_SECONDS", "90")),
            crewai_storage_dir=Path(os.getenv("CREWAI_STORAGE_DIR", str(DEFAULT_CREWAI_STORAGE_DIR))).expanduser().resolve(),
            allowed_origins=[value.strip() for value in origins.split(",") if value.strip()],
            mock_mode=os.getenv("VCPILOT_MOCK_MODE", "false").lower() == "true",
            api_key=os.getenv("VCPILOT_API_KEY") or None,
        )


def configure_crewai_storage(settings: Settings) -> None:
    """Keep CrewAI's cache/database inside the project, not macOS Application Support."""
    try:
        settings.crewai_storage_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise VCPilotError("crewai_storage_unavailable", "CrewAI could not create its local storage directory.", 500) from exc
    os.environ["CREWAI_STORAGE_DIR"] = str(settings.crewai_storage_dir)


class Source(BaseModel):
    title: str
    url: str
    publisher: str = "not stated"
    published_or_accessed_date: str = "not stated"
    claim_supported: str


class BusinessAnalysis(BaseModel):
    executive_summary: str
    problem: str
    solution: str
    target_customer: str
    product: str
    business_model: str
    revenue_model: str
    traction: str
    go_to_market: str
    team: str
    funding_ask: str
    market_claims: list[str] = Field(default_factory=list)
    financial_claims: list[str] = Field(default_factory=list)
    key_assumptions: list[str] = Field(default_factory=list)
    evidence_gaps: list[str] = Field(default_factory=list)
    source_quotes: list[str] = Field(default_factory=list)


class Competitor(BaseModel):
    name: str
    description: str
    similarity: str
    source_url: str | None = None


class MarketSizeValidation(BaseModel):
    deck_claim: str
    assessment: Literal["supported", "partially_supported", "unsupported", "not_stated", "inconclusive"]
    explanation: str


class MarketResearch(BaseModel):
    market_definition: str
    direct_competitors: list[Competitor] = Field(default_factory=list)
    adjacent_alternatives: list[Competitor] = Field(default_factory=list)
    market_size_validation: list[MarketSizeValidation] = Field(default_factory=list)
    claim_assessment: str
    differentiation_risks: list[str] = Field(default_factory=list)
    research_limitations: list[str] = Field(default_factory=list)
    sources: list[Source] = Field(default_factory=list)


class VCAssessment(BaseModel):
    investment_decision: Literal["invest", "conditional_invest", "pass"]
    decision_rationale: str
    strengths: list[str] = Field(default_factory=list)
    critical_risks: list[str] = Field(default_factory=list)
    unit_economics_review: str
    market_and_competition_review: str
    traction_review: str
    team_review: str
    diligence_questions: list[str] = Field(default_factory=list)
    required_changes: list[str] = Field(default_factory=list)
    investment_score: int = Field(ge=0, le=100)
    confidence: Literal["low", "medium", "high"]
    harsh_vc_memo: str


class DocumentMetadata(BaseModel):
    page_count: int
    raw_characters: int
    clean_characters: int
    warnings: list[str] = Field(default_factory=list)


class PDFExtractionResult(DocumentMetadata):
    text: str


class APIErrorDetail(BaseModel):
    code: str
    message: str
    fields: list[str] | None = None


class APIErrorResponse(BaseModel):
    detail: APIErrorDetail


class AIConnectionReport(BaseModel):
    """A minimal live-model check that does not process or retain a PDF."""
    status: Literal["ok", "mock_mode"]
    model: str
    message: str


class VCPilotReport(BaseModel):
    report_id: str
    created_at: datetime
    language: Literal["ar", "en"]
    document: DocumentMetadata
    business_analysis: BusinessAnalysis
    market_research: MarketResearch
    vc_assessment: VCAssessment
    disclaimer: str
    processing_warnings: list[str] = Field(default_factory=list)


def clean_extracted_text(text: str) -> str:
    """Clean PDF text without removing Arabic, currencies, numbers, or punctuation."""
    value = unicodedata.normalize("NFKC", text).replace("\u00a0", " ")
    value = "".join(char for char in value if char in "\n\t" or unicodedata.category(char)[0] != "C")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r" *\n *", "\n", value)
    return re.sub(r"\n{3,}", "\n\n", value).strip()


# Distinctive lorem-ipsum vocabulary. A paragraph is flagged as placeholder
# text if enough of its words come from this set -- catches both the classic
# "Lorem ipsum dolor sit amet..." opener and mid-passage filler variants that
# template tools (Canva, PowerPoint, Figma, etc.) splice in without it.
_LOREM_IPSUM_WORDS = {
    "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit", "sed", "do",
    "eiusmod", "tempor", "incididunt", "ut", "labore", "et", "dolore", "magna", "aliqua", "quis",
    "nostrud", "exercitation", "ullamco", "laboris", "nisi", "aliquip", "ea", "commodo", "consequat",
    "duis", "aute", "irure", "reprehenderit", "voluptate", "velit", "esse", "cillum", "fugiat",
    "nulla", "pariatur", "excepteur", "sint", "occaecat", "cupidatat", "proident", "sunt", "culpa",
    "officia", "deserunt", "mollit", "anim", "laborum", "quisque", "molestie", "nisl", "eu", "sem",
    "tristique", "convallis", "maecenas", "varius", "lectus", "hendrerit", "augue", "blandit",
    "posuere", "erat", "aliquam", "praesent", "auctor", "tellus", "eget", "purus", "elementum",
    "vestibulum", "fermentum", "vel", "class", "aptent", "taciti", "sociosqu", "litora", "torquent",
    "conubia", "nostra", "inceptos", "himenaeos", "curabitur", "sodales", "ligula", "porttitor",
    "nunc", "mauris", "vitae", "nibh", "phasellus", "gravida", "semper", "cras", "justo", "odio",
}


def _looks_like_lorem_ipsum(paragraph: str) -> bool:
    words = re.findall(r"[a-zA-Z]+", paragraph.lower())
    if len(words) < 6:
        return False
    hits = sum(1 for w in words if w in _LOREM_IPSUM_WORDS)
    return hits / len(words) >= 0.3


def detect_placeholder_text(text: str) -> int:
    """Count paragraphs that look like lorem-ipsum / duplicated template filler.

    Non-destructive: used only to surface a warning about the document. The
    original text is still sent to the LLM in full -- the agent is prompted
    to recognize and correctly discount placeholder content itself, which is
    more reliable than a word-list heuristic at telling real content apart
    from filler that happens to sit next to it on the same slide.
    """
    paragraphs = text.split("\n\n")
    seen: dict[str, int] = {}
    for p in paragraphs:
        key = p.strip().lower()
        if key:
            seen[key] = seen.get(key, 0) + 1

    count = 0
    for p in paragraphs:
        key = p.strip().lower()
        is_lorem = _looks_like_lorem_ipsum(p)
        is_repeated_filler = len(key) > 40 and seen.get(key, 0) >= 2
        if is_lorem or is_repeated_filler:
            count += 1
    return count


def extract_and_clean_pdf(pdf_bytes: bytes, settings: Settings) -> PDFExtractionResult:
    if not pdf_bytes:
        raise VCPilotError("empty_file", "The uploaded file is empty.", 400)
    if len(pdf_bytes) > settings.max_pdf_mb * 1024 * 1024:
        raise VCPilotError("file_too_large", f"PDF must be at most {settings.max_pdf_mb} MB.", 413)
    if not pdf_bytes.startswith(b"%PDF"):
        raise VCPilotError("invalid_pdf", "The uploaded file is not a valid PDF.", 400)
    try:
        import fitz
        document = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        raise VCPilotError("unreadable_pdf", "The PDF is corrupt, encrypted, or cannot be opened.", 422) from exc
    try:
        if document.needs_pass:
            raise VCPilotError("password_protected_pdf", "Password-protected PDFs are not supported.", 422)
        page_count = document.page_count
        if page_count > settings.max_pdf_pages:
            raise VCPilotError("too_many_pages", f"PDF must contain at most {settings.max_pdf_pages} pages.", 413)
        raw_text = "\n\n".join(page.get_text("text") for page in document)
    finally:
        document.close()
    clean_text = clean_extracted_text(raw_text)
    warnings = []
    if len(clean_text) < 80:
        warnings.append("Very little selectable text was found. The PDF may require OCR.")
    placeholder_count = detect_placeholder_text(clean_text)
    if placeholder_count:
        warnings.append(
            f"Detected {placeholder_count} section(s) that look like unfinished template/lorem-ipsum "
            "text. The full deck text was still sent for analysis; the AI was instructed to identify "
            "and correctly discount placeholder content rather than summarize it as real claims."
        )
    if not clean_text:
        raise VCPilotError("no_extractable_text", "No extractable text was found. Upload a text-based PDF or run OCR first.", 422)
    if len(clean_text) > settings.max_text_chars:
        clean_text = clean_text[:settings.max_text_chars]
        warnings.append(f"Extracted text was truncated to {settings.max_text_chars:,} characters.")
    return PDFExtractionResult(page_count=page_count, raw_characters=len(raw_text), clean_characters=len(clean_text), text=clean_text, warnings=warnings)


def _strip_json_fence(value: str) -> str:
    value = value.strip()
    if value.startswith("```"):
        value = re.sub(r"^```(?:json)?\s*", "", value, flags=re.I)
        value = re.sub(r"\s*```$", "", value)
    return value.strip()


def _task_output_to_model(task: Any, model: type[BaseModel]) -> BaseModel:
    output = getattr(task, "output", None)
    candidate = getattr(output, "pydantic", None)
    if isinstance(candidate, model):
        return candidate
    if isinstance(candidate, BaseModel):
        return model.model_validate(candidate.model_dump())
    raw = getattr(output, "raw", None)
    if not raw:
        raise VCPilotError("invalid_agent_output", f"{model.__name__} returned no structured output.", 500)
    try:
        return model.model_validate_json(_strip_json_fence(str(raw)))
    except ValidationError as exc:
        raise VCPilotError("invalid_agent_output", f"{model.__name__} returned invalid structured JSON.", 500) from exc


def _duckduckgo_tool() -> Any:
    try:
        from crewai.tools import tool
        try:
            from ddgs import DDGS
        except ImportError:  # Backward-compatible with existing local environments.
            from duckduckgo_search import DDGS
    except ImportError as exc:
        raise VCPilotError("missing_research_dependency", "Install crewai and ddgs to enable market research.", 500) from exc

    @tool("DuckDuckGo web search")
    def duckduckgo_web_search(query: str) -> str:
        """Search the public web for competitors and market evidence."""
        try:
            results = list(DDGS().text(query, max_results=5))
            return json.dumps([{"title": r.get("title", ""), "url": r.get("href", ""), "snippet": r.get("body", "")} for r in results if r.get("href")], ensure_ascii=False)
        except Exception as exc:
            return json.dumps({"search_error": type(exc).__name__, "results": []})
    return duckduckgo_web_search


def _provider_error_from_exception(exc: Exception) -> VCPilotError:
    """Convert provider failures to a useful, non-secret API response."""
    logger.exception("AI provider request failed; error_type=%s", type(exc).__name__)
    error_text = str(exc).lower()
    if "connection" in error_text or "name resolution" in error_text or "nodename" in error_text:
        code = "openai_connection_failed"
        message = "Could not reach OpenAI. Check the internet connection, DNS, firewall, VPN, or proxy, then retry."
    elif "authentication" in error_text or "invalid api key" in error_text or "incorrect api key" in error_text or "401" in error_text:
        code = "openai_authentication_failed"
        message = "OpenAI rejected the API key. Create a new project API key and update OPENAI_API_KEY."
    elif "rate limit" in error_text or "quota" in error_text or "insufficient" in error_text or "429" in error_text:
        code = "openai_quota_or_rate_limit"
        message = "OpenAI rate limit or billing quota was reached. Check the project billing and retry shortly."
    elif "model" in error_text and ("not found" in error_text or "does not exist" in error_text or "404" in error_text):
        code = "openai_model_unavailable"
        message = "OPENAI_MODEL is unavailable to this API project. Set it to a model enabled for the project, then restart the server."
    elif "timeout" in error_text or "timed out" in error_text:
        code = "openai_timeout"
        message = "The AI request timed out. Check the connection and retry; if it persists, increase LLM_TIMEOUT_SECONDS."
    else:
        code = "analysis_provider_error"
        message = f"The AI provider failed ({type(exc).__name__}). Run GET /api/v1/diagnostics/ai to isolate the key, model, and connection."
    return VCPilotError(code, message, 502)


def check_ai_connection(settings: Settings) -> AIConnectionReport:
    """Check the configured model using one tiny request before a costly deck run."""
    if settings.mock_mode:
        return AIConnectionReport(status="mock_mode", model=settings.openai_model, message="Mock mode is enabled; no provider request was made.")
    if not settings.openai_api_key:
        raise VCPilotError("missing_api_key", "OPENAI_API_KEY is required unless VCPILOT_MOCK_MODE=true.", 503)
    try:
        configure_crewai_storage(settings)
        from crewai import LLM
        reply = LLM(model=settings.openai_model, api_key=settings.openai_api_key, temperature=0, timeout=settings.llm_timeout_seconds).call("Reply with exactly: OK")
        if not str(reply).strip():
            raise RuntimeError("The model returned an empty response.")
        return AIConnectionReport(status="ok", model=settings.openai_model, message="OpenAI connection and model are working.")
    except VCPilotError:
        raise
    except Exception as exc:
        raise _provider_error_from_exception(exc) from exc


BUSINESS_ANALYST_PROMPT = """You are a rigorous startup Business Analyst. Read only the supplied pitch-deck evidence. Extract the customer problem, proposed solution, target customers, product, business and revenue model, traction, go-to-market, team, funding ask, and every stated financial or market claim. Separate evidence from inference. If a fact is absent, write 'not stated'; never fabricate.

Some decks include unfinished template placeholder text (e.g. 'Lorem ipsum dolor sit amet, consectetur adipiscing elit...' or other generic filler repeated across several slides, sometimes in languages other than Latin). This is NOT real content from the founders -- it is leftover boilerplate from the slide template. When you encounter it:
- Do not translate, summarize, or paraphrase it as if it were the founder's actual claim.
- Write 'not stated' for that field, exactly as you would for a blank slide.
- Add a specific evidence gap noting which section still contains placeholder/template text and appears unfinished (e.g. "Executive summary slide still contains placeholder lorem-ipsum text and has not been completed").
- Still extract and use any real, non-placeholder content elsewhere on the same or nearby slides normally (e.g. short labeled bullets, names, numbers) -- placeholder text in one section should not cause you to discard real content in another.

Flag contradictions and evidence gaps. Return structured JSON only."""
MARKET_RESEARCHER_PROMPT = """You are a skeptical market-intelligence researcher. Use web search to identify direct competitors and credible market-size evidence. Distinguish direct competitors from adjacent alternatives. Compare every deck market claim with sources, dates, geography, and methodology whenever available. Never invent search results or citations. If evidence is weak, unavailable, conflicting, or too broad, say so explicitly. Return structured JSON only."""
HARSH_VC_PROMPT = """You are a managing partner at a Silicon Valley venture-capital fund. You are blunt, evidence-led, and intolerant of unrealistic metrics. Assess the evidence from the Business Analyst and Market Researcher. Stress-test market size, positioning, moat, traction, execution risk, unit economics, CAC, LTV, gross margin, burn, runway, and valuation logic. Do not flatter the founders. Do not invent metrics: label missing evidence as a risk. If the Business Analyst flagged sections as unfinished placeholder/template text, treat that specifically as "deck is incomplete / not investor-ready" rather than as evidence of a flawed business -- note it as a required change (finish the deck) distinct from substantive risks about the business itself. End with a clear investment decision and specific changes required to reconsider. Return structured JSON only."""


def _mock_results(language: Literal["ar", "en"]) -> tuple[BusinessAnalysis, MarketResearch, VCAssessment]:
    absent = "غير مذكور في العرض" if language == "ar" else "not stated in the deck"
    business = BusinessAnalysis(executive_summary="مثال تجريبي فقط" if language == "ar" else "Demo fixture only", problem=absent, solution=absent, target_customer=absent, product=absent, business_model=absent, revenue_model=absent, traction=absent, go_to_market=absent, team=absent, funding_ask=absent, evidence_gaps=["Offline mock mode is enabled."])
    market = MarketResearch(market_definition=absent, claim_assessment=absent, research_limitations=["No web search is run in offline mock mode."])
    vc = VCAssessment(investment_decision="pass", decision_rationale="Offline demo mode cannot support an investment decision.", critical_risks=["This is a deterministic mock, not diligence."], unit_economics_review=absent, market_and_competition_review=absent, traction_review=absent, team_review=absent, diligence_questions=["Run live analysis with a valid API key and PDF."], investment_score=0, confidence="low", harsh_vc_memo="Offline mock only — do not use as an investment decision.")
    return business, market, vc


def run_crewai_pipeline(clean_text: str, language: Literal["ar", "en"], settings: Settings) -> tuple[BusinessAnalysis, MarketResearch, VCAssessment]:
    """Run the three required agents sequentially, with Pydantic validation at each hand-off."""
    if settings.mock_mode:
        return _mock_results(language)
    if not settings.openai_api_key:
        raise VCPilotError("missing_api_key", "OPENAI_API_KEY is required unless VCPILOT_MOCK_MODE=true.", 503)
    try:
        configure_crewai_storage(settings)
        from crewai import Agent, Crew, LLM, Process, Task
    except ImportError as exc:
        raise VCPilotError("missing_crewai", "Install CrewAI before running live analysis.", 500) from exc
    try:
        llm = LLM(model=settings.openai_model, api_key=settings.openai_api_key, temperature=0.1, timeout=settings.llm_timeout_seconds)
        analyst = Agent(role="Business Analyst", goal="Extract evidence without fabrication.", backstory=BUSINESS_ANALYST_PROMPT, llm=llm, verbose=False, allow_delegation=False)
        researcher = Agent(role="Market Researcher", goal="Validate market claims using web evidence.", backstory=MARKET_RESEARCHER_PROMPT, llm=llm, tools=[_duckduckgo_tool()], verbose=False, allow_delegation=False)
        vc = Agent(role="The Harsh VC", goal="Reach a direct evidence-led investment decision.", backstory=HARSH_VC_PROMPT, llm=llm, verbose=False, allow_delegation=False)
        language_instruction = "Write all narrative values in Arabic." if language == "ar" else "Write all narrative values in English."
        analysis_task = Task(description=f"{BUSINESS_ANALYST_PROMPT}\n{language_instruction}\n\nPITCH-DECK EVIDENCE:\n{clean_text}", expected_output="Valid BusinessAnalysis JSON only.", agent=analyst, output_pydantic=BusinessAnalysis)
        research_task = Task(description=f"{MARKET_RESEARCHER_PROMPT}\n{language_instruction}\nUse the previous analysis. Run focused searches. Only cite URLs returned by the tool.", expected_output="Valid MarketResearch JSON only.", agent=researcher, context=[analysis_task], output_pydantic=MarketResearch)
        vc_task = Task(description=f"{HARSH_VC_PROMPT}\n{language_instruction}\nUse the previous reports. Treat missing CAC, LTV, margin, burn and runway as diligence gaps.", expected_output="Valid VCAssessment JSON only.", agent=vc, context=[analysis_task, research_task], output_pydantic=VCAssessment)
        Crew(agents=[analyst, researcher, vc], tasks=[analysis_task, research_task, vc_task], process=Process.sequential, verbose=False).kickoff()
        return _task_output_to_model(analysis_task, BusinessAnalysis), _task_output_to_model(research_task, MarketResearch), _task_output_to_model(vc_task, VCAssessment)
    except VCPilotError:
        raise
    except Exception as exc:
        raise _provider_error_from_exception(exc) from exc


def run_vcpilot_analysis(pdf_bytes: bytes, language: Literal["ar", "en"] = "ar", settings: Settings | None = None) -> VCPilotReport:
    active = settings or Settings.from_env()
    extraction = extract_and_clean_pdf(pdf_bytes, active)
    business, market, vc = run_crewai_pipeline(extraction.text, language, active)
    return VCPilotReport(report_id=str(uuid4()), created_at=datetime.now(timezone.utc), language=language, document=DocumentMetadata(**extraction.model_dump(exclude={"text"})), business_analysis=business, market_research=market, vc_assessment=vc, disclaimer="هذا تحليل أولي مدعوم بالذكاء الاصطناعي وليس نصيحة استثمارية أو قانونية أو مالية." if language == "ar" else "This is an AI-assisted preliminary analysis, not investment, legal, or financial advice.", processing_warnings=extraction.warnings + (["Offline mock mode was used; no live model or web research was run."] if active.mock_mode else []))


def create_app(settings: Settings | None = None) -> FastAPI:
    active = settings or Settings.from_env()
    app = FastAPI(title="VCPilot API", version="1.0.0", description="AI-assisted pitch-deck diligence API")
    app.add_middleware(CORSMiddleware, allow_origins=active.allowed_origins, allow_credentials=True, allow_methods=["GET", "POST"], allow_headers=["Content-Type", "Authorization", "X-API-Key"])

    def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
        """Reject requests missing/mismatching X-API-Key, when VCPILOT_API_KEY is configured.

        If no key is configured (local dev with VCPILOT_API_KEY unset), this is a no-op so
        existing local workflows and tests keep working without any changes.
        """
        if active.api_key and x_api_key != active.api_key:
            raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Missing or invalid X-API-Key header."})

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        fields = [".".join(str(part) for part in error["loc"] if part != "body") for error in exc.errors()]
        return JSONResponse(
            status_code=422,
            content={"detail": {"code": "validation_error", "message": "Provide a PDF in the required 'file' field and use language 'ar' or 'en'.", "fields": fields}},
        )

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "live_analysis_ready": bool(active.openai_api_key) and not active.mock_mode,
            "mock_mode": active.mock_mode,
            "model": active.openai_model,
            "max_pdf_mb": active.max_pdf_mb,
        }

    @app.get(
        "/api/v1/diagnostics/ai",
        response_model=AIConnectionReport,
        dependencies=[Depends(require_api_key)],
        responses={502: {"model": APIErrorResponse, "description": "OpenAI connection, key, or model failure"}, 503: {"model": APIErrorResponse, "description": "AI service is not configured"}},
    )
    async def diagnose_ai() -> AIConnectionReport:
        """Make a minimal model call; use this before uploading a pitch deck."""
        try:
            return check_ai_connection(active)
        except VCPilotError as exc:
            raise HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message}) from exc

    @app.post(
        "/api/v1/analyze-pitch-deck",
        response_model=VCPilotReport,
        dependencies=[Depends(require_api_key)],
        responses={
            400: {"model": APIErrorResponse, "description": "Invalid file type"},
            413: {"model": APIErrorResponse, "description": "Upload exceeds configured limit"},
            422: {"model": APIErrorResponse, "description": "Missing/invalid request or unreadable PDF"},
            502: {"model": APIErrorResponse, "description": "AI provider or research service failure"},
            503: {"model": APIErrorResponse, "description": "AI service is not configured"},
        },
    )
    async def analyze_pitch_deck(file: UploadFile = File(...), language: Literal["ar", "en"] = Query(default="ar")) -> VCPilotReport:
        if file.content_type not in {"application/pdf", "application/x-pdf"}:
            raise HTTPException(status_code=400, detail={"code": "unsupported_media_type", "message": "Only application/pdf uploads are accepted."})
        try:
            pdf_bytes = await file.read()
            return await run_in_threadpool(run_vcpilot_analysis, pdf_bytes, language, active)
        except VCPilotError as exc:
            raise HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message}) from exc
        except Exception:
            logger.exception("Unexpected VCPilot processing failure")
            raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "The analysis could not be completed."})
        finally:
            await file.close()
    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("vcpilot_api:app", host="0.0.0.0", port=8000, reload=True)
