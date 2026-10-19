# Runs in the session; $1 session id. Prints each repo with work not pushed.
cd "/workspaces/$1" || exit 1
for r in . projects/*; do
  [ -d "$r/.git" ] || continue
  s=$(git -C "$r" status --porcelain); u=$(git -C "$r" log --branches --not --remotes --oneline)
  [ -z "$s$u" ] || echo "$r"
done
