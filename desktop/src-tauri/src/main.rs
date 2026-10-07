#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use flate2::read::GzDecoder;
use fs2::available_space;
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};

const OLLAMA_VERSION: &str = "0.34.0";
const OLLAMA_URL: &str =
    "https://github.com/ollama/ollama/releases/download/v0.34.0/ollama-darwin.tgz";
const OLLAMA_SHA256: &str = "dd12b00bcce2d6551178e67ada90d5af9f75bdb54a118b96655250fa3e8ef734";
const OLLAMA_ENDPOINT: &str = "http://127.0.0.1:11434";
const REQUIRED_BYTES: u64 = 6 * 1024 * 1024 * 1024;

#[derive(Default)]
struct AiState {
    owned_child: Mutex<Option<Child>>,
    cancel_setup: AtomicBool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SetupProgress {
    stage: String,
    message: String,
    completed: u64,
    total: u64,
    percent: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiStatus {
    runtime_installed: bool,
    runtime_path: Option<String>,
    runtime_source: String,
    server_running: bool,
    models: Vec<Value>,
    available_bytes: u64,
    os_version: String,
    os_supported: bool,
    arch: String,
    managed_process: bool,
}

fn support_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or_else(|| "无法定位 Application Support".to_string())?;
    let path = base.join("OoFR");
    fs::create_dir_all(&path).map_err(|error| format!("无法创建 OoFR 数据目录：{error}"))?;
    Ok(path)
}

fn private_runtime_dir() -> Result<PathBuf, String> {
    let path = support_dir()?.join("runtime");
    fs::create_dir_all(&path).map_err(|error| format!("无法创建运行时目录：{error}"))?;
    Ok(path)
}

fn is_executable(path: &Path) -> bool {
    path.is_file()
}

fn find_in_path(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|path| path.join(name))
            .find(|path| is_executable(path))
    })
}

fn find_named_file(root: &Path, name: &str, depth: usize) -> Option<PathBuf> {
    if depth == 0 || !root.exists() {
        return None;
    }
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && path.file_name().and_then(|value| value.to_str()) == Some(name) {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_named_file(&path, name, depth - 1) {
                return Some(found);
            }
        }
    }
    None
}

fn find_ollama() -> Option<(PathBuf, &'static str)> {
    if let Some(path) = find_in_path("ollama") {
        return Some((path, "system"));
    }
    for path in [
        PathBuf::from("/opt/homebrew/bin/ollama"),
        PathBuf::from("/usr/local/bin/ollama"),
        PathBuf::from("/Applications/Ollama.app/Contents/Resources/ollama"),
    ] {
        if is_executable(&path) {
            return Some((path, "system"));
        }
    }
    private_runtime_dir()
        .ok()
        .and_then(|root| find_named_file(&root, "ollama", 4))
        .map(|path| (path, "private"))
}

