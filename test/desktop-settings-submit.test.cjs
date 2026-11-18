"use strict";
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..','desktop','renderer');
test('desktop save submits through actual renderer despite body data-view; relay mode survives reopening',async()=>{
 const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;
 try{
  await new Promise(r=>w.addEventListener('load',r,{once:true}));
  w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.HTMLElement.prototype.scrollIntoView=function(){};
  w.eval(fs.readFileSync(path.join(root,'app.js'),'utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await new Promise(r=>setTimeout(r,20));
  w.document.querySelector('a[data-view="settings"]').click();
  const mode=w.document.querySelector('#set-network-mode');mode.value='direct';mode.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.equal(w.document.body.dataset.view,'settings');
  let submits=0;w.document.querySelector('#settings-form').addEventListener('submit',()=>submits++);
  const save=w.document.querySelector('#btn-save');assert.equal(save.disabled,false);save.click();await new Promise(r=>setTimeout(r,30));
  assert.equal(submits,1,'a normal save click must not be cancelled as a navigation click');
  assert.equal(w.document.querySelector('#save-status-text').textContent,'所有更改已保存');
  w.document.querySelector('a[data-view="overview"]').click();w.document.querySelector('a[data-view="settings"]').click();
  assert.equal(mode.value,'direct');assert.equal(w.document.querySelector('[data-public-field]').hidden,true);
 }finally{dom.window.close();}
});
