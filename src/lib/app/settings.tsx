// The settings, read once per window and kept current: a save in one window
// reaches the other through the `settings-changed` event Rust emits.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { onSettingsChanged } from './events';
import { getSettings, saveSettings, type Settings } from './native';
import { applyTheme } from './theme';

type Ctx = {
  settings: Settings | null;
  save: (next: Settings) => Promise<Settings>;
};

const SettingsContext = createContext<Ctx>({
  settings: null,
  save: async (s) => s,
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    const use = (s: Settings) => {
      setSettings(s);
      applyTheme(s.theme, s.eyeComfort);
    };
    getSettings().then(use).catch(() => {});
    return onSettingsChanged(use);
  }, []);

  const save = async (next: Settings) => {
    const saved = await saveSettings(next);
    setSettings(saved);
    applyTheme(saved.theme, saved.eyeComfort);
    return saved;
  };

  return <SettingsContext.Provider value={{ settings, save }}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  return useContext(SettingsContext);
}
