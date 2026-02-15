(function() {
  if (window.__monochromeSourceUrlSettings) return;
  window.__monochromeSourceUrlSettings = true;

  var DEFAULT_URL = "__DEFAULT_URL__";
  var tapTimes = [];
  var TAP_COUNT = 3;
  var TAP_WINDOW = 600;
  var TAP_RADIUS = 40;
  var lastTapX = 0;
  var lastTapY = 0;

  function isAboutPage() {
    var path = (location.pathname || "").toLowerCase();
    var hash = (location.hash || "").toLowerCase();
    return path.indexOf("/about") !== -1 || hash.indexOf("about") !== -1;
  }

  window.addEventListener("touchend", function(e) {
    if (!isAboutPage()) return;
    if (e.changedTouches.length !== 1) return;
    var touch = e.changedTouches[0];
    var now = Date.now();

    if (tapTimes.length > 0) {
      var dx = touch.clientX - lastTapX;
      var dy = touch.clientY - lastTapY;
      if (Math.sqrt(dx * dx + dy * dy) > TAP_RADIUS) {
        tapTimes = [];
      }
    }

    lastTapX = touch.clientX;
    lastTapY = touch.clientY;
    tapTimes.push(now);

    tapTimes = tapTimes.filter(function(t) { return now - t < TAP_WINDOW; });

    if (tapTimes.length >= TAP_COUNT) {
      tapTimes = [];
      showSourceUrlModal();
    }
  }, { passive: true });

  function showSourceUrlModal() {
    if (document.getElementById("__src_url_modal")) return;

    var overlay = document.createElement("div");
    overlay.id = "__src_url_modal";
    overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:999999;\
background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;\
font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif";

    var box = document.createElement("div");
    box.style.cssText = "background:#1a1a1a;border-radius:12px;padding:24px;width:90%;max-width:400px;\
color:#eee;box-shadow:0 8px 32px rgba(0,0,0,0.5)";

    box.innerHTML = '\
<h2 style="margin:0 0 4px;font-size:18px">Source URL</h2>\
<p style="margin:0 0 16px;font-size:13px;color:#888">Change the Monochrome instance URL</p>\
<input id="__src_modal_input" type="url" \
style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #333;\
border-radius:6px;background:#222;color:#eee;font-size:14px;margin-bottom:12px;outline:none">\
<div style="display:flex;gap:8px">\
<button id="__src_modal_save" style="flex:1;padding:10px;border:none;border-radius:6px;\
background:#4a9eff;color:#fff;font-size:14px;cursor:pointer">Load</button>\
<button id="__src_modal_reset" style="flex:1;padding:10px;border:none;border-radius:6px;\
background:#333;color:#eee;font-size:14px;cursor:pointer">Reset</button>\
<button id="__src_modal_close" style="padding:10px 16px;border:none;border-radius:6px;\
background:#333;color:#eee;font-size:14px;cursor:pointer">Cancel</button>\
</div>\
<p id="__src_modal_err" style="color:#ff6b6b;margin:10px 0 0;font-size:13px;display:none"></p>';

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    var input = document.getElementById("__src_modal_input");
    var errEl = document.getElementById("__src_modal_err");

    window.__TAURI__.core.invoke("get_source_url").then(function(url) {
      input.value = url;
    });

    function showError(msg) {
      errEl.textContent = msg;
      errEl.style.display = "block";
    }

    function close() {
      var el = document.getElementById("__src_url_modal");
      if (el) el.remove();
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

    document.getElementById("__src_modal_save").addEventListener("click", function() {
      applyUrl(input.value.trim());
    });

    document.getElementById("__src_modal_reset").addEventListener("click", function() {
      applyUrl(DEFAULT_URL);
    });

    document.getElementById("__src_modal_close").addEventListener("click", close);

    overlay.addEventListener("click", function(e) {
      if (e.target === overlay) close();
    });
  }
})();
