use tauri::{WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "ios")]
mod ios;

#[cfg(target_os = "android")]
mod android;

// ── Setup ──

pub fn configure(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
}

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let mut init_script = String::new();
    init_script.push_str(include_str!("../google-auth-init.js"));
    init_script.push('\n');
    init_script.push_str(include_str!("../mobile-gestures.js"));

    let _window = WebviewWindowBuilder::new(
        app,
        "main",
        WebviewUrl::External("https://monochrome.samidy.com".parse().unwrap()),
    )
    .initialization_script(init_script)
    .build()?;

    println!("[DEBUG] mobile webview built");

    #[cfg(target_os = "ios")]
    ios::setup(app)?;

    #[cfg(target_os = "android")]
    android::setup(app)?;

    Ok(())
}
