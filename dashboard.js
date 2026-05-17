/* ═══════════════════════════════════════════════════════════════
   AL AROUBA HEALTH — Admin Dashboard JS (Cloudflare Edition)
   Storage  : Cloudflare KV  (via Worker API)
   Images   : Cloudflare Images  (via Worker API)
   Auth     : JWT via Worker /api/auth/login
   Hosting  : Cloudflare Pages
═══════════════════════════════════════════════════════════════ */
'use strict';

const CONFIG = {
  workerUrl:    localStorage.getItem('cf_worker_url')  || '',
  imagesBaseUrl:localStorage.getItem('cf_images_base') || '',
};

let state       = { products:[], hero:{}, stats:[], section:{}, meta:{} };
let authToken   = sessionStorage.getItem('admin_jwt') || null;
let editingId   = null;
let currentImage= { base64:null, cfImageId:null, cfImageUrl:null };
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
  loadCFSettings(); loadData(); initNavigation(); initColorSync(); initDragUpload();
});

/* ── API Helper ─────────────────────────────────────────── */
async function apiCall(path,method='GET',body=null,isForm=false){
  const url=CONFIG.workerUrl.replace(/\/$/,'')+path;
  const headers={};
  if(authToken) headers['Authorization']=`Bearer ${authToken}`;
  if(body&&!isForm) headers['Content-Type']='application/json';
  const opts={method,headers};
  if(body) opts.body=isForm?body:JSON.stringify(body);
  const res=await fetch(url,opts);
  const data=await res.json().catch(()=>({error:'Non-JSON response'}));
  if(!res.ok) throw new Error(data.error||`API error ${res.status}`);
  return data;
}

/* ── Data Load ──────────────────────────────────────────── */
async function loadData(){
  if(!CONFIG.workerUrl){ loadLocalFallback(); return; }
  const tid=toast('Loading from Cloudflare KV…','loading',0);
  try{ const data=await apiCall('/api/products'); applyData(data); dismissToast(tid); toast('Loaded from Cloudflare KV ✓','success'); }
  catch(e){ dismissToast(tid); toast('Worker unreachable — using local draft','info'); loadLocalFallback(); }
}

function loadLocalFallback(){
  const draft=localStorage.getItem('products_draft');
  if(draft){ try{ applyData(JSON.parse(draft)); toast('Loaded from local draft','info'); return; }catch(_){} }
  applyData(getDefaultData()); toast('Using defaults — configure Cloudflare Worker','info');
}

async function loadFromCloudflare(){
  if(!CONFIG.workerUrl){ toast('Set Worker URL in Cloudflare Settings first','error'); switchSection('cloudflare'); return; }
  const tid=toast('Pulling from Cloudflare KV…','loading',0);
  try{ const data=await apiCall('/api/products'); applyData(data); dismissToast(tid); toast('Synced from Cloudflare KV ✓','success'); }
  catch(e){ dismissToast(tid); toast('Pull failed: '+e.message,'error'); }
}

function applyData(data){
  state.products=(data.products||[]).sort((a,b)=>a.order-b.order);
  state.hero=data.hero||{}; state.stats=data.stats||[];
  state.section=data.section||{}; state.meta=data.meta||{};
  renderProducts(); renderHeroForm(); renderStatsForm();
}

