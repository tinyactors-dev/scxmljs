import{t}from"./chunk-166w1z2n.js";import{g,R,L,N,H,S,ve,_}from"./chunk-nghx4der.js";var v={type:"sync",importFFI:()=>(t("vzf0jxfz"),import("./chunk-vzf0jxfz.js")).then((e)=>e.QuickJSFFI),importModuleLoader:()=>(t("exssp3t2"),import("./chunk-exssp3t2.js")).then((e)=>e.default)},p=v;async function h(e){let n=c(await e),[r,i,{QuickJSWASMModule:a}]=await Promise.all([n.importModuleLoader().then(c),n.importFFI(),(t("f5dnz9k9"),import("./chunk-f5dnz9k9.js")).then(c)]),s=await r();s.type="sync";let o=new i(s);return new a(s,o)}function c(e){return e&&"default"in e&&e.default?e.default&&"default"in e.default&&e.default.default?e.default.default:e.default:e}var f,l;function D(){return f??=h(p).then((e)=>l=e),f.then(()=>{})}function y(){if(!l)throw Error("QuickJS is not loaded yet: await loadQuickJS() (createSession does this for you)");return l}class w extends S{vm;setEventFn;plainFn;deadline=0;timeoutMs;disposed=!1;constructor(e){super();this.timeoutMs=e.timeoutMs??2000,this.vm=y().newContext();let n=this.vm.runtime;n.setMemoryLimit(e.memoryLimitBytes??67108864),n.setMaxStackSize(1048576),n.setInterruptHandler(()=>Date.now()>this.deadline);let r=this.vm.newFunction("In",(o)=>e.In(this.vm.getString(o))?this.vm.true:this.vm.false);this.vm.setProp(this.vm.global,"In",r),r.dispose();let i=this.evalHandle(R),a=this.toVm(L(e)),s=this.vm.callFunction(i,this.vm.undefined,a);if(a.dispose(),i.dispose(),s.error){let o=this.describe(s.error);throw s.error.dispose(),new g(o)}s.value.dispose(),this.run(M),this.setEventFn=this.evalHandle(N),this.plainFn=this.evalHandle(ve)}dispose(){if(this.disposed)return;this.disposed=!0,this.setEventFn.dispose(),this.plainFn.dispose(),this.vm.dispose()}setEvent(e){let n=this.toVm(H(e)),r=this.vm.callFunction(this.setEventFn,this.vm.undefined,n);if(n.dispose(),r.error)r.error.dispose();else r.value.dispose()}run(e){this.evalHandle(e).dispose()}read(e){let n=this.evalHandle(e);try{this.deadline=Date.now()+this.timeoutMs;let r=this.vm.callFunction(this.plainFn,this.vm.undefined,n);if(r.error){r.error.dispose();return}try{return this.dump(r.value)}finally{r.value.dispose()}}finally{n.dispose()}}setGlobal(e,n){let r=this.toVm(n);this.vm.setProp(this.vm.global,e,r),r.dispose()}setGlobalFromExpr(e,n){let r=this.evalHandle(n);this.vm.setProp(this.vm.global,e,r),r.dispose()}evalHandle(e){this.deadline=Date.now()+this.timeoutMs;let n=this.vm.evalCode(e,"scxml.js");if(n.error){let r=this.describe(n.error);throw n.error.dispose(),new g(r)}return n.value}describe(e){try{let n=this.vm.dump(e);if(n&&typeof n==="object"&&"message"in n){let r=n;return`${r.name??"Error"}: ${r.message}`}return String(n)}catch{return"error"}}dump(e){try{return this.vm.dump(e)}catch{return}}toVm(e,n=0,r=[]){let i=this.vm;if(n>64)return i.undefined;switch(typeof e){case"undefined":return i.undefined;case"boolean":return e?i.true:i.false;case"number":return i.newNumber(e);case"bigint":return i.newBigInt(e);case"string":return i.newString(e);case"object":{if(e===null)return i.null;if(r.includes(e))return i.undefined;if(e instanceof Date)return i.newNumber(e.getTime());if(_(e))return this.evalHandle(`__scxml_xml(${JSON.stringify(d(e))})`);r.push(e);try{if(Array.isArray(e)){let s=i.newArray();return e.forEach((o,u)=>{let m=this.toVm(o,n+1,r);i.setProp(s,u,m),m.dispose()}),s}let a=i.newObject();for(let[s,o]of Object.entries(e)){let u=this.toVm(o,n+1,r);i.setProp(a,s,u),u.dispose()}return a}finally{r.pop()}}default:return i.undefined}}}var ue=(e)=>new w(e);function d(e){if(e.nodeType===9)return d(e.documentElement);if(e.nodeType!==1)return{t:"x",v:e.nodeValue??""};let n=e;return{t:"e",n:n.localName,p:n.prefix,ns:n.namespaceURI,a:Array.from(n.attributes).map((r)=>[r.name,r.value]),c:Array.from(n.childNodes).filter((r)=>r.nodeType===1||r.nodeType===3||r.nodeType===4).map(d)}}var M=`
var __scxml_xml = (function () {
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function Text(v, parent) { this.nodeType = 3; this.nodeName = "#text"; this.nodeValue = this.data = v; this.parentNode = parent; this.childNodes = []; }
  Object.defineProperty(Text.prototype, "textContent", { get: function () { return this.nodeValue; } });
  Text.prototype.serialize = function () { return esc(this.nodeValue).replace(/"/g, '"'); };
  function Element(t, parent) {
    var self = this;
    this.nodeType = 1; this.localName = t.n; this.prefix = t.p || null; this.namespaceURI = t.ns || null;
    this.nodeName = this.tagName = t.p ? t.p + ":" + t.n : t.n; this.parentNode = parent || null;
    this.attributes = t.a.map(function (a) { return { name: a[0], nodeName: a[0], value: a[1], nodeValue: a[1] }; });
    this.childNodes = t.c.map(function (c) { return c.t === "e" ? new Element(c, self) : new Text(c.v, self); });
  }
  var E = Element.prototype;
  Object.defineProperty(E, "children", { get: function () { return this.childNodes.filter(function (c) { return c.nodeType === 1; }); } });
  Object.defineProperty(E, "firstChild", { get: function () { return this.childNodes[0] || null; } });
  Object.defineProperty(E, "lastChild", { get: function () { return this.childNodes[this.childNodes.length - 1] || null; } });
  Object.defineProperty(E, "firstElementChild", { get: function () { return this.children[0] || null; } });
  Object.defineProperty(E, "textContent", { get: function () { return this.childNodes.map(function (c) { return c.textContent; }).join(""); } });
  E.getAttribute = function (n) { for (var i = 0; i < this.attributes.length; i++) if (this.attributes[i].name === n) return this.attributes[i].value; return null; };
  E.hasAttribute = function (n) { return this.getAttribute(n) !== null; };
  E.setAttribute = function (n, v) { v = String(v); for (var i = 0; i < this.attributes.length; i++) if (this.attributes[i].name === n) { this.attributes[i].value = this.attributes[i].nodeValue = v; return; } this.attributes.push({ name: n, nodeName: n, value: v, nodeValue: v }); };
  E.getElementsByTagName = function (name) {
    var out = [];
    (function walk(e) { e.children.forEach(function (c) { if (name === "*" || c.nodeName === name || c.localName === name) out.push(c); walk(c); }); })(this);
    return out;
  };
  E.serialize = function (parentNs) {
    var self = this;
    var a = this.attributes.map(function (x) { return " " + x.name + '="' + esc(x.value) + '"'; }).join("");
    // declare the default namespace where it changes (it may have been inherited in the source)
    if (!this.prefix && (this.namespaceURI || null) !== (parentNs === undefined ? null : parentNs) && !this.hasAttribute("xmlns"))
      a = ' xmlns="' + esc(this.namespaceURI || "") + '"' + a;
    var body = this.childNodes.map(function (c) { return c.serialize(self.namespaceURI || null); }).join("");
    return "<" + this.nodeName + a + (body ? ">" + body + "</" + this.nodeName + ">" : "/>");
  };
  E.toString = E.toJSON = function () { return this.serialize(); };
  function Doc(root) { this.nodeType = 9; this.nodeName = "#document"; this.documentElement = root; this.childNodes = [root]; root.parentNode = this; }
  Doc.prototype.getElementsByTagName = function (name) {
    var r = this.documentElement;
    return (name === "*" || r.nodeName === name || r.localName === name ? [r] : []).concat(r.getElementsByTagName(name));
  };
  Doc.prototype.toString = Doc.prototype.toJSON = function () { return this.documentElement.serialize(); };
  Object.defineProperty(Doc.prototype, "textContent", { get: function () { return this.documentElement.textContent; } });
  return function (tree) { return tree.t === "e" ? new Doc(new Element(tree)) : tree.v; };
})();
`;
export{D,ue};
