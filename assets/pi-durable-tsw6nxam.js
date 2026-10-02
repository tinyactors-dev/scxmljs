import"./chunk-n3g1hjg9.js";import"./chunk-7c7mhb7g.js";import{a,c}from"./chunk-zg14dymx.js";import{E}from"./chunk-mesna8e0.js";import{m}from"./chunk-166w1z2n.js";import{x}from"./chunk-s938p6mw.js";m(import.meta.url,["tsw6nxam","n3g1hjg9","7c7mhb7g","zg14dymx","mesna8e0","166w1z2n","s938p6mw","vzf0jxfz","exssp3t2","f5dnz9k9","nghx4der","k1ce4eyz"],[["./pi-durable-tsw6nxam.js",1,2,3,4,5,6],["./chunk-n3g1hjg9.js",6],["./chunk-7c7mhb7g.js",5,10],["./chunk-zg14dymx.js"],["./chunk-mesna8e0.js",2,6],["./chunk-166w1z2n.js"],["./chunk-s938p6mw.js"],["./chunk-vzf0jxfz.js"],["./chunk-exssp3t2.js"],["./chunk-f5dnz9k9.js",11],["./chunk-nghx4der.js"],["./chunk-k1ce4eyz.js"]],0);
var ct=`<?xml version="1.0" encoding="UTF-8"?>
<!--
  shop.checkout: the post's checkout that splits the bill across several cards.

    defineTask({ name: "shop.checkout", version: 1, initial: () => ({ phase: "pay" }), phases: { pay, decide }, abort })

  pay      in one commit: one shop.payment task per card, owned by this task, and the state
           "waiting" on all of them with policy failFast. No code runs until every payment
           is done; the first failed payment aborts the others, which refund themselves.
  decide   runtime.outcomes(payments): all completed → "Order placed.", else failed.

  The lifecycle around the phases is the same in every task chart; see tool.scxml.
-->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="shop.checkout" initial="recover">
  <datamodel>
    <data id="task" expr="null"/>
    <data id="now" expr="0"/>
    <data id="cp" expr="null"/>
  </datamodel>

  <state id="recover">
    <onentry><assign location="cp" expr="task.state.checkpoint || null"/></onentry>
    <transition cond="task.state.status === 'terminal'" target="terminal"/>
    <transition cond="task.state.status === 'completing'" target="completing"/>
    <transition cond="task.abortRequested" target="aborting"/>
    <transition cond="task.state.status === 'waiting'" target="waiting"/>
    <transition target="running"/>
  </state>

  <state id="live" initial="running">
    <transition event="task.abort" target="aborting"/>

    <state id="running" initial="route">
      <state id="route">
        <transition cond="cp.phase === 'decide'" target="decide"/>
        <transition target="pay"/>
      </state>

      <state id="pay">
        <onentry>
          <send type="durable" event="checkout.pay"><param name="policy" expr="'failFast'"/></send>
        </onentry>
        <transition target="waiting"/>
      </state>

      <state id="decide">
        <invoke type="outcomes" id="outcomes">
          <param name="ids" expr="cp.payments"/>
        </invoke>
        <transition event="done.invoke.outcomes" cond="_event.data.every(function (o) { return o.status === 'completed'; })" target="completing">
          <send type="durable" event="task.complete"><param name="result" expr="'Order placed.'"/></send>
        </transition>
        <transition event="done.invoke.outcomes" target="completing">
          <send type="durable" event="task.fail"><param name="message" expr="'A payment failed.'"/></send>
        </transition>
      </state>
    </state>

    <state id="waiting">
      <transition event="task.wake" target="running">
        <assign location="cp" expr="_event.data.checkpoint"/>
      </transition>
    </state>

    <state id="completing">
      <transition event="task.terminal" target="terminal"/>
    </state>
  </state>

  <!-- aborted (the call that owns it was): the payments abort first and refund, then this -->
  <state id="aborting" initial="draining">
    <state id="draining">
      <transition event="task.drained" target="handler"/>
    </state>
    <state id="handler">
      <onentry><send type="durable" event="task.aborted"/></onentry>
      <transition event="task.terminal" target="terminal"/>
    </state>
  </state>

  <final id="terminal"/>
</scxml>
`;var lt=`<?xml version="1.0" encoding="UTF-8"?>
<!--
  A client: a person's screen on another machine, attached to one conversation.

    const view = await thread.viewState(context);   render(view.value);
    view.subscribe((value) => render(value));
    await thread.submit({ type: "input", content, whenBusy: "steer" }, context);

  link        offline (no process is up) → attaching (asks for the current view: the transcript,
              the answer being streamed, running tools and their output, queued messages, the
              agent, usage) → live (after that, only each commit's operations). A client that
              joins late or reconnects starts from the current view; nothing is replayed.
  composer    every message carries a requestId. Whatever was sent but not answered is sent
              again, with the same requestId, whenever the link comes back: the harness returns
              the original submission instead of asking twice.

  I/O processor \`wire\` (src/wire.ts): attach, submit, abort, compact, fork → the process;
  view, ops, submitted, rejected, forked ← the process; wire.up / wire.down ← the link.
  The page sends ui.* events (the person's clicks).
-->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="client" initial="client">
  <datamodel>
    <data id="clientId" expr="'you'"/>
    <data id="name" expr="'You'"/>
    <data id="conversationId" expr="'c1'"/>
    <!-- the conversation as this client knows it: the attach view, plus every op since -->
    <data id="view" expr="null"/>
    <data id="frames" expr="0"/>
    <data id="ops" expr="0"/>
    <!-- requestId → { requestId, text, whenBusy, status: sending | admitted | rejected, submissionId?, duplicate?, reason? } -->
    <data id="requests" expr="[]"/>
    <data id="counter" expr="0"/>
  </datamodel>

  <script>
    function apply(list) {
      for (var i = 0; i &lt; list.length; i++) {
        var op = list[i];
        if (op.op === "entry") view.entries.push(op.entry);
        else if (op.op === "doc") view.docs[op.name] = op.value;
        else if (op.op === "head") {
          var at = -1;
          for (var j = 0; j &lt; view.entries.length; j++) if (view.entries[j].id === op.first) at = j;
          for (var k = 0; k &lt; view.entries.length; k++) view.entries[k].active = op.first === null || k >= at;
        } else if (op.op === "submission") {
          var found = false;
          for (var s = 0; s &lt; view.submissions.length; s++)
            if (view.submissions[s].id === op.record.id) { view.submissions[s] = op.record; found = true; }
          if (!found) view.submissions.push(op.record);
        }
      }
    }
    function request(id) {
      for (var i = 0; i &lt; requests.length; i++) if (requests[i].requestId === id) return requests[i];
      return null;
    }
    /** Answered (or given up on) by the harness: nothing left to wait for. */
    function settled(r) {
      if (r.status === "rejected") return true;
      if (!r.submissionId || !view) return false;
      for (var i = 0; i &lt; view.submissions.length; i++) {
        var s = view.submissions[i];
        if (s.id === r.submissionId) return s.status === "done" || s.status === "unanswered";
      }
      return false;
    }
    function unanswered() {
      return requests.filter(function (r) { return r.conversationId === conversationId &amp;&amp; !settled(r); });
    }
  </script>

  <parallel id="client">
    <state id="link" initial="offline">
      <transition event="wire.down" target="offline"/>

      <state id="offline">
        <transition event="wire.up" target="attaching"/>
      </state>

      <state id="attaching">
        <onentry>
          <send type="wire" event="attach"><param name="conversationId" expr="conversationId"/></send>
        </onentry>
        <transition event="view" target="live">
          <assign location="view" expr="_event.data.view"/>
          <assign location="frames" expr="frames + 1"/>
        </transition>
      </state>

      <state id="live">
        <!-- (re)attached: retry what was never answered, with the same requestId -->
        <onentry>
          <foreach array="unanswered()" item="r">
            <send type="wire" event="submit">
              <param name="conversationId" expr="r.conversationId"/>
              <param name="requestId" expr="r.requestId"/>
              <param name="text" expr="r.text"/>
              <param name="whenBusy" expr="r.whenBusy"/>
              <param name="author" expr="name"/>
            </send>
          </foreach>
        </onentry>
        <transition event="ops">
          <script>apply(_event.data.ops);</script>
          <assign location="view.seq" expr="_event.data.seq"/>
          <assign location="frames" expr="frames + 1"/>
          <assign location="ops" expr="ops + _event.data.ops.length"/>
        </transition>
        <transition event="ui.switch" target="attaching">
          <assign location="conversationId" expr="_event.data.conversationId"/>
          <assign location="view" expr="null"/>
        </transition>
        <transition event="forked" target="attaching">
          <assign location="conversationId" expr="_event.data.conversationId"/>
          <assign location="view" expr="null"/>
        </transition>
        <transition event="ui.abort">
          <send type="wire" event="abort"><param name="conversationId" expr="conversationId"/></send>
        </transition>
        <transition event="ui.compact">
          <send type="wire" event="compact">
            <param name="conversationId" expr="conversationId"/>
            <param name="instructions" expr="_event.data.instructions"/>
          </send>
        </transition>
        <transition event="ui.fork">
          <send type="wire" event="fork">
            <param name="conversationId" expr="conversationId"/>
            <param name="at" expr="_event.data.at"/>
            <param name="title" expr="_event.data.title"/>
          </send>
        </transition>
      </state>
    </state>

    <state id="composer">
      <transition event="ui.submit">
        <assign location="counter" expr="counter + 1"/>
        <script>
          requests.push({
            requestId: _event.data.requestId || (clientId + "-" + counter),
            conversationId: conversationId,
            text: _event.data.text,
            whenBusy: _event.data.whenBusy || "followUp",
            status: "sending"
          });
        </script>
        <if cond="In('live')">
          <send type="wire" event="submit">
            <param name="conversationId" expr="conversationId"/>
            <param name="requestId" expr="requests[requests.length - 1].requestId"/>
            <param name="text" expr="_event.data.text"/>
            <param name="whenBusy" expr="_event.data.whenBusy || 'followUp'"/>
            <param name="author" expr="name"/>
          </send>
        </if>
      </transition>
      <transition event="submitted">
        <script>
          var r = request(_event.data.requestId);
          if (r) { r.status = "admitted"; r.submissionId = _event.data.submissionId; r.duplicate = r.duplicate || _event.data.duplicate; }
        </script>
      </transition>
      <transition event="rejected">
        <script>
          var r = request(_event.data.requestId);
          if (r) { r.status = "rejected"; r.reason = _event.data.reason; }
        </script>
      </transition>
    </state>
  </parallel>
</scxml>
`;var pt=`<?xml version="1.0" encoding="UTF-8"?>
<!--
  pi.compaction: summarize older messages, as a durable task
  (packages/durable/src/harness/compaction.ts).

  Checkpoints: {phase: "select"} | {phase: "summarize", firstKept}

  Who owns it decides how it runs:
    background threshold   owned by the conversation, background: the conversation keeps going;
                           the summary is a write submission, placed at the next turn boundary
    blocking threshold     owned by the generation that needs it, which waits
    manual (compact())     owned by the conversation, foreground: Esc aborts it
  The older messages always stay in storage; the summary is a head marker.

  The lifecycle around the phases is the same in every task chart; see tool.scxml.
-->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="pi.compaction" initial="recover">
  <datamodel>
    <data id="task" expr="null"/>
    <data id="now" expr="0"/>
    <data id="cp" expr="null"/>
  </datamodel>

  <state id="recover">
    <onentry><assign location="cp" expr="task.state.checkpoint || null"/></onentry>
    <transition cond="task.state.status === 'terminal'" target="terminal"/>
    <transition cond="task.state.status === 'completing'" target="completing"/>
    <transition cond="task.abortRequested" target="aborting"/>
    <transition cond="task.state.status === 'waiting'" target="waiting"/>
    <transition target="running"/>
  </state>

  <state id="live" initial="running">
    <transition event="task.abort" target="aborting"/>

    <state id="running" initial="route">
      <state id="route">
        <transition cond="cp.phase === 'summarize'" target="summarize"/>
        <transition target="select"/>
      </state>

      <!-- where to cut: keep the most recent messages, summarize the rest -->
      <state id="select">
        <invoke type="compaction-select" id="select"/>
        <transition event="done.invoke.select" cond="!_event.data.firstKept" target="completing">
          <send type="durable" event="compaction.nothing"/>
        </transition>
        <transition event="done.invoke.select" target="summarize">
          <send type="durable" event="task.checkpoint">
            <param name="checkpoint" expr="({ phase: 'summarize', firstKept: _event.data.firstKept })"/>
          </send>
          <assign location="cp" expr="({ phase: 'summarize', firstKept: _event.data.firstKept })"/>
        </transition>
      </state>

      <state id="summarize">
        <invoke type="model" id="summary">
          <param name="firstKept" expr="cp.firstKept"/>
        </invoke>
        <transition event="done.invoke.summary" cond="_event.data.ok" target="completing">
          <send type="durable" event="compaction.place">
            <param name="summary" expr="_event.data.text"/>
            <param name="firstKept" expr="cp.firstKept"/>
          </send>
        </transition>
        <transition event="done.invoke.summary" target="completing">
          <send type="durable" event="task.fail"><param name="message" expr="_event.data.error"/></send>
        </transition>
      </state>
    </state>

    <state id="waiting">
      <transition event="task.wake" target="running">
        <assign location="cp" expr="_event.data.checkpoint"/>
      </transition>
    </state>

    <state id="completing">
      <transition event="task.terminal" target="terminal"/>
    </state>
  </state>

  <state id="aborting" initial="draining">
    <state id="draining">
      <transition event="task.drained" target="handler"/>
    </state>
    <state id="handler">
      <onentry><send type="durable" event="task.aborted"/></onentry>
      <transition event="task.terminal" target="terminal"/>
    </state>
  </state>

  <final id="terminal"/>
</scxml>
`;var ut=`<?xml version="1.0" encoding="UTF-8"?>
<!--
  pi.generation: one model request, as a durable task (packages/durable/src/harness/generation.ts).

  Checkpoints: {phase: "prepare", attempt, compacted?} | {phase: "request", attempt}
             | {phase: "retry", attempt, until} | {phase: "tools", assistant}

  prepare   render the system prompt sections and count the context. Close to the window: a
            blocking compaction (owned by this task; it waits for it), or a background one
            (owned by the conversation; nobody waits). Then commit "request".
  request   stream the answer; partials are committed to pi.live as they arrive. A request cut
            off by a crash is sent again; the partial answer stays in the transcript, marked
            aborted. The response decides: tool calls (a tool round: one pi.tool task per
            call, owned by this task, waited on with allSettled), an answer (the run's final
            boundary), a retryable error (a timer stored in the checkpoint), or failure.
  tools     the round is over: the postTools boundary places queued steers, and the next
            generation continues the run.

  The lifecycle around the phases is the same in every task chart; see tool.scxml.
-->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="pi.generation" initial="recover">
  <datamodel>
    <data id="task" expr="null"/>
    <data id="now" expr="0"/>
    <data id="cp" expr="null"/>
    <data id="maxAttempts" expr="3"/>
  </datamodel>

  <script>
    function backoff(attempt) { return 1500 * attempt; }
    /** A retry timer survives restarts: its deadline is in the checkpoint. */
    function retryDelay() { return cp.until ? Math.max(0, cp.until - now) : backoff(cp.attempt); }
  </script>

  <state id="recover">
    <onentry><assign location="cp" expr="task.state.checkpoint || null"/></onentry>
    <transition cond="task.state.status === 'terminal'" target="terminal"/>
    <transition cond="task.state.status === 'completing'" target="completing"/>
    <transition cond="task.abortRequested" target="aborting"/>
    <transition cond="task.state.status === 'waiting'" target="waiting"/>
    <transition target="running"/>
  </state>

  <state id="live" initial="running">
    <transition event="task.abort" target="aborting"/>

    <state id="running" initial="route">
      <state id="route">
        <transition cond="cp.phase === 'request'" target="request"/>
        <transition cond="cp.phase === 'retry'" target="retry"/>
        <transition cond="cp.phase === 'tools'" target="tools"/>
        <transition target="prepare"/>
      </state>

      <state id="prepare">
        <invoke type="prepare" id="prepare"/>
        <transition event="done.invoke.prepare" cond="_event.data.blocking &amp;&amp; !cp.compacted" target="waiting">
          <send type="durable" event="generation.compactBlocking"><param name="attempt" expr="cp.attempt"/></send>
        </transition>
        <transition event="done.invoke.prepare" target="request">
          <send type="durable" event="generation.request">
            <param name="attempt" expr="cp.attempt"/>
            <param name="background" expr="_event.data.background"/>
          </send>
          <assign location="cp" expr="({ phase: 'request', attempt: cp.attempt })"/>
        </transition>
      </state>

      <state id="request">
        <!-- after a crash: the committed partial becomes an aborted pi.assistant entry -->
        <onentry><send type="durable" event="generation.convertPartial"/></onentry>
        <invoke type="model" id="model"/>
        <transition event="done.invoke.model" cond="_event.data.ok &amp;&amp; _event.data.toolCalls.length" target="waiting">
          <send type="durable" event="generation.toolRound">
            <param name="text" expr="_event.data.text"/>
            <param name="toolCalls" expr="_event.data.toolCalls"/>
          </send>
        </transition>
        <transition event="done.invoke.model" cond="_event.data.ok" target="completing">
          <send type="durable" event="generation.answer"><param name="text" expr="_event.data.text"/></send>
        </transition>
        <transition event="done.invoke.model" cond="_event.data.retryable &amp;&amp; cp.attempt &lt; maxAttempts" target="retry">
          <send type="durable" event="generation.retry">
            <param name="attempt" expr="cp.attempt"/>
            <param name="delayMs" expr="backoff(cp.attempt)"/>
            <param name="error" expr="_event.data.error"/>
          </send>
          <assign location="cp" expr="({ phase: 'retry', attempt: cp.attempt })"/>
        </transition>
        <transition event="done.invoke.model" target="completing">
          <send type="durable" event="generation.failed"><param name="error" expr="_event.data.error"/></send>
        </transition>
      </state>

      <state id="retry">
        <onentry><send event="retry.due" delayexpr="retryDelay() + 'ms'"/></onentry>
        <transition event="retry.due" target="prepare">
          <send type="durable" event="task.checkpoint">
            <param name="checkpoint" expr="({ phase: 'prepare', attempt: cp.attempt + 1 })"/>
          </send>
          <assign location="cp" expr="({ phase: 'prepare', attempt: cp.attempt + 1 })"/>
        </transition>
      </state>

      <!-- woken: every tool call of the round is terminal -->
      <state id="tools">
        <onentry><send type="durable" event="generation.postTools"/></onentry>
        <transition target="completing"/>
      </state>
    </state>

    <!-- parked, no code running: on its tool calls (allSettled), or on a blocking compaction -->
    <state id="waiting">
      <transition event="task.wake" target="running">
        <assign location="cp" expr="_event.data.checkpoint"/>
      </transition>
    </state>

    <state id="completing">
      <transition event="task.terminal" target="terminal"/>
    </state>
  </state>

  <!-- Esc: the tool calls abort first (bottom-up); then the inputs are settled "aborted" -->
  <state id="aborting" initial="draining">
    <state id="draining">
      <transition event="task.drained" target="handler"/>
    </state>
    <state id="handler">
      <onentry><send type="durable" event="generation.aborted"/></onentry>
      <transition event="task.terminal" target="terminal"/>
    </state>
  </state>

  <final id="terminal"/>
</scxml>
`;var mt=`<?xml version="1.0" encoding="UTF-8"?>
<!--
  The harness: one process's life over a storage.

    const harness = await Harness.open(storage, { models, registry, env }, context);
    harness.resume();

  opening       take ownership of the storage: one process owns a storage at a time
  reconciling   one commit, and no task code: every task the dead process left "running" goes
                back to "pending" with its checkpoint, abort marks stay
  open          paused until resume(); then the scheduler runs tasks (runs pending ones,
                wakes waiting ones whose tasks are done, cascades aborts)

  A crash is not a state of this chart: the process, and every session in it, is simply gone.
  The storage is not.
-->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="harness" initial="opening">
  <datamodel>
    <data id="process" expr="''"/>
    <data id="previousOwner" expr="null"/>
    <data id="recovered" expr="0"/>
  </datamodel>

  <state id="opening">
    <onentry><send type="durable" event="harness.acquire"/></onentry>
    <transition event="harness.acquired" target="reconciling">
      <assign location="previousOwner" expr="_event.data.previousOwner"/>
    </transition>
  </state>

  <state id="reconciling">
    <onentry><send type="durable" event="harness.reconcile"/></onentry>
    <transition event="harness.reconciled" target="open">
      <assign location="recovered" expr="_event.data.recovered"/>
    </transition>
  </state>

  <state id="open" initial="paused">
    <state id="paused">
      <transition event="resume" target="scheduling"/>
    </state>
    <state id="scheduling">
      <onentry><send type="durable" event="harness.resume"/></onentry>
    </state>
  </state>
</scxml>
`;var ht=`<?xml version="1.0" encoding="UTF-8"?>
<!--
  shop.payment: one card's charge, from the post.

  charge   bank.charge(card, "payment-" + task.id): the key makes the charge idempotent, so a
           rerun after a crash charges once. The outcome is "completed" with the receipt, or
           "failed".
  abort    another payment failed, or the checkout was aborted: refund this one, then commit
           "aborted". It runs only after the work this task owns has ended (it owns none).

  The lifecycle around the phases is the same in every task chart; see tool.scxml.
-->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="shop.payment" initial="recover">
  <datamodel>
    <data id="task" expr="null"/>
    <data id="now" expr="0"/>
    <data id="cp" expr="null"/>
  </datamodel>

  <state id="recover">
    <onentry><assign location="cp" expr="task.state.checkpoint || null"/></onentry>
    <transition cond="task.state.status === 'terminal'" target="terminal"/>
    <transition cond="task.state.status === 'completing'" target="completing"/>
    <transition cond="task.abortRequested" target="aborting"/>
    <transition cond="task.state.status === 'waiting'" target="waiting"/>
    <transition target="running"/>
  </state>

  <state id="live" initial="running">
    <transition event="task.abort" target="aborting"/>

    <state id="running" initial="charge">
      <state id="charge">
        <invoke type="bank" id="charge">
          <param name="op" expr="'charge'"/>
          <param name="card" expr="task.input.card"/>
          <param name="key" expr="'payment-' + task.id"/>
        </invoke>
        <transition event="done.invoke.charge" cond="_event.data.ok" target="completing">
          <send type="durable" event="task.complete"><param name="result" expr="_event.data.receipt"/></send>
        </transition>
        <transition event="done.invoke.charge" target="completing">
          <send type="durable" event="task.fail"><param name="message" expr="_event.data.error"/></send>
        </transition>
      </state>
    </state>

    <state id="waiting">
      <transition event="task.wake" target="running"/>
    </state>

    <state id="completing">
      <transition event="task.terminal" target="terminal"/>
    </state>
  </state>

  <state id="aborting" initial="draining">
    <state id="draining">
      <transition event="task.drained" target="refund"/>
    </state>
    <!-- the abort handler: undo this payment -->
    <state id="refund">
      <invoke type="bank" id="refund">
        <param name="op" expr="'refund'"/>
        <param name="key" expr="'payment-' + task.id"/>
      </invoke>
      <transition event="done.invoke.refund" target="handled">
        <send type="durable" event="task.aborted">
          <param name="reason" expr="_event.data.refunded ? 'refunded' : 'nothing to refund'"/>
        </send>
      </transition>
    </state>
    <state id="handled">
      <transition event="task.terminal" target="terminal"/>
    </state>
  </state>

  <final id="terminal"/>
</scxml>
`;var gt=`<?xml version="1.0" encoding="UTF-8"?>
<!--
  app.reminder: a background task with a timer that survives restarts.

  Created by the remind_me tool with { ownership: { kind: "conversation" }, background: true }:
  the conversation goes idle while it sleeps, and an ordinary abort (Esc) leaves it alone.

  sleep    the deadline is in the checkpoint ({phase: "sleep", until}); a new process sleeps
           for whatever is left.
  remind   submit the reminder to the conversation as a follow-up. Its requestId,
           "reminder:" + task.id, makes that exactly-once if a crash makes this phase rerun.

  The lifecycle around the phases is the same in every task chart; see tool.scxml.
-->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="app.reminder" initial="recover">
  <datamodel>
    <data id="task" expr="null"/>
    <data id="now" expr="0"/>
    <data id="cp" expr="null"/>
  </datamodel>

  <state id="recover">
    <onentry><assign location="cp" expr="task.state.checkpoint || null"/></onentry>
    <transition cond="task.state.status === 'terminal'" target="terminal"/>
    <transition cond="task.state.status === 'completing'" target="completing"/>
    <transition cond="task.abortRequested" target="aborting"/>
    <transition cond="task.state.status === 'waiting'" target="waiting"/>
    <transition target="running"/>
  </state>

  <state id="live" initial="running">
    <transition event="task.abort" target="aborting"/>

    <state id="running" initial="route">
      <state id="route">
        <transition cond="cp.phase === 'remind'" target="remind"/>
        <transition target="sleep"/>
      </state>

      <state id="sleep">
        <onentry><send event="due" delayexpr="Math.max(0, cp.until - now) + 'ms'"/></onentry>
        <transition event="due" target="remind">
          <send type="durable" event="task.checkpoint"><param name="checkpoint" expr="({ phase: 'remind' })"/></send>
        </transition>
      </state>

      <state id="remind">
        <onentry><send type="durable" event="reminder.deliver"/></onentry>
        <transition target="completing"/>
      </state>
    </state>

    <state id="waiting">
      <transition event="task.wake" target="running">
        <assign location="cp" expr="_event.data.checkpoint"/>
      </transition>
    </state>

    <state id="completing">
      <transition event="task.terminal" target="terminal"/>
    </state>
  </state>

  <state id="aborting" initial="draining">
    <state id="draining">
      <transition event="task.drained" target="handler"/>
    </state>
    <state id="handler">
      <onentry><send type="durable" event="task.aborted"/></onentry>
      <transition event="task.terminal" target="terminal"/>
    </state>
  </state>

  <final id="terminal"/>
</scxml>
`;var vt=`<?xml version="1.0" encoding="UTF-8"?>
<!--
  pi.tool: one tool call, as a durable task (packages/durable/src/harness/tool.ts).

  Checkpoints: {phase: "call"} | {phase: "execute", arguments, replay}.

  Every task chart has the same outer shape, the task's lifecycle:
    recover     where a (re)started session begins: it routes to the stored status and phase
    live        running (the phases) · waiting (parked on other tasks) · completing (an outcome
                is decided; the work the task owns is finishing)
    aborting    the abort mark arrived: wait for owned work to end (bottom-up), then the
                abort handler commits an outcome
    terminal    the permanent receipt

  The phases inside \`running\` are this task's definition. Every step is a commit through the
  \`durable\` I/O processor (PROTOCOL.md): the checkpoint and what the step produced are stored
  together, so a new process continues from the last one.

  \`call\` resolves the tool, runs the beforeTool hook chain, then stores the intent: the
  checkpoint becomes \`execute\` with the final arguments and the tool's replay policy, BEFORE
  the tool runs. \`execute\` is only ever entered from storage by a new process: the call was
  cut off. If the stored and the current policy are both "safe", it reruns with the stored
  arguments (no beforeTool); otherwise the model is told it was interrupted.
-->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="pi.tool" initial="recover">
  <datamodel>
    <!-- the task record as stored; \`now\` = the clock when this session started -->
    <data id="task" expr="null"/>
    <data id="now" expr="0"/>
    <data id="cp" expr="null"/>
    <data id="args" expr="null"/>
    <data id="replay" expr="'unsafe'"/>
    <data id="result" expr="null"/>
  </datamodel>

  <state id="recover">
    <onentry>
      <assign location="cp" expr="task.state.checkpoint || null"/>
      <assign location="args" expr="task.input.args"/>
    </onentry>
    <transition cond="task.state.status === 'terminal'" target="terminal"/>
    <transition cond="task.state.status === 'completing'" target="completing"/>
    <transition cond="task.abortRequested" target="aborting"/>
    <transition cond="task.state.status === 'waiting'" target="waiting"/>
    <transition target="running"/>
  </state>

  <state id="live" initial="running">
    <transition event="task.abort" target="aborting"/>

    <state id="running" initial="route">
      <state id="route">
        <transition cond="cp.phase === 'execute'" target="resume"/>
        <transition target="call"/>
      </state>

      <!-- phase "call": resolve → beforeTool → store the intent -->
      <state id="call" initial="resolve">
        <state id="resolve">
          <invoke type="resolve-tool" id="resolve"/>
          <transition event="done.invoke.resolve" cond="!_event.data.found" target="completing">
            <send type="durable" event="tool.unavailable"/>
          </transition>
          <transition event="done.invoke.resolve" target="beforeTool">
            <assign location="replay" expr="_event.data.replay"/>
          </transition>
        </state>
        <state id="beforeTool">
          <invoke type="hooks" id="beforeTool">
            <param name="point" expr="'beforeTool'"/>
            <param name="args" expr="args"/>
          </invoke>
          <transition event="done.invoke.beforeTool" cond="_event.data.block" target="completing">
            <send type="durable" event="tool.blocked"><param name="reason" expr="_event.data.block"/></send>
          </transition>
          <transition event="done.invoke.beforeTool" target="intent">
            <assign location="args" expr="_event.data.args"/>
          </transition>
        </state>
        <!-- the intent commit: from here on, a crash means "this call may have partly run" -->
        <state id="intent">
          <onentry>
            <send type="durable" event="tool.intent">
              <param name="args" expr="args"/>
              <param name="replay" expr="replay"/>
            </send>
            <assign location="cp" expr="({ phase: 'execute', arguments: args, replay: replay })"/>
          </onentry>
          <transition target="run"/>
        </state>
      </state>

      <!-- phase "execute" -->
      <state id="execute" initial="resume">
        <!-- reached only from storage: the call was cut off by a crash -->
        <state id="resume">
          <invoke type="resolve-tool" id="recheck"/>
          <transition event="done.invoke.recheck" cond="cp.replay === 'safe' &amp;&amp; _event.data.found &amp;&amp; _event.data.replay === 'safe'" target="run">
            <assign location="args" expr="cp.arguments"/>
          </transition>
          <transition event="done.invoke.recheck" target="completing">
            <send type="durable" event="tool.interrupted"/>
          </transition>
        </state>
        <state id="run">
          <invoke type="tool" id="run">
            <param name="args" expr="args"/>
          </invoke>
          <transition event="done.invoke.run" cond="!_event.data.ok" target="completing">
            <send type="durable" event="tool.error"><param name="message" expr="_event.data.error"/></send>
          </transition>
          <transition event="done.invoke.run" target="afterTool">
            <assign location="result" expr="_event.data.result"/>
          </transition>
        </state>
        <state id="afterTool">
          <invoke type="hooks" id="afterTool">
            <param name="point" expr="'afterTool'"/>
            <param name="args" expr="args"/>
            <param name="result" expr="result"/>
          </invoke>
          <transition event="done.invoke.afterTool" target="completing">
            <send type="durable" event="tool.result"><param name="result" expr="_event.data.result"/></send>
          </transition>
        </state>
      </state>
    </state>

    <state id="waiting">
      <transition event="task.wake" target="running">
        <assign location="cp" expr="_event.data.checkpoint"/>
      </transition>
    </state>

    <!-- the outcome is stored; owned work (a subagent, a checkout) may still be finishing -->
    <state id="completing">
      <transition event="task.terminal" target="terminal"/>
    </state>
  </state>

  <state id="aborting" initial="draining">
    <state id="draining">
      <transition event="task.drained" target="handler"/>
    </state>
    <state id="handler">
      <onentry><send type="durable" event="tool.aborted"/></onentry>
      <transition event="task.terminal" target="terminal"/>
    </state>
  </state>

  <final id="terminal"/>
</scxml>
`;var ft=`<?xml version="1.0" encoding="UTF-8"?>
<!-- Tour 1, "What is a harness?": storage, a conversation, an agent, tools, an environment, tasks. -->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="tour · what is a harness" initial="setup">
  <state id="setup">
    <onentry>
      <send type="stage" event="client.add"><param name="client" expr="'you'"/><param name="name" expr="'You'"/></send>
      <send type="stage" event="note">
        <param name="text" expr="'The harness (Process) opened over a storage (Storage): it took ownership, found nothing to recover, and resumed. Your screen is a client attached to the root conversation.'"/>
        <param name="cite" expr="'harness'"/>
        <param name="panel" expr="'storage'"/>
        </send>
      <send type="stage" event="inspect"><param name="kind" expr="'harness'"/></send>
    </onentry>
    <transition event="client.you.live" target="ask"/>
  </state>

  <state id="ask">
    <onentry><send event="go" delay="1.5s"/></onentry>
    <transition event="go" target="admitted">
      <send type="stage" event="type"><param name="text" expr="'What’s in the repo?'"/></send>
    </transition>
  </state>

  <state id="admitted">
    <transition event="pi.generation.request" target="generating">
      <send type="stage" event="note">
        <param name="text" expr="'One commit admitted your message: the submission, the pi.user entry, and a pi.generation task. Everything the harness runs is a task; this one asks the model.'"/>
        <param name="cite" expr="'harness'"/>
        <param name="panel" expr="'process'"/>
        </send>
      <send type="stage" event="inspect"><param name="kind" expr="'pi.generation'"/></send>
    </transition>
  </state>

  <state id="generating">
    <transition event="pi.tool.run" target="tools">
      <send type="stage" event="note">
        <param name="text" expr="'The model called two tools. Each call is a pi.tool task owned by the generation, which waits for both (allSettled). The tools run in the conversation’s execution environment, /work/repo.'"/>
        <param name="cite" expr="'harness'"/>
        <param name="panel" expr="'process'"/>
        </send>
      <send type="stage" event="inspect"><param name="kind" expr="'pi.tool'"/></send>
    </transition>
  </state>

  <state id="tools">
    <transition event="commit.generation.answer" target="done"/>
  </state>

  <final id="done">
    <onentry>
      <send type="stage" event="note">
        <param name="text" expr="'Answered. The transcript, the tasks and their checkpoints are all in storage, one commit at a time (the commit log). Pick a task to see its chart, or try the next chapter.'"/>
        <param name="panel" expr="'storage'"/>
        </send>
    </onentry>
  </final>
</scxml>
`;var yt=`<?xml version="1.0" encoding="UTF-8"?>
<!-- Tour 2, "Long runs anywhere": a storage backend, one owner at a time, an environment per conversation. -->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="tour · long runs anywhere" initial="setup">
  <state id="setup">
    <onentry>
      <send type="stage" event="client.add"><param name="client" expr="'you'"/><param name="name" expr="'You'"/></send>
      <send type="stage" event="note">
        <param name="text" expr="'A harness opens over a storage backend. This one is in memory; its commit log (right) is what the JSONL backend would write, one line per commit. Process 1 owns it.'"/>
        <param name="cite" expr="'anywhere'"/>
        <param name="panel" expr="'storage'"/>
        </send>
    </onentry>
    <transition event="client.you.live" target="second"/>
  </state>

  <state id="second">
    <onentry>
      <send type="stage" event="client.add"><param name="client" expr="'reviewer'"/><param name="name" expr="'Reviewer'"/></send>
      <send event="go" delay="1s"/>
    </onentry>
    <transition event="go" target="both">
      <send type="stage" event="conversation.create">
        <param name="client" expr="'reviewer'"/>
        <param name="title" expr="'review'"/>
        <param name="agent" expr="({ cwd: '/work/review', model: 'sim-luna' })"/>
      </send>
      <send type="stage" event="note">
        <param name="text" expr="'A second conversation, for a reviewer: its own working directory (/work/review) and a cheaper model. The env function builds each tool call’s environment from the conversation’s cwd.'"/>
        <param name="cite" expr="'anywhere'"/>
      </send>
    </transition>
  </state>

  <state id="both">
    <onentry><send event="go" delay="1.5s"/></onentry>
    <transition event="go" target="running">
      <send type="stage" event="type"><param name="text" expr="'What is your working directory?'"/></send>
      <send type="stage" event="type"><param name="client" expr="'reviewer'"/><param name="text" expr="'What is your working directory?'"/></send>
    </transition>
  </state>

  <state id="running">
    <transition event="commit.generation.answer" target="oneDone"/>
  </state>
  <state id="oneDone">
    <transition event="commit.generation.answer" target="handover"/>
  </state>

  <state id="handover">
    <onentry>
      <send type="stage" event="note">
        <param name="text" expr="'Same question, two places. Now the process dies, and process 2 opens the same storage: one process owns a storage at a time, and the clients attach to whichever process is up.'"/>
        <param name="cite" expr="'anywhere'"/>
        <param name="panel" expr="'process'"/>
        </send>
      <send event="kill" delay="2s"/>
      <send event="start" delay="4s"/>
    </onentry>
    <transition event="kill"><send type="stage" event="kill"/></transition>
    <transition event="start" target="reopened">
      <send type="stage" event="start"/>
      <send type="stage" event="inspect"><param name="kind" expr="'harness'"/></send>
    </transition>
  </state>

  <state id="reopened">
    <transition event="harness.scheduling" target="done"/>
  </state>

  <final id="done">
    <onentry>
      <send type="stage" event="note">
        <param name="text" expr="'Process 2 took ownership (the commit log shows harness.acquire), reconciled nothing, and both clients reattached. The working set (Storage) is what a SQLite harness keeps in memory: active transcripts, live tasks, pending submissions.'"/>
        <param name="cite" expr="'anywhere'"/>
        <param name="panel" expr="'storage'"/>
        </send>
    </onentry>
  </final>
</scxml>
`;var kt=`<?xml version="1.0" encoding="UTF-8"?>
<!--
  Tour 3, "Survives crashes": the post's job-42. The process dies during a tool round (one safe
  call, one not), and again while the final answer streams. A follow-up waits in the inbox
  through both. The client retries job-42 with the same requestId each time it reconnects.
-->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="tour · survives crashes" initial="setup">
  <datamodel>
    <data id="bashResults" expr="0"/>
    <data id="toldDuplicate" expr="false"/>
  </datamodel>

  <state id="setup">
    <onentry>
      <send type="stage" event="client.add"><param name="client" expr="'you'"/><param name="name" expr="'You'"/></send>
    </onentry>
    <transition event="client.you.live" target="submit"/>
  </state>

  <state id="submit">
    <onentry><send event="go" delay="1s"/></onentry>
    <transition event="go" target="round">
      <send type="stage" event="type">
        <param name="text" expr="'Fix the flaky login test'"/>
        <param name="requestId" expr="'job-42'"/>
      </send>
      <send type="stage" event="note">
        <param name="text" expr="'The job is submitted with requestId job-42.'"/>
        <param name="cite" expr="'crashes'"/>
      </send>
    </transition>
  </state>

  <state id="round">
    <transition event="tool.bash.run" target="queue">
      <send type="stage" event="note">
        <param name="text" expr="'Two tool calls: search_issues (replay: safe) and bash (not safe). Each stored its intent (phase execute) before it started. bash streams its output into storage.'"/>
        <param name="cite" expr="'tools'"/>
      </send>
      <send type="stage" event="inspect"><param name="kind" expr="'pi.tool'"/><param name="label" expr="'bash'"/></send>
    </transition>
  </state>

  <state id="queue">
    <onentry><send event="go" delay="1.2s"/></onentry>
    <transition event="go" target="crash1">
      <send type="stage" event="type"><param name="text" expr="'Then update the changelog.'"/></send>
      <send type="stage" event="note">
        <param name="text" expr="'A follow-up, typed while the agent works: it waits in the inbox (pi.inbox).'"/>
      </send>
    </transition>
  </state>

  <state id="crash1">
    <onentry><send event="kill" delay="1.3s"/></onentry>
    <transition event="kill" target="dead1">
      <send type="stage" event="kill"/>
      <send type="stage" event="note">
        <param name="text" expr="'The process dies, mid tool round. Every session, timer and promise is gone. Storage is not: two tasks are running in phase execute, the generation is waiting, the follow-up is queued.'"/>
        <param name="cite" expr="'crashes'"/>
        <param name="panel" expr="'process'"/>
        </send>
    </transition>
  </state>

  <state id="dead1">
    <onentry><send event="start" delay="3s"/></onentry>
    <transition event="start" target="recovering">
      <send type="stage" event="start"/>
      <send type="stage" event="inspect"><param name="kind" expr="'harness'"/></send>
    </transition>
  </state>

  <!-- from the first restart on: whenever the client retries job-42 -->
  <state id="afterCrash" initial="recovering">
    <transition event="submit.duplicate" cond="!toldDuplicate">
      <assign location="toldDuplicate" expr="true"/>
      <send type="stage" event="note">
        <param name="text" expr="'The client reconnected and sent job-42 again: same requestId, so the harness returned the original submission instead of asking twice.'"/>
        <param name="cite" expr="'crashes'"/>
        <param name="panel" expr="'process'"/>
        </send>
    </transition>
    <state id="recovering">
      <transition event="harness.open">
        <send type="stage" event="note">
          <param name="text" expr="'A new process opens the same storage. Reconciling is one commit and runs no task code: the running tasks go back to pending, with their checkpoints. Then resume().'"/>
          <param name="cite" expr="'crashes'"/>
          <param name="panel" expr="'process'"/>
        </send>
      </transition>
      <transition event="tool.bash.resume" target="resumed">
        <send type="stage" event="inspect"><param name="kind" expr="'pi.tool'"/><param name="label" expr="'bash'"/></send>
      </transition>
    </state>

    <state id="resumed">
      <transition event="commit.tool.interrupted" target="retried">
        <send type="stage" event="note">
          <param name="text" expr="'Each tool task resumes in phase execute. search_issues is safe: it runs again with its stored arguments. bash is not: the model is told it was interrupted, with the output stored so far.'"/>
          <param name="cite" expr="'crashes'"/>
          <param name="panel" expr="'process'"/>
        </send>
      </transition>
    </state>

    <state id="retried">
      <!-- the rerun bash fails the test; the next one (after the edit) passes -->
      <transition event="commit.tool.result.bash">
        <assign location="bashResults" expr="bashResults + 1"/>
      </transition>
      <transition cond="bashResults >= 2" target="answering"/>
    </state>

    <state id="answering">
      <transition event="pi.generation.request" target="streaming"/>
    </state>

    <state id="streaming">
      <onentry><send event="kill" delay="2.6s"/></onentry>
      <transition event="kill" target="dead2">
        <send type="stage" event="kill"/>
        <send type="stage" event="note">
          <param name="text" expr="'The tests pass, the answer starts streaming, and the process dies again. The streamed part was committed as it arrived (pi.live).'"/>
          <param name="cite" expr="'crashes'"/>
          <param name="panel" expr="'process'"/>
        </send>
      </transition>
    </state>

    <state id="dead2">
      <onentry><send event="start" delay="2.5s"/></onentry>
      <transition event="start" target="resent"><send type="stage" event="start"/></transition>
    </state>

    <state id="resent">
      <transition event="pi.generation.request">
        <send type="stage" event="note">
          <param name="text" expr="'The request was cut off, so it is sent again. The partial answer stays in the transcript, marked aborted; the model never sees it.'"/>
          <param name="cite" expr="'crashes'"/>
          <param name="panel" expr="'process'"/>
        </send>
        <send type="stage" event="inspect"><param name="kind" expr="'pi.generation'"/></send>
      </transition>
      <transition event="commit.generation.answer" target="followUp"/>
    </state>

    <state id="followUp">
      <transition event="commit.generation.answer" target="done">
        <send type="stage" event="note">
          <param name="text" expr="'job-42 is answered, exactly once, and the follow-up was still queued: it ran as the next run. Two crashes, nothing lost, nothing done twice that wasn’t safe to.'"/>
          <param name="cite" expr="'crashes'"/>
        </send>
      </transition>
    </state>
  </state>

  <final id="done"/>
</scxml>
`;var wt=`<?xml version="1.0" encoding="UTF-8"?>
<!-- Tour 4, "Many conversations at once": the post's Slack channel and its thread. -->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="tour · many conversations" initial="setup">
  <state id="setup">
    <onentry>
      <send type="stage" event="client.add"><param name="client" expr="'you'"/><param name="name" expr="'Ada'"/></send>
      <send type="stage" event="client.add"><param name="client" expr="'bo'"/><param name="name" expr="'Bo'"/></send>
      <send type="stage" event="note">
        <param name="text" expr="'Think of a Slack channel: the root conversation. Ada and Bo both watch it.'"/>
        <param name="cite" expr="'conversations'"/>
      </send>
    </onentry>
    <transition event="client.bo.live" target="ask"/>
  </state>

  <state id="ask">
    <onentry><send event="go" delay="1s"/></onentry>
    <transition event="go" target="answering">
      <send type="stage" event="type"><param name="text" expr="'@agent why did the deploy fail?'"/></send>
    </transition>
  </state>

  <state id="answering">
    <transition event="commit.generation.answer" target="fork"/>
  </state>

  <state id="fork">
    <onentry><send event="go" delay="1.5s"/></onentry>
    <transition event="go" target="forked">
      <send type="stage" event="fork"><param name="title" expr="'thread'"/></send>
      <send type="stage" event="note">
        <param name="text" expr="'Ada replies in a thread: a fork of the channel at the agent’s answer, ownerless. It sees the channel’s history up to that entry by reference (the inherited entries); nothing is copied.'"/>
        <param name="cite" expr="'conversations'"/>
      </send>
    </transition>
  </state>

  <state id="forked">
    <transition event="client.you.live" target="configure">
      <send type="stage" event="configure">
        <param name="conversation" expr="'last'"/>
        <param name="change" expr="({ model: 'sim-luna', tools: { remove: ['deploy'] } })"/>
      </send>
      <send type="stage" event="note">
        <param name="text" expr="'The thread stores its own agent: a cheaper model, and every tool but deploy. It may search, not deploy.'"/>
        <param name="cite" expr="'conversations'"/>
      </send>
    </transition>
  </state>

  <state id="configure">
    <onentry><send event="go" delay="2s"/></onentry>
    <transition event="go" target="both">
      <send type="stage" event="type"><param name="text" expr="'@agent can we roll it back?'"/></send>
      <send type="stage" event="type"><param name="client" expr="'bo'"/><param name="text" expr="'@agent who is on call today?'"/></send>
      <send type="stage" event="note">
        <param name="text" expr="'Ada asks in the thread, Bo in the channel, at the same moment. Two runs, two generation tasks, side by side; neither waits for the other.'"/>
        <param name="cite" expr="'conversations'"/>
        <param name="panel" expr="'process'"/>
        </send>
    </transition>
  </state>

  <state id="both">
    <transition event="commit.generation.answer" target="one"/>
  </state>
  <state id="one">
    <transition event="commit.generation.answer" target="done"/>
  </state>

  <final id="done">
    <onentry>
      <send type="stage" event="note">
        <param name="text" expr="'Both answered. In the thread the agent couldn’t roll back: deploy isn’t among its tools there. Switch between the conversations in each client.'"/>
      </send>
    </onentry>
  </final>
</scxml>
`;var bt=`<?xml version="1.0" encoding="UTF-8"?>
<!-- Tour 5, "Extensions › System prompt sections": AGENTS.md changes; the next request records the change. -->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="tour · system prompt sections" initial="setup">
  <state id="setup">
    <onentry>
      <send type="stage" event="client.add"><param name="client" expr="'you'"/><param name="name" expr="'You'"/></send>
      <send type="stage" event="note">
        <param name="text" expr="'The project-context extension renders a section, agents_md, from the AGENTS.md in the conversation’s environment, before every request.'"/>
        <param name="cite" expr="'sections'"/>
        <param name="panel" expr="'process'"/>
        </send>
    </onentry>
    <transition event="client.you.live" target="ask"/>
  </state>

  <state id="ask">
    <onentry><send event="go" delay="1s"/></onentry>
    <transition event="go" target="first">
      <send type="stage" event="type"><param name="text" expr="'Add a house rule to AGENTS.md'"/></send>
    </transition>
  </state>

  <state id="first">
    <transition event="commit.generation.request" target="editing">
      <send type="stage" event="note">
        <param name="text" expr="'The first request records the whole system prompt as a pi.system entry, at its position in the transcript.'"/>
        <param name="cite" expr="'sections'"/>
      </send>
    </transition>
  </state>

  <state id="editing">
    <transition event="commit.tool.result.edit" target="next"/>
  </state>

  <state id="next">
    <transition event="commit.generation.request" target="done">
      <send type="stage" event="note">
        <param name="text" expr="'The edit changed AGENTS.md. The very next request rendered the sections again and recorded only what changed: a second pi.system entry, right after the tool result. A restart or a fork replays these entries and sees exactly what the model saw.'"/>
        <param name="cite" expr="'sections'"/>
      </send>
    </transition>
  </state>

  <final id="done"/>
</scxml>
`;var xt=`<?xml version="1.0" encoding="UTF-8"?>
<!-- Tour 6, "Extensions › Tools": a subagent owned by a tool call (and a crash under it), then an override and a wrap. -->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="tour · tools" initial="setup">
  <state id="setup">
    <onentry>
      <send type="stage" event="client.add"><param name="client" expr="'you'"/><param name="name" expr="'You'"/></send>
    </onentry>
    <transition event="client.you.live" target="ask"/>
  </state>

  <state id="ask">
    <onentry><send event="go" delay="1s"/></onentry>
    <transition event="go" target="subagent">
      <send type="stage" event="type"><param name="text" expr="'Triage this issue: the app crashes when I log out'"/></send>
    </transition>
  </state>

  <state id="subagent">
    <transition event="commit.triage.subagent" target="crash">
      <send type="stage" event="note">
        <param name="text" expr="'The triage tool created a conversation it owns: a subagent with a smaller model, no tools and one instruction. It submitted the issue there (requestId triage:&lt;call&gt;) and waits for the answer.'"/>
        <param name="cite" expr="'tools'"/>
        <param name="panel" expr="'process'"/>
        </send>
    </transition>
  </state>

  <state id="crash">
    <transition event="pi.generation.request" target="dying"/>
  </state>
  <state id="dying">
    <onentry><send event="kill" delay="700ms"/></onentry>
    <transition event="kill" target="dead">
      <send type="stage" event="kill"/>
      <send type="stage" event="note">
        <param name="text" expr="'The process dies while the subagent thinks.'"/>
        <param name="panel" expr="'process'"/>
        </send>
    </transition>
  </state>
  <state id="dead">
    <onentry><send event="start" delay="2s"/></onentry>
    <transition event="start" target="rerun"><send type="stage" event="start"/></transition>
  </state>

  <state id="rerun">
    <transition event="commit.tool.result.triage" target="override">
      <send type="stage" event="note">
        <param name="text" expr="'triage is safe to rerun: it found its subagent again (owned by the same call), resubmitted with the same requestId, got the same submission, and waited for its answer. The subagent continued from its own checkpoint.'"/>
        <param name="cite" expr="'crashes'"/>
        <param name="panel" expr="'process'"/>
        </send>
    </transition>
  </state>

  <state id="override">
    <onentry><send event="go" delay="3s"/></onentry>
    <transition event="go" target="wrapped">
      <send type="stage" event="install"><param name="extension" expr="'venv@1'"/></send>
      <send type="stage" event="install"><param name="extension" expr="'timing@1'"/></send>
      <send type="stage" event="note">
        <param name="text" expr="'Two more extensions: venv brings its own bash (same name, later extension: it replaces coding’s), and timing wraps whichever bash won.'"/>
        <param name="cite" expr="'tools'"/>
        <param name="panel" expr="'process'"/>
        </send>
      <send type="stage" event="type"><param name="text" expr="'What is your working directory?'"/></send>
    </transition>
  </state>

  <state id="wrapped">
    <transition event="commit.tool.result.bash" target="done">
      <send type="stage" event="note">
        <param name="text" expr="'The call ran venv’s bash (the (venv) prefix), timed by the wrap (timing, in the tool’s details).'"/>
        <param name="cite" expr="'tools'"/>
      </send>
    </transition>
  </state>

  <final id="done"/>
</scxml>
`;var Tt=`<?xml version="1.0" encoding="UTF-8"?>
<!-- Tour 7, "Extensions › Hooks": a beforeTool chain (approval, then freeze); the approval is a memo that survives a crash. -->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="tour · hooks" initial="setup">
  <state id="setup">
    <onentry>
      <send type="stage" event="client.add"><param name="client" expr="'you'"/><param name="name" expr="'You'"/></send>
    </onentry>
    <transition event="client.you.live" target="ask"/>
  </state>

  <state id="ask">
    <onentry><send event="go" delay="1s"/></onentry>
    <transition event="go" target="asking">
      <send type="stage" event="type"><param name="text" expr="'Deploy v1.5.1'"/></send>
    </transition>
  </state>

  <state id="asking">
    <transition event="approval.asked" target="approve">
      <send type="stage" event="note">
        <param name="text" expr="'The deploy call runs the beforeTool chain of its conversation’s extensions, in order: approval, then freeze. approval asks a person (the card in the conversation).'"/>
        <param name="cite" expr="'hooks'"/>
        <param name="panel" expr="'process'"/>
        </send>
      <send type="stage" event="inspect"><param name="kind" expr="'pi.tool'"/><param name="label" expr="'deploy'"/></send>
    </transition>
  </state>

  <state id="approve">
    <onentry><send event="go" delay="2.5s"/></onentry>
    <transition event="go" target="memo"><send type="stage" event="approve"/></transition>
  </state>

  <state id="memo">
    <transition event="hook.beforeTool.freeze" target="freeze">
      <send type="stage" event="note">
        <param name="text" expr="'Approved, and stored as a memo on the task (approval:deploy = true): the first write wins. Now freeze checks the change calendar, which takes a while.'"/>
        <param name="cite" expr="'hooks'"/>
        <param name="panel" expr="'process'"/>
        </send>
    </transition>
  </state>

  <state id="freeze">
    <onentry><send event="kill" delay="1.2s"/></onentry>
    <transition event="kill" target="dead">
      <send type="stage" event="kill"/>
      <send type="stage" event="note">
        <param name="text" expr="'The process dies in the middle of the chain. The call’s checkpoint is still call: nothing has run yet.'"/>
        <param name="panel" expr="'process'"/>
        </send>
    </transition>
  </state>

  <state id="dead">
    <onentry><send event="start" delay="2s"/></onentry>
    <transition event="start" target="again"><send type="stage" event="start"/></transition>
  </state>

  <state id="again">
    <transition event="hook.beforeTool.freeze" target="deploying">
      <send type="stage" event="note">
        <param name="text" expr="'The call phase runs again, hooks and all. approval found its memo and didn’t ask anybody; freeze checks again.'"/>
        <param name="cite" expr="'hooks'"/>
        <param name="panel" expr="'process'"/>
        </send>
    </transition>
  </state>

  <state id="deploying">
    <transition event="commit.generation.answer" target="done"/>
  </state>

  <final id="done">
    <onentry>
      <send type="stage" event="note">
        <param name="text" expr="'Deployed, with one approval. Hooks can run again after a crash; decisions belong in memos.'"/>
        <param name="panel" expr="'process'"/>
        </send>
    </onentry>
  </final>
</scxml>
`;var St=`<?xml version="1.0" encoding="UTF-8"?>
<!-- Tour 8, "Extensions › Tasks": the post's checkout (failFast, bottom-up abort, refunds), then foreground vs background. -->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="tour · tasks" initial="setup">
  <state id="setup">
    <onentry>
      <send type="stage" event="client.add"><param name="client" expr="'you'"/><param name="name" expr="'You'"/></send>
      <send type="stage" event="bank"><param name="card" expr="'mc-0009'"/><param name="latencyMs" expr="700"/></send>
    </onentry>
    <transition event="client.you.live" target="ask"/>
  </state>

  <state id="ask">
    <onentry><send event="go" delay="1s"/></onentry>
    <transition event="go" target="paying">
      <send type="stage" event="type"><param name="text" expr="'Checkout with visa-4242, amex-0005 and mc-0009'"/></send>
    </transition>
  </state>

  <state id="paying">
    <transition event="shop.checkout.waiting" target="declined">
      <send type="stage" event="note">
        <param name="text" expr="'The checkout tool created a shop.checkout task, owned by the call. Its pay phase created one shop.payment per card, in one commit, and waits for all of them with policy failFast. No checkout code runs while it waits.'"/>
        <param name="cite" expr="'tasks'"/>
        <param name="panel" expr="'process'"/>
        </send>
      <send type="stage" event="inspect"><param name="kind" expr="'shop.checkout'"/></send>
    </transition>
  </state>

  <state id="declined">
    <transition event="shop.payment.aborting" target="refunds">
      <send type="stage" event="note">
        <param name="text" expr="'mc-0009 is declined: that payment failed. failFast puts an abort mark on the other two while their charges are still in flight. Each runs its own abort handler: refund (the bank voids a charge that hasn’t landed).'"/>
        <param name="cite" expr="'tasks'"/>
        <param name="panel" expr="'process'"/>
        </send>
      <send type="stage" event="inspect"><param name="kind" expr="'shop.payment'"/></send>
    </transition>
  </state>

  <state id="refunds">
    <transition event="shop.checkout.decide" target="decided">
      <send type="stage" event="inspect"><param name="kind" expr="'shop.checkout'"/></send>
    </transition>
  </state>

  <state id="decided">
    <transition event="commit.generation.answer" target="background">
      <send type="stage" event="note">
        <param name="text" expr="'Every payment is terminal, so the checkout woke in decide, read the outcomes (completed? no) and failed. Nothing was charged.'"/>
        <param name="cite" expr="'tasks'"/>
        <param name="panel" expr="'process'"/>
        </send>
    </transition>
  </state>

  <state id="background">
    <onentry><send event="go" delay="2s"/></onentry>
    <transition event="go" target="reminding">
      <send type="stage" event="type"><param name="text" expr="'Remind me to stretch'"/></send>
    </transition>
  </state>

  <state id="reminding">
    <transition event="commit.generation.answer" target="foreground">
      <send type="stage" event="note">
        <param name="text" expr="'remind_me created an app.reminder task owned by the conversation, background: true. The conversation is idle again while it sleeps; its deadline is in its checkpoint.'"/>
        <param name="cite" expr="'tasks'"/>
        <param name="panel" expr="'process'"/>
        </send>
      <send type="stage" event="inspect"><param name="kind" expr="'app.reminder'"/></send>
    </transition>
  </state>

  <state id="foreground">
    <onentry><send event="go" delay="1.5s"/></onentry>
    <transition event="go" target="slow">
      <send type="stage" event="type"><param name="text" expr="'Why is checkout slow?'"/></send>
    </transition>
  </state>

  <state id="slow">
    <transition event="tool.bash.run" target="esc"/>
  </state>

  <state id="esc">
    <onentry><send event="go" delay="1s"/></onentry>
    <transition event="go" target="aborted">
      <send type="stage" event="abort"/>
      <send type="stage" event="note">
        <param name="text" expr="'Esc. The abort marks the conversation’s current work: the generation and the bash call it owns. The call aborts first, then the generation (bottom-up). The background reminder is not current work: it keeps sleeping.'"/>
        <param name="cite" expr="'tasks'"/>
        <param name="panel" expr="'process'"/>
        </send>
      <send type="stage" event="inspect"><param name="kind" expr="'pi.generation'"/></send>
    </transition>
  </state>

  <state id="aborted">
    <transition event="app.reminder.remind" target="done">
      <send type="stage" event="note">
        <param name="text" expr="'The reminder’s deadline came: it submits a follow-up (requestId reminder:&lt;task&gt;, exactly-once) and the conversation runs on it.'"/>
        <param name="cite" expr="'tasks'"/>
        <param name="panel" expr="'process'"/>
        </send>
    </transition>
  </state>

  <final id="done"/>
</scxml>
`;var Et=`<?xml version="1.0" encoding="UTF-8"?>
<!-- Tour 9, "Compaction": a tiny context window; background, manual, then a handoff and a search of what came before. -->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="tour · compaction" initial="setup">
  <datamodel>
    <data id="questions" expr="['Tell me about durability', 'And about tasks?', 'What about storage?', 'And forks?', 'And clients?', 'And extensions?']"/>
    <data id="asked" expr="0"/>
  </datamodel>

  <state id="setup">
    <onentry>
      <send type="stage" event="client.add"><param name="client" expr="'you'"/><param name="name" expr="'You'"/></send>
      <send type="stage" event="note">
        <param name="text" expr="'This chapter’s model has a context window of 900 tokens (reserve 150, background 300), so it fills up fast. Watch the context meter in the conversation.'"/>
        <param name="cite" expr="'compaction'"/>
      </send>
    </onentry>
    <transition event="client.you.live" target="chat"/>
  </state>

  <state id="chat">
    <onentry><send event="ask" delay="800ms"/></onentry>
    <transition event="ask" cond="asked &lt; questions.length" target="waitAnswer">
      <send type="stage" event="type"><param name="text" expr="questions[asked]"/></send>
      <assign location="asked" expr="asked + 1"/>
    </transition>
    <transition event="ask" target="manual"/>
    <transition event="pi.compaction.select">
      <send type="stage" event="note">
        <param name="text" expr="'Close to the limit: a background compaction (owned by the conversation, background) summarizes the older messages while the conversation keeps going. Its summary is a write, placed at the next turn boundary.'"/>
        <param name="cite" expr="'compaction'"/>
        <param name="panel" expr="'process'"/>
        </send>
      <send type="stage" event="inspect"><param name="kind" expr="'pi.compaction'"/></send>
    </transition>
  </state>
  <state id="waitAnswer">
    <transition event="commit.generation.answer" target="chat"/>
    <transition event="pi.compaction.select">
      <send type="stage" event="note">
        <param name="text" expr="'Close to the limit: a background compaction (owned by the conversation, background) summarizes the older messages while the conversation keeps going. Its summary is a write, placed at the next turn boundary.'"/>
        <param name="cite" expr="'compaction'"/>
        <param name="panel" expr="'process'"/>
        </send>
      <send type="stage" event="inspect"><param name="kind" expr="'pi.compaction'"/></send>
    </transition>
  </state>

  <state id="manual">
    <onentry>
      <send type="stage" event="note">
        <param name="text" expr="'The older messages are greyed: the model no longer sees them, but they are all still in storage. Now a manual compaction, with instructions.'"/>
        <param name="cite" expr="'compaction'"/>
        <param name="panel" expr="'process'"/>
        </send>
      <send type="stage" event="compact"><param name="instructions" expr="'Keep the names of the topics'"/></send>
    </onentry>
    <transition event="commit.compaction.place" target="handoff"/>
    <transition event="commit.compaction.nothing" target="handoff"/>
  </state>

  <state id="handoff">
    <onentry><send event="go" delay="1.5s"/></onentry>
    <transition event="go" target="handingOff">
      <send type="stage" event="type"><param name="text" expr="'Hand off and start over'"/></send>
    </transition>
  </state>

  <state id="handingOff">
    <transition event="commit.generation.answer" target="search">
      <send type="stage" event="note">
        <param name="text" expr="'The handoff tool returned control: { handoff }. That ended the run with a pi.reset entry: a new context, starting from the note. It also queued &quot;Continue.&quot;, which started the next run in the new context.'"/>
        <param name="cite" expr="'compaction'"/>
      </send>
    </transition>
  </state>

  <state id="search">
    <onentry><send event="go" delay="2s"/></onentry>
    <transition event="go" target="searching">
      <send type="stage" event="type"><param name="text" expr="'What did we say about durability earlier?'"/></send>
    </transition>
  </state>

  <state id="searching">
    <transition event="commit.generation.answer" target="done">
      <send type="stage" event="note">
        <param name="text" expr="'search_history read the conversation’s entries through a transaction: everything, from before the summaries and the handoff too.'"/>
        <param name="cite" expr="'compaction'"/>
      </send>
    </transition>
  </state>

  <final id="done"/>
</scxml>
`;var It=`<?xml version="1.0" encoding="UTF-8"?>
<!-- Tour 10, "Durable application state": the todo document, committed with the transcript; a fork's todos as of its fork entry. -->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="tour · durable application state" initial="setup">
  <state id="setup">
    <onentry>
      <send type="stage" event="client.add"><param name="client" expr="'you'"/><param name="name" expr="'You'"/></send>
    </onentry>
    <transition event="client.you.live" target="first"/>
  </state>

  <state id="first">
    <onentry><send event="go" delay="1s"/></onentry>
    <transition event="go" target="adding">
      <send type="stage" event="type"><param name="text" expr="'Add to my list: buy milk and call Bo'"/></send>
    </transition>
  </state>

  <state id="adding">
    <transition event="commit.todo.add" target="added">
      <send type="stage" event="note">
        <param name="text" expr="'The todo tool changes the app.todos document in a commit: the same kind of atomic commit that stores the transcript. The list (in the conversation) is a client subscribing to the committed value; the todos section shows it to the model before every request.'"/>
        <param name="cite" expr="'documents'"/>
      </send>
    </transition>
  </state>
  <state id="added">
    <transition event="commit.generation.answer" target="second"/>
  </state>

  <state id="second">
    <onentry><send event="go" delay="1.5s"/></onentry>
    <transition event="go" target="more">
      <send type="stage" event="type"><param name="text" expr="'Add to my list: water the plants'"/></send>
    </transition>
  </state>

  <state id="more">
    <transition event="commit.generation.answer" target="fork"/>
  </state>

  <state id="fork">
    <onentry><send event="go" delay="2s"/></onentry>
    <transition event="go" target="forked">
      <send type="stage" event="fork">
        <param name="title" expr="'what if'"/>
        <param name="at" expr="'firstAnswer'"/>
      </send>
    </transition>
  </state>

  <state id="forked">
    <transition event="client.you.live" target="done">
      <send type="stage" event="note">
        <param name="text" expr="'A fork at the first answer. app.todos is defined with fork: &quot;asOf&quot;, so the fork starts with the two todos its parent had at that entry, not three. pi.inbox and pi.usage are &quot;initial&quot;: empty.'"/>
        <param name="cite" expr="'documents'"/>
      </send>
    </transition>
  </state>

  <final id="done"/>
</scxml>
`;var $t=`<?xml version="1.0" encoding="UTF-8"?>
<!-- Tour 11, "Malleable": replace an extension while a call of it runs. -->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="tour · malleable" initial="setup">
  <state id="setup">
    <onentry>
      <send type="stage" event="client.add"><param name="client" expr="'you'"/><param name="name" expr="'You'"/></send>
    </onentry>
    <transition event="client.you.live" target="ask"/>
  </state>

  <state id="ask">
    <onentry><send event="go" delay="1s"/></onentry>
    <transition event="go" target="running">
      <send type="stage" event="type"><param name="text" expr="'Deploy v1.6.0'"/></send>
    </transition>
  </state>

  <state id="running">
    <transition event="tool.deploy.run" target="install"/>
  </state>

  <state id="install">
    <onentry><send event="go" delay="2s"/></onentry>
    <transition event="go" target="finishing">
      <send type="stage" event="install"><param name="extension" expr="'ops@2'"/></send>
      <send type="stage" event="note">
        <param name="text" expr="'ops@2 is installed while the deploy runs: same name, so it replaces ops@1 in one step. The running call finishes on the code it started with (see its output: ops@1).'"/>
        <param name="cite" expr="'malleable'"/>
        <param name="panel" expr="'process'"/>
        </send>
    </transition>
  </state>

  <state id="finishing">
    <transition event="commit.generation.answer" target="again"/>
  </state>

  <state id="again">
    <onentry><send event="go" delay="1.5s"/></onentry>
    <transition event="go" target="second">
      <send type="stage" event="type"><param name="text" expr="'Deploy v1.6.1'"/></send>
    </transition>
  </state>

  <state id="second">
    <transition event="tool.deploy.run">
      <send type="stage" event="note">
        <param name="text" expr="'The next call resolves deploy again and gets ops@2: a canary first.'"/>
        <param name="cite" expr="'malleable'"/>
      </send>
    </transition>
    <transition event="commit.generation.answer" target="restart"/>
  </state>

  <state id="restart">
    <onentry>
      <send type="stage" event="kill"/>
      <send event="go" delay="1.5s"/>
    </onentry>
    <transition event="go" target="done">
      <send type="stage" event="start"/>
      <send type="stage" event="note">
        <param name="text" expr="'The conversation stores the names &quot;ops&quot; and &quot;deploy&quot;, never code. A new process installs whatever is deployed now (ops@2; see Process › Registry) and the conversation picks it up.'"/>
        <param name="cite" expr="'malleable'"/>
        <param name="panel" expr="'process'"/>
        </send>
    </transition>
  </state>

  <final id="done"/>
</scxml>
`;var Rt=`<?xml version="1.0" encoding="UTF-8"?>
<!-- Tour 12, "Multiplayer": a late joiner gets the view, then ops; a steer joins the run after the tool round. -->
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="tour · multiplayer" initial="setup">
  <state id="setup">
    <onentry>
      <send type="stage" event="client.add"><param name="client" expr="'you'"/><param name="name" expr="'Ada'"/></send>
    </onentry>
    <transition event="client.you.live" target="ask"/>
  </state>

  <state id="ask">
    <onentry><send event="go" delay="1s"/></onentry>
    <transition event="go" target="working">
      <send type="stage" event="type"><param name="text" expr="'Why is checkout slow?'"/></send>
    </transition>
  </state>

  <state id="working">
    <transition event="tool.bash.run" target="join"/>
  </state>

  <state id="join">
    <onentry><send event="go" delay="800ms"/></onentry>
    <transition event="go" target="joining">
      <send type="stage" event="client.add"><param name="client" expr="'bo'"/><param name="name" expr="'Bo'"/></send>
    </transition>
  </state>

  <state id="joining">
    <transition event="client.bo.live" target="steer">
      <send type="stage" event="note">
        <param name="text" expr="'Bo joins while the agent works. His client got the current view first, the running bash and its output included, and from now on only each commit’s ops (see the frame and op counts in his client).'"/>
        <param name="cite" expr="'multiplayer'"/>
      </send>
    </transition>
  </state>

  <state id="steer">
    <onentry><send event="go" delay="700ms"/></onentry>
    <transition event="go" target="steered">
      <send type="stage" event="type">
        <param name="client" expr="'bo'"/>
        <param name="text" expr="'Check the staging logs first'"/>
        <param name="whenBusy" expr="'steer'"/>
      </send>
      <send type="stage" event="type">
        <param name="client" expr="'bo'"/>
        <param name="text" expr="'Then summarise it for the team'"/>
        <param name="whenBusy" expr="'followUp'"/>
      </send>
      <send type="stage" event="type">
        <param name="text" expr="'Are you done yet?'"/>
        <param name="whenBusy" expr="'reject'"/>
      </send>
      <send type="stage" event="note">
        <param name="text" expr="'Bo steers (whenBusy: steer) and queues a follow-up; both wait in the inbox. Ada asks with whenBusy: reject, and is refused: ConversationBusy, nothing written.'"/>
        <param name="cite" expr="'multiplayer'"/>
      </send>
    </transition>
  </state>

  <state id="steered">
    <transition event="commit.generation.postTools" target="followUp">
      <send type="stage" event="note">
        <param name="text" expr="'The tool round is over: at the postTools boundary the steer was placed and joined the running work. The follow-up waits for the answer.'"/>
        <param name="cite" expr="'multiplayer'"/>
      </send>
    </transition>
  </state>

  <state id="followUp">
    <transition event="commit.generation.answer" target="last"/>
  </state>
  <state id="last">
    <transition event="commit.generation.answer" target="done">
      <send type="stage" event="note">
        <param name="text" expr="'The answer took the steer into account; then the follow-up ran as its own run. Both clients saw every step.'"/>
        <param name="cite" expr="'multiplayer'"/>
      </send>
    </transition>
  </state>

  <final id="done"/>
</scxml>
`;var V={kind:"pi.agent",fork:"asOf",initial:()=>({})},q={kind:"pi.live",fork:"initial",initial:()=>({})},G={kind:"pi.inbox",fork:"initial",initial:()=>({items:[]})},ae={kind:"pi.usage",fork:"initial",initial:()=>({requests:0,inputTokens:0,outputTokens:0,toolCalls:0})},Z={kind:"app.todos",fork:"asOf",initial:()=>({items:[]})},Ct=[V,q,G,ae,Z];var j=(e)=>e.state.status!=="terminal";var O=(e)=>e===void 0?e:structuredClone(e);class Ce{clock;owner=null;seq=0;conversations=new Map;entries=new Map;order=new Map;tasks=new Map;submissions=new Map;docs=new Map;log=[];#e={};#t=new Set;constructor(e){this.clock=e}mint(e){return this.#e[e]=(this.#e[e]??0)+1,`${e}${this.#e[e]}`}subscribe(e){return this.#t.add(e),()=>this.#t.delete(e)}commit(e,t,n){let s=++this.seq;for(let r of n)switch(r.type){case"conversation":if(this.conversations.set(r.record.id,O(r.record)),!this.order.has(r.record.id))this.order.set(r.record.id,[]);break;case"entry":{let d={...O(r.record),seq:s};this.entries.set(d.id,d),r.record.seq=s;let i=this.order.get(d.conversationId)??[];i.push(d.id),this.order.set(d.conversationId,i);break}case"task":this.tasks.set(r.record.id,O(r.record));break;case"submission":this.submissions.set(r.record.id,O(r.record));break;case"doc":{let d=re(r.kind,r.scope),i=this.docs.get(d)??{kind:r.kind,scope:r.scope,value:void 0,history:[]};i.value=O(r.value),i.history.push({seq:s,value:O(r.value)}),this.docs.set(d,i);break}case"owner":this.owner=r.owner;break}let o={seq:s,at:this.clock.now(),by:e,name:t,writes:O(n)};this.log.push(o);for(let r of this.#t)r(o);return o}doc(e,t){let n=this.docs.get(re(e.kind,t));return n?O(n.value):e.initial()}docAsOf(e,t,n){let o=this.docs.get(re(e.kind,t))?.history.findLast((r)=>r.seq<=n);return o?O(o.value):e.initial()}transcript(e){let t=this.conversations.get(e);if(!t)return[];let n=(this.order.get(e)??[]).map((r)=>this.entries.get(r));if(!t.parent)return n;let s=this.transcript(t.parent.conversationId),o=s.findIndex((r)=>r.id===t.parent.at);return[...s.slice(0,o+1),...n]}workingSet(){let e=0;for(let t of this.conversations.keys())e+=ee(this.transcript(t)).entries.length;return{entries:e,tasks:[...this.tasks.values()].filter((t)=>t.state.status!=="terminal").length,submissions:[...this.submissions.values()].filter((t)=>t.status==="queued"||t.status==="placed").length}}}var re=(e,t)=>`${e}@${t}`;function ee(e){let t=-1;for(let i=e.length-1;i>=0;i--){let u=e[i].data.kind;if(u==="pi.compaction"||u==="pi.reset"){t=i;break}}if(t<0)return{entries:e.filter(Re),headIndex:0};let n=e[t].data;if(n.kind==="pi.reset")return{...n.handoff?{handoff:n.handoff}:{},entries:e.slice(t+1).filter(Re),headIndex:t};let s=n,o=e.findIndex((i)=>i.id===s.firstKept),r=o>=0?o:t+1,d=e.filter((i,u)=>u>=r&&u!==t&&i.data.kind!=="pi.compaction"&&i.data.kind!=="pi.reset");return{summary:s.summary,entries:d.filter(Re),headIndex:r}}var Re=(e)=>!(e.data.kind==="pi.assistant"&&e.data.stopReason==="aborted"),Ln=(e)=>Math.max(1,Math.ceil(e.length/4));function Ae(e){switch(e.kind){case"pi.user":return e.text;case"pi.assistant":return e.text+e.toolCalls.map((t)=>` ${t.name}(${JSON.stringify(t.args)})`).join("");case"pi.system":return Object.values(e.sections).join(`
`);case"pi.tool-result":return e.text;case"pi.compaction":return e.summary;case"pi.reset":return e.handoff??""}}class oe{storage;by;name;#e=new Map;#t=[];#n=new Map;constructor(e,t,n){this.storage=e;this.by=t;this.name=n}get now(){return this.storage.clock.now()}conversation(e){let t=this.#e.get(`conversation:${e}`);return t?t.record:O(this.storage.conversations.get(e))}task(e){let t=this.#e.get(`task:${e}`);return t?t.record:O(this.storage.tasks.get(e))}submission(e){let t=this.#e.get(`submission:${e}`);return t?t.record:O(this.storage.submissions.get(e))}entry(e){return this.#t.find((t)=>t.id===e)??O(this.storage.entries.get(e))}tasks(){let e=new Set([...this.storage.tasks.keys()]);for(let t of this.#e.keys())if(t.startsWith("task:"))e.add(t.slice(5));return[...e].map((t)=>this.task(t))}conversations(){let e=new Set([...this.storage.conversations.keys()]);for(let t of this.#e.keys())if(t.startsWith("conversation:"))e.add(t.slice(13));return[...e].map((t)=>this.conversation(t))}submissions(e){let t=new Set([...this.storage.submissions.keys()]);for(let n of this.#e.keys())if(n.startsWith("submission:"))t.add(n.slice(11));return[...t].map((n)=>this.submission(n)).filter((n)=>n.conversationId===e)}transcript(e){return[...this.storage.transcript(e),...this.#t.filter((t)=>t.conversationId===e)]}putConversation(e){this.#e.set(`conversation:${e.id}`,{type:"conversation",record:e})}putTask(e){this.#e.set(`task:${e.id}`,{type:"task",record:e})}putSubmission(e){this.#e.set(`submission:${e.id}`,{type:"submission",record:e})}append(e,t,n){let s={id:this.storage.mint("e"),conversationId:e,seq:0,at:this.now,tokens:Ln(Ae(t)),data:t,...n?{byTaskId:n}:{}};return this.#t.push(s),s}doc(e,t){let n=re(e.kind,t),s=this.#n.get(n);if(!s){let o=this.storage.doc(e,t);s={kind:e.kind,scope:t,value:o,json:this.storage.docs.has(n)?JSON.stringify(o):""},this.#n.set(n,s)}return s.value}setDoc(e,t,n){this.doc(e,t),this.#n.get(re(e.kind,t)).value=n}mint(e){return this.storage.mint(e)}commit(){let e=[];for(let t of this.#e.values())if(t.type==="conversation")e.push(t);for(let t of this.#t)e.push({type:"entry",record:t});for(let t of this.#e.values())if(t.type!=="conversation")e.push(t);for(let t of this.#n.values())if(JSON.stringify(t.value)!==t.json)e.push({type:"doc",kind:t.kind,scope:t.scope,value:t.value});if(!e.length)return null;return this.storage.commit(this.by,this.name,e)}}function At(e,t,n){for(let s of Ct){let o=s.initial();if(n&&s.fork==="asOf")o=e.storage.docAsOf(s,n.conversationId,n.seq);else if(n&&s.fork==="current")o=e.storage.doc(s,n.conversationId);e.setDoc(s,t,o)}}class ie extends Error{constructor(){super("ConversationBusy: the conversation is running and the submission asked to be rejected")}}function W(e,t,n){let s=t.task(n.kind);if(!s)throw Error(`no task definition ${n.kind}`);if(n.background&&n.owner)throw Error("only conversation-owned tasks may be background");let o=e.mint("t"),r=n.input??{};return e.putTask({id:o,conversationId:n.conversationId,kind:n.kind,version:s.version,input:r,...n.owner?{owner:n.owner}:{},background:!!n.background,abortRequested:!1,state:{status:"pending",checkpoint:s.initial(r)},label:n.label,createdAt:e.now}),o}function te(e,t){let n=e.mint("c"),s=t.ownership.kind==="task"?e.task(t.ownership.taskId):void 0;e.putConversation({id:n,title:t.title,...t.fork?{parent:t.fork}:{},...s?{owner:{conversationId:s.conversationId,taskId:s.id}}:{},createdAt:e.now});let o=t.fork?e.entry(t.fork.at):void 0;if(At(e,n,t.fork&&o?{conversationId:t.fork.conversationId,seq:o.seq}:void 0),s)e.setDoc(V,n,structuredClone(e.doc(V,s.conversationId)));if(t.agent)qe(e,n,t.agent);return n}function qe(e,t,n){let s=e.doc(V,t);for(let[o,r]of Object.entries(n))if(r===null)delete s[o];else if(r!==void 0)s[o]=r}var Dn=(e,t)=>!!e.doc(q,t).run;function ge(e,t,n,s){if(s.requestId){let u=e.submissions(n).find((p)=>p.requestId===s.requestId);if(u)return{id:u.id,duplicate:!0}}let o=s.type??"input",r=Dn(e,n);if(r&&o==="input"&&s.whenBusy==="reject")throw new ie;let d=e.doc(G,n),i={id:e.mint("s"),conversationId:n,type:o,status:"queued",at:e.now,...s.requestId?{requestId:s.requestId}:{},...o==="input"?{whenBusy:s.whenBusy??"followUp",author:s.author??"You",text:s.text??""}:{},...s.write?{write:s.write}:{}};if(r||d.items.length){if(e.putSubmission(i),d.items.push({id:i.id,mode:o==="write"?"write":i.whenBusy==="steer"?"steer":"followUp",...i.author?{author:i.author}:{},...i.text!==void 0?{text:i.text}:s.write?.kind==="pi.compaction"?{text:"compaction summary"}:{}}),!r)de(e,t,n,"final");return{id:i.id,duplicate:!1}}if(o==="write")Mt(e,i);else qt(e,i),Lt(e,t,n,[i.id]);return{id:i.id,duplicate:!1}}function qt(e,t){let n=e.append(t.conversationId,{kind:"pi.user",author:t.author??"You",text:t.text??"",submissionId:t.id});e.putSubmission({...t,status:"placed",entry:n.id})}function Mt(e,t){let n=e.append(t.conversationId,t.write);e.putSubmission({...t,status:"done",entry:n.id})}function Lt(e,t,n,s){let o=W(e,t,{conversationId:n,kind:"pi.generation",label:"model request"}),r=e.doc(q,n);return r.run={taskId:o,inputs:s},r.generation={taskId:o,attempt:1},r.tools=[],o}function de(e,t,n,s){let o=e.doc(G,n),r=[];for(let p of o.items)if(p.mode==="write")r.push(p.id);let d=o.items.find((p)=>p.mode==="steer");if(d)r.push(d.id);if(s==="final"){let p=o.items.find((g)=>g.mode==="followUp");if(p)r.push(p.id)}o.items=o.items.filter((p)=>!r.includes(p.id));let i=[];for(let p of r.sort(On)){let g=e.submission(p);if(g.type==="write")Mt(e,g);else qt(e,g),i.push(p)}if(!i.length)return{placed:[]};let u=e.doc(q,n);if(s==="postTools"&&u.run)return u.run.inputs.push(...i),{placed:i};return{placed:i,started:Lt(e,t,n,i)}}var On=(e,t)=>Number(e.slice(1))-Number(t.slice(1));function ce(e,t,n){let s=e.doc(q,t);for(let o of s.run?.inputs??[]){let r=e.submission(o);if(!r||r.status==="done"||r.status==="unanswered")continue;e.putSubmission("answer"in n?{...r,status:"done",answer:n.answer}:{...r,status:"unanswered",reason:n.reason})}delete s.run,delete s.generation,s.tools=[]}function Me(e,t,n={}){let s=e.doc(G,t);for(let r of s.items){if(r.mode==="write")continue;let d=e.submission(r.id);e.putSubmission({...d,status:"unanswered",reason:"aborted"})}s.items=s.items.filter((r)=>r.mode==="write");let o=[];for(let r of e.tasks()){if(r.conversationId!==t||r.owner||!j(r)||r.abortRequested)continue;if(r.background&&!n.background)continue;if(r.state.status==="completing")continue;e.putTask({...r,abortRequested:!0}),o.push(r.id)}return o}function le(e,t,n){let s=[];for(let o of e)if(o.owner===n&&j(o))s.push(o,...le(e,t,o.id));for(let o of t)if(o.owner?.taskId===n)s.push(...Pn(e,t,o.id));return s}function Pn(e,t,n){let s=[];for(let o of e)if(o.conversationId===n&&!o.owner&&!o.background&&j(o))s.push(o,...le(e,t,o.id));return s}var L=(e,t=!1)=>({text:e,...t?{isError:t}:{}}),M=(e)=>String(e??""),Dt={name:"bash",description:"Run a shell command in the conversation's working directory",execute:async(e,t)=>{let{code:n,output:s}=await t.env.exec(M(e.command),(o)=>t.output(`${o}
`),t.signal);return L(s||"(no output)",n!==0)}},_n={name:"coding",version:1,blurb:"read, write, edit, bash (CodingTools)",tools:[{name:"read",description:"Read a file",replay:"safe",execute:async(e,t)=>{await t.sleep(400);let n=t.env.read(M(e.path));return n===void 0?L(`no such file: ${e.path}`,!0):L(n)}},{name:"write",description:"Write a file",execute:async(e,t)=>(await t.sleep(300),t.env.write(M(e.path),M(e.content)),L(`wrote ${e.path}`))},{name:"edit",description:"Replace text in a file",execute:async(e,t)=>{await t.sleep(500);let n=t.env.read(M(e.path));if(n===void 0||!n.includes(M(e.find)))return L(`could not find the text in ${e.path}`,!0);return t.env.write(M(e.path),n.replace(M(e.find),M(e.replace))),L(`edited ${e.path}`)}},Dt]},Bn={name:"project-context",version:1,blurb:"the agents_md section, read from the conversation's environment",sections:[{key:"agents_md",render:(e)=>e.env.read("AGENTS.md")?.trimEnd()}]},Hn={"flaky login":`#208 login test times out when the token is slow (open)
#97 flaky CI on Mondays (closed)`,"deploy failure":"#311 deploy v1.5.0 failed: migration 0042 timed out (open)"};function Ot(e){return{name:"ops",version:e,blurb:e===1?"search_issues (safe), deploy":"search_issues (safe), deploy with a canary",tools:[{name:"search_issues",description:"Search the issue tracker",replay:"safe",execute:async(t,n)=>(n.output(`searching for ${t.query}
`),await n.sleep(2500),L(Hn[M(t.query)]??"no issues found"))},{name:"deploy",description:"Deploy a version to production",execute:async(t,n)=>{let s=e===1?[`ops@1: building ${t.version}`,"ops@1: pushing image",`ops@1: ${t.version} is live`]:[`ops@2: building ${t.version}`,"ops@2: canary at 10%","ops@2: canary healthy, 100%",`ops@2: ${t.version} is live`];for(let o of s)await n.sleep(1500),n.output(`${o}
`);return L(s.join(`
`))}}]}}var Pt=Ot(1),jn=Ot(2),Nn={name:"approval",version:1,blurb:"beforeTool: a person approves every deploy (memo: approval:deploy)",hooks:{beforeTool:async(e,t)=>{if(e.name!=="deploy")return;let n=t.memo("approval:deploy");return n??=t.memo("approval:deploy",await t.ask(`Deploy ${e.args.version}?`)),n?void 0:{block:"Nobody approved the deploy."}}}},Wn={name:"freeze",version:1,blurb:"beforeTool: no deploys during a change freeze",hooks:{beforeTool:async(e,t)=>{if(e.name!=="deploy")return;return await t.sleep(2500),String(e.args.version).endsWith("-friday")?{block:"Change freeze: no deploys on Fridays."}:void 0}}},Fn={name:"venv",version:1,blurb:"replaces bash with one that runs inside a Python virtualenv",tools:[{...Dt,execute:async(e,t)=>{let{code:n,output:s}=await t.env.exec(M(e.command),(o)=>t.output(`(venv) ${o}
`),t.signal);return L(s?s.replace(/^/gm,"(venv) "):"(no output)",n!==0)}}]},Un={name:"timing",version:1,blurb:"wraps whichever bash won, and times every call",wraps:[{tool:"bash",wrap:(e)=>({...e,execute:async(t,n)=>{let s=n.now();try{return await e.execute(t,n)}finally{n.details({timing:`${((n.now()-s)/1000).toFixed(1)} s`})}}})}]},Vn={name:"subagents",version:1,blurb:"triage: a subagent in a conversation owned by the call",tools:[{name:"triage",description:"Label an incoming issue as bug, feature, or question",replay:"safe",execute:async(e,t)=>{let n=t.commit("triage.subagent",(r)=>{let d=r.conversations().find((i)=>i.owner?.taskId===t.taskId);if(d)return d.id;return te(r,{title:"triage (subagent)",ownership:{kind:"task",taskId:t.taskId},agent:{model:"sim-luna",tools:[],instructions:"Answer with one word: bug, feature, or question."}})});t.details({conversationId:n});let s=t.submit(n,{text:M(e.issue),requestId:`triage:${t.taskId}`}),o=await t.waitForSubmission(s);if(o.status!=="done")return L(`the subagent didn't answer (${o.reason})`,!0);return L(t.answerText(o.answer))}}]},zn={name:"shop",version:1,blurb:"checkout: tasks shop.checkout and shop.payment (failFast)",tools:[{name:"checkout",description:"Pay for the cart, split across several cards",execute:async(e,t)=>{let n=e.cards??[],s=t.createTask("shop.checkout",{cards:n},{ownership:{kind:"task",taskId:t.taskId},label:`checkout (${n.length} cards)`});t.details({taskId:s});let o=await t.waitForTask(s),r=o.state.status==="terminal"?o.state.outcome:void 0;return r?.status==="completed"?L(String(r.result)):L(`${r?.status}: ${r?.error?.message??""}`.trim(),!0)}}],tasks:[{name:"shop.checkout",version:1,chart:"checkout",initial:()=>({phase:"pay"})},{name:"shop.payment",version:1,chart:"payment",initial:()=>({phase:"charge"})}]},Kn={name:"reminders",version:1,blurb:"remind_me: a background app.reminder task",tools:[{name:"remind_me",description:"Remind the user later",execute:async(e,t)=>{let n=t.now()+Number(e.inSeconds??20)*1000;return t.createTask("app.reminder",{text:M(e.text),until:n},{ownership:{kind:"conversation"},background:!0,label:"reminder"}),L(`reminder set for +${e.inSeconds??20} s`)}}],tasks:[{name:"app.reminder",version:1,chart:"reminder",initial:(e)=>({phase:"sleep",until:e.until})}]},Gn={name:"todo",version:1,blurb:"the app.todos document, its tool and its section",tools:[{name:"todo",description:"Add an item to your todo list",execute:async(e,t)=>(await t.sleep(300),t.commit("todo.add",(n)=>{n.doc(Z,t.conversationId).items.push(M(e.item))}),L(`Added ${e.item}`))}],sections:[{key:"todos",render:(e)=>e.read(Z).items.join(`
`)||void 0}]},Yn={name:"history",version:1,blurb:"handoff, search_history",tools:[{name:"handoff",description:"Start over from a handoff note. Older messages stay searchable with search_history.",execute:async(e,t)=>(t.submit(t.conversationId,{text:"Continue.",requestId:`handoff:${t.taskId}`}),{text:"Handing off.",control:{handoff:M(e.note)}})},{name:"search_history",description:"Search older messages, including those before a handoff",replay:"safe",execute:async(e,t)=>{await t.sleep(400);let n=t.allEntries().filter((s)=>s.text.includes(M(e.text)));return L(n.map((s)=>`${s.id}: ${s.text.slice(0,80)}`).join(`
`)||"nothing found")}}]},_t=[_n,Bn,Pt,Nn,Wn,Vn,zn,Kn,Gn,Yn],ve={"ops@1":Pt,"ops@2":jn,"venv@1":Fn,"timing@1":Un};var Bt={harness:{id:"harness",section:"What is a harness?",quotes:["A harness is storage plus the machinery needed to run one or more conversations with large language models in parallel. It provides the tools those models call, and the execution environments the tools run in.","Everything the harness runs, from calling the model to executing a tool, is a task."]},anywhere:{id:"anywhere",section:"Long runs anywhere",quotes:["In Pi Durable, a harness opens over a storage backend.","One process owns a storage at a time, and other clients attach to that process.","Your env function builds the environment for every tool call, from the conversation's working directory, so each conversation can run in a different place."]},crashes:{id:"crashes",section:"Survives crashes",quotes:["In Pi Durable, every step of a run is a task that stores a checkpoint before it moves on. If the process dies, a new process opens the same storage, finds the unfinished tasks, and continues each one from its last checkpoint.","A model request that was cut off is sent again; the partial answer stays in the transcript, marked as aborted. A tool call that was cut off reruns if it is safe to; otherwise the model is told it was interrupted.","Queued messages are still queued. A requestId makes a submission exactly-once, so a client that retries after a crash gets the original submission back instead of asking twice."]},conversations:{id:"conversations",section:"Many conversations at once",quotes:["A conversation starts fresh or forks another one at any point in its transcript, and sees the parent's history up to that point without copying it.","A reviewer next to the main agent can use a cheaper model, read-only tools, and its own checkout."]},sections:{id:"sections",section:"Extensions › System prompt sections",quotes:["The system prompt is rebuilt from the sections of the conversation's extensions before every request, so a changed section is picked up by the next request. Pi Durable records what changed in the transcript, at the position where it changed, so a restart or a fork sees exactly what the model saw."]},tools:{id:"tools",section:"Extensions › Tools",quotes:["Every tool call runs as its own durable task, and its intent is stored before it runs. After a crash, a tool reruns only if it says that is safe.","A tool creates a conversation it owns, gives it a smaller model and its own instructions, and waits for its answer.","A tool with the same name in a later extension replaces the earlier one, for example a bash that runs inside a Python virtualenv. A wrap decorates whichever tool won, wherever the wrapping extension is selected."]},hooks:{id:"hooks",section:"Extensions › Hooks",quotes:["A hook can run again after a crash, so a hook that makes a decision stores it in a memo: a small value stored with the task, where the first write wins.","Their hooks run as a chain, in the order the conversation selects the extensions, and each hook defines how its chain runs."]},tasks:{id:"tasks",section:"Extensions › Tasks",quotes:["A checkout that splits the bill across several cards charges every card at once. If one card is declined, the other payments are aborted and refund themselves","Tasks and conversations form one ownership tree. Aborting a task aborts what it owns, bottom-up, so every task cleans up its own effects first, and a task only finishes once the work it owns has finished.","A background task belongs to the conversation, but not to its current work. The conversation goes idle while it runs, and an ordinary abort leaves it and everything it owns alone."]},compaction:{id:"compaction",section:"Compaction",quotes:["When the context gets close to the model's limit, a background compaction summarizes the older messages, and the summary is placed at the next turn boundary. The conversation only waits for a summary when the next request would not fit otherwise.","Because nothing is deleted, a second tool can still search everything before the handoff."]},documents:{id:"documents",section:"Durable application state",quotes:["Documents are typed JSON stored next to the transcript and changed in the same atomic commits, so the state never disagrees with the transcript that produced it. Each document says what a fork starts with: the parent's value at the fork point, its current value, or a fresh one."]},malleable:{id:"malleable",section:"Malleable",quotes:["Installing an extension under a name that is already installed replaces it in one step. A tool call that is already running finishes on the code it started with; the next call uses the new code.","Conversations store extension and tool names, never code, so after a restart they pick up whatever the new process installs."]},multiplayer:{id:"multiplayer",section:"Multiplayer",quotes:["A client gets the current view first: the transcript, the answer being streamed, running tools and their output, queued messages, the agent, and usage. After that it only gets what changes.","Any client can steer a running conversation or queue a follow-up."]}};var Ht='<svg xmlns="http://www.w3.org/2000/svg" viewBox="165 165 470 470" aria-hidden="true"><path fill="#F09082" d="M165.29 165.29H517.36V400H400V282.65H165.29Z"/><path fill="#4D9ABF" d="M165.29 282.65H282.65V400H400V517.36H282.65V634.72H165.29Z"/><path fill="#F1BE58" d="M517.36 400H634.72V634.72H517.36Z"/></svg>';var Jn={"/work/repo/README.md":`# shop

A small web shop: login, cart, checkout.
`,"/work/repo/AGENTS.md":`- Use bun for everything.
- Keep answers short.
`,"/work/repo/test/login.test.ts":`test("logs in", async () => {
  await login({ timeout: 100 });
});
`,"/work/repo/CHANGELOG.md":`## Unreleased
`,"/work/review/README.md":`# shop (review checkout)
`,"/work/review/AGENTS.md":`- You review; never change files.
`};class Le{clock;files=new Map(Object.entries(Jn));runs=[];constructor(e){this.clock=e}env(e="/work/repo"){let t=(n)=>n.startsWith("/")?n:`${e}/${n}`;return{cwd:e,label:`MemoryEnv(${e})`,read:(n)=>this.files.get(t(n)),write:(n,s)=>void this.files.set(t(n),s),list:()=>[...this.files.keys()].filter((n)=>n.startsWith(`${e}/`)).map((n)=>n.slice(e.length+1)),exec:(n,s,o)=>this.#t(e,n,s,o)}}#e(e,t){let n=t.trim();if(n==="pwd")return{script:[[200,e]],code:0};if(n==="ls")return{script:[[300,this.env(e).list().join("  ")]],code:0};if(n.startsWith("cat ")){let s=this.env(e).read(n.slice(4).trim());return s===void 0?{script:[[200,`cat: ${n.slice(4)}: No such file`]],code:1}:{script:[[200,s.trimEnd()]],code:0}}if(n.startsWith("bun test")){let o=(this.files.get(`${e}/test/login.test.ts`)??"").includes("timeout: 500");return{script:[[500,"bun test v1.3.0"],[900,"test/login.test.ts:"],[1200,"  ✓ renders the form [12ms]"],[1200,"  ✓ rejects a wrong password [31ms]"],[1500,o?"  ✓ logs in [212ms]":"  ✗ logs in: timed out after 100ms (the token arrived after 212ms)"],[600,o?" 3 pass, 0 fail":" 2 pass, 1 fail"]],code:o?0:1}}if(n.startsWith("tail")&&n.includes("staging"))return{script:[[600,"staging  12:01:07  checkout: payment provider p95 1840ms"],[800,"staging  12:01:09  checkout: retrying card authorisation (attempt 2)"],[700,"staging  12:01:12  checkout: 3 of 40 requests over 2s"]],code:0};if(n.startsWith("tail"))return{script:[[800,"prod  12:00:41  GET /checkout 200 412ms"],[900,"prod  12:00:44  GET /checkout 200 1207ms"],[900,"prod  12:00:49  POST /checkout/pay 200 1931ms"],[900,"prod  12:00:52  GET /checkout 200 388ms"]],code:0};if(n.startsWith("git log"))return{script:[[300,`a1c9e0f fix: retry token refresh
77d01b2 feat: split payments`]],code:0};return{script:[[200,`sh: ${n.split(" ")[0]}: command not found`]],code:127}}#t(e,t,n,s){this.runs.push({command:t,cwd:e,at:this.clock.now()});let{script:o,code:r}=this.#e(e,t);return new Promise((d,i)=>{let u=[],p,g=0,h=()=>{if(g>=o.length)return d({code:r,output:u.join(`
`)});let[v,y]=o[g++];p=this.clock.setTimeout(()=>{u.push(y),n(y),h()},v)};s.addEventListener("abort",()=>{this.clock.clearTimeout(p),i(Error("aborted"))}),h()})}}class De{clock;charges=new Map;declines=new Set(["mc-0009"]);latency=new Map;latencyMs=1500;log=[];constructor(e){this.clock=e}charge(e,t,n){return this.#e(this.latency.get(e)??this.latencyMs,n,!0,()=>{let s=this.charges.get(t);if(s?.status==="voided")return this.log.push(`${t}: voided before it arrived, not charged`),{ok:!1,error:"voided"};if(s)return this.log.push(`${t}: already ${s.status} (idempotent)`),s.status==="declined"?{ok:!1,error:`${e} was declined`,repeated:!0}:{ok:!0,receipt:s.receipt,repeated:!0};if(this.declines.has(e))return this.charges.set(t,{card:e,status:"declined"}),this.log.push(`${t}: ${e} declined`),{ok:!1,error:`${e} was declined`};let o=`rcpt-${e.slice(-4)}`;return this.charges.set(t,{card:e,status:"charged",receipt:o}),this.log.push(`${t}: charged ${e}`),{ok:!0,receipt:o}})}refund(e,t){return this.#e(600,t,!1,()=>{let n=this.charges.get(e);if(!n)return this.charges.set(e,{card:"?",status:"voided"}),this.log.push(`${e}: voided (no charge yet)`),{refunded:!1};if(n.status!=="charged")return this.log.push(`${e}: nothing to refund`),{refunded:!1};return n.status="refunded",this.log.push(`${e}: refunded ${n.card}`),{refunded:!0}})}#e(e,t,n,s){return new Promise((o,r)=>{let d=this.clock.setTimeout(()=>{let i=s();if(!t.aborted)o(i)},e);t.addEventListener("abort",()=>{if(!n)this.clock.clearTimeout(d);r(Error("aborted"))})})}}class pe extends Error{retryable;constructor(e,t){super(e);this.retryable=t}}class Oe{clock;wordsPerSecond=20;thinkMs=600;#e=[];requests=[];constructor(e){this.clock=e}fault(e){this.#e.push(e)}async stream(e,t,n){this.requests.push({at:this.clock.now(),model:e.model,mode:e.mode,messages:e.messages.length}),await this.#t(this.thinkMs,n);let s=this.#e.shift();if(s==="overloaded")throw new pe("overloaded (529): try again",!0);if(s==="invalid")throw new pe("invalid request (400)",!1);let o=Qn(e),r=o.text.split(/(?<=\s)/),d="";for(let i of r)await this.#t(1000/this.wordsPerSecond,n),d+=i,t(d);return o}#t(e,t){return new Promise((n,s)=>{if(t.aborted)return s(Error("aborted"));let o=this.clock.setTimeout(n,e);t.addEventListener("abort",()=>{this.clock.clearTimeout(o),s(Error("aborted"))})})}}var R=(e,t)=>({name:e,args:t}),F=(e,t)=>e.find((n)=>n.name===t),Xn=[{match:/staging logs/i,first:()=>({text:"Checking the staging logs first.",calls:[R("bash",{command:"tail -n 20 staging.log"})]}),answer:()=>"Staging shows the payment provider at 1.8 s p95, with card authorisations retried. Checkout is slow because of the provider, not our code."},{match:/checkout (is )?slow|slow checkout/i,first:()=>({text:"Reading the production log.",calls:[R("bash",{command:"tail -n 20 /var/log/app.log"})]}),answer:()=>"Production checkout requests take up to 1.9 s, mostly in POST /checkout/pay. The payment step is the slow part."},{match:/flaky login/i,first:()=>({text:"Let me check the tracker for known issues and run the test.",calls:[R("search_issues",{query:"flaky login"}),R("bash",{command:"bun test login"})]}),next:({round:e})=>{let t=F(e,"bash"),n=F(e,"edit");if(t?.code==="interrupted")return{text:"The test run was interrupted, so I'm running it again.",calls:[R("bash",{command:"bun test login"})]};if(t?.text.includes("✗ logs in"))return{text:"The token takes up to 212 ms but the test waits only 100 ms. I'll raise the timeout.",calls:[R("edit",{path:"test/login.test.ts",find:"timeout: 100",replace:"timeout: 500"})]};if(n)return{text:"Running the test again.",calls:[R("bash",{command:"bun test login"})]};return},answer:()=>"Fixed the flaky login test. The login token can take up to 212 ms to arrive, but the test gave up after 100 ms, so it failed whenever the token was slow. I raised the timeout in test/login.test.ts to 500 ms, which matches issue #208, and the suite now passes three out of three. Nothing else needed to change."},{match:/deploy fail/i,first:()=>({text:"Searching the tracker.",calls:[R("search_issues",{query:"deploy failure"})]}),answer:()=>"The deploy failed because migration 0042 timed out on the orders table (issue #311). v1.4.1 is the last good version."},{match:/roll (it )?back|rollback/i,first:({tools:e})=>e.has("deploy")?{text:"Rolling back to v1.4.1.",calls:[R("deploy",{version:"v1.4.1"})]}:{text:"I can't roll back from this thread: deploy isn't one of my tools here. I can search the tracker, though; ask in the channel to deploy."},answer:({all:e})=>{let t=F(e,"deploy");return t&&!t.isError?"Rolled back: v1.4.1 is live.":`I didn't deploy: ${t?.text??"no result"}`}},{match:/on.call/i,first:()=>({text:"Ada is on call today; Bo is the backup."})},{match:/deploy (v\d[\w.]*)/i,first:({text:e})=>{let t=/deploy (v\d[\w.]*)/i.exec(e)[1];return{text:`Deploying ${t}.`,calls:[R("deploy",{version:t})]}},answer:({all:e})=>{let t=F(e,"deploy");return t&&!t.isError?`Done: ${t.text.split(`
`).at(-1)}`:`I didn't deploy: ${t?.text??"no result"}`}},{match:/triage|label (this|the) issue/i,first:({text:e})=>({text:"Asking a triage subagent.",calls:[R("triage",{issue:e.split(":").slice(1).join(":").trim()||e})]}),answer:({all:e})=>`Triage says: ${F(e,"triage")?.text??"nothing"}.`},{match:/checkout|pay for/i,first:({text:e})=>{let t=e.match(/\b(visa|amex|mc)-\d+/gi)??["visa-4242","amex-0005","mc-0009"];return{text:`Paying with ${t.length} cards.`,calls:[R("checkout",{cards:t})]}},answer:({all:e})=>{let t=F(e,"checkout");return t?.code==="interrupted"?"The checkout was interrupted by a restart; its payments were refunded. Nothing was charged.":`Checkout: ${t?.text??"no result"}`}},{match:/remind/i,first:()=>({text:"Setting a reminder.",calls:[R("remind_me",{text:"Stretch your legs.",inSeconds:20})]}),answer:()=>"I'll remind you in 20 seconds. The reminder is a background task, so I'm free in the meantime."},{match:/\btodo|to my list/i,first:({text:e})=>{let t=(e.split(/:\s*/)[1]??e).split(/,\s*|\s+and\s+/).map((n)=>n.trim().replace(/\.$/,"")).filter(Boolean);return{text:`Adding ${t.length} item${t.length===1?"":"s"}.`,calls:t.map((n)=>R("todo",{item:n}))}},answer:({all:e})=>`Added: ${e.map((t)=>t.text.replace(/^Added /,"")).join(", ")}.`},{match:/AGENTS\.md|house rule/i,first:()=>({text:"Adding the rule to AGENTS.md.",calls:[R("edit",{path:"AGENTS.md",find:"- Keep answers short.",replace:`- Keep answers short.
- Always run the tests before you answer.`})]}),answer:()=>"Added the rule to AGENTS.md. From the next request on, it is part of my instructions."},{match:/hand ?off|start over/i,first:()=>({text:"Handing off to a fresh context.",calls:[R("handoff",{note:"We fixed the flaky login test (timeout 100 → 500 ms, issue #208). Next: update the changelog."})]})},{match:/^continue\.?$/i,first:({req:e})=>({text:e.handoff?`Picking up from the handoff note: ${e.handoff} Older messages are still in storage; I can search them.`:"Continuing."})},{match:/earlier|search (the )?history|what did (we|i) (say|do)/i,first:({text:e})=>({text:"Searching the history, including what came before the handoff.",calls:[R("search_history",{text:/about (\w+)/i.exec(e)?.[1]??"timeout"})]}),answer:({all:e})=>{let t=F(e,"search_history"),n=t&&t.text!=="nothing found"?t.text.split(`
`).filter(Boolean).length:0;return`Found ${n} earlier message${n===1?"":"s"}. They are older than the summary and the handoff, so I no longer see them, but they are all still in storage.`}},{match:/\bfiles\b|\brepo\b|look around|what's in/i,first:()=>({text:"Looking around.",calls:[R("bash",{command:"ls"}),R("read",{path:"README.md"})]}),answer:({all:e})=>`The repository has ${F(e,"bash")?.text??"nothing"}. It's a small web shop: login, cart, checkout.`},{match:/\bpwd\b|where are you|working directory/i,first:()=>({text:"Checking.",calls:[R("bash",{command:"pwd"})]}),answer:({all:e})=>`I'm working in ${F(e,"bash")?.text.replace(/^\(venv\) /,"")??"?"}.`}],jt=["Here is how I'd think about it.","The short version is that the system keeps every step it takes, so nothing is lost when something goes wrong.","Each step is written down before the next one starts.","That makes the work easy to resume, to inspect, and to share with other people who join later.","If you want, I can go deeper on any part of this."];function Qn(e){if(e.mode==="summary"){let h=e.messages.filter((v)=>v.role==="user").map((v)=>v.text);return{text:`Summary of ${e.messages.length} earlier messages. The user asked: ${h.map((v)=>`“${v.slice(0,48)}”`).join("; ")}.`,toolCalls:[]}}if(e.instructions&&/one word/i.test(e.instructions)){let v=[...e.messages].reverse().find((k)=>k.role==="user")?.text.toLowerCase()??"";return{text:/crash|fail|error|broken|wrong/.test(v)?"bug":/please add|could you|would be nice|support/.test(v)?"feature":"question",toolCalls:[]}}let t=e.messages.findLastIndex((h)=>h.role==="user"),n=t>=0?e.messages[t].text:"",s=e.messages.slice(t+1),o=s.filter((h)=>h.role==="tool"),r=s.findLastIndex((h)=>h.role==="assistant"),d=s.slice(r+1).filter((h)=>h.role==="tool"),i={text:n,round:d,all:o,tools:new Set(e.tools),req:e},u=Xn.find((h)=>h.match.test(n));if(!u){let h=e.messages.filter((y)=>y.role==="user").length,v=[0,1,2,3,4].map((y)=>jt[(h+y)%jt.length]).join(" ");return{text:`About “${n.slice(0,60)}”: ${v}`,toolCalls:[]}}let p=o.length===0?u.first(i):u.next?.(i)??{text:u.answer?.(i)??"Done."},g=(p.calls??[]).filter((h)=>i.tools.has(h.name));if(p.calls?.length&&!g.length)return{text:`I would use ${p.calls.map((h)=>h.name).join(", ")}, but this conversation doesn't offer it.`,toolCalls:[]};return{text:p.text,toolCalls:g}}var Pe={compaction:{contextWindow:16000,reserveTokens:2000,backgroundTokens:3000,keepRecentTokens:2000}},Nt="http://tinyactors.dev/pi-durable/durable",Zn=new Set(["task.aborted","tool.aborted","generation.aborted"]),es=250;class fe extends EventTarget{processId;dead=!1;scheduling="paused";session;sessions=new Map;approvals=new Map;#e;#t=new Map;#n=new Map;#s={abort:new Set,drained:new Set,terminal:new Set};#o=new AbortController;#h=new Map;#u=new Map;#i=new Map;#g=new Set;#y=!1;#b;constructor(e){super();this.#e=e,this.processId=e.processId,this.#b=e.storage.subscribe(()=>this.#P())}get storage(){return this.#e.storage}get registry(){return this.#e.registry}get settings(){return this.#e.settings}static async open(e){let t=new fe(e);return t.session=await e.engine(Wt(e.charts.harness,`harness · ${e.processId}`),{clock:e.clock,...e.domParser?{domParser:e.domParser}:{},ioprocessors:[t.#x],data:{process:e.processId}}),t.#n.set(t.session.sessionId,"harness"),t.session.addEventListener("microstep",(n)=>{for(let s of n.entered)t.#r(`harness.${s.id}`)}),t.session.addEventListener("macrostep",()=>t.#p()),t.session.start(),t}resume(){if(!this.dead)this.session.send("resume",void 0)}kill(){if(this.dead)return;this.dead=!0,this.#o.abort(),this.#b();for(let e of this.sessions.values())e.dispose();this.session.dispose(),this.approvals.clear(),this.#g.clear(),this.#p()}#x={type:Nt,aliases:["durable"],location:()=>Nt,send:(e,t)=>{if(this.dead)return;let n=this.#n.get(t.sessionId);if(n==="harness")this.#A(e.event);else if(n)this.#T(n,e.event,e.data??{})}};#A(e){let{storage:t}=this.#e;if(e==="harness.acquire"){let n=t.owner;t.commit("harness","harness.acquire",[{type:"owner",owner:this.processId}]),this.session.send("harness.acquired",{previousOwner:n})}else if(e==="harness.reconcile"){let n=new oe(t,"harness","harness.reconcile"),s=0;for(let o of n.tasks()){if(!j(o))continue;if(s++,o.state.status==="running")n.putTask({...o,state:{status:"pending",checkpoint:o.state.checkpoint}})}n.commit(),this.session.send("harness.reconciled",{recovered:s})}else if(e==="harness.resume")this.scheduling="running",this.#k()}#a(e,t,n){let s=new oe(this.#e.storage,e,t),o=n(s);return s.commit(),this.#r(`commit.${t}`),o}#T(e,t,n){let s=this.#e.storage.tasks.get(e);if(!s||s.state.status==="terminal")return;if(s.abortRequested&&!Zn.has(t)){this.#r(`rejected.${t}`),this.#k();return}let o=this.#e.registry;if(this.#a(e,t,(r)=>{let d=r.task(e),i=d.conversationId,u=()=>r.doc(q,i),p=(h)=>this.#q(r,d,h),g=(h)=>r.putTask({...d,state:{status:"running",checkpoint:h}});switch(t){case"task.checkpoint":return g(n.checkpoint);case"task.complete":return this.#m(r,d),p({status:"completed",result:n.result});case"task.fail":return this.#m(r,d),p({status:"failed",error:{message:String(n.message??"failed")}});case"task.aborted":return this.#m(r,d),p({status:"aborted",...n.reason?{reason:String(n.reason)}:{}});case"generation.request":{this.#M(r,i);let h=u();if(n.background&&!h.compactions?.length){let v=W(r,o,{conversationId:i,kind:"pi.compaction",input:{reason:"threshold",blocking:!1},background:!0,label:"background compaction"});h.compactions=[...h.compactions??[],{taskId:v,reason:"threshold",blocking:!1}]}return h.generation={taskId:e,attempt:Number(n.attempt)},g({phase:"request",attempt:Number(n.attempt)})}case"generation.compactBlocking":{let h=W(r,o,{conversationId:i,kind:"pi.compaction",input:{reason:"threshold",blocking:!0},owner:e,label:"blocking compaction"}),v=u();return v.compactions=[...v.compactions??[],{taskId:h,reason:"threshold",blocking:!0}],r.putTask({...d,state:{status:"waiting",checkpoint:{phase:"prepare",attempt:Number(n.attempt),compacted:!0},on:[h],policy:"allSettled"}})}case"generation.stream":{let h=u();if(h.generation?.taskId===e)h.generation.message=String(n.text);return}case"generation.convertPartial":return this.#S(r,d);case"generation.toolRound":{let h=this.#d(i).model??"sim-sol",v=n.toolCalls.map((T,H)=>({id:`${e}-${H+1}`,...T})),y=r.append(i,{kind:"pi.assistant",text:String(n.text),toolCalls:v,stopReason:"toolUse",model:h},e),k=v.map((T)=>W(r,o,{conversationId:i,kind:"pi.tool",input:{assistant:y.id,callId:T.id,name:T.name,args:T.args},owner:e,label:T.name})),b=u();if(b.tools=v.map((T,H)=>({callId:T.id,name:T.name,taskId:k[H],status:"pending"})),b.generation)delete b.generation.message;return this.#I(r,i,String(n.text)),r.putTask({...d,state:{status:"waiting",checkpoint:{phase:"tools",assistant:y.id},on:k,policy:"allSettled"}})}case"generation.answer":{let h=this.#d(i).model??"sim-sol",v=r.append(i,{kind:"pi.assistant",text:String(n.text),toolCalls:[],stopReason:"stop",model:h},e);return this.#I(r,i,String(n.text)),ce(r,i,{answer:v.id}),de(r,o,i,"final"),p({status:"completed",result:{entryId:v.id}})}case"generation.retry":{let h=r.now+Number(n.delayMs),v=u();if(v.generation)v.generation.retry={at:h,error:String(n.error)};return g({phase:"retry",attempt:Number(n.attempt),until:h})}case"generation.failed":return ce(r,i,{reason:"model_error"}),p({status:"failed",error:{message:String(n.error)}});case"generation.postTools":{let v=r.tasks().filter((y)=>y.owner===e&&y.kind==="pi.tool").map((y)=>y.state.status==="terminal"?y.state.outcome.result?.control?.handoff:void 0).find(Boolean);if(v)r.append(i,{kind:"pi.reset",handoff:v},e),ce(r,i,{reason:"reset"}),de(r,o,i,"final");else{de(r,o,i,"postTools");let y=W(r,o,{conversationId:i,kind:"pi.generation",label:"model request"}),k=u();if(k.run)k.run.taskId=y;k.generation={taskId:y,attempt:1},k.tools=[]}return p({status:"completed"})}case"generation.aborted":return this.#S(r,d),ce(r,i,{reason:"aborted"}),p({status:"aborted"});case"tool.intent":return this.#E(r,d,{status:"running"}),g({phase:"execute",arguments:n.args,replay:n.replay});case"tool.unavailable":return this.#c(r,d,`Tool ${d.input.name} is not available in this conversation.`,!0,"tool_unavailable"),p({status:"completed"});case"tool.blocked":return this.#c(r,d,`Blocked: ${n.reason}`,!0,"blocked"),p({status:"completed"});case"tool.result":{let h=n.result,v=this.#c(r,d,h.text,!!h.isError),y=r.doc(ae,i);return y.toolCalls++,p({status:"completed",result:{entryId:v.id,...h.control?{control:h.control}:{}}})}case"tool.error":return this.#c(r,d,`Error: ${n.message}`,!0,"tool_error"),p({status:"failed",error:{message:String(n.message)}});case"tool.interrupted":{let h=u().tools?.find((v)=>v.callId===d.input.callId)?.output??"";return this.#c(r,d,`Tool ${d.input.name} was interrupted and may have partially run.${h?`
Output so far:
${h.trimEnd()}`:""}`,!0,"interrupted"),p({status:"failed",error:{message:"interrupted"}})}case"tool.aborted":return this.#c(r,d,`Tool ${d.input.name} was aborted.`,!0,"aborted"),p({status:"aborted"});case"compaction.nothing":return this.#m(r,d),p({status:"completed"});case"compaction.place":{this.#m(r,d);let h={kind:"pi.compaction",firstKept:String(n.firstKept),summary:String(n.summary),reason:d.input.reason??"threshold"};if(d.owner)r.append(i,h,e);else ge(r,o,i,{type:"write",write:h,requestId:`compaction:${e}`});return p({status:"completed"})}case"checkout.pay":{let h=d.input.cards.map((v)=>W(r,o,{conversationId:i,kind:"shop.payment",input:{card:v},owner:e,label:`payment ${v}`}));return r.putTask({...d,state:{status:"waiting",checkpoint:{phase:"decide",payments:h},on:h,policy:n.policy??"failFast"}})}case"reminder.deliver":return ge(r,o,i,{text:`Reminder: ${d.input.text}`,author:"reminder",requestId:`reminder:${e}`,whenBusy:"followUp"}),p({status:"completed"});default:throw Error(`durable: unknown commit ${t}`)}}),s.kind==="pi.tool")this.#r(`commit.${t}.${s.label}`)}#q(e,t,n){let s=le(e.tasks(),e.conversations(),t.id),{memos:o,...r}=e.task(t.id);e.putTask({...r,state:{status:s.length?"completing":"terminal",outcome:n}})}#m(e,t){if(t.kind!=="pi.compaction")return;let n=e.doc(q,t.conversationId);n.compactions=(n.compactions??[]).filter((s)=>s.taskId!==t.id)}#S(e,t){let n=e.doc(q,t.conversationId),s=n.generation?.taskId===t.id?n.generation.message:void 0;if(!s)return;e.append(t.conversationId,{kind:"pi.assistant",text:s,toolCalls:[],stopReason:"aborted",model:this.#d(t.conversationId).model??"sim-sol"},t.id),delete n.generation.message}#E(e,t,n){let o=e.doc(q,t.conversationId).tools?.find((r)=>r.callId===t.input.callId);if(o)Object.assign(o,n)}#c(e,t,n,s,o){return this.#E(e,t,{status:"done"}),e.append(t.conversationId,{kind:"pi.tool-result",callId:String(t.input.callId),name:String(t.input.name),text:n,isError:s,...o?{code:o}:{}},t.id)}#I(e,t,n){let s=e.doc(ae,t);s.requests++,s.outputTokens+=Math.ceil(n.length/4),s.inputTokens+=this.#l(t).tokens}#M(e,t){let n=e.transcript(t),s=ns(n,(h)=>h.data.kind==="pi.compaction"||h.data.kind==="pi.reset"),o={},r=new Set;for(let h of n.slice(s+1)){if(h.data.kind!=="pi.system")continue;for(let[v,y]of Object.entries(h.data.sections))if(y===null)delete o[v];else o[v]=y;for(let v of h.data.toolsRemoved)r.delete(v);for(let v of h.data.toolsAdded)r.add(v)}let{sections:d,toolNames:i}=this.#v(t),u={};for(let[h,v]of Object.entries(d))if(o[h]!==v)u[h]=v;for(let h of Object.keys(o))if(!(h in d))u[h]=null;let p=i.filter((h)=>!r.has(h)),g=[...r].filter((h)=>!i.includes(h));if(r=new Set(i),Object.keys(u).length||p.length||g.length)e.append(t,{kind:"pi.system",sections:u,toolsAdded:p,toolsRemoved:g})}#d(e){return this.#e.storage.doc(V,e)}#v(e){let t=this.#d(e),n=this.#e.registry.resolve(t,this.#e.settings.extensions),s=this.#e.machine.env(t.cwd),o={};for(let r of n.sections){let d=r.render({conversationId:e,env:s,read:(i)=>this.#e.storage.doc(i,e)});if(d!==void 0)o[r.key]=d}if(t.instructions)o.instructions=t.instructions;return{sections:o,toolNames:n.tools.map((r)=>r.name),tools:n.tools}}#l(e){let t=ee(this.#e.storage.transcript(e)),n=[];for(let o of t.entries){let r=o.data;if(r.kind==="pi.user")n.push({role:"user",text:r.text,author:r.author});else if(r.kind==="pi.assistant")n.push({role:"assistant",text:r.text,toolCalls:r.toolCalls});else if(r.kind==="pi.tool-result")n.push({role:"tool",name:r.name,text:r.text,isError:r.isError,...r.code?{code:r.code}:{}})}let s=t.entries.reduce((o,r)=>o+r.tokens,0)+Math.ceil((t.summary??t.handoff??"").length/4);return{messages:n,tokens:s,entries:t.entries,...t.summary?{summary:t.summary}:{},...t.handoff?{handoff:t.handoff}:{}}}#$(e){let{entries:t}=this.#l(e),n=0,s=t.length;while(s>0&&n<this.#e.settings.compaction.keepRecentTokens)n+=t[--s].tokens;while(s<t.length&&t[s].data.kind!=="pi.user")s++;return s>0&&s<t.length?t[s].id:null}#L(e){let t=()=>this.#e.storage.tasks.get(e),n=()=>t().conversationId,{clock:s}=this.#e,o=(d,i)=>(u)=>{let p=s.setTimeout(()=>!this.dead&&u.done(i()),d);return{send(){},cancel:()=>s.clearTimeout(p)}},r=(d)=>(i)=>{let u=new AbortController,p=AbortSignal.any([u.signal,this.#o.signal]);return d(i,p).then((g)=>p.aborted||i.done(g),(g)=>p.aborted||i.done({ok:!1,error:g instanceof Error?g.message:String(g)})),{send(){},cancel:()=>u.abort()}};return{prepare:o(150,()=>{let d=n(),{contextWindow:i,reserveTokens:u,backgroundTokens:p}=this.#e.settings.compaction,{tokens:g}=this.#l(d),h=this.#$(d)!==null,v=h&&g>i-u,y=this.#e.storage.doc(q,d),k=h&&!v&&g>i-u-p&&!y.compactions?.length;return{tokens:g,contextWindow:i,blocking:v,background:k}}),model:r(async(d,i)=>{let u=t(),p=u.conversationId,g=this.#d(p),h=g.model??"sim-sol";if(u.kind==="pi.compaction"){let{entries:_}=this.#l(p),K=_.findIndex((I)=>I.id===d.params.firstKept),at=this.#l(p).messages.slice(0,Math.max(0,K));return this.#e.model.stream({model:h,mode:"summary",sections:{},messages:at,tools:[]},()=>{},i).then((I)=>({ok:!0,text:I.text}))}let{messages:v,summary:y,handoff:k}=this.#l(p),{sections:b,toolNames:T}=this.#v(p),H=-1/0;try{let _=await this.#e.model.stream({model:h,mode:"chat",sections:b,messages:v,tools:T,...g.instructions?{instructions:g.instructions}:{},...y?{summary:y}:{},...k?{handoff:k}:{}},(K)=>{if(s.now()-H<es)return;H=s.now(),this.#T(e,"generation.stream",{text:K})},i);return{ok:!0,text:_.text,toolCalls:_.toolCalls}}catch(_){if(_ instanceof pe)return{ok:!1,retryable:_.retryable,error:_.message};throw _}}),"resolve-tool":o(120,()=>{let d=t(),{tools:i}=this.#v(d.conversationId),u=i.find((p)=>p.name===d.input.name);if(!u)return{found:!1};return this.#h.set(e,u),{found:!0,replay:u.replay??"unsafe",from:u.from,wrappedBy:u.wrappedBy??[]}}),hooks:r(async(d,i)=>{let u=t(),p=this.#e.registry.resolve(this.#d(u.conversationId),this.#e.settings.extensions),g=this.#D(u,i),h={name:String(u.input.name),args:d.params.args};if(d.params.point==="beforeTool"){for(let{extension:y,hooks:k}of p.hooks){if(!k.beforeTool)continue;this.#r(`hook.beforeTool.${y}`);try{let b=await k.beforeTool(h,g);if(b&&"block"in b)return{block:b.block};if(b&&"args"in b)h.args=b.args}catch(b){return{block:b instanceof Error?b.message:String(b)}}}return{args:h.args}}let v=d.params.result;for(let{hooks:y}of p.hooks){if(!y.afterTool)continue;try{v=await y.afterTool(h,v,g)??v}catch{}}return{result:v}}),tool:r(async(d,i)=>{let u=t(),p=this.#h.get(e)??this.#v(u.conversationId).tools.find((g)=>g.name===u.input.name);if(!p)return{ok:!1,error:`no tool ${u.input.name}`};try{return{ok:!0,result:await p.execute(d.params.args,this.#O(u,i))}}catch(g){if(i.aborted)throw g;return{ok:!1,error:g instanceof Error?g.message:String(g)}}}),bank:r((d,i)=>{let{bank:u}=this.#e;return d.params.op==="refund"?u.refund(String(d.params.key),i):u.charge(String(d.params.card),String(d.params.key),i)}),outcomes:(d)=>{let i=s.setTimeout(()=>!this.dead&&d.done(ts(this.#e.storage,d.params.ids)),100);return{send(){},cancel:()=>s.clearTimeout(i)}},"compaction-select":o(150,()=>({firstKept:this.#$(n())}))}}#R(e,t,n){let s=this.#e.storage.tasks.get(e),o=s?.memos?.[t];if(o!==void 0||n===void 0||!s||!j(s))return o;return this.#a(e,`memo ${t}`,(r)=>{let d=r.task(e);r.putTask({...d,memos:{...d.memos??{},[t]:n}})}),this.#r(`memo.${t}`),n}#D(e,t){return{taskId:e.id,conversationId:e.conversationId,signal:t,memo:(n,s)=>this.#R(e.id,n,s),ask:(n)=>new Promise((s,o)=>{this.approvals.set(e.id,{taskId:e.id,conversationId:e.conversationId,question:n,resolve:s}),t.addEventListener("abort",()=>{this.approvals.delete(e.id),o(Error("aborted"))}),this.#r("approval.asked"),this.#p()}),sleep:(n)=>new Promise((s,o)=>{let r=this.#e.clock.setTimeout(s,n);t.addEventListener("abort",()=>{this.#e.clock.clearTimeout(r),o(Error("aborted"))})})}}approve(e,t){let n=this.approvals.get(e);if(!n)return;this.approvals.delete(e),n.resolve(t),this.#p()}#O(e,t){let{clock:n,storage:s,registry:o}=this.#e,r=this.#d(e.conversationId);return{taskId:e.id,conversationId:e.conversationId,callId:String(e.input.callId),env:this.#e.machine.env(r.cwd),signal:t,output:(d)=>{if(t.aborted)return;this.#a(e.id,"tool.output",(i)=>{let u=i.doc(q,e.conversationId).tools?.find((p)=>p.callId===e.input.callId);if(u)u.output=(u.output??"")+d})},details:(d)=>{if(t.aborted)return;this.#a(e.id,"tool.details",(i)=>{let u=i.doc(q,e.conversationId).tools?.find((p)=>p.callId===e.input.callId);if(u)u.details={...u.details??{},...d}})},commit:(d,i)=>this.#a(e.id,d,i),memo:(d,i)=>this.#R(e.id,d,i),createTask:(d,i,u)=>this.#a(e.id,"createTask",(p)=>W(p,o,{conversationId:e.conversationId,kind:d,input:i,label:u.label,...u.ownership.kind==="task"?{owner:u.ownership.taskId}:{},...u.background?{background:!0}:{}})),waitForTask:(d)=>this.#C(this.#u,d,()=>s.tasks.get(d),(i)=>i.state.status==="terminal",t),submit:(d,i)=>this.submit(d,i,e.id).id,waitForSubmission:(d)=>this.#C(this.#i,d,()=>s.submissions.get(d),(i)=>i.status==="done"||i.status==="unanswered",t),sleep:(d)=>new Promise((i,u)=>{let p=n.setTimeout(i,d);t.addEventListener("abort",()=>{n.clearTimeout(p),u(Error("aborted"))})}),now:()=>n.now(),answerText:(d)=>{let i=s.entries.get(d)?.data;return i?.kind==="pi.assistant"?i.text:""},allEntries:()=>s.transcript(e.conversationId).map((d)=>({id:d.id,text:Ae(d.data)}))}}#C(e,t,n,s,o){return new Promise((r,d)=>{let i=n();if(i&&s(i))return r(i);e.set(t,[...e.get(t)??[],r]),o.addEventListener("abort",()=>d(Error("aborted")))})}#P(){if(this.dead)return;let{storage:e}=this.#e;for(let[t,n]of this.#u){let s=e.tasks.get(t);if(s?.state.status!=="terminal")continue;this.#u.delete(t);for(let o of n)o(s)}for(let[t,n]of this.#i){let s=e.submissions.get(t);if(s?.status!=="done"&&s?.status!=="unanswered")continue;this.#i.delete(t);for(let o of n)o(s)}for(let t of this.#g){let n=this.view(t.conversationId),s=ss(t.last,n);if(t.last=n,s.length)t.send(s,n.seq)}this.#k(),this.#p()}#k(){if(this.#y||this.dead)return;this.#y=!0,this.#e.clock.setTimeout(()=>{this.#y=!1,this.#_()},0)}#_(){if(this.dead||this.scheduling!=="running")return;let{storage:e,registry:t}=this.#e;for(let n=0;n<50;n++){let s=!1,o=[...e.tasks.values()],r=[...e.conversations.values()],d=new Map(o.map((p)=>[p.id,p])),i=(p)=>p&&(p.state.status==="terminal"||p.state.status==="completing")?p.state.outcome:void 0,u=new oe(e,"harness","harness.cascade");for(let p of o){if(!j(p))continue;if(p.abortRequested||p.state.status==="completing"&&p.state.outcome.status!=="completed"){for(let h of o)if(h.owner===p.id&&j(h)&&!h.abortRequested&&h.state.status!=="completing")u.putTask({...h,abortRequested:!0});for(let h of r)if(h.owner?.taskId===p.id)Me(u,h.id)}if(p.state.status==="waiting"&&p.state.policy==="failFast"&&p.state.on.some((h)=>(i(d.get(h))?.status??"completed")!=="completed"))for(let h of p.state.on){let v=d.get(h);if(v&&j(v)&&!v.abortRequested&&v.state.status!=="completing")u.putTask({...v,abortRequested:!0})}}if(u.commit()){s=!0,this.#r("commit.harness.cascade");continue}for(let p of o){let g=()=>le(o,r,p.id),h=p.state;if(h.status==="completing"&&g().length===0){e.commit("harness","harness.finish",[{type:"task",record:{...p,state:{status:"terminal",outcome:h.outcome}}}]),s=!0;continue}if(h.status==="terminal"){if(this.sessions.has(p.id)&&!this.#s.terminal.has(p.id))this.#s.terminal.add(p.id),this.#f(p.id,"task.terminal",{outcome:h.outcome});continue}if(h.status==="completing")continue;if(p.abortRequested){if(!this.#s.abort.has(p.id))this.#s.abort.add(p.id),this.#f(p.id,"task.abort",void 0,!0);if(g().length===0&&!this.#s.drained.has(p.id))this.#s.drained.add(p.id),this.#f(p.id,"task.drained",void 0,!0);continue}if(!t.task(p.kind))continue;if(h.status==="waiting"){if(h.on.every((v)=>d.get(v)?.state.status==="terminal"))e.commit("harness","harness.wake",[{type:"task",record:{...p,state:{status:"running",checkpoint:h.checkpoint}}}]),this.#f(p.id,"task.wake",{checkpoint:h.checkpoint},!0),s=!0;else if(!this.sessions.has(p.id))this.#w(p.id);continue}if(h.status==="pending")e.commit("harness","harness.reserve",[{type:"task",record:{...p,state:{status:"running",checkpoint:h.checkpoint}}}]),this.#w(p.id),s=!0}if(!s)break}}#f(e,t,n,s=!1){(this.sessions.has(e)||this.#t.has(e)||s?this.#w(e):null)?.then((r)=>{if(r&&!this.dead)r.send(t,n)})}#w(e){let t=this.sessions.get(e);if(t)return Promise.resolve(t);let n=this.#t.get(e);if(n)return n;let{storage:s,registry:o,charts:r,clock:d,engine:i,domParser:u}=this.#e,p=s.tasks.get(e),g=o.task(p.kind),h=g&&r[g.chart];if(!h)return Promise.resolve(null);let v=i(Wt(h,`${p.kind} · ${p.id} ${p.label}`),{clock:d,...u?{domParser:u}:{},ioprocessors:[this.#x],invokers:this.#L(e),data:{task:structuredClone(p),now:d.now()}}).then((y)=>{if(this.#t.delete(e),this.dead)return y.dispose(),null;this.sessions.set(e,y),this.#n.set(y.sessionId,e);let k=p.kind,b=k==="pi.tool"?String(p.input.name):null;return y.addEventListener("microstep",(T)=>{for(let H of T.entered)if(this.#r(`${k}.${H.id}`),b)this.#r(`tool.${b}.${H.id}`)}),y.addEventListener("macrostep",()=>this.#p()),y.start(),this.dispatchEvent(new CustomEvent("session",{detail:e})),y});return this.#t.set(e,v),v}root(e){let t=this.#e.storage.conversations.get("c1");if(t)return t.id;return this.#a("harness","root",(n)=>te(n,{title:"root",ownership:{kind:"ownerless"},...e?{agent:e}:{}}))}createConversation(e,t){return this.#a("harness","createConversation",(n)=>te(n,{title:e,ownership:{kind:"ownerless"},...t?{agent:t}:{}}))}submit(e,t,n="client"){let s=this.#a(n,"submit",(o)=>ge(o,this.#e.registry,e,t));return this.#r(s.duplicate?"submit.duplicate":"submit.admitted"),s}abort(e,t={}){this.#a("client","abort",(n)=>Me(n,e,t))}abortTask(e){this.#a("client","abortTask",(t)=>{let n=t.task(e);if(n&&j(n))t.putTask({...n,abortRequested:!0})})}compact(e,t){return this.#a("client","compact",(n)=>{let s=W(n,this.#e.registry,{conversationId:e,kind:"pi.compaction",input:{reason:"manual",blocking:!1,...t?{instructions:t}:{}},label:"manual compaction"}),o=n.doc(q,e);return o.compactions=[...o.compactions??[],{taskId:s,reason:"manual",blocking:!1}],s})}fork(e,t,n){return this.#a("client","fork",(s)=>te(s,{title:n.title,ownership:{kind:"ownerless"},fork:{conversationId:e,at:t},...n.agent?{agent:n.agent}:{}}))}configure(e,t){this.#a("client","configure",(n)=>qe(n,e,t))}view(e){let{storage:t}=this.#e,n=t.conversations.get(e),s=t.transcript(e),{headIndex:o}=ee(s),r=new Set(t.order.get(e)??[]);return{seq:t.seq,conversation:n,entries:s.map((d,i)=>({...d,active:i>=o,inherited:!r.has(d.id)})),docs:{agent:t.doc(V,e),live:t.doc(q,e),inbox:t.doc(G,e),usage:t.doc(ae,e),todos:t.doc(Z,e)},submissions:[...t.submissions.values()].filter((d)=>d.conversationId===e)}}watch(e,t){let n={conversationId:e,last:this.view(e),send:t};return this.#g.add(n),{view:n.last,stop:()=>this.#g.delete(n)}}#r(e){this.dispatchEvent(new CustomEvent("cue",{detail:e}))}#p(){this.dispatchEvent(new Event("change"))}}function ts(e,t){return t.map((n)=>{let s=e.tasks.get(n)?.state;return s&&(s.status==="terminal"||s.status==="completing")?s.outcome:{status:"failed",error:{message:`${n} is not done`}}})}function Wt(e,t){return e.replace(/(<scxml\b[^>]*\bname=")[^"]*(")/,`$1${t.replace(/[<>&"]/g,"")}$2`)}function ns(e,t){for(let n=e.length-1;n>=0;n--)if(t(e[n]))return n;return-1}function ss(e,t){let n=[],s=new Set(e.entries.map((i)=>i.id));for(let i of t.entries)if(!s.has(i.id))n.push({op:"entry",entry:i});let o=e.entries.find((i)=>i.active)?.id??null,r=t.entries.find((i)=>i.active)?.id??null;if(o!==r)n.push({op:"head",first:r});for(let i of Object.keys(t.docs))if(JSON.stringify(e.docs[i])!==JSON.stringify(t.docs[i]))n.push({op:"doc",name:i,value:t.docs[i]});let d=new Map(e.submissions.map((i)=>[i.id,JSON.stringify(i)]));for(let i of t.submissions)if(d.get(i.id)!==JSON.stringify(i))n.push({op:"submission",record:i});return n}var as=[{name:"pi.generation",version:1,chart:"generation",initial:()=>({phase:"prepare",attempt:1})},{name:"pi.tool",version:1,chart:"tool",initial:()=>({phase:"call"})},{name:"pi.compaction",version:1,chart:"compaction",initial:()=>({phase:"select"})}];class _e extends EventTarget{extensions=[];changes=[];install(e){let t=this.extensions.findIndex((n)=>n.name===e.name);if(t>=0){let n=this.extensions[t];this.extensions[t]=e,this.changes.push(`installed ${e.name}@${e.version} (replaced ${n.name}@${n.version})`)}else this.extensions.push(e),this.changes.push(`installed ${e.name}@${e.version}`);this.dispatchEvent(new Event("change"))}uninstall(e){let t=this.extensions.findIndex((n)=>n.name===e);if(t<0)return;this.extensions.splice(t,1),this.changes.push(`uninstalled ${e}`),this.dispatchEvent(new Event("change"))}task(e){return as.find((t)=>t.name===e)??this.extensions.flatMap((t)=>t.tasks??[]).find((t)=>t.name===e)}resolve(e,t){let n=e.extensions??t,s=n?n.flatMap((i)=>this.extensions.filter((u)=>u.name===i)):[...this.extensions],o=[];for(let i of s)for(let u of i.tools??[]){let p={...u,from:`${i.name}@${i.version}`,wrappedBy:[]},g=o.findIndex((h)=>h.name===u.name);if(g>=0)o[g]=p;else o.push(p)}for(let i of s)for(let u of i.wraps??[]){let p=o.findIndex((h)=>h.name===u.tool);if(p<0)continue;let g=o[p];o[p]={...u.wrap(g),from:g.from,wrappedBy:[...g.wrappedBy??[],i.name]}}let r=Array.isArray(e.tools)?e.tools:null,d=new Set(e.tools&&!Array.isArray(e.tools)?e.tools.remove:[]);return{extensions:s,tools:r?r.flatMap((i)=>o.filter((u)=>u.name===i)):o.filter((i)=>!d.has(i.name)),sections:s.flatMap((i)=>i.sections??[]),hooks:s.filter((i)=>i.hooks).map((i)=>({extension:i.name,hooks:i.hooks}))}}}class Be{clock;type="http://tinyactors.dev/pi-durable/wire";aliases=["wire"];latencyMs=60;server=null;#e=new Map;#t=new Map;#n=new Set;#s=0;constructor(e){this.clock=e}register(e,t){this.#t.set(t.sessionId,e)}tap(e){return this.#n.add(e),()=>this.#n.delete(e)}get up(){return this.server!==null}setServer(e){this.server=e,this.#s++;for(let t of this.#e.keys())this.toClient(t,e?"wire.up":"wire.down",{})}location(e){return`http://tinyactors.dev/pi-durable/wire#${this.#t.get(e.sessionId)??e.sessionId}`}attach(e){let t=this.#t.get(e.sessionId);if(!t)return;if(this.#e.set(t,e),this.server)this.toClient(t,"wire.up",{})}detach(e){let t=this.#t.get(e.sessionId);if(t)this.#e.delete(t)}send(e,t){let n=this.#t.get(t.sessionId)??"?",s={at:this.clock.now(),from:n,to:"harness",event:e.event,data:e.data};if(!this.server)s.dropped=!0;for(let o of this.#n)o(s);if(s.dropped)return;this.clock.setTimeout(()=>this.server?.(n,e.event,e.data??{}),this.latencyMs)}toClient(e,t,n){let s=t==="wire.up"||t==="wire.down";if(!s)for(let r of this.#n)r({at:this.clock.now(),from:"harness",to:e,event:t,data:n});let o=this.#s;this.clock.setTimeout(()=>{if(!s&&o!==this.#s)return;this.#e.get(e)?.deliver(t,n,"harness")},s?0:this.latencyMs)}fromPanel(e,t,n={}){this.#e.get(e)?.deliver(t,n,"ui")}}var Ft="http://tinyactors.dev/pi-durable/stage";class ye extends EventTarget{clock;storage;machine;bank;model;wire;clients=new Map;deployed=[..._t];settings;harness=null;processes=0;director=null;notes=[];deaths=[];#e;#t=new Map;constructor(e){super();this.#e=e,this.clock=e.clock,this.storage=new Ce(e.clock),this.machine=new Le(e.clock),this.bank=new De(e.clock),this.model=new Oe(e.clock),this.wire=new Be(e.clock),this.settings={...Pe,...e.settings,compaction:{...Pe.compaction,...e.settings?.compaction}},this.storage.subscribe((t)=>this.dispatchEvent(new CustomEvent("commit",{detail:t})))}static async create(e){let t=new ye(e);return await t.start(),t}get registry(){return this.harness?.registry??null}async start(){if(this.harness&&!this.harness.dead)return this.harness;let e=`process ${++this.processes}`,t=new _e;for(let i of this.deployed)t.install(i);t.changes.length=0,t.addEventListener("change",()=>this.#i());let{engine:n,charts:s,clock:o,domParser:r}=this.#e,d=await fe.open({processId:e,storage:this.storage,clock:o,engine:n,charts:{...s},registry:t,model:this.model,machine:this.machine,bank:this.bank,settings:this.settings,...r?{domParser:r}:{}});return this.harness=d,d.addEventListener("cue",(i)=>this.#o(i.detail)),d.addEventListener("change",()=>this.#i()),d.addEventListener("session",(i)=>this.dispatchEvent(new CustomEvent("session",{detail:i.detail}))),d.addEventListener("cue",(i)=>{if(i.detail!=="harness.paused")return;d.root(this.#e.rootAgent),this.wire.setServer((u,p,g)=>this.#n(d,u,p,g)),o.setTimeout(()=>d.resume(),this.#e.resumeDelayMs??300)}),this.dispatchEvent(new Event("process")),this.#o("process.started"),d}kill(){let e=this.harness;if(!e||e.dead)return;this.deaths.push({processId:e.processId,at:this.clock.now(),live:[...this.storage.tasks.values()].filter((t)=>t.state.status!=="terminal").length});for(let t of this.#t.values())t();this.#t.clear(),e.kill(),this.wire.setServer(null),this.dispatchEvent(new Event("process")),this.#o("process.killed")}get up(){return!!this.harness&&!this.harness.dead}install(e){let t=ve[e];if(!t)throw Error(`no extension ${e}`);let n=this.deployed.findIndex((s)=>s.name===t.name);if(n>=0)this.deployed[n]=t;else this.deployed.push(t);this.harness?.registry.install(t),this.#o(`installed.${t.name}`)}#n(e,t,n,s){if(e.dead)return;let o=String(s.conversationId??"c1");switch(n){case"attach":{this.#t.get(t)?.();let r=e.watch(o,(d,i)=>this.wire.toClient(t,"ops",{ops:d,seq:i}));this.#t.set(t,r.stop),this.wire.toClient(t,"view",{view:r.view});return}case"submit":try{let r=e.submit(o,{text:String(s.text??""),author:String(s.author??t),whenBusy:s.whenBusy??"followUp",...s.requestId?{requestId:String(s.requestId)}:{}});this.wire.toClient(t,"submitted",{requestId:s.requestId,submissionId:r.id,duplicate:r.duplicate})}catch(r){if(!(r instanceof ie))throw r;this.wire.toClient(t,"rejected",{requestId:s.requestId,reason:"ConversationBusy"}),this.#o("submit.rejected")}return;case"abort":e.abort(o);return;case"compact":e.compact(o,s.instructions?String(s.instructions):void 0);return;case"fork":{let r=e.fork(o,String(s.at),{title:String(s.title||"fork")});this.wire.toClient(t,"forked",{conversationId:r});return}}}async addClient(e,t,n="c1"){let s=this.clients.get(e);if(s)return s;let{engine:o,charts:r,clock:d,domParser:i}=this.#e,u=r.client.replace('name="client"',`name="client · ${t.replace(/[<>&"]/g,"")}"`),p=await o(u,{clock:d,...i?{domParser:i}:{},ioprocessors:[this.wire],data:{clientId:e,name:t,conversationId:n}});this.wire.register(e,p),p.addEventListener("microstep",(h)=>{for(let v of h.entered)this.#o(`client.${e}.${v.id}`)}),p.addEventListener("macrostep",()=>this.#i());let g={id:e,name:t,session:p};return this.clients.set(e,g),p.start(),this.dispatchEvent(new Event("clients")),g}removeClient(e){let t=this.clients.get(e);if(!t)return;this.#t.get(e)?.(),this.#t.delete(e),this.clients.delete(e),this.dispatchEvent(new Event("clients")),t.session.dispose()}type(e,t,n={}){this.wire.fromPanel(e,"ui.submit",{text:t,...n})}ui(e,t,n={}){this.wire.fromPanel(e,`ui.${t}`,n)}conversationOf(e){return String(this.clients.get(e)?.session.datamodel.evaluate("conversationId")??"c1")}async runScenario(e){this.director?.dispose();let{engine:t,clock:n,domParser:s}=this.#e;return this.director=await t(e,{clock:n,...s?{domParser:s}:{},ioprocessors:[this.#h()]}),this.director.start(),this.director}#s=null;#o(e){this.#s?.deliver(e,void 0,"stage")}#h(){return{type:Ft,aliases:["stage"],location:()=>Ft,attach:(e)=>{this.#s=e},detach:()=>{this.#s=null},send:(e)=>this.#u(e.event,e.data??{})}}conversationRef(e){let t=String(e??"root"),n=[...this.storage.conversations.values()];if(t==="root")return"c1";if(t==="last")return n.at(-1)?.id??"c1";if(t==="subagent")return n.findLast((s)=>s.owner)?.id??"c1";return t}#u(e,t){let n=String(t.client??"you");switch(e){case"note":{let s={text:String(t.text),at:this.clock.now(),...t.cite?{cite:String(t.cite)}:{},...t.panel==="process"||t.panel==="storage"?{panel:t.panel}:{}};this.notes.push(s),this.dispatchEvent(new CustomEvent("note",{detail:s}));return}case"kill":this.kill();return;case"start":this.start();return;case"client.add":this.addClient(n,String(t.name??n),this.conversationRef(t.conversation));return;case"type":this.type(n,String(t.text),{...t.whenBusy?{whenBusy:t.whenBusy}:{},...t.requestId?{requestId:String(t.requestId)}:{}});return;case"switch":this.ui(n,"switch",{conversationId:this.conversationRef(t.conversation)});return;case"abort":this.ui(n,"abort");return;case"compact":this.ui(n,"compact",{instructions:t.instructions??""});return;case"fork":{let s=this.conversationOf(n),o=this.storage.transcript(s).filter((d)=>d.data.kind==="pi.assistant"&&d.data.stopReason==="stop"),r=t.at==="lastAnswer"||t.at===void 0?o.at(-1)?.id:t.at==="firstAnswer"?o[0]?.id:String(t.at);if(r)this.ui(n,"fork",{at:r,title:t.title??"fork"});return}case"conversation.create":{let s=this.harness?.createConversation(String(t.title??"conversation"),t.agent);if(s&&t.client)this.ui(n,"switch",{conversationId:s});return}case"bank":if(t.latencyMs!==void 0)this.bank.latency.set(String(t.card),Number(t.latencyMs));if(t.decline===!0)this.bank.declines.add(String(t.card));if(t.decline===!1)this.bank.declines.delete(String(t.card));return;case"configure":this.harness?.configure(this.conversationRef(t.conversation),t.change);return;case"install":this.install(String(t.extension));return;case"approve":{let s=[...this.harness?.approvals.values()??[]][0];if(s)this.harness.approve(s.taskId,t.ok!==!1);return}case"fault":this.model.fault(String(t.kind));return;case"abortTask":{let s=[...this.storage.tasks.values()].findLast((o)=>o.kind===t.kind&&o.state.status!=="terminal");if(s)this.harness?.abortTask(s.id);return}case"inspect":this.dispatchEvent(new CustomEvent("inspect",{detail:{kind:String(t.kind??""),label:t.label?String(t.label):void 0}}));return;default:throw Error(`stage: unknown message ${e}`)}}#i(){this.dispatchEvent(new Event("change"))}dispose(){this.director?.dispose(),this.harness?.kill();for(let e of this.clients.values())e.session.dispose()}}var ke=[{id:"harness",file:"01-harness",title:"What is a harness?",cite:"harness",blurb:"Storage, a conversation, an agent, tools in an environment; everything a task."},{id:"anywhere",file:"02-anywhere",title:"Long runs anywhere",cite:"anywhere",blurb:"A storage backend owned by one process; an environment per conversation."},{id:"crashes",file:"03-crashes",title:"Survives crashes",cite:"crashes",blurb:"job-42: two crashes; safe calls rerun, unsafe ones are reported, nothing is asked twice."},{id:"conversations",file:"04-conversations",title:"Many conversations at once",cite:"conversations",blurb:"A channel and a thread forked from it, each with its own agent, both running."},{id:"sections",file:"05-sections",title:"System prompt sections",cite:"sections",blurb:"A changed AGENTS.md, recorded in the transcript where it changed."},{id:"tools",file:"06-tools",title:"Tools",cite:"tools",blurb:"A subagent owned by a tool call, through a crash; then an override and a wrap."},{id:"hooks",file:"07-hooks",title:"Hooks",cite:"hooks",blurb:"A beforeTool chain; an approval kept in a memo across a crash."},{id:"tasks",file:"08-tasks",title:"Tasks",cite:"tasks",blurb:"The post's checkout: failFast, bottom-up abort, refunds. Foreground vs background."},{id:"compaction",file:"09-compaction",title:"Compaction",cite:"compaction",blurb:"A tiny context window: background and manual compaction, a handoff, and a search of what came before.",settings:{compaction:{contextWindow:900,reserveTokens:150,backgroundTokens:300,keepRecentTokens:150}}},{id:"documents",file:"10-documents",title:"Durable application state",cite:"documents",blurb:"A todo document committed with the transcript; a fork's todos as of the fork."},{id:"malleable",file:"11-malleable",title:"Malleable",cite:"malleable",blurb:"Replace an extension while one of its calls runs.",settings:{extensions:["coding","project-context","ops"]}},{id:"multiplayer",file:"12-multiplayer",title:"Multiplayer",cite:"multiplayer",blurb:"A late joiner gets the view, then ops; a steer, a follow-up, a rejection."}];var rs={"01-harness":ft,"02-anywhere":yt,"03-crashes":kt,"04-conversations":wt,"05-sections":bt,"06-tools":xt,"07-hooks":Tt,"08-tasks":St,"09-compaction":Et,"10-documents":It,"11-malleable":$t,"12-multiplayer":Rt},os={harness:mt,generation:ut,tool:vt,compaction:pt,checkout:ct,payment:ht,reminder:gt,client:lt},is=["What’s in the repo?","Fix the flaky login test","Deploy v1.5.1","Checkout with visa-4242, amex-0005 and mc-0009","Triage this issue: the app crashes when I log out","Remind me to stretch","Add to my list: buy milk and call Bo","Add a house rule to AGENTS.md","Why is checkout slow?","Hand off and start over"],we=["Bo","Cy","Dee","Eli","Fay"],ds=0.5,Qt=new URLSearchParams(location.search).get("autoplay")==="1",w=(e,t=document)=>t.querySelector(e),l=(e,t={},...n)=>{let s=document.createElement(e);for(let[o,r]of Object.entries(t)){if(r===!1)continue;if(o==="class")s.className=String(r);else s.setAttribute(o,r===!0?"":String(r))}for(let o of n)if(o!==null&&o!==void 0&&o!==!1)s.append(o);return s},Ke=(e)=>`${(e/1000).toFixed(2)} s`,Ge=document.querySelector("scxml-explorer"),Zt=w("#pd-clients"),We=w("#pd-process"),Ut=w("#pd-storage"),en=w("#pd-caption"),xe=w("#pd-session"),Ye=w("#pd-main"),Y=w("#pd-inspector"),Fe=w("#pd-next"),Te=w("#pd-chart-hint"),ne=w("#pd-play"),Je=w("#pd-step"),cs=w("#pd-time"),tn=[...document.querySelectorAll("input[name=pd-speed]")],Se=w("#pd-speed-select"),nn=w("#pd-kill"),sn=w("#pd-start"),Vt=w("#pd-process-status"),an=new URLSearchParams(location.search),f,S,zt=0,C=null,Ue=0,J="harness",Kt=null;function P(e,t){let n=Bt[e];return l("button",{type:"button",class:"pd-cite-btn",popovertarget:`cite-${e}`,"aria-label":`From the post: ${n.section}`,title:`From the post: ${n.section}`},l("span",{"aria-hidden":"true"},"¶"),t?` ${t}`:null)}var Ve=null;document.addEventListener("click",(e)=>{let t=e.target.closest?.("[popovertarget]");if(t)Ve=t});function rn(e){e.addEventListener("toggle",(t)=>{if(t.newState!=="open"||!Ve?.isConnected)return;let n=Ve.getBoundingClientRect(),s=Math.min(e.offsetWidth,innerWidth-32);e.style.left=`${Math.max(16,Math.min(n.left,innerWidth-s-16))}px`;let o=n.bottom+8;e.style.top=o+e.offsetHeight<innerHeight-16?`${o}px`:`${Math.max(16,n.top-e.offsetHeight-8)}px`})}for(let e of document.querySelectorAll(".pd-cite[popover]"))rn(e);async function Xe(e){let t=++zt,n=S?.speed??(Number(an.get("speed"))||ds);if(st(),me.clear(),f?.dispose(),S?.dispose(),Kt?.(),C=ke.find((s)=>s.id===e)??null,ls(),Zt.replaceChildren(),se.clear(),B=null,ze=0,en.replaceChildren(),Te.hidden=!0,Ee=null,Ze(C?.panel??"process"),S=new x({speed:n,playing:Qt}),f=await ye.create({clock:S,engine:E,charts:os,...C?.settings?{settings:C.settings}:{},...C?.rootAgent?{rootAgent:C.rootAgent}:{}}),t!==zt)return;if(f.addEventListener("note",(s)=>Gt(s.detail)),f.addEventListener("clients",()=>fs()),f.addEventListener("change",()=>{Ue++,ue(He)}),f.addEventListener("commit",()=>ue(ln)),f.addEventListener("process",()=>{if(!f.up&&!J.startsWith("client:")&&J!=="director")Ge.detach(),J="";ue(He)}),f.addEventListener("session",()=>ue(nt)),f.addEventListener("inspect",(s)=>$s(s.detail)),Kt=S.subscribe(()=>ue(pn)),C)await f.runScenario(rs[C.file]);else await f.addClient("you","You"),Gt({text:"Free play: everything installed, nothing scripted. Press Play, type into a client (Try… lists what the simulated model knows), add clients, kill the process whenever you like.",at:0});He()}var me=new Set;function ue(e){if(me.size===0)requestAnimationFrame(()=>{let t=[...me];me.clear();for(let n of t)n()});me.add(e)}function He(){ps(),pn();for(let e of se.values())e.render();cn(),ln(),nt()}function Gt(e){if(en.replaceChildren(l("span",{class:"pd-caption-at"},Ke(e.at))," ",e.text," ",...e.cite?[P(e.cite)]:[]),e.panel)Ze(e.panel);if(!Qt&&S.playing)S.pause();Qe()}function Qe(){Fe.hidden=S.playing;let e=!!f?.director&&f.director.activeStateIds().length===0;Fe.textContent=S.now()===0?"Start":e?"Keep running":"Next"}Fe.addEventListener("click",()=>{if(S.now()===0)w(".pd-story").scrollIntoView({block:"start",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});S.play(),Qe()});var he=w("#pd-sidebar"),be=w("#pd-side-toggle"),z=w("#pd-sidebar-resize"),on="pi-durable:sidebar",U=440;try{U=Number(JSON.parse(localStorage.getItem(on)??"{}").width)||440}catch{}function Ze(e){Ye.dataset.panel=e;for(let t of he.querySelectorAll("[role=tab]")){let n=t.dataset.panel===e;t.setAttribute("aria-selected",String(n)),w(`#${t.getAttribute("aria-controls")}`).hidden=!n}}for(let e of he.querySelectorAll("[role=tab]"))e.addEventListener("click",()=>{Ze(e.dataset.panel),et(!0)});function et(e){he.dataset.open=String(e),be.setAttribute("aria-expanded",String(e)),be.textContent=e?"»":"«",be.setAttribute("aria-label",e?"Collapse the sidebar":"Expand the sidebar"),Ie()}function Ie(){U=Math.max(300,Math.min(760,Math.round(U),innerWidth-360)),document.body.style.setProperty("--pd-sidebar-w",`${U}px`),document.body.dataset.pdSidebar=he.dataset.open==="true"?"open":"closed",z.setAttribute("aria-valuenow",String(U))}function dn(){try{localStorage.setItem(on,JSON.stringify({width:U}))}catch{}}be.addEventListener("click",()=>et(he.dataset.open!=="true"));z.addEventListener("pointerdown",(e)=>{z.setPointerCapture(e.pointerId);let t=(s)=>{U=innerWidth-s.clientX,Ie()},n=()=>{z.removeEventListener("pointermove",t),z.removeEventListener("pointerup",n),dn()};z.addEventListener("pointermove",t),z.addEventListener("pointerup",n)});z.addEventListener("keydown",(e)=>{let t=e.shiftKey?80:20;if(e.key==="ArrowLeft")U+=t;else if(e.key==="ArrowRight")U-=t;else return;e.preventDefault(),Ie(),dn()});addEventListener("resize",Ie);et(!matchMedia("(max-width: 900px)").matches);function ls(){for(let t of document.querySelectorAll(".pd-chapters button"))t.setAttribute("aria-pressed",String((t.dataset.chapter||null)===(C?.id??null)));w("#pd-chapter-title").textContent=C?`${ke.indexOf(C)+1}. ${C.title}`:"Free play",w("#pd-chapter-cite").replaceChildren(C?P(C.cite,"the post"):""),w("#pd-chapter-blurb").textContent=C?.blurb??"Everything installed, nothing scripted.";let e=new URL(location.href);if(C)e.searchParams.set("chapter",C.id);else e.searchParams.delete("chapter");history.replaceState(null,"",e)}function ps(){let e=f.up,t=e?f.harness.session.activeStateIds().filter((n)=>n!=="open").at(-1)??"":"";Vt.textContent=e?`${f.harness.processId} · ${t}`:`no process (${f.processes?`${f.harness?.processId} died`:"not started"})`,Vt.dataset.up=String(e),nn.disabled=!e,sn.disabled=e}var us={opening:"opening: taking ownership of the storage",reconciling:"reconciling: running tasks go back to pending (one commit, no task code)",paused:"open, paused: waiting for resume()",scheduling:"open, scheduling: running, waking and aborting tasks"};function cn(){let e=f.harness;if(!e||e.dead){We.replaceChildren(l("div",{class:"pd-dead"},l("strong",{},e?`${e.processId} is dead.`:"No process.")," Its sessions, timers and promises are gone; storage still holds every task and its checkpoint. ",N("Start a new process",()=>void f.start(),"chat-primary")),Yt());return}let t=e.session.activeStateIds().filter((s)=>s!=="open").at(-1)??"",n=l("div",{class:"pd-harness"},l("div",{class:"pd-row"},l("button",{type:"button",class:"pd-link","data-inspect":"harness",title:"Show harness.scxml"},`harness · ${e.processId}`),l("span",{class:`pd-pill pd-pill-${t==="scheduling"?"running":"waiting"}`},t)),l("p",{class:"pd-small"},us[t]??""));We.replaceChildren(n,Yt(),ms())}function ms(){let e=f.registry,t=l("dl",{class:"pd-registry"},...e.extensions.flatMap((o)=>[l("dt",{},`${o.name}@${o.version}`),l("dd",{},o.blurb,f.settings.extensions&&!f.settings.extensions.includes(o.name)?l("span",{class:"pd-badge"},"not selected"):null)])),n=l("div",{class:"pd-row"},l("span",{class:"pd-small"},"Install while it runs:"),...Object.keys(ve).filter((o)=>!e.extensions.some((r)=>`${r.name}@${r.version}`===o)).map((o)=>N(o,()=>f.install(o),"pd-mini"))),s=e.changes.length?l("p",{class:"pd-small"},e.changes.slice(-3).join(" · ")):null;return l("section",{class:"pd-section"},l("div",{class:"pd-row"},l("h3",{},"Registry"),P("malleable"),l("span",{class:"pd-small"},"code: installed by this process")),t,n,s)}var je={value:!0};function hs(e,t,n){let s=e.state,o=[s.status==="waiting"?l("span",{},`waits on ${s.on.join(", ")} · ${s.policy}`):null,n&&s.status==="completing"?l("span",{},`holds ${n}`):null,e.background?l("span",{class:"pd-badge"},"background"):null,e.abortRequested&&!t?l("span",{class:"pd-badge pd-badge-abort"},"abort mark"):null,e.memos&&Object.keys(e.memos).length?l("span",{class:"pd-badge"},`memo ${Object.entries(e.memos).map(([r,d])=>`${r}=${JSON.stringify(d)}`).join(" ")}`):null].filter((r)=>!!r);return o.length?l("span",{class:"pd-task-meta"},...o):null}function Yt(){let{storage:e}=f,t=[...e.tasks.values()],n=[...e.conversations.values()],s=(u)=>!!f.harness&&!f.harness.dead&&f.harness.sessions.has(u.id),o=(u)=>{let p=u.state,g=p.status==="terminal",h=p.status==="terminal"||p.status==="completing"?p.outcome.status:null,v="checkpoint"in p?String(p.checkpoint.phase):"",y=g?`done-${h}`:p.status,k=[...t.filter((T)=>T.owner===u.id).map(o),...n.filter((T)=>T.owner?.taskId===u.id).map(r)].filter((T)=>T.childElementCount||!T.hidden);return l("li",{class:`pd-task${g?" pd-done":""}`,hidden:g&&!je.value&&!k.length},l("button",{type:"button",class:"pd-task-row","data-inspect":u.id,title:s(u)?"Show its chart":"In storage only: no session in this process"},l("span",{class:`pd-mem${s(u)?" pd-mem-on":""}`,"aria-label":s(u)?"running in this process":"in storage only"}),l("span",{class:`pd-pill pd-pill-${y}`},g?h:p.status),l("span",{class:"pd-task-title"},l("span",{class:"pd-label"},u.label),l("code",{class:"pd-kind"},u.kind),l("span",{class:"pd-id"},u.id),v?l("span",{class:"pd-phase"},v):null),hs(u,g,h)),k.length?l("ul",{},...k):null)},r=(u)=>{let p=e.doc({kind:"pi.live",fork:"initial",initial:()=>({})},u.id),g=t.filter((h)=>h.conversationId===u.id&&!h.owner);return l("li",{class:"pd-conv"},l("div",{class:"pd-conv-row"},l("strong",{},u.title),l("span",{class:"pd-id"},u.id),l("span",{class:`pd-pill pd-pill-${p.run?"running":"idle"}`},p.run?"busy":"idle"),u.parent?l("span",{class:"pd-small"},`fork of ${u.parent.conversationId} at ${u.parent.at}`):null,u.owner?l("span",{class:"pd-small"},`owned by ${u.owner.taskId}`):null),g.length?l("ul",{},...g.map(o)):null)},d=n.filter((u)=>!u.owner),i=l("label",{class:"pd-small pd-toggle"},l("input",{type:"checkbox",checked:je.value})," show finished");return i.querySelector("input").addEventListener("change",(u)=>{je.value=u.target.checked,cn()}),l("section",{class:"pd-section"},l("div",{class:"pd-row"},l("h3",{},"Tasks and conversations"),P("tasks"),i),l("p",{class:"pd-small"},"One ownership tree. ",l("span",{class:"pd-mem pd-mem-on"})," has a session in this process; ",l("span",{class:"pd-mem"})," exists only in storage. Click a task for its chart."),l("ul",{class:"pd-tree"},...d.map(r)))}We.addEventListener("click",(e)=>{let t=e.target.closest("[data-inspect]");if(t)X(t.dataset.inspect)});var B=null,ze=0;function ln(){let e=f.storage,t=[...e.tasks.values()],n=e.workingSet(),s=l("dl",{class:"pd-stats"},l("dt",{},"backend"),l("dd",{},"MemoryStorage"),l("dt",{},"owner"),l("dd",{},e.owner?`${e.owner}${f.up?"":" (dead)"}`:"none"),l("dt",{},"commits"),l("dd",{},String(e.seq)),l("dt",{},"records"),l("dd",{},`${e.conversations.size} conversations · ${e.entries.size} entries · ${t.length} tasks (${t.filter((r)=>r.state.status!=="terminal").length} live) · ${e.submissions.size} submissions · ${e.docs.size} documents`),l("dt",{},"working set"),l("dd",{},`${n.entries} active entries · ${n.tasks} live tasks · ${n.submissions} pending submissions`));if(!B)B=l("ol",{class:"pd-log","aria-label":"Commit log, one line per commit"}),Ut.replaceChildren(s,l("div",{class:"pd-row"},l("h3",{},"Commit log"),l("span",{class:"pd-small"},"the JSONL backend's file: one line per commit")),B);else Ut.firstElementChild.replaceWith(s);let o=B.scrollHeight-B.scrollTop-B.clientHeight<40;for(let r of e.log.slice(ze))B.append(vs(r));ze=e.log.length;while(B.childElementCount>400)B.firstElementChild?.remove();if(o)B.scrollTop=B.scrollHeight}function gs(e){switch(e.type){case"conversation":return`conversation ${e.record.id}`;case"entry":return`entry ${e.record.id} ${e.record.data.kind}`;case"task":{let t=e.record.state,n="outcome"in t?`${t.status} ${t.outcome.status}`:`${t.status} · ${t.checkpoint.phase}`;return`task ${e.record.id} ${n}${e.record.abortRequested?" ⚑":""}`}case"submission":return`submission ${e.record.id} ${e.record.status}${e.record.requestId?` (${e.record.requestId})`:""}`;case"doc":return`doc ${e.kind}@${e.scope}`;case"owner":return`owner ${e.owner}`}}function vs(e){return l("li",{"data-by":e.by.startsWith("t")?"task":e.by},l("details",{},l("summary",{},l("span",{class:"pd-seq"},`#${e.seq}`),l("span",{class:"pd-at"},Ke(e.at)),l("span",{class:"pd-by"},e.by),l("code",{},e.name),l("span",{class:"pd-writes"},e.writes.map(gs).join(", "))),l("pre",{},JSON.stringify(e))))}var se=new Map;function fs(){for(let[e,t]of se)if(!f.clients.has(e))t.el.remove(),se.delete(e);for(let e of f.clients.values()){if(se.has(e.id))continue;let t=ys(e.id,e.name,e.session);se.set(e.id,t),Zt.append(t.el),t.render()}nt()}function ys(e,t,n){let s=l("h3",{},t),o=l("span",{class:"pd-pill"}),r=l("span",{class:"pd-small"}),d=l("select",{"aria-label":`${t}: conversation`});d.addEventListener("change",()=>f.ui(e,"switch",{conversationId:d.value}));let i=N("chart",()=>X(`client:${e}`),"pd-mini");i.title="This client’s statechart (client.scxml)";let u=l("div",{class:"pd-client-body"}),p=l("ol",{class:"pd-transcript","aria-label":`${t}: transcript`}),g=l("div",{class:"pd-client-below"}),h=l("textarea",{rows:2,placeholder:"Message the agent…","aria-label":`${t}: message`}),v=l("select",{"aria-label":"When busy",title:"whenBusy: what happens if the conversation is running"},l("option",{value:"followUp"},"followUp"),l("option",{value:"steer"},"steer"),l("option",{value:"reject"},"reject")),y=()=>{let I=h.value.trim();if(!I)return;f.type(e,I,{whenBusy:v.value}),h.value=""};h.addEventListener("keydown",(I)=>{if(I.key==="Enter"&&!I.shiftKey)I.preventDefault(),y()});let k=l("div",{popover:"",id:`try-${e}`,class:"pd-pop pd-try-list",role:"menu","aria-label":"Try a message"});for(let I of is){let D=N(I,()=>{h.value=I,k.hidePopover(),h.focus()});D.setAttribute("role","menuitem"),k.append(D)}rn(k);let b=l("button",{type:"button",class:"pd-mini chat-quiet",popovertarget:`try-${e}`,"aria-haspopup":"menu"},"Try…"),T=l("div",{class:"pd-composer"},h,l("div",{class:"pd-row"},l("label",{class:"pd-small"},"whenBusy ",v),P("multiplayer"),N("Send",y,"chat-primary"),N("Stop (Esc)",()=>f.ui(e,"abort"),"pd-mini"),N("Compact",()=>f.ui(e,"compact",{instructions:""}),"pd-mini"),b)),H=l("article",{class:"pd-client card","data-client":e},l("header",{},s,o,r,d,i),k,u,p,g,T),_="",K="";return{el:H,render:()=>{if(!f.clients.has(e))return;let I=n.isActive("live")?"live":n.isActive("attaching")?"attaching":"offline",D=n.datamodel.evaluate("view"),$e=Number(n.datamodel.evaluate("frames")),rt=Number(n.datamodel.evaluate("ops")),Q=String(n.datamodel.evaluate("conversationId")),ot=f.up?[...f.harness.approvals.values()].filter((A)=>A.conversationId===Q):[],it=`${I}|${$e}|${rt}|${Q}|${f.storage.conversations.size}|${ot.length}|${D?.seq}`;if(it===_)return;if(_=it,o.textContent=I,o.className=`pd-pill pd-pill-${I==="live"?"running":I==="attaching"?"waiting":"error"}`,r.textContent=`${$e} frame${$e===1?"":"s"} · ${rt} ops`,r.title="The first frame is the full view; every later one carries only a commit's operations",d.replaceChildren(...[...f.storage.conversations.values()].map((A)=>l("option",{value:A.id,selected:A.id===Q},`${A.title} (${A.id})${A.parent?` · fork of ${A.parent.conversationId}`:""}${A.owner?` · subagent of ${A.owner.taskId}`:""}`))),!D){u.replaceChildren(l("p",{class:"pd-small"},I==="offline"?"Offline: no process is up. What you send waits here, and is sent again when a process is.":"Attaching…")),p.replaceChildren(),K="",g.replaceChildren(Jt(n,Q));return}u.replaceChildren(ws(D),bs(D),...I==="offline"?[l("p",{class:"pd-small pd-offline"},"Offline: showing the last view this client had.")]:[]);let dt=`${Q}|${D.entries.length}|${D.entries.find((A)=>A.active)?.id}`;if(dt!==K){K=dt;let A=p.scrollHeight-p.scrollTop-p.clientHeight<40;if(p.replaceChildren(...D.entries.map((un)=>xs(un,e,D))),A)p.scrollTop=p.scrollHeight}g.replaceChildren(Ts(D),...ot.map((A)=>Ss(A.taskId,A.question)),Es(D),Is(D),Jt(n,Q))}}}function ks(){let e=l("span",{class:"pd-avatar",title:"The agent (Pi)"});return e.innerHTML=Ht,e}function ws(e){let t=e.docs.agent,n=Array.isArray(t.tools)?`tools: ${t.tools.length?t.tools.join(", "):"none"}`:t.tools?.remove.length?`without ${t.tools.remove.join(", ")}`:"all tools";return l("p",{class:"pd-agent"},ks(),l("span",{class:"pd-small"},"pi.agent")," ",l("code",{},t.model??"sim-sol")," · ",l("code",{},t.cwd??"/work/repo")," · ",n,t.instructions?` · “${t.instructions}”`:""," ",P("conversations"))}function bs(e){let{contextWindow:t,reserveTokens:n,backgroundTokens:s}=f.settings.compaction,o=ee(e.entries),r=o.entries.reduce((u,p)=>u+p.tokens,0)+Math.ceil((o.summary??o.handoff??"").length/4),d=(u)=>`${Math.min(100,u/t*100).toFixed(1)}%`,i=l("div",{class:"pd-meter",role:"meter","aria-valuemin":0,"aria-valuemax":t,"aria-valuenow":r,"aria-label":"Context"},l("span",{class:"pd-meter-fill",style:`width:${d(r)}`}),l("span",{class:"pd-meter-tick",style:`left:${d(t-n-s)}`,title:"background compaction starts"}),l("span",{class:"pd-meter-tick pd-meter-hard",style:`left:${d(t-n)}`,title:"the next request waits for a summary"}));return l("div",{class:"pd-context"},l("span",{class:"pd-small"},`context ${r} / ${t} tokens`),i,P("compaction"))}function xs(e,t,n){let s=e.data,o=`pd-entry pd-${s.kind.replace("pi.","")}${e.active?"":" pd-inactive"}${e.inherited?" pd-inherited":""}`,r=l("span",{class:"pd-entry-meta"},l("span",{class:"pd-id"},e.id),e.inherited?l("span",{class:"pd-badge",title:"Seen through the fork, not copied"},`from ${e.conversationId}`):null,e.active?null:l("span",{class:"pd-badge",title:"Before the newest summary or handoff: still in storage, not sent to the model"},"not in context")),d;switch(s.kind){case"pi.user":d=[l("strong",{},s.author)," ",l("span",{},s.text)];break;case"pi.assistant":d=[s.stopReason==="aborted"?l("span",{class:"pd-badge pd-badge-abort",title:"Cut off by a crash or an abort; never sent to the model again"},"aborted partial"):null,s.text,...s.toolCalls.map((i)=>l("code",{class:"pd-call"},`${i.name}(${Object.values(i.args).map((u)=>JSON.stringify(u)).join(", ")})`)),s.stopReason==="stop"&&!e.inherited?N("fork here",()=>f.ui(t,"fork",{at:e.id,title:`fork of ${n.conversation.id}`}),"pd-mini pd-fork"):null];break;case"pi.system":{let i=Object.keys(s.sections);d=[l("details",{},l("summary",{},"system prompt ",i.length?`· ${i.map((u)=>s.sections[u]===null?`−${u}`:u).join(", ")}`:"",s.toolsAdded.length?` · +${s.toolsAdded.length} tools`:"",s.toolsRemoved.length?` · −${s.toolsRemoved.join(", ")}`:""," "),...i.map((u)=>l("pre",{},`<${u}>
${s.sections[u]??"(removed)"}
</${u}>`)),s.toolsAdded.length?l("p",{class:"pd-small"},`tools: ${s.toolsAdded.join(", ")}`):null),P("sections")];break}case"pi.tool-result":d=[l("code",{},s.name),s.code?l("span",{class:`pd-badge${s.code==="interrupted"||s.code==="aborted"?" pd-badge-abort":""}`},s.code):null,s.code==="interrupted"?P("crashes"):null,l("pre",{},s.text)];break;case"pi.compaction":d=[l("strong",{},`summary (${s.reason})`)," ",P("compaction"),l("p",{},s.summary),l("span",{class:"pd-small"},`keeps ${s.firstKept} on`)];break;case"pi.reset":d=[l("strong",{},"handoff: a new context")," ",s.handoff??""];break}return l("li",{class:o},l("div",{class:"pd-entry-body"},...d),r)}function Ts(e){let t=e.docs.live,n=[];if(t.generation?.message)n.push(l("p",{class:"pd-streaming"},t.generation.message,l("span",{class:"pd-caret"})));if(t.generation?.retry)n.push(l("p",{class:"pd-small"},`retrying at ${Ke(t.generation.retry.at)}: ${t.generation.retry.error}`));for(let s of t.tools??[])n.push(l("div",{class:`pd-slot pd-slot-${s.status}`},l("div",{class:"pd-row"},l("code",{},s.name),l("span",{class:`pd-pill pd-pill-${s.status==="done"?"done-completed":s.status}`},s.status),l("span",{class:"pd-id"},s.taskId),f.harness?.sessions.has(s.taskId)?N("chart",()=>X(s.taskId),"pd-mini pd-slot-chart"):null),s.output?l("pre",{},s.output.trimEnd()):null,s.details?l("p",{class:"pd-small"},Object.entries(s.details).map(([o,r])=>`${o}: ${typeof r==="string"?r:JSON.stringify(r)}`).join(" · ")):null));for(let s of t.compactions??[])n.push(l("p",{class:"pd-small"},`compaction ${s.taskId}: ${s.reason}${s.blocking?", blocking":""}`));if(!n.length)return l("div",{hidden:!0});return l("section",{class:"pd-live","aria-label":"Live: pi.live"},l("div",{class:"pd-row"},l("h4",{},"pi.live"),l("span",{class:"pd-small"},t.run?`run ${t.run.taskId}`:"")),...n)}function Ss(e,t){return l("div",{class:"pd-approval",role:"group","aria-label":"Approval"},l("strong",{},t)," ",l("span",{class:"pd-small"},`asked by the approval hook of ${e}`),P("hooks"),l("div",{class:"pd-row"},N("Approve",()=>f.harness?.approve(e,!0),"chat-primary"),N("Deny",()=>f.harness?.approve(e,!1))))}function Es(e){let t=e.docs.inbox.items;if(!t.length)return l("div",{hidden:!0});return l("section",{class:"pd-inbox","aria-label":"Queued: pi.inbox"},l("div",{class:"pd-row"},l("h4",{},"pi.inbox"),l("span",{class:"pd-small"},"queued until a boundary")),l("ul",{},...t.map((n)=>l("li",{},l("span",{class:"pd-badge"},n.mode)," ",n.author?l("strong",{},`${n.author} `):null,n.text??""))))}function Is(e){let t=e.docs.todos.items;if(!t.length)return l("div",{hidden:!0});return l("section",{class:"pd-todos","aria-label":"Todos: app.todos"},l("div",{class:"pd-row"},l("h4",{},"app.todos"),P("documents")),l("ul",{},...t.map((n)=>l("li",{},n))))}function Jt(e,t){let n=(e.datamodel.evaluate("requests")??[]).filter((s)=>s.conversationId===t);if(!n.length)return l("div",{hidden:!0});return l("details",{class:"pd-requests"},l("summary",{},`Sent (${n.length}): each with its requestId`),l("p",{class:"pd-small"},"Retried with the same requestId whenever the link comes back. ",P("crashes")),l("ul",{},...n.map((s)=>l("li",{},l("code",{},s.requestId),` → ${s.submissionId??"…"} ${s.status}`,s.duplicate?l("span",{class:"pd-badge",title:"Sent again after a reconnect: the harness returned the original submission"},"retried · same submission"):null,s.reason?` (${s.reason})`:""))))}function tt(){let e=[],t=f.harness;if(t&&!t.dead){e.push(["harness",`harness · ${t.processId}`,t.session]);let n=[...t.sessions.entries()].reverse();for(let[s,o]of n){let r=f.storage.tasks.get(s);e.push([s,`${r?.kind} · ${s} ${r?.label??""}${r?.state.status==="terminal"?" (finished)":""}`,o])}}for(let n of f.clients.values())e.push([`client:${n.id}`,`client · ${n.name}`,n.session]);if(f.director)e.push(["director","the tour’s scenario",f.director]);return e}function nt(){let e=tt(),t=!e.some(([n])=>n===J);if(xe.replaceChildren(...t?[l("option",{value:"",selected:!0,disabled:!0},f.up?"Pick a session":"No process: its sessions are gone")]:[],...e.map(([n,s])=>l("option",{value:n,selected:n===J},s))),t&&!Y.hidden&&f.up)X("harness")}function X(e){let t=tt().find(([n])=>n===e);if(!t)return;if(J=e,xe.value=e,Ge.attach({session:t[2],processors:[],clock:S}),Y.hidden)Y.hidden=!1,Ye.hidden=!0,Y.scrollIntoView({block:"start"})}function st(){Ge.detach(),J="",Y.hidden=!0,Ye.hidden=!1}w("#pd-back").addEventListener("click",st);document.addEventListener("keydown",(e)=>{if(e.key==="Escape"&&!Y.hidden&&!document.querySelector(":popover-open"))st()});var Ee=null;function Ne(e){Ee=e;let t=tt().find(([n])=>n===e)?.[1]??e;if(Te.textContent=`Open the chart: ${t}`,Te.hidden=!1,!Y.hidden)X(e)}Te.addEventListener("click",()=>Ee&&X(Ee));function $s({kind:e,label:t}){if(e==="harness"){Ne("harness");return}let n=f.harness;if(!n)return;let s=[...n.sessions.keys()].reverse().find((o)=>{let r=f.storage.tasks.get(o);return r?.kind===e&&(!t||r.label===t)});if(s)Ne(s);else{let o=(r)=>{let d=r.detail,i=f.storage.tasks.get(d);if(i?.kind!==e||t&&i.label!==t)return;f.removeEventListener("session",o),Ne(d)};f.addEventListener("session",o)}}xe.addEventListener("change",()=>X(xe.value));function pn(){if(!S)return;let e=S.playing;if(ne.dataset.playing!==String(e))ne.dataset.playing=String(e),ne.replaceChildren(c(e?a.Pause:a.Play,18)),ne.setAttribute("aria-label",e?"Pause":"Play"),ne.title=e?"Pause (the whole world)":"Play";for(let t of tn)t.checked=Number(t.value)===S.speed;if(Number(Se.value)!==S.speed)Se.value=String(S.speed);cs.textContent=`${(S.now()/1000).toFixed(1)} s`,Qe()}ne.addEventListener("click",()=>S.toggle());Je.prepend(c(a.StepForward));Je.title="Pause, then run until something changes";Je.addEventListener("click",()=>{let e=Ue;S.step(()=>Ue>e)});for(let e of tn)e.addEventListener("change",()=>S.speed=Number(e.value));Se.addEventListener("change",()=>S.speed=Number(Se.value));nn.addEventListener("click",()=>f.kill());sn.addEventListener("click",()=>void f.start());for(let e of document.querySelectorAll(".pd-chapters button"))e.addEventListener("click",()=>void Xe(e.dataset.chapter||null));w("#pd-replay").addEventListener("click",()=>void Xe(C?.id??null));w("#pd-add-client").addEventListener("click",()=>{let e=f.clients.size-1,t=we[e%we.length]+(e>=we.length?` ${Math.floor(e/we.length)+1}`:"");f.addClient(t.toLowerCase().replace(/\s+/g,"-"),t)});function N(e,t,n=""){let s=l("button",{type:"button",class:n},e);return s.addEventListener("click",t),s}var Xt=an.get("chapter");Xe(Xt===null?ke[0].id:Xt||null);window.piDurable=()=>f;
