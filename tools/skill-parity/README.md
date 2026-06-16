# skill-parity

Keep Claude Code (`~/.claude/skills`) and Codex CLI (`~/.codex/skills`) skill libraries in sync, and keep `SKILL.md` frontmatter valid for **both** parsers.

## Why

`SKILL.md` files are shared between harnesses, but the two CLIs disagree:

- **Claude's** YAML parser is lenient.
- **Codex's** (Rust `codex_core`) is strict — it silently drops any skill whose frontmatter has invalid YAML (e.g. a double-quoted `description` containing `\'`, an unquoted `description` with a `: ` colon, a missing `---` delimiter) or a `description` over **1024 chars**.

Result: skills authored in Claude format fail to load in Codex. This tool fixes that and keeps the libraries aligned.

## Tools

| Script | What it does |
|---|---|
| `skill-parity-sync.sh` | Bidirectional sync. Claude is content-canonical except a configurable `CODEX_CANONICAL` set. Pulls Codex-only skills into Claude, pushes Claude-only into Codex, resyncs drift, archives superseded skills (never deletes). Idempotent. `--apply` to write (dry-run default). |
| `normalize-skill-frontmatter.py` | Re-emits `SKILL.md` frontmatter as strict-valid YAML via PyYAML, clamps descriptions to ≤1024 chars at a clean boundary, synthesizes frontmatter for old `## Metadata`-format skills. Only touches broken files. `--check`/`--apply <dir> [stamp]`. Called automatically by the sync. |

## Setup

```sh
cp skill-parity.config.example.sh ~/.coding-harness/skill-vault/skill-parity.config.sh
# edit it with your harness-specific skill classification (stays local, never committed)
bash skill-parity-sync.sh            # preview
bash skill-parity-sync.sh --apply    # execute
```

The personal classification (which skills are Codex-native, superseded, or Codex-canonical) lives ONLY in the local config — it never enters this repo.

## Diagnose Codex load failures

```sh
codex exec -s read-only --skip-git-repo-check "ok" 2>&1 | grep "failed to load skill"
```

Safety: archive-not-delete (every overwrite/removal backs up to a timestamped `_archive/` dir), idempotent, `--apply` required to write.
