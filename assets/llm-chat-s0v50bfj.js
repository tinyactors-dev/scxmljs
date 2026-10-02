import"./chunk-n3g1hjg9.js";import"./chunk-7c7mhb7g.js";import{q,I,a,c}from"./chunk-zg14dymx.js";import{E}from"./chunk-mesna8e0.js";import{t,m}from"./chunk-166w1z2n.js";import{Q,x}from"./chunk-s938p6mw.js";m(import.meta.url,["s0v50bfj","bdjw5s01","25e8dg60","shkbdapp","n3g1hjg9","7c7mhb7g","zg14dymx","mesna8e0","166w1z2n","s938p6mw","a4w2gj65","edakkfx6","zrha9h2z","vzf0jxfz","exssp3t2","f5dnz9k9","nghx4der","k1ce4eyz"],[["./llm-chat-s0v50bfj.js",4,5,6,7,8,9],["./chunk-bdjw5s01.js",5,7,0],["./chunk-25e8dg60.js",12,8,0],["./chunk-shkbdapp.js",0],["./chunk-n3g1hjg9.js",9],["./chunk-7c7mhb7g.js",8,16],["./chunk-zg14dymx.js"],["./chunk-mesna8e0.js",5,9],["./chunk-166w1z2n.js"],["./chunk-s938p6mw.js"],["./chunk-a4w2gj65.js",12],["./chunk-edakkfx6.js",12],["./chunk-zrha9h2z.js"],["./chunk-vzf0jxfz.js"],["./chunk-exssp3t2.js"],["./chunk-f5dnz9k9.js",17],["./chunk-nghx4der.js"],["./chunk-k1ce4eyz.js"]],0);
var dt=`<?xml version="1.0" encoding="UTF-8"?>
<!--
  llm-chat: one client (a person, a tool provider or a viewer), connected to the host
  over the bus. Every client runs this chart; what it may do comes from its roles.

  The page creates the session with \`data\` set: clientId, name, kind, wants, tools.

  I/O processors (see PROTOCOL.md):
    type="bus"    messages to the host (target="host"). Inbound events come from the host,
                  or from this client's own panel (origin "ui"): ui.submit, ui.steer,
                  ui.interrupt, ui.queue.remove, ui.queue.edit, ui.leave, ui.offline, ui.online.
    type="tool"   this client's tool runtime (simulated or real): run, cancel → tool.done.
    type="panel"  this client's own panel: restore { text } puts text back into the editor
                  (appended; typed input is never thrown away).
    type="workspace"  the shared WebAssembly workspace (workspace.scxml): need { packages } →
                  workspace.progress / workspace.ready / workspace.failed.

  Regions of \`member\`:
    sync      has this client seen every log entry? live, or catching up from a snapshot
    composer  can this client type (the input role), and why the host last refused it
    outbox    this client's own queue: a message goes out only while the host is idle;
              the rest wait here, visible, editable and deletable
    work      tool calls running here (the tools role)
    tools     simulated, or real: loading its packages (calls wait here, and the host is told
              they are delayed), ready, or failed (retry)
  and \`link\`, the network toggle: while offline the bus drops everything to and from this client.
-->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript"
       name="llm-chat-client" initial="client">
  <datamodel>
    <data id="clientId" expr="''"/>
    <data id="name" expr="''"/>
    <data id="kind" expr="'person'"/>
    <!-- roles asked for: input, control, tools -->
    <data id="wants" expr="[]"/>
    <!-- ToolDef[] this client offers -->
    <data id="tools" expr="[]"/>
    <!-- roles the host granted, and the tool names it accepted -->
    <data id="granted" expr="[]"/>
    <data id="accepted" expr="[]"/>
    <!-- whether the host was running a turn when we joined -->
    <data id="hostBusy" expr="false"/>
    <!-- the last log sequence number applied -->
    <data id="seq" expr="0"/>
    <!-- callId → tool name, for calls running here -->
    <data id="running" expr="({})"/>
    <!-- the WebAssembly packages this client's real tools need (none: no Real mode) -->
    <data id="needs" expr="[]"/>
    <!-- tool calls waiting for the real tools to finish loading: { callId, name, input } -->
    <data id="held" expr="[]"/>
    <data id="toolsError" expr="null"/>
    <!-- callId → { isError, content } of calls answered lately: a repeated call gets the same answer -->
    <data id="finished" expr="({})"/>
    <!-- Real asked for before this client had joined: applied once it is in -->
    <data id="wantsReal" expr="false"/>
    <!-- messages waiting for the host to be idle: { id, text }, oldest first -->
    <data id="queue" expr="[]"/>
    <!-- inputId → { kind: "submit" | "steer", text }: sent, not yet accepted or refused -->
    <data id="awaiting" expr="({})"/>
    <!-- the submit this client is waiting on (state \`sending\`) -->
    <data id="lastSubmit" expr="null"/>
    <data id="nextInput" expr="1"/>
    <data id="rejection" expr="null"/>
    <data id="joinAttempts" expr="0"/>
  </datamodel>

  <script>
    function has(role) { return granted.indexOf(role) >= 0; }
    function runningCount() { return Object.keys(running).length; }
    /** A new input id, remembered with its text until the host answers. */
    function track(kind, text) {
      var id = clientId + "-" + nextInput++;
      awaiting[id] = { kind: kind, text: String(text) };
      if (kind === "submit") lastSubmit = id;
      return id;
    }
    function settle(inputId) {
      var a = awaiting[inputId];
      delete awaiting[inputId];
      return a;
    }
    function enqueue(text) { queue.push({ id: clientId + "-q" + nextInput++, text: String(text) }); }
    /** Remove a queued message by id; returns it, or null. */
    function unqueue(id) {
      for (var i = 0; i &lt; queue.length; i++) if (queue[i].id === id) return queue.splice(i, 1)[0];
      return null;
    }
    function canSend() { return has("input") &amp;&amp; In("online"); }
    function provides(tool) { return has("tools") &amp;&amp; accepted.indexOf(tool) >= 0; }
  </script>

  <parallel id="client">

    <!-- ── the network, as the panel's toggle sets it ──────────────────── -->
    <state id="link" initial="online">
      <state id="online">
        <transition event="ui.offline" target="offline"/>
      </state>
      <state id="offline">
        <transition event="ui.online" target="online">
          <raise event="link.restored"/>
        </transition>
      </state>
    </state>

    <state id="membership" initial="joining">
      <state id="joining">
        <onentry>
          <assign location="joinAttempts" expr="joinAttempts + 1"/>
          <send type="bus" target="host" event="client.hello">
            <param name="name" expr="name"/>
            <param name="kind" expr="kind"/>
            <param name="wants" expr="wants"/>
            <param name="tools" expr="tools"/>
          </send>
          <send event="join.timeout" id="joinTimer" delay="2s"/>
        </onentry>
        <onexit>
          <cancel sendid="joinTimer"/>
        </onexit>
        <transition event="welcome" target="member">
          <assign location="granted" expr="_event.data.granted"/>
          <assign location="accepted" expr="_event.data.tools"/>
          <assign location="hostBusy" expr="!!_event.data.busy"/>
        </transition>
        <transition event="join.timeout" target="joining"/>
        <transition event="ui.leave" target="left"/>
        <!-- Simulated/Real chosen before we're in: remembered, applied once we are -->
        <transition event="ui.tools.real ui.tools.retry">
          <assign location="wantsReal" expr="true"/>
        </transition>
        <transition event="ui.tools.simulated">
          <assign location="wantsReal" expr="false"/>
        </transition>
        <!-- typed before we're in: queued, never dropped (it goes out once the host is idle) -->
        <transition event="ui.submit ui.steer">
          <script>enqueue(_event.data.text)</script>
        </transition>
      </state>

      <parallel id="member">
        <transition event="roles.changed">
          <assign location="granted" expr="_event.data.granted"/>
        </transition>
        <transition event="ui.leave" target="left">
          <send type="bus" target="host" event="client.bye"/>
          <foreach array="Object.keys(running)" item="callId">
            <send type="tool" event="cancel"><param name="callId" expr="callId"/></send>
          </foreach>
        </transition>

        <!-- ── following the log ─────────────────────────────────────── -->
        <state id="sync" initial="syncing">
          <!-- waiting for a snapshot: the host sends one after welcome and after client.resync -->
          <state id="syncing">
            <onentry>
              <send event="sync.timeout" id="syncTimer" delay="2s"/>
            </onentry>
            <onexit>
              <cancel sendid="syncTimer"/>
            </onexit>
            <transition event="snapshot" target="live">
              <assign location="seq" expr="_event.data.seq"/>
            </transition>
            <transition event="sync.timeout" target="syncing">
              <send type="bus" target="host" event="client.resync">
                <param name="fromSeq" expr="seq"/>
              </send>
            </transition>
          </state>

          <state id="live">
            <transition event="snapshot">
              <assign location="seq" expr="_event.data.seq"/>
            </transition>
            <!-- already seen -->
            <transition event="log.batch" cond="_event.data.last &lt;= seq"/>
            <!-- continues (or overlaps) what we have -->
            <transition event="log.batch" cond="_event.data.first &lt;= seq + 1">
              <assign location="seq" expr="_event.data.last"/>
            </transition>
            <!-- a gap: something was lost -->
            <transition event="log.batch" target="syncing">
              <send type="bus" target="host" event="client.resync">
                <param name="fromSeq" expr="seq"/>
              </send>
            </transition>
            <transition event="link.restored" target="syncing">
              <send type="bus" target="host" event="client.resync">
                <param name="fromSeq" expr="seq"/>
              </send>
            </transition>
          </state>
        </state>

        <!-- ── may this client type, and why was it last refused ─────── -->
        <state id="composer" initial="readonly">
          <state id="readonly">
            <transition cond="has('input')" target="ready"/>
          </state>
          <state id="ready">
            <transition cond="!has('input')" target="readonly"/>
            <!-- "busy" is not shown: the outbox just queues the message again -->
            <transition event="input.rejected" cond="_event.data.code !== 'busy'" target="rejected">
              <assign location="rejection" expr="_event.data.reason"/>
            </transition>
          </state>
          <!-- shows the host's reason for a few seconds, or until the person types again -->
          <state id="rejected">
            <onentry>
              <send event="rejection.seen" id="rejectionTimer" delay="4s"/>
            </onentry>
            <onexit>
              <cancel sendid="rejectionTimer"/>
              <assign location="rejection" expr="null"/>
            </onexit>
            <transition cond="!has('input')" target="readonly"/>
            <transition event="rejection.seen ui.submit ui.steer ui.interrupt" target="ready"/>
          </state>
        </state>

        <!-- ── this client's own queue ───────────────────────────────── -->
        <state id="outbox" initial="outbox-start">
          <!-- anywhere in the outbox -->
          <transition event="ui.steer">
            <send type="bus" target="host" event="input.steer">
              <param name="inputId" expr="track('steer', _event.data.text)"/>
              <param name="text" expr="_event.data.text"/>
            </send>
          </transition>
          <transition event="ui.interrupt">
            <send type="bus" target="host" event="input.interrupt"/>
          </transition>
          <transition event="ui.queue.remove">
            <script>unqueue(_event.data.id)</script>
          </transition>
          <!-- edit = take it out of the queue and append it to the editor -->
          <transition event="ui.queue.edit" cond="queue.some(function (q) { return q.id === _event.data.id; })">
            <send type="panel" event="restore">
              <param name="text" expr="unqueue(_event.data.id).text"/>
            </send>
          </transition>
          <transition event="input.accepted">
            <script>settle(_event.data.inputId)</script>
          </transition>
          <!-- a refused steer (or a submit refused for a reason other than busy) goes back to the editor -->
          <transition event="input.rejected" cond="!!awaiting[_event.data.inputId]">
            <send type="panel" event="restore">
              <param name="text" expr="settle(_event.data.inputId).text"/>
            </send>
          </transition>

          <state id="outbox-start">
            <transition cond="hostBusy" target="host-busy"/>
            <transition target="host-idle"/>
          </state>

          <!-- the host is idle: the next message goes out now -->
          <state id="host-idle">
            <transition cond="queue.length > 0 &amp;&amp; canSend()" target="sending">
              <send type="bus" target="host" event="input.submit">
                <param name="inputId" expr="track('submit', queue[0].text)"/>
                <param name="text" expr="queue.shift().text"/>
              </send>
            </transition>
            <transition event="ui.submit" cond="queue.length === 0 &amp;&amp; canSend()" target="sending">
              <send type="bus" target="host" event="input.submit">
                <param name="inputId" expr="track('submit', _event.data.text)"/>
                <param name="text" expr="_event.data.text"/>
              </send>
            </transition>
            <transition event="ui.submit">
              <script>enqueue(_event.data.text)</script>
            </transition>
            <transition event="host.busy" target="host-busy"/>
          </state>

          <!-- a message is out; anything typed meanwhile is queued -->
          <state id="sending">
            <onentry>
              <send event="send.timeout" id="sendTimer" delay="3s"/>
            </onentry>
            <onexit>
              <cancel sendid="sendTimer"/>
            </onexit>
            <transition event="ui.submit">
              <script>enqueue(_event.data.text)</script>
            </transition>
            <transition event="input.accepted" cond="_event.data.inputId === lastSubmit" target="host-busy">
              <script>settle(lastSubmit)</script>
            </transition>
            <!-- another client's message got there first: ours goes back to the head of the queue -->
            <transition event="input.rejected" cond="_event.data.inputId === lastSubmit &amp;&amp; _event.data.code === 'busy'" target="host-busy">
              <script>queue.unshift({ id: lastSubmit, text: settle(lastSubmit).text })</script>
            </transition>
            <transition event="input.rejected" cond="_event.data.inputId === lastSubmit" target="host-idle">
              <send type="panel" event="restore">
                <param name="text" expr="settle(lastSubmit).text"/>
              </send>
            </transition>
            <!-- no answer (offline?): queue it again and try when possible -->
            <transition event="send.timeout" target="host-idle">
              <script>if (awaiting[lastSubmit]) queue.unshift({ id: lastSubmit, text: settle(lastSubmit).text })</script>
            </transition>
          </state>

          <!-- a turn is running: messages wait in the queue -->
          <state id="host-busy">
            <transition event="ui.submit">
              <script>enqueue(_event.data.text)</script>
            </transition>
            <!-- this client stopped the turn: its queue goes back into the editor instead of out -->
            <transition event="host.idle" cond="_event.data.stoppedBy === clientId &amp;&amp; queue.length > 0" target="host-idle">
              <send type="panel" event="restore">
                <param name="text" expr="queue.map(function (q) { return q.text; }).join('\\n\\n')"/>
              </send>
              <assign location="queue" expr="[]"/>
            </transition>
            <transition event="host.idle" target="host-idle"/>
          </state>
        </state>

        <!-- ── tool calls from the host ──────────────────────────────── -->
        <state id="work" initial="waiting">
          <!-- the host may send a call again (we were offline): never run it twice -->
          <transition event="tool.call" cond="!!running[_event.data.callId]"/>
          <transition event="tool.call" cond="!!finished[_event.data.callId]">
            <send type="bus" target="host" event="tool.result">
              <param name="callId" expr="_event.data.callId"/>
              <param name="isError" expr="finished[_event.data.callId].isError"/>
              <param name="content" expr="finished[_event.data.callId].content"/>
            </send>
          </transition>
          <!-- real tools still downloading: the call waits, and the host is told why it takes longer -->
          <transition event="tool.call" cond="provides(_event.data.name) &amp;&amp; In('real-loading')">
            <assign location="running[_event.data.callId]" expr="_event.data.name"/>
            <script>held.push({ callId: _event.data.callId, name: _event.data.name, input: _event.data.input })</script>
            <send type="bus" target="host" event="tool.delayed">
              <param name="callId" expr="_event.data.callId"/>
              <param name="reason" expr="'downloading its WebAssembly packages'"/>
            </send>
          </transition>
          <transition event="tool.call" cond="provides(_event.data.name) &amp;&amp; In('real-failed')">
            <send type="bus" target="host" event="tool.result">
              <param name="callId" expr="_event.data.callId"/>
              <param name="isError" expr="true"/>
              <param name="content" expr="name + ' could not load its real tools: ' + toolsError"/>
            </send>
          </transition>
          <transition event="tool.call" cond="provides(_event.data.name)">
            <assign location="running[_event.data.callId]" expr="_event.data.name"/>
            <send type="tool" event="run">
              <param name="callId" expr="_event.data.callId"/>
              <param name="name" expr="_event.data.name"/>
              <param name="input" expr="_event.data.input"/>
              <param name="real" expr="In('real-ready')"/>
            </send>
          </transition>
          <transition event="tool.call">
            <send type="bus" target="host" event="tool.result">
              <param name="callId" expr="_event.data.callId"/>
              <param name="isError" expr="true"/>
              <param name="content" expr="name + ' does not provide ' + _event.data.name + '.'"/>
            </send>
          </transition>
          <transition event="tool.cancel" cond="held.some(function (c) { return c.callId === _event.data.callId; })">
            <script>held = held.filter(function (c) { return c.callId !== _event.data.callId; }); delete running[_event.data.callId];</script>
          </transition>
          <transition event="tool.cancel" cond="!!running[_event.data.callId]">
            <send type="tool" event="cancel"><param name="callId" expr="_event.data.callId"/></send>
            <script>delete running[_event.data.callId];</script>
          </transition>
          <!-- from the runtime; results of cancelled calls are dropped -->
          <transition event="tool.done" cond="!!running[_event.data.callId]">
            <send type="bus" target="host" event="tool.result">
              <param name="callId" expr="_event.data.callId"/>
              <param name="isError" expr="!!_event.data.isError"/>
              <param name="content" expr="_event.data.content"/>
            </send>
            <script>
              delete running[_event.data.callId];
              finished[_event.data.callId] = { isError: !!_event.data.isError, content: _event.data.content };
              var ids = Object.keys(finished);
              if (ids.length > 20) delete finished[ids[0]];
            </script>
          </transition>

          <state id="waiting">
            <transition cond="runningCount() > 0" target="working"/>
          </state>
          <state id="working">
            <transition cond="runningCount() === 0" target="waiting"/>
          </state>
        </state>

        <!-- ── simulated or real (WebAssembly) tools ─────────────────── -->
        <state id="tools" initial="tools-start">
          <state id="tools-start">
            <transition cond="wantsReal &amp;&amp; needs.length > 0" target="real"/>
            <transition target="simulated"/>
          </state>
          <state id="simulated">
            <transition event="ui.tools.real" cond="needs.length > 0" target="real"/>
          </state>

          <state id="real" initial="real-loading">
            <!-- back to the simulation: held calls run simulated -->
            <transition event="ui.tools.simulated" target="simulated">
              <foreach array="held" item="call">
                <send type="tool" event="run">
                  <param name="callId" expr="call.callId"/>
                  <param name="name" expr="call.name"/>
                  <param name="input" expr="call.input"/>
                  <param name="real" expr="false"/>
                </send>
              </foreach>
              <assign location="held" expr="[]"/>
            </transition>

            <!-- asks the workspace for its packages; each is a package.scxml machine there -->
            <state id="real-loading">
              <onentry>
                <assign location="toolsError" expr="null"/>
                <send type="workspace" target="workspace" event="need">
                  <param name="packages" expr="needs"/>
                </send>
              </onentry>
              <transition event="workspace.ready" target="real-ready"/>
              <transition event="workspace.failed" target="real-failed">
                <assign location="toolsError" expr="_event.data.key + ': ' + (_event.data.error || 'failed')"/>
              </transition>
              <!-- a package moved on: tell the host again that held calls are still coming -->
              <transition event="workspace.progress" cond="held.length > 0">
                <foreach array="held" item="call">
                  <send type="bus" target="host" event="tool.delayed">
                    <param name="callId" expr="call.callId"/>
                    <param name="reason" expr="'still downloading its WebAssembly packages'"/>
                  </send>
                </foreach>
              </transition>
            </state>

            <!-- everything installed: held calls run now -->
            <state id="real-ready">
              <onentry>
                <foreach array="held" item="call">
                  <send type="tool" event="run">
                    <param name="callId" expr="call.callId"/>
                    <param name="name" expr="call.name"/>
                    <param name="input" expr="call.input"/>
                    <param name="real" expr="true"/>
                  </send>
                </foreach>
                <assign location="held" expr="[]"/>
              </onentry>
            </state>

            <!-- a download failed: held calls fail with the reason; asking again retries -->
            <state id="real-failed">
              <onentry>
                <foreach array="held" item="call">
                  <send type="bus" target="host" event="tool.result">
                    <param name="callId" expr="call.callId"/>
                    <param name="isError" expr="true"/>
                    <param name="content" expr="name + ' could not load its real tools: ' + toolsError"/>
                  </send>
                  <script>delete running[call.callId];</script>
                </foreach>
                <assign location="held" expr="[]"/>
              </onentry>
              <transition event="ui.tools.real ui.tools.retry" target="real-loading"/>
            </state>
          </state>
        </state>
      </parallel>

      <final id="left"/>
    </state>
  </parallel>
</scxml>
`;var ct=`<?xml version="1.0" encoding="UTF-8"?>
<!--
  llm-chat: the host's controller.

  One tab runs one system: this chart, a model (simulated or Claude), and the clients
  (people, tool providers, viewers), each running client.scxml. The chart is the control
  plane only. Message bodies, streamed text and history live in the chat log (host code);
  this chart decides what happens to them.

  I/O processors (see PROTOCOL.md):
    type="bus"  messages to one client (target = clientId) or to everyone (target = "*").
                Inbound bus events carry the sender in _event.origin ("host" = the control panel).
    type="log"  commands to the chat log, which broadcasts every change to the clients.
  Invokers:
    type="llm"        one Messages API request (simulated or real), streamed into the log.
    type="key-check"  verifies the API key the control panel stored.

  Regions:
    roster        who is connected, their roles and tools (last region, see there)
    model         simulated, or Claude (locked until a key is verified)
    conversation  turns: request → (tools → request)* → settle, with steer and stop. It tells the
                  clients host.busy / host.idle; each client keeps its own queue and sends the
                  next message when the host is idle.
    inbox         whether steers are waiting (for the picture; the data is steers)
-->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript"
       name="llm-chat-host" initial="host">
  <datamodel>
    <!-- clientId → { name, kind, roles: [], tools: [ToolDef] } -->
    <data id="clients" expr="({})"/>
    <!-- the input that starts the next turn: { inputId, author, text }. Clients hold their own
         queues and send the next message when the host says it is idle again (host.idle). -->
    <data id="incoming" expr="[]"/>
    <!-- steers for the next boundary: after the tool results, or as the next turn -->
    <data id="steers" expr="[]"/>
    <!-- who stopped the last turn, if anyone (sent with host.idle) -->
    <data id="stoppedBy" expr="null"/>
    <data id="turn" expr="0"/>
    <data id="request" expr="0"/>
    <!-- the tools offered to the model this turn, frozen when the turn starts -->
    <data id="toolset" expr="[]"/>
    <!-- the tool_use blocks of the last response, with the client that provides each -->
    <data id="calls" expr="[]"/>
    <!-- callId → provider clientId, while their results are outstanding -->
    <data id="pending" expr="({})"/>
    <data id="results" expr="[]"/>
    <data id="attempts" expr="0"/>
    <data id="maxAttempts" expr="4"/>
    <data id="retryInMs" expr="0"/>
    <!-- how long tool calls may take; re-armed when a provider says it needs longer or comes back -->
    <data id="toolTimeoutMs" expr="30000"/>
  </datamodel>

  <script>
    var ROLES = ["input", "control", "tools"];

    function can(origin, role) {
      if (origin === "host") return true;
      var c = clients[origin];
      return !!c &amp;&amp; c.roles.indexOf(role) >= 0;
    }
    function roleFor(name) { return name === "input.submit" ? "input" : "control"; }
    function modelReady() { return In("simulated") || In("unlocked"); }
    function authorOf(origin) {
      if (origin === "host") return "Host";
      return clients[origin] ? clients[origin].name : origin;
    }
    function hold(list, origin, data) {
      list.push({ inputId: data.inputId, author: authorOf(origin), text: String(data.text || "") });
    }
    /** Steers first, then the new input; empties both. */
    function take() {
      var entries = steers.concat(incoming);
      steers = [];
      incoming = [];
      return entries;
    }

    /** A hello → the roster entry. Tool names already provided by someone else are refused. */
    function admit(id, hello) {
      var taken = {};
      for (var k in clients) {
        if (k === id) continue;
        for (var i = 0; i &lt; clients[k].tools.length; i++) taken[clients[k].tools[i].name] = true;
      }
      var roles = (hello.wants || []).filter(function (r) { return ROLES.indexOf(r) >= 0; });
      var tools = [];
      var refused = [];
      var offered = roles.indexOf("tools") >= 0 ? hello.tools || [] : [];
      for (var j = 0; j &lt; offered.length; j++) (taken[offered[j].name] ? refused : tools).push(offered[j]);
      return { name: hello.name || id, kind: hello.kind || "client", roles: roles, tools: tools, refused: refused };
    }
    function rosterView() {
      var out = [];
      for (var id in clients) {
        var c = clients[id];
        out.push({ id: id, name: c.name, kind: c.kind, roles: c.roles, tools: c.tools.map(function (t) { return t.name; }) });
      }
      return out;
    }
    function freezeTools() {
      var out = [];
      for (var id in clients) {
        var c = clients[id];
        if (c.roles.indexOf("tools") &lt; 0) continue;
        for (var i = 0; i &lt; c.tools.length; i++) {
          var t = c.tools[i];
          out.push({ name: t.name, description: t.description, input_schema: t.input_schema, provider: id });
        }
      }
      return out;
    }
    function route(toolCalls) {
      return toolCalls.map(function (call) {
        var provider = null;
        for (var i = 0; i &lt; toolset.length; i++) if (toolset[i].name === call.name) provider = toolset[i].provider;
        return { id: call.id, name: call.name, input: call.input, invalid: call.invalid || null, provider: provider };
      });
    }
    function callById(id) {
      for (var i = 0; i &lt; calls.length; i++) if (calls[i].id === id) return calls[i];
      return null;
    }
    function settle(callId, isError, content) {
      results.push({ callId: callId, isError: !!isError, content: content });
      delete pending[callId];
    }
    /** Outstanding call ids, all of them or only those of one provider. */
    function pendingFrom(provider) {
      var ids = [];
      for (var id in pending) if (!provider || pending[id] === provider) ids.push(id);
      return ids;
    }
    /** Why an input was refused: a code clients act on, and a reason people read. */
    function whyNot(origin, name) {
      if (origin !== "host" &amp;&amp; !clients[origin]) return { code: "disconnected", reason: "not connected" };
      if (!can(origin, roleFor(name))) return { code: "role", reason: "needs the " + roleFor(name) + " role" };
      if (name === "input.interrupt") return { code: "nothing", reason: "nothing to stop" };
      if (!modelReady()) return { code: "model", reason: "the model isn't ready: paste an API key or switch to the simulation" };
      if (!In("idle")) return { code: "busy", reason: "a turn is running; the message stays queued" };
      return { code: "other", reason: "not possible right now" };
    }
    function retryDelayMs(error) {
      if (error &amp;&amp; typeof error.retryAfterMs === "number") return error.retryAfterMs;
      return Math.min(30000, 1000 * Math.pow(2, attempts - 1));
    }
  </script>

  <parallel id="host">

    <!-- ── which model answers ──────────────────────────────────────────── -->
    <state id="model" initial="simulated">
      <state id="simulated">
        <transition event="mode.claude" cond="_event.origin === 'host' &amp;&amp; In('idle')" target="claude"/>
      </state>

      <state id="claude" initial="locked">
        <transition event="mode.simulated" cond="_event.origin === 'host' &amp;&amp; In('idle')" target="simulated"/>

        <state id="locked">
          <transition event="key.set" cond="_event.origin === 'host'" target="verifying"/>
        </state>

        <state id="verifying">
          <invoke type="key-check" id="keycheck"/>
          <transition event="done.invoke.keycheck" cond="_event.data.ok" target="unlocked"/>
          <transition event="done.invoke.keycheck" target="locked">
            <send type="log" event="notice">
              <param name="level" expr="'error'"/>
              <param name="text" expr="'The API key was not accepted: ' + _event.data.message"/>
            </send>
          </transition>
          <transition event="key.set" cond="_event.origin === 'host'" target="verifying"/>
        </state>

        <state id="unlocked">
          <transition event="key.forget" cond="_event.origin === 'host'" target="locked"/>
          <!-- raised by the conversation when a request fails with 401 -->
          <transition event="key.rejected" target="locked"/>
        </state>
      </state>
    </state>

    <!-- ── the conversation ─────────────────────────────────────────────── -->
    <state id="conversation" initial="idle">
      <!-- any input nobody below accepted is refused, with the reason -->
      <transition event="input.*">
        <send type="bus" targetexpr="_event.origin" event="input.rejected">
          <param name="inputId" expr="_event.data &amp;&amp; _event.data.inputId"/>
          <param name="code" expr="whyNot(_event.origin, _event.name).code"/>
          <param name="reason" expr="whyNot(_event.origin, _event.name).reason"/>
        </send>
      </transition>
      <!-- a result that arrives after its call was settled (timeout, provider left, stop) -->
      <transition event="tool.result">
        <send type="log" event="notice">
          <param name="level" expr="'info'"/>
          <param name="text" expr="'Ignored a late result for ' + _event.data.callId + ' from ' + authorOf(_event.origin)"/>
        </send>
      </transition>

      <state id="idle">
        <!-- tell the clients: a queued message can go now (unless its author just stopped the turn) -->
        <onentry>
          <send type="bus" target="*" event="host.idle">
            <param name="stoppedBy" expr="stoppedBy"/>
          </send>
        </onentry>
        <!-- a steer with nothing running is just a message -->
        <transition event="input.submit input.steer"
                    cond="can(_event.origin, roleFor(_event.name)) &amp;&amp; modelReady()" target="turn">
          <script>hold(incoming, _event.origin, _event.data)</script>
          <send type="bus" targetexpr="_event.origin" event="input.accepted">
            <param name="inputId" expr="_event.data.inputId"/>
            <param name="queued" expr="false"/>
          </send>
        </transition>
      </state>

      <state id="turn" initial="requesting">
        <onentry>
          <assign location="turn" expr="turn + 1"/>
          <assign location="stoppedBy" expr="null"/>
          <send type="bus" target="*" event="host.busy"/>
          <assign location="toolset" expr="freezeTools()"/>
          <send type="log" event="user.append">
            <param name="turn" expr="turn"/>
            <param name="entries" expr="take()"/>
          </send>
          <raise event="queue.changed"/>
        </onentry>

        <!-- a submit now is refused as "busy" (it raced another client): its client queues it
             again. A steer is held for the next boundary. -->
        <transition event="input.steer" cond="can(_event.origin, 'control')">
          <script>hold(steers, _event.origin, _event.data)</script>
          <send type="bus" targetexpr="_event.origin" event="input.accepted">
            <param name="inputId" expr="_event.data.inputId"/>
            <param name="queued" expr="true"/>
            <param name="steer" expr="true"/>
          </send>
          <raise event="queue.changed"/>
        </transition>

        <state id="requesting" initial="connecting">
          <onentry>
            <assign location="request" expr="request + 1"/>
          </onentry>
          <invoke type="llm" id="llm">
            <param name="request" expr="request"/>
            <param name="model" expr="In('simulated') ? 'simulated' : 'claude'"/>
            <param name="tools" expr="toolset"/>
          </invoke>

          <!-- what the stream is doing right now (type="internal": the invoke keeps running) -->
          <state id="connecting"/>
          <state id="thinking"/>
          <state id="writing"/>
          <state id="calling"/>
          <transition event="llm.block.start" cond="_event.data.kind === 'thinking'" type="internal" target="thinking"/>
          <transition event="llm.block.start" cond="_event.data.kind === 'text'" type="internal" target="writing"/>
          <transition event="llm.block.start" cond="_event.data.kind === 'tool_use'" type="internal" target="calling"/>

          <transition event="done.invoke.llm" cond="_event.data.ok &amp;&amp; _event.data.stop === 'tool_use'" target="tools">
            <assign location="attempts" expr="0"/>
            <assign location="calls" expr="route(_event.data.toolCalls)"/>
            <send type="log" event="assistant.commit">
              <param name="request" expr="request"/>
              <param name="stop" expr="_event.data.stop"/>
            </send>
          </transition>
          <transition event="done.invoke.llm" cond="_event.data.ok" target="settling">
            <assign location="attempts" expr="0"/>
            <send type="log" event="assistant.commit">
              <param name="request" expr="request"/>
              <param name="stop" expr="_event.data.stop"/>
            </send>
            <if cond="_event.data.stop === 'max_tokens'">
              <send type="log" event="notice">
                <param name="level" expr="'warning'"/>
                <param name="text" expr="'The answer was cut off at the output limit.'"/>
              </send>
            </if>
          </transition>
          <transition event="done.invoke.llm"
                      cond="_event.data.error.retryable &amp;&amp; attempts &lt; maxAttempts" target="backoff">
            <assign location="attempts" expr="attempts + 1"/>
            <assign location="retryInMs" expr="retryDelayMs(_event.data.error)"/>
            <send type="log" event="assistant.discard">
              <param name="request" expr="request"/>
              <param name="reason" expr="_event.data.error.message"/>
            </send>
          </transition>
          <transition event="done.invoke.llm" target="settling">
            <assign location="attempts" expr="0"/>
            <send type="log" event="assistant.discard">
              <param name="request" expr="request"/>
              <param name="reason" expr="_event.data.error.message"/>
            </send>
            <send type="log" event="notice">
              <param name="level" expr="'error'"/>
              <param name="text" expr="'The request failed: ' + _event.data.error.message"/>
            </send>
            <if cond="_event.data.error.kind === 'auth'">
              <raise event="key.rejected"/>
            </if>
          </transition>

          <!-- stop: leaving this state cancels the invoke, which aborts the stream -->
          <transition event="input.interrupt" cond="can(_event.origin, 'control')" target="idle">
            <assign location="stoppedBy" expr="_event.origin"/>
            <send type="log" event="assistant.discard">
              <param name="request" expr="request"/>
              <param name="reason" expr="'stopped by ' + authorOf(_event.origin)"/>
            </send>
          </transition>
        </state>

        <state id="backoff">
          <onentry>
            <send event="retry" id="retryTimer" delayexpr="retryInMs + 'ms'"/>
            <send type="log" event="notice">
              <param name="level" expr="'warning'"/>
              <param name="text" expr="'Retrying in ' + Math.round(retryInMs / 1000) + ' s (attempt ' + (attempts + 1) + ' of ' + (maxAttempts + 1) + ')'"/>
            </send>
          </onentry>
          <onexit>
            <cancel sendid="retryTimer"/>
          </onexit>
          <transition event="retry" target="requesting"/>
          <transition event="input.interrupt" cond="can(_event.origin, 'control')" target="idle">
            <assign location="stoppedBy" expr="_event.origin"/>
          </transition>
        </state>

        <!-- run every tool call of the response at once, each on the client that provides it -->
        <state id="tools">
          <onentry>
            <assign location="results" expr="[]"/>
            <assign location="pending" expr="({})"/>
            <foreach array="calls" item="call">
              <!-- input that failed the tool's schema is answered here, never run -->
              <if cond="call.invalid">
                <script>settle(call.id, true, "Invalid input: " + call.invalid + ". Call the tool again with valid input.")</script>
              <elseif cond="call.provider &amp;&amp; clients[call.provider]"/>
                <assign location="pending[call.id]" expr="call.provider"/>
                <send type="bus" targetexpr="call.provider" event="tool.call">
                  <param name="callId" expr="call.id"/>
                  <param name="name" expr="call.name"/>
                  <param name="input" expr="call.input"/>
                </send>
              <else/>
                <script>settle(call.id, true, "No connected client provides the tool " + call.name + ".")</script>
              </if>
            </foreach>
            <send type="log" event="tools.dispatched">
              <param name="request" expr="request"/>
              <param name="calls" expr="calls"/>
            </send>
            <send event="tools.timeout" id="toolsTimer" delayexpr="toolTimeoutMs + 'ms'"/>
            <send type="log" event="tools.timer">
              <param name="request" expr="request"/>
              <param name="ms" expr="toolTimeoutMs"/>
            </send>
          </onentry>
          <onexit>
            <cancel sendid="toolsTimer"/>
          </onexit>

          <!-- every call answered: results (and any steers) go back to the model -->
          <transition cond="pendingFrom(null).length === 0" target="requesting">
            <send type="log" event="tool.results">
              <param name="request" expr="request"/>
              <param name="results" expr="results"/>
              <param name="steers" expr="steers"/>
            </send>
            <assign location="steers" expr="[]"/>
            <raise event="queue.changed"/>
          </transition>

          <!-- the provider is still getting ready (downloading real tools): wait longer -->
          <transition event="tool.delayed" cond="pending[_event.data.callId] === _event.origin">
            <cancel sendid="toolsTimer"/>
            <send event="tools.timeout" id="toolsTimer" delayexpr="toolTimeoutMs + 'ms'"/>
            <send type="log" event="tools.timer">
              <param name="request" expr="request"/>
              <param name="ms" expr="toolTimeoutMs"/>
            </send>
            <send type="log" event="notice">
              <param name="level" expr="'info'"/>
              <param name="text" expr="authorOf(_event.origin) + ' is ' + _event.data.reason + '; waiting longer for it.'"/>
            </send>
          </transition>

          <!-- a provider that was offline is back (it asks for a snapshot): whatever it still owes
               us may never have reached it, so it gets those calls again, and the full timeout.
               Calls are idempotent on the client: a running one is ignored, a finished one is
               answered again from its stored result. -->
          <transition event="client.resync" cond="pendingFrom(_event.origin).length > 0">
            <foreach array="pendingFrom(_event.origin)" item="callId">
              <send type="bus" targetexpr="_event.origin" event="tool.call">
                <param name="callId" expr="callId"/>
                <param name="name" expr="callById(callId).name"/>
                <param name="input" expr="callById(callId).input"/>
              </send>
            </foreach>
            <cancel sendid="toolsTimer"/>
            <send event="tools.timeout" id="toolsTimer" delayexpr="toolTimeoutMs + 'ms'"/>
            <send type="log" event="tools.timer">
              <param name="request" expr="request"/>
              <param name="ms" expr="toolTimeoutMs"/>
            </send>
            <send type="log" event="notice">
              <param name="level" expr="'info'"/>
              <param name="text" expr="authorOf(_event.origin) + ' is back: sent it its ' + pendingFrom(_event.origin).length + ' outstanding tool call(s) again.'"/>
            </send>
          </transition>

          <transition event="tool.result" cond="pending[_event.data.callId] === _event.origin">
            <script>settle(_event.data.callId, _event.data.isError, _event.data.content)</script>
          </transition>

          <transition event="client.bye">
            <foreach array="pendingFrom(_event.origin)" item="callId">
              <script>settle(callId, true, authorOf(_event.origin) + " disconnected before answering.")</script>
            </foreach>
          </transition>

          <transition event="tools.timeout">
            <foreach array="pendingFrom(null)" item="callId">
              <send type="bus" targetexpr="pending[callId]" event="tool.cancel">
                <param name="callId" expr="callId"/>
              </send>
              <script>settle(callId, true, "Timed out after " + toolTimeoutMs / 1000 + "s.")</script>
            </foreach>
          </transition>

          <!-- stop: every tool_use still needs a tool_result, so cancelled calls get one -->
          <transition event="input.interrupt" cond="can(_event.origin, 'control')" target="idle">
            <assign location="stoppedBy" expr="_event.origin"/>
            <foreach array="pendingFrom(null)" item="callId">
              <send type="bus" targetexpr="pending[callId]" event="tool.cancel">
                <param name="callId" expr="callId"/>
              </send>
              <script>settle(callId, true, "Cancelled: " + authorOf(_event.origin) + " stopped the turn.")</script>
            </foreach>
            <send type="log" event="tool.results">
              <param name="request" expr="request"/>
              <param name="results" expr="results"/>
              <param name="steers" expr="[]"/>
            </send>
          </transition>
        </state>

        <!-- the model finished: held steers start the next turn; otherwise idle, and the clients
             send their queued messages -->
        <state id="settling">
          <transition cond="steers.length > 0 &amp;&amp; modelReady()" target="turn"/>
          <transition target="idle"/>
        </state>
      </state>
    </state>

    <!-- ── held steers (the picture; the data is steers) ──────────────── -->
    <state id="inbox" initial="empty">
      <transition event="queue.changed">
        <send type="log" event="queue.changed">
          <param name="steers" expr="steers"/>
        </send>
      </transition>
      <state id="empty">
        <transition cond="steers.length > 0" target="holding"/>
      </state>
      <state id="holding">
        <transition cond="steers.length === 0" target="empty"/>
      </state>
    </state>

    <!-- ── who is connected (last, so on client.bye the regions above still see the client) ── -->
    <state id="roster">
      <transition event="client.hello">
        <assign location="clients[_event.origin]" expr="admit(_event.origin, _event.data)"/>
        <send type="bus" targetexpr="_event.origin" event="welcome">
          <param name="clientId" expr="_event.origin"/>
          <param name="granted" expr="clients[_event.origin].roles"/>
          <param name="tools" expr="clients[_event.origin].tools.map(function (t) { return t.name; })"/>
          <param name="refused" expr="clients[_event.origin].refused.map(function (t) { return t.name; })"/>
          <param name="busy" expr="!In('idle')"/>
        </send>
        <send type="log" event="snapshot.send"><param name="to" expr="_event.origin"/></send>
        <send type="log" event="roster.changed"><param name="clients" expr="rosterView()"/></send>
      </transition>

      <transition event="client.resync" cond="!!clients[_event.origin]">
        <send type="log" event="snapshot.send"><param name="to" expr="_event.origin"/></send>
        <!-- it may have missed host.idle / host.busy while away -->
        <send type="bus" targetexpr="_event.origin" eventexpr="In('idle') ? 'host.idle' : 'host.busy'"/>
      </transition>

      <transition event="client.bye" cond="!!clients[_event.origin]">
        <script>delete clients[_event.origin];</script>
        <send type="log" event="roster.changed"><param name="clients" expr="rosterView()"/></send>
      </transition>

      <!-- from the control panel: grant or revoke roles live -->
      <transition event="roles.set" cond="_event.origin === 'host' &amp;&amp; !!clients[_event.data.clientId]">
        <assign location="clients[_event.data.clientId].roles"
                expr="_event.data.roles.filter(function (r) { return ROLES.indexOf(r) >= 0; })"/>
        <send type="bus" targetexpr="_event.data.clientId" event="roles.changed">
          <param name="granted" expr="clients[_event.data.clientId].roles"/>
        </send>
        <send type="log" event="roster.changed"><param name="clients" expr="rosterView()"/></send>
      </transition>
    </state>
  </parallel>
</scxml>
`;var pt=`<?xml version="1.0" encoding="UTF-8"?>
<!--
  llm-chat: one WebAssembly package of the real tools (the Wasmer runtime, bash, coreutils,
  Python, PGlite, psql). workspace.scxml invokes one of these per package.

    absent ──need──▶ waiting ──runtime.ready──▶ fetching ──▶ ready
                      (the Wasmer runtime        resolving       │
                       must be up first)         downloading     └──need──▶ (tells the workspace again)
                                                 installing
                                                     │ fails
                                                     ▼
                                                   failed ──need──▶ waiting (retry)

  Invoker type="wasm-package" (params: key): does the work, sends package.progress
  { phase, downloadedBytes, totalBytes, percent, cached } while it runs, and finishes with
  done.invoke.fetch { ok, cached?, error? }. Leaving \`fetching\` cancels it.

  Every change goes to the parent as package.changed { key, status }.
-->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript"
       name="package" initial="absent">
  <datamodel>
    <data id="key" expr="''"/>
    <data id="label" expr="''"/>
    <data id="approxBytes" expr="0"/>
    <!-- false for the Wasmer runtime itself -->
    <data id="needsRuntime" expr="true"/>
    <data id="downloadedBytes" expr="0"/>
    <data id="totalBytes" expr="null"/>
    <data id="percent" expr="null"/>
    <data id="cached" expr="false"/>
    <data id="error" expr="null"/>
    <data id="attempts" expr="0"/>
  </datamodel>

  <script>
    function phase() {
      if (In("absent") || In("waiting")) return "waiting";
      if (In("resolving")) return "resolving";
      if (In("downloading")) return "downloading";
      if (In("installing")) return "loading";
      if (In("ready")) return "ready";
      return "failed";
    }
    function status() {
      return {
        key: key, label: label, approxBytes: approxBytes, phase: phase(), needed: !In("absent"),
        downloadedBytes: downloadedBytes, totalBytes: totalBytes, percent: percent,
        cached: cached, error: error, attempts: attempts
      };
    }
    function track(p) {
      if (typeof p.downloadedBytes === "number") downloadedBytes = p.downloadedBytes;
      if (p.totalBytes !== undefined) totalBytes = p.totalBytes;
      if (p.percent !== undefined) percent = p.percent;
      if (p.cached) cached = true;
    }
  </script>

  <state id="absent">
    <transition event="need" target="waiting"/>
  </state>

  <state id="waiting">
    <onentry>
      <send target="#_parent" event="package.changed">
        <param name="key" expr="key"/>
        <param name="status" expr="status()"/>
      </send>
    </onentry>
    <transition cond="!needsRuntime" target="fetching"/>
    <transition event="runtime.ready" target="fetching"/>
  </state>

  <state id="fetching" initial="resolving">
    <onentry>
      <assign location="attempts" expr="attempts + 1"/>
      <assign location="error" expr="null"/>
    </onentry>
    <invoke type="wasm-package" id="fetch">
      <param name="key" expr="key"/>
    </invoke>

    <state id="resolving">
      <onentry>
        <send target="#_parent" event="package.changed">
          <param name="key" expr="key"/>
          <param name="status" expr="status()"/>
        </send>
      </onentry>
    </state>
    <!-- re-entered on every progress event (internal transition), so each one is reported -->
    <state id="downloading">
      <onentry>
        <send target="#_parent" event="package.changed">
          <param name="key" expr="key"/>
          <param name="status" expr="status()"/>
        </send>
      </onentry>
    </state>
    <state id="installing">
      <onentry>
        <send target="#_parent" event="package.changed">
          <param name="key" expr="key"/>
          <param name="status" expr="status()"/>
        </send>
      </onentry>
    </state>

    <!-- progress: move between the steps (the invoke keeps running), report the bytes -->
    <!-- report from the steps' onentry: during a transition's own content neither step is active -->
    <transition event="package.progress" cond="_event.data.phase === 'downloading'" type="internal" target="downloading">
      <script>track(_event.data)</script>
    </transition>
    <transition event="package.progress" cond="_event.data.phase === 'loading' || _event.data.phase === 'ready'" type="internal" target="installing">
      <script>track(_event.data)</script>
    </transition>
    <transition event="package.progress">
      <script>track(_event.data)</script>
    </transition>

    <transition event="done.invoke.fetch" cond="_event.data.ok" target="ready">
      <assign location="percent" expr="100"/>
      <assign location="cached" expr="cached || !!_event.data.cached"/>
    </transition>
    <transition event="done.invoke.fetch" target="failed">
      <assign location="error" expr="_event.data.error"/>
    </transition>
    <transition event="error.execution" target="failed">
      <assign location="error" expr="'could not start the download'"/>
    </transition>
  </state>

  <state id="ready">
    <onentry>
      <send target="#_parent" event="package.changed">
        <param name="key" expr="key"/>
        <param name="status" expr="status()"/>
      </send>
    </onentry>
    <!-- asked again (another client): say so again -->
    <transition event="need">
      <send target="#_parent" event="package.changed">
        <param name="key" expr="key"/>
        <param name="status" expr="status()"/>
      </send>
    </transition>
  </state>

  <state id="failed">
    <onentry>
      <send target="#_parent" event="package.changed">
        <param name="key" expr="key"/>
        <param name="status" expr="status()"/>
      </send>
    </onentry>
    <!-- asked again: try again -->
    <transition event="need" target="waiting"/>
  </state>
</scxml>
`;var ut=`<?xml version="1.0" encoding="UTF-8"?>
<!--
  Scenario: a tool provider leaves while its call is running.

  A scenario is a chart that drives the stage the way a person would (type="stage", see
  PROTOCOL.md). The stage sends it \`host.enter.<stateId>\` whenever the host enters a state,
  so the script can wait for the system instead of guessing times.
-->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript"
       name="scenario-provider-leaves" initial="setup">
  <state id="setup">
    <onentry>
      <send type="stage" event="note">
        <param name="text" expr="'Terminal and Python join. Each offers a tool.'"/>
      </send>
      <send type="stage" event="client.add"><param name="kind" expr="'terminal'"/></send>
      <send type="stage" event="client.add"><param name="kind" expr="'python'"/></send>
      <send event="next" delay="1500ms"/>
    </onentry>
    <transition event="next" target="ask"/>
  </state>

  <state id="ask">
    <onentry>
      <send type="stage" event="note">
        <param name="text" expr="'Ada asks something that needs both. The model calls both tools at once.'"/>
      </send>
      <send type="stage" event="type">
        <param name="client" expr="'ada'"/>
        <param name="text" expr="'How many files are in the workspace? And use python to compute 2**64.'"/>
      </send>
    </onentry>
    <transition event="host.enter.tools" target="pull"/>
  </state>

  <state id="pull">
    <onentry>
      <send event="next" delay="800ms"/>
    </onentry>
    <transition event="next" target="wait">
      <send type="stage" event="note">
        <param name="text" expr="'Python leaves before answering. The host answers its call with an error: every tool call still gets a result.'"/>
      </send>
      <send type="stage" event="client.remove"><param name="client" expr="'python'"/></send>
    </transition>
  </state>

  <state id="wait">
    <transition event="host.enter.idle" target="done"/>
  </state>

  <final id="done">
    <onentry>
      <send type="stage" event="note">
        <param name="text" expr="'The model answered with what it had. Python is gone from the roster, so the next turn will not offer its tool.'"/>
      </send>
    </onentry>
  </final>
</scxml>
`;var mt=`<?xml version="1.0" encoding="UTF-8"?>
<!--
  Scenario: queueing, steering and stopping while a turn runs.
  Bo (input only) queues and is refused a steer; Ada (input and control) steers during the tool
  calls, then stops. Bo's queued message then goes out as its own turn.
-->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript"
       name="scenario-queue-and-steer" initial="setup">
  <state id="setup">
    <onentry>
      <send type="stage" event="client.add"><param name="kind" expr="'terminal'"/></send>
      <send type="stage" event="client.add"><param name="kind" expr="'bo'"/></send>
      <send type="stage" event="note">
        <param name="text" expr="'Bo joins. Bo may type, but not steer or stop.'"/>
      </send>
      <send event="next" delay="1s"/>
    </onentry>
    <transition event="next" target="ask"/>
  </state>

  <state id="ask">
    <onentry>
      <send type="stage" event="type">
        <param name="client" expr="'ada'"/>
        <param name="text" expr="'List the files in the workspace and tell me what each one is for.'"/>
      </send>
    </onentry>
    <transition event="host.enter.writing host.enter.calling" target="queue"/>
  </state>

  <state id="queue">
    <onentry>
      <send type="stage" event="note">
        <param name="text" expr="'Bo types while the model is busy: his message waits in his own queue, above his editor. He tries to steer too, but may not: the host refuses, and the text goes back into his editor.'"/>
      </send>
      <send type="stage" event="type">
        <param name="client" expr="'bo'"/>
        <param name="text" expr="'Afterwards, also count the lines of the README.'"/>
      </send>
      <send type="stage" event="type">
        <param name="client" expr="'bo'"/>
        <param name="steer" expr="true"/>
        <param name="text" expr="'Only the markdown files, please.'"/>
      </send>
    </onentry>
    <transition event="host.enter.tools" target="steer"/>
  </state>

  <state id="steer">
    <onentry>
      <send type="stage" event="note">
        <param name="text" expr="'Ada may steer: her steer rides along with the tool results.'"/>
      </send>
      <send type="stage" event="type">
        <param name="client" expr="'ada'"/>
        <param name="steer" expr="true"/>
        <param name="text" expr="'Only the markdown files, please.'"/>
      </send>
    </onentry>
    <transition event="host.enter.writing" target="stop"/>
  </state>

  <state id="stop">
    <onentry>
      <send event="next" delay="600ms"/>
    </onentry>
    <transition event="next" target="stopped">
      <send type="stage" event="note">
        <param name="text" expr="'Ada stops the answer: it is dropped from the history. The host is idle again, so Bo’s queued message goes out as the next turn.'"/>
      </send>
      <send type="stage" event="interrupt"><param name="client" expr="'ada'"/></send>
    </transition>
  </state>

  <!-- the idle right after the stop, then Bo's turn, then idle again -->
  <state id="stopped">
    <transition event="host.enter.turn" target="bo"/>
  </state>
  <state id="bo">
    <transition event="host.enter.idle" target="done"/>
  </state>

  <final id="done">
    <onentry>
      <send type="stage" event="note">
        <param name="text" expr="'Bo’s message got its own turn and its own answer.'"/>
      </send>
    </onentry>
  </final>
</scxml>
`;var ht=`<?xml version="1.0" encoding="UTF-8"?>
<!--
  Scenario: three messages in quick succession. The first starts a turn; the other two wait
  in Ada's own queue. She edits one (back into her editor); the other goes out by itself
  once the host has settled.
-->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript"
       name="scenario-three-in-a-row" initial="spam">
  <state id="spam">
    <onentry>
      <send type="stage" event="note">
        <param name="text" expr="'Ada sends three messages in quick succession. The first starts a turn; the other two wait in her queue, above her editor.'"/>
      </send>
      <send type="stage" event="type">
        <param name="client" expr="'ada'"/>
        <param name="text" expr="'What can you do?'"/>
      </send>
      <send type="stage" event="type">
        <param name="client" expr="'ada'"/>
        <param name="text" expr="'And what can you not do?'"/>
      </send>
      <send type="stage" event="type">
        <param name="client" expr="'ada'"/>
        <param name="text" expr="'Thanks!'"/>
      </send>
      <send event="next" delay="300ms"/>
    </onentry>
    <transition event="next" target="edit"/>
  </state>

  <state id="edit">
    <onentry>
      <send type="stage" event="note">
        <param name="text" expr="'She edits the second one: it leaves the queue and is appended to her editor, so nothing she typed is lost.'"/>
      </send>
      <send type="stage" event="queue.edit">
        <param name="client" expr="'ada'"/>
        <param name="index" expr="0"/>
      </send>
    </onentry>
    <transition event="host.enter.idle" target="next">
      <send type="stage" event="note">
        <param name="text" expr="'The first turn is over. Nothing streams and no tools run, so the next queued message goes out by itself.'"/>
      </send>
    </transition>
  </state>

  <state id="next">
    <transition event="host.enter.idle" target="done"/>
  </state>

  <final id="done">
    <onentry>
      <send type="stage" event="note">
        <param name="text" expr="'Each message got its own turn. The edited one is still in Ada’s editor, waiting for her.'"/>
      </send>
    </onentry>
  </final>
</scxml>
`;var gt=`<?xml version="1.0" encoding="UTF-8"?>
<!--
  llm-chat: the shared WebAssembly workspace behind the real tools. One per tab. The Terminal,
  Python and psql share its filesystem (/workspace); PostgreSQL (PGlite) runs beside it.

  It invokes one package.scxml per package, so every download is a machine of its own (see the
  explorer's System view). Clients ask for what they need; a package already on its way or
  installed is never fetched twice: the second client just waits for the same machine.

  I/O processor type="workspace" (see PROTOCOL.md §5):
    in   need { packages: string[] }        from a client (origin = its id)
    out  workspace.progress { packages }    to a waiting client, when one of its packages changes step
         workspace.ready { packages }       all of its packages are installed
         workspace.failed { key, error }    one failed; the client may ask again (retry)

  The page creates the session with \`data\`: catalog = { key → { label, approxBytes } }.
-->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript"
       name="llm-chat-workspace" initial="open">
  <datamodel>
    <data id="catalog" expr="({})"/>
    <!-- key → the package machine's last status -->
    <data id="packages" expr="({})"/>
    <!-- clientId → { keys: [...], answered: bool } -->
    <data id="clients" expr="({})"/>
    <!-- key → the client that asked first (the others find it "shared") -->
    <data id="firstBy" expr="({})"/>
    <!-- key → last phase told to clients (progress is sent on phase changes, not every byte) -->
    <data id="told" expr="({})"/>
    <!-- whether the last package.changed moved a package to another step -->
    <data id="phaseChanged" expr="false"/>
  </datamodel>

  <script>
    function keysOf(list) { return ["sdk"].concat((list || []).filter(function (k) { return k !== "sdk"; })); }
    function phaseOf(k) { return packages[k] ? packages[k].phase : "waiting"; }
    function view(keys) { return keys.map(function (k) { return packages[k] || { key: k, phase: "waiting" }; }); }
    /** Packages that are waiting for the runtime (to release once it is up). */
    function waitingForRuntime() {
      return Object.keys(packages).filter(function (k) { return k !== "sdk" &amp;&amp; packages[k].needed &amp;&amp; packages[k].phase === "waiting"; });
    }
    /** What to tell which clients now: [{ to, event, data }]. */
    function replies(changedKey, phaseChanged) {
      var out = [];
      for (var id in clients) {
        var c = clients[id];
        if (c.answered || (changedKey &amp;&amp; c.keys.indexOf(changedKey) &lt; 0)) continue;
        var failed = c.keys.filter(function (k) { return phaseOf(k) === "failed"; })[0];
        if (failed) {
          c.answered = true;
          out.push({ to: id, event: "workspace.failed", data: { key: failed, error: packages[failed].error } });
        } else if (c.keys.every(function (k) { return phaseOf(k) === "ready"; })) {
          c.answered = true;
          out.push({ to: id, event: "workspace.ready", data: { packages: view(c.keys) } });
        } else if (phaseChanged) {
          out.push({ to: id, event: "workspace.progress", data: { packages: view(c.keys) } });
        }
      }
      return out;
    }
  </script>

  <state id="open">
    <invoke type="scxml" id="pkg-sdk" src="package.scxml">
      <param name="key" expr="'sdk'"/>
      <param name="label" expr="catalog.sdk.label"/>
      <param name="approxBytes" expr="catalog.sdk.approxBytes"/>
      <param name="needsRuntime" expr="false"/>
    </invoke>
    <invoke type="scxml" id="pkg-bash" src="package.scxml">
      <param name="key" expr="'bash'"/>
      <param name="label" expr="catalog.bash.label"/>
      <param name="approxBytes" expr="catalog.bash.approxBytes"/>
    </invoke>
    <invoke type="scxml" id="pkg-coreutils" src="package.scxml">
      <param name="key" expr="'coreutils'"/>
      <param name="label" expr="catalog.coreutils.label"/>
      <param name="approxBytes" expr="catalog.coreutils.approxBytes"/>
    </invoke>
    <invoke type="scxml" id="pkg-python" src="package.scxml">
      <param name="key" expr="'python'"/>
      <param name="label" expr="catalog.python.label"/>
      <param name="approxBytes" expr="catalog.python.approxBytes"/>
    </invoke>
    <invoke type="scxml" id="pkg-pglite" src="package.scxml">
      <param name="key" expr="'pglite'"/>
      <param name="label" expr="catalog.pglite.label"/>
      <param name="approxBytes" expr="catalog.pglite.approxBytes"/>
    </invoke>
    <invoke type="scxml" id="pkg-psql" src="package.scxml">
      <param name="key" expr="'psql'"/>
      <param name="label" expr="catalog.psql.label"/>
      <param name="approxBytes" expr="catalog.psql.approxBytes"/>
    </invoke>

    <!-- a client needs packages (again, after a failure: that retries them) -->
    <transition event="need">
      <assign location="clients[_event.origin]" expr="({ keys: keysOf(_event.data.packages), answered: false })"/>
      <foreach array="clients[_event.origin].keys" item="k">
        <!-- asked again after a failure: that package starts over (don't answer with the old failure) -->
        <if cond="packages[k] &amp;&amp; packages[k].phase === 'failed'">
          <script>packages[k].phase = "waiting"; told[k] = "waiting";</script>
        </if>
        <if cond="!firstBy[k]">
          <assign location="firstBy[k]" expr="_event.origin"/>
        </if>
        <send targetexpr="'#_pkg-' + k" event="need"/>
      </foreach>
      <!-- the runtime may already be up: release what is waiting for it -->
      <if cond="phaseOf('sdk') === 'ready'">
        <foreach array="clients[_event.origin].keys" item="k">
          <send targetexpr="'#_pkg-' + k" event="runtime.ready"/>
        </foreach>
      </if>
      <foreach array="replies(null, true)" item="r">
        <send type="workspace" targetexpr="r.to" eventexpr="r.event"><content expr="r.data"/></send>
      </foreach>
    </transition>

    <!-- a package machine moved on -->
    <transition event="package.changed">
      <script>
        var k = _event.data.key;
        packages[k] = _event.data.status;
        phaseChanged = told[k] !== packages[k].phase;
        told[k] = packages[k].phase;
      </script>
      <if cond="_event.data.key === 'sdk' &amp;&amp; phaseOf('sdk') === 'ready'">
        <foreach array="waitingForRuntime()" item="k">
          <send targetexpr="'#_pkg-' + k" event="runtime.ready"/>
        </foreach>
      </if>
      <foreach array="replies(_event.data.key, phaseChanged)" item="r">
        <send type="workspace" targetexpr="r.to" eventexpr="r.event"><content expr="r.data"/></send>
      </foreach>
    </transition>
  </state>
</scxml>
`;var le={"README.md":`# Demo workspace

Files for the llm-chat demo.

- notes.md: meeting notes
- orders.csv: last week's orders
- report.py: summarises orders.csv
`,"notes.md":`# Notes

- ship the chat demo
- write the protocol doc
`,"orders.csv":`id,status,total
1,shipped,20
2,pending,35
3,shipped,12
4,cancelled,8
`,"report.py":`import csv
rows = list(csv.DictReader(open('orders.csv')))
print(len(rows), 'orders')
`};function yt(e=le){let s=(o)=>{let i=new RegExp(`^${o.replace(/[.+^${}()|[\]\\]/g,"\\$&").replace(/\*/g,".*").replace(/\?/g,".")}$`);return Object.keys(e).filter((l)=>i.test(l)).sort()},r=(o)=>{let i=e[o.replace(/^(\/workspace\/|\.\/)/,"")];if(i===void 0)throw Error(`${o}: No such file or directory`);return i};return async(o,{clock:i})=>{let l=String(o.command??"").trim();if(/[|;&><`$]/.test(l))throw Error("sh (simulated): pipes, redirects and substitutions aren't simulated; switch Terminal to real");let[p="",...u]=l.split(/\s+/),g=u.filter((h)=>!h.startsWith("-")),f=(h)=>h.flatMap((k)=>/[*?]/.test(k)?s(k):[k]);switch(p){case"ls":return(g.length?f(g):Object.keys(e).sort()).join(`
`);case"cat":return f(g).map(r).join("");case"wc":return f(g).map((k)=>`${r(k).split(`
`).length-1} ${k}`).join(`
`);case"head":return f(g).map((h)=>r(h).split(`
`).slice(0,10).join(`
`)).join(`
`);case"grep":{let[h="",...k]=g;return f(k).flatMap((b)=>r(b).split(`
`).filter((w)=>w.includes(h)).map((w)=>`${b}:${w}`)).join(`
`)}case"echo":return u.join(" ");case"pwd":return"/workspace";case"date":return new Date(i.now()).toUTCString();case"":return"";default:throw Error(`sh (simulated): ${p}: command not found. Simulated: ls, cat, wc, head, grep, echo, pwd, date`)}}}var ft=async(e)=>{let s=String(e.code??"").trim(),r=/^print\((.*)\)$/s.exec(s);if(!r)throw Error("python (simulated): only print(<integer arithmetic>) is simulated; switch Python to real");return`${dn(r[1])}`};function dn(e){let s=e.match(/\*\*|\/\/|\d+|[-+*/%()]|\S/g)??[],r=0,o=()=>s[r],i=(h)=>{let k=s[r++];if(h&&k!==h)throw Error(`python (simulated): expected ${h}`);return k},l=()=>{let h=i();if(h==="("){let k=g();return i(")"),k}if(h==="-")return-p();if(h==="+")return p();if(h&&/^\d+$/.test(h))return BigInt(h);throw Error(`python (simulated): unexpected ${h??"end of input"}`)},p=()=>{let h=l();if(o()==="**")return i(),h**p();return h},u=()=>{let h=p();for(let k=o();k==="*"||k==="/"||k==="//"||k==="%";k=o()){i();let b=p();if(b===0n&&k!=="*")throw Error("ZeroDivisionError: division by zero");h=k==="*"?h*b:k==="%"?(h%b+b)%b:cn(h,b)}return h},g=()=>{let h=u();for(let k=o();k==="+"||k==="-";k=o())i(),h=k==="+"?h+u():h-u();return h},f=g();if(r<s.length)throw Error(`python (simulated): unexpected ${s[r]}`);return f}function cn(e,s){let r=e/s;return e%s!==0n&&e<0n!==s<0n?r-1n:r}var vt=async(e)=>{let s=String(e.query??"").replace(/\s+/g," ").trim().toLowerCase();if(/group by status/.test(s))return` status    | count
-----------+-------
 shipped   |     2
 pending   |     1
 cancelled |     1
(3 rows)`;if(/^select count\(\*\) from orders/.test(s))return` count
-------
     4
(1 row)`;if(/^select \* from orders/.test(s))return` id | status    | total
----+-----------+-------
  1 | shipped   |    20
  2 | pending   |    35
  3 | shipped   |    12
  4 | cancelled |     8
(4 rows)`;throw Error("ERROR (simulated): only a few queries on `orders` are simulated; switch Postgres to real")},kt=async(e)=>{let s=new Q,r=[],o;try{o=await E(String(e.scxml??""),{clock:s,scriptTimeoutMs:500}),o.addEventListener("log",(p)=>r.push(`${p.label??"log"}: ${String(p.value??"")}`));let i=[];o.addEventListener("error",(p)=>i.push(`${p.kind}: ${p.message}`)),o.start(),s.run();let l=[`start → ${o.activeStateIds().join(", ")}`];for(let p of e.events??[])o.send(String(p)),s.run(s.now()+1e4),l.push(`${String(p)} → ${o.activeStateIds().join(", ")}`);return[...l,`status: ${o.status}`,...r,...i].join(`
`)}finally{o?.dispose()}};class Le extends EventTarget{pending=[];#t=0;ask=(e,{signal:s})=>new Promise((r,o)=>{let i={id:++this.#t,question:String(e.question??""),answer:(l)=>{this.#e(i),r(l)}};this.pending.push(i),this.dispatchEvent(new Event("change")),s.addEventListener("abort",()=>{this.#e(i),o(s.reason)})});answer(e){let s=this.pending[0];return s?.answer(e),!!s}#e(e){let s=this.pending.indexOf(e);if(s>=0)this.pending.splice(s,1);this.dispatchEvent(new Event("change"))}}var oe=(e)=>({type:"string",description:e}),ie={ada:{kind:"ada",latencyMs:0,name:"Ada",blurb:"A person: types, steers, stops, and answers questions the model asks her.",wants:["input","control","tools"],tools:[{name:"ask_ada",description:"Ask Ada, a person in this conversation, a question and wait for her answer. Use it for decisions only she can make.",input_schema:{type:"object",properties:{question:oe("The question, in one or two sentences")},required:["question"]}}],implement(){let e=new Le;return{tools:{ask_ada:{simulated:e.ask}},desk:e}}},bo:{kind:"bo",latencyMs:0,name:"Bo",blurb:"A person who may type, but not steer or stop.",wants:["input"],tools:[],implement:()=>({tools:{}})},terminal:{kind:"terminal",latencyMs:400,name:"Terminal",blurb:"A bash shell with a small /workspace: simulated, or real (bash + coreutils in WebAssembly, ≈ 15 MB; the same /workspace as Python and psql).",wants:["tools"],tools:[{name:"shell",description:"Run a shell command in /workspace (bash and coreutils) and return its output. When the other tools run for real, /workspace is shared with them: files written here are visible to the python and sql tools, and `python` and `psql` work here too once they are loaded.",input_schema:{type:"object",properties:{command:oe("The command line")},required:["command"]}}],implement:()=>({tools:{shell:{simulated:yt(),real:()=>(t("bdjw5s01"),import("./chunk-bdjw5s01.js")).then((e)=>e.shellTool)}}})},python:{kind:"python",latencyMs:1500,name:"Python",blurb:"A Python interpreter: simulated (print() of integer arithmetic), or real (Python 3.13 in WebAssembly, ≈ 62 MB, with its own bash; files shared with the Terminal).",wants:["tools"],tools:[{name:"python",description:"Run Python 3 code in /workspace and return what it prints. Files there can be read and written; when the shell tool runs for real it sees the same files.",input_schema:{type:"object",properties:{code:oe("The program")},required:["code"]}}],implement:()=>({tools:{python:{simulated:ft,real:()=>(t("bdjw5s01"),import("./chunk-bdjw5s01.js")).then((e)=>e.pythonTool)}}})},postgres:{kind:"postgres",latencyMs:900,name:"Postgres",blurb:"A PostgreSQL database with an orders table: simulated (a few queries), or real (PGlite + psql in WebAssembly, ≈ 78 MB; psql can \\copy to and from /workspace).",wants:["tools"],tools:[{name:"sql",description:"Run one SQL statement (or a psql command such as \\copy) against a PostgreSQL database with an `orders(id, status, total)` table. psql runs in /workspace, so \\copy can read and write files there.",input_schema:{type:"object",properties:{query:oe("One SQL statement")},required:["query"]}}],implement:()=>({tools:{sql:{simulated:vt,real:()=>(t("bdjw5s01"),import("./chunk-bdjw5s01.js")).then((e)=>e.sqlTool)}}})},lab:{kind:"lab",latencyMs:300,name:"Statechart Lab",blurb:"Runs SCXML statecharts the model writes, in a sandbox, and reports where they end up.",wants:["tools"],tools:[{name:"run_statechart",description:"Run an SCXML statechart (ECMAScript data model) in a sandbox, send it events in order, and report the active states after each.",input_schema:{type:"object",properties:{scxml:oe("The whole <scxml> document"),events:{type:"array",items:{type:"string"},description:"Event names to send, in order"}},required:["scxml"]}}],implement:()=>({tools:{run_statechart:{simulated:kt}}})},viewer:{kind:"viewer",latencyMs:0,name:"Viewer",blurb:"Watches the conversation; can't type.",wants:[],tools:[],implement:()=>({tools:{}})}};class X{static storageKey="llm-chat:anthropic-key";#t=null;constructor(){try{this.#t=localStorage.getItem(X.storageKey)}catch{}}get(){return this.#t}get remembered(){try{return localStorage.getItem(X.storageKey)!==null}catch{return!1}}set(e,s){this.#t=e.trim()||null;try{if(s&&this.#t)localStorage.setItem(X.storageKey,this.#t);else localStorage.removeItem(X.storageKey)}catch{}}forget(){this.set("",!1)}}var Ce="urn:llm-chat:bus",Be="urn:llm-chat:log",Pe="urn:llm-chat:tool",Re="urn:llm-chat:stage",Ae="urn:llm-chat:panel",Oe="urn:llm-chat:workspace";class n extends Error{kind;details;constructor(e,s,r={}){super(s);this.kind=e;this.details=r}get retryable(){return["rate_limit","overloaded","server","network","stream"].includes(this.kind)}}class $e{vault;name="claude";#t=null;constructor(e){this.vault=e}async load(){if(!this.#t){let{ClaudeModel:e}=await (t("25e8dg60"),import("./chunk-25e8dg60.js"));this.#t??=new e(this.vault)}return this.#t}stream(e,s){if(!this.#t)throw new n("auth","Claude isn't loaded yet: set a key first.");return this.#t.stream(e,s)}async check(e){await(await this.load()).check(e)}}class je{clock;type=Ce;aliases=["bus"];latencyMs=0;onControlReply;#t=new Map;#e=new Map;#n=new Set;#s=new Set;#a=new Map;constructor(e){this.clock=e}register(e,s){this.#e.set(s.sessionId,e)}unregister(e){let s=this.#t.get(e);if(s)this.#e.delete(s.sessionId);this.#t.delete(e),this.#n.delete(e),this.#a.delete(e)}setOnline(e,s){if(s)this.#n.delete(e);else this.#n.add(e)}isOnline(e){return!this.#n.has(e)}tap(e){return this.#s.add(e),()=>this.#s.delete(e)}watch(e,s){let r=this.#a.get(e)??new Set;return this.#a.set(e,r),r.add(s),()=>r.delete(s)}location(e){return`${Ce}#${this.#e.get(e.sessionId)??e.sessionId}`}attach(e){let s=this.#e.get(e.sessionId);if(s)this.#t.set(s,e)}detach(e){let s=this.#e.get(e.sessionId);if(s)this.unregister(s)}send(e,s){let r=this.#e.get(s.sessionId);if(!r)throw Error(`bus: session ${s.sessionId} has no address`);this.post(r,e.target,e.event,e.data)}post(e,s,r,o){if(s==="*"){for(let l of this.#t.keys())if(l!=="host")this.post(e,l,r,o);return}let i={at:this.clock.now(),from:e,to:s,event:r,data:o};if(e==="host"&&s==="host"){for(let l of this.#s)l(i);this.clock.setTimeout(()=>this.onControlReply?.(r,o),this.latencyMs);return}if(this.#n.has(e)||this.#n.has(s))i.dropped="offline";else if(!this.#t.has(s))i.dropped="unknown";for(let l of this.#s)l(i);if(i.dropped)return;this.clock.setTimeout(()=>{if(this.#n.has(s))return;let l=this.#t.get(s);if(!l)return;for(let p of this.#a.get(s)??[])p(r,o,e);l.deliver(r,o,e)},this.latencyMs)}fromPanel(e,s,r={}){for(let o of this.#s)o({at:this.clock.now(),from:"ui",to:e,event:s,data:r});this.#t.get(e)?.deliver(s,r,"ui")}fromControl(e,s={}){for(let r of this.#s)r({at:this.clock.now(),from:"host",to:"host",event:e,data:s});this.#t.get("host")?.deliver(e,s,"host")}}function xt({log:e,models:s,system:r}){return(o)=>{let i=new AbortController,l=Number(o.params.request),p=o.params.tools??[],u=s[String(o.params.model)];return(async()=>{if(!u)return{ok:!1,error:{kind:"invalid",retryable:!1,message:`no model ${o.params.model}`}};let f=e.draft(l,u.name),h=u.stream({system:r,messages:e.history(),tools:p.map(({provider:b,...w})=>w)},i.signal);for await(let b of h){if(i.signal.aborted)break;if(f.apply(b),b.type==="content_block_start"){let w=b.content_block;if(w.type==="text"||w.type==="thinking"||w.type==="tool_use")o.sendToParent("llm.block.start",{index:b.index,kind:w.type,name:"name"in w?w.name:void 0})}else if(b.type==="content_block_stop")o.sendToParent("llm.block.stop",{index:b.index,kind:f.kindOf(b.index)})}let k=await h.finalMessage();return f.finish(k),pn(k,p)})().then((f)=>{if(!i.signal.aborted)o.done(f)},(f)=>{if(!i.signal.aborted)o.done({ok:!1,error:mn(f)})}),{send(){},cancel:()=>i.abort()}}}function pn(e,s){let r=e.content.flatMap((l)=>l.type==="tool_use"?[l]:[]),o=e.stop_reason??"end_turn";if(o==="refusal")return{ok:!1,error:{kind:"refusal",retryable:!1,message:"The model declined to continue."}};if(o==="max_tokens"&&r.length)return{ok:!1,error:{kind:"truncated",retryable:!1,message:"A tool call was cut off at the output limit."}};let i=r.map((l)=>{let p=s.find((g)=>g.name===l.name),u=p?un(l.input,p.input_schema):`unknown tool ${l.name}`;return{id:l.id,name:l.name,input:l.input,...u?{invalid:u}:{}}});return{ok:!0,stop:o,toolCalls:i}}function un(e,s){if(typeof e!=="object"||e===null||Array.isArray(e))return"the input is not an object";let r=e;for(let o of s.required??[])if(!(o in r))return`missing "${o}"`;for(let[o,i]of Object.entries(r)){let l=s.properties?.[o];if(!l){if(s.additionalProperties===!1)return`unexpected "${o}"`;continue}let p=Array.isArray(i)?"array":i===null?"null":typeof i,u=l.type==="integer"?"number":l.type;if(u&&p!==u)return`"${o}" should be ${l.type}, not ${p}`}return}function mn(e){if(e instanceof n)return{kind:e.kind,retryable:e.retryable,message:e.message,...e.details};return{kind:"stream",retryable:!0,message:e instanceof Error?e.message:String(e)}}function bt(e){return(s)=>{let r=new AbortController;return e(r.signal).then(()=>r.signal.aborted||s.done({ok:!0}),(o)=>r.signal.aborted||s.done({ok:!1,message:o instanceof Error?o.message:String(o)})),{send(){},cancel:()=>r.abort()}}}class wt{request;model;log;message=null;#t=new Map;constructor(e,s,r){this.request=e;this.model=s;this.log=r;r.append({kind:"assistant.start",request:e,model:s})}apply(e){let{request:s,log:r}=this;switch(e.type){case"content_block_start":{let o=e.content_block;this.#t.set(e.index,o.type),r.append({kind:"block.start",request:s,index:e.index,block:o.type,...o.type==="tool_use"?{name:o.name,id:o.id}:{}});break}case"content_block_delta":{let o=e.delta;if(o.type==="text_delta")r.append({kind:"block.delta",request:s,index:e.index,text:o.text});else if(o.type==="thinking_delta")r.append({kind:"block.delta",request:s,index:e.index,text:o.thinking});else if(o.type==="input_json_delta")r.append({kind:"block.delta",request:s,index:e.index,json:o.partial_json});break}case"content_block_stop":r.append({kind:"block.stop",request:s,index:e.index});break;case"message_delta":r.append({kind:"usage",request:s,input:e.usage.input_tokens??0,output:e.usage.output_tokens,cacheRead:e.usage.cache_read_input_tokens??0});break}}kindOf(e){return this.#t.get(e)??"unknown"}finish(e){this.message=e}}class He{clock;bus;type=Be;aliases=["log"];batchMs=50;entries=[];#t=[];#e=new Map;#n=-1;#s=null;#a=new Set;constructor(e,s){this.clock=e;this.bus=s}get seq(){return this.entries.length}history(){return this.#t.slice()}subscribe(e){return this.#a.add(e),()=>this.#a.delete(e)}append(e){let s={...e,seq:this.entries.length+1,at:this.clock.now()};this.entries.push(s);for(let r of this.#a)r(s);if(this.#n<0)this.#n=s.seq-1;return this.#s??=this.clock.setTimeout(()=>this.flush(),this.batchMs),s}flush(){if(this.#s!==null)this.clock.clearTimeout(this.#s);if(this.#s=null,this.#n<0)return;let e=this.entries.slice(this.#n);this.#n=-1,this.bus.post("host","*","log.batch",{first:e[0].seq,last:e.at(-1).seq,entries:e})}draft(e,s){let r=new wt(e,s,this);return this.#e.set(e,r),r}state(e){this.append({kind:"state",configuration:e})}location(){return Be}send(e,s){let r=e.data??{};switch(e.event){case"user.append":{let o=r.entries;if(!o.length)return;this.#t.push({role:"user",content:o.map((i)=>({type:"text",text:`[${i.author}] ${i.text}`}))}),this.append({kind:"user",turn:r.turn,entries:o});return}case"assistant.commit":{let o=r.request,i=this.#e.get(o);if(!i?.message)throw Error(`log: no finished draft for request ${o}`);this.#t.push({role:"assistant",content:i.message.content}),this.#e.delete(o),this.append({kind:"assistant.commit",request:o,stop:String(r.stop)});return}case"assistant.discard":{let o=r.request;this.#e.delete(o),this.append({kind:"assistant.discard",request:o,reason:String(r.reason??"")});return}case"tools.dispatched":{let o=r.calls;this.append({kind:"tools",request:r.request,calls:o.map(({id:i,name:l,provider:p})=>({id:i,name:l,provider:p}))});return}case"tools.timer":this.append({kind:"timer",request:r.request,ms:Number(r.ms)});return;case"tool.results":{let o=r.results,i=r.steers??[],l=this.#r(),p=[...o].sort((u,g)=>l.indexOf(u.callId)-l.indexOf(g.callId));this.#t.push({role:"user",content:[...p.map((u)=>({type:"tool_result",tool_use_id:u.callId,is_error:u.isError,content:u.content})),...i.map((u)=>({type:"text",text:`[${u.author}] ${u.text}`}))]}),this.append({kind:"tool.results",request:r.request,results:p,steers:i});return}case"queue.changed":this.append({kind:"steers",steers:r.steers});return;case"roster.changed":this.append({kind:"roster",clients:r.clients});return;case"notice":this.append({kind:"notice",level:r.level,text:String(r.text)});return;case"snapshot.send":this.flush(),this.bus.post("host",r.to,"snapshot",{seq:this.seq,entries:this.entries.slice()});return;default:throw Error(`log: unknown command ${e.event}`)}}#r(){let e=this.#t.at(-1);if(!e||e.role!=="assistant"||typeof e.content==="string")return[];return e.content.flatMap((s)=>s.type==="tool_use"?[s.id]:[])}}var hn=`<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="red">
  <state id="red"><transition event="timer" target="green"/></state>
  <state id="green"><transition event="timer" target="yellow"/></state>
  <state id="yellow"><transition event="timer" target="red"/></state>
</scxml>`,gn=[{tool:"shell",when:/\b(files?|workspace|ls|folder|directory|shell|terminal|readme|lines)\b/i,input:(e)=>({command:/\blines?\b/i.test(e)?"wc -l README.md":/markdown|\.md\b/i.test(e)?"ls *.md":"ls"})},{tool:"python",when:/\b(python|compute|calculate)\b|\d\s*\*\*\s*\d/i,input:(e)=>({code:`print(${yn(e)??"2**64"})`})},{tool:"sql",when:/\b(sql|database|postgres|orders?|table)\b/i,input:()=>({query:"SELECT status, count(*) FROM orders GROUP BY status ORDER BY 2 DESC;"})},{tool:"run_statechart",when:/\b(statecharts?|state machines?|scxml|traffic light)\b/i,input:()=>({scxml:hn,events:["timer","timer"]})},{tool:"ask_ada",when:/\b(ask ada|check with ada|confirm|approve)\b/i,input:()=>({question:"Should I go ahead with this?"})}];function yn(e){return(e.match(/[\d(][\d\s+\-*/%().]*[\d)]/g)??[]).filter((r)=>/[+\-*/%]/.test(r)).sort((r,o)=>o.length-r.length)[0]?.trim()}class De{clock;name="simulated";timeToFirstTokenMs=400;tokensPerSecond=40;#t=[];#e=0;constructor(e){this.clock=e}fault(e){this.#t.push(e)}stream(e,s){let r=this.plan(e),o=this.#t.shift(),i,l,p=new Promise((g,f)=>{i=g,l=f});p.catch(()=>{});let u=this.#s(r,o,s,i,l);return{[Symbol.asyncIterator]:()=>u,finalMessage:()=>p}}plan({messages:e,tools:s}){let r=e.at(-1);if(ye(r).filter((f)=>f.type==="tool_result").length)return{blocks:[{type:"text",text:this.#n(e)}],stop:"end_turn"};let i=fn(e),l=new Set(s.map((f)=>f.name)),p=gn.filter((f)=>l.has(f.tool)&&f.when.test(i.text));if(p.length){let f=p.map((h)=>h.tool).join(" and ");return{blocks:[{type:"text",text:p.length>1?`I'll run ${f} at the same time.`:`Let me use ${f}.`},...p.map((h)=>({type:"tool_use",id:`toolu_sim_${++this.#e}`,name:h.tool,input:h.input(i.text)}))],stop:"tool_use"}}let u=[...l].filter((f)=>f!=="ask_ada"),g=u.length?`Try asking about ${u.map(vn).join(", ")}${l.has("ask_ada")?", or to check with Ada":""}.`:"Add Terminal, Python, Postgres or Statechart Lab with “Add client”, then ask about files, arithmetic, the orders table or a statechart; they each bring a tool.";return{blocks:[{type:"text",text:`(Simulated answer for ${i.authors.join(" and ")||"you"}.) You said: “${i.text}”. ${g}`}],stop:"end_turn"}}#n(e){let s=new Map;for(let l of ye(e.at(-2)))if(l.type==="tool_use")s.set(l.id,l.name);let r=["Here is what came back:"],o=ye(e.at(-1));for(let l of o){if(l.type!=="tool_result")continue;let u=(typeof l.content==="string"?l.content:JSON.stringify(l.content)).split(`
`).slice(0,3).join(" · ").slice(0,160);r.push(`- ${s.get(l.tool_use_id)??"a tool"}${l.is_error?" failed":""}: ${u}`)}let i=o.filter((l)=>l.type==="text");for(let l of i)if(l.type==="text")r.push(`Noted: ${l.text.replace(/[.!?]$/,"")}. I'll keep that in mind.`);return r.join(`
`)}async*#s(e,s,r,o,i){let l=1000/this.tokensPerSecond,p=0;try{if(await this.#a(this.timeToFirstTokenMs,r),s?.kind==="hang")await this.#a(Number.POSITIVE_INFINITY,r);if(s?.kind==="rate_limit")throw new n("rate_limit","429 rate limited (simulated)",{status:429,retryAfterMs:s.retryAfterMs??2000});if(s?.kind==="overloaded")throw new n("overloaded","529 overloaded (simulated)",{status:529});let u=`msg_sim_${++this.#e}`;yield N({type:"message_start",message:St(u,[],null,0)});let g=[],f=e.stop;for(let[h,k]of e.blocks.entries()){if(k.type==="text"){yield N({type:"content_block_start",index:h,content_block:{type:"text",text:"",citations:null}});let b="",w=k.text.split(/(?<=\s)/);for(let[M,B]of w.entries()){if(await this.#a(l,r),s?.kind==="stream"&&M===Math.floor(w.length/2))throw new n("stream","the stream broke off (simulated)");if((s?.kind==="max_tokens"||s?.kind==="refusal")&&M===Math.floor(w.length/2)){f=s.kind;break}b+=B,p++,yield N({type:"content_block_delta",index:h,delta:{type:"text_delta",text:B}})}g.push({type:"text",text:b}),yield N({type:"content_block_stop",index:h})}else{yield N({type:"content_block_start",index:h,content_block:{type:"tool_use",id:k.id,name:k.name,input:{}}});let b=JSON.stringify(k.input);for(let w=0;w<b.length;w+=16)await this.#a(l,r),p++,yield N({type:"content_block_delta",index:h,delta:{type:"input_json_delta",partial_json:b.slice(w,w+16)}});g.push(k),yield N({type:"content_block_stop",index:h})}if(f!==e.stop)break}yield N({type:"message_delta",delta:{stop_reason:f,stop_sequence:null},usage:It(p)}),yield N({type:"message_stop"}),o(St(u,g,f,p))}catch(u){throw i(u),u}}#a(e,s){return new Promise((r,o)=>{if(s.aborted)return o(new n("stream","aborted"));let i=Number.isFinite(e)?this.clock.setTimeout(r,e):null;s.addEventListener("abort",()=>{if(i!==null)this.clock.clearTimeout(i);o(new n("stream","aborted"))},{once:!0})})}}function Et(e){return["rate_limit","overloaded","stream","max_tokens","refusal","hang"].includes(e)}function ye(e){if(!e)return[];let{content:s}=e;return typeof s==="string"?[{type:"text",text:s}]:s}function fn(e){let s=[],r=new Set;for(let o=e.length-1;o>=0&&e[o].role==="user";o--)for(let i of ye(e[o]).reverse()){if(i.type!=="text")continue;let l=/^\[([^\]]+)\]\s*(.*)$/s.exec(i.text);if(l)r.add(l[1]);s.unshift(l?l[2]:i.text)}return{text:s.join(" "),authors:[...r].reverse()}}function vn(e){return{shell:"files",python:"arithmetic",sql:"the orders table",run_statechart:"a statechart",ask_ada:"asking Ada"}[e]??e}function N(e){return e}function It(e){return{input_tokens:0,output_tokens:e,cache_read_input_tokens:0,cache_creation_input_tokens:0}}function St(e,s,r,o){return{id:e,type:"message",role:"assistant",model:"simulated",content:s.map((i)=>i.type==="text"?{...i,citations:null}:i),stop_reason:r,stop_sequence:null,usage:It(o)}}var v={bash:{id:"wasmer/bash@=1.0.25",label:"bash",approxBytes:1870786},coreutils:{id:"wasmer/coreutils@=1.0.27",label:"coreutils",approxBytes:12703522},python:{id:"python/python@=3.13.20",label:"Python 3.13",approxBytes:61744083},pglite:{id:"wasmer/pglite@=0.1.3",label:"PostgreSQL (PGlite)",approxBytes:76919536},psql:{id:"wasmer/psql@=18.4.0",label:"psql",approxBytes:1065711}},F={id:"@wasmer/sdk",label:"Wasmer runtime",approxBytes:4951977},Y={shell:["bash","coreutils"],python:["bash","coreutils","python"],sql:["pglite","psql"]};function _t(e){return[F,...(Y[e]??[]).flatMap((r)=>v[r]?[v[r]]:[])].map((r)=>({...r,phase:"waiting",cached:!1,shared:!1,downloadedBytes:0,totalBytes:null,percent:null}))}function j(e){return e>=1048576?`${(e/1048576).toFixed(e>=10485760?0:1)} MB`:`${Math.max(1,Math.round(e/1024))} KB`}function qt(){let e={sdk:{label:F.label,approxBytes:F.approxBytes}};for(let[s,r]of Object.entries(v))e[s]={label:r.label,approxBytes:r.approxBytes};return e}var K=16384;class Fe extends EventTarget{clock;tools;type=Pe;aliases=["tool"];knobs=new Map;link=null;#t=null;#e=new Map;#n=new Map;constructor(e,s,r=600){super();this.clock=e;this.tools=s;for(let o of Object.keys(s))this.knobs.set(o,{latencyMs:r,failNext:!1,hang:!1})}get mode(){return this.link?.mode()??"simulated"}get hasReal(){return Object.values(this.tools).some((e)=>e.real)}setMode(e){let s=Object.keys(this.tools).some((r)=>this.realState(r).status==="failed");this.link?.request(e==="real"&&s?"retry":e)}realState(e){return this.link?.state(e)??{status:"idle"}}changed(){this.dispatchEvent(new Event("change"))}get running(){return[...this.#e.keys()]}location(){return Pe}attach(e){this.#t=e}detach(){for(let e of this.#e.values())e.abort();this.#e.clear(),this.#t=null}send(e){let s=e.data;if(e.event==="run")this.#s(s.callId,String(s.name),s.input??{},!!s.real);else if(e.event==="cancel")this.#e.get(s.callId)?.abort();else throw Error(`tool runtime: unknown message ${e.event}`)}async#s(e,s,r,o){let i=new AbortController;this.#e.set(e,i);let{signal:l}=i;try{let p=await this.invoke(s,r,l,o);if(!l.aborted)this.#t?.deliver("tool.done",{callId:e,isError:!1,content:p})}catch(p){if(!l.aborted)this.#t?.deliver("tool.done",{callId:e,isError:!0,content:p instanceof Error?p.message:String(p)})}finally{this.#e.delete(e)}}async invoke(e,s,r=new AbortController().signal,o=this.mode==="real"){let i=this.knobs.get(e)??{latencyMs:0,failNext:!1,hang:!1},l=this.tools[e];if(!l)throw Error(`no tool ${e}`);let p=o&&l.real;if(!p)await Mt(this.clock,i.latencyMs,r);if(i.hang)await Mt(this.clock,Number.POSITIVE_INFINITY,r);if(i.failNext)throw i.failNext=!1,this.changed(),Error("failed (“fail next call” was set)");let g=await(p?await this.#a(e,p):l.simulated)(s,{signal:r,clock:this.clock});return g.length>K?`${g.slice(0,K)}
… (${g.length-K} more characters cut)`:g}#a(e,s){let r=this.#n.get(e);if(!r)r=s(),r.catch(()=>this.#n.delete(e)),this.#n.set(e,r);return r}}function Mt(e,s,r){return new Promise((o,i)=>{if(r.aborted)return i(r.reason);let l=Number.isFinite(s)?e.setTimeout(o,s):null;r.addEventListener("abort",()=>{if(l!==null)e.clearTimeout(l);i(r.reason)},{once:!0})})}class fe extends EventTarget{seq=0;items=[];steers=[];roster=[];configuration=[];usage={input:0,output:0,cacheRead:0};receive(e,s){if(e==="snapshot"){let r=s;this.#t(),this.#n(r.entries),this.seq=r.seq}else if(e==="log.batch"){let r=s;if(r.last<=this.seq)return!0;if(r.first>this.seq+1)return!1;this.#n(r.entries.filter((o)=>o.seq>this.seq))}else return!0;return this.dispatchEvent(new Event("change")),!0}append(e){this.#n([e]),this.dispatchEvent(new Event("change"))}text(){return this.items.map((e)=>{switch(e.type){case"user":return`${e.steer?"steer":"user"} [${e.author}] ${e.text}`;case"assistant":return`assistant(${e.status}) ${e.blocks.map((s)=>s.kind==="tool_use"?`<${s.name}>`:s.text).join(" | ")}`;case"tools":return`tools ${e.calls.map((s)=>`${s.name}@${s.provider??"-"}:${s.status}`).join(", ")}`;default:return`notice(${e.level}) ${e.text}`}}).join(`
`)}#t(){this.seq=0,this.items=[],this.steers=[],this.roster=[],this.configuration=[],this.usage={input:0,output:0,cacheRead:0}}#e(e){for(let s=this.items.length-1;s>=0;s--){let r=this.items[s];if(r.type==="assistant"&&r.request===e)return r}return}#n(e){for(let s of e)switch(this.seq=s.seq,s.kind){case"user":for(let r of s.entries)this.items.push({type:"user",author:r.author,text:r.text,steer:!1});break;case"assistant.start":this.items.push({type:"assistant",request:s.request,model:s.model,blocks:[],status:"streaming"});break;case"block.start":this.#e(s.request)?.blocks.splice(s.index,0,{kind:s.block,text:"",...s.name?{name:s.name}:{},...s.id?{id:s.id}:{}});break;case"block.delta":{let r=this.#e(s.request)?.blocks[s.index];if(r&&s.text)r.text+=s.text;if(r&&s.json)r.json=(r.json??"")+s.json;break}case"assistant.commit":{let r=this.#e(s.request);if(r)r.status="committed";break}case"assistant.discard":{let r=this.#e(s.request);if(r)r.status="discarded",r.note=s.reason;break}case"tools":this.items.push({type:"tools",request:s.request,calls:s.calls.map((r)=>({...r,status:"running"}))});break;case"timer":{let r=this.items.findLast((o)=>o.type==="tools"&&o.request===s.request);if(r?.type==="tools")r.armedAt=s.at,r.deadline=s.at+s.ms;break}case"tool.results":{let r=this.items.findLast((o)=>o.type==="tools"&&o.request===s.request);if(r?.type==="tools")for(let o of s.results){let i=r.calls.find((l)=>l.id===o.callId);if(i)Object.assign(i,{status:o.isError?"failed":"done",content:o.content})}for(let o of s.steers)this.items.push({type:"user",author:o.author,text:o.text,steer:!0});break}case"steers":this.steers=s.steers;break;case"roster":this.roster=s.clients;break;case"notice":this.items.push({type:"notice",level:s.level,text:s.text});break;case"state":this.configuration=s.configuration;break;case"usage":this.usage.input+=s.input,this.usage.output+=s.output,this.usage.cacheRead+=s.cacheRead;break;case"block.stop":break}}}class Ne{type=Oe;aliases=["workspace"];#t=new Map;#e=new Map;#n=new Set;register(e,s){this.#t.set(s.sessionId,e)}tap(e){return this.#n.add(e),()=>this.#n.delete(e)}location(e){return`${Oe}#${this.#t.get(e.sessionId)??e.sessionId}`}attach(e){let s=this.#t.get(e.sessionId);if(s)this.#e.set(s,e)}detach(e){let s=this.#t.get(e.sessionId);if(s&&this.#e.get(s)===e)this.#e.delete(s)}send(e,s){let r=this.#t.get(s.sessionId);if(!r)throw Error(`workspace link: session ${s.sessionId} has no address`);let o={from:r,to:e.target,event:e.event,data:e.data};for(let i of this.#n)i(o);this.#e.get(e.target)?.deliver(e.event,e.data,r)}}function kn(e){return(s)=>{let r=new AbortController,o=!1;return e(String(s.params.key),{signal:r.signal,onProgress:(i)=>{if(o||=i.cached,!r.signal.aborted)s.sendToParent("package.progress",{phase:i.phase,downloadedBytes:i.downloadedBytes,totalBytes:i.totalBytes,percent:i.percent,cached:i.cached})}}).then(()=>r.signal.aborted||s.done({ok:!0,cached:o}),(i)=>r.signal.aborted||s.done({ok:!1,error:i instanceof Error?i.message:String(i)})),{send(){},cancel:()=>r.abort()}}}var xn=(e,s)=>(t("bdjw5s01"),import("./chunk-bdjw5s01.js")).then((r)=>r.loadPackage(e,s));function bn(e){return{type:Ae,aliases:["panel"],location:()=>Ae,send:(s)=>{if(s.event!=="restore")throw Error(`panel: unknown message ${s.event}`);e.dispatchEvent(new CustomEvent("restore",{detail:String(s.data.text??"")}))}}}var wn=`You are the assistant in a group chat. Several people may write; each message starts with the author's name in brackets.
Tools are provided by other participants and may come and go between turns. When several tool calls are independent, make them in the same response so they run in parallel.
Keep answers short.`;class ve extends EventTarget{clock;bus;log;sim;hostView=new fe;clients=new Map;host;workspace;workspaceLink=new Ne;director=null;notes=[];#t;constructor(e){super();this.#t=e,this.clock=e.clock,this.bus=new je(e.clock),this.log=new He(e.clock,this.bus),this.sim=new De(e.clock),this.log.subscribe((s)=>this.hostView.append(s))}static async create(e){let s=new ve(e);return await s.#e(),await s.#s(),s}async#e(){let{engine:e,charts:s,clock:r,domParser:o}=this.#t;this.workspace=await e(s.workspace,{clock:r,...o?{domParser:o}:{},ioprocessors:[this.workspaceLink],invokers:{"wasm-package":kn(this.#t.packageLoader??xn)},loader:(i)=>{if(i!=="package.scxml")throw Error(`workspace: no chart ${i}`);return s.package},data:{catalog:qt()}}),this.workspaceLink.register("workspace",this.workspace),this.workspace.addEventListener("macrostep",()=>{for(let i of this.clients.values())i.runtime.changed()}),this.workspace.start()}#n(e,s){let r=e.session,o=r.isActive("real-loading")?"loading":r.isActive("real-ready")?"ready":r.isActive("real-failed")?"failed":"idle",i=this.workspace.datamodel.evaluate("packages")??{},l=this.workspace.datamodel.evaluate("firstBy")??{},p=["sdk",...Y[s]??[]],u=_t(s).map((h,k)=>{let b=p[k],w=i[b];if(!w||o==="idle")return h;let M=w.phase??"waiting";return{...h,phase:M,cached:!!w.cached,shared:M==="ready"&&!!l[b]&&l[b]!==e.id,downloadedBytes:w.downloadedBytes??0,totalBytes:w.totalBytes??null,percent:w.percent??null}}),f=p.map((h)=>i[h]).find((h)=>h?.phase==="failed")?.error??r.datamodel.evaluate("toolsError");return{status:o,packages:u,...o==="failed"&&f?{error:String(f)}:{}}}async#s(){let{engine:e,charts:s,clock:r,domParser:o,claude:i}=this.#t,l={simulated:this.sim,...i?{claude:i}:{}};this.host=await e(s.host,{clock:r,...o?{domParser:o}:{},ioprocessors:[this.bus,this.log],invokers:{llm:xt({log:this.log,models:l,system:this.#t.system??wn}),"key-check":bt((u)=>i?i.check(u):Promise.reject(Error("Claude isn't loaded")))}}),this.bus.register("host",this.host);let p="";this.host.addEventListener("macrostep",()=>{let u=this.host.activeStateIds(),g=u.join(" ");if(g!==p)this.log.state(u);p=g}),this.host.addEventListener("microstep",(u)=>{for(let g of u.entered)this.#a(`host.enter.${g.id}`)}),this.host.start()}async addClient(e,s){let r=ie[e];if(!r)throw Error(`unknown client kind ${e}`);let o=e;for(let L=2;this.clients.has(o);L++)o=`${e}-${L}`;let{engine:i,charts:l,clock:p,domParser:u}=this.#t,{tools:g,desk:f}=r.implement(p),h=new Fe(p,g,r.latencyMs),k=new EventTarget,b=(s??r.name).replace(/[<>&"]/g,""),w=l.client.replace('name="llm-chat-client"',`name="llm-chat-client · ${b}"`),M=await i(w,{clock:p,...u?{domParser:u}:{},ioprocessors:[this.bus,h,bn(k),this.workspaceLink],data:{clientId:o,name:s??r.name,kind:e,wants:r.wants,tools:r.tools,needs:Sn(g)}});this.workspaceLink.register(o,M),h.link={mode:()=>M.isActive("real")?"real":"simulated",request:(L)=>this.bus.fromPanel(o,`ui.tools.${L}`),state:(L)=>this.#n({id:o,session:M},L)},M.addEventListener("macrostep",()=>h.changed());let B=new fe;this.bus.register(o,M),this.bus.watch(o,(L,A)=>B.receive(L,A)),M.addEventListener("microstep",(L)=>{for(let A of L.entered)this.#a(`client.${o}.enter.${A.id}`)});let z={id:o,kind:e,name:s??r.name,session:M,runtime:h,view:B,panel:k,...f?{desk:f}:{}};return this.clients.set(o,z),M.start(),this.dispatchEvent(new Event("clients")),z}removeClient(e){let s=this.clients.get(e);if(!s)return;this.bus.fromPanel(e,"ui.leave"),this.clock.setTimeout(()=>{this.bus.unregister(e),this.clients.delete(e),this.dispatchEvent(new Event("clients")),s.session.dispose()},this.bus.latencyMs+1)}setOnline(e,s){this.bus.setOnline(e,s),this.bus.fromPanel(e,s?"ui.online":"ui.offline")}type(e,s,r=!1){this.bus.fromPanel(e,r?"ui.steer":"ui.submit",{text:s})}interrupt(e){this.bus.fromPanel(e,"ui.interrupt")}queueOf(e){let s=this.clients.get(e);return s?s.session.datamodel.evaluate("queue")??[]:[]}removeQueued(e,s){this.bus.fromPanel(e,"ui.queue.remove",{id:s})}editQueued(e,s){this.bus.fromPanel(e,"ui.queue.edit",{id:s})}control(e,s={}){this.bus.fromControl(e,s)}async runScenario(e){this.director?.dispose();let{engine:s,clock:r,domParser:o}=this.#t;return this.director=await s(e,{clock:r,...o?{domParser:o}:{},ioprocessors:[this.#l()]}),this.director.start(),this.director}#a(e){this.#r?.deliver(e,void 0,"stage")}#r=null;#l(){return{type:Re,aliases:["stage"],location:()=>Re,attach:(e)=>{this.#r=e},detach:()=>{this.#r=null},send:(e)=>this.#p(e.event,e.data??{})}}#p(e,s){let r=String(s.client??"");switch(e){case"note":this.notes.push(String(s.text)),this.dispatchEvent(new CustomEvent("note",{detail:String(s.text)}));return;case"client.add":this.addClient(String(s.kind),s.name===void 0?void 0:String(s.name));return;case"client.remove":this.removeClient(r);return;case"client.offline":this.setOnline(r,!1);return;case"client.online":this.setOnline(r,!0);return;case"type":this.type(r,String(s.text),!!s.steer);return;case"interrupt":this.interrupt(r);return;case"queue.edit":case"queue.remove":{let o=this.queueOf(r)[Number(s.index??0)];if(!o)throw Error(`stage: ${r} has nothing queued at ${s.index}`);if(e==="queue.edit")this.editQueued(r,o.id);else this.removeQueued(r,o.id);return}case"answer":this.clients.get(r)?.desk?.answer(String(s.text));return;case"sim.fault":if(!Et(String(s.kind)))throw Error(`stage: unknown fault ${s.kind}`);this.sim.fault(s);return;case"sim.tool":{let o=this.clients.get(r)?.runtime.knobs.get(String(s.tool));if(!o)throw Error(`stage: ${r} has no tool ${s.tool}`);Object.assign(o,En(s,["latencyMs","failNext","hang"]));return}default:throw Error(`stage: unknown message ${e}`)}}dispose(){this.director?.dispose(),this.workspace?.dispose();for(let e of this.clients.values())e.session.dispose();this.host.dispose()}}function Sn(e){let s=Object.entries(e).flatMap(([r,o])=>o.real?Y[r]??[]:[]);return[...new Set(s)]}function En(e,s){return Object.fromEntries(s.filter((r)=>(r in e)).map((r)=>[r,e[r]]))}var Tt=[["path",{d:"m5 12 7-7 7 7"}],["path",{d:"M12 19V5"}]];var Lt=[["path",{d:"m15 10 5 5-5 5"}],["path",{d:"M4 4v7a4 4 0 0 0 4 4h12"}]];var Ct=[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}],["path",{d:"m15 5 4 4"}]];var Bt=[["path",{d:"M10 11v6"}],["path",{d:"M14 11v6"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"}],["path",{d:"M3 6h18"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}]];var ke=(e)=>{let s=q(e,{width:16,height:16,"stroke-width":2});return s.setAttribute("aria-hidden","true"),s},In=`
:host {
  display: block;
  position: relative;
  min-width: 0;
  --cp-surface: var(--surface-1, #fff);
  --cp-raised: var(--surface-2, #f4f4f4);
  --cp-border: var(--border-2, #ccc);
  --cp-fg: var(--fg-1, #111);
  --cp-muted: var(--fg-2, #555);
  --cp-accent: var(--accent, #2b6);
  --cp-on-accent: var(--fg-on-accent, #fff);
  --cp-radius: 12px;
  font: var(--type-body-sm, 14px/1.5 system-ui, sans-serif);
  color: var(--cp-fg);
}
.box {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 6px;
  padding: 10px 10px 8px 14px;
  background: var(--cp-surface);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.box:focus-within {
  border-color: var(--border-strong, var(--cp-muted));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--cp-accent) 18%, transparent);
}
::slotted(textarea) {
  display: block;
}
.bar {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
/* whole shortcuts only: the element drops the ones that don't fit (no ellipsis) */
.hint {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--fg-3, var(--cp-muted));
  white-space: nowrap;
  overflow: hidden;
}
button {
  display: inline-grid;
  place-items: center;
  border: 0;
  cursor: pointer;
  font: inherit;
  color: inherit;
  background: transparent;
}
button:focus-visible {
  outline: 2px solid var(--focus-ring, var(--cp-accent));
  outline-offset: 2px;
}
button:disabled {
  cursor: default;
  opacity: 0.4;
}
.steer {
  height: 30px;
  padding: 0 10px;
  gap: 4px;
  grid-auto-flow: column;
  border-radius: 999px;
  font-size: 12px;
  color: var(--cp-muted);
  border: 1px solid var(--cp-border);
}
.steer:not(:disabled):hover {
  color: var(--cp-fg);
  border-color: var(--cp-muted);
}
.primary {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  color: var(--cp-on-accent);
  background: var(--cp-accent);
}
.primary[data-mode="stop"] {
  color: var(--cp-surface);
  background: var(--cp-fg);
}
.primary[data-mode="stop"] svg {
  fill: currentColor;
  width: 12px;
  height: 12px;
}
.status {
  margin: 6px 2px 0;
  font-size: 12px;
  color: var(--cp-muted);
}
.status:empty {
  display: none;
}

/* ── the queue, flying out above the editor ── */
/* attached to the top of the editor, in the flow: it never covers the conversation above */
.queue {
  position: relative;
  margin: 0 12px -1px;
  padding: 6px;
  background: var(--cp-raised);
  border: 1px solid var(--cp-border);
  border-bottom: 0;
  border-radius: var(--cp-radius) var(--cp-radius) 0 0;
  box-shadow: 0 -6px 18px rgb(0 0 0 / 0.07);
  transform-origin: bottom center;
  animation: fly 160ms ease-out;
}
.queue[hidden] {
  display: none;
}
@keyframes fly {
  from {
    opacity: 0;
    transform: translateY(8px) scaleY(0.96);
  }
}
@media (prefers-reduced-motion: reduce) {
  .queue {
    animation: none;
  }
}
.queue-head {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  align-items: baseline;
  padding: 2px 6px 6px;
  font: var(--type-label, 600 11px/1 ui-monospace, monospace);
  color: var(--cp-muted);
}
ol {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 2px;
  max-height: 9.5em;
  overflow-y: auto;
}
li {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 5px 6px;
  border-radius: 8px;
}
li:hover,
li:focus-within {
  background: color-mix(in srgb, var(--cp-fg) 6%, transparent);
}
li .n {
  flex: none;
  min-width: 1.4em;
  font: var(--type-label, 600 11px/1.6 ui-monospace, monospace);
  color: var(--cp-muted);
}
li .text {
  flex: 1;
  min-width: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
li .actions {
  flex: none;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 100ms ease;
}
li:hover .actions,
li:focus-within .actions {
  opacity: 1;
}
@media (hover: none) {
  li .actions {
    opacity: 1;
  }
}
li .actions button {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  color: var(--cp-muted);
}
li .actions button:hover {
  color: var(--cp-fg);
  background: color-mix(in srgb, var(--cp-fg) 8%, transparent);
}
li .actions button.remove:hover {
  color: var(--state-error, #c33);
}

/* phones and touch screens: 44px targets, and the hint (keyboard shortcuts) out of the way */
@media (max-width: 999px), (pointer: coarse) {
  .primary {
    width: 44px;
    height: 44px;
  }
  .steer {
    height: 44px;
    padding: 0 14px;
  }
  li {
    align-items: center;
  }
  li .actions button {
    width: 44px;
    height: 44px;
  }
}
@media (pointer: coarse) {
  .hint {
    visibility: hidden;
  }
}
`,_n=`
chat-prompt > textarea.cp-editor {
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-height: 1.5em;
  max-height: 12em;
  margin: 0;
  resize: none;
  border: 0;
  border-radius: 0;
  outline: 0;
  box-shadow: none;
  padding: 2px 0;
  background: transparent;
  color: var(--fg-1, #111);
  font: var(--type-body-sm, 14px/1.5 system-ui, sans-serif);
  line-height: 1.5;
  field-sizing: content;
}
chat-prompt > textarea.cp-editor::placeholder {
  color: var(--fg-3, var(--fg-2, #555));
}
chat-prompt > textarea.cp-editor:disabled {
  cursor: not-allowed;
}
@media (max-width: 999px), (pointer: coarse) {
  chat-prompt > textarea.cp-editor {
    font-size: 16px; /* no zoom-on-focus on iOS */
  }
}
`;function qn(){if(document.querySelector("style[data-chat-prompt]"))return;let e=document.createElement("style");e.dataset.chatPrompt="",e.textContent=_n,document.head.append(e)}class Pt extends HTMLElement{static observedAttributes=["placeholder","label"];#t;#e;#n;#s;#a;#r;#l;#p;#u;#g=new Map;#o=[];#d=!1;#m=!1;#h=!1;constructor(){super();this.#t=this.attachShadow({mode:"open"});let e=document.createElement("style");e.textContent=In,this.#l=T("section",{class:"queue",hidden:"","aria-label":"Queued messages"}),this.#p=T("span"),this.#u=T("ol"),this.#l.append(T("div",{class:"queue-head"},T("span",{},"Queued · sent one by one, when the model is done"),this.#p),this.#u),this.#e=T("textarea",{rows:"1",class:"cp-editor",slot:"editor"}),this.#s=T("button",{type:"button",class:"steer",title:"Steer: sent now, reaches the model at its next step (⌘/Ctrl+⏎)"},ke(Lt),"Steer"),this.#n=T("button",{type:"button",class:"primary"}),this.#a=T("span",{class:"hint"}),this.#r=T("p",{class:"status",role:"status"});let s=T("div",{class:"box"},T("slot",{name:"editor"}),T("div",{class:"bar"},this.#a,this.#s,this.#n));s.addEventListener("pointerdown",(r)=>{if(r.target===s)r.preventDefault(),this.#e.focus()}),this.#t.append(e,this.#l,s,this.#r),this.#e.addEventListener("input",()=>this.#i()),this.#e.addEventListener("keydown",(r)=>this.#k(r)),this.#n.addEventListener("click",()=>this.#n.dataset.mode==="stop"?this.#c("prompt-stop"):this.#y(!1)),this.#s.addEventListener("click",()=>this.#y(!0)),new ResizeObserver(()=>this.#v()).observe(this.#a),this.#i()}attributeChangedCallback(){this.#e.placeholder=this.getAttribute("placeholder")??"",this.#e.setAttribute("aria-label",this.getAttribute("label")??"Message")}connectedCallback(){if(qn(),this.#e.parentNode!==this)this.append(this.#e);this.attributeChangedCallback()}get editor(){return this.#e}focus(e){this.#e.focus(e)}get value(){return this.#e.value}set value(e){this.#e.value=e,this.#i()}get queue(){return this.#o}set queue(e){if(Mn(e,this.#o))return;this.#o=e.map((s)=>({...s})),this.#x()}get busy(){return this.#d}set busy(e){this.#d=e,this.#i()}get canSteer(){return this.#m}set canSteer(e){this.#m=e,this.#i()}get canStop(){return this.#h}set canStop(e){this.#h=e,this.#i()}get disabled(){return this.#e.disabled}set disabled(e){this.#e.disabled=e,this.#i()}set status(e){if(this.#r.textContent!==e)this.#r.textContent=e}appendText(e){let s=this.#e.value.replace(/\s+$/,"");this.#e.value=s?`${s}

${e}`:e,this.#i(),this.#e.focus(),this.#e.setSelectionRange(this.#e.value.length,this.#e.value.length)}#k(e){if(e.isComposing)return;if(e.key==="Enter"&&!e.shiftKey)e.preventDefault(),this.#y(e.metaKey||e.ctrlKey);else if(e.key==="Escape"&&this.#d&&this.#h)e.preventDefault(),this.#c("prompt-stop");else if(e.key==="ArrowUp"&&!this.#e.value&&this.#o.length)e.preventDefault(),this.#c("prompt-queue-edit",{id:this.#o.at(-1).id})}#y(e){let s=this.#e.value.trim();if(!s||this.#e.disabled||e&&!this.#m)return;this.#e.value="",this.#i(),this.#c(e?"prompt-steer":"prompt-submit",{text:s})}#c(e,s){this.dispatchEvent(new CustomEvent(e,{detail:s,bubbles:!0,composed:!0}))}#i(){let e=!this.#e.value.trim(),s=this.#d&&this.#h&&e,r=s?"stop":"send";if(this.#n.dataset.mode!==r)this.#n.dataset.mode=r,this.#n.replaceChildren(ke(s?I:Tt));let o=s?"Stop the turn (Esc)":this.#d?"Queue the message: it goes out when the model is done (⏎)":"Send (⏎)";this.#n.setAttribute("aria-label",o),this.#n.title=o,this.#n.disabled=!s&&(e||this.#e.disabled),this.#s.hidden=!this.#m,this.#s.disabled=e||this.#e.disabled;let i=this.#e.disabled?[]:this.#d?["⏎ queue",...this.#h?["Esc stop"]:[],...this.#m?["⌘⏎ steer"]:[],...this.#o.length?["↑ edit last"]:[]]:["⏎ send","⇧⏎ new line"];this.#f=i,this.#v()}#f=[];#v(){let e=this.#a;for(let s=this.#f.length;s>=0;s--){let r=this.#f.slice(0,s).join(" · ");if(e.textContent!==r)e.textContent=r;if(s===0||e.scrollWidth<=e.clientWidth)return}}#x(){let e=new Set(this.#o.map((s)=>s.id));for(let[s,r]of this.#g)if(!e.has(s))r.remove(),this.#g.delete(s);this.#o.forEach((s,r)=>{let o=this.#g.get(s.id);if(!o)o=this.#b(s),this.#g.set(s.id,o);if(o.querySelector(".n").textContent=`${r+1}`,this.#u.children[r]!==o)this.#u.insertBefore(o,this.#u.children[r]??null)}),this.#l.hidden=this.#o.length===0,this.#p.textContent=String(this.#o.length),this.#i()}#b(e){let s=e.text.length>40?`${e.text.slice(0,40)}…`:e.text,r=T("button",{type:"button",class:"edit","aria-label":`Edit queued message: ${s}`,title:"Edit (back into the editor)"},ke(Ct)),o=T("button",{type:"button",class:"remove","aria-label":`Delete queued message: ${s}`,title:"Delete"},ke(Bt));return r.addEventListener("click",()=>this.#c("prompt-queue-edit",{id:e.id})),o.addEventListener("click",()=>this.#c("prompt-queue-remove",{id:e.id})),T("li",{"data-id":e.id},T("span",{class:"n"}),T("span",{class:"text"},e.text),T("span",{class:"actions"},r,o))}}function Mn(e,s){return e.length===s.length&&e.every((r,o)=>r.id===s[o]?.id&&r.text===s[o]?.text)}function T(e,s={},...r){let o=document.createElement(e);for(let[i,l]of Object.entries(s))o.setAttribute(i,l);return o.append(...r),o}if(!customElements.get("chat-prompt"))customElements.define("chat-prompt",Pt);var xe={"provider-leaves":{title:"A tool provider leaves mid-call",source:ut},"three-in-a-row":{title:"Three messages in a row",source:ht},"queue-and-steer":{title:"Queue, steer and stop",source:mt}},Tn=new Set(["ada","bo"]),Rt=["input","control","tools"],_=(e,s=document)=>s.querySelector(e),d=(e,s={},...r)=>{let o=document.createElement(e);for(let[i,l]of Object.entries(s)){if(l===!1)continue;if(i==="class")o.className=String(l);else o.setAttribute(i,l===!0?"":l)}for(let i of r)if(i!==null&&i!==void 0&&i!==!1)o.append(i);return o},V=new X,Ln=new $e(V),Ft=document.querySelector("scxml-explorer"),Nt=_("#chat-clients"),Cn=_("#chat-host-body"),W=_("#chat-timeline"),Kt=_("#chat-caption"),he=_("#chat-session"),Bn=_("#chat-switcher"),Pn=_(".chat-demo"),ne=_("#chat-play"),Je=_("#chat-step"),Rn=_("#chat-time"),Wt=[...document.querySelectorAll("input[name=chat-speed]")],we=_("#chat-speed-select"),Qe=_("#chat-dl"),ce=_("#chat-dl-toggle"),An=_("#chat-dl-text"),At=_("#chat-dl-bar"),pe=_("#chat-dl-list"),Ze=_("#chat-setup"),Se=new URLSearchParams(location.search),Qt=Se.get("fake-downloads"),Ve=Qt===null?null:(t("shkbdapp"),import("./chunk-shkbdapp.js")),Ee=matchMedia("(min-width: 1000px)"),On=0.5,y,C,Ot=0,Z="ada",Ie=0,$t=null;async function et(e){let s=++Ot,r=C?.speed??(Number(Se.get("speed"))||On);Ft.detach(),de.clear(),y?.dispose(),C?.dispose(),$t?.(),Nt.replaceChildren(),U.clear(),Z="ada",Ue="",_e="",W.replaceChildren(),Kt.textContent="",Qe.hidden=!0,pe.hidden=!0,nt.clear(),C=new x({speed:r,playing:Se.get("paused")!=="1"});let o=Ve?await Ve:null;if(y=await ve.create({clock:C,engine:E,charts:{host:ct,client:dt,workspace:gt,package:pt},claude:Ln,...o?{packageLoader:o.fakeLoader(o.fakeOptions(Qt??""))}:{}}),s!==Ot)return;if(y.bus.tap(ts),y.addEventListener("note",(i)=>ue(i.detail)),y.addEventListener("clients",()=>Kn()),y.hostView.addEventListener("change",()=>R(me)),y.host.addEventListener("macrostep",()=>{Ie++,R(me)}),$t=C.subscribe(()=>R(Dt)),Dt(),y.bus.onControlReply=(i,l)=>{if(i==="input.rejected")ue(`The host refused: ${l.reason}.`)},await y.addClient("ada"),me(),Te("host"),e&&xe[e])ue(`Scenario: ${xe[e].title}.`),await y.runScenario(xe[e].source),Yt()}var de=new Set;function R(e){if(de.size===0)requestAnimationFrame(()=>{let s=[...de];de.clear();for(let r of s)r()});de.add(e)}function ue(e){Kt.textContent=e,Jt(d("li",{class:"tl-note"},d("span",{class:"tl-at"},Vt(C.now())),e))}var Vt=(e)=>`${(e/1000).toFixed(2)} s`;function $n(e){let s=(r)=>e.isActive(r);if(s("idle"))return"idle";if(s("backoff"))return"waiting to retry";if(s("tools"))return`running tools (${Object.keys(e.datamodel.evaluate("pending")??{}).length} open)`;for(let r of["connecting","thinking","writing","calling"])if(s(r))return`model ${r==="calling"?"writing a tool call":r}`;return e.activeStateIds().join(", ")}var Ke=(e,s=!1)=>{let r=d("div",{class:"chat-disclosure-body"}),o=d("summary",{},e);return{el:d("details",{class:"chat-disclosure",open:s},o,r),body:r,summary:o}},be="Claude Haiku 4.5",jn={input:"may send messages",control:"may steer and stop turns",tools:"may run tools for the model"},J=(()=>{let e=d("div",{class:"chat-status",role:"status"}),s=d("button",{type:"button",class:"chat-stop",hidden:!0},c(a.Square,12),"Stop");s.addEventListener("click",()=>y.control("input.interrupt"));let r=Ke("Clients",Ee.matches),o=Ke("Model",Ee.matches),i=Ke("Simulate a failure"),l=d("dl",{class:"chat-host-stats"});i.body.append(Dn());for(let p of[r,o,i])p.el.classList.add("chat-section");return Cn.replaceChildren(d("div",{class:"chat-host-status"},e,s),r.el,o.el,i.el,l),{status:e,stop:s,roster:r,model:o,usage:l}})(),Ue="",_e="",se=!1;function jt(e){if(e.isActive("simulated"))return"Simulated";if(e.isActive("unlocked"))return`${be} · ready`;if(e.isActive("verifying"))return`${be} · checking the key…`;return`${be} · needs a key`}function me(){let{host:e,hostView:s}=y,r=e.isActive("claude"),o=$n(e);J.status.replaceChildren(d("span",{class:"chat-chip","data-kind":o==="idle"?"idle":o.startsWith("waiting")?"error":"busy"},o),d("span",{class:"chat-chip"},jt(e)),s.steers.length?d("span",{class:"chat-chip","data-kind":"busy"},`${s.steers.length} steer held`):""),J.stop.hidden=o==="idle",J.roster.summary.textContent=`Clients · ${s.roster.length}`,J.model.summary.textContent=`Model · ${jt(e)}`,J.usage.replaceChildren(d("div",{},d("dt",{},"Log entries"),d("dd",{},y.log.seq.toLocaleString("en"))),d("div",{},d("dt",{},"Output tokens"),d("dd",{},s.usage.output.toLocaleString("en"))));let i=JSON.stringify([s.roster,[...y.clients.keys()].map((u)=>y.bus.isOnline(u))]);if(i!==Ue)Ue=i,J.roster.body.replaceChildren(Hn());let l=e.isActive("unlocked")?"ready":e.isActive("verifying")?"checking":"locked",p=`${r}|${!!V.get()}|${V.remembered}|${se}|${l}`;if(p!==_e)_e=p,J.model.body.replaceChildren(Fn(r,l))}function Hn(){return d("ul",{class:"chat-roster-list"},...y.hostView.roster.map((e)=>{let s=!y.clients.has(e.id)||y.bus.isOnline(e.id);return d("li",{},d("div",{class:"chat-roster-who"},d("span",{class:"chat-dot","data-kind":s?"idle":"error","aria-hidden":"true"}),d("strong",{},e.name),s?null:d("span",{class:"chat-roster-note"},"offline"),e.tools.length?d("span",{class:"chat-roster-tools"},e.tools.join(", ")):null),d("div",{class:"chat-role-toggles",role:"group","aria-label":`${e.name}: roles`},...Rt.map((r)=>{let o=e.roles.includes(r),i=d("button",{type:"button",class:"chat-role","aria-pressed":String(o),"aria-label":`${e.name}: ${r}`,title:`${r}: ${jn[r]}`},o?c(a.Check,12):null,r);return i.addEventListener("click",()=>{let l=Rt.filter((p)=>p===r?!o:e.roles.includes(p));y.control("roles.set",{clientId:e.id,roles:l})}),i})))}))}var te="";function Dn(){let e=d("select",{id:"chat-fault","aria-label":"Make the next simulated request fail"},d("option",{value:""},"Next request: normal"),...["rate_limit","overloaded","stream","max_tokens","refusal","hang"].map((s)=>d("option",{value:s,selected:te===s},`Next request: ${s.replace("_"," ")}`)));return e.addEventListener("change",()=>{if(te=e.value,te)y.sim.fault({kind:te,retryAfterMs:3000}),ue(`The next simulated request will fail: ${te.replace("_"," ")}.`),te=""}),d("label",{class:"chat-inline"},e)}function Fn(e,s){let r=(i,l)=>{let p=d("input",{type:"radio",name:"chat-model",value:i,checked:i==="claude"===e});return p.addEventListener("change",()=>y.control(i==="claude"?"mode.claude":"mode.simulated")),d("label",{},p,d("span",{},l))},o=d("div",{class:"chat-model"},d("fieldset",{class:"chat-segmented"},d("legend",{class:"visually-hidden"},"Model"),r("simulated","Simulated"),r("claude","Claude")),d("p",{class:"chat-small"},e?`${be} with your own Anthropic API key. Fast and cheap: a demo turn costs well under a cent.`:"Rule-based answers made up in this tab. Free, no key; good for following the machinery."));if(e)o.append(Nn(s));return o}function Nn(e){let s=d("p",{class:"chat-key-help"},"No key yet? ",d("a",{href:"https://console.anthropic.com/settings/keys",target:"_blank",rel:"noopener noreferrer"},"Create one in the Anthropic Console"),", ideally in a workspace with a spend limit. It stays in this tab and only ever goes to api.anthropic.com."),r=()=>{_e="",me()};if(V.get()&&!se){let g={ready:"working",checking:"checking…",locked:"not accepted"}[e];return d("div",{class:"chat-key-card","data-state":e},d("div",{class:"chat-key-line"},c(a.KeyRound,16),d("span",{},d("strong",{},"API key set"),` · ${V.remembered?"saved on this device":"for this tab only"} · ${g}`)),d("div",{class:"chat-key-actions","data-align":"start"},We("Replace",()=>{se=!0,r()}),We("Forget",()=>{V.forget(),y.control("key.forget"),r()})),e==="locked"?d("p",{class:"chat-key-help"},"The API didn't accept this key: replace it with a valid one."):null)}let o=d("input",{type:"password",autocomplete:"off",placeholder:"sk-ant-…","aria-label":"Anthropic API key"}),i=V.remembered,l=d("button",{type:"button",class:"chat-switch",role:"switch","aria-checked":String(i),"aria-label":"Remember the key on this device"},d("span",{class:"chat-switch-track","aria-hidden":"true"}),d("span",{},"Remember on this device"));l.addEventListener("click",()=>{i=!i,l.setAttribute("aria-checked",String(i))});let p=()=>{if(!o.value.trim())return o.focus();V.set(o.value,i),o.value="",se=!1,y.control("key.set"),r()};o.addEventListener("keydown",(g)=>g.key==="Enter"&&p());let u=d("button",{type:"button",class:"chat-primary"},"Use key");return u.addEventListener("click",p),d("div",{class:"chat-key-card"},d("div",{class:"chat-combo"},o,u),d("div",{class:"chat-key-actions"},l,se?We("Cancel",()=>{se=!1,r()}):null),s)}function We(e,s){let r=d("button",{type:"button",class:"chat-quiet"},e);return r.addEventListener("click",s),r}var U=new Map;function Kn(){for(let[e,s]of U)if(!y.clients.has(e))s.el.remove(),U.delete(e);for(let e of y.clients.values())if(!U.has(e.id)){if(Ve){for(let s of Object.values(e.runtime.tools))if(s.real)s.real=async()=>s.simulated}U.set(e.id,Wn(e))}if(zt(),!y.clients.has(Z))Z=y.clients.keys().next().value??"ada";for(let[e,s]of U)s.el.toggleAttribute("data-current",e===Z);Yt(),R(me),R(qe)}function qe(){let e=[...y.clients.values()].map((r)=>{let o=y.queueOf(r.id).length,i=r.runtime.running.length,l=r.desk?.pending.length??0,p=y.bus.isOnline(r.id),u=d("button",{type:"button","aria-pressed":String(r.id===Z),"data-client-tab":r.id},d("span",{class:"dot","data-kind":p?i||l?"busy":"idle":"error","aria-hidden":"true"}),r.name,o?d("span",{class:"badge",title:`${o} queued`},String(o)):null,i?d("span",{class:"badge"},"working"):null,l?d("span",{class:"badge"},"asks you"):null,p?null:d("span",{class:"visually-hidden"}," (offline)"));return u.addEventListener("click",()=>tt(r.id)),u}),s=d("button",{type:"button",class:"add","aria-label":"Add a client"},c(a.Plus),"Add");s.addEventListener("click",()=>{Ze.open=!0,_("#chat-add").focus()}),Bn.replaceChildren(...e,s)}function tt(e){Z=e;for(let[s,r]of U)r.el.toggleAttribute("data-current",s===e);qe()}function Wn(e){let s=ie[e.kind],r=d("article",{class:"chat-client card","aria-label":e.name,"data-client":e.id,"data-current":e.id===Z}),o=d("span",{class:"chat-chip"}),i=d("span",{class:"chat-roles"}),l=d("p",{class:"chat-small"}),p=ge("Go offline",()=>{y.setOnline(e.id,!y.bus.isOnline(e.id)),R(L),R(qe)}),u=ge("Leave",()=>y.removeClient(e.id)),g=d("details",{class:"chat-client-options"},d("summary",{"aria-label":`Options for ${e.name}`},"Options"),d("div",{class:"chat-client-options-body"},l,d("div",{class:"chat-row"},p,u))),f=d("header",{},d("h3",{},e.name),o,i,g),h=d("div",{class:"chat-client-body"});r.append(f,h),Nt.append(r);let k=Tn.has(e.kind),b=k||e.kind==="viewer"?d("ol",{class:"chat-transcript","aria-label":`What ${e.name} sees`,"aria-live":"off"}):null,w=e.desk?d("div",{class:"chat-questions"}):null,M=k?Qn(e):null,B=s.tools.length&&!k?d("div",{class:"chat-tools"}):null,z=s.tools.length&&!k?zn(e):null;h.append(...[b,w,M?.el,B,z].filter((H)=>!!H));let L=()=>{if(y.clients.get(e.id)!==e)return;let H=e.session,P=y.bus.isOnline(e.id)?H.isActive("live")?"live":H.isActive("syncing")?"catching up":H.isActive("joining")?"joining":"left":"offline",D=H.datamodel.evaluate("granted")??[];if(o.textContent=P,o.dataset.kind=P==="live"?"idle":P==="offline"?"error":"busy",i.textContent=D.length?D.join(" · "):"watches",l.textContent=`${s.blurb} Has seen ${e.view.seq} of ${y.log.seq} log entries.`,p.textContent=y.bus.isOnline(e.id)?"Go offline":"Go online",b)Jn(b,e.view);if(B)Yn(B,e);if(w&&e.desk)Xn(w,e);M?.render()},A=()=>{R(L),R(qe)};return e.view.addEventListener("change",A),e.session.addEventListener("macrostep",()=>{Ie++,A()}),e.desk?.addEventListener("change",A),L(),{el:r,render:L}}function Qn(e){let s=document.createElement("chat-prompt");s.setAttribute("label",`Message from ${e.name}`),s.setAttribute("placeholder",`Message as ${e.name}…`);let r=(i)=>i.detail;return s.addEventListener("prompt-submit",(i)=>y.type(e.id,r(i).text)),s.addEventListener("prompt-steer",(i)=>y.type(e.id,r(i).text,!0)),s.addEventListener("prompt-stop",()=>y.interrupt(e.id)),s.addEventListener("prompt-queue-edit",(i)=>y.editQueued(e.id,r(i).id)),s.addEventListener("prompt-queue-remove",(i)=>y.removeQueued(e.id,r(i).id)),e.panel.addEventListener("restore",(i)=>s.appendText(r(i))),{el:s,render:()=>{let i=e.session,l=i.datamodel.evaluate("granted")??[];s.disabled=i.isActive("readonly")||i.isActive("left"),s.busy=i.isActive("host-busy")||i.isActive("sending"),s.canSteer=l.includes("control"),s.canStop=l.includes("control"),s.queue=y.queueOf(e.id);let p=i.isActive("rejected")?String(i.datamodel.evaluate("rejection")):"",u=e.view.steers.filter((g)=>g.author===e.name).length;s.status=p?`Refused: ${p}.`:s.disabled?`${e.name} may not type (no input role).`:u?`${u} steer${u>1?"s":""} on the way to the model (with the next tool results, or as the next turn).`:""}}}function Vn(e,s){if(e.packages?.length)return e.packages;let r=e.status==="ready"?"ready":e.status==="failed"?"failed":"waiting";return(Y[s]??[]).map((o)=>({...v[o],phase:r,cached:!1,shared:!1,downloadedBytes:0,totalBytes:null,percent:r==="ready"?100:null}))}function Me(e){let s=new Map,r=[];for(let[o,i]of Object.entries(e.runtime.tools)){if(!i.real||!Y[o])continue;let l=e.runtime.realState(o);r.push(l);for(let p of Vn(l,o))s.set(p.id,p)}return{packages:[...s.values()],states:r}}function ze(e){let s=0,r=0,o=!0;for(let i of e){if(i.cached||i.shared)continue;let l=i.totalBytes??i.approxBytes;if(i.totalBytes===null&&i.phase!=="ready")o=!1;r+=l,s+=i.phase==="loading"||i.phase==="ready"?l:i.downloadedBytes}return{done:s,total:r,percent:r===0?100:o||s>0?Math.min(100,Math.round(s/r*100)):null}}function Ut(e,s){for(let r of y.clients.values()){if(r===e)continue;if(Me(r).packages.find((i)=>i.id===s&&i.phase==="ready"&&!i.shared))return r.name}return}function Ht(e,s,r){switch(e.phase){case"waiting":return"waiting";case"resolving":return"looking it up";case"downloading":return`downloading ${j(e.downloadedBytes)} of ${j(e.totalBytes??e.approxBytes)}`;case"loading":return"starting";case"ready":return e.cached?"ready, from this browser's cache":e.shared?`ready, shared with ${Ut(s,e.id)??"another client"}`:"ready";case"failed":return`failed${r?`: ${r}`:""}`}}function Un(e,s){let r=s.filter((g)=>g.phase==="ready"||Ut(e,g.id)),o=s.filter((g)=>!r.includes(g)),i=o.reduce((g,f)=>g+f.approxBytes,0),l=[...y.clients.values()].some((g)=>g!==e&&Me(g).states.some((f)=>f.status!=="idle")),p=r.length?` (${r.map((g)=>g.label).join(" and ")} already here)`:"",u=l?"":` plus the ${j(F.approxBytes)} Wasmer runtime the first time`;return o.length?`Downloads about ${j(i)}${p} once, then cached${u?`,${u}`:""}. Runs in WebAssembly, in this tab.`:`Nothing to download${p}. Runs in WebAssembly, in this tab.`}function Ge(e,s,r){if(s===null&&r)e.removeAttribute("value");else e.value=s??0}function zn(e){let s=d("div",{class:"chat-client-tools"}),{runtime:r}=e;if(r.hasReal){let i=`tools-mode-${e.id}`,l=(P,D,ee)=>{let ae=d("input",{type:"radio",name:i,value:P,checked:r.mode===P});return ae.addEventListener("change",()=>ae.checked&&r.setMode(P)),d("label",{class:"chat-mode-option"},ae,d("span",{},d("strong",{},D),d("small",{},ee)))},p=d("small",{}),u=l("real","Real","");u.querySelector("small").replaceWith(p);let g=d("fieldset",{class:"chat-tools-mode"},d("legend",{},"Tools"),l("simulated","Simulated","Canned answers, instant. Nothing to download."),u),f=d("span",{class:"chat-dl-total-text"}),h=d("progress",{max:"100","aria-label":`${e.name}: all downloads`}),k=ge("Try again",()=>r.setMode("real")),b=d("ul",{class:"chat-dl-rows"}),w=d("div",{class:"chat-dl-detail"},d("p",{class:"chat-dl-total"},f,h),b,k),M=d("p",{class:"visually-hidden","aria-live":"polite"}),B=d("p",{class:"chat-credit"},"Real tools run on ",d("a",{href:"https://wasmer.io"},"Wasmer"),", in WebAssembly."),z=new Map,L=new Map,A="",H=()=>{if(y.clients.get(e.id)!==e)return;let{packages:P,states:D}=Me(e),ee=D.find((S)=>S.status==="failed"),ae=D.some((S)=>S.status==="loading"),at=D.length>0&&D.every((S)=>S.status==="ready"),O=ee?"failed":ae?"loading":at?"ready":"idle";p.textContent=at?"Downloaded and running, in WebAssembly in this tab.":Un(e,P),w.hidden=O==="idle"&&r.mode!=="real";let re=ze(P);f.textContent=O==="ready"?"Ready.":O==="failed"?`Download failed: ${ee?.error??"unknown error"}`:O==="loading"?`Downloading ${j(re.done)} of about ${j(re.total)}${re.percent===null?"":` · ${re.percent}%`}`:"Waiting to start.",h.hidden=O==="ready",Ge(h,re.percent,O==="loading"),k.hidden=O!=="failed";for(let S of P){let G=z.get(S.id);if(!G){let ot=d("progress",{max:"100","aria-label":`${S.label} download`}),it=d("span",{class:"chat-dl-words"}),lt=d("li",{},d("span",{class:"chat-dl-name"},S.label),d("span",{class:"chat-dl-size"},j(S.approxBytes)),ot,it);G={li:lt,bar:ot,words:it},z.set(S.id,G),b.append(lt)}G.li.dataset.phase=S.phase;let rt=Ht(S,e,ee?.error);if(G.words.textContent!==rt)G.words.textContent=rt;if(Ge(G.bar,S.phase==="ready"?100:S.phase==="loading"?null:S.percent,S.phase!=="waiting"&&S.phase!=="failed"),L.get(S.id)!==S.phase){if(L.set(S.id,S.phase),S.phase!=="waiting")M.textContent=`${e.name}, ${S.label}: ${S.phase==="downloading"?"downloading":Ht(S,e,ee?.error)}`}}if(O!==A){if(O==="ready")M.textContent=`${e.name}: real tools ready`;A=O}};nt.add(H),r.addEventListener("change",zt),H(),s.append(g,w,M,B)}let o=d("details",{class:"chat-knobs"},d("summary",{},r.hasReal?"Simulation knobs (latency, failures)":"Simulation knobs"));s.append(o);for(let[i,l]of e.runtime.knobs){let p=d("input",{type:"number",min:"0",step:"100",value:String(l.latencyMs),"aria-label":`${i} latency in ms`});p.addEventListener("change",()=>l.latencyMs=Number(p.value)||0);let u=d("input",{type:"checkbox",checked:l.failNext});u.addEventListener("change",()=>l.failNext=u.checked);let g=d("input",{type:"checkbox",checked:l.hang});g.addEventListener("change",()=>l.hang=g.checked),o.append(d("div",{class:"chat-row"},d("code",{},i),d("label",{},"latency ",p," ms"),d("label",{},u," fail next call"),d("label",{},g," hang")))}return s}var nt=new Set;function zt(){for(let e of nt)R(e);R(Gn)}function Gn(){if(!y)return;let e=[...y.clients.values()].map((i)=>({c:i,...Me(i)})).filter(({c:i,states:l})=>l.some((p)=>p.status==="loading"||p.status==="failed"&&i.runtime.mode==="real"));if(Qe.hidden=e.length===0,!e.length){pe.hidden=!0,ce.setAttribute("aria-expanded","false");return}let s=new Map;for(let i of e)for(let l of i.packages)s.set(l.id,l);let r=ze([...s.values()]),o=e.filter((i)=>i.states.some((l)=>l.status==="failed"));Qe.dataset.state=o.length?"failed":"loading",An.textContent=o.length?`Download failed: ${o.map((i)=>i.c.name).join(", ")}`:`Downloading ${j(r.done)} of ${j(r.total)}${r.percent===null?"":` · ${r.percent}%`}`,Ge(At,r.percent,!o.length),At.hidden=o.length>0,pe.replaceChildren(...e.map(({c:i,packages:l,states:p})=>{let u=ze(l),g=p.find((h)=>h.status==="failed")?"failed":`${u.percent??0}%`,f=ge(`Show ${i.name}`,()=>{Zt("chat"),tt(i.id),U.get(i.id)?.el.scrollIntoView({block:"start",behavior:"smooth"}),pe.hidden=!0,ce.setAttribute("aria-expanded","false")});return d("li",{},d("span",{},`${i.name}: ${g}`),f)}))}ce.addEventListener("click",()=>{let e=ce.getAttribute("aria-expanded")!=="true";ce.setAttribute("aria-expanded",String(e)),pe.hidden=!e});function Xn(e,s){let r=s.desk;if(!r.pending.length){e.replaceChildren();return}let o=r.pending[0],i=d("input",{type:"text","aria-label":`${s.name}'s answer`,placeholder:"Your answer"}),l=()=>i.value.trim()&&o.answer(i.value.trim());i.addEventListener("keydown",(p)=>p.key==="Enter"&&l()),e.replaceChildren(d("p",{},d("strong",{},"The model asks you: "),o.question),d("div",{class:"chat-row"},i,ge("Answer",l)))}function Yn(e,s){let r=s.view.items.flatMap((i)=>i.type==="tools"?i.calls.filter((l)=>l.provider===s.id).map((l)=>({...l,card:i})):[]),o=new Set(s.runtime.running);e.replaceChildren(r.length?d("ol",{class:"chat-calls"},...r.slice(-4).map((i)=>d("li",{"data-status":o.has(i.id)?"running":i.status,...Gt(i.status,i.card)},d("code",{},i.name),` ${o.has(i.id)?"running…":i.status}`,i.content?d("pre",{},i.content):null))):d("p",{class:"chat-small"},"No calls yet. Ask the model something this tool can do."))}function Gt(e,s){if(e!=="running"||s.armedAt===void 0||s.deadline===void 0)return{};return{"data-armed":String(s.armedAt),"data-deadline":String(s.deadline)}}function Xt(){let e=C?.now()??0;for(let s of document.querySelectorAll("[data-deadline]")){let r=Number(s.dataset.armed),o=Number(s.dataset.deadline),i=Math.min(1,Math.max(0,(e-r)/(o-r)));s.style.setProperty("--timeout",i.toFixed(4)),s.toggleAttribute("data-late",i>0.75),s.title=`times out in ${Math.max(0,Math.ceil((o-e)/1000))} s (simulated time)`}requestAnimationFrame(Xt)}requestAnimationFrame(Xt);function Jn(e,s){let r=e.scrollHeight-e.scrollTop-e.clientHeight<40;if(e.replaceChildren(...s.items.map(Zn)),r)e.scrollTop=e.scrollHeight}function Zn(e){switch(e.type){case"user":return d("li",{class:"msg user","data-steer":e.steer},d("span",{class:"who"},e.steer?`${e.author} (steer)`:e.author),d("span",{class:"text"},e.text));case"assistant":return d("li",{class:"msg assistant","data-status":e.status},d("span",{class:"who"},e.status==="discarded"?`model (dropped: ${e.note??""})`:"model"),...e.blocks.map((s)=>s.kind==="tool_use"?d("span",{class:"call"},"calls ",d("code",{},s.name??"?"),d("code",{class:"json"},s.json??"")):d("span",{class:`text ${s.kind}`},s.text)),e.status==="streaming"?d("span",{class:"cursor","aria-hidden":"true"},"▍"):null);case"tools":return d("li",{class:"msg tools"},d("span",{class:"who"},e.calls.length>1?`${e.calls.length} tool calls, in parallel`:"1 tool call"),d("ul",{},...e.calls.map((s)=>d("li",{"data-status":s.status,...Gt(s.status,e)},d("code",{},s.name),` on ${s.provider?y.clients.get(s.provider)?.name??s.provider:"nobody"}: ${s.status}`,s.content?d("pre",{},s.content):null))));default:return d("li",{class:"msg notice","data-level":e.level},e.text)}}function Yt(){let e=he.value||"host",s=[["host","Host"],...[...y.clients.values()].map((r)=>[r.id,r.name]),["workspace","Workspace (downloads)"]];if(y.director)s.push(["scenario","Scenario"]);if(he.replaceChildren(...s.map(([r,o])=>d("option",{value:r,selected:r===e},o))),!s.some(([r])=>r===e))Te("host")}function Te(e){let s,r;if(e==="host")s=y.host,r=[y.bus,y.log];else if(e==="workspace")s=y.workspace,r=[y.workspaceLink];else if(e==="scenario"&&y.director)s=y.director,r=[];else{let o=y.clients.get(e);if(!o){Te("host");return}s=o.session,r=[y.bus,o.runtime]}he.value=e,Ft.attach({session:s,processors:r,clock:C})}var es={"client.hello":()=>"joins and asks for roles",welcome:()=>"is admitted",snapshot:()=>"gets everything so far","client.resync":()=>"missed something, asks for a snapshot","client.bye":()=>"leaves","input.submit":()=>"sends a message","input.steer":()=>"steers","input.interrupt":()=>"asks to stop","input.accepted":(e)=>{let s=e.data;return s.steer?"steer held for the next boundary":s.queued?"message held until the turn ends":"message starts a turn"},"input.rejected":(e)=>{let s=e.data;return s.code==="busy"?"busy: another message got there first; back to the head of its queue":`refused: ${s.reason}`},"host.busy":()=>"a turn started: new messages wait in their queues","host.idle":(e)=>{let s=e.data.stoppedBy;return s?`idle (stopped by ${y.clients.get(s)?.name??s}): queues may send`:"idle: the next queued message may go"},"tool.call":(e)=>`run ${e.data.name}`,"tool.cancel":()=>"cancel that call","tool.result":(e)=>e.data.isError?"tool failed":"tool result","roles.changed":(e)=>`roles now: ${e.data.granted.join(", ")||"none"}`,"log.batch":(e)=>{let s=e.data;return`log entries ${s.first}–${s.last}`}},Xe=_("#chat-batches");function ts(e){if(e.event==="log.batch"&&!Xe.checked)return;if(e.from==="ui")return;let s=(r)=>r==="host"?"Host":y.clients.get(r)?.name??r;Jt(d("li",{"data-dropped":e.dropped??!1},d("span",{class:"tl-at"},Vt(e.at)),d("span",{class:"tl-route"},`${s(e.from)} → ${s(e.to)}`),d("code",{},e.event),d("span",{class:"tl-gloss"},`${es[e.event]?.(e)??""}${e.dropped?` (dropped: ${e.dropped})`:""}`)))}function Jt(e){let s=W.scrollHeight-W.scrollTop-W.clientHeight<40;W.append(e);while(W.childElementCount>400)W.firstElementChild?.remove();if(s)W.scrollTop=W.scrollHeight}function ge(e,s,r={}){let o=d("button",{type:"button",disabled:!!r.disabled},e);return o.addEventListener("click",s),o}function Dt(){if(!C)return;let e=C.playing;if(ne.dataset.playing!==String(e))ne.dataset.playing=String(e),ne.replaceChildren(c(e?a.Pause:a.Play,18)),ne.setAttribute("aria-label",e?"Pause":"Play"),ne.title=e?"Pause (the whole system)":"Play";for(let s of Wt)s.checked=Number(s.value)===C.speed;if(Number(we.value)!==C.speed)we.value=String(C.speed);Rn.textContent=`${(C.now()/1000).toFixed(1)} s`}ne.addEventListener("click",()=>C.toggle());Je.prepend(c(a.StepForward));Je.title="Pause, then run until something changes";Je.addEventListener("click",()=>{let e=Ie;C.step(()=>Ie>e)});for(let e of Wt)e.addEventListener("change",()=>C.speed=Number(e.value));we.addEventListener("change",()=>C.speed=Number(we.value));function Zt(e){Pn.dataset.view=e;for(let s of document.querySelectorAll(".chat-views button"))s.setAttribute("aria-pressed",String(s.dataset.view===e))}for(let e of document.querySelectorAll(".chat-views button"))e.addEventListener("click",()=>Zt(e.dataset.view));Ze.open=Ee.matches;var st=_("#chat-scenario");st.append(...Object.entries(xe).map(([e,s])=>d("option",{value:e},s.title)));_("#chat-run").addEventListener("click",()=>void et(st.value||void 0));_("#chat-reset").addEventListener("click",()=>void et());var en=_("#chat-add");en.append(...Object.values(ie).map((e)=>d("option",{value:e.kind,title:e.blurb},e.name)));_("#chat-add-button").addEventListener("click",async()=>{let e=await y.addClient(en.value);if(tt(e.id),!Ee.matches)Ze.open=!1});he.addEventListener("change",()=>Te(he.value));Xe.addEventListener("change",()=>ue(Xe.checked?"The timeline now shows log batches too.":"Log batches hidden."));var Ye=Se.get("scenario")??void 0;if(Ye)st.value=Ye;et(Ye);window.llmChat=()=>y;export{le,v,F,n,K};
