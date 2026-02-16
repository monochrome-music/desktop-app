(function() {
  var EXPECTED_URL = "__EXPECTED_URL__";
  var DEFAULT_URL = "__DEFAULT_URL__";
  var TIMEOUT_MS = 6000;
  var APP_SELECTORS = ".sidebar, .player-container, #app, .app";
  var LOGIN_SELECTORS = ".login-container";

  function isMonochromePage() {
    if (document.querySelector(APP_SELECTORS)) return true;
    if (document.querySelector(LOGIN_SELECTORS)) return true;
    if (document.title && document.title.indexOf("Monochrome") === 0) return true;
    return false;
  }

  function checkManifest(callback) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", "/manifest.json", true);
      xhr.timeout = 4000;
      xhr.onload = function() {
        if (xhr.status === 200) {
          try {
            var data = JSON.parse(xhr.responseText);
            callback(data.name === "Monochrome Music");
          } catch(e) {
            callback(false);
          }
        } else {
          callback(false);
        }
      };
      xhr.onerror = function() { callback(false); };
      xhr.ontimeout = function() { callback(false); };
      xhr.send();
    } catch(e) {
      callback(false);
    }
  }

  function validate(onFail) {
    if (isMonochromePage()) return;

    checkManifest(function(isMonochrome) {
      if (isMonochrome) return;
      onFail();
    });
  }

  function showErrorPage() {
    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    var attemptedUrl = (window.location && window.location.href) || EXPECTED_URL;
    if (attemptedUrl === "about:blank" || attemptedUrl === "about:blank#blocked") {
      attemptedUrl = EXPECTED_URL;
    }

    var attemptedLabel = escapeHtml(attemptedUrl);
    var expectedValue = escapeHtml(EXPECTED_URL);

    document.documentElement.innerHTML = '\
<head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"></head>\
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;\
background:#111;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;touch-action:manipulation">\
<div style="text-align:center;max-width:480px;padding:24px">\
<div style="font-size:48px;margin-bottom:16px">&#9888;</div>\
<h1 style="font-size:20px;margin:0 0 8px">Connection Failed</h1>\
<p style="color:#999;margin:0 0 24px;font-size:14px">Could not connect to<br>\
<strong style="color:#ccc">' + attemptedLabel + '</strong></p>\
<input id="__src_url_input" type="url" value="' + expectedValue + '" \
style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #333;\
border-radius:6px;background:#222;color:#eee;font-size:14px;margin-bottom:12px;outline:none">\
<div style="display:flex;gap:8px;justify-content:center">\
<button id="__src_url_load" style="padding:10px 20px;border:none;border-radius:6px;\
background:#4a9eff;color:#fff;font-size:14px;cursor:pointer">Load</button>\
<button id="__src_url_reset" style="padding:10px 20px;border:none;border-radius:6px;\
background:#333;color:#eee;font-size:14px;cursor:pointer">Reset to Default</button>\
</div>\
<p id="__src_url_err" style="color:#ff6b6b;margin:12px 0 0;font-size:13px;display:none"></p>\
</div></body>';

    var input = document.getElementById("__src_url_input");
    var errEl = document.getElementById("__src_url_err");

    function showError(msg) {
      errEl.textContent = msg;
      errEl.style.display = "block";
    }

    function applyUrl(url) {
      errEl.style.display = "none";
      if (!url || !url.startsWith("https://")) {
        showError("Only HTTPS URLs are allowed.");
        return;
      }
      window.__TAURI__.core.invoke("set_source_url", { url: url }).catch(function(e) {
        showError(String(e));
      });
    }

    document.getElementById("__src_url_load").addEventListener("click", function() {
      applyUrl(input.value.trim());
    });

    document.getElementById("__src_url_reset").addEventListener("click", function() {
      input.value = DEFAULT_URL;
      applyUrl(DEFAULT_URL);
    });

    input.addEventListener("keydown", function(e) {
      if (e.key === "Enter") applyUrl(input.value.trim());
    });
  }

  // Layer 1: Check at DOMContentLoaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function() {
      validate(function() {
        // Layer 2: Final timeout check
        setTimeout(function() {
          validate(showErrorPage);
        }, TIMEOUT_MS);
      });
    });
  } else {
    validate(function() {
      setTimeout(function() {
        validate(showErrorPage);
      }, TIMEOUT_MS);
    });
  }
})();
