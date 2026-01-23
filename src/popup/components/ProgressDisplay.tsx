/**
 * Progress Display Component
 *
 * Shows the current execution progress including plan and steps.
 */

import React from 'react';
import type { Step } from '../App';

interface ProgressDisplayProps {
  state: 'planning' | 'executing';
  plan: string[];
  steps: Step[];
}

export function ProgressDisplay({
  state,
  plan,
  steps,
}: ProgressDisplayProps): React.ReactElement {
  return (
    <div className="progress-display">
      {state === 'planning' && (
        <div className="planning-indicator">
          <div className="spinner" />
          <span>Creating execution plan...</span>
        </div>
      )}

      {plan.length > 0 && (
        <div className="progress-section">
          <h3>Plan</h3>
          <ul className="plan-list">
            {plan.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ul>
        </div>
      )}

      {steps.length > 0 && (
        <div className="progress-section">
          <h3>Execution</h3>
          <ul className="steps-list">
            {steps.map((step) => (
              <li key={step.number} className={`step-item ${step.status}`}>
                <div className="step-header">
                  <span className="step-number">{step.number}</span>
                  <span className="step-action">
                    {step.action === '...' ? 'Thinking...' : step.action}
                  </span>
                  {step.status === 'running' && <div className="spinner" />}
                </div>

                {Object.keys(step.params).length > 0 && (
                  <div className="step-params">
                    {Object.entries(step.params)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(', ')
                      .slice(0, 100)}
                  </div>
                )}

                {/* Phase 1.3: Show agent reasoning */}
                {step.reasoning && (
                  <div className="step-reasoning">
                    <strong>Reasoning:</strong> {step.reasoning}
                  </div>
                )}

                {step.stateDetected && (
                  <div className="step-source">
                    <span className="source-badge">
                      {step.stateDetected.includes('state machine') ? '🤖 State Machine' :
                       step.stateDetected.includes('rule') ? '📋 Rule Engine' :
                       step.stateDetected.includes('Vision') ? '👁 Vision Mode' :
                       '🧠 LLM'}
                    </span>
                    {step.stateDetected}
                    {step.confidence !== undefined && (
                      <span className="confidence">
                        {' '}• Confidence: {Math.round(step.confidence * 100)}%
                      </span>
                    )}
                  </div>
                )}

                {step.result && (
                  <div className="step-result">✓ {step.result}</div>
                )}

                {step.error && (
                  <div className="step-error">✗ {step.error}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
