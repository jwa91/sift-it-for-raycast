//! Hybrid search: meaning (the model's vectors) and exact words (the full-text index), one result per file.
//!
//! Meaning: every vector is scored against the query (one matrix-vector product), and each score is put on its
//! modality's scale: how many standard deviations it stands above the typical score of a passage, a picture or a stretch
//! of sound for this query. That's what lets a photo compete with a page of text (a query lands nearer to text than to
//! a picture that matches it as well), and it gives an honest "nothing found": when nothing stands out, nothing is
//! shown.
//!
//! Words: a segment with every word of the query (the last one as a prefix, while typing) gets a bonus, since no vector
//! holds an invoice number or a name exactly.

use crate::crawl::Kind;
use crate::embedder::DIM;
use crate::store::{blob_to_vector, Modality, Segment, Store};
use anyhow::Result;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// A meaning match must stand this far above its modality's typical score to be shown at all...
const WEAK_GATE: f32 = 2.0;
/// ...and this far to count as a strong one (weaker matches are shown after them, apart).
const STRONG_GATE: f32 = 3.0;
/// The bonus for containing all of the query's words, in the same units.
const WORD_BONUS: f32 = 2.5;
/// Below this many vectors of a modality, its scores' spread is a guess: borrow the overall one.
const MIN_FOR_STATS: usize = 30;

#[link(name = "Accelerate", kind = "framework")]
unsafe extern "C" {
    fn cblas_sgemv(
        order: i32, trans: i32, m: i32, n: i32, alpha: f32, a: *const f32, lda: i32, x: *const f32, incx: i32,
        beta: f32, y: *mut f32, incy: i32,
    );
}
const ROW_MAJOR: i32 = 101;
const NO_TRANS: i32 = 111;

#[derive(Debug, Clone, Deserialize, Default)]
pub struct Request {
    #[serde(default)]
    pub q: String,
    /// Only these kinds of file (all when empty).
    #[serde(default)]
    pub kinds: Vec<Kind>,
    #[serde(default = "default_limit")]
    pub limit: usize,
    /// Match the last word as a prefix (the user is still typing it).
    #[serde(default)]
    pub prefix_last: bool,
}

fn default_limit() -> usize {
    40
}

#[derive(Debug, Clone, Serialize)]
pub struct Hit {
    pub path: String,
    pub name: String,
    pub kind: Kind,
    /// The segment that matched best: where the result opens.
    pub segment: Segment,
    pub segment_id: i64,
    pub loc: Option<f64>,
    pub loc_end: Option<f64>,
    pub score: f32,
    /// How far the meaning match stands out (None without a query vector, or for a segment without one).
    pub z: Option<f32>,
    pub cosine: Option<f32>,
    /// All of the query's words are in it.
    pub words: bool,
    pub strong: bool,
    pub excerpt: Option<String>,
    pub modified: f64,
    pub size: u64,
    pub info: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct Response {
    pub hits: Vec<Hit>,
    /// Meaning was part of this search (false: words only).
    pub meaning: bool,
    pub ms: f64,
}

pub struct Searcher {
    store: Store,
    ids: Vec<i64>,
    rows: HashMap<i64, usize>,
    files: Vec<i64>,
    modalities: Vec<Modality>,
    matrix: Vec<f32>,
    file_kinds: HashMap<i64, Kind>,
    data_version: i64,
    max_id: i64,
}

impl Searcher {
    pub fn open(path: &Path) -> Result<Self> {
        let store = Store::open_readonly(path)?;
        let mut searcher = Self {
            store,
            ids: Vec::new(),
            rows: HashMap::new(),
            files: Vec::new(),
            modalities: Vec::new(),
            matrix: Vec::new(),
            file_kinds: HashMap::new(),
            data_version: -1,
            max_id: 0,
        };
        searcher.refresh()?;
        Ok(searcher)
    }

