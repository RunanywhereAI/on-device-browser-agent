# Enhancement Points

This document catalogs all identified areas for improvement in the Local Browser project, organized by priority and category.

## Critical Enhancements

### 1. Testing Infrastructure
**Status**: Missing
**Location**: Root project
**Issue**: No test files exist (0 test files found in ~7,400 lines of code)
**Impact**: High risk of regressions, difficult to verify changes
**Recommendation**:
- Add unit tests for state machines (deterministic logic = easy to test)
- Add integration tests for agent orchestration
- Add E2E tests for common workflows (YouTube search, Amazon shopping)
- Test framework suggestions: Vitest, Playwright for E2E
**Files to create**:
- `tests/unit/state-machines/youtube.test.ts`
- `tests/unit/state-machines/amazon.test.ts`
- `tests/unit/agents/executor.test.ts`
- `tests/integration/task-execution.test.ts`
- `tests/e2e/youtube-workflow.spec.ts`

### 2. Error Handling Standardization
**Status**: Inconsistent
**Location**: Throughout codebase
**Issue**: Mix of throw/catch, some errors silently logged with console.warn
**Examples**:
- `src/background/index.ts:163-166` - Silent failure on content script unavailable
- `src/background/llm-engine.ts` - Throws errors
- `src/popup/App.tsx:87-88` - Sets error state
**Recommendation**:
- Create error classification system (Recoverable, UserAction, Fatal)
- Implement error boundary for React UI
- Add structured error logging with error codes
- Create error recovery decision tree
**Files to create/modify**:
- `src/shared/errors.ts` - Error class hierarchy
- `src/popup/components/ErrorBoundary.tsx`
- Update all error handling to use standardized approach

### 3. Security Hardening
**Status**: Needs review
**Location**: Content scripts, message passing
**Issues**:
- No input sanitization documentation for selectors
- CSP allows 'wasm-unsafe-eval' (required for WebGPU but document why)
- Content script injection into all URLs
- No rate limiting on actions (could be abused)
**Recommendation**:
- Add selector validation/sanitization in `action-executor.ts`
- Document security model in SECURITY.md
- Add rate limiting for actions (max N actions per second)
- Consider permission model for sensitive sites
- Add content script allowlist/denylist
**Files to create/modify**:
- `SECURITY.md` - Security documentation
- `src/content/selector-validator.ts` - Validate selectors before execution
- Add rate limiting in `executor.ts`

## High Priority Enhancements

### 4. Expand State Machine Coverage
**Status**: Limited (2 sites)
**Location**: `src/background/agents/state-machines/`
**Current**: YouTube, Amazon
**Issue**: Most sites fall back to LLM, defeating performance optimization
**Recommendation**: Add state machines for common sites:
- Google Search (simple: navigate → type → press_enter → extract)
- Wikipedia (navigation → extract)
- Reddit (navigation → search → click thread)
- GitHub (navigation → search → repository actions)
- eBay (similar to Amazon)
- Walmart (similar to Amazon)
- Netflix (browse/search)
**Files to create**:
- `src/background/agents/state-machines/google.ts`
- `src/background/agents/state-machines/wikipedia.ts`
- `src/background/agents/state-machines/github.ts`
- Update `site-router.ts` to register new machines

### 5. Settings Persistence
**Status**: Missing
**Location**: Popup UI
**Issue**: Model selection not saved, user must reselect every session
**Current**: User selects model each time in `TaskInput.tsx`
**Recommendation**:
- Save last used model to chrome.storage.local
- Save vision mode preference
- Save task history (last 10 tasks)
- Add settings page for defaults
**Files to create/modify**:
- `src/shared/storage.ts` - Storage utilities
- `src/popup/components/Settings.tsx` - Settings panel
- Update `TaskInput.tsx` to load/save preferences

### 6. Task History & Replay
**Status**: Missing
**Location**: None
**Issue**: No way to review past tasks or see what happened
**Recommendation**:
- Log task execution to chrome.storage.local
- Show history in popup UI
- Allow replay of previous tasks
- Export task logs for debugging
**Files to create**:
- `src/background/task-logger.ts` - Log execution details
- `src/popup/components/TaskHistory.tsx` - History UI
- Add history tab to popup

