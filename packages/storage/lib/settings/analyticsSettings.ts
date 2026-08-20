import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

// Interface for analytics settings configuration
export interface AnalyticsSettingsConfig {
  enabled: boolean;
  anonymousUserId: string;
}

export type AnalyticsSettingsStorage = BaseStorage<AnalyticsSettingsConfig> & {
  updateSettings: (settings: Partial<AnalyticsSettingsConfig>) => Promise<void>;
  getSettings: () => Promise<AnalyticsSettingsConfig>;
  resetToDefaults: () => Promise<void>;
  generateAnonymousUserId: () => string;
};

// Generate a random anonymous user ID
function generateAnonymousUserId(): string {
  return 'anon_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Default settings - enabled by default as per requirements
export const DEFAULT_ANALYTICS_SETTINGS: AnalyticsSettingsConfig = {
  enabled: true,
  anonymousUserId: '',
};

const storage = createStorage<AnalyticsSettingsConfig>('analytics-settings', DEFAULT_ANALYTICS_SETTINGS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const analyticsSettingsStore: AnalyticsSettingsStorage = {
  ...storage,
  async updateSettings(settings: Partial<AnalyticsSettingsConfig>) {
    const currentSettings = (await storage.get()) || DEFAULT_ANALYTICS_SETTINGS;
    const updatedSettings = {
      ...currentSettings,
      ...settings,
    };

    await storage.set(updatedSettings);
  },
  async getSettings() {
    const settings = await storage.get();

    // If no anonymousUserId exists, generate one
    if (!settings?.anonymousUserId) {
      const newSettings = {
        ...DEFAULT_ANALYTICS_SETTINGS,
        ...settings,
        anonymousUserId: generateAnonymousUserId(),
      };
      await storage.set(newSettings);
      return newSettings;
    }

    return {
      ...DEFAULT_ANALYTICS_SETTINGS,
      ...settings,
    };
  },
  async resetToDefaults() {
    // Keep the same user ID when resetting to defaults
    const currentSettings = await storage.get();
    const resetSettings = {
      ...DEFAULT_ANALYTICS_SETTINGS,
      anonymousUserId: currentSettings?.anonymousUserId || generateAnonymousUserId(),
    };
    await storage.set(resetSettings);
  },
  generateAnonymousUserId,
};
