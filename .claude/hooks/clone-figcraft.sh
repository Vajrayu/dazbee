#!/usr/bin/env bash
# Clones FigCraft's source at the commit the FigCraft epic reads into the git-ignored reference/figcraft,
# when a session starts without it. FigCraft's own agent instructions are deleted from the clone so a
# session never loads them as this repo's. Silent on success; on a failed clone it prints one line,
# which Claude Code adds to the session's context, and it always exits 0 so the session goes on.

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
[ -d reference/figcraft ] && exit 0

figcraft_commit=be991533b0cc1891447d8ea48198abc87fdbc609
part=reference/figcraft.part
rm -rf "$part"
if git -c init.defaultBranch=main init -q "$part" &&
  git -C "$part" fetch -q --depth 1 https://github.com/storytold/figcraft "$figcraft_commit" &&
  git -C "$part" checkout -q FETCH_HEAD; then
  rm -f "$part/CLAUDE.md" "$part/AGENTS.md"
  mv "$part" reference/figcraft
else
  rm -rf "$part"
  echo "Could not clone FigCraft into reference/figcraft; this session has no FigCraft source to read."
fi
exit 0
