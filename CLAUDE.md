# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Local Browser is a Chrome extension that performs AI-powered web automation entirely on-device using WebLLM. No cloud APIs, no API keys - all AI inference runs locally in the browser using WebGPU acceleration. The extension uses a multi-agent system (Planner + Navigator) to execute natural language tasks like "search for X on YouTube" or "add X to cart on Amazon."

## Technology Stack

- **Chrome Extension MV3**: Service worker-based architecture with offscreen documents
- **WebLLM**: On-device LLM inference with WebGPU (via @mlc-ai/web-llm)
- **Transformers.js**: Alternative inference engine for specific models
- **React + TypeScript**: Popup UI
- **Vite + CRXJS**: Extension bundling and hot reload
- **Offscreen Documents**: Required for WebLLM model loading and WebGPU workers

## Build Commands

```bash
# Development (watch mode with auto-rebuild)
npm run dev

# Production build (outputs to dist/)
npm run build

# Preview build
npm run preview
```

After building, load the `dist/` folder as an unpacked extension in Chrome.

## Architecture

### Core Architecture: State-Machine-First Design

The extension uses a **state-machine-first approach** to minimize LLM calls (critical for performance). The execution flow is:

1. **State Machines** (90% of actions) - Site-specific deterministic logic (Amazon, YouTube)
2. **Rule Engine** (8% of actions) - Pattern-based heuristics for common scenarios
3. **LLM Fallback** (2% of actions) - Only when state machines and rules can't handle the situation

This architecture is enforced by `MAX_LLM_CALLS_PER_TASK` (default: 3) to prevent excessive inference.

### Component Hierarchy

```
Background Service Worker (src/background/index.ts)
├── Executor (agents/executor.ts)
│   ├── Site Router (agents/site-router.ts)
│   │   ├── Amazon State Machine (agents/amazon-state-machine.ts)
│   │   └── YouTube State Machine (agents/state-machines/youtube.ts)
│   ├── Planner Agent (agents/planner-agent.ts)
│   ├── Navigator Agent (agents/navigator-agent.ts)
│   ├── Obstacle Detector (agents/obstacle-detector.ts)
│   └── Change Observer (agents/change-observer.ts)
├── LLM Engine (llm-engine.ts)
└── Vision Engine (vision-engine.ts)

Content Script (src/content/index.ts)
├── DOM Observer (content/dom-observer.ts)
└── Action Executor (content/action-executor.ts)

Offscreen Document (src/offscreen/offscreen.ts)
├── WebLLM Worker
└── Vision Model Worker

Popup UI (src/popup/App.tsx)
```

### Message Flow

1. **User enters task** → Popup sends `START_TASK` via long-lived port connection
2. **Background service worker**:
   - Initializes LLM/VLM models via offscreen document
   - Executor orchestrates task execution
   - Queries content script for DOM state (`GET_DOM_STATE`)
   - Sends actions to content script (`EXECUTE_ACTION`)
3. **Content script**:
   - Serializes DOM state with site-specific extraction
   - Executes browser actions (click, type, scroll, etc.)
   - Returns results to service worker
4. **Background emits events** → Forwarded to popup for UI updates

### Agent System

**Executor** (agents/executor.ts):
- Main orchestrator controlling task execution loop
- Manages state machine routing, replanning, and obstacle handling
- Implements pause/resume for user interventions (login, CAPTCHA)
- Enforces `MAX_STEPS` (25) and `MAX_REPLANS` (2) limits
- Extracts search queries without LLM using regex patterns

**Site Router** (agents/site-router.ts):
- Routes tasks to appropriate state machines based on URL and task content
- Provides unified interface: `canHandle()`, `getAction()`
- Currently supports Amazon and YouTube state machines

**State Machines**:
- **Amazon** (agents/amazon-state-machine.ts): Full shopping flow from search → product → add to cart
  - States: NAVIGATE, SEARCH_PAGE, SEARCH_RESULTS, PRODUCT_PAGE, ADDED_TO_CART, DONE
  - Handles obstacles: login walls, CAPTCHA, out-of-stock
  - Uses pause/resume mechanism for user interventions
- **YouTube** (agents/state-machines/youtube.ts): Video search and playback
  - States: NAVIGATING, ON_HOMEPAGE, TYPED_QUERY, ON_RESULTS, ON_VIDEO, DONE
  - No LLM needed - pure DOM-based logic

**Planner Agent** (agents/planner-agent.ts):
- Only used when state machines can't handle a task (rare)
- Creates high-level strategy with steps and success criteria
- Fallback plan if LLM inference fails

**Navigator Agent** (agents/navigator-agent.ts):
- Rule engine for common patterns (search boxes, buttons)
- LLM fallback for ambiguous situations
- Outputs structured actions with parameters