    pub fn vector_count(&self) -> usize {
        self.ids.len()
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    /// Catches up with the indexer's commits: only the new vectors when nothing was removed, all of them otherwise.
    pub fn refresh(&mut self) -> Result<bool> {
        let version = self.store.data_version()?;
        if version == self.data_version {
            return Ok(false);
        }
        self.data_version = version;
        let kept: i64 = self.store.conn.query_row(
            "SELECT COUNT(*) FROM segments WHERE vector IS NOT NULL AND id <= ?1",
            [self.max_id],
            |row| row.get(0),
        )?;
        if kept as usize != self.ids.len() {
            self.ids.clear();
            self.rows.clear();
            self.files.clear();
            self.modalities.clear();
            self.matrix.clear();
            self.max_id = 0;
        }
        let mut statement = self.store.conn.prepare(
            "SELECT id, file_id, segment, vector FROM segments WHERE vector IS NOT NULL AND id > ?1 ORDER BY id",
        )?;
        let mut rows = statement.query([self.max_id])?;
        while let Some(row) = rows.next()? {
            let id: i64 = row.get(0)?;
            let segment = Segment::parse(&row.get::<_, String>(2)?).unwrap_or(Segment::Passage);
            let blob = row.get_ref(3)?.as_blob()?;
            if blob.len() != DIM * 4 {
                continue;
            }
            self.rows.insert(id, self.ids.len());
            self.ids.push(id);
            self.files.push(row.get(1)?);
            self.modalities.push(segment.modality());
            blob_to_vector(blob, &mut self.matrix);
            self.max_id = self.max_id.max(id);
        }
        drop(rows);
        drop(statement);
        let mut statement = self.store.conn.prepare("SELECT id, kind FROM files")?;
        self.file_kinds = statement
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))?
            .filter_map(|row| row.ok())
            .filter_map(|(id, kind)| Kind::parse(&kind).map(|kind| (id, kind)))
            .collect();
        Ok(true)
    }

    pub fn search(&mut self, request: &Request, query: Option<&[f32]>) -> Result<Response> {
        let started = std::time::Instant::now();
        self.refresh()?;
        let wanted = |kind: Kind| request.kinds.is_empty() || request.kinds.contains(&kind);

        // Meaning: every vector's standing for this query.
        let (cosines, z) = match query {
            Some(query) if !self.ids.is_empty() => {
                let cosines = self.scores(query);
                let z = self.standardize(&cosines);
                (cosines, z)
            }
            _ => (Vec::new(), Vec::new()),
        };

        // Each segment's score: its meaning standing (when it clears the gate), plus the bonus for the words.
        let mut segment_scores: HashMap<i64, (f32, bool)> = HashMap::new();
        if !z.is_empty() {
            let mut candidates: Vec<usize> = (0..z.len()).filter(|&i| z[i] >= WEAK_GATE).collect();
            candidates.sort_by(|&a, &b| z[b].total_cmp(&z[a]));
            for i in candidates.into_iter().take(2000) {
                segment_scores.insert(self.ids[i], (z[i], false));
            }
        }
        let words = words_of(&request.q);
        if !words.is_empty() {
            let matches = self.word_matches(&words, request.prefix_last, 500)?;
            let count = matches.len().max(1) as f32;
            for (rank, id) in matches.into_iter().enumerate() {
                let standing = self.rows.get(&id).and_then(|&row| z.get(row)).copied().unwrap_or(0.0).max(0.0);
                // Earlier in the full-text ranking breaks ties.
                let score = WORD_BONUS + standing + 0.5 * (1.0 - rank as f32 / count);
                let entry = segment_scores.entry(id).or_insert((0.0, true));
                *entry = (entry.0.max(score), true);
            }
        }

        // One result per file: its best segment.
        let mut best: HashMap<i64, (i64, f32, bool)> = HashMap::new();
        for (&segment_id, &(score, words)) in &segment_scores {
            let file_id = match self.rows.get(&segment_id) {
                Some(&row) => self.files[row],
                None => match self.file_of(segment_id)? {
                    Some(file_id) => file_id,
                    None => continue,
                },
            };
            if !self.file_kinds.get(&file_id).is_some_and(|&kind| wanted(kind)) {
                continue;
            }
            let entry = best.entry(file_id).or_insert((segment_id, f32::MIN, false));
            if score > entry.1 {
                *entry = (segment_id, score, words || entry.2);
            } else {
                entry.2 |= words;
            }
        }
        let mut ranked: Vec<(i64, i64, f32, bool)> =
            best.into_iter().map(|(file, (segment, score, words))| (file, segment, score, words)).collect();
        ranked.sort_by(|a, b| b.2.total_cmp(&a.2));
        ranked.truncate(request.limit);

        let mut hits = Vec::with_capacity(ranked.len());
        for (_, segment_id, score, has_words) in ranked {
            let row = self.rows.get(&segment_id).copied();
            let z_value = row.and_then(|r| z.get(r)).copied();
            let cosine = row.and_then(|r| cosines.get(r)).copied();
            if let Some(mut hit) = self.hit(segment_id, &words)? {
                hit.score = score;
                hit.z = z_value;
                hit.cosine = cosine;
                hit.words = has_words;
                hit.strong = has_words || z_value.is_some_and(|z| z >= STRONG_GATE);
                hits.push(hit);
            }
        }
        // Strong matches first, then the weaker ones, each by score.
        hits.sort_by(|a, b| b.strong.cmp(&a.strong).then(b.score.total_cmp(&a.score)));
        Ok(Response { hits, meaning: query.is_some(), ms: started.elapsed().as_secs_f64() * 1000.0 })
    }

