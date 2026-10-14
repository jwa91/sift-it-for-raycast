mod av;
mod config;
mod daemon;
mod crawl;
mod embedder;
mod eval;
mod imaging;
mod indexer;
mod llama;
mod mac;
mod models;
mod power;
mod preview;
mod readers;
mod search;
mod selftest;
mod serve;
mod service;
mod store;

use anyhow::{bail, Result};
use clap::{Parser, Subcommand};
use config::Config;
use crawl::Kind;
use std::path::PathBuf;

/// Sift: search your files by what's in them, with EmbeddingGemma 2 on this Mac.
#[derive(Parser)]
#[command(name = "sift", version)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// The folders to index
    Folders {
        #[command(subcommand)]
        action: Option<FolderAction>,
    },
    /// Change an option: include-code, index-on-battery (true or false), exclude-ext (comma-separated)
    Config { key: Option<String>, value: Option<String> },
    /// Bring the index up to date with the folders, then exit
    Index {
        /// JSON lines instead of text
        #[arg(long)]
        json: bool,
        /// Drop every vector and embed everything again
        #[arg(long)]
        reindex: bool,
    },
    /// Search the index
    Search {
        words: Vec<String>,
        /// Only these kinds: text, doc, pdf, image, screenshot, audio, video, code
        #[arg(long, value_delimiter = ',')]
        kind: Vec<String>,
        #[arg(short = 'n', default_value_t = 10)]
        limit: usize,
        /// Exact words only, without the model
        #[arg(long)]
        words_only: bool,
        #[arg(long)]
        json: bool,
    },
    /// Answer searches over stdin/stdout (JSON lines), for the Raycast extension
    Serve,
    /// Keep the index up to date in the background, watching the folders for changes
    Daemon,
    /// The background indexer as a LaunchAgent (starts at login)
    Service {
        #[command(subcommand)]
        action: ServiceAction,
    },
    /// What's in the index
    Status {
        #[arg(long)]
        json: bool,
    },
    /// The model files
    Model {
        #[command(subcommand)]
        action: ModelAction,
    },
    /// Measure search against known answers (scripts/evals.json on the testbed)
    Eval {
        file: PathBuf,
        /// Show each query's top results with their scores
        #[arg(short, long)]
        verbose: bool,
    },
    /// Print the query vectors of these queries, one JSON array per line (for analysis)
    #[command(hide = true)]
    EmbedQuery { queries: Vec<String> },
    /// Check that this build makes the reference vectors
    Selftest {
        /// The folder with vectors.json and its inputs
        #[arg(default_value = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/reference"))]
        folder: PathBuf,
    },
}

#[derive(Subcommand)]
enum FolderAction {
    /// Add folders to index
    Add { paths: Vec<String> },
    /// Stop indexing folders (what was indexed from them leaves at the next sync)
    Remove { paths: Vec<String> },
    /// Skip a folder inside the indexed ones
    Exclude { paths: Vec<String> },
    /// Stop skipping a folder
    Include { paths: Vec<String> },
}

#[derive(Subcommand)]
enum ServiceAction {
    /// Install and start it
    Install,
    /// Stop and remove it
    Uninstall,
    /// Whether it's installed and running
    Status,
    /// Print the LaunchAgent plist it would install
    Plist,
}

#[derive(Subcommand)]
enum ModelAction {
    /// Whether the model files are there
    Status,
    /// Download the model files (865 MB, once)
    Download {
        #[arg(long)]
        json: bool,
    },
}

fn main() {
    if let Err(error) = run(Cli::parse()) {
        eprintln!("sift: {error:#}");
        std::process::exit(1);
    }
}

