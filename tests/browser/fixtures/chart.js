// A small chart with a compound state, a parallel state and data, shared by the fixtures.
export const PLAYER = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="player" initial="stopped">
  <datamodel><data id="volume" expr="5"/></datamodel>
  <state id="stopped"><transition event="play" target="playing"/></state>
  <parallel id="playing">
    <transition event="stop" target="stopped"/>
    <state id="audio" initial="normal">
      <state id="normal"><transition event="mute" target="muted"/></state>
      <state id="muted"><transition event="unmute" target="normal"/></state>
    </state>
    <state id="video" initial="sd">
      <state id="sd"><transition event="hd" target="hq"/></state>
      <state id="hq"><transition event="sd" target="sd"/></state>
    </state>
  </parallel>
</scxml>`;