    /// Recently changed files, for an empty query.
    pub fn recent(&self, request: &Request) -> Result<Response> {
        let mut statement = self.store.conn.prepare(
            "SELECT (SELECT MIN(id) FROM segments WHERE file_id = f.id), f.kind FROM files f
             WHERE f.state = 'done' ORDER BY f.modified DESC LIMIT ?1",
        )?;
        let candidates: Vec<(Option<i64>, String)> = statement
            .query_map([request.limit as i64 * 4], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<std::result::Result<_, _>>()?;
        let mut hits = Vec::new();
        for (segment_id, kind) in candidates {
            let Some(segment_id) = segment_id else { continue };
            let kind = Kind::parse(&kind).unwrap_or(Kind::Text);
            if !request.kinds.is_empty() && !request.kinds.contains(&kind) {
                continue;
            }
            if let Some(mut hit) = self.hit(segment_id, &[])? {
                hit.strong = true;
                hits.push(hit);
            }
            if hits.len() >= request.limit {
                break;
            }
        }
        Ok(Response { hits, meaning: false, ms: 0.0 })
    }

    /// Cosine similarity of every vector with the query.
    fn scores(&self, query: &[f32]) -> Vec<f32> {
        let n = self.ids.len();
        let mut scores = vec![0.0f32; n];
        unsafe {
            cblas_sgemv(
                ROW_MAJOR, NO_TRANS, n as i32, DIM as i32, 1.0, self.matrix.as_ptr(), DIM as i32, query.as_ptr(), 1,
                0.0, scores.as_mut_ptr(), 1,
            );
        }
        scores
    }

    /// Each score as standard deviations above its modality's mean for this query.
    fn standardize(&self, scores: &[f32]) -> Vec<f32> {
        let mut sums: HashMap<Modality, (f64, f64, usize)> = HashMap::new();
        let mut total = (0.0f64, 0.0f64, 0usize);
        for (score, modality) in scores.iter().zip(&self.modalities) {
            let s = *score as f64;
            let entry = sums.entry(*modality).or_default();
            entry.0 += s;
            entry.1 += s * s;
            entry.2 += 1;
            total.0 += s;
            total.1 += s * s;
            total.2 += 1;
        }
        let stats = |(sum, squares, count): (f64, f64, usize)| {
            let mean = sum / count.max(1) as f64;
            let variance = (squares / count.max(1) as f64 - mean * mean).max(0.0);
            (mean as f32, (variance.sqrt() as f32).max(0.02))
        };
        let overall = stats(total);
        let per_modality: HashMap<Modality, (f32, f32)> = sums
            .into_iter()
            .map(|(modality, sums)| {
                let (mean, spread) = stats(sums);
                // Few vectors of a kind: keep their own mean, but not a spread measured on a handful.
                (modality, if sums.2 >= MIN_FOR_STATS { (mean, spread) } else { (mean, spread.max(overall.1)) })
            })
            .collect();
        scores
            .iter()
            .zip(&self.modalities)
            .map(|(score, modality)| {
                let (mean, spread) = per_modality[modality];
                (score - mean) / spread
            })
            .collect()
    }

    /// Segments with every word, best first (FTS5's bm25).
    fn word_matches(&self, words: &[String], prefix_last: bool, limit: usize) -> Result<Vec<i64>> {
        let query = words
            .iter()
            .enumerate()
            .map(|(i, word)| {
                let quoted = format!("\"{}\"", word.replace('"', "\"\""));
                if prefix_last && i == words.len() - 1 { format!("{quoted}*") } else { quoted }
            })
            .collect::<Vec<_>>()
            .join(" ");
        let mut statement =
            self.store.conn.prepare_cached("SELECT rowid FROM words WHERE words MATCH ?1 ORDER BY rank LIMIT ?2")?;
        let ids = statement
            .query_map(params![query, limit as i64], |row| row.get(0))?
            .collect::<std::result::Result<Vec<i64>, _>>()?;
        Ok(ids)
    }

    fn file_of(&self, segment_id: i64) -> Result<Option<i64>> {
        Ok(self
            .store
            .conn
            .query_row("SELECT file_id FROM segments WHERE id = ?1", [segment_id], |row| row.get(0))
            .optional()?)
    }

    fn hit(&self, segment_id: i64, words: &[String]) -> Result<Option<Hit>> {
        let mut statement = self.store.conn.prepare_cached(
            "SELECT f.path, f.kind, f.modified, f.size, f.info, s.segment, s.loc, s.loc_end, s.text
             FROM segments s JOIN files f ON f.id = s.file_id WHERE s.id = ?1",
        )?;
        let hit = statement
            .query_row([segment_id], |row| {
                let path: String = row.get(0)?;
                let text: Option<String> = row.get(8)?;
                Ok(Hit {
                    name: Path::new(&path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                    path,
                    kind: Kind::parse(&row.get::<_, String>(1)?).unwrap_or(Kind::Text),
                    modified: row.get(2)?,
                    size: row.get::<_, i64>(3)? as u64,
                    info: row
                        .get::<_, Option<String>>(4)?
                        .and_then(|info| serde_json::from_str(&info).ok())
                        .unwrap_or(serde_json::Value::Null),
                    segment: Segment::parse(&row.get::<_, String>(5)?).unwrap_or(Segment::Passage),
                    segment_id,
                    loc: row.get(6)?,
                    loc_end: row.get(7)?,
                    excerpt: text.map(|text| excerpt(&text, words)),
                    score: 0.0,
                    z: None,
                    cosine: None,
                    words: false,
                    strong: false,
                })
            })
            .optional()?;
        Ok(hit)
    }
}

/// The query's words, as the full-text index splits them (letters and digits; everything else separates).
pub fn words_of(query: &str) -> Vec<String> {
    query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(|word| word.to_lowercase())
        .collect()
}

/// About 300 characters of the text, around the first of the query's words in it when there is one.
pub fn excerpt(text: &str, words: &[String]) -> String {
    const LENGTH: usize = 300;
    let text = text.trim();
    let lower = text.to_lowercase();
    // Lowercasing can change byte lengths; only trust a position that lands on a boundary in the original.
    let found = words
        .iter()
        .filter_map(|word| lower.find(word.as_str()))
        .min()
        .filter(|&position| text.is_char_boundary(position));
    let start = match found {
        Some(position) if position > LENGTH / 3 => {
            let mut start = position - LENGTH / 3;
            while !text.is_char_boundary(start) {
                start -= 1;
            }
            // Begin at a word.
            text[start..].find(char::is_whitespace).map(|space| start + space + 1).unwrap_or(start)
        }
        _ => 0,
    };
    let mut end = (start + LENGTH).min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    let mut excerpt = String::new();
    if start > 0 {
        excerpt.push('…');
    }
    excerpt.push_str(text[start..end].trim());
    if end < text.len() {
        excerpt.push('…');
    }
    excerpt
}
