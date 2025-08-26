function post(url, body) {
    return fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body||{})});
  }
  
  /* YAML load & scene list */
  async function loadYaml() {
    const path = document.getElementById('yaml_path').value || 'scenes.yaml';
    const r = await post('/api/load_yaml', {path});
    const data = await r.json();
    const st = document.getElementById('load_status');
    if (!data.ok) { st.textContent = 'Error: ' + (data.error||''); return; }
    st.textContent = 'Loaded';
    await populateScenes();
    await refreshResources();
    await refreshCurrentScenePreview();
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
      const b = document.createElement('button');
      b.className = 'choice';
      b.innerHTML = `<div class="main">${(c.label||'')}</div><div class="sub">${(c.effects_text||'')}</div>`;
      b.onclick = ()=> choose(c.key);
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
  function timerSet() { const seconds = parseMMSS(document.getElementById('mmss').value); post('/api/timer', {action:'set', seconds, show:true}); }
  function timerStart(){ post('/api/timer', {action:'start', show:true}); }
  function timerStop() { post('/api/timer', {action:'stop'}); }
  function timerAdd(d) { post('/api/timer', {action:'add', delta:d}); }
  function timerToggle(){ post('/api/timer', {action:'toggle_visibility'}); }
  
  /* Init */
  (async ()=>{
    await populateScenes().catch(()=>{});
    await refreshResources().catch(()=>{});
    await refreshCurrentScenePreview().catch(()=>{});
  })();
  