fn run(cli: Cli) -> Result<()> {
    match cli.command {
        Command::Folders { action } => folders(action),
        Command::Config { key, value } => set_option(key, value),
        Command::Index { json, reindex } => index(json, reindex),
        Command::Search { words, kind, limit, words_only, json } => {
            search_once(&words.join(" "), &kind, limit, words_only, json)
        }
        Command::Serve => serve::serve(&config::index_path(), &config::models_dir()),
        Command::Daemon => daemon::run(),
        Command::Service { action } => match action {
            ServiceAction::Install => service::install(),
            ServiceAction::Uninstall => service::uninstall(),
            ServiceAction::Status => service::status(),
            ServiceAction::Plist => {
                print!("{}", service::plist()?);
                Ok(())
            }
        },
        Command::Status { json } => status(json),
        Command::Model { action } => match action {
            ModelAction::Status => {
                println!("{}", serde_json::to_string_pretty(&models::status(&config::models_dir()))?);
                Ok(())
            }
            ModelAction::Download { json } => models::download(&config::models_dir(), &mut |progress| {
                if json {
                    println!("{}", serde_json::to_string(&progress).unwrap());
                } else if let models::Progress::Downloading { file, done, total } = progress {
                    eprint!("\r{file}: {} of {} MB   ", done >> 20, total >> 20);
                } else if let models::Progress::Ready { file } = progress {
                    eprintln!("\r{file}: ready{:20}", "");
                }
            }),
        },
        Command::Eval { file, verbose } => {
            let mut searcher = search::Searcher::open(&config::index_path())?;
            let files = embedder::ModelFiles::in_folder(&config::models_dir())?;
            let mut encoder = embedder::Embedder::load(&files, true)?;
            eval::run(&file, &mut searcher, &mut encoder, verbose)
        }
        Command::EmbedQuery { queries } => {
            let files = embedder::ModelFiles::in_folder(&config::models_dir())?;
            let mut encoder = embedder::Embedder::load(&files, true)?;
            for query in queries {
                println!("{}", serde_json::to_string(&encoder.embed_text(&embedder::prompts::query(&query))?)?);
            }
            Ok(())
        }
        Command::Selftest { folder } => {
            let models = embedder::ModelFiles::in_folder(&config::models_dir())?;
            selftest::run(&models, &folder)
        }
    }
}

fn folders(action: Option<FolderAction>) -> Result<()> {
    let mut config = Config::load()?;
    match action {
        None => {}
        Some(FolderAction::Add { paths }) => {
            for path in paths {
                let path = config::expand(&path);
                if !path.is_dir() {
                    bail!("not a folder: {}", path.display());
                }
                if !config.folders.contains(&path) {
                    config.folders.push(path);
                }
            }
            config.save()?;
        }
        Some(FolderAction::Remove { paths }) => {
            for path in paths {
                let path = config::expand(&path);
                config.folders.retain(|folder| folder != &path);
                config.excluded.retain(|folder| !folder.starts_with(&path));
            }
            config.save()?;
        }
        Some(FolderAction::Include { paths }) => {
            for path in paths {
                let path = config::expand(&path);
                config.excluded.retain(|folder| folder != &path);
            }
            config.save()?;
        }
        Some(FolderAction::Exclude { paths }) => {
            for path in paths {
                let path = config::expand(&path);
                if !config.excluded.contains(&path) {
                    config.excluded.push(path);
                }
            }
            config.save()?;
        }
    }
    println!("{}", serde_json::to_string_pretty(&config)?);
    Ok(())
}

fn set_option(key: Option<String>, value: Option<String>) -> Result<()> {
    let mut config = Config::load()?;
    if let (Some(key), Some(value)) = (key.as_deref(), value.as_deref()) {
        let flag = || match value {
            "true" | "on" | "yes" | "1" => Ok(true),
            "false" | "off" | "no" | "0" => Ok(false),
            _ => Err(anyhow::anyhow!("{key} takes true or false")),
        };
        match key {
            "include-code" => config.include_code = flag()?,
            "index-on-battery" => config.index_on_battery = flag()?,
            "exclude-ext" => {
                config.excluded_extensions = value
                    .split(',')
                    .map(|e| e.trim().trim_start_matches('.').to_lowercase())
                    .filter(|e| !e.is_empty())
                    .collect()
            }
            _ => bail!("no option {key}: include-code, index-on-battery, exclude-ext"),
        }
        config.save()?;
    } else if key.is_some() {
        bail!("which value?");
    }
    println!("{}", serde_json::to_string_pretty(&config)?);
    Ok(())
}

