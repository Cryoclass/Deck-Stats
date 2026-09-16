// Bascule de thème (docs/design-backoffice.md §2, T11) : préférence dans localStorage, `data-theme`
// sur <html>, système par défaut. Chargé dans <head> avant le rendu pour éviter tout éclair ; fichier
// séparé parce que la CSP interdit tout script inline. Sans stockage, la préférence vaut pour la page.
(function () {
  var KEY = 'th_theme';
  var current = null;
  try { current = localStorage.getItem(KEY); } catch (e) { current = null; }
  if (current !== 'light' && current !== 'dark') current = null;
  function apply() {
    if (current) document.documentElement.setAttribute('data-theme', current);
    else document.documentElement.removeAttribute('data-theme');
  }
  apply();
  document.addEventListener('DOMContentLoaded', function () {
    var button = document.getElementById('theme-toggle');
    if (!button) return;
    function label() {
      button.textContent = 'Thème : ' + (current === 'light' ? 'clair' : current === 'dark' ? 'sombre' : 'système');
      button.setAttribute('data-theme-state', current || 'system');
    }
    label();
    button.addEventListener('click', function () {
      current = current === null ? 'light' : current === 'light' ? 'dark' : null;
      try { if (current) localStorage.setItem(KEY, current); else localStorage.removeItem(KEY); } catch (e) { /* stockage indisponible : la préférence vaut pour la page */ }
      apply();
      label();
    });
  });
})();
