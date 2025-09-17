function post(url, body) {
  return fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body||{})});
}

/* YAML load & scene list */
async function loadYaml() {
  // if a file is selected, upload its contents directly; otherwise load via path
  const fileInp = document.getElementById('yaml_file');
  const st = document.getElementById('load_status');
  st.textContent = '';
  try {
    if (fileInp && fileInp.files && fileInp.files.length > 0) {
      const file = fileInp.files[0];
      const text = await file.text();
      const r = await post('/api/upload_yaml', {data: text});
      const data = await r.json();
      if(!data.ok){ st.textContent = 'Error: ' + (data.error||''); return; }
      st.textContent = 'Loaded';
    } else {
      const path = document.getElementById('yaml_path').value || 'scenes.yaml';
      const r = await post('/api/load_yaml', {path});
      const data = await r.json();
      if(!data.ok){ st.textContent = 'Error: ' + (data.error||''); return; }
      st.textContent = 'Loaded';
    }
    await populateScenes();
    await refreshResources();
    await refreshCurrentScenePreview();
  } catch (err) {
    st.textContent = 'Error: ' + (err.message || err);
  }
}
async function populateScenes() {
  const r = await fetch('/api/scenes');
  const data = await r.json();
  const sel = document.getElementById('scene_select');
  sel.innerHTML = '';
  (data.scenes||[]).forEach(s=>{
    const opt = document.createElement('option');
    opt.value = s.id; opt.textContent = s.title ? `${s.title} (${s.id})` : s.id;
    sel.appendChild(opt);
  });
}
async function selectScene() {
  const id = document.getElementById('scene_select').value;
  await post('/api/select_scene', {id});
  await refreshCurrentScenePreview();
}

/* Preview + choices */
async function refreshCurrentScenePreview() {
  const r = await fetch('/api/state');
  const s = await r.json();
  if (!s) return;
  document.getElementById('scene_title').textContent = s.title || '';
  document.getElementById('scene_desc').textContent  = s.description || '';
  const box = document.getElementById('scene_choices');
  box.innerHTML = '';
  (s.choices||[]).forEach(c=>{
    const b = document.createElement('div');
    b.className = 'choice';
    b.style.padding='8px 10px';
    b.style.background='#2a3040';
    b.style.borderRadius='8px';
    b.style.margin='4px 0';
    b.innerHTML = `<div class="main" style="font-weight:600">${(c.label||'')}</div><div class="sub" style="font-size:12px;color:#b6c0f5">${(c.effects_text||'')}</div>`;

    // A/B checkboxes
    const row = document.createElement('div');
    row.style.display='flex'; row.style.alignItems='center'; row.style.gap='12px'; row.style.marginTop='6px';
    const lA = document.createElement('label'); lA.textContent='A'; lA.style.display='flex'; lA.style.gap='6px'; lA.style.alignItems='center';
    const cbA = document.createElement('input'); cbA.type='checkbox'; cbA.addEventListener('change', async ()=>{
      if(cbA.checked){
        // Uncheck other A boxes
        box.querySelectorAll('input[data-leader="A"]').forEach(o=>{ if(o!==cbA) o.checked=false; });
        await post('/api/leader_select', {leader:'A', choice:c.key});
      }else{
        await post('/api/leader_select', {leader:'A', choice:null});
      }
    });
    cbA.setAttribute('data-leader','A');
    lA.prepend(cbA);
    const lB = document.createElement('label'); lB.textContent='B'; lB.style.display='flex'; lB.style.gap='6px'; lB.style.alignItems='center';
    const cbB = document.createElement('input'); cbB.type='checkbox'; cbB.addEventListener('change', async ()=>{
      if(cbB.checked){
        box.querySelectorAll('input[data-leader="B"]').forEach(o=>{ if(o!==cbB) o.checked=false; });
        await post('/api/leader_select', {leader:'B', choice:c.key});
      }else{
        await post('/api/leader_select', {leader:'B', choice:null});
      }
    });
    cbB.setAttribute('data-leader','B');
    lB.prepend(cbB);
    row.appendChild(lA); row.appendChild(lB);
    // selection button; clicking will resolve the choice
    const selBtn = document.createElement('button');
    selBtn.textContent = 'Select';
    selBtn.style.padding = '4px 8px';
    selBtn.style.fontSize = '12px';
    selBtn.style.borderRadius = '4px';
    selBtn.style.cursor = 'pointer';
    selBtn.style.background = '#3a66ff';
    selBtn.style.color = 'white';
    selBtn.addEventListener('click', async (ev)=>{
      ev.stopPropagation();
      await choose(c.key);
    });
    row.appendChild(selBtn);
    b.appendChild(row);

    // clicking on the card (outside of button/checkbox) also resolves the choice
    b.addEventListener('click', async (ev)=>{
      if(ev.target === cbA || ev.target === cbB || ev.target === selBtn) return;
      await choose(c.key);
    });

    box.appendChild(b);
  });
}

async function choose(key) {
  await post('/api/choice', {key});
  await refreshResources();
  await refreshCurrentScenePreview();
}

/* Resources */
async function refreshResources() {
  const r = await fetch('/api/resources');
  const data = await r.json();
  const box = document.getElementById('resources_box');
  box.innerHTML = '';
  const res = data.resources || {};
  Object.keys(res).sort().forEach(name=>{
    const val = res[name];
    const card = document.createElement('div');
    card.className = 'resitem';
    card.innerHTML = `
      <div class="name">${name}</div>
      <div class="controls">
        <button onclick="bump('${name}',-1)">-</button>
        <input id="res_${name}" type="number" value="${val}">
        <button onclick="bump('${name}',+1)">+</button>
      </div>`;
    box.appendChild(card);
  });
}
async function bump(name, d) {
  await post('/api/resources', {delta: {[name]: d}});
  await refreshResources();
}
async function saveResources() {
  const inputs = Array.from(document.querySelectorAll('[id^=res_]'));
  const values = {};
  inputs.forEach(inp=>{
    const name = inp.id.replace('res_','');
    values[name] = parseInt(inp.value||'0',10);
  });
  await post('/api/resources', {values});
  await refreshResources();
}

/* Background + utilities */
function setBlackout(v){ post('/api/blackout', {value: !!v}); }
function setBg() {
  const url = document.getElementById('bg_url').value;
  const dim = parseFloat(document.getElementById('bg_dim').value||'0.35')||0.35;
  post('/api/background', {url, dim});
}
function clearBg() { post('/api/background', {url:'', dim:0.35}); }

/* Timer */
function parseMMSS(s) {
  s = (s||'').trim();
  if (s.includes(':')) {
    const [m, ss] = s.split(':');
    return Math.max(0, (parseInt(m||'0',10)||0)*60 + (parseInt(ss||'0',10)||0));
  }
  if (/^\d+$/.test(s)) return parseInt(s,10)*60;
  return 0;
}
function timerSet()  { const seconds = parseMMSS(document.getElementById('mmss').value); post('/api/timer', {action:'set', seconds, show:true}); }
function timerStart(){ post('/api/timer', {action:'start', show:true}); }
function timerStop() { post('/api/timer', {action:'stop'}); }
function timerAdd(d){ post('/api/timer', {action:'add',  delta:d}); }
function timerToggle(){ post('/api/timer', {action:'toggle_visibility'}); }

/* Init */
(async ()=>{
  await populateScenes().catch(()=>{});
  await refreshResources().catch(()=>{});
  await refreshCurrentScenePreview().catch(()=>{});
})();
