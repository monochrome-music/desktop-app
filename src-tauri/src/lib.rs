use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
    State,
    WebviewUrl,
    WebviewWindowBuilder,
};
use tauri_plugin_updater::UpdaterExt;

mod discord;

use discord::{
    clear_activity,
    update_song,
    DiscordState,
};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn discord_update_song(
    title: String,
    artist: String,
    artwork: String,
    position: f64,
    duration: f64,
    playing: bool,
    state: State<DiscordState>,
) {
    update_song(
        &state,
        title,
        artist,
        artwork,
        position,
        duration,
        playing,
    );
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())

        .manage(DiscordState::new())

        .invoke_handler(tauri::generate_handler![
            greet,
            discord_update_song
        ])

        .setup(|app| {
            let app_handle = app.handle().clone();

            #[cfg(not(debug_assertions))]
            tauri::async_runtime::spawn(async move {
                if let Ok(updater) = app_handle.updater() {
                    if let Ok(Some(update)) = updater.check().await {
                        println!("Update found: {}", update.version);

                        if update
                            .download_and_install(|_, _| {}, || {})
                            .await
                            .is_ok()
                        {
                            println!("Update installed. Restarting...");
                            app_handle.restart();
                        }
                    }
                }
            });

            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("Monochrome Desktop")
            .inner_size(800.0, 600.0)
            .on_new_window(move |url, features| {
                let label = format!(
                    "popup-{}",
                    std::time::SystemTime::now()
                        .duration_since(
                            std::time::UNIX_EPOCH
                        )
                        .unwrap()
                        .as_nanos()
                );

                let window = WebviewWindowBuilder::new(
                    &app_handle,
                    label,
                    WebviewUrl::External(url),
                )
                .title("Monochrome Account Linker")
                .window_features(features)
                .build()
                .unwrap();

                tauri::webview::NewWindowResponse::Create {
                    window,
                }
            })
            .build()?;


            let toggle_rpc = MenuItem::with_id(
                app,
                "toggle_rpc",
                "Disable Discord RPC",
                true,
                None::<&str>,
            )?;

            let quit = MenuItem::with_id(
                app,
                "quit",
                "Quit",
                true,
                None::<&str>,
            )?;

            let menu = Menu::with_items(
                app,
                &[
                    &toggle_rpc,
                    &quit,
                ],
            )?;

            let toggle_rpc_clone = toggle_rpc.clone();

            TrayIconBuilder::new()
                .icon(
                    app.default_window_icon()
                        .unwrap()
                        .clone()
                )
                .menu(&menu)
                .on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "toggle_rpc" => {
                            let state =
                                app.state::<DiscordState>();

                            let mut enabled =
                                state.enabled
                                    .lock()
                                    .unwrap();

                            *enabled = !*enabled;

                            if *enabled {
                                toggle_rpc_clone
                                    .set_text(
                                        "Disable Discord RPC"
                                    )
                                    .unwrap();

                                println!(
                                    "discord RPC enabled"
                                );
                            } else {
                                toggle_rpc_clone
                                    .set_text(
                                        "Enable Discord RPC"
                                    )
                                    .unwrap();

                                clear_activity(&state);

                                println!(
                                    "discord RPC disabled"
                                );
                            }
                        }

                        "quit" => {
                            app.exit(0);
                        }

                        _ => {}
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
