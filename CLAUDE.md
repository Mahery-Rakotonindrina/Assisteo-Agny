@AGENTS.md

# Compact instructions

When compacting, keep: the user's requests and decisions, files changed, test and CI results, what is left to do. Drop full command outputs, file contents and screenshots.

# Agents: the main conversation conducts

The owner leaves it to the main conversation to decide when to use the project's agents (`.claude/agents/`), with as few tokens as possible:

- **No agent** for questions, analyses, small fixes, texts, settings, docs or a change of a few files: do it here (branch, code, `assisteo-tester`, `assisteo-livrer`).
- **Medium feature** (a new screen or route, several files): code it here, where the context already is. Then `assisteo-testeur` if a screen, the AI or real data is touched, then `assisteo-relecteur` for the review and the PR.
- **Large feature**, several independent ones, or when this conversation is already long: `assisteo-developpeur`, then `assisteo-testeur`, then `assisteo-relecteur`.
- The agents don't re-read the project. They start from their own memory (`.claude/agent-memory-local/<agent>/`) and the hand-over note `.claude/passation/<branch with / as ->.md`. Brief them precisely: the branch, the files, what changed, what to check. When the code was written here, write the note's `## Développeur` section first.
- A fix after a review or a test goes back to the same developer agent (SendMessage), not to a new one.
- Pass on to the owner, in French, only what matters from their short reports.
