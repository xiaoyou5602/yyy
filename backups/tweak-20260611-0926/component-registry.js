/* ── Component Registry ── */
// 统一管理所有页面组件的生命周期
// 每个组件在自己的 root 内操作 DOM，不跨组件查询

window._componentRegistry = (function() {
  var components = {};
  var current = null;

  function register(name, component) {
    if (!component || typeof component.mount !== 'function') {
      console.warn('Component "' + name + '" missing mount()');
      return;
    }
    components[name] = component;

    // 如果组件声明了 tokens，注册到调参台
    if (component.tokens && window._tweakTokens) {
      window._tweakTokens[name] = component.tokens;
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
  }

  function getCurrent() { return current; }
  function getCurrentName() {
    for (var k in components) { if (components[k] === current) return k; }
    return null;
  }
  function getAll() { return components; }

  return { register: register, switchTo: switchTo, getCurrent: getCurrent, getCurrentName: getCurrentName, getAll: getAll };
})();