fn macos_version() -> String {
    Command::new("/usr/bin/sw_vers")
        .args(["-productVersion"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_default()
}

fn macos_supported(version: &str) -> bool {
    version
        .split('.')
        .next()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(0)
        >= 14
}

async fn server_version(client: &reqwest::Client) -> Option<Value> {
    client
        .get(format!("{OLLAMA_ENDPOINT}/api/version"))
        .timeout(Duration::from_secs(2))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json::<Value>()
        .await
        .ok()
}

async fn model_list(client: &reqwest::Client) -> Vec<Value> {
    let response = match client
        .get(format!("{OLLAMA_ENDPOINT}/api/tags"))
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
    {
        Ok(response) => response,
        Err(_) => return Vec::new(),
    };
    response
        .json::<Value>()
        .await
        .ok()
        .and_then(|payload| payload.get("models").and_then(Value::as_array).cloned())
        .unwrap_or_default()
}

fn emit_progress(app: &AppHandle, stage: &str, message: &str, completed: u64, total: u64) {
    let percent = if total > 0 {
        (completed as f64 / total as f64) * 100.0
    } else {
        0.0
    };
    let _ = app.emit(
        "ai-setup-progress",
        SetupProgress {
            stage: stage.to_string(),
            message: message.to_string(),
            completed,
            total,
            percent,
        },
    );
}

#[tauri::command]
async fn ai_status(state: State<'_, AiState>) -> Result<AiStatus, String> {
    let client = reqwest::Client::new();
    let running = server_version(&client).await.is_some();
    let models = if running {
        model_list(&client).await
    } else {
        Vec::new()
    };
    let runtime = find_ollama();
    let data_dir = support_dir()?;
    let free = available_space(&data_dir).map_err(|error| format!("无法读取磁盘空间：{error}"))?;
    let version = macos_version();
    let managed_process = state
        .owned_child
        .lock()
        .map_err(|_| "AI 进程状态不可用")?
        .is_some();
    Ok(AiStatus {
        runtime_installed: runtime.is_some(),
        runtime_path: runtime
            .as_ref()
            .map(|(path, _)| path.to_string_lossy().to_string()),
        runtime_source: runtime
            .as_ref()
            .map(|(_, source)| source.to_string())
            .unwrap_or_else(|| "missing".to_string()),
        server_running: running,
        models,
        available_bytes: free,
        os_supported: macos_supported(&version),
        os_version: version,
        arch: std::env::consts::ARCH.to_string(),
        managed_process,
    })
}

#[tauri::command]
async fn ai_install_runtime(app: AppHandle, state: State<'_, AiState>) -> Result<Value, String> {
    if let Some((path, source)) = find_ollama() {
        return Ok(json!({ "path": path, "source": source, "reused": true }));
    }
    let root = private_runtime_dir()?;
    let free = available_space(&root).map_err(|error| format!("无法读取磁盘空间：{error}"))?;
    if free < REQUIRED_BYTES {
        return Err("至少需要 6GB 可用空间才能安装本地 AI".to_string());
    }
    state.cancel_setup.store(false, Ordering::SeqCst);
    let archive_path = root.join(format!("ollama-{OLLAMA_VERSION}.tgz.part"));
    emit_progress(&app, "runtime", "正在下载 Ollama 运行时…", 0, 0);
    let response = reqwest::Client::new()
        .get(OLLAMA_URL)
        .send()
        .await
        .map_err(|error| format!("Ollama 下载失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("Ollama 下载失败：{error}"))?;
    let total = response.content_length().unwrap_or(0);
    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(&archive_path)
        .await
        .map_err(|error| format!("无法保存 Ollama：{error}"))?;
    let mut hasher = Sha256::new();
    let mut completed = 0_u64;
    use tokio::io::AsyncWriteExt;
    while let Some(chunk) = stream.next().await {
        if state.cancel_setup.load(Ordering::SeqCst) {
            let _ = tokio::fs::remove_file(&archive_path).await;
            return Err("安装已取消".to_string());
        }
        let bytes = chunk.map_err(|error| format!("Ollama 下载中断：{error}"))?;
        file.write_all(&bytes)
            .await
            .map_err(|error| format!("无法保存 Ollama：{error}"))?;
        hasher.update(&bytes);
        completed += bytes.len() as u64;
        emit_progress(&app, "runtime", "正在下载 Ollama 运行时…", completed, total);
    }
    file.flush()
        .await
        .map_err(|error| format!("无法完成 Ollama 下载：{error}"))?;
    let digest = format!("{:x}", hasher.finalize());
    if digest != OLLAMA_SHA256 {
        let _ = tokio::fs::remove_file(&archive_path).await;
        return Err("Ollama 下载校验失败，文件已丢弃".to_string());
    }
    emit_progress(&app, "runtime", "正在解压 Ollama 运行时…", total, total);
    let archive_for_extract = archive_path.clone();
    let root_for_extract = root.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let file = File::open(&archive_for_extract)
            .map_err(|error| format!("无法打开 Ollama 安装包：{error}"))?;
        let decoder = GzDecoder::new(file);
        let mut archive = tar::Archive::new(decoder);
        archive
            .unpack(&root_for_extract)
            .map_err(|error| format!("Ollama 解压失败：{error}"))?;
        Ok(())
    })
    .await
    .map_err(|error| format!("Ollama 解压任务失败：{error}"))??;
    let _ = tokio::fs::remove_file(&archive_path).await;
    let executable = find_ollama()
        .ok_or_else(|| "安装包中没有找到 Ollama 可执行文件".to_string())?
        .0;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&executable)
            .map_err(|error| error.to_string())?
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&executable, permissions).map_err(|error| error.to_string())?;
    }
    Ok(json!({ "path": executable, "source": "private", "reused": false }))
}

