use std::fs;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

pub const DEFAULT_SOURCE_URL: &str = "https://monochrome.samidy.com";

pub fn load_source_url(handle: &AppHandle) -> String {
    if let Ok(config_dir) = handle.path().app_config_dir() {
        let config_file = config_dir.join("source_url.txt");
        if config_file.exists() {
            if let Ok(content) = fs::read_to_string(config_file) {
                let trimmed = content.trim().to_string();
                if !trimmed.is_empty() {
                    return trimmed;
                }
            }
        }
    }
    DEFAULT_SOURCE_URL.to_string()
}

pub fn save_source_url(handle: &AppHandle, url: &str) {
    if let Ok(config_dir) = handle.path().app_config_dir() {
        if !config_dir.exists() {
            let _ = fs::create_dir_all(&config_dir);
        }
        let config_file = config_dir.join("source_url.txt");
        let _ = fs::write(config_file, url.as_bytes());
    }
}

#[tauri::command]
fn get_source_url(app: AppHandle) -> String {
    load_source_url(&app)
}

#[tauri::command]
fn set_source_url(app: AppHandle, url: String) -> Result<String, String> {
    let url = url.trim().to_string();
    if !url.starts_with("https://") {
        return Err("Only HTTPS URLs are allowed".into());
    }
    let parsed = url::Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;
    let url = parsed.to_string();
    save_source_url(&app, &url);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.navigate(parsed);
    }
    Ok(url)
}

#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    let url = url.trim();
    if !(url.starts_with("http://")
        || url.starts_with("https://")
        || url.starts_with("mailto:")
        || url.starts_with("tel:"))
    {
        return Err("unsupported url scheme".into());
    }

    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(desktop)]
mod desktop;

#[cfg(mobile)]
mod mobile;

#[cfg(target_os = "android")]
mod android_download;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_media_toolkit::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_google_auth::init());

    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_safe_area_insets::init());

    #[cfg(desktop)]
    let builder = desktop::configure(builder);

    #[cfg(mobile)]
    let builder = mobile::configure(builder);

    builder
        .setup(|app| {
            #[cfg(desktop)]
            desktop::setup(app)?;

            #[cfg(mobile)]
            mobile::setup(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
