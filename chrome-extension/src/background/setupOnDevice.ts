/**
 * Make on-device inference the default with no configuration step.
 *
 * The extension it forked from could not work until you went and pasted an API
 * key somewhere. That is the wrong first experience for this product: the model
 * runs locally, so there is nothing to configure and nothing to pay for, and the
 * user should never see a "set up a provider" screen at all.
 *
 * This seeds the provider and both agent roles on install, so a fresh profile
 * arrives at a working default. It is deliberately conservative: it never
 * overwrites a choice the user has already made, so re-running it (on every
 * update, say) cannot undo someone's preference for a cloud model or a
 * different local one.
 */

import {
  AgentNameEnum,
  agentModelStore,
  llmProviderStore,
  ProviderTypeEnum,
  getDefaultProviderConfig,
} from '@extension/storage';
import { chooseModel, findModel } from '@extension/runanywhere';
import { createLogger } from './log';

const logger = createLogger('setupOnDevice');

/**
 * Pick the default model without touching the engine.
 *
 * Capability probing lives in the offscreen document, which means booting the
 * WASM runtime — far too heavy for an install hook, and it would make first
 * install feel broken while a model loaded. `chooseModel(null)` falls back to a
 * mainstream-laptop assumption, which is the right guess to make here; the UI
 * re-checks against real capabilities later and can offer something better or
 * smaller once it actually knows.
 */
export async function seedOnDeviceDefaults(): Promise<void> {
  try {
    // Returns the agent->model map directly, not a wrapper.
    const existing = await agentModelStore.getAllAgentModels();
    const alreadyConfigured = Object.keys(existing ?? {}).length > 0;
    if (alreadyConfigured) {
      logger.info('Agent models already configured; leaving the user’s choice alone.');
      return;
    }

    if (!(await llmProviderStore.hasProvider(ProviderTypeEnum.RunAnywhere))) {
      // No key, no endpoint — that is the whole point of this provider.
      await llmProviderStore.setProvider(
        ProviderTypeEnum.RunAnywhere,
        getDefaultProviderConfig(ProviderTypeEnum.RunAnywhere),
      );
      logger.info('Registered the on-device provider.');
    }

    const choice = chooseModel(null);
    const model = findModel(choice.model.id);
    if (!model) {
      logger.error(`Default model ${choice.model.id} is not in the catalog; leaving unconfigured.`);
      return;
    }

    // Both roles get the same model. Only one LLM can be resident at a time
    // (the SDK's lifecycle store is latest-load-wins per modality), so pointing
    // the Planner at something different would just evict the Navigator's model
    // on every planning turn.
    for (const agent of [AgentNameEnum.Navigator, AgentNameEnum.Planner]) {
      await agentModelStore.setAgentModel(agent, {
        provider: ProviderTypeEnum.RunAnywhere,
        modelName: model.id,
      });
    }

    logger.info(`On-device default ready: ${model.label} (${choice.rationale})`);
  } catch (error) {
    // A failure here must not break install — the user can still configure
    // manually, and the UI will offer to set things up.
    logger.error('Could not seed on-device defaults:', error);
  }
}
