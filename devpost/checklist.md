---
doc: checklist
status: approved
previous_baseline_status: approved
revision_status: approved
revision_authorization: "Start bother build now and ask whener u need my input go"
revision_date: 2026-10-19
recorded: 2026-10-17
authorization: owner-directed autonomous completion
---

# Overnight build checklist

Build mode: fast, autonomous. Sunny explicitly directed “Finish this work now don’t ask me any further questions finish it and give me result in the morning”. This replaces further interview pauses, not truthful reporting or final publication rules. Human testing is not claimed while he sleeps.

## Slices

- [x] **1. Describe one moment by voice or typing with the right people**
  Becomes usable: Talk fills editable text, useful questions stay inline, and selected grown-ups follow the story.
  Why now: This directly serves the calm shared-story purpose.
  PRD ref: `prd.md > Voice and useful questions`, `Brief help and choosing the grown-up`
  Spec ref: `spec.md > Moment input and speech`, `Inline clarification`, `Selected story people`
  Build: Reuse current screens, private drafts, transport accounting and selected family drawings.
  Verify (mechanical): Speech/controller, clarification and family-context tests; browser checks in both themes.
  Learner check: Morning review can speak a note, correct it and choose a grown-up. Not yet performed by Sunny.
  Commit: Integrated verified feature commit.

- [x] **2. Sign up and keep access to saved stories**
  Becomes usable: Parents create their own email/password accounts, recover access and keep saved reading when creation is disabled.
  Why now: The requested showcase requires owned family access and explicit limits.
  PRD ref: `prd.md > October 17 self-signup and owner controls`
  Spec ref: `spec.md > Invitations and password recovery`, `Account capacity, daily stories and revocation`, `Finished-kit owner view`
  Build: Email setup/recovery, 50 accounts, 3 new stories/account/Chicago-day, creation-only revocation and finished-kit owner view.
  Verify (mechanical): HTTP account/token/quota/owner isolation tests, legacy compatibility, both-theme account screens.
  Learner check: Morning review can inspect accounts and disable creation while saved stories remain accessible.
  Commit: Integrated verified feature commit.

- [x] **3. Find fitting education sources and draw the actual story action**
  Becomes usable: Research can use ERIC and comics receive shared action/surface directions.
  Why now: These are the two demonstrated generation gaps.
  PRD ref: `prd.md > Fitting research beyond PubMed`, `Story and comic agreement`
  Spec ref: `spec.md > Broader source discovery`, `Story-to-picture action agreement`
  Build: Typed source adapters and shared panel instructions, preserving old receipts and completed files.
  Verify (mechanical): Source parsing/review/consumer tests, live generic ERIC retrieval, exact saved shape comparison and separate generated revision when feasible.
  Learner check: Read the relevant new comic and source note. Never infer family learning benefit.
  Commit: Integrated verified feature commit.

- [x] **4. Keep hosted reading available while the Mac makes new content**
  Becomes usable: Railway/Postgres/private files serve accounts and reading; an outbound Mac worker runs fixed model requests.
  Why now: Sunny explicitly requires saved access with the Mac offline.
  PRD ref: `prd.md > States and boundaries`
  Spec ref: `spec.md > Where it runs and how someone tries it`, `Hosted job handoff and Mac generation worker`
  Build: Durable hosted state, configured origin/cookies, fixed outbound model bridge and Linux page export.
  Verify (mechanical): Store/lease/worker tests, worker disconnect and restart, actual hosted/read-only proof if deployed. Do not call fixtures a real deploy.
  Learner check: Morning URL and actual delivery status, if deployment was completed.
  Commit: Integrated verified feature commit.

- [x] **5. Check the full journey and prepare the demonstration and interview**
  Becomes usable: A truthful demonstration kit and updated rehearsal material match the finished app.
  Why now: The complete result must meet the original idea, not just pass separate component tests.
  PRD ref: `prd.md > Demonstration and interview preparation`
  Spec ref: `spec.md > Verification and ordered implementation`
  Build: Integrate all changes; select an ordinary difficult-moment demonstration; update the existing rehearsal copy without inventing personal answers.
  Verify (mechanical): Different-model review, combined tests/build, real browser in both themes, exported pages and preserved historical bytes.
  Learner check: Morning review of actual result. Unperformed human checks remain labelled.
  Commit: Integrated verified feature commit.

### October 19 continuation plan

