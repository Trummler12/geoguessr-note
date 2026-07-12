(function () {
  const STORAGE_KEY = 'theme';
  // Fallback theme used only when the visitor's system expresses *no* colour preference.
  // Safe to change to 'light'.
  const DEFAULT_THEME = 'dark';

  const sun = '{{ "svg/sun.svg" | relURL }}';
  const moon = '{{ "svg/moon.svg" | relURL }}';
  const root = document.documentElement;
  const button = document.getElementById('theme-toggle');
  const icon = document.getElementById('theme-toggle-icon');

  // System preference, with DEFAULT_THEME as the last resort for 'no-preference'.
  function systemTheme() {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
    return DEFAULT_THEME;
  }

  // Priority: attribute already set (pre-paint) > saved choice > system > default.
  function isTheme(t) {
    return t === 'dark' || t === 'light';
  }

  function safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {}
  }

  function resolve() {
    const attr = root.getAttribute('data-theme');
    if (isTheme(attr)) return attr;

    const saved = safeGet(STORAGE_KEY);
    if (isTheme(saved)) return saved;

    return systemTheme();
  }

  function render(theme) {
    const t = isTheme(theme) ? theme : systemTheme();
    root.setAttribute('data-theme', t);
    if (icon) icon.src = t === 'dark' ? sun : moon;
  }

  // Reflect the effective theme (e.g. keep the icon in sync) without persisting it,
  // so "follow the system" survives until the user actively chooses.
  render(resolve());

  if (button) {
    button.addEventListener('click', function () {
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      render(next);
      safeSet(STORAGE_KEY, next); // persist only on explicit choice
    });
  }
})();
