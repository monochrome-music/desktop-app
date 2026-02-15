use crate::{get_source_url, open_external, set_source_url};
use tauri::{WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "ios")]
mod ios;

#[cfg(target_os = "android")]
mod android;

// ── Setup ──

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
    init_script.push_str(include_str!("../google-auth-init.js"));
    init_script.push('\n');
    init_script.push_str(include_str!("../ios-download-init.js"));
    init_script.push('\n');
    init_script.push_str(include_str!("../external-links.js"));
    init_script.push('\n');
    init_script.push_str(include_str!("../mobile-gestures.js"));
    init_script.push('\n');
    init_script.push_str(include_str!("../media-remote-init.js"));
    init_script.push('\n');
    let settings_script = include_str!("../source-url-settings.js")
        .replace("__DEFAULT_URL__", crate::DEFAULT_SOURCE_URL);
    init_script.push_str(&settings_script);
    init_script.push('\n');
    let fallback_script = include_str!("../url-error-fallback.js")
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
