'use strict';
const bus = require('../frontend/src/data/bus.json');
const netIntel = require('../frontend/src/data/networkIntelligence.json');
const HUBS = netIntel.hubs;
const TRUNK_ROUTES = new Set(netIntel.trunkCorridors);

// ── Build transit data ────────────────────────────────────────────────────────
const _stops=[], _stopById=new Map(), _routes={}, _stopToRoutes={};
for (const [rawId,info] of Object.entries(bus.stops||{})) {
  const id='bus:'+rawId;
  const stop={id,raw_id:rawId,name:info.name,lat:info.lat,lon:info.lon,mode:'bus'};
  _stops.push(stop); _stopById.set(id,stop);
  if(!_stopById.has(rawId)) _stopById.set(rawId,stop);
}
for (const [rawId,info] of Object.entries(bus.routes||{})) {
  const id='bus:'+rawId;
  const stopObjs=(info.stops||[]).map(sid=>_stopById.get('bus:'+sid)||_stopById.get(sid)||null).filter(Boolean);
  _routes[id]={id,raw_id:rawId,line_name:info.line_name,frequency_mins:info.frequency_mins,mode:'bus',stops:stopObjs};
}
for (const [routeId,route] of Object.entries(_routes)) {
  for (const stop of route.stops) {
    if(!_stopToRoutes[stop.id]) _stopToRoutes[stop.id]=[];
    _stopToRoutes[stop.id].push(routeId);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function hav(la1,lo1,la2,lo2){
  const R=6371000,f1=la1*Math.PI/180,f2=la2*Math.PI/180;
  const df=(la2-la1)*Math.PI/180,dl=(lo2-lo1)*Math.PI/180;
  const a=Math.sin(df/2)**2+Math.cos(f1)*Math.cos(f2)*Math.sin(dl/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function tSec(d,m){const spd={bus:20,walk:4.5,auto:20};return Math.round((d/1000/spd[m])*3600);}

function isTrunkLineName(name){
  if(TRUNK_ROUTES.has(name)) return true;
  for(const t of TRUNK_ROUTES){
    if(name.length>t.length&&name.startsWith(t)&&/[A-Za-z\/]/.test(name[t.length])) return true;
  }
  return false;
}
function isTrunkRoute(routeId){const r=_routes[routeId];return r?isTrunkLineName(r.line_name):false;}

function getNearestHubScore(lat,lon,maxD=800){
  let best=0;
  for(const hub of HUBS){
    const d=hav(lat,lon,hub.lat,hub.lon);
    if(d<=maxD){const w=hub.hubScore*(1-(d/maxD)*0.5);if(w>best)best=w;}
  }
  return best;
}
function computeHubPassageBonus(steps){
  let bonus=0;
  for(const step of steps){
    if(step.mode==='walk'||step.mode==='auto') continue;
    for(const hub of HUBS){
      const dF=hav(step.from_coord.lat,step.from_coord.lon,hub.lat,hub.lon);
      const dT=hav(step.to_coord.lat,step.to_coord.lon,hub.lat,hub.lon);
      if(dF<=hub.transferRadius||dT<=hub.transferRadius){
        const b=hub.tier===1?6:hub.tier===2?3:1;
        if(b>bonus)bonus=b;
      }
    }
    if(bonus>=6) break;
  }
  return Math.min(bonus,10);
}

function scoreRoute(steps, journeyDistM){
  const totalDuration=steps.reduce((s,st)=>s+st.duration_sec,0);
  const walkDist=steps.filter(st=>st.mode==='walk').reduce((s,st)=>s+st.distance_m,0);
  const transitSteps=steps.filter(st=>st.mode!=='walk'&&st.mode!=='auto');
  const primaryMode=transitSteps[0]&&transitSteps[0].mode||'bus';
  const transfers=Math.max(0,transitSteps.length-1);

  let score=55;
  if(transfers===0) score+=15; else if(transfers===1) score-=8; else if(transfers===2) score-=35; else score-=70;
  if(primaryMode==='metro') score+=15; else if(primaryMode==='mmts') score+=8;
  const bestFreq=transitSteps.reduce((b,st)=>(st.freq_mins>0&&st.freq_mins<b?st.freq_mins:b),999);
  if(bestFreq<=5) score+=8; else if(bestFreq<=10) score+=6; else if(bestFreq<=20) score+=4; else if(bestFreq<=30) score+=2;
  const walk=walkDist;
  if(walk<=50) score+=4;
  else if(walk<=200) score-=0;
  else if(walk<=400) score-=2;
  else if(walk<=700) score-=4;
  else if(walk<=1000) score-=7;
  else if(walk<=1500) score-=10;
  else if(walk<=2000) score-=15;
  else score-=22;
  if(steps.some(st=>st.mode==='auto')) score-=8;
  const mins=totalDuration/60;
  if(mins<=20) score+=15; else if(mins<=35) score+=8; else if(mins<=75) score+=0; else if(mins<=90) score-=8; else score-=15;
  const isTrunk=transitSteps.some(st=>isTrunkLineName(st.line_name));
  if(isTrunk) score+=6;
  score+=computeHubPassageBonus(steps);
  if(journeyDistM>10000){if(primaryMode==='metro') score+=10; else if(primaryMode==='mmts') score+=6;}
  return {score:Math.max(0,Math.min(100,score)),transfers,mins:Math.round(mins),walk:Math.round(walk),isTrunk,bestFreq,hubBonus:computeHubPassageBonus(steps)};
}

function makeWalk(fromLat,fromLon,toLat,toLon){
  const d=hav(fromLat,fromLon,toLat,toLon);
  return {mode:'walk',from_coord:{lat:fromLat,lon:fromLon},to_coord:{lat:toLat,lon:toLon},distance_m:Math.round(d),duration_sec:tSec(d,'walk'),cost_inr:0,line_name:'',freq_mins:0};
}
function makeTransit(route,boardStop,alightStop){
  const d=hav(boardStop.lat,boardStop.lon,alightStop.lat,alightStop.lon)*1.4;
  return {mode:'bus',from_coord:{lat:boardStop.lat,lon:boardStop.lon},to_coord:{lat:alightStop.lat,lon:alightStop.lon},distance_m:Math.round(d),duration_sec:tSec(d,'bus'),cost_inr:10,line_name:route.line_name,freq_mins:route.frequency_mins||0};
}

function resolveDirection(route,boardId,alightId){
  const fb=route.stops.findIndex(s=>s.id===boardId);
  const fa=route.stops.findIndex(s=>s.id===alightId);
  if(fb!==-1&&fa!==-1&&fb<fa) return {stops:route.stops,boardIdx:fb,alightIdx:fa};
  const rev=[...route.stops].reverse();
  const rb=rev.findIndex(s=>s.id===boardId);
  const ra=rev.findIndex(s=>s.id===alightId);
  if(rb!==-1&&ra!==-1&&rb<ra) return {stops:rev,boardIdx:rb,alightIdx:ra};
  return null;
}

// ── Journey ───────────────────────────────────────────────────────────────────
const HAF=[17.4783,78.3617], LIN=[17.4948,78.3168], RADIUS=1200;
const journeyDistM=hav(HAF[0],HAF[1],LIN[0],LIN[1]);

const srcNearby=[],dstNearby=[];
for (const stop of _stops) {
  if(stop.mode!=='bus') continue;
  const dH=hav(HAF[0],HAF[1],stop.lat,stop.lon);
  const dL=hav(LIN[0],LIN[1],stop.lat,stop.lon);
  if(dH<=RADIUS) srcNearby.push({stop,dist:dH});
  if(dL<=RADIUS) dstNearby.push({stop,dist:dL});
}
srcNearby.sort((a,b)=>a.dist-b.dist);
dstNearby.sort((a,b)=>a.dist-b.dist);

const srcRouteMap=new Map();
for (const {stop,dist} of srcNearby) {
  for (const routeId of (_stopToRoutes[stop.id]||[])) {
    const route=_routes[routeId]; if(!route) continue;
    const idx=route.stops.findIndex(s=>s.id===stop.id); if(idx===-1) continue;
    const ex=srcRouteMap.get(routeId);
    if(!ex||dist<ex.dist) srcRouteMap.set(routeId,{stopIdx:idx,stop,dist});
  }
}
const dstStopMap=new Map();
for (const {stop,dist} of dstNearby) {
  for (const routeId of (_stopToRoutes[stop.id]||[])) {
    const route=_routes[routeId]; if(!route) continue;
    const idx=route.stops.findIndex(s=>s.id===stop.id); if(idx===-1) continue;
    if(!dstStopMap.has(routeId)) dstStopMap.set(routeId,[]);
    dstStopMap.get(routeId).push({stopIdx:idx,stop,dist});
  }
}
for (const e of dstStopMap.values()) e.sort((a,b)=>a.dist-b.dist);

// Sort: trunk first, then frequency
const srcRouteEntries=[...srcRouteMap.entries()].sort(([aId],[bId])=>{
  const at=isTrunkRoute(aId)?0:1,bt=isTrunkRoute(bId)?0:1;
  if(at!==bt) return at-bt;
  const af=(_routes[aId]&&_routes[aId].frequency_mins)||999;
  const bf=(_routes[bId]&&_routes[bId].frequency_mins)||999;
  return af-bf;
});

// Collect direct routes
const collected=[];
const seenFPs=new Set();

for (const [routeId,boardEntry] of srcRouteEntries){
  const route=_routes[routeId]; if(!route) continue;
  const dstEntries=dstStopMap.get(routeId); if(!dstEntries) continue;
  for (const alightEntry of dstEntries){
    if(alightEntry.stopIdx===boardEntry.stopIdx) continue;
    const dir=resolveDirection(route,boardEntry.stop.id,alightEntry.stop.id);
    if(dir){
      const boardStop=dir.stops[dir.boardIdx], alightStop=dir.stops[dir.alightIdx];
      const steps=[];
      const dIn=hav(HAF[0],HAF[1],boardStop.lat,boardStop.lon);
      if(dIn>=20) steps.push(dIn>1000?{mode:'auto',from_coord:{lat:HAF[0],lon:HAF[1]},to_coord:{lat:boardStop.lat,lon:boardStop.lon},distance_m:Math.round(dIn),duration_sec:tSec(dIn,'auto'),cost_inr:Math.round(30+15*(dIn/1000)),line_name:'',freq_mins:0}:makeWalk(HAF[0],HAF[1],boardStop.lat,boardStop.lon));
      steps.push(makeTransit(route,boardStop,alightStop));
      const dOut=hav(alightStop.lat,alightStop.lon,LIN[0],LIN[1]);
      if(dOut>=20) steps.push(dOut>1000?{mode:'auto',from_coord:{lat:alightStop.lat,lon:alightStop.lon},to_coord:{lat:LIN[0],lon:LIN[1]},distance_m:Math.round(dOut),duration_sec:tSec(dOut,'auto'),cost_inr:Math.round(30+15*(dOut/1000)),line_name:'',freq_mins:0}:makeWalk(alightStop.lat,alightStop.lon,LIN[0],LIN[1]));

      const transit=steps.filter(st=>st.mode!=='walk'&&st.mode!=='auto');
      const fp=transit.map(st=>st.line_name).join('->');
      if(!seenFPs.has(fp)){
        seenFPs.add(fp);
        const res=scoreRoute(steps,journeyDistM);
        const totalDur=Math.round(steps.reduce((s,st)=>s+st.duration_sec,0)/60);
        const walkTotal=steps.filter(st=>st.mode==='walk').reduce((s,st)=>s+st.distance_m,0);
        collected.push({routeId,lineName:route.line_name,freq:route.frequency_mins,boardStop:boardStop.name,alightStop:alightStop.name,walkTotal:Math.round(walkTotal),totalDur,score:res.score,trunk:res.isTrunk,bestFreq:res.bestFreq,hubBonus:res.hubBonus,mins:res.mins});
      }
      break;
    }
  }
}

// Also collect 1-transfer routes
const XFER_R=400;
const BIDIRECTIONAL=new Set(['bus','metro','mmts']);
outerLoop:
for (const [routeId1,boardEntry1] of srcRouteEntries){
  if(collected.length>=20) break;
  const route1=_routes[routeId1]; if(!route1) continue;
  let r1Stops=route1.stops,r1BoardIdx=boardEntry1.stopIdx;
  if(BIDIRECTIONAL.has('bus')){
    const fwdCount=route1.stops.length-boardEntry1.stopIdx-1;
    const rev=[...route1.stops].reverse();
    const revBoardIdx=rev.findIndex(s=>s.id===boardEntry1.stop.id);
    const revCount=revBoardIdx!==-1?rev.length-revBoardIdx-1:0;
    if(revCount>fwdCount){r1Stops=rev;r1BoardIdx=revBoardIdx;}
  }
  const downstream=r1Stops.slice(r1BoardIdx+1);
  for (let di=0;di<downstream.length;di++){
    const xferStop=downstream[di];
    const xferIdx=r1BoardIdx+1+di;
    const nearbyX=[];
    for(const stop of _stops){
      if(stop.mode!=='bus') continue;
      const d=hav(xferStop.lat,xferStop.lon,stop.lat,stop.lon);
      if(d<=XFER_R&&stop.id!==xferStop.id) nearbyX.push(stop);
    }
    const candidates=[xferStop,...nearbyX].sort((a,b)=>getNearestHubScore(b.lat,b.lon,500)-getNearestHubScore(a.lat,a.lon,500));
    for(const xStop of candidates){
      for(const routeId2 of (_stopToRoutes[xStop.id]||[])){
        if(routeId2===routeId1) continue;
        const route2=_routes[routeId2]; if(!route2||route2.mode!=='bus') continue;
        const dstEntries2=dstStopMap.get(routeId2); if(!dstEntries2) continue;
        for(const alightEntry2 of dstEntries2){
          const dir2=resolveDirection(route2,xStop.id,alightEntry2.stop.id);
          if(dir2){
            const boardStop1=r1Stops[r1BoardIdx], alightStop1=r1Stops[xferIdx];
            const boardStop2=dir2.stops[dir2.boardIdx], alightStop2=dir2.stops[dir2.alightIdx];
            const steps=[];
            const dIn=hav(HAF[0],HAF[1],boardStop1.lat,boardStop1.lon);
            if(dIn>=20) steps.push(makeWalk(HAF[0],HAF[1],boardStop1.lat,boardStop1.lon));
            steps.push(makeTransit(route1,boardStop1,alightStop1));
            const xd=hav(xferStop.lat,xferStop.lon,xStop.lat,xStop.lon);
            if(xd>=20) steps.push(makeWalk(xferStop.lat,xferStop.lon,xStop.lat,xStop.lon));
            steps.push(makeTransit(route2,boardStop2,alightStop2));
            const dOut=hav(alightStop2.lat,alightStop2.lon,LIN[0],LIN[1]);
            if(dOut>=20) steps.push(makeWalk(alightStop2.lat,alightStop2.lon,LIN[0],LIN[1]));
            const transit=steps.filter(st=>st.mode!=='walk'&&st.mode!=='auto');
            const fp=transit.map(st=>st.line_name).join('->');
            if(!seenFPs.has(fp)){
              seenFPs.add(fp);
              const res=scoreRoute(steps,journeyDistM);
              const walkTotal=steps.filter(st=>st.mode==='walk').reduce((s,st)=>s+st.distance_m,0);
              const totalDur=Math.round(steps.reduce((s,st)=>s+st.duration_sec,0)/60);
              collected.push({routeId:routeId1+'+'+routeId2,lineName:route1.line_name+'->'+route2.line_name,freq:Math.max(route1.frequency_mins,route2.frequency_mins),boardStop:boardStop1.name,alightStop:alightStop2.name,walkTotal:Math.round(walkTotal),totalDur,score:res.score,trunk:res.isTrunk,bestFreq:res.bestFreq,hubBonus:res.hubBonus,mins:res.mins,xfer:xferStop.name});
            }
            if(collected.length>=20) break outerLoop;
            break;
          }
        }
      }
    }
    if(collected.length>=20) break;
  }
}

collected.sort((a,b)=>b.score-a.score||a.totalDur-b.totalDur);
const MAX_ALL=5;
const final=collected.slice(0,MAX_ALL);

console.log('=== STEP 9: All collected routes (direct + 1-transfer), sorted by score ===');
console.log('  Journey distance: '+Math.round(journeyDistM)+'m');
collected.forEach((c,i)=>{
  const mark=c.lineName==='216K/L'?' <-- TARGET':'';
  const xferStr=c.xfer?' xfer@'+c.xfer:'';
  console.log('  #'+(i+1)+' score='+c.score+' '+c.lineName.padEnd(22)+' freq='+String(c.freq).padEnd(4)+' walk='+String(c.walkTotal).padEnd(5)+'m dur='+String(c.totalDur).padEnd(3)+'min trunk='+String(c.trunk)+' hub='+c.hubBonus+xferStr+mark);
});

console.log('\n=== STEP 10: Score breakdown for 216K/L ===');
const t=collected.find(c=>c.lineName==='216K/L');
if(t){
  let s=55;
  console.log('  base                      = 55');
  s+=15; console.log('  +15 direct (0 transfers)  =',s);
  if(t.freq<=5){s+=8;console.log('  +8  freq≤5               =',s);}
  else if(t.freq<=10){s+=6;console.log('  +6  freq≤10              =',s);}
  else if(t.freq<=20){s+=4;console.log('  +4  freq≤20              =',s);}
  if(t.walkTotal<=50){s+=4;console.log('  +4  walk≤50m ('+t.walkTotal+'m)     =',s);}
  else if(t.walkTotal<=200){console.log('  ±0  walk 50-200m ('+t.walkTotal+'m)  =',s);}
  else if(t.walkTotal<=400){s-=2;console.log('  -2  walk 200-400m        =',s);}
  if(t.mins<=20){s+=15;console.log('  +15 dur≤20min ('+t.mins+'min)   =',s);}
  else if(t.mins<=35){s+=8;console.log('  +8  dur≤35min ('+t.mins+'min)   =',s);}
  if(t.trunk){s+=6;console.log('  +6  trunk corridor        =',s);}
  if(t.hubBonus>0){s+=t.hubBonus;console.log('  +'+t.hubBonus+' hub passage bonus     =',s);}
  console.log('  capped score              =',Math.min(100,Math.max(0,s)));
  console.log('  Rank in collected list: #'+(collected.indexOf(t)+1));
  console.log('  In final top-'+MAX_ALL+'?', final.includes(t));
} else {
  console.log('  216K/L not found in collected routes!');
}

console.log('\n=== STEP 11: Final top-'+MAX_ALL+' shown to user ===');
final.forEach((c,i)=>{
  const mark=c.lineName==='216K/L'?' <-- TARGET 216K/L':'';
  console.log('  #'+(i+1)+' score='+c.score+' '+c.lineName+mark);
});
const idx216=final.findIndex(c=>c.lineName==='216K/L');
if(idx216===-1){
  console.log('\n  RESULT: 216K/L is NOT in the final top-'+MAX_ALL+' shown to user.');
  console.log('  It was rank #'+(collected.indexOf(t)+1)+' out of '+collected.length+' total routes collected.');
} else {
  console.log('\n  RESULT: 216K/L IS in final output at rank #'+(idx216+1));
}
