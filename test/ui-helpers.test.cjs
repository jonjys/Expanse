const test = require('node:test');
const assert = require('node:assert/strict');
const { storage, dialogs } = require('../ui-helpers.js');
test('stored owner keys survive a new storage wrapper', () => {
  const data = new Map(), backend = {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const owned = { tool: { key:'private-test-key',name:'Tool' } };
  assert.equal(storage(()=>backend).set('owned',owned),true);
  assert.deepEqual(storage(()=>backend).get('owned'),owned);
});
test('quota errors, blocked access and silently discarded writes report failure',()=>{
  assert.equal(storage(()=>{throw new Error('blocked');}).set('owned',{}),false);
  assert.equal(storage(()=>({setItem(){throw new Error('quota');}})).set('owned',{}),false);
  assert.equal(storage(()=>({setItem(){},getItem(){return null;}})).set('owned',{}),false);
});
test('corrupt stored JSON returns null',()=>assert.equal(storage(()=>({getItem:()=>'{bad'})).get('owned'),null));
function fixture() {
  const handlers={}, doc={activeElement:null, addEventListener:(key,fn)=>handlers[key]=fn};
  const element=(id,props={})=>({ id,isConnected:true,disabled:false,tabIndex:0,closest:()=>null,getClientRects:()=>[{}],focus(){doc.activeElement=this;},...props });
  const opener=element('opener');doc.activeElement=opener;
  const modal=(id,children)=>{
    const classes=new Set();
    return element(id,{tabIndex:-1,classList:{add:k=>classes.add(k),remove:k=>classes.delete(k)},querySelectorAll:()=>children,querySelector:()=>null,contains:e=>children.includes(e)});
  };
  // contains() must include the container itself, too.
  const first=element('first'),last=element('last'),hidden=element('hidden',{getClientRects:()=>[]}),disabled=element('disabled',{disabled:true});
  const node=modal('dialog',[hidden,first,disabled,last]);node.contains=e=>e===node||[hidden,first,disabled,last].includes(e);
  const controller=dialogs(doc);
  const tab=shift=>{let prevented=false;handlers.keydown({key:'Tab',shiftKey:shift,preventDefault(){prevented=true;}});return prevented;};
  return {doc,handlers,opener,first,last,node,controller,tab,element,modal};
}
test('Tab and Shift+Tab wrap visible enabled controls and restore the opener',()=>{
  const f=fixture(); f.controller.open(f.node); assert.equal(f.doc.activeElement,f.first);
  assert.equal(f.tab(true),true);assert.equal(f.doc.activeElement,f.last);
  assert.equal(f.tab(false),true);assert.equal(f.doc.activeElement,f.first);
  f.controller.close(f.node);assert.equal(f.doc.activeElement,f.opener);
});
test('outside focus is redirected and a second open retains the original opener',()=>{
  const f=fixture();f.controller.open(f.node);f.controller.open(f.node,f.last);
  f.opener.focus();f.handlers.focusin();assert.equal(f.doc.activeElement,f.first);
  f.controller.close(f.node);assert.equal(f.doc.activeElement,f.opener);
});
test('nested modal closes back into parent before restoring background focus',()=>{
  const f=fixture();f.controller.open(f.node,f.last);
  const input=f.element('input'), child=f.modal('child',[input]);child.contains=e=>e===child||e===input;
  f.controller.open(child);assert.equal(f.doc.activeElement,input);
  f.controller.close(child);assert.equal(f.doc.activeElement,f.last);
  f.controller.close(f.node);assert.equal(f.doc.activeElement,f.opener);
});
test('empty dialog contains keyboard focus and detached opener is ignored',()=>{
  const f=fixture();f.node.querySelectorAll=()=>[];f.controller.open(f.node);
  assert.equal(f.doc.activeElement,f.node);assert.equal(f.tab(false),true);
  f.opener.isConnected=false;f.controller.close(f.node);
  assert.notEqual(f.doc.activeElement,f.opener);
});
