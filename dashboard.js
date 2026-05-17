/* ═══════════════════════════════════════════════════════════════
   AL AROUBA HEALTH — Admin Dashboard JS (GitHub Edition)
   Storage  : GitHub API  (commits products.json to repo)
   Images   : Base64 embedded in JSON
   Auth     : sessionStorage flag (login.html)
   Hosting  : GitHub Pages
═══════════════════════════════════════════════════════════════ */
'use strict';

let state       = { products:[], hero:{}, stats:[], section:{}, meta:{} };
let editingId   = null;
let currentImage= { base64:null };
let dragSrcIndex= null;

/* ── Auth Guard ─────────────────────────────────────────── */
(function checkAuth(){
  if(!sessionStorage.getItem('admin_auth')){ window.location.href='login.html'; return; }
  const user=sessionStorage.getItem('admin_user')||'Admin';
  document.addEventListener('DOMContentLoaded',()=>{
    const el=document.getElementById('sfName'); const av=document.querySelector('.sf-avatar');
    if(el) el.textContent=user[0].toUpperCase()+user.slice(1);
    if(av) av.textContent=user[0].toUpperCase();
  });
})();

/* ── Init ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded',()=>{
  loadData(); initNavigation(); initColorSync(); initDragUpload();
});

/* ── Data Load ──────────────────────────────────────────── */
function loadData(){
  const draft=localStorage.getItem('products_draft');
  if(draft){
    try{ applyData(JSON.parse(draft)); toast('Loaded from local draft','info'); return; }catch(_){}
  }
  applyData(getDefaultData());
  toast('Using defaults — configure GitHub Settings and publish','info');
}

function applyData(data){
  state.products=(data.products||[]).sort((a,b)=>(a.order||0)-(b.order||0));
  state.hero=data.hero||{}; state.stats=data.stats||[];
  state.section=data.section||{}; state.meta=data.meta||{};
  renderProducts(); renderHeroForm(); renderStatsForm();
}

/* ── Pull Latest from GitHub ────────────────────────────── */
async function pullFromGitHub(){
  loadGitHubSettings();
  if(window.location.protocol==='file:'){
    toast('❌ Cannot reach GitHub from a local file. Serve the dashboard over HTTP.','error',8000); switchSection('github'); return;
  }
  if(!ghSettings.token||!ghSettings.owner||!ghSettings.repo){
    toast('Configure GitHub Settings first','error'); switchSection('github'); return;
  }
  const tid=toast('Pulling from GitHub…','loading',0);
  try{
    const url=`https://api.github.com/repos/${ghSettings.owner}/${ghSettings.repo}/contents/${ghSettings.filePath}?ref=${ghSettings.branch}`;
    const res=await ghFetch(url,{headers:ghHeaders()});
    if(res.status===401||res.status===403){ const b=await res.json().catch(()=>({})); throw new Error(`Auth error ${res.status}: ${b.message||'check token scope'}`); }
    if(!res.ok) throw new Error(`GitHub error ${res.status}`);
    const fileData=await res.json();
    const decoded=JSON.parse(decodeURIComponent(escape(atob(fileData.content.replace(/\n/g,'')))));
    applyData(decoded); saveDraft(decoded); dismissToast(tid);
    toast('✅ Pulled latest from GitHub','success');
  }catch(e){
    dismissToast(tid);
    const hint=e.message.toLowerCase().includes('failed to fetch')?' — serve dashboard over HTTP, not file://':'';
    toast('❌ Pull failed: '+e.message+hint,'error',7000);
  }
}

/* ── Publish (top-level — goes straight to GitHub) ──────── */
async function publishChanges(){
  // Auto-save any open section forms
  if(!document.getElementById('panel-hero')?.classList.contains('hidden'))  saveHero();
  if(!document.getElementById('panel-stats')?.classList.contains('hidden')) saveStats();
  await publishToGitHub();
}

function buildPayload(){
  return { meta:{lastUpdated:new Date().toISOString(),version:'1.0'}, hero:state.hero, stats:state.stats, section:state.section, products:state.products };
}
function saveDraft(p){ try{ localStorage.setItem('products_draft',JSON.stringify(p||buildPayload())); }catch(_){} }

