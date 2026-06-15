/* ── Component Registry ── */
// Manages component lifecycle. Exposes getTokens() for the tweak panel.
// Dispatches 'component-switched' events so the tweak panel can follow page changes.
window._componentRegistry = (function() {
  var components = {};
  var current = null;

  function register(name, component) {
    if (!component || typeof component.mount !== 'function') {
      console.warn('Component "' + name + '" missing mount()');
      return;
    }
    components[name] = component;

    // If component has tokens, merge into _pageTokens registry
    if (component.tokens && component.tokens.tokens && window._pageTokens && window._pageTokens[name]) {
      var compTokens = component.tokens.tokens;
      if (Array.isArray(compTokens) && compTokens.length) {
        // Merge: component tokens.json takes priority, fall back to page-tokens defaults
        var existing = window._pageTokens[name].tokens || [];
        var existingKeys = {};
        existing.forEach(function(t) { existingKeys[t.key] = true; });
        compTokens.forEach(function(t) {
          if (!existingKeys[t.key]) {
            existing.push(t);
          }
        });
        window._pageTokens[name].tokens = existing;
      }
    }
  }

  function switchTo(name) {
    var next = components[name];
    if (!next) { console.warn('Component not found:', name); return; }

    if (current && current !== next) {
      if (typeof current.hide === 'function') current.hide();
    }

    if (typeof next.show === 'function') next.show();
    current = next;

    window.dispatchEvent(new CustomEvent('component-switched', { detail: { name: name } }));
  }

  function getCurrent() { return current; }
  function getCurrentName() {
    for (var k in components) { if (components[k] === current) return k; }
    return null;
  }
  function getAll() { return components; }

  // Return component token definitions in normalized array form
  function getTokens(name) {
    var comp = components[name];
    if (!comp || !comp.tokens) return [];
    var raw = comp.tokens;
    if (raw.tokens && Array.isArray(raw.tokens)) return raw.tokens;
    return [];
  }

  return {
    register: register,
    switchTo: switchTo,
    getCurrent: getCurrent,
    getCurrentName: getCurrentName,
    getAll: getAll,
    getTokens: getTokens
  };
})();
