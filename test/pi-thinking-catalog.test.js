import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import test from 'node:test';
import {modelConfigurationFromCatalog,normalizeTurnSettings} from '../server.js';
const source=fs.readFileSync(new URL('../third-party/turnloom-pidesktop/plugin/main.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function part(start,end){const at=source.indexOf(start),to=source.indexOf(end,at);assert.ok(at>=0&&to>at);return source.slice(at,to);}
const thinking=part('function modelThinkingFromRow(','/** 把 PI 的 供应商 × 模型');
const fn=vm.runInNewContext(thinking+';modelThinkingFromRow');
const row=(levels,def)=>({model_id:'deep',provider_config_json:JSON.stringify({models:[{id:'deep',thinkingLevels:levels,defaultThinkingLevel:def}]})});
const plain=value=>JSON.parse(JSON.stringify(value));
test('PI reasoning preserves exact declared levels, off and per-model default',()=>{
 assert.deepEqual(plain(fn(row(['off','low','high','max'],'max'))),{efforts:['off','low','high','max'],defaultEffort:'max',known:true});
 assert.deepEqual(plain(fn(row(['max'],'max'))).efforts,['max']);
 assert.deepEqual(plain(fn(row(['high','high','invented'],'bad'))).efforts,['high']);
 assert.equal(fn(row(['high'],'bad')).defaultEffort,'high');
});
test('PI unknown and nonreasoning models never invent reasoning levels',()=>{
 assert.deepEqual(plain(fn(row([],null))),{efforts:[],defaultEffort:'',known:true});
 assert.deepEqual(plain(fn({model_id:'deep',provider_config_json:'{bad'})),{efforts:[],defaultEffort:'',known:false});
});
test('PI request rejects unsupported effort and keeps off instead of silently switching levels',()=>{
 const reasoning=new Map([['P/deep',fn(row(['off','high'],'high'))]]);
 const code=part('function turnSettingsFromRequest(','/**\n * 切换模型只有 session/configure');
 const settings=vm.runInNewContext(code+';turnSettingsFromRequest',{modelIndex:{reasoning},resolveModelPair:()=>({providerId:'P',modelId:'deep'}),log:()=>{}});
 assert.equal(settings({model:'P/deep',effort:'off'}).thinkingLevel,'off');
 assert.throws(()=>settings({model:'P/deep',effort:'xhigh'}),/不支持所选思考强度/);
 assert.equal(settings({model:'P/deep'}).thinkingLevel,'high');
 reasoning.set('P/deep',fn({model_id:'deep'}));
 assert.equal(settings({model:'P/deep',effort:'high'}).thinkingLevel,undefined,'unknown means defer to host default');
});
test('PI catalog uses model levels and retains valid configured effort without forcing medium',()=>{
 const writes=new Map();const code=part('function writeModelCatalog(','\nfunction syncOnce(');
 const fsStub={mkdirSync(){},writeFileSync(f,v){writes.set(f,v);},readFileSync(){return 'model = "P/deep"\nmodel_reasoning_effort = "off"\n';}};
 const write=vm.runInNewContext(code+';writeModelCatalog',{fs:fsStub,path:{join:(...x)=>x.join('/')},SHIM_HOME:'/qa',codexModelTemplate:()=>({}),modelVisionFromRow:()=>false,modelCapabilities:()=>({items:['text']}),modelThinkingFromRow:fn,lastErrorLogAt:0,log:e=>{throw Error(e);}});
 write([{...row(['off','high'],'high'),provider_name:'P',provider_enabled:1}]);
 const catalog=JSON.parse(writes.get('/qa/model-catalogs/pidesk.json'));
 assert.deepEqual(catalog.models[0].supported_reasoning_levels.map(x=>x.effort),['off','high']);
 assert.equal(catalog.models[0].default_reasoning_level,'high');
 assert.match(writes.get('/qa/config.toml'),/model_reasoning_effort = "off"/);
});
test('backend keeps models without effort controls and does not substitute another model default',()=>{
 const config=modelConfigurationFromCatalog({models:[{slug:'P/plain',visibility:'list',supported_in_api:true,supported_reasoning_levels:[]},{slug:'P/reason',visibility:'list',supported_reasoning_levels:[{effort:'high'}]}]},{model:'P/plain',modelReasoningEffort:'high'});
 assert.equal(config.models.length,2);assert.equal(config.defaultModel,'P/plain');assert.equal(config.defaultEffort,'');
 assert.deepEqual(normalizeTurnSettings({model:'P/plain',effort:'high'},config),{model:'P/plain',effort:''});
});