#[tauri::command]
async fn ai_start(app: AppHandle, state: State<'_, AiState>) -> Result<Value, String> {
    let client = reqwest::Client::new();
    if let Some(version) = server_version(&client).await {
        return Ok(json!({ "started": false, "reused": true, "version": version }));
    }
    let version = macos_version();
    if !macos_supported(&version) {
        return Err(format!(
            "OoFR Desktop 需要 macOS 14 或更高版本；当前为 {version}"
        ));
    }
    if TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], 11434)),
        Duration::from_millis(500),
    )
    .is_ok()
    {
        return Err("端口 11434 已被其他程序占用，且该程序不是可用的 Ollama".to_string());
    }
    let executable = find_ollama()
        .ok_or_else(|| "尚未安装 Ollama 运行时".to_string())?
        .0;
    let log_dir = support_dir()?.join("logs");
    fs::create_dir_all(&log_dir).map_err(|error| format!("无法创建日志目录：{error}"))?;
    let stdout = File::create(log_dir.join("ollama.log")).map_err(|error| error.to_string())?;
    let stderr = stdout.try_clone().map_err(|error| error.to_string())?;
    let child = Command::new(executable)
        .arg("serve")
        .env("OLLAMA_HOST", "127.0.0.1:11434")
        .env("OLLAMA_NO_CLOUD", "1")
        .env("OLLAMA_KEEP_ALIVE", "30m")
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|error| format!("Ollama 启动失败：{error}"))?;
    *state.owned_child.lock().map_err(|_| "AI 进程状态不可用")? = Some(child);
    emit_progress(&app, "start", "正在启动本地 AI…", 0, 0);
    for _ in 0..80 {
        if let Some(version) = server_version(&client).await {
            return Ok(json!({ "started": true, "reused": false, "version": version }));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    if let Some(mut child) = state
        .owned_child
        .lock()
        .map_err(|_| "AI 进程状态不可用")?
        .take()
    {
        let _ = child.kill();
        let _ = child.wait();
    }
    Err("Ollama 启动超时，请查看 OoFR 日志".to_string())
}

#[tauri::command]
async fn ai_pull_model(
    app: AppHandle,
    state: State<'_, AiState>,
    model: String,
) -> Result<Value, String> {
    state.cancel_setup.store(false, Ordering::SeqCst);
    let response = reqwest::Client::new()
        .post(format!("{OLLAMA_ENDPOINT}/api/pull"))
        .json(&json!({ "model": &model, "stream": true }))
        .send()
        .await
        .map_err(|error| format!("模型下载请求失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("模型下载请求失败：{error}"))?;
    let mut stream = response.bytes_stream();
    let mut pending = Vec::<u8>::new();
    while let Some(chunk) = stream.next().await {
        if state.cancel_setup.load(Ordering::SeqCst) {
            return Err("模型下载已取消；下次会从已有进度继续".to_string());
        }
        pending.extend_from_slice(&chunk.map_err(|error| format!("模型下载中断：{error}"))?);
        while let Some(position) = pending.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = pending.drain(..=position).collect();
            if let Ok(payload) = serde_json::from_slice::<Value>(&line) {
                if let Some(error) = payload.get("error").and_then(Value::as_str) {
                    return Err(error.to_string());
                }
                let completed = payload
                    .get("completed")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                let total = payload.get("total").and_then(Value::as_u64).unwrap_or(0);
                let status = payload
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("正在下载模型");
                emit_progress(&app, "model", status, completed, total);
            }
        }
    }
    emit_progress(&app, "ready", "gemma3:4b 已安装", 1, 1);
    Ok(json!({ "model": model, "ready": true }))
}

#[tauri::command]
async fn ai_chat(request: Value) -> Result<Value, String> {
    reqwest::Client::new()
        .post(format!("{OLLAMA_ENDPOINT}/api/chat"))
        .timeout(Duration::from_secs(240))
        .json(&request)
        .send()
        .await
        .map_err(|error| format!("本地 AI 请求失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("本地 AI 请求失败：{error}"))?
        .json::<Value>()
        .await
        .map_err(|error| format!("本地 AI 返回无效数据：{error}"))
}

#[tauri::command]
fn ai_cancel_setup(state: State<'_, AiState>) -> Value {
    state.cancel_setup.store(true, Ordering::SeqCst);
    json!({ "cancelled": true })
}

#[tauri::command]
fn ai_stop(state: State<'_, AiState>) -> Result<Value, String> {
    if let Some(mut child) = state
        .owned_child
        .lock()
        .map_err(|_| "AI 进程状态不可用")?
        .take()
    {
        let _ = child.kill();
        let _ = child.wait();
        return Ok(json!({ "stopped": true, "managed": true }));
    }
    Ok(json!({ "stopped": false, "managed": false }))
}

fn main() {
    tauri::Builder::default()
        .manage(AiState::default())
        .invoke_handler(tauri::generate_handler![
            ai_status,
            ai_install_runtime,
            ai_pull_model,
            ai_start,
            ai_chat,
            ai_stop,
            ai_cancel_setup
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Ok(mut guard) = window.state::<AiState>().owned_child.lock() {
                    if let Some(mut child) = guard.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running OoFR Desktop");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supports_sonoma_and_newer() {
        assert!(!macos_supported("13.7.8"));
        assert!(macos_supported("14.0"));
        assert!(macos_supported("26.6.2"));
        assert!(!macos_supported(""));
    }

    #[test]
    fn pins_the_verified_official_runtime() {
        assert_eq!(OLLAMA_VERSION, "0.34.0");
        assert!(OLLAMA_URL.starts_with("https://github.com/ollama/ollama/releases/download/"));
        assert_eq!(OLLAMA_SHA256.len(), 64);
        assert_eq!(OLLAMA_ENDPOINT, "http://127.0.0.1:11434");
    }

    #[test]
    fn reserves_space_for_runtime_and_model() {
        assert_eq!(REQUIRED_BYTES, 6 * 1024 * 1024 * 1024);
    }
}
