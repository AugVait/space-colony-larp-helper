async function jget(u){ const r=await fetch(u); if(!r.ok) throw new Error(await r.text()); return r.json(); }
async function jpost(u,d){ const r=await fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)}); if(!r.ok) throw new Error(await r.text()); return r.json(); }
const $=id=>document.getElementById(id);
function css(s){return s.replace(/\s+/g,"_").replace(/[^a-zA-Z0-9_]/g,"");}
function attr(s){return s.replaceAll('"','').replaceAll("'","");}

async function assign(){
  const names = $("names").value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(names.length===0){ alert("Įvesk bent vieną vardą."); return; }
  const res = await jpost("/api/assign_personalities",{names});
  const counts = res.counts || {};
  const tb = document.querySelector("#tbl tbody");
  tb.innerHTML = "";
  res.assignments.forEach(a=>{
    const tr = document.createElement("tr");
    const count = counts[a.name] || 0;
    tr.innerHTML = `
      <td>${a.name}</td>
      <td class="role"><div><strong>${a.personality.name}</strong></div><div class="small">${a.personality.info||""}</div></td>
      <td>
        <span id="c_${css(a.name)}">${count}</span>
        <button class="btnsm" data-n="${attr(a.name)}" data-d="+1">+1</button>
        <button class="btnsm" data-n="${attr(a.name)}" data-d="-1">−1</button>
      </td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll("button.btnsm").forEach(btn=>{
    btn.addEventListener("click", async e=>{
      const name = e.currentTarget.getAttribute("data-n");
      const delta = parseInt(e.currentTarget.getAttribute("data-d"),10);
      const out = await jpost("/api/cocaptain",{name, delta});
      document.getElementById(`c_${css(name)}`).textContent = out.count;
    });
  });
  $("results").style.display = "block";
}

document.addEventListener("DOMContentLoaded", ()=>{ $("btnAssign").addEventListener("click", assign); });
