use std::ffi::c_void;

// Link AVFoundation so AVAudioSession is available at runtime.
#[link(name = "AVFoundation", kind = "framework")]
extern "C" {}

extern "C" {
    fn objc_getClass(name: *const u8) -> *mut c_void;
    fn sel_registerName(name: *const u8) -> *mut c_void;
    fn objc_msgSend(receiver: *mut c_void, sel: *mut c_void, ...) -> *mut c_void;
}

/// Configure AVAudioSession with the `.playback` category.
///
/// This tells iOS the app plays audio and should keep running in the
/// background while audio is active.  When playback stops the system
/// will suspend the app normally.
fn configure_audio_session() {
    unsafe {
        let cls = objc_getClass(b"AVAudioSession\0".as_ptr());
        if cls.is_null() {
            eprintln!("[Monochrome] AVAudioSession class not found");
            return;
        }

        let session = objc_msgSend(cls, sel_registerName(b"sharedInstance\0".as_ptr()));
        if session.is_null() {
            eprintln!("[Monochrome] Failed to get AVAudioSession shared instance");
            return;
        }

        // Build the NSString for the category name.
        let ns_string = objc_getClass(b"NSString\0".as_ptr());
        let category = objc_msgSend(
            ns_string,
            sel_registerName(b"stringWithUTF8String:\0".as_ptr()),
            b"AVAudioSessionCategoryPlayback\0".as_ptr() as *const c_void,
        );

        let null: *mut c_void = std::ptr::null_mut();

        // [session setCategory:@"AVAudioSessionCategoryPlayback" error:nil]
        let _ = objc_msgSend(
            session,
            sel_registerName(b"setCategory:error:\0".as_ptr()),
            category,
            null,
        );

        // [session setActive:YES error:nil]
        let _ = objc_msgSend(
            session,
            sel_registerName(b"setActive:error:\0".as_ptr()),
            1usize as *mut c_void, // BOOL YES
            null,
        );

        println!("[Monochrome] AVAudioSession configured for background playback");
    }
}

pub fn setup(_app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    configure_audio_session();
    Ok(())
}
