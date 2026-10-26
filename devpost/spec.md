---
doc: spec
status: approved
previous_baseline_status: approved
revision_status: approved
revision_authorization: "Start bother build now and ask whener u need my input go"
revision_date: 2026-10-19
recorded: 2026-10-17
---

# Story Poster: build plan


## Storybook and approved demonstration access, October19 evening

Owner authorization: "And can you connect invitation with my telegram and email both? And storybook is good go Make the changes". The prior prototype and new access flow are approved for implementation without another vision interview. Keep the current stack, hosted store and fixed Mac worker.

### Access and referral contract

The existing config reports request mode and requiresInvitation. Public POST /api/access-requests accepts email, optional adultName and optional referralToken, returns a generic saved-request response, and deduplicates by normalized email. Existing users still sign in/recover normally. Owner GET /api/owner/access-requests lists requests; authenticated POST /api/owner/access-requests/:id/decision approves or declines. No GET performs approval. Approved invitation links use a random one-use email-bound token; inspect reads only, signup consumes it atomically and sets the proven email verified. Direct signup cannot bypass request mode. Token bytes must not leak in reports, logs or public account views.

Each approved verified account has three lifetime invitation slots for distinct intended recipients. Family GET/POST /api/invitations reads/creates; POST /api/invitations/:id/send resends the same slot. A referral link leads to an access request, not automatic admission. New referred accounts receive their own three after admission. Retries, concurrent requests, duplicate email, self-referral, replay and failed sends cannot multiply slots. Capacity checks include registered accounts and active approved reservations. Existing generation revocation, family boundaries, finite model requests and saved-reading rights remain.

### Two-channel owner notices

Reuse server/mail.js for email. Keep a durable per-channel outbox with delivery receipts, bounded retry delays and idempotency keys. The fixed Mac generation worker can claim an owner-alert job and call the existing ~/bin/tell-sunny with fixed executable and argument array, never a remote shell command. Keep the Telegram token out of the cloud. Verify explicit delivery evidence: tell-sunny exit0 can also mean duplicate suppression, so do not treat exit status alone as delivery. A prior matching sent receipt may settle an uncertain retry. Links go to the approved hosted origin and owner screen. No child content enters notifications.

### Storybook and public example

Reuse the inspected Chapter mockup's layout, typography, colours and generated assets. Keep account-owned images and complete style previews; preserve current selected-person, Talk, draft, recovery and saved-reader behavior. Root supplies a separate safe public-sample loader and manifest for the already accepted fictional age8 kit; the backend may wire it as a fallback to the existing sample path. Require record.real===false, a fixed asset allowlist, checked hashes and no private job files. Unknown or missing sample assets keep a truthful unavailable state.

### Verification and release

Test real boundaries: owner-only decisions, email binding, replay, three-slot and capacity concurrency, restart persistence, channel retry receipts, old account access, unchanged story limits and worker request history. Then combine tests/build and both-theme browser checks. Verify a clearly labelled delivery test to Sunny's existing Telegram and owner email, without contacting other people. Use the approved deployment route once the integrated package passes. A different model loads live screens and writes a fresh report after deployment. Preserve all existing family assets and unrelated working changes.


## October 19 continuation blueprint

The base app and October17 plan are already implemented. Sunny approved these continuation changes on October19. Checklist boxes and actual proof determine completion. Reuse the current hosting, account separation, source-review path and image service. No new service or research sweep is needed merely to preserve the saved experience.

### Familiar reminder binding

Implements prd.md > Familiar topic reminders and shared learning.

Use the existing move identity to bind a chosen reminder and its revision. Resolve it once before a new kit is written and store the exact wording with that kit. Feed that same value to the writer, reviewer, poster, practice, parent card and export. Resume must keep the kit's stored wording even if a later default changes. Older completed kits keep their stored words and files.

Remove the fresh-rhyme instruction only for topics with a saved chosen reminder. New topics can use the existing reviewed rhyme step once and save its result for reuse. Do not change source evidence or practice instructions as a side effect of changing a reminder. The same selected learner and grown-ups continue through the existing family context; a parent can learn without adding a separate course.

