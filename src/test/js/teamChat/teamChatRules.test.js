// Team Chat v1 - unit tests for the browser-side rules.
// Run from the project folder:  node src/test/js/teamChat/teamChatRules.test.js
var assert = require("assert");
var path = require("path");
var Rules = require(path.join(__dirname, "../../../main/webapp/static/js/teamChat.js"));

var passed = 0, failed = 0;
function test(name, fn){
    try { fn(); passed++; console.log("  PASS  " + name); }
    catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

console.log("TeamChatRules");

test("normal message is valid and trimmed", function(){
    var r = Rules.validate("  hello team  ");
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.text, "hello team");
});
test("empty and whitespace-only messages are rejected", function(){
    assert.strictEqual(Rules.validate("").ok, false);
    assert.strictEqual(Rules.validate("   ").ok, false);
    assert.strictEqual(Rules.validate(undefined).ok, false);
});
test("2,000 characters is allowed", function(){
    assert.strictEqual(Rules.validate(new Array(2001).join("a")).ok, true);
});
test("2,001 characters is rejected with a reason", function(){
    var r = Rules.validate(new Array(2002).join("a"));
    assert.strictEqual(r.ok, false);
    assert.ok(/2,000/.test(r.reason));
});
test("makeMessage builds a public MeTL chatMessage stanza", function(){
    var m = Rules.makeMessage("jose", "1001", "hi", 1700000000000);
    assert.strictEqual(m.type, "chatMessage");
    assert.strictEqual(m.author, "jose");
    assert.strictEqual(m.content, "hi");
    assert.strictEqual(m.context, "1001");
    assert.strictEqual(m.identity, "jose_1001_1700000000000");
    assert.deepStrictEqual(m.audiences, []);
    assert.strictEqual(Rules.isPublicChat(m), true);
});
test("whispers (messages with an audience) are not shown in the team panel", function(){
    var m = Rules.makeMessage("jose", "1001", "psst");
    m.audiences = [{domain:"metl", name:"ana", type:"user", action:"read"}];
    assert.strictEqual(Rules.isPublicChat(m), false);
    assert.strictEqual(Rules.isPublicChat({type:"ink"}), false);
});
test("presence lists online people first, then offline, and always includes me", function(){
    var p = Rules.presence(["ana"], ["ana", "bob", "carl"], "jose");
    assert.deepStrictEqual(p.map(function(x){ return x.name + ":" + x.status; }),
        ["ana:online", "jose:online", "bob:offline", "carl:offline"]);
    assert.strictEqual(p[1].isMe, true);
});
test("presence with no data still shows me as online", function(){
    var p = Rules.presence([], [], "jose");
    assert.strictEqual(p.length, 1);
    assert.strictEqual(p[0].status, "online");
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
