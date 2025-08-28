(function(){
  const $  = s => document.querySelector(s);

  let tick = null;

  function cap(s){ return (s||"").charAt(0).toUpperCase() + (s||"").slice(1); }
  function setText(sel, txt){ const el=$(sel); if(el) el.textContent = txt||""; }

  function renderResources(state){
    const res = state.resources || {};
    const order = (state.resource_order && state.resource_order.length) ? state.resource_order : Object.keys(res).sort();
    setText(".resbar", order.map(k => `${cap(k)}: ${res[k] ?? 0}`).join(" • "));
  }

  function renderScene(state){
    setText(".title", state.title || "");
    setText(".desc", state.description || "");

    const wrap = $(".choices");
    if(!wrap) return;
    wrap.innerHTML = "";

    (state.choices || []).forEach(c => {
      const box = document.createElement("div");
      box.className = "choice";
      box.dataset.key = c.key;
      box.innerHTML = `
        <div class="label">${c.label || ""}</div>
        <div class="effects">${c.effects_text || ""}</div>
      `;
      if(state.last_choice_key && state.last_choice_key === c.key){
        box.classList.add("selected");
      }
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
    renderScene(state);   // <-- renders effects_text under each choice
    renderResult(state);
    renderTimer(state);

    // blackout
    let b = document.querySelector(".blackout");
    if(state.blackout){
      if(!b){ b = document.createElement("div"); b.className="blackout"; document.body.appendChild(b); }
    }else if(b){ b.remove(); }

    // background + dim
    const dimEl = document.querySelector(".dim");
    if(dimEl) dimEl.style.setProperty("--dim", String(state.bg_dim ?? 0.35));
    const bg = document.querySelector(".bg");
    if(bg) bg.style.backgroundImage = state.bg_url ? `url(${state.bg_url})` : "none";
  }

  function connect(){
    const es = new EventSource("/stream");
    es.onmessage = e => { try{ applyState(JSON.parse(e.data)); }catch(_){} };
  }

  document.addEventListener("DOMContentLoaded", connect);
})();
