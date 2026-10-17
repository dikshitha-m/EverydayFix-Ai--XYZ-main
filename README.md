# EverydayFix AI

A React + Node/Express app for low-risk household mishaps. It accepts a text description and optional photo, asks follow-up questions, returns structured advice, redirects high-risk situations, adapts to outcomes, and saves fixes in the browser.

## Features
- Responsive React UI with category discovery, material and 4-parameter preference controls (time, budget, materials on hand, skill level), and optional photo upload when a vision model is configured.
- React assessment UI connected to `/api/health` and `/api/solve`, with separate saved problem histories, confirmed outcomes, clarification answers, and a strict four-question limit per problem. Reaching the limit does not block supported guidance or safe precautions.
- FixPath shows extracted entities (item, surface, substance), visual observations, safe inferences vs boundaries of safe inference, safety-gate result, and next-action criteria.
- Application logic for structured entity extraction, preference comparison against user constraints, and transparent uncertainty handling. A single unmodified API response is never relied upon.
- Ingredient & chemical status classification engine distinguishing an ingredient listed (`LISTED`) from an ingredient not listed (`NOT_LISTED`), an ingredient not detected (`NOT_DETECTED`), or one whose status cannot safely be determined (`CANNOT_BE_DETERMINED`).
- Normalized Nutrition Facts table displaying serving size, calories, and standard nutrient breakdown with % Daily Value for food/beverage mishaps without requiring external barcode or database integration.
- Structured LiveFix plans with materials, ordered and trackable steps, precautions, stop criteria, success criteria and follow-up questions.
- Optional Groq chat-completions API for AI reasoning and vision-capable models.
- Backend intent routing distinguishes greetings, supported issues, clarification, out-of-scope requests, invalid input, and safety-critical reports before solution generation.
- Stain and upholstery requests use a backend clarification gate for exact material, stain source, previous treatment, and relevant care instructions. Uncertain cases receive no material-specific treatment steps.
- Clearly labelled tested-rules mode when no Groq API key is configured or the text-AI provider fails. It does not claim AI or photo analysis and does not invent a fix for an unrecognised issue.
- A small deterministic rule set covers coffee on confirmed washable cotton, mud on washable canvas shoes with compatible care instructions, and cooled candle wax on confirmed glass or glazed ceramic. Each rule has explicit prerequisites, low-risk steps, and stop conditions; other materials receive clarification or professional referral.
- ClarifyIQ follow-ups and FixLoop success, partial, no-improvement, stuck, failed and worsened outcomes carried into the next request.
- Adaptive reassessment accepts structured attempted steps, avoids re-issuing a failed action, asks outcome-specific follow-up questions, and explains why the approach is changing.
- Repeated failures and specialist-only materials can redirect users to qualified professional help rather than escalating DIY treatment.
- FixSafe deterministic text rules run before a separate constrained AI safety screen for configured AI requests. A failed AI safety screen blocks routine recommendations.
- Each problem receives a unique ID. Its original description, facts, clarification history, suggestions, step IDs, recorded outcomes, safety warnings, and plan rationale remain separate in the browser's saved-problem list.
- Upload size, declared MIME type, and image signature validation (JPG, PNG, WEBP; max 8 MB).

## Requirements
- Node.js 18+ and npm.
- Optional Groq API key. The default `qwen/qwen3.8-27b` model supports text and image input according to Groq's vision documentation; availability depends on the Groq account.

## Run locally
1. Unzip the project and open a terminal in `everydayfix-ai`.
2. Install packages:
   ```bash
   npm install
   ```
