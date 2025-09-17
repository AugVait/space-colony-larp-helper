(function(){
  const $  = s => document.querySelector(s);
  let tick = null;

  // Resource icons
  const ICONS = { population:"👥", food:"🍞", morale:"🙂", infrastructure:"🏗️" };

  function setText(sel, txt){ const el=$(sel); if(el) el.textContent = txt||""; }

  function renderResources(state){
    const res = state.resources || {};
    const order = (state.resource_order && state.resource_order.length) ? state.resource_order : Object.keys(res).sort();
    const pills = order.map(k => `${ICONS[k]||""}${res[k] ?? 0}`);
    setText(".resbar", pills.join("   "));
  }

  function renderScene(state){
    setText(".title", state.title || "");
    setText(".desc", state.description || "");

    const wrap = $(".choices");
    if(!wrap) return;
    wrap.innerHTML = "";

    const resolvedKey = state.last_choice_key || null;
    (state.choices || []).forEach(c => {
      const box = document.createElement("div");
      box.className = "choice";
      box.dataset.key = c.key;

      const label = document.createElement("div");
      label.className = "label";
      label.textContent = c.label || "";
      box.appendChild(label);

      const eff = document.createElement("div");
      eff.className = "effects";
      // show effects only for the choice actually resolved
      if(resolvedKey && resolvedKey === c.key && c.effects_text){
        const parts = c.effects_text.split(",").map(s=>s.trim());
        const shown = parts.map(p => {
          const [val, res] = p.split(/\s+/);
          return `${val}${ICONS[res]||""}`;
        });
        eff.textContent = shown.join(" ");
      } else {
        eff.textContent = ""; // hide before resolution or other choices
      }
      box.appendChild(eff);

      if(state.last_choice_key && state.last_choice_key === c.key){
        box.classList.add("selected");
      }

      const gs = state.group_selected || {};
      if(gs.A === c.key) box.classList.add("green");
      if(gs.B === c.key) box.classList.add("red");

      wrap.appendChild(box);
    });
  }

  function renderResult(state){
    setText(".result", state.last_result_text || "");
  }

  function renderTimer(state){
    const el = $(".timer");
    if(!el) return;
    if(!state.show_timer){
      el.style.display = "none";
      if(tick){ clearInterval(tick); tick=null; }
      return;
    }
    el.style.display = "block";
    const update = ()=>{
      let s = 0;
      if(state.timer_running && state.timer_ends_at){
        s = Math.max(0, Math.round(state.timer_ends_at - Date.now()/1000));
      }else{
        s = Math.max(0, parseInt(state.timer_seconds||0,10));
      }
      const m = Math.floor(s/60), r = s%60;
      el.textContent = `${m}:${String(r).padStart(2,"0")}`;
    };
    update();
    if(tick) clearInterval(tick);
    tick = setInterval(update, 1000);
  }

  function applyState(state){
    renderResources(state);
    renderScene(state);
    renderResult(state);
    renderTimer(state);

    let b = document.querySelector(".blackout");
    if(state.blackout){
      if(!b){ b = document.createElement("div"); b.className="blackout"; document.body.appendChild(b); }
    }else if(b){ b.remove(); }

    const dimEl = document.querySelector(".dim");
    if(dimEl) dimEl.style.setProperty("--dim", String(state.bg_dim ?? 0.35));
    const bg = document.querySelector(".bg");
    if(bg) bg.style.backgroundImage = state.bg_url ? `url(${state.bg_url})` : "none";
  }

  function connect(){
    const es = new EventSource("/stream");
    es.onmessage = e => { try{ applyState(JSON.parse(e.data)); }catch(_){ } };
  }

  document.addEventListener("DOMContentLoaded", connect);
})();
