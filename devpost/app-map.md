# App map

Updated October 25, 2026 from runtime d48e8c508567839df8c92a42529dd2f05dfe9c02. The earlier map was recorded October 21. This is a description of the working app, not a backdated plan.

Family saves private people and their chosen drawings. Tonight keeps one moment and the people taking part. The guide library supplies a checked action and its familiar reminder. A private story job keeps those choices while producing a story, pictures and five pages. Our stories keeps finished kits available to read and download. The owner can stop new creation without removing saved reading.

| Part | Where it lives | What it does |
| --- | --- | --- |
| Parent screens | app/ | Family setup, Tonight, library, reader and saved stories |
| Web server | server/app-server.mjs | Owned requests, account access, files and job routes |
| Story work | server/kit.js and server/picture.js | Saved story and art stages with persistent request limits |
| Model connection | server/subscription-transport.js and server/generation-worker.mjs | Personal local Codex route and fixed outbound hosted worker |
| Teaching records | content/ and server/library.js | General guides, source evidence and private fit decisions |
| Printed pages | server/layout.js and server/print-copy.js | Five-page exports and separate monochrome copies |
| Earlier written instructions | war-room/research/chatgpt-growth-project/project-files/ | Sanitized reused prompt text, not earlier app source code |
| Checks | test/ | Unit, HTTP, privacy, fictional fixture and optional browser checks |

The October 17 and later plans were recorded after the prototype. Human phone speech, real-family comprehension and final demonstration feedback stay unclaimed until reported by the owner.

Current additions: About has ten questions and page previews. The public sample opens its poster first and offers an optional static recording. People shows each selected child’s saved three-look comparisons. New printed notes include source links; older saved exports remain unchanged.

The latest people page combines child and adult details with photos or free descriptions, nearby outfit controls, selected-picture marks and numbered navigation. Actual work status appears in the header and stage card, with motion disabled when requested. Saving and drawing are separate actions.