**Obstacle Detector** (agents/obstacle-detector.ts):
- Detects blocking conditions: LOGIN_REQUIRED, CAPTCHA, OUT_OF_STOCK, PRICE_CHANGED
- Triggers task pause with user action requirements
- Integrates with Amazon state machine for recovery

### DOM Serialization

**DOM Observer** (content/dom-observer.ts):
- Site-specific extraction strategies:
  - **YouTube**: Video links, search inputs, navigation elements
  - **Amazon**: Product cards, prices, add-to-cart buttons, cart count, alerts
  - **Generic**: Interactive elements via `INTERACTIVE_SELECTORS`
- Limits: `MAX_INTERACTIVE_ELEMENTS` (30), `MAX_PAGE_TEXT_LENGTH` (1500 chars)
- Returns `DOMState` with URL, title, elements, page text, and site-specific metadata

**Action Executor** (content/action-executor.ts):
- Supported actions: click, type, press_enter, extract, scroll, wait
- Features: element waiting with retries, overlay dismissal, click verification
- Amazon-specific handling for cookie banners and modals

### LLM Integration

**LLM Engine** (background/llm-engine.ts):
- Uses offscreen document for WebLLM (WebGPU requires full web context)
- Model management with progress tracking
- Fallback chain: Qwen2.5-3B → Qwen2.5-1.5B → Llama-3.2-1B
- Chat completion with temperature (0.3) and max tokens (512)

**Vision Engine** (background/vision-engine.ts):
- SmolVLM models for screenshot-based navigation (tiny/small/base)
- Runs in offscreen document using Transformers.js
- Optional vision mode for complex UI or when DOM extraction fails

**Model Configuration** (shared/constants.ts):
- `DEFAULT_MODEL`: Qwen2.5-3B-Instruct-q4f16_1-MLC (~2GB, recommended)
- `AVAILABLE_LLM_MODELS`: User-selectable models with size/context info
- `AVAILABLE_VLM_MODELS`: SmolVLM variants (256M to 2B)
- `AGENT_TEMPERATURE`: 0.3 (deterministic)
- `AGENT_MAX_TOKENS`: 512 (keep output small due to 4K context limit)

## Key Files

- **manifest.json**: Extension manifest (requires Chrome 124+ for WebGPU in service workers)
- **src/shared/constants.ts**: All configuration values (models, limits, selectors, timeouts)
- **src/shared/types.ts**: TypeScript interfaces for agents, DOM state, messages, events
- **src/background/index.ts**: Service worker entry point and message handling
- **src/background/agents/executor.ts**: Main task execution orchestrator
- **src/background/agents/site-router.ts**: State machine routing logic
- **src/content/index.ts**: Content script entry point
- **src/popup/App.tsx**: React popup UI

## Development Guidelines

### Adding New State Machines

1. Create new file in `src/background/agents/state-machines/`
2. Define state type enum and implement `StateMachine` interface
3. Add routing logic in `site-router.ts`:
   - Pattern detection in `initialize()`
   - State machine check in `getAction()`
   - Add to `canHandle()` method
4. State machines should:
   - Use URL patterns and DOM state to determine current state
   - Return `NavigatorOutput` actions with thought and parameters
   - Handle all edge cases without LLM calls
   - Be deterministic and testable

### Modifying Agent Behavior

- **Change action limits**: Update `MAX_STEPS`, `MAX_REPLANS`, `MAX_LLM_CALLS_PER_TASK` in `constants.ts`
- **Add new action types**: Update `ActionType` in `types.ts` and implement in `action-executor.ts`
- **Modify DOM extraction**: Edit `dom-observer.ts` - adjust limits or add site-specific logic
- **Change model defaults**: Update `DEFAULT_MODEL` and `FALLBACK_MODELS` in `constants.ts`

### Obstacle Handling Pattern

When adding obstacle detection:
1. Add obstacle type to `ObstacleType` in `types.ts`
2. Implement detection logic in `obstacle-detector.ts`
3. Define user action requirement: LOGIN, SOLVE_CAPTCHA, CONFIRM, or NONE
4. Executor automatically handles pause/resume flow
5. State machine should implement `resume()` method if needed

### Testing

The extension requires manual testing:
1. Build with `npm run build`
2. Load unpacked extension in Chrome from `dist/`
3. Test on real websites (YouTube, Amazon, Wikipedia, etc.)
4. Check browser console for service worker and content script logs
5. Monitor model download progress in popup

### Common Issues

