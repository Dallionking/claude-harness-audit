# skill-parity.config.example.sh
# Copy to ~/.coding-harness/skill-vault/skill-parity.config.sh and fill in.
# These arrays APPEND to the structural defaults in skill-parity-sync.sh.
# Keep this file LOCAL — your skill names are harness-specific and need not be public.

# Codex-only skills that mirror your Claude AGENTS/commands (kept Codex-only, never pulled to Claude):
# CODEX_NATIVE+=( my-codex-persona-skill another-codex-only )

# Codex skills replaced by a Claude consolidation/rename → archived from Codex (reversible):
# SUPERSEDED+=( old-split-skill renamed-skill )

# Shared skills genuinely developed in Codex → Codex's copy wins on content drift:
# CODEX_CANONICAL+=( my-codex-developed-skill )
