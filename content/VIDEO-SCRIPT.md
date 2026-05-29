# Video: "I Audited My AI Coding Setup With Claude Code's New Workflows Feature"

Two cuts below: a **YouTube main cut** (~6–8 min) and a **short-form cut** (~45s, Reels/Shorts/TikTok).
Voice: direct, declarative, no hype words. Show the terminal, not slides.

---

## SHORT-FORM CUT (~45s)

**HOOK (0–3s)** — *(screen: the Workflows rainbow shimmer on the word "Workflow")*
> "Claude Code can now write scripts that run other AI agents. I pointed it at my own setup — and it found bugs I'd been shipping for weeks."

**PROBLEM (3–12s)** — *(screen: settings.json scrolling)*
> "If you've customized Claude Code — hooks, agents, custom commands — it rots silently. Hooks point at files you renamed. Your config swears a safety check is on when the script behind it is dead."

**THE MOVE (12–28s)** — *(screen: a workflow running, phase tree filling in: Inventory → Synthesize → Verify → Benchmark)*
> "So I wrote one Workflow that audits the whole thing. Seven agents read my config in parallel. One agent merges it into a fix list. Then — this is the part people skip — a second wave of agents tries to PROVE each fix wrong. About a third got rejected. Already fixed. Wrong path. A flag that doesn't exist."

**PAYOFF (28–40s)** — *(screen: the before/after delta: missing_target_files 2 → 0)*
> "Two dead hooks firing on every keystroke: gone. Eight hundred megs poisoning every search: gone. And every fix shipped with a benchmark, so I can prove it actually worked instead of just claiming it."

**CTA (40–45s)**
> "I open-sourced it. Link in bio. Audit your own setup in one command."

---

## YOUTUBE MAIN CUT (~6–8 min)

### 0. Cold open (0:00–0:20)
*(screen: terminal, type `Workflow`, it turns into the rainbow shimmer)*
> "This little rainbow is the most powerful thing Claude Code shipped this year. It lets the AI write a script that calls other AI agents — in parallel, in loops, passing structured data between them. Today I'm turning it on the one codebase nobody audits: my own AI setup."

### 1. The problem nobody talks about (0:20–1:30)
> "Everyone's bragging about their custom Claude Code config — dozens of hooks, custom agents, hundreds of skills. Nobody talks about what happens six months in. It rots. You rename a script and forget the hook that called it. You disable something and your instructions still claim it's running. Your reference folder quietly balloons until every search crawls."
>
> *(show 2–3 real examples on screen, redacted)*
> "On my setup: two hooks were calling files that didn't exist anymore — firing on every single search and every prompt, doing nothing. And my main instructions file confidently told the AI those guardrails were active. That's not a typo. That's the AI being lied to by its own config, every session."

### 2. What the Workflows feature actually is (1:30–2:45)
> "Here's the mental model. Before, if you wanted five agents to do something, your MAIN session had to spawn each one, wait, read its output, spawn the next — burning your context window the whole time. Workflows flip that. You write a JavaScript file. It runs in the background. It calls the agents. Only the final answer comes back to you."
>
> Key capabilities, on screen as bullets:
> - **Parallel or sequential** subagent calls
> - **Arguments** — pass it variables, like a function
> - **Loops with limits** — "keep going until X, max N rounds"
> - **Structured output** — force each agent to return clean JSON so you can chain them
> - **Permanent run logs** — every run saved for auditing
>
> "Turn it on under slash-config, Dynamic Workflows. Then you just describe what you want and Claude writes the script."

### 3. The audit, live (2:45–5:00)
*(screen: the workflow launching, the /workflows progress tree)*
> "I gave it four phases."
>
> **Phase 1 — Inventory.** "Seven agents, in parallel, each reading one part of my setup: the hooks, the always-loaded instructions, the agents, the skills and commands, and my session history to see what actually goes wrong day to day."
>
> **Phase 2 — Synthesize.** "One agent merges seventy-six raw findings into a ranked list: delete this, update that, enhance this, build that."
>
> **Phase 3 — Verify.** *(lean in)* "This is the part that matters and the part everyone skips. The first pass is a guess. So I sent one skeptic agent per recommendation, told it to go re-read the actual file and try to PROVE the finding wrong. Twenty-eight recommendations. Ten got knocked down — already fixed, mis-scoped, or pointing at a path that doesn't exist. One was flat wrong. If I'd trusted the first pass, I'd have edited files that don't exist and used a command-line flag that isn't real."
>
> **Phase 4 — Benchmark.** "For every fix, a runnable command that measures the before and the after. Because 'I fixed it' with no measurement is just a vibe."

### 4. The results (5:00–6:30)
*(screen: before/after table)*
> - Dead hooks firing every event: **2 → 0**
> - Stale permission rules: **4 → 0**
> - Reference folder bloat poisoning search: **flagged, with the exact eviction command**
> - Context loaded before I type a word: **measured at ~11,000 tokens — now I know the number, so I can cut it**
>
> "And the bigger insight: half my 'config' was rituals I run by hand every session — gap analysis, review gates, multi-model debates. Those aren't config. Those are programs. So I converted the first one into a Workflow — a gap-analysis loop that runs rounds until it comes back clean twice, fixing issues between rounds, without me babysitting it."

### 5. The takeaway + open source (6:30–7:30)
> "Three things. One: your AI setup is software, and software you don't test, rots. Two: never trust a first-pass audit — make a second wave of agents try to break it. Three: anything you do by hand every session should be a script."
>
> "I open-sourced the whole thing — the audit workflow, the verify pass, the gap-loop, and a one-line installer. Clone it, run one command, and it audits YOUR setup and hands you a verified fix list with benchmarks. Link's in the description. If it finds something nasty in your config, reply and tell me what."

### B-roll / overlay checklist
- [ ] The `Workflow` → rainbow shimmer moment (cold open + short hook)
- [ ] `/workflows` live progress tree filling in across the 4 phases
- [ ] A real dead-hook line in settings.json next to the `.disabled` file (redact personal paths)
- [ ] The verify phase rejecting a recommendation (the "gotcha" beat)
- [ ] The before/after benchmark table
- [ ] `git clone` + `./install.sh` + `/harness-audit` in a clean terminal

### Title / thumbnail options
- "Claude Code Workflows audited my own AI setup (it found bugs)"
- "I made AI agents audit my AI agents"
- Thumbnail: the rainbow `Workflow` shimmer + big red "2 DEAD HOOKS" callout.
