const API = {
  state: () => fetch("/api/state").then(r=>r.json()),
  select: (leader, choice_id) => fetch("/api/select", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({leader, choice_id})
  }).then(r=>r.json()),
  reset: () => fetch("/api/reset",{method:"POST"}).then(r=>r.json()),
  prev: () => fetch("/api/scene/prev",{method:"POST"}).then(r=>r.json()),
  next: () => fetch("/api/scene/next",{method:"POST"}).then(r=>r.json()),
  emoji: () => fetch("/api/emoji").then(r=>r.json()),
};

const EMOJI = window.RESOURCE_EMOJI_FROM_TEMPLATE || {};

function $(q, root=document){ return root.querySelector(q); }

function renderGM(state){
  const s = state.scene;
  $("#sceneTitle").textContent = `${s.title} (${s.index+1}/${s.count})`;
  $("#sceneDesc").textContent = s.description || "";

  const renderSide = (leader, mountSel) => {
    const mount = $(mountSel);
    mount.innerHTML = "";
    const options = (s.choices?.[leader] || []);
    const selected = state.selections?.[leader] || null;

    options.forEach(opt => {
      const wrap = document.createElement("label");
      wrap.className = "choice";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `choice_${leader}`;
      input.value = opt.id;
      input.checked = (opt.id === selected);
      input.addEventListener("change", async () => {
        await API.select(leader, opt.id);
      });
      const text = document.createElement("div");
      text.innerHTML = `<strong>${opt.text}</strong>`;
      wrap.appendChild(input);
      wrap.appendChild(text);
      mount.appendChild(wrap);
    });
  };

  renderSide("A", "#formA");
  renderSide("B", "#formB");
}

function renderPlayer(state){
  const s = state.scene;
  $("#sceneTitle").textContent = s.title || "";
  $("#sceneDesc").textContent = s.description || "";

  const selections = state.selections || {};

  const renderSide = (leader, mountId, selClass) => {
    const mount = $(mountId);
    mount.innerHTML = "";
    const options = (s.choices?.[leader] || []);
    const selectedId = selections?.[leader] || null;

    options.forEach(opt => {
      const card = document.createElement("div");
      card.className = "card";
      if (selectedId === opt.id) card.classList.add(selClass); // outline color

      const p = document.createElement("p");
      p.className = "text";
      p.textContent = opt.text;
      card.appendChild(p);

      // Show consequences ONLY after a choice is made
      if (selectedId === opt.id) {
        const c = document.createElement("div");
        c.className = "conseq";
        c.textContent = formatConsequences(opt.consequences || {});
        card.appendChild(c);
      }

      mount.appendChild(card);
    });
  };

  renderSide("A", "#playerA", "selected-a");
  renderSide("B", "#playerB", "selected-b");

  // Legend shows emojis only
  const legend = $("#emojiLegend");
  if (legend && legend.childElementCount === 0) {
    Object.values(EMOJI).forEach(e => {
      const pill = document.createElement("div");
      pill.className = "emoji-pill";
      pill.textContent = e;
      legend.appendChild(pill);
    });
  }
}

function formatConsequences(obj){
  const parts = [];
  for (const [k,v] of Object.entries(obj || {})){
    if (typeof v !== "number") continue;
    const emoji = EMOJI[k] || "";
    const sign = v > 0 ? "+" : (v < 0 ? "-" : "±");
    const mag = Math.abs(v);
    parts.push(`${sign}${emoji}${mag>1?mag:""}`);
  }
  return parts.join("  ");
}

// GM controls
async function wireGMControls(){
  $("#prevScene")?.addEventListener("click", async ()=>{ await API.prev(); });
  $("#nextScene")?.addEventListener("click", async ()=>{ await API.next(); });
  $("#resetA")?.addEventListener("click", async ()=>{ await API.select("A", null); });
  $("#resetB")?.addEventListener("click", async ()=>{ await API.select("B", null); });
  $("#resetAll")?.addEventListener("click", async ()=>{ await API.reset(); });
}

// Polling loop
function startLoop(){
  const isGM = document.body.dataset.page === "gm";
  const tick = async ()=>{
    const state = await API.state();
    if (!state.ok) return;
    if (isGM) renderGM(state);
    else renderPlayer(state);
  };
  tick();
  setInterval(tick, 800);
}

(async function init(){
  if (!Object.keys(EMOJI).length) {
    const e = await API.emoji();
    Object.assign(EMOJI, e);
  }
  if (document.body.dataset.page === "gm") await wireGMControls();
  startLoop();
})();