### 7. Enhance Obstacle Detection
**Status**: Amazon-focused
**Location**: `src/background/agents/obstacle-detector.ts`
**Issue**: Only detects Amazon obstacles, generic sites not covered
**Current patterns**: LOGIN_REQUIRED, CAPTCHA, OUT_OF_STOCK (Amazon-specific)
**Recommendation**:
- Add generic pattern detection (form errors, 404s, timeouts)
- Add site-specific obstacle detectors (YouTube age restrictions, paywall detection)
- Make obstacle patterns configurable
- Add obstacle resolution strategies
**Files to modify**:
- `src/background/agents/obstacle-detector.ts` - Add generic patterns
- `src/shared/constants.ts` - Add configurable patterns
- Add site-specific obstacle modules

### 8. Performance Monitoring
**Status**: Missing
**Location**: None
**Issue**: No metrics on LLM efficiency, action success rate, timing
**Recommendation**:
- Track LLM call count vs state machine usage
- Measure action execution time
- Track success/failure rates by action type
- Monitor model load time and memory usage
- Dashboard showing statistics
**Files to create**:
- `src/background/performance-monitor.ts` - Collect metrics
- `src/popup/components/Stats.tsx` - Display metrics
- Add metrics to task logs

## Medium Priority Enhancements

### 9. Code Duplication
**Status**: Present
**Location**: Multiple files
**Issues**:
- Port reconnection logic duplicated in `App.tsx` (lines 54-91, 236-276)
- Obstacle detection duplicated in `amazon-state-machine.ts` and `obstacle-detector.ts`
- Search query extraction duplicated in `executor.ts` and `site-router.ts`
**Recommendation**:
- Extract port connection to custom hook `useBackgroundPort()`
- Consolidate obstacle detection in single module
- Consolidate query extraction utilities
**Files to create/modify**:
- `src/popup/hooks/useBackgroundPort.ts` - Port connection hook
- Refactor `App.tsx` to use hook
- Remove duplicate obstacle detection

### 10. Change Observer Integration
**Status**: Underutilized
**Location**: `src/background/agents/change-observer.ts`
**Issue**: Created but not actively used for verification
**Current**: `takeSnapshot()` called but `detectChanges()` results not used
**Recommendation**:
- Use change detection to verify action success
- Provide feedback to navigator about what changed
- Use patterns to improve success detection
- Add change-based retry logic
**Files to modify**:
- `src/background/agents/executor.ts` - Use change detection results
- Expand success/error patterns in `change-observer.ts`

### 11. Enhanced Action Types
**Status**: Basic
**Location**: `src/content/action-executor.ts`, `src/shared/types.ts`
**Current actions**: navigate, click, type, press_enter, extract, scroll, wait, done, fail
**Missing actions**:
- `select` - Dropdown selection
- `hover` - Mouse hover for tooltips/menus
- `drag` - Drag and drop
- `right_click` - Context menu
- `double_click` - Double click
- `upload` - File upload
- `download` - File download trigger
- `switch_tab` - Multi-tab support
**Recommendation**: Add incrementally based on use cases
**Files to modify**:
- `src/shared/types.ts` - Add action types
- `src/content/action-executor.ts` - Implement actions

### 12. Multi-Tab Support
**Status**: Single tab only
**Location**: `src/background/index.ts`
**Issue**: `currentTabId` tracks only one tab
**Limitation**: Documented in README.md line 145
**Recommendation**:
- Track multiple task executions by tab ID
- Allow switching between tabs during execution
- Support opening links in new tabs
**Files to modify**:
- `src/background/index.ts` - Track tasks by tab ID
- Add tab management in executor
- Add `open_in_new_tab` action

### 13. Vision Mode Enhancement
**Status**: Implemented but underdocumented
**Location**: `src/background/vision-engine.ts`, `src/background/agents/vision-executor.ts`
**Issue**: README.md:144 says "No Vision" but vision mode exists
**Current**: Vision mode available but not primary path
**Recommendation**:
- Update README to reflect vision capabilities
- Add vision mode use cases to docs
- Improve vision-based element selection
- Combine DOM + vision for better accuracy
**Files to modify**:
- `README.md` - Update limitations section
- Add vision mode documentation
- Consider hybrid DOM+vision approach

