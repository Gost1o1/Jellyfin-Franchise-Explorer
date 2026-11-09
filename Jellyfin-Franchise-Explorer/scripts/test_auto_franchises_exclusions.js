'use strict';
// Pure queue-resolution checks against a detached, simulated Jellyfin library.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const guid=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const show={Id:guid(1),Type:'Series',Name:'Protected show',ProviderIds:{Imdb:'tt100',Tmdb:'900'}};
const movie={Id:guid(2),Type:'Movie',Name:'Protected movie',ProviderIds:{Imdb:'tt201'}};
const otherMovie={Id:guid(3),Type:'Movie',Name:'Other movie',ProviderIds:{Imdb:'tt202'}};
const collection={Id:guid(4),Type:'BoxSet',Name:'Collection'};
const episodes=[
  [1,1,1,'tt101'],[1,2,3,'tt102'],[1,4,4,'tt104'],[2,1,1,'tt105'],[2,2,2,'tt106']
].map(([season,start,end,imdb],index)=>({
  Id:guid(100+index),Type:'Episode',Name:'Episode '+start,SeriesId:show.Id,
  ParentIndexNumber:season,IndexNumber:start,IndexNumberEnd:end,ProviderIds:{Imdb:imdb}
}));
const library=new Map([show,movie,otherMovie,collection,...episodes].map(item=>[item.Id,item]));
const canon=value=>String(value||'').replace(/-/g,'').toLowerCase();
const json=value=>({ok:true,status:200,json:async()=>value});
const requests=[];
const globals={window:{},console,setInterval:()=>1,clearInterval:()=>{},setTimeout,
  fetch:async(url,options={})=>{
    assert(!options.method||options.method==='GET','Resolution must not write playback or library state');
    requests.push(String(url));
    const request=new URL(String(url),'http://fixture.local');
    if(request.pathname==='/Shows/'+show.Id+'/Episodes')return json({Items:episodes,TotalRecordCount:episodes.length});
    if(request.pathname==='/Items'&&request.searchParams.get('ParentId')===collection.Id)
      return json({Items:[movie,show],TotalRecordCount:2});
    throw Error('Unexpected queue request '+url);
  }};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,
  '../src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-timeline.js'),'utf8'),globals,
  {filename:'franchise-timeline.js'});
const manager=new globals.window.FranchiseTimeline.TimelineManager({
  serverId:guid(10),token:'fixture',prefix:'',userId:guid(11),catalog:{links:[],rows:[]},
  getItem:async id=>[...library.values()].find(item=>canon(item.Id)===canon(id))||null
});
let serial=1000;
const ref=(item,range={})=>({id:guid(serial++),itemId:item.Id,rangeMode:'Full',...range});
const rule=(scope,extra={})=>({scope,providerName:'Imdb',providerId:'tt100',...extra});
const row=(items,exclusions=[])=>({id:guid(serial++),rowType:'Timeline',name:'Chronological Order',
  items,mediaLinkIds:[],mediaOrder:items.map(item=>item.id),exclusions});
const episodeIds=episodes.map(item=>item.Id);
async function expectQueue(target,expected,why){
  const before=JSON.stringify(target);
  const result=await manager.resolve(target);
  assert.deepEqual(Array.from(result.queue,item=>item.id),expected,why);
  assert.equal(JSON.stringify(target),before,'Queue resolution must retain row references and exclusion rules');
}

