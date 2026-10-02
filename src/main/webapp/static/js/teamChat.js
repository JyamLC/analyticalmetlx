/*
 * Team Chat (v2 - Test stage)
 * MeTL Real-Time Chat Enhancement - Jose Y. Lebron Cuadra, COM-430
 *
 * A docked chat panel next to the board with:
 *   - real-time send/receive (reuses MeTL's existing "chatMessage" stanza,
 *     which the server already stores in H2)
 *   - presence list (Online / Offline) from MeTL's attendance updates
 *   - 1 to 2,000 character validation (also enforced on the server, see ChatRules.scala)
 *   - collapse/expand with an unread-message badge
 *   v2:
 *   - @mentions with autocomplete, highlighting and a "you were mentioned" alert
 *   - threaded replies to a message
 *   - comments attached to a selected whiteboard element (click to zoom to it)
 *   - file and image sharing (type allow-list and 5 MB limit)
 *
 * The stanza's existing "context" field (saved in H2ChatMessage.context, max 128 chars)
 * is used to link a reply to its thread or a comment to a whiteboard element.
 *
 * TeamChatRules holds the pure logic so it can be unit tested in Node
 * (see src/test/js/teamChat/teamChatRules.test.js).
 */
var TeamChatRules = (function(){
    var MAX_LENGTH = 2000;
    var MAX_CONTEXT = 128;
    var MAX_FILE_BYTES = 5 * 1024 * 1024;
    var ALLOWED_EXT = ["png","jpg","jpeg","gif","pdf","txt","csv","doc","docx","xls","xlsx","ppt","pptx"];
    var IMAGE_EXT = ["png","jpg","jpeg","gif"];

    var validate = function(text){
        var t = (text === undefined || text === null) ? "" : String(text).trim();
        if (!t.length){
            return {ok:false, reason:"Type a message first."};
        }
        if (t.length > MAX_LENGTH){
            return {ok:false, reason:"Message is " + t.length + " characters. The limit is 2,000."};
        }
        return {ok:true, text:t};
    };

    var isPublicChat = function(stanza){
        return !!stanza && stanza.type == "chatMessage" && "identity" in stanza &&
            (!stanza.audiences || stanza.audiences.length == 0);
    };

    // opts: {context, contentType}
    var makeMessage = function(author, location, text, now, opts){
        now = now || new Date().getTime();
        opts = opts || {};
        return {
            type:"chatMessage",
            author:author,
            timestamp:now,
            identity:author + "_" + location + "_" + now,
            contentType:opts.contentType || "text",
            content:text,
            context:(opts.context || location || "").substring(0, MAX_CONTEXT),
            audiences:[]
        };
    };

    // current = usernames connected now, possible = everyone who has joined
    var presence = function(current, possible, me){
        var online = {};
        (current || []).forEach(function(n){ online[n] = true; });
        if (me) { online[me] = true; }
        var everyone = {};
        (possible || []).concat(current || []).concat(me ? [me] : []).forEach(function(n){ everyone[n] = true; });
        return Object.keys(everyone).map(function(n){
            return {name:n, status:online[n] ? "online" : "offline", isMe:n === me};
        }).sort(function(a,b){
            if (a.status != b.status) { return a.status == "online" ? -1 : 1; }
            return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
        });
    };

    /* ---------- files ---------- */
    var extension = function(name){
        var m = /\.([A-Za-z0-9]+)$/.exec(String(name || ""));
        return m ? m[1].toLowerCase() : "";
    };
    var validateFile = function(name, size){
        var ext = extension(name);
        if (ALLOWED_EXT.indexOf(ext) < 0){
            return {ok:false, reason:"Files of type ." + (ext || "?") + " are not allowed. Allowed: " + ALLOWED_EXT.join(", ") + "."};
        }
        if (!(size > 0)){
            return {ok:false, reason:"The file is empty."};
        }
        if (size > MAX_FILE_BYTES){
            return {ok:false, reason:"The file is " + (size / 1048576).toFixed(1) + " MB. The limit is 5 MB."};
        }
        return {ok:true};
    };
    var isImage = function(name){ return IMAGE_EXT.indexOf(extension(name)) >= 0; };
    var fileContent = function(name, size, url){
        return JSON.stringify({name:String(name), size:size, url:String(url)});
    };
    var parseFile = function(content){
        try {
            var f = JSON.parse(content);
            if (f && typeof f.name == "string" && typeof f.url == "string") { return f; }
        } catch(e) {}
        return null;
    };
    var formatSize = function(bytes){
        if (bytes >= 1048576) { return (bytes / 1048576).toFixed(1) + " MB"; }
        if (bytes >= 1024) { return Math.round(bytes / 1024) + " KB"; }
        return bytes + " B";
    };

    /* ---------- threads and element comments (stored in "context") ---------- */
    var threadContext = function(rootIdentity){
        return ("thread:" + rootIdentity).substring(0, MAX_CONTEXT);
    };
    var shortHash = function(s){
        var h = 5381;
        s = String(s);
        for (var i = 0; i < s.length; i++){ h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; }
        return h.toString(36);
    };
    // "el|<type>|<hash of element identity>|x,y,w,h|<label>" (always <= 128 characters)
    var elementContext = function(type, identity, bounds, label){
        var b = (bounds || [0,0,0,0]).map(function(n){ return Math.round(Number(n) || 0); });
        var box = [b[0], b[1], Math.max(1, b[2] - b[0]), Math.max(1, b[3] - b[1])].join(",");
        var head = ["el", type, shortHash(identity), box, ""].join("|");
        var cleanLabel = String(label || "").replace(/[|\s]+/g, " ").trim();
        return (head + cleanLabel).substring(0, MAX_CONTEXT);
    };
    var parseContext = function(context){
        var c = String(context || "");
        if (c.indexOf("thread:") === 0){
            return {kind:"thread", root:c.substring(7)};
        }
        if (c.indexOf("el|") === 0){
            var parts = c.split("|");
            var box = (parts[3] || "").split(",").map(Number);
            return {kind:"element", type:parts[1] || "element", ref:parts[2] || "", box:box, label:parts.slice(4).join("|")};
        }
        return {kind:"none"};
    };
    var elementTypeName = function(type){
        return ({multiWordTexts:"text", texts:"text", images:"image", inks:"drawing", videos:"video"})[type] || "element";
    };

    /* ---------- @mentions ---------- */
    var escapeRegex = function(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); };
    var mentionRegex = function(names){
        var list = (names || []).filter(function(n){ return n && n.length; })
            .sort(function(a,b){ return b.length - a.length; })
            .map(escapeRegex);
        if (!list.length) { return null; }
        return new RegExp("@(" + list.join("|") + ")(?=$|[\\s.,!?;:)])", "gi");
    };
    // split text into [{text, mention}] so mentions can be highlighted safely
    var splitMentions = function(text, names){
        var re = mentionRegex(names);
        text = String(text || "");
        if (!re) { return [{text:text, mention:null}]; }
        var out = [], last = 0, m;
        while ((m = re.exec(text)) !== null){
            if (m.index > 0 && /[A-Za-z0-9._]/.test(text.charAt(m.index - 1))) { continue; } // e.g. an email address
            if (m.index > last) { out.push({text:text.substring(last, m.index), mention:null}); }
            var canonical = (names || []).filter(function(n){ return n.toLowerCase() == m[1].toLowerCase(); })[0] || m[1];
            out.push({text:m[0], mention:canonical});
            last = m.index + m[0].length;
        }
        if (last < text.length) { out.push({text:text.substring(last), mention:null}); }
        return out;
    };
    var findMentions = function(text, names){
        var found = [];
        splitMentions(text, names).forEach(function(s){
            if (s.mention && found.indexOf(s.mention) < 0) { found.push(s.mention); }
        });
        return found;
    };
    var mentionsMe = function(text, me){
        return !!me && findMentions(text, [me]).length > 0;
    };
    // text typed before the cursor -> the partial name after "@", or null
    var mentionQuery = function(beforeCursor){
        var m = /(^|\s)@([^@\n]{0,30})$/.exec(String(beforeCursor || ""));
        return m ? m[2] : null;
    };
    var suggestions = function(query, names, me, limit){
        var q = String(query || "").toLowerCase();
        return (names || []).filter(function(n){
            return n && n !== me && n.toLowerCase().indexOf(q) === 0;
        }).sort().slice(0, limit || 5);
    };

    return {
        MAX_LENGTH:MAX_LENGTH,
        MAX_CONTEXT:MAX_CONTEXT,
        MAX_FILE_BYTES:MAX_FILE_BYTES,
        ALLOWED_EXT:ALLOWED_EXT,
        validate:validate,
        isPublicChat:isPublicChat,
        makeMessage:makeMessage,
        presence:presence,
        extension:extension,
        validateFile:validateFile,
        isImage:isImage,
        fileContent:fileContent,
        parseFile:parseFile,
        formatSize:formatSize,
        threadContext:threadContext,
        elementContext:elementContext,
        parseContext:parseContext,
        elementTypeName:elementTypeName,
        splitMentions:splitMentions,
        findMentions:findMentions,
        mentionsMe:mentionsMe,
        mentionQuery:mentionQuery,
        suggestions:suggestions
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = TeamChatRules;
}

var TeamChat = (function(){
    if (typeof $ === "undefined") { return {}; }

    var R = TeamChatRules;
    var seen = {};
    var messages = {};          // identity -> stanza
    var pendingReplies = {};    // root identity -> [stanza] (reply arrived before its root)
    var knownNames = {};
    var unread = 0, unreadMention = false;
    var collapsed = false;
    var lastPresence = {current:[], possible:[]};
    var currentConversation = undefined;
    var replyTo = null;         // stanza being replied to
    var attachElement = null;   // {type, identity, bounds, label}
    var suggestIndex = 0;
    var panel, list, box, counter, errorLine, sendButton, toggleButton, badge, presenceList,
        contextBar, pinButton, fileButton, fileInput, suggestBox, toast;

    var css =
        "#teamChatColumn{width:300px;flex-shrink:0;display:flex;flex-direction:column;background:#f7f9fc;border-left:2px solid #1F3864;font-family:inherit;position:relative;align-self:flex-start;overflow:hidden;box-sizing:border-box;}" +
        "#teamChatColumn.collapsed{width:36px;}" +
        "#teamChatColumn.collapsed .teamChatBody{display:none;}" +
        ".teamChatHeader{flex-shrink:0;display:flex;align-items:center;background:#1F3864;color:white;padding:6px 8px;}" +
        ".teamChatHeader .title{flex-grow:1;font-weight:bold;}" +
        "#teamChatColumn.collapsed .teamChatHeader .title{display:none;}" +
        "#teamChatColumn.collapsed .teamChatHeader{flex-direction:column;padding:6px 2px;}" +
        "#teamChatColumn.collapsed .teamChatBadge{margin:6px 0 0 0;}" +
        ".teamChatToggle{background:none;border:none;color:white;cursor:pointer;font-size:14px;padding:0 4px;}" +
        ".teamChatBadge{background:#c0392b;color:white;border-radius:9px;padding:0 6px;font-size:11px;margin-left:4px;display:none;}" +
        ".teamChatBadge.mention{background:#e6a100;}" +
        ".teamChatBody{display:flex;flex-direction:column;flex-grow:1;min-height:0;}" +
        ".teamChatPresence{flex-shrink:0;padding:6px 8px;border-bottom:1px solid #d5dbe5;max-height:120px;overflow-y:auto;font-size:12px;}" +
        ".teamChatPresence .who{display:flex;align-items:center;margin:2px 0;}" +
        ".teamChatPresence .dot{width:9px;height:9px;border-radius:50%;margin-right:6px;display:inline-block;}" +
        ".teamChatPresence .online .dot{background:#2e7d32;}" +
        ".teamChatPresence .offline .dot{background:#9e9e9e;}" +
        ".teamChatPresence .offline{color:#777;}" +
        ".teamChatMessages{flex:1 1 0;overflow-y:auto;padding:6px 8px;min-height:60px;}" +
        ".teamChatMsg{margin:4px 0;padding:5px 7px;background:white;border:1px solid #e0e5ee;border-radius:6px;word-wrap:break-word;font-size:13px;}" +
        ".teamChatMsg.mine{background:#e8eef9;border-color:#b8c7e6;}" +
        ".teamChatMsg.mentioned{background:#fff6d6;border-color:#e6c25a;}" +
        ".teamChatMsg .meta{font-size:11px;color:#556;margin-bottom:2px;}" +
        ".teamChatMsg .meta b{color:#1F3864;margin-right:6px;}" +
        ".teamChatMsg .body{white-space:pre-wrap;}" +
        ".teamChatMsg .mention{background:#dfe8fb;color:#1F3864;font-weight:bold;border-radius:3px;padding:0 2px;}" +
        ".teamChatMsg .mention.me{background:#ffe08a;}" +
        ".teamChatMsg .elementTag{display:inline-block;font-size:11px;background:#eef3e6;border:1px solid #9cc28a;color:#2e5e1f;border-radius:4px;padding:1px 5px;margin-bottom:3px;cursor:pointer;}" +
        ".teamChatMsg .actions{font-size:11px;margin-top:3px;}" +
        ".teamChatMsg .actions a{color:#1F3864;cursor:pointer;margin-right:8px;text-decoration:underline;}" +
        ".teamChatMsg .replies{margin:4px 0 0 10px;border-left:2px solid #c9d3e6;padding-left:6px;}" +
        ".teamChatMsg .replies .teamChatMsg{margin:3px 0;}" +
        ".teamChatMsg img.shared{max-width:100%;max-height:160px;display:block;margin-top:3px;border:1px solid #ddd;border-radius:4px;}" +
        ".teamChatMsg a.file{color:#1F3864;}" +
        ".teamChatEmpty{color:#888;font-size:12px;text-align:center;margin-top:12px;}" +
        ".teamChatComposer{flex-shrink:0;border-top:1px solid #d5dbe5;padding:6px 8px;position:relative;}" +
        ".teamChatComposer textarea{width:100%;box-sizing:border-box;height:56px;resize:vertical;font-family:inherit;font-size:13px;}" +
        ".teamChatComposer .row{display:flex;align-items:center;margin-top:4px;}" +
        ".teamChatComposer .count{flex-grow:1;font-size:11px;color:#666;}" +
        ".teamChatComposer .count.over{color:#c0392b;font-weight:bold;}" +
        ".teamChatComposer button{background:#1F3864;color:white;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;margin-left:4px;}" +
        ".teamChatComposer button.tool{background:#e3e8f2;color:#1F3864;padding:4px 7px;}" +
        ".teamChatComposer button.tool.active{background:#9cc28a;color:#1b3a10;}" +
        ".teamChatComposer button:disabled{background:#c5ccd9;color:#eef;cursor:default;}" +
        ".teamChatContext{display:none;font-size:11px;background:#eef3fb;border:1px solid #c9d3e6;border-radius:4px;padding:3px 6px;margin-bottom:4px;}" +
        ".teamChatContext a{float:right;cursor:pointer;color:#c0392b;font-weight:bold;}" +
        ".teamChatSuggest{display:none;position:absolute;left:8px;right:8px;bottom:100%;background:white;border:1px solid #9aa6bd;border-radius:4px;box-shadow:0 2px 6px rgba(0,0,0,.2);font-size:12px;z-index:20;}" +
        ".teamChatSuggest div{padding:4px 8px;cursor:pointer;}" +
        ".teamChatSuggest div.sel{background:#1F3864;color:white;}" +
        ".teamChatToast{display:none;position:absolute;top:40px;left:8px;right:8px;background:#ffe08a;border:1px solid #e6a100;color:#4a3500;border-radius:5px;padding:6px 8px;font-size:12px;z-index:20;cursor:pointer;}" +
        ".teamChatError{color:#c0392b;font-size:11px;min-height:14px;}";

    var username = function(){
        try { return UserSettings.getUsername(); } catch(e) { return "me"; }
    };
    var slideLocation = function(){
        try { return Conversations.getCurrentSlideJid(); } catch(e) { return ""; }
    };
    var conversationJid = function(){
        try { return Conversations.getCurrentConversationJid(); } catch(e) { return ""; }
    };
    var formatTime = function(ts){
        var d = new Date(ts);
        return d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
    };
    var relayout = function(){
        try { Progress.call("onLayoutUpdated"); } catch(e) {}
        $(window).trigger("resize");
    };
    var names = function(){
        var all = {};
        Object.keys(knownNames).forEach(function(n){ all[n] = true; });
        (lastPresence.current || []).concat(lastPresence.possible || []).forEach(function(n){ all[n] = true; });
        all[username()] = true;
        return Object.keys(all);
    };

    /* ---------- header: collapse, badge, alerts ---------- */
    var updateBadge = function(){
        if (unread > 0 && collapsed){
            badge.text(unreadMention ? "@" + unread : unread).toggleClass("mention", unreadMention).show();
        } else {
            badge.hide();
        }
    };
    var setCollapsed = function(value){
        collapsed = value;
        panel.toggleClass("collapsed", collapsed);
        toggleButton.html(collapsed ? "&#9664;" : "&#9654;").attr("title", collapsed ? "Show chat" : "Hide chat");
        if (!collapsed) { unread = 0; unreadMention = false; restoreTitle(); }
        updateBadge();
        relayout();
    };
    var originalTitle = document.title;
    var restoreTitle = function(){ document.title = originalTitle; };
    var showMentionAlert = function(stanza){
        toast.text(stanza.author + " mentioned you: “" + String(stanza.content).substring(0, 60) + "”").stop(true, true).fadeIn(150);
        setTimeout(function(){ toast.fadeOut(400); }, 6000);
        originalTitle = document.title.replace(/^\(@\) /, "");
        document.title = "(@) " + originalTitle;
        if (collapsed) { unreadMention = true; updateBadge(); }
    };

    /* ---------- presence ---------- */
    var renderPresence = function(){
        presenceList.empty();
        var people = R.presence(lastPresence.current, lastPresence.possible, username());
        var onlineCount = people.filter(function(p){ return p.status == "online"; }).length;
        presenceList.append($("<div/>",{text:"People (" + onlineCount + " online)", css:{fontWeight:"bold", marginBottom:"3px"}}));
        people.forEach(function(p){
            var row = $("<div/>",{"class":"who " + p.status, title:(p.status == "online" ? "Online" : "Offline") + (p.isMe ? "" : " - click to mention")});
            row.append($("<span/>",{"class":"dot"}));
            row.append($("<span/>",{text:p.name + (p.isMe ? " (you)" : "")}));
            if (!p.isMe){
                row.css("cursor","pointer").on("click", function(){ insertMention(p.name, true); });
            }
            presenceList.append(row);
        });
    };

    /* ---------- rendering messages ---------- */
    var renderBody = function(stanza){
        var body = $("<div/>",{"class":"body"});
        if (stanza.contentType == "file"){
            var f = R.parseFile(stanza.content);
            if (!f) { return body.text("(file could not be read)"); }
            var href = "/resourceProxy/" + encodeURIComponent(f.url);
            if (R.isImage(f.name)){
                var a = $("<a/>",{href:href, target:"_blank", title:"Open " + f.name});
                a.append($("<img/>",{"class":"shared", src:href, alt:f.name}));
                body.append($("<span/>",{text:"🖼 " + f.name + " (" + R.formatSize(f.size || 0) + ")"})).append(a);
            } else {
                body.append($("<a/>",{"class":"file", href:href, download:f.name, target:"_blank",
                    text:"📄 " + f.name + " (" + R.formatSize(f.size || 0) + ")"}));
            }
            return body;
        }
        var me = username();
        // build with .text() pieces so message content is never interpreted as HTML
        R.splitMentions(stanza.content, names()).forEach(function(seg){
            if (seg.mention){
                body.append($("<span/>",{"class":"mention" + (seg.mention == me ? " me" : ""), text:seg.text}));
            } else {
                body.append(document.createTextNode(seg.text));
            }
        });
        return body;
    };

    var zoomTo = function(ctx){
        var b = ctx.box || [];
        if (b.length < 4 || typeof IncludeView === "undefined") { return; }
        var pad = Math.max(b[2], b[3]) * 0.5 + 20;
        try { IncludeView.specific(b[0] - pad, b[1] - pad, b[2] + pad * 2, b[3] + pad * 2); } catch(e) { console.log("TeamChat zoom failed", e); }
    };

    var buildItem = function(stanza){
        var me = username();
        var mine = stanza.author == me;
        var ctx = R.parseContext(stanza.context);
        var mentioned = !mine && stanza.contentType != "file" && R.mentionsMe(stanza.content, me);
        var item = $("<div/>",{"class":"teamChatMsg" + (mine ? " mine" : "") + (mentioned ? " mentioned" : ""), "data-id":stanza.identity});
        item.attr("data-ts", stanza.timestamp);
        var meta = $("<div/>",{"class":"meta"});
        meta.append($("<b/>",{text:stanza.author}));
        meta.append($("<span/>",{text:formatTime(stanza.timestamp)}));
        item.append(meta);
        if (ctx.kind == "element"){
            var tag = $("<span/>",{"class":"elementTag", title:"Click to zoom to this item on the whiteboard",
                text:"📌 On " + R.elementTypeName(ctx.type) + (ctx.label ? ": “" + ctx.label + "”" : "")});
            tag.on("click", function(){ zoomTo(ctx); });
            item.append(tag);
        }
        item.append(renderBody(stanza));
        if (ctx.kind != "thread"){
            var actions = $("<div/>",{"class":"actions"});
            actions.append($("<a/>",{text:"Reply"}).on("click", function(){ startReply(stanza); }));
            actions.append($("<span/>",{"class":"replyCount"}));
            item.append(actions);
            item.append($("<div/>",{"class":"replies"}).hide());
        }
        return {item:item, mine:mine, mentioned:mentioned};
    };

    var insertByTime = function(container, item, ts){
        var placed = false;
        container.children(".teamChatMsg").each(function(){
            if (!placed && Number($(this).attr("data-ts")) > ts){
                item.insertBefore($(this));
                placed = true;
            }
        });
        if (!placed) { container.append(item); }
    };

    var updateReplyCount = function(rootItem){
        var n = rootItem.children(".replies").children(".teamChatMsg").length;
        rootItem.children(".replies").toggle(n > 0);
        rootItem.find("> .actions .replyCount").text(n ? (n == 1 ? "1 reply" : n + " replies") : "");
    };

    var placeItem = function(stanza, built){
        var ctx = R.parseContext(stanza.context);
        if (ctx.kind == "thread"){
            var root = list.find(".teamChatMsg[data-id]").filter(function(){ return $(this).attr("data-id") == ctx.root; }).first();
            if (!root.length){
                (pendingReplies[ctx.root] = pendingReplies[ctx.root] || []).push(stanza);
                return false;
            }
            insertByTime(root.children(".replies"), built.item, stanza.timestamp);
            updateReplyCount(root);
            return true;
        }
        insertByTime(list, built.item, stanza.timestamp);
        var waiting = pendingReplies[stanza.identity];
        if (waiting){
            delete pendingReplies[stanza.identity];
            waiting.forEach(function(r){ placeItem(r, buildItem(r)); });
        }
        return true;
    };

    var addMessage = function(stanza, fromHistory){
        if (!R.isPublicChat(stanza) || seen[stanza.identity]) { return; }
        seen[stanza.identity] = true;
        messages[stanza.identity] = stanza;
        if (stanza.author) { knownNames[stanza.author] = true; }
        list.find(".teamChatEmpty").remove();
        var built = buildItem(stanza);
        placeItem(stanza, built);
        if (!fromHistory){
            list.scrollTop(list[0].scrollHeight);
            if (built.mentioned) { showMentionAlert(stanza); }
            if (collapsed && !built.mine) {
                unread += 1;
                updateBadge();
            }
        }
    };

    var clearMessages = function(){
        seen = {}; messages = {}; pendingReplies = {};
        list.empty().append($("<div/>",{"class":"teamChatEmpty", text:"No messages yet. Say hello to your team."}));
    };

    /* ---------- composer: replies, element comments, mentions ---------- */
    var renderContextBar = function(){
        contextBar.empty();
        var text = null;
        if (replyTo){
            text = "↩ Replying to " + replyTo.author + ": “" + (replyTo.contentType == "file" ? "file" : String(replyTo.content).substring(0, 40)) + "”";
        } else if (attachElement){
            text = "📌 Commenting on " + R.elementTypeName(attachElement.type) + (attachElement.label ? ": “" + attachElement.label.substring(0, 40) + "”" : "");
        }
        if (text){
            contextBar.append($("<a/>",{text:"✕", title:"Cancel"}).on("click", function(){ replyTo = null; attachElement = null; renderContextBar(); }));
            contextBar.append($("<span/>",{text:text}));
            contextBar.show();
        } else {
            contextBar.hide();
        }
        pinButton.toggleClass("active", !!attachElement);
    };
    var startReply = function(stanza){
        replyTo = stanza; attachElement = null;
        renderContextBar();
        box.focus();
    };

    var currentSelection = function(){
        try {
            var sel = (typeof Modes !== "undefined" && Modes.select) ? Modes.select.selected : null;
            if (!sel) { return null; }
            var order = ["multiWordTexts","texts","images","inks","videos"];
            for (var i = 0; i < order.length; i++){
                var group = sel[order[i]] || {};
                var keys = Object.keys(group);
                if (keys.length){
                    var el = group[keys[0]];
                    var label = "";
                    if (el.words) { label = el.words.map(function(w){ return w.text || ""; }).join(""); }
                    else if (el.text) { label = el.text; }
                    else if (el.doc && el.doc.documentRange) { label = el.doc.documentRange().plainText(); }
                    return {type:order[i], identity:el.identity || keys[0], bounds:el.bounds, label:String(label).trim().substring(0, 40)};
                }
            }
        } catch(e) { console.log("TeamChat selection read failed", e); }
        return null;
    };
    var updatePinButton = function(){
        pinButton.prop("disabled", !currentSelection() && !attachElement);
    };
    var togglePin = function(){
        if (attachElement){ attachElement = null; renderContextBar(); updatePinButton(); return; }
        var s = currentSelection();
        if (!s){
            errorLine.text("Select something on the whiteboard first (Select tool), then press 📌.");
            return;
        }
        attachElement = s; replyTo = null;
        renderContextBar();
        box.focus();
    };

    var hideSuggestions = function(){ suggestBox.hide().empty(); };
    var insertMention = function(name, append){
        var val = box.val();
        var pos = box[0].selectionStart || val.length;
        var before = val.substring(0, pos), after = val.substring(pos);
        var q = R.mentionQuery(before);
        if (q !== null && !append){
            before = before.substring(0, before.length - q.length - 1);
        } else if (before.length && !/\s$/.test(before)){
            before += " ";
        }
        var insert = "@" + name + " ";
        box.val(before + insert + after);
        var caret = (before + insert).length;
        box[0].setSelectionRange(caret, caret);
        hideSuggestions();
        updateCounter();
        box.focus();
    };
    var showSuggestions = function(){
        var q = R.mentionQuery(box.val().substring(0, box[0].selectionStart || 0));
        if (q === null){ hideSuggestions(); return; }
        var list_ = R.suggestions(q, names(), username(), 5);
        if (!list_.length){ hideSuggestions(); return; }
        suggestIndex = Math.min(suggestIndex, list_.length - 1);
        suggestBox.empty();
        list_.forEach(function(n, i){
            suggestBox.append($("<div/>",{text:"@" + n, "class":i == suggestIndex ? "sel" : ""})
                .on("mousedown", function(ev){ ev.preventDefault(); insertMention(n); }));
        });
        suggestBox.show();
    };

    var updateCounter = function(){
        var len = box.val().trim().length;
        counter.text(len + " / 2,000");
        counter.toggleClass("over", len > R.MAX_LENGTH);
        sendButton.prop("disabled", !R.validate(box.val()).ok);
        errorLine.text("");
    };

    var contextForSend = function(){
        if (replyTo){
            var rootCtx = R.parseContext(replyTo.context);
            var rootId = rootCtx.kind == "thread" ? rootCtx.root : replyTo.identity;
            return R.threadContext(rootId);
        }
        if (attachElement){
            return R.elementContext(attachElement.type, attachElement.identity, attachElement.bounds, attachElement.label);
        }
        return null;
    };

    var connected = function(){
        if (typeof sendStanza !== "function"){
            errorLine.text("Not connected to the server yet. Try again in a moment.");
            return false;
        }
        return true;
    };

    var send = function(){
        var result = R.validate(box.val());
        if (!result.ok){
            errorLine.text(result.reason);
            return;
        }
        if (!connected()) { return; }
        sendStanza(R.makeMessage(username(), slideLocation(), result.text, null, {context:contextForSend()}));
        box.val("");
        replyTo = null; attachElement = null;
        renderContextBar(); updatePinButton(); hideSuggestions();
        updateCounter();
    };

    /* ---------- file sharing ---------- */
    var uploadFile = function(file){
        var check = R.validateFile(file.name, file.size);
        if (!check.ok){ errorLine.text(check.reason); return; }
        if (!connected()) { return; }
        var jid = conversationJid();
        var context = contextForSend();
        errorLine.css("color","#1F3864").text("Uploading " + file.name + "…");
        fileButton.prop("disabled", true);
        var reader = new FileReader();
        reader.onload = function(ev){
            $.ajax({
                url:"/uploadDataUri?filename=" + encodeURIComponent(file.name) + "&jid=" + encodeURIComponent(jid),
                type:"POST",
                data:ev.target.result,
                cache:false, contentType:false, processData:false,
                success:function(resp){
                    var url = $(resp).find("resourceUrl").text();
                    if (!url){ fail("The server did not return a file address."); return; }
                    sendStanza(R.makeMessage(username(), slideLocation(), R.fileContent(file.name, file.size, url), null,
                        {contentType:"file", context:context}));
                    replyTo = null; attachElement = null; renderContextBar(); updatePinButton();
                    errorLine.css("color","").text("");
                    fileButton.prop("disabled", false);
                },
                error:function(e){ console.log("TeamChat upload failed", e); fail("Upload failed. Try again."); }
            });
        };
        var fail = function(msg){
            errorLine.css("color","").text(msg);
            fileButton.prop("disabled", false);
        };
        reader.onerror = function(){ fail("Could not read the file."); };
        reader.readAsDataURL(file);
    };

    /* ---------- layout ---------- */
    var fitHeight = function(){
        if (!panel || !panel[0]) { return; }
        var top = Math.max(0, panel[0].getBoundingClientRect().top);
        var h = Math.max(260, window.innerHeight - top - 2);
        panel.css({height:h + "px", maxHeight:h + "px"});
    };

    /* ---------- build and wire ---------- */
    var build = function(){
        $("<style/>").text(css).appendTo("head");
        panel = $("<div/>",{id:"teamChatColumn"});
        var header = $("<div/>",{"class":"teamChatHeader"});
        toggleButton = $("<button/>",{"class":"teamChatToggle", id:"teamChatToggle"});
        badge = $("<span/>",{"class":"teamChatBadge", id:"teamChatBadge"});
        header.append(toggleButton).append($("<span/>",{"class":"title", text:"Team Chat"})).append(badge);
        toast = $("<div/>",{"class":"teamChatToast", id:"teamChatToast"}).on("click", function(){ $(this).fadeOut(200); });
        var body = $("<div/>",{"class":"teamChatBody"});
        presenceList = $("<div/>",{"class":"teamChatPresence", id:"teamChatPresence"});
        list = $("<div/>",{"class":"teamChatMessages", id:"teamChatMessages"});
        var composer = $("<div/>",{"class":"teamChatComposer"});
        suggestBox = $("<div/>",{"class":"teamChatSuggest", id:"teamChatSuggest"});
        contextBar = $("<div/>",{"class":"teamChatContext", id:"teamChatContext"});
        box = $("<textarea/>",{id:"teamChatInput", placeholder:"Message your team (Enter to send, Shift+Enter for a new line, @ to mention)"});
        counter = $("<span/>",{"class":"count", id:"teamChatCount"});
        pinButton = $("<button/>",{"class":"tool", id:"teamChatPin", html:"&#128204;", title:"Comment on the selected whiteboard item"});
        fileButton = $("<button/>",{"class":"tool", id:"teamChatFile", html:"&#128206;", title:"Share a file or image (max 5 MB)"});
        fileInput = $("<input/>",{type:"file", id:"teamChatFileInput", accept:R.ALLOWED_EXT.map(function(e){ return "." + e; }).join(",")}).hide();
        sendButton = $("<button/>",{id:"teamChatSend", text:"Send"});
        errorLine = $("<div/>",{"class":"teamChatError", id:"teamChatError"});
        composer.append(suggestBox).append(contextBar).append(box)
            .append($("<div/>",{"class":"row"}).append(counter).append(pinButton).append(fileButton).append(sendButton))
            .append(fileInput).append(errorLine);
        body.append(presenceList).append(list).append(composer);
        panel.append(header).append(toast).append(body);

        var host = $("#masterLayout");
        if (host.length) { host.append(panel); } else { $("body").append(panel); }

        // v2 fix: keep the panel the height of the window so the message list
        // scrolls and the text box and buttons always stay visible at the bottom.
        fitHeight();
        $(window).on("resize", fitHeight);
        Progress.onLayoutUpdated["TeamChat"] = fitHeight;
        setTimeout(fitHeight, 500);

        toggleButton.on("click", function(){ setCollapsed(!collapsed); });
        sendButton.on("click", send);
        pinButton.on("click", togglePin);
        fileButton.on("click", function(){ fileInput.val(""); fileInput.click(); });
        fileInput.on("change", function(){ if (this.files && this.files[0]) { uploadFile(this.files[0]); } });
        box.on("input click", function(){ updateCounter(); showSuggestions(); });
        box.on("blur", function(){ setTimeout(hideSuggestions, 150); });
        box.on("keydown", function(ev){
            if (suggestBox.is(":visible")){
                var items = suggestBox.children();
                if (ev.keyCode == 40 || ev.keyCode == 38){ // down / up
                    ev.preventDefault();
                    suggestIndex = (suggestIndex + (ev.keyCode == 40 ? 1 : items.length - 1)) % items.length;
                    showSuggestions();
                    return;
                }
                if (ev.keyCode == 13 || ev.keyCode == 9){ // enter / tab picks the suggestion
                    ev.preventDefault();
                    insertMention(items.eq(suggestIndex).text().substring(1));
                    return;
                }
                if (ev.keyCode == 27){ hideSuggestions(); return; }
            }
            if (ev.keyCode == 13 && !ev.shiftKey){
                ev.preventDefault();
                send();
            }
        });
        clearMessages();
        renderPresence();
        renderContextBar();
        updatePinButton();
        updateCounter();
        setCollapsed(false);
    };

    var wire = function(){
        Progress.stanzaReceived["TeamChat"] = function(s){ addMessage(s, false); };
        Progress.historyReceived["TeamChat"] = function(history){
            (history && history.chatMessages || []).slice().sort(function(a,b){ return a.timestamp - b.timestamp; })
                .forEach(function(s){ addMessage(s, true); });
            fitHeight();
            list.scrollTop(list[0].scrollHeight); // open at the newest message
        };
        Progress.attendanceReceived["TeamChat"] = function(a){
            if (!a) { return; }
            lastPresence = {current:a.currentMembers || [], possible:a.possibleMembers || []};
            renderPresence();
        };
        Progress.currentConversationJidReceived["TeamChat"] = function(jid){
            if (jid != currentConversation){
                currentConversation = jid;
                clearMessages();
                lastPresence = {current:[], possible:[]};
                renderPresence();
            }
        };
        Progress.usernameReceived["TeamChat"] = function(){ renderPresence(); };
        Progress.onSelectionChanged["TeamChat"] = function(){ updatePinButton(); };
        // MeTL already ships a small "Chat" box in the footer plugin bar. The docked
        // panel replaces it for this enhancement, so its button is hidden.
        try {
            if (typeof Plugins !== "undefined" && Plugins.chat) { Plugins.chat.changeVisualState(false, true, false); }
        } catch(e) {}
    };

    $(function(){
        build();
        wire();
    });

    return {
        addMessage:function(s, fromHistory){ addMessage(s, fromHistory); },
        setPresence:function(current, possible){ lastPresence = {current:current, possible:possible}; renderPresence(); },
        isCollapsed:function(){ return collapsed; },
        setCollapsed:function(v){ setCollapsed(v); },
        refreshSelection:function(){ updatePinButton(); }
    };
})();
