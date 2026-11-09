'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const context={URL};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,
  '../src/Jellyfin.Plugin.FranchiseExplorer/Configuration/franchise-settings-core.js'),'utf8'),context);
const core=context.FranchiseSettingsCore;
const guid=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const owner=guid(1),child=guid(2),rowA=guid(3),rowB=guid(4),registration=guid(5);
const show={Id:guid(10),Type:'Series',ProviderIds:{Imdb:'tt100'}};
const episode=(number,season=1,end=number)=>({item:{Id:guid(100+season*10+number),Type:'Episode',SeriesId:show.Id,
  ParentIndexNumber:season,IndexNumber:number,IndexNumberEnd:end,ProviderIds:{Imdb:'tt'+season+String(number).padStart(2,'0')}},series:show});
const one=episode(1),double=episode(2,1,3),four=episode(4),seasonTwo=episode(1,2);
const rule=(Scope,extra={})=>({Scope,RegistrationId:registration,ProviderName:'Imdb',ProviderId:'tt100',Enabled:true,...extra});
const model=Exclusions=>({Nodes:[{Id:owner,ParentId:''},{Id:child,ParentId:owner}],AutoFranchises:{
  Registry:[{Id:registration,FranchiseNodeId:owner}],Exclusions}});
function allowed(rules,entry,targetRow=rowA,targetNode=child){
  const config=model(rules),before=JSON.stringify(config);
  const result=core.automationAllowed(config,targetNode,targetRow,entry);
  assert.equal(JSON.stringify(config),before,'Preview exclusion checks must not alter durable choices');
  return result;
}
assert.equal(allowed([rule('Episode',{ProviderName:'iMdB',ProviderId:double.item.ProviderIds.Imdb.toUpperCase(),StartSeason:0,EndSeason:0,StartEpisode:0,EndEpisode:0})],double),false,
  'An exact episode provider exclusion with zero range bounds must suppress the episode');
assert.equal(allowed([rule('Episode',{ProviderId:double.item.ProviderIds.Imdb,StartSeason:0,EndSeason:0,StartEpisode:0,EndEpisode:0})],one),true,
  'An exact episode provider exclusion must not suppress another episode');
assert.equal(allowed([rule('Episode',{ProviderId:'',JellyfinItemId:double.item.Id.replace(/-/g,'').toUpperCase(),StartSeason:0,EndSeason:0,StartEpisode:0,EndEpisode:0})],double),false,
  'A direct episode item-ID exclusion with zero bounds must suppress that physical item');
const seasonLock=rule('AllowedRange',{StartSeason:1,EndSeason:1,StartEpisode:1,EndEpisode:2147483647});
assert.equal(allowed([seasonLock],one),true,'An entire selected season permits its accessible episodes');
assert.equal(allowed([seasonLock],seasonTwo),false,
  'A Seasons range with int.MaxValue end episode must not spill into a later season');
assert.equal(allowed([rule('AllowedRange',{StartSeason:1,EndSeason:1,StartEpisode:2,EndEpisode:3})],double),true,
  'A physical double episode entirely inside a protected range remains selectable');
assert.equal(allowed([rule('AllowedRange',{StartSeason:1,EndSeason:1,StartEpisode:3,EndEpisode:4})],double),false,
  'A physical double episode crossing the start of a protected range is held in full');
assert.equal(allowed([rule('Episode',{StartSeason:1,EndSeason:1,StartEpisode:3,EndEpisode:3})],double),false,
  'Excluding any part of a double episode excludes that complete physical item');
assert.equal(allowed([rule('AllowedRange',{StartSeason:1,EndSeason:2,StartEpisode:4,EndEpisode:1})],four),true,
  'Cross-season range comparisons retain the selected first-season endpoint');
assert.equal(allowed([rule('AllowedRange',{StartSeason:1,EndSeason:2,StartEpisode:4,EndEpisode:1})],seasonTwo),true,
  'Cross-season range comparisons retain the selected last-season endpoint');
assert.equal(allowed([rule('WholeShow',{RowId:rowA})],one,rowA),false,'Row-scoped restrictions protect their selected destination');
assert.equal(allowed([rule('WholeShow',{RowId:rowA})],one,rowB),true,'Row-scoped restrictions leave independent destinations selectable');
assert.equal(allowed([rule('WholeShow',{Enabled:false})],one),true,'Disabled restrictions must not affect an explicit preview');
assert.equal(allowed([rule('WholeShow',{RegistrationId:'another-registration'})],one),true,'Another registry entry must not supply this franchise\'s restrictions');
assert.equal(allowed([rule('WholeShow',{RegistrationId:'',FranchiseNodeId:owner})],one),false,'Legacy franchise-scoped restrictions apply through descendant nodes');
assert.equal(allowed([rule('WholeShow',{ProviderName:'Tvdb'})],one),true,'Provider names are part of the protected media identity');
console.log('PASS Auto Franchises preview exclusions: exact episode identity, season boundaries, physical double episodes, durable range intersections and row scope');
