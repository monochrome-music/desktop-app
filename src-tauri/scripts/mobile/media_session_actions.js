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

  function clickControlButton(id) {
    var btn = document.getElementById(id);
    if (!btn) return false;
    try {
      btn.click();
      return true;
    } catch (_) {
      return false;
    }
  }

  function nextTrack() {
    if (clickControlButton('next-btn')) return;
    dispatchKey('ArrowRight', 'ArrowRight', 39, { shiftKey: true });
  }

  function prevTrack() {
    if (clickControlButton('prev-btn')) return;
    dispatchKey('ArrowLeft', 'ArrowLeft', 37, { shiftKey: true });
  }

  function togglePlayPause() {
    if (clickControlButton('fs-play-pause-btn')) return;
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
  // Media Session
  //
  // Mobile webviews may reset action handlers as playback state changes.
  // We register eagerly and re-register whenever playback or metadata changes.
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
    artworkUrl: null,
  };

  var isUnloading = false;
  var androidMediaActionUnlisten = null;
  var androidMediaActionListenerPending = false;
  var detailsObserver = null;
  var queueObserver = null;
  var observeRetryTimer = null;
  var trackedListeners = [];

  function addTrackedListener(target, type, handler, options) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, handler, options);
    trackedListeners.push(function () {
      try {
        target.removeEventListener(type, handler, options);
      } catch (_) {}
    });
  }

  function clearTrackedListeners() {
    if (!trackedListeners.length) return;
    for (var i = 0; i < trackedListeners.length; i += 1) {
      try {
        trackedListeners[i]();
      } catch (_) {}
    }
    trackedListeners = [];
  }

  function clearObserveRetryTimer() {
    if (!observeRetryTimer) return;
    window.clearTimeout(observeRetryTimer);
    observeRetryTimer = null;
  }

  function disconnectObservers() {
    if (detailsObserver) {
      try {
        detailsObserver.disconnect();
      } catch (_) {}
      detailsObserver = null;
    }
    if (queueObserver) {
      try {
        queueObserver.disconnect();
      } catch (_) {}
      queueObserver = null;
    }
  }

  function sendToPlugin(payload) {
    if (isUnloading) return;
    waitForTauri().then(function (ready) {
      if (isUnloading) return;
      if (!ready) return;
      var core = getTauriCore();
      if (!core) return;
      var logFields = {};
      for (var k in payload) { logFields[k] = payload[k]; }
      console.log('[MediaSession] \u2192', JSON.stringify(logFields));
      core.invoke('plugin:' + ANDROID_PLUGIN + '|update_state', payload).then(
        function () {},
        function (err) { console.warn('[MediaSession] update_state failed:', err); }
      );
    });
  }

  function sendTrackInfo() {
    if (!isAndroid) return;
    if (isUnloading) return;
    var audio = getAudio();
    var title = readText('.track-info .details .title') || readText('#fullscreen-track-title');
    var artist = readText('.track-info .details .artist') || readText('#fullscreen-track-artist');
    var album = readText('.track-info .details .album');
    var duration = audio && Number.isFinite(audio.duration) ? audio.duration : null;
    var img = document.querySelector('.now-playing-bar img.cover');
    var artworkUrl = img && img.src ? img.src : null;

    var payload = {};
    var changed = false;
    var trackChanged = title !== sent.title;

    if (title !== sent.title) { payload.title = title || null; sent.title = title; changed = true; }
    if (artist !== sent.artist) { payload.artist = artist || null; sent.artist = artist; changed = true; }
    if (album !== sent.album) { payload.album = album || null; sent.album = album; changed = true; }
    if (duration !== sent.duration) { payload.duration = duration; sent.duration = duration; changed = true; }

    // Send artwork URL — the plugin downloads natively (no CORS)
    if (artworkUrl !== sent.artworkUrl) {
      payload.artworkUrl = artworkUrl || '';
      sent.artworkUrl = artworkUrl;
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
    if (isUnloading) return;
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
    if (isUnloading) return;
    var audio = getAudio();
    if (!audio) return;
    var pos = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    sendToPlugin({ position: pos });
  }

  function sendDuration() {
    if (!isAndroid) return;
    if (isUnloading) return;
    var audio = getAudio();
    if (!audio) return;
    var duration = Number.isFinite(audio.duration) ? audio.duration : null;
    if (duration === sent.duration) return;
    sent.duration = duration;
    sendToPlugin({ duration: duration });
  }

  function sendCanNext() {
    if (!isAndroid) return;
    if (isUnloading) return;
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

  function cleanupAndroidMediaActionListener() {
    if (typeof androidMediaActionUnlisten !== 'function') return;
    try {
      androidMediaActionUnlisten();
    } catch (_) {}
    androidMediaActionUnlisten = null;
  }

  function listenAndroidMediaActions() {
    if (!isAndroid) return;
    if (isUnloading) return;
    if (androidMediaActionUnlisten || androidMediaActionListenerPending) return;
    waitForTauri().then(function (ready) {
      if (isUnloading) return;
      if (!ready) return;
      var core = getTauriCore();
      if (!core || typeof core.addPluginListener !== 'function') return;
      androidMediaActionListenerPending = true;
      var listener = core.addPluginListener(ANDROID_PLUGIN, 'media_action', function (event) {
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

      if (listener && typeof listener.then === 'function') {
        listener.then(
          function (unlisten) {
            if (typeof unlisten === 'function') {
              androidMediaActionUnlisten = unlisten;
            }
            androidMediaActionListenerPending = false;
          },
          function (err) {
            androidMediaActionListenerPending = false;
            console.warn('[MediaSession] addPluginListener failed:', err);
          }
        );
      } else {
        if (typeof listener === 'function') {
          androidMediaActionUnlisten = listener;
        }
        androidMediaActionListenerPending = false;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Attach everything
  // ---------------------------------------------------------------------------

  var observingDetails = false;
  var observingQueue = false;

  function observeDOM() {
    if (isUnloading) return;
    if (!observingDetails) {
      var details = document.querySelector('.now-playing-bar .track-info .details');
      if (details) {
        observingDetails = true;
        detailsObserver = new MutationObserver(function () {
          if (isUnloading) return;
          registerMediaSessionHandlers();
          sendTrackInfo();
        });
        detailsObserver.observe(details, { childList: true, subtree: true, characterData: true });
      }
    }

    if (!observingQueue) {
      var queueList = document.getElementById('queue-list');
      if (queueList) {
        observingQueue = true;
        queueObserver = new MutationObserver(function () {
          if (isUnloading) return;
          sendCanNext();
        });
        queueObserver.observe(queueList, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class'],
        });
      }
    }

    // Retry until both observers are attached
    if (!observingDetails || !observingQueue) {
      clearObserveRetryTimer();
      observeRetryTimer = window.setTimeout(observeDOM, 1000);
    }
  }

  function attach() {
    if (isUnloading) return;
    var audio = getAudio();
    if (audio) {
      addTrackedListener(audio, 'play', registerMediaSessionHandlers);
      addTrackedListener(audio, 'loadedmetadata', registerMediaSessionHandlers);
      addTrackedListener(audio, 'play', sendPlaybackState);
      addTrackedListener(audio, 'pause', sendPlaybackState);
      addTrackedListener(audio, 'ended', sendPlaybackState);
      addTrackedListener(audio, 'loadedmetadata', sendDuration);
      addTrackedListener(audio, 'durationchange', sendDuration);
      addTrackedListener(audio, 'seeked', sendSeekPosition);
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

  function startShutdownCleanup() {
    if (isUnloading) return;
    isUnloading = true;
    clearObserveRetryTimer();
    clearTrackedListeners();
    disconnectObservers();
    cleanupAndroidMediaActionListener();
  }

  window.addEventListener('beforeunload', startShutdownCleanup);
  window.addEventListener('unload', startShutdownCleanup);
})();