The completed slices above remain complete. The following order follows Sunny's request for one improvement at a time. Sunny authorized the build on October19: "Start bother build now and ask whener u need my input go". This lifts the planning-only boundary. Fast mode carries forward; no repeat mode interview is needed.

- [x] **6. Keep the familiar reminder across new stories**
  Becomes usable: A revisited topic keeps its chosen reminder while the moment, story and pictures change. Parents can learn alongside the child.
  Why now: This is the owner's central correction to preserve the original experience.
  PRD ref: `prd.md > Familiar topic reminders and shared learning`
  Spec ref: `spec.md > Familiar reminder binding`
  Build: Bind the reminder to the topic and snapshot it on each kit; update every word and export consumer together; preserve historical kits and source evidence.
  Verify (mechanical): Two different moments on one topic; matching words throughout each kit; Resume after a later default change; unchanged earlier files; actual exported pages.
  Learner check: Compare the two stories and confirm the reminder feels familiar while the moments differ.
  Commit: Preserve familiar topic reminders across new stories.
  Evidence: October19 local implementation passed1,145 tests and build. Independent GPT-6.1 Sol review is clear after retry and legacy-note fixes. Two actual subscription text generations keep Name it to tame it with different stories/scenes and measured page fit. Proof: context/familiar-reminders-2026-10-19. Sunny accepted the simple family dialogue and asked to use age8 language in parent guides too. A real age8 fictional kit, When the Rules Changed, completed with eight model requests and five exported pages. Final wording/export verification is recorded below when complete. Family comprehension is still untested.

- [x] **7. Reconcile and bring in the missing saved content**
  Becomes usable: Missing completed general guides are present without duplicates. Original posters remain references for the feel and wording of newly generated stories.
  Why now: Some checked general guides remain outside the live library. The historical poster list is a reference collection, not an archive to import.
  PRD ref: `prd.md > Complete the saved content collection`
  Spec ref: `spec.md > Content reconciliation and import`
  Build: Check the three local candidates, import eligible general guides through the existing path, resolve overlaps and investigate the grade-only fit case. Do not build a historical-poster import feature.
  Verify (mechanical): Import twice without duplicate entries; compare source evidence; test general/private separation and supported audience selection; leave existing original files unchanged.
  Learner check: See the missing guides in the library and judge whether a newly generated kit carries the familiar poster feeling.
  Commit: Reconcile the missing general teaching guides.
  Local result: Three general documents imported through existing checks. There are34 records and33 distinct actions. The overlapping feelings guide uses the canonical familiar reminder. Optional explicit school grade now supports the saved grade-based guide. No personal posters or private family facts enter this library.

- [x] **8. Choose a look for each new story**
  Becomes usable: Every new story offers the original three styles, with consistent faces and optional outfit changes.
  Why now: This is the remaining visual behavior the owner explicitly requested.
  PRD ref: `prd.md > Choose the look for each new story`
  Spec ref: `spec.md > Per-story style and preserved likeness`
  Build: Reuse the three personal setup previews before each story; create one kit in the chosen style; generate only missing references in that style. Add the proposed one-person, one-style redraw control through the existing replacement flow and retain older references.
  Verify (mechanical): All three saved choices available without generation calls; one chosen style creates one kit; missing portraits created only for that style; redraw affects only the requested person/look and retains the old selection until accepted; Resume preserves the choice; old stories unchanged; actual output and both themes inspected.
  Learner check: Start another story, see all three styles, and inspect likeness in the completed result.
  Commit: Allow a fresh style choice for each story.
  Local result: All three saved previews are shown per new story, one choice makes one kit, and redraw keeps the old chosen person drawing until a replacement is chosen. Stable job references and per-kit outfits are checked. Phone-sized screens in both themes have been inspected. Fixture drawings do not prove real family likeness.

## Hands-on Checkpoints

- [x] Early owner tone checkpoint: Sunny approved the simple dialogue and requested age8 wording throughout, including parent guides.
  Do not ask for the same approval again. The exact words25/38 remain undecided; existing wording stays. Actual family testing remains in the final hands-on check below.
- [ ] Final owner checkpoint: read a completed family kit, try phone speech and reopen/download the same story.
  Owner input: report whether the chosen faces and style look right, whether the story serves the actual moment and teaches both parent and child where appropriate, and whether speaking/editing/reading works on the phone. The agent handles code checks, failure diagnosis and repairs.
