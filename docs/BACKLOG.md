# Backlog

Sprint 1, started 2026-11-26. Owners are agents from [`team.md`](team.md). Sizes: S, M, L.
Release steps, in order: validate_data, e2e, build, emulator check (README "Test on a phone or emulator").

## Next sprint

| id | title | owner | size | acceptance check | link |
|----|-------|-------|------|------------------|------|
| - | nothing yet | | | | |

## In progress

| id | title | owner | size | acceptance check | link |
|----|-------|-------|------|------------------|------|
| S1-1 | Team review of the design/impeccable merge (gallery theme + polish for all themes) | whole team, tech-lead collects | M | every reviewer reports pass or a list of findings; findings land in this file | `c68b0eb` (local, not pushed) |
| S1-2 | Release v4.9: validate_data, e2e, build, install and open on the emulator | devops-engineer | M | step reached: not started (`app/version.properties` still says `4.8-gallery`, code 14); done when `build/outputs/the-road-to-100-v4.9-15.apk` opens on the emulator with a screenshot | after S1-1 |

## Blocked

| id | title | owner | size | acceptance check | link |
|----|-------|-------|------|------------------|------|
| - | nothing | | | | |

## Done this sprint

| id | title | owner | size | acceptance check | link |
|----|-------|-------|------|------------------|------|
| D-1 | v4.5: question updates retry until GitHub answers | | S | committed | `916fc24` |
| D-2 | v4.6: identify the building from a picture | | M | committed | `e2ae5ac` |
| D-3 | v4.7: home-screen widget with a goal timer and a sentence a day | | M | committed | `9518ec0` |
| D-4 | v4.8: fixes from a ponytail audit | | S | committed | `f8eecea` |
| D-5 | "גלריה" (gallery) theme, inspired by Apple's design language | | M | committed | `90244b1` |
| D-6 | Impeccable polish for all themes, checked with ponytail | | M | committed | `ec6d8b9` |
| D-7 | Dev and security team as Claude Code agents | | S | committed | `bd9d937` |
| D-8 | Merge of design/impeccable into master | | S | local merge, review in S1-1 | `c68b0eb` |

## Later

From [`ui-design-notes.md`](ui-design-notes.md) "Worth doing next", the items still open:

| id | title | owner | size | acceptance check | link |
|----|-------|-------|------|------------------|------|
| L-1 | Recover when Android's WebView renderer crashes (`onRenderProcessGone` recreates the WebView) | android dev (tech-lead to name) | S | no handler in the code today; killing the renderer on the emulator brings the app back with progress kept | note 5 |
| L-2 | The explanation's "מקור:" line still names the summaries (for example "סיכום שיעור 1") | content / frontend, PM picks the option | S | needs a PM decision: rename `ref` to the lecture name, or hide it for generated questions | note 1 |
| L-3 | "Continue where you left off" row on the course list (tall phones) | frontend | S | the row shows the last course and saves three taps | note 4, second half |

From the team: nothing yet.
