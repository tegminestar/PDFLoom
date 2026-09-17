use std::sync::Mutex;
use tauri::Manager;

/// The file a launch (initial process start, a second launch redirected here
/// by the single-instance plugin, or a mobile/macOS "Opened" event) asked us
/// to open, if any — read once by the frontend via `take_pending_open_path`
/// on startup. A launch while already running instead reaches the frontend
/// live through the `pdfloom://open-file` event emitted below, since by
/// then the frontend's listener is already registered.
struct PendingOpenPath(Mutex<Option<String>>);

/// Windows and Linux pass the opened file as a plain positional argument
/// when a file association or "Open With" launches the app — `argv[0]` is
/// the executable path itself, so this looks at whatever follows it for
/// something that looks like a PDF. macOS/iOS/Android don't use argv for
/// this at all (see `RunEvent::Opened` handling in `run` below) — this is
/// only ever consulted on those two platforms.
fn extract_pdf_path_from_argv(args: &[String]) -> Option<String> {
  args
    .iter()
    .skip(1)
    .find(|a| !a.starts_with('-') && a.to_lowercase().ends_with(".pdf"))
    .cloned()
}

/// macOS, iOS, and Android instead hand over a URL via `RunEvent::Opened`
/// (Finder/Files-app/another-app's-share-sheet). A `file://` URL — the
/// common case on macOS and iOS — converts straight to a plain path that
/// `read_file_bytes`'s plain `std::fs::read` can already handle. Anything
/// else (notably Android's `content://` URIs, which a plain filesystem read
/// cannot open at all — that needs the Android ContentResolver, not
/// implemented here) is passed through as a raw URL string so it's at least
/// visible/debuggable rather than silently dropped, with the frontend's own
/// read attempt failing with a real error instead of nothing happening.
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
fn url_to_path_or_string(url: &tauri::Url) -> String {
  url.to_file_path().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| url.to_string())
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
  std::fs::read(&path).map_err(|e| format!("Couldn't read {path}: {e}"))
}

#[tauri::command]
fn take_pending_open_path(state: tauri::State<PendingOpenPath>) -> Option<String> {
  state.0.lock().unwrap().take()
}

fn emit_open_file(app: &tauri::AppHandle, path: String) {
  use tauri::Emitter;
  let _ = app.emit("pdfloom://open-file", path);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default();

  // Desktop-only (Windows/macOS/Linux): without this, double-clicking a
  // second PDF while PDFLoom is already open would launch an entirely
  // separate instance instead of handing that file to the one already
  // running. Must be registered before any other plugin (the plugin's own
  // requirement). Covers the Windows/Linux argv case below on a *second*
  // launch; macOS's equivalent second-launch case arrives through
  // `RunEvent::Opened` instead (registered further down), since Finder
  // re-activates the existing process via that mechanism, not argv.
  #[cfg(desktop)]
  {
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
      }
      if let Some(path) = extract_pdf_path_from_argv(&argv) {
        emit_open_file(app, path);
      }
    }));

    // Update checks/downloads happen entirely from the frontend (see
    // desktopBridge.ts) via these two plugins' JS bindings — installed
    // builds have no auto-updater otherwise, so a shipped fix or feature
    // never reaches an existing install without this.
    builder = builder
      .plugin(tauri_plugin_updater::Builder::new().build())
      .plugin(tauri_plugin_process::init());
  }

  let initial_path = extract_pdf_path_from_argv(&std::env::args().collect::<Vec<_>>());

  let app = builder
    .manage(PendingOpenPath(Mutex::new(initial_path)))
    .invoke_handler(tauri::generate_handler![read_file_bytes, take_pending_open_path])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while running tauri application");

  #[cfg_attr(not(any(target_os = "macos", target_os = "ios", target_os = "android")), allow(unused_variables))]
  app.run(|app, event| {
    // macOS (Finder "Open With" / drag onto the dock icon, including while
    // already running), iOS, and Android all deliver an opened file this
    // way instead of argv — Windows and Linux never emit this event, which
    // is why they're excluded here rather than because it wouldn't compile.
    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
    if let tauri::RunEvent::Opened { urls } = event {
      if let Some(url) = urls.first() {
        let path = url_to_path_or_string(url);
        // Whether this is a cold start (no frontend listener registered
        // yet — the window object existing isn't a reliable signal of
        // that, since Tauri creates it well before the webview's JS has
        // loaded and run its effects) or an already-running redirect is
        // not reliably knowable here, so do both: stash it for
        // take_pending_open_path's one-time startup poll to pick up, *and*
        // emit it live for an already-registered listener to pick up.
        // Safe to do unconditionally — the frontend only calls
        // take_pending_open_path once, at mount, so an already-running
        // instance's stale stash is never re-read and can't cause a
        // double-open.
        *app.state::<PendingOpenPath>().0.lock().unwrap() = Some(path.clone());
        emit_open_file(app, path);
      }
    }
  });
}
