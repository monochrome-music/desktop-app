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
// The media-session plugin drives native lock screen metadata/controls.
// We still configure AVAudioSession early so background playback stays enabled
// even before the first JS -> plugin state sync happens.

pub fn setup(_app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    configure_audio_session();
    Ok(())
}
