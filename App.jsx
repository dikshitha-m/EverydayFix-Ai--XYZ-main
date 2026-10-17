import { useEffect, useRef, useState } from 'react';
import { attemptStatusText, findRecordedStepOutcome, recordStepOutcome } from './attempts.js';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  Bot,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Droplets,
  FlaskConical,
  Hammer,
  Leaf,
  LoaderCircle,
  MessageCircle,
  Play,
  Printer,
  RotateCcw,
  Send,
  ShieldCheck,
  Sliders,
  Sparkles,
  Trash2,
  TriangleAlert,
  Volume2,
  VolumeX,
  Wrench,
  X
} from 'lucide-react';
import { MISSION_SCENARIOS, runLiveScenario } from './missionAudit.js';

const STORAGE_KEY = 'everydayfix-cases-v2';
const LEGACY_STORAGE_KEY = 'everydayfix-current-case-v1';
const MAX_CLARIFICATIONS = 4;
const OUTCOMES = [
  { value: 'completed', label: 'Completed' },
  { value: 'partial_improvement', label: 'Helped a little' },
  { value: 'no_improvement', label: 'No improvement' },
  { value: 'failed', label: 'Did not work' },
  { value: 'stuck', label: 'Got stuck' },
  { value: 'worsened', label: 'Made it worse' }
];

const CATEGORIES = [
  { name: 'Cleaning & stains', icon: Droplets, example: 'Coffee spill on a cotton shirt' },
  { name: 'Small home fixes', icon: Hammer, example: 'Candle wax on a wooden table' },
  { name: 'Everyday objects', icon: Wrench, example: 'Mud on canvas shoes' },
  { name: 'Not sure yet', icon: CircleHelp, example: '' }
];

function createId() {
  return globalThis.crypto?.randomUUID?.() || `case-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emptyCase(problem = '') {
  return {
    problemId: createId(),
    originalProblem: problem,
    problem,
    category: '',
    material: '',
    cause: '',
    tried: '',
    timeAvailable: '',
    budget: '',
    availableMaterials: '',
    skillLevel: '',
    attempts: [],
    clarifications: [],
    askedQuestions: [],
    displayedQuestions: [],
    plans: [],
    safetyWarnings: [],
    pendingRequestId: '',
    result: null
  };
}

function needsRefresh(result) {
  return result?.mode === 'local demo mode' ||
    /text-only demo mode does not have a tested fix|follow-up limit reached/i.test(`${result?.title || ''} ${result?.summary || ''} ${result?.message || ''}`);
}

function pruneCases(rawCases) {
  if (!Array.isArray(rawCases) || !rawCases.length) return [emptyCase()];
  const seenProblems = new Set();
  const pruned = [];

  for (let i = rawCases.length - 1; i >= 0; i--) {
    const item = rawCases[i];
    const key = (item.problem || '').trim().toLowerCase();
    if (!key) {
      if (!seenProblems.has('__empty__')) {
        seenProblems.add('__empty__');
        pruned.unshift(item);
      }
      continue;
    }
    if (!seenProblems.has(key)) {
      seenProblems.add(key);
      pruned.unshift(item);
    }
    if (pruned.length >= 8) break;
  }
  return pruned.length ? pruned : [emptyCase()];
}

function readSavedWorkspace() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && Array.isArray(saved.cases) && saved.cases.length) {
      const rawCases = saved.cases.map((item) => ({
        ...emptyCase(),
        ...item,
        problemId: item.problemId || createId(),
        originalProblem: item.originalProblem || item.problem || '',
        attempts: Array.isArray(item.attempts) ? item.attempts : [],
        clarifications: Array.isArray(item.clarifications) ? item.clarifications : [],
        askedQuestions: Array.isArray(item.askedQuestions) ? item.askedQuestions.slice(0, MAX_CLARIFICATIONS) : [],
        displayedQuestions: Array.isArray(item.displayedQuestions) ? item.displayedQuestions : [],
        plans: Array.isArray(item.plans) ? item.plans : [],
        safetyWarnings: Array.isArray(item.safetyWarnings) ? item.safetyWarnings : [],
        ...(needsRefresh(item.result) ? { result: null, displayedQuestions: [], pendingRequestId: '' } : {})
      }));
      const cases = pruneCases(rawCases);
      const activeCaseId = cases.some(({ problemId }) => problemId === saved.activeCaseId)
        ? saved.activeCaseId : cases.at(-1).problemId;
      return { activeCaseId, cases };
    }
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || 'null');
    const migrated = { ...emptyCase(), ...(legacy && typeof legacy === 'object' ? legacy : {}) };
    migrated.originalProblem ||= migrated.problem;
    migrated.plans ||= [];
    migrated.safetyWarnings ||= [];
    if (needsRefresh(migrated.result)) {
      migrated.result = null;
      migrated.displayedQuestions = [];
      migrated.pendingRequestId = '';
    }
    return { activeCaseId: migrated.problemId, cases: [migrated] };
  } catch {
    const freshCase = emptyCase();
    return { activeCaseId: freshCase.problemId, cases: [freshCase] };
  }
}

function questionTopics(question) {
  const text = question.toLowerCase();
  const topics = [];
  if (/\b(happen|change|improv|wors|result|outcome|colour|color|texture|damage|effect|reaction)\b/.test(text)) topics.push('outcome');
  if (/\b(product|cleaner|chemical|soap|detergent|used|applied|sprayed|tried|treatment|method)\b/.test(text)) topics.push('prior-treatment');
  if (/\b(material|fabric|fibre|fiber|cotton|polyester|leather|suede|surface|finish|made of)\b/.test(text)) topics.push('material');
  if (/\b(care|label|manufacturer|instruction|washing|washable|code)\b/.test(text)) topics.push('care');
  if (/\b(cause|caused|source|spill|substance|liquid|mark|stain)\b/.test(text)) topics.push('cause');
  if (/\b(item|object|which|what is affected)\b/.test(text)) topics.push('item');
  return topics.length ? [...new Set(topics)].sort() : [text.replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()];
}

function questionTopic(question) {
  return questionTopics(question).join('+');
}

function sameQuestionMeaning(first, second) {
  const left = questionTopics(first);
  const right = questionTopics(second);
  const overlap = left.filter((topic) => right.includes(topic)).length;
  return overlap > 0 && overlap / new Set([...left, ...right]).size >= 0.5;
}

function historyText(clarifications) {
  return clarifications.map(({ question, answer }) =>
    `Clarification: ${question}\nAnswer: ${answer}`
  ).join('\n');
}

function answerErrorMessage(payload, status) {
  if (typeof payload?.error === 'string') return payload.error;
  return `The request could not be completed (HTTP ${status}). Please try again.`;
}

function PreferenceComparisonCard({ comparison }) {
  if (!comparison) return null;
  const { matchGrade = 'Ready', overallSummary = '', time, budget, materials, skillLevel } = comparison;
  const gradeClass = `grade-${(matchGrade || 'optimal').toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className="pref-comparison-box">
      <div className="pref-heading">
        <div className="pref-title"><Clock3 size={16} /> Preferences & Readiness Comparison</div>
        <span className={`pref-grade-badge ${gradeClass}`}>{matchGrade}</span>
      </div>
      {overallSummary ? <p className="pref-summary">{overallSummary}</p> : null}
      <div className="pref-grid">
        <div className="pref-metric">
          <div className="pref-metric-header">
            <span className="pref-metric-name">Time Required</span>
            <span className={`pref-pill status-${time?.status || 'fits'}`}>
              {time?.status === 'fits' ? '✓ Fits schedule' : time?.status === 'exceeds' ? '⚠ More time needed' : 'Flexible'}
            </span>
          </div>
          <div className="pref-metric-values">
            <span><strong>Plan estimate:</strong> {time?.planRequirement || '10–20 min'}</span>
            <span><strong>Your window:</strong> {time?.userPreference || 'Flexible'}</span>
          </div>
          {time?.note ? <p className="pref-metric-note">{time.note}</p> : null}
        </div>

        <div className="pref-metric">
          <div className="pref-metric-header">
            <span className="pref-metric-name">Cost & Budget</span>
            <span className={`pref-pill status-${budget?.status || 'within_budget'}`}>
              {budget?.status === 'within_budget' ? '✓ Within budget' : '⚠ Extra cost'}
            </span>
          </div>
          <div className="pref-metric-values">
            <span><strong>Plan cost:</strong> {budget?.planRequirement || '$0 (household supplies)'}</span>
            <span><strong>Your budget:</strong> {budget?.userPreference || '$0'}</span>
          </div>
          {budget?.note ? <p className="pref-metric-note">{budget.note}</p> : null}
        </div>

        <div className="pref-metric">
          <div className="pref-metric-header">
            <span className="pref-metric-name">Materials On Hand</span>
            <span className={`pref-pill status-${materials?.status || 'all_on_hand'}`}>
              {materials?.status === 'all_on_hand' ? '✓ Ready on hand' : 'Supplies needed'}
            </span>
          </div>
          <div className="pref-metric-values">
            <span><strong>Have on hand:</strong> {materials?.onHand?.length || 0} items</span>
            <span><strong>To acquire:</strong> {materials?.missing?.length || 0} items</span>
          </div>
          {materials?.note ? <p className="pref-metric-note">{materials.note}</p> : null}
        </div>

        <div className="pref-metric">
          <div className="pref-metric-header">
            <span className="pref-metric-name">Complexity & Skill</span>
            <span className={`pref-pill status-${skillLevel?.status || 'compatible'}`}>
              {skillLevel?.status === 'compatible' ? '✓ Comfortable' : 'More involved'}
            </span>
          </div>
          <div className="pref-metric-values">
            <span><strong>Plan complexity:</strong> {skillLevel?.planRequirement || 'Beginner'}</span>
            <span><strong>Your comfort:</strong> {skillLevel?.userPreference || 'Beginner'}</span>
          </div>
          {skillLevel?.note ? <p className="pref-metric-note">{skillLevel.note}</p> : null}
        </div>
      </div>
    </div>
  );
}

