#!/usr/bin/env python3
"""Prints a release's title and writes its notes, both from that version's entry in CHANGELOG.md.

Every RIFT release is named after the Lord of the Rings line that opens its changelog entry, and its notes are the
curated entry, not GitHub's list of pull request titles. A version without an entry fails, so a release cannot go
out unnamed.

usage: .github/release-notes.py <version> <notes-file>     version with or without the leading v
"""
import re, sys

SMALL = {"a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to"}


def title_case(sentence):
    words = sentence.split(" ")
    return " ".join(
        word if index > 0 and word.lower() in SMALL else word[:1].upper() + word[1:] for index, word in enumerate(words)
    )


def main(version, out):
    version = version.removeprefix("v")
    text = open("CHANGELOG.md", encoding="utf-8").read()
    match = re.search(rf"^## v{re.escape(version)} \(.*?\)\n(.*?)(?=^## v|\Z)", text, re.M | re.S)
    if not match:
        sys.exit(f"CHANGELOG.md has no entry for v{version}")
    body = match.group(1).strip()
    quote = re.match(r"([^.!?]+)[.!?]", body)
    if not quote:
        sys.exit(f"the v{version} entry must open with its quote")
    body = re.sub(r" ?Full notes: \S+", "", body, count=1)
    open(out, "w", encoding="utf-8").write(body + "\n")
    print(f"v{version} — {title_case(quote.group(1).strip())}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