- **WebGPU not available**: Chrome 124+ required, check `chrome://gpu`
- **Model fails to load**: Requires 2GB+ free disk space, check offscreen document console
- **Content script not responding**: Restricted pages (chrome://, extensions) can't be automated
- **Actions not executing**: Some sites block content scripts - test on regular webpages
- **State machine stuck**: Check state detection logic in `getState()` methods
- **Too many LLM calls**: Verify state machine `canHandle()` is returning true

## Important Constraints

- **Model context**: 4K tokens total for Qwen models - keep prompts and outputs small
- **Service worker limits**: Can be killed by Chrome - use offscreen document for long-running tasks
- **WebGPU requirement**: Must use Chrome 124+ with compatible GPU
- **No navigation in service worker**: Must use `chrome.tabs.update()` and wait for load
- **Content script restrictions**: Cannot run on chrome:// pages, extension pages, or some security-sensitive sites

## Constants Reference

Key configuration in `src/shared/constants.ts`:
- `MAX_STEPS = 25`: Maximum actions before task timeout
- `MAX_REPLANS = 2`: Maximum replanning attempts when stuck
- `MAX_LLM_CALLS_PER_TASK = 3`: Enforce state-machine-first approach
- `MAX_INTERACTIVE_ELEMENTS = 30`: DOM serialization limit
- `AGENT_MAX_TOKENS = 512`: Keep LLM output small
- `POST_NAVIGATION_DELAY = 1000ms`: Wait time after page navigation
- `PAGE_LOAD_TIMEOUT = 30000ms`: Maximum wait for page load

Amazon-specific constants include URL patterns, selectors, success patterns, and obstacle patterns.

## Known Limitations & Enhancement Opportunities

### Current Limitations

**No Test Suite**: Zero test files exist for ~7,400 lines of code. State machines (deterministic logic) are ideal candidates for unit testing. See ENHANCEMENT_POINTS.md #1.

**Limited State Machine Coverage**: Only Amazon and YouTube have state machines. Most sites fall back to LLM, defeating the performance optimization. Common sites like Google Search, Wikipedia, GitHub could benefit from state machines. See ENHANCEMENT_POINTS.md #4.

**Settings Not Persisted**: Model selection and preferences reset each session. No chrome.storage.local usage for settings. See ENHANCEMENT_POINTS.md #5.

**No Task History**: Tasks aren't logged, can't review what happened or replay previous tasks. See ENHANCEMENT_POINTS.md #6.

**Single Tab Only**: Executor tracks one `currentTabId`, can't handle multi-tab workflows. See ENHANCEMENT_POINTS.md #12.

**Basic Action Set**: Only 9 action types (navigate, click, type, press_enter, extract, scroll, wait, done, fail). Missing select, hover, drag, upload, etc. See ENHANCEMENT_POINTS.md #11.

**Inconsistent Error Handling**: Mix of throw/catch, silent console.warn, and error state. No structured error classification. See ENHANCEMENT_POINTS.md #2.

**Obstacle Detection Amazon-Focused**: Generic site obstacles (404s, form errors, paywalls) not detected. See ENHANCEMENT_POINTS.md #7.

**Change Observer Underutilized**: Created for verification but results not actively used by executor. See ENHANCEMENT_POINTS.md #10.

**No Performance Metrics**: Can't track LLM call efficiency, action success rates, or verify state-machine-first approach is working. See ENHANCEMENT_POINTS.md #8.

### README Discrepancy

README.md line 144 states "No Vision" but vision mode is implemented (`vision-engine.ts`, `vision-executor.ts`, VLM models available). Vision mode exists but isn't the primary path. See ENHANCEMENT_POINTS.md #13.

### Code Quality Issues

**Code Duplication**:
- Port reconnection logic duplicated in `App.tsx` (lines 54-91 and 236-276)
- Obstacle detection duplicated between `amazon-state-machine.ts` and `obstacle-detector.ts`
- Search query extraction duplicated in `executor.ts` and `site-router.ts`

**Hardcoded Values**:
- Site patterns in `navigator-agent.ts:16-32` (SITES object)
- All constants in `constants.ts` - no runtime configuration

**Security Considerations**:
- Content script runs on all URLs (manifest.json)
- No selector validation/sanitization
- No rate limiting (could spam sites)
- See ENHANCEMENT_POINTS.md #3

### Quick Wins

1. **Add Basic Tests**: Start with YouTube state machine (simplest, deterministic)
2. **Persist Settings**: Add chrome.storage.local for model/vision mode preferences
3. **Refactor Port Connection**: Extract to `useBackgroundPort()` hook in App.tsx
4. **Expand State Machines**: Add Google Search (trivial: navigate → type → press_enter → extract)
5. **Update README**: Document vision mode capabilities
6. **Add Performance Logging**: Track LLM calls vs state machine usage in executor

See **ENHANCEMENT_POINTS.md** for complete list of 33+ identified enhancements organized by priority.
