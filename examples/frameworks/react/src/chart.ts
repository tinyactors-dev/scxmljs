/** The chart the explorer shows (a session the app creates itself). */
export const PLAYER = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="player" initial="stopped">
  <state id="stopped"><transition event="play" target="playing"/></state>
  <state id="playing"><transition event="stop" target="stopped"/></state>
</scxml>`;
