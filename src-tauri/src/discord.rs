use byteorder::{LittleEndian, ReadBytesExt, WriteBytesExt};
use serde_json::{json, Value};

use std::{
    io::{Read, Write},
    sync::Mutex,
};

#[cfg(target_os = "windows")]
use std::fs::OpenOptions;

#[cfg(not(target_os = "windows"))]
use std::os::unix::net::UnixStream;

const CLIENT_ID: &str = "1534975256723456110";

pub struct DiscordState {
    pub client: Mutex<Option<DiscordIPC>>,
    pub enabled: Mutex<bool>,
}

#[cfg(target_os = "windows")]
type DiscordStream = std::fs::File;

#[cfg(not(target_os = "windows"))]
type DiscordStream = std::os::unix::net::UnixStream;

pub struct DiscordIPC {
    pipe: DiscordStream,
}

impl DiscordState {
    pub fn new() -> Self {
        let client = DiscordIPC::connect().ok();

        if client.is_some() {
            println!("discord RPC connected");
        } else {
            println!("discord RPC unavailable");
        }

        Self {
            client: Mutex::new(client),
            enabled: Mutex::new(true),
        }
    }
}

impl DiscordIPC {
    fn connect() -> Result<Self, Box<dyn std::error::Error>> {
        for i in 0..10 {
            #[cfg(target_os = "windows")]
            let pipe = {
                let path = format!(
                    r"\\.\pipe\discord-ipc-{}",
                    i
                );

                OpenOptions::new()
                    .read(true)
                    .write(true)
                    .open(path)
            };

            #[cfg(not(target_os = "windows"))]
            let pipe = {
                let path = if cfg!(target_os = "macos") {
                    format!(
                        "{}/Library/Application Support/discord/ipc-{}",
                        std::env::var("HOME")?,
                        i
                    )
                } else {
                    format!(
                        "/tmp/discord-ipc-{}",
                        i
                    )
                };

                UnixStream::connect(path)
            };

            if let Ok(mut pipe) = pipe {
                let handshake = json!({
                    "v": 1,
                    "client_id": CLIENT_ID
                });

                write_frame(
                    &mut pipe,
                    0,
                    handshake.to_string().as_bytes(),
                )?;

                read_frame(&mut pipe)?;

                return Ok(Self {
                    pipe,
                });
            }
        }

        Err("discord pipe not found".into())
    }

    pub fn update(
        &mut self,
        title: String,
        artist: String,
        artwork: String,
        position: f64,
        duration: f64,
        playing: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let now = chrono::Utc::now().timestamp();

        let mut activity = json!({
            "type": 2,

            "details": title,

            "state": artist,

            "assets": {
                "large_image": artwork,
                "small_image": "monochrome",
                "small_text": "Monochrome"
            },

            "buttons": [
                "Listen on Monochrome"
            ]
        });

        if playing {
            let start = now - position.floor() as i64;
            let end = start + duration.floor() as i64;

            activity["timestamps"] = json!({
                "start": start,
                "end": end
            });
        }

        let payload = json!({
            "cmd": "SET_ACTIVITY",

            "args": {
                "pid": std::process::id(),
                "activity": activity
            },

            "nonce": format!("{}", now)
        });

        write_frame(
            &mut self.pipe,
            1,
            payload.to_string().as_bytes(),
        )?;

        read_frame(&mut self.pipe)?;

        Ok(())
    }
}

fn write_frame<T: Write>(
    pipe: &mut T,
    opcode: u32,
    data: &[u8],
) -> Result<(), Box<dyn std::error::Error>> {
    let mut header = Vec::new();

    header.write_u32::<LittleEndian>(opcode)?;

    header.write_u32::<LittleEndian>(
        data.len() as u32
    )?;

    pipe.write_all(&header)?;
    pipe.write_all(data)?;

    Ok(())
}

fn read_frame<T: Read>(
    pipe: &mut T,
) -> Result<Value, Box<dyn std::error::Error>> {
    let mut header = [0u8; 8];

    pipe.read_exact(&mut header)?;

    let mut cursor = std::io::Cursor::new(header);

    cursor.read_u32::<LittleEndian>()?;

    let length = cursor.read_u32::<LittleEndian>()?;

    let mut data = vec![0u8; length as usize];

    pipe.read_exact(&mut data)?;

    Ok(serde_json::from_slice(&data)?)
}

pub fn update_song(
    state: &DiscordState,
    title: String,
    artist: String,
    artwork: String,
    position: f64,
    duration: f64,
    playing: bool,
) {
    {
        let enabled = state.enabled.lock().unwrap();

        if !*enabled {
            return;
        }
    }

    if !playing {
        clear_activity(state);
        return;
    }

    let mut lock = state.client.lock().unwrap();

    if let Some(client) = lock.as_mut() {
        if let Err(e) = client.update(
            title,
            artist,
            artwork,
            position,
            duration,
            playing,
        ) {
            println!("discord update failed: {}", e);
        }
    }
}

pub fn clear_activity(state: &DiscordState) {
    let mut lock = state.client.lock().unwrap();

    if let Some(client) = lock.as_mut() {
        let payload = json!({
            "cmd": "SET_ACTIVITY",

            "args": {
                "pid": std::process::id(),
                "activity": null
            },

            "nonce": format!(
                "{}",
                chrono::Utc::now().timestamp()
            )
        });

        if let Err(e) = write_frame(
            &mut client.pipe,
            1,
            payload.to_string().as_bytes(),
        ) {
            println!(
                "Failed clearing Discord RPC: {}",
                e
            );
        }

        let _ = read_frame(&mut client.pipe);
    }
}
