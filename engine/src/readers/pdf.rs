//! PDFs, page by page, through PDFKit. A page's text is one passage (or more, for a dense page), embedded with the
//! document's title; the page number is where a result opens.

use super::text::{mostly_numbers, passages};
use super::{title_of, Payload, Piece, Sink};
use crate::embedder::prompts;
use crate::store::Segment;
use anyhow::{bail, Result};
use objc2::rc::autoreleasepool;
use objc2::AllocAnyThread;
use objc2_foundation::{NSString, NSURL};
use objc2_pdf_kit::PDFDocument;
use std::path::Path;

/// Pages read from one PDF, at most.
pub const MAX_PAGES: usize = 5000;

/// A page with fewer characters than this has no real text layer: it's a scan (read by OCR, when that's there).
pub const SCANNED_BELOW: usize = 40;

pub fn open(path: &Path) -> Result<objc2::rc::Retained<PDFDocument>> {
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    let Some(document) = (unsafe { PDFDocument::initWithURL(PDFDocument::alloc(), &url) }) else {
        bail!("PDFKit can't open it");
    };
    if unsafe { document.isLocked() } {
        bail!("it's password protected");
    }
    Ok(document)
}

pub fn read(path: &Path, sink: Sink) -> Result<serde_json::Value> {
    let document = open(path)?;
    let title = title_of(path);
    let pages = unsafe { document.pageCount() };
    let mut scanned = Vec::new();
    for index in 0..pages.min(MAX_PAGES) {
        let text = autoreleasepool(|_| unsafe {
            document.pageAtIndex(index).and_then(|page| page.string()).map(|s| s.to_string()).unwrap_or_default()
        });
        let number = (index + 1) as f64;
        if text.trim().chars().count() < SCANNED_BELOW {
            scanned.push(index + 1);
            continue;
        }
        for passage in passages(&text) {
            let payload = if mostly_numbers(&passage.text) {
                Payload::None
            } else {
                Payload::Text(prompts::document(Some(&title), &passage.text))
            };
            sink(Piece { segment: Segment::Page, loc: Some(number), loc_end: None, text: Some(passage.text), payload })?;
        }
    }
    Ok(serde_json::json!({ "pages": pages, "scanned_pages": scanned.len() }))
}
