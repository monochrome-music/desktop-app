use crate::{get_source_url, open_external, set_source_url};
use tauri::{WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "ios")]
mod ios;

#[cfg(target_os = "android")]
mod android;

// ── Setup ──

#[cfg(target_os = "android")]
pub fn configure(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.invoke_handler(tauri::generate_handler![
        open_external,
        get_source_url,
        set_source_url,
        crate::android_download::android_download_begin,
        crate::android_download::android_download_write,
        crate::android_download::android_download_finish
    ])
}

#[cfg(not(target_os = "android"))]
pub fn configure(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.invoke_handler(tauri::generate_handler![
        open_external,
        get_source_url,
        set_source_url
    ])
}

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let source_url = crate::load_source_url(app.handle());
    let mut init_script = String::new();
    init_script.push_str(include_str!("../tauri-defineproperty-guard.js"));
    init_script.push('\n');
    init_script.push_str(include_str!("../scripts/mobile/google_auth_init.js"));
    init_script.push('\n');
    #[cfg(target_os = "android")]
    {
        init_script.push_str(include_str!("../android-audio-workaround.js"));
        init_script.push('\n');
        init_script.push_str(include_str!("../android-audio-mode-settings.js"));
        init_script.push('\n');
        init_script.push_str(include_str!("../scripts/android/download_init.js"));
        init_script.push('\n');
    }
    #[cfg(target_os = "ios")]
    {
        init_script.push_str(include_str!("../scripts/ios/download_init.js"));
        init_script.push('\n');
    }
    init_script.push_str(include_str!("../scripts/mobile/download_init.js"));
    init_script.push('\n');
    init_script.push_str(include_str!("../scripts/mobile/external_links.js"));
    init_script.push('\n');
    init_script.push_str(include_str!("../scripts/mobile/gestures.js"));
    init_script.push('\n');
    #[cfg(target_os = "android")]
    {
        init_script.push_str(include_str!("../scripts/android/safe_area_insets.js"));
        init_script.push('\n');
    }
    init_script.push_str(include_str!("../scripts/mobile/media_remote_init.js"));
    init_script.push('\n');
    let settings_script = include_str!("../scripts/mobile/source_url_settings.js")
        .replace("__DEFAULT_URL__", crate::DEFAULT_SOURCE_URL);
    init_script.push_str(&settings_script);
    init_script.push('\n');
    let fallback_script = include_str!("../scripts/mobile/url_error_fallback.js")
        .replace("__EXPECTED_URL__", &source_url)
        .replace("__DEFAULT_URL__", crate::DEFAULT_SOURCE_URL);
    init_script.push_str(&fallback_script);

    let _window = WebviewWindowBuilder::new(
        app,
        "main",
        WebviewUrl::External(source_url.parse().unwrap()),
    )
    .initialization_script(init_script)
    .build()?;

    #[cfg(target_os = "ios")]
    ios::setup(app)?;

    #[cfg(target_os = "android")]
    android::setup(app)?;

    Ok(())
}
