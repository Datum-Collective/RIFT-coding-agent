/**
 * Captions in @remotion/captions' Caption format, whatever their source. Narration-timed
 * captions are an estimate; a transcription provider (Whisper, AssemblyAI) replaces them by
 * supplying `captions.items` with real timings, and nothing downstream changes.
 */
import type { Caption, VideoSpec } from "../../spec/schema";
import { timeline } from "../../spec/timing";

const MAX_WORDS = 5;
// Breathing room so a caption never appears before its scene has settled or lingers past it.
const PAD_MS = 150;

export function buildCaptions(spec: VideoSpec): Caption[] {
  const captions = spec.captions;
  if (!captions?.enabled) return [];
  if (captions.source === "items") return captions.items ?? [];
  const fps = spec.format.fps;
  return timeline(spec).entries.flatMap((entry) => {
    if (!entry.scene.narration) return [];
    const phrases = splitPhrases(entry.scene.narration);
    const start = ((entry.from + entry.transitionIn) / fps) * 1000 + PAD_MS;
    const end = ((entry.from + entry.durationInFrames) / fps) * 1000 - PAD_MS;
    const weights = phrases.map((phrase) => wordCount(phrase) + 1);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return phrases.map((phrase, index) => {
      const before = weights
        .slice(0, index)
        .reduce((sum, weight) => sum + weight, 0);
      const startMs = Math.round(start + ((end - start) * before) / total);
      const endMs = Math.round(
        start + ((end - start) * (before + (weights[index] ?? 0))) / total,
      );
      return {
        text: phrase,
        startMs,
        endMs,
        timestampMs: startMs,
        confidence: null,
      };
    });
  });
}

/** Short, readable phrases that break at natural pauses and never run past five words. */
export function splitPhrases(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const phrases = words.reduce<string[][]>(
    (list, word) => {
      const current = list[list.length - 1] ?? [];
      const previous = current[current.length - 1];
      // A sentence end always breaks; a comma only once the phrase has two words, so no caption
      // is a lone word that flashes past too fast to read.
      const sentence = previous !== undefined && /[.!?]$/.test(previous);
      const pause =
        previous !== undefined &&
        /[;:,]$/.test(previous) &&
        current.length >= 2;
      const full = current.length >= MAX_WORDS || sentence || pause;
      if (full && current.length > 0) return [...list, [word]];
      return [...list.slice(0, -1), [...current, word]];
    },
    [[]],
  );
  // A single word stranded by the cap joins the phrase before it; one extra word reads better
  // than a caption that flashes past too fast to see.
  const merged = phrases
    .filter((phrase) => phrase.length > 0)
    .reduce<string[][]>((list, phrase) => {
      const previous = list[list.length - 1];
      const stranded =
        phrase.length === 1 &&
        previous !== undefined &&
        previous.length === MAX_WORDS &&
        !/[.!?]$/.test(previous[previous.length - 1] ?? "");
      return stranded
        ? [...list.slice(0, -1), [...previous, ...phrase]]
        : [...list, phrase];
    }, []);
  return merged.map((phrase) => phrase.join(" "));
}

export type Segment = { text: string; emphasis: boolean };

/** Splits "*emphasis*" markers out of text. Markers may span several words. */
export function parseEmphasis(text: string): Segment[] {
  return text
    .split(/(\*[^*]+\*)/)
    .filter(Boolean)
    .map((part) =>
      part.startsWith("*") && part.endsWith("*") && part.length > 2
        ? { text: part.slice(1, -1), emphasis: true }
        : { text: part, emphasis: false },
    );
}

function wordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}
