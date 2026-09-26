import { defineVideo, FORMATS } from "../../spec/schema";

/**
 * Storyboard — about 75s, 16:9, paper theme. One running example, "The cat sat on the mat",
 * carried through every step so the viewer follows one sentence rather than abstractions.
 *   Title → tokenize → embed → the attention question → Q/K/V → one attention map →
 *   many heads → the block → next-token probabilities → recap.
 * Numbers are illustrative and labelled as such; the shapes (causal mask, rows summing to 1)
 * are accurate.
 */

const TOKENS = ["The", "cat", "sat", "on", "the", "mat"];

// Deterministic stand-in embedding values: same numbers on every render.
const vector = (seed: number) =>
  Array.from(
    { length: 12 },
    (_, index) =>
      Math.round(Math.sin(seed * 12.9898 + index * 78.233) * 100) / 100,
  );

// Causal attention: each row attends only to itself and earlier tokens, and sums to 1.
const causal = (weights: (row: number, col: number) => number) =>
  TOKENS.map((_, row) => {
    const raw = TOKENS.map((__, col) => (col <= row ? weights(row, col) : 0));
    const total = raw.reduce((sum, value) => sum + value, 0);
    return raw.map((value) => Math.round((value / total) * 100) / 100);
  });

export const transformerExplainer = defineVideo({
  id: "transformer-explainer",
  title: "How a transformer processes a token",
  description:
    "Educational 16:9 explainer: tokenization, embeddings, attention, Q/K/V, heads, output.",
  brief:
    "Create a 90-second 16:9 explainer explaining how a transformer processes a token. Audience: computer science students. Style: clean educational motion graphics. Explain tokenization, show embeddings, visualize attention, explain Q/K/V conceptually, show multiple attention heads, end with the transformer output.",
  format: FORMATS.horizontal,
  targetDurationInSeconds: 75,
  style: {
    theme: "paper",
    pacing: "medium",
    visualDirection: "Clean, diagrammatic, generous whitespace. Blue accent.",
  },
  scenes: [
    {
      id: "title",
      type: "title",
      durationInSeconds: 5,
      eyebrow: "How transformers work",
      headline: "What happens to one token?",
      subheadline: "From text to the next word.",
    },
    {
      id: "tokenize",
      type: "chips",
      durationInSeconds: 8,
      transition: { type: "fade", durationInSeconds: 0.5 },
      heading: "1 · Tokenize: text becomes pieces",
      narration:
        "First, the text is split into tokens, and each token is looked up as an integer ID.",
      chips: [
        { label: "The", sub: "id 464" },
        { label: " cat", sub: "id 3797" },
        { label: " sat", sub: "id 3332" },
        { label: " on", sub: "id 319" },
        { label: " the", sub: "id 262" },
        { label: " mat", sub: "id 2603" },
      ],
      note: "Each piece maps to an ID in a fixed vocabulary. IDs shown are illustrative.",
    },
    {
      id: "embed",
      type: "vectors",
      durationInSeconds: 9,
      transition: { type: "fade", durationInSeconds: 0.5 },
      heading: "2 · Embed: each ID becomes a vector",
      narration:
        "Each ID becomes a learned vector. Position information is added, so word order matters.",
      rows: TOKENS.map((label, index) => ({
        label,
        values: vector(index + 1),
      })),
      note: "Real models use hundreds to thousands of dimensions. Position is added in, so order matters.",
    },
    {
      id: "question",
      type: "statement",
      durationInSeconds: 6,
      transition: { type: "fade", durationInSeconds: 0.5 },
      narration:
        "Then every token asks which other tokens matter to it. That is attention.",
      lines: [
        "Every token asks:",
        "*which other tokens matter to me?*",
        "That is attention.",
      ],
    },
    {
      id: "qkv",
      type: "cards",
      durationInSeconds: 10,
      transition: { type: "fade", durationInSeconds: 0.5 },
      heading: "3 · Query, Key, Value",
      narration:
        "Each vector is projected three ways. Queries are compared with keys, and the scores decide how much of each value flows through.",
      cards: [
        { glyph: "Q", title: "Query", body: "What this token is looking for." },
        {
          glyph: "K",
          title: "Key",
          body: "What each token offers to be matched on.",
        },
        {
          glyph: "V",
          title: "Value",
          body: "The information passed on when matched.",
        },
      ],
    },
    {
      id: "attention",
      type: "heatmap",
      durationInSeconds: 10,
      transition: { type: "fade", durationInSeconds: 0.5 },
      heading: "4 · Scores → softmax → attention weights",
      narration:
        "Query-key scores go through a softmax, so each row sums to one. A decoder only looks backwards.",
      matrices: [
        {
          rows: TOKENS,
          cols: TOKENS,
          values: causal(
            (row, col) =>
              (row === col ? 2 : 1) +
              (row === 2 && col === 1 ? 4 : 0) +
              (row === 5 && col === 1 ? 2 : 0),
          ),
        },
      ],
      note: "Each row sums to 1. Upper triangle is masked: a token cannot attend to the future.",
    },
    {
      id: "heads",
      type: "heatmap",
      durationInSeconds: 10,
      transition: { type: "fade", durationInSeconds: 0.5 },
      heading: "5 · Many heads, many patterns",
      narration:
        "Several heads run in parallel. Each learns a different pattern, and their outputs are combined.",
      matrices: [
        {
          title: "head 1 · previous token",
          rows: TOKENS,
          cols: TOKENS,
          values: causal((row, col) =>
            col === row - 1 || (row === 0 && col === 0) ? 8 : 0.2,
          ),
        },
        {
          title: "head 2 · first token",
          rows: TOKENS,
          cols: TOKENS,
          values: causal((_, col) => (col === 0 ? 6 : 0.5)),
        },
        {
          title: "head 3 · verb → subject",
          rows: TOKENS,
          cols: TOKENS,
          values: causal((row, col) =>
            row === 2 && col === 1 ? 8 : row === col ? 1.5 : 0.4,
          ),
        },
        {
          title: "head 4 · itself",
          rows: TOKENS,
          cols: TOKENS,
          values: causal((row, col) => (row === col ? 8 : 0.3)),
        },
      ],
      note: "Head outputs are concatenated and mixed by a learned projection.",
    },
    {
      id: "block",
      type: "flow",
      durationInSeconds: 8,
      transition: { type: "fade", durationInSeconds: 0.5 },
      heading: "6 · One transformer block, repeated",
      narration:
        "Attention and a feed-forward network, each with a residual connection and normalization, make one block. Blocks repeat.",
      steps: [
        "Embeddings",
        "Attention",
        "Add & Norm",
        "Feed-forward",
        "Add & Norm",
        "Output",
      ],
      loop: { from: 4, to: 1, label: "repeat for each layer" },
    },
    {
      id: "output",
      type: "chart",
      durationInSeconds: 8,
      transition: { type: "fade", durationInSeconds: 0.5 },
      heading: "7 · Output: a probability for every next token",
      narration:
        "The final vector is scored against the whole vocabulary. A softmax turns scores into next-token probabilities.",
      unit: "%",
      data: [
        { label: ".", value: 46 },
        { label: ",", value: 18 },
        { label: " and", value: 12 },
        { label: " while", value: 6 },
        { label: " with", value: 5 },
      ],
      highlight: ".",
      source: "illustrative probabilities after “The cat sat on the mat”",
    },
    {
      id: "recap",
      type: "cta",
      durationInSeconds: 5.5,
      transition: { type: "fade", durationInSeconds: 0.5 },
      headline: "Tokens → vectors → attention → next token",
      subline: "Repeated once for every token the model generates.",
    },
  ],
});
