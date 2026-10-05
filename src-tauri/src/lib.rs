use base64::Engine;
use serde::Serialize;
use std::fs;
use std::io::{BufReader, Write};
use std::path::{Path, PathBuf};
use tauri::Manager;

const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "heic", "heif", "png", "tif", "tiff", "webp"];

#[derive(Debug, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScannedImage {
    name: String,
    path: String,
    date_time_original: Option<String>,
    sub_sec_time_original: Option<String>,
    offset_time_original: Option<String>,
    orientation: Option<u32>,
    /// Embedded EXIF thumbnail as a `data:` URL.
    thumbnail: Option<String>,
}

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn ascii_field(exif: &exif::Exif, tag: exif::Tag) -> Option<String> {
    let field = exif.get_field(tag, exif::In::PRIMARY)?;
    match &field.value {
        exif::Value::Ascii(parts) => parts
            .first()
            .map(|b| String::from_utf8_lossy(b).trim_end_matches('\0').trim().to_string())
            .filter(|s| !s.is_empty()),
        _ => None,
    }
}

fn read_metadata(path: &Path) -> ScannedImage {
    let mut img = ScannedImage {
        name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        ..Default::default()
    };
    let Ok(file) = fs::File::open(path) else { return img };
    let Ok(exif) = exif::Reader::new().read_from_container(&mut BufReader::new(file)) else { return img };

    img.date_time_original = ascii_field(&exif, exif::Tag::DateTimeOriginal).or_else(|| ascii_field(&exif, exif::Tag::DateTime));
    img.sub_sec_time_original = ascii_field(&exif, exif::Tag::SubSecTimeOriginal);
    img.offset_time_original = ascii_field(&exif, exif::Tag::OffsetTimeOriginal);
    img.orientation = exif
        .get_field(exif::Tag::Orientation, exif::In::PRIMARY)
        .and_then(|f| f.value.get_uint(0));

    let thumb_offset = exif
        .get_field(exif::Tag::JPEGInterchangeFormat, exif::In::THUMBNAIL)
        .and_then(|f| f.value.get_uint(0));
    let thumb_len = exif
        .get_field(exif::Tag::JPEGInterchangeFormatLength, exif::In::THUMBNAIL)
        .and_then(|f| f.value.get_uint(0));
    if let (Some(off), Some(len)) = (thumb_offset, thumb_len) {
        let (off, len) = (off as usize, len as usize);
        if let Some(bytes) = exif.buf().get(off..off.saturating_add(len)) {
            if bytes.starts_with(&[0xFF, 0xD8]) {
                let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
                img.thumbnail = Some(format!("data:image/jpeg;base64,{b64}"));
            }
        }
    }
    img
}

pub fn scan_dir(dir: &Path) -> Result<Vec<ScannedImage>, String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let mut paths: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file() && is_image(p))
        .filter(|p| !p.file_name().map(|n| n.to_string_lossy().starts_with('.')).unwrap_or(true))
        .collect();
    paths.sort();
    Ok(paths.iter().map(|p| read_metadata(p)).collect())
}

/// Resolves `name` inside `dir`, refusing anything that could escape the folder.
fn child(dir: &Path, name: &str) -> Result<PathBuf, String> {
    let ok = !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains('\0');
    if !ok {
        return Err(format!("invalid file name: {name:?}"));
    }
    Ok(dir.join(name))
}

pub fn rename_in(dir: &Path, from: &str, to: &str) -> Result<String, String> {
    let src = child(dir, from)?;
    let dst = child(dir, to)?;
    if from == to {
        return Ok(to.to_string());
    }
    if !src.is_file() {
        return Err(format!("{from} no longer exists"));
    }
    // A case-only change (a.jpg → A.jpg) on a case-insensitive volume points at the same file.
    let same_file = from.eq_ignore_ascii_case(to)
        && fs::canonicalize(&src).ok().is_some_and(|a| fs::canonicalize(&dst).ok() == Some(a));
    if dst.exists() && !same_file {
        return Err(format!("{to} already exists"));
    }
    fs::rename(&src, &dst).map_err(|e| format!("could not rename {from}: {e}"))?;
    Ok(to.to_string())
}

pub fn read_text_in(dir: &Path, name: &str) -> Result<Option<String>, String> {
    let path = child(dir, name)?;
    match fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("could not read {name}: {e}")),
    }
}

/// Writes atomically (temp file + rename) so a crash never leaves a half-written sidecar.
pub fn write_text_in(dir: &Path, name: &str, contents: &str) -> Result<(), String> {
    let path = child(dir, name)?;
    let tmp = child(dir, &format!("{name}.tmp"))?;
    let mut f = fs::File::create(&tmp).map_err(|e| format!("could not write {name}: {e}"))?;
    f.write_all(contents.as_bytes())
        .and_then(|_| f.sync_all())
        .map_err(|e| format!("could not write {name}: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("could not write {name}: {e}"))
}

#[tauri::command]
async fn scan_folder(app: tauri::AppHandle, dir: String) -> Result<Vec<ScannedImage>, String> {
    let path = PathBuf::from(&dir);
    // Let the webview load full-size images from this folder via the asset protocol.
    app.asset_protocol_scope()
        .allow_directory(&path, false)
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || scan_dir(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn rename_file(dir: String, from: String, to: String) -> Result<String, String> {
    rename_in(Path::new(&dir), &from, &to)
}

#[tauri::command]
fn read_text_file(dir: String, name: String) -> Result<Option<String>, String> {
    read_text_in(Path::new(&dir), &name)
}

#[tauri::command]
fn write_text_file(dir: String, name: String, contents: String) -> Result<(), String> {
    write_text_in(Path::new(&dir), &name, &contents)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![scan_folder, rename_file, read_text_file, write_text_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_images() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../test-images")
    }

    #[test]
    fn scans_sample_photos_with_exif() {
        let images = scan_dir(&test_images()).unwrap();
        assert_eq!(images.len(), 31);
        let first = images.iter().find(|i| i.name.ends_with("0271.jpg")).unwrap();
        assert_eq!(first.date_time_original.as_deref(), Some("2026:10:04 14:48:07"));
        assert_eq!(first.sub_sec_time_original.as_deref(), Some("54"));
        assert_eq!(first.offset_time_original.as_deref(), Some("-08:00"));
    }

    #[test]
    fn matches_extensions_case_insensitively() {
        assert!(is_image(Path::new("a.JPG")));
        assert!(is_image(Path::new("a.jpeg")));
        assert!(!is_image(Path::new("a.json")));
    }

    #[test]
    fn renames_without_overwriting() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.JPG"), b"a").unwrap();
        fs::write(dir.path().join("b.jpg"), b"b").unwrap();
        assert_eq!(rename_in(dir.path(), "a.JPG", "a_Enric-Umbert.JPG").unwrap(), "a_Enric-Umbert.JPG");
        assert!(dir.path().join("a_Enric-Umbert.JPG").exists());
        assert!(rename_in(dir.path(), "a_Enric-Umbert.JPG", "b.jpg").is_err());
        assert!(rename_in(dir.path(), "b.jpg", "../escape.jpg").is_err());
        assert!(rename_in(dir.path(), "missing.jpg", "x.jpg").is_err());
    }

    #[test]
    fn sidecar_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_text_in(dir.path(), ".dh-photo-tagger.json").unwrap(), None);
        write_text_in(dir.path(), ".dh-photo-tagger.json", "{}").unwrap();
        assert_eq!(read_text_in(dir.path(), ".dh-photo-tagger.json").unwrap().as_deref(), Some("{}"));
    }
}
