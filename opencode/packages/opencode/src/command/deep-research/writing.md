# Writing the report

The reader is the audience in `brief.md`. Write for them a report they could cite: it argues, it does not list.

## Shape

1. **Title and abstract**: 150 words. The question, what the evidence says, and the unique findings in one sentence each.
2. **Introduction**: why the question matters now, and the scope (window, what is out).
3. **Background**: the established core, compressed. Readers in the field know it; give them the shape and the key citations.
4. **Body**: one section per theme, not per angle or per source. Synthesise: "Three groups report X [@a; @b; @c], but all measure it on Y; on Z, [@d] finds the opposite."
5. **Unique findings**: the heart of the report. One subsection per finding from `findings.md`, with its evidence, why it is non-obvious, confidence, and how to test or use it.
6. **Open questions**: the gaps that survived, framed as research questions someone could take on.
7. **Method**: angles searched, sources used, the window, and the date. Two short paragraphs.
8. **References**.

## Style

- Lead each paragraph with its claim; the evidence follows.
- Every factual sentence carries a citation. Opinion and synthesis are marked as yours ("We read this as ...").
- Give numbers with their conditions: dataset, setting, year.
- Hedge to match the evidence: one source "reports", several "find", a meta-analysis "establishes".
- Short paragraphs, plain words, active voice. Define each term once, then use it consistently.
- Use a table when comparing more than three things on more than two dimensions.

## report.md

Citations in pandoc form: `[@key]`, `[@a; @b]`. End with `## References`, one line per cited key: `- [@key] Authors (Year). *Title*. Venue. URL`.

## report.tex

Start from `template.tex`. Fill the title, author ("Compiled with RIFT deep-research" unless the user gives one) and date. Carry the same sections and the same claims as `report.md`.

- Citations: `\citep{key}` for parenthetical, `\citet{key}` for "Smith et al. (2024) show". Several keys: `\citep{a,b}`.
- Escape `& % $ # _ { } ~ ^ \` in text. Write URLs inside `\url{}`.
- Tables use `booktabs` (`\toprule`, `\midrule`, `\bottomrule`). Wide tables go in `tabularx` with `X` columns.
- Unique findings go in the `finding` environment: `\begin{finding}{Short title} ... \end{finding}`.