/* ── Publish ────────────────────────────────────────────── */
async function publishChanges(){
  if(!CONFIG.workerUrl){ toast('Configure Cloudflare Worker URL first','error'); switchSection('cloudflare'); return; }
  if(!document.getElementById('panel-hero').classList.contains('hidden'))  saveHero();
  if(!document.getElementById('panel-stats').classList.contains('hidden')) saveStats();
  const tid=toast('Publishing to Cloudflare KV…','loading',0);
  try{
    const payload=buildPayload();
    await apiCall('/api/products','PUT',payload);
    saveDraft(payload); dismissToast(tid);
    toast('✅ Published to Cloudflare KV! Live instantly.','success',5000);
  }catch(e){ dismissToast(tid); toast('❌ Publish failed: '+e.message,'error',7000); }
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
  const imgSrc=p.cfImageUrl||p.image||'';
  const iconHtml=imgSrc?`<img src="${imgSrc}" alt="${escHtml(p.title)}" style="width:100%;height:100%;object-fit:cover;border-radius:14px;"/>`:escHtml(p.icon||'💊');
  const tags=(p.tags||[]).slice(0,4).map(t=>`<span class="pac-tag">${escHtml(t)}</span>`).join('');
  const cfBadge=p.cfImageId?`<span style="font-size:0.65rem;color:#7ec8f7;background:rgba(42,127,212,0.15);padding:2px 8px;border-radius:100px;">☁ CF Image</span>`:'';
  return `<div class="prod-admin-card ${p.visible?'':'hidden-card'}" data-id="${p.id}" data-index="${i}" draggable="true">
    <div class="pac-drag-handle">⋮⋮</div>
    <div class="pac-stripe" style="background:${grad};"></div>
    <div class="pac-body">
      <div class="pac-top">
        <div class="pac-icon" style="background:${grad};">${iconHtml}</div>
        <div class="pac-controls">
          <span class="pac-badge-visible ${p.visible?'yes':'no'}">${p.visible?'● Visible':'○ Hidden'}</span>
          <span class="pac-order">#${i+1}</span>${cfBadge}
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
  editingId=null; currentImage={base64:null,cfImageId:null,cfImageUrl:null};
  document.getElementById('modalTitle').textContent='Add New Product';
  document.getElementById('modalDeleteBtn').style.display='none';
  setModalFields({icon:'💊',visible:true,gradientFrom:'#0d2d6b',gradientTo:'#2a7fd4',title:'',description:'',tags:[],image:''});
  openModal();
}
function openEditModal(id){
  const p=state.products.find(x=>x.id===id); if(!p) return;
  editingId=id; currentImage={base64:p.image||null,cfImageId:p.cfImageId||null,cfImageUrl:p.cfImageUrl||null};
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
  const imgSrc=p.cfImageUrl||p.image||'';
  imgSrc?showImagePreview(imgSrc):clearImagePreview();
  updateColorPreview();
}
function openModal(){ document.getElementById('productModal').classList.add('open'); document.body.style.overflow='hidden'; setTimeout(()=>document.getElementById('mTitle').focus(),200); }
function closeModal(){ document.getElementById('productModal').classList.remove('open'); document.body.style.overflow=''; editingId=null; currentImage={base64:null,cfImageId:null,cfImageUrl:null}; }

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
    image:currentImage.base64||'', cfImageId:currentImage.cfImageId||'', cfImageUrl:currentImage.cfImageUrl||'',
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
  if(p.cfImageId&&CONFIG.workerUrl) apiCall(`/api/images/${p.cfImageId}`,'DELETE').catch(()=>{});
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
  if(CONFIG.workerUrl){
    const tid=toast('Uploading to Cloudflare Images…','loading',0);
    try{
      const blob=await(await fetch(compressed)).blob();
      const form=new FormData(); form.append('file',blob,file.name);
      const result=await apiCall('/api/images/upload','POST',form,true);
      currentImage.cfImageId=result.imageId; currentImage.cfImageUrl=result.imageUrl; currentImage.base64=result.imageUrl;
      showImagePreview(result.imageUrl); dismissToast(tid); toast('☁️ Uploaded to Cloudflare Images ✓','success');
    }catch(e){ dismissToast(tid); toast('CF Images upload failed — using local preview','info'); }
  } else { toast('Image ready (configure Worker to use Cloudflare Images)','info'); }
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
function removeImage(e){ e.stopPropagation(); currentImage={base64:null,cfImageId:null,cfImageUrl:null}; clearImagePreview(); }

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
      const sw=document.getElementById(sid); const hx=document.getElementById(hid); if(!sw||!hx) return;
      sw.addEventListener('input',()=>{hx.value=sw.value;updateColorPreview();});
      hx.addEventListener('input',()=>{if(/^#[0-9a-fA-F]{6}$/.test(hx.value)){sw.value=hx.value;updateColorPreview();}});
    });
    document.getElementById('mIcon')?.addEventListener('input',updateColorPreview);
    document.getElementById('mVisible')?.addEventListener('change',()=>{ document.getElementById('toggleLabel').textContent=document.getElementById('mVisible').checked?'Visible':'Hidden'; });
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

/* ── Cloudflare Settings ────────────────────────────────── */
function loadCFSettings(){
  setValue('cfWorkerUrl',localStorage.getItem('cf_worker_url')||'');
  setValue('cfImagesBase',localStorage.getItem('cf_images_base')||'');
}
function saveCFSettings(){
  const wu=document.getElementById('cfWorkerUrl')?.value.trim().replace(/\/$/,'')||'';
  const ib=document.getElementById('cfImagesBase')?.value.trim()||'';
  CONFIG.workerUrl=wu; CONFIG.imagesBaseUrl=ib;
  localStorage.setItem('cf_worker_url',wu); localStorage.setItem('cf_images_base',ib);
  toast('Cloudflare settings saved ✓','success');
}
async function testCFConnection(){
  const url=document.getElementById('cfWorkerUrl')?.value.trim().replace(/\/$/,'');
  if(!url){ showCFStatus('error','❌ Enter your Worker URL first.'); return; }
  showCFStatus('loading','⏳ Testing connection to Worker…');
  try{
    const res=await fetch(url+'/api/health'); if(!res.ok) throw new Error(`Status ${res.status}`);
    const data=await res.json();
    showCFStatus('success',`✅ Worker online! Server time: ${data.timestamp}`);
  }catch(e){ showCFStatus('error','❌ Cannot reach Worker: '+e.message); }
}
function showCFStatus(type,msg){ const el=document.getElementById('cfStatus'); if(!el) return; el.className='gh-status '+type; el.textContent=msg; }

/* ── Navigation ─────────────────────────────────────────── */
function initNavigation(){
  document.addEventListener('DOMContentLoaded',()=>{
    document.querySelectorAll('.nav-item[data-section]').forEach(item=>{
      item.addEventListener('click',e=>{ e.preventDefault(); switchSection(item.dataset.section); if(window.innerWidth<=900) toggleSidebar(false); });
    });
  });
}
function switchSection(sec){
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.querySelector(`.nav-item[data-section="${sec}"]`)?.classList.add('active');
  document.querySelectorAll('.section-panel').forEach(p=>p.classList.add('hidden'));
  document.getElementById(`panel-${sec}`)?.classList.remove('hidden');
  const titles={products:'Products',hero:'Hero Section',stats:'Stats Bar',cloudflare:'Cloudflare Settings'};
  const t=titles[sec]||sec;
  const te=document.getElementById('sectionTitle'); const be=document.getElementById('breadcrumbSpan');
  if(te) te.textContent=t; if(be) be.textContent=t;
  if(sec==='cloudflare') loadCFSettings();
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
      {id:'prod_001',visible:true,order:1,icon:'💊',gradientFrom:'#0d2d6b',gradientTo:'#2a7fd4',title:'Pharmaceuticals',description:'Prescription and OTC medications from WHO-GMP certified manufacturers.',tags:['Antibiotics','Cardiology','Diabetes Care','Pain Relief','Oncology'],image:'',cfImageId:'',cfImageUrl:''},
      {id:'prod_002',visible:true,order:2,icon:'🩺',gradientFrom:'#059669',gradientTo:'#34d399',title:'Medical Devices & Equipment',description:'CE-marked and FDA-registered diagnostic tools and monitoring devices.',tags:['Diagnostics','Monitoring','Surgical Tools','Rehabilitation'],image:'',cfImageId:'',cfImageUrl:''},
      {id:'prod_003',visible:true,order:3,icon:'🧴',gradientFrom:'#be185d',gradientTo:'#f472b6',title:'Cosmetics & Dermatology',description:'Medically formulated skincare and dermocosmetics.',tags:['Skincare','Sunscreen','Anti-Aging','Wound Care'],image:'',cfImageId:'',cfImageUrl:''},
      {id:'prod_004',visible:true,order:4,icon:'🌿',gradientFrom:'#d97706',gradientTo:'#fbbf24',title:'Vitamins & Supplements',description:'High-bioavailability vitamins, minerals, and nutraceuticals.',tags:['Multivitamins','Omega-3','Probiotics','Immunity'],image:'',cfImageId:'',cfImageUrl:''},
      {id:'prod_005',visible:true,order:5,icon:'🩹',gradientFrom:'#7c3aed',gradientTo:'#a78bfa',title:'Medical Consumables',description:'Sterile disposables and clinical consumables.',tags:['Gloves','Syringes','Bandages','IV Supplies'],image:'',cfImageId:'',cfImageUrl:''},
      {id:'prod_006',visible:true,order:6,icon:'👶',gradientFrom:'#0891b2',gradientTo:'#67e8f9',title:'Baby & Mother Care',description:'Clinically tested products for newborns, infants, and mothers.',tags:['Infant Formula','Baby Skincare','Postnatal','Pediatrics'],image:'',cfImageId:'',cfImageUrl:''}
    ]
  };
}
