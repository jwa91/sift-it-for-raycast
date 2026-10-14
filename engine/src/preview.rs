//! Preview images for search results: a picture's thumbnail, a PDF page, a video frame.

use anyhow::{bail, Result};
use std::path::{Path, PathBuf};

pub fn render(path: &Path, kind: &str, _loc: Option<f64>, _size: u32, _folder: &Path) -> Result<PathBuf> {
    bail!("no preview for {kind} files yet: {}", path.display())
}