fn index(json: bool, reindex: bool) -> Result<()> {
    let config = Config::load()?;
    if config.folders.is_empty() {
        bail!("no folders to index: add some with `sift folders add <folder>`");
    }
    // Two indexers would read the same files: let the running one do it.
    if let Some(pid) = daemon::running_pid() {
        if reindex {
            bail!("the background indexer is running (pid {pid}); stop it before --reindex");
        }
        unsafe { libc::kill(pid, libc::SIGUSR1) };
        eprintln!("the background indexer (pid {pid}) is looking for changes now");
        return Ok(());
    }
    let store = store::Store::open(&config::index_path())?;
    if reindex {
        store.requeue_all()?;
    }
    let mut indexer = indexer::Indexer::new(store, config::models_dir());
    let mut report = |event: indexer::Event| {
        if json {
            println!("{}", serde_json::to_string(&event).unwrap());
            return;
        }
        match event {
            indexer::Event::Sync { files, added, changed, removed, pending, ms, .. } => eprintln!(
                "{files} files in the folders ({added} new, {changed} changed, {removed} gone), {pending} to index ({ms} ms)"
            ),
            indexer::Event::Started { pending } => eprintln!("indexing {pending} files…"),
            indexer::Event::Queued { count } => eprintln!("{count} more files joined the queue"),
            indexer::Event::File { path, segments, vectors, ms, .. } => {
                eprintln!("  {path}: {segments} segments, {vectors} vectors, {ms} ms")
            }
            indexer::Event::Failed { path, error } => eprintln!("  {path}: {error}"),
            indexer::Event::Finished { indexed, failed, seconds, .. } => {
                eprintln!("{indexed} files indexed, {failed} failed, in {seconds:.1} s")
            }
        }
    };
    let sync = indexer.sync(&config)?;
    report(sync);
    indexer.index_pending(&config, &mut report, &|| false, &mut Vec::new)
}

fn search_once(q: &str, kinds: &[String], limit: usize, words_only: bool, json: bool) -> Result<()> {
    let kinds = kinds
        .iter()
        .map(|name| Kind::parse(name).ok_or_else(|| anyhow::anyhow!("no such kind: {name}")))
        .collect::<Result<Vec<_>>>()?;
    let mut searcher = search::Searcher::open(&config::index_path())?;
    let vector = if words_only {
        None
    } else {
        let files = embedder::ModelFiles::in_folder(&config::models_dir())?;
        let mut encoder = embedder::Embedder::load(&files, true)?;
        Some(encoder.embed_text(&embedder::prompts::query(q))?)
    };
    let request = search::Request { q: q.to_string(), kinds, limit, prefix_last: false };
    let response = searcher.search(&request, vector.as_deref())?;
    if json {
        println!("{}", serde_json::to_string_pretty(&response)?);
        return Ok(());
    }
    for hit in &response.hits {
        let at = match (hit.segment, hit.loc) {
            (store::Segment::Page, Some(page)) => format!(" p.{page}"),
            (store::Segment::Passage, Some(line)) => format!(" line {line}"),
            (store::Segment::Sound | store::Segment::Frame, Some(seconds)) => {
                format!(" at {}:{:02}", seconds as u64 / 60, seconds as u64 % 60)
            }
            _ => String::new(),
        };
        println!(
            "{:>5.2}{} {}{}  [{}{}]",
            hit.score,
            if hit.strong { " " } else { "?" },
            hit.path,
            at,
            hit.segment.as_str(),
            if hit.words { ", words" } else { "" }
        );
        if let Some(excerpt) = &hit.excerpt {
            println!("        {}", excerpt.replace('\n', " ").chars().take(160).collect::<String>());
        }
    }
    eprintln!("({} results, {:.1} ms)", response.hits.len(), response.ms);
    Ok(())
}

fn status(json: bool) -> Result<()> {
    let store = store::Store::open(&config::index_path())?;
    let stats = store.stats()?;
    let config = Config::load()?;
    let models = models::status(&config::models_dir());
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "index": config::index_path().display().to_string(),
                "stats": stats,
                "config": config,
                "models": models,
            }))?
        );
        return Ok(());
    }
    println!("index:   {}", config::index_path().display());
    println!("files:   {} ({} indexed, {} waiting, {} unreadable)", stats.files, stats.done, stats.pending, stats.failed);
    println!("vectors: {} in {} segments", stats.vectors, stats.segments);
    let mut kinds: Vec<_> = stats.by_kind.iter().collect();
    kinds.sort();
    println!("kinds:   {}", kinds.iter().map(|(k, n)| format!("{k} {n}")).collect::<Vec<_>>().join(", "));
    println!("folders: {}", config.folders.iter().map(|f| f.display().to_string()).collect::<Vec<_>>().join(", "));
    println!("model:   {}", if models.media { "ready" } else if models.text { "text only" } else { "not downloaded" });
    Ok(())
}