/* ── Render Products ────────────────────────────────────── */
function renderProducts(){
  const grid=document.getElementById('productsGrid');
  const cnt=document.getElementById('productCount');
  if(!grid) return;
  cnt.textContent=state.products.length;
  if(!state.products.length){
    grid.innerHTML=`<div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:var(--muted);"><div style="font-size:3rem;margin-bottom:16px;">📦</div><div style="font-size:1rem;font-weight:600;color:var(--navy);margin-bottom:8px;">No products yet</div><div style="font-size:0.85rem;">Click <strong>Add Product</strong> to get started.</div></div>`;
    return;
  }
  grid.innerHTML=state.products.map((p,i)=>buildProductCard(p,i)).join('');
  initDragAndDrop();
}

function buildProductCard(p,i){
  const grad=`linear-gradient(135deg,${p.gradientFrom},${p.gradientTo})`;
  const imgSrc=p.image||'';
  const iconHtml=imgSrc?`<img src="${imgSrc}" alt="${escHtml(p.title)}" style="width:100%;height:100%;object-fit:cover;border-radius:14px;"/>`:escHtml(p.icon||'💊');
  const tags=(p.tags||[]).slice(0,4).map(t=>`<span class="pac-tag">${escHtml(t)}</span>`).join('');
  return `<div class="prod-admin-card ${p.visible?'':'hidden-card'}" data-id="${p.id}" data-index="${i}" draggable="true">
    <div class="pac-drag-handle">⋮⋮</div>
    <div class="pac-stripe" style="background:${grad};"></div>
    <div class="pac-body">
      <div class="pac-top">
        <div class="pac-icon" style="background:${grad};">${iconHtml}</div>
        <div class="pac-controls">
          <span class="pac-badge-visible ${p.visible?'yes':'no'}">${p.visible?'● Visible':'○ Hidden'}</span>
          <span class="pac-order">#${i+1}</span>
        </div>
      </div>
      <div class="pac-title">${escHtml(p.title)}</div>
      <div class="pac-desc">${escHtml(p.description)}</div>
      <div class="pac-tags">${tags}</div>
      <div class="pac-footer">
        <button class="pac-btn-edit" onclick="openEditModal('${p.id}')">✏️ Edit</button>
        <button class="pac-btn-toggle" onclick="toggleVisibility('${p.id}')">${p.visible?'🙈 Hide':'👁 Show'}</button>
      </div>
    </div>
  </div>`;
}

/* ── Drag & Drop ────────────────────────────────────────── */
function initDragAndDrop(){
  document.querySelectorAll('.prod-admin-card').forEach(c=>{
    c.addEventListener('dragstart',onDragStart); c.addEventListener('dragover',onDragOver);
    c.addEventListener('dragleave',onDragLeave); c.addEventListener('drop',onDrop);
    c.addEventListener('dragend',onDragEnd);
  });
}
function onDragStart(e){ dragSrcIndex=parseInt(this.dataset.index); this.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; }
function onDragOver(e){ e.preventDefault(); document.querySelectorAll('.prod-admin-card').forEach(c=>c.classList.remove('drag-over')); this.classList.add('drag-over'); }
function onDragLeave(){ this.classList.remove('drag-over'); }
function onDrop(e){
  e.stopPropagation(); const dest=parseInt(this.dataset.index);
  if(dragSrcIndex===null||dragSrcIndex===dest) return;
  const moved=state.products.splice(dragSrcIndex,1)[0];
  state.products.splice(dest,0,moved);
  state.products.forEach((p,i)=>p.order=i+1);
  saveDraft(); renderProducts(); toast('Order updated','success');
}
function onDragEnd(){ document.querySelectorAll('.prod-admin-card').forEach(c=>c.classList.remove('dragging','drag-over')); dragSrcIndex=null; }

/* ── Toggle Visibility ──────────────────────────────────── */
function toggleVisibility(id){
  const p=state.products.find(x=>x.id===id); if(!p) return;
  p.visible=!p.visible; saveDraft(); renderProducts();
  toast(`${p.title} is now ${p.visible?'visible':'hidden'}`,'info');
}

