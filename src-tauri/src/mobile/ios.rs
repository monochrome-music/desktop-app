use objc::runtime::{Object, BOOL};
use objc::{class, msg_send, sel, sel_impl};
use std::ffi::CString;

#[link(name = "AVFoundation", kind = "framework")]
extern "C" {}

// ---------------------------------------------------------------------------
// Audio session  (required for background playback on iOS)
// ---------------------------------------------------------------------------

fn configure_audio_session() {
    unsafe {
        let session: *mut Object = msg_send![class!(AVAudioSession), sharedInstance];
        if session.is_null() {
            return;
        }

        let cstr = match CString::new("AVAudioSessionCategoryPlayback") {
            Ok(s) => s,
            Err(_) => return,
        };
        let category: *mut Object =
            msg_send![class!(NSString), stringWithUTF8String: cstr.as_ptr()];
        if category.is_null() {
            return;
        }

        let mut error: *mut Object = std::ptr::null_mut();
        let _: BOOL = msg_send![session, setCategory: category error: &mut error];
        let _: BOOL = msg_send![session, setActive: true error: &mut error];
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
//
// Lock screen controls (next/previous track) are handled entirely via the
// W3C Media Session API from JavaScript (media-remote-init.js).
//
// WKWebView runs audio in a separate process and takes exclusive control of
// MPRemoteCommandCenter / MPNowPlayingInfoCenter once playback starts,
// overriding any native handlers set from Rust.  The Media Session API is
// the only mechanism WKWebView honours for lock screen buttons.
//
// The only native setup we need is AVAudioSession to enable background
// playback.

pub fn setup(_app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    configure_audio_session();
    Ok(())
}
