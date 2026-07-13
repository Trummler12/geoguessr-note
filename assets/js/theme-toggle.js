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

  function explicitTheme() {
    const attr = root.getAttribute('data-theme');
    if (isTheme(attr)) return attr;

    const saved = safeGet(STORAGE_KEY);
    if (isTheme(saved)) return saved;

    return null;
  }

  function syncControls(theme) {
    const t = isTheme(theme) ? theme : systemTheme();
    if (icon) icon.src = t === 'dark' ? sun : moon;
    if (button) button.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
  }

  function applyExplicit(theme) {
    const t = isTheme(theme) ? theme : systemTheme();
    root.setAttribute('data-theme', t);
    syncControls(t);
  }

  function applySystem() {
    root.removeAttribute('data-theme'); // keep BookTheme='auto' (CSS) in control
    syncControls(systemTheme());
  }

  const explicit = explicitTheme();
  if (explicit) applyExplicit(explicit);
  else applySystem();

  if (button) {
    button.addEventListener('click', function () {
      const current = root.getAttribute('data-theme') || systemTheme();
      const next = current === 'dark' ? 'light' : 'dark';
      applyExplicit(next);
      safeSet(STORAGE_KEY, next); // persist only on explicit choice
    });
  }

  // If the user hasn't chosen explicitly, keep following system changes.
  const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  if (mq && !explicit) {
    const onChange = function () {
      if (!isTheme(safeGet(STORAGE_KEY))) applySystem();
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