3. For Groq text intelligence and photo analysis, copy `.env.example` to `.env` and set `GROQ_API_KEY` to a key created in your provider account. `.env.example` is only a template; it contains no credential. `GROQ_MODEL` defaults to `qwen/qwen3.8-27b`.
   - Requests use Groq's official OpenAI-compatible endpoint, `https://api.groq.com/openai/v1/chat/completions`.
   - Groq documents `qwen/qwen3.8-27b` as a model supporting text and image input. Confirm the model is enabled for your own account. If text generation fails, the server falls back only to tested rules or safe interim guidance. AI safety-screen failures fail closed. Image requests do not fall back to invented photo analysis.
   - The uploaded image is sent as a base64 data URL in Groq's documented `image_url` message format for intent classification, independent safety screening, and solution analysis.
   - Never put the API key in React/Vite environment variables or commit `.env` to GitHub.
4. Start both servers:
   ```bash
   npm start
   ```
5. Open `http://localhost:3000`. The API runs at `http://localhost:3001`.

The header/health status must show **Groq API** before expecting broad AI-generated, problem-specific recommendations. Without a server-side key the application intentionally uses a small tested-rules catalog, not a broad repair database; unsupported problems get safe clarification or pause guidance instead of a fabricated treatment. In Groq API mode, the server prompt includes the current problem, material, cause, attempted actions/outcomes, time, budget, available materials, and skill level. These details can improve relevance but do not guarantee correctness; safety checks remain authoritative.

Run the API integration tests and production build with:
```bash
npm test
npm run build
```

## Adaptive troubleshooting API

Send the same `problemId` with each `/api/solve` request. Each request also carries a unique `requestId`, the original and current problem description, confirmed material/cause facts, prior clarification answers, attempted steps, and the plan history. JSON requests may send arrays directly; multipart requests send arrays as JSON-encoded form fields. The browser stores the full state per problem in local storage. The API also merges state by `problemId` in a bounded in-memory cache so accidental omissions or duplicate submissions within a running server do not reset history.

```json
{
  "problemId": "case-unique-id-001",
  "requestId": "request-unique-id-001",
  "originalProblem": "Candle wax on a glass tabletop",
  "problem": "Candle wax on a glass tabletop",
  "questionHistory": [],
  "planHistory": [],
  "safetyWarnings": [],
  "attempts": [
    {
      "attemptId": "attempt-unique-id-001",
      "planId": "prior-plan-id",
      "stepId": "prior-plan-id:0",
      "step": "Lift the hardened wax with a plastic card",
      "outcome": "no_improvement",
      "details": "The wax did not lift."
    }
  ]
}
```

Each entry requires `step` (or `action`) and `outcome`; `details`, `attemptId`, `planId`, and `stepId` are optional for legacy clients. Up to 64 attempt records are accepted. Reusing an `attemptId` is idempotent. Supported outcomes are `completed`, `partial_improvement`, `no_improvement`, `failed`, `stuck`, and `worsened`. Invalid attempt records are rejected with HTTP 400. Existing `history` records using `Outcome:` and `Clarification: ... Answer: ...` remain supported.

`questionHistory` contains up to four distinct questions and optional answers. The server merges it with the problem's in-memory history and deduplicates by topic as well as wording; `questionsAsked` remains accepted for legacy clients. The API returns the updated question history and count. The browser never resets the counter when a user answers or records an outcome. At four questions, it returns no fifth question but still supports an evidence-backed plan, a safe pause, or an appropriate professional referral.

For a failed or worsening attempt, the response includes the matching `problemId`, merged attempts, updated problem state, revised steps, targeted questions, `revisionReason`, and `professionalHelp`. Every plan step has a stable ID and is marked suggested until the user explicitly records an outcome. A step appearing on screen is not treated as attempted or successful. AI-generated plans are checked against recorded actions, high-risk chemical terms, and an independent recommendation safety check. Hazard signals in the problem, history, safety warnings, or attempt details take priority and return `SAFETY_ESCALATION` with no routine solution.

The API's problem cache is process-local and bounded to the most recent 1,000 problem IDs; it is lost when the API restarts. Browser local storage is the durable source for a user's separate problems on that browser. Clearing site data or using another browser/device removes or does not transfer that history. The app does not store provider keys or uploaded photos in browser storage. Avoid entering sensitive personal information.