### 14. Configuration System
**Status**: Hardcoded constants
**Location**: `src/shared/constants.ts`
**Issue**: All values hardcoded, no runtime configuration
**Recommendation**:
- Make key constants user-configurable
- Add advanced settings panel
- Allow per-site configuration
**Configurable values**:
- `MAX_STEPS`, `MAX_REPLANS`, `MAX_LLM_CALLS_PER_TASK`
- `MAX_INTERACTIVE_ELEMENTS`, `MAX_PAGE_TEXT_LENGTH`
- Timeouts and delays
- Model selection
**Files to create**:
- `src/shared/config.ts` - Configuration loader
- `src/popup/components/AdvancedSettings.tsx`

### 15. Site Pattern Management
**Status**: Hardcoded
**Location**: `src/background/agents/navigator-agent.ts:16-32`
**Issue**: `SITES` object hardcoded with URLs
**Recommendation**:
- Move to configuration file
- Allow user to add custom sites
- Support site aliases and URL patterns
**Files to modify**:
- Move to `src/shared/site-patterns.ts`
- Make extensible

## Low Priority / Future Enhancements

### 16. Plugin System
**Status**: Not implemented
**Issue**: Can't add state machines without modifying code
**Recommendation**:
- Define state machine interface
- Allow loading external state machines
- State machine marketplace/registry
**Files to create**:
- `src/background/plugin-loader.ts`
- State machine SDK documentation

### 17. Benchmarking Suite
**Status**: Missing
**Issue**: Can't compare model performance objectively
**Recommendation**:
- Create standard task suite
- Measure completion rate, steps, time per model
- Generate performance reports
**Files to create**:
- `benchmarks/tasks.json` - Standard tasks
- `benchmarks/runner.ts` - Benchmark executor
- `benchmarks/report.ts` - Results analysis

### 18. Session Persistence
**Status**: Not implemented
**Issue**: Can't resume task after browser restart or extension reload
**Recommendation**:
- Serialize executor state
- Save to chrome.storage.local
- Offer resume on startup
**Files to create**:
- `src/background/session-manager.ts`
- Add serialization to executor

### 19. Task Queue
**Status**: Single task at a time
**Issue**: Can't queue multiple tasks
**Recommendation**:
- Task queue with priorities
- Schedule tasks for later
- Batch task execution
**Files to create**:
- `src/background/task-queue.ts`
- Queue management UI

### 20. Accessibility
**Status**: Limited
**Location**: Popup UI
**Issue**: Not fully keyboard navigable, no ARIA labels
**Recommendation**:
- Full keyboard navigation
- Screen reader support
- ARIA labels and roles
**Files to modify**:
- All popup components
- Add accessibility testing

### 21. Network Resilience
**Status**: Basic
**Issue**: No offline detection, model download failures not gracefully handled
**Recommendation**:
- Detect offline mode
- Show cached model status
- Better download retry logic
**Files to modify**:
- `src/background/llm-engine.ts` - Improve download handling
- Add offline detection

### 22. Rate Limiting
**Status**: Not implemented
**Issue**: Could spam websites with rapid actions
**Recommendation**:
- Configurable rate limit per domain
- Respect robots.txt
- Add delays between actions
**Files to create**:
- `src/background/rate-limiter.ts`
- Add to executor

### 23. Internationalization
**Status**: English only
**Issue**: UI strings hardcoded
**Recommendation**:
- Extract strings to i18n files
- Support multiple languages
- Localize obstacle messages
**Files to create**:
- `src/shared/i18n/en.json`
- Add i18n library

