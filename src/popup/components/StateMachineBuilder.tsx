/**
 * State Machine Builder Component
 *
 * Visual GUI for creating and configuring state machines.
 * Allows users to define states, transitions, actions, and URL patterns.
 * (Phase 3.1)
 */

import React, { useState, useEffect } from 'react';

// ============================================================================
// Types
// ============================================================================

interface StateMachineConfig {
  id: string;
  name: string;
  description: string;
  urlPatterns: string[];
  states: StateConfig[];
  initialState: string;
}

interface StateConfig {
  id: string;
  name: string;
  description: string;
  detectionRules: DetectionRule[];
  actions: ActionConfig[];
  transitions: Transition[];
}

interface DetectionRule {
  type: 'url' | 'pageText' | 'element';
  pattern: string;
  operator: 'contains' | 'equals' | 'matches';
}

interface ActionConfig {
  actionType: 'navigate' | 'click' | 'type' | 'press_enter' | 'scroll' | 'done';
  selector?: string;
  text?: string;
  url?: string;
  reasoning: string;
}

interface Transition {
  toState: string;
  condition: string;
}

// ============================================================================
// Component
// ============================================================================

export function StateMachineBuilder(): React.ReactElement {
  const [machines, setMachines] = useState<StateMachineConfig[]>([]);
  const [selectedMachine, setSelectedMachine] = useState<string | null>(null);
  const [editingMachine, setEditingMachine] = useState<StateMachineConfig | null>(null);
  const [editingState, setEditingState] = useState<StateConfig | null>(null);
  const [view, setView] = useState<'list' | 'create' | 'edit-machine' | 'edit-state'>('list');

  // Load saved state machines on mount
  useEffect(() => {
    loadStateMachines();
  }, []);

  const loadStateMachines = async () => {
    try {
      const result = await chrome.storage.local.get('customStateMachines');
      const saved = result.customStateMachines || [];
      setMachines(saved);
    } catch (error) {
      console.error('[StateMachineBuilder] Failed to load machines:', error);
    }
  };

  const saveStateMachines = async (updated: StateMachineConfig[]) => {
    try {
      await chrome.storage.local.set({ customStateMachines: updated });
      setMachines(updated);
    } catch (error) {
      console.error('[StateMachineBuilder] Failed to save machines:', error);
    }
  };

  const createNewMachine = () => {
    const newMachine: StateMachineConfig = {
      id: `custom_${Date.now()}`,
      name: 'New State Machine',
      description: 'A custom state machine',
      urlPatterns: ['example.com'],
      states: [
        {
          id: 'initial',
          name: 'Initial State',
          description: 'Starting state',
          detectionRules: [],
          actions: [],
          transitions: [],
        },
      ],
      initialState: 'initial',
    };
    setEditingMachine(newMachine);
    setView('edit-machine');
  };

  const saveMachine = async () => {
    if (!editingMachine) return;

    const exists = machines.find((m) => m.id === editingMachine.id);
    let updated: StateMachineConfig[];

    if (exists) {
      updated = machines.map((m) => (m.id === editingMachine.id ? editingMachine : m));
    } else {
      updated = [...machines, editingMachine];
    }

    await saveStateMachines(updated);
    setEditingMachine(null);
    setView('list');
  };

  const deleteMachine = async (id: string) => {
    const updated = machines.filter((m) => m.id !== id);
    await saveStateMachines(updated);
  };

  const addState = () => {
    if (!editingMachine) return;

    const newState: StateConfig = {
      id: `state_${Date.now()}`,
      name: 'New State',
      description: '',
      detectionRules: [],
      actions: [],
      transitions: [],
    };

    setEditingMachine({
      ...editingMachine,
      states: [...editingMachine.states, newState],
    });
  };

  const deleteState = (stateId: string) => {
    if (!editingMachine) return;

    setEditingMachine({
      ...editingMachine,
      states: editingMachine.states.filter((s) => s.id !== stateId),
    });
  };

  const editState = (state: StateConfig) => {
    setEditingState(state);
    setView('edit-state');
  };

  const saveState = () => {
    if (!editingMachine || !editingState) return;

    setEditingMachine({
      ...editingMachine,
      states: editingMachine.states.map((s) =>
        s.id === editingState.id ? editingState : s
      ),
    });
    setEditingState(null);
    setView('edit-machine');
  };

  // ============================================================================
  // Render
  // ============================================================================

  if (view === 'list') {
    return (
      <div className="state-machine-builder">
        <div className="builder-header">
          <h3>State Machine Builder</h3>
          <button onClick={createNewMachine} className="create-button">
            + Create New
          </button>
        </div>

        <div className="builder-info">
          <p>
            Create custom state machines to automate tasks on specific websites.
            Define states, actions, and transitions to control the agent's behavior.
          </p>
        </div>

        {machines.length === 0 ? (
          <div className="empty-state">
            <p>No custom state machines yet.</p>
            <p>Click "Create New" to get started.</p>
          </div>
        ) : (
          <div className="machines-grid">
            {machines.map((machine) => (
              <div key={machine.id} className="machine-card-builder">
                <div className="machine-card-header">
                  <h4>{machine.name}</h4>
                  <span className="badge">{machine.states.length} states</span>
                </div>
                <p className="machine-card-description">{machine.description}</p>
                <div className="machine-card-patterns">
                  <strong>Handles:</strong>
                  {machine.urlPatterns.map((pattern, idx) => (
                    <span key={idx} className="url-pattern-tag">
                      {pattern}
                    </span>
                  ))}
                </div>
                <div className="machine-card-actions">
                  <button
                    onClick={() => {
                      setEditingMachine(machine);
                      setView('edit-machine');
                    }}
                    className="edit-button"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteMachine(machine.id)}
                    className="delete-button"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (view === 'edit-machine' && editingMachine) {
    return (
      <div className="state-machine-builder">
        <div className="builder-header">
          <h3>Edit State Machine</h3>
          <div className="header-actions">
            <button onClick={saveMachine} className="save-button">
              Save
            </button>
            <button
              onClick={() => {
                setEditingMachine(null);
                setView('list');
              }}
              className="cancel-button"
            >
              Cancel
            </button>
          </div>
        </div>

        <div className="edit-form">
          <div className="form-group">
            <label>Name:</label>
            <input
              type="text"
              value={editingMachine.name}
              onChange={(e) =>
                setEditingMachine({ ...editingMachine, name: e.target.value })
              }
            />
          </div>

          <div className="form-group">
            <label>Description:</label>
            <textarea
              value={editingMachine.description}
              onChange={(e) =>
                setEditingMachine({ ...editingMachine, description: e.target.value })
              }
              rows={2}
            />
          </div>

          <div className="form-group">
            <label>URL Patterns (one per line):</label>
            <textarea
              value={editingMachine.urlPatterns.join('\n')}
              onChange={(e) =>
                setEditingMachine({
                  ...editingMachine,
                  urlPatterns: e.target.value.split('\n').filter((p) => p.trim()),
                })
              }
              placeholder="example.com&#10;*.example.com"
              rows={3}
            />
          </div>

          <div className="form-group">
            <label>Initial State:</label>
            <select
              value={editingMachine.initialState}
              onChange={(e) =>
                setEditingMachine({ ...editingMachine, initialState: e.target.value })
              }
            >
              {editingMachine.states.map((state) => (
                <option key={state.id} value={state.id}>
                  {state.name}
                </option>
              ))}
            </select>
          </div>

          <div className="states-section">
            <div className="section-header">
              <h4>States ({editingMachine.states.length})</h4>
              <button onClick={addState} className="add-button">
                + Add State
              </button>
            </div>

            <div className="states-list-builder">
              {editingMachine.states.map((state) => (
                <div key={state.id} className="state-item-builder">
                  <div className="state-item-header">
                    <strong>{state.name}</strong>
                    {state.id === editingMachine.initialState && (
                      <span className="initial-badge">Initial</span>
                    )}
                  </div>
                  <p className="state-item-description">{state.description}</p>
                  <div className="state-item-stats">
                    <span>{state.actions.length} actions</span>
                    <span>{state.transitions.length} transitions</span>
                  </div>
                  <div className="state-item-actions">
                    <button onClick={() => editState(state)} className="edit-button-small">
                      Edit
                    </button>
                    {editingMachine.states.length > 1 && (
                      <button
                        onClick={() => deleteState(state.id)}
                        className="delete-button-small"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'edit-state' && editingState && editingMachine) {
    return (
      <div className="state-machine-builder">
        <div className="builder-header">
          <h3>Edit State: {editingState.name}</h3>
          <div className="header-actions">
            <button onClick={saveState} className="save-button">
              Save State
            </button>
            <button
              onClick={() => {
                setEditingState(null);
                setView('edit-machine');
              }}
              className="cancel-button"
            >
              Cancel
            </button>
          </div>
        </div>

        <div className="edit-form">
          <div className="form-group">
            <label>State Name:</label>
            <input
              type="text"
              value={editingState.name}
              onChange={(e) =>
                setEditingState({ ...editingState, name: e.target.value })
              }
            />
          </div>

          <div className="form-group">
            <label>Description:</label>
            <textarea
              value={editingState.description}
              onChange={(e) =>
                setEditingState({ ...editingState, description: e.target.value })
              }
              rows={2}
            />
          </div>

          <div className="section">
            <h4>Detection Rules</h4>
            <p className="hint">
              Define how to detect when the agent is in this state (e.g., URL contains
              "checkout", page text includes "Your Cart")
            </p>
            {editingState.detectionRules.map((rule, idx) => (
              <div key={idx} className="rule-item">
                <select
                  value={rule.type}
                  onChange={(e) => {
                    const updated = [...editingState.detectionRules];
                    updated[idx].type = e.target.value as any;
                    setEditingState({ ...editingState, detectionRules: updated });
                  }}
                >
                  <option value="url">URL</option>
                  <option value="pageText">Page Text</option>
                  <option value="element">Element</option>
                </select>
                <select
                  value={rule.operator}
                  onChange={(e) => {
                    const updated = [...editingState.detectionRules];
                    updated[idx].operator = e.target.value as any;
                    setEditingState({ ...editingState, detectionRules: updated });
                  }}
                >
                  <option value="contains">contains</option>
                  <option value="equals">equals</option>
                  <option value="matches">matches (regex)</option>
                </select>
                <input
                  type="text"
                  placeholder="pattern"
                  value={rule.pattern}
                  onChange={(e) => {
                    const updated = [...editingState.detectionRules];
                    updated[idx].pattern = e.target.value;
                    setEditingState({ ...editingState, detectionRules: updated });
                  }}
                />
                <button
                  onClick={() => {
                    setEditingState({
                      ...editingState,
                      detectionRules: editingState.detectionRules.filter(
                        (_, i) => i !== idx
                      ),
                    });
                  }}
                  className="delete-button-small"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={() => {
                setEditingState({
                  ...editingState,
                  detectionRules: [
                    ...editingState.detectionRules,
                    { type: 'url', pattern: '', operator: 'contains' },
                  ],
                });
              }}
              className="add-button-small"
            >
              + Add Rule
            </button>
          </div>

          <div className="section">
            <h4>Actions</h4>
            <p className="hint">
              Define what action the agent should take when in this state
            </p>
            {editingState.actions.map((action, idx) => (
              <div key={idx} className="action-item">
                <select
                  value={action.actionType}
                  onChange={(e) => {
                    const updated = [...editingState.actions];
                    updated[idx].actionType = e.target.value as any;
                    setEditingState({ ...editingState, actions: updated });
                  }}
                >
                  <option value="click">Click</option>
                  <option value="type">Type</option>
                  <option value="navigate">Navigate</option>
                  <option value="press_enter">Press Enter</option>
                  <option value="scroll">Scroll</option>
                  <option value="done">Done</option>
                </select>
                {(action.actionType === 'click' || action.actionType === 'press_enter') && (
                  <input
                    type="text"
                    placeholder="CSS selector"
                    value={action.selector || ''}
                    onChange={(e) => {
                      const updated = [...editingState.actions];
                      updated[idx].selector = e.target.value;
                      setEditingState({ ...editingState, actions: updated });
                    }}
                  />
                )}
                {action.actionType === 'type' && (
                  <>
                    <input
                      type="text"
                      placeholder="CSS selector"
                      value={action.selector || ''}
                      onChange={(e) => {
                        const updated = [...editingState.actions];
                        updated[idx].selector = e.target.value;
                        setEditingState({ ...editingState, actions: updated });
                      }}
                    />
                    <input
                      type="text"
                      placeholder="text to type"
                      value={action.text || ''}
                      onChange={(e) => {
                        const updated = [...editingState.actions];
                        updated[idx].text = e.target.value;
                        setEditingState({ ...editingState, actions: updated });
                      }}
                    />
                  </>
                )}
                {action.actionType === 'navigate' && (
                  <input
                    type="text"
                    placeholder="URL"
                    value={action.url || ''}
                    onChange={(e) => {
                      const updated = [...editingState.actions];
                      updated[idx].url = e.target.value;
                      setEditingState({ ...editingState, actions: updated });
                    }}
                  />
                )}
                <input
                  type="text"
                  placeholder="reasoning"
                  value={action.reasoning}
                  onChange={(e) => {
                    const updated = [...editingState.actions];
                    updated[idx].reasoning = e.target.value;
                    setEditingState({ ...editingState, actions: updated });
                  }}
                />
                <button
                  onClick={() => {
                    setEditingState({
                      ...editingState,
                      actions: editingState.actions.filter((_, i) => i !== idx),
                    });
                  }}
                  className="delete-button-small"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={() => {
                setEditingState({
                  ...editingState,
                  actions: [
                    ...editingState.actions,
                    { actionType: 'click', reasoning: '' },
                  ],
                });
              }}
              className="add-button-small"
            >
              + Add Action
            </button>
          </div>

          <div className="section">
            <h4>Transitions</h4>
            <p className="hint">
              Define when to move to another state (e.g., after successful action)
            </p>
            {editingState.transitions.map((transition, idx) => (
              <div key={idx} className="transition-item">
                <select
                  value={transition.toState}
                  onChange={(e) => {
                    const updated = [...editingState.transitions];
                    updated[idx].toState = e.target.value;
                    setEditingState({ ...editingState, transitions: updated });
                  }}
                >
                  <option value="">Select state...</option>
                  {editingMachine.states.map((state) => (
                    <option key={state.id} value={state.id}>
                      {state.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="condition (e.g., 'success', 'url contains checkout')"
                  value={transition.condition}
                  onChange={(e) => {
                    const updated = [...editingState.transitions];
                    updated[idx].condition = e.target.value;
                    setEditingState({ ...editingState, transitions: updated });
                  }}
                />
                <button
                  onClick={() => {
                    setEditingState({
                      ...editingState,
                      transitions: editingState.transitions.filter((_, i) => i !== idx),
                    });
                  }}
                  className="delete-button-small"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={() => {
                setEditingState({
                  ...editingState,
                  transitions: [
                    ...editingState.transitions,
                    { toState: '', condition: '' },
                  ],
                });
              }}
              className="add-button-small"
            >
              + Add Transition
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <div>Loading...</div>;
}