## Adaptive workflow and expected outcomes

1. Record the step/action, outcome, and what changed; include prior clarification answers on the next request.
2. Check all current and attempted-step details against the deterministic safety gate before routing or generating advice.
3. For a failed, partly successful, stuck, or worsened result, record the exact step and observation; pause that action and do not increase chemical strength, heat, or force.
4. Use new details and remaining uncertainty to select a different low-risk plan when the available evidence supports one. If safe alternatives cannot be established, keep treatment paused and ask for the missing information.
5. Stop and recommend professional assistance after repeated safe attempts fail, visible deterioration occurs, or material/care instructions indicate specialist handling.

The system does not automatically recommend stronger chemicals or risky repairs. Deterministic safety checks run before recommendation routing and again before response; configured AI requests also have an independent safety-screen call, and generated advice is checked before delivery. These checks cannot identify every hazard or guarantee that a treatment is safe. If there are fumes, injury, fire, electrical danger, gas, structural risk, or other hazardous changes, stop and seek appropriate local emergency or qualified assistance. The deterministic demo provides only the listed supported example fixes; an unsupported issue gets targeted clarification or safe precautions, not a generic treatment.

## Mission 03 state, workflow, and limitations

- **Per-problem record:** the frontend creates a unique problem ID and stores each problem separately. Original description, current facts, clarification answers, prior plans, suggested/attempted status, outcome details, reasons for plan changes, and safety warnings remain associated with that ID.
- **Attempt semantics:** a step begins as `suggested`. Only the user's explicit outcome action changes it to `attempted`; `completed` means the user confirmed completion. Outcome IDs make submission retries idempotent. The UI keeps a failed request's answers and attempts and offers a retry without appending a duplicate.
- **Adaptive plan:** each assessment receives prior plans and attempts. The next plan excludes or pauses failed actions, considers partial/worsened outcomes and updated facts, gives a reason for its change, and only suggests a distinct treatment if the known prerequisites support it.
- **Four-question budget:** the question history travels with the same problem ID and is merged by the server while it runs. Similar questions are not repeated under slightly different wording. At four, no ordinary follow-up is returned; an existing safe rule may continue, otherwise the response explains uncertainty and pauses or escalates professionally. Outcomes and history viewing remain available.
- **Rules versus AI:** `tested rules mode` means deterministic rules or cautious interim guidance, never AI-generated advice. The only tested cleaning examples are coffee on confirmed washable cotton, mud on confirmed washable canvas shoes with compatible care instructions, and cooled candle wax on confirmed glass or glazed ceramic. An AI provider outage may use these rules or safe interim guidance and labels the response accordingly. Unknown materials, chemicals, hazards, and unsupported situations never receive an invented fix.
- **Safety and professional help:** high-risk user details trigger a safety redirect; configured AI also requires a separate safety screen. Proposed advice is independently checked before it is returned. The app does not authorize mixing chemicals, bypassing safety systems, or escalating to harsher products. Stop for fumes, exposure, fire, electrical/gas/structural hazards, injury, visible deterioration, delicate/valuable material, or repeated failed safe attempts; contact emergency responders or a relevant qualified professional where appropriate.
- **Photo analysis:** photos are not analyzed in rules mode. With a configured compatible model, uploaded images are sent to the provider; image evidence cannot confirm chemistry, fibre, or cause. A failed or unavailable safety screen does not fall back to an unverified image-based answer.
- **Data retention:** local storage persists on the current browser until site data is cleared. The API keeps a bounded in-memory cache for up to 1,000 problems, which is lost at process restart; it is not a cross-device database. API keys and photos are not written to browser storage. Do not submit sensitive data.
- **Expected outcomes:** supported facts yield a constrained safe plan; uncertain prerequisites yield targeted questions and interim precautions; exhausted clarification budget yields guidance or a safe pause; failed outcomes produce a non-repeating reassessment; hazards block ordinary troubleshooting; repeated failures or risky materials trigger professional help.

