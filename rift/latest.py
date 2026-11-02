#!/usr/bin/env python3
"""Prints the newest stable upstream version, or nothing when RIFT already has it.

GitHub's "latest release" cannot be used: upstream's maintenance line can hold that flag while the
current line is ahead of it, so this reads the tags and compares versions.
"""
import json, re, subprocess, sys

config = json.load(open("rift/upstream.json"))
output = subprocess.run(["git", "ls-remote", "--tags", "--refs", config["repository"]], capture_output=True, text=True, check=True).stdout
parse = lambda tag: tuple(int(part) for part in tag[1:].split("."))
current = parse(config["version"])
versions = [line.split("refs/tags/")[1] for line in output.splitlines()]
stable = [tag for tag in versions if re.fullmatch(r"v\d+\.\d+\.\d+", tag) and parse(tag)[0] == current[0]]
newest = max(stable, key=parse, default=None)
if newest and parse(newest) > current:
    print(newest)
