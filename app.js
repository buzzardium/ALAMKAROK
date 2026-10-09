/* ALAMKAROK - resilient static web app */
(() => {
  'use strict';
  // Canonicalize all Vercel deployment URLs to the stable public production domain.
  // Preserve room codes, paths, and any other query/hash data when redirecting.
  if (location.hostname.endsWith('.vercel.app') && location.hostname !== 'alamkarok.vercel.app') {
    const canonical = new URL(location.href);
    canonical.protocol = 'https:';
    canonical.hostname = 'alamkarok.vercel.app';
    canonical.port = '';
    location.replace(canonical.toString());
    return;
  }
  const app = document.getElementById('app');
  const cfg = window.JUKEBOX_CONFIG || {};
  const colors = ['#9b5cff','#28a8ff','#18c9a0','#ff9d2e','#ff4f5f','#f1d21b','#ef67c7','#7bd66f','#54d8e8','#ff6f9c'];
  const state = {
    room:null, me:null, people:[], queue:[], isHost:false, channel:null,
    player:null, playerReady:false, ytReady:false, ytLoading:false, currentPosition:0, playbackStartedAt:0, playbackPlayedSeconds:0, hostVolume:80, busy:false, pendingSwitchSession:null, privateList:[], privateBusy:false, privateCollapsed:false, sharedCollapsed:false, playlistCollapsed:{}, queueVersion:0, chatMessages:[], chatLoading:false, pointsReady:false, pointVotes:[], pointVoteVideoId:null, pointVoteBusy:false, endPreviewItems:null, drag:{type:null,id:null}, reconnectTimer:null, reconnecting:false, leaving:false
  };

  function esc(v){ return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function uuid(){ return (crypto && crypto.randomUUID) ? crypto.randomUUID() : 'u-'+Date.now()+'-'+Math.random().toString(36).slice(2); }
  function roomCode(){ return Math.random().toString(36).slice(2,7).toUpperCase(); }
  function validConfig(){ return /^https:\/\/[^\s]+\.supabase\.co(?:\/)?$/.test(String(cfg.SUPABASE_URL||'')) && /^sb_publishable_/.test(String(cfg.SUPABASE_ANON_KEY||'')); }
  const PUBLIC_APP_URL = 'https://alamkarok.vercel.app/';
  function roomUrl(code){ return `${PUBLIC_APP_URL}?room=${encodeURIComponent(code)}`; }
  const ROOM_SESSION_KEY='alamkarok-room-session-v1';
  const PREVIOUS_ROOM_KEY='alamkarok-previous-room-v1';
  function saveRoomSession(){ try{ if(state.room&&state.me) localStorage.setItem(ROOM_SESSION_KEY,JSON.stringify({roomId:state.room.id,roomCode:state.room.code,participantId:state.me.id,userId:state.me.user_id,isHost:!!state.isHost})); }catch(_){} }
  function readRoomSession(){ try{ const raw=localStorage.getItem(ROOM_SESSION_KEY); if(!raw)return null; const s=JSON.parse(raw); return s&&s.roomId&&s.roomCode&&s.participantId?s:null; }catch(_){return null;} }
  function clearRoomSession(){ try{ localStorage.removeItem(ROOM_SESSION_KEY); }catch(_){} }
  function savePreviousRoom(){ try{ if(state.room&&state.me) localStorage.setItem(PREVIOUS_ROOM_KEY,JSON.stringify({roomId:state.room.id,roomCode:state.room.code,userId:state.me.user_id||null,name:state.me.name||'',color:state.me.color||'',isHost:!!state.isHost,savedAt:new Date().toISOString()})); }catch(_){} }
  function readPreviousRoom(){ try{ const raw=localStorage.getItem(PREVIOUS_ROOM_KEY); if(!raw)return null; const s=JSON.parse(raw); return s&&s.roomId&&s.roomCode&&s.userId&&s.name?s:null; }catch(_){return null;} }
  function clearPreviousRoom(){ try{ localStorage.removeItem(PREVIOUS_ROOM_KEY); }catch(_){} }
  const DEVICE_ID_KEY='alamkarok-device-id-v1';
  const PERSONAL_PLAYLISTS_KEY='alamkarok-personal-playlists-v1';
  function deviceId(){ try{ let id=localStorage.getItem(DEVICE_ID_KEY); if(!id){id=uuid();localStorage.setItem(DEVICE_ID_KEY,id);} return id; }catch(_){return 'local-device';} }
  function personalPlaylistsKey(){ return `${PERSONAL_PLAYLISTS_KEY}-${deviceId()}`; }
  function loadPersonalPlaylists(){ try{ const raw=localStorage.getItem(personalPlaylistsKey()); const parsed=raw?JSON.parse(raw):[]; state.personalPlaylists=Array.isArray(parsed)?parsed.filter(x=>x&&x.name&&Array.isArray(x.items)):[]; }catch(_){state.personalPlaylists=[];} }
  function savePersonalPlaylists(){ try{ localStorage.setItem(personalPlaylistsKey(),JSON.stringify(state.personalPlaylists)); }catch(_){} }
  function saveStoredPlaylist(name,items){
    const clean=items.filter(x=>x&&x.video_id).map(x=>({video_id:x.video_id,title:x.title||'YouTube video',thumbnail:x.thumbnail||ytThumb(x.video_id),playlist_id:x.playlist_id||null,playlist_title:x.playlist_title||null}));
    if(!clean.length)return false;
    const existing=state.personalPlaylists.find(x=>x.name.toLowerCase()===name.toLowerCase());
    const record={id:existing?.id||'pl-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),name:name.trim(),items:clean,updatedAt:new Date().toISOString(),createdAt:existing?.createdAt||new Date().toISOString()};
    if(existing)Object.assign(existing,record);else state.personalPlaylists.push(record);
    savePersonalPlaylists(); return true;
  }
  async function loadStoredPlaylist(id){
    const p=state.personalPlaylists.find(x=>x.id===id); if(!p)return;
    const button=Array.from(document.querySelectorAll('[data-stored-open]')).find(b=>b.dataset.storedOpen===id);
    if(button){button.disabled=true;button.innerText='Checking videos…';}
    let removed=0,unknown=0; const kept=[];
    for(let i=0;i<p.items.length;i+=5){
      const results=await Promise.all(p.items.slice(i,i+5).map(async item=>({item,status:await checkVideoEmbeddable(item.video_id)})));
      for(const result of results){if(result.status===false)removed++;else{kept.push(result.item);if(result.status===null)unknown++;}}
    }
    p.items=kept; p.updatedAt=new Date().toISOString(); savePersonalPlaylists();
    state.privateList=kept.map(x=>({...x,id:privateItemId(),selected:false}));
    state.privateCollapsed=false; savePrivateList(); renderPrivateList(); updateListSectionUI();
    const body=document.getElementById('privateBody'); if(body)body.scrollIntoView({behavior:'smooth',block:'start'});
    document.querySelector('.stored-lists-modal')?.remove();
    if(removed||unknown)notify('Loaded “'+p.name+'” into My List. Removed '+removed+' unavailable; '+unknown+' could not be verified.','info');
    else notify('Loaded “'+p.name+'” into My List. All '+kept.length+' videos passed the available checks.','info');
  }
  function openStoredLists(){
    loadPersonalPlaylists();
    const back=document.createElement('div'); back.className='modalback';
    const rows=state.personalPlaylists.map(p=>`<div class="stored-list-row"><button class="btn stored-list-open" data-stored-open="${esc(p.id)}"><b>${esc(p.name)}</b><span class="small">${p.items.length} saved videos · check on open</span></button><button class="btn danger-sm stored-list-delete" data-stored-del="${esc(p.id)}" title="Delete stored list">×</button></div>`).join('');
    back.innerHTML=`<div class="modal stored-lists-modal"><div class="brand">ALAMKAROK</div><h2>Stored Lists</h2><p class="sub">Your personal playlists are stored on this device and are not shared with the room.</p><div class="stored-list-list">${rows||'<div class="empty">No stored lists yet.</div>'}</div><div class="modalactions"><button class="btn" id="saveCurrentList">Save Current My List</button><button class="btn primary" id="closeStoredLists">Close</button></div></div>`;
    document.body.appendChild(back);
    back.querySelector('#closeStoredLists').onclick=()=>back.remove();
    back.querySelector('#saveCurrentList').onclick=()=>{
      if(!state.privateList.length)return notify('My List is empty.','error');
      const name=window.prompt('Name this stored list:','My Playlist');
      if(!name||!name.trim())return;
      if(saveStoredPlaylist(name.trim(),state.privateList)){back.remove();notify(`Saved “${name.trim()}” as a stored list.`,'info');}
    };
    back.querySelectorAll('[data-stored-open]').forEach(b=>b.onclick=()=>{const id=b.dataset.storedOpen;back.remove();loadStoredPlaylist(id);});
    back.querySelectorAll('[data-stored-del]').forEach(b=>b.onclick=()=>{const id=b.dataset.storedDel;state.personalPlaylists=state.personalPlaylists.filter(x=>x.id!==id);savePersonalPlaylists();b.closest('.stored-list-row')?.remove();});
  }
  function showExistingRoomPrompt(session,requestedCode){
    const back=document.createElement('div'); back.className='modalback';
    const target=requestedCode&&requestedCode!==session.roomCode?`Switch to <b>${esc(requestedCode)}</b>?`:'You can continue where you left off.';
    back.innerHTML=`<div class="modal center"><div class="brand">ALAMKAROK</div><div class="small">You're already in a room</div><h2>Room ${esc(session.roomCode)}</h2><p class="sub">${target}</p><div class="modalactions"><button class="btn" id="stayRoom">Stay in Room</button><button class="btn primary" id="switchRoom">Switch Room</button></div></div>`;
    document.body.appendChild(back);
    back.querySelector('#stayRoom').onclick=async()=>{back.remove();try{await restoreRoomSession(session);}catch(e){clearRoomSession();renderHome();notify('Your previous room is no longer available.','error');}};
    back.querySelector('#switchRoom').onclick=async()=>{back.remove();await switchRoomFromPrompt(session,requestedCode);};
  }
  async function restoreRoomSession(session){
    const client=getClient();
    const [roomRes,participantRes]=await Promise.all([
      client.from('rooms').select('*').eq('id',session.roomId).maybeSingle(),
      client.from('participants').select('*').eq('id',session.participantId).maybeSingle()
    ]);
    if(roomRes.error)throw roomRes.error; if(participantRes.error)throw participantRes.error;
    if(!roomRes.data||!participantRes.data||participantRes.data.room_id!==roomRes.data.id)throw new Error('Room session is no longer valid.');
    state.room=roomRes.data; state.me=participantRes.data; state.isHost=state.me.user_id===state.room.host_id;
    await enterRoom();
  }
  async function switchRoomFromPrompt(oldSession,requestedCode){
    const code=String(requestedCode||'').trim().toUpperCase();
    if(!/^[A-Z0-9]{5}$/.test(code)){
      return notify('The scanned room code is invalid.','error');
    }
    // Keep the old session until the new room is successfully joined.
    // registerParticipant() will remove the old participant after the new room is active.
    state.pendingSwitchSession=oldSession;
    await joinRoom(code);
  }
  async function leaveStoredSessionAfterSuccessfulJoin(oldSession){
    if(!oldSession||!oldSession.participantId)return;
    try{ await getClient().from('participants').delete().eq('id',oldSession.participantId); }catch(_){}
  }
  function ytId(value){
    try {
      const u = new URL(value);
      if (u.hostname === 'youtu.be' || u.hostname.endsWith('.youtu.be')) return u.pathname.slice(1).split('/')[0] || null;
      if (u.hostname.includes('youtube.com')) {
        if (u.searchParams.get('v')) return u.searchParams.get('v');
        const parts=u.pathname.split('/').filter(Boolean);
        if (['shorts','embed','live'].includes(parts[0])) return parts[1] || null;
      }
    } catch (_) {}
    return null;
  }
  function ytThumb(id){ return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`; }
  function privateKey(){ return state.room&&state.me ? `alamkarok-private-v2-${state.room.code}-${state.me.user_id||state.me.id}` : null; }
  function loadPrivateList(){ state.privateList=[]; state.privateCollapsed=false; state.sharedCollapsed=false; state.playlistCollapsed={}; try{ const k=privateKey(); if(!k)return; const raw=localStorage.getItem(k); const parsed=raw?JSON.parse(raw):[]; if(Array.isArray(parsed)) state.privateList=parsed.filter(x=>x&&x.video_id); else if(parsed&&typeof parsed==='object'){ state.privateList=Array.isArray(parsed.items)?parsed.items.filter(x=>x&&x.video_id):[]; state.privateCollapsed=!!parsed.privateCollapsed; state.sharedCollapsed=!!parsed.sharedCollapsed; state.playlistCollapsed=(parsed.playlistCollapsed&&typeof parsed.playlistCollapsed==='object')?parsed.playlistCollapsed:{}; } }catch(_){state.privateList=[];} checkUnavailablePrivateVideos(); }
  async function checkUnavailablePrivateVideos(){
    const items=state.privateList.slice();
    if(!items.length)return;
    let removed=0;
    const concurrency=6;
    let cursor=0;
    async function worker(){
      while(cursor<items.length){
        const item=items[cursor++];
        try{
          const r=await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(item.video_id)}&format=json`);
          // Only treat a clear YouTube "not found/unavailable" response as removable.
          // Network errors and rate limits are kept so temporary failures never delete a saved video.
          if(r.status===404||r.status===410){
            const current=state.privateList.find(x=>x.id===item.id);
            if(current){state.privateList=state.privateList.filter(x=>x.id!==item.id);removed++;}
          }
        }catch(_){}
      }
    }
    await Promise.all(Array.from({length:Math.min(concurrency,items.length)},worker));
    if(!removed)return;
    savePrivateList();
    if(document.getElementById('privateList'))renderPrivateList();
    notify(`${removed} unavailable YouTube video${removed===1?' was':'s were'} removed from My List.`,'info');
  }
  function savePrivateList(){ try{ const k=privateKey(); if(k)localStorage.setItem(k,JSON.stringify({items:state.privateList,privateCollapsed:state.privateCollapsed,sharedCollapsed:state.sharedCollapsed,playlistCollapsed:state.playlistCollapsed})); }catch(_){} }
  function bindMobilePinchCollapse(){
    if(!window.matchMedia || !window.matchMedia('(max-width:780px)').matches)return;
    const sharedBody=document.getElementById('sharedBody');
    if(sharedBody && sharedBody.dataset.pinchCollapseBound!=='1'){
      sharedBody.dataset.pinchCollapseBound='1';
      let startDistance=0,armed=false;
      const distance=e=>{
        if(!e.touches||e.touches.length<2)return 0;
        const dx=e.touches[0].clientX-e.touches[1].clientX;
        const dy=e.touches[0].clientY-e.touches[1].clientY;
        return Math.hypot(dx,dy);
      };
      sharedBody.addEventListener('touchstart',e=>{
        if(e.touches.length===2){startDistance=distance(e);armed=startDistance>0;}
      },{passive:true});
      sharedBody.addEventListener('touchmove',e=>{
        if(!armed||e.touches.length<2)return;
        const d=distance(e);
        if(d>0&&startDistance-d>=45){
          armed=false;
          e.preventDefault();
          if(!state.sharedCollapsed)toggleListSection('shared');
        }
      },{passive:false});
      sharedBody.addEventListener('touchend',()=>{startDistance=0;armed=false;},{passive:true});
      sharedBody.addEventListener('touchcancel',()=>{startDistance=0;armed=false;},{passive:true});
    }
    document.querySelectorAll('.playlist-subbody').forEach(el=>{
      if(el.dataset.pinchCollapseBound==='1')return;
      const header=el.closest('.playlist-subsection')?.querySelector('[data-playlist-toggle]');
      const playlistId=header?.dataset.playlistToggle;
      if(!playlistId)return;
      el.dataset.pinchCollapseBound='1';
      let startDistance=0,armed=false;
      const distance=e=>{
        if(!e.touches||e.touches.length<2)return 0;
        const dx=e.touches[0].clientX-e.touches[1].clientX;
        const dy=e.touches[0].clientY-e.touches[1].clientY;
        return Math.hypot(dx,dy);
      };
      el.addEventListener('touchstart',e=>{
        if(e.touches.length===2){startDistance=distance(e);armed=startDistance>0;}
      },{passive:true});
      el.addEventListener('touchmove',e=>{
        if(!armed||e.touches.length<2)return;
        const d=distance(e);
        if(d>0&&startDistance-d>=45){
          armed=false;
          e.preventDefault();
          if(!state.playlistCollapsed[playlistId])togglePlaylistGroup(playlistId);
        }
      },{passive:false});
      el.addEventListener('touchend',()=>{startDistance=0;armed=false;},{passive:true});
      el.addEventListener('touchcancel',()=>{startDistance=0;armed=false;},{passive:true});
    });
  }
  function toggleListSection(which){ if(which==='private') state.privateCollapsed=!state.privateCollapsed; else state.sharedCollapsed=!state.sharedCollapsed; savePrivateList(); updateListSectionUI(); }
  function updateListSectionUI(){ const p=document.getElementById('privateBody'), q=document.getElementById('sharedBody'); if(p){p.classList.toggle('collapsed',state.privateCollapsed); p.setAttribute('aria-hidden',state.privateCollapsed?'true':'false');} if(q){q.classList.toggle('collapsed',state.sharedCollapsed); q.setAttribute('aria-hidden',state.sharedCollapsed?'true':'false');} document.querySelectorAll('[data-collapse]').forEach(b=>{const c=b.dataset.collapse==='private'?state.privateCollapsed:state.sharedCollapsed;const chev=b.querySelector('.chevron');if(chev)chev.textContent=c?'▼':'▲';b.setAttribute('aria-expanded',c?'false':'true');}); }
  function togglePlaylistGroup(id){ state.playlistCollapsed[id]=!state.playlistCollapsed[id]; savePrivateList(); renderPrivateList(); requestAnimationFrame(()=>requestAnimationFrame(updateVideoListScrollState)); }
  function playlistGroupTitle(id){ const g=state.privateList.find(x=>x.playlist_id===id); return g?.playlist_title||'Imported YouTube Playlist'; }
  function playlistId(value){ try{ const u=new URL(value); return u.hostname.includes('youtube.com')&&u.searchParams.get('list') ? u.searchParams.get('list') : null; }catch(_){ return null; } }
  function privateItemId(){ return 'p-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8); }
  async function videoTitle(id){ let title='YouTube video'; try{const r=await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(id)}&format=json`);if(r.ok){const j=await r.json();if(j.title)title=j.title;}}catch(_){} return title; }
  // Best-effort preflight: YouTube only exposes embed permission through the Data API.
  // null means unknown (no key, rate limit, network failure), not automatically blocked.
  async function checkVideoEmbeddable(id){
    const key=String(cfg.YOUTUBE_API_KEY||'').trim();
    if(key){
      try{
        const r=await fetch(`https://www.googleapis.com/youtube/v3/videos?part=status&id=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`);
        if(r.ok){
          const j=await r.json();
          if(Array.isArray(j.items)&&j.items.length&&j.items[0].status?.embeddable===false)return false;
          if(Array.isArray(j.items)&&j.items.length&&j.items[0].status?.embeddable===true)return true;
          if(Array.isArray(j.items)&&j.items.length===0)return false;
        }
      }catch(_){}
    }
    try{
      const r=await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(id)}&format=json`);
      if(r.status===404||r.status===410)return false;
      if(r.ok)return true;
    }catch(_){}
    return null;
  }
  async function skipUnplayableCurrent(videoId,errorCode){
    if(!state.isHost||state.room?.current_video_id!==videoId)return;
    const idx=state.queue.findIndex(x=>x.video_id===videoId);
    const item=idx>=0?state.queue[idx]:null;
    if(item){
      const r=await getClient().from('queue_items').delete().eq('id',item.id);
      if(r.error){notify('This video cannot be embedded. Remove it from Shared Queue to continue.','error');return;}
      await refreshQueue();await normalizePositions();await refreshQueue();
      await broadcast('queue',{queue:state.queue});
    }
    const next=state.queue[Math.max(0,idx)];
    if(next){
      await performPlayback('load',next.video_id,0,true,true);
      notify('Skipped a YouTube video that cannot be played here.','info');
    }else{
      const patch={current_video_id:null,current_index:0,is_playing:false,position_seconds:0,updated_at:new Date().toISOString()};
      const r=await getClient().from('rooms').update(patch).eq('id',state.room.id).select().single();
      if(!r.error)state.room=r.data;
      updateRoomView();await broadcast('room',patch);
      try{state.player?.stopVideo();}catch(_){}
      notify('The video cannot be embedded and the queue is empty.','info');
    }
  }
  function notify(message, kind='info'){
    let n=document.getElementById('toast');
    if(!n){ n=document.createElement('div'); n.id='toast'; document.body.appendChild(n); }
    n.className='toast '+kind; n.textContent=message; n.hidden=false;
    clearTimeout(notify.timer); notify.timer=setTimeout(()=>{n.hidden=true;},3500);
  }
  function errorScreen(title, message, detail=''){
    app.innerHTML=`<div class="wrap"><div class="card hero"><div class="brand">ALAMKAROK</div><h1 class="h1">${esc(title)}</h1><p class="sub">${esc(message)}</p>${detail?`<pre class="errorbox">${esc(detail)}</pre>`:''}<button class="btn primary" id="retry">Try Again</button></div></div>`;
    document.getElementById('retry').onclick=()=>location.reload();
  }

  function renderHome(){
    const configProblem = !validConfig();
    const sdkProblem = !window.supabase || typeof window.supabase.createClient !== 'function';
    const previous=readPreviousRoom();
    const previousMarkup=previous?`<div class="previous-room card"><div class="section-title"><h2>Previous Room</h2><span class="badge">${esc(previous.roomCode)}</span></div><div class="small">Return as <b>${esc(previous.name)}</b> and keep your previous room identity and private list.</div><button class="btn primary wide" id="joinPrevious" ${configProblem||sdkProblem?'disabled':''}>Join Previous Room</button></div>`:'';
    app.innerHTML=`<div class="wrap"><div class="hero card">
      <div class="brand">ALAMKAROK</div><div class="eyebrow">SHARED MEDIA ROOM</div>
      <h1 class="h1">Queue videos. Control playback. Share the room.</h1>
      <p class="sub">Create a room, show the QR code, and let everyone add <b>YouTube videos to the shared queue</b> and control playback from their own phone.</p>
      <p class="small home-support-note"><i>Currently supports YouTube videos and YouTube playlists.</i></p>
      ${configProblem?'<div class="notice error"><b>Supabase configuration is missing.</b><br>Open <code>config.js</code> and add your Project URL and <code>sb_publishable_…</code> key.</div>':''}
      ${sdkProblem?'<div class="notice error"><b>Supabase library did not load.</b><br>Check your internet connection and reload.</div>':''}
      <div class="joinbox">
        <button class="btn primary big" id="create" ${configProblem||sdkProblem?'disabled':''}>Create Room</button>
        <div class="divider"><span>or join an existing room</span></div>
        <div class="row"><input class="input" id="roomCode" maxlength="5" placeholder="Room code e.g. 7K4P9" autocomplete="off" style="flex:1;text-transform:uppercase"><button class="btn" id="joinCode" ${configProblem||sdkProblem?'disabled':''}>Join</button></div>
      </div>
      ${previousMarkup}
      <div class="featuregrid"><div>📺 <b>Host playback</b><span>Audio and video play through the host device</span></div><div>🔀 <b>Shared queue</b><span>Everyone sees the same order</span></div><div>🎛️ <b>Shared controls</b><span>Everyone can play, pause, next and previous</span></div><div>👥 <b>People + colours</b><span>Name required when joining</span></div></div>
    </div><div class="footer">ALAMKAROK • internet-based shared queue</div></div>`;
    if(!configProblem&&!sdkProblem)loadAnnouncement();
    if(!configProblem&&!sdkProblem){
      document.getElementById('create').onclick=createRoom;
      document.getElementById('joinCode').onclick=()=>joinRoom(document.getElementById('roomCode').value.trim().toUpperCase());
      document.getElementById('roomCode').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('joinCode').click();});
      const previousBtn=document.getElementById('joinPrevious'); if(previousBtn) previousBtn.onclick=joinPreviousRoom;
    }
  }

  // Block severe racial, ethnic, and religious slurs in public display names.
  // Matching is normalized to catch common punctuation/spacing/number substitutions.
  const BLOCKED_NAME_TERMS = [
    'nigger','nigga','niggah','niggaz','jigaboo','porchmonkey',
    'kike','yid','heeb',
    'chink','gook','jap',
    'spic','spick','beaner','wetback',
    'paki','raghead','towelhead','sandnigger',
    'gypsy','kafir','kaffir','sandmonkey'
  ];
  const NAME_LEET_MAP={'0':'o','1':'i','3':'e','4':'a','5':'s','7':'t','8':'b','9':'g','@':'a','$':'s','!':'i'};
  function normalizeNameForModeration(value){
    return String(value||'').toLowerCase()
      .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[01345789@$!]/g,ch=>NAME_LEET_MAP[ch]||ch)
      .replace(/[^a-z0-9]+/g,'')
      .replace(/(.)\1{2,}/g,'$1$1');
  }
  function containsBlockedNameTerm(value){
    const normalized=normalizeNameForModeration(value);
    return BLOCKED_NAME_TERMS.some(term=>normalized.includes(term));
  }

  function nameModal(code, isHost, callback){
    const back=document.createElement('div'); back.className='modalback';
    back.innerHTML=`<div class="modal"><div class="brand">ALAMKAROK</div><div class="small">Room <b>${esc(code)}</b></div><h2>Join the room</h2><p class="sub">Choose the name everyone will see. A colour will be assigned automatically.</p><input class="input" id="joinName" maxlength="40" placeholder="Your name" autocomplete="name"><div class="modalactions"><button class="btn" id="cancelName">Cancel</button><button class="btn primary" id="confirmName">${isHost?'Start Room':'Join Room'}</button></div></div>`;
    document.body.appendChild(back);
    const input=back.querySelector('#joinName'); setTimeout(()=>input.focus(),50);
    back.querySelector('#cancelName').onclick=()=>back.remove();
    back.querySelector('#confirmName').onclick=()=>{const n=input.value.trim();if(!n){input.focus();return notify('Enter a name first','error');}if(containsBlockedNameTerm(n)){input.focus();return notify("That name isn't allowed. Please choose another name.",'error');}back.remove();callback(n);};
    input.addEventListener('keydown',e=>{if(e.key==='Enter')back.querySelector('#confirmName').click();});
  }

  let sb=null;
  function getClient(){
    if(sb) return sb;
    if(!validConfig()) throw new Error('Supabase configuration is missing or invalid.');
    if(!window.supabase || typeof window.supabase.createClient!=='function') throw new Error('Supabase browser library failed to load.');
    sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
    return sb;
  }

  async function createRoom(){
    try{
      const client=getClient(); const hostId=uuid(); const code=roomCode();
      const {data,error}=await client.from('rooms').insert({code,host_id:hostId}).select().single();
      if(error) throw error;
      nameModal(code,true,async name=>{ try{await registerParticipant(data,true,hostId,name);}catch(e){errorScreen('Could not create the room',e.message);} });
    }catch(e){notify(e.message||'Could not create room','error');}
  }
  async function joinRoom(code){
    if(!/^[A-Z0-9]{5}$/.test(code)) return notify('Enter a 5-character room code.','error');
    try{
      const client=getClient(); const {data,error}=await client.from('rooms').select('*').eq('code',code).maybeSingle();
      if(error) throw error; if(!data) return notify('Room not found. Check the code.','error');
      const userId=uuid(); nameModal(code,false,name=>registerParticipant(data,false,userId,name).catch(e=>errorScreen('Could not join the room',e.message)));
    }catch(e){notify(e.message||'Could not join room','error');}
  }
  async function joinPreviousRoom(){
    const previous=readPreviousRoom();
    if(!previous)return notify('No previous room is saved.','error');
    try{
      const client=getClient();
      const {data:room,error}=await client.from('rooms').select('*').eq('id',previous.roomId).maybeSingle();
      if(error)throw error;
      if(!room){
        clearPreviousRoom();
        renderHome();
        return notify('Your previous room is no longer available.','error');
      }
      const {data:people,error:listErr}=await client.from('participants').select('*').eq('room_id',room.id).order('created_at',{ascending:true});
      if(listErr)throw listErr;
      const existing=(people||[]).find(p=>p.user_id===previous.userId);
      if(existing){
        state.room=room;state.me=existing;state.isHost=existing.user_id===room.host_id;saveRoomSession();clearPreviousRoom();await enterRoom();return;
      }
      const {data:p,error:insertErr}=await client.from('participants').insert({room_id:room.id,user_id:previous.userId,name:previous.name.slice(0,40),color:previous.color||colors[(people||[]).length%colors.length]}).select().single();
      if(insertErr)throw insertErr;
      state.room=room;state.me=p;state.isHost=p.user_id===room.host_id;saveRoomSession();clearPreviousRoom();await enterRoom();
    }catch(e){
      notify(e.message||'Could not rejoin previous room.','error');
    }
  }

  async function registerParticipant(room,isHost,userId,name){
    const client=getClient();
    const {data:people,error:listErr}=await client.from('participants').select('*').eq('room_id',room.id).order('created_at',{ascending:true});
    if(listErr) throw listErr;
    const color=colors[(people||[]).length%colors.length];
    const {data:p,error}=await client.from('participants').insert({room_id:room.id,user_id:userId,name:name.slice(0,40),color}).select().single();
    if(error) throw error;
    state.room=room;state.me=p;state.isHost=isHost;saveRoomSession();const oldSession=state.pendingSwitchSession;state.pendingSwitchSession=null;await enterRoom();if(oldSession&&oldSession.roomId!==room.id)await leaveStoredSessionAfterSuccessfulJoin(oldSession);
  }
  async function enterRoom(){
    const client=getClient();
    const [people,q,room]=await Promise.all([
      client.from('participants').select('*').eq('room_id',state.room.id).order('created_at',{ascending:true}),
      client.from('queue_items').select('*').eq('room_id',state.room.id).order('position',{ascending:true}),
      client.from('rooms').select('*').eq('id',state.room.id).single()
    ]);
    if(people.error)throw people.error;if(q.error)throw q.error;if(room.error)throw room.error;
    state.people=people.data||[];state.queue=q.data||[];state.room=room.data;state.queueVersion=Number(state.room.queue_version||0);state.chatMessages=[];loadPrivateList();await loadChatMessages();renderRoom();await setupRealtime();if(state.isHost)loadYouTubeAPI();
  }
  async function recoverRoomState(){
    if(!state.room||!state.me||state.leaving)return;
    const client=getClient();
    const [people,q,room]=await Promise.all([
      client.from('participants').select('*').eq('room_id',state.room.id).order('created_at',{ascending:true}),
      client.from('queue_items').select('*').eq('room_id',state.room.id).order('position',{ascending:true}),
      client.from('rooms').select('*').eq('id',state.room.id).single()
    ]);
    if(people.error||q.error||room.error)throw (people.error||q.error||room.error);
    if(!room.data)throw new Error('Room no longer exists.');
    const me=await client.from('participants').select('*').eq('id',state.me.id).maybeSingle();
    if(me.error)throw me.error;
    if(!me.data||me.data.room_id!==room.data.id)throw new Error('Your room session is no longer valid.');
    state.people=people.data||[];
    state.queue=q.data||[];
    state.room=room.data;
    state.me=me.data;
    state.isHost=state.me.user_id===state.room.host_id;
    state.queueVersion=Number(state.room.queue_version||0);
    await loadChatMessages();
    updateRoomView();
    if(state.isHost&&state.room.current_video_id)ensureYouTubePlayer();
  }

  function scheduleRealtimeReconnect(){
    if(state.leaving||!state.room||!state.me||state.reconnectTimer)return;
    state.reconnectTimer=setTimeout(async()=>{
      state.reconnectTimer=null;
      if(state.leaving||!state.room||!state.me)return;
      state.reconnecting=true;
      try{
        const old=state.channel;
        state.channel=null;
        if(old)try{await getClient().removeChannel(old);}catch(_){}
        await recoverRoomState();
        await setupRealtime();
        notify('Connection restored.','info');
      }catch(e){
        notify('Connection lost. Reconnecting…','error');
        scheduleRealtimeReconnect();
      }finally{
        state.reconnecting=false;
      }
    },2000);
  }

  async function setupRealtime(){
    if(state.leaving||!state.room||!state.me)return;
    const client=getClient();
    const channel=client.channel(`alamkarok-${state.room.id}`,{config:{broadcast:{self:true},presence:{key:state.me.id}}});
    state.channel=channel;
    channel.on('broadcast',{event:'command'},({payload})=>handleCommandBroadcast(payload))
      .on('broadcast',{event:'queue'},({payload})=>{state.queue=payload.queue||[];if(Number.isFinite(Number(payload.queue_version)))state.queueVersion=Number(payload.queue_version);updateRoomView();})
      .on('broadcast',{event:'people'},({payload})=>{state.people=payload.people||[];updateRoomView();})
      .on('broadcast',{event:'participant_left'},({payload})=>{
        const id=payload?.participantId;
        if(!id)return;
        state.people=state.people.filter(p=>p.id!==id);
        updateRoomView();
      })
      .on('broadcast',{event:'volume'},({payload})=>{handleVolumeBroadcast(payload);})
      .on('broadcast',{event:'handoff_volume'},({payload})=>{handleHandoffVolume(payload);})
      .on('broadcast',{event:'room'},({payload})=>{state.room={...state.room,...payload};if(Number.isFinite(Number(payload?.queue_version)))state.queueVersion=Number(payload.queue_version);saveRoomSession();updateRoomView();})
      .on('broadcast',{event:'chat'},({payload})=>{if(payload?.message) receiveChatMessage(payload.message);})
      .on('broadcast',{event:'points'},({payload})=>{if(payload?.people){state.people=payload.people;updatePeopleUI();}})
      .on('presence',{event:'leave'},({leftPresences})=>handleHostPresenceLeave(leftPresences))
      .on('postgres_changes',{event:'*',schema:'public',table:'participants',filter:`room_id=eq.${state.room.id}`},refreshPeople)
      .on('postgres_changes',{event:'*',schema:'public',table:'chat_messages',filter:`room_id=eq.${state.room.id}`},refreshChatMessages)
      .on('postgres_changes',{event:'*',schema:'public',table:'queue_items',filter:`room_id=eq.${state.room.id}`},scheduleQueueRefresh)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'rooms',filter:`id=eq.${state.room.id}`},refreshRoom)
      .subscribe(async status=>{
        if(status==='SUBSCRIBED'){
          try{
            await channel.track({participantId:state.me.id,userId:state.me.user_id,name:state.me.name});
          }catch(_){}
          try{
            await recoverRoomState();
          }catch(e){
            notify('Could not recover room state. Reconnecting…','error');
            scheduleRealtimeReconnect();
          }
        }else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){
          notify('Real-time connection lost. Reconnecting…','error');
          scheduleRealtimeReconnect();
        }
      });
  }
  async function refreshPeople(){const r=await getClient().from('participants').select('*').eq('room_id',state.room.id).order('created_at',{ascending:true});if(!r.error){state.people=r.data||[];updateRoomView();}}
  async function loadChatMessages(){try{const r=await getClient().from('chat_messages').select('*').eq('room_id',state.room.id).order('created_at',{ascending:true}).limit(80);if(!r.error)state.chatMessages=r.data||[];}catch(_){} }
  async function refreshChatMessages(){await loadChatMessages();updatePeopleUI();}
  function receiveChatMessage(message){if(!message||!message.id)return;if(state.chatMessages.some(x=>x.id===message.id))return;state.chatMessages.push(message);state.chatMessages=state.chatMessages.slice(-80);renderChatMessages();}
  function updatePeopleUI(){const people=document.getElementById('peopleList');if(people)people.innerHTML=renderPeopleHtml();renderChatMessages();}
  function renderPeopleHtml(){return state.people.map(p=>{const pts=Number(p.points||0);const isMe=p.id===state.me.id;const canVote=!!state.room.current_video_id&&!!state.room.is_playing;return `<div class="person person-with-points"><div class="person-main"><span class="dot" style="background:${esc(p.color)}"></span><span>${esc(p.name)}${isMe?' <span class="muted">(You)</span>':''}${p.user_id===state.room.host_id?' 👑':''}</span></div><div class="person-score"><span class="points-badge">⭐ ${pts}</span>${isMe?'':`<button class="give-point-btn" data-give="${esc(p.id)}" title="${canVote?'Give points for the current song':'Points can only be given while a song is playing'}" ${canVote?'':'disabled'}>🎁</button>`}</div></div>`;}).join('');}
  function renderChatMessages(){const box=document.getElementById('roomChatMessages');if(!box)return;box.innerHTML=state.chatMessages.length?state.chatMessages.map(m=>{const mine=m.sender_id===state.me.id;return `<div class="chat-msg ${mine?'mine':''}"><span class="chat-dot" style="background:${esc(m.color||'#9b5cff')}"></span><div><div class="chat-meta">${esc(m.name||'Guest')}</div><div class="chat-bubble">${esc(m.message)}</div></div></div>`}).join(''):'<div class="chat-empty">Say something… 👋</div>';box.scrollTop=box.scrollHeight;bindPointButtons();}
  async function sendChat(){const input=document.getElementById('roomChatInput');if(!input)return;const message=input.value.trim();if(!message)return;if(message.length>240)return notify('Chat message is limited to 240 characters.','error');const row={id:uuid(),room_id:state.room.id,sender_id:state.me.id,name:state.me.name,color:state.me.color,message,created_at:new Date().toISOString()};input.value='';state.chatMessages.push(row);state.chatMessages=state.chatMessages.slice(-80);renderChatMessages();try{const r=await getClient().from('chat_messages').insert({id:row.id,room_id:row.room_id,sender_id:row.sender_id,name:row.name,color:row.color,message:row.message});if(r.error){} }catch(_){} await broadcast('chat',{message:row});}
  function addEmoji(e){const input=document.getElementById('roomChatInput');if(!input)return;const pos=input.selectionStart??input.value.length;input.value=input.value.slice(0,pos)+e+input.value.slice(pos);input.focus();input.selectionStart=input.selectionEnd=pos+e.length;}
  function bindPointButtons(){document.querySelectorAll('[data-give]').forEach(b=>b.onclick=()=>openGivePoints(b.dataset.give));}
  async function openGivePoints(recipientId){
    const existing=document.getElementById('givePointsPop');if(existing)existing.remove();
    const p=state.people.find(x=>x.id===recipientId);if(!p||recipientId===state.me.id)return;
    const videoId=state.room?.current_video_id;
    if(!videoId||!state.room?.is_playing)return notify('Points can only be given while a song is playing.','info');
    try{
      const votes=await getClient().from('point_votes').select('recipient_id').eq('room_id',state.room.id).eq('video_id',videoId).eq('giver_id',state.me.id);
      if(votes.error)throw votes.error;
      state.pointVotes=(votes.data||[]).map(v=>v.recipient_id);state.pointVoteVideoId=videoId;
      if(state.pointVotes.includes(recipientId))return notify('You already gave points to this person for this song.','info');
    }catch(e){return notify('Points database update is required before song voting can be used.','error');}
    if(!state.room?.is_playing||state.room.current_video_id!==videoId)return notify('The song changed. Open points again for the current song.','info');
    const back=document.createElement('div');back.className='point-popover';
    back.innerHTML=`<div class="point-pop-card"><div class="small">Give points to <b>${esc(p.name)}</b></div><div class="small">Current song: ${esc(state.queue.find(x=>x.video_id===videoId)?.title||'Now playing')}</div><div class="point-options"><button class="btn" data-pts="1">+1 ⭐</button><button class="btn" data-pts="5">+5 ⭐</button><button class="btn primary" data-pts="10">+10 ⭐</button></div><div class="small">One selection per person for this song.</div><button class="point-close">Cancel</button></div>`;
    back.id='givePointsPop';document.body.appendChild(back);
    back.querySelectorAll('[data-pts]').forEach(b=>b.onclick=async()=>{if(state.pointVoteBusy)return;state.pointVoteBusy=true;back.querySelectorAll('[data-pts]').forEach(x=>x.disabled=true);await givePoints(recipientId,Number(b.dataset.pts),videoId);state.pointVoteBusy=false;});
    back.querySelector('.point-close').onclick=()=>back.remove();back.onclick=e=>{if(e.target===back)back.remove();};
  }
  async function givePoints(recipientId,amount,videoId){
    const back=document.getElementById('givePointsPop');
    if(recipientId===state.me.id||![1,5,10].includes(amount))return;
    const recipient=state.people.find(x=>x.id===recipientId);if(!recipient)return;
    if(!videoId||!state.room?.is_playing||state.room.current_video_id!==videoId){if(back)back.remove();return notify('Points can only be given while that song is playing.','error');}
    try{
      const r=await getClient().rpc('give_points',{p_room_id:state.room.id,p_giver_id:state.me.id,p_recipient_id:recipientId,p_video_id:videoId,p_amount:amount});
      if(r.error)throw r.error;
      if(back)back.remove();
      state.pointVotes=state.pointVoteVideoId===videoId?[...new Set([...state.pointVotes,recipientId])]:[recipientId];state.pointVoteVideoId=videoId;
      await refreshPeople();await broadcast('points',{people:state.people});
      notify(`Gave ${amount} point${amount===1?'':'s'} to ${recipient.name} for this song ⭐`,'info');
    }catch(e){
      if(back)back.remove();
      const msg=String(e?.message||e);
      if(/already voted|already gave|duplicate key|unique constraint/i.test(msg))notify('You already gave points to this person for this song.','info');
      else if(/song is not playing|current song changed/i.test(msg))notify('Points can only be given while that song is playing.','error');
      else notify('Points could not be given. Apply the song-points database migration, then try again.','error');
    }
  }
  let queueRefreshTimer=null;
  let queueRefreshInFlight=false;
  let queueRefreshPending=false;
  let renderedQueueSignature=null;
  function scheduleQueueRefresh(){
    if(queueRefreshTimer)clearTimeout(queueRefreshTimer);
    queueRefreshTimer=setTimeout(()=>{queueRefreshTimer=null;refreshQueue();},140);
  }
  async function refreshQueue(){
    if(queueRefreshInFlight){queueRefreshPending=true;return;}
    queueRefreshInFlight=true;
    try{
      const r=await getClient().from('queue_items').select('*').eq('room_id',state.room.id).order('position',{ascending:true});
      if(!r.error){state.queue=r.data||[];updateRoomView();}
    }finally{
      queueRefreshInFlight=false;
      if(queueRefreshPending){queueRefreshPending=false;scheduleQueueRefresh();}
    }
  }
  async function refreshRoom(){const r=await getClient().from('rooms').select('*').eq('id',state.room.id).single();if(!r.error){const wasHost=!!state.isHost;state.room=r.data;state.queueVersion=Number(r.data.queue_version||0);state.isHost=!!state.me&&state.me.user_id===state.room.host_id;updateRoomView();if(wasHost!==state.isHost){if(!state.isHost){try{if(state.player&&typeof state.player.stopVideo==='function')state.player.stopVideo();if(state.player&&typeof state.player.destroy==='function')state.player.destroy();}catch(_){}state.player=null;state.playerReady=false;}else if(state.room.current_video_id)loadYouTubeAPI();}else if(state.isHost&&state.room.current_video_id)ensureYouTubePlayer();saveRoomSession();}}

  async function broadcast(event,payload){if(state.channel) await state.channel.send({type:'broadcast',event,payload});}

  function renderRoom(){
    renderedQueueSignature=null;
    const current=state.room.current_video_id;const q=state.queue;
    loadStoredHostVolume();
    app.innerHTML=`<div class="wrap room-screen"><div class="top"><div><div class="brand">ALAMKAROK</div><div class="small">Room <b>${esc(state.room.code)}</b> · <span id="peopleCount">${state.people.length}</span> people</div></div><div class="actions"><span class="badge"><span class="dot" style="background:${esc(state.me.color)}"></span>${esc(state.me.name)}</span><button class="btn" id="showQr">QR</button><button class="btn danger-sm" id="leaveRoom" type="button">Leave Room</button></div></div>
      <div class="roomgrid">
        <section class="player-column">
          <div class="card player-card">${state.isHost?'<div class="player player-shell" id="playerShell"><div id="player" class="playerbox"><div class="playerplaceholder" id="playerPlaceholder">'+(current?'Loading YouTube player…':'Add a YouTube video to start playback.')+'</div></div></div>':'<div class="guest-player-status"><span class="guest-status-icon">♫</span><div class="guest-status-copy"><strong>Room controls</strong><span>Playback is controlled on the host device</span></div><span class="guest-live-dot"></span><button class="guest-next-up-toggle" id="guestNextUpToggle" type="button" aria-expanded="false">NEXT UP <span>⌄</span></button></div><div class="guest-next-up-panel" id="guestNextUpPanel" hidden><div class="guest-next-up-current"><span class="guest-next-up-label">CURRENTLY PLAYING</span><strong id="guestCurrentTitle">Nothing playing</strong></div><div class="guest-next-up-label">UP NEXT</div><div id="guestNextUpList" class="guest-next-up-list"></div><div id="guestNextUpCount" class="guest-next-up-count"></div></div>'}${state.isHost?`<div class="end-preview" id="endPreview" aria-hidden="true"><button class="end-preview-tab" id="endPreviewTab" type="button" aria-expanded="false"><span>NEXT UP</span><span class="end-preview-tab-chevron">⌃</span></button><div class="end-preview-panel"><div class="end-preview-current"><div class="end-preview-section-label">CURRENTLY PLAYING</div><div class="end-preview-current-title" id="endPreviewCurrentTitle">Nothing playing</div></div><div class="end-preview-upcoming"><div class="end-preview-section-label">NEXT UP</div><div class="end-preview-list" id="endPreviewList"></div><div class="end-preview-count" id="endPreviewCount"></div></div></div></div>`:''}<div class="controls"><button class="control" id="prev" title="Previous">⏮</button><button class="control main" id="play" title="Play/Pause">${state.room.is_playing?'❚❚':'▶'}</button><button class="control" id="next" title="Next">⏭</button>${state.isHost?'<button class="control fullscreen-control" id="fullscreenBtn" type="button" title="Fullscreen player" aria-label="Fullscreen player">⛶</button>':''}</div><div class="volume-control"><span>🔊</span><input id="volume" class="range" type="range" min="0" max="100" value="${state.hostVolume}" aria-label="Party volume"><span id="volumeValue">${state.hostVolume}%</span></div><div class="small center" id="playState">${state.room.is_playing?'Playing':'Paused'} · ${current?'Video selected':'No video selected'}</div></div>
        </section>
        <aside class="room-sidebar"><div class="card people-chat-card"><div class="section-title"><h2>People in Room</h2><span class="badge">${state.isHost?'HOST':'GUEST'}</span></div><div class="people" id="peopleList">${renderPeopleHtml()}</div><div class="room-chat"><div class="chat-title"><span>💬 Room Chat</span><span class="small">Give ⭐ points</span></div><div class="chat-messages" id="roomChatMessages"></div><div class="chat-emoji-row">${['😂','❤️','🔥','👏','🎤','🎉','👍','😎'].map(e=>`<button type="button" class="emoji-btn" data-emoji="${e}">${e}</button>`).join('')}</div><div class="chat-compose"><input class="input" id="roomChatInput" maxlength="240" placeholder="Message the room…" autocomplete="off"><button class="btn primary" id="roomChatSend">Send</button></div></div></div></aside>
      </div>

      <section class="main-section shared-section card gap">
        <div class="section-title section-toggle"><button class="btn collapse-btn" id="toggleShared" data-collapse="shared" aria-expanded="${state.sharedCollapsed?'false':'true'}" aria-label="Collapse shared queue"><span class="chevron" aria-hidden="true">${state.sharedCollapsed?'▼':'▲'}</span></button><div class="section-static-label">SHARED QUEUE <span class="section-count">(<span id="queueCount">${q.length}</span>)</span></div><button class="btn green section-action-btn" id="shuffle">🔀 Shuffle</button></div>
                <div id="sharedBody" class="collapsible-body ${state.sharedCollapsed?'collapsed':''}" aria-hidden="${state.sharedCollapsed?'true':'false'}"><div class="row"><input class="input" id="url" placeholder="Paste a YouTube link" inputmode="url"><button class="btn primary" id="add">Add to Queue</button></div><div class="queue" id="queueList">${q.length?q.map((x,i)=>`<div class="qitem ${x.video_id===current?'now':''}" draggable="false" data-drag-type="shared" data-drag-id="${esc(x.id)}"><div class="qnum drag-handle" title="Drag to reorder">⠿<span>${i+1}</span></div><img class="thumb" src="${esc(x.thumbnail||ytThumb(x.video_id))}" alt=""><div class="min0"><div class="qtitle">${esc(x.title||'YouTube video')}</div><div class="meta">${x.video_id===current?'NOW PLAYING · ':''}${esc(personName(x.added_by))}</div></div><div class="actions queue-actions"><button class="action-sm move-btn" data-up="${esc(x.id)}" title="Move up" ${i===0?'disabled':''}>↑</button><button class="action-sm move-btn" data-down="${esc(x.id)}" title="Move down" ${i===q.length-1?'disabled':''}>↓</button>${x.video_id!==current||state.isHost?`<button class="action-sm" data-play="${esc(x.id)}">Play</button>`:''}<button class="action-sm danger-sm" data-del="${esc(x.id)}">×</button></div></div>`).join(''):'<div class="empty">No videos yet. Add the first YouTube link.</div>'}</div></div>
      </section>

      <section class="main-section private-section card gap private-card">
        <div class="section-title section-toggle"><button class="btn collapse-btn" id="togglePrivate" data-collapse="private" aria-expanded="${state.privateCollapsed?'false':'true'}" aria-label="Collapse private list"><span class="chevron" aria-hidden="true">${state.privateCollapsed?'▼':'▲'}</span></button><div class="section-static-label">MY LIST <span class="section-private">— PRIVATE</span></div><div class="actions section-header-actions"><button class="btn section-action-btn" id="storedLists">Stored Lists</button><button class="btn section-action-btn" id="privateSelectAll">Select All</button></div></div>
                <div id="privateBody" class="collapsible-body ${state.privateCollapsed?'collapsed':''}" aria-hidden="${state.privateCollapsed?'true':'false'}"><div class="row"><input class="input" id="privateUrl" placeholder="Paste a YouTube video or playlist link" inputmode="url"><button class="btn primary" id="privateAdd">Add to My List</button></div><div class="small private-help">Build your own list first. Select one, several, or all songs, then send them to the shared queue.</div><div class="queue" id="privateList"></div><div class="private-actions"><button class="btn green" id="uploadSelected">Upload Selected</button><button class="btn" id="uploadAll">Upload All</button></div></div>
      </section>

      <section class="card gap room-qr-bottom"><div class="section-title"><h2>Room QR</h2></div><div id="qr" class="qr"></div><div class="small center">Scan to join</div><div class="linkbox">${esc(roomUrl(state.room.code))}</div></section>

      <div class="footer">Everyone can add links and control playback. Only the host displays YouTube.</div></div>`;
    bindRoomControls();
    // Apply the universal 10-video viewport on the initial room render too.
    // Previously this only happened after a later room update (for example Shuffle).
    renderPrivateList();
    updateVideoListScrollState();
    if(state.isHost&&state.room.current_video_id)ensureYouTubePlayer();
    loadAnnouncement();
  }

  function updateVideoListScrollState(){
    const lists=[
      {el:document.getElementById('queueList'),limit:10},
      {el:document.getElementById('privateList'),limit:10}
    ];
    lists.forEach(({el,limit})=>{
      if(!el)return;
      el.classList.remove('long-list-scroll');
      el.style.removeProperty('--list-scroll-height');
      el.style.removeProperty('height');
      el.style.removeProperty('max-height');
      requestAnimationFrame(()=>{
        const items=[...el.querySelectorAll('.qitem[data-drag-type]')].filter(item=>item.getBoundingClientRect().height>0);
        if(!items.length)return;

        const listRect=el.getBoundingClientRect();
        const scrollTop=el.scrollTop||0;
        const contentBottom=item=>item.getBoundingClientRect().bottom-listRect.top+scrollTop;
        const target=items[Math.min(limit,items.length)-1];
        const contentHeight=Math.ceil((target?contentBottom(target):contentBottom(items[items.length-1]))+4);
        const shouldScroll=items.length>limit;

        if(!shouldScroll)return;

        // The viewport is always sized to exactly the first 10 visible video rows.
        // The calculation is based on content coordinates, so scrolling/re-rendering
        // cannot make the viewport shrink.
        const scrollHeight=Math.max(220,contentHeight)+'px';
        el.style.setProperty('--list-scroll-height',scrollHeight);
        el.style.setProperty('height',scrollHeight);
        el.style.setProperty('max-height',scrollHeight);
        el.classList.add('long-list-scroll');
      });
    });
  }

  function updateRoomView(){
    if(!document.querySelector('.room-screen')){renderRoom();return;}
    const current=state.room.current_video_id,q=state.queue;
    const count=document.getElementById('peopleCount');if(count)count.textContent=state.people.length;
    const qc=document.getElementById('queueCount');if(qc)qc.textContent=q.length;
    const stateEl=document.getElementById('playState');if(stateEl)stateEl.textContent=`${state.room.is_playing?'Playing':'Paused'} · ${current?'Video selected':'No video selected'}`;
    const play=document.getElementById('play');if(play)play.textContent=state.room.is_playing?'❚❚':'▶';
    const list=document.getElementById('queueList');
    const queueSignature=JSON.stringify({current,host:!!state.isHost,items:q.map(x=>[x.id,x.video_id,x.title,x.thumbnail,x.added_by,x.position])});
    if(list&&queueSignature!==renderedQueueSignature){
      list.innerHTML=q.length?q.map((x,i)=>`<div class="qitem ${x.video_id===current?'now':''}" draggable="false" data-drag-type="shared" data-drag-id="${esc(x.id)}"><div class="qnum drag-handle" title="Drag to reorder">⠿<span>${i+1}</span></div><img class="thumb" src="${esc(x.thumbnail||ytThumb(x.video_id))}" alt=""><div class="min0"><div class="qtitle">${esc(x.title||'YouTube video')}</div><div class="meta">${x.video_id===current?'NOW PLAYING · ':''}${esc(personName(x.added_by))}</div></div><div class="actions queue-actions"><button class="action-sm move-btn" data-up="${esc(x.id)}" title="Move up" ${i===0?'disabled':''}>↑</button><button class="action-sm move-btn" data-down="${esc(x.id)}" title="Move down" ${i===q.length-1?'disabled':''}>↓</button>${x.video_id!==current||state.isHost?`<button class="action-sm" data-play="${esc(x.id)}">Play</button>`:''}<button class="action-sm danger-sm" data-del="${esc(x.id)}">×</button></div></div>`).join(''):'<div class="empty">No videos yet. Add the first YouTube link.</div>';
      renderedQueueSignature=queueSignature;
      list.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>removeItem(b.dataset.del));
      list.querySelectorAll('[data-play]').forEach(b=>b.onclick=()=>playQueueItem(b.dataset.play));
      list.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>moveQueueItem(b.dataset.up,-1));
      list.querySelectorAll('[data-down]').forEach(b=>b.onclick=()=>moveQueueItem(b.dataset.down,1));
      bindDragAndDrop(document);
    }
    updateEndPreview();
    renderPrivateList();
    updateVideoListScrollState();
    bindMobilePinchCollapse();
    updatePeopleUI();
    if(state.isHost&&current)ensureYouTubePlayer();
  }
  function dragItems(container,type){
    if(!container)return [];
    return [...container.querySelectorAll(`:scope > [data-drag-type="${type}"]`)];
  }
  function clearDragTransforms(container){
    if(!container)return;
    container.querySelectorAll('[data-drag-type]').forEach(el=>{
      el.style.transition='';
      el.style.transform='';
      el.classList.remove('drag-shift','drag-over');
    });
  }
  function dragContainerFor(item,type){
    if(type==='private') return item.closest('.playlist-subbody') || item.parentElement;
    return item.closest('#queueList');
  }
  function applyLiveDragPreview(container,type,fromId,toId){
    const items=dragItems(container,type);
    const from=items.findIndex(x=>x.dataset.dragId===fromId);
    const to=items.findIndex(x=>x.dataset.dragId===toId);
    if(from<0||to<0||from===to)return;
    const dragged=items[from];
    const gap=parseFloat(getComputedStyle(container).rowGap||getComputedStyle(container).gap||'8')||8;
    const shift=dragged.getBoundingClientRect().height+gap;
    items.forEach(x=>{x.style.transition='transform 180ms cubic-bezier(.2,.8,.2,1)';x.style.transform='';});
    if(from<to){
      for(let i=from+1;i<=to;i++)items[i].style.transform=`translate3d(0,${-shift}px,0)`;
    }else{
      for(let i=to;i<from;i++)items[i].style.transform=`translate3d(0,${shift}px,0)`;
    }
  }
  function bindDragAndDrop(root=document){
    const queue=root.querySelector?.('#queueList');
    if(queue) bindSortableContainer(queue,'shared');
    const privateList=root.querySelector?.('#privateList');
    if(privateList){
      privateList.querySelectorAll('.playlist-subbody').forEach(el=>bindSortableContainer(el,'private'));
      bindSortableContainer(privateList,'private',true);
    }
  }

  function bindSortableContainer(container,type,includeNested=false){
    if(!container)return;
    const items=()=>includeNested
      ? [...container.children].filter(x=>x.matches?.('[data-drag-type="private"]'))
      : [...container.children].filter(x=>x.matches?.(`[data-drag-type="${type}"]`));
    items().forEach(item=>enablePointerDrag(item,container,type));
  }

  // One pointer-based sorter for mouse + touch. No native HTML5 drag is used.
  // Touch starts directly from the visible drag handle; mouse can start anywhere on the row.
  function enablePointerDrag(item,container,type){
    if(item.dataset.pointerDragBound==='1')return;
    item.dataset.pointerDragBound='1';

    const handle=item.querySelector('.drag-handle');
    let pointerId=null, startY=0, active=false, currentTarget=null;
    let startTop=0, ghost=null;

    const items=()=>[...container.children].filter(el=>el.matches?.(`[data-drag-type="${type}"]`));

    function resetVisuals(){
      items().forEach(el=>{
        el.style.transition='';
        el.style.transform='';
        el.style.visibility='';
        el.classList.remove('drag-over');
      });
      item.classList.remove('dragging');
      if(ghost){ghost.remove();ghost=null;}
    }

    function cleanup(){
      document.removeEventListener('pointermove',onMove,true);
      document.removeEventListener('pointerup',onUp,true);
      document.removeEventListener('pointercancel',onCancel,true);
      try{if(pointerId!==null)item.releasePointerCapture(pointerId);}catch(_){ }
      resetVisuals();
      state.drag={type:null,id:null};
      pointerId=null;
      active=false;
      currentTarget=null;
    }

    function createGhost(){
      const r=item.getBoundingClientRect();
      ghost=item.cloneNode(true);
      ghost.dataset.pointerDragBound='0';
      ghost.classList.add('drag-ghost');
      ghost.style.position='fixed';
      ghost.style.left=r.left+'px';
      ghost.style.top=r.top+'px';
      ghost.style.width=r.width+'px';
      ghost.style.height=r.height+'px';
      ghost.style.margin='0';
      ghost.style.pointerEvents='none';
      ghost.style.zIndex='2147483640';
      ghost.style.transition='none';
      ghost.style.transform='translate3d(0,0,0) scale(1.015)';
      document.body.appendChild(ghost);
      item.style.visibility='hidden';
    }

    function animateDrop(target){
      if(!ghost||!target)return Promise.resolve();
      const targetRect=target.getBoundingClientRect();
      const ghostRect=ghost.getBoundingClientRect();
      const dy=targetRect.top-ghostRect.top;
      const dx=targetRect.left-ghostRect.left;
      ghost.style.transition='transform 180ms cubic-bezier(.2,.8,.2,1)';
      ghost.style.transform=`translate3d(${dx}px,${dy}px,0) scale(1.015)`;
      return new Promise(resolve=>setTimeout(resolve,190));
    }

    function activate(e){
      if(active)return;
      active=true;
      state.drag={type,id:item.dataset.dragId};
      const r=item.getBoundingClientRect();
      startTop=r.top;
      item.classList.add('dragging');
      item.style.transition='none';
      createGhost();
      try{item.setPointerCapture(pointerId);}catch(_){ }
      if(e.pointerType==='touch'||e.pointerType==='pen')e.preventDefault();
    }

    function findTarget(clientY){
      let list=items().filter(el=>el!==item);
      if(!list.length)return null;
      let best=null,bestDistance=Infinity;
      for(const el of list){
        const r=el.getBoundingClientRect();
        const center=r.top+r.height/2;
        const d=Math.abs(clientY-center);
        if(d<bestDistance){bestDistance=d;best=el;}
      }
      return best;
    }

    function preview(target){
      const all=items();
      all.forEach(el=>{
        if(el!==item){
          el.style.transition='transform 180ms cubic-bezier(.2,.8,.2,1)';
          el.style.transform='';
          el.classList.remove('drag-over');
        }
      });
      if(!target)return;
      target.classList.add('drag-over');
      const from=all.indexOf(item),to=all.indexOf(target);
      if(from<0||to<0||from===to)return;
      const gap=parseFloat(getComputedStyle(container).rowGap||getComputedStyle(container).gap||'8')||8;
      const shift=item.getBoundingClientRect().height+gap;
      if(from<to){
        for(let i=from+1;i<=to;i++)all[i].style.transform=`translate3d(0,${-shift}px,0)`;
      }else{
        for(let i=to;i<from;i++)all[i].style.transform=`translate3d(0,${shift}px,0)`;
      }
    }

    function onMove(e){
      if(e.pointerId!==pointerId)return;
      if(!active)activate(e);
      if(e.pointerType==='touch'||e.pointerType==='pen')e.preventDefault();
      const dy=e.clientY-startY;
      if(ghost)ghost.style.transform=`translate3d(0,${dy}px,0) scale(1.015)`;
      const target=findTarget(e.clientY);
      if(target!==currentTarget){
        currentTarget=target;
        preview(target);
      }
    }

    async function onUp(e){
      if(e.pointerId!==pointerId)return;
      const target=currentTarget||findTarget(e.clientY);
      const fromId=item.dataset.dragId;
      const toId=target?.dataset.dragId||null;
      const shouldMove=active&&toId&&toId!==fromId;
      if(!shouldMove){cleanup();return;}
      await animateDrop(target);
      cleanup();
      if(type==='shared')await reorderQueueByDrop(fromId,toId);
      else reorderPrivateByDrop(fromId,toId);
    }

    function onCancel(e){if(e.pointerId===pointerId)cleanup();}

    function onDown(e){
      if(e.button!==undefined&&e.button!==0)return;
      if(e.target.closest('button,input,select,textarea,a'))return;
      if(!handle||!e.target.closest('.drag-handle'))return;
      pointerId=e.pointerId;
      startY=e.clientY;
      active=false;
      currentTarget=null;
      const r=item.getBoundingClientRect();
      startTop=r.top;
      document.addEventListener('pointermove',onMove,true);
      document.addEventListener('pointerup',onUp,true);
      document.addEventListener('pointercancel',onCancel,true);
      if(e.pointerType==='touch'||e.pointerType==='pen'){
        e.preventDefault();
        activate(e);
      }else activate(e);
    }

    item.addEventListener('pointerdown',onDown,{passive:false});
  }

  function animateListReorder(list,beforeRects){
    if(!list||!beforeRects||!beforeRects.size)return;
    const els=[...list.querySelectorAll('[data-drag-type]')];
    els.forEach(el=>{
      const old=beforeRects.get(el.dataset.dragId);if(!old)return;
      const now=el.getBoundingClientRect();const dx=old.left-now.left,dy=old.top-now.top;
      if(Math.abs(dx)<1&&Math.abs(dy)<1)return;
      el.style.transition='none';
      el.style.transform=`translate3d(${dx}px,${dy}px,0)`;
      el.getBoundingClientRect();
      requestAnimationFrame(()=>{
        requestAnimationFrame(()=>{
          el.style.transition='transform 240ms cubic-bezier(.2,.8,.2,1)';
          el.style.transform='translate3d(0,0,0)';
        });
      });
      const done=()=>{el.style.transition='';el.style.transform='';el.removeEventListener('transitionend',done);};
      el.addEventListener('transitionend',done);
    });
  }
  function captureDragRects(list){
    const m=new Map();if(!list)return m;
    list.querySelectorAll('[data-drag-type]').forEach(el=>m.set(el.dataset.dragId,el.getBoundingClientRect()));return m;
  }
  function reorderPrivateByDrop(fromId,toId){
    const from=state.privateList.findIndex(x=>x.id===fromId),to=state.privateList.findIndex(x=>x.id===toId);
    if(from<0||to<0||from===to)return;
    const list=document.getElementById('privateList'),before=captureDragRects(list);
    const [item]=state.privateList.splice(from,1);state.privateList.splice(to,0,item);savePrivateList();renderPrivateList();
    animateListReorder(document.getElementById('privateList'),before);
  }
  async function reorderSharedQueue(fromId,toId,options={}){
    if(state.busy)return false;
    if(!fromId||!toId||fromId===toId)return false;
    const beforeRects=options.beforeRects||captureDragRects(document.getElementById('queueList'));
    const previousQueue=options.previousQueue||state.queue.slice();
    const previousIndex=Number.isInteger(state.room.current_index)?state.room.current_index:0;
    const from=state.queue.findIndex(x=>x.id===fromId);
    const to=state.queue.findIndex(x=>x.id===toId);
    if(from<0||to<0)return false;
    if(!options.optimisticApplied){
      const optimistic=state.queue.slice();
      const [moved]=optimistic.splice(from,1);
      optimistic.splice(to,0,moved);
      state.queue=optimistic;
    }
    const currentIndex=state.room.current_video_id?state.queue.findIndex(x=>x.video_id===state.room.current_video_id):-1;
    state.room.current_index=currentIndex>=0?currentIndex:0;
    updateRoomView();
    requestAnimationFrame(()=>requestAnimationFrame(()=>animateListReorder(document.getElementById('queueList'),beforeRects)));
    state.busy=true;
    try{
      const r=await getClient().rpc('reorder_queue_item',{
        p_room_id:state.room.id,
        p_item_id:fromId,
        p_target_id:toId,
        p_expected_version:Number(state.queueVersion||0)
      });
      if(r.error)throw r.error;
      const payload=r.data&&Array.isArray(r.data)?r.data[0]:r.data;
      const queue=payload?.queue;
      if(!Array.isArray(queue))throw new Error('Invalid queue response from server.');
      state.queue=queue;
      state.queueVersion=Number(payload.queue_version||0);
      const serverCurrentIndex=state.room.current_video_id?state.queue.findIndex(x=>x.video_id===state.room.current_video_id):-1;
      const patch={current_index:serverCurrentIndex>=0?serverCurrentIndex:0,updated_at:new Date().toISOString(),queue_version:state.queueVersion};
      const rr=await getClient().from('rooms').update(patch).eq('id',state.room.id).select().single();
      if(!rr.error)state.room=rr.data;
      updateRoomView();
      await broadcast('queue',{queue:state.queue,queue_version:state.queueVersion});
      if(serverCurrentIndex>=0)await broadcast('room',{current_index:serverCurrentIndex,queue_version:state.queueVersion});
      return true;
    }catch(e){
      state.queue=previousQueue;
      state.room.current_index=previousIndex;
      updateRoomView();
      const msg=String(e?.message||e||'');
      if(/QUEUE_VERSION_CONFLICT|Queue changed by another user/i.test(msg)){
        await refreshQueue();
        const rr=await getClient().from('rooms').select('*').eq('id',state.room.id).single();
        if(!rr.error){state.room=rr.data;state.queueVersion=Number(rr.data.queue_version||0);updateRoomView();}
        notify('Queue changed by another user. Refreshed — please drag again.','error');
      }else notify(msg||'Could not reorder the shared queue.','error');
      return false;
    }finally{state.busy=false;}
  }
  async function reorderQueueByDrop(fromId,toId){
    const previousTopVideo=state.queue[0]?.video_id;
    const ok=await reorderSharedQueue(fromId,toId);
    const nextTop=state.queue[0];
    if(ok&&nextTop&&nextTop.video_id!==previousTopVideo&&nextTop.video_id!==state.room?.current_video_id)await playQueueItem(nextTop.id);
    return ok;
  }

  async function moveQueueItem(id,direction){
    if(state.busy)return;
    const index=state.queue.findIndex(x=>x.id===id);
    const targetIndex=index+direction;
    if(index<0||targetIndex<0||targetIndex>=state.queue.length)return;
    const targetId=state.queue[targetIndex].id;
    const list=document.getElementById('queueList');
    const before=captureDragRects(list);
    const previousQueue=state.queue.slice();
    const previousTopVideo=state.queue[0]?.video_id;
    [state.queue[index],state.queue[targetIndex]]=[state.queue[targetIndex],state.queue[index]];
    const ok=await reorderSharedQueue(id,targetId,{beforeRects:before,previousQueue,optimisticApplied:true});
    const nextTop=state.queue[0];
    if(ok&&nextTop&&nextTop.video_id!==previousTopVideo&&nextTop.video_id!==state.room?.current_video_id)await playQueueItem(nextTop.id);
  }

  async function shuffleQueue(){
    if(state.queue.length<2)return notify('Add at least two videos to shuffle.');
    if(state.busy)return;
    const current=state.room.current_video_id;
    const currentItem=state.queue.find(x=>x.video_id===current);
    let rest=state.queue.filter(x=>x.video_id!==current);
    for(let i=rest.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[rest[i],rest[j]]=[rest[j],rest[i]];}
    const ordered=currentItem?[currentItem,...rest]:rest;
    state.busy=true;
    try{
      const r=await getClient().rpc('shuffle_queue',{
        p_room_id:state.room.id,
        p_expected_version:Number(state.queueVersion||0),
        p_ordered_ids:ordered.map(x=>x.id)
      });
      if(r.error)throw r.error;
      const payload=r.data&&Array.isArray(r.data)?r.data[0]:r.data;
      if(!Array.isArray(payload?.queue))throw new Error('Invalid shuffle response from server.');
      state.queue=payload.queue;state.queueVersion=Number(payload.queue_version||0);
      const currentIndex=state.room.current_video_id?state.queue.findIndex(x=>x.video_id===state.room.current_video_id):-1;
      const rr=await getClient().from('rooms').update({current_index:currentIndex>=0?currentIndex:0,updated_at:new Date().toISOString(),queue_version:state.queueVersion}).eq('id',state.room.id).select().single();
      if(!rr.error)state.room=rr.data;
      updateRoomView();await broadcast('queue',{queue:state.queue,queue_version:state.queueVersion});
      notify('Queue shuffled for everyone');
    }catch(e){
      const msg=String(e?.message||e||'');
      if(/QUEUE_VERSION_CONFLICT|Queue changed by another user/i.test(msg)){
        await refreshQueue();const rr=await getClient().from('rooms').select('*').eq('id',state.room.id).single();
        if(!rr.error){state.room=rr.data;state.queueVersion=Number(rr.data.queue_version||0);updateRoomView();}
        notify('Queue changed by another user. Refreshed — please shuffle again.','error');
      }else notify(msg||'Could not shuffle the queue.','error');
    }finally{state.busy=false;}
  }

  function closeHostHandoffModal(){const el=document.getElementById('hostHandoffModal');if(el)el.remove();}
  async function completeHostHandoff(target){
    if(state.leaving||!state.isHost||!state.room||!state.me||!target)return false;
    state.leaving=true;
    try{
      const r=await getClient().from('rooms').update({host_id:target.user_id,updated_at:new Date().toISOString()}).eq('id',state.room.id).eq('host_id',state.me.user_id).select().single();
      if(r.error||!r.data)throw r.error||new Error('The host changed before handoff completed.');
      state.room=r.data;await broadcast('handoff_volume',{targetUserId:target.user_id,volume:state.hostVolume}).catch(()=>{});savePreviousRoom();
      try{if(state.player&&typeof state.player.stopVideo==='function')state.player.stopVideo();if(state.player&&typeof state.player.destroy==='function')state.player.destroy();}catch(_){}
      if(state.channel)try{await broadcast('participant_left',{participantId:state.me.id,name:state.me.name});}catch(_){}
      if(state.me?.id)await getClient().from('participants').delete().eq('id',state.me.id);
      if(state.channel)try{await getClient().removeChannel(state.channel);}catch(_){}
      clearRoomSession();closeHostHandoffModal();state.room=null;state.me=null;state.people=[];state.queue=[];state.channel=null;state.player=null;state.playerReady=false;state.isHost=false;state.chatMessages=[];state.privateList=[];state.pendingSwitchSession=null;state.leaving=false;renderHome();notify(target.name+' is now the host. You left the room.','info');return true;
    }catch(e){state.leaving=false;notify(e.message||'Could not transfer host.','error');return false;}
  }
  async function showHostHandoffModal(){
    const others=(state.people||[]).filter(p=>p.id!==state.me?.id&&p.user_id);
    if(!others.length)return leaveRoomNow();
    // A fullscreen player is in the browser's top layer and can sit above normal body overlays.
    // Exit fullscreen before creating the handoff modal so the dialog is always visible.
    if(document.fullscreenElement)try{await document.exitFullscreen();}catch(_){}
    await new Promise(resolve=>requestAnimationFrame(resolve));
    const back=document.createElement('div');back.className='modalback host-handoff-overlay';back.id='hostHandoffModal';
    const peopleHtml=others.map(p=>`<button class="btn host-handoff-person" type="button" data-host-person="${esc(p.id)}"><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}</button>`).join('');
    back.innerHTML=`<div class="modal host-handoff-modal"><div class="brand">ALAMKAROK</div><div class="small">Room ${esc(state.room.code)}</div><h2>Host Handoff</h2><p class="sub">Choose who should become the new host before you leave.</p><div class="modalactions"><button class="btn" id="hostRandom">🎲 Random Person</button><button class="btn primary" id="hostSelect">Select Person</button></div><div id="hostPersonPicker" class="host-person-picker" hidden><div class="small">Select the new host:</div><div class="host-person-list">${peopleHtml}</div></div><div class="modalactions"><button class="btn" id="hostHandoffCancel">Cancel</button></div></div>`;
    document.body.appendChild(back);const picker=back.querySelector('#hostPersonPicker');
    back.querySelector('#hostHandoffCancel').onclick=closeHostHandoffModal;
    back.querySelector('#hostSelect').onclick=()=>{picker.hidden=!picker.hidden;};
    back.querySelector('#hostRandom').onclick=()=>completeHostHandoff(others[Math.floor(Math.random()*others.length)]);
    back.querySelectorAll('[data-host-person]').forEach(b=>b.onclick=()=>completeHostHandoff(others.find(p=>p.id===b.dataset.hostPerson)));
  }
  let hostLeavePromptTimer=null;
  async function handleHostPresenceLeave(leftPresences){
    if(state.leaving||state.isHost||!state.room||!state.me||!Array.isArray(leftPresences))return;
    const departedHostId=state.room.host_id;
    if(!departedHostId||!leftPresences.some(p=>p&&p.userId===departedHostId))return;
    if(hostLeavePromptTimer)clearTimeout(hostLeavePromptTimer);
    hostLeavePromptTimer=setTimeout(async()=>{
      hostLeavePromptTimer=null;
      if(state.leaving||state.isHost||!state.room||!state.me||state.room.host_id!==departedHostId)return;
      try{
        const r=await getClient().from('rooms').select('*').eq('id',state.room.id).single();
        if(r.error||!r.data||r.data.host_id!==departedHostId)return;
        state.room=r.data;
        const presence=state.channel?.presenceState?.()||{};
        const hostStillPresent=Object.values(presence).flat().some(p=>p&&p.userId===departedHostId);
        if(hostStillPresent)return;
        showHostTakeoverModal(departedHostId);
      }catch(_){}
    },2500);
  }
  function closeHostTakeoverModal(){const el=document.getElementById('hostTakeoverModal');if(el)el.remove();}
  function showHostTakeoverModal(departedHostId){
    if(state.isHost||!state.room||!state.me||document.getElementById('hostTakeoverModal'))return;
    const back=document.createElement('div');
    back.className='modalback host-handoff-overlay';
    back.id='hostTakeoverModal';
    back.innerHTML=`<div class="modal host-handoff-modal"><div class="brand">ALAMKAROK</div><div class="small">Room ${esc(state.room.code)}</div><h2>Host Disconnected</h2><p class="sub">The host appears to have left the room. Become the new host to keep playback controls available?</p><div class="modalactions"><button class="btn" id="hostTakeoverLater" type="button">Not Now</button><button class="btn primary" id="hostTakeoverNow" type="button">Become Host</button></div><div class="small" id="hostTakeoverStatus" aria-live="polite"></div></div>`;
    document.body.appendChild(back);
    back.querySelector('#hostTakeoverLater').onclick=closeHostTakeoverModal;
    back.querySelector('#hostTakeoverNow').onclick=()=>takeOverDisconnectedHost(departedHostId);
  }
  async function takeOverDisconnectedHost(departedHostId){
    if(state.leaving||state.isHost||!state.room||!state.me||!state.me.user_id)return;
    const back=document.getElementById('hostTakeoverModal');
    const button=back?.querySelector('#hostTakeoverNow');
    const status=back?.querySelector('#hostTakeoverStatus');
    if(button){button.disabled=true;button.textContent='Taking over…';}
    if(status)status.textContent='Checking room ownership…';
    try{
      const r=await getClient().from('rooms').update({host_id:state.me.user_id,updated_at:new Date().toISOString()}).eq('id',state.room.id).eq('host_id',departedHostId).select().single();
      if(r.error||!r.data)throw r.error||new Error('Another participant may already have taken over.');
      state.room=r.data;
      state.isHost=true;
      saveRoomSession();
      closeHostTakeoverModal();
      updateRoomView();
      try{await state.channel?.track({participantId:state.me.id,userId:state.me.user_id,name:state.me.name});}catch(_){}
      try{await broadcast('room',{host_id:state.me.user_id,updated_at:state.room.updated_at});}catch(_){}
      try{await getClient().from('participants').delete().eq('room_id',state.room.id).eq('user_id',departedHostId);}catch(_){}
      await refreshPeople();
      if(state.room.current_video_id)loadYouTubeAPI();
      notify('You are now the host. Playback controls are yours.','info');
    }catch(e){
      if(button){button.disabled=false;button.textContent='Try Again';}
      if(status)status.textContent='Could not take over automatically. The room permissions may need an update.';
      notify(e?.message||'Could not take over hosting.','error');
    }
  }
  async function leaveRoomNow(){
    state.leaving=true;if(state.reconnectTimer){clearTimeout(state.reconnectTimer);state.reconnectTimer=null;}
    try{if(state.player&&typeof state.player.stopVideo==='function')state.player.stopVideo();if(state.player&&typeof state.player.destroy==='function')state.player.destroy();}catch(_){}
    try{if(state.channel)await broadcast('participant_left',{participantId:state.me.id,name:state.me.name});}catch(_){}
    try{if(state.me?.id)await getClient().from('participants').delete().eq('id',state.me.id);}catch(_){}
    try{if(state.channel)await getClient().removeChannel(state.channel);}catch(_){}
    savePreviousRoom();clearRoomSession();state.room=null;state.me=null;state.people=[];state.queue=[];state.channel=null;state.player=null;state.playerReady=false;state.isHost=false;state.chatMessages=[];state.privateList=[];state.pendingSwitchSession=null;state.leaving=false;renderHome();notify('You left the room.','info');
  }
  async function leaveRoom(){
    if(state.leaving||!state.room||!state.me)return;
    if(!window.confirm(`Leave room ${state.room.code}?`))return;
    if(state.isHost&&(state.people||[]).some(p=>p.id!==state.me.id)){showHostHandoffModal();return;}
    await leaveRoomNow();
  }

  function roomVolumeKey(){return state.room?.id?'alamkarok-host-volume-'+state.room.id:null;}
  function loadStoredHostVolume(){try{const raw=roomVolumeKey()?localStorage.getItem(roomVolumeKey()):null;const v=Number(raw);if(Number.isFinite(v))state.hostVolume=Math.max(0,Math.min(100,v));}catch(_){}}
  function storeHostVolume(v){try{const k=roomVolumeKey();if(k)localStorage.setItem(k,String(v));}catch(_){} state.hostVolume=v;}
  function applyHostVolume(v){const volume=Math.max(0,Math.min(100,Number(v)||0));storeHostVolume(volume);const input=document.getElementById('volume');const label=document.getElementById('volumeValue');if(input)input.value=String(volume);if(label)label.textContent=volume+'%';if(state.isHost&&state.playerReady&&state.player)try{state.player.setVolume(volume);if(volume===0)state.player.mute();else state.player.unMute();}catch(_){} }
  function handleVolumeBroadcast(payload){if(!payload||payload.targetHostId!==state.room?.host_id)return;const v=Number(payload.volume);if(!Number.isFinite(v))return;applyHostVolume(v);}
  function handleHandoffVolume(payload){if(!payload||payload.targetUserId!==state.me?.user_id)return;const v=Number(payload.volume);if(!Number.isFinite(v))return;applyHostVolume(v);}

  function bindRoomControls(){
    const leaveBtn=document.getElementById('leaveRoom');if(leaveBtn)leaveBtn.onclick=leaveRoom;
    document.getElementById('togglePrivate').onclick=()=>toggleListSection('private');document.getElementById('toggleShared').onclick=()=>toggleListSection('shared');document.getElementById('add').onclick=addLink;document.getElementById('shuffle').onclick=shuffleQueue;const privateAddBtn=document.getElementById('privateAdd'); if(privateAddBtn) privateAddBtn.onclick=(e)=>{e.preventDefault();addPrivateInput();};document.getElementById('privateSelectAll').onclick=selectAllPrivate;const storedListsBtn=document.getElementById('storedLists');if(storedListsBtn)storedListsBtn.onclick=openStoredLists;document.getElementById('uploadSelected').onclick=()=>uploadPrivate(false);document.getElementById('uploadAll').onclick=()=>uploadPrivate(true);document.getElementById('prev').onclick=()=>sendCommand('previous');document.getElementById('next').onclick=()=>sendCommand('next');document.getElementById('play').onclick=()=>sendCommand(state.room.is_playing?'pause':'play');document.getElementById('showQr').onclick=showQrModal;const chatSend=document.getElementById('roomChatSend');if(chatSend)chatSend.onclick=sendChat;const chatInput=document.getElementById('roomChatInput');if(chatInput)chatInput.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();}});document.querySelectorAll('[data-emoji]').forEach(b=>b.onclick=()=>addEmoji(b.dataset.emoji));bindPointButtons();renderChatMessages();const fs=document.getElementById('fullscreenBtn');if(fs)fs.onclick=togglePlayerFullscreen;const guestNextToggle=document.getElementById('guestNextUpToggle');if(guestNextToggle)guestNextToggle.onclick=()=>{const panel=document.getElementById('guestNextUpPanel');if(!panel)return;const open=panel.hidden;panel.hidden=!open;guestNextToggle.setAttribute('aria-expanded',open?'true':'false');guestNextToggle.innerHTML=open?'HIDE <span>⌃</span>':'NEXT UP <span>⌄</span>';if(open)updateEndPreview();};const previewTab=document.getElementById('endPreviewTab');if(previewTab)previewTab.onclick=()=>{const open=document.getElementById('endPreview')?.classList.contains('show');if(open)hideEndPreview();else{state.endPreviewItems=null;updateEndPreview();setEndPreviewOpen(true,false);}};const vol=document.getElementById('volume');if(vol){vol.value=String(state.hostVolume);vol.oninput=()=>{const v=Math.max(0,Math.min(100,Number(vol.value)||0));applyHostVolume(v);broadcast('volume',{from:state.me.id,targetHostId:state.room.host_id,volume:v}).catch(()=>{});};}
    document.getElementById('url').addEventListener('keydown',e=>{if(e.key==='Enter')addLink();});
    document.getElementById('privateUrl').addEventListener('keydown',e=>{if(e.key==='Enter')addPrivateInput();});
    document.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>removeItem(b.dataset.del));document.querySelectorAll('[data-play]').forEach(b=>b.onclick=()=>playQueueItem(b.dataset.play));document.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>moveQueueItem(b.dataset.up,-1));document.querySelectorAll('[data-down]').forEach(b=>b.onclick=()=>moveQueueItem(b.dataset.down,1));
    document.querySelectorAll('#prev,#play,#next').forEach(b=>{b.addEventListener('pointerdown',()=>{b.classList.add('control-pressing');if(navigator.vibrate)try{navigator.vibrate(8);}catch(_){}},{passive:true});['pointerup','pointercancel','pointerleave'].forEach(ev=>b.addEventListener(ev,()=>b.classList.remove('control-pressing'),{passive:true}));});
    const qr=document.getElementById('qr'); if(window.QRCode){new QRCode(qr,{text:roomUrl(state.room.code),width:150,height:150});} else qr.innerHTML='<div class="small qrtext">QR library unavailable.<br>Use the link below.</div>';
    bindDragAndDrop(document);
  }
  function showQrModal(){const back=document.createElement('div');back.className='modalback';back.innerHTML=`<div class="modal center"><div class="brand">ALAMKAROK</div><h2>Join Room</h2><div id="modalQr" class="qr"></div><div class="code">${esc(state.room.code)}</div><div class="linkbox">${esc(roomUrl(state.room.code))}</div><button class="btn primary wide" id="closeQr">Close</button></div>`;document.body.appendChild(back);if(window.QRCode)new QRCode(document.getElementById('modalQr'),{text:roomUrl(state.room.code),width:220,height:220});back.querySelector('#closeQr').onclick=()=>back.remove();}
  function personName(id){const p=state.people.find(x=>x.id===id);return p?p.name:'Unknown';}

  function renderPrivateList(){
    const list=document.getElementById('privateList'); if(!list)return;
    if(!state.privateList.length){ list.innerHTML='<div class="empty">Your private list is empty.</div>'; return; }
    const groups=[]; const seen=new Map();
    state.privateList.forEach((x,i)=>{
      const key=x.playlist_id?`playlist:${x.playlist_id}`:`single:${i}`;
      if(!seen.has(key)){ const g={key,playlistId:x.playlist_id||null,title:x.playlist_title||'Individual Videos',items:[]}; seen.set(key,g);groups.push(g); }
      seen.get(key).items.push({x,i});
    });
    const itemHtml=({x,i})=>`<div class="qitem private-item" draggable="false" data-drag-type="private" data-drag-id="${esc(x.id)}"><input class="private-check" type="checkbox" data-private-check="${esc(x.id)}" ${x.selected?'checked':''} aria-label="Select ${esc(x.title)}"><div class="qnum drag-handle" title="Drag to reorder">⠿<span>${i+1}</span></div><img class="thumb" src="${esc(x.thumbnail||ytThumb(x.video_id))}" alt=""><div class="min0"><div class="qtitle">${esc(x.title||'YouTube video')}</div><div class="meta">${x.playlist_id?'Playlist · ':''}Private · not uploaded</div></div><div class="actions queue-actions"><button class="action-sm move-btn" data-private-up="${esc(x.id)}" ${i===0?'disabled':''}>↑</button><button class="action-sm move-btn" data-private-down="${esc(x.id)}" ${i===state.privateList.length-1?'disabled':''}>↓</button><button class="action-sm private-upload-btn" data-private-upload="${esc(x.id)}" title="Upload this video to Shared Queue" aria-label="Upload this video">Upload</button><button class="action-sm danger-sm" data-private-del="${esc(x.id)}">×</button></div></div>`;
    list.innerHTML=groups.map(g=>{
      if(!g.playlistId) return g.items.map(itemHtml).join('');
      const collapsed=!!state.playlistCollapsed[g.playlistId];
      return `<div class="playlist-subsection ${collapsed?'is-collapsed':''}"><button class="playlist-subhead" data-playlist-toggle="${esc(g.playlistId)}" aria-expanded="${collapsed?'false':'true'}"><span class="playlist-subtitle">${esc(g.title)}</span><span class="playlist-count">${g.items.length} video${g.items.length===1?'':'s'}</span><span class="playlist-chevron">${collapsed?'▼':'▲'}</span></button><div class="playlist-subbody ${collapsed?'collapsed':''}">${g.items.map(itemHtml).join('')}</div></div>`;
    }).join('');
    list.querySelectorAll('[data-playlist-toggle]').forEach(b=>b.onclick=()=>togglePlaylistGroup(b.dataset.playlistToggle));
    list.querySelectorAll('[data-private-check]').forEach(b=>b.onchange=()=>{const x=state.privateList.find(x=>x.id===b.dataset.privateCheck);if(x){x.selected=b.checked;savePrivateList();}});
    list.querySelectorAll('[data-private-upload]').forEach(b=>b.onclick=()=>uploadPrivateOne(b.dataset.privateUpload));
    list.querySelectorAll('[data-private-up]').forEach(b=>b.onclick=()=>movePrivate(b.dataset.privateUp,-1));
    list.querySelectorAll('[data-private-down]').forEach(b=>b.onclick=()=>movePrivate(b.dataset.privateDown,1));
    list.querySelectorAll('[data-private-del]').forEach(b=>b.onclick=()=>deletePrivate(b.dataset.privateDel));
    bindDragAndDrop(document);
    updateVideoListScrollState();
    bindMobilePinchCollapse();
  }
  function selectAllPrivate(){ const all=state.privateList.length>0 && state.privateList.every(x=>x.selected); state.privateList.forEach(x=>x.selected=!all); savePrivateList(); renderPrivateList(); }
  function movePrivate(id,direction){
    const i=state.privateList.findIndex(x=>x.id===id), j=i+direction;
    if(i<0||j<0||j>=state.privateList.length)return;
    const list=document.getElementById('privateList'),before=captureDragRects(list);
    [state.privateList[i],state.privateList[j]]=[state.privateList[j],state.privateList[i]];
    savePrivateList();renderPrivateList();
    requestAnimationFrame(()=>requestAnimationFrame(()=>animateListReorder(document.getElementById('privateList'),before)));
  }

  async function uploadPrivateOne(id){const item=state.privateList.find(x=>x.id===id);if(!item)return;await uploadPrivateItems([item]);}
  function deletePrivate(id){ state.privateList=state.privateList.filter(x=>x.id!==id);savePrivateList();renderPrivateList(); }
  async function addPrivateInput(){
    if(state.privateBusy)return;
    const input=document.getElementById('privateUrl');
    const value=(input?.value||'').trim();
    if(!value)return notify('Paste a YouTube video or playlist link.','error');
    const listId=playlistId(value);
    if(listId){
      input.value='';
      try{ await importYouTubePlaylist(listId); }catch(e){ notify(e.message||'Could not import playlist','error'); }
      return;
    }
    const id=ytId(value);
    if(!id)return notify('Enter a valid YouTube video link.','error');
    if(state.privateList.some(x=>x.video_id===id))return notify('That video is already in your private list.','info');
    const playable=await checkVideoEmbeddable(id);
    if(playable===false)return notify('This YouTube video is unavailable or does not allow embedding. It was not added to My List.','error');
    const item={id:privateItemId(),video_id:id,title:'YouTube video',thumbnail:ytThumb(id),selected:false};
    state.privateList.push(item);
    savePrivateList();
    if(input)input.value='';
    renderPrivateList();
    notify('Added to My List');
    videoTitle(id).then(title=>{
      const found=state.privateList.find(x=>x.id===item.id);
      if(found&&title&&title!=='YouTube video'){found.title=title;savePrivateList();renderPrivateList();}
    }).catch(()=>{});
  }
  async function importYouTubePlaylist(listId){
    const key=String(cfg.YOUTUBE_API_KEY||'').trim();
    if(!key)throw new Error('Playlist import needs a YouTube Data API key. Add YOUTUBE_API_KEY to config.js. Single videos work without it.');
    let playlistTitle='Imported YouTube Playlist';
    try{ const pr=await fetch(`https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${encodeURIComponent(listId)}&key=${encodeURIComponent(key)}`); const pj=await pr.json(); if(pr.ok&&pj.items?.[0]?.snippet?.title) playlistTitle=pj.items[0].snippet.title; }catch(_){}
    let pageToken=''; let added=0;
    do{
      const url=`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${encodeURIComponent(listId)}&key=${encodeURIComponent(key)}${pageToken?`&pageToken=${encodeURIComponent(pageToken)}`:''}`;
      const r=await fetch(url); const j=await r.json(); if(!r.ok)throw new Error(j.error?.message||'Could not import the YouTube playlist.');
      for(const item of (j.items||[])){ const id=item.snippet?.resourceId?.videoId; if(!id||state.privateList.some(x=>x.video_id===id))continue; state.privateList.push({id:privateItemId(),video_id:id,title:item.snippet?.title||'YouTube video',thumbnail:item.snippet?.thumbnails?.medium?.url||ytThumb(id),selected:false,playlist_id:listId,playlist_title:playlistTitle});added++; }
      pageToken=j.nextPageToken||''; savePrivateList(); renderPrivateList();
    }while(pageToken);
    const importedItems=state.privateList.filter(x=>x.playlist_id===listId);
    if(importedItems.length)saveStoredPlaylist(playlistTitle,importedItems);
    notify(added?`Imported ${added} video${added===1?'':'s'} into “${playlistTitle}”`:'No new videos found.','info');
  }
  function uploadPrivate(all){
    const items=all?state.privateList.filter(Boolean):state.privateList.filter(x=>x.selected); if(!items.length)return notify(all?'Your private list is empty.':'Select at least one video.','error');
    uploadPrivateItems(items);
  }
  async function uploadPrivateItems(items){
    if(state.privateBusy)return; state.privateBusy=true;
    try{
      const start=state.queue.length?Math.max(...state.queue.map(x=>x.position))+1:0;
      const rows=items.map((x,i)=>({room_id:state.room.id,video_id:x.video_id,title:x.title||'YouTube video',thumbnail:x.thumbnail||ytThumb(x.video_id),added_by:state.me.id,position:start+i}));
      const r=await getClient().from('queue_items').insert(rows).select(); if(r.error)throw r.error;
      const ids=new Set(items.map(x=>x.id)); state.privateList=state.privateList.map(x=>ids.has(x.id)?{...x,selected:false}:x);savePrivateList();await refreshQueue();await broadcast('queue',{queue:state.queue});
      if(state.isHost&&!state.room.current_video_id&&r.data?.[0])await performPlayback('load',r.data[0].video_id,0,true);
      notify(`${items.length} video${items.length===1?'':'s'} added to the shared queue`);
    }catch(e){notify(e.message||'Could not upload videos to the shared queue','error');}finally{state.privateBusy=false;}
  }

  async function addLink(){if(state.busy)return;const input=document.getElementById('url');const id=ytId(input.value.trim());if(!id)return notify('Enter a valid YouTube link.','error');state.busy=true;try{const playable=await checkVideoEmbeddable(id);if(playable===false){notify('This YouTube video is unavailable or does not allow embedding. It was not added.','error');return;}let title=await videoTitle(id);const pos=state.queue.length?Math.max(...state.queue.map(x=>x.position))+1:0;const r=await getClient().from('queue_items').insert({room_id:state.room.id,video_id:id,title,thumbnail:ytThumb(id),added_by:state.me.id,position:pos}).select().single();if(r.error)throw r.error;input.value='';await refreshQueue();await broadcast('queue',{queue:state.queue});if(state.isHost&&!state.room.current_video_id)await performPlayback('load',id,0,true);notify(playable===null?'Added to Shared Queue (could not pre-check embed permission).':'Added to the shared queue');}catch(e){notify(e.message||'Could not add video','error');}finally{state.busy=false;}}
  const deletingQueueItems=new Set();
  async function removeItem(id){
    if(deletingQueueItems.has(id))return;
    const index=state.queue.findIndex(x=>x.id===id);
    if(index<0)return;
    const item=state.queue[index];
    const wasCurrent=item.video_id===state.room.current_video_id;
    const previousQueue=state.queue.slice();
    deletingQueueItems.add(id);
    state.queue=state.queue.filter(x=>x.id!==id);
    updateRoomView();
    try{
      const r=await getClient().from('queue_items').delete().eq('id',id);
      if(r.error)throw r.error;
      for(let i=0;i<state.queue.length;i++){
        const pr=await getClient().from('queue_items').update({position:i}).eq('id',state.queue[i].id);
        if(pr.error)throw pr.error;
      }
      await refreshQueue();
      if(wasCurrent){
        const next=state.queue[Math.min(index,state.queue.length-1)]||state.queue[0];
        if(next)await performPlayback('load',next.video_id,0,true);
        else{
          const patch={current_video_id:null,current_index:0,is_playing:false,position_seconds:0,updated_at:new Date().toISOString()};
          const rr=await getClient().from('rooms').update(patch).eq('id',state.room.id).select().single();
          if(!rr.error)state.room=rr.data;
          updateRoomView();await broadcast('room',patch);
          if(state.isHost&&state.player){try{state.player.stopVideo();}catch(_){}}
        }
      }
      await broadcast('queue',{queue:state.queue});
      notify('Video removed');
    }catch(e){
      state.queue=previousQueue;
      updateRoomView();
      notify(e.message||'Could not remove video.','error');
    }finally{deletingQueueItems.delete(id);}
  }
  async function normalizePositions(){for(let i=0;i<state.queue.length;i++){const r=await getClient().from('queue_items').update({position:i}).eq('id',state.queue[i].id);if(r.error)break;}}
  function resetPlaybackTiming(){state.playbackStartedAt=0;state.playbackPlayedSeconds=0;}
  function finalizePlaybackTiming(){
    if(state.playbackStartedAt){state.playbackPlayedSeconds+=Math.max(0,(Date.now()-state.playbackStartedAt)/1000);state.playbackStartedAt=0;}
    return Number(state.playbackPlayedSeconds||0);
  }
  function startPlaybackTiming(){if(!state.playbackStartedAt)state.playbackStartedAt=Date.now();}
  async function moveCurrentForInterruption(){
    const currentId=state.room?.current_video_id;
    // Resolve the current song by ID first; current_index can be stale after a queue mutation.
    const foundIndex=state.queue.findIndex(x=>x.video_id===currentId);
    const idx=foundIndex>=0?foundIndex:(Number.isInteger(state.room?.current_index)?state.room.current_index:-1);
    const current=idx>=0?state.queue[idx]:null;
    if(!current)return;
    const playedSeconds=finalizePlaybackTiming();
    if(playedSeconds>30){
      const r=await getClient().from('queue_items').delete().eq('id',current.id);
      if(r.error)throw r.error;
      await refreshQueue();await normalizePositions();await refreshQueue();
    }else{
      const last=state.queue[state.queue.length-1];
      if(last&&last.id!==current.id){
        // reorder_queue_item inserts BEFORE its target. Move the old last item
        // before the interrupted song on a second transaction so the interrupted
        // song truly ends up at the bottom, not second-to-last.
        const moved=await reorderSharedQueue(current.id,last.id);
        if(moved){
          const refreshedLast=state.queue[state.queue.length-1];
          if(refreshedLast&&refreshedLast.id!==current.id)await reorderSharedQueue(refreshedLast.id,current.id);
        }
        await refreshQueue();
      }
    }
    await broadcast('queue',{queue:state.queue,queue_version:state.queueVersion});
  }
  async function playQueueItem(id){
    const item=state.queue.find(x=>x.id===id);if(!item)return;
    if(!state.isHost){
      await broadcast('command',{from:state.me.id,action:'load',videoId:item.video_id});
      return;
    }
    if(item.video_id!==state.room?.current_video_id){
      await moveCurrentForInterruption();
      await refreshQueue();
      const selected=state.queue.find(x=>x.id===id);if(!selected)return;
      if(state.queue[0]?.id!==selected.id){await reorderSharedQueue(selected.id,state.queue[0].id);await refreshQueue();}
    }
    resetPlaybackTiming();
    const selected=state.queue.find(x=>x.id===id);
    if(selected)await performPlayback('load',selected.video_id,0,true);
  }
  async function advanceAfterEnd(){
    if(!state.isHost)return;

    // A played item is consumed only from the Shared Queue.
    // My List is private/local and is never modified here.
    const idx=Number.isInteger(state.room.current_index)?state.room.current_index:state.queue.findIndex(x=>x.video_id===state.room.current_video_id);
    const played=idx>=0?state.queue[idx]:null;
    if(played){
      const r=await getClient().from('queue_items').delete().eq('id',played.id);
      if(r.error){
        notify(r.error.message||'Could not remove the played video from the shared queue','error');
        return;
      }
      await refreshQueue();
      await normalizePositions();
      await refreshQueue();
      await broadcast('queue',{queue:state.queue});
    }

    // After consuming the current item, the next item now occupies the same index.
    const nextIndex=Math.max(0,idx);
    const next=state.queue[nextIndex];
    if(next){
      await performPlayback('load',next.video_id,0,true,true);
      notify('Autoplay: next video');
    }else{
      const patch={current_video_id:null,current_index:0,is_playing:false,position_seconds:0,updated_at:new Date().toISOString()};
      const r=await getClient().from('rooms').update(patch).eq('id',state.room.id).select().single();
      if(!r.error)state.room=r.data;
      updateRoomView();
      await broadcast('room',patch);
      if(state.player){try{state.player.stopVideo();}catch(_){}}
      notify('Queue finished');
    }
  }
  function pulsePlaybackControl(id){const btn=document.getElementById(id);if(!btn)return;btn.classList.remove('command-pulse');void btn.offsetWidth;btn.classList.add('command-pulse');setTimeout(()=>btn.classList.remove('command-pulse'),180);}
  function updatePlaybackControlsUI(){
    const play=document.getElementById('play');
    if(play)play.textContent=state.room?.is_playing?'❚❚':'▶';
    const stateEl=document.getElementById('playState');
    if(stateEl)stateEl.textContent=(state.room?.is_playing?'Playing':'Paused')+' · '+(state.room?.current_video_id?'Video selected':'No video selected');
  }
  function applyOptimisticPlaybackCommand(action){
    if(!state.room)return;
    if(action==='play'||action==='pause'){
      state.room.is_playing=action==='play';
      state.room.position_seconds=Number(state.room.position_seconds||0);
    }else if(action==='next'||action==='previous'){
      const idx=Number.isInteger(state.room.current_index)?state.room.current_index:state.queue.findIndex(x=>x.video_id===state.room.current_video_id);
      const targetIdx=action==='next'?Math.min(state.queue.length-1,idx+1):Math.max(0,idx-1);
      const target=state.queue[targetIdx];
      if(target){
        state.room.current_index=targetIdx;
        state.room.current_video_id=target.video_id;
        state.room.position_seconds=0;
        state.room.is_playing=true;
      }
    }
    updatePlaybackControlsUI();
  }

  async function sendCommand(action){
    if(!state.room||!state.me)return;
    pulsePlaybackControl(action==='play'||action==='pause'?'play':action==='previous'?'prev':'next');
    // Guests get immediate local feedback, while the host remains authoritative.
    // The host must not optimistically mutate current_index before handling the command,
    // otherwise Next/Previous would advance twice.
    if(!state.isHost)applyOptimisticPlaybackCommand(action);
    const payload={from:state.me.id,action};
    broadcast('command',payload).catch(()=>{});
    if(state.isHost)await handleCommandBroadcast(payload);
  }

  async function handleCommandBroadcast(payload){
    if(!payload||payload.from===state.me.id && !state.isHost)return;
    if(!state.isHost)return;
    if(payload.action==='play'||payload.action==='pause'){await performPlayback(payload.action,null,currentTime(),payload.action==='play');return;}
    if(payload.action==='load'&&payload.videoId){
      const requestedId=payload.videoId;
      const queuedBefore=state.queue.some(x=>x.video_id===requestedId);
      if(!queuedBefore){notify('That video is no longer in Shared Queue.','error');await refreshQueue();return;}
      if(requestedId!==state.room.current_video_id){
        await moveCurrentForInterruption();
        await refreshQueue();
        const selected=state.queue.find(x=>x.video_id===requestedId);
        if(!selected){notify('That video was removed from Shared Queue.','error');return;}
        // Participant and host Play requests follow the same rule: selected song goes to top.
        if(state.queue[0]?.id!==selected.id){
          const moved=await reorderSharedQueue(selected.id,state.queue[0].id);
          if(!moved){await refreshQueue();notify('Queue changed while selecting that song. Please press Play again.','error');return;}
          await refreshQueue();
        }
      }
      const selected=state.queue.find(x=>x.video_id===requestedId);
      if(!selected){notify('That video is no longer in Shared Queue.','error');return;}
      resetPlaybackTiming();
      await performPlayback('load',selected.video_id,0,true);
      return;
    }
    if(payload.action!=='next'&&payload.action!=='previous')return;
    const currentId=state.room?.current_video_id;
    const foundIndex=state.queue.findIndex(x=>x.video_id===currentId);
    const originalIndex=foundIndex>=0?foundIndex:(Number.isInteger(state.room.current_index)?state.room.current_index:0);
    // Previous at the beginning should not move the current song or jump to another item.
    if(payload.action==='previous'&&originalIndex<=0)return;
    if(currentId&&foundIndex>=0)await moveCurrentForInterruption();
    await refreshQueue();
    // Whether the interrupted song is removed (>30s) or moved to the end (<=30s),
    // the next song shifts into the old current index. Previous remains at index - 1.
    const targetIndex=payload.action==='next'
      ?Math.min(Math.max(0,originalIndex),state.queue.length-1)
      :Math.max(0,originalIndex-1);
    const target=state.queue[targetIndex];
    // If the current song was already last and was moved to the end, there is no next song.
    if(target&&target.video_id!==currentId)await performPlayback('load',target.video_id,0,true);
  }
  function currentTime(){try{return state.playerReady?state.player.getCurrentTime():Number(state.room.position_seconds||0);}catch(_){return Number(state.room.position_seconds||0);}}
  async function performPlayback(action,videoId,position=0,playing=false,preservePreview=false){
    if(action==='load'){resetPlaybackTiming();const idx=state.queue.findIndex(x=>x.video_id===videoId);const patch={current_video_id:videoId,current_index:idx<0?0:idx,is_playing:playing,position_seconds:position};const r=await getClient().from('rooms').update({...patch,updated_at:new Date().toISOString()}).eq('id',state.room.id).select().single();if(!r.error)state.room=r.data;updateRoomView();if(state.isHost)loadVideo(videoId,position,playing,preservePreview);await broadcast('room',patch);return;}
    const playingNow=action==='play';const pos=position;const patch={is_playing:playingNow,position_seconds:pos,updated_at:new Date().toISOString()};const r=await getClient().from('rooms').update(patch).eq('id',state.room.id).select().single();if(!r.error)state.room=r.data;updateRoomView();if(state.isHost)applyLocalPlay(playingNow);await broadcast('room',patch);
  }

  let endPreviewTimer=null;
  function getEndPreviewItems(){
    const currentId=state.room?.current_video_id;
    // NEXT UP mirrors the Shared Queue, excluding the current song wherever it sits.
    // This keeps the preview useful even if the current item was moved to the end.
    return state.queue.filter(x=>!currentId||x.video_id!==currentId);
  }
  function updateEndPreview(){
    const current=state.queue.find(x=>x.video_id===state.room?.current_video_id);
    const title=current?(current.title||'YouTube video'):'Nothing playing';
    const remaining=getEndPreviewItems();
    const currentTitle=document.getElementById('endPreviewCurrentTitle');
    const list=document.getElementById('endPreviewList');
    const count=document.getElementById('endPreviewCount');
    if(currentTitle)currentTitle.textContent=title;
    if(list)list.innerHTML=remaining.slice(0,8).map((x,i)=>`<div class="end-preview-item"><span>${i+1}</span><span>${esc(x.title||'YouTube video')}</span></div>`).join('');
    if(count)count.textContent=remaining.length===0?'No upcoming songs':`${remaining.length} remaining`;
    const guestTitle=document.getElementById('guestCurrentTitle');
    const guestList=document.getElementById('guestNextUpList');
    const guestCount=document.getElementById('guestNextUpCount');
    if(guestTitle)guestTitle.textContent=title;
    if(guestList)guestList.innerHTML=remaining.slice(0,8).map((x,i)=>`<div class="guest-next-up-item"><span>${i+1}</span><span>${esc(x.title||'YouTube video')}</span></div>`).join('');
    if(guestCount)guestCount.textContent=remaining.length===0?'No upcoming songs':`${remaining.length} songs in queue`;
  }
  function setEndPreviewOpen(open,autoClose=false){
    const panel=document.getElementById('endPreview');
    const tab=document.getElementById('endPreviewTab');
    if(!panel||!tab)return;
    panel.classList.toggle('show',open);
    panel.setAttribute('aria-hidden',open?'false':'true');
    tab.setAttribute('aria-expanded',open?'true':'false');
    clearTimeout(endPreviewTimer);
    if(open&&autoClose)endPreviewTimer=setTimeout(()=>setEndPreviewOpen(false),25000);
  }
  function showEndPreview(){
    updateEndPreview();
    setEndPreviewOpen(true,true);
  }
  function hideEndPreview(){
    state.endPreviewItems=null;
    setEndPreviewOpen(false);
  }
  async function togglePlayerFullscreen(){
    const card=document.querySelector('.player-card');
    if(!card||!state.isHost)return;
    try{
      if(document.fullscreenElement){await document.exitFullscreen();}
      else await card.requestFullscreen();
    }catch(e){notify('Fullscreen is not available in this browser.','info');}
  }
  document.addEventListener('fullscreenchange',()=>{
    const card=document.querySelector('.player-card');
    const btn=document.getElementById('fullscreenBtn');
    if(!card||!btn)return;
    const active=document.fullscreenElement===card;
    card.classList.toggle('is-fullscreen',active);
    btn.textContent=active?'⛶':'⛶';
    btn.title=active?'Exit fullscreen':'Fullscreen';
    btn.setAttribute('aria-label',active?'Exit fullscreen':'Fullscreen');
  });

  function loadYouTubeAPI(){
    if(!state.isHost)return;
    if(state.ytReady&&window.YT&&window.YT.Player){ensureYouTubePlayer();return;}
    if(state.ytLoading)return;
    if(window.YT&&window.YT.Player){state.ytReady=true;ensureYouTubePlayer();return;}
    state.ytLoading=true;
    const previous=window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady=()=>{
      state.ytLoading=false;state.ytReady=!!(window.YT&&window.YT.Player);
      if(state.ytReady)ensureYouTubePlayer();else notify('YouTube API loaded but the player is unavailable.','error');
      if(typeof previous==='function')try{previous();}catch(_){ }
    };
    const script=document.createElement('script');
    script.src='https://www.youtube.com/iframe_api';
    script.async=true;
    script.onerror=()=>{state.ytLoading=false;notify('Could not load YouTube. Check that YouTube is reachable on this device.','error');};
    document.head.appendChild(script);
    setTimeout(()=>{if(state.ytLoading){state.ytLoading=false;notify('YouTube is taking too long to load. Reload and try again.','error');}},12000);
  }

  function ensureYouTubePlayer(){
    if(!state.isHost||!state.room?.current_video_id)return;
    if(!(window.YT&&window.YT.Player)){loadYouTubeAPI();return;}
    state.ytReady=true;
    const holder=document.getElementById('player');
    if(!holder)return;
    if(state.playerReady&&state.player)return;
    // If a YouTube player is still initializing, keep it alive. Recreating it here
    // can discard a participant's Play command during the first-load race.
    if(state.player&&!state.playerReady)return;
    const placeholder=document.getElementById('playerPlaceholder');
    if(placeholder)placeholder.textContent='Loading YouTube player…';
    try{
      state.player=new YT.Player('player',{
        width:'100%',height:'100%',
        videoId:state.room.current_video_id,
        playerVars:{playsinline:1,controls:1,fs:0,rel:0,enablejsapi:1,origin:location.origin},
        events:{
          onReady:()=>{
            state.playerReady=true;
            try{applyHostVolume(state.hostVolume);}catch(_){}
            const p=Number(state.room.position_seconds||0);
            const videoId=state.room.current_video_id;
            // Read the latest room intent when the player becomes ready, rather than
            // losing a remote Play/Pause command that arrived during initialization.
            if(state.room.is_playing)state.player.loadVideoById({videoId,startSeconds:p});
            else state.player.cueVideoById({videoId,startSeconds:p});
          },
          onStateChange:async e=>{
            if(e.data===YT.PlayerState.ENDED){showEndPreview();await advanceAfterEnd();}
            else if(e.data===YT.PlayerState.PLAYING){
              startPlaybackTiming();
              state.room.is_playing=true;state.room.position_seconds=currentTime();await broadcast('room',{is_playing:true,position_seconds:state.room.position_seconds});
            }else if(e.data===YT.PlayerState.PAUSED){
              finalizePlaybackTiming();
              state.room.is_playing=false;state.room.position_seconds=currentTime();await broadcast('room',{is_playing:false,position_seconds:state.room.position_seconds});
            }
          },
          onError:e=>{
            const videoId=state.room?.current_video_id;
            const messages={2:'Invalid YouTube video ID.',5:'YouTube player error.',100:'This video was removed or is private.',101:'This video cannot be embedded.',150:'This video cannot be embedded.'};
            if((e.data===101||e.data===150||e.data===100)&&state.isHost&&videoId){
              skipUnplayableCurrent(videoId,e.data).catch(()=>notify(messages[e.data]||'Could not skip unavailable video.','error'));
              return;
            }
            notify(messages[e.data]||`YouTube player error (${e.data}).`,'error');
          },
          onAutoplayBlocked:()=>notify('YouTube blocked automatic playback. Press Play on the host phone.','info')
        }
      });
    }catch(e){state.player=null;state.playerReady=false;notify(`Could not create YouTube player: ${e.message||e}`,'error');}
  }

  function loadVideo(id,pos,play,preservePreview=false){
    if(!state.isHost)return;
    if(!preservePreview)hideEndPreview();
    if(!state.playerReady||!state.player){ensureYouTubePlayer();setTimeout(()=>{if(state.playerReady&&state.player)loadVideo(id,pos,play,preservePreview);},500);return;}
    try{
      state.player.loadVideoById({videoId:id,startSeconds:Number(pos||0)});
      if(!play)state.player.pauseVideo();
    }catch(e){notify('Could not load this YouTube video.','error');}
  }
  function applyLocalPlay(play){
    // Persist the intended state before ensuring the player. If a participant's
    // command arrives before YouTube is ready, onReady will read state.room.is_playing
    // and load/cue the current video accordingly instead of dropping the command.
    if(!state.playerReady||!state.player){ensureYouTubePlayer();return;}
    try{play?state.player.playVideo():state.player.pauseVideo();}catch(e){notify('Could not control the YouTube player.','error');}
  }

  let announcementTimer=null;
  function announcementIsCurrent(a){
    const now=Date.now();
    const start=a.starts_at?Date.parse(a.starts_at):-Infinity;
    const end=a.expires_at?Date.parse(a.expires_at):Infinity;
    return a.active!==false && start<=now && end>now;
  }
  function announcementViewCountKey(id){return `alamkarok-announcement-views-${id}`;}
  function announcementViewCount(id){
    try{
      const key=announcementViewCountKey(id);
      const raw=localStorage.getItem(key);
      if(raw!==null){const n=Number(raw);return Number.isFinite(n)&&n>=0?n:0;}
      // Migrate the old one-time-seen flag so existing users get the new 5-view behavior.
      const oldKey=`alamkarok-announcement-seen-${id}`;
      if(localStorage.getItem(oldKey)!==null){localStorage.removeItem(oldKey);}
    }catch(_){ }
    return 0;
  }
  function recordAnnouncementView(id){
    try{localStorage.setItem(announcementViewCountKey(id),String(announcementViewCount(id)+1));}catch(_){ }
  }
  async function getActiveAnnouncement(){
    try{
      const r=await getClient().from('announcements').select('*').eq('active',true).order('created_at',{ascending:false}).limit(20);
      if(r.error)return null;
      return (r.data||[]).find(announcementIsCurrent)||null;
    }catch(_){return null;}
  }
  function closeAnnouncement(id){
    const el=document.getElementById('announcementOverlay');
    if(el)el.remove();
  }
  function showAnnouncement(a){
    if(!a||document.getElementById('announcementOverlay'))return;
    // Show once per page visit, up to 5 visits for each announcement on this browser/device.
    if(announcementViewCount(a.id)>=5)return;
    recordAnnouncementView(a.id);
    const back=document.createElement('div');
    back.className='announcement-overlay';
    back.id='announcementOverlay';
    const image=a.image_url?`<div class="announcement-image-wrap"><img class="announcement-image" src="${esc(a.image_url)}" alt=""></div>`:'';
    const button=a.button_text&&a.button_url?`<a class="btn primary announcement-button" href="${esc(a.button_url)}" target="_blank" rel="noopener noreferrer">${esc(a.button_text)}</a>`:'';
    back.innerHTML=`<div class="announcement-modal" role="dialog" aria-modal="true" aria-labelledby="announcementTitle"><button class="announcement-close" id="announcementClose" type="button" aria-label="Close announcement">×</button>${image}<div class="announcement-content"><div class="announcement-kicker">📢 ANNOUNCEMENT</div><h2 id="announcementTitle">${esc(a.title||'Announcement')}</h2>${a.message?`<div class="announcement-message">${esc(a.message).replace(/\n/g,'<br>')}</div>`:''}${button}</div></div>`;
    document.body.appendChild(back);
    back.querySelector('#announcementClose').onclick=()=>closeAnnouncement(a.id);
    back.addEventListener('click',e=>{if(e.target===back)closeAnnouncement(a.id);});
    const onKey=e=>{if(e.key==='Escape'){closeAnnouncement(a.id);document.removeEventListener('keydown',onKey);}};
    document.addEventListener('keydown',onKey);
  }
  async function loadAnnouncement(){
    if(location.pathname.replace(/\/+$/, '')==='/admin')return;
    const a=await getActiveAnnouncement();
    if(a)showAnnouncement(a);
  }

  function adminStyles(){return `
    <style id="adminInlineStyles">
      .admin-wrap{width:min(980px,100%);padding:20px}.admin-top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:18px}.admin-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(280px,.9fr);gap:16px}.admin-card{padding:18px}.admin-card h1,.admin-card h2{margin:0 0 8px}.admin-form{display:grid;gap:12px}.admin-label{display:grid;gap:6px;font-size:12px;color:#94a2b5;font-weight:700;text-transform:uppercase;letter-spacing:.06em}.admin-textarea{min-height:140px;resize:vertical}.admin-check{display:flex;align-items:center;gap:8px;color:#cbd5e1;font-size:14px}.admin-dates{display:grid;grid-template-columns:1fr 1fr;gap:10px}.admin-actions{display:flex;gap:8px;flex-wrap:wrap}.admin-list{display:grid;gap:10px;margin-top:14px}.admin-item{padding:13px;border:1px solid #243246;background:#0b111a;border-radius:12px}.admin-item-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.admin-item-title{font-weight:750;color:#eef3f9}.admin-item-meta{font-size:11px;color:#718096;margin-top:4px}.admin-item-preview{max-height:110px;max-width:100%;object-fit:cover;border-radius:8px;margin-top:10px}.admin-badge{font-size:11px;padding:4px 7px;border-radius:999px;border:1px solid #294337;color:#78ddb5;background:#10251f}.admin-badge.off{border-color:#47313a;color:#ef9cae;background:#26161c}.admin-empty{color:#718096;font-size:13px;padding:14px 0}.admin-error{color:#ff9cab;background:#28161d;border:1px solid #57303a;padding:10px;border-radius:10px;font-size:13px}.admin-success{color:#75dfb8;background:#10251f;border:1px solid #285342;padding:10px;border-radius:10px;font-size:13px}.admin-login{max-width:430px;margin:8vh auto}.admin-preview{position:relative}.admin-preview .announcement-modal{position:relative;inset:auto;transform:none;margin:0;max-height:none}.admin-preview .announcement-overlay{position:relative;inset:auto;background:none;padding:0}.admin-file{font-size:12px;color:#8290a4}
      @media(max-width:760px){.admin-grid{grid-template-columns:1fr}.admin-dates{grid-template-columns:1fr}.admin-wrap{padding:14px}.admin-top{align-items:flex-start}.admin-top .btn{white-space:nowrap}}
    </style>`;}
  async function adminIsAdmin(){
    const {data:{session}}=await getClient().auth.getSession();
    if(!session)return false;
    const r=await getClient().from('admin_users').select('user_id').eq('user_id',session.user.id).maybeSingle();
    return !r.error&&!!r.data;
  }
  async function renderAdmin(){
    app.innerHTML=adminStyles()+`<div class="admin-wrap"><div class="admin-top"><div><div class="brand">ALAMKAROK</div><div class="small">Announcement Manager</div></div><button class="btn" id="adminBack">Back to ALAMKAROK</button></div><div id="adminArea"></div></div>`;
    document.getElementById('adminBack').onclick=()=>{location.href='/';};
    const area=document.getElementById('adminArea');
    const {data:{session}}=await getClient().auth.getSession();
    if(!session){renderAdminLogin(area);return;}
    if(!(await adminIsAdmin())){area.innerHTML=`<div class="card admin-card"><h1>Access not enabled</h1><p class="sub">This account is signed in, but it is not listed as an ALAMKAROK administrator.</p><button class="btn" id="adminSignOut">Sign out</button></div>`;document.getElementById('adminSignOut').onclick=async()=>{await getClient().auth.signOut();renderAdmin();};return;}
    renderAdminDashboard(area,session.user);
  }
  function renderAdminLogin(area){
    area.innerHTML=`<div class="card admin-card admin-login"><h1>Admin Login</h1><p class="sub">Sign in to publish ALAMKAROK announcements.</p><div id="adminMsg"></div><form class="admin-form" id="adminLoginForm"><label class="admin-label">Email<input class="input" id="adminEmail" type="email" autocomplete="username" required></label><label class="admin-label">Password<input class="input" id="adminPassword" type="password" autocomplete="current-password" required></label><button class="btn primary" type="submit">Sign In</button></form></div>`;
    area.querySelector('#adminLoginForm').onsubmit=async e=>{e.preventDefault();const msg=area.querySelector('#adminMsg');msg.innerHTML='';const r=await getClient().auth.signInWithPassword({email:area.querySelector('#adminEmail').value.trim(),password:area.querySelector('#adminPassword').value});if(r.error){msg.innerHTML=`<div class="admin-error">${esc(r.error.message)}</div>`;return;}renderAdmin();};
  }
  async function adminAnnouncements(){const r=await getClient().from('announcements').select('*').order('created_at',{ascending:false});return r.error?[]:(r.data||[]);}
  function adminFormHtml(edit){
    const a=edit||{};
    const iso=v=>v?new Date(v).toISOString().slice(0,16):'';
    return `<form class="admin-form" id="announcementForm"><input type="hidden" id="annId" value="${esc(a.id||'')}"><label class="admin-label">Title<input class="input" id="annTitle" maxlength="120" value="${esc(a.title||'')}" placeholder="🎉 New Feature Available!" required></label><label class="admin-label">Message<textarea class="input admin-textarea" id="annMessage" maxlength="4000" placeholder="Write your announcement...">${esc(a.message||'')}</textarea></label><label class="admin-label">Image <span class="admin-file">optional</span><input class="input" id="annImage" type="file" accept="image/png,image/jpeg,image/webp,image/gif"><input class="input" id="annImageUrl" type="url" value="${esc(a.image_url||'')}" placeholder="Or paste an image URL"><span class="admin-file">${a.image_url?'Current image is set. Uploading a new image replaces it.':''}</span></label><label class="admin-label">Button text <span class="admin-file">optional</span><input class="input" id="annButtonText" maxlength="50" value="${esc(a.button_text||'')}" placeholder="Learn More"></label><label class="admin-label">Button link <span class="admin-file">optional</span><input class="input" id="annButtonUrl" type="url" value="${esc(a.button_url||'')}" placeholder="https://..."></label><div class="admin-dates"><label class="admin-label">Start <input class="input" id="annStart" type="datetime-local" value="${iso(a.starts_at)}"></label><label class="admin-label">Expiry <input class="input" id="annExpiry" type="datetime-local" value="${iso(a.expires_at)}"></label></div><label class="admin-check"><input id="annActive" type="checkbox" ${a.active!==false?'checked':''}> Active</label><div class="admin-actions"><button class="btn primary" type="submit">${a.id?'Update':'Publish'}</button>${a.id?'<button class="btn" type="button" id="annCancel">Cancel Edit</button>':''}</div></form>`;
  }
  async function uploadAnnouncementImage(file){
    if(!file)return null;
    const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
    const path=`${crypto.randomUUID()}.${ext}`;
    const r=await getClient().storage.from('announcement-images').upload(path,file,{upsert:false,contentType:file.type||undefined});
    if(r.error)throw r.error;
    return getClient().storage.from('announcement-images').getPublicUrl(path).data.publicUrl;
  }
  async function renderAdminDashboard(area,user){
    let editing=null;
    const draw=async()=>{
      const rows=await adminAnnouncements();
      area.innerHTML=`<div class="admin-grid"><section class="card admin-card"><div class="admin-top"><div><h1>${editing?'Edit Announcement':'New Announcement'}</h1><div class="small">${esc(user.email||'')}</div></div></div><div id="adminFormMsg"></div>${adminFormHtml(editing)}</section><section class="card admin-card"><h2>Published Announcements</h2><div class="small">Active announcements appear to visitors once, until they close them.</div><div class="admin-list">${rows.length?rows.map(a=>{const current=announcementIsCurrent(a);return `<div class="admin-item"><div class="admin-item-head"><div><div class="admin-item-title">${esc(a.title||'Untitled')}</div><div class="admin-item-meta">${a.expires_at?'Expires '+new Date(a.expires_at).toLocaleString():'No expiry'}</div></div><span class="admin-badge ${current?'':'off'}">${current?'ACTIVE':'INACTIVE'}</span></div>${a.message?`<div class="admin-item-meta">${esc(a.message).slice(0,180)}</div>`:''}${a.image_url?`<img class="admin-item-preview" src="${esc(a.image_url)}" alt="">`:''}<div class="admin-actions" style="margin-top:10px"><button class="btn" data-edit="${esc(a.id)}">Edit</button><button class="btn" data-toggle="${esc(a.id)}">${a.active?'Disable':'Enable'}</button><button class="btn" data-delete="${esc(a.id)}">Delete</button></div></div>`}).join(''):'<div class="admin-empty">No announcements yet.</div>'}</div></section></div>`;
      const form=area.querySelector('#announcementForm');
      form.onsubmit=async e=>{e.preventDefault();const msg=area.querySelector('#adminFormMsg');msg.innerHTML='';try{let imageUrl=area.querySelector('#annImageUrl').value.trim()||null;const file=area.querySelector('#annImage').files?.[0];if(file)imageUrl=await uploadAnnouncementImage(file);const payload={title:area.querySelector('#annTitle').value.trim(),message:area.querySelector('#annMessage').value, image_url:imageUrl,button_text:area.querySelector('#annButtonText').value.trim()||null,button_url:area.querySelector('#annButtonUrl').value.trim()||null,active:area.querySelector('#annActive').checked,starts_at:area.querySelector('#annStart').value?new Date(area.querySelector('#annStart').value).toISOString():new Date().toISOString(),expires_at:area.querySelector('#annExpiry').value?new Date(area.querySelector('#annExpiry').value).toISOString():null};if(!payload.title)throw new Error('Title is required.');let r;if(editing)r=await getClient().from('announcements').update(payload).eq('id',editing.id);else r=await getClient().from('announcements').insert(payload);if(r.error)throw r.error;editing=null;await draw();}catch(e){msg.innerHTML=`<div class="admin-error">${esc(e.message||String(e))}</div>`;}};
      area.querySelectorAll('[data-edit]').forEach(b=>b.onclick=async()=>{const rows2=await adminAnnouncements();editing=rows2.find(x=>x.id===b.dataset.edit)||null;await draw();});
      area.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=async()=>{const rows2=await adminAnnouncements();const a=rows2.find(x=>x.id===b.dataset.toggle);if(!a)return;await getClient().from('announcements').update({active:!a.active}).eq('id',a.id);await draw();});
      area.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this announcement?'))return;await getClient().from('announcements').delete().eq('id',b.dataset.delete);await draw();});
      const cancel=area.querySelector('#annCancel');if(cancel)cancel.onclick=()=>{editing=null;draw();};
    };
    await draw();
  }

  window.addEventListener('error',e=>{if(!document.getElementById('app'))return;console.error(e.error||e.message);});
  window.addEventListener('unhandledrejection',e=>{console.error(e.reason);});

  (async()=>{
    if(!validConfig() || !window.supabase){renderHome();return;}
    try{
      getClient();
      const params=new URLSearchParams(location.search);
      if(location.pathname.replace(/\/+$/, '')==='/admin' || params.get('admin')==='1') await renderAdmin();
      else {
        const code=params.get('room')?.toUpperCase()||null;
        const saved=readRoomSession();
        if(saved){
          if(code && code!==saved.roomCode) showExistingRoomPrompt(saved,code);
          else { try{ await restoreRoomSession(saved); }catch(e){ clearRoomSession(); if(code) await joinRoom(code); else renderHome(); } }
        }else if(code) await joinRoom(code);
        else loadPersonalPlaylists();
  renderHome();
      }
    }catch(e){errorScreen('ALAMKAROK could not start',e.message||'Unknown startup error','Check config.js and make sure the Supabase URL and publishable key are correct.');}
  })();
})();