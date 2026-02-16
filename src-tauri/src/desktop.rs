use crate::{get_source_url, open_external, set_source_url};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

struct DiscordState {
    client: Mutex<Option<DiscordIpcClient>>,
    last_song: Mutex<Option<String>>,
}

struct DownloadState {
    path: Mutex<Option<PathBuf>>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn save_download_path(app: &AppHandle, path: &PathBuf) {
    if let Ok(config_dir) = app.path().app_config_dir() {
        if !config_dir.exists() {
            let _ = fs::create_dir_all(&config_dir);
        }
        let config_file = config_dir.join("download_path.txt");
        let _ = fs::write(config_file, path.to_string_lossy().as_bytes());
    }
}

fn load_download_path(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(config_dir) = app.path().app_config_dir() {
        let config_file = config_dir.join("download_path.txt");
        if config_file.exists() {
            if let Ok(content) = fs::read_to_string(config_file) {
                return Some(PathBuf::from(content.trim()));
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn update_discord_presence(
    app: AppHandle,
    state: tauri::State<DiscordState>,
    details: String,
    status: String,
    image: String,
    is_paused: bool,
    current_sec: f64,
) -> Result<(), String> {
    let mut client_guard = state.client.lock().map_err(|_| "Failed to lock mutex")?;
    let client = client_guard
        .as_mut()
        .ok_or("Discord client not initialized")?;

    let details = if details.len() < 2 {
        format!("{}  ", details)
    } else {
        details
    };
    let mut status = if status.len() < 2 {
        format!("{}  ", status)
    } else {
        status
    };

    if is_paused {
        status = format!("{} (Paused)", status);
    }

    let mut activity = json!({
        "type": 2,
        "details": details,
        "state": status,
        "assets": {
            "large_image": image,
            "large_text": "Music On Monochrome"
        },
        "buttons": [
            { "label": "Listen On Monochrome", "url": crate::load_source_url(&app) }
        ]
    });

    if !is_paused {
        let now = SystemTime::now();
        let song_start = now - Duration::from_secs_f64(current_sec);
        let start_timestamp = song_start.duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
        activity["timestamps"] = json!({ "start": start_timestamp });

        let mut last_song_guard = state.last_song.lock().unwrap();
        let current_song_key = format!("{} - {}", details, status);

        if last_song_guard.as_deref() != Some(&current_song_key) {
            *last_song_guard = Some(current_song_key);

            let window = app.get_webview_window("main");
            if let Some(win) = window {
                if !win.is_focused().unwrap_or(false) {
                    let _ = app
                        .notification()
                        .builder()
                        .title("Now Playing")
                        .body(format!("{}\n{}", details, status))
                        .show();
                }
            }
        }
    }

    let payload = json!({
        "cmd": "SET_ACTIVITY",
        "args": {
            "pid": std::process::id(),
            "activity": activity
        },
        "nonce": format!("{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis())
    });

    if let Err(e) = client.send(payload.clone(), 1) {
        let _ = client.close();
        if client.connect().is_ok() {
            client.send(payload, 1).map_err(|e| e.to_string())?;
        } else {
            return Err(format!("Failed to connect to Discord: {}", e));
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Builder configuration (plugins, state, commands)
// ---------------------------------------------------------------------------

pub fn configure(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    let client_id = "1462186088184549661";
    let mut client = DiscordIpcClient::new(client_id).ok();
    if let Some(c) = &mut client {
        let _ = c.connect();
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(
            |app: &AppHandle, _args, _cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            },
        ))
        .manage(DiscordState {
            client: Mutex::new(client),
            last_song: Mutex::new(None),
        })
        .manage(DownloadState {
            path: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            update_discord_presence,
            open_external,
            get_source_url,
            set_source_url
        ])
}

// ---------------------------------------------------------------------------
// App setup (window, tray, shortcuts)
// ---------------------------------------------------------------------------

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    if let Ok(config_dir) = app.path().app_config_dir() {
        if !config_dir.exists() {
            let _ = fs::create_dir_all(&config_dir);
        }
    }

    let state = app.state::<DownloadState>();
    *state.path.lock().unwrap() = load_download_path(app.handle());

    // System tray
    let quit = MenuItemBuilder::with_id("quit", "Quit Monochrome").build(app)?;
    let show = MenuItemBuilder::with_id("show", "Show Player").build(app)?;
    let change_dl = MenuItemBuilder::with_id("change_dl", "Set Download Folder").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&show)
        .item(&change_dl)
        .separator()
        .item(&quit)
        .build()?;

    let icon = Image::from_bytes(include_bytes!("../icons/icon.png")).expect("Failed to load icon");
    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quit" => std::process::exit(0),
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "change_dl" => {
                let app_handle = app.clone();
                app.dialog().file().pick_folder(move |folder| {
                    if let Some(path) = folder {
                        let path = path.into_path().unwrap();
                        let state = app_handle.state::<DownloadState>();
                        *state.path.lock().unwrap() = Some(path.clone());
                        save_download_path(&app_handle, &path);
                    }
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button,
                button_state,
                ..
            } = event
            {
                if button == MouseButton::Left && button_state == MouseButtonState::Up {
                    let app = tray.app_handle();
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    // Global media key shortcut
    let _ = app
        .global_shortcut()
        .on_shortcut("MediaPlayPause", |app, _shortcut, event| {
            if event.state == ShortcutState::Released {
                let _ = app.emit("media-toggle", ());
            }
        });

    // Main window
    let app_handle = app.handle().clone();
    let source_url = crate::load_source_url(app.handle());
    let mut init_script = String::new();
    init_script.push_str(include_str!(
        "../scripts/desktop/discord_presence_bridge.js"
    ));
    init_script.push('\n');
    init_script.push_str(include_str!("../scripts/mobile/external_link_router.js"));
    init_script.push('\n');
    let fallback_script = include_str!("../scripts/mobile/source_url_fallback.js")
        .replace("__EXPECTED_URL__", &source_url)
        .replace("__DEFAULT_URL__", crate::DEFAULT_SOURCE_URL);
    init_script.push_str(&fallback_script);
    let window = WebviewWindowBuilder::new(
        app,
        "main",
        WebviewUrl::External(source_url.parse().unwrap()),
    )
    .title("Monochrome")
    .inner_size(1200.0, 800.0)
    .initialization_script(&init_script)
    .on_download(move |_webview, event| {
        if let tauri::webview::DownloadEvent::Requested { destination, .. } = event {
            let state = app_handle.state::<DownloadState>();
            let path_guard = state.path.lock().unwrap();
            if let Some(path) = &*path_guard {
                if let Some(name) = destination.file_name() {
                    *destination = path.join(name);
                }
            }
        }
        true
    })
    .build()?;

    let _ = window.show();

    let window_clone = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            let _ = window_clone.hide();
            api.prevent_close();
        }
    });

    Ok(())
}
