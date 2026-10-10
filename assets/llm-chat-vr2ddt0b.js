import"./chunk-00kaws6r.js";import"./chunk-r2017h4a.js";import{R,L,l,f}from"./chunk-jj8v68xv.js";import{y}from"./chunk-fejtk7mc.js";import{t,m}from"./chunk-42sm0716.js";import{U,x}from"./chunk-5z6zfdqv.js";m(import.meta.url,["vr2ddt0b","zgxg1fd4","1g1frxcm","7170wmf8","00kaws6r","r2017h4a","jj8v68xv","fejtk7mc","42sm0716","5z6zfdqv","nntrav87","5bq3gsk7","0ra20n77","vzf0jxfz","exssp3t2","4h162q9x","xnk7vpy4","5ghk3dq1"],[["./llm-chat-vr2ddt0b.js",4,5,6,7,8,9],["./chunk-zgxg1fd4.js",5,7,0],["./chunk-1g1frxcm.js",12,8,0],["./chunk-7170wmf8.js",0],["./chunk-00kaws6r.js",9],["./chunk-r2017h4a.js",8,16],["./chunk-jj8v68xv.js"],["./chunk-fejtk7mc.js",5,9],["./chunk-42sm0716.js"],["./chunk-5z6zfdqv.js"],["./chunk-nntrav87.js",12],["./chunk-5bq3gsk7.js",12],["./chunk-0ra20n77.js"],["./chunk-vzf0jxfz.js"],["./chunk-exssp3t2.js"],["./chunk-4h162q9x.js",17],["./chunk-xnk7vpy4.js"],["./chunk-5ghk3dq1.js"]],0);
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
`;var ve={"README.md":`# Demo workspace

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
`};function yt(e=ve){let s=(r)=>{let o=new RegExp(`^${r.replace(/[.+^${}()|[\]\\]/g,"\\$&").replace(/\*/g,".*").replace(/\?/g,".")}$`);return Object.keys(e).filter((i)=>o.test(i)).sort()},a=(r)=>{let o=e[r.replace(/^(\/workspace\/|\.\/)/,"")];if(o===void 0)throw Error(`${r}: No such file or directory`);return o};return async(r,{clock:o})=>{let i=String(r.command??"").trim();if(/[|;&><`$]/.test(i))throw Error("sh (simulated): pipes, redirects and substitutions aren't simulated; switch Terminal to real");let[c="",...p]=i.split(/\s+/),h=p.filter((u)=>!u.startsWith("-")),k=(u)=>u.flatMap((b)=>/[*?]/.test(b)?s(b):[b]);switch(c){case"ls":return(h.length?k(h):Object.keys(e).sort()).join(`
`);case"cat":return k(h).map(a).join("");case"wc":return k(h).map((b)=>`${a(b).split(`
`).length-1} ${b}`).join(`
`);case"head":return k(h).map((u)=>a(u).split(`
`).slice(0,10).join(`
`)).join(`
`);case"grep":{let[u="",...b]=h;return k(b).flatMap((w)=>a(w).split(`
`).filter((S)=>S.includes(u)).map((S)=>`${w}:${S}`)).join(`
`)}case"echo":return p.join(" ");case"pwd":return"/workspace";case"date":return new Date(o.now()).toUTCString();case"":return"";default:throw Error(`sh (simulated): ${c}: command not found. Simulated: ls, cat, wc, head, grep, echo, pwd, date`)}}}var ft=async(e)=>{let s=String(e.code??"").trim(),a=/^print\((.*)\)$/s.exec(s);if(!a)throw Error("python (simulated): only print(<integer arithmetic>) is simulated; switch Python to real");return`${dn(a[1])}`};function dn(e){let s=e.match(/\*\*|\/\/|\d+|[-+*/%()]|\S/g)??[],a=0,r=()=>s[a],o=(u)=>{let b=s[a++];if(u&&b!==u)throw Error(`python (simulated): expected ${u}`);return b},i=()=>{let u=o();if(u==="("){let b=h();return o(")"),b}if(u==="-")return-c();if(u==="+")return c();if(u&&/^\d+$/.test(u))return BigInt(u);throw Error(`python (simulated): unexpected ${u??"end of input"}`)},c=()=>{let u=i();if(r()==="**")return o(),u**c();return u},p=()=>{let u=c();for(let b=r();b==="*"||b==="/"||b==="//"||b==="%";b=r()){o();let w=c();if(w===0n&&b!=="*")throw Error("ZeroDivisionError: division by zero");u=b==="*"?u*w:b==="%"?(u%w+w)%w:cn(u,w)}return u},h=()=>{let u=p();for(let b=r();b==="+"||b==="-";b=r())o(),u=b==="+"?u+p():u-p();return u},k=h();if(a<s.length)throw Error(`python (simulated): unexpected ${s[a]}`);return k}function cn(e,s){let a=e/s;return e%s!==0n&&e<0n!==s<0n?a-1n:a}var vt=async(e)=>{let s=String(e.query??"").replace(/\s+/g," ").trim().toLowerCase();if(/group by status/.test(s))return` status    | count
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
(4 rows)`;throw Error("ERROR (simulated): only a few queries on `orders` are simulated; switch Postgres to real")},kt=async(e)=>{let s=new U,a=[],r;try{r=await y(String(e.scxml??""),{clock:s,scriptTimeoutMs:500}),r.addEventListener("log",(c)=>a.push(`${c.label??"log"}: ${String(c.value??"")}`));let o=[];r.addEventListener("error",(c)=>o.push(`${c.kind}: ${c.message}`)),r.start(),s.run();let i=[`start → ${r.activeStateIds().join(", ")}`];for(let c of e.events??[])r.send(String(c)),s.run(s.now()+1e4),i.push(`${String(c)} → ${r.activeStateIds().join(", ")}`);return[...i,`status: ${r.status}`,...a,...o].join(`
`)}finally{r?.dispose()}};class Le extends EventTarget{pending=[];#t=0;ask=(e,{signal:s})=>new Promise((a,r)=>{let o={id:++this.#t,question:String(e.question??""),answer:(i)=>{this.#e(o),a(i)}};this.pending.push(o),this.dispatchEvent(new Event("change")),s.addEventListener("abort",()=>{this.#e(o),r(s.reason)})});answer(e){let s=this.pending[0];return s?.answer(e),!!s}#e(e){let s=this.pending.indexOf(e);if(s>=0)this.pending.splice(s,1);this.dispatchEvent(new Event("change"))}}var oe=(e)=>({type:"string",description:e}),ie={ada:{kind:"ada",latencyMs:0,name:"Ada",blurb:"A person: types, steers, stops, and answers questions the model asks her.",wants:["input","control","tools"],tools:[{name:"ask_ada",description:"Ask Ada, a person in this conversation, a question and wait for her answer. Use it for decisions only she can make.",input_schema:{type:"object",properties:{question:oe("The question, in one or two sentences")},required:["question"]}}],implement(){let e=new Le;return{tools:{ask_ada:{simulated:e.ask}},desk:e}}},bo:{kind:"bo",latencyMs:0,name:"Bo",blurb:"A person who may type, but not steer or stop.",wants:["input"],tools:[],implement:()=>({tools:{}})},terminal:{kind:"terminal",latencyMs:400,name:"Terminal",blurb:"A bash shell with a small /workspace: simulated, or real (bash + coreutils in WebAssembly, ≈ 15 MB; the same /workspace as Python and psql).",wants:["tools"],tools:[{name:"shell",description:"Run a shell command in /workspace (bash and coreutils) and return its output. When the other tools run for real, /workspace is shared with them: files written here are visible to the python and sql tools, and `python` and `psql` work here too once they are loaded.",input_schema:{type:"object",properties:{command:oe("The command line")},required:["command"]}}],implement:()=>({tools:{shell:{simulated:yt(),real:()=>(t("zgxg1fd4"),import("./chunk-zgxg1fd4.js")).then((e)=>e.shellTool)}}})},python:{kind:"python",latencyMs:1500,name:"Python",blurb:"A Python interpreter: simulated (print() of integer arithmetic), or real (Python 3.13 in WebAssembly, ≈ 62 MB, with its own bash; files shared with the Terminal).",wants:["tools"],tools:[{name:"python",description:"Run Python 3 code in /workspace and return what it prints. Files there can be read and written; when the shell tool runs for real it sees the same files.",input_schema:{type:"object",properties:{code:oe("The program")},required:["code"]}}],implement:()=>({tools:{python:{simulated:ft,real:()=>(t("zgxg1fd4"),import("./chunk-zgxg1fd4.js")).then((e)=>e.pythonTool)}}})},postgres:{kind:"postgres",latencyMs:900,name:"Postgres",blurb:"A PostgreSQL database with an orders table: simulated (a few queries), or real (PGlite + psql in WebAssembly, ≈ 78 MB; psql can \\copy to and from /workspace).",wants:["tools"],tools:[{name:"sql",description:"Run one SQL statement (or a psql command such as \\copy) against a PostgreSQL database with an `orders(id, status, total)` table. psql runs in /workspace, so \\copy can read and write files there.",input_schema:{type:"object",properties:{query:oe("One SQL statement")},required:["query"]}}],implement:()=>({tools:{sql:{simulated:vt,real:()=>(t("zgxg1fd4"),import("./chunk-zgxg1fd4.js")).then((e)=>e.sqlTool)}}})},lab:{kind:"lab",latencyMs:300,name:"Statechart Lab",blurb:"Runs SCXML statecharts the model writes, in a sandbox, and reports where they end up.",wants:["tools"],tools:[{name:"run_statechart",description:"Run an SCXML statechart (ECMAScript data model) in a sandbox, send it events in order, and report the active states after each.",input_schema:{type:"object",properties:{scxml:oe("The whole <scxml> document"),events:{type:"array",items:{type:"string"},description:"Event names to send, in order"}},required:["scxml"]}}],implement:()=>({tools:{run_statechart:{simulated:kt}}})},viewer:{kind:"viewer",latencyMs:0,name:"Viewer",blurb:"Watches the conversation; can't type.",wants:[],tools:[],implement:()=>({tools:{}})}};class G{static storageKey="llm-chat:anthropic-key";#t=null;constructor(){try{this.#t=localStorage.getItem(G.storageKey)}catch{}}get(){return this.#t}get remembered(){try{return localStorage.getItem(G.storageKey)!==null}catch{return!1}}set(e,s){this.#t=e.trim()||null;try{if(s&&this.#t)localStorage.setItem(G.storageKey,this.#t);else localStorage.removeItem(G.storageKey)}catch{}}forget(){this.set("",!1)}}var Ce="urn:llm-chat:bus",Be="urn:llm-chat:log",Pe="urn:llm-chat:tool",Re="urn:llm-chat:stage",Ae="urn:llm-chat:panel",Oe="urn:llm-chat:workspace";class n extends Error{kind;details;constructor(e,s,a={}){super(s);this.kind=e;this.details=a}get retryable(){return["rate_limit","overloaded","server","network","stream"].includes(this.kind)}}class $e{vault;name="claude";#t=null;constructor(e){this.vault=e}async load(){if(!this.#t){let{ClaudeModel:e}=await (t("1g1frxcm"),import("./chunk-1g1frxcm.js"));this.#t??=new e(this.vault)}return this.#t}stream(e,s){if(!this.#t)throw new n("auth","Claude isn't loaded yet: set a key first.");return this.#t.stream(e,s)}async check(e){await(await this.load()).check(e)}}class je{clock;type=Ce;aliases=["bus"];latencyMs=0;onControlReply;#t=new Map;#e=new Map;#n=new Set;#s=new Set;#a=new Map;constructor(e){this.clock=e}register(e,s){this.#e.set(s.sessionId,e)}unregister(e){let s=this.#t.get(e);if(s)this.#e.delete(s.sessionId);this.#t.delete(e),this.#n.delete(e),this.#a.delete(e)}setOnline(e,s){if(s)this.#n.delete(e);else this.#n.add(e)}isOnline(e){return!this.#n.has(e)}tap(e){return this.#s.add(e),()=>this.#s.delete(e)}watch(e,s){let a=this.#a.get(e)??new Set;return this.#a.set(e,a),a.add(s),()=>a.delete(s)}location(e){return`${Ce}#${this.#e.get(e.sessionId)??e.sessionId}`}attach(e){let s=this.#e.get(e.sessionId);if(s)this.#t.set(s,e)}detach(e){let s=this.#e.get(e.sessionId);if(s)this.unregister(s)}send(e,s){let a=this.#e.get(s.sessionId);if(!a)throw Error(`bus: session ${s.sessionId} has no address`);this.post(a,e.target,e.event,e.data)}post(e,s,a,r){if(s==="*"){for(let i of this.#t.keys())if(i!=="host")this.post(e,i,a,r);return}let o={at:this.clock.now(),from:e,to:s,event:a,data:r};if(e==="host"&&s==="host"){for(let i of this.#s)i(o);this.clock.setTimeout(()=>this.onControlReply?.(a,r),this.latencyMs);return}if(this.#n.has(e)||this.#n.has(s))o.dropped="offline";else if(!this.#t.has(s))o.dropped="unknown";for(let i of this.#s)i(o);if(o.dropped)return;this.clock.setTimeout(()=>{if(this.#n.has(s))return;let i=this.#t.get(s);if(!i)return;for(let c of this.#a.get(s)??[])c(a,r,e);i.deliver(a,r,e)},this.latencyMs)}fromPanel(e,s,a={}){for(let r of this.#s)r({at:this.clock.now(),from:"ui",to:e,event:s,data:a});this.#t.get(e)?.deliver(s,a,"ui")}fromControl(e,s={}){for(let a of this.#s)a({at:this.clock.now(),from:"host",to:"host",event:e,data:s});this.#t.get("host")?.deliver(e,s,"host")}}function xt({log:e,models:s,system:a}){return(r)=>{let o=new AbortController,i=Number(r.params.request),c=r.params.tools??[],p=s[String(r.params.model)];return(async()=>{if(!p)return{ok:!1,error:{kind:"invalid",retryable:!1,message:`no model ${r.params.model}`}};let k=e.draft(i,p.name),u=p.stream({system:a,messages:e.history(),tools:c.map(({provider:w,...S})=>S)},o.signal);for await(let w of u){if(o.signal.aborted)break;if(k.apply(w),w.type==="content_block_start"){let S=w.content_block;if(S.type==="text"||S.type==="thinking"||S.type==="tool_use")r.sendToParent("llm.block.start",{index:w.index,kind:S.type,name:"name"in S?S.name:void 0})}else if(w.type==="content_block_stop")r.sendToParent("llm.block.stop",{index:w.index,kind:k.kindOf(w.index)})}let b=await u.finalMessage();return k.finish(b),pn(b,c)})().then((k)=>{if(!o.signal.aborted)r.done(k)},(k)=>{if(!o.signal.aborted)r.done({ok:!1,error:mn(k)})}),{send(){},cancel:()=>o.abort()}}}function pn(e,s){let a=e.content.flatMap((i)=>i.type==="tool_use"?[i]:[]),r=e.stop_reason??"end_turn";if(r==="refusal")return{ok:!1,error:{kind:"refusal",retryable:!1,message:"The model declined to continue."}};if(r==="max_tokens"&&a.length)return{ok:!1,error:{kind:"truncated",retryable:!1,message:"A tool call was cut off at the output limit."}};let o=a.map((i)=>{let c=s.find((h)=>h.name===i.name),p=c?un(i.input,c.input_schema):`unknown tool ${i.name}`;return{id:i.id,name:i.name,input:i.input,...p?{invalid:p}:{}}});return{ok:!0,stop:r,toolCalls:o}}function un(e,s){if(typeof e!=="object"||e===null||Array.isArray(e))return"the input is not an object";let a=e;for(let r of s.required??[])if(!(r in a))return`missing "${r}"`;for(let[r,o]of Object.entries(a)){let i=s.properties?.[r];if(!i){if(s.additionalProperties===!1)return`unexpected "${r}"`;continue}let c=Array.isArray(o)?"array":o===null?"null":typeof o,p=i.type==="integer"?"number":i.type;if(p&&c!==p)return`"${r}" should be ${i.type}, not ${c}`}return}function mn(e){if(e instanceof n)return{kind:e.kind,retryable:e.retryable,message:e.message,...e.details};return{kind:"stream",retryable:!0,message:e instanceof Error?e.message:String(e)}}function bt(e){return(s)=>{let a=new AbortController;return e(a.signal).then(()=>a.signal.aborted||s.done({ok:!0}),(r)=>a.signal.aborted||s.done({ok:!1,message:r instanceof Error?r.message:String(r)})),{send(){},cancel:()=>a.abort()}}}class wt{request;model;log;message=null;#t=new Map;constructor(e,s,a){this.request=e;this.model=s;this.log=a;a.append({kind:"assistant.start",request:e,model:s})}apply(e){let{request:s,log:a}=this;switch(e.type){case"content_block_start":{let r=e.content_block;this.#t.set(e.index,r.type),a.append({kind:"block.start",request:s,index:e.index,block:r.type,...r.type==="tool_use"?{name:r.name,id:r.id}:{}});break}case"content_block_delta":{let r=e.delta;if(r.type==="text_delta")a.append({kind:"block.delta",request:s,index:e.index,text:r.text});else if(r.type==="thinking_delta")a.append({kind:"block.delta",request:s,index:e.index,text:r.thinking});else if(r.type==="input_json_delta")a.append({kind:"block.delta",request:s,index:e.index,json:r.partial_json});break}case"content_block_stop":a.append({kind:"block.stop",request:s,index:e.index});break;case"message_delta":a.append({kind:"usage",request:s,input:e.usage.input_tokens??0,output:e.usage.output_tokens,cacheRead:e.usage.cache_read_input_tokens??0});break}}kindOf(e){return this.#t.get(e)??"unknown"}finish(e){this.message=e}}class He{clock;bus;type=Be;aliases=["log"];batchMs=50;entries=[];#t=[];#e=new Map;#n=-1;#s=null;#a=new Set;constructor(e,s){this.clock=e;this.bus=s}get seq(){return this.entries.length}history(){return this.#t.slice()}subscribe(e){return this.#a.add(e),()=>this.#a.delete(e)}append(e){let s={...e,seq:this.entries.length+1,at:this.clock.now()};this.entries.push(s);for(let a of this.#a)a(s);if(this.#n<0)this.#n=s.seq-1;return this.#s??=this.clock.setTimeout(()=>this.flush(),this.batchMs),s}flush(){if(this.#s!==null)this.clock.clearTimeout(this.#s);if(this.#s=null,this.#n<0)return;let e=this.entries.slice(this.#n);this.#n=-1,this.bus.post("host","*","log.batch",{first:e[0].seq,last:e.at(-1).seq,entries:e})}draft(e,s){let a=new wt(e,s,this);return this.#e.set(e,a),a}state(e){this.append({kind:"state",configuration:e})}location(){return Be}send(e,s){let a=e.data??{};switch(e.event){case"user.append":{let r=a.entries;if(!r.length)return;this.#t.push({role:"user",content:r.map((o)=>({type:"text",text:`[${o.author}] ${o.text}`}))}),this.append({kind:"user",turn:a.turn,entries:r});return}case"assistant.commit":{let r=a.request,o=this.#e.get(r);if(!o?.message)throw Error(`log: no finished draft for request ${r}`);this.#t.push({role:"assistant",content:o.message.content}),this.#e.delete(r),this.append({kind:"assistant.commit",request:r,stop:String(a.stop)});return}case"assistant.discard":{let r=a.request;this.#e.delete(r),this.append({kind:"assistant.discard",request:r,reason:String(a.reason??"")});return}case"tools.dispatched":{let r=a.calls;this.append({kind:"tools",request:a.request,calls:r.map(({id:o,name:i,provider:c})=>({id:o,name:i,provider:c}))});return}case"tools.timer":this.append({kind:"timer",request:a.request,ms:Number(a.ms)});return;case"tool.results":{let r=a.results,o=a.steers??[],i=this.#r(),c=[...r].sort((p,h)=>i.indexOf(p.callId)-i.indexOf(h.callId));this.#t.push({role:"user",content:[...c.map((p)=>({type:"tool_result",tool_use_id:p.callId,is_error:p.isError,content:p.content})),...o.map((p)=>({type:"text",text:`[${p.author}] ${p.text}`}))]}),this.append({kind:"tool.results",request:a.request,results:c,steers:o});return}case"queue.changed":this.append({kind:"steers",steers:a.steers});return;case"roster.changed":this.append({kind:"roster",clients:a.clients});return;case"notice":this.append({kind:"notice",level:a.level,text:String(a.text)});return;case"snapshot.send":this.flush(),this.bus.post("host",a.to,"snapshot",{seq:this.seq,entries:this.entries.slice()});return;default:throw Error(`log: unknown command ${e.event}`)}}#r(){let e=this.#t.at(-1);if(!e||e.role!=="assistant"||typeof e.content==="string")return[];return e.content.flatMap((s)=>s.type==="tool_use"?[s.id]:[])}}var hn=`<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="red">
  <state id="red"><transition event="timer" target="green"/></state>
  <state id="green"><transition event="timer" target="yellow"/></state>
  <state id="yellow"><transition event="timer" target="red"/></state>
</scxml>`,gn=[{tool:"shell",when:/\b(files?|workspace|ls|folder|directory|shell|terminal|readme|lines)\b/i,input:(e)=>({command:/\blines?\b/i.test(e)?"wc -l README.md":/markdown|\.md\b/i.test(e)?"ls *.md":"ls"})},{tool:"python",when:/\b(python|compute|calculate)\b|\d\s*\*\*\s*\d/i,input:(e)=>({code:`print(${yn(e)??"2**64"})`})},{tool:"sql",when:/\b(sql|database|postgres|orders?|table)\b/i,input:()=>({query:"SELECT status, count(*) FROM orders GROUP BY status ORDER BY 2 DESC;"})},{tool:"run_statechart",when:/\b(statecharts?|state machines?|scxml|traffic light)\b/i,input:()=>({scxml:hn,events:["timer","timer"]})},{tool:"ask_ada",when:/\b(ask ada|check with ada|confirm|approve)\b/i,input:()=>({question:"Should I go ahead with this?"})}];function yn(e){return(e.match(/[\d(][\d\s+\-*/%().]*[\d)]/g)??[]).filter((a)=>/[+\-*/%]/.test(a)).sort((a,r)=>r.length-a.length)[0]?.trim()}class De{clock;name="simulated";timeToFirstTokenMs=400;tokensPerSecond=40;#t=[];#e=0;constructor(e){this.clock=e}fault(e){this.#t.push(e)}stream(e,s){let a=this.plan(e),r=this.#t.shift(),o,i,c=new Promise((h,k)=>{o=h,i=k});c.catch(()=>{});let p=this.#s(a,r,s,o,i);return{[Symbol.asyncIterator]:()=>p,finalMessage:()=>c}}plan({messages:e,tools:s}){let a=e.at(-1);if(ge(a).filter((k)=>k.type==="tool_result").length)return{blocks:[{type:"text",text:this.#n(e)}],stop:"end_turn"};let o=fn(e),i=new Set(s.map((k)=>k.name)),c=gn.filter((k)=>i.has(k.tool)&&k.when.test(o.text));if(c.length){let k=c.map((u)=>u.tool).join(" and ");return{blocks:[{type:"text",text:c.length>1?`I'll run ${k} at the same time.`:`Let me use ${k}.`},...c.map((u)=>({type:"tool_use",id:`toolu_sim_${++this.#e}`,name:u.tool,input:u.input(o.text)}))],stop:"tool_use"}}let p=[...i].filter((k)=>k!=="ask_ada"),h=p.length?`Try asking about ${p.map(vn).join(", ")}${i.has("ask_ada")?", or to check with Ada":""}.`:"Add Terminal, Python, Postgres or Statechart Lab with “Add client”, then ask about files, arithmetic, the orders table or a statechart; they each bring a tool.";return{blocks:[{type:"text",text:`(Simulated answer for ${o.authors.join(" and ")||"you"}.) You said: “${o.text}”. ${h}`}],stop:"end_turn"}}#n(e){let s=new Map;for(let i of ge(e.at(-2)))if(i.type==="tool_use")s.set(i.id,i.name);let a=["Here is what came back:"],r=ge(e.at(-1));for(let i of r){if(i.type!=="tool_result")continue;let p=(typeof i.content==="string"?i.content:JSON.stringify(i.content)).split(`
`).slice(0,3).join(" · ").slice(0,160);a.push(`- ${s.get(i.tool_use_id)??"a tool"}${i.is_error?" failed":""}: ${p}`)}let o=r.filter((i)=>i.type==="text");for(let i of o)if(i.type==="text")a.push(`Noted: ${i.text.replace(/[.!?]$/,"")}. I'll keep that in mind.`);return a.join(`
`)}async*#s(e,s,a,r,o){let i=1000/this.tokensPerSecond,c=0;try{if(await this.#a(this.timeToFirstTokenMs,a),s?.kind==="hang")await this.#a(Number.POSITIVE_INFINITY,a);if(s?.kind==="rate_limit")throw new n("rate_limit","429 rate limited (simulated)",{status:429,retryAfterMs:s.retryAfterMs??2000});if(s?.kind==="overloaded")throw new n("overloaded","529 overloaded (simulated)",{status:529});let p=`msg_sim_${++this.#e}`;yield N({type:"message_start",message:St(p,[],null,0)});let h=[],k=e.stop;for(let[u,b]of e.blocks.entries()){if(b.type==="text"){yield N({type:"content_block_start",index:u,content_block:{type:"text",text:"",citations:null}});let w="",S=b.text.split(/(?<=\s)/);for(let[_,C]of S.entries()){if(await this.#a(i,a),s?.kind==="stream"&&_===Math.floor(S.length/2))throw new n("stream","the stream broke off (simulated)");if((s?.kind==="max_tokens"||s?.kind==="refusal")&&_===Math.floor(S.length/2)){k=s.kind;break}w+=C,c++,yield N({type:"content_block_delta",index:u,delta:{type:"text_delta",text:C}})}h.push({type:"text",text:w}),yield N({type:"content_block_stop",index:u})}else{yield N({type:"content_block_start",index:u,content_block:{type:"tool_use",id:b.id,name:b.name,input:{}}});let w=JSON.stringify(b.input);for(let S=0;S<w.length;S+=16)await this.#a(i,a),c++,yield N({type:"content_block_delta",index:u,delta:{type:"input_json_delta",partial_json:w.slice(S,S+16)}});h.push(b),yield N({type:"content_block_stop",index:u})}if(k!==e.stop)break}yield N({type:"message_delta",delta:{stop_reason:k,stop_sequence:null},usage:It(c)}),yield N({type:"message_stop"}),r(St(p,h,k,c))}catch(p){throw o(p),p}}#a(e,s){return new Promise((a,r)=>{if(s.aborted)return r(new n("stream","aborted"));let o=Number.isFinite(e)?this.clock.setTimeout(a,e):null;s.addEventListener("abort",()=>{if(o!==null)this.clock.clearTimeout(o);r(new n("stream","aborted"))},{once:!0})})}}function Et(e){return["rate_limit","overloaded","stream","max_tokens","refusal","hang"].includes(e)}function ge(e){if(!e)return[];let{content:s}=e;return typeof s==="string"?[{type:"text",text:s}]:s}function fn(e){let s=[],a=new Set;for(let r=e.length-1;r>=0&&e[r].role==="user";r--)for(let o of ge(e[r]).reverse()){if(o.type!=="text")continue;let i=/^\[([^\]]+)\]\s*(.*)$/s.exec(o.text);if(i)a.add(i[1]);s.unshift(i?i[2]:o.text)}return{text:s.join(" "),authors:[...a].reverse()}}function vn(e){return{shell:"files",python:"arithmetic",sql:"the orders table",run_statechart:"a statechart",ask_ada:"asking Ada"}[e]??e}function N(e){return e}function It(e){return{input_tokens:0,output_tokens:e,cache_read_input_tokens:0,cache_creation_input_tokens:0}}function St(e,s,a,r){return{id:e,type:"message",role:"assistant",model:"simulated",content:s.map((o)=>o.type==="text"?{...o,citations:null}:o),stop_reason:a,stop_sequence:null,usage:It(r)}}var v={bash:{id:"wasmer/bash@=1.0.25",label:"bash",approxBytes:1870786},coreutils:{id:"wasmer/coreutils@=1.0.27",label:"coreutils",approxBytes:12703522},python:{id:"python/python@=3.13.20",label:"Python 3.13",approxBytes:61744083},pglite:{id:"wasmer/pglite@=0.1.3",label:"PostgreSQL (PGlite)",approxBytes:76919536},psql:{id:"wasmer/psql@=18.4.0",label:"psql",approxBytes:1065711}},F={id:"@wasmer/sdk",label:"Wasmer runtime",approxBytes:4951977},X={shell:["bash","coreutils"],python:["bash","coreutils","python"],sql:["pglite","psql"]};function _t(e){return[F,...(X[e]??[]).flatMap((a)=>v[a]?[v[a]]:[])].map((a)=>({...a,phase:"waiting",cached:!1,shared:!1,downloadedBytes:0,totalBytes:null,percent:null}))}function j(e){return e>=1048576?`${(e/1048576).toFixed(e>=10485760?0:1)} MB`:`${Math.max(1,Math.round(e/1024))} KB`}function qt(){let e={sdk:{label:F.label,approxBytes:F.approxBytes}};for(let[s,a]of Object.entries(v))e[s]={label:a.label,approxBytes:a.approxBytes};return e}var te=16384;class Fe extends EventTarget{clock;tools;type=Pe;aliases=["tool"];knobs=new Map;link=null;#t=null;#e=new Map;#n=new Map;constructor(e,s,a=600){super();this.clock=e;this.tools=s;for(let r of Object.keys(s))this.knobs.set(r,{latencyMs:a,failNext:!1,hang:!1})}get mode(){return this.link?.mode()??"simulated"}get hasReal(){return Object.values(this.tools).some((e)=>e.real)}setMode(e){let s=Object.keys(this.tools).some((a)=>this.realState(a).status==="failed");this.link?.request(e==="real"&&s?"retry":e)}realState(e){return this.link?.state(e)??{status:"idle"}}changed(){this.dispatchEvent(new Event("change"))}get running(){return[...this.#e.keys()]}location(){return Pe}attach(e){this.#t=e}detach(){for(let e of this.#e.values())e.abort();this.#e.clear(),this.#t=null}send(e){let s=e.data;if(e.event==="run")this.#s(s.callId,String(s.name),s.input??{},!!s.real);else if(e.event==="cancel")this.#e.get(s.callId)?.abort();else throw Error(`tool runtime: unknown message ${e.event}`)}async#s(e,s,a,r){let o=new AbortController;this.#e.set(e,o);let{signal:i}=o;try{let c=await this.invoke(s,a,i,r);if(!i.aborted)this.#t?.deliver("tool.done",{callId:e,isError:!1,content:c})}catch(c){if(!i.aborted)this.#t?.deliver("tool.done",{callId:e,isError:!0,content:c instanceof Error?c.message:String(c)})}finally{this.#e.delete(e)}}async invoke(e,s,a=new AbortController().signal,r=this.mode==="real"){let o=this.knobs.get(e)??{latencyMs:0,failNext:!1,hang:!1},i=this.tools[e];if(!i)throw Error(`no tool ${e}`);let c=r&&i.real;if(!c)await Mt(this.clock,o.latencyMs,a);if(o.hang)await Mt(this.clock,Number.POSITIVE_INFINITY,a);if(o.failNext)throw o.failNext=!1,this.changed(),Error("failed (“fail next call” was set)");let h=await(c?await this.#a(e,c):i.simulated)(s,{signal:a,clock:this.clock});return h.length>te?`${h.slice(0,te)}
… (${h.length-te} more characters cut)`:h}#a(e,s){let a=this.#n.get(e);if(!a)a=s(),a.catch(()=>this.#n.delete(e)),this.#n.set(e,a);return a}}function Mt(e,s,a){return new Promise((r,o)=>{if(a.aborted)return o(a.reason);let i=Number.isFinite(s)?e.setTimeout(r,s):null;a.addEventListener("abort",()=>{if(i!==null)e.clearTimeout(i);o(a.reason)},{once:!0})})}class ye extends EventTarget{seq=0;items=[];steers=[];roster=[];configuration=[];usage={input:0,output:0,cacheRead:0};receive(e,s){if(e==="snapshot"){let a=s;this.#t(),this.#n(a.entries),this.seq=a.seq}else if(e==="log.batch"){let a=s;if(a.last<=this.seq)return!0;if(a.first>this.seq+1)return!1;this.#n(a.entries.filter((r)=>r.seq>this.seq))}else return!0;return this.dispatchEvent(new Event("change")),!0}append(e){this.#n([e]),this.dispatchEvent(new Event("change"))}text(){return this.items.map((e)=>{switch(e.type){case"user":return`${e.steer?"steer":"user"} [${e.author}] ${e.text}`;case"assistant":return`assistant(${e.status}) ${e.blocks.map((s)=>s.kind==="tool_use"?`<${s.name}>`:s.text).join(" | ")}`;case"tools":return`tools ${e.calls.map((s)=>`${s.name}@${s.provider??"-"}:${s.status}`).join(", ")}`;default:return`notice(${e.level}) ${e.text}`}}).join(`
`)}#t(){this.seq=0,this.items=[],this.steers=[],this.roster=[],this.configuration=[],this.usage={input:0,output:0,cacheRead:0}}#e(e){for(let s=this.items.length-1;s>=0;s--){let a=this.items[s];if(a.type==="assistant"&&a.request===e)return a}return}#n(e){for(let s of e)switch(this.seq=s.seq,s.kind){case"user":for(let a of s.entries)this.items.push({type:"user",author:a.author,text:a.text,steer:!1});break;case"assistant.start":this.items.push({type:"assistant",request:s.request,model:s.model,blocks:[],status:"streaming"});break;case"block.start":this.#e(s.request)?.blocks.splice(s.index,0,{kind:s.block,text:"",...s.name?{name:s.name}:{},...s.id?{id:s.id}:{}});break;case"block.delta":{let a=this.#e(s.request)?.blocks[s.index];if(a&&s.text)a.text+=s.text;if(a&&s.json)a.json=(a.json??"")+s.json;break}case"assistant.commit":{let a=this.#e(s.request);if(a)a.status="committed";break}case"assistant.discard":{let a=this.#e(s.request);if(a)a.status="discarded",a.note=s.reason;break}case"tools":this.items.push({type:"tools",request:s.request,calls:s.calls.map((a)=>({...a,status:"running"}))});break;case"timer":{let a=this.items.findLast((r)=>r.type==="tools"&&r.request===s.request);if(a?.type==="tools")a.armedAt=s.at,a.deadline=s.at+s.ms;break}case"tool.results":{let a=this.items.findLast((r)=>r.type==="tools"&&r.request===s.request);if(a?.type==="tools")for(let r of s.results){let o=a.calls.find((i)=>i.id===r.callId);if(o)Object.assign(o,{status:r.isError?"failed":"done",content:r.content})}for(let r of s.steers)this.items.push({type:"user",author:r.author,text:r.text,steer:!0});break}case"steers":this.steers=s.steers;break;case"roster":this.roster=s.clients;break;case"notice":this.items.push({type:"notice",level:s.level,text:s.text});break;case"state":this.configuration=s.configuration;break;case"usage":this.usage.input+=s.input,this.usage.output+=s.output,this.usage.cacheRead+=s.cacheRead;break;case"block.stop":break}}}class Ne{type=Oe;aliases=["workspace"];#t=new Map;#e=new Map;#n=new Set;register(e,s){this.#t.set(s.sessionId,e)}tap(e){return this.#n.add(e),()=>this.#n.delete(e)}location(e){return`${Oe}#${this.#t.get(e.sessionId)??e.sessionId}`}attach(e){let s=this.#t.get(e.sessionId);if(s)this.#e.set(s,e)}detach(e){let s=this.#t.get(e.sessionId);if(s&&this.#e.get(s)===e)this.#e.delete(s)}send(e,s){let a=this.#t.get(s.sessionId);if(!a)throw Error(`workspace link: session ${s.sessionId} has no address`);let r={from:a,to:e.target,event:e.event,data:e.data};for(let o of this.#n)o(r);this.#e.get(e.target)?.deliver(e.event,e.data,a)}}function kn(e){return(s)=>{let a=new AbortController,r=!1;return e(String(s.params.key),{signal:a.signal,onProgress:(o)=>{if(r||=o.cached,!a.signal.aborted)s.sendToParent("package.progress",{phase:o.phase,downloadedBytes:o.downloadedBytes,totalBytes:o.totalBytes,percent:o.percent,cached:o.cached})}}).then(()=>a.signal.aborted||s.done({ok:!0,cached:r}),(o)=>a.signal.aborted||s.done({ok:!1,error:o instanceof Error?o.message:String(o)})),{send(){},cancel:()=>a.abort()}}}var xn=(e,s)=>(t("zgxg1fd4"),import("./chunk-zgxg1fd4.js")).then((a)=>a.loadPackage(e,s));function bn(e){return{type:Ae,aliases:["panel"],location:()=>Ae,send:(s)=>{if(s.event!=="restore")throw Error(`panel: unknown message ${s.event}`);e.dispatchEvent(new CustomEvent("restore",{detail:String(s.data.text??"")}))}}}var wn=`You are the assistant in a group chat. Several people may write; each message starts with the author's name in brackets.
Tools are provided by other participants and may come and go between turns. When several tool calls are independent, make them in the same response so they run in parallel.
Keep answers short.`;class fe extends EventTarget{clock;bus;log;sim;hostView=new ye;clients=new Map;host;workspace;workspaceLink=new Ne;director=null;notes=[];#t;constructor(e){super();this.#t=e,this.clock=e.clock,this.bus=new je(e.clock),this.log=new He(e.clock,this.bus),this.sim=new De(e.clock),this.log.subscribe((s)=>this.hostView.append(s))}static async create(e){let s=new fe(e);return await s.#e(),await s.#s(),s}async#e(){let{engine:e,charts:s,clock:a,domParser:r}=this.#t;this.workspace=await e(s.workspace,{clock:a,...r?{domParser:r}:{},ioprocessors:[this.workspaceLink],invokers:{"wasm-package":kn(this.#t.packageLoader??xn)},loader:(o)=>{if(o!=="package.scxml")throw Error(`workspace: no chart ${o}`);return s.package},data:{catalog:qt()}}),this.workspaceLink.register("workspace",this.workspace),this.workspace.addEventListener("macrostep",()=>{for(let o of this.clients.values())o.runtime.changed()}),this.workspace.start()}#n(e,s){let a=e.session,r=a.isActive("real-loading")?"loading":a.isActive("real-ready")?"ready":a.isActive("real-failed")?"failed":"idle",o=this.workspace.datamodel.evaluate("packages")??{},i=this.workspace.datamodel.evaluate("firstBy")??{},c=["sdk",...X[s]??[]],p=_t(s).map((u,b)=>{let w=c[b],S=o[w];if(!S||r==="idle")return u;let _=S.phase??"waiting";return{...u,phase:_,cached:!!S.cached,shared:_==="ready"&&!!i[w]&&i[w]!==e.id,downloadedBytes:S.downloadedBytes??0,totalBytes:S.totalBytes??null,percent:S.percent??null}}),k=c.map((u)=>o[u]).find((u)=>u?.phase==="failed")?.error??a.datamodel.evaluate("toolsError");return{status:r,packages:p,...r==="failed"&&k?{error:String(k)}:{}}}async#s(){let{engine:e,charts:s,clock:a,domParser:r,claude:o}=this.#t,i={simulated:this.sim,...o?{claude:o}:{}};this.host=await e(s.host,{clock:a,...r?{domParser:r}:{},ioprocessors:[this.bus,this.log],invokers:{llm:xt({log:this.log,models:i,system:this.#t.system??wn}),"key-check":bt((p)=>o?o.check(p):Promise.reject(Error("Claude isn't loaded")))}}),this.bus.register("host",this.host);let c="";this.host.addEventListener("macrostep",()=>{let p=this.host.activeStateIds(),h=p.join(" ");if(h!==c)this.log.state(p);c=h}),this.host.addEventListener("microstep",(p)=>{for(let h of p.entered)this.#a(`host.enter.${h.id}`)}),this.host.start()}async addClient(e,s){let a=ie[e];if(!a)throw Error(`unknown client kind ${e}`);let r=e;for(let M=2;this.clients.has(r);M++)r=`${e}-${M}`;let{engine:o,charts:i,clock:c,domParser:p}=this.#t,{tools:h,desk:k}=a.implement(c),u=new Fe(c,h,a.latencyMs),b=new EventTarget,w=(s??a.name).replace(/[<>&"]/g,""),S=i.client.replace('name="llm-chat-client"',`name="llm-chat-client · ${w}"`),_=await o(S,{clock:c,...p?{domParser:p}:{},ioprocessors:[this.bus,u,bn(b),this.workspaceLink],data:{clientId:r,name:s??a.name,kind:e,wants:a.wants,tools:a.tools,needs:Sn(h)}});this.workspaceLink.register(r,_),u.link={mode:()=>_.isActive("real")?"real":"simulated",request:(M)=>this.bus.fromPanel(r,`ui.tools.${M}`),state:(M)=>this.#n({id:r,session:_},M)},_.addEventListener("macrostep",()=>u.changed());let C=new ye;this.bus.register(r,_),this.bus.watch(r,(M,A)=>C.receive(M,A)),_.addEventListener("microstep",(M)=>{for(let A of M.entered)this.#a(`client.${r}.enter.${A.id}`)});let V={id:r,kind:e,name:s??a.name,session:_,runtime:u,view:C,panel:b,...k?{desk:k}:{}};return this.clients.set(r,V),_.start(),this.dispatchEvent(new Event("clients")),V}removeClient(e){let s=this.clients.get(e);if(!s)return;this.bus.fromPanel(e,"ui.leave"),this.clock.setTimeout(()=>{this.bus.unregister(e),this.clients.delete(e),this.dispatchEvent(new Event("clients")),s.session.dispose()},this.bus.latencyMs+1)}setOnline(e,s){this.bus.setOnline(e,s),this.bus.fromPanel(e,s?"ui.online":"ui.offline")}type(e,s,a=!1){this.bus.fromPanel(e,a?"ui.steer":"ui.submit",{text:s})}interrupt(e){this.bus.fromPanel(e,"ui.interrupt")}queueOf(e){let s=this.clients.get(e);return s?s.session.datamodel.evaluate("queue")??[]:[]}removeQueued(e,s){this.bus.fromPanel(e,"ui.queue.remove",{id:s})}editQueued(e,s){this.bus.fromPanel(e,"ui.queue.edit",{id:s})}control(e,s={}){this.bus.fromControl(e,s)}async runScenario(e){this.director?.dispose();let{engine:s,clock:a,domParser:r}=this.#t;return this.director=await s(e,{clock:a,...r?{domParser:r}:{},ioprocessors:[this.#l()]}),this.director.start(),this.director}#a(e){this.#r?.deliver(e,void 0,"stage")}#r=null;#l(){return{type:Re,aliases:["stage"],location:()=>Re,attach:(e)=>{this.#r=e},detach:()=>{this.#r=null},send:(e)=>this.#p(e.event,e.data??{})}}#p(e,s){let a=String(s.client??"");switch(e){case"note":this.notes.push(String(s.text)),this.dispatchEvent(new CustomEvent("note",{detail:String(s.text)}));return;case"client.add":this.addClient(String(s.kind),s.name===void 0?void 0:String(s.name));return;case"client.remove":this.removeClient(a);return;case"client.offline":this.setOnline(a,!1);return;case"client.online":this.setOnline(a,!0);return;case"type":this.type(a,String(s.text),!!s.steer);return;case"interrupt":this.interrupt(a);return;case"queue.edit":case"queue.remove":{let r=this.queueOf(a)[Number(s.index??0)];if(!r)throw Error(`stage: ${a} has nothing queued at ${s.index}`);if(e==="queue.edit")this.editQueued(a,r.id);else this.removeQueued(a,r.id);return}case"answer":this.clients.get(a)?.desk?.answer(String(s.text));return;case"sim.fault":if(!Et(String(s.kind)))throw Error(`stage: unknown fault ${s.kind}`);this.sim.fault(s);return;case"sim.tool":{let r=this.clients.get(a)?.runtime.knobs.get(String(s.tool));if(!r)throw Error(`stage: ${a} has no tool ${s.tool}`);Object.assign(r,En(s,["latencyMs","failNext","hang"]));return}default:throw Error(`stage: unknown message ${e}`)}}dispose(){this.director?.dispose(),this.workspace?.dispose();for(let e of this.clients.values())e.session.dispose();this.host.dispose()}}function Sn(e){let s=Object.entries(e).flatMap(([a,r])=>r.real?X[a]??[]:[]);return[...new Set(s)]}function En(e,s){return Object.fromEntries(s.filter((a)=>(a in e)).map((a)=>[a,e[a]]))}var Tt=[["path",{d:"m5 12 7-7 7 7"}],["path",{d:"M12 19V5"}]];var Lt=[["path",{d:"m15 10 5 5-5 5"}],["path",{d:"M4 4v7a4 4 0 0 0 4 4h12"}]];var Ct=[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}],["path",{d:"m15 5 4 4"}]];var Bt=[["path",{d:"M10 11v6"}],["path",{d:"M14 11v6"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"}],["path",{d:"M3 6h18"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}]];var ke=(e)=>{let s=R(e,{width:16,height:16,"stroke-width":2});return s.setAttribute("aria-hidden","true"),s},In=`
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
`;function qn(){if(document.querySelector("style[data-chat-prompt]"))return;let e=document.createElement("style");e.dataset.chatPrompt="",e.textContent=_n,document.head.append(e)}class Pt extends HTMLElement{static observedAttributes=["placeholder","label"];#t;#e;#n;#s;#a;#r;#l;#p;#u;#g=new Map;#o=[];#d=!1;#m=!1;#h=!1;constructor(){super();this.#t=this.attachShadow({mode:"open"});let e=document.createElement("style");e.textContent=In,this.#l=q("section",{class:"queue",hidden:"","aria-label":"Queued messages"}),this.#p=q("span"),this.#u=q("ol"),this.#l.append(q("div",{class:"queue-head"},q("span",{},"Queued · sent one by one, when the model is done"),this.#p),this.#u),this.#e=q("textarea",{rows:"1",class:"cp-editor",slot:"editor"}),this.#s=q("button",{type:"button",class:"steer",title:"Steer: sent now, reaches the model at its next step (⌘/Ctrl+⏎)"},ke(Lt),"Steer"),this.#n=q("button",{type:"button",class:"primary"}),this.#a=q("span",{class:"hint"}),this.#r=q("p",{class:"status",role:"status"});let s=q("div",{class:"box"},q("slot",{name:"editor"}),q("div",{class:"bar"},this.#a,this.#s,this.#n));s.addEventListener("pointerdown",(a)=>{if(a.target===s)a.preventDefault(),this.#e.focus()}),this.#t.append(e,this.#l,s,this.#r),this.#e.addEventListener("input",()=>this.#i()),this.#e.addEventListener("keydown",(a)=>this.#k(a)),this.#n.addEventListener("click",()=>this.#n.dataset.mode==="stop"?this.#c("prompt-stop"):this.#y(!1)),this.#s.addEventListener("click",()=>this.#y(!0)),new ResizeObserver(()=>this.#v()).observe(this.#a),this.#i()}attributeChangedCallback(){this.#e.placeholder=this.getAttribute("placeholder")??"",this.#e.setAttribute("aria-label",this.getAttribute("label")??"Message")}connectedCallback(){if(qn(),this.#e.parentNode!==this)this.append(this.#e);this.attributeChangedCallback()}get editor(){return this.#e}focus(e){this.#e.focus(e)}get value(){return this.#e.value}set value(e){this.#e.value=e,this.#i()}get queue(){return this.#o}set queue(e){if(Mn(e,this.#o))return;this.#o=e.map((s)=>({...s})),this.#x()}get busy(){return this.#d}set busy(e){this.#d=e,this.#i()}get canSteer(){return this.#m}set canSteer(e){this.#m=e,this.#i()}get canStop(){return this.#h}set canStop(e){this.#h=e,this.#i()}get disabled(){return this.#e.disabled}set disabled(e){this.#e.disabled=e,this.#i()}set status(e){if(this.#r.textContent!==e)this.#r.textContent=e}appendText(e){let s=this.#e.value.replace(/\s+$/,"");this.#e.value=s?`${s}

${e}`:e,this.#i(),this.#e.focus(),this.#e.setSelectionRange(this.#e.value.length,this.#e.value.length)}#k(e){if(e.isComposing)return;if(e.key==="Enter"&&!e.shiftKey)e.preventDefault(),this.#y(e.metaKey||e.ctrlKey);else if(e.key==="Escape"&&this.#d&&this.#h)e.preventDefault(),this.#c("prompt-stop");else if(e.key==="ArrowUp"&&!this.#e.value&&this.#o.length)e.preventDefault(),this.#c("prompt-queue-edit",{id:this.#o.at(-1).id})}#y(e){let s=this.#e.value.trim();if(!s||this.#e.disabled||e&&!this.#m)return;this.#e.value="",this.#i(),this.#c(e?"prompt-steer":"prompt-submit",{text:s})}#c(e,s){this.dispatchEvent(new CustomEvent(e,{detail:s,bubbles:!0,composed:!0}))}#i(){let e=!this.#e.value.trim(),s=this.#d&&this.#h&&e,a=s?"stop":"send";if(this.#n.dataset.mode!==a)this.#n.dataset.mode=a,this.#n.replaceChildren(ke(s?L:Tt));let r=s?"Stop the turn (Esc)":this.#d?"Queue the message: it goes out when the model is done (⏎)":"Send (⏎)";this.#n.setAttribute("aria-label",r),this.#n.title=r,this.#n.disabled=!s&&(e||this.#e.disabled),this.#s.hidden=!this.#m,this.#s.disabled=e||this.#e.disabled;let o=this.#e.disabled?[]:this.#d?["⏎ queue",...this.#h?["Esc stop"]:[],...this.#m?["⌘⏎ steer"]:[],...this.#o.length?["↑ edit last"]:[]]:["⏎ send","⇧⏎ new line"];this.#f=o,this.#v()}#f=[];#v(){let e=this.#a;for(let s=this.#f.length;s>=0;s--){let a=this.#f.slice(0,s).join(" · ");if(e.textContent!==a)e.textContent=a;if(s===0||e.scrollWidth<=e.clientWidth)return}}#x(){let e=new Set(this.#o.map((s)=>s.id));for(let[s,a]of this.#g)if(!e.has(s))a.remove(),this.#g.delete(s);this.#o.forEach((s,a)=>{let r=this.#g.get(s.id);if(!r)r=this.#b(s),this.#g.set(s.id,r);if(r.querySelector(".n").textContent=`${a+1}`,this.#u.children[a]!==r)this.#u.insertBefore(r,this.#u.children[a]??null)}),this.#l.hidden=this.#o.length===0,this.#p.textContent=String(this.#o.length),this.#i()}#b(e){let s=e.text.length>40?`${e.text.slice(0,40)}…`:e.text,a=q("button",{type:"button",class:"edit","aria-label":`Edit queued message: ${s}`,title:"Edit (back into the editor)"},ke(Ct)),r=q("button",{type:"button",class:"remove","aria-label":`Delete queued message: ${s}`,title:"Delete"},ke(Bt));return a.addEventListener("click",()=>this.#c("prompt-queue-edit",{id:e.id})),r.addEventListener("click",()=>this.#c("prompt-queue-remove",{id:e.id})),q("li",{"data-id":e.id},q("span",{class:"n"}),q("span",{class:"text"},e.text),q("span",{class:"actions"},a,r))}}function Mn(e,s){return e.length===s.length&&e.every((a,r)=>a.id===s[r]?.id&&a.text===s[r]?.text)}function q(e,s={},...a){let r=document.createElement(e);for(let[o,i]of Object.entries(s))r.setAttribute(o,i);return r.append(...a),r}if(!customElements.get("chat-prompt"))customElements.define("chat-prompt",Pt);var xe={"provider-leaves":{title:"A tool provider leaves mid-call",source:ut},"three-in-a-row":{title:"Three messages in a row",source:ht},"queue-and-steer":{title:"Queue, steer and stop",source:mt}},Tn=new Set(["ada","bo"]),Rt=["input","control","tools"],I=(e,s=document)=>s.querySelector(e),d=(e,s={},...a)=>{let r=document.createElement(e);for(let[o,i]of Object.entries(s)){if(i===!1)continue;if(o==="class")r.className=String(i);else r.setAttribute(o,i===!0?"":i)}for(let o of a)if(o!==null&&o!==void 0&&o!==!1)r.append(o);return r},W=new G,Ln=new $e(W),Ft=document.querySelector("scxml-explorer"),Nt=I("#chat-clients"),Cn=I("#chat-host-body"),K=I("#chat-timeline"),Kt=I("#chat-caption"),me=I("#chat-session"),Bn=I("#chat-switcher"),Pn=I(".chat-demo"),ne=I("#chat-play"),Je=I("#chat-step"),Rn=I("#chat-time"),Wt=[...document.querySelectorAll("input[name=chat-speed]")],we=I("#chat-speed-select"),Qe=I("#chat-dl"),de=I("#chat-dl-toggle"),An=I("#chat-dl-text"),At=I("#chat-dl-bar"),ce=I("#chat-dl-list"),Ze=I("#chat-setup"),Se=new URLSearchParams(location.search),Qt=Se.get("fake-downloads"),Ve=Qt===null?null:(t("7170wmf8"),import("./chunk-7170wmf8.js")),Ee=matchMedia("(min-width: 1000px)"),On=0.5,g,T,Ot=0,J="ada",Ie=0,$t=null;async function et(e){let s=++Ot,a=T?.speed??(Number(Se.get("speed"))||On);Ft.detach(),le.clear(),g?.dispose(),T?.dispose(),$t?.(),Nt.replaceChildren(),Q.clear(),J="ada",Ue="",_e="",K.replaceChildren(),Kt.textContent="",Qe.hidden=!0,ce.hidden=!0,nt.clear(),T=new x({speed:a,playing:Se.get("paused")!=="1"});let r=Ve?await Ve:null;if(g=await fe.create({clock:T,engine:y,charts:{host:ct,client:dt,workspace:gt,package:pt},claude:Ln,...r?{packageLoader:r.fakeLoader(r.fakeOptions(Qt??""))}:{}}),s!==Ot)return;if(g.bus.tap(ts),g.addEventListener("note",(o)=>pe(o.detail)),g.addEventListener("clients",()=>Kn()),g.hostView.addEventListener("change",()=>P(ue)),g.host.addEventListener("macrostep",()=>{Ie++,P(ue)}),$t=T.subscribe(()=>P(Dt)),Dt(),g.bus.onControlReply=(o,i)=>{if(o==="input.rejected")pe(`The host refused: ${i.reason}.`)},await g.addClient("ada"),ue(),Te("host"),e&&xe[e])pe(`Scenario: ${xe[e].title}.`),await g.runScenario(xe[e].source),Yt()}var le=new Set;function P(e){if(le.size===0)requestAnimationFrame(()=>{let s=[...le];le.clear();for(let a of s)a()});le.add(e)}function pe(e){Kt.textContent=e,Jt(d("li",{class:"tl-note"},d("span",{class:"tl-at"},Vt(T.now())),e))}var Vt=(e)=>`${(e/1000).toFixed(2)} s`;function $n(e){let s=(a)=>e.isActive(a);if(s("idle"))return"idle";if(s("backoff"))return"waiting to retry";if(s("tools"))return`running tools (${Object.keys(e.datamodel.evaluate("pending")??{}).length} open)`;for(let a of["connecting","thinking","writing","calling"])if(s(a))return`model ${a==="calling"?"writing a tool call":a}`;return e.activeStateIds().join(", ")}var Ke=(e,s=!1)=>{let a=d("div",{class:"chat-disclosure-body"}),r=d("summary",{},e);return{el:d("details",{class:"chat-disclosure",open:s},r,a),body:a,summary:r}},be="Claude Haiku 4.5",jn={input:"may send messages",control:"may steer and stop turns",tools:"may run tools for the model"},Y=(()=>{let e=d("div",{class:"chat-status",role:"status"}),s=d("button",{type:"button",class:"chat-stop",hidden:!0},f(l.Square,12),"Stop");s.addEventListener("click",()=>g.control("input.interrupt"));let a=Ke("Clients",Ee.matches),r=Ke("Model",Ee.matches),o=Ke("Simulate a failure"),i=d("dl",{class:"chat-host-stats"});o.body.append(Dn());for(let c of[a,r,o])c.el.classList.add("chat-section");return Cn.replaceChildren(d("div",{class:"chat-host-status"},e,s),a.el,r.el,o.el,i),{status:e,stop:s,roster:a,model:r,usage:i}})(),Ue="",_e="",se=!1;function jt(e){if(e.isActive("simulated"))return"Simulated";if(e.isActive("unlocked"))return`${be} · ready`;if(e.isActive("verifying"))return`${be} · checking the key…`;return`${be} · needs a key`}function ue(){let{host:e,hostView:s}=g,a=e.isActive("claude"),r=$n(e);Y.status.replaceChildren(d("span",{class:"chat-chip","data-kind":r==="idle"?"idle":r.startsWith("waiting")?"error":"busy"},r),d("span",{class:"chat-chip"},jt(e)),s.steers.length?d("span",{class:"chat-chip","data-kind":"busy"},`${s.steers.length} steer held`):""),Y.stop.hidden=r==="idle",Y.roster.summary.textContent=`Clients · ${s.roster.length}`,Y.model.summary.textContent=`Model · ${jt(e)}`,Y.usage.replaceChildren(d("div",{},d("dt",{},"Log entries"),d("dd",{},g.log.seq.toLocaleString("en"))),d("div",{},d("dt",{},"Output tokens"),d("dd",{},s.usage.output.toLocaleString("en"))));let o=JSON.stringify([s.roster,[...g.clients.keys()].map((p)=>g.bus.isOnline(p))]);if(o!==Ue)Ue=o,Y.roster.body.replaceChildren(Hn());let i=e.isActive("unlocked")?"ready":e.isActive("verifying")?"checking":"locked",c=`${a}|${!!W.get()}|${W.remembered}|${se}|${i}`;if(c!==_e)_e=c,Y.model.body.replaceChildren(Fn(a,i))}function Hn(){return d("ul",{class:"chat-roster-list"},...g.hostView.roster.map((e)=>{let s=!g.clients.has(e.id)||g.bus.isOnline(e.id);return d("li",{},d("div",{class:"chat-roster-who"},d("span",{class:"chat-dot","data-kind":s?"idle":"error","aria-hidden":"true"}),d("strong",{},e.name),s?null:d("span",{class:"chat-roster-note"},"offline"),e.tools.length?d("span",{class:"chat-roster-tools"},e.tools.join(", ")):null),d("div",{class:"chat-role-toggles",role:"group","aria-label":`${e.name}: roles`},...Rt.map((a)=>{let r=e.roles.includes(a),o=d("button",{type:"button",class:"chat-role","aria-pressed":String(r),"aria-label":`${e.name}: ${a}`,title:`${a}: ${jn[a]}`},r?f(l.Check,12):null,a);return o.addEventListener("click",()=>{let i=Rt.filter((c)=>c===a?!r:e.roles.includes(c));g.control("roles.set",{clientId:e.id,roles:i})}),o})))}))}var ee="";function Dn(){let e=d("select",{id:"chat-fault","aria-label":"Make the next simulated request fail"},d("option",{value:""},"Next request: normal"),...["rate_limit","overloaded","stream","max_tokens","refusal","hang"].map((s)=>d("option",{value:s,selected:ee===s},`Next request: ${s.replace("_"," ")}`)));return e.addEventListener("change",()=>{if(ee=e.value,ee)g.sim.fault({kind:ee,retryAfterMs:3000}),pe(`The next simulated request will fail: ${ee.replace("_"," ")}.`),ee=""}),d("label",{class:"chat-inline"},e)}function Fn(e,s){let a=(o,i)=>{let c=d("input",{type:"radio",name:"chat-model",value:o,checked:o==="claude"===e});return c.addEventListener("change",()=>g.control(o==="claude"?"mode.claude":"mode.simulated")),d("label",{},c,d("span",{},i))},r=d("div",{class:"chat-model"},d("fieldset",{class:"chat-segmented"},d("legend",{class:"visually-hidden"},"Model"),a("simulated","Simulated"),a("claude","Claude")),d("p",{class:"chat-small"},e?`${be} with your own Anthropic API key. Fast and cheap: a demo turn costs well under a cent.`:"Rule-based answers made up in this tab. Free, no key; good for following the machinery."));if(e)r.append(Nn(s));return r}function Nn(e){let s=d("p",{class:"chat-key-help"},"No key yet? ",d("a",{href:"https://console.anthropic.com/settings/keys",target:"_blank",rel:"noopener noreferrer"},"Create one in the Anthropic Console"),", ideally in a workspace with a spend limit. It stays in this tab and only ever goes to api.anthropic.com."),a=()=>{_e="",ue()};if(W.get()&&!se){let h={ready:"working",checking:"checking…",locked:"not accepted"}[e];return d("div",{class:"chat-key-card","data-state":e},d("div",{class:"chat-key-line"},f(l.KeyRound,16),d("span",{},d("strong",{},"API key set"),` · ${W.remembered?"saved on this device":"for this tab only"} · ${h}`)),d("div",{class:"chat-key-actions","data-align":"start"},We("Replace",()=>{se=!0,a()}),We("Forget",()=>{W.forget(),g.control("key.forget"),a()})),e==="locked"?d("p",{class:"chat-key-help"},"The API didn't accept this key: replace it with a valid one."):null)}let r=d("input",{type:"password",autocomplete:"off",placeholder:"sk-ant-…","aria-label":"Anthropic API key"}),o=W.remembered,i=d("button",{type:"button",class:"chat-switch",role:"switch","aria-checked":String(o),"aria-label":"Remember the key on this device"},d("span",{class:"chat-switch-track","aria-hidden":"true"}),d("span",{},"Remember on this device"));i.addEventListener("click",()=>{o=!o,i.setAttribute("aria-checked",String(o))});let c=()=>{if(!r.value.trim())return r.focus();W.set(r.value,o),r.value="",se=!1,g.control("key.set"),a()};r.addEventListener("keydown",(h)=>h.key==="Enter"&&c());let p=d("button",{type:"button",class:"chat-primary"},"Use key");return p.addEventListener("click",c),d("div",{class:"chat-key-card"},d("div",{class:"chat-combo"},r,p),d("div",{class:"chat-key-actions"},i,se?We("Cancel",()=>{se=!1,a()}):null),s)}function We(e,s){let a=d("button",{type:"button",class:"chat-quiet"},e);return a.addEventListener("click",s),a}var Q=new Map;function Kn(){for(let[e,s]of Q)if(!g.clients.has(e))s.el.remove(),Q.delete(e);for(let e of g.clients.values())if(!Q.has(e.id)){if(Ve){for(let s of Object.values(e.runtime.tools))if(s.real)s.real=async()=>s.simulated}Q.set(e.id,Wn(e))}if(zt(),!g.clients.has(J))J=g.clients.keys().next().value??"ada";for(let[e,s]of Q)s.el.toggleAttribute("data-current",e===J);Yt(),P(ue),P(qe)}function qe(){let e=[...g.clients.values()].map((a)=>{let r=g.queueOf(a.id).length,o=a.runtime.running.length,i=a.desk?.pending.length??0,c=g.bus.isOnline(a.id),p=d("button",{type:"button","aria-pressed":String(a.id===J),"data-client-tab":a.id},d("span",{class:"dot","data-kind":c?o||i?"busy":"idle":"error","aria-hidden":"true"}),a.name,r?d("span",{class:"badge",title:`${r} queued`},String(r)):null,o?d("span",{class:"badge"},"working"):null,i?d("span",{class:"badge"},"asks you"):null,c?null:d("span",{class:"visually-hidden"}," (offline)"));return p.addEventListener("click",()=>tt(a.id)),p}),s=d("button",{type:"button",class:"add","aria-label":"Add a client"},f(l.Plus),"Add");s.addEventListener("click",()=>{Ze.open=!0,I("#chat-add").focus()}),Bn.replaceChildren(...e,s)}function tt(e){J=e;for(let[s,a]of Q)a.el.toggleAttribute("data-current",s===e);qe()}function Wn(e){let s=ie[e.kind],a=d("article",{class:"chat-client card","aria-label":e.name,"data-client":e.id,"data-current":e.id===J}),r=d("span",{class:"chat-chip"}),o=d("span",{class:"chat-roles"}),i=d("p",{class:"chat-small"}),c=he("Go offline",()=>{g.setOnline(e.id,!g.bus.isOnline(e.id)),P(M),P(qe)}),p=he("Leave",()=>g.removeClient(e.id)),h=d("details",{class:"chat-client-options"},d("summary",{"aria-label":`Options for ${e.name}`},"Options"),d("div",{class:"chat-client-options-body"},i,d("div",{class:"chat-row"},c,p))),k=d("header",{},d("h3",{},e.name),r,o,h),u=d("div",{class:"chat-client-body"});a.append(k,u),Nt.append(a);let b=Tn.has(e.kind),w=b||e.kind==="viewer"?d("ol",{class:"chat-transcript","aria-label":`What ${e.name} sees`,"aria-live":"off"}):null,S=e.desk?d("div",{class:"chat-questions"}):null,_=b?Qn(e):null,C=s.tools.length&&!b?d("div",{class:"chat-tools"}):null,V=s.tools.length&&!b?zn(e):null;u.append(...[w,S,_?.el,C,V].filter((H)=>!!H));let M=()=>{if(g.clients.get(e.id)!==e)return;let H=e.session,B=g.bus.isOnline(e.id)?H.isActive("live")?"live":H.isActive("syncing")?"catching up":H.isActive("joining")?"joining":"left":"offline",D=H.datamodel.evaluate("granted")??[];if(r.textContent=B,r.dataset.kind=B==="live"?"idle":B==="offline"?"error":"busy",o.textContent=D.length?D.join(" · "):"watches",i.textContent=`${s.blurb} Has seen ${e.view.seq} of ${g.log.seq} log entries.`,c.textContent=g.bus.isOnline(e.id)?"Go offline":"Go online",w)Jn(w,e.view);if(C)Yn(C,e);if(S&&e.desk)Xn(S,e);_?.render()},A=()=>{P(M),P(qe)};return e.view.addEventListener("change",A),e.session.addEventListener("macrostep",()=>{Ie++,A()}),e.desk?.addEventListener("change",A),M(),{el:a,render:M}}function Qn(e){let s=document.createElement("chat-prompt");s.setAttribute("label",`Message from ${e.name}`),s.setAttribute("placeholder",`Message as ${e.name}…`);let a=(o)=>o.detail;return s.addEventListener("prompt-submit",(o)=>g.type(e.id,a(o).text)),s.addEventListener("prompt-steer",(o)=>g.type(e.id,a(o).text,!0)),s.addEventListener("prompt-stop",()=>g.interrupt(e.id)),s.addEventListener("prompt-queue-edit",(o)=>g.editQueued(e.id,a(o).id)),s.addEventListener("prompt-queue-remove",(o)=>g.removeQueued(e.id,a(o).id)),e.panel.addEventListener("restore",(o)=>s.appendText(a(o))),{el:s,render:()=>{let o=e.session,i=o.datamodel.evaluate("granted")??[];s.disabled=o.isActive("readonly")||o.isActive("left"),s.busy=o.isActive("host-busy")||o.isActive("sending"),s.canSteer=i.includes("control"),s.canStop=i.includes("control"),s.queue=g.queueOf(e.id);let c=o.isActive("rejected")?String(o.datamodel.evaluate("rejection")):"",p=e.view.steers.filter((h)=>h.author===e.name).length;s.status=c?`Refused: ${c}.`:s.disabled?`${e.name} may not type (no input role).`:p?`${p} steer${p>1?"s":""} on the way to the model (with the next tool results, or as the next turn).`:""}}}function Vn(e,s){if(e.packages?.length)return e.packages;let a=e.status==="ready"?"ready":e.status==="failed"?"failed":"waiting";return(X[s]??[]).map((r)=>({...v[r],phase:a,cached:!1,shared:!1,downloadedBytes:0,totalBytes:null,percent:a==="ready"?100:null}))}function Me(e){let s=new Map,a=[];for(let[r,o]of Object.entries(e.runtime.tools)){if(!o.real||!X[r])continue;let i=e.runtime.realState(r);a.push(i);for(let c of Vn(i,r))s.set(c.id,c)}return{packages:[...s.values()],states:a}}function ze(e){let s=0,a=0,r=!0;for(let o of e){if(o.cached||o.shared)continue;let i=o.totalBytes??o.approxBytes;if(o.totalBytes===null&&o.phase!=="ready")r=!1;a+=i,s+=o.phase==="loading"||o.phase==="ready"?i:o.downloadedBytes}return{done:s,total:a,percent:a===0?100:r||s>0?Math.min(100,Math.round(s/a*100)):null}}function Ut(e,s){for(let a of g.clients.values()){if(a===e)continue;if(Me(a).packages.find((o)=>o.id===s&&o.phase==="ready"&&!o.shared))return a.name}return}function Ht(e,s,a){switch(e.phase){case"waiting":return"waiting";case"resolving":return"looking it up";case"downloading":return`downloading ${j(e.downloadedBytes)} of ${j(e.totalBytes??e.approxBytes)}`;case"loading":return"starting";case"ready":return e.cached?"ready, from this browser's cache":e.shared?`ready, shared with ${Ut(s,e.id)??"another client"}`:"ready";case"failed":return`failed${a?`: ${a}`:""}`}}function Un(e,s){let a=s.filter((h)=>h.phase==="ready"||Ut(e,h.id)),r=s.filter((h)=>!a.includes(h)),o=r.reduce((h,k)=>h+k.approxBytes,0),i=[...g.clients.values()].some((h)=>h!==e&&Me(h).states.some((k)=>k.status!=="idle")),c=a.length?` (${a.map((h)=>h.label).join(" and ")} already here)`:"",p=i?"":` plus the ${j(F.approxBytes)} Wasmer runtime the first time`;return r.length?`Downloads about ${j(o)}${c} once, then cached${p?`,${p}`:""}. Runs in WebAssembly, in this tab.`:`Nothing to download${c}. Runs in WebAssembly, in this tab.`}function Ge(e,s,a){if(s===null&&a)e.removeAttribute("value");else e.value=s??0}function zn(e){let s=d("div",{class:"chat-client-tools"}),{runtime:a}=e;if(a.hasReal){let o=`tools-mode-${e.id}`,i=(B,D,Z)=>{let ae=d("input",{type:"radio",name:o,value:B,checked:a.mode===B});return ae.addEventListener("change",()=>ae.checked&&a.setMode(B)),d("label",{class:"chat-mode-option"},ae,d("span",{},d("strong",{},D),d("small",{},Z)))},c=d("small",{}),p=i("real","Real","");p.querySelector("small").replaceWith(c);let h=d("fieldset",{class:"chat-tools-mode"},d("legend",{},"Tools"),i("simulated","Simulated","Canned answers, instant. Nothing to download."),p),k=d("span",{class:"chat-dl-total-text"}),u=d("progress",{max:"100","aria-label":`${e.name}: all downloads`}),b=he("Try again",()=>a.setMode("real")),w=d("ul",{class:"chat-dl-rows"}),S=d("div",{class:"chat-dl-detail"},d("p",{class:"chat-dl-total"},k,u),w,b),_=d("p",{class:"visually-hidden","aria-live":"polite"}),C=d("p",{class:"chat-credit"},"Real tools run on ",d("a",{href:"https://wasmer.io"},"Wasmer"),", in WebAssembly."),V=new Map,M=new Map,A="",H=()=>{if(g.clients.get(e.id)!==e)return;let{packages:B,states:D}=Me(e),Z=D.find((E)=>E.status==="failed"),ae=D.some((E)=>E.status==="loading"),at=D.length>0&&D.every((E)=>E.status==="ready"),O=Z?"failed":ae?"loading":at?"ready":"idle";c.textContent=at?"Downloaded and running, in WebAssembly in this tab.":Un(e,B),S.hidden=O==="idle"&&a.mode!=="real";let re=ze(B);k.textContent=O==="ready"?"Ready.":O==="failed"?`Download failed: ${Z?.error??"unknown error"}`:O==="loading"?`Downloading ${j(re.done)} of about ${j(re.total)}${re.percent===null?"":` · ${re.percent}%`}`:"Waiting to start.",u.hidden=O==="ready",Ge(u,re.percent,O==="loading"),b.hidden=O!=="failed";for(let E of B){let z=V.get(E.id);if(!z){let ot=d("progress",{max:"100","aria-label":`${E.label} download`}),it=d("span",{class:"chat-dl-words"}),lt=d("li",{},d("span",{class:"chat-dl-name"},E.label),d("span",{class:"chat-dl-size"},j(E.approxBytes)),ot,it);z={li:lt,bar:ot,words:it},V.set(E.id,z),w.append(lt)}z.li.dataset.phase=E.phase;let rt=Ht(E,e,Z?.error);if(z.words.textContent!==rt)z.words.textContent=rt;if(Ge(z.bar,E.phase==="ready"?100:E.phase==="loading"?null:E.percent,E.phase!=="waiting"&&E.phase!=="failed"),M.get(E.id)!==E.phase){if(M.set(E.id,E.phase),E.phase!=="waiting")_.textContent=`${e.name}, ${E.label}: ${E.phase==="downloading"?"downloading":Ht(E,e,Z?.error)}`}}if(O!==A){if(O==="ready")_.textContent=`${e.name}: real tools ready`;A=O}};nt.add(H),a.addEventListener("change",zt),H(),s.append(h,S,_,C)}let r=d("details",{class:"chat-knobs"},d("summary",{},a.hasReal?"Simulation knobs (latency, failures)":"Simulation knobs"));s.append(r);for(let[o,i]of e.runtime.knobs){let c=d("input",{type:"number",min:"0",step:"100",value:String(i.latencyMs),"aria-label":`${o} latency in ms`});c.addEventListener("change",()=>i.latencyMs=Number(c.value)||0);let p=d("input",{type:"checkbox",checked:i.failNext});p.addEventListener("change",()=>i.failNext=p.checked);let h=d("input",{type:"checkbox",checked:i.hang});h.addEventListener("change",()=>i.hang=h.checked),r.append(d("div",{class:"chat-row"},d("code",{},o),d("label",{},"latency ",c," ms"),d("label",{},p," fail next call"),d("label",{},h," hang")))}return s}var nt=new Set;function zt(){for(let e of nt)P(e);P(Gn)}function Gn(){if(!g)return;let e=[...g.clients.values()].map((o)=>({c:o,...Me(o)})).filter(({c:o,states:i})=>i.some((c)=>c.status==="loading"||c.status==="failed"&&o.runtime.mode==="real"));if(Qe.hidden=e.length===0,!e.length){ce.hidden=!0,de.setAttribute("aria-expanded","false");return}let s=new Map;for(let o of e)for(let i of o.packages)s.set(i.id,i);let a=ze([...s.values()]),r=e.filter((o)=>o.states.some((i)=>i.status==="failed"));Qe.dataset.state=r.length?"failed":"loading",An.textContent=r.length?`Download failed: ${r.map((o)=>o.c.name).join(", ")}`:`Downloading ${j(a.done)} of ${j(a.total)}${a.percent===null?"":` · ${a.percent}%`}`,Ge(At,a.percent,!r.length),At.hidden=r.length>0,ce.replaceChildren(...e.map(({c:o,packages:i,states:c})=>{let p=ze(i),h=c.find((u)=>u.status==="failed")?"failed":`${p.percent??0}%`,k=he(`Show ${o.name}`,()=>{Zt("chat"),tt(o.id),Q.get(o.id)?.el.scrollIntoView({block:"start",behavior:"smooth"}),ce.hidden=!0,de.setAttribute("aria-expanded","false")});return d("li",{},d("span",{},`${o.name}: ${h}`),k)}))}de.addEventListener("click",()=>{let e=de.getAttribute("aria-expanded")!=="true";de.setAttribute("aria-expanded",String(e)),ce.hidden=!e});function Xn(e,s){let a=s.desk;if(!a.pending.length){e.replaceChildren();return}let r=a.pending[0],o=d("input",{type:"text","aria-label":`${s.name}'s answer`,placeholder:"Your answer"}),i=()=>o.value.trim()&&r.answer(o.value.trim());o.addEventListener("keydown",(c)=>c.key==="Enter"&&i()),e.replaceChildren(d("p",{},d("strong",{},"The model asks you: "),r.question),d("div",{class:"chat-row"},o,he("Answer",i)))}function Yn(e,s){let a=s.view.items.flatMap((o)=>o.type==="tools"?o.calls.filter((i)=>i.provider===s.id).map((i)=>({...i,card:o})):[]),r=new Set(s.runtime.running);e.replaceChildren(a.length?d("ol",{class:"chat-calls"},...a.slice(-4).map((o)=>d("li",{"data-status":r.has(o.id)?"running":o.status,...Gt(o.status,o.card)},d("code",{},o.name),` ${r.has(o.id)?"running…":o.status}`,o.content?d("pre",{},o.content):null))):d("p",{class:"chat-small"},"No calls yet. Ask the model something this tool can do."))}function Gt(e,s){if(e!=="running"||s.armedAt===void 0||s.deadline===void 0)return{};return{"data-armed":String(s.armedAt),"data-deadline":String(s.deadline)}}function Xt(){let e=T?.now()??0;for(let s of document.querySelectorAll("[data-deadline]")){let a=Number(s.dataset.armed),r=Number(s.dataset.deadline),o=Math.min(1,Math.max(0,(e-a)/(r-a)));s.style.setProperty("--timeout",o.toFixed(4)),s.toggleAttribute("data-late",o>0.75),s.title=`times out in ${Math.max(0,Math.ceil((r-e)/1000))} s (simulated time)`}requestAnimationFrame(Xt)}requestAnimationFrame(Xt);function Jn(e,s){let a=e.scrollHeight-e.scrollTop-e.clientHeight<40;if(e.replaceChildren(...s.items.map(Zn)),a)e.scrollTop=e.scrollHeight}function Zn(e){switch(e.type){case"user":return d("li",{class:"msg user","data-steer":e.steer},d("span",{class:"who"},e.steer?`${e.author} (steer)`:e.author),d("span",{class:"text"},e.text));case"assistant":return d("li",{class:"msg assistant","data-status":e.status},d("span",{class:"who"},e.status==="discarded"?`model (dropped: ${e.note??""})`:"model"),...e.blocks.map((s)=>s.kind==="tool_use"?d("span",{class:"call"},"calls ",d("code",{},s.name??"?"),d("code",{class:"json"},s.json??"")):d("span",{class:`text ${s.kind}`},s.text)),e.status==="streaming"?d("span",{class:"cursor","aria-hidden":"true"},"▍"):null);case"tools":return d("li",{class:"msg tools"},d("span",{class:"who"},e.calls.length>1?`${e.calls.length} tool calls, in parallel`:"1 tool call"),d("ul",{},...e.calls.map((s)=>d("li",{"data-status":s.status,...Gt(s.status,e)},d("code",{},s.name),` on ${s.provider?g.clients.get(s.provider)?.name??s.provider:"nobody"}: ${s.status}`,s.content?d("pre",{},s.content):null))));default:return d("li",{class:"msg notice","data-level":e.level},e.text)}}function Yt(){let e=me.value||"host",s=[["host","Host"],...[...g.clients.values()].map((a)=>[a.id,a.name]),["workspace","Workspace (downloads)"]];if(g.director)s.push(["scenario","Scenario"]);if(me.replaceChildren(...s.map(([a,r])=>d("option",{value:a,selected:a===e},r))),!s.some(([a])=>a===e))Te("host")}function Te(e){let s,a;if(e==="host")s=g.host,a=[g.bus,g.log];else if(e==="workspace")s=g.workspace,a=[g.workspaceLink];else if(e==="scenario"&&g.director)s=g.director,a=[];else{let r=g.clients.get(e);if(!r){Te("host");return}s=r.session,a=[g.bus,r.runtime]}me.value=e,Ft.attach({session:s,processors:a,clock:T})}var es={"client.hello":()=>"joins and asks for roles",welcome:()=>"is admitted",snapshot:()=>"gets everything so far","client.resync":()=>"missed something, asks for a snapshot","client.bye":()=>"leaves","input.submit":()=>"sends a message","input.steer":()=>"steers","input.interrupt":()=>"asks to stop","input.accepted":(e)=>{let s=e.data;return s.steer?"steer held for the next boundary":s.queued?"message held until the turn ends":"message starts a turn"},"input.rejected":(e)=>{let s=e.data;return s.code==="busy"?"busy: another message got there first; back to the head of its queue":`refused: ${s.reason}`},"host.busy":()=>"a turn started: new messages wait in their queues","host.idle":(e)=>{let s=e.data.stoppedBy;return s?`idle (stopped by ${g.clients.get(s)?.name??s}): queues may send`:"idle: the next queued message may go"},"tool.call":(e)=>`run ${e.data.name}`,"tool.cancel":()=>"cancel that call","tool.result":(e)=>e.data.isError?"tool failed":"tool result","roles.changed":(e)=>`roles now: ${e.data.granted.join(", ")||"none"}`,"log.batch":(e)=>{let s=e.data;return`log entries ${s.first}–${s.last}`}},Xe=I("#chat-batches");function ts(e){if(e.event==="log.batch"&&!Xe.checked)return;if(e.from==="ui")return;let s=(a)=>a==="host"?"Host":g.clients.get(a)?.name??a;Jt(d("li",{"data-dropped":e.dropped??!1},d("span",{class:"tl-at"},Vt(e.at)),d("span",{class:"tl-route"},`${s(e.from)} → ${s(e.to)}`),d("code",{},e.event),d("span",{class:"tl-gloss"},`${es[e.event]?.(e)??""}${e.dropped?` (dropped: ${e.dropped})`:""}`)))}function Jt(e){let s=K.scrollHeight-K.scrollTop-K.clientHeight<40;K.append(e);while(K.childElementCount>400)K.firstElementChild?.remove();if(s)K.scrollTop=K.scrollHeight}function he(e,s,a={}){let r=d("button",{type:"button",disabled:!!a.disabled},e);return r.addEventListener("click",s),r}function Dt(){if(!T)return;let e=T.playing;if(ne.dataset.playing!==String(e))ne.dataset.playing=String(e),ne.replaceChildren(f(e?l.Pause:l.Play,18)),ne.setAttribute("aria-label",e?"Pause":"Play"),ne.title=e?"Pause (the whole system)":"Play";for(let s of Wt)s.checked=Number(s.value)===T.speed;if(Number(we.value)!==T.speed)we.value=String(T.speed);Rn.textContent=`${(T.now()/1000).toFixed(1)} s`}ne.addEventListener("click",()=>T.toggle());Je.prepend(f(l.StepForward));Je.title="Pause, then run until something changes";Je.addEventListener("click",()=>{let e=Ie;T.step(()=>Ie>e)});for(let e of Wt)e.addEventListener("change",()=>T.speed=Number(e.value));we.addEventListener("change",()=>T.speed=Number(we.value));function Zt(e){Pn.dataset.view=e;for(let s of document.querySelectorAll(".chat-views button"))s.setAttribute("aria-pressed",String(s.dataset.view===e))}for(let e of document.querySelectorAll(".chat-views button"))e.addEventListener("click",()=>Zt(e.dataset.view));Ze.open=Ee.matches;var st=I("#chat-scenario");st.append(...Object.entries(xe).map(([e,s])=>d("option",{value:e},s.title)));I("#chat-run").addEventListener("click",()=>void et(st.value||void 0));I("#chat-reset").addEventListener("click",()=>void et());var en=I("#chat-add");en.append(...Object.values(ie).map((e)=>d("option",{value:e.kind,title:e.blurb},e.name)));I("#chat-add-button").addEventListener("click",async()=>{let e=await g.addClient(en.value);if(tt(e.id),!Ee.matches)Ze.open=!1});me.addEventListener("change",()=>Te(me.value));Xe.addEventListener("change",()=>pe(Xe.checked?"The timeline now shows log batches too.":"Log batches hidden."));var Ye=Se.get("scenario")??void 0;if(Ye)st.value=Ye;et(Ye);window.llmChat=()=>g;export{ve,v,F,n,te};
