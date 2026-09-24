/* =====================================================
   plantas.js — LEITURA DE PLANTAS (Groq direto)
   -----------------------------------------------------
   Aba "Plantas": fotografa a planta baixa e a IA devolve
   medidas e áreas por cômodo.
   - A chave da Groq é pedida UMA vez e guardada no aparelho
     (localStorage). Nunca vai para o código nem para o GitHub.
   ===================================================== */

const GROQ_MODEL = "qwen/qwen3.8-27b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_KEY_SAVE = "mario_groq_key";

// Chave pedida uma vez e guardada NO APARELHO (nunca no código/GitHub)
function chaveGroq() {
  try {
    let k = localStorage.getItem(GROQ_KEY_SAVE) || "";
    if (!k) {
      k = (prompt("Cole a chave da Groq (só na primeira vez):") || "").trim();
      if (k) localStorage.setItem(GROQ_KEY_SAVE, k);
    }
    return k;
  } catch (e) { return ""; }
}

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
  const chave = chaveGroq();
  if (!chave) { mostrarToast("Sem chave, sem leitura.", false); btn.disabled = false; btn.textContent = "Ler planta"; return; }
  try {
    const blob = await prepararFoto(arq);
    const dataUrl = await blobParaDataURL(blob);
    // Tenta até 3x (a IA às vezes falha 1x com limite/instabilidade e passa na seguinte)
    let resp = null, ultimoErro = "";
    for (let tent = 1; tent <= 3; tent++) {
      status.textContent = tent > 1 ? `Tentando de novo (${tent}/3)...` : "Enviando para análise...";
      try {
        resp = await fetch(GROQ_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + chave,
          },
          body: JSON.stringify({
            model: GROQ_MODEL,
            temperature: 0.1,
            max_tokens: 1500,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Analise esta planta baixa de obra. Extraia as medidas e áreas. " +
                      "Responda SOMENTE com JSON válido, sem texto fora dele, neste formato: " +
                      '{"comodos": [{"nome": "Sala", "area_m2": 12.5, "perimetro_m": 14}], ' +
                      '"area_total_m2": 0, "observacao": "texto curto se algo estiver ilegível"}. ' +
                      "Se não for uma planta, use observacao para dizer e comodos vazio.",
                  },
                  { type: "image_url", image_url: { url: dataUrl } },
                ],
              },
            ],
          }),
        });
        if (resp.ok) break;
        ultimoErro = "Groq " + resp.status + ": " + (await resp.text()).slice(0, 120);
        resp = null;
        if (resp === null && tent < 3) await new Promise((r) => setTimeout(r, 2000 * tent));
      } catch (e) {
        ultimoErro = e.message || "rede";
        resp = null;
        if (tent < 3) await new Promise((r) => setTimeout(r, 2000 * tent));
      }
    }
    if (!resp) throw new Error(ultimoErro || "falha temporária");
    const j = await resp.json();
    const texto = (((j.choices || [])[0] || {}).message || {}).content || "";
    const ini = texto.indexOf("{");
    const fim = texto.lastIndexOf("}");
    if (ini < 0 || fim <= ini) throw new Error("resposta inválida");
    const dados = JSON.parse(texto.slice(ini, fim + 1));
    desenharLeitura(dados);
    await salvarLeitura(arq, dados);
    status.textContent = "";
    mostrarToast("Planta lida!");
  } catch (e) {
    console.error("Planta:", e);
    status.textContent = "";
    mostrarToast("Não foi possível ler: " + (e.message || "erro"), false);
  }
  btn.disabled = false; btn.textContent = "Ler planta";
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
      `<span class="item-meta">Área ${c.area_m2 ?? "—"} m²${c.perimetro_m ? " • Perímetro " + c.perimetro_m + " m" : ""}</span></div>` +
      `</div></div>`;
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
      obra_id: obraId || null, imagem_url: url || null,
      resultado: JSON.stringify(dados),
    });
  } catch (e) { console.error("salvar leitura:", e); }
  carregarHistoricoPlantas();
}

async function carregarHistoricoPlantas() {
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
