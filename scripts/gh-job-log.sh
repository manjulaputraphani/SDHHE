#!/bin/bash
# Local-only: download the log of a GitHub Actions job (token from the keychain).
set -e
TOKEN=$(security find-internet-password -s github.com -w)
curl -sL -m 60 -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/manjulaputraphani/SDHHE/actions/jobs/$1/logs"
