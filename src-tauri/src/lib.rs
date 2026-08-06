use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
    State,
};

mod discord;

use discord::{
    clear_activity,
    update_song,
    DiscordState,
};

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
        .plugin(
            tauri_plugin_opener::init()
        )
        .manage(
            DiscordState::new()
        )
        .setup(|app| {
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
                            let state = app.state::<DiscordState>();

                            let mut enabled =
                                state.enabled.lock().unwrap();

                            *enabled = !*enabled;

                            if *enabled {
                                toggle_rpc_clone
                                    .set_text("Disable Discord RPC")
                                    .unwrap();

                                println!("discord RPC enabled");
                            } else {
                                toggle_rpc_clone
                                    .set_text("Enable Discord RPC")
                                    .unwrap();

                                clear_activity(&state);

                                println!("discord RPC disabled");
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
        .invoke_handler(
            tauri::generate_handler![
                discord_update_song
            ]
        )
        .run(
            tauri::generate_context!()
        )
        .expect(
            "error while running tauri application"
        );
}