- [x] Final continuation review: reported failures resolved, independent review and combined tests complete locally.
- [x] Learning wrap-up: The owner asked to keep a familiar reminder while each story follows a new moment. This records a product choice, not a measured learning outcome. The app map below connects the build to that goal.

After these steps, use 6-ship for the real demonstration video, safe public source copy, owner-written form answers, exit survey and verified accessible links. Public posting remains a separate concrete approval.

Shipping input timing: choose the exact existing family photos permitted in the public demonstration before recording; provide narration in the owner's own words; review the actual edited video and public source package before publication. The agent handles recording mechanics, sound cleanup, captions and link checks. Do not ask the owner to repeat the already-settled motivation, audience, hosting or account decisions.

- [ ] Human exploration: deferred by Sunny's instruction to work without further questions.
- [ ] Final personal feedback: not fabricated from agent/browser checks.

## Final Review

- [x] Lead gap/simplification/security review and combined verification complete.
- [x] Actual evidence and remaining limits recorded for the scheduled morning report.

## Code Tour and App Map

- [x] Short plain app map ready in FOCUS.md for the morning report.
- [x] Personal reflection preserved as Sunny's own words; no invented mastery.

Activity and evidence: use context/overnight-1017 for actual receipts and per-agent progress. Code for slices1-4 is complete. Combined1141checks passed; final listening-rule recipient checks76root/81independent passed. Live deployment, delivered verification/recovery, persisted family drawings and draft, and Resume without a second daily slot are proved. Slice5now also has actual5pagePDF inspection, both reader themes, worker-offline and creation-off read/download proof, real useful clarification, and the revised10page interview packet. Human phone speech and family outcomes are unperformed, not silently checked off.
Activity mode: autonomous build by owner instruction; human practice may follow in this chat.

## Revisions

- Hosted service keeps orchestration and page export; Mac worker handles fixed model requests through the existing transport. This reduces copying of whole family job trees and keeps the cloud data authoritative.

## Final live evidence, October18

Runtime e6e3e6f deployed successfully on Railway. After the Tag Game uses fictional Maya and Mom, Name the feeling, and the six-word rhyme Say it clear. Name what's here. It resumed the same job through worker reconnect and Linux print-font repair, with one daily story slot. The PDF has5Letterpages, all inspected. Saved reading/downloads worked with worker offline and creation disabled; final worker online, creation enabled. Unauthorized download401; owner raw-file request404; owner review showed0unfinished then1finished kit. See context/overnight-1017/live-proof.

Shape correction is a separately reviewed image/edit and five-page export. All87original source files still match their hashes. The interview packet has40topics/10pages, all rendered and inspected. Original interview packet is preserved. These are software and artifact proofs. The morning message is scheduled for7AMCentral; no final contest submission or video was made.

## Continuation app map, October19

Family saves the people and their three chosen drawing styles. Tonight saves one moment and the people reading together. The guide library supplies a checked action and its familiar reminder. A private story job keeps those choices while making one story, its pictures and five pages. Our stories keeps finished kits available to read and download. The owner can stop new creation without removing saved reading.

The October19 additions are local until a separately approved deployment. Public demo photos, the owner's narration, an accessible video, a reviewed public source copy, his own form answers and exit survey remain part of shipping. Do not call the contest entry complete.

Continuation code verification:1,172 tests pass, zero failures/skips. Frontend build passes. The final separate five-page age8 export fits in both themes, has no missing panels and preserves every original kit file. Sol checked source-note wording, consumer integration, reference/grade behavior and final colour/copy changes. The complete local screen walk passes118 screenshots and18 grouped checks in both themes. It uses fictional accounts, local-login fallback and injected replies. Physical iPhone speech and family comprehension remain untested. Evidence: context/continuation-walk-current-2026-10-19-e/walk.json.

## Approved live update, October19 evening

Sunny approved deployment of1b1a516. Railway deployment5ed882fa-4179-424f-b2d6-e3cc94fd6e72 succeeded. All193 runtime files match that commit and all5saved PDFs are unchanged. The independent live checker wrote fresh PASS evidence at21:37CT:44screen/state pairs,88captures in both themes. Its scope and untested conditional states are listed in build-check-report.md. No current phone/real-family outcome or fresh live generation claim is made.

At this earlier checkpoint, the interface polish and request-only access were proposals. Sunny then approved both. Their completed release is recorded below; the phone trial and Devpost media/submission remain unfinished.

## Approved Storybook and invitations build, October19 evening

