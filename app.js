/* ALAMKAROK - resilient static web app */
(() => {
  'use strict';
  const app = document.getElementById('app');
  const cfg = window.JUKEBOX_CONFIG || {};
  const colors = ['#9b5cff','#28a8ff','#18c9a0','#ff9d2e','#ff4f5f','#f1d21b','#ef67c7','#7bd66f','#54d8e8','#ff6f9c'];
  const state = {
    room:null, me:null, people:[], queue:[], isHost:false, channel:null,
    player:null, playerReady:false, ytReady:false, ytLoading:false, currentPosition:0, busy:false, privateList:[], privateBusy:false, privateCollapsed:false, sharedCollapsed:false, playlistCollapsed:{}
  };

  function esc(v){ return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function uuid(){ return (crypto && crypto.randomUUID) ? crypto.randomUUID() : 'u-'+Date.now()+'-'+Math.random().toString(36).slice(2); }
  function roomCode(){ return Math.random().toString(36).slice(2,7).toUpperCase(); }
  function validConfig(){ return /^https:\/\/[^\s]+\.supabase\.co(?:\/)?$/.test(String(cfg.SUPABASE_URL||'')) && /^sb_publishable_/.test(String(cfg.SUPABASE_ANON_KEY||'')); }
  function roomUrl(code){ return `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`; }
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
  function loadPrivateList(){ state.privateList=[]; state.privateCollapsed=false; state.sharedCollapsed=false; state.playlistCollapsed={}; try{ const k=privateKey(); if(!k)return; const raw=localStorage.getItem(k); const parsed=raw?JSON.parse(raw):[]; if(Array.isArray(parsed)) state.privateList=parsed.filter(x=>x&&x.video_id); else if(parsed&&typeof parsed==='object'){ state.privateList=Array.isArray(parsed.items)?parsed.items.filter(x=>x&&x.video_id):[]; state.privateCollapsed=!!parsed.privateCollapsed; state.sharedCollapsed=!!parsed.sharedCollapsed; state.playlistCollapsed=(parsed.playlistCollapsed&&typeof parsed.playlistCollapsed==='object')?parsed.playlistCollapsed:{}; } }catch(_){state.privateList=[];} }
  function savePrivateList(){ try{ const k=privateKey(); if(k)localStorage.setItem(k,JSON.stringify({items:state.privateList,privateCollapsed:state.privateCollapsed,sharedCollapsed:state.sharedCollapsed,playlistCollapsed:state.playlistCollapsed})); }catch(_){} }
  function toggleListSection(which){ if(which==='private') state.privateCollapsed=!state.privateCollapsed; else state.sharedCollapsed=!state.sharedCollapsed; savePrivateList(); updateListSectionUI(); }
  function updateListSectionUI(){ const p=document.getElementById('privateBody'), q=document.getElementById('sharedBody'); if(p){p.classList.toggle('collapsed',state.privateCollapsed); p.setAttribute('aria-hidden',state.privateCollapsed?'true':'false');} if(q){q.classList.toggle('collapsed',state.sharedCollapsed); q.setAttribute('aria-hidden',state.sharedCollapsed?'true':'false');} document.querySelectorAll('[data-collapse]').forEach(b=>{const c=b.dataset.collapse==='private'?state.privateCollapsed:state.sharedCollapsed;const chev=b.querySelector('.chevron');if(chev)chev.textContent=c?'▼':'▲';b.setAttribute('aria-expanded',c?'false':'true');}); }
  function togglePlaylistGroup(id){ state.playlistCollapsed[id]=!state.playlistCollapsed[id]; savePrivateList(); renderPrivateList(); }
  function playlistGroupTitle(id){ const g=state.privateList.find(x=>x.playlist_id===id); return g?.playlist_title||'Imported YouTube Playlist'; }
  function playlistId(value){ try{ const u=new URL(value); return u.hostname.includes('youtube.com')&&u.searchParams.get('list') ? u.searchParams.get('list') : null; }catch(_){ return null; } }
  function privateItemId(){ return 'p-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8); }
  async function videoTitle(id){ let title='YouTube video'; try{const r=await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(id)}&format=json`);if(r.ok){const j=await r.json();if(j.title)title=j.title;}}catch(_){} return title; }
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
    app.innerHTML=`<div class="wrap"><div class="hero card">
      <div class="brand">ALAMKAROK</div><div class="eyebrow">SHARED YOUTUBE ROOM</div>
      <h1 class="h1">One screen. One shared queue.</h1>
      <p class="sub">Create a room, show the QR code, and let everyone add videos and control playback from their own phone.</p>
      ${configProblem?'<div class="notice error"><b>Supabase configuration is missing.</b><br>Open <code>config.js</code> and add your Project URL and <code>sb_publishable_…</code> key.</div>':''}
      ${sdkProblem?'<div class="notice error"><b>Supabase library did not load.</b><br>Check your internet connection and reload.</div>':''}
      <div class="joinbox">
        <button class="btn primary big" id="create" ${configProblem||sdkProblem?'disabled':''}>Create Room</button>
        <div class="divider"><span>or join an existing room</span></div>
        <div class="row"><input class="input" id="roomCode" maxlength="5" placeholder="Room code e.g. 7K4P9" autocomplete="off" style="flex:1;text-transform:uppercase"><button class="btn" id="joinCode" ${configProblem||sdkProblem?'disabled':''}>Join</button></div>
      </div>
      <div class="featuregrid"><div>📺 <b>Host player</b><span>Only the host plays YouTube</span></div><div>🔀 <b>Shared queue</b><span>Everyone sees the same order</span></div><div>🎛️ <b>Shared controls</b><span>Everyone can play, pause, next and previous</span></div><div>👥 <b>People + colours</b><span>Name required when joining</span></div></div>
    </div><div class="footer">ALAMKAROK • internet-based shared queue</div></div>`;
    if(!configProblem&&!sdkProblem){
      document.getElementById('create').onclick=createRoom;
      document.getElementById('joinCode').onclick=()=>joinRoom(document.getElementById('roomCode').value.trim().toUpperCase());
      document.getElementById('roomCode').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('joinCode').click();});
    }
  }

  function nameModal(code, isHost, callback){
    const back=document.createElement('div'); back.className='modalback';
    back.innerHTML=`<div class="modal"><div class="brand">ALAMKAROK</div><div class="small">Room <b>${esc(code)}</b></div><h2>Join the room</h2><p class="sub">Choose the name everyone will see. A colour will be assigned automatically.</p><input class="input" id="joinName" maxlength="40" placeholder="Your name" autocomplete="name"><div class="modalactions"><button class="btn" id="cancelName">Cancel</button><button class="btn primary" id="confirmName">${isHost?'Start Room':'Join Room'}</button></div></div>`;
    document.body.appendChild(back);
    const input=back.querySelector('#joinName'); setTimeout(()=>input.focus(),50);
    back.querySelector('#cancelName').onclick=()=>back.remove();
    back.querySelector('#confirmName').onclick=()=>{const n=input.value.trim();if(!n){input.focus();return notify('Enter a name first','error');}back.remove();callback(n);};
    input.addEventListener('keydown',e=>{if(e.key==='Enter')back.querySelector('#confirmName').click();});
  }

  let sb=null;
  function getClient(){
    if(sb) return sb;
    if(!validConfig()) throw new Error('Supabase configuration is missing or invalid.');
    if(!window.supabase || typeof window.supabase.createClient!=='function') throw new Error('Supabase browser library failed to load.');
    sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
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
  async function registerParticipant(room,isHost,userId,name){
    const client=getClient();
    const {data:people,error:listErr}=await client.from('participants').select('*').eq('room_id',room.id).order('created_at',{ascending:true});
    if(listErr) throw listErr;
    const color=colors[(people||[]).length%colors.length];
    const {data:p,error}=await client.from('participants').insert({room_id:room.id,user_id:userId,name:name.slice(0,40),color}).select().single();
    if(error) throw error;
    state.room=room;state.me=p;state.isHost=isHost;await enterRoom();
  }
  async function enterRoom(){
    const client=getClient();
    const [people,q,room]=await Promise.all([
      client.from('participants').select('*').eq('room_id',state.room.id).order('created_at',{ascending:true}),
      client.from('queue_items').select('*').eq('room_id',state.room.id).order('position',{ascending:true}),
      client.from('rooms').select('*').eq('id',state.room.id).single()
    ]);
    if(people.error)throw people.error;if(q.error)throw q.error;if(room.error)throw room.error;
    state.people=people.data||[];state.queue=q.data||[];state.room=room.data;loadPrivateList();renderRoom();await setupRealtime();if(state.isHost)loadYouTubeAPI();
  }
  async function setupRealtime(){
    const client=getClient();
    state.channel=client.channel(`alamkarok-${state.room.id}`,{config:{broadcast:{self:true},presence:{key:state.me.id}}});
    state.channel.on('broadcast',{event:'command'},({payload})=>handleCommandBroadcast(payload))
      .on('broadcast',{event:'queue'},({payload})=>{state.queue=payload.queue||[];updateRoomView();})
      .on('broadcast',{event:'people'},({payload})=>{state.people=payload.people||[];updateRoomView();})
      .on('broadcast',{event:'room'},({payload})=>{state.room={...state.room,...payload};updateRoomView();})
      .on('postgres_changes',{event:'*',schema:'public',table:'participants',filter:`room_id=eq.${state.room.id}`},refreshPeople)
      .on('postgres_changes',{event:'*',schema:'public',table:'queue_items',filter:`room_id=eq.${state.room.id}`},refreshQueue)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'rooms',filter:`id=eq.${state.room.id}`},refreshRoom)
      .subscribe(status=>{if(status==='CHANNEL_ERROR')notify('Real-time connection failed. Refresh to reconnect.','error');});
  }
  async function refreshPeople(){const r=await getClient().from('participants').select('*').eq('room_id',state.room.id).order('created_at',{ascending:true});if(!r.error){state.people=r.data||[];updateRoomView();}}
  async function refreshQueue(){const r=await getClient().from('queue_items').select('*').eq('room_id',state.room.id).order('position',{ascending:true});if(!r.error){state.queue=r.data||[];updateRoomView();}}
  async function refreshRoom(){const r=await getClient().from('rooms').select('*').eq('id',state.room.id).single();if(!r.error){state.room=r.data;updateRoomView();if(state.isHost&&state.room.current_video_id)ensureYouTubePlayer();}}
  async function broadcast(event,payload){if(state.channel) await state.channel.send({type:'broadcast',event,payload});}

  function renderRoom(){
    const current=state.room.current_video_id;const q=state.queue;
    app.innerHTML=`<div class="wrap room-screen"><div class="top"><div><div class="brand">ALAMKAROK</div><div class="small">Room <b>${esc(state.room.code)}</b> · <span id="peopleCount">${state.people.length}</span> people</div></div><div class="actions"><span class="badge"><span class="dot" style="background:${esc(state.me.color)}"></span>${esc(state.me.name)}</span><button class="btn" id="showQr">QR</button></div></div>
      <div class="roomgrid">
        <section class="player-column">
          <div class="card player-card"><div class="player player-shell" id="playerShell"><div id="player" class="playerbox"><div class="playerplaceholder" id="playerPlaceholder">${state.isHost?(current?'Loading YouTube player…':'Add a YouTube video to start playback.'):'Host is playing the video on their phone'}</div></div>${state.isHost?`<div class="end-preview" id="endPreview" aria-hidden="true"><button class="end-preview-tab" id="endPreviewTab" type="button" aria-expanded="false"><span>NEXT UP</span><span class="end-preview-tab-chevron">⌃</span></button><div class="end-preview-panel"><div class="end-preview-list" id="endPreviewList"></div><div class="end-preview-count" id="endPreviewCount"></div></div></div><button class="fullscreen-btn" id="fullscreenBtn" type="button" title="Fullscreen" aria-label="Fullscreen">⛶</button>`:''}</div><div class="controls"><button class="control" id="prev" title="Previous">⏮</button><button class="control main" id="play" title="Play/Pause">${state.room.is_playing?'❚❚':'▶'}</button><button class="control" id="next" title="Next">⏭</button></div>${state.isHost?`<div class="volume-control"><span>🔊</span><input id="volume" class="range" type="range" min="0" max="100" value="80" aria-label="Host volume"><span id="volumeValue">80%</span></div>`:''}<div class="small center" id="playState">${state.room.is_playing?'Playing':'Paused'} · ${current?'Video selected':'No video selected'}</div></div>
        </section>
        <aside class="room-sidebar"><div class="card"><div class="section-title"><h2>People in Room</h2><span class="badge">${state.isHost?'HOST':'GUEST'}</span></div><div class="people" id="peopleList">${state.people.map(p=>`<div class="person"><span class="dot" style="background:${esc(p.color)}"></span><span>${esc(p.name)}${p.id===state.me.id?' <span class="muted">(You)</span>':''}${p.user_id===state.room.host_id?' 👑':''}</span></div>`).join('')}</div></div><div class="card gap"><div class="section-title"><h2>Room QR</h2></div><div id="qr" class="qr"></div><div class="small center">Scan to join</div><div class="linkbox">${esc(roomUrl(state.room.code))}</div></div></aside>
      </div>

      <section class="main-section shared-section card gap">
        <div class="section-title section-toggle"><button class="btn collapse-btn" id="toggleShared" data-collapse="shared" aria-expanded="${state.sharedCollapsed?'false':'true'}" aria-label="Collapse shared queue"><span class="chevron" aria-hidden="true">${state.sharedCollapsed?'▼':'▲'}</span></button><div class="section-static-label">SHARED QUEUE <span class="section-count">(<span id="queueCount">${q.length}</span>)</span></div><button class="btn green section-action-btn" id="shuffle">🔀 Shuffle</button></div>
                <div id="sharedBody" class="collapsible-body ${state.sharedCollapsed?'collapsed':''}" aria-hidden="${state.sharedCollapsed?'true':'false'}"><div class="row"><input class="input" id="url" placeholder="Paste a YouTube link" inputmode="url"><button class="btn primary" id="add">Add to Queue</button></div><div class="queue" id="queueList">${q.length?q.map((x,i)=>`<div class="qitem ${x.video_id===current?'now':''}"><div class="qnum">${i+1}</div><img class="thumb" src="${esc(x.thumbnail||ytThumb(x.video_id))}" alt=""><div class="min0"><div class="qtitle">${esc(x.title||'YouTube video')}</div><div class="meta">${x.video_id===current?'NOW PLAYING · ':''}${esc(personName(x.added_by))}</div></div><div class="actions queue-actions"><button class="action-sm move-btn" data-up="${esc(x.id)}" title="Move up" ${i===0?'disabled':''}>↑</button><button class="action-sm move-btn" data-down="${esc(x.id)}" title="Move down" ${i===q.length-1?'disabled':''}>↓</button>${x.video_id!==current||state.isHost?`<button class="action-sm" data-play="${esc(x.id)}">Play</button>`:''}<button class="action-sm danger-sm" data-del="${esc(x.id)}">×</button></div></div>`).join(''):'<div class="empty">No videos yet. Add the first YouTube link.</div>'}</div></div>
      </section>

      <section class="main-section private-section card gap private-card">
        <div class="section-title section-toggle"><button class="btn collapse-btn" id="togglePrivate" data-collapse="private" aria-expanded="${state.privateCollapsed?'false':'true'}" aria-label="Collapse private list"><span class="chevron" aria-hidden="true">${state.privateCollapsed?'▼':'▲'}</span></button><div class="section-static-label">MY LIST <span class="section-private">— PRIVATE</span></div><button class="btn section-action-btn" id="privateSelectAll">Select All</button></div>
                <div id="privateBody" class="collapsible-body ${state.privateCollapsed?'collapsed':''}" aria-hidden="${state.privateCollapsed?'true':'false'}"><div class="row"><input class="input" id="privateUrl" placeholder="Paste a YouTube video or playlist link" inputmode="url"><button class="btn primary" id="privateAdd">Add to My List</button></div><div class="small private-help">Build your own list first. Select one, several, or all songs, then send them to the shared queue.</div><div class="queue" id="privateList"></div><div class="private-actions"><button class="btn green" id="uploadSelected">Upload Selected</button><button class="btn" id="uploadAll">Upload All</button></div></div>
      </section>

      <div class="footer">Everyone can add links and control playback. Only the host displays YouTube.</div></div>`;
    bindRoomControls();
    if(state.isHost&&state.room.current_video_id)ensureYouTubePlayer();
  }

  function updateRoomView(){
    if(!document.querySelector('.room-screen')){renderRoom();return;}
    const current=state.room.current_video_id,q=state.queue;
    const count=document.getElementById('peopleCount');if(count)count.textContent=state.people.length;
    const qc=document.getElementById('queueCount');if(qc)qc.textContent=q.length;
    const stateEl=document.getElementById('playState');if(stateEl)stateEl.textContent=`${state.room.is_playing?'Playing':'Paused'} · ${current?'Video selected':'No video selected'}`;
    const play=document.getElementById('play');if(play)play.textContent=state.room.is_playing?'❚❚':'▶';
    const list=document.getElementById('queueList');
    if(list)list.innerHTML=q.length?q.map((x,i)=>`<div class="qitem ${x.video_id===current?'now':''}"><div class="qnum">${i+1}</div><img class="thumb" src="${esc(x.thumbnail||ytThumb(x.video_id))}" alt=""><div class="min0"><div class="qtitle">${esc(x.title||'YouTube video')}</div><div class="meta">${x.video_id===current?'NOW PLAYING · ':''}${esc(personName(x.added_by))}</div></div><div class="actions queue-actions"><button class="action-sm move-btn" data-up="${esc(x.id)}" title="Move up" ${i===0?'disabled':''}>↑</button><button class="action-sm move-btn" data-down="${esc(x.id)}" title="Move down" ${i===q.length-1?'disabled':''}>↓</button>${x.video_id!==current||state.isHost?`<button class="action-sm" data-play="${esc(x.id)}">Play</button>`:''}<button class="action-sm danger-sm" data-del="${esc(x.id)}">×</button></div></div>`).join(''):'<div class="empty">No videos yet. Add the first YouTube link.</div>';
    if(list){list.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>removeItem(b.dataset.del));list.querySelectorAll('[data-play]').forEach(b=>b.onclick=()=>playQueueItem(b.dataset.play));list.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>moveQueueItem(b.dataset.up,-1));list.querySelectorAll('[data-down]').forEach(b=>b.onclick=()=>moveQueueItem(b.dataset.down,1));}
    updateEndPreview();
    renderPrivateList();
    const people=document.getElementById('peopleList');if(people)people.innerHTML=state.people.map(p=>`<div class="person"><span class="dot" style="background:${esc(p.color)}"></span><span>${esc(p.name)}${p.id===state.me.id?' <span class="muted">(You)</span>':''}${p.user_id===state.room.host_id?' 👑':''}</span></div>`).join('');
    if(state.isHost&&current)ensureYouTubePlayer();
  }
  function bindRoomControls(){
    document.getElementById('togglePrivate').onclick=()=>toggleListSection('private');document.getElementById('toggleShared').onclick=()=>toggleListSection('shared');document.getElementById('add').onclick=addLink;document.getElementById('shuffle').onclick=shuffleQueue;const privateAddBtn=document.getElementById('privateAdd'); if(privateAddBtn) privateAddBtn.onclick=(e)=>{e.preventDefault();addPrivateInput();};document.getElementById('privateSelectAll').onclick=selectAllPrivate;document.getElementById('uploadSelected').onclick=()=>uploadPrivate(false);document.getElementById('uploadAll').onclick=()=>uploadPrivate(true);document.getElementById('prev').onclick=()=>sendCommand('previous');document.getElementById('next').onclick=()=>sendCommand('next');document.getElementById('play').onclick=()=>sendCommand(state.room.is_playing?'pause':'play');document.getElementById('showQr').onclick=showQrModal;const fs=document.getElementById('fullscreenBtn');if(fs)fs.onclick=togglePlayerFullscreen;const previewTab=document.getElementById('endPreviewTab');if(previewTab)previewTab.onclick=()=>setEndPreviewOpen(!document.getElementById('endPreview')?.classList.contains('show'));const vol=document.getElementById('volume');if(vol){vol.oninput=()=>{const v=Number(vol.value);const label=document.getElementById('volumeValue');if(label)label.textContent=v+'%';if(state.playerReady&&state.player)try{state.player.setVolume(v);state.player.unMute();if(v===0)state.player.mute();}catch(_){}};}
    document.getElementById('url').addEventListener('keydown',e=>{if(e.key==='Enter')addLink();});
    document.getElementById('privateUrl').addEventListener('keydown',e=>{if(e.key==='Enter')addPrivateInput();});
    document.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>removeItem(b.dataset.del));document.querySelectorAll('[data-play]').forEach(b=>b.onclick=()=>playQueueItem(b.dataset.play));document.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>moveQueueItem(b.dataset.up,-1));document.querySelectorAll('[data-down]').forEach(b=>b.onclick=()=>moveQueueItem(b.dataset.down,1));
    const qr=document.getElementById('qr'); if(window.QRCode){new QRCode(qr,{text:roomUrl(state.room.code),width:150,height:150});} else qr.innerHTML='<div class="small qrtext">QR library unavailable.<br>Use the link below.</div>';
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
    const itemHtml=({x,i})=>`<div class="qitem private-item"><input class="private-check" type="checkbox" data-private-check="${esc(x.id)}" ${x.selected?'checked':''} aria-label="Select ${esc(x.title)}"><div class="qnum">${i+1}</div><img class="thumb" src="${esc(x.thumbnail||ytThumb(x.video_id))}" alt=""><div class="min0"><div class="qtitle">${esc(x.title||'YouTube video')}</div><div class="meta">${x.playlist_id?'Playlist · ':''}Private · not uploaded</div></div><div class="actions queue-actions"><button class="action-sm move-btn" data-private-up="${esc(x.id)}" ${i===0?'disabled':''}>↑</button><button class="action-sm move-btn" data-private-down="${esc(x.id)}" ${i===state.privateList.length-1?'disabled':''}>↓</button><button class="action-sm danger-sm" data-private-del="${esc(x.id)}">×</button></div></div>`;
    list.innerHTML=groups.map(g=>{
      if(!g.playlistId) return g.items.map(itemHtml).join('');
      const collapsed=!!state.playlistCollapsed[g.playlistId];
      return `<div class="playlist-subsection ${collapsed?'is-collapsed':''}"><button class="playlist-subhead" data-playlist-toggle="${esc(g.playlistId)}" aria-expanded="${collapsed?'false':'true'}"><span class="playlist-subtitle">${esc(g.title)}</span><span class="playlist-count">${g.items.length} video${g.items.length===1?'':'s'}</span><span class="playlist-chevron">${collapsed?'▼':'▲'}</span></button><div class="playlist-subbody ${collapsed?'collapsed':''}">${g.items.map(itemHtml).join('')}</div></div>`;
    }).join('');
    list.querySelectorAll('[data-playlist-toggle]').forEach(b=>b.onclick=()=>togglePlaylistGroup(b.dataset.playlistToggle));
    list.querySelectorAll('[data-private-check]').forEach(b=>b.onchange=()=>{const x=state.privateList.find(x=>x.id===b.dataset.privateCheck);if(x){x.selected=b.checked;savePrivateList();}});
    list.querySelectorAll('[data-private-up]').forEach(b=>b.onclick=()=>movePrivate(b.dataset.privateUp,-1));
    list.querySelectorAll('[data-private-down]').forEach(b=>b.onclick=()=>movePrivate(b.dataset.privateDown,1));
    list.querySelectorAll('[data-private-del]').forEach(b=>b.onclick=()=>deletePrivate(b.dataset.privateDel));
  }
  function selectAllPrivate(){ const all=state.privateList.length>0 && state.privateList.every(x=>x.selected); state.privateList.forEach(x=>x.selected=!all); savePrivateList(); renderPrivateList(); }
  function movePrivate(id,direction){ const i=state.privateList.findIndex(x=>x.id===id), j=i+direction; if(i<0||j<0||j>=state.privateList.length)return; [state.privateList[i],state.privateList[j]]=[state.privateList[j],state.privateList[i]]; savePrivateList();renderPrivateList(); }
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

  async function addLink(){if(state.busy)return;const input=document.getElementById('url');const id=ytId(input.value.trim());if(!id)return notify('Enter a valid YouTube link.','error');state.busy=true;try{let title='YouTube video';try{const r=await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(id)}&format=json`);if(r.ok){const j=await r.json();if(j.title)title=j.title;}}catch(_){}const pos=state.queue.length?Math.max(...state.queue.map(x=>x.position))+1:0;const r=await getClient().from('queue_items').insert({room_id:state.room.id,video_id:id,title,thumbnail:ytThumb(id),added_by:state.me.id,position:pos}).select().single();if(r.error)throw r.error;input.value='';await refreshQueue();await broadcast('queue',{queue:state.queue});if(state.isHost&&!state.room.current_video_id)await performPlayback('load',id,0,true);notify('Added to the shared queue');}catch(e){notify(e.message||'Could not add video','error');}finally{state.busy=false;}}
  async function removeItem(id){
    const item=state.queue.find(x=>x.id===id); if(!item)return;
    const wasCurrent=item.video_id===state.room.current_video_id;
    const r=await getClient().from('queue_items').delete().eq('id',id);
    if(r.error)return notify(r.error.message,'error');
    await refreshQueue(); await normalizePositions(); await refreshQueue();
    if(wasCurrent){
      const next=state.queue[0];
      if(next) await performPlayback('load',next.video_id,0,true);
      else {
        const patch={current_video_id:null,current_index:0,is_playing:false,position_seconds:0,updated_at:new Date().toISOString()};
        const rr=await getClient().from('rooms').update(patch).eq('id',state.room.id).select().single();
        if(!rr.error)state.room=rr.data;
        updateRoomView(); await broadcast('room',patch);
        if(state.isHost&&state.player){try{state.player.stopVideo();}catch(_){} }
      }
    }
    await broadcast('queue',{queue:state.queue});
    notify('Video removed');
  }
  async function normalizePositions(){for(let i=0;i<state.queue.length;i++){const r=await getClient().from('queue_items').update({position:i}).eq('id',state.queue[i].id);if(r.error)break;}}
  async function moveQueueItem(id,direction){
    if(state.busy)return;
    const index=state.queue.findIndex(x=>x.id===id);
    const targetIndex=index+direction;
    if(index<0||targetIndex<0||targetIndex>=state.queue.length)return;
    const item=state.queue[index], target=state.queue[targetIndex];
    state.busy=true;
    try{
      const client=getClient();
      const first=await client.from('queue_items').update({position:target.position}).eq('id',item.id);
      if(first.error)throw first.error;
      const second=await client.from('queue_items').update({position:item.position}).eq('id',target.id);
      if(second.error)throw second.error;
      await refreshQueue();
      const currentIndex=state.room.current_video_id?state.queue.findIndex(x=>x.video_id===state.room.current_video_id):-1;
      if(currentIndex>=0){
        const rr=await client.from('rooms').update({current_index:currentIndex,updated_at:new Date().toISOString()}).eq('id',state.room.id).select().single();
        if(!rr.error)state.room=rr.data;
      }
      updateRoomView();
      await broadcast('queue',{queue:state.queue});
      if(currentIndex>=0)await broadcast('room',{current_index:currentIndex});
    }catch(e){notify(e.message||'Could not move video.','error');}
    finally{state.busy=false;}
  }

  async function shuffleQueue(){if(state.queue.length<2)return notify('Add at least two videos to shuffle.');const current=state.room.current_video_id;const currentItem=state.queue.find(x=>x.video_id===current);let rest=state.queue.filter(x=>x.video_id!==current);for(let i=rest.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[rest[i],rest[j]]=[rest[j],rest[i]];}const ordered=currentItem?[currentItem,...rest]:rest;for(let i=0;i<ordered.length;i++){const r=await getClient().from('queue_items').update({position:i}).eq('id',ordered[i].id);if(r.error)return notify(r.error.message,'error');}await refreshQueue();await broadcast('queue',{queue:state.queue});notify('Queue shuffled for everyone');}
  async function playQueueItem(id){const item=state.queue.find(x=>x.id===id);if(!item)return;await performPlayback('load',item.video_id,0,true);}
  async function advanceAfterEnd(){
    if(!state.isHost)return;
    const idx=Number.isInteger(state.room.current_index)?state.room.current_index:state.queue.findIndex(x=>x.video_id===state.room.current_video_id);
    const next=state.queue[idx+1];
    if(next){ await performPlayback('load',next.video_id,0,true); notify('Autoplay: next video'); }
    else {
      const patch={is_playing:false,position_seconds:0,updated_at:new Date().toISOString()};
      const r=await getClient().from('rooms').update(patch).eq('id',state.room.id).select().single();
      if(!r.error)state.room=r.data;
      updateRoomView();
      await broadcast('room',patch);
      notify('Queue finished');
    }
  }
  async function sendCommand(action){await broadcast('command',{from:state.me.id,action});if(state.isHost)await handleCommandBroadcast({from:state.me.id,action});}
  async function handleCommandBroadcast(payload){
    if(!payload||payload.from===state.me.id && !state.isHost)return;
    if(!state.isHost)return;
    if(payload.action==='play'||payload.action==='pause'){await performPlayback(payload.action,null,currentTime(),payload.action==='play');return;}
    let idx=Number.isInteger(state.room.current_index)?state.room.current_index:0;
    if(payload.action==='next')idx=Math.min(state.queue.length-1,idx+1);
    if(payload.action==='previous')idx=Math.max(0,idx-1);
    if(payload.action==='load'&&payload.videoId){await performPlayback('load',payload.videoId,0,true);return;}
    if((payload.action==='next'||payload.action==='previous')&&state.queue[idx])await performPlayback('load',state.queue[idx].video_id,0,true);
  }
  function currentTime(){try{return state.playerReady?state.player.getCurrentTime():Number(state.room.position_seconds||0);}catch(_){return Number(state.room.position_seconds||0);}}
  async function performPlayback(action,videoId,position=0,playing=false){
    if(action==='load'){const idx=state.queue.findIndex(x=>x.video_id===videoId);const patch={current_video_id:videoId,current_index:idx<0?0:idx,is_playing:playing,position_seconds:position};const r=await getClient().from('rooms').update({...patch,updated_at:new Date().toISOString()}).eq('id',state.room.id).select().single();if(!r.error)state.room=r.data;updateRoomView();if(state.isHost)loadVideo(videoId,position,playing);await broadcast('room',patch);return;}
    const playingNow=action==='play';const pos=position;const patch={is_playing:playingNow,position_seconds:pos,updated_at:new Date().toISOString()};const r=await getClient().from('rooms').update(patch).eq('id',state.room.id).select().single();if(!r.error)state.room=r.data;updateRoomView();if(state.isHost)applyLocalPlay(playingNow);await broadcast('room',patch);
  }

  let endPreviewTimer=null;
  function updateEndPreview(){
    const list=document.getElementById('endPreviewList');
    const count=document.getElementById('endPreviewCount');
    if(!list||!count)return;
    const idx=state.room?.current_video_id?state.queue.findIndex(x=>x.video_id===state.room.current_video_id):-1;
    const remaining=idx>=0?state.queue.slice(idx+1):state.queue.slice(0);
    list.innerHTML=remaining.slice(0,8).map((x,i)=>`<div class="end-preview-item"><span>${i+1}</span><span>${esc(x.title||'YouTube video')}</span></div>`).join('');
    count.textContent=remaining.length===0?'Nothing remaining':`${remaining.length} remaining`;
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
  function showEndPreview(){updateEndPreview();setEndPreviewOpen(true,true);}
  function hideEndPreview(){setEndPreviewOpen(false);}
  async function togglePlayerFullscreen(){
    const shell=document.getElementById('playerShell');
    if(!shell)return;
    try{
      if(document.fullscreenElement){await document.exitFullscreen();}
      else await shell.requestFullscreen();
    }catch(e){notify('Fullscreen is not available in this browser.','info');}
  }
  document.addEventListener('fullscreenchange',()=>{
    const shell=document.getElementById('playerShell');
    const btn=document.getElementById('fullscreenBtn');
    if(!shell||!btn)return;
    const active=document.fullscreenElement===shell;
    shell.classList.toggle('is-fullscreen',active);
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
    if(state.player){try{state.player.destroy();}catch(_){ }state.player=null;state.playerReady=false;}
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
            try{state.player.setVolume(Number(document.getElementById('volume')?.value||80));}catch(_){}
            const p=Number(state.room.position_seconds||0);
            if(state.room.is_playing)state.player.loadVideoById({videoId:state.room.current_video_id,startSeconds:p});
            else state.player.cueVideoById({videoId:state.room.current_video_id,startSeconds:p});
          },
          onStateChange:async e=>{
            if(e.data===YT.PlayerState.ENDED){showEndPreview();await advanceAfterEnd();}
            else if(e.data===YT.PlayerState.PLAYING){
              state.room.is_playing=true;state.room.position_seconds=currentTime();await broadcast('room',{is_playing:true,position_seconds:state.room.position_seconds});
            }else if(e.data===YT.PlayerState.PAUSED){
              state.room.is_playing=false;state.room.position_seconds=currentTime();await broadcast('room',{is_playing:false,position_seconds:state.room.position_seconds});
            }
          },
          onError:e=>{
            const messages={2:'Invalid YouTube video ID.',5:'YouTube player error.',100:'This video was removed or is private.',101:'This video cannot be embedded.',150:'This video cannot be embedded.'};
            notify(messages[e.data]||`YouTube player error (${e.data}).`,'error');
          },
          onAutoplayBlocked:()=>notify('YouTube blocked automatic playback. Press Play on the host phone.','info')
        }
      });
    }catch(e){state.player=null;state.playerReady=false;notify(`Could not create YouTube player: ${e.message||e}`,'error');}
  }

  function loadVideo(id,pos,play){
    if(!state.isHost)return;
    hideEndPreview();
    if(!state.playerReady||!state.player){ensureYouTubePlayer();setTimeout(()=>{if(state.playerReady&&state.player)loadVideo(id,pos,play);},500);return;}
    try{
      state.player.loadVideoById({videoId:id,startSeconds:Number(pos||0)});
      if(!play)state.player.pauseVideo();
    }catch(e){notify('Could not load this YouTube video.','error');}
  }
  function applyLocalPlay(play){
    if(!state.playerReady||!state.player){ensureYouTubePlayer();return;}
    try{play?state.player.playVideo():state.player.pauseVideo();}catch(e){notify('Could not control the YouTube player.','error');}
  }

  window.addEventListener('error',e=>{if(!document.getElementById('app'))return;console.error(e.error||e.message);});
  window.addEventListener('unhandledrejection',e=>{console.error(e.reason);});

  (async()=>{
    if(!validConfig() || !window.supabase){renderHome();return;}
    try{
      getClient();
      const code=new URLSearchParams(location.search).get('room');
      if(code) await joinRoom(code.toUpperCase()); else renderHome();
    }catch(e){errorScreen('ALAMKAROK could not start',e.message||'Unknown startup error','Check config.js and make sure the Supabase URL and publishable key are correct.');}
  })();
})();
