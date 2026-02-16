(function () {
  if (window.__monochromeAndroidAudioWorkaround) return;
  window.__monochromeAndroidAudioWorkaround = true;

  var ua = (navigator.userAgent || '').toLowerCase();
  if (ua.indexOf('android') === -1) return;

  var MODE_KEY = 'android-audio-mode';
  var LEGACY_KEY = 'android-audio-workaround';
  var MODE_PASSTHROUGH = 'passthrough';
  var MODE_FULL = 'full';
  var MODE_AUTO = 'auto';

  function normalizeMode(value) {
    if (value === MODE_FULL || value === MODE_AUTO || value === MODE_PASSTHROUGH) {
      return value;
    }
    return MODE_AUTO;
  }

  function getConfiguredMode() {
    try {
      var mode = localStorage.getItem(MODE_KEY);
      if (mode) return normalizeMode(mode);

      var legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy === 'off') return MODE_FULL;
      if (legacy === 'on') return MODE_PASSTHROUGH;
    } catch (_) {}
    return MODE_AUTO;
  }

  function dspRequested() {
    try {
      return localStorage.getItem('equalizer-enabled') === 'true'
        || localStorage.getItem('mono-audio-enabled') === 'true';
    } catch (_) {
      return false;
    }
  }

  function resolveEffectiveMode(configuredMode) {
    if (configuredMode !== MODE_AUTO) return configuredMode;
    return dspRequested() ? MODE_FULL : MODE_PASSTHROUGH;
  }

  function setCtor(key, value) {
    if (window[key] === value) return true;
    try {
      Object.defineProperty(window, key, {
        value: value,
        configurable: true,
        writable: true,
      });
      return true;
    } catch (_) {
      try {
        window[key] = value;
        return window[key] === value;
      } catch (__e) {
        return window[key] === value;
      }
    }
  }

  function rememberOriginalCtor(key) {
    var backupKey = '__original' + key;
    if (window[backupKey]) return true;
    if (typeof window[key] === 'undefined') return false;
    window[backupKey] = window[key];
    return true;
  }

  function getCtorCreateMediaElementSourceBackupKey(key) {
    return '__original' + key + 'CreateMediaElementSource';
  }

  function createBypassSourceNode(context, mediaElement) {
    return {
      context: context,
      mediaElement: mediaElement,
      numberOfInputs: 0,
      numberOfOutputs: 1,
      channelCount: 2,
      channelCountMode: 'max',
      channelInterpretation: 'speakers',
      connect: function (target) {
        return target || this;
      },
      disconnect: function () {},
      addEventListener: function () {},
      removeEventListener: function () {},
      dispatchEvent: function () {
        return false;
      },
    };
  }

  function patchCtorForPassthrough(key) {
    try {
      if (!rememberOriginalCtor(key)) return false;

      var ctor = window['__original' + key];
      if (!ctor || !ctor.prototype) return false;

      var backupKey = getCtorCreateMediaElementSourceBackupKey(key);
      if (!window[backupKey]) {
        var originalCreateMediaElementSource = ctor.prototype.createMediaElementSource;
        if (typeof originalCreateMediaElementSource !== 'function') return false;
        window[backupKey] = originalCreateMediaElementSource;
      }

      ctor.prototype.createMediaElementSource = function (mediaElement) {
        return createBypassSourceNode(this, mediaElement);
      };

      return setCtor(key, ctor);
    } catch (err) {
      console.warn('[AndroidAudioWorkaround] Failed to patch ' + key + ' for passthrough:', err);
      return false;
    }
  }

  function restoreCtorForFullMode(key) {
    try {
      if (!rememberOriginalCtor(key)) return false;

      var ctor = window['__original' + key];
      if (!ctor || !ctor.prototype) return false;

      var backupKey = getCtorCreateMediaElementSourceBackupKey(key);
      if (typeof window[backupKey] === 'function') {
        ctor.prototype.createMediaElementSource = window[backupKey];
      }

      return setCtor(key, ctor);
    } catch (err) {
      console.warn('[AndroidAudioWorkaround] Failed to restore ' + key + ' for full mode:', err);
      return false;
    }
  }

  function applyMode(mode) {
    if (mode === MODE_PASSTHROUGH) {
      var patched = [];
      if (patchCtorForPassthrough('AudioContext')) patched.push('AudioContext');
      if (patchCtorForPassthrough('webkitAudioContext')) patched.push('webkitAudioContext');

      if (patched.length > 0) {
        console.log('[AndroidAudioWorkaround] Passthrough mode active (WebAudio graph bypass):', patched.join(', '));
      } else {
        console.log('[AndroidAudioWorkaround] Passthrough mode requested, but no WebAudio constructor found to patch.');
      }
      return;
    }

    var restored = [];
    if (restoreCtorForFullMode('AudioContext')) restored.push('AudioContext');
    if (restoreCtorForFullMode('webkitAudioContext')) restored.push('webkitAudioContext');
    if (restored.length > 0) {
      console.log('[AndroidAudioWorkaround] Full mode active (WebAudio restored):', restored.join(', '));
    } else {
      console.log('[AndroidAudioWorkaround] Full mode active (nothing to restore).');
    }
  }

  var configuredMode = getConfiguredMode();
  var effectiveMode = resolveEffectiveMode(configuredMode);
  applyMode(effectiveMode);

  window.__monochromeAndroidAudio = {
    getMode: function () {
      return configuredMode;
    },
    getEffectiveMode: function () {
      return effectiveMode;
    },
    setMode: function (nextMode) {
      var normalized = normalizeMode(nextMode);
      try {
        localStorage.setItem(MODE_KEY, normalized);
        localStorage.removeItem(LEGACY_KEY);
      } catch (_) {}
      configuredMode = normalized;
      effectiveMode = resolveEffectiveMode(configuredMode);
      console.log('[AndroidAudioWorkaround] Saved mode:', normalized, '(restart or reload app to apply)');
    },
  };

  if (effectiveMode === MODE_PASSTHROUGH && dspRequested()) {
    console.log('[AndroidAudioWorkaround] EQ/Mono is enabled in settings. Switch to full mode for DSP features.');
  }

  console.log('[AndroidAudioWorkaround] Mode:', configuredMode, '=>', effectiveMode);
  console.log('[AndroidAudioWorkaround] Use localStorage key "android-audio-mode" = passthrough | full | auto');
})();