### Content reconciliation and import

Implements prd.md > Complete the saved content collection.

Use the existing library import and review records. Compare stable guide IDs and actions before import so running the import again does not duplicate entries. Previously inventoried local candidates are Words for Difficult Feelings, Choose the maths move and Picture the Turn. The first may overlap Name the feeling; resolve that mapping before counting it as an additional topic.

The October19 live check found Ask why and explain present but unavailable to an age-only family because its fit record uses school grades. Investigate the source's actual supported population and the existing family data path. Do not silently infer a grade from age or weaken source-fit checks just to remove the message. Bring back a question only if a real product choice remains after that check.

Historical private posters are design and wording references, not an import task. Do not add an archive, PDF-import route or historical-kit conversion. Preserve their existing files. Carry the requested general qualities and approved reminders into new generation; never inject a family's old story events into another family's output.

### Per-story style and preserved likeness

Implements prd.md > Choose the look for each new story.

Snapshot the selected pictureStyleId and its compatible family references on each new kit. Reuse approved references for that person and style. If the requested style needs new drawings, use the existing family likeness flow and preserve the references used by older jobs. Let outfits vary between kits while keeping each kit visually consistent. Resume keeps its original style and people; changing the next-story choice must not affect it.

Reuse the three stored style-comparison candidate assets as the next-story choices. Selection is a stored choice, not an image-generation request. Exactly one style ID reaches the new kit job. Generate only missing selected-person references for that chosen style and reuse them on later kits. Preserve comparison candidates independently of the newest portrait attempt so a redraw cannot make the other style cards disappear.

Extend the existing portrait replacement flow into a proposed Redraw this look action scoped to one person and one style. Reuse existing input, request accounting and selection behavior. Keep the accepted version until the parent selects the replacement, and retain job-owned references for earlier kits. The input photo must be supplied again under the current no-original-photo-storage behavior. Do not add completed-kit regeneration or video animation as part of this change.

### Verification and owner checkpoint

Implements prd.md > Continuation proof.

Use current test tools. Check two moments with one topic, all kit consumers, Resume after a default change, and unchanged historical files. Check duplicate-safe guide import, general/private separation and the grade-only fit case. Check all three next-story style choices and older-kit preservation, then inspect new actual pages and both reader themes. A different Codex model reviews substantial implementation, and the lead runs the combined checks.

Sunny's useful checkpoint is the finished personal kit: whether the faces, reminder, story and parent-child learning feel like the original experience. Phone speech remains a separate unperformed human check. Keep final demo narration and submission answers in his own words.

October19 reviewer authorization: Sunny permits Claude through the existing CLI, including Opus or Fable when useful for a difficult technical issue or second opinion. Check the current suitable model when a real review is needed. Codex retains creative leadership under Sunny's vision. Advice is evidence to assess, not an automatic new rule or blocker. Verify real correctness issues and avoid adding restrictions or redesigns merely because a reviewer prefers them. This permits advisory help without requiring a new council or another review loop for every decision.

## How this works, in plain language

Keep the working app and its saved families. Add the missing ways to speak, sign in by email, recover a password and review finished kits. Keep one difficult moment at the center: the parent describes it, the app uses a fitting checked guide, and the family reads and learns together when calm.

Keep saved reading separate from making a new story. Ending the trial must not erase stories or close reading and downloads. Whether new stories continue is a later decision.

Implementation authorized October17: Sunny said “Finish this work now don’t ask me any further questions finish it and give me result in the morning”. This delegates remaining routine implementation choices and overrides further interview pauses. It is not a claim that he reviewed every technical detail below. Record actual choices and test evidence; do not fabricate provider approval or publication.

## October 17 self-signup and owner controls

Sunny said:

> i want them to set up their accounts by themselves it sok as long as i have the power to rescind it ad maximum 3 stories in a day for them so maybe limit to 50 accoutns for now, they woudl automatically make their email address and passwords with how other apps do with my railway account as a setuo

