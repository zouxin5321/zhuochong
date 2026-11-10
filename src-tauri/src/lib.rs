//! 卓宠宿主：透明置顶窗 + 精灵渲染 + 资源包插件扫描。
//!
//! 设计边界（见 docs/PLUGIN_SPEC.md）：
//! - 宿主只读插件目录里的 manifest.json 与 PNG 精灵图，**不执行任何插件代码**；
//! - 插件通过窗口内的 canvas 呈现，宿主与插件之间没有脚本通道，天然无沙箱风险；
//! - 插件查找顺序：用户插件目录 > 内置资源目录（同 id 时用户版覆盖内置版）。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use serde_json::Value;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{LogicalSize, Manager, PhysicalPosition, PhysicalSize};

const PET_LABEL: &str = "pet";

/// 大招窗口放大的基准矩形：第一次放大时记录，恢复时还原，
/// 避免多次缩放误差累积，也保证放大期间的位置变化不污染位置记忆。
struct ZoomBase(Mutex<Option<(PhysicalPosition<i32>, PhysicalSize<u32>)>>);

#[derive(Debug, Clone, Serialize)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    /// 插件目录的绝对路径（前端不使用，便于排障与日志）
    pub dir: String,
    /// manifest 原样透传，前端按 PLUGIN_SPEC 解析
    pub manifest: Value,
}

fn plugin_roots(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    // 用户目录优先，便于覆盖内置角色
    if let Ok(dir) = app.path().app_data_dir() {
        roots.push(dir.join("plugins"));
    }
    if let Ok(dir) = app.path().resource_dir() {
        roots.push(dir.join("plugins"));
    }
    roots
}

fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

/// 精灵图只允许插件目录内的单层文件名，挡住 ../ 与绝对路径
fn is_safe_file_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && !name.contains("..")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