(async()=>{
  await expectQueue(row([ref(show),ref(movie)]),[...episodeIds,movie.Id],
    'Rows without durable restrictions retain the existing full-show queue');
  await expectQueue(row([ref(movie),ref(otherMovie)],[rule('Movie',{providerName:'iMdB',providerId:'TT201'})]),[otherMovie.Id],
    'Movie rules compare provider names and values without case sensitivity');
  await expectQueue(row([ref(movie),ref(otherMovie)],[rule('Movie',{providerId:'',itemId:movie.Id.replace(/-/g,'').toUpperCase()})]),[otherMovie.Id],
    'Stable Jellyfin identities support canonical GUID forms when a provider identity is absent');
  for(const scope of ['WholeShow','Show','Series']){
    await expectQueue(row([ref(show),ref(movie)],[rule(scope)]),[movie.Id],
      scope+' suppresses the full show before its episodes enter the queue');
  }
  await expectQueue(row([ref(show)],[rule('WholeShow',{providerName:'tmDB',providerId:'900'})]),[],
    'Show identity matching honors the declared provider instead of assuming IMDb');
  await expectQueue(row([ref(show)],[rule('WholeShow',{providerName:'Tvdb',providerId:'900'})]),episodeIds,
    'A value from another provider must not match by value alone');
  await expectQueue(row([ref(show)],[rule('Season',{startSeason:1,endSeason:1})]),episodes.slice(3).map(item=>item.Id),
    'Persistent season exclusions apply to expanded whole-show references');
  await expectQueue(row([ref(show)],[rule('Episode',{startSeason:1,endSeason:1,startEpisode:3,endEpisode:3})]),
    [episodes[0].Id,episodes[2].Id,episodes[3].Id,episodes[4].Id],
    'An exclusion overlapping the end of a double episode suppresses the entire physical media item');
  await expectQueue(row([ref(show)],[rule('Episode',{providerId:'tt102'})]),
    [episodes[0].Id,episodes[2].Id,episodes[3].Id,episodes[4].Id],
    'An exact episode provider identity suppresses that physical item without a parent range');
  await expectQueue(row([ref(show)],[rule('AllowedRange',{startSeason:1,endSeason:1,startEpisode:3,endEpisode:4})]),
    [episodes[2].Id],
    'An allowed range cannot play the portion of a double episode outside its protected boundary');
  const selectedRange={rangeMode:'Episodes',startSeason:1,endSeason:2,startEpisode:2,endEpisode:2};
  await expectQueue(row([ref(show,selectedRange)],[rule('AllowedRange',{startSeason:1,endSeason:2,startEpisode:4,endEpisode:1})]),
    [episodes[2].Id,episodes[3].Id],
    'AllowedRange intersects a manually selected cross-season range before queue construction');
  await expectQueue(row([ref(show)],[
    rule('AllowedRange',{startSeason:1,endSeason:2,startEpisode:1,endEpisode:2}),
    rule('Episode',{startSeason:2,endSeason:2,startEpisode:1,endEpisode:1})
  ]),[episodes[0].Id,episodes[1].Id,episodes[2].Id,episodes[4].Id],
    'Restoring an allowed range must not bypass a separate individual episode restriction');
  await expectQueue(row([ref(episodes[1])],[rule('WholeShow')]),[],
    'A direct episode reference cannot bypass a whole-show provider restriction on its parent');
  await expectQueue(row([ref(episodes[1])],[rule('Season',{startSeason:1,endSeason:1})]),[],
    'A direct episode reference is checked against its parent season restriction');
  await expectQueue(row([ref(episodes[1])],[rule('Episode',{providerId:'tt102'})]),[],
    'A direct episode reference is checked against its own provider restriction');
  await expectQueue(row([ref(episodes[2])],[rule('AllowedRange',{startSeason:1,endSeason:1,startEpisode:2,endEpisode:3})]),[],
    'A direct episode outside a locked parent range cannot bypass that range');
  await expectQueue(row([ref(episodes[1])],[rule('AllowedRange',{startSeason:1,endSeason:1,startEpisode:2,endEpisode:3})]),[episodes[1].Id],
    'A direct double episode entirely inside the locked parent range remains playable');
  const getItem=manager.context.getItem;
  manager.context.getItem=async id=>canon(id)===canon(show.Id)?null:getItem(id);
  await expectQueue(row([ref(episodes[1])],[rule('WholeShow',{itemIds:[show.Id.replace(/-/g,'').toUpperCase()]})]),[],
    'The catalog stable-ID fallback still blocks a direct episode when parent metadata is inaccessible');
  manager.context.getItem=getItem;
  await expectQueue(row([ref(collection)],[rule('WholeShow'),rule('Movie',{providerId:'tt201'})]),[],
    'Collection expansion cannot reintroduce an excluded whole show or movie');
  await expectQueue(row([ref(collection)],[rule('Episode',{startSeason:1,endSeason:1,startEpisode:3,endEpisode:3})]),
    [movie.Id,episodes[0].Id,episodes[2].Id,episodes[3].Id,episodes[4].Id],
    'Collection-expanded series episodes retain their parent provider identity for overlap restrictions');
  await expectQueue(row([ref(show),ref(movie)],[rule('WholeShow',{enabled:false}),rule('Movie',{providerId:'tt201',enabled:false})]),
    [...episodeIds,movie.Id],
    'Disabled rules must not alter a playback queue');
  const sharedRef=ref(show);
  const protectedRow=row([sharedRef],[rule('Season',{startSeason:1,endSeason:1})]);
  const otherRow=row([sharedRef]);
  await expectQueue(protectedRow,episodes.slice(3).map(item=>item.Id),
    'The selected row applies its own rules');
  await expectQueue(otherRow,episodeIds,
    'A sibling sharing the identical reference retains its independent queue');
  await expectQueue(protectedRow,episodes.slice(3).map(item=>item.Id),
    'Resolving another row cannot clear the protected row restriction');
  assert(requests.length>0,'Fixtures must exercise series and collection expansion');
  console.log('PASS Auto Franchises playback exclusions: movie/show/season/episode/range identities, double episodes, direct references, BoxSets and row isolation');
})().catch(error=>{console.error(error);process.exitCode=1;});
