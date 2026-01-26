/**
 * State Machine Registry
 *
 * Central registry for all state machines with status tracking.
 * Provides visibility into which machines are active and their current state.
 * (Phase 2.1)
 */

// ============================================================================
// Types
// ============================================================================

export interface StateMachineInfo {
  id: string;
  name: string;
  description: string;
  active: boolean;
  currentState?: string;
  possibleStates: string[];
  canHandleUrls: string[];
  lastMatchTime?: number;
}

export interface StateMachineStatus {
  machines: StateMachineInfo[];
  activeMachine?: string;
  lastUpdate: number;
}

// ============================================================================
// State Machine Registry
// ============================================================================

class StateRegistry {
  private machines: Map<string, StateMachineInfo> = new Map();
  private activeMachine: string | null = null;

  constructor() {
    // Register built-in state machines
    this.registerMachine({
      id: 'amazon',
      name: 'Amazon Shopping',
      description: 'Handles Amazon product search, cart, and checkout',
      active: false,
      possibleStates: [
        'homepage',
        'search_results',
        'product_page',
        'cart',
        'checkout',
        'signin',
        'captcha',
      ],
      canHandleUrls: ['amazon.com', 'amazon.co.uk', 'amazon.ca', 'amazon.de'],
    });

    this.registerMachine({
      id: 'youtube',
      name: 'YouTube',
      description: 'Handles YouTube video search and playback',
      active: false,
      possibleStates: [
        'homepage',
        'search_results',
        'video_page',
        'channel_page',
      ],
      canHandleUrls: ['youtube.com', 'youtu.be'],
    });

    console.log('[StateRegistry] Initialized with', this.machines.size, 'machines');
  }

  /**
   * Register a new state machine
   */
  registerMachine(info: StateMachineInfo): void {
    this.machines.set(info.id, info);
    console.log(`[StateRegistry] Registered: ${info.name}`);
  }

  /**
   * Update the active state of a machine
   */
  setMachineActive(machineId: string, active: boolean, currentState?: string): void {
    const machine = this.machines.get(machineId);
    if (machine) {
      machine.active = active;
      machine.currentState = currentState;
      machine.lastMatchTime = active ? Date.now() : machine.lastMatchTime;

      if (active) {
        // Deactivate other machines
        for (const [id, m] of this.machines) {
          if (id !== machineId && m.active) {
            m.active = false;
            m.currentState = undefined;
          }
        }
        this.activeMachine = machineId;
      } else if (this.activeMachine === machineId) {
        this.activeMachine = null;
      }

      console.log(`[StateRegistry] ${machine.name}: active=${active}, state=${currentState}`);
    }
  }

  /**
   * Update the current state of a machine
   */
  updateMachineState(machineId: string, state: string): void {
    const machine = this.machines.get(machineId);
    if (machine) {
      machine.currentState = state;
      machine.lastMatchTime = Date.now();
    }
  }

  /**
   * Get current status of all machines
   */
  getStatus(): StateMachineStatus {
    return {
      machines: Array.from(this.machines.values()),
      activeMachine: this.activeMachine || undefined,
      lastUpdate: Date.now(),
    };
  }

  /**
   * Get info for a specific machine
   */
  getMachine(machineId: string): StateMachineInfo | undefined {
    return this.machines.get(machineId);
  }

  /**
   * Reset all machines (e.g., when task completes)
   */
  reset(): void {
    for (const machine of this.machines.values()) {
      machine.active = false;
      machine.currentState = undefined;
    }
    this.activeMachine = null;
    console.log('[StateRegistry] Reset all machines');
  }

  /**
   * Check which machine can handle a URL
   */
  findMachineForUrl(url: string): StateMachineInfo | undefined {
    const normalizedUrl = url.toLowerCase();
    for (const machine of this.machines.values()) {
      if (machine.canHandleUrls.some(pattern => normalizedUrl.includes(pattern))) {
        return machine;
      }
    }
    return undefined;
  }
}

// Export singleton instance
export const stateRegistry = new StateRegistry();
