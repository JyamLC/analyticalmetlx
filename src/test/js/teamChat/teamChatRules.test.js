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

console.log("\nTeamChatRules v2");

test("@mention of a full name with spaces is found and highlighted", function(){
    var names = ["Jose Lebron Cuadra", "Jose Cuadra Lebron", "Ana"];
    var segs = Rules.splitMentions("Hi @Jose Cuadra Lebron, can you check this?", names);
    assert.deepStrictEqual(segs.map(function(s){ return s.mention; }), [null, "Jose Cuadra Lebron", null]);
    assert.deepStrictEqual(Rules.findMentions("@ana and @Jose Lebron Cuadra", names), ["Ana", "Jose Lebron Cuadra"]);
});
test("@mention needs the whole name and is not found inside an email address", function(){
    var names = ["Jose Lebron Cuadra", "Ana"];
    assert.deepStrictEqual(Rules.findMentions("@Jose can you look", names), []);
    assert.deepStrictEqual(Rules.findMentions("mail me at x@anabelle.com", names), []);
    assert.deepStrictEqual(Rules.findMentions("mail me at x@Ana now", names), []);
    assert.strictEqual(Rules.mentionsMe("thanks @Ana!", "Ana"), true);
    assert.strictEqual(Rules.mentionsMe("thanks Ana", "Ana"), false);
});
test("mention autocomplete finds the partial name after @", function(){
    assert.strictEqual(Rules.mentionQuery("hello @Jo"), "Jo");
    assert.strictEqual(Rules.mentionQuery("hello @"), "");
    assert.strictEqual(Rules.mentionQuery("no mention here"), null);
    assert.strictEqual(Rules.mentionQuery("email a@b"), null);
    assert.deepStrictEqual(Rules.suggestions("jo", ["Jose Lebron Cuadra","Ana","Jose Cuadra Lebron"], "Jose Lebron Cuadra"), ["Jose Cuadra Lebron"]);
});
test("reply context links a message to its thread", function(){
    var root = Rules.makeMessage("Ana", "1001", "root", 1700000000000);
    var reply = Rules.makeMessage("Jose", "1001", "reply", 1700000000500, {context:Rules.threadContext(root.identity)});
    var ctx = Rules.parseContext(reply.context);
    assert.strictEqual(ctx.kind, "thread");
    assert.strictEqual(ctx.root, root.identity);
    assert.strictEqual(Rules.parseContext("1001").kind, "none");
});
test("element comment context keeps type, position and label within 128 characters", function(){
    var longLabel = new Array(300).join("x");
    var c = Rules.elementContext("multiWordTexts", "Jose_some_very_long_identity_" + longLabel, [10.4, 20, 110, 70], "Hello|world " + longLabel);
    assert.ok(c.length <= 128);
    var ctx = Rules.parseContext(c);
    assert.strictEqual(ctx.kind, "element");
    assert.strictEqual(ctx.type, "multiWordTexts");
    assert.deepStrictEqual(ctx.box, [10, 20, 100, 50]);
    assert.ok(ctx.label.indexOf("Hello world") === 0);
    assert.strictEqual(Rules.elementTypeName(ctx.type), "text");
});
test("file sharing allows listed types up to 5 MB", function(){
    assert.strictEqual(Rules.validateFile("plan.pdf", 1024).ok, true);
    assert.strictEqual(Rules.validateFile("Photo.JPG", 2 * 1048576).ok, true);
    assert.strictEqual(Rules.validateFile("virus.exe", 1024).ok, false);
    assert.strictEqual(Rules.validateFile("big.png", 6 * 1048576).ok, false);
    assert.strictEqual(Rules.validateFile("empty.txt", 0).ok, false);
    assert.strictEqual(Rules.isImage("a.gif"), true);
    assert.strictEqual(Rules.isImage("a.pdf"), false);
});
test("file message content round-trips and stays under 2,000 characters", function(){
    var content = Rules.fileContent("notes.txt", 2048, "1000/notes.txt/123");
    var f = Rules.parseFile(content);
    assert.strictEqual(f.name, "notes.txt");
    assert.strictEqual(f.url, "1000/notes.txt/123");
    assert.ok(Rules.validate(content).ok);
    assert.strictEqual(Rules.parseFile("not json"), null);
    var m = Rules.makeMessage("Ana", "1001", content, 1, {contentType:"file"});
    assert.strictEqual(m.contentType, "file");
    assert.strictEqual(Rules.formatSize(2048), "2 KB");
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
