#!/bin/sh
# Verify the pre-commit hook is properly installed.
# Exits 0 when all checks pass.

set -e

HOOK=".husky/pre-commit"

echo "== Checking pre-commit hook =="

# 1. Hook file exists
if [ ! -f "$HOOK" ]; then
  echo "FAIL: $HOOK does not exist"
  exit 1
fi
echo "PASS: $HOOK exists"

# 2. Hook is executable
if [ ! -x "$HOOK" ]; then
  echo "FAIL: $HOOK is not executable"
  exit 1
fi
echo "PASS: $HOOK is executable"

# 3. Hook contains 'make test'
if ! grep -q "make test" "$HOOK"; then
  echo "FAIL: $HOOK does not contain 'make test'"
  exit 1
fi
echo "PASS: $HOOK contains 'make test'"

# 4. No other commands in hook
COUNT=$(grep -cve '^\s*$' "$HOOK")
if [ "$COUNT" -ne 1 ]; then
  echo "FAIL: $HOOK should contain exactly one non-empty line (make test), found $COUNT"
  exit 1
fi
echo "PASS: $HOOK contains exactly one command"

echo ""
echo "All pre-commit hook checks passed."
