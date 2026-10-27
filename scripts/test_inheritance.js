'use strict';
// Evaluate ONLY the pure artwork-resolver section against a mocked Jellyfin client.
// This is not a host/runtime test.
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const assert=require('node:assert/strict');
const html=fs.readFileSync(path.resolve(__dirname,'../src/Jellyfin.Plugin.FranchiseExplorer/Configuration/configPage.html'),'utf8');
const script=html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1];
const start=script.indexOf('  const mediaCache = new Map();');
const stop=script.indexOf('  function releasePreview(',start);
assert(start>0 && stop>start,'Artwork resolver section missing');
const parent={Id:'11111111-1111-4111-8111-111111111111',ParentId:'',Name:'Marvel',CollectionId:'',Artwork:{PrimaryUrl:'https://example.org/custom.jpg'}};
const phase={Id:'22222222-2222-4222-8222-222222222222',ParentId:parent.Id,Name:'Phase One',CollectionId:'33333333-3333-4333-8333-333333333333',Artwork:{}};
const solo={Id:'44444444-4444-4444-8444-444444444444',ParentId:'',Name:'Solo',CollectionId:'',Artwork:{}};
const library={
 '33333333-3333-4333-8333-333333333333':{Id:phase.CollectionId,Type:'BoxSet',Name:'Phase 1 Collection',ImageTags:{Primary:'abc',Logo:'xyz'},BackdropImageTags:['bd']},
 '55555555-5555-4555-8555-555555555555':{Id:'55555555-5555-4555-8555-555555555555',Type:'Movie',Name:'Solo',ImageTags:{Primary:'movie'}}
};
const model={Nodes:[parent,phase,solo],MediaLinks:[{NodeId:solo.Id,JellyfinItemId:'55555555-5555-4555-8555-555555555555',Position:1}]};
const ctx={model,artSlots:{primary:'PrimaryUrl',backdrop:'BackdropUrl',logo:'LogoUrl',thumb:'ThumbUrl',banner:'BannerUrl'},isManagedArt:(x)=>x.startsWith('/FranchiseExplorer/Artwork/'),validGuid:x=>/^[a-f\d-]{36}$/i.test(x),ApiClient:{getCurrentUserId:()=>undefined,getItem:async(_,id)=>library[id]||null,getImageUrl:(id,o)=>`/Items/${id}/Images/${o.type}`},URL,fetch:async()=>{},previewEpoch:0,releasePreview:()=>{},showSlot:()=>{},authHeaders:()=>{},artApiUrl:x=>x};
vm.runInNewContext(script.slice(start,stop)+'\nglobalThis.resolve=inheritedArt;globalThis.image=jellyfinImageUrl;',ctx);
(async()=>{
 const imported=await ctx.resolve(phase,'primary');
 assert(imported.url.endsWith('/Images/Primary'),'explicit native collection first');
 assert(imported.source.includes('Phase 1 Collection'));
 const inheritedParent=await ctx.resolve({...phase,CollectionId:''},'primary');
 assert.equal(inheritedParent.url,parent.Artwork.PrimaryUrl,'parent custom art can be inherited');
 const linked=await ctx.resolve(solo,'primary');
 assert(linked.source.includes('Linked Movie'),'link art when no collection or parent');
 assert.equal(await ctx.resolve(solo,'logo'),null,'must not misuse a poster as a logo');
 console.log('Offline inheritance resolver tests passed.');
})().catch(e=>{console.error(e);process.exit(1)});
