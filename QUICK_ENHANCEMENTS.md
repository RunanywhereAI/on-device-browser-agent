# Quick Enhancement Reference Card

One-page reference for the most actionable improvements. See `ENHANCEMENT_POINTS.md` for complete list.

## 🎯 Top 3 Priorities

### 1. Add Tests (Start Here!)
```bash
# Create test structure
mkdir -p tests/unit/state-machines
npm install -D vitest @vitest/ui

# Start with YouTube state machine
# tests/unit/state-machines/youtube.test.ts
```
**Why**: Zero tests = high regression risk. State machines are deterministic = easy to test.
**Impact**: High (prevents breaking changes)
**Effort**: 4 hours for first test, then template for others

### 2. Persist Settings
```typescript
// src/shared/storage.ts
export async function saveSettings(settings: {
  modelId: string;
  visionMode: boolean;
  vlmModelId: string;
}) {
  await chrome.storage.local.set({ settings });
}

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings || { modelId: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', visionMode: false };
}
```
**Why**: User must reselect model every session
**Impact**: High (UX improvement)
**Effort**: 2 hours

### 3. Add Performance Logging
```typescript
// In executor.ts after each action
const source = action ? 'state-machine' : 'llm-fallback';
console.log(`[Metrics] Action via ${source}, LLM calls remaining: ${this.llmCallsRemaining}`);

// Track at task end
console.log(`[Metrics] Task complete: ${steps} steps, ${llmCalls} LLM calls, ${duration}ms`);
```
**Why**: Can't verify state-machine-first approach is working
**Impact**: Medium (enables optimization)
**Effort**: 2 hours

## 🚀 Quick Wins (< 4 hours each)

### 4. Extract Port Connection Hook
**File**: `src/popup/hooks/useBackgroundPort.ts`
```typescript
export function useBackgroundPort() {
  const [port, setPort] = useState<chrome.runtime.Port | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const connect = () => {
      try {
        const newPort = chrome.runtime.connect({ name: POPUP_PORT_NAME });
        // ... connection logic ...
        setPort(newPort);
      } catch (err) {
        setError('Failed to connect');
      }
    };
    connect();
    return () => port?.disconnect();
  }, []);

  return { port, error, reconnect: connect };
}
```
**Removes duplication**: Lines 54-91 and 236-276 in App.tsx

### 5. Add Google Search State Machine
**File**: `src/background/agents/state-machines/google.ts`
```typescript
export class GoogleStateMachine {
  canHandle(url: string, task: string): boolean {
    return task.toLowerCase().includes('google') || url.includes('google.com');
  }

  getState(dom: DOMState): 'NAVIGATING' | 'ON_HOMEPAGE' | 'ON_RESULTS' | 'DONE' {
    if (!dom.url.includes('google.com')) return 'NAVIGATING';
    if (dom.url.includes('/search?')) return 'ON_RESULTS';
    return 'ON_HOMEPAGE';
  }

  getAction(state: string, dom: DOMState, query: string): NavigatorOutput {
    // Simple: navigate → type → press_enter → extract
  }
}
```
**Register**: Add to `site-router.ts`
**Impact**: Reduces LLM calls for common searches

### 6. Update README Vision Section
**File**: `README.md:144`
```diff
- **No Vision**: Uses text-only DOM analysis (no screenshot understanding)
+ **Hybrid DOM + Vision**: Primary DOM analysis, with optional vision mode for complex UI
```
**Why**: Vision mode exists but README says it doesn't
**Effort**: 30 minutes

## 🔧 Code Quality Fixes

### 7. Remove Obstacle Detection Duplication
**Problem**: Logic duplicated in `amazon-state-machine.ts:185-209` and `obstacle-detector.ts`
**Solution**:
```typescript
// In amazon-state-machine.ts
import { detectObstacle } from './obstacle-detector';

// Replace detectObstacle() method with:
const obstacle = detectObstacle(domState);
```

### 8. Consolidate Search Query Extraction
**Problem**: Duplicated in `executor.ts:563-592` and `site-router.ts:125-154`
**Solution**: Create `src/shared/query-extractor.ts`
```typescript
export function extractSearchQuery(task: string): string | null {
  const patterns = [
    /(?:search|find)\s+(?:for\s+)?["']?(.+?)["']?(?:\s+on|\s*$)/i,
    // ... consolidated patterns ...
  ];
  // ... unified logic ...
}
```

## 🎨 Feature Additions

