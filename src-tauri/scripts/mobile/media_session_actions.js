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

  var userAgent = navigator.userAgent || '';
  var isAndroid = /Android/i.test(userAgent);
  var isIOS = /iP(ad|hone|od)/i.test(userAgent) || (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1);
  var isNativeMobile = isAndroid || isIOS;

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
  var MEDIA_SESSION_PLUGIN = 'media-session';

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
  // Native mobile media session — delta-based state sync
  //
  // The plugin uses merge semantics: omitted fields keep their previous value.
  // We only send what actually changed to minimize payload size.
  // ---------------------------------------------------------------------------

  var sent = {
    title: null,
    artist: null,
    album: null,
    duration: null,
    position: null,
    playbackSpeed: null,
    isPlaying: null,
    canPrev: null,
    canNext: null,
    canSeek: null,
    artworkUrl: null,
  };

  var isUnloading = false;
  var nativeMediaActionUnlisten = null;
  var nativeMediaActionListenerPending = false;
  var detailsObserver = null;
  var queueObserver = null;
  var observeRetryTimer = null;
  var audioAttachPollTimer = null;
  var timelineTickTimer = null;
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

  function clearAudioAttachPollTimer() {
    if (!audioAttachPollTimer) return;
    window.clearInterval(audioAttachPollTimer);
    audioAttachPollTimer = null;
  }

  function clearTimelineTickTimer() {
    if (!timelineTickTimer) return;
    window.clearInterval(timelineTickTimer);
    timelineTickTimer = null;
  }

  function getPlaybackSpeed(audio) {
    if (!audio) return 1;
    var speed = Number.isFinite(audio.playbackRate) ? audio.playbackRate : 1;
    if (speed <= 0) return 1;
    return speed;
  }

  function sendTimelineToPlugin(payload) {
    if (isUnloading) return;
    waitForTauri().then(function (ready) {
      if (isUnloading) return;
      if (!ready) return;
      var core = getTauriCore();
      if (!core) return;
      core.invoke('plugin:' + MEDIA_SESSION_PLUGIN + '|update_timeline', payload).then(
        function () {},
        function (err) { console.warn('[MediaSession] update_timeline failed:', err); }
      );
    });
  }

  function startTimelineTickTimer() {
    if (timelineTickTimer) return;
    timelineTickTimer = window.setInterval(function () {
      if (isUnloading) return;
      var audio = getAudio();
      if (!audio || audio.paused || audio.ended) return;
      var pos = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      var duration = Number.isFinite(audio.duration) ? audio.duration : null;
      var playbackSpeed = getPlaybackSpeed(audio);
      sent.position = pos;
      sent.playbackSpeed = playbackSpeed;
      if (duration != null) sent.duration = duration;
      sendTimelineToPlugin({
        position: pos,
        duration: duration,
        playbackSpeed: playbackSpeed,
      });
    }, 1000);
  }

  function attachAudioListeners(audio) {
    if (!audio) return;
    if (audio.__mediaSessionBridgeAttached) return;
    audio.__mediaSessionBridgeAttached = true;

    addTrackedListener(audio, 'play', registerMediaSessionHandlers);
    addTrackedListener(audio, 'loadedmetadata', registerMediaSessionHandlers);
    addTrackedListener(audio, 'play', sendPlaybackState);
    addTrackedListener(audio, 'pause', sendPlaybackState);
    addTrackedListener(audio, 'ended', sendPlaybackState);
    addTrackedListener(audio, 'loadedmetadata', sendDuration);
    addTrackedListener(audio, 'durationchange', sendDuration);
    addTrackedListener(audio, 'seeked', sendSeekPosition);

    if (isNativeMobile) {
      sendDuration();
      sendPlaybackState();
      sendSeekPosition();
    }
  }

  function startAudioAttachPoll() {
    if (audioAttachPollTimer) return;
    audioAttachPollTimer = window.setInterval(function () {
      if (isUnloading) return;
      attachAudioListeners(getAudio());
    }, 1000);
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
      core.invoke('plugin:' + MEDIA_SESSION_PLUGIN + '|update_state', payload).then(
        function () {},
        function (err) { console.warn('[MediaSession] update_state failed:', err); }
      );
    });
  }

  function sendTrackInfo() {
    if (!isNativeMobile) return;
    if (isUnloading) return;
    var audio = getAudio();
    var title = readText('.track-info .details .title') || readText('#fullscreen-track-title');
    var artist = readText('.track-info .details .artist') || readText('#fullscreen-track-artist');
    var album = readText('.track-info .details .album');
    var duration = audio && Number.isFinite(audio.duration) ? audio.duration : null;
    var playbackSpeed = getPlaybackSpeed(audio);
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
      sent.position = 0;
      sent.isPlaying = null;
      changed = true;
    }

    var isPlaying = audio ? (!audio.paused && !audio.ended) : false;
    if (isPlaying !== sent.isPlaying) {
      payload.isPlaying = isPlaying;
      sent.isPlaying = isPlaying;
      changed = true;
    }

    if (playbackSpeed !== sent.playbackSpeed) {
      payload.playbackSpeed = playbackSpeed;
      sent.playbackSpeed = playbackSpeed;
      changed = true;
    }

    if (!trackChanged && audio) {
      var pos = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      if (sent.position == null || Math.abs(pos - sent.position) >= 0.5) {
        payload.position = pos;
        sent.position = pos;
        changed = true;
      }
    }

    if (sent.canSeek !== true) {
      payload.canSeek = true;
      sent.canSeek = true;
      changed = true;
    }

    if (isPlaying) {
      startTimelineTickTimer();
    } else {
      clearTimelineTickTimer();
    }

    if (changed) sendToPlugin(payload);
  }

  function sendPlaybackState() {
    if (!isNativeMobile) return;
    if (isUnloading) return;
    var audio = getAudio();
    if (!audio) return;
    var isPlaying = !audio.paused && !audio.ended;
    var playbackSpeed = getPlaybackSpeed(audio);
    var stateChanged = isPlaying !== sent.isPlaying;
    var speedChanged = playbackSpeed !== sent.playbackSpeed;
    if (!stateChanged && !speedChanged) return;

    sent.isPlaying = isPlaying;
    sent.playbackSpeed = playbackSpeed;
    var pos = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    sent.position = pos;

    if (isPlaying) {
      startTimelineTickTimer();
    } else {
      clearTimelineTickTimer();
    }

    sendToPlugin({ isPlaying: isPlaying, position: pos, playbackSpeed: playbackSpeed });
  }

  function sendSeekPosition() {
    if (!isNativeMobile) return;
    if (isUnloading) return;
    var audio = getAudio();
    if (!audio) return;
    var pos = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    var playbackSpeed = getPlaybackSpeed(audio);
    sent.position = pos;
    sent.playbackSpeed = playbackSpeed;
    sendToPlugin({ position: pos, playbackSpeed: playbackSpeed });
  }

  function sendDuration() {
    if (!isNativeMobile) return;
    if (isUnloading) return;
    var audio = getAudio();
    if (!audio) return;
    var duration = Number.isFinite(audio.duration) ? audio.duration : null;
    if (duration === sent.duration) return;
    sent.duration = duration;
    sendToPlugin({ duration: duration });
  }

  function sendCanNext() {
    if (!isNativeMobile) return;
    if (isUnloading) return;
    var canNext = true;
    var queueList = document.getElementById('queue-list');
    if (queueList) {
      var playing = queueList.querySelector('.queue-track-item.playing');
      if (playing) canNext = !!playing.nextElementSibling;
    }
    var shouldSendCanPrev = sent.canPrev !== true;
    if (canNext === sent.canNext && !shouldSendCanPrev) return;
    sent.canPrev = true;
    sent.canNext = canNext;
    // canPrev always true (restart current track or go to previous — standard UX)
    sendToPlugin({ canPrev: true, canNext: canNext });
  }

  // ---------------------------------------------------------------------------
  // Native media action listener
  // ---------------------------------------------------------------------------

  function cleanupNativeMediaActionListener() {
    if (typeof nativeMediaActionUnlisten !== 'function') return;
    try {
      nativeMediaActionUnlisten();
    } catch (_) {}
    nativeMediaActionUnlisten = null;
  }

  function listenNativeMediaActions() {
    if (!isNativeMobile) return;
    if (isUnloading) return;
    if (nativeMediaActionUnlisten || nativeMediaActionListenerPending) return;
    waitForTauri().then(function (ready) {
      if (isUnloading) return;
      if (!ready) return;
      var core = getTauriCore();
      if (!core || typeof core.addPluginListener !== 'function') return;
      nativeMediaActionListenerPending = true;
      var listener = core.addPluginListener(MEDIA_SESSION_PLUGIN, 'media_action', function (event) {
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
              nativeMediaActionUnlisten = unlisten;
            }
            nativeMediaActionListenerPending = false;
          },
          function (err) {
            nativeMediaActionListenerPending = false;
            console.warn('[MediaSession] addPluginListener failed:', err);
          }
        );
      } else {
        if (typeof listener === 'function') {
          nativeMediaActionUnlisten = listener;
        }
        nativeMediaActionListenerPending = false;
      }
    });
  }

  function clearNativeMediaSession() {
    if (!isNativeMobile) return;
    waitForTauri().then(function (ready) {
      if (!ready) return;
      var core = getTauriCore();
      if (!core) return;
      core.invoke('plugin:' + MEDIA_SESSION_PLUGIN + '|clear').then(
        function () {},
        function (err) { console.warn('[MediaSession] clear failed:', err); }
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Attach everything
  // ---------------------------------------------------------------------------

  var observingDetails = false;
  var observingQueue = false;

  function observeDOM() {
    if (isUnloading) return;
    attachAudioListeners(getAudio());

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
    attachAudioListeners(audio);
    startAudioAttachPoll();

    if (isNativeMobile) {
      sendTrackInfo();
      sendCanNext();
      listenNativeMediaActions();
      if (audio && !audio.paused && !audio.ended) sendPlaybackState();
    }

    // Keep observing for W3C Media Session re-registration and metadata changes
    observeDOM();
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
    clearAudioAttachPollTimer();
    clearTimelineTickTimer();
    clearTrackedListeners();
    disconnectObservers();
    cleanupNativeMediaActionListener();
    clearNativeMediaSession();
  }

  window.addEventListener('beforeunload', startShutdownCleanup);
  window.addEventListener('unload', startShutdownCleanup);
})();
