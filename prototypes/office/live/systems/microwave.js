// The microwave (site/charts/microwave.scxml): two parallel regions, the engine and the door.
// The person using it opens and closes the door and turns it on and off at the hatch; the cooking
// tick is a delayed self-send that only the wall clock lets fire.
export default {
  title: "Microwave",
  app: { id: "user", label: "the person using it", kind: "user" },
  preload: ["microwave.scxml"],
  inputs: {
    order: ["door.open", "door.close", "turn.on", "turn.off"],
    labels: { "door.open": "OPEN DOOR", "door.close": "CLOSE DOOR", "turn.on": "TURN ON", "turn.off": "TURN OFF" },
  },
  async boot(ctx) {
    await ctx.spawn("microwave.scxml", { id: "microwave", label: "microwave" });
  },
};