### 9. Add Task History
**File**: `src/background/task-logger.ts`
```typescript
export async function logTask(task: {
  description: string;
  steps: number;
  llmCalls: number;
  duration: number;
  success: boolean;
  timestamp: number;
}) {
  const history = await chrome.storage.local.get('taskHistory');
  const tasks = history.taskHistory || [];
  tasks.unshift(task);
  // Keep last 50 tasks
  await chrome.storage.local.set({
    taskHistory: tasks.slice(0, 50)
  });
}
```

### 10. Add Selector Validation
**File**: `src/content/action-executor.ts`
```typescript
function validateSelector(selector: string): boolean {
  // Prevent injection attacks
  if (selector.includes('<script>') || selector.includes('javascript:')) {
    console.error('[Security] Blocked dangerous selector:', selector);
    return false;
  }
  try {
    document.querySelector(selector);
    return true;
  } catch {
    return false;
  }
}
```

## 📊 Monitoring

### Add Basic Metrics
```typescript
// In executor.ts
const metrics = {
  stateMachineActions: 0,
  ruleEngineActions: 0,
  llmFallbackActions: 0,
  totalActions: 0,
};

// Update after each action determination
if (machineResult) metrics.stateMachineActions++;
else if (ruleAction) metrics.ruleEngineActions++;
else metrics.llmFallbackActions++;

// Log at task end
console.log(`[Metrics] State machine: ${metrics.stateMachineActions}, Rules: ${metrics.ruleEngineActions}, LLM: ${metrics.llmFallbackActions}`);
```

## 🔐 Security Quick Fixes

### Add Rate Limiting
```typescript
// src/background/rate-limiter.ts
export class RateLimiter {
  private lastAction: number = 0;
  private minDelay: number = 500; // ms between actions

  async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastAction;
    if (elapsed < this.minDelay) {
      await sleep(this.minDelay - elapsed);
    }
    this.lastAction = Date.now();
  }
}
```

## 🧪 Testing Template

```typescript
// tests/unit/state-machines/youtube.test.ts
import { describe, it, expect } from 'vitest';
import { YouTubeStateMachine } from '@/background/agents/state-machines/youtube';

describe('YouTubeStateMachine', () => {
  const machine = new YouTubeStateMachine();

  it('detects YouTube URLs', () => {
    expect(machine.canHandle('https://youtube.com', '')).toBe(true);
    expect(machine.canHandle('https://amazon.com', '')).toBe(false);
  });

  it('determines correct state from URL', () => {
    const homepageState = machine.getState({
      url: 'https://youtube.com',
      title: 'YouTube',
      interactiveElements: [],
      pageText: '',
    }, []);
    expect(homepageState).toBe('ON_HOMEPAGE');
  });

  it('returns navigate action when not on YouTube', () => {
    const action = machine.getAction('NAVIGATING', mockDomState, '');
    expect(action.action.action_type).toBe('navigate');
    expect(action.action.parameters.url).toBe('https://www.youtube.com');
  });
});
```

## 📝 Documentation Updates

### Add State Machine Guide
**File**: `docs/STATE_MACHINES.md`
- Template structure
- State transitions
- Action creation
- Testing approach
- Registration in site-router

### Add Architecture Diagram
**File**: `docs/ARCHITECTURE.md`
- Component hierarchy
- Message flow diagram
- State machine routing
- Decision tree

## 🎯 Success Metrics

Track these after enhancements:

```typescript
// Metrics to monitor
interface TaskMetrics {
  llmCallPercentage: number;      // Target: < 5%
  averageStepsPerTask: number;    // Target: < 10
  actionSuccessRate: number;      // Target: > 95%
  taskCompletionRate: number;     // Target: > 85%
  averageTaskDuration: number;    // Target: < 30s
}
```

## 🔄 Next Actions

1. [ ] Run `npm install -D vitest` and create first test
2. [ ] Add chrome.storage for settings
3. [ ] Add performance logging to executor
4. [ ] Extract useBackgroundPort hook
5. [ ] Create Google Search state machine
6. [ ] Update README vision documentation
7. [ ] Add basic task history logging
8. [ ] Consolidate duplicated code
9. [ ] Add selector validation
10. [ ] Create SECURITY.md

---

**Estimated total effort for top 10**: 20-25 hours
**Expected impact**: 80% coverage of critical issues, measurable improvements

See `ENHANCEMENT_POINTS.md` for all 33 enhancements.
See `ENHANCEMENT_SUMMARY.md` for detailed analysis and roadmap.