/* ── Modal ──────────────────────────────────────────────── */
function openAddModal(){
  editingId=null; currentImage={base64:null};
  document.getElementById('modalTitle').textContent='Add New Product';
  document.getElementById('modalDeleteBtn').style.display='none';
  setModalFields({icon:'💊',visible:true,gradientFrom:'#0d2d6b',gradientTo:'#2a7fd4',title:'',description:'',tags:[],image:''});
  openModal();
}
function openEditModal(id){
  const p=state.products.find(x=>x.id===id); if(!p) return;
  editingId=id; currentImage={base64:p.image||null};
  document.getElementById('modalTitle').textContent='Edit Product';
  document.getElementById('modalDeleteBtn').style.display='inline-flex';
  setModalFields(p); openModal();
}
function setModalFields(p){
  setValue('mIcon',p.icon||'💊');
  document.getElementById('mVisible').checked=p.visible!==false;
  document.getElementById('toggleLabel').textContent=p.visible!==false?'Visible':'Hidden';
  setValue('mGradFrom',p.gradientFrom||'#0d2d6b'); setValue('mGradFromHex',p.gradientFrom||'#0d2d6b');
  setValue('mGradTo',p.gradientTo||'#2a7fd4');     setValue('mGradToHex',p.gradientTo||'#2a7fd4');
  setValue('mTitle',p.title||''); setValue('mDesc',p.description||'');
  setValue('mTags',(p.tags||[]).join(', '));
  const imgSrc=p.image||'';
  imgSrc?showImagePreview(imgSrc):clearImagePreview();
  updateColorPreview();
}
function openModal(){ document.getElementById('productModal').classList.add('open'); document.body.style.overflow='hidden'; setTimeout(()=>document.getElementById('mTitle').focus(),200); }
function closeModal(){ document.getElementById('productModal').classList.remove('open'); document.body.style.overflow=''; editingId=null; currentImage={base64:null}; }

document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('productModal').addEventListener('click',function(e){ if(e.target===this) closeModal(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeModal(); });
});

/* ── Save Product ───────────────────────────────────────── */
function saveProduct(){
  const title=document.getElementById('mTitle').value.trim();
  if(!title){ toast('Product title is required','error'); document.getElementById('mTitle').focus(); return; }
  const tags=document.getElementById('mTags').value.split(',').map(t=>t.trim()).filter(Boolean);
  const productData={
    icon:document.getElementById('mIcon').value.trim()||'💊',
    visible:document.getElementById('mVisible').checked,
    gradientFrom:document.getElementById('mGradFromHex').value||'#0d2d6b',
    gradientTo:document.getElementById('mGradToHex').value||'#2a7fd4',
    title, description:document.getElementById('mDesc').value.trim(), tags,
    image:currentImage.base64||'',
  };
  if(editingId){
    const idx=state.products.findIndex(x=>x.id===editingId);
    if(idx!==-1) state.products[idx]={...state.products[idx],...productData};
    toast(`"${title}" updated`,'success');
  } else {
    const maxOrd=state.products.reduce((m,p)=>Math.max(m,p.order||0),0);
    state.products.push({id:'prod_'+Date.now(),order:maxOrd+1,...productData});
    toast(`"${title}" added`,'success');
  }
  saveDraft(); renderProducts(); closeModal();
}

/* ── Delete Product ─────────────────────────────────────── */
function confirmDelete(){
  if(!editingId) return;
  const p=state.products.find(x=>x.id===editingId);
  if(!p||!confirm(`Delete "${p.title}"?`)) return;
  state.products=state.products.filter(x=>x.id!==editingId);
  state.products.forEach((p,i)=>p.order=i+1);
  saveDraft(); renderProducts(); closeModal(); toast(`"${p.title}" deleted`,'success');
}

/* ── Image Upload ───────────────────────────────────────── */
function handleImageUpload(e){ const f=e.target.files[0]; if(f) processImageFile(f); }

async function processImageFile(file){
  if(!file.type.startsWith('image/')){ toast('Please upload an image file','error'); return; }
  if(file.size>5*1024*1024){ toast('Image must be under 5MB','error'); return; }
  const compressed=await compressImage(file,600);
  showImagePreview(compressed); currentImage.base64=compressed;
  toast('Image ready','success');
}

