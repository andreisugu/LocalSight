// Pre-paint theme bootstrap.
//
// This file is served verbatim from `public/` (not bundled), so it can run as a classic,
// render-blocking script in <head> before React and the first paint. It only does one
// thing: put the dark class on <html> unless the operator explicitly chose light. A
// light-mode reload therefore never flashes the dark body, and the default stays dark.
//
// The storage rules (key, allowed values, default) live in
// `src/utils/themePreference.js`; this file mirrors the read because a module import would
// be deferred and paint would happen first. Anything other than the exact string 'light'
// is treated as dark, which is also what the provider does for an unknown value.
try {
  if (localStorage.getItem('localsight.theme') !== 'light') {
    document.documentElement.classList.add('dark');
  }
} catch {
  // Blocked storage (private mode, disabled cookies): keep the product default.
  document.documentElement.classList.add('dark');
}
