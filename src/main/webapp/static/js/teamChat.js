/*
 * Team Chat (v1 - Test stage)
 * MeTL Real-Time Chat Enhancement - Jose Y. Lebron Cuadra, COM-430
 *
 * A docked chat panel on the right side of the board with:
 *   - real-time send/receive (reuses MeTL's existing "chatMessage" stanza,
 *     which the server already stores in H2)
 *   - presence list (Online / Offline) from MeTL's attendance updates
 *   - 1 to 2,000 character validation (also enforced on the server, see ChatRules.scala)
 *   - collapse/expand with an unread-message badge
 *
 * TeamChatRules holds the pure logic so it can be unit tested in Node
 * (see src/test/js/teamChat/teamChatRules.test.js).
 */
var TeamChatRules = (function(){
    var MAX_LENGTH = 2000;

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

    var makeMessage = function(author, location, text, now){
        now = now || new Date().getTime();
        return {
            type:"chatMessage",
            author:author,
            timestamp:now,
            identity:author + "_" + location + "_" + now,
            contentType:"text",
            content:text,
            context:location,
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

    return {
        MAX_LENGTH:MAX_LENGTH,
        validate:validate,
        isPublicChat:isPublicChat,
        makeMessage:makeMessage,
        presence:presence
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = TeamChatRules;
}

var TeamChat = (function(){
    if (typeof $ === "undefined") { return {}; }

    var seen = {};
    var unread = 0;
    var collapsed = false;
    var lastPresence = {current:[], possible:[]};
    var currentConversation = undefined;
    var panel, list, box, counter, errorLine, sendButton, toggleButton, badge, presenceList;

    var css =
        "#teamChatColumn{width:300px;flex-shrink:0;display:flex;flex-direction:column;background:#f7f9fc;border-left:2px solid #1F3864;font-family:inherit;}" +
        "#teamChatColumn.collapsed{width:36px;}" +
        "#teamChatColumn.collapsed .teamChatBody{display:none;}" +
        ".teamChatHeader{display:flex;align-items:center;background:#1F3864;color:white;padding:6px 8px;}" +
        ".teamChatHeader .title{flex-grow:1;font-weight:bold;}" +
        "#teamChatColumn.collapsed .teamChatHeader .title{display:none;}" +
        "#teamChatColumn.collapsed .teamChatHeader{flex-direction:column;padding:6px 2px;}" +
        "#teamChatColumn.collapsed .teamChatBadge{margin:6px 0 0 0;}" +
        ".teamChatToggle{background:none;border:none;color:white;cursor:pointer;font-size:14px;padding:0 4px;}" +
        ".teamChatBadge{background:#c0392b;color:white;border-radius:9px;padding:0 6px;font-size:11px;margin-left:4px;display:none;}" +
        ".teamChatBody{display:flex;flex-direction:column;flex-grow:1;min-height:0;}" +
        ".teamChatPresence{padding:6px 8px;border-bottom:1px solid #d5dbe5;max-height:120px;overflow-y:auto;font-size:12px;}" +
        ".teamChatPresence .who{display:flex;align-items:center;margin:2px 0;}" +
        ".teamChatPresence .dot{width:9px;height:9px;border-radius:50%;margin-right:6px;display:inline-block;}" +
        ".teamChatPresence .online .dot{background:#2e7d32;}" +
        ".teamChatPresence .offline .dot{background:#9e9e9e;}" +
        ".teamChatPresence .offline{color:#777;}" +
        ".teamChatMessages{flex-grow:1;overflow-y:auto;padding:6px 8px;min-height:120px;}" +
        ".teamChatMsg{margin:4px 0;padding:5px 7px;background:white;border:1px solid #e0e5ee;border-radius:6px;word-wrap:break-word;white-space:pre-wrap;font-size:13px;}" +
        ".teamChatMsg.mine{background:#e8eef9;border-color:#b8c7e6;}" +
        ".teamChatMsg .meta{font-size:11px;color:#556;margin-bottom:2px;}" +
        ".teamChatMsg .meta b{color:#1F3864;margin-right:6px;}" +
        ".teamChatEmpty{color:#888;font-size:12px;text-align:center;margin-top:12px;}" +
        ".teamChatComposer{border-top:1px solid #d5dbe5;padding:6px 8px;}" +
        ".teamChatComposer textarea{width:100%;box-sizing:border-box;height:56px;resize:vertical;font-family:inherit;font-size:13px;}" +
        ".teamChatComposer .row{display:flex;align-items:center;margin-top:4px;}" +
        ".teamChatComposer .count{flex-grow:1;font-size:11px;color:#666;}" +
        ".teamChatComposer .count.over{color:#c0392b;font-weight:bold;}" +
        ".teamChatComposer button{background:#1F3864;color:white;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;}" +
        ".teamChatComposer button:disabled{background:#9aa6bd;cursor:default;}" +
        ".teamChatError{color:#c0392b;font-size:11px;min-height:14px;}";

    var username = function(){
        try { return UserSettings.getUsername(); } catch(e) { return "me"; }
    };
    var slideLocation = function(){
        try { return Conversations.getCurrentSlideJid(); } catch(e) { return ""; }
    };
    var formatTime = function(ts){
        var d = new Date(ts);
        return d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
    };
    var relayout = function(){
        try { Progress.call("onLayoutUpdated"); } catch(e) {}
        $(window).trigger("resize");
    };

    var updateBadge = function(){
        if (unread > 0 && collapsed){
            badge.text(unread).show();
        } else {
            badge.hide();
        }
    };

    var setCollapsed = function(value){
        collapsed = value;
        panel.toggleClass("collapsed", collapsed);
        toggleButton.html(collapsed ? "&#9664;" : "&#9654;").attr("title", collapsed ? "Show chat" : "Hide chat");
        if (!collapsed) { unread = 0; }
        updateBadge();
        relayout();
    };

    var renderPresence = function(){
        presenceList.empty();
        var people = TeamChatRules.presence(lastPresence.current, lastPresence.possible, username());
        var onlineCount = people.filter(function(p){ return p.status == "online"; }).length;
        presenceList.append($("<div/>",{text:"People (" + onlineCount + " online)", css:{fontWeight:"bold", marginBottom:"3px"}}));
        people.forEach(function(p){
            var row = $("<div/>",{"class":"who " + p.status, title:p.status == "online" ? "Online" : "Offline"});
            row.append($("<span/>",{"class":"dot"}));
            row.append($("<span/>",{text:p.name + (p.isMe ? " (you)" : "")}));
            presenceList.append(row);
        });
    };

    var addMessage = function(stanza){
        if (!TeamChatRules.isPublicChat(stanza) || seen[stanza.identity]) { return; }
        seen[stanza.identity] = true;
        list.find(".teamChatEmpty").remove();
        var mine = stanza.author == username();
        var item = $("<div/>",{"class":"teamChatMsg" + (mine ? " mine" : "")});
        var meta = $("<div/>",{"class":"meta"});
        meta.append($("<b/>",{text:stanza.author}));
        meta.append($("<span/>",{text:formatTime(stanza.timestamp)}));
        item.append(meta);
        // .text() so that message content is never interpreted as HTML
        item.append($("<div/>",{text:stanza.content}));
        // keep messages in time order even if history arrives late
        var placed = false;
        list.children(".teamChatMsg").each(function(){
            if (!placed && Number($(this).attr("data-ts")) > stanza.timestamp){
                item.insertBefore($(this));
                placed = true;
            }
        });
        item.attr("data-ts", stanza.timestamp);
        if (!placed) { list.append(item); }
        list.scrollTop(list[0].scrollHeight);
        if (collapsed && !mine) {
            unread += 1;
            updateBadge();
        }
    };

    var clearMessages = function(){
        seen = {};
        list.empty().append($("<div/>",{"class":"teamChatEmpty", text:"No messages yet. Say hello to your team."}));
    };

    var updateCounter = function(){
        var len = box.val().trim().length;
        counter.text(len + " / 2,000");
        counter.toggleClass("over", len > TeamChatRules.MAX_LENGTH);
        sendButton.prop("disabled", !TeamChatRules.validate(box.val()).ok);
        errorLine.text("");
    };

    var send = function(){
        var result = TeamChatRules.validate(box.val());
        if (!result.ok){
            errorLine.text(result.reason);
            return;
        }
        if (typeof sendStanza !== "function"){
            errorLine.text("Not connected to the server yet. Try again in a moment.");
            return;
        }
        sendStanza(TeamChatRules.makeMessage(username(), slideLocation(), result.text));
        box.val("");
        updateCounter();
    };

    var build = function(){
        $("<style/>").text(css).appendTo("head");
        panel = $("<div/>",{id:"teamChatColumn"});
        var header = $("<div/>",{"class":"teamChatHeader"});
        toggleButton = $("<button/>",{"class":"teamChatToggle", id:"teamChatToggle"});
        badge = $("<span/>",{"class":"teamChatBadge", id:"teamChatBadge"});
        header.append(toggleButton).append($("<span/>",{"class":"title", text:"Team Chat"})).append(badge);
        var body = $("<div/>",{"class":"teamChatBody"});
        presenceList = $("<div/>",{"class":"teamChatPresence", id:"teamChatPresence"});
        list = $("<div/>",{"class":"teamChatMessages", id:"teamChatMessages"});
        var composer = $("<div/>",{"class":"teamChatComposer"});
        box = $("<textarea/>",{id:"teamChatInput", placeholder:"Message your team (Enter to send, Shift+Enter for a new line)"});
        counter = $("<span/>",{"class":"count", id:"teamChatCount"});
        sendButton = $("<button/>",{id:"teamChatSend", text:"Send"});
        errorLine = $("<div/>",{"class":"teamChatError", id:"teamChatError"});
        composer.append(box).append($("<div/>",{"class":"row"}).append(counter).append(sendButton)).append(errorLine);
        body.append(presenceList).append(list).append(composer);
        panel.append(header).append(body);

        var host = $("#masterLayout");
        if (host.length) { host.append(panel); } else { $("body").append(panel); }

        toggleButton.on("click", function(){ setCollapsed(!collapsed); });
        sendButton.on("click", send);
        box.on("input", updateCounter);
        box.on("keydown", function(ev){
            if (ev.keyCode == 13 && !ev.shiftKey){
                ev.preventDefault();
                send();
            }
        });
        clearMessages();
        renderPresence();
        updateCounter();
        setCollapsed(false);
    };

    var wire = function(){
        Progress.stanzaReceived["TeamChat"] = addMessage;
        Progress.historyReceived["TeamChat"] = function(history){
            (history && history.chatMessages || []).forEach(addMessage);
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
        addMessage:function(s){ addMessage(s); },
        setPresence:function(current, possible){ lastPresence = {current:current, possible:possible}; renderPresence(); },
        isCollapsed:function(){ return collapsed; },
        setCollapsed:function(v){ setCollapsed(v); }
    };
})();
