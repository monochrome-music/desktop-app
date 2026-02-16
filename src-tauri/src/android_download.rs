#[cfg(target_os = "android")]
use jni::objects::{JObject, JValue};
#[cfg(target_os = "android")]
use jni::JNIEnv;
#[cfg(target_os = "android")]
use serde::Deserialize;
#[cfg(target_os = "android")]
use std::{sync::mpsc, time::Duration};
#[cfg(target_os = "android")]
use tauri::{AppHandle, Manager};

#[cfg(target_os = "android")]
fn with_android_env<R, F>(app: &AppHandle, func: F) -> Result<R, String>
where
    F: FnOnce(&mut JNIEnv, &JObject, &JObject) -> Result<R, String> + Send + 'static,
    R: Send + 'static,
{
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let (tx, rx) = mpsc::channel();
    window
        .with_webview(|webview| {
            webview.jni_handle().exec(move |env, activity, webview| {
                let result = func(env, activity, webview);
                let _ = tx.send(result);
            });
        })
        .map_err(|e| e.to_string())?;

    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| "Android JNI call timed out".to_string())?
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidDownloadBeginArgs {
    filename: String,
    mime_type: Option<String>,
    relative_path: Option<String>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidDownloadWriteArgs {
    uri: String,
    data: Vec<u8>,
    append: Option<bool>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidDownloadFinishArgs {
    uri: String,
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn android_download_begin(
    app: AppHandle,
    args: AndroidDownloadBeginArgs,
) -> Result<String, String> {
    with_android_env(&app, move |env, activity, _webview| {
        let sdk_int = env
            .get_static_field("android/os/Build$VERSION", "SDK_INT", "I")
            .and_then(|value| value.i())
            .unwrap_or(0);

        if sdk_int < 29 {
            return Err("Android 10+ required for public downloads".to_string());
        }

        let resolver = env
            .call_method(
                activity,
                "getContentResolver",
                "()Landroid/content/ContentResolver;",
                &[],
            )
            .and_then(|value| value.l())
            .map_err(|e| format!("Failed to get ContentResolver: {e}"))?;

        let values = env
            .new_object("android/content/ContentValues", "()V", &[])
            .map_err(|e| format!("Failed to create ContentValues: {e}"))?;

        let display_name_key = env
            .get_static_field(
                "android/provider/MediaStore$MediaColumns",
                "DISPLAY_NAME",
                "Ljava/lang/String;",
            )
            .and_then(|value| value.l())
            .map_err(|e| format!("Failed to get DISPLAY_NAME: {e}"))?;

        let filename = env
            .new_string(args.filename)
            .map_err(|e| format!("Failed to create filename string: {e}"))?;
        env.call_method(
            &values,
            "put",
            "(Ljava/lang/String;Ljava/lang/String;)V",
            &[JValue::Object(&display_name_key), JValue::Object(&filename)],
        )
        .map_err(|e| format!("Failed to set display name: {e}"))?;

        if let Some(mime) = args.mime_type {
            if !mime.is_empty() {
                let mime_key = env
                    .get_static_field(
                        "android/provider/MediaStore$MediaColumns",
                        "MIME_TYPE",
                        "Ljava/lang/String;",
                    )
                    .and_then(|value| value.l())
                    .map_err(|e| format!("Failed to get MIME_TYPE: {e}"))?;
                let mime_value = env
                    .new_string(mime)
                    .map_err(|e| format!("Failed to create MIME string: {e}"))?;
                env.call_method(
                    &values,
                    "put",
                    "(Ljava/lang/String;Ljava/lang/String;)V",
                    &[JValue::Object(&mime_key), JValue::Object(&mime_value)],
                )
                .map_err(|e| format!("Failed to set MIME type: {e}"))?;
            }
        }

        let relative_path_key = env
            .get_static_field(
                "android/provider/MediaStore$MediaColumns",
                "RELATIVE_PATH",
                "Ljava/lang/String;",
            )
            .and_then(|value| value.l())
            .map_err(|e| format!("Failed to get RELATIVE_PATH: {e}"))?;

        let mut relative_path = args.relative_path.unwrap_or_else(|| "Download".to_string());
        if !relative_path.ends_with('/') {
            relative_path.push('/');
        }
        let relative_value = env
            .new_string(relative_path)
            .map_err(|e| format!("Failed to create RELATIVE_PATH string: {e}"))?;
        env.call_method(
            &values,
            "put",
            "(Ljava/lang/String;Ljava/lang/String;)V",
            &[
                JValue::Object(&relative_path_key),
                JValue::Object(&relative_value),
            ],
        )
        .map_err(|e| format!("Failed to set RELATIVE_PATH: {e}"))?;

        let is_pending_key = env
            .get_static_field(
                "android/provider/MediaStore$MediaColumns",
                "IS_PENDING",
                "Ljava/lang/String;",
            )
            .and_then(|value| value.l())
            .map_err(|e| format!("Failed to get IS_PENDING: {e}"))?;
        let pending_value = env
            .new_object("java/lang/Integer", "(I)V", &[JValue::Int(1)])
            .map_err(|e| format!("Failed to create pending Integer: {e}"))?;
        env.call_method(
            &values,
            "put",
            "(Ljava/lang/String;Ljava/lang/Integer;)V",
            &[
                JValue::Object(&is_pending_key),
                JValue::Object(&pending_value),
            ],
        )
        .map_err(|e| format!("Failed to set IS_PENDING: {e}"))?;

        let volume = env
            .new_string("external_primary")
            .map_err(|e| format!("Failed to create volume string: {e}"))?;
        let downloads_class = env
            .find_class("android/provider/MediaStore$Downloads")
            .map_err(|e| format!("Failed to find MediaStore.Downloads: {e}"))?;
        let collection = env
            .call_static_method(
                downloads_class,
                "getContentUri",
                "(Ljava/lang/String;)Landroid/net/Uri;",
                &[JValue::Object(&volume)],
            )
            .and_then(|value| value.l())
            .map_err(|e| format!("Failed to get Downloads collection: {e}"))?;

        let uri = env
            .call_method(
                resolver,
                "insert",
                "(Landroid/net/Uri;Landroid/content/ContentValues;)Landroid/net/Uri;",
                &[JValue::Object(&collection), JValue::Object(&values)],
            )
            .and_then(|value| value.l())
            .map_err(|e| format!("Failed to insert download: {e}"))?;

        if uri.is_null() {
            return Err("Failed to create download entry".to_string());
        }

        let uri_string = env
            .call_method(uri, "toString", "()Ljava/lang/String;", &[])
            .and_then(|value| value.l())
            .map_err(|e| format!("Failed to read URI string: {e}"))?;
        let uri_jstring = jni::objects::JString::from(uri_string);
        let uri_rust: String = env
            .get_string(&uri_jstring)
            .map_err(|e| format!("Failed to convert URI string: {e}"))?
            .into();

        Ok(uri_rust)
    })
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn android_download_write(
    app: AppHandle,
    args: AndroidDownloadWriteArgs,
) -> Result<(), String> {
    with_android_env(&app, move |env, activity, _webview| {
        let resolver = env
            .call_method(
                activity,
                "getContentResolver",
                "()Landroid/content/ContentResolver;",
                &[],
            )
            .and_then(|value| value.l())
            .map_err(|e| format!("Failed to get ContentResolver: {e}"))?;

        let uri_string = env
            .new_string(args.uri)
            .map_err(|e| format!("Failed to create URI string: {e}"))?;
        let uri = env
            .call_static_method(
                "android/net/Uri",
                "parse",
                "(Ljava/lang/String;)Landroid/net/Uri;",
                &[JValue::Object(&uri_string)],
            )
            .and_then(|value| value.l())
            .map_err(|e| format!("Failed to parse URI: {e}"))?;

        let mode = if args.append.unwrap_or(false) {
            "wa"
        } else {
            "w"
        };
        let mode_string = env
            .new_string(mode)
            .map_err(|e| format!("Failed to create mode string: {e}"))?;
        let output_stream = env
            .call_method(
                resolver,
                "openOutputStream",
                "(Landroid/net/Uri;Ljava/lang/String;)Ljava/io/OutputStream;",
                &[JValue::Object(&uri), JValue::Object(&mode_string)],
            )
            .and_then(|value| value.l())
            .map_err(|e| format!("Failed to open output stream: {e}"))?;

        if output_stream.is_null() {
            return Err("Failed to open output stream".to_string());
        }

        let bytes = env
            .byte_array_from_slice(&args.data)
            .map_err(|e| format!("Failed to create byte array: {e}"))?;
        env.call_method(&output_stream, "write", "([B)V", &[JValue::Object(&bytes)])
            .map_err(|e| format!("Failed to write bytes: {e}"))?;
        let _ = env.call_method(&output_stream, "flush", "()V", &[]);
        let _ = env.call_method(&output_stream, "close", "()V", &[]);

        Ok(())
    })
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn android_download_finish(
    app: AppHandle,
    args: AndroidDownloadFinishArgs,
) -> Result<(), String> {
    with_android_env(&app, move |env, activity, _webview| {
        let sdk_int = env
            .get_static_field("android/os/Build$VERSION", "SDK_INT", "I")
            .and_then(|value| value.i())
            .unwrap_or(0);

        if sdk_int < 29 {
            return Ok(());
        }

        let resolver = env
            .call_method(
                activity,
                "getContentResolver",
                "()Landroid/content/ContentResolver;",
                &[],
            )
            .and_then(|value| value.l())
            .map_err(|e| format!("Failed to get ContentResolver: {e}"))?;

        let uri_string = env
            .new_string(args.uri)
            .map_err(|e| format!("Failed to create URI string: {e}"))?;
        let uri = env
            .call_static_method(
                "android/net/Uri",
                "parse",
                "(Ljava/lang/String;)Landroid/net/Uri;",
                &[JValue::Object(&uri_string)],
            )
            .and_then(|value| value.l())
            .map_err(|e| format!("Failed to parse URI: {e}"))?;

        let values = env
            .new_object("android/content/ContentValues", "()V", &[])
            .map_err(|e| format!("Failed to create ContentValues: {e}"))?;
        let is_pending_key = env
            .get_static_field(
                "android/provider/MediaStore$MediaColumns",
                "IS_PENDING",
                "Ljava/lang/String;",
            )
            .and_then(|value| value.l())
            .map_err(|e| format!("Failed to get IS_PENDING: {e}"))?;
        let pending_value = env
            .new_object("java/lang/Integer", "(I)V", &[JValue::Int(0)])
            .map_err(|e| format!("Failed to create pending Integer: {e}"))?;
        env.call_method(
            &values,
            "put",
            "(Ljava/lang/String;Ljava/lang/Integer;)V",
            &[
                JValue::Object(&is_pending_key),
                JValue::Object(&pending_value),
            ],
        )
        .map_err(|e| format!("Failed to update IS_PENDING: {e}"))?;

        let null_obj = JObject::null();
        let _ = env.call_method(
            resolver,
            "update",
            "(Landroid/net/Uri;Landroid/content/ContentValues;Ljava/lang/String;[Ljava/lang/String;)I",
            &[
                JValue::Object(&uri),
                JValue::Object(&values),
                JValue::Object(&null_obj),
                JValue::Object(&null_obj),
            ],
        );

        Ok(())
    })
}
