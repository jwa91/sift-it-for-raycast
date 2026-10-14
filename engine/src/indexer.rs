//! Keeping the index in step with the chosen folders.
//!
//! `sync` crawls the folders and compares them with the index: new and changed files are queued, gone files leave.
//! `index_pending` then reads the queued files on a few worker threads, which stream their pieces to this thread, the
//! one that owns the model. Texts are embedded in batches; each file is written in one transaction once all of it is
//! in, so a search never sees half a file.

use crate::config::Config;
use crate::crawl::{self, Found, Kind};
use crate::embedder::{Embedder, ModelFiles};
use crate::readers::{self, Payload, Piece};
use crate::store::{FileRow, NewSegment, Store};
use anyhow::{anyhow, Result};
use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, TryRecvError};
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum Event {
    Sync { files: usize, added: usize, changed: usize, removed: usize, unavailable: Vec<String>, pending: usize, ms: u64 },
    Started { pending: usize },
    File { path: String, kind: Kind, segments: usize, vectors: usize, ms: u64 },
    Failed { path: String, error: String },
    Finished { indexed: usize, failed: usize, seconds: f64, stopped: bool },
}

enum Message {
    /// The first message about a file: when its reading started.
    Start(i64, Instant),
    Piece(i64, Piece),
    Done(i64, Result<serde_json::Value>),
}

/// A file being put together from its pieces.
struct Assembly {
    path: PathBuf,
    kind: Kind,
    started: Instant,
    segments: Vec<NewSegment>,
    /// Pieces whose vector failed: they stay in the keyword index.
    failures: usize,
}

pub struct Indexer {
    pub store: Store,
    models: PathBuf,
    embedder: Option<Embedder>,
}

impl Indexer {
    pub fn new(store: Store, models: PathBuf) -> Self {
        Self { store, models, embedder: None }
    }

    /// Frees the model (about 1 GB) until it's needed again.
    pub fn release_model(&mut self) {
        self.embedder = None;
    }

    pub fn model_loaded(&self) -> bool {
        self.embedder.is_some()
    }

    pub fn sync(&mut self, config: &Config) -> Result<Event> {
        let started = Instant::now();
        let crawl = crawl::crawl(config);
        let existing: HashMap<PathBuf, FileRow> =
            self.store.files()?.into_iter().map(|row| (row.path.clone(), row)).collect();
        let found_paths: HashSet<&PathBuf> = crawl.found.iter().map(|f| &f.path).collect();
        let (mut added, mut changed, mut removed) = (0, 0, 0);
        let transaction = self.store.conn.unchecked_transaction()?;
        for found in &crawl.found {
            match existing.get(&found.path) {
                None => {
                    self.store.queue(found, None)?;
                    added += 1;
                }
                Some(row) if is_changed(row, found) => {
                    self.store.queue(found, Some(row.id))?;
                    changed += 1;
                }
                Some(_) => {}
            }
        }
        for (path, row) in &existing {
            if found_paths.contains(path) || crawl.unavailable.iter().any(|root| path.starts_with(root)) {
                continue;
            }
            self.store.remove_file(row.id)?;
            removed += 1;
        }
        transaction.commit()?;
        let pending = self.store.stats()?.pending as usize;
        Ok(Event::Sync {
            files: crawl.found.len(),
            added,
            changed,
            removed,
            unavailable: crawl.unavailable.iter().map(|p| p.display().to_string()).collect(),
            pending,
            ms: started.elapsed().as_millis() as u64,
        })
    }

