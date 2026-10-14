mod config;
mod embedder;
mod imaging;
mod llama;
mod selftest;

use anyhow::Result;
use clap::{Parser, Subcommand};
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
    /// Check that this build makes the reference vectors
    Selftest {
        /// The folder with vectors.json and its inputs
        #[arg(default_value = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/reference"))]
        folder: PathBuf,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Selftest { folder } => {
            let models = embedder::ModelFiles::in_folder(&config::models_dir())?;
            selftest::run(&models, &folder)
        }
    }
}
