#!/bin/sh
set -eu

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "Gitleaks 8.30.1 is required on PATH." >&2
  exit 1
fi
if [ "$(gitleaks version)" != "8.30.1" ]; then
  echo "Gitleaks must match the pinned version 8.30.1." >&2
  exit 1
fi
if [ "$(git rev-parse --is-shallow-repository)" != "false" ]; then
  echo "Security scan requires a Git repository with full history; fetch --unshallow first." >&2
  exit 1
fi

gitleaks git --no-banner --redact --verbose .
npm audit --audit-level=high