### 24. Documentation Improvements
**Status**: Basic
**Issues**:
- No API documentation
- No architecture diagrams
- No state machine authoring guide
- No troubleshooting guide beyond README
**Recommendation**:
- Add JSDoc comments
- Generate API docs with TypeDoc
- Create architecture diagrams
- Expand troubleshooting guide
**Files to create**:
- `docs/ARCHITECTURE.md` with diagrams
- `docs/STATE_MACHINES.md` - Guide to writing state machines
- `docs/TROUBLESHOOTING.md` - Detailed debugging
- `docs/API.md` - API reference

### 25. Memory Management
**Status**: Unoptimized
**Issue**: No cleanup of old model data, history unbounded
**Recommendation**:
- Implement model unloading
- Cap history size
- Periodic cleanup of chrome.storage
**Files to modify**:
- `src/background/llm-engine.ts` - Add model cleanup
- Add storage cleanup utilities

### 26. Enhanced Logging
**Status**: console.log only
**Issue**: No structured logging, hard to debug production issues
**Recommendation**:
- Structured logging with levels
- Export logs for debugging
- Log rotation/cleanup
**Files to create**:
- `src/shared/logger.ts` - Structured logger
- Replace all console.log calls

### 27. Content Script Optimization
**Status**: Runs on all URLs
**Location**: `manifest.json:36-42`
**Issue**: Content script injected into every page
**Recommendation**:
- Lazy load content scripts
- Only inject when task starts
- Allowlist/denylist patterns
**Files to modify**:
- `manifest.json` - Change to programmatic injection
- `src/background/index.ts` - Inject on demand

### 28. Model Management UI
**Status**: Basic
**Issue**: No way to see cached models, clear cache, or manage storage
**Recommendation**:
- Show cached models and sizes
- Clear model cache
- Disk usage overview
**Files to create**:
- `src/popup/components/ModelManager.tsx`

### 29. Collaborative Features
**Status**: Not implemented
**Issue**: Can't share tasks or state machines
**Recommendation**:
- Export/import tasks
- Share state machines
- Community repository
**Files to create**:
- `src/shared/export.ts` - Export utilities
- Task sharing UI

### 30. Advanced Vision Features
**Status**: Basic vision mode
**Issue**: Vision not integrated with DOM for hybrid approach
**Recommendation**:
- Combine DOM + vision for element identification
- Use vision for verification
- Visual diff for change detection
- OCR for text extraction from images
**Files to modify**:
- Hybrid approach in navigator
- Visual verification in change observer

## Technical Debt

### 31. TypeScript Strictness
**Status**: Moderate
**Issue**: Some `any` types, optional chaining overused
**Recommendation**:
- Enable strict mode
- Remove `any` types
- Add proper null checks
**Files**: Throughout codebase

### 32. Build Optimization
**Status**: Basic Vite setup
**Issue**: No code splitting, bundle size not optimized
**Recommendation**:
- Analyze bundle size
- Code split by route
- Tree shaking verification
**Files to modify**:
- `vite.config.ts`

### 33. CSS Organization
**Status**: Single CSS file
**Location**: `src/popup/styles.css`
**Issue**: No component-scoped styles, growing file
**Recommendation**:
- Component-scoped CSS modules or styled-components
- CSS variables for theming
**Files to modify/create**:
- Convert to CSS modules

## Priority Matrix

**Immediate (Next Sprint)**:
1. Testing Infrastructure (Critical for maintenance)
2. Settings Persistence (User experience)
3. Error Handling Standardization (Stability)

**Short Term (1-2 months)**:
4. Expand State Machine Coverage (Performance)
5. Task History & Replay (User experience)
6. Security Hardening (Production readiness)
7. Performance Monitoring (Optimization)

**Medium Term (3-6 months)**:
8. Multi-Tab Support (Feature expansion)
9. Enhanced Action Types (Capability)
10. Plugin System (Extensibility)

**Long Term (6+ months)**:
11. Internationalization (Reach)
12. Collaborative Features (Community)
13. Advanced Vision Features (Accuracy)

## Metrics for Success

For each enhancement, define success metrics:
- **Testing**: 80%+ code coverage, 0 critical bugs in state machines
- **Performance**: <5% LLM fallback rate for covered sites, <2s avg action time
- **Reliability**: <1% task failure rate for standard workflows
- **User Experience**: <10s model load time, 90%+ task completion rate