function FixPathEvidenceDisplay({ evidence, observations = [], photoNote = '' }) {
  if (!evidence && !observations.length) return null;
  const extracted = evidence?.extracted || {};
  const limits = evidence?.limitsOfInference || [];
  return (
    <details className="fixpath-details" open>
      <summary className="fixpath-summary">
        <span className="fixpath-summary-title">
          <ShieldCheck size={16} /> FixPath Evidence & Inferences
        </span>
        <span className="fixpath-badge">{evidence?.safetyStatus || 'Verified safe'}</span>
      </summary>
      <div className="fixpath-content">
        <div className="extracted-grid">
          <div className="extracted-card">
            <span className="extracted-label">Identified Item</span>
            <span className="extracted-value">{extracted.targetItem || 'Household item'}</span>
          </div>
          <div className="extracted-card">
            <span className="extracted-label">Material / Surface</span>
            <span className="extracted-value">
              {extracted.material?.name || 'Unconfirmed'}
              <span className={`confidence-tag conf-${extracted.material?.confidence || 'unconfirmed'}`}>
                {extracted.material?.confidence || 'unconfirmed'}
              </span>
            </span>
          </div>
          <div className="extracted-card">
            <span className="extracted-label">Substance / Mishap</span>
            <span className="extracted-value">
              {extracted.substance?.name || 'Unconfirmed'}
              <span className={`confidence-tag conf-${extracted.substance?.confidence || 'unconfirmed'}`}>
                {extracted.substance?.confidence || 'unconfirmed'}
              </span>
            </span>
          </div>
          <div className="extracted-card">
            <span className="extracted-label">Prior Actions</span>
            <span className="extracted-value">
              {Array.isArray(extracted.priorActions) ? extracted.priorActions.join(', ') : 'None'}
            </span>
          </div>
        </div>

        {observations.length ? (
          <div className="observation-box">
            <strong>What the photo directly shows</strong>
            <ul>{observations.map((item) => <li key={item}>{item}</li>)}</ul>
            {photoNote ? <small>{photoNote}</small> : null}
          </div>
        ) : null}

        {limits.length ? (
          <div className="limits-box">
            <span className="limits-title"><CircleHelp size={14} /> Boundaries of Safe Inference</span>
            <ul>{limits.map((limit, idx) => <li key={idx}>{limit}</li>)}</ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function IngredientAnalysisTable({ ingredients }) {
  if (!Array.isArray(ingredients) || !ingredients.length) return null;
  return (
    <div className="ingredient-box">
      <div className="ingredient-heading">
        <FlaskConical size={16} />
        <span>Ingredient & Chemical Safety Status</span>
      </div>
      <p className="ingredient-intro">
        Distinguishing ingredients listed on product packaging from ingredients not detected or whose status cannot safely be determined.
      </p>
      <div className="ingredient-list">
        {ingredients.map((item, idx) => (
          <div className="ingredient-row" key={`${item.name}-${idx}`}>
            <div className="ingredient-main">
              <span className="ingredient-name">{item.name}</span>
              <span className="ingredient-cat">{item.category}</span>
            </div>
            <div className="ingredient-status-col">
              <span className={`ingredient-badge status-${(item.status || 'CANNOT_BE_DETERMINED').toLowerCase().replace(/_/g, '-')}`}>
                {item.status === 'LISTED' && '✓ Listed on packaging'}
                {item.status === 'NOT_LISTED' && '✕ Not listed on label'}
                {item.status === 'NOT_DETECTED' && '○ Not detected in sample'}
                {item.status === 'CANNOT_BE_DETERMINED' && '? Cannot be determined'}
              </span>
            </div>
            <div className="ingredient-details">
              <span className="ingredient-desc">{item.explanation}</span>
              {item.hazardOrImpact ? <span className="ingredient-hazard">Safety note: {item.hazardOrImpact}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NutritionFactsWidget({ nutrition }) {
  if (!nutrition || !nutrition.nutrients || !nutrition.nutrients.length) return null;
  return (
    <div className="nutrition-card">
      <div className="nutrition-header">
        <h3>Nutrition Facts</h3>
        <p className="nutrition-sub">Normalized from product/label description</p>
        <div className="nutrition-serving-row">
          <span>Serving size</span>
          <span><strong>{nutrition.servingSize}</strong></span>
        </div>
        {nutrition.servingsPerContainer ? (
          <div className="nutrition-servings-container">
            <span>Servings per container: <strong>{nutrition.servingsPerContainer}</strong></span>
          </div>
        ) : null}
      </div>
      <div className="nutrition-bar-thick" />
      <div className="nutrition-calories-row">
        <span>Amount per serving<br /><strong className="nutrition-cal-title">Calories</strong></span>
        <span className="nutrition-cal-val">{nutrition.calories}</span>
      </div>
      <div className="nutrition-bar-medium" />
      <div className="nutrition-dv-header">% Daily Value*</div>
      <div className="nutrition-bar-thin" />
      <div className="nutrition-nutrients-list">
        {nutrition.nutrients.map((n, idx) => {
          const isSubItem = ['Saturated Fat', 'Trans Fat', 'Dietary Fiber', 'Total Sugars', 'Added Sugars'].includes(n.name);
          return (
            <div className={`nutrition-row ${isSubItem ? 'nutrition-subrow' : ''}`} key={`${n.name}-${idx}`}>
              <span>
                {isSubItem ? <span className="sub-indent" /> : null}
                <strong>{n.name}</strong> {n.amount}
              </span>
              {n.dailyValuePercent ? <span className="dv-val"><strong>{n.dailyValuePercent}</strong></span> : null}
            </div>
          );
        })}
      </div>
      {nutrition.cleaningSignificance ? (
        <div className="nutrition-cleanup-note">
          <Droplets size={14} />
          <span><strong>Spill significance:</strong> {nutrition.cleaningSignificance}</span>
        </div>
      ) : null}
    </div>
  );
}

function App() {
  const [caseStore, setCaseStore] = useState(readSavedWorkspace);
  const [health, setHealth] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [attemptSaveFailed, setAttemptSaveFailed] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [pendingAttempt, setPendingAttempt] = useState(null);
  const [clarificationDrafts, setClarificationDrafts] = useState({});
  const [image, setImage] = useState(null);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiProviderInput, setApiProviderInput] = useState('Gemini');
  const [keySaveMessage, setKeySaveMessage] = useState('');

  async function saveApiKey(clear = false) {
    try {
      const payload = clear ? { apiKey: '', provider: '' } : { apiKey: apiKeyInput, provider: apiProviderInput };
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.configured) {
        setKeySaveMessage(`Saved! Active provider: ${data.provider} (${data.model})`);
      } else {
        setKeySaveMessage('Cleared! EverydayFix is in local mode with built-in vision analyzer.');
        setApiKeyInput('');
      }
      const h = await fetch('/api/health').then((r) => r.json()).catch(() => null);
      if (h) setHealth(h);
      setTimeout(() => {
        setKeySaveMessage('');
        if (data.configured || clear) setShowKeyModal(false);
      }, 1500);
    } catch (err) {
      setKeySaveMessage(`Failed: ${err.message}`);
    }
  }

  // Mission 04 Validation Studio State
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [auditResults, setAuditResults] = useState({});
  const [isAuditing, setIsAuditing] = useState(false);

  async function runAllAuditScenarios() {
    setIsAuditing(true);
    setAuditResults({});
    for (const scenario of MISSION_SCENARIOS) {
      const res = await runLiveScenario(scenario);
      setAuditResults(prev => ({ ...prev, [scenario.id]: res }));
    }
    setIsAuditing(false);
  }

  // Hands-free Voice Speech State
  const [isSpeaking, setIsSpeaking] = useState(false);

  function toggleSpeech(steps = []) {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    if (!steps || !steps.length) return;
    const textToSpeak = steps.map((s, i) => `Step ${i + 1}. ${s}`).join('. ');
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.rate = 0.95;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  // Conversational AI Copilot Chat State
  const [showCopilot, setShowCopilot] = useState(false);
  const [copilotMessages, setCopilotMessages] = useState([
    {
      role: 'assistant',
      text: "👋 Hi! I'm your EverydayFix AI Copilot. Ask me anything about fabric care, cleaning chemistry, spot tests, or troubleshooting your current fix!"
    }
  ]);
  const [copilotInput, setCopilotInput] = useState('');
  const [isCopilotSending, setIsCopilotSending] = useState(false);

  async function sendCopilotMessage(customText = '') {
    const textToSend = String(customText || copilotInput || '').trim();
    if (!textToSend || isCopilotSending) return;
    setCopilotMessages(prev => [...prev, { role: 'user', text: textToSend }]);
    setCopilotInput('');
    setIsCopilotSending(true);

    try {
      const res = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: textToSend,
          problem: caseState.problem,
          material: caseState.material,
          cause: caseState.cause,
          history: copilotMessages.slice(-6)
        })
      });
      const data = await res.json();
      const reply = data.answer || data.reply || data.summary || data.message || 'Check the item care label and pause before applying heat or harsh chemicals.';
      setCopilotMessages(prev => [...prev, { role: 'assistant', text: reply }]);
    } catch {
      setCopilotMessages(prev => [...prev, { role: 'assistant', text: "For safety, always test any cleaning solution on an inconspicuous seam first and never mix household chemicals." }]);
    } finally {
      setIsCopilotSending(false);
    }
  }

  const resultRef = useRef(null);
  const attemptSubmissionLock = useRef(false);
  const skipNextResultScroll = useRef(false);
  const caseState = caseStore.cases.find(({ problemId }) => problemId === caseStore.activeCaseId) || caseStore.cases.at(-1);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(caseStore));
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      setStorageError('');
    } catch {
      setStorageError('This browser could not save the troubleshooting log. Keep this tab open and export or copy important details before leaving.');
    }
  }, [caseStore]);

  useEffect(() => {
    if (skipNextResultScroll.current) {
      skipNextResultScroll.current = false;
      return;
    }
    if (caseState.result) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [caseState.result]);

  useEffect(() => {
    let active = true;
    fetch('/api/health')
      .then(async (response) => {
        if (!response.ok) throw new Error(`Health check failed (HTTP ${response.status}).`);
        return response.json();
      })
      .then((data) => { if (active) setHealth(data); })
      .catch(() => { if (active) setHealth({ ok: false }); });
    return () => { active = false; };
  }, []);

  const displayedQuestions = caseState.displayedQuestions || [];
  const remainingQuestions = Math.max(0, MAX_CLARIFICATIONS - caseState.askedQuestions.length);
  const result = caseState.result;
  const isSafetyEscalation = result?.workflowState === 'SAFETY_ESCALATION' || result?.safety === true;
  const hasProfessionalGuidance = Boolean(result?.professionalHelp);
  const isConversationalOnly = ['GREETING', 'INVALID_INPUT', 'OUT_OF_SCOPE'].includes(result?.intent);
  const isTroubleshootingIssue = Boolean(result) && !isSafetyEscalation && !isConversationalOnly &&
    (result.intent === 'SUPPORTED_PROBLEM' ||
     result.workflowState === 'READY_FOR_RECOMMENDATION' ||
     Boolean(result.steps?.length) ||
     (result.workflowState === 'SAFE_INTERIM_GUIDANCE' && Boolean(result.evidenceDisplay?.extracted?.item && result.evidenceDisplay?.extracted?.item !== 'Household item')));
  function setCaseState(update) {
    setCaseStore((current) => ({
      ...current,
      cases: current.cases.map((entry) => entry.problemId === current.activeCaseId
        ? (typeof update === 'function' ? update(entry) : update)
        : entry)
    }));
  }

  function updateCase(problemId, update) {
    setCaseStore((current) => ({
      ...current,
      cases: current.cases.map((entry) => entry.problemId === problemId
        ? (typeof update === 'function' ? update(entry) : update)
        : entry)
    }));
  }

  function updateField(name, value) {
    setCaseState((current) => ({
      ...current,
      [name]: value,
      ...(name === 'problem' && !current.originalProblem ? { originalProblem: value } : {})
    }));
  }

  function startNewProblem(problem = '') {
    if (!caseState.problem.trim() && !caseState.attempts.length && !caseState.result) {
      if (problem) {
        updateField('problem', problem);
      }
      setPendingAttempt(null);
      setClarificationDrafts({});
      setRequestError('');
      setImage(null);
      return;
    }
    if (problem.trim()) {
      const existing = caseStore.cases.find((c) => c.problem.trim().toLowerCase() === problem.trim().toLowerCase());
      if (existing) {
        switchProblem(existing.problemId);
        return;
      }
    }
    const newCase = emptyCase(problem);
    setCaseStore((current) => ({
      activeCaseId: newCase.problemId,
      cases: pruneCases([...current.cases, newCase])
    }));
    setPendingAttempt(null);
    setClarificationDrafts({});
    setRequestError('');
    setImage(null);
  }

  function switchProblem(problemId) {
    setCaseStore((current) => ({ ...current, activeCaseId: problemId }));
    setPendingAttempt(null);
    setClarificationDrafts({});
    setRequestError('');
    setImage(null);
  }

  async function requestAssessment(nextCase = caseState, retry = false, { scrollToResult = true } = {}) {
    if (!nextCase.problem.trim() && !image) {
      setRequestError('Describe the practical problem before asking for a plan.');
      return;
    }
    setRequestError('');
    setIsSubmitting(true);
    const requestId = retry && nextCase.pendingRequestId ? nextCase.pendingRequestId : createId();
    const requestCase = {
      ...nextCase,
      originalProblem: nextCase.originalProblem || nextCase.problem,
      pendingRequestId: requestId
    };
    updateCase(nextCase.problemId, requestCase);
    const body = {
      problemId: nextCase.problemId,
      requestId,
      originalProblem: requestCase.originalProblem,
      problem: nextCase.problem.trim(),
      category: nextCase.category,
      material: nextCase.material.trim(),
      tried: nextCase.tried.trim(),
      history: historyText(nextCase.clarifications),
      cause: nextCase.cause || '',
      attempts: nextCase.attempts,
      questionsAsked: String(nextCase.askedQuestions.length),
      questionHistory: nextCase.askedQuestions.map((question) => ({
        question,
        answer: nextCase.clarifications.find((entry) => questionTopic(entry.question) === questionTopic(question))?.answer || ''
      })),
      planHistory: nextCase.plans.slice(-40).map((plan) => ({
        id: plan.id,
        reason: plan.reason,
        steps: plan.steps.map(({ stepId, text, outcome }) => ({
          stepId,
          text,
          status: outcome ? 'attempted' : 'suggested',
          ...(outcome ? { outcome } : {})
        }))
      })),
      safetyWarnings: nextCase.safetyWarnings,
      timeAvailable: nextCase.timeAvailable,
      budget: nextCase.budget,
      availableMaterials: nextCase.availableMaterials,
      skillLevel: nextCase.skillLevel
    };
    try {
      let response;
      if (image) {
        const form = new FormData();
        for (const [key, value] of Object.entries(body)) {
          form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
        }
        form.append('image', image);
        response = await fetch('/api/solve', { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
      } else {
        response = await fetch('/api/solve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30000)
        });
      }
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(answerErrorMessage(payload, response.status));
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('The API returned an unreadable assessment. Your saved details are preserved; retry the assessment.');
      }
      if (payload?.problemId && payload.problemId !== nextCase.problemId) {
        throw new Error('The response did not match this problem. Your recorded details are preserved; retry the assessment.');
      }

      const incoming = Array.isArray(payload?.questions) && payload.questions.length
        ? payload.questions
        : Array.isArray(payload?.followUp) ? payload.followUp : [];
      const usedQuestions = [...nextCase.askedQuestions];
      const nextQuestions = incoming.filter((question) => {
        if (usedQuestions.some((previous) => sameQuestionMeaning(previous, question))) return false;
        usedQuestions.push(question);
        return true;
      }).slice(0, Math.max(0, MAX_CLARIFICATIONS - nextCase.askedQuestions.length));
      const serverQuestionHistory = Array.isArray(payload?.questionHistory)
        ? payload.questionHistory.map((entry) => typeof entry === 'string' ? entry : entry.question).filter(Boolean)
        : [];
      const nextAskedQuestions = serverQuestionHistory.length
        ? [...serverQuestionHistory.reduce((history, question) => {
          if (!history.some((previous) => sameQuestionMeaning(previous, question))) history.push(question);
          return history;
        }, [...nextCase.askedQuestions])].slice(0, MAX_CLARIFICATIONS)
        : [...nextCase.askedQuestions, ...nextQuestions];
      const planId = payload?.requestId || requestId;
      const plan = Array.isArray(payload?.steps) && payload.steps.length
        ? {
          id: planId,
          reason: payload.revisionReason || payload.summary || 'Initial troubleshooting plan',
          createdAt: new Date().toISOString(),
          steps: payload.steps.map((text, index) => ({
            stepId: `${planId}:${index}`,
            text,
            status: 'suggested',
            outcome: ''
          }))
        }
        : null;
      const savedPlans = Array.isArray(payload?.problemState?.recommendedPlans)
        ? payload.problemState.recommendedPlans.map((savedPlan) => ({
          id: savedPlan.id || createId(),
          reason: savedPlan.reason || 'Saved troubleshooting plan',
          createdAt: savedPlan.createdAt || new Date().toISOString(),
          steps: (savedPlan.steps || []).map((step, index) => ({
            stepId: step.stepId || `${savedPlan.id || 'saved'}:${index}`,
            text: step.text,
            status: step.status === 'attempted' ? 'attempted' : 'suggested',
            outcome: step.outcome || ''
          }))
        }))
        : [];
      const plansById = new Map([...savedPlans, ...nextCase.plans].map((entry) => [entry.id, entry]));
      if (plan && !plansById.has(plan.id)) plansById.set(plan.id, plan);
      const knownWarnings = new Set(nextCase.safetyWarnings.map(({ reason }) => reason));
      const newWarnings = (payload?.safetyWarnings || []).filter((warning) => warning?.reason && !knownWarnings.has(warning.reason));
      const updatedCase = {
        ...nextCase,
        result: payload,
        attempts: Array.isArray(payload.attempts) ? payload.attempts : nextCase.attempts,
        serverState: payload.problemState || nextCase.serverState || null,
        displayedQuestions: nextQuestions,
        askedQuestions: nextAskedQuestions,
        pendingRequestId: '',
        plans: [...plansById.values()],
        safetyWarnings: [...nextCase.safetyWarnings, ...newWarnings]
      };
      skipNextResultScroll.current = !scrollToResult;
      updateCase(nextCase.problemId, updatedCase);
      setPendingAttempt(null);
      setAttemptSaveFailed(false);
      setClarificationDrafts({});
      return true;
    } catch (error) {
      if (!scrollToResult) skipNextResultScroll.current = false;
      updateCase(nextCase.problemId, requestCase);
      setRequestError(error instanceof Error ? error.message : 'The request failed. Please try again.');
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  function prepareAttempt(step, outcome, stepId, planId) {
    setRequestError('');
    setAttemptSaveFailed(false);
    setPendingAttempt({ attemptId: createId(), step, stepId, planId, outcome, details: '' });
  }

  async function submitAttempt() {
    if (!pendingAttempt || isSubmitting || attemptSubmissionLock.current) return;
    attemptSubmissionLock.current = true;
    const attempt = { ...pendingAttempt, details: pendingAttempt.details.trim(), recordedAt: new Date().toISOString() };
    const nextCase = recordStepOutcome(caseState, attempt);
    setCaseState(nextCase);
    try {
      const saved = await requestAssessment(nextCase, false, { scrollToResult: false });
      setAttemptSaveFailed(!saved);
    } finally {
      attemptSubmissionLock.current = false;
    }
  }

  async function submitClarifications(event) {
    event.preventDefault();
    const unanswered = displayedQuestions.filter((question) => !clarificationDrafts[question]?.trim());
    if (unanswered.length) {
      setRequestError('Answer each question shown, or enter “I’m not sure” so the uncertainty is clear.');
      return;
    }
    const clarifications = [
      ...caseState.clarifications,
      ...displayedQuestions.map((question) => ({
        question,
        answer: clarificationDrafts[question].trim()
      }))
    ];
    if (historyText(clarifications).length > 6000) {
      setRequestError('The clarification history is too long to send safely. Start a new problem with a concise summary.');
      return;
    }
    const nextCase = { ...caseState, clarifications, displayedQuestions: [] };
    setCaseState(nextCase);
    setRequestError('');
    await requestAssessment(nextCase);
  }

  function renderOutcomeControls(step, stepId, planId) {
    if (isSafetyEscalation) return null;
    const recordedAttempt = findRecordedStepOutcome(caseState.attempts, stepId, step);
    if (recordedAttempt) {
      return (
        <div className="recorded-outcome-wrap">
          <span className="recorded-outcome"><CheckCircle2 size={14} /> {attemptStatusText(recordedAttempt, OUTCOMES)}</span>
          {attemptSaveFailed && pendingAttempt?.attemptId === recordedAttempt.attemptId ? (
            <div className="attempt-editor">
              <label htmlFor="attempt-details-retry">
                Your outcome is saved locally; the reassessment could not be confirmed. Retry without losing your feedback.
              </label>
              {requestError ? <p className="attempt-error" role="alert">{requestError}</p> : null}
              <textarea
                id="attempt-details-retry"
                rows="2"
                maxLength="1000"
                value={pendingAttempt.details}
                onChange={(event) => setPendingAttempt({ ...pendingAttempt, details: event.target.value })}
                placeholder="Optional: describe what changed."
              />
              <div className="attempt-actions">
                <button type="button" className="button button-primary button-small" disabled={isSubmitting} onClick={submitAttempt}>
                  {isSubmitting ? <LoaderCircle className="spin" size={16} /> : null}
                  Retry outcome
                </button>
              </div>
            </div>
          ) : null}
        </div>
      );
    }
    if (pendingAttempt?.stepId === stepId) {
      return (
        <div className="attempt-editor">
          <label htmlFor="attempt-details">
            What happened after this step? <span>Share any change; this helps avoid repeating or worsening it.</span>
          </label>
          <textarea
            id="attempt-details"
            rows="2"
            maxLength="1000"
            value={pendingAttempt.details}
            onChange={(event) => setPendingAttempt({ ...pendingAttempt, details: event.target.value })}
            placeholder="For example: no visible change; the finish looks unchanged."
          />
          <div className="attempt-actions">
            <button type="button" className="button button-primary button-small" disabled={isSubmitting} onClick={submitAttempt}>
              {isSubmitting ? <LoaderCircle className="spin" size={16} /> : null}
              Record outcome
            </button>
            <button type="button" className="button button-quiet button-small" disabled={isSubmitting} onClick={() => setPendingAttempt(null)}>Cancel</button>
          </div>
        </div>
      );
    }
    return (
      <details className="step-feedback">
        <summary>Record the result of this step</summary>
        <div className="outcome-list">
          {OUTCOMES.map(({ value, label }) => (
            <button type="button" key={value} disabled={isSubmitting} className="outcome-button" onClick={() => prepareAttempt(step, value, stepId, planId)}>{label}</button>
          ))}
        </div>
      </details>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" onClick={(event) => { event.preventDefault(); startNewProblem(); }}>
          <span className="brand-mark"><Leaf size={20} strokeWidth={2.4} /></span>
          <span>everyday<span className="brand-strong">fix</span><span className="brand-ai"> AI</span></span>
        </a>
        <div className="topbar-right">
          <span className={`mode-indicator ${health?.ok ? 'is-online' : health ? 'is-offline' : ''}`}>
            <span className="status-dot" />
            {health?.ok ? (health.aiConfigured ? `${health.provider || 'AI'} Vision Active` : 'Built-in Vision · Tested Rules') : health ? 'API unavailable' : 'Checking API'}
          </span>
          <button
            type="button"
            className="button button-quiet settings-trigger"
            onClick={() => { setShowKeyModal(true); setKeySaveMessage(''); }}
            title="Configure Vision AI Provider (Gemini / Groq / OpenAI)"
          >
            <Sliders size={14} /> AI Vision Key
          </button>
          <button
            type="button"
            className="audit-trigger"
            onClick={() => { setShowAuditModal(true); }}
            title="Open Mission 01-04 Scenario Testing & Validation Studio"
          >
            <FlaskConical size={14} /> Mission 04 Studio
          </button>
          {caseStore.cases.length > 1 ? (
            <div className="case-selector-group">
              <select
                className="case-selector"
                aria-label="Saved troubleshooting problems"
                value={caseState.problemId}
                disabled={isSubmitting}
                onChange={(event) => switchProblem(event.target.value)}
              >
                {caseStore.cases.map((savedCase, index) => (
                  <option key={savedCase.problemId} value={savedCase.problemId}>
                    {`#${index + 1}: ${(savedCase.problem.trim() || 'Untitled problem').slice(0, 36)}`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-button clear-history-btn"
                title="Clear all saved problem history"
                disabled={isSubmitting}
                onClick={() => {
                  const fresh = emptyCase();
                  setCaseStore({ activeCaseId: fresh.problemId, cases: [fresh] });
                  try {
                    localStorage.removeItem(STORAGE_KEY);
                    localStorage.removeItem(LEGACY_STORAGE_KEY);
                  } catch {}
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ) : null}
          {result || caseState.problem.trim() ? (
            <button type="button" className="button button-quiet reset-button" disabled={isSubmitting} onClick={() => startNewProblem()}>
              <RotateCcw size={15} /> New problem
            </button>
          ) : null}
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><Sparkles size={14} /> EVERYDAY PROBLEMS, SAFER NEXT STEPS</div>
            <h1>Let’s figure out<br /><span>a safe next step.</span></h1>
            <p>Tell us what happened. Get a practical plan that adapts when something doesn’t work.</p>
            <div className="trust-row">
              <span><ShieldCheck size={16} /> Safety-first guidance</span>
              <span><Leaf size={16} /> No harsh-chemical escalation</span>
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <div className="art-leaf"><Leaf size={94} strokeWidth={1.2} /></div>
            <span className="art-spark spark-one">✳</span>
            <span className="art-spark spark-two">✳</span>
            <span className="art-label">small fixes<br />with care</span>
          </div>
        </section>

        <section className="workspace">
          <div className="main-column">
            <section className="card problem-card">
              <div className="section-heading">
                <div className="section-number">01</div>
                <div><h2>What needs fixing?</h2><p>A little context helps us keep the advice relevant and safe.</p></div>
              </div>
              <div className="category-grid" aria-label="Problem category">
                {CATEGORIES.map(({ name, icon: Icon, example }) => (
                  <button
                    key={name}
                    type="button"
                    disabled={isSubmitting}
                    className={`category-card ${caseState.category === name ? 'selected' : ''}`}
                    onClick={() => {
                      updateField('category', name);
                      if (!caseState.problem && example) updateField('problem', example);
                    }}
                  >
                    <span className="category-icon"><Icon size={18} /></span>
                    <span>{name}</span>
                    {caseState.category === name ? <Check size={15} className="category-check" /> : null}
                  </button>
                ))}
              </div>
              <label className="field-label" htmlFor="problem">Describe the problem <span>Required</span></label>
              <textarea
                id="problem"
                className="problem-input"
                rows="3"
                maxLength="3000"
                disabled={isSubmitting}
                value={caseState.problem}
                onChange={(event) => updateField('problem', event.target.value)}
                placeholder="What happened, and what item or surface is affected?"
              />
              <div className="field-meta"><span>Be specific about the item, material, and what changed.</span><span>{caseState.problem.length}/3000</span></div>
              <div className="field-row">
                <div className="field-group">
                  <label className="field-label" htmlFor="material">Material or surface <span>Optional</span></label>
                  <input id="material" disabled={isSubmitting} value={caseState.material} onChange={(event) => updateField('material', event.target.value)} maxLength="120" placeholder="e.g. cotton, painted wood, unknown" />
                </div>
                <div className="field-group">
                  <label className="field-label" htmlFor="cause">Possible cause <span>Optional</span></label>
                  <input id="cause" disabled={isSubmitting} value={caseState.cause || ''} onChange={(event) => updateField('cause', event.target.value)} maxLength="500" placeholder="e.g. coffee, if known" />
                </div>
                <div className="field-group">
                  <label className="field-label" htmlFor="tried">What have you tried? <span>Optional</span></label>
                  <input id="tried" disabled={isSubmitting} value={caseState.tried} onChange={(event) => updateField('tried', event.target.value)} maxLength="1000" placeholder="Include any products or steps" />
                </div>
              </div>
              <details className="preferences-details">
                <summary>Optional preferences <ChevronDown size={15} /></summary>
                <div className="field-row preference-row">
                  <input aria-label="Time available" disabled={isSubmitting} value={caseState.timeAvailable} onChange={(event) => updateField('timeAvailable', event.target.value)} maxLength="120" placeholder="Time available" />
                  <input aria-label="Budget" disabled={isSubmitting} value={caseState.budget} onChange={(event) => updateField('budget', event.target.value)} maxLength="120" placeholder="Budget" />
                  <input aria-label="Available materials" disabled={isSubmitting} value={caseState.availableMaterials} onChange={(event) => updateField('availableMaterials', event.target.value)} maxLength="500" placeholder="Materials on hand" />
                  <input aria-label="Skill level" disabled={isSubmitting} value={caseState.skillLevel} onChange={(event) => updateField('skillLevel', event.target.value)} maxLength="120" placeholder="Comfort level or experience" />
                </div>
              </details>
              <div className="photo-row">
                <label className="upload-control">
                  <input type="file" disabled={isSubmitting} accept="image/jpeg,image/png,image/webp" onChange={(event) => setImage(event.target.files?.[0] || null)} />
                  <Camera size={15} style={{ marginRight: 6, verticalAlign: 'middle', opacity: 0.8 }} />
                  <span>{image ? image.name : 'Add a photo (optional)'}</span>
                </label>
                <span className="photo-note">
                  {health?.aiConfigured ? `JPG, PNG or WEBP · ${health.provider} Multimodal Vision` : 'JPG, PNG or WEBP · Built-in Vision Analyzer'}
                </span>
                {image ? <button type="button" disabled={isSubmitting} className="icon-button" aria-label="Remove photo" onClick={() => setImage(null)}><X size={16} /></button> : null}
              </div>
              <div className="submit-row">
                <div className="privacy-note"><ShieldCheck size={15} /> Your attempt history stays in this browser.</div>
                <button className="button button-primary" disabled={isSubmitting} onClick={() => requestAssessment()}>
                  {isSubmitting ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={17} />}
                  {isSubmitting ? 'Checking safely…' : result ? 'Update assessment' : 'Get safe next steps'}
                  {!isSubmitting ? <ArrowRight size={17} /> : null}
                </button>
              </div>
              {requestError ? (
                <div className="inline-error" role="alert">
                  <TriangleAlert size={17} />
                  <span>{requestError}</span>
                  {caseState.pendingRequestId ? (
                    <button type="button" className="text-button" disabled={isSubmitting} onClick={() => requestAssessment(caseState, true)}>
                      Retry with saved details <ArrowRight size={14} />
                    </button>
                  ) : null}
                </div>
              ) : null}
              {storageError ? <div className="inline-error" role="alert"><TriangleAlert size={17} /> {storageError}</div> : null}
              {!health?.ok && health !== null ? (
                <div className="inline-error" role="status"><TriangleAlert size={17} /> The API is not responding. Start the server with <code>npm run server</code> and retry.</div>
              ) : null}
            </section>

            {result ? (
              <section ref={resultRef} className={`card result-card ${isSafetyEscalation ? 'result-safety' : ''} ${result.intent === 'GREETING' ? 'result-greeting' : ''}`} aria-live="polite">
                <div className="result-topline">
                  <span className={`result-status ${isSafetyEscalation ? 'status-danger' : result.intent === 'GREETING' ? 'status-greeting' : ''}`}>
                    {isSafetyEscalation ? <AlertTriangle size={15} /> : result.intent === 'GREETING' ? <Sparkles size={15} /> : <ShieldCheck size={15} />}
                    {isSafetyEscalation
                      ? 'SAFETY REDIRECT'
                      : result.intent === 'GREETING'
                        ? 'WELCOME'
                        : result.intent === 'OUT_OF_SCOPE'
                          ? 'OUT OF SCOPE'
                          : result.intent === 'INVALID_INPUT'
                            ? 'INPUT UNCLEAR'
                            : result.workflowState === 'PROFESSIONAL_REFERRAL'
                              ? 'PROFESSIONAL HELP ADVISED'
                              : result.workflowState === 'ADAPTIVE_REASSESSMENT'
                                ? 'ADAPTING TO YOUR FEEDBACK'
                                : result.workflowState === 'SAFE_INTERIM_GUIDANCE'
                                  ? 'PAUSE & CLARIFY'
                                  : 'YOUR FIX PATH'}
                  </span>
                  <span className="mode-label">{result.mode || result.analysisMode || 'EverydayFix'}</span>
                </div>
                <h2 className="result-title">{result.title || 'Your next steps'}</h2>
                <p className="result-summary">{result.summary || result.message}</p>

                {result.intent === 'GREETING' ? (
                  <div className="greeting-starter-box">
                    <div className="subheading" style={{ marginTop: '0.2rem', marginBottom: '0.75rem', fontWeight: 700 }}>
                      <Sparkles size={16} /> Choose an everyday problem or describe your own:
                    </div>
                    <div className="quick-prompts-grid">
                      <button
                        type="button"
                        className="quick-prompt-card"
                        onClick={() => {
                          updateField('problem', 'Coffee spill on a cotton shirt');
                          updateField('material', 'cotton');
                          updateField('cause', 'coffee');
                          updateField('category', 'cleaning');
                        }}
                      >
                        <span className="prompt-icon">☕</span>
                        <div>
                          <strong>Coffee on Cotton</strong>
                          <p>Safe blot-first steps without harsh chemicals</p>
                        </div>
                      </button>
                      <button
                        type="button"
                        className="quick-prompt-card"
                        onClick={() => {
                          updateField('problem', 'Candle wax on a wooden table');
                          updateField('material', 'wood');
                          updateField('cause', 'candle wax');
                          updateField('category', 'cleaning');
                        }}
                      >
                        <span className="prompt-icon">🕯️</span>
                        <div>
                          <strong>Wax on Wood Table</strong>
                          <p>Careful scraping & cool temperature guidance</p>
                        </div>
                      </button>
                      <button
                        type="button"
                        className="quick-prompt-card"
                        onClick={() => {
                          updateField('problem', 'Mud on washable canvas sneakers');
                          updateField('material', 'canvas');
                          updateField('cause', 'mud');
                          updateField('category', 'cleaning');
                        }}
                      >
                        <span className="prompt-icon">👟</span>
                        <div>
                          <strong>Mud on Canvas Shoes</strong>
                          <p>Dry-first brush technique before washing</p>
                        </div>
                      </button>
                      <button
                        type="button"
                        className="quick-prompt-card"
                        onClick={() => {
                          updateField('problem', 'Stain on my sofa');
                          updateField('material', 'fabric upholstery');
                          updateField('cause', 'unknown');
                          updateField('category', 'cleaning');
                        }}
                      >
                        <span className="prompt-icon">🛋️</span>
                        <div>
                          <strong>Unknown Sofa Stain</strong>
                          <p>Material identification & safe interim pause</p>
                        </div>
                      </button>
                    </div>
                  </div>
                ) : null}

                {!isSafetyEscalation && caseState.attempts.length ? (
                  <div className="latest-attempt" role="status">
                    <span className="recorded-outcome"><CheckCircle2 size={14} /> {attemptStatusText(caseState.attempts.at(-1), OUTCOMES)}</span>
                    <span>{caseState.attempts.at(-1).step}</span>
                  </div>
                ) : null}

                {isSafetyEscalation ? (
                  <div className="safety-box">
                    <div className="safety-heading"><TriangleAlert size={19} /> Pause — safety comes first</div>
                    <p>{result.message || result.summary}</p>
                    <ol>{(result.steps || []).map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol>
                  </div>
                ) : null}

                {!isSafetyEscalation && result.revisionReason ? (
                  <div className="revision-box">
                    <div className="revision-heading"><RotateCcw size={17} /> Why this plan changed</div>
                    <p>{result.revisionReason}</p>
                  </div>
                ) : null}

                {!isSafetyEscalation && result.interimGuidance?.length ? (
                  <div className="interim-box">
                    <div className="revision-heading"><ShieldCheck size={17} /> For now, keep it paused</div>
                    <ul>{result.interimGuidance.map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                ) : null}

                {isTroubleshootingIssue ? (
                  <>
                    {result.evidenceDisplay ? (
                      <FixPathEvidenceDisplay
                        evidence={result.evidenceDisplay || (result.extractedEntities ? { extracted: result.extractedEntities } : null)}
                        observations={result.observations}
                        photoNote={result.photoNote}
                      />
                    ) : null}
                    {result.preferenceComparison ? <PreferenceComparisonCard comparison={result.preferenceComparison} /> : null}
                    {result.ingredientAnalysis?.length ? <IngredientAnalysisTable ingredients={result.ingredientAnalysis} /> : null}
                    {result.nutritionFacts ? <NutritionFactsWidget nutrition={result.nutritionFacts} /> : null}
                  </>
                ) : null}

                {!isSafetyEscalation && result.materials?.length ? (
                  <div className="materials-row"><div className="subheading"><FlaskConical size={17} /> Gather (only if needed)</div><div className="chip-list">{result.materials.map((item) => <span className="material-chip" key={item}>{item}</span>)}</div></div>
                ) : null}

                {!isSafetyEscalation && result.steps?.length ? (
                  <div className="steps-section">
                    <div className="plan-action-bar">
                      <div className="subheading"><CheckCircle2 size={17} /> Your step-by-step plan</div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button
                          type="button"
                          className={`voice-btn ${isSpeaking ? 'is-speaking' : ''}`}
                          onClick={() => toggleSpeech(result.steps)}
                          title="Listen to steps hands-free while working"
                        >
                          {isSpeaking ? <VolumeX size={14} /> : <Volume2 size={14} />}
                          {isSpeaking ? 'Stop Audio' : '🔊 Read Steps Aloud (Hands-Free)'}
                        </button>
                        <button
                          type="button"
                          className="export-btn"
                          onClick={() => window.print()}
                          title="Print or export clean incident fix report"
                        >
                          <Printer size={13} /> Export Report
                        </button>
                      </div>
                    </div>
                    <ol className="steps-list">
                      {result.steps.map((step, index) => (
                        <li className="step-item" key={`${index}-${step}`}>
                          <span className="step-index">{String(index + 1).padStart(2, '0')}</span>
                          <div className="step-content">
                            <p>{step}</p>
                            {renderOutcomeControls(step, `${result.requestId || caseState.problemId}:${index}`, result.requestId || caseState.problemId)}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}

                {!isSafetyEscalation && displayedQuestions.length > 0 && remainingQuestions >= 0 ? (
                  <form className="questions-box" onSubmit={submitClarifications}>
                    <div className="revision-heading"><MessageCircle size={17} /> A couple of details will help</div>
                    <p className="question-intro">Answer what you can. We’ll use this information to reassess without repeating failed steps.</p>
                    {displayedQuestions.map((question, index) => (
                      <label className="question-field" key={question}>
                        <span><b>{index + 1}</b>{question}</span>
                        <textarea
                          rows="2"
                          maxLength="1000"
                          required
                          value={clarificationDrafts[question] || ''}
                          onChange={(event) => setClarificationDrafts((current) => ({ ...current, [question]: event.target.value }))}
                          placeholder="If unsure, say “I’m not sure”"
                        />
                      </label>
                    ))}
                    <div className="questions-footer">
                      <span>{caseState.askedQuestions.length} of {MAX_CLARIFICATIONS} follow-up questions used</span>
                      <button className="button button-primary button-small" disabled={isSubmitting}>
                        {isSubmitting ? <LoaderCircle className="spin" size={16} /> : null}
                        Share details <ArrowRight size={15} />
                      </button>
                    </div>
                  </form>
                ) : null}

                {result.questionBudgetReached && !isSafetyEscalation ? (
                  <div className="limit-box"><AlertTriangle size={18} /><div><strong>Question limit reached; guidance continues</strong><p>The four-question maximum is preserved. The steps above use only confirmed details; uncertainty and safe precautions are shown below.</p></div></div>
                ) : null}

                {hasProfessionalGuidance && !isSafetyEscalation ? (
                  <div className="professional-box"><Hammer size={18} /><div><strong>Professional help may be the safer next step</strong><p>{result.professionalHelp}</p></div></div>
                ) : null}

                {!isSafetyEscalation && result.precautions?.length ? (
                  <div className="safety-notes">
                    <div className="note-column"><div className="note-title"><ShieldCheck size={16} /> Keep in mind</div><ul>{result.precautions.map((item) => <li key={item}>{item}</li>)}</ul></div>
                    {result.avoid?.length ? <div className="note-column avoid-column"><div className="note-title"><TriangleAlert size={16} /> Avoid</div><ul>{result.avoid.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
                  </div>
                ) : null}
                {!isSafetyEscalation && result.uncertainty ? <p className="uncertainty"><CircleHelp size={15} /> {result.uncertainty}</p> : null}
                {!isSafetyEscalation && result.successCriteria ? <p className="criteria"><CheckCircle2 size={15} /> <strong>Check for:</strong> {result.successCriteria}</p> : null}
                {!isSafetyEscalation && result.stopIf ? <p className="stop-note"><AlertTriangle size={15} /> <strong>Stop if:</strong> {result.stopIf}</p> : null}
                {caseState.attempts.length ? (
                  <details className="attempt-history">
                    <summary><Clock3 size={15} /> {caseState.attempts.length} recorded {caseState.attempts.length === 1 ? 'attempt' : 'attempts'} <ArrowDown size={14} /></summary>
                    <ol>{caseState.attempts.map((attempt, index) => <li key={`${attempt.attemptId || attempt.step}-${index}`}><strong>{attempt.step}</strong><span>{OUTCOMES.find(({ value }) => value === attempt.outcome)?.label || attempt.outcome}</span>{attempt.details ? <p>{attempt.details}</p> : null}</li>)}</ol>
                  </details>
                ) : null}
                {caseState.plans.length > 1 ? (
                  <details className="attempt-history plan-history">
                    <summary><RotateCcw size={15} /> {caseState.plans.length} saved recommendation plans <ArrowDown size={14} /></summary>
                    <ol>
                      {caseState.plans.map((plan, planIndex) => (
                        <li key={plan.id}>
                          <strong>Plan {planIndex + 1}: {plan.reason}</strong>
                          <ul>{plan.steps.map((step) => {
                            const attempted = caseState.attempts.find(({ stepId }) => stepId === step.stepId);
                            const outcome = attempted?.outcome || step.outcome;
                            return (
                              <li key={step.stepId}>
                                {step.text}
                                <span>{outcome ? `Attempted · ${OUTCOMES.find(({ value }) => value === outcome)?.label || outcome}` : 'Suggested · not attempted'}</span>
                              </li>
                            );
                          })}</ul>
                        </li>
                      ))}
                    </ol>
                  </details>
                ) : null}
              </section>
            ) : (
              <section className="how-card">
                <div className="how-heading"><span>HOW IT WORKS</span><span className="how-line" /></div>
                <div className="how-grid">
                  <div><span className="how-number">01</span><h3>Tell us what happened</h3><p>Share the item, material, and any steps you’ve already tried.</p></div>
                  <div><span className="how-number">02</span><h3>Get a careful plan</h3><p>Clear steps with precautions and stop conditions.</p></div>
                  <div><span className="how-number">03</span><h3>Adapt as you go</h3><p>Record outcomes. We’ll avoid repeating failed steps.</p></div>
                </div>
              </section>
            )}
          </div>

          <aside className="side-column">
            <section className="side-card safe-card">
              <div className="side-icon safe-icon"><ShieldCheck size={20} /></div>
              <div className="side-title">Safety comes first</div>
              <p>Every recommendation is cautious by design. No harsh-chemical escalation or risky repairs.</p>
              <div className="safety-divider" />
              <p className="urgent-copy"><TriangleAlert size={15} /> Active danger? Leave the area and contact local emergency services or a qualified professional.</p>
            </section>
            <section className="side-card adapt-card">
              <div className="side-icon adapt-icon"><RotateCcw size={19} /></div>
              <div className="side-title">A plan that listens</div>
              <p>If something didn’t work, tell us what you tried and what changed.</p>
              <div className="adapt-points">
                <div><CheckCircle2 size={15} /> Remembers your attempts</div>
                <div><CheckCircle2 size={15} /> Asks focused follow-ups</div>
                <div><CheckCircle2 size={15} /> Knows when to pause</div>
              </div>
            </section>
            {caseState.attempts.length ? (
              <section className="side-card progress-card">
                <div className="progress-heading"><Clock3 size={16} /> Troubleshooting log</div>
                <div className="progress-count">{caseState.attempts.length}<span> attempts</span></div>
                <p>{caseState.askedQuestions.length} of {MAX_CLARIFICATIONS} follow-up questions used</p>
                <button className="text-button" onClick={() => document.querySelector('.attempt-history')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>View attempt history <ArrowRight size={14} /></button>
              </section>
            ) : null}
          </aside>
        </section>
      </main>
      <footer className="footer"><span>EverydayFix AI</span><span>Helpful ideas, not a substitute for qualified professional advice.</span></footer>

      {showKeyModal ? (
        <div className="modal-overlay" onClick={() => setShowKeyModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="modal-header">
              <div className="modal-title" id="settings-title"><Sliders size={18} /> Multimodal Vision AI Provider</div>
              <button type="button" className="modal-close" onClick={() => setShowKeyModal(false)} aria-label="Close dialog"><X size={18} /></button>
            </div>
            <div className="modal-body">
              <p className="modal-desc">
                EverydayFix AI features a <strong>built-in visual analyzer</strong> that works offline. To enable advanced multimodal reasoning, enter your API key below:
              </p>
              <div className="provider-select-row">
                <button
                  type="button"
                  className={`provider-btn ${apiProviderInput === 'Gemini' ? 'active' : ''}`}
                  onClick={() => setApiProviderInput('Gemini')}
                >
                  Google Gemini
                </button>
                <button
                  type="button"
                  className={`provider-btn ${apiProviderInput === 'Groq' ? 'active' : ''}`}
                  onClick={() => setApiProviderInput('Groq')}
                >
                  Groq Vision
                </button>
                <button
                  type="button"
                  className={`provider-btn ${apiProviderInput === 'OpenAI' ? 'active' : ''}`}
                  onClick={() => setApiProviderInput('OpenAI')}
                >
                  OpenAI
                </button>
              </div>
              <input
                type="password"
                className="modal-input"
                placeholder={apiProviderInput === 'Gemini' ? 'Paste Gemini key (AIza...)' : apiProviderInput === 'Groq' ? 'Paste Groq key (gsk_...)' : 'Paste OpenAI key (sk-...)'}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
              />
              {keySaveMessage ? <div className="modal-msg">{keySaveMessage}</div> : null}
              <div className="modal-actions">
                {health?.aiConfigured ? (
                  <button type="button" className="button button-quiet" onClick={() => saveApiKey(true)}>Clear Key</button>
                ) : null}
                <button type="button" className="button button-quiet" onClick={() => setShowKeyModal(false)}>Cancel</button>
                <button type="button" className="button button-primary" onClick={() => saveApiKey(false)}>Save &amp; Connect</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Mission 01-04 Scenario Testing & Validation Studio */}
      {showAuditModal ? (
        <div className="modal-overlay" onClick={() => setShowAuditModal(false)}>
          <div className="modal-card audit-modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="audit-title">
            <div className="modal-header">
              <div className="modal-title" id="audit-title">
                <FlaskConical size={18} /> Mission 01–04 Live Validation Studio
              </div>
              <button type="button" className="modal-close" onClick={() => setShowAuditModal(false)} aria-label="Close dialog"><X size={18} /></button>
            </div>
            <div className="audit-modal-body">
              <div className="audit-overview">
                <div className="audit-overview-stat">
                  <span>Automated Jury Test Suite:</span>
                  <span style={{ color: '#2f603c', fontWeight: 800 }}>5 Comprehensive Missions</span>
                </div>
                <button
                  type="button"
                  className="button button-primary button-small"
                  disabled={isAuditing}
                  onClick={runAllAuditScenarios}
                >
                  {isAuditing ? <LoaderCircle className="spin" size={14} /> : <Play size={14} />}
                  {isAuditing ? 'Auditing Live...' : 'Run All Live Tests'}
                </button>
              </div>

              {MISSION_SCENARIOS.map((scenario) => {
                const res = auditResults[scenario.id];
                return (
                  <div className="scenario-card" key={scenario.id}>
                    <div className="scenario-header">
                      <div className="scenario-title">
                        <span>{scenario.title}</span>
                      </div>
                      <div className="scenario-badges">
                        <span className="scenario-mission-tag">{scenario.mission.split(':')[0]}</span>
                        {res ? (
                          <span className={res.passed ? 'badge-pass' : 'badge-fail'}>
                            {res.passed ? `PASS (${res.durationMs}ms)` : 'FAIL'}
                          </span>
                        ) : (
                          <span className="badge-pending">READY</span>
                        )}
                      </div>
                    </div>
                    <div className="scenario-expected">
                      <strong>Target:</strong> {scenario.expected}
                    </div>
                    {res ? (
                      <div className={`scenario-result-box ${res.passed ? 'result-passed' : 'result-failed'}`}>
                        <strong>{res.passed ? '✓ Validation Verified:' : '✕ Failed:'}</strong> {res.details}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="modal-actions" style={{ borderTop: '1px solid #edf2ec', paddingTop: 10 }}>
              <button type="button" className="button button-quiet" onClick={() => setShowAuditModal(false)}>Close Studio</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Floating Conversational AI Copilot */}
      <button
        type="button"
        className="copilot-fab"
        onClick={() => setShowCopilot((prev) => !prev)}
        title="Open EverydayFix AI Conversational Copilot"
      >
        <Bot size={18} />
        <span>Ask Copilot</span>
      </button>

      {showCopilot ? (
        <div className="copilot-window" role="dialog" aria-label="EverydayFix AI Copilot">
          <div className="copilot-header">
            <div className="copilot-header-title">
              <Bot size={17} /> EverydayFix Copilot
            </div>
            <button
              type="button"
              className="copilot-close-btn"
              onClick={() => setShowCopilot(false)}
              aria-label="Close Copilot"
            >
              <X size={17} />
            </button>
          </div>
          <div className="copilot-messages">
            {copilotMessages.map((msg, i) => (
              <div key={i} className={`chat-msg ${msg.role === 'assistant' ? 'msg-assistant' : 'msg-user'}`}>
                {msg.text}
              </div>
            ))}
            {isCopilotSending ? (
              <div className="chat-msg msg-assistant" style={{ fontStyle: 'italic', color: '#687e6d' }}>
                <LoaderCircle className="spin" size={13} style={{ display: 'inline', marginRight: 5 }} />
                Reasoning with safety gate...
              </div>
            ) : null}
            <div className="copilot-chips">
              <button type="button" className="chip-btn" onClick={() => sendCopilotMessage("How do I perform a safe spot test?")}>
                🧪 Spot test guide
              </button>
              <button type="button" className="chip-btn" onClick={() => sendCopilotMessage("Can I use white vinegar on this?")}>
                🧴 Is vinegar safe?
              </button>
              <button type="button" className="chip-btn" onClick={() => sendCopilotMessage("What if the stain is already dried?")}>
                ⏰ Dried stain tips
              </button>
            </div>
          </div>
          <form
            className="copilot-input-bar"
            onSubmit={(e) => {
              e.preventDefault();
              sendCopilotMessage();
            }}
          >
            <input
              type="text"
              className="copilot-input"
              placeholder="Ask anything about this fix..."
              value={copilotInput}
              disabled={isCopilotSending}
              onChange={(e) => setCopilotInput(e.target.value)}
            />
            <button type="submit" className="copilot-send-btn" disabled={isCopilotSending || !copilotInput.trim()}>
              <Send size={15} />
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export default App;