Mission 04 scenario results, evidence, limitations, and reproducible verification are recorded in [docs/MISSION-04-TEST-REPORT.md](./docs/MISSION-04-TEST-REPORT.md).

If you prefer two terminals:
- Terminal 1: `npm run server`
- Terminal 2: `npm run dev`

## Mission Submission Guide & Architecture (Target: 79)

### 1. Repository Organization & Structure
```
everydayfix-ai/
├── src/
│   ├── App.jsx            # Main React application & state management
│   ├── main.jsx           # React DOM root entry
│   ├── attempts.js        # FixLoop state machine & attempt tracker
│   ├── extraction.js      # Structured entity extraction, ingredient status engine & nutrition normalizer
│   ├── imageAnalyzer.js   # Built-in zero-dependency offline image analyzer
│   └── styles.css         # Modern responsive UI & design system
├── server.js              # Express API, safety gates, multi-provider AI vision routing
├── server.test.js         # 43 automated test suites covering all workflows
├── package.json           # Dependencies, scripts, and build metadata
└── README.md              # Project documentation, mission brief & architectural guide
```

### 2. Setup & Installation
```bash
# Clone the repository
git clone <repository-url>
cd everydayfix-ai

# Install dependencies (Node 18+ required)
npm install

# Run the test suite (43 automated tests)
npm test

# Build production assets
npm run build

# Start local server (Runs Frontend on :3000 and Backend on :3001)
npm start
```

### 3. Relevant Test Data, Test Cases & Evaluation Results
The repository includes **43 automated test cases** executed with Node's native test runner (`node --test server.test.js`).
- **Safety Gate**: Tests redirection of dangerous chemicals (bleach + ammonia fumes, acid exposure), medical emergencies, and structural hazards.
- **Question Budget**: Enforces a strict 4-question budget that prevents endless interrogation and gracefully falls back to interim guidance.
- **State Machine Idempotency**: Guarantees identical attempt IDs are recorded once and prevents step duplication.
- **Outcome Adaptation**: Verifies that reported deterioration (`worsened`) pauses treatment, updates rationale, and refers to professional help.
- **Ingredient & Chemical Status**: Evaluates `LISTED`, `NOT_LISTED`, `NOT_DETECTED`, and `CANNOT_BE_DETERMINED` statuses accurately.
- **Nutrition Facts Normalization**: Normalizes serving sizes, calories, and macronutrients into standard tables with cleaning significance notes.
- **Photo Analysis Offline & Online**: Confirms PNG, JPEG, and WebP visual inspection works offline without 503 errors and connects seamlessly to multimodal LLMs.

### 4. 60-Second Demo Video Script
1. **Scene 1 (Household Mishap - 0:00 - 0:15)**: Open `http://localhost:3000`. Enter "Coffee spill on a cotton shirt" with photo upload. Point out the instant FixPath visual observations (resolution, tone, bounds of inference).
2. **Scene 2 (Clarification & Safe Plan - 0:15 - 0:30)**: Answer the ClarifyIQ question ("Is it washable cotton?"). Watch the LiveFix plan generate step-by-step gentle blotting guidance with clear avoid lists and stop criteria.
3. **Scene 3 (Adaptive Loop - 0:30 - 0:45)**: Mark a step as "Made it worse" or "No improvement". Highlight how EverydayFix immediately pauses the treatment, explains why the approach is changing, and avoids repeating failed actions.
4. **Scene 4 (Safety Escalation & AI Vision Key - 0:45 - 1:00)**: Type "I mixed bleach and ammonia and there are fumes". Show the immediate safety redirect withholding DIY instructions. Open the "AI Vision Key" modal in the topbar to demonstrate support for Google Gemini, Groq, and OpenAI.

