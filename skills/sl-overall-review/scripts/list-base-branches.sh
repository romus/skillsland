#!/usr/bin/env bash
# list-base-branches.sh — emit a JSON array of candidate base branches.
#
# Output shape:
#   [
#     {"name": "main", "source": "local"},
#     {"name": "origin/main", "source": "remote"},
#     {"name": "feature/x", "source": "recent"},
#     {"name": "<manual>", "source": "manual"}
#   ]
#
# The skill consumes this to populate an interactive picker.

set -euo pipefail

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo '{"error":"not a git repository"}'
  exit 1
fi

CURRENT=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

emit() {
  # emit name source
  printf '  {"name": "%s", "source": "%s"}' "$1" "$2"
}

CANDIDATES=()
SEEN=()

add() {
  local name="$1"
  local source="$2"
  [ -z "$name" ] && return 0
  [ "$name" = "$CURRENT" ] && return 0
  for s in "${SEEN[@]:-}"; do
    [ "$s" = "$name" ] && return 0
  done
  SEEN+=("$name")
  CANDIDATES+=("$(emit "$name" "$source")")
}

# main / master (local + remote)
for b in main master; do
  if git show-ref --verify --quiet "refs/heads/$b"; then
    add "$b" "local"
  fi
  if git show-ref --verify --quiet "refs/remotes/origin/$b"; then
    add "origin/$b" "remote"
  fi
done

# upstream of current branch
if UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null); then
  add "$UPSTREAM" "upstream"
fi

# 5 most recent local branches
while IFS= read -r b; do
  add "$b" "recent"
done < <(git for-each-ref --sort=-committerdate --count=5 \
         --format='%(refname:short)' refs/heads/ 2>/dev/null || true)

# always provide a manual-entry option
add "<manual>" "manual"

printf '[\n'
for i in "${!CANDIDATES[@]}"; do
  printf '%s' "${CANDIDATES[$i]}"
  if [ "$i" -lt $((${#CANDIDATES[@]} - 1)) ]; then
    printf ','
  fi
  printf '\n'
done
printf ']\n'
