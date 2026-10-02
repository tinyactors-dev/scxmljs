class g extends Error{code="SCXML_DATAMODEL";constructor(e){super(e);this.name="DataModelError"}}var p=/^[A-Za-z_$][\w$]*$/,h=new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await".split(" "));function d(e){return p.test(e)&&!h.has(e)}function l(e){return e.trim().replace(/;+$/,"")}var R=`(function () {
  function deepFreeze(o) { if (o && typeof o === "object") { Object.freeze(o); for (var k in o) deepFreeze(o[k]); } return o; }
  function define(name, value) {
    Object.defineProperty(globalThis, name, { enumerable: true, configurable: false,
      get: function () { return value; },
      set: function () { throw new Error(name + " is a read-only system variable"); } });
  }
  return function (values) {
    define("_sessionid", deepFreeze(values.sessionid));
    define("_name", deepFreeze(values.name));
    define("_ioprocessors", deepFreeze(values.ioprocessors));
  };
})()`;function L(e){return{sessionid:e.sessionId,name:e.name,ioprocessors:e.ioprocessors}}var N=`(function () { var ev;
  Object.defineProperty(globalThis, "_event", { enumerable: true, configurable: false,
    get: function () { return ev; },
    set: function () { throw new Error("_event is a read-only system variable"); } });
  return function (v) { ev = v; }; })()`;function H(e){return{name:e.name,type:e.type,sendid:e.sendid,origin:e.origin,origintype:e.origintype,invokeid:e.invokeid,data:e.data}}class S{tmpDepth=0;evaluate(e){return this.read(`(${l(e)}
)`)}condition(e){return this.read(`!!(${l(e)}
)`)===!0}script(e){this.run(e)}declareExpr(e,t){this.setGlobalFromExpr(e,`(${l(t)}
)`)}declareValue(e,t){this.setGlobal(e,t)}assignExpr(e,t){let r=this.acquireTmp();try{this.run(`globalThis.${r} = (${l(t)}
);`),this.assignFromTmp(e,r)}finally{this.releaseTmp()}}assignValue(e,t){let r=this.acquireTmp();try{this.setGlobal(r,t),this.assignFromTmp(e,r)}finally{this.releaseTmp()}}isValidLocation(e){try{return this.run(`(function () { "use strict"; void (${e}
); })()`),!0}catch{return!1}}foreach(e,t,r,i){if(!d(t))throw new g(`foreach: "${t}" is not a legal variable name`);if(r!=null&&!d(r))throw new g(`foreach: "${r}" is not a legal variable name`);let n=this.acquireTmp();try{this.run(`(function (a) { if (!Array.isArray(a)) throw new TypeError("foreach: array is not an array"); globalThis.${n} = a.slice(); })((${l(e)}
));`);let a=this.read(`globalThis.${n}.length`);for(let o of[t,r])if(o)this.run(`if (!(${JSON.stringify(o)} in globalThis)) globalThis.${o} = undefined;`);for(let o=0;o<a;o++)this.run(`${t} = globalThis.${n}[${o}];${r?` ${r} = ${o};`:""}`),i()}finally{this.run(`delete globalThis.${n};`),this.releaseTmp()}}snapshot(e){let t={};for(let r of e)try{t[r]=this.read(`globalThis[${JSON.stringify(r)}]`)}catch{t[r]=void 0}return t}assignFromTmp(e,t){try{this.run(`(function () { "use strict"; void (${e}
); ${e} = globalThis.${t}; })();`)}finally{this.run(`delete globalThis.${t};`)}}acquireTmp(){return`__scxml_tmp${this.tmpDepth++}`}releaseTmp(){this.tmpDepth--}}function pe(e,t){let r=[],i=(n,a)=>{if(typeof n==="function"||typeof n==="symbol")return;if(typeof n==="number")return a&&!Number.isFinite(n)?null:n;if(typeof n==="bigint")return a?String(n):n;if(n===null||typeof n!=="object")return n;if(t?.(n))return n;let o=n.toJSON;if(typeof o==="function")return i(o.call(n),a);if(r.includes(n))return;r.push(n);try{if(Array.isArray(n)){let u=[];for(let s=0;s<n.length;s++){let f=i(n[s],!0);u.push(f===void 0?null:f)}return u}let c={};for(let u of Object.keys(n)){let s=i(n[u],!0);if(s!==void 0)c[u]=s}return c}finally{r.pop()}};return i(e,!1)}var ve=`(function () {
  return function (value) {
    var ancestors = [];
    function convert(v, nested) {
      if (typeof v === "function" || typeof v === "symbol") return undefined;
      if (typeof v === "number") return nested && !isFinite(v) ? null : v;
      if (typeof v === "bigint") return nested ? String(v) : v;
      if (v === null || typeof v !== "object") return v;
      if (typeof v.toJSON === "function") return convert(v.toJSON(), nested);
      if (ancestors.indexOf(v) >= 0) return undefined;
      ancestors.push(v);
      try {
        var out, c, i, k, keys;
        if (Array.isArray(v)) {
          out = [];
          for (i = 0; i < v.length; i++) { c = convert(v[i], true); out.push(c === undefined ? null : c); }
          return out;
        }
        out = {};
        keys = Object.keys(v);
        for (i = 0; i < keys.length; i++) { k = keys[i]; c = convert(v[k], true); if (c !== undefined) out[k] = c; }
        return out;
      } finally {
        ancestors.pop();
      }
    }
    return convert(value, false);
  };
})()`;function _(e){return typeof e==="object"&&e!==null&&typeof e.nodeType==="number"&&"nodeName"in e}
export{g,R,L,N,H,S,pe,ve,_};