    /// Indexes every queued file. Stops between pieces when `stop` says so; files not finished stay queued.
    pub fn index_pending(&mut self, on_event: &mut dyn FnMut(Event), stop: &dyn Fn() -> bool) -> Result<()> {
        let pending = self.store.pending(usize::MAX)?;
        if pending.is_empty() {
            return Ok(());
        }
        let started = Instant::now();
        on_event(Event::Started { pending: pending.len() });
        if self.embedder.is_none() {
            let files = ModelFiles::in_folder(&self.models)?;
            self.embedder = Some(Embedder::load(&files, false)?);
        }

        let queue = Arc::new(Mutex::new(VecDeque::from(pending)));
        let cancelled = Arc::new(AtomicBool::new(false));
        let (sender, receiver) = sync_channel::<Message>(32);
        let workers = std::thread::available_parallelism().map(|n| (n.get() / 3).clamp(2, 4)).unwrap_or(2);
        let mut threads = Vec::new();
        let mut assemblies: HashMap<i64, Assembly> = HashMap::new();
        // Paths of the files handed out, for the assemblies (the worker sends only ids).
        let paths: HashMap<i64, (PathBuf, Kind)> =
            queue.lock().unwrap().iter().map(|row| (row.id, (row.path.clone(), row.kind))).collect();
        for _ in 0..workers {
            let queue = queue.clone();
            let cancelled = cancelled.clone();
            let sender = sender.clone();
            threads.push(std::thread::spawn(move || loop {
                if cancelled.load(Ordering::Relaxed) {
                    break;
                }
                let Some(row) = queue.lock().unwrap().pop_front() else { break };
                let id = row.id;
                if sender.send(Message::Start(id, Instant::now())).is_err() {
                    break;
                }
                let result = objc2::rc::autoreleasepool(|_| {
                    readers::read(&row.path, row.kind, &mut |piece| {
                        sender.send(Message::Piece(id, piece)).map_err(|_| anyhow!("indexing stopped"))
                    })
                });
                if sender.send(Message::Done(id, result)).is_err() {
                    break;
                }
            }));
        }
        drop(sender);

        let mut batch: Vec<(i64, Piece)> = Vec::new();
        let (mut indexed, mut failed) = (0usize, 0usize);
        let mut stopped = false;
        let mut next = receiver.recv().ok();
        while let Some(message) = next {
            if stop() {
                stopped = true;
                break;
            }
            match message {
                Message::Start(id, started) => {
                    let (path, kind) = paths[&id].clone();
                    assemblies.insert(id, Assembly { path, kind, started, segments: Vec::new(), failures: 0 });
                }
                Message::Piece(id, piece) => {
                    assemblies.entry(id).or_insert_with(|| {
                        let (path, kind) = paths[&id].clone();
                        Assembly { path, kind, started: Instant::now(), segments: Vec::new(), failures: 0 }
                    });
                    if matches!(piece.payload, Payload::Text(_)) {
                        batch.push((id, piece));
                        if batch.len() >= 16 {
                            self.embed_texts(&mut batch, &mut assemblies);
                        }
                    } else {
                        self.embed_texts(&mut batch, &mut assemblies);
                        let assembly = assemblies.get_mut(&id).expect("just made");
                        let segment = self.embed_piece(piece, assembly);
                        assembly.segments.push(segment);
                    }
                }
                Message::Done(id, result) => {
                    self.embed_texts(&mut batch, &mut assemblies);
                    let assembly = assemblies.remove(&id).unwrap_or_else(|| {
                        let (path, kind) = paths[&id].clone();
                        Assembly { path, kind, started: Instant::now(), segments: Vec::new(), failures: 0 }
                    });
                    match result {
                        Ok(info) => {
                            let vectors = assembly.segments.iter().filter(|s| s.vector.is_some()).count();
                            self.store.finish_file(id, &assembly.segments, &info)?;
                            indexed += 1;
                            on_event(Event::File {
                                path: assembly.path.display().to_string(),
                                kind: assembly.kind,
                                segments: assembly.segments.len(),
                                vectors,
                                ms: assembly.started.elapsed().as_millis() as u64,
                            });
                        }
                        Err(error) => {
                            let error = format!("{error:#}");
                            self.store.fail_file(id, &error)?;
                            failed += 1;
                            on_event(Event::Failed { path: assembly.path.display().to_string(), error });
                        }
                    }
                }
            }
            next = match receiver.try_recv() {
                Ok(message) => Some(message),
                Err(TryRecvError::Empty) => {
                    // Nothing waiting: embed what's batched rather than sit on it.
                    self.embed_texts(&mut batch, &mut assemblies);
                    receiver.recv().ok()
                }
                Err(TryRecvError::Disconnected) => None,
            };
        }
        cancelled.store(true, Ordering::Relaxed);
        drop(receiver);
        for thread in threads {
            let _ = thread.join();
        }
        on_event(Event::Finished { indexed, failed, seconds: started.elapsed().as_secs_f64(), stopped });
        Ok(())
    }

    /// Embeds the batched texts, one model call for up to 16 of them.
    fn embed_texts(&mut self, batch: &mut Vec<(i64, Piece)>, assemblies: &mut HashMap<i64, Assembly>) {
        if batch.is_empty() {
            return;
        }
        let pieces = std::mem::take(batch);
        let texts: Vec<&str> = pieces
            .iter()
            .map(|(_, piece)| match &piece.payload {
                Payload::Text(text) => text.as_str(),
                _ => "",
            })
            .collect();
        let embedder = self.embedder.as_mut().expect("model loaded");
        let vectors = embedder.embed_texts(&texts);
        let failed = vectors.is_err();
        let mut vectors = vectors.unwrap_or_default().into_iter();
        for (id, piece) in pieces {
            let Some(assembly) = assemblies.get_mut(&id) else { continue };
            if failed {
                assembly.failures += 1;
            }
            assembly.segments.push(NewSegment {
                segment: piece.segment,
                loc: piece.loc,
                loc_end: piece.loc_end,
                text: piece.text,
                vector: vectors.next(),
            });
        }
    }

    fn embed_piece(&mut self, piece: Piece, assembly: &mut Assembly) -> NewSegment {
        let embedder = self.embedder.as_mut().expect("model loaded");
        let vector = match &piece.payload {
            Payload::None | Payload::Text(_) => None,
            Payload::Image(image) => embedder.embed_image(image).ok(),
            Payload::Audio(samples) => embedder.embed_audio(samples).ok(),
        };
        if vector.is_none() && !matches!(piece.payload, Payload::None) {
            assembly.failures += 1;
        }
        NewSegment { segment: piece.segment, loc: piece.loc, loc_end: piece.loc_end, text: piece.text, vector }
    }
}

fn is_changed(row: &FileRow, found: &Found) -> bool {
    row.size != found.size || (row.modified - found.modified).abs() > 0.001 || row.kind != found.kind
}
