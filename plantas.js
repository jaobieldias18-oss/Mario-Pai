/* =====================================================
   plantas.js — LEITURA DE PLANTAS (Groq direto)
   -----------------------------------------------------
   Aba "Plantas": fotografa a planta baixa e a IA devolve
   medidas e áreas por cômodo.
   - A chave da Groq é pedida UMA vez e guardada no aparelho
     (localStorage). Nunca vai para o código nem para o GitHub.
   ===================================================== */

// Chave da IA mantida apenas no servidor (Supabase Edge Functions).

function elPlanta2(id) { return document.getElementById(id); }

function blobParaDataURL(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error("leitura"));
    fr.readAsDataURL(blob);
  });
}

async function analisarPlanta() {
  const arq = elPlanta2("planta-foto").files[0];
  if (!arq) { mostrarToast("Escolha a foto da planta.", false); return; }
  const btn = elPlanta2("btn-analisar");
  const status = elPlanta2("planta-status");
  btn.disabled = true; btn.textContent = "Lendo planta...";
  status.textContent = "Enviando para análise...";
  elPlanta2("planta-resultado").innerHTML = "";
  try {
    const blob = await prepararFoto(arq, 2048); // plantas vão em alta p/ ler as cotas miúdas
    let dados = null;
    try {
      dados = await analisarViaServidor(blob, arq.type || "image/jpeg");
      status.textContent = "";
    } catch (e) {
      console.error("falha ao analisar planta:", e);
      status.textContent = "";
      mostrarToast("Não foi possível ler a planta. Tente novamente ou verifique se a IA está configurada.", false);
      btn.disabled = false; btn.textContent = "Ler planta";
      return;
    }
    desenharLeitura(dados);
    try {
      if (typeof montarRaioX === "function") {
        const sel = document.getElementById("planta-obra");
        montarRaioX(dados, (sel || {}).value || null);
      }
    } catch (e) { console.error("raio-x:", e); }
    await salvarLeitura(arq, dados);
    mostrarToast("Planta lida!");
  } catch (e) {
    console.error("Planta:", e);
    status.textContent = "";
    mostrarToast(erroSimplesPlanta(e), false);
  }
  btn.disabled = false; btn.textContent = "Ler planta";
}

// Caminho principal: Edge Function (chave no servidor, autenticação requerida)
async function analisarViaServidor(blob, mime) {
  const dataUrl = await blobParaDataURL(blob);
  const base64 = (dataUrl.split(",")[1] || "");
  const sess = (sb && sb.auth && typeof sb.auth.getSession === "function")
    ? await sb.auth.getSession().catch(() => null) : null;
  const token = (sess && sess.data && sess.data.session && sess.data.session.access_token) || null;
  const headers = Object.assign(
    { "Content-Type": "application/json" },
    token ? { Authorization: "Bearer " + token } : {}
  );
  const resp = await fetch(
    "https://wmcrbjlzsqveekwifded.supabase.co/functions/v1/analisar-planta",
    {
      method: "POST",
      headers,
      body: JSON.stringify({ nome_arquivo: "planta", mime, imagem_base64: base64 }),
    }
  );
  if (!resp.ok) {
    if (resp.status === 401) throw new Error("Sessão inválida. Faça login novamente.");
    if (resp.status === 429) throw new Error("Limite de uso da IA atingido. Aguarde um minuto e tente novamente.");
    if (resp.status >= 500) throw new Error("IA temporariamente indisponível.");
    throw new Error("servidor " + resp.status);
  }
  const j = await resp.json();
  const a = j.analise || j;
  const comodos = ((a.ambientes || []).map((x) => ({
    nome: x.nome, area_m2: x.area, perimetro_m: null,
    cotas: null,
  }))).filter((x) => x.nome);
  const total = (a.area_construida && a.area_construida.valor) || null;
  const obs = []
    .concat(a.observacoes || [])
    .concat(a.informacoes_incertas || [])
    .join(" ");
  if (!comodos.length && !total) throw new Error("vazia");
  return { comodos, area_total_m2: total, observacao: obs };
}



function erroSimplesPlanta(e) {
  const m = String((e && e.message) || "");
  if (/401/.test(m)) return "Sessão inválida. Faça login novamente.";
  if (/429/.test(m)) return "Limite de uso da IA atingido. Aguarde um minuto e tente de novo.";
  if (/500|temporariamente/.test(m)) return "IA temporariamente indisponível. Verifique se o serviço foi configurado.";
  if (/rede|fetch|Failed/.test(m)) return "Sem internet. Confira o sinal e tente de novo.";
  return "Não foi possível ler. Tente de novo com a foto mais nítida.";
}

function desenharLeitura(d) {
  const box = elPlanta2("planta-resultado");
  const comodos = d.comodos || [];
  let html = "";
  if (d.area_total_m2)
    html += `<div class="numero-card azul"><span>Área total</span><strong>${Number(d.area_total_m2).toFixed(2).replace(".", ",")} m²</strong></div>`;
  for (const c of comodos) {
    html += `<div class="item"><div class="item-topo">` +
      `<span class="item-icone" aria-hidden="true">P</span>` +
      `<div class="item-conteudo"><strong>${proteger(c.nome || "Cômodo")}</strong>` +
      `<span class="item-meta">Área ${c.area_m2 ?? "—"} m²${c.perimetro_m ? " • Perímetro " + c.perimetro_m + " m" : ""}${c.cotas ? " • Cotas " + proteger(c.cotas) : ""}</span></div>` +
      `</div></div>`;
  }
  // Conferência matemática no aparelho: soma dos cômodos x total informado
  const soma = comodos.reduce((s, c) => s + (Number(c.area_m2) || 0), 0);
  if (d.area_total_m2 && soma > 0 && Math.abs(soma - Number(d.area_total_m2)) / Number(d.area_total_m2) > 0.02) {
    html += `<div class="card dica"><p><strong>Confira:</strong> a soma dos cômodos (${soma.toFixed(2).replace(".", ",")} m²) difere do total informado (${Number(d.area_total_m2).toFixed(2).replace(".", ",")} m²). Valide na trena antes de comprar material.</p></div>`;
  }
  if (d.observacao) html += `<div class="card dica"><p>${proteger(d.observacao)}</p></div>`;
  if (!html) html = `<div class="lista-vazia">Nada legível nesta imagem.</div>`;
  box.innerHTML = html;
}

