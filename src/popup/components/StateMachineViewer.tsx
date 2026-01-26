/**
 * State Machine Viewer Component
 *
 * Displays all registered state machines with their current status.
 * Shows which machines are active and their current state.
 * (Phase 2.1)
 */

import React, { useState, useEffect } from 'react';

// ============================================================================
// Types (matching backend state-registry.ts)
// ============================================================================

interface StateMachineInfo {
  id: string;
  name: string;
  description: string;
  active: boolean;
  currentState?: string;
  possibleStates: string[];
  canHandleUrls: string[];
  lastMatchTime?: number;
}

interface StateMachineStatus {
  machines: StateMachineInfo[];
  activeMachine?: string;
  lastUpdate: number;
}

// ============================================================================
// Component
// ============================================================================

export function StateMachineViewer(): React.ReactElement {
  const [status, setStatus] = useState<StateMachineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load status on mount and refresh periodically
  useEffect(() => {
    loadStatus();

    // Refresh every 2 seconds when a task is running
    const interval = setInterval(loadStatus, 2000);

    return () => clearInterval(interval);
  }, []);

  const loadStatus = async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_STATE_MACHINE_STATUS',
      });

      if (response?.success) {
        setStatus(response.status);
        setError(null);
      } else {
        setError('Failed to load state machine status');
      }
    } catch (err) {
      console.error('[StateMachineViewer] Failed to load status:', err);
      setError('Could not connect to background service');
    } finally {
      setLoading(false);
    }
  };

  const formatTimestamp = (timestamp?: number) => {
    if (!timestamp) return 'Never';
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 1000) return 'Just now';
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return new Date(timestamp).toLocaleTimeString();
  };

  if (loading) {
    return (
      <div className="state-machine-viewer">
        <div className="loading">Loading state machines...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="state-machine-viewer">
        <div className="error-state">{error}</div>
        <button onClick={loadStatus} className="retry-button">
          Retry
        </button>
      </div>
    );
  }

  if (!status || status.machines.length === 0) {
    return (
      <div className="state-machine-viewer">
        <div className="empty-state">
          <p>No state machines registered.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="state-machine-viewer">
      <div className="viewer-header">
        <h3>State Machines</h3>
        <button onClick={loadStatus} className="refresh-button">
          ↻ Refresh
        </button>
      </div>

      <div className="machines-list">
        {status.machines.map((machine) => (
          <div
            key={machine.id}
            className={`machine-card ${machine.active ? 'active' : 'inactive'}`}
          >
            <div className="machine-header">
              <div className="machine-status-indicator">
                {machine.active ? '●' : '○'}
              </div>
              <div className="machine-info">
                <h4>{machine.name}</h4>
                <p className="machine-description">{machine.description}</p>
              </div>
            </div>

            {machine.active && machine.currentState && (
              <div className="machine-current-state">
                <span className="label">Current State:</span>
                <span className="state-value">{machine.currentState}</span>
              </div>
            )}

            <div className="machine-details">
              <div className="detail-group">
                <span className="detail-label">Status:</span>
                <span className={`status-badge ${machine.active ? 'active' : 'inactive'}`}>
                  {machine.active ? 'Active' : 'Inactive'}
                </span>
              </div>

              {machine.active && (
                <div className="detail-group">
                  <span className="detail-label">Last Match:</span>
                  <span className="detail-value">
                    {formatTimestamp(machine.lastMatchTime)}
                  </span>
                </div>
              )}

              <div className="detail-group">
                <span className="detail-label">Handles:</span>
                <div className="url-patterns">
                  {machine.canHandleUrls.map((url, idx) => (
                    <span key={idx} className="url-pattern">
                      {url}
                    </span>
                  ))}
                </div>
              </div>

              <div className="detail-group">
                <span className="detail-label">Possible States:</span>
                <div className="states-list">
                  {machine.possibleStates.map((state) => (
                    <span
                      key={state}
                      className={`state-chip ${
                        state === machine.currentState ? 'current' : ''
                      }`}
                    >
                      {state}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="viewer-footer">
        <p className="last-update">
          Last updated: {new Date(status.lastUpdate).toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
}
