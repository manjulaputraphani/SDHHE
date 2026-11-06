#!/usr/bin/env python3
"""Local-only: read the GitHub Actions runs of this repo (short output).

Uses the credential already stored in the macOS keychain by the git credential
helper. The token is never printed.
"""
import json
import subprocess
import sys


def keychain_token() -> str:
    out = subprocess.run(
        ["security", "find-internet-password", "-s", "github.com", "-w"],
        capture_output=True,
        text=True,
    )
    if out.returncode != 0 or not out.stdout.strip():
        sys.exit("no github.com credential in the keychain")
    return out.stdout.strip()


def api(path: str, token: str) -> object:
    args = [
        "curl", "-s", "-m", "40", "-X", "GET",
        "-H", f"Authorization: Bearer {token}",
        "-H", "Accept: application/vnd.github+json",
        "-H", "X-GitHub-Api-Version: 2022-11-28",
        path,
    ]
    res = subprocess.run(args, capture_output=True, text=True).stdout
    try:
        return json.loads(res)
    except Exception:
        return {"raw": res[:200]}


token = keychain_token()
repo = "manjulaputraphani/SDHHE"

runs = api(f"https://api.github.com/repos/{repo}/actions/runs?per_page=15", token)
items = runs.get("workflow_runs", []) if isinstance(runs, dict) else []
print(f"{'run':>12}  {'status':10} {'result':9} {'sha':8} {'created':21} title")
for run in items:
    print(
        f"{run['id']:>12}  {run['status']:10} {str(run.get('conclusion')):9} "
        f"{run['head_sha'][:7]:8} {run['created_at'][:19]:21} {run['display_title'][:44]}"
    )

if len(sys.argv) > 1 and sys.argv[1] == "jobs":
    run_id = sys.argv[2]
    jobs = api(f"https://api.github.com/repos/{repo}/actions/runs/{run_id}/jobs", token)
    for job in jobs.get("jobs", []):
        print(f"\njob {job['id']} {job['name']}: {job['status']} {job.get('conclusion')}")
        for step in job.get("steps", []):
            print(f"   {step['number']}. {step['name']}: {step['status']} {step.get('conclusion')}")
