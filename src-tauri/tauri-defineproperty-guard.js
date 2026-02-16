(function () {
  if (window.__monochromeDefinePropertyGuard) return;
  window.__monochromeDefinePropertyGuard = true;

  var originalDefineProperty = Object.defineProperty;
  var guardedKeys = {
    postMessage: true,
    metadata: true,
    __TAURI_PATTERN__: true,
    path: true,
    __TAURI_EVENT_PLUGIN_INTERNALS__: true,
  };

  Object.defineProperty = function (target, prop, descriptor) {
    try {
      return originalDefineProperty(target, prop, descriptor);
    } catch (err) {
      var key = String(prop);
      if (!guardedKeys[key]) throw err;

      try {
        var existing = Object.getOwnPropertyDescriptor(target, prop);
        if (existing && existing.configurable === false) {
          return target;
        }
      } catch (_) {}

      throw err;
    }
  };
})();