fn scan_plugins(app: &tauri::AppHandle) -> Vec<PluginInfo> {
    let mut out: Vec<PluginInfo> = Vec::new();
    for root in plugin_roots(app) {
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let Ok(raw) = fs::read_to_string(dir.join("manifest.json")) else {
                continue;
            };
            let Ok(manifest) = serde_json::from_str::<Value>(&raw) else {
                eprintln!("跳过 {}：manifest.json 不是合法 JSON", dir.display());
                continue;
            };
            let text = |key: &str| {
                manifest
                    .get(key)
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .trim()
                    .to_string()
            };
            let id = text("id");
            let name = text("name");
            if !is_valid_id(&id) || name.is_empty() {
                eprintln!("跳过 {}：manifest 缺少合法 id / name", dir.display());
                continue;
            }
            if !manifest.pointer("/sprite/file").is_some() || manifest.get("actions").is_none() {
                eprintln!("跳过 {id}：manifest 缺少 sprite.file 或 actions");
                continue;
            }
            if out.iter().any(|p| p.id == id) {
                continue;
            }
            out.push(PluginInfo {
                id,
                name,
                version: text("version"),
                author: text("author"),
                description: text("description"),
                dir: dir.to_string_lossy().to_string(),
                manifest,
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

fn read_config(app: &tauri::AppHandle) -> Result<Value, String> {
    let path = config_path(app)?;
    match fs::read_to_string(path) {
        Ok(raw) => Ok(serde_json::from_str(&raw).unwrap_or_else(|_| Value::Object(Default::default()))),
        Err(_) => Ok(Value::Object(Default::default())),
    }
}

fn write_config(app: &tauri::AppHandle, config: &Value) -> Result<(), String> {
    let path = config_path(app)?;
    let raw = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_plugins(app: tauri::AppHandle) -> Vec<PluginInfo> {
    scan_plugins(&app)
}

#[tauri::command]
fn load_sprite(app: tauri::AppHandle, plugin_id: String) -> Result<String, String> {
    let plugin = scan_plugins(&app)
        .into_iter()
        .find(|p| p.id == plugin_id)
        .ok_or_else(|| format!("角色插件不存在：{plugin_id}"))?;
    let file = plugin
        .manifest
        .pointer("/sprite/file")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    if !is_safe_file_name(file) {
        return Err("manifest 的 sprite.file 只能是插件目录内的文件名（不含路径分隔符）".into());
    }
    let path = Path::new(&plugin.dir).join(file);
    let bytes = fs::read(&path).map_err(|e| format!("读取精灵图 {} 失败：{e}", path.display()))?;
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

#[tauri::command]
fn get_config(app: tauri::AppHandle) -> Result<Value, String> {
    read_config(&app)
}

#[tauri::command]
fn set_config(app: tauri::AppHandle, config: Value) -> Result<(), String> {
    write_config(&app, &config)
}

#[tauri::command]
fn save_position(app: tauri::AppHandle, x: i32, y: i32) -> Result<(), String> {
    let mut config = read_config(&app)?;
    if let Some(obj) = config.as_object_mut() {
        obj.insert("x".to_string(), Value::from(x));
        obj.insert("y".to_string(), Value::from(y));
    }
    write_config(&app, &config)
}

#[tauri::command]
fn resize_pet(window: tauri::WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    let w = width.clamp(32.0, 1024.0);
    let h = height.clamp(32.0, 1024.0);
    window
        .set_size(LogicalSize::new(w, h))
        .map_err(|e| e.to_string())
}

/// 大招视觉冲击：按 factor 临时放大窗口（1.0 恢复基准矩形）。
/// 锚定右下角——角色站在窗口底部中央，放大时向左上扩展，脚底位置不动。
#[tauri::command]
fn zoom_pet(
    window: tauri::WebviewWindow,
    base: tauri::State<ZoomBase>,
    factor: f64,
) -> Result<(), String> {
    let f = factor.clamp(1.0, 3.0);
    let mut guard = base.0.lock().map_err(|e| e.to_string())?;
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;

    if f <= 1.001 {
        if let Some((p, s)) = guard.take() {
            window
                .set_size(PhysicalSize::new(s.width, s.height))
                .map_err(|e| e.to_string())?;
            window
                .set_position(PhysicalPosition::new(p.x, p.y))
                .map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    if guard.is_none() {
        *guard = Some((pos, size));
    }
    let (bp, bs) = guard.as_ref().expect("基准矩形已记录");
    let nw = (bs.width as f64 * f).round() as u32;
    let nh = (bs.height as f64 * f).round() as u32;
    let nx = bp.x + (bs.width as i32 - nw as i32);
    let ny = bp.y + (bs.height as i32 - nh as i32);
    window
        .set_size(PhysicalSize::new(nw, nh))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(nx, ny))
        .map_err(|e| e.to_string())
}

/// 系统通知（Windows 托盘气泡）：放大招时即使视线离开桌宠也能收到。
#[tauri::command]
fn toast(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

fn open_plugins_dir(app: &tauri::AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("plugins");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    open_in_file_manager(&dir).map_err(|e| e.to_string())
}

fn open_in_file_manager(path: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer").arg(path).spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(path).spawn()?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open").arg(path).spawn()?;
    }
    Ok(())
}

fn toggle_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window(PET_LABEL) {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
        }
    }
}

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "显示 / 隐藏", true, None::<&str>)?;
    let plugins = MenuItem::with_id(app, "plugins", "打开插件目录", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出卓宠", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&toggle, &plugins, &PredefinedMenuItem::separator(app)?, &quit],
    )?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("卓宠 · 桌面宠物（右键切换角色）")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle" => toggle_window(app),
            "plugins" => {
                if let Err(e) = open_plugins_dir(app) {
                    eprintln!("打开插件目录失败：{e}");
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(ZoomBase(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();

            // 还原上次位置：没有记录就让窗口居中
            if let Some(win) = app.get_webview_window(PET_LABEL) {
                if let Ok(config) = read_config(&handle) {
                    let x = config.get("x").and_then(|v| v.as_i64());
                    let y = config.get("y").and_then(|v| v.as_i64());
                    if let (Some(x), Some(y)) = (x, y) {
                        let _ = win.set_position(PhysicalPosition::new(x as i32, y as i32));
                    }
                }
            }

            build_tray(&handle)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_plugins,
            load_sprite,
            get_config,
            set_config,
            save_position,
            resize_pet,
            zoom_pet,
            toast
        ])
        .run(tauri::generate_context!())
        .expect("卓宠启动失败");
}
