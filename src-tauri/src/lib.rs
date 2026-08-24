use std::{fs, path::Path};

#[tauri::command]
fn read_image_file(path: String) -> Result<tauri::ipc::Response, String> {
    let path = Path::new(&path);
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp") {
        return Err("仅支持 PNG、JPG 或 WebP 图片".into());
    }
    let metadata = fs::metadata(path).map_err(|_| "图片文件不存在、已失效或无法访问".to_string())?;
    if !metadata.is_file() {
        return Err("拖入的对象不是图片文件".into());
    }
    if metadata.len() > 50 * 1024 * 1024 {
        return Err("图片文件超过 50 MB，无法导入".into());
    }
    let bytes = fs::read(path).map_err(|_| "无法读取图片；若图片来自微信，请复制图片后在应用内按 Ctrl+V".to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![read_image_file])
        .run(tauri::generate_context!())
        .expect("error while running COCArmyTool");
}
