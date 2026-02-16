(function () {
  if (window.__monochromeAndroidAudioModeSettings) return;
  window.__monochromeAndroidAudioModeSettings = true;

  var ua = (navigator.userAgent || '').toLowerCase();
  if (ua.indexOf('android') === -1) return;

  var MODE_KEY = 'android-audio-mode';
  var LEGACY_KEY = 'android-audio-workaround';
  var MODE_AUTO = 'auto';
  var MODE_PASSTHROUGH = 'passthrough';
  var MODE_FULL = 'full';

  function normalizeMode(value) {
    if (value === MODE_AUTO || value === MODE_PASSTHROUGH || value === MODE_FULL) {
      return value;
    }
    return MODE_AUTO;
  }

  function getMode() {
    try {
      var mode = localStorage.getItem(MODE_KEY);
      if (mode) return normalizeMode(mode);

      var legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy === 'off') return MODE_FULL;
      if (legacy === 'on') return MODE_PASSTHROUGH;

      return MODE_AUTO;
    } catch (_) {
      return MODE_AUTO;
    }
  }

  function setMode(mode) {
    try {
      localStorage.setItem(MODE_KEY, normalizeMode(mode));
      localStorage.removeItem(LEGACY_KEY);
      return true;
    } catch (_) {
      return false;
    }
  }

  function getAnchorItem() {
    var mono = document.getElementById('mono-audio-toggle');
    if (!mono || !mono.closest) return null;
    return mono.closest('.setting-item');
  }

  function updateSelectValue() {
    var select = document.getElementById('android-audio-mode-setting');
    if (!select) return;
    var mode = getMode();
    if (select.value !== mode) select.value = mode;
  }

  function onModeChange(event) {
    var mode = normalizeMode(event && event.target ? event.target.value : MODE_AUTO);
    if (!setMode(mode)) {
      var statusError = document.getElementById('android-audio-mode-status');
      if (statusError) {
        statusError.textContent = 'Failed to save mode.';
      }
      return;
    }

    if (window.__monochromeAndroidAudio && typeof window.__monochromeAndroidAudio.setMode === 'function') {
      window.__monochromeAndroidAudio.setMode(mode);
    }

    try {
      window.alert('This change will be applied on the next app restart.');
    } catch (_) {}

    var status = document.getElementById('android-audio-mode-status');
    if (status) {
      status.textContent = 'Saved. Reload app to apply.';
      window.setTimeout(function () {
        if (status.textContent === 'Saved. Reload app to apply.') {
          status.textContent = '';
        }
      }, 3000);
    }
  }

  function createSettingItem() {
    var item = document.createElement('div');
    item.className = 'setting-item';
    item.id = 'android-audio-mode-item';

    var info = document.createElement('div');
    info.className = 'info';

    var label = document.createElement('span');
    label.className = 'label';
    label.textContent = 'Android Audio Mode';

    var description = document.createElement('span');
    description.className = 'description';
    description.textContent = 'Auto uses passthrough for best sound and switches to full mode when EQ/Mono is enabled.';

    var status = document.createElement('span');
    status.className = 'description';
    status.id = 'android-audio-mode-status';
    status.style.opacity = '0.75';

    info.appendChild(label);
    info.appendChild(description);
    info.appendChild(status);

    var controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.alignItems = 'center';
    controls.style.gap = '8px';

    var select = document.createElement('select');
    select.id = 'android-audio-mode-setting';
    select.innerHTML = '' +
      '<option value="auto">Auto</option>' +
      '<option value="passthrough">Passthrough (Best sound)</option>' +
      '<option value="full">Full (All DSP features)</option>';
    select.value = getMode();
    select.addEventListener('change', onModeChange);

    controls.appendChild(select);
    item.appendChild(info);
    item.appendChild(controls);

    return item;
  }

  function ensureSettingItem() {
    var existing = document.getElementById('android-audio-mode-item');
    if (existing) {
      updateSelectValue();
      return true;
    }

    var anchor = getAnchorItem();
    if (!anchor || !anchor.parentNode) return false;

    var item = createSettingItem();
    if (anchor.nextSibling) {
      anchor.parentNode.insertBefore(item, anchor.nextSibling);
    } else {
      anchor.parentNode.appendChild(item);
    }
    return true;
  }

  function startObserver() {
    var root = document.body || document.documentElement;
    if (!root) return;
    var observer = new MutationObserver(function () {
      ensureSettingItem();
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  function init() {
    ensureSettingItem();
    startObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