async function salvarLeitura(arquivo, dados) {
  if (typeof sb === "undefined" || !sb) return;
  let url = "";
  try {
    const blob = await prepararFoto(arquivo);
    const nome = "planta-" + Date.now().toString(36) + "-" +
      Math.random().toString(36).slice(2, 10) + ".jpg";
    const { error } = await sb.storage.from("anexos").upload(nome, blob, { contentType: "image/jpeg" });
    if (!error) url = sb.storage.from("anexos").getPublicUrl(nome).data.publicUrl;
  } catch (e) { console.error("foto planta:", e); }
  const obraId = (elPlanta2("planta-obra") || {}).value || null;
  try {
    await sb.from("plantas").insert({
      owner_id: (typeof donoIdAtual === "function" ? donoIdAtual() : null),
      obra_id: obraId || null, imagem_url: url || null,
      resultado: JSON.stringify(dados),
    });
  } catch (e) { console.error("salvar leitura:", e); }
  carregarHistoricoPlantas();
}

async function carregarHistoricoPlantas() {
  try { if (typeof renderOrcamentosSalvos === "function") renderOrcamentosSalvos(); } catch (e) {}
  const box = elPlanta2("lista-plantas");
  if (!box || typeof sb === "undefined" || !sb) return;
  box.innerHTML = "";
  try {
    const { data, error } = await sb.from("plantas").select("*").order("created_at", { ascending: false }).limit(20);
    if (error) throw error;
    if (!data || !data.length) {
      box.innerHTML = `<div class="lista-vazia">Nenhuma planta lida ainda.</div>`;
      return;
    }
    const nomesObras = {};
    try { for (const o of obras || []) nomesObras[o.id] = o.nome; } catch (e) {}
    for (const p of data) {
      let d = {};
      try { d = JSON.parse(p.resultado || "{}"); } catch (e) {}
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="item-topo">
          <span class="item-icone" aria-hidden="true">P</span>
          <div class="item-conteudo">
            <strong>${(d.comodos || []).length} cômodos${d.area_total_m2 ? " • " + Number(d.area_total_m2).toFixed(1).replace(".", ",") + " m²" : ""}</strong>
            <span class="item-meta">${p.obra_id && nomesObras[p.obra_id] ? proteger(nomesObras[p.obra_id]) + " • " : ""}${formatarData((p.created_at || "").slice(0, 10))}</span>
          </div>
        </div>
        ${p.imagem_url ? `<a href="${proteger(p.imagem_url)}" target="_blank" rel="noopener"><img class="foto-mini" src="${proteger(p.imagem_url)}" alt="Planta" loading="lazy" /></a>` : ""}
        <div class="item-acoes"><button data-a="ver">Ver medidas</button><button data-a="excluir" class="excluir">Excluir</button></div>`;
      div.querySelector('[data-a="ver"]').addEventListener("click", () => {
        desenharLeitura(d);
        document.getElementById("planta-resultado").scrollIntoView({ behavior: "smooth", block: "center" });
      });
      div.querySelector('[data-a="excluir"]').addEventListener("click", async () => {
        if (!confirm("Excluir esta leitura?")) return;
        try { await sb.from("plantas").delete().eq("id", p.id); } catch (e) { await erroBanco("excluir a leitura", e); return; }
        carregarHistoricoPlantas();
        mostrarToast("Leitura excluída.");
      });
      box.appendChild(div);
    }
  } catch (e) { console.error("histórico plantas:", e); }
}

function atualizarObrasPlanta() {
  const sel = elPlanta2("planta-obra");
  if (!sel) return;
  const atual = sel.value;
  sel.innerHTML = `<option value="">Sem obra vinculada</option>`;
  try {
    for (const o of obras || []) {
      const op = document.createElement("option");
      op.value = o.id;
      op.textContent = o.nome;
      sel.appendChild(op);
    }
  } catch (e) {}
  if (atual) sel.value = atual;
}

(function ligarPlantas() {
  function ligar() {
    const foto = elPlanta2("planta-foto");
    if (foto && !foto.dataset.ligado) {
      foto.dataset.ligado = "1";
      foto.addEventListener("change", () => {
        const prev = elPlanta2("planta-previa");
        if (foto.files[0] && prev) {
          prev.src = URL.createObjectURL(foto.files[0]);
          prev.hidden = false;
        }
      });
    }
    const btn = elPlanta2("btn-analisar");
    if (btn && !btn.dataset.ligado) {
      btn.dataset.ligado = "1";
      btn.addEventListener("click", analisarPlanta);
    }
    document.querySelectorAll('[data-ir="plantas"]').forEach((b) => {
      if (!b.dataset.plantasLigado) {
        b.dataset.plantasLigado = "1";
        b.addEventListener("click", () => {
          setTimeout(() => { atualizarObrasPlanta(); carregarHistoricoPlantas(); }, 100);
        });
      }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligar);
  else ligar();
})();
