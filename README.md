# Story Poster

This repository contains the Story Poster application and a complete fictional five-page example. The app stores family stories privately and exports a poster, two story pages, a practice page and cards with a grown-up guide. Bonding and learning are aims, not measured benefits.

This public source edition includes the original 14 base guides. The hosted service also has 20 extra preloaded guides and their saved source text, which are not bundled here. The full app and its online source-search adapters remain. See [PUBLIC-CATALOG.md](PUBLIC-CATALOG.md) for the difference.

## Run the included fictional example

Requires Node `^20.19.0 || >=22.12.0`. Install Chrome or Chromium and Poppler for PDF export and rendered page viewing.

```sh
npm ci
npm test
npm run build
npm run start:sample
```

Open http://127.0.0.1:4317. Sample mode uses the included fictional Pip and Dad kit and does not generate new stories. Tests and the frontend build need no provider credentials. Set `STORY_POSTER_CHROME` if Chrome is not in a usual location.

## Run a personal local app

```sh
STORY_POSTER_GENERATION_ROUTE=subscription npm run start:public
```

New generation needs your own signed-in Codex CLI on the same machine. It uses that account's settings, the app's current parent consent and persistent request limits. There is no paid API fallback. This personal route is not a turnkey public subscription service. The separate explicit API mode retains its own notices, data restrictions and spending ledger.

`.env.example` lists configuration names with blank secret values. Set them in your shell or hosting environment; copying the file alone does not configure the server. Never publish credentials or private account data.

## Hosted setup

The included Dockerfile builds the frontend and installs Chromium and Poppler. Hosted mode uses PostgreSQL and a private file volume. Configure `STORY_POSTER_HOSTED=1`, `DATABASE_URL`, `STORY_POSTER_DATA_DIRECTORY`, `STORY_POSTER_PUBLIC_ORIGIN` and a private `STORY_POSTER_WORKER_SECRET`. Email delivery needs your own Resend sender/key. Verified owner access uses `STORY_POSTER_OWNER_EMAILS` or owner account IDs.

`npm run start:hosted` starts the hosted server. `npm run start:worker` runs the separate outbound generation worker with the same private worker secret and hosted origin. Codex credentials remain on the worker machine. Saved reading can remain available while the worker is offline; new generation cannot.

Optional owner phone alerts rely on an existing local `~/bin/tell-sunny` notification program. That personal program and its credentials are not included. Email has its own delivery path. The worker keeps phone-alert failures pending rather than claiming delivery. Reusing that integration requires a local notifier with the expected explicit delivery receipt.

## Current behavior

The public example opens the poster and links to all five saved pages. Parents can read the story, play its saved narration, download the original print files and watch Help. The live demonstration is at https://story-poster-production.up.railway.app/ and the owner's demo is at https://youtu.be/-EBFv6U5xaU.

Family setup keeps each person's name, photo or description, outfit and drawing choices on one page. A picture tap selects the drawing and style. New appearance fields contain examples only until the parent enters text. Current work has a clear status and reduced-motion support. Each family's people, stories, practice answers and files stay behind its account.

New generation still requires the configured model route, valid family consent and available worker. The code does not include the owner's account access or a free shared generation service. Historical finished kits stay unchanged when future settings change.

## Public source and license

The project-owned source is offered under AGPL-3.0-only. The notice does not relicense third-party works or assets. See [LICENSE-SCOPE.md](LICENSE-SCOPE.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The built-in library is intentionally smaller than the hosted demo; online source search and new guide creation still use the existing configured model route.

## Optional recording builder

The included example recording plays without a provider account. Rebuilding it is optional and separate from running the app. `test/sample-narration-build.mjs` requires an external compatible `tts-gemini.mjs` helper supplied by `--helper` or `STORY_POSTER_TTS_HELPER`, its own credentials, and macOS `afconvert`. That personal helper is not bundled. `--dry-run` validates the exact saved transcript without provider calls.

