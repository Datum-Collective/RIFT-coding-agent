#!/usr/bin/env python3
"""Does RIFT break anything of upstream's? Runs upstream's whole core and TUI suites on the pristine release and on
RIFT, then reruns every file with a failing or vanished test on both trees. Results come from bun's JUnit report, so a
crash or a file that stops loading shows up as tests that vanished.

  regression   fails every rerun on RIFT, never on pristine. Exit 1 unless listed in rift/known-differences.txt.
  intermittent fails some reruns on RIFT, never on pristine. Writes the review flag, so the update will not auto-merge.
  flaky        fails on pristine too, or not again.

A failure that needs another file's state in the shared process cannot be told from a flake, and reads as flaky.
"""
import json, os, re, shutil, subprocess, sys, tempfile
import xml.etree.ElementTree as ElementTree

RERUNS = 3
SUITE_LIMIT = 25 * 60
FILE_LIMIT = 5 * 60
TIMEOUT = {"core": "60000", "tui": "30000"}
REVIEW_FLAG = os.environ.get("RIFT_REVIEW_FLAG", "/tmp/rift-needs-review")
SECRET = re.compile(r"^(?:AWS|AZURE|GOOGLE|GCP|GCLOUD|VERTEX|OPENAI|ANTHROPIC|GEMINI|XAI|CLOUDFLARE)_|(?:^|_)(?:API_KEY|AUTHORIZATION|TOKEN|SECRET|PASSWORD|CREDENTIALS?)$", re.I)

root = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip()
config = json.load(open(f"{root}/rift/upstream.json"))


def environment(home):
    """The isolation core's script/test.ts applies: a private home, and no credentials."""
    temporary = os.path.join(home, "tmp")
    os.makedirs(temporary, exist_ok=True)
    env = {name: value for name, value in os.environ.items() if not SECRET.search(name)}
    for name in ("OPENCODE_CONFIG", "OPENCODE_CONFIG_CONTENT"):
        env.pop(name, None)
    env.update(
        HOME=home,
        OPENCODE_TEST_HOME=home,
        XDG_CONFIG_HOME=f"{home}/.config",
        XDG_DATA_HOME=f"{home}/.local/share",
        XDG_CACHE_HOME=f"{home}/.cache",
        XDG_STATE_HOME=f"{home}/.local/state",
        OPENCODE_CONFIG_DIR=f"{home}/.config/opencode",
        TMPDIR=temporary,
    )
    return env


def run(tree, package, files, limit):
    """Returns {test id: failure text or None}, or None when bun died before writing a report."""
    with tempfile.TemporaryDirectory(prefix="rift-run-") as home:
        report = os.path.join(home, "report.xml")
        command = ["bun", "test", "--timeout", TIMEOUT[package], "--reporter=junit", f"--reporter-outfile={report}", *files]
        try:
            subprocess.run(command, cwd=f"{tree}/packages/{package}", env=environment(home), capture_output=True, timeout=limit)
        except subprocess.TimeoutExpired:
            print(f"timed out after {limit}s: {package} {' '.join(files)[:80]}", flush=True)
            return None
        if not os.path.exists(report):
            return None
        results = {}
        for case in ElementTree.parse(report).getroot().iter("testcase"):
            if case.find("skipped") is not None:
                continue
            failure = case.find("failure")
            if failure is None:
                failure = case.find("error")
            test = f"{case.get('file')}::{case.get('classname')}::{case.get('name')}"
            results[test] = None if failure is None else (failure.get("message") or failure.text or "failed")
        return results


def known_differences():
    lines = open(f"{root}/rift/known-differences.txt").read().splitlines()
    return {line.strip() for line in lines if line.strip() and not line.startswith("#")}


def reruns(tree, package, file, tests):
    """How many of RERUNS each test failed or was missing, and the last failure text."""
    fails, texts = dict.fromkeys(tests, 0), {}
    if not os.path.exists(f"{tree}/packages/{package}/{file}"):
        return fails, texts
    for _ in range(RERUNS):
        results = run(tree, package, [file], FILE_LIMIT) or {}
        for test in tests:
            if test not in results or results[test] is not None:
                fails[test] += 1
                texts[test] = results.get(test) or "did not run"
    return fails, texts


def main():
    known = known_differences()
    seen, regressions, intermittent = set(), [], []
    with tempfile.TemporaryDirectory(prefix="rift-pristine-") as pristine:
        ref = f"refs/rift/upstream/{config['version']}"
        if subprocess.run(["git", "rev-parse", "-q", "--verify", ref], cwd=root, capture_output=True).returncode != 0:
            subprocess.run(["git", "fetch", "--quiet", "--no-tags", config["repository"], config["version"]], cwd=root, check=True)
            ref = "FETCH_HEAD"
        archive = subprocess.Popen(["git", "archive", ref], cwd=root, stdout=subprocess.PIPE)
        subprocess.run(["tar", "-x", "-C", pristine], stdin=archive.stdout, check=True)
        if archive.wait() != 0:
            sys.exit("could not extract the pristine release")
        install = subprocess.run(["bun", "install", "--no-summary"], cwd=pristine, capture_output=True, text=True)
        if install.returncode != 0:
            sys.exit(f"bun install failed on the pristine release:\n{install.stderr[-2000:]}")
        for package in TIMEOUT:
            base = run(pristine, package, [], SUITE_LIMIT)
            ours = run(f"{root}/opencode", package, [], SUITE_LIMIT)
            if base is None:
                sys.exit(f"{package}: the pristine suite produced no report")
            if ours is None:
                print(f"{package}: the suite crashed on RIFT and pristine reported")
                regressions.append(f"{package}: the whole suite crashed")
                continue
            failed = {test for test, failure in ours.items() if failure is not None}
            vanished = {test for test, failure in base.items() if failure is None and test not in ours}
            print(f"{package}: {len(base)} tests on pristine, {len(ours)} on RIFT, {len(failed)} failed, {len(vanished)} vanished", flush=True)
            by_file = {}
            for test in failed | vanished:
                by_file.setdefault(test.split("::")[0], []).append(test)
            for file, tests in sorted(by_file.items()):
                ours_fails, texts = reruns(f"{root}/opencode", package, file, tests)
                base_fails, _ = reruns(pristine, package, file, tests)
                for test in sorted(tests):
                    key = f"{package}: {test}"
                    seen.add(key)
                    if base_fails[test] > 0 or ours_fails[test] == 0:
                        continue
                    label = "known difference" if key in known else "regression" if ours_fails[test] == RERUNS else "intermittent"
                    print(f"  {label} {ours_fails[test]}/{RERUNS}: {test}", flush=True)
                    if label == "regression":
                        regressions.append(f"{key}\n{texts.get(test, '')[:1500]}")
                    elif label == "intermittent":
                        intermittent.append(key)
    for key in sorted(known - seen):
        print(f"warning: stale entry in rift/known-differences.txt: {key}")
    if intermittent:
        open(REVIEW_FLAG, "w").write("\n".join(intermittent))
    if regressions:
        print("RIFT broke upstream behaviour:", *regressions, sep="\n\n")
        sys.exit(1)
    print("no regressions" + (f", {len(intermittent)} intermittent, needs review" if intermittent else ""))


main()
