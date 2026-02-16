(function () {
  if (window.__mediaRemoteInit) return;
  window.__mediaRemoteInit = true;

  // ---------------------------------------------------------------------------
  // Track controls
  //
  // The host web app uses Shift+ArrowRight / Shift+ArrowLeft for next / prev.
  // We synthesise those keyboard events so the app responds exactly as if the
  // user pressed the keys.
  // ---------------------------------------------------------------------------

  var isAndroid = /Android/i.test(navigator.userAgent || '');

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

  function togglePlayPause() {
    dispatchKey(' ', 'Space', 32);
  }

  function getAudio() {
    return document.getElementById('audio-player');
  }

  function playMedia() {
    var audio = getAudio();
    if (audio) {
      audio.play();
      return;
    }
    togglePlayPause();
  }

  function pauseMedia() {
    var audio = getAudio();
    if (audio) {
      audio.pause();
      return;
    }
    togglePlayPause();
  }

  // ---------------------------------------------------------------------------
  // W3C Media Session (iOS WKWebView lock screen controls)
  //
  // Handlers must be (re-)registered every time audio starts playing because
  // WKWebView may reset them when the media session changes, and the host web
  // app may also overwrite them when it updates its own metadata.
  // ---------------------------------------------------------------------------

  function registerMediaSessionHandlers() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler('play', playMedia);
      navigator.mediaSession.setActionHandler('pause', pauseMedia);
      navigator.mediaSession.setActionHandler('nexttrack', nextTrack);
      navigator.mediaSession.setActionHandler('previoustrack', prevTrack);
    } catch (e) {}
  }

  registerMediaSessionHandlers();

  // ---------------------------------------------------------------------------
  // Tauri IPC helpers
  // ---------------------------------------------------------------------------

  var tauriReadyPromise = null;
  var ANDROID_PLUGIN = 'media-session';

  function getTauriCore() {
    var tauri = window.__TAURI__;
    if (!tauri || !tauri.core || typeof tauri.core.invoke !== 'function') return null;
    return tauri.core;
  }

  function waitForTauri() {
    if (tauriReadyPromise) return tauriReadyPromise;
    if (getTauriCore()) {
      tauriReadyPromise = Promise.resolve(true);
      return tauriReadyPromise;
    }
    tauriReadyPromise = new Promise(function (resolve) {
      var attempts = 0;
      var check = function () {
        if (getTauriCore()) { resolve(true); return; }
        if (++attempts > 200) { resolve(false); return; }
        window.setTimeout(check, 50);
      };
      check();
    });
    return tauriReadyPromise;
  }

  function readText(selector) {
    var el = document.querySelector(selector);
    if (!el) return '';
    return (el.textContent || '').trim();
  }

  // ---------------------------------------------------------------------------
  // Android media session — delta-based state sync
  //
  // The plugin uses merge semantics: omitted fields keep their previous value.
  // We only send what actually changed to minimize payload size.
  // ---------------------------------------------------------------------------

  var sent = {
    title: null,
    artist: null,
    album: null,
    duration: null,
    isPlaying: null,
    canNext: null,
  };
  var lastArtworkSrc = null;
  var lastArtworkBase64 = null;
  var artworkSentToPlugin = false;

  function encodeArtwork() {
    var img = document.querySelector('.now-playing-bar img.cover');
    if (!img || !img.naturalWidth || !img.complete) return;
    if (img.src === lastArtworkSrc) return;

    // Try canvas encoding (works for same-origin images)
    try {
      var size = Math.min(img.naturalWidth, 512);
      var canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      canvas.getContext('2d').drawImage(img, 0, 0, size, size);
      var dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      lastArtworkSrc = img.src;
      lastArtworkBase64 = dataUrl.split(',')[1] || null;
      artworkSentToPlugin = false;
      return;
    } catch (e) {
      console.warn('[MediaSession] canvas encode failed (CORS?), trying fetch:', e.message);
    }

    // Fallback: fetch as blob → base64 (works when server sends CORS headers)
    var src = img.src;
    fetch(src)
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.blob(); })
      .then(function (blob) {
        return new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onloadend = function () { resolve(reader.result); };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      })
      .then(function (dataUrl) {
        lastArtworkSrc = src;
        lastArtworkBase64 = dataUrl.split(',')[1] || null;
        artworkSentToPlugin = false;
        sendTrackInfo();
      })
      .catch(function (e) {
        console.warn('[MediaSession] artwork fetch fallback failed:', e.message || e);
        lastArtworkBase64 = null;
      });
  }

  function sendToPlugin(payload) {
    waitForTauri().then(function (ready) {
      if (!ready) return;
      var core = getTauriCore();
      if (!core) return;
      var logFields = {};
      for (var k in payload) {
        if (k === 'artwork') {
          logFields.artwork = '(' + Math.round(payload.artwork.length / 1024) + 'KB)';
        } else {
          logFields[k] = payload[k];
        }
      }
      console.log('[MediaSession] \u2192', JSON.stringify(logFields));
      core.invoke('plugin:' + ANDROID_PLUGIN + '|update_state', payload).then(
        function () {},
        function (err) { console.warn('[MediaSession] update_state failed:', err); }
      );
    });
  }

  function sendTrackInfo() {
    if (!isAndroid) return;
    var audio = getAudio();
    var title = readText('.track-info .details .title') || readText('#fullscreen-track-title');
    var artist = readText('.track-info .details .artist') || readText('#fullscreen-track-artist');
    var album = readText('.track-info .details .album');
    var duration = audio && Number.isFinite(audio.duration) ? audio.duration : null;

    encodeArtwork();

    var payload = {};
    var changed = false;
    var trackChanged = title !== sent.title;

    if (title !== sent.title) { payload.title = title || null; sent.title = title; changed = true; }
    if (artist !== sent.artist) { payload.artist = artist || null; sent.artist = artist; changed = true; }
    if (album !== sent.album) { payload.album = album || null; sent.album = album; changed = true; }
    if (duration !== sent.duration) { payload.duration = duration; sent.duration = duration; changed = true; }

    if (!artworkSentToPlugin && lastArtworkBase64) {
      payload.artwork = lastArtworkBase64;
      artworkSentToPlugin = true;
      changed = true;
    }

    // On track change: reset position to 0 and force isPlaying re-send
    // (sendPlaybackState skips when isPlaying hasn't changed, e.g. playing → playing)
    if (trackChanged) {
      payload.position = 0;
      sent.isPlaying = null;
    }

    var isPlaying = audio ? (!audio.paused && !audio.ended) : false;
    if (isPlaying !== sent.isPlaying) { payload.isPlaying = isPlaying; sent.isPlaying = isPlaying; }
    if (!trackChanged && audio) { payload.position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0; }

    if (changed) sendToPlugin(payload);
  }

  function sendPlaybackState() {
    if (!isAndroid) return;
    var audio = getAudio();
    if (!audio) return;
    var isPlaying = !audio.paused && !audio.ended;
    if (isPlaying === sent.isPlaying) return;
    sent.isPlaying = isPlaying;
    var pos = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    sendToPlugin({ isPlaying: isPlaying, position: pos });
  }

  function sendSeekPosition() {
    if (!isAndroid) return;
    var audio = getAudio();
    if (!audio) return;
    var pos = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    sendToPlugin({ position: pos });
  }

  function sendDuration() {
    if (!isAndroid) return;
    var audio = getAudio();
    if (!audio) return;
    var duration = Number.isFinite(audio.duration) ? audio.duration : null;
    if (duration === sent.duration) return;
    sent.duration = duration;
    sendToPlugin({ duration: duration });
  }

  function sendCanNext() {
    if (!isAndroid) return;
    var canNext = true;
    var queueList = document.getElementById('queue-list');
    if (queueList) {
      var playing = queueList.querySelector('.queue-track-item.playing');
      if (playing) canNext = !!playing.nextElementSibling;
    }
    if (canNext === sent.canNext) return;
    sent.canNext = canNext;
    // canPrev always true (restart current track or go to previous — standard UX)
    sendToPlugin({ canPrev: true, canNext: canNext });
  }

  // ---------------------------------------------------------------------------
  // Android media action listener
  // ---------------------------------------------------------------------------

  function listenAndroidMediaActions() {
    if (!isAndroid) return;
    waitForTauri().then(function (ready) {
      if (!ready) return;
      var core = getTauriCore();
      if (!core || typeof core.addPluginListener !== 'function') return;
      core.addPluginListener(ANDROID_PLUGIN, 'media_action', function (event) {
        var action = event && event.action;
        if (!action) return;
        console.log('[MediaSession] \u2190', action + (event.seekPosition != null ? ' @ ' + event.seekPosition + 's' : ''));
        if (action === 'play') { playMedia(); return; }
        if (action === 'pause' || action === 'stop') { pauseMedia(); return; }
        if (action === 'next') { nextTrack(); return; }
        if (action === 'previous') { prevTrack(); return; }
        if (action === 'seek') {
          var audio = getAudio();
          if (audio && event.seekPosition != null) audio.currentTime = event.seekPosition;
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Attach everything
  // ---------------------------------------------------------------------------

  var observingDetails = false;
  var observingQueue = false;

  function observeDOM() {
    if (!observingDetails) {
      var details = document.querySelector('.now-playing-bar .track-info .details');
      if (details) {
        observingDetails = true;
        new MutationObserver(function () {
          registerMediaSessionHandlers();
          sendTrackInfo();
        }).observe(details, { childList: true, subtree: true, characterData: true });
      }
    }

    if (!observingQueue) {
      var queueList = document.getElementById('queue-list');
      if (queueList) {
        observingQueue = true;
        new MutationObserver(function () { sendCanNext(); }).observe(queueList, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class'],
        });
      }
    }

    // Retry until both observers are attached
    if (!observingDetails || !observingQueue) {
      window.setTimeout(observeDOM, 1000);
    }
  }

  function attach() {
    var audio = getAudio();
    if (audio) {
      audio.addEventListener('play', registerMediaSessionHandlers);
      audio.addEventListener('loadedmetadata', registerMediaSessionHandlers);
      audio.addEventListener('play', sendPlaybackState);
      audio.addEventListener('pause', sendPlaybackState);
      audio.addEventListener('ended', sendPlaybackState);
      audio.addEventListener('loadedmetadata', sendDuration);
      audio.addEventListener('durationchange', sendDuration);
      audio.addEventListener('seeked', sendSeekPosition);
    }

    if (isAndroid) {
      sendTrackInfo();
      sendCanNext();
      observeDOM();
      listenAndroidMediaActions();
      if (audio && !audio.paused && !audio.ended) sendPlaybackState();
    } else {
      // Non-Android: still observe for W3C Media Session re-registration
      observeDOM();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }
})();