This supersedes mandatory individual invitations. Parents create an account using their own existing email address and a password they choose. The app does not create a new email mailbox for them. Plan an initial ceiling of 50 family accounts and at most 3 new stories per account per day. These are owner-requested limits, superseding earlier notes against an arbitrary three-story cap.

Sunny clarified on October 17: “Ability to make new stories”. Revocation disables new story creation only. Families retain sign-in, password recovery, reading and downloads of saved stories. Revocation does not delete files. Normal trial completion also preserves reading/downloads. This question is answered; do not ask again.

Email verification and password recovery remain needed. Selecting a sender is an implementation setup issue, not a reason to require Sunny to create families manually or repeat the sender question now. No actual signup page is being published during planning.

## The core journey through the system

Implements prd.md > The core journey.

Capacity-checked self-signup and email sign-in -> existing stable family account -> people and chosen drawings -> typed or spoken moment -> useful inline clarification only if needed -> existing saved-guide/research path -> existing story and picture pipeline -> saved five-page kit -> existing reader and downloads.

An owner-only route exposes a deliberately small finished-kit view. It does not reuse the full family/session response. Reading routes never depend on permission to make a new story.

## Existing stack and reuse

The inspected working app uses Node, React, Vite, Material UI, Sharp, Playwright and Chrome for page rendering. Keep these. There is no reason to rebuild the app or add a second framework.

Declared package ranges at inspection: Node ^20.19.0 or >=22.12.0; React and React DOM ^19.3.1; Vite ^8.3.4; Material UI ^9.5.0; Sharp ^0.35.5; Playwright Core ^1.64.1. These are package.json ranges, not a fresh claim about the newest versions or exact installed versions.

