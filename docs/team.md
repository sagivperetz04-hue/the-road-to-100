# The team

You are the PM and CEO: you set priorities and accept or reject risks. Every agent below takes its work from you. The
agents live in `.claude/agents/`; ask for one by name ("ask the qa-engineer to ...", "have the game-designer look at
..."), or let Claude pick by the task.

## Roster

| Area | Agent | Covers | Call it for |
|---|---|---|---|
| Leadership | `tech-lead` | Tech lead / engineering manager | architecture, splitting a feature into tasks, reviews, unblocking |
| Leadership | `scrum-master` | Scrum master / project manager | sprint plan, stand-up, review, retro; `docs/BACKLOG.md` |
| Design | `ui-ux-designer` | UI/UX designer | screens, themes, widget look, accessibility, polish |
| Design | `game-designer` | Gameplay and learning design | climb rules, learning loop, balance, new mechanics |
| Engineering | `frontend-developer` | Frontend developer | the web app in `app/assets` (JS, CSS, SVG, RTL) |
| Engineering | `backend-developer` | Backend developer | native Android layer, question updates, content pipeline |
| Quality | `qa-engineer` | QA engineer | e2e and device tests, bug reports, release go/no-go |
| Deployment | `devops-engineer` | DevOps engineer | build, signing, versions, releases, CI |
| Security | `security-lead` | CISO + GRC | policy, risk register, privacy, licences, `docs/SECURITY.md` |
| Security | `appsec-engineer` | Security engineer, AppSec, DevSecOps | threat model, secure code review, secrets, supply chain |
| Security | `penetration-tester` | Penetration tester + red team | authorized attacks on this app on the local emulator only |
| Security | `incident-responder` | SOC analyst, threat hunter, incident responder | watching the repo and data feed, playbooks, incidents |

Merged roles: the app has no servers and no cloud, so the SOC analyst, threat hunter and incident responder are one
agent (they watch the repo, the question feed and the build machine instead of a network); the cloud security
engineer's job (accounts, CI, supply chain) sits with `appsec-engineer`; the red team operator is part of the
`penetration-tester`, whose scope is this app only.

## Skills the team uses

Installed user-wide in `~/.claude/skills`, chosen with `find-skills` (skills.sh registry), keeping only official or
well-known sources with 1K+ installs:

| Skill | Source | Used by |
|---|---|---|
| `impeccable` | pbakaus/impeccable | ui-ux-designer, frontend-developer |
| `frontend-design` | anthropics/skills | ui-ux-designer |
| `web-design-guidelines` | vercel-labs/agent-skills | ui-ux-designer, qa-engineer |
| `ui-ux-pro-max` | (already installed) | ui-ux-designer |
| `webapp-testing` | anthropics/skills | qa-engineer |
| `ci-cd-and-automation`, `git-workflow-and-versioning` | addyosmani/agent-skills | devops-engineer |
| `security-threat-model` | openai/skills | appsec-engineer, security-lead |
| `android-intent-security` | android/skills (Google) | appsec-engineer, penetration-tester, backend-developer |
| `incident-runbook-templates` | wshobson/agents | incident-responder |
| `ponytail` (+ review, audit, debt, gain, help) | DietrichGebert/ponytail | everyone: smallest complete change |
| `find-skills` | vercel-labs/skills | anyone looking for a new skill |

Not installed: no gameplay or game-balance skill met the bar (the best had about 1,100 installs from unknown
authors), so the game-designer works from the project's own decisions. Plugin hooks and downloaded binaries
(ponytail's ledger, impeccable's engine) are not enabled; the skills' instructions work without them.

## How a feature flows

1. You state the goal and priority.
2. `scrum-master` puts it in the backlog; `tech-lead` splits it into tasks with owners.
3. `game-designer` / `ui-ux-designer` specify; `frontend-developer` / `backend-developer` build.
4. `qa-engineer` tests; `appsec-engineer` reviews anything that moves a trust boundary.
5. `devops-engineer` builds and releases after your OK; `scrum-master` reports in the sprint review.
