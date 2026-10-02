# Team Chat – Test Stage (Version 2)

Branch: `test`  ·  Database: `metl-test.h2` (separate from the Dev `testdb.h2`)

## What v1 adds
- Docked **Team Chat** panel on the right side of the board (collapsible, unread badge)
- Real-time send/receive using MeTL's existing `chatMessage` stanza (saved in H2 by the existing `H2ChatMessage` table)
- **Presence** list: Online / Offline, from MeTL's attendance updates
- 1–2,000 character limit, checked in the browser **and** on the server (`ChatRules.scala`)
- MeTL's old footer "Chat" box is hidden so there is one chat

## Files
| File | Change |
|---|---|
| `src/main/webapp/static/js/teamChat.js` | new – panel UI + `TeamChatRules` |
| `src/main/webapp/board.html` | loads `teamChat.js` |
| `src/main/scala/com/metl/utils/ChatRules.scala` | new – server-side rules |
| `src/main/scala/com/metl/comet/MeTL.scala` | rejects invalid chat messages before they reach the room |
| `src/test/js/teamChat/teamChatRules.test.js` | new – 8 JavaScript unit tests |
| `src/test/scala/com/metl/utils/ChatRulesSuite.scala` | new – 5 Scala unit tests |
| `test-stage.bat` / `test-stage.sh` | promote + run the Test stage |

## Promote to Test
```
git checkout test
test-stage.bat        (Windows)   or   ./test-stage.sh   (Mac/Linux)
```
The script stops if any automated test fails (gate: tests must pass before promotion).

## Manual test checklist (take a screenshot of each)
1. Open a board: the Team Chat panel appears on the right.
2. Send "hello" with Enter: it appears with your name and time.
3. Open a second browser (or private window) as a second user on the same board: the message appears there without refreshing, and both users show **Online**.
4. Close the second browser: that user changes to **Offline**.
5. Paste more than 2,000 characters: the counter turns red, Send is disabled, an error explains why.
6. Collapse the panel, send from the other user: a red unread badge appears.
7. Stop and restart the server, reopen the board: earlier messages are still there (H2 persistence).
8. Type `<b>hi</b>`: it shows as plain text, not bold.

## Version 2 additions
- **@mentions**: type `@` for name suggestions; mentions are highlighted; the mentioned person gets a yellow alert, a "(@)" in the tab title and an "@" badge when the panel is collapsed
- **Threaded replies**: "Reply" under any message; replies are grouped under the original message
- **Comments on whiteboard items**: select an item with the Select tool, press 📌, type the comment; the comment shows "📌 On text: …" and clicking it zooms to the item
- **File and image sharing**: 📎 button; allowed types png, jpg, jpeg, gif, pdf, txt, csv, doc(x), xls(x), ppt(x); 5 MB limit; images show a preview
- **Presence for everyone** (DEF-05) and Offline after about 45 seconds on the Test stage (DEF-06)
- Server rejects any chat message that is not "text" or "file", and files with types not on the allow-list

## Version 2 manual checklist
9. Type `@` and part of a name: suggestions appear; pick one with Enter.
10. Mention the other user: they see the yellow alert and the highlighted message.
11. Reply to a message: the reply appears indented under it with a reply count.
12. Select a text box on the board, press 📌, send a comment: the comment shows the 📌 tag; clicking it zooms to the text.
13. Share a PNG: a preview appears for both users. Share a PDF: a download link appears.
14. Try a .exe or a file over 5 MB: it is blocked with a message.
15. Second user (not the owner) sees both users Online.
16. Close the second user's browser: they change to Offline within about a minute.

## Defect log

| ID | Found in | Problem | Cause | Status |
|---|---|---|---|---|
| DEF-01 | v1 Test | `manifest.json` redirect loop (ERR_TOO_MANY_REDIRECTS) | Manifest requested without the login cookie | Fixed in v1 (`crossorigin="use-credentials"`) |
| DEF-02 | v1 Test | Board stays blank when the username has spaces | Username placed inside an HTML class was split at the space | Fixed in v1 (username encoded/decoded) |
| DEF-03 | v1 Test | Port 8080 showed Apache instead of MeTL | Another web server on the Mac uses 8080 | Fixed (Test stage runs on 8081) |
| DEF-04 | v1 Test | sbt fails with "Unrecognized VM option MaxPermSize" | Terminal was on Java 24; MeTL needs Java 8 | Fixed in v2 (`test-stage.sh` selects Java 8) |
| DEF-05 | v1 Test | Only the owner sees who is online | Comet only forwarded attendance `if shouldModifyConversation()` | Fixed in v2 (sent to every member) |
| DEF-06 | v1 Test | A user stays Online about 2 minutes after leaving | `metlActorLifespan` default is 2 minutes | Fixed in v2 (45 seconds on the Test stage) |
| DEF-07 | v2 Test | After sharing a file, the chat panel grows past the bottom of the window and the message box, 📌, 📎 and Send buttons are hidden, so nothing else can be sent or attached | The panel had no height limit, so each new message made the whole panel taller instead of scrolling the list | Fixed in v2 (panel sized to the window; only the message list scrolls; opens at the newest message) |
