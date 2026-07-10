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
  function resolve() {
    return root.getAttribute('data-theme') || localStorage.getItem(STORAGE_KEY) || systemTheme();
  }

  function render(theme) {
    root.setAttribute('data-theme', theme);
    if (icon) icon.src = theme === 'dark' ? sun : moon;
  }

  // Reflect the effective theme (e.g. keep the icon in sync) without persisting it,
  // so "follow the system" survives until the user actively chooses.
  render(resolve());

  if (button) {
    button.addEventListener('click', function () {
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      render(next);
      localStorage.setItem(STORAGE_KEY, next); // persist only on explicit choice
    });
  }
})();
