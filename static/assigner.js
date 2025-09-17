async function postJSON(url, data){
  const r = await fetch(url, {method:"POST", headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)});
  if(!r.ok){ throw new Error((await r.json()).error || r.statusText); }
  return r.json();
}

function byId(id){ return document.getElementById(id); }

async function assign(){
  const names = byId("names").value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const allow_duplicates = byId("dups").checked;
  const mode = byId("mode").value;
  const seed = byId("seed").value || null;

  if(names.length === 0){ alert("Įvesk bent vieną vardą."); return; }

  try{
    const res = await postJSON("/api/assign_personalities", {names, allow_duplicates, mode, seed});
    const tbody = document.querySelector("#tbl tbody");
    tbody.innerHTML = "";
    res.assignments.forEach(a=>{
      const tr = document.createElement("tr");
      const ties = a.personality.ties || {allies:[], rivals:[]};
      tr.innerHTML = `
        <td>${a.name}</td>
        <td><span class="pill">${a.personality.id}</span> ${a.personality.name}</td>
        <td class="muted">${a.personality.voting_rule || ""}</td>
        <td>
          <span class="pill">Saj.: ${ (ties.allies||[]).join(", ") || "—" }</span>
          <span class="pill">Konf.: ${ (ties.rivals||[]).join(", ") || "—" }</span>
        </td>`;
      tbody.appendChild(tr);
    });
    byId("results").style.display = "block";
    byId("btnCopy").disabled = false;
    byId("btnDownload").disabled = false;

    // store csv
    window._lastCSV = res.csv;
  }catch(err){
    alert("Klaida: " + err.message);
  }
}

function copyCSV(){
  if(!window._lastCSV) return;
  navigator.clipboard.writeText(window._lastCSV).then(()=> {
    alert("CSV nukopijuotas.");
  });
}

function downloadCSV(){
  if(!window._lastCSV) return;
  const blob = new Blob([window._lastCSV], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "assignments.csv";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

document.addEventListener("DOMContentLoaded", ()=>{
  byId("btnAssign").addEventListener("click", assign);
  byId("btnCopy").addEventListener("click", copyCSV);
  byId("btnDownload").addEventListener("click", downloadCSV);
});