Authorization: "And can you connect invitation with my telegram and email both? And storybook is good go Make the changes". Temporary demonstrations use the existing owner Codex connection, with no paid fallback. Existing answers remain settled.

- [x] **9. Receive and approve access requests, with three onward invitations**
  Becomes usable: Requests reach Sunny on Telegram and email; approved families enter with a one-use link and can invite three more families for approval.
  Why now: Sunny selected an invited demonstration group and direct phone notices.
  PRD ref: `prd.md > Requests, approval and three invitations`, `Notices and demonstration connection`
  Spec ref: `spec.md > Access and referral contract`, `Two-channel owner notices`
  Build: Reuse current accounts, mail, hosted data and fixed worker. Preserve reading and daily story behavior.
  Verify (mechanical): Approval, token, replay, concurrent slot/capacity checks, durable partial delivery and worker tests. Confirm labelled real delivery to Sunny only.
  Learner check: Receive a real test request on his phone/email and open its owner review link.
  Commit: Add approved access and three family invitations.
  Result: Built and deployed in `63e562a`. One controlled request proved Telegram delivery and both owner/admission email delivery events. Email-bound one-use signup, three link-only referrals, fourth-referral refusal and retry reuse passed. The test account was deleted; original data and allowances stayed unchanged. Sunny's own phone reading remains unconfirmed.

- [x] **10. Apply the approved Storybook look and show a fictional sample**
  Becomes usable: Warm artwork-led pages keep one clear action, all saved style choices and a working fictional example.
  Why now: Sunny chose the actual page previews.
  PRD ref: `prd.md > Storybook pages`
  Spec ref: `spec.md > Storybook and public example`
  Build: Apply the approved design to existing screens and add the new request/approval/invite controls. Reuse reviewed fictional sample art.
  Verify (mechanical): Current mobile and desktop flow, both themes, real-image ownership, visible actions, reader/sample hashes, different-model review and combined build/tests.
  Learner check: Try the updated flow on his phone; human results remain unclaimed until he reports them.
  Commit: Apply Storybook pages and the public fictional sample.
  Result: Built and deployed in `63e562a`. Combined 1,195 tests and build passed; actual Fable review found no must-fix issue. The live public sample opens and downloads, and all seven assets match their saved hashes. The live checker inspected both themes. Human phone feedback and fresh family likeness remain unclaimed.

- [x] **11. Release the integrated demonstration update**
  Becomes usable: The approved pages and invitation flow work on the existing hosted app with the current Mac worker.
  Why now: These changes need one integrated release and a fresh live check.
  PRD ref: `prd.md > Notices and demonstration connection`
  Spec ref: `spec.md > Verification and release`
  Build: Deploy the checked runtime package and enable request-only access; update/restart the existing fixed worker when idle.
  Verify (mechanical): Runtime hash, hosted data preservation, real owner delivery receipts, live screen checker report after deployment.
  Learner check: Review the useful result in chat and test his chosen phone journey.
  Commit: Record invitation release and current evidence.
  Result: Deployment `b7f389fc-2de3-422a-b2d9-7deb9f3763ef` succeeded on October 19 at 10:47 PM CT. All 206 runtime files matched `63e562a`; the existing idle worker was reloaded and its new alert poll succeeded. The independent checker wrote `build-check-report.md` with scoped PASS at 11:06 PM CT after loading 50 screen/state pairs in both themes, with 100 fresh captures.

- [ ] Sunny's own phone tryout and feedback on the approved flow.
- [ ] Devpost recording with chosen public photos and Sunny's narration, a reviewed public source copy, his submission answers and exit survey. No public repository or contest submission was made by this release.
- [x] **12. Show real progress and tell a parent when the story is ready**
  Becomes usable: A family sees one honest status sentence, can leave and return, and may choose a ready email.
  Why now: Sunny approved the next recommended improvement and the shared-reading tagline.
  PRD ref: `prd.md > Clear waiting and returning`, `Brand and future connection wording`
  Spec ref: `spec.md > Progress and completion contract`, `Interface and verification`
  Build: Add saved queued/working/offline presentation and optional verified-email completion notice. Apply the accepted tagline with the existing researched fonts and measured theme colors.
  Verify (mechanical): Owned-state and notification tests; actual page checks in both themes; frozen design and security review; combined build and tests.
  Learner check: Start a story, leave its page and return to its saved work. If selected, receive its ready email only after the complete kit is available.
  Commit: Show real story progress and optional ready notices.
  Result: Live in runtime7d1574e. Combined tests passed 1,214 checks; final wording and global font-registration corrections passed the build, focused browser checks, Sol review and actual Fable follow-up. Waiting/offline do not animate. Opt-in, completed-only notice, storage failure/retry and signed-out shelf return are verified with explicit fixtures. No live ready email or fresh generation is claimed.

