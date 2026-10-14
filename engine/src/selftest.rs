//! `sift selftest`: the vectors this build makes for fixed inputs, against reference vectors made by a known-good
//! pipeline (tests/reference). Any change to llama.cpp, the model files, the image sizing or the prompts must still
//! pass this, or an existing index would no longer agree with new queries.

use crate::embedder::{dot, prompts, Decoded, Embedder, ModelFiles};
use crate::imaging;
use anyhow::{bail, Context, Result};
use std::collections::BTreeMap;
use std::path::Path;

/// Runtimes that agree measure ≥ 0.999; less is a change people would see in their results.
const AGREEMENT: f32 = 0.999;

pub fn run(models: &ModelFiles, folder: &Path) -> Result<()> {
    let reference: serde_json::Value = serde_json::from_slice(
        &std::fs::read(folder.join("vectors.json")).with_context(|| format!("no vectors.json in {}", folder.display()))?,
    )?;
    let expected: BTreeMap<String, Vec<f32>> = serde_json::from_value(reference["vectors"].clone())?;

    let started = std::time::Instant::now();
    let mut embedder = Embedder::load(models, false)?;
    eprintln!("model loaded in {:.2} s", started.elapsed().as_secs_f64());

    let long = (1..=60)
        .map(|n| {
            format!(
                "Note {n}: the review moved to room {} because the projector in the main hall failed again, and the \
                 team agreed to send the slides the night before.",
                n % 7 + 2
            )
        })
        .collect::<Vec<_>>()
        .join(" ");
    let texts = [
        ("query", prompts::query("payment declined error")),
        ("query-bn", prompts::query("ইলিশ মাছ রান্না")),
        ("query-ar", prompts::query("متى تغلق المكتبة")),
        (
            "document",
            prompts::document(
                Some("Tokyo itinerary"),
                "Flight to Tokyo Haneda on November 3. Then the train to Kamakura to see the Great Buddha, and back \
                 for dinner in Shibuya.",
            ),
        ),
        ("document-long", prompts::document(None, &long)),
    ];
    let mut made: BTreeMap<String, Vec<f32>> = BTreeMap::new();
    let started = std::time::Instant::now();
    let vectors = embedder.embed_texts(&texts.iter().map(|(_, t)| t.as_str()).collect::<Vec<_>>())?;
    eprintln!("5 texts in {:.0} ms", started.elapsed().as_secs_f64() * 1000.0);
    for ((name, _), vector) in texts.iter().zip(vectors) {
        made.insert(name.to_string(), vector);
    }

    for (name, file, budget) in [("screen-280", "screen.png", 280), ("photo-140", "photo.jpg", 140), ("frame-70", "photo.jpg", 70)] {
        let Decoded::Image(image) = embedder.decode_with_mtmd(&folder.join(file))? else { bail!("{file} isn't an image") };
        let started = std::time::Instant::now();
        let vector = embedder.embed_image(&imaging::fit(&image, budget)?)?;
        eprintln!("{name} in {:.0} ms", started.elapsed().as_secs_f64() * 1000.0);
        made.insert(name.into(), vector);
    }
    let Decoded::Audio(samples) = embedder.decode_with_mtmd(&folder.join("speech.wav"))? else { bail!("speech.wav isn't audio") };
    let started = std::time::Instant::now();
    made.insert("speech".into(), embedder.embed_audio(&samples)?);
    eprintln!("speech ({:.1} s of audio) in {:.0} ms", samples.len() as f64 / 16000.0, started.elapsed().as_secs_f64() * 1000.0);

    let mut worst = 1.0f32;
    for (name, vector) in &made {
        let Some(reference) = expected.get(name) else { bail!("no reference vector for {name}") };
        let cosine = dot(vector, reference);
        worst = worst.min(cosine);
        println!("{name:<14} cosine {cosine:.5}{}", if cosine < AGREEMENT { "  ✗" } else { "" });
    }
    if worst < AGREEMENT {
        bail!("vectors differ from the reference (worst cosine {worst:.5} < {AGREEMENT})");
    }
    println!("all vectors match the reference (worst cosine {worst:.5})");
    Ok(())
}
