'use strict';
// Real shared preference service against an offline Jellyfin API simulation.
// Native launch ordering is separately exercised by the native bridge tests.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-timeline.js','utf8').split('/* Franchise Explorer v0.8.9.5')[0];
const uuid=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const user=uuid(1),server=uuid(2),first=uuid(3),second=uuid(4),other=uuid(5);
const context={userId:user,serverId:server,deviceId:'native-phone',token:'test-token',prefix:'/jellyfin',itemIds:[first,second]};
const ok=value=>({ok:true,status:200,json:async()=>value});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function flush(){for(let i=0;i<8;i++)await tick();}
function fixture(){
  const data=new Map(),requests=[],events=[],errors=[],listeners=new Map(),timers=new Map();
  const localStorage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),
    key:index=>[...data.keys()][index]??null,get length(){return data.size;}};
  let sessions=[],failure=0,handler=null,preference=null,timerId=0;
  const window={localStorage,addEventListener:(name,listener)=>listeners.set(name,listener),dispatchEvent:event=>{
    events.push(event);listeners.get(event.type)?.(event);
  },setTimeout:fn=>{const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)};
  const fetch=async(url,options={})=>{
    const record={url,method:options.method||'GET',body:options.body?JSON.parse(options.body):null,headers:options.headers};
    requests.push(record);
    if(handler){const result=await handler(record);if(result)return result;}
    if(failure)return {ok:false,status:failure};
    if(url.endsWith('/ViewerPreferences'))return ok(preference||{hasPreference:false,subtitleEnabled:false,subtitleLanguage:''});
    if(url.endsWith('/Sessions'))return ok(sessions);
    if(url.endsWith('/PlaybackPreferences'))return ok({enabled:record.body.enabled,language:record.body.language||'eng',
      subtitleStreamIndex:record.body.enabled?31:-1,mediaSourceId:record.body.mediaSourceId||'source-a'});
    if(url.includes('/Command'))return {ok:true,status:204};
    throw Error('Unexpected subtitle API request '+url);
  };
  vm.runInNewContext(source,{window,fetch,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},console:{error:(...args)=>errors.push(args)}},{filename:'subtitle-preferences.js'});
  return {api:window.FranchiseSubtitlePreferences,data,requests,events,errors,emit:(name,event)=>listeners.get(name)?.(event),
    set sessions(value){sessions=value;},set failure(value){failure=value;},set handler(value){handler=value;},
    set preference(value){preference=value;},async monitor(){const entry=timers.entries().next().value;
      assert(entry,'Playback monitoring must be armed');timers.delete(entry[0]);entry[1]();await flush();}};
}
const ownSession={Id:'own-session',UserId:user,DeviceId:context.deviceId,NowPlayingItem:{Id:second},PlayState:{MediaSourceId:'source-b'}};
(async()=>{
  const f=fixture();
  // Match the same account despite Jellyfin's compact/case-normalized GUIDs.
  f.data.set('fe-subtitles:'+server.replace(/-/g,'').toUpperCase()+':'+user.replace(/-/g,'').toUpperCase(),'0');
  f.data.set('fe-subtitle-language:'+server+':'+user,'fra');
  const disabled=await f.api.prepare({...context,itemIds:[first,'not-a-guid',first,second]},
    {subtitleEnabled:true,subtitleLanguage:'deu'});
  assert.equal(disabled.subtitleEnabled,false,'Saved Off must beat an older enabled playback intent');
  assert.equal(disabled.subtitleStreamIndex,-1,'Off explicitly disables forced, ASS and server-default tracks');
  assert.equal(disabled.subtitleLanguage,'fra');
  assert.deepEqual(f.requests[1].body,{deviceId:context.deviceId,itemIds:[first,second],mediaSourceId:null,enabled:false,language:'fra'});
  assert.equal(f.requests[1].url,'/jellyfin/FranchiseExplorer/PlaybackPreferences');
  assert.equal(f.requests[0].headers.Authorization,'MediaBrowser Token="test-token"');
  const beforeInvalid=f.requests.length;
  await assert.rejects(()=>f.api.prepare({...context,deviceId:''}),/device could not be identified/);
  assert.equal(f.requests.length,beforeInvalid,'An unidentified device cannot enroll or launch');

  // Enabling uses the server's actual stream index, never a language array offset.
  const on=fixture();
  on.data.set('fe-subtitles:'+server+':'+user,'1');
  on.data.set('fe-subtitle-language:'+server+':'+user,'');
  const enabled=await on.api.prepare(context,{subtitleEnabled:false,subtitleLanguage:'fra'});
  assert.equal(enabled.subtitleEnabled,true);assert.equal(enabled.subtitleStreamIndex,31);
  assert.equal(on.requests[1].body.language,'','An empty saved language inherits the Jellyfin account language');
  assert.equal(enabled.subtitleLanguage,'eng');
  const failed=fixture();failed.failure=403;
  await assert.rejects(()=>failed.api.prepare(context),/HTTP 403/);
  assert.equal(failed.requests.length,1);
  const unconfirmed=fixture();unconfirmed.handler=record=>record.url.endsWith('/PlaybackPreferences')?ok({enabled:true}):null;
  await assert.rejects(()=>unconfirmed.api.prepare(context,{subtitleEnabled:false}),/did not confirm/);

  // Refresh acts only on the same account/device playing an enrolled title.
  on.sessions=[{...ownSession,Id:'other-user',UserId:other},{...ownSession,Id:'other-device',DeviceId:'other-phone'},
    {...ownSession,Id:'unlisted-item',NowPlayingItem:{Id:other}},ownSession];
  on.data.set('fe-subtitles:'+server+':'+user,'0');
  await on.api.refresh();
  const refreshEnrollment=on.requests.filter(record=>record.url.endsWith('/PlaybackPreferences')).at(-1);
  assert.equal(refreshEnrollment.body.mediaSourceId,'source-b','Current version must be used when toggling live playback');
  assert.deepEqual(refreshEnrollment.body.itemIds,[second,first]);
  const commands=on.requests.filter(record=>record.url.endsWith('/Command'));
  assert.equal(commands.length,1);assert.equal(commands[0].url,'/jellyfin/Sessions/own-session/Command');
  assert.deepEqual(commands[0].body,{Name:'SetSubtitleStreamIndex',Arguments:{Index:'-1'}});
  const applied=on.events.find(event=>event.type==='franchise-subtitles-applied'&&event.detail.subtitleEnabled===false);
  assert(applied);assert.equal(applied.detail.serverId,server);assert.equal(applied.detail.userId,user);
  assert.equal(applied.detail.deviceId,context.deviceId,'The bridge must be able to reject events for another playback device');
  assert(!on.requests.some(record=>record.url.includes('/PlaybackInfo')),'The remote controller must not negotiate playback under its own device identity');
  on.sessions=[{...ownSession,UserId:other},{...ownSession,DeviceId:'other-phone'},
    {...ownSession,NowPlayingItem:{Id:other}}];
  const eventsBeforeUnrelated=on.events.length;
  await on.api.refresh();
  assert.equal(on.requests.filter(record=>record.url.endsWith('/Command')).length,1,'Unrelated sessions must not receive subtitle commands');
  assert.equal(on.events.length,eventsBeforeUnrelated,'Unrelated playback must not receive the HTML text-track fallback event');

  // Settings events are account/server scoped; errors are surfaced to the player.
  const eventStart=on.requests.length;
  on.emit('franchise-subtitles-changed',{detail:{serverId:server,userId:other}});await flush();
  assert.equal(on.requests.length,eventStart);
  on.sessions=[ownSession];on.data.set('fe-subtitles:'+server+':'+user,'1');
  on.emit('franchise-subtitles-changed',{detail:{serverId:server,userId:user}});await flush();
  assert.equal(on.requests.filter(record=>record.url.endsWith('/Command')).at(-1).body.Arguments.Index,'31');
  on.failure=500;on.emit('storage',{key:'fe-subtitles:'+server+':'+user});await flush();
  assert(on.events.some(event=>event.type==='franchise-subtitles-error'&&event.detail.message.includes('HTTP 500')));

  // A slow old enrollment must finish before the new one is sent, and cannot
  // replace the latest active queue or return settings to a waiting launch.
  const race=fixture();let releaseOld,firstRequest=true;
  race.handler=record=>{
    if(record.url.endsWith('/PlaybackPreferences')&&firstRequest){firstRequest=false;return new Promise(resolve=>{releaseOld=()=>resolve(ok({enabled:false,subtitleStreamIndex:-1}));});}
    return null;
  };
  const old=race.api.prepare(context).then(()=>({resolved:true}),error=>({error}));
  await flush();assert.equal(typeof releaseOld,'function');
  race.data.set('fe-subtitles:'+server+':'+user,'1');
  const newer=race.api.prepare({...context,itemIds:[other]});
  await flush();assert.equal(race.requests.filter(record=>record.url.endsWith('/PlaybackPreferences')).length,1,'A newer enrollment must wait for the older server mutation');
  releaseOld();
  assert.match((await old).error.message,/superseded/);
  assert.equal((await newer).subtitleStreamIndex,31);
  assert.deepEqual(race.requests.filter(record=>record.url.endsWith('/PlaybackPreferences')).map(record=>record.body.enabled),[false,true]);
  race.sessions=[{...ownSession,NowPlayingItem:{Id:other}}];
  await race.api.refresh();
  assert.deepEqual(race.requests.filter(record=>record.url.endsWith('/PlaybackPreferences')).at(-1).body.itemIds,[other]);

  // A refresh that was still discovering sessions when a new franchise starts
  // must not reinstall the old queue or change the old session's subtitle track.
  const refreshRace=fixture();await refreshRace.api.prepare(context);
  let releaseSessions;
  refreshRace.handler=record=>record.url.endsWith('/Sessions')?new Promise(resolve=>{
    releaseSessions=()=>resolve(ok([ownSession]));
  }):null;
  const staleRefresh=refreshRace.api.refresh();await flush();
  await refreshRace.api.prepare({...context,itemIds:[other]});
  releaseSessions();await staleRefresh;
  assert.equal(refreshRace.requests.filter(record=>record.url.endsWith('/PlaybackPreferences')).length,2);
  assert.equal(refreshRace.requests.some(record=>record.url.endsWith('/Command')),false);
  assert.equal(refreshRace.events.length,0);

  // A second browser/device's durable Off wins over this browser's stale On.
  const durable=fixture();durable.data.set('fe-subtitles:'+server+':'+user,'1');
  durable.preference={hasPreference:true,subtitleEnabled:false,subtitleLanguage:'de'};
  const authoritative=await durable.api.prepare(context,{subtitleEnabled:true});
  assert.equal(authoritative.subtitleEnabled,false);
  assert.equal(durable.requests.find(record=>record.url.endsWith('/PlaybackPreferences')).body.enabled,false);

  // PlaybackInfo and player creation can complete after the old 4.5s fallback.
  // Observe actual starts, remembered/forced tracks restored later, and every
  // enrolled queue entry instead of relying on launch-time HTML text tracks.
  await durable.monitor();
  assert.equal(durable.requests.some(record=>record.url.endsWith('/Command')),false);
  durable.sessions=[{...ownSession,NowPlayingItem:{Id:first},PlayState:{SubtitleStreamIndex:7}}];
  await durable.monitor();
  assert.equal(durable.requests.filter(record=>record.url.endsWith('/Command')).at(-1).body.Arguments.Index,'-1');
  const commandsAfterStart=durable.requests.filter(record=>record.url.endsWith('/Command')).length;
  durable.sessions=[{...ownSession,NowPlayingItem:{Id:first},PlayState:{SubtitleStreamIndex:-1}}];
  await durable.monitor();
  assert.equal(durable.requests.filter(record=>record.url.endsWith('/Command')).length,commandsAfterStart);
  durable.sessions=[{...ownSession,NowPlayingItem:{Id:first},PlayState:{SubtitleStreamIndex:12}}];
  await durable.monitor();
  assert.equal(durable.requests.filter(record=>record.url.endsWith('/Command')).length,commandsAfterStart+1,
    'A forced/custom track re-enabled after startup must be switched Off through the actual player');
  durable.sessions=[{...ownSession,PlayState:{SubtitleStreamIndex:3}}];await durable.monitor();
  assert.deepEqual(durable.requests.filter(record=>record.url.endsWith('/PlaybackPreferences')).at(-1).body.itemIds,[second,first]);
  const beforeUnrelated=durable.requests.filter(record=>record.url.endsWith('/Command')).length;
  const beforeUnrelatedEvents=durable.events.length;
  durable.sessions=[{...ownSession,NowPlayingItem:{Id:other},PlayState:{SubtitleStreamIndex:9}}];await durable.monitor();
  assert.equal(durable.requests.filter(record=>record.url.endsWith('/Command')).length,beforeUnrelated);
  assert.equal(durable.events.length,beforeUnrelatedEvents+1);
  assert.equal(durable.events.at(-1).type,'franchise-subtitles-cleared',
    'Ordinary playback must cancel delayed HTML track fallbacks from the franchise');
  durable.sessions=[ownSession];
  durable.preference={hasPreference:true,subtitleEnabled:true,subtitleLanguage:'fr'};
  await durable.monitor();
  assert.equal(durable.requests.filter(record=>record.url.endsWith('/Command')).at(-1).body.Arguments.Index,'31',
    'An account change from another client must reach the currently enrolled player');

  console.log('Playback subtitle preference tests passed: durable Off/On, late player startup/restoration, queue changes, cross-device refresh, scope, failures and superseded enrollment.');
})().catch(error=>{console.error(error);process.exitCode=1;});