- [x] **13. Print the same saved story in colour or black and white**
  Becomes usable: The print area offers a checked monochrome copy without another story or drawing.
  Why now: Sunny accepted the simple print-option recommendation.
  PRD ref: `prd.md > One story with two print choices`
  Spec ref: `spec.md > Monochrome saved export`
  Build: Reuse saved-kit export with a separate white-paper monochrome result. Preserve the original colour assets and existing three style choices.
  Verify (mechanical): Original hashes unchanged, no model requests, both print controls work, derived PDF opens and every page is inspected.
  Learner check: Open the monochrome preview and choose it for a black-and-white printer.
  Commit: Add monochrome printing from saved stories.
  Result: Live. An owned monochrome copy was prepared through the live button and both PDFs opened without changing the originals. Root inspected every page of the actual five-page sample derivative; the standalone poster is pixel-identical to its first page. Original seven public assets, story words and fictional profile are unchanged. Sol checked the nine-asset manifest and private export routes. No new model request or physical print test was made.

- [x] **14. Save optional family practice words**
  Becomes usable: A family can type, save, edit and clear the existing blank prompts in its private story reader.
  Why now: Sunny accepted optional saved answers after reading.
  PRD ref: `prd.md > Optional saved practice words`
  Spec ref: `spec.md > Private practice answers`
  Build: Reuse the existing blank-plan prompts with owned account storage and optional reader controls. Keep the original printed pages blank.
  Verify (mechanical): Ownership, isolation, validation, escaping and deletion checks; real save/reload/edit/clear browser flow; original kit unchanged.
  Learner check: Save a short plan, return to the story and find it; clear it without changing the story.
  Commit: Save optional practice plans with family stories.
  Result: Save, reload, edit/clear, conflict recovery, delayed-response navigation and second-account denial passed with real local owned storage and fictional accounts. The live Save, reload, edit and Clear flow also passed, restoring the original empty answer content at revision3. Original printed files stay blank. Full local screen walk passed 118 captures; final focused experience proof has 36 captures and checks both themes, reduced motion and text spacing.

These three approved steps are one integrated experience release. Existing models, generation limits, family accounts and invitation rules remain. Final publication of competition source, license selection and domain purchase are not part of this update.

Final experience release: deploymentd35c75f7-34c9-488a-85c6-1cb877124b63 succeeded October20 at6:54AM CT; all213runtime files matched7d1574e. Independent live checker scopedPASS at7:05AM CT covers26screen/state pairs in both themes, actual correct fonts and preserved records/files. No settings or worker reload changed. Conditional unvisited states and live ready-email/physical-phone limits remain in build-check-report.md.


## October20 approved reader and example release

Sunny approved invitation-only access, clearer welcome words, the full five-page poster viewer, a practical recess example with Pip and Dad, better black-and-white copies and a separate judge account.

- [x] Build the saved-PDF viewer and bounded private/public page routes.
- [x] Generate a fresh fictional five-page example through the app, keep its artwork and improve its words with an honest edited-example label.
- [x] Keep Name it to tame it, Dad learning too, and a practical next step without promising acceptance into the game.
- [x] Have actual Fable review the finished story and welcome words; run the real app story check.
- [x] Pass the combined 1,230 tests and production build; inspect all five color and monochrome pages and the phone reader in both themes.
- [x] Finish combined checks, deploy the exact commit and check the live screens. Runtime e7231163731e777204ea4a814f3deed1bb6159b2 deployed October 20 at 10:41 AM CT; all 214 runtime files matched and existing private records and files were preserved. The independent checker wrote a fresh scoped PASS at 10:58 AM CT for 64 live screen states, every sample page and viewer zoom in both themes. Conditional states and actions not exercised remain listed in build-check-report.md.
- [x] Prepare and verify the separate non-owner judge account on that deployment. Judge sign-in passed October 20 at 10:43 AM CT, with a fictional family, no owner access and invitation-only access retained. The independent browser check confirmed the separate shelf and refusal from owner routes.

Contest submission still needs Sunny's own narration, final video, approved public images if used, a reviewed complete public source copy and license choice, his form answers and exit survey. Preparing judge access does not submit the entry or send invitations.
