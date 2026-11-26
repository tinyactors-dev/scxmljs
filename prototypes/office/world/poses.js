// world/poses.js: which pose an actor shows, from its ACTIVE STATES (one small table per chart).
// The first row whose state is active wins. Every pose here corresponds to real states of the chart.
export const POSE_TABLES = {
  client: [
    ["left", "leave", "membership left (final): gets up and goes"],
    ["offline", "asleep", "link offline: lights out, head on the desk"],
    ["joining", "wave", "membership joining: arrives and waves to the exchange"],
    ["syncing", "watch", "sync syncing: waiting for the history to arrive"],
    ["working", "machine", "work working: turned to the tool machine, cranking it"],
    ["sending", "post", "outbox sending: a message is out, eyes on the tube"],
    ["host-busy", "watch", "outbox host-busy: a turn runs; elbows on the desk, watching the stream"],
    ["host-idle", "idle", "outbox host-idle: nothing running; leaning back"],
  ],
  host: [
    ["backoff", "wristwatch", "turn backoff: checking the watch before a retry"],
    ["connecting", "phone", "requesting connecting: on the line to the model, waiting"],
    ["thinking", "phone", "requesting thinking: on the line, the model thinks"],
    ["writing", "phoneWrite", "requesting writing: on the line, writing the answer down"],
    ["calling", "phoneWrite", "requesting calling: on the line, noting the tool calls"],
    ["tools", "switchboard", "turn tools: plugging calls through to the clients' machines"],
    ["settling", "stamp", "turn settling: stamping the turn done"],
    ["idle", "idle", "conversation idle: leaning back"],
  ],
  scenario: [
    ["done", "leave", "done (final): the floor manager leaves"],
    ["__root__", "clipboard", "every scripted step: reading the clipboard (its page = the step)"],
  ],
  workspace: [["open", "doze", "open: the storekeeper waits for orders"]],
};

export function poseFor(chart, active) {
  const table = POSE_TABLES[chart];
  if (!table || !active.length) return null;
  for (const [state, pose] of table) if (active.includes(state)) return pose;
  return null;
}
