(function () {
  if (window.__monochromeRemoteMediaInit) return;
  window.__monochromeRemoteMediaInit = true;

  // ---------------------------------------------------------------------------
  // Track controls
  //
  // The host web app uses Shift+ArrowRight / Shift+ArrowLeft for next / prev.
  // We synthesise those keyboard events so the app responds exactly as if the
  // user pressed the keys.
  // ---------------------------------------------------------------------------

  function dispatchKey(key, code, keyCode, mods) {
    var opts = {
      key: key,
      code: code,
      keyCode: keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true,
      shiftKey: !!(mods && mods.shiftKey),
    };
    var target = document.activeElement || document.body || document;
    target.dispatchEvent(new KeyboardEvent('keydown', opts));
    target.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  function nextTrack() {
    dispatchKey('ArrowRight', 'ArrowRight', 39, { shiftKey: true });
  }

  function prevTrack() {
    dispatchKey('ArrowLeft', 'ArrowLeft', 37, { shiftKey: true });
  }

  // ---------------------------------------------------------------------------
  // Media Session  (the ONLY way to control lock screen buttons in WKWebView)
  //
  // WKWebView runs audio in a separate process and takes exclusive control of
  // MPRemoteCommandCenter.  The W3C Media Session API set from JavaScript is
  // the only mechanism WKWebView honours for lock screen buttons.
  //
  // Handlers must be (re-)registered every time audio starts playing because
  // WKWebView may reset them when the media session changes, and the host web
  // app may also overwrite them when it updates its own metadata.
  // ---------------------------------------------------------------------------

  function registerMediaSessionHandlers() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler('nexttrack', nextTrack);
      navigator.mediaSession.setActionHandler('previoustrack', prevTrack);
    } catch (e) {}
  }

  // Register once eagerly, then re-register on every playback start.
  registerMediaSessionHandlers();

  // ---------------------------------------------------------------------------
  // Attach observers
  // ---------------------------------------------------------------------------

  function attach() {
    var audio = document.getElementById('audio-player');
    if (audio) {
      audio.addEventListener('play', registerMediaSessionHandlers);
      audio.addEventListener('loadedmetadata', registerMediaSessionHandlers);
    }

    // Re-register after the web app updates track metadata in the DOM.
    var details = document.querySelector('.now-playing-bar .track-info .details');
    if (details) {
      new MutationObserver(registerMediaSessionHandlers).observe(details, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }
})();