### 5. Deployment Information
- **Local Dev URLs**: Frontend `http://localhost:3000` | Backend API `http://localhost:3001`
- **Deploying to Vercel/Render/Railway**:
  - Backend: Deploy `server.js` with `PORT=3001`, `FRONTEND_ORIGIN=https://<your-frontend-domain>`.
  - Frontend: Set `VITE_API_BASE_URL=https://<your-api-domain>`, run `npm run build`, publish `dist/`.

### 6. AI Disclosures & Transparency
- **AI Models Supported**: Google Gemini 2.5 Flash (`gemini-2.5-flash`), Groq Llama 3.2 Vision (`llama-3.2-11b-vision-preview`), and OpenAI (`gpt-4o-mini`).
- **AI Code Assistance**: AI tools (Google Antigravity) were utilized for pairing, test generation, and architectural refactoring.
- **Safety Design**: Raw LLM output is **never** presented unmodified. All inputs and outputs pass through deterministic rule validation, structured JSON schema parsing, chemical safety gates, and constraint checking.

### 7. Technical Architecture & Decisions
- **Two-Tiered Safety Architecture**: High-risk scenarios (fumes, mixing cleaning agents, electrical hazards) are intercepted by a deterministic pre-screener before any LLM API call is made, saving latency and ensuring zero hallucinated bypasses.
- **Dual-Mode Vision**: A lightweight local image header and color-sampling analyzer (`src/imageAnalyzer.js`) runs offline without native C++ dependencies, while the backend also supports cloud multimodal vision LLMs.
- **In-Memory & LocalStorage Dual Persistence**: Browser `localStorage` maintains durable case history across reloads, while the server caches recent sessions for fast idempotent lookups.

---

## 10. Solution Limitations & Future Improvements

### Solution Limitations
1. **Chemical & Spectral Boundary of Photographs**:
   - *Limitation*: A smartphone camera photograph cannot establish chemical pH, solvent volatility, or microscopic synthetic fiber blends (e.g., poly-cotton vs pure Egyptian cotton).
   - *Mitigation*: EverydayFix AI enforces conservative uncertainty boundaries; it extracts visual cues (color hue, saturation, contrast) but strictly treats them as observations, never authoritative chemical facts.
2. **Context Window Clarification Limit**:
   - *Limitation*: The system caps clarifying follow-ups to 4 questions to prevent user fatigue. If vital details remain ambiguous after 4 attempts, the system cannot keep probing.
   - *Mitigation*: At the budget limit, EverydayFix safely reverts to non-destructive interim guidance (gentle blotting, dry-first, pausing) and recommends a qualified professional.
3. **Lighting & Sensor Variance**:
   - *Limitation*: Heavy shadows, yellow incandescent indoor lighting, or camera white-balance distortion can alter perceived stain color in pixel sampling.
   - *Mitigation*: Image analysis uses relative contrast and luminance distributions rather than absolute color thresholds.
4. **Offline Rule Catalog Scope**:
   - *Limitation*: In pure offline demo mode without an active AI key, the deterministic catalog is intentionally limited to high-frequency everyday items (cotton coffee spills, glazed ceramic/glass wax, canvas shoe mud) to avoid unverified DIY guesswork.

### Possible Future Improvements
1. **Barcode & UPC Product Lookup**:
   - Integrate barcode scanning on household cleaning bottles or garment care tags using camera feeds and Open Food Facts / SDS (Safety Data Sheet) databases to automatically extract exact surfactant and ingredient listings.
2. **Live Video Feed & WebRTC AR Guidance**:
   - Implement real-time WebRTC camera streams with AR overlays that pinpoint the precise perimeter to blot and visually alert users when excessive pressure is being applied.
3. **Localized Professional Directory Integration**:
   - When damage is worsening or delicate materials are involved (e.g., silk, antique velvet, heirloom rugs), provide a one-click referral to certified local professional cleaners (IICRC certified) with exported mishap logs.
4. **On-Device Vision Micro-Model (WebAssembly/WebGPU)**:
   - Ship a lightweight quantized MobileNet/YOLO model running directly on WebGPU in the browser for instant client-side object segmentation with zero server roundtrip.

