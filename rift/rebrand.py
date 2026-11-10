#!/usr/bin/env python3
"""Applies rift/rebrand.txt to opencode/. Changes nothing and exits 1 if any rule no longer matches upstream."""
import sys
from collections import defaultdict
from pathlib import Path

root = Path(__file__).resolve().parent.parent
table = root / "rift" / "rebrand.txt"

rules = defaultdict(list)
for number, line in enumerate(table.read_text().splitlines(), 1):
    if not line.strip() or line.lstrip().startswith("#"):
        continue
    path, _, rest = line.partition(" :: ")
    find, _, replacement = rest.partition(" => ")
    path, find, replacement = path.strip(), find.strip(), replacement.strip()
    assert path and find and replacement, f"rebrand.txt:{number}: expected <path> :: <find> => <replacement>"
    assert find not in replacement, f"rebrand.txt:{number}: the find text is inside its replacement, so it would re-apply"
    rules[path].append((number, find, replacement))

# A find text that is gone with its replacement in its place was applied by an earlier run.
unmatched, edits = [], {}
for path, file_rules in rules.items():
    file = root / "opencode" / path
    text = file.read_text() if file.is_file() else ""
    for number, find, replacement in file_rules:
        if find in text:
            text = text.replace(find, replacement)
        elif replacement not in text:
            unmatched.append(f"rebrand.txt:{number}: {path} :: {find}")
    edits[file] = text

if unmatched:
    print("rebrand rules that match nothing in opencode/ (nothing was changed):", file=sys.stderr)
    print("\n".join(unmatched), file=sys.stderr)
    sys.exit(1)
for file, text in edits.items():
    if file.read_text() != text:
        file.write_text(text)
print(f"rebrand: {sum(map(len, rules.values()))} rules hold in {len(rules)} files")