Documentation: [Node](https://nodejs.org/api/), [React](https://react.dev/), [Vite](https://vite.dev/guide/), [Material UI](https://mui.com/material-ui/), [Sharp](https://sharp.pixelplumbing.com/), [Playwright](https://playwright.dev/docs/intro).

Use server/app-server.mjs, app/main.jsx, app/navigation.js and the existing account/child checks. Keep private files under the current family IDs. Do not copy original family data into a new public store. Keep original completed files unchanged.

## Where it runs and how someone tries it

The present local app runs from the project checkout:

```sh
PORT=4317 STORY_POSTER_GENERATION_ROUTE=subscription npm start
```

Open http://127.0.0.1:4317. Reuse the existing listener if healthy; do not start a second process against the same data folder. A local recording remains possible without publishing anything.

Current source binds to 127.0.0.1, accepts local Host/Origin only and uses local cookie settings. Remote access is not obtained merely by sending its address to someone. A trial URL needs explicit HTTPS origin configuration, correct cookies and ownership checks. Do not replace the local-only checks with arbitrary origins or proxy headers.

Owner decision, October17: saved reading and downloads must remain available when the Mac is offline. Use Railway with Postgres and GitHub. The temporary competition showcase is now about a month, superseding the earlier one-to-two-week estimate. Sunny requests his existing Codex app/CLI plan for temporary picture generation; this is his chosen route, not a newly verified provider entitlement.

Recommended implementation: one Railway web service serves sign-in, reading and downloads, with Postgres for accounts/job state and a private persistent volume for generated files. The Mac pulls generation work through an authenticated outbound connection and sends completed assets back. No public inbound Mac port, second queue service or cloud Codex credential copy. Existing stories keep working if the Mac stops; unfinished generation waits honestly. This architecture follows the availability decision but remains part of the draft for final review.

Railway account access was verified read-only October17. No Story Poster project appeared under that name. An unrelated service was not a confirmed deployment of this app and was left untouched. The source repository was private. Plan an isolated Story Poster service unless a later exact existing target is identified. No project or deployment was created.

## Look and feel

Implements prd.md > Look and feel and Screens and layout.

Retain warm cream and teal, current local Plus Jakarta Sans, Georgia headings, large family art and saved covers. Light is default; dark stays optional. Keep three first-story stages. Add Talk, short help and grown-up selection within existing pages. The exact saved rhyme continues through app/story-presentation.js. No new decorative art or layout chooser is needed.

## Components

### Moment input and speech

Implements prd.md > Voice and useful questions.

Add a small app/MomentInput.jsx component around the existing controlled moment text. A proposed app/useSpeechInput.js hook owns microphone start, stop, final/interim text and cleanup. The browser requests microphone use only after a tap. Leaving the page, changing family or signing out stops capture. Never auto-submit a transcript or start listening again on return.

Candidate recommendation: browser speech recognition first, editable result, typed fallback. This avoids adding an app-billed speech provider, but browser coverage is limited and recognition can send audio to the browser vendor. It is not universally on-device or offline. This tradeoff needs to be shown in the build-plan review before selection.

Reuse the relevant lifecycle lessons from the existing voice transcription implementation and the transcribe-voice-multilingual skill. Do not copy its full multi-provider translation chain: that code also records audio for paid services and has app-specific names and language decisions. No new translation requirement has been approved here.

If reliable coverage requires a metered transcription service, return with the actual provider, cost, data handling and cap before adding it. The newer Sign in with ChatGPT flow does not supply transcription.

### Inline clarification

Implements prd.md > Voice and useful questions.

Use the existing generation transport, private record and request accounting. Proposed POST /api/moment/clarify accepts childId, current note, selected kitContext and prior clarification turns, and returns either ready or one necessary question with a draft identity. Treat all supplied text as data, never tool instructions. Keep the parent's original words and explicit answers separately.

Reuse the result for Create only while account, child, note and selected people still match. A changed note invalidates the old answer. No unconditional second interview and no keyword list pretending to understand the note. The final generation path must still preserve factual/inspired mode and the actual supplied events. Clarification cannot spend outside the existing durable allowance; the exact draft-to-job accounting must be checked in implementation design before code.

### Invitations and password recovery

Implements prd.md > Invitations and account recovery.

Preserve stable account IDs, existing password hashes, private files and sessions. Recommended shape: extend the existing account service with email verification and single-use hashed verification/recovery tokens rather than replacing every family with a new identity system. This is a recommendation pending the final service review.

The current API creates the account only when people are submitted. The new email path needs an account that can exist before family setup completes. Mark setup completeness separately, and resume at the existing People stage. Old accounts must continue to read their existing files without automatic email matching or destructive migration.

Proposed routes: POST /api/auth/register for email and chosen password; POST /api/auth/verify for a single-use verification token; POST /api/auth/recovery/request for email; POST /api/auth/recovery/complete for token and new password. Mandatory invitation routes are no longer required. Recovery keeps the account ID and invalidates obsolete sessions. Generic request responses must not reveal who has an account. Expired or reused links return useful next steps.

Use a standard email delivery service or an already configured suitable sender. Candidate: Resend, which requires a verified domain the owner controls. Do not pretend the test sender can send to the whole invited group. Sender/domain, service account, current limits and costs remain unselected. No credentials in browser code, logs or planning files. No actual invitation or recovery mail is sent during planning.

### Account capacity, daily stories and revocation

Implements the latest owner-directed self-signup amendment in prd.md.

Enforce the initial 50-account ceiling transactionally in Postgres; concurrent signups cannot each claim the last slot. Do not treat 50 as simultaneous generating workers. Use the existing Chicago-day helper for the proposed per-account daily window. Record completed story IDs and reserved in-progress slots so simultaneous requests cannot exceed 3. Proposed counting rule: failed work is not a completed story, and resuming the same job never consumes a second story slot; its actual spent model requests still count. Make these derived details visible in the final build-plan review.

Add minimal owner account controls separately from the finished-kit content view: account identity and access status, not private notes/photos. A proposed PATCH /api/owner/accounts/:id/access records the requested access change and rechecks it on job claim, before model work, before publishing a result, and on family requests. Revocation means generationEnabled=false, not account suspension: keep sign-in, recovery, reading and downloads. Apply it to new generation requests and queued new-story work, without removing existing finished assets. Preserve in-flight answers and spent requests; do not erase useful completed work. Revocation is not deletion. Owner management access remains available.

The signup ceiling and daily quota belong in shared server logic and tests, not hidden buttons or an AI decision. Existing original account IDs and saved assets remain. Trial ending is distinct from revocation and quota exhaustion: neither a full daily quota nor normal trial end removes saved reading/download access.

### Finished-kit owner view

Implements prd.md > Finished-kit owner review.

Proposed app/OwnerKits.jsx and server/owner-kits.js, connected through the existing server. Bind owner access to an explicit account ID, never a query flag, email display name or first-created account. Normal family routes retain account/child isolation.

GET /api/owner/kits returns only completed kit identifiers, title, completion time and permitted cover/reader links. GET /api/owner/kits/:id and its allow-listed file route return only finished result content and final assets. Build the response field by field. Never return raw account objects, checkpoints, notes, family records, request logs or source uploads.

The participant notice explains review before family information is supplied. Owner review does not imply that the administrator of the physical storage has no other access. Trial creation controls must not prevent participants from reading or downloading saved work.

### Selected story people

Implements prd.md > Brief help and choosing the grown-up.

Extend the existing kitContext in server/app-data.js buildKitRecord with selected grown-up IDs. Resolve them only inside the current family, like existing selected siblings. Preserve the saved master family and chosen portrait files; filter a per-job copy. Store the selection in the job and keep it through Resume.

The same selection feeds story people, parent wording, picture references, speaker checks and source-learning context. A chosen grown-up learner must remain among the selected participants. Historical jobs without this field keep their original meaning. Extend test/family-context.test.mjs for the class, including the second adult and two adults, rather than patching one panel.

### Story-to-picture action agreement

Implements prd.md > Story and comic agreement.

Extend the existing server/panel-contract.js and scene request assembly so each panel carries the intended actor, object, action and physical relation from the accepted story. Both individual-panel and native four-scene-sheet requests must use the same description. Avoid guessing hidden geometry or changing the story to suit an image.

Read the saved shape checkpoint and exact prompts before implementation. Use a separate revision for corrected art and compare real exported panels against the sentences. Do not add a whole-kit redraw loop, an appearance gate or an automatic retry budget reset. Existing speaker/factual checks remain; uncertain artistic opinions remain advisory.

### Broader source discovery

Implements prd.md > Fitting research beyond PubMed.

Extend server/library-sources.js with named source adapters. Preserve the current PubMed implementation and historical receipts. Additional lane: official ERIC education records plus selected primary papers and official guidance, with actual source-rights checks. The official ERIC API and a generic test request were verified October17: GET https://api.ies.ed.gov/eric/ accepts search, format, start, rows and fields. JSON returns response.docs with ED/EJ identifiers and metadata. One generic request returned HTTP200; it is retrieval proof, not an accepted teaching source. Use the current YAML specification, not an older PDF with different page-size limits.

Use an explicit source type with title, stable ID/URL, source body, scope of that body, publisher, actual date or undated label, fetched time, content hash and notices. A full paper or official guidance must never masquerade as a PubMed abstract.

Reuse the existing library document builder, source evidence and separate reviewer. Update every consumer that currently assumes source.abstract or a PubMed URL, including library-action.js, library.js, library-prepared.js, source rendering and cache identity. Add the source version to new evidence without rewriting old guides or resetting spent attempts. Public queries contain only cleared general concepts. Fetches must reject private network addresses and unsafe redirects; broad discovery does not mean arbitrary internal URL access.

Do not assume an ERIC index record is itself adequate evidence for an activity. Retrieve and check the actual supporting content. Generalization, relevant populations and source limits still govern reuse.

### Help, reader and after-trial access

Implements prd.md > Brief help and choosing the grown-up and States and boundaries.

Keep page help short and contextual in the existing components. Retain the older video and its truthful label. Reuse Our stories, StoryReader, PosterReader, downloads and saved reading positions.

Model permission to create new work separately from permission to authenticate/read/download. Do not attach trial expiry to family deletion or saved-file access. New-generation policy after the trial remains unset until Sunny chooses it. Preserve existing user-requested family deletion.

### Demonstration and interview material

Implements prd.md > Demonstration and interview preparation.

Reuse saved fictional kits, the original interview answers and current question packet. Complete the pending demo-topic comparison without inventing finished review stages. Update claims only after their features are proved. Use honest time cuts in the demo. No public upload or submission is authorized by this draft.

### Hosted job handoff and Mac generation worker

Implements prd.md > States and boundaries and the October17 availability decision.

Proposed server/generation-worker.mjs on the Mac polls fixed authenticated job routes. Postgres tracks a leased job, its account/child/context, request ledger, progress and result manifest. The worker accepts only known operations such as portraits, clarification, research and kit generation, never arbitrary shell commands or executable code from a browser.

POST /api/worker/jobs/claim returns one job with a lease; POST /api/worker/jobs/:id/heartbeat reports progress; PUT /api/worker/jobs/:id/assets/:name sends an allow-listed generated asset with its hash; POST /api/worker/jobs/:id/complete validates the full manifest before exposing the finished kit. A dedicated revocable worker credential stays server-side and in the Mac Keychain. Reject expired leases and wrong job/account bindings. These routes are unavailable to family sessions. PostgreSQL row locking prevents duplicate claims; no Redis is needed.

The worker reuses createKit/createPortraits/createLibrary and the existing subscription transport inside a private job directory. Preserve the same checkpoint, stage answers and spent request ledger after interruption. A remote lease timeout must not reset allowance or immediately buy a duplicate picture. Reconcile an uncertain in-flight result before resuming; saved files remain evidence. Plan one active generation worker initially, matching the Mac resource limits.

Original photo inputs remain memory-only. Do not quietly store them in Postgres or the file volume to bridge an offline Mac. Before starting a photo transfer, verify worker availability and current permission, then relay to the active portrait operation without disk caching or request-body logs. If the worker is unavailable, keep already saved drawings and ask for a later photo attempt; typed appearance descriptions remain saved private input. Chosen drawings and generated results can be stored privately as before.

A family deletion removes hosted records/assets and revokes pending work. The worker checks job validity before new model work and before publication, then removes its associated private cache when instructed. Do not resurrect a deleted family through a delayed upload.

## Data model

Existing private data remains under context/local-app with stable account and child IDs, family drawings, jobs, checkpoints and logs. Keep the shared general catalog separate.

Proposed additions: verified email and setup status on accounts; explicit owner role assignment; separate hashed verification/recovery token records with expiry/use status; per-job selected grown-up IDs; private clarification drafts bound to note/context; typed source receipts for additional providers; a generation policy separate from saved reading. Never store passwords or raw tokens in plain text.

Use the owner-selected Postgres as the authoritative store for hosted accounts, sessions, token records and jobs. Keep existing record shapes in JSONB where useful rather than redesigning every family field. Add a narrow store interface so the local fixture/test path can retain its existing files. Import only the approved data set with stable IDs and verified file hashes; never upload the whole private context tree. Keep original local files and a tested restore path. A copied JSON file on two writers is not a synchronization design.

Use a private persistent Railway volume for kit files and chosen drawings, served only after existing account/child or explicit owner checks. Postgres holds each asset manifest and hash. Write uploads to temporary paths, verify bytes, then publish the complete manifest and mark the job complete in one database transaction. A database row alone cannot prove a file exists. Restart and backup/restore tests must cover the database and its matching assets together. A storage bucket is an alternative if the single-service volume proves unsuitable, not an additional requirement now.

## Proposed file structure

Existing files are kept. New files below are proposed only.

```text
app/
  main.jsx                 Existing screen assembly
  navigation.js            Existing account-bound navigation
  MomentInput.jsx          Proposed Talk and editable note
  useSpeechInput.js        Proposed capture lifecycle
  OwnerKits.jsx            Proposed finished-kit owner view
  StoryReader.jsx          Existing saved story reader
  PosterReader.jsx         Existing readable poster words
  GuideHelp.jsx            Existing help and historical video
server/
  app-server.mjs           Existing account and route entry point
  account-email.js         Proposed signup/verification/recovery logic
  mail-delivery.js         Proposed selected delivery adapter
  app-store.js             Proposed local/Postgres store interface
  postgres-store.js        Proposed hosted accounts and jobs
  generation-worker.mjs    Proposed outbound Mac job worker
  worker-routes.js         Proposed fixed leased job protocol
  migrations/             Proposed versioned Postgres schema
  moment-clarification.js  Proposed private question stage
  owner-kits.js            Proposed minimal owner projection
  app-data.js              Existing per-story people assembly
  panel-contract.js        Existing shared panel contract
  requests.js              Existing model request assembly
  picture.js               Existing native-sheet and panel work
  library-sources.js       Existing source adapters, to extend
  library-action.js        Existing source-to-action evidence
  library-prepared.js      Existing typed prepared sources
  library.js               Existing research workflow/builder
  subscription-transport.js Existing requested generation route
test/                      Existing tests and browser/export tools
devpost/                   Scope, product plan, this build-plan draft
context/                   Private ignored family data and evidence
```

## External services and evidence

Official documentation read October17:

- [ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source): describes users authorizing their own plan for open-source/local apps and directs remote or paid apps to an interest form. This is not confirmation that one owner's plan can serve independent invited families.
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations): that particular Responses/app-server flow does not support image generation or transcription. It is not the existing CLI picture route and must not silently replace it.
- [SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition): limited browser availability; some implementations send audio to a recognition service. No universal offline or on-device claim.
- [Railway volumes](https://docs.railway.com/volumes): persistent files mounted at runtime, with backup support. Do not write permanent kit assets only to a temporary deployment filesystem.
- [ERIC API specification](https://eric.ed.gov/api/eric-api.yaml): verified live metadata search; actual paper or guidance content still needs retrieval and review.
- [Sign in with ChatGPT terms](https://openai.com/policies/sign-in-with-chatgpt-terms/): the new SIWC integration explicitly disallows using one user’s subscription for another user’s requests. Do not propose that route as approval for pooled usage. This is not a tested replacement for the existing CLI.
- [Resend verified domains](https://resend.com/docs/dashboard/domains/introduction): sender needs a verified domain controlled by the owner. Current account and sender availability are unverified.

The existing subscription transport stays the development route with no API key fallback. Do not turn unverified shared-family permission into either a claimed approval or a newly invented permanent ban. Resolve the exact supported trial arrangement before invitations.

Candidate email contract if Resend is selected: POST https://api.resend.com/emails with server-side Bearer authentication and from, to, subject, text/html; successful response includes id. Use a stable idempotency key for retries, store delivery status separately from token acceptance, and never log live recovery links. See https://resend.com/docs/api-reference/emails/send-email. Sender selection and delivery limits still need verification.

Selected email configuration, actual cost and service limits must be filled in after the remaining choices are settled. This draft is deliberately not ready for build approval while those decisions remain open.

## Verification and ordered implementation

After build-plan approval, order work by shared prerequisites: account/read-access boundaries; moment input, clarification and chosen people; shared art/source improvements; owner view and email integration; final all-screen/kit proof and demonstration updates. Exact build checklist belongs in the installed 5-build step, not a falsely completed file now.

Extend existing class tests for account isolation, token use/recovery, voice failure and account changes, participant propagation, typed sources and preservation of completed files. Keep old fixtures labelled. Lead runs the combined suite/build and relevant browser walk at completion; inspect both themes and actual exported pages. A physical iPhone or real-family test is never inferred from browser simulation. A different Codex model checks substantial implementation under current AGENTS.md.

Current checks to reuse: npm test, npm run build, test/walk-nightly.mjs --offline --all-screens, test/render-saved-kit.mjs for separate export evidence. Fresh generation uses the existing route and durable accounting, not a new test engine.

## Decisions and open issues

Settled: original purpose, existing stack, family likeness/styles, original five-page kit, all seven pending work groups, three first-story stages, finished-kit owner visibility, after-trial reading/download access, no silent paid generation switch, and no public actions without the concrete final authorization.

Answered: saved reading must work with the Mac offline. Railway, Postgres and GitHub are selected; existing Codex CLI remains the requested temporary generation route for about a month. Do not ask the hosting question again.

Latest owner answer replaces mandatory invitations with self-signup, an initial 50-account ceiling, a 3-story daily cap per account and owner revocation. Sender remains service configuration to resolve; do not repeat that question now. Answered: rescinding access disables only new-story creation. Saved reading/downloads, sign-in and recovery remain available.

Pending recommendation review: browser speech with typed fallback versus a separately priced transcription service; existing account extension and choice of email sender. Do not ask for credentials in chat. Inspect existing approved integrations before asking Sunny to choose a new service.

Pending evidence: supported shared generation arrangement, account-specific sender setup and hosting costs. ERIC retrieval is verified. Independent research is evidence, not approval.

Research receipt: ChatGPT and Grok completed and supported extending the existing app, editable text with browser speech fallback, a verified email sender, persistent saved reading and a separate ERIC adapter. Gemini's existing route returned a billing error; no paid fallback was used. Reddit RSS completed; signed-in browser Answers attempts failed and were not presented as successful. Their general agreement is advice, not service authorization. Use the live ERIC YAML/probe over an older page-size claim in one model answer. A separate read of this draft found no material contradiction in hosted reading, the Mac worker or memory-only original photos.

Learning intention: preserve the original idea through change. Each component above names the approved product behavior it serves. Remove additions with no such purpose; do not add more guard screens to demonstrate planning rigor.


## October 17 signup wording correction

Sunny supplied the signup screenshot and said: “Remove this completely from the wording.” Remove both shown paragraphs about the 50-account/3-story limits and owner review from signup. This supersedes earlier instructions to show those paragraphs there. The account limits and finished-kit owner function remain as separately requested behavior. Do not mark the removed wording as read or accepted by a participant.
# Approved experience follow-through, October20

PRD source: the final “Approved experience follow-through, October20” sections. User approval and fast build mode carry forward; no new provider, framework, paid API fallback or duplicated worker.

## Progress and completion contract

Derive a sanitized account-owned job presentation from existing persisted job stages and worker request state. Distinguish waiting, active work and unavailable worker without disclosing another family's queue contents. Keep the current serial model-request loop and separate owner-alert loop. Preserve restart, uncertain-outcome and Resume behavior; an animation is not evidence of an active model call.

Add a per-job opt-in for a completion email, accepted only for a verified account. Reuse the current mail sender and durable outbox/retry approach. Queue only after the finished kit and files are stored successfully; use a stable job-specific idempotency key. Validate ownership/account existence at delivery time. Do not include child or story details in the subject/body. A successful provider receipt is delivery evidence, not human inbox reading.

## Monochrome saved export

Reuse the existing saved-kit renderer and rendering checks rather than another story/picture engine. Create a distinct derived monochrome PDF from the same saved words and art, with white paper and legible grayscale contrast. Serve it only through the owned result/file route and preserve original bytes. No generated artwork, new story allowance use or silent replacement of old assets. Keep the existing colour path. Public sample export may use its explicitly public reviewed assets only.

## Private practice answers

Reuse the existing plan prompt structure and existing authenticated account store. Key saved answers to the owned finished job, validate fields and length, escape display text and offer explicit save/edit/clear. Keep storage separate from the immutable kit and include it in family/job deletion. Do not expose these answers through the public sample or owner finished-kit review. Guests/sample readers may see blank prompts but cannot save family answers.

## Interface and verification

Use existing font files and theme tokens for the accepted tagline. Mainline text should meet at least 4.5:1 contrast in both themes. Check at narrow phone and desktop widths, text enlargement and reduced motion. Main thread verifies the frozen integrated change once; focused backend tests must cover ownership, queued/active/offline state, notification eligibility/idempotency/deletion, original export preservation and practice isolation. Actual browser checks cover the visible transitions, optional controls, reader and print choices. Obtain a different-model review and actual Fable design review. Do not deploy until the combined checks are complete.
