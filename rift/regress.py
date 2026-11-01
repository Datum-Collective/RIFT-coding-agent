#!/usr/bin/env python3
"""Does RIFT break anything of upstream's? Runs upstream's whole core and TUI suites on the pristine release and on
RIFT, then reruns whatever failed only on RIFT. Those suites are flaky, so a regression has to fail every rerun on RIFT
and never fail on pristine. Exits 1 on a regression not listed in rift/known-differences.txt.
"""
import json, os, re, subprocess, sys, tempfile

RERUNS = 3
TIMEOUT = {"core": "60000", "tui": "30000"}
root = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip()
config = json.load(open(f"{root}/rift/upstream.json"))


def failures(text):
    return {re.sub(r" \[[\d.]+m?s\]$", "", line.strip())[len("(fail) "):] for line in text.splitlines() if line.startswith("(fail) ")}


def suite(tree, package):
    result = subprocess.run(["bun", "test", "--timeout", TIMEOUT[package]], cwd=f"{tree}/packages/{package}", capture_output=True, text=True)
    return failures(result.stdout + result.stderr)


def fails(tree, package, name):
    leaf = name.split(" > ")[-1]
    found = subprocess.run(["grep", "-rlF", leaf[:40], "test"], cwd=f"{tree}/packages/{package}", capture_output=True, text=True).stdout.split()[:2]
    count = 0
    for _ in range(RERUNS):
        run = subprocess.run(["bun", "test", "--timeout", TIMEOUT[package], "-t", re.escape(leaf[:60]), *found], cwd=f"{tree}/packages/{package}", capture_output=True, text=True)
        count += run.returncode != 0
    return count


known = {line.strip() for line in open(f"{root}/rift/known-differences.txt") if line.strip() and not line.startswith("#")}
with tempfile.TemporaryDirectory(prefix="rift-pristine-") as pristine:
    subprocess.run(["git", "fetch", "--quiet", "--no-tags", config["repository"], config["version"]], cwd=root, check=True)
    archive = subprocess.run(["git", "archive", "FETCH_HEAD"], cwd=root, capture_output=True, check=True)
    subprocess.run(["tar", "-x", "-C", pristine], input=archive.stdout, check=True)
    subprocess.run(["bun", "install", "--no-summary"], cwd=pristine, capture_output=True, check=True)
    regressions = []
    for package in TIMEOUT:
        base, ours = suite(pristine, package), suite(f"{root}/opencode", package)
        print(f"{package}: {len(base)} failures on pristine, {len(ours)} on RIFT, {len(ours - base)} only on RIFT", flush=True)
        for name in sorted(ours - base):
            on_rift, on_pristine = fails(f"{root}/opencode", package, name), fails(pristine, package, name)
            real = on_rift == RERUNS and on_pristine == 0
            print(f"  {'REGRESSION' if real else 'flaky'} rift {on_rift}/{RERUNS} pristine {on_pristine}/{RERUNS}: {name[:90]}", flush=True)
            if real and f"{package}: {name.split(' > ')[-1]}" not in known:
                regressions.append(f"{package}: {name}")
if regressions:
    print("RIFT broke upstream behaviour:", *regressions, sep="\n  ")
    sys.exit(1)
print("no regressions")
