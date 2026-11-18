// The settings, read once per window and kept current: a save in one window
// reaches the other through the `settings-changed` event Rust emits.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { onSettingsChanged } from './events';
import { getSettings, saveSettings, setStudyPref, type Settings, type StudyPrefs } from './native';
import { applyTheme } from './theme';

type Ctx = {
  settings: Settings | null;
  save: (next: Settings) => Promise<Settings>;
  /** A study screen's choice: shown at once, kept by Rust. */
  setPref: <K extends keyof StudyPrefs>(key: K, value: StudyPrefs[K]) => void;
};

const SettingsContext = createContext<Ctx>({
  settings: null,
  save: async (s) => s,
  setPref: () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    const use = (s: Settings) => {
      setSettings(s);
      applyTheme(s.theme, s.eyeComfort, s.motion);
    };
    getSettings().then(use).catch(() => {});
    return onSettingsChanged(use);
  }, []);

  const save = async (next: Settings) => {
    const saved = await saveSettings(next);
    setSettings(saved);
    applyTheme(saved.theme, saved.eyeComfort, saved.motion);
    return saved;
  };

  const setPref = useCallback(<K extends keyof StudyPrefs>(key: K, value: StudyPrefs[K]) => {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
    setStudyPref(key, value)
      .then(setSettings)
      .catch(() => {
        /* not remembered, still applied */
      });
  }, []);

  return <SettingsContext.Provider value={{ settings, save, setPref }}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  return useContext(SettingsContext);
}