async function compressImage(file,maxSize){
  return new Promise(resolve=>{
    const reader=new FileReader();
    reader.onload=ev=>{
      const img=new Image();
      img.onload=()=>{
        const canvas=document.createElement('canvas');
        let w=img.width,h=img.height;
        if(w>maxSize||h>maxSize){ if(w>h){h=Math.round(h*maxSize/w);w=maxSize;}else{w=Math.round(w*maxSize/h);h=maxSize;} }
        canvas.width=w; canvas.height=h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        resolve(canvas.toDataURL('image/webp',0.82));
      };
      img.src=ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function showImagePreview(src){
  document.getElementById('iuaInner').style.display='none';
  document.getElementById('iuaPreview').src=src; document.getElementById('iuaPreview').style.display='block';
  document.getElementById('iuaRemove').style.display='block';
  document.getElementById('imgUploadArea').style.padding='12px';
}
function clearImagePreview(){
  document.getElementById('iuaInner').style.display='flex';
  document.getElementById('iuaPreview').style.display='none'; document.getElementById('iuaRemove').style.display='none';
  document.getElementById('imgUploadArea').style.padding='32px 20px';
  const inp=document.getElementById('imgFileInput'); if(inp) inp.value='';
}
function removeImage(e){ e.stopPropagation(); currentImage={base64:null}; clearImagePreview(); }

function initDragUpload(){
  document.addEventListener('DOMContentLoaded',()=>{
    const area=document.getElementById('imgUploadArea'); if(!area) return;
    area.addEventListener('dragover',e=>{e.preventDefault();area.classList.add('drag-active');});
    area.addEventListener('dragleave',()=>area.classList.remove('drag-active'));
    area.addEventListener('drop',e=>{ e.preventDefault(); area.classList.remove('drag-active'); const f=e.dataTransfer.files[0]; if(f) processImageFile(f); });
  });
}

/* ── Color Sync ─────────────────────────────────────────── */
function initColorSync(){
  document.addEventListener('DOMContentLoaded',()=>{
    [['mGradFrom','mGradFromHex'],['mGradTo','mGradToHex']].forEach(([sid,hid])=>{
      const sw=document.getElementById(sid); const hex=document.getElementById(hid);
      if(sw&&hex){
        sw.addEventListener('input',()=>{ hex.value=sw.value; updateColorPreview(); });
        hex.addEventListener('input',()=>{ if(/^#[0-9a-fA-F]{6}$/.test(hex.value)){ sw.value=hex.value; updateColorPreview(); } });
      }
    });
    const vis=document.getElementById('mVisible');
    if(vis) vis.addEventListener('change',()=>{ document.getElementById('toggleLabel').textContent=vis.checked?'Visible':'Hidden'; });
    updateColorPreview();
  });
}
function updateColorPreview(){
  const from=document.getElementById('mGradFromHex')?.value||'#0d2d6b';
  const to=document.getElementById('mGradToHex')?.value||'#2a7fd4';
  const icon=document.getElementById('mIcon')?.value||'💊';
  const bar=document.getElementById('cpBar'); const ico=document.getElementById('cpIcon');
  if(bar) bar.style.background=`linear-gradient(180deg,${from},${to})`;
  if(ico){ ico.style.background=`linear-gradient(135deg,${from},${to})`; ico.textContent=icon; }
}

/* ── Hero Form ──────────────────────────────────────────── */
function renderHeroForm(){
  const h=state.hero;
  setValue('heroTitle',h.title||'Our'); setValue('heroHighlight',h.titleHighlight||'Products');
  setValue('heroSubtitle',h.subtitle||''); setValue('heroBadges',(h.badges||[]).join('\n'));
}
function saveHero(){
  state.hero={
    title:document.getElementById('heroTitle').value.trim(),
    titleHighlight:document.getElementById('heroHighlight').value.trim(),
    subtitle:document.getElementById('heroSubtitle').value.trim(),
    badges:document.getElementById('heroBadges').value.split('\n').map(b=>b.trim()).filter(Boolean)
  };
  saveDraft(); toast('Hero section saved','success');
}

/* ── Stats Form ─────────────────────────────────────────── */
function renderStatsForm(){
  const container=document.getElementById('statsEditor'); if(!container) return;
  const stats=state.stats.length?state.stats:[{number:'500',suffix:'+',label:'Product SKUs'},{number:'40',suffix:'+',label:'Global Brands'},{number:'6',suffix:'',label:'Core Categories'},{number:'100',suffix:'%',label:'Quality Verified'}];
  container.innerHTML=stats.map((s,i)=>`
    <div class="stat-edit-row">
      <div class="form-col"><label class="fl">Number ${i+1}</label><input class="fi stat-num" data-index="${i}" value="${escHtml(s.number)}" placeholder="500"/></div>
      <div class="form-col"><label class="fl">Suffix</label><input class="fi stat-suf" data-index="${i}" value="${escHtml(s.suffix)}" placeholder="+" style="max-width:70px"/></div>
      <div class="form-col"><label class="fl">Label</label><input class="fi stat-lbl" data-index="${i}" value="${escHtml(s.label)}" placeholder="Product SKUs"/></div>
    </div>`).join('');
}
function saveStats(){
  const nums=document.querySelectorAll('.stat-num'),sufs=document.querySelectorAll('.stat-suf'),lbls=document.querySelectorAll('.stat-lbl');
  state.stats=Array.from(nums).map((n,i)=>({number:n.value.trim(),suffix:sufs[i].value.trim(),label:lbls[i].value.trim()}));
  saveDraft(); toast('Stats saved','success');
}

/* ══════════════════════════════════════════════════════════
   GITHUB SETTINGS
══════════════════════════════════════════════════════════ */

let ghSettings = {
  token:    '',
  owner:    '',
  repo:     '',
  branch:   'main',
  filePath: 'data/products.json'
};

/* ── Load saved GitHub settings ─────────────────────────── */
function loadGitHubSettings() {
  const saved = localStorage.getItem('gh_settings');
  if (saved) { try { Object.assign(ghSettings, JSON.parse(saved)); } catch (_) {} }
  const st = sessionStorage.getItem('gh_token');
  if (st) ghSettings.token = st;

  setValue('ghToken',    ghSettings.token);
  setValue('ghOwner',    ghSettings.owner);
  setValue('ghRepo',     ghSettings.repo);
  setValue('ghBranch',   ghSettings.branch   || 'main');
  setValue('ghFilePath', ghSettings.filePath  || 'data/products.json');
}

/* ── Save GitHub settings ───────────────────────────────── */
function saveGitHubSettings() {
  ghSettings.token    = document.getElementById('ghToken')?.value.trim()    || '';
  ghSettings.owner    = document.getElementById('ghOwner')?.value.trim()    || '';
  ghSettings.repo     = document.getElementById('ghRepo')?.value.trim()     || '';
  ghSettings.branch   = document.getElementById('ghBranch')?.value.trim()   || 'main';
  ghSettings.filePath = document.getElementById('ghFilePath')?.value.trim() || 'data/products.json';

  // Token only in sessionStorage (safer — clears on tab close)
  sessionStorage.setItem('gh_token', ghSettings.token);

  // Save rest (no token) to localStorage
  localStorage.setItem('gh_settings', JSON.stringify({
    owner: ghSettings.owner, repo: ghSettings.repo,
    branch: ghSettings.branch, filePath: ghSettings.filePath
  }));

  toast('GitHub settings saved ✓', 'success');
}

/* ── Shared pre-flight checks ───────────────────────────── */
function syncGhFormFields() {
  ghSettings.token    = document.getElementById('ghToken')?.value.trim()    || ghSettings.token;
  ghSettings.owner    = document.getElementById('ghOwner')?.value.trim()    || ghSettings.owner;
  ghSettings.repo     = document.getElementById('ghRepo')?.value.trim()     || ghSettings.repo;
  ghSettings.branch   = (document.getElementById('ghBranch')?.value.trim()   || ghSettings.branch || 'main');
  ghSettings.filePath = (document.getElementById('ghFilePath')?.value.trim() || ghSettings.filePath || 'data/products.json');
}

function ghPreflightError() {
  // Must be served over HTTP/HTTPS — file:// blocks all cross-origin fetches
  if (window.location.protocol === 'file:') {
    const msg = '❌ Cannot reach GitHub from a local file. Open dashboard.html via a web server (e.g. VS Code Live Server, GitHub Pages, or any http:// URL).';
    showGhStatus('error', msg);
    toast(msg, 'error', 10000);
    return true;
  }
  if (!ghSettings.token) {
    showGhStatus('error', '❌ Enter your GitHub Personal Access Token first.');
    return true;
  }
  // Basic token shape check — GitHub PATs start with ghp_, github_pat_, or gho_
  if (!/^(ghp_|github_pat_|gho_|ghs_|v1\.)/.test(ghSettings.token) && ghSettings.token.length < 20) {
    showGhStatus('error', '❌ Token looks invalid. GitHub tokens start with "ghp_" or "github_pat_". Re-paste it from GitHub.');
    return true;
  }
  if (!ghSettings.owner || !ghSettings.repo) {
    showGhStatus('error', '❌ Fill in your GitHub Username and Repository Name.');
    return true;
  }
  return false;
}

function ghHeaders() {
  return {
    Authorization:  `token ${ghSettings.token}`,
    Accept:         'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };
}

async function ghFetch(url, opts = {}) {
  // Always explicit CORS mode so browsers don't silently block
  return fetch(url, { mode: 'cors', ...opts });
}

/* ── Test GitHub connection ─────────────────────────────── */
async function testGitHubConnection() {
  syncGhFormFields();
  if (ghPreflightError()) return;

  showGhStatus('loading', '⏳ Testing connection to GitHub…');
  try {
    const url = `https://api.github.com/repos/${ghSettings.owner}/${ghSettings.repo}/contents/${ghSettings.filePath}?ref=${ghSettings.branch}`;
    const res = await ghFetch(url, { headers: ghHeaders() });

    if (res.status === 200) {
      showGhStatus('success', `✅ Connected! Found "${ghSettings.filePath}" in ${ghSettings.owner}/${ghSettings.repo} (branch: ${ghSettings.branch}).`);
    } else if (res.status === 404) {
      // Could be missing file OR missing repo — try repo itself
      const repoRes = await ghFetch(`https://api.github.com/repos/${ghSettings.owner}/${ghSettings.repo}`, { headers: ghHeaders() });
      if (!repoRes.ok) {
        showGhStatus('error', `❌ Repository "${ghSettings.owner}/${ghSettings.repo}" not found. Check username and repo name.`);
      } else {
        showGhStatus('error', `❌ Repo found, but "${ghSettings.filePath}" doesn't exist yet. Upload products.json to your repo first, then retry.`);
      }
    } else if (res.status === 401) {
      showGhStatus('error', '❌ Authentication failed — token rejected. Ensure it has "repo" (or "Contents: write") scope and hasn\'t expired.');
    } else if (res.status === 403) {
      showGhStatus('error', '❌ Forbidden — token lacks permission. Re-generate with "repo" scope (classic token) or "Contents: write" (fine-grained token).');
    } else {
      const body = await res.json().catch(() => ({}));
      showGhStatus('error', `❌ GitHub API error ${res.status}: ${body.message || res.statusText}`);
    }
  } catch (e) {
    const hint = e.message.includes('fetch') || e.message.includes('network') || e.message.includes('Failed')
      ? ' — Make sure the dashboard is served over HTTP (not opened as a local file).'
      : '';
    showGhStatus('error', '❌ Network error: ' + e.message + hint);
  }
}

/* ── Publish to GitHub ──────────────────────────────────── */
async function publishToGitHub() {
  // Always pull latest values from form if visible, otherwise from storage
  const ghPanelVisible = !document.getElementById('panel-github')?.classList.contains('hidden');
  if (ghPanelVisible) { syncGhFormFields(); } else { loadGitHubSettings(); }

  if (ghPreflightError()) {
    // If we're not on the GitHub panel, also show a toast so it's seen
    if (!ghPanelVisible) toast('❌ Configure GitHub Settings first.', 'error'); 
    if (!ghPanelVisible) switchSection('github');
    return;
  }

  const tid = toast('⏳ Publishing to GitHub…', 'loading', 0);

  try {
    const payload  = buildPayload();
    const content  = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))));
    const fileUrl  = `https://api.github.com/repos/${ghSettings.owner}/${ghSettings.repo}/contents/${ghSettings.filePath}`;

    // 1. Get current SHA (required to update an existing file)
    let sha = null;
    const getRes = await ghFetch(`${fileUrl}?ref=${ghSettings.branch}`, { headers: ghHeaders() });
    if (getRes.ok) {
      const fileData = await getRes.json();
      sha = fileData.sha;
    } else if (getRes.status === 401 || getRes.status === 403) {
      const body = await getRes.json().catch(() => ({}));
      throw new Error(`Auth error ${getRes.status}: ${body.message || 'check token scope'}`);
    } else if (getRes.status !== 404) {
      throw new Error(`GitHub GET error ${getRes.status}`);
    }
    // 404 on GET = file doesn't exist yet → create it (sha stays null)

    // 2. Commit the updated file
    const commitBody = {
      message:  `Admin: Update products.json — ${new Date().toISOString()}`,
      content,
      branch:   ghSettings.branch,
    };
    if (sha) commitBody.sha = sha;

    const putRes = await ghFetch(fileUrl, {
      method:  'PUT',
      headers: ghHeaders(),
      body:    JSON.stringify(commitBody),
    });

    if (!putRes.ok) {
      const errJson = await putRes.json().catch(() => ({}));
      throw new Error(errJson.message || `GitHub PUT error ${putRes.status}`);
    }

    saveDraft(payload);
    dismissToast(tid);
    showGhStatus('success', '✅ Published! GitHub Pages will serve the update in ~30 seconds.');
    toast('✅ Published to GitHub successfully!', 'success', 6000);

  } catch (e) {
    dismissToast(tid);
    const hint = e.message.toLowerCase().includes('failed to fetch')
      ? '\n\nThis is usually a network/CORS issue. Make sure:\n• Dashboard is served via HTTP (not file://)\n• Your token is valid and has "repo" scope'
      : '';
    showGhStatus('error', '❌ ' + e.message + hint);
    toast('❌ Publish failed: ' + e.message, 'error', 8000);
  }
}

/* ── GitHub Status & Token Toggle ───────────────────────── */
function showGhStatus(type, msg) {
  const el = document.getElementById('ghStatus'); if (!el) return;
  el.className = 'gh-status ' + type; el.textContent = msg;
}
function toggleToken() {
  const inp = document.getElementById('ghToken'); if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
}

/* ── Navigation ─────────────────────────────────────────── */
function initNavigation(){
  document.querySelectorAll('.nav-item[data-section]').forEach(item=>{
    item.addEventListener('click',e=>{ e.preventDefault(); switchSection(item.dataset.section); if(window.innerWidth<=900) toggleSidebar(false); });
  });
}
function switchSection(sec){
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.querySelector(`.nav-item[data-section="${sec}"]`)?.classList.add('active');
  document.querySelectorAll('.section-panel').forEach(p=>p.classList.add('hidden'));
  document.getElementById(`panel-${sec}`)?.classList.remove('hidden');
  const titles={products:'Products',hero:'Hero Section',stats:'Stats Bar',github:'GitHub Settings'};
  const t=titles[sec]||sec;
  const te=document.getElementById('sectionTitle'); const be=document.getElementById('breadcrumbSpan');
  if(te) te.textContent=t; if(be) be.textContent=t;
  if(sec==='github'){
    loadGitHubSettings();
    const warn=document.getElementById('fileProtocolWarning');
    if(warn) warn.style.display=window.location.protocol==='file:'?'flex':'none';
  }
}

/* ── Sidebar Toggle ─────────────────────────────────────── */
function toggleSidebar(forceClose){
  const s=document.getElementById('sidebar'); const o=document.getElementById('sidebarOverlay');
  const open=forceClose===false?false:!s.classList.contains('open');
  s.classList.toggle('open',open); o.classList.toggle('visible',open);
  document.body.style.overflow=open?'hidden':'';
}

/* ── Logout ─────────────────────────────────────────────── */
function doLogout(){ if(!confirm('Log out of the admin dashboard?')) return; sessionStorage.clear(); window.location.href='login.html'; }

/* ── Toast ──────────────────────────────────────────────── */
let toastIdCounter=0;
function toast(msg,type='info',duration=3500){
  const container=document.getElementById('toastContainer');
  const id='toast_'+(++toastIdCounter);
  const icons={success:'✅',error:'❌',info:'ℹ️',loading:'⏳'};
  const el=document.createElement('div'); el.className=`toast ${type}`; el.id=id;
  el.innerHTML=`<span>${icons[type]||'ℹ️'}</span><span>${msg}</span>`;
  container.appendChild(el);
  if(duration>0) setTimeout(()=>dismissToast(id),duration);
  return id;
}
function dismissToast(id){
  const el=document.getElementById(id); if(!el) return;
  el.style.animation='toastOut 0.35s ease forwards';
  setTimeout(()=>el.remove(),350);
}

/* ── Utilities ──────────────────────────────────────────── */
function escHtml(str){ if(!str) return ''; return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function setValue(id,val){ const el=document.getElementById(id); if(el) el.value=val||''; }

/* ── Default Data ───────────────────────────────────────── */
function getDefaultData(){
  return {
    meta:{lastUpdated:new Date().toISOString(),version:'1.0'},
    hero:{title:'Our',titleHighlight:'Products',subtitle:"Discover AL AROUBA HEALTH's curated range of premium pharmaceutical, medical, and wellness products.",badges:['WHO-GMP Certified','Cold Chain Managed','Regulatory Compliant','Expert Medical Team']},
    stats:[{number:'500',suffix:'+',label:'Product SKUs'},{number:'40',suffix:'+',label:'Global Brands'},{number:'6',suffix:'',label:'Core Categories'},{number:'100',suffix:'%',label:'Quality Verified'}],
    section:{label:'WHAT WE CARRY',title:'Comprehensive Healthcare Product Portfolio',subtitle:'Every product in our portfolio meets stringent international standards.'},
    products:[
      {id:'prod_001',visible:true,order:1,icon:'💊',gradientFrom:'#0d2d6b',gradientTo:'#2a7fd4',title:'Pharmaceuticals',description:'Prescription and OTC medications from WHO-GMP certified manufacturers.',tags:['Antibiotics','Cardiology','Diabetes Care','Pain Relief','Oncology'],image:''},
      {id:'prod_002',visible:true,order:2,icon:'🩺',gradientFrom:'#059669',gradientTo:'#34d399',title:'Medical Devices & Equipment',description:'CE-marked and FDA-registered diagnostic tools and monitoring devices.',tags:['Diagnostics','Monitoring','Surgical Tools','Rehabilitation'],image:''},
      {id:'prod_003',visible:true,order:3,icon:'🧴',gradientFrom:'#be185d',gradientTo:'#f472b6',title:'Cosmetics & Dermatology',description:'Medically formulated skincare and dermocosmetics.',tags:['Skincare','Sunscreen','Anti-Aging','Wound Care'],image:''},
      {id:'prod_004',visible:true,order:4,icon:'🌿',gradientFrom:'#d97706',gradientTo:'#fbbf24',title:'Vitamins & Supplements',description:'High-bioavailability vitamins, minerals, and nutraceuticals.',tags:['Multivitamins','Omega-3','Probiotics','Immunity'],image:''},
      {id:'prod_005',visible:true,order:5,icon:'🩹',gradientFrom:'#7c3aed',gradientTo:'#a78bfa',title:'Medical Consumables',description:'Sterile disposables and clinical consumables.',tags:['Gloves','Syringes','Bandages','IV Supplies'],image:''},
      {id:'prod_006',visible:true,order:6,icon:'👶',gradientFrom:'#0891b2',gradientTo:'#67e8f9',title:'Baby & Mother Care',description:'Clinically tested products for newborns, infants, and mothers.',tags:['Infant Formula','Baby Skincare','Postnatal','Pediatrics'],image:''}
    ]
  };
}
