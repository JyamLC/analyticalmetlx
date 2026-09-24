# Team Chat v1 – Test Stage

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
