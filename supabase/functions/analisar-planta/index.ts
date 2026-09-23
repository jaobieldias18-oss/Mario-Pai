// ============================================================
// MARIO · Edge Function: analisar-planta (Groq)
// Lê plantas de casas e devolve JSON estruturado.
// Roda no SERVIDOR (Supabase). Segredos — NUNCA no código:
//   GROQ_API_KEY     → obrigatória (só via Secret do Supabase)
//   GROQ_VISION_MODEL→ opcional (padrão abaixo; um só lugar)
// Deploy: supabase functions deploy analisar-planta
// Secrets: supabase secrets set GROQ_API_KEY=xxx
// ============================================================
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ÚNICO lugar com o nome do modelo. Troque aqui (ou via Secret
// GROQ_VISION_MODEL) sem mexer no resto.
const MODELO_PADRAO = "qwen/qwen3.8-27b";

const PROMPT_SISTEMA = `Você interpreta plantas arquitetônicas de casas e devolve SOMENTE JSON válido, sem texto extra, neste formato:
{
"tipo_planta": "planta_baixa"|"corte"|"fachada"|"eletrica"|"hidraulica"|"estrutural"|null,
"escala": "1:50"|null,
"area_construida": {"valor": null, "unidade": "m²", "origem": null, "confianca": null},
"area_util": {"valor": null, "unidade": "m²", "origem": null, "confianca": null},
"pavimentos": null,
"dimensoes_externas": {"comprimento": null, "largura": null, "origem": null, "confianca": null},
"ambientes": [{"nome": "...", "comprimento": null, "largura": null, "area": null, "origem": null, "confianca": null}],
"contagens": {"quartos": null, "banheiros": null, "lavabos": null, "portas": null, "janelas": null, "garagens": null, "vagas": null, "escadas": null},
"areas_adicionais": [{"nome": "...", "area": null, "confianca": null}],
"paredes": {"espessura": null, "comprimento_total": null, "unidade": "m", "confianca": null},
"cobertura": {"tipo": null, "area": null, "inclinacao": null, "confianca": null},
"instalacoes": {"vasos": null, "chuveiros": null, "lavatorios": null, "pias": null, "tanques": null, "ralos": null, "tomadas": null, "interruptores": null, "pontos_iluminacao": null},
"medidas_identificadas": [{"texto": "5,00 m", "valor_metros": 5, "onde": "sala"}],
"informacoes_incertas": ["..."],
"possiveis_inconsistencias": ["..."],
"observacoes": ["..."]
}
REGRAS OBRIGATÓRIAS:
1. NUNCA invente medidas, áreas, preços ou materiais. Sem evidência na imagem: null.
2. NUNCA assuma espessura de parede sem evidência.
3. NUNCA considere automaticamente a soma dos ambientes como área construída.
4. Converta medidas para metros (50 cm = 0.5). Áreas sempre em m².
5. confianca: "alta"|"media"|"baixa". origem: "informada_na_planta"|"calculada_a_partir_de_medidas"|"identificada_visualmente"|"estimada".
6. Liste em informacoes_incertas tudo que precisa de conferência humana.
7. Se a imagem tiver vários desenhos (planta baixa + situação + cortes + fachada), use APENAS a planta baixa para medidas e ambientes; ignore os demais.
8. NUNCA liste o mesmo cômodo duas vezes com nomes diferentes. Em dúvida, use um só e explique em observacoes.
9. Para area_construida, prefira o rótulo "ÁREA TOTAL" ou "ÁREA CONSTRUÍDA" escrito na planta.
10. Para portas e janelas, prefira a tabela de esquadrias quando existir; senão, conte pelos símbolos e marque confianca baixa.
11. Para escala, prefira o rótulo "ESCALA 1:xx" junto à planta baixa.
12. Analise SOMENTE o conteúdo da região/imagem fornecida.
13. Quando existir rótulo explícito de área, priorize-o e nunca o substitua por estimativa. Em conflito, registre em possiveis_inconsistencias.
14. Seja conciso: nomes curtos de cômodos, números diretos, nenhum texto fora do JSON.`;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function extrairJson(texto: string): unknown | null {
  try {
    return JSON.parse(texto);
  } catch {
    const limpo = texto.replace(/```json|```/g, "");
    try {
      return JSON.parse(limpo);
    } catch {
      const ini = limpo.indexOf("{");
      const fim = limpo.lastIndexOf("}");
      if (ini >= 0 && fim > ini) {
        try {
          return JSON.parse(limpo.slice(ini, fim + 1));
        } catch {
          return null;
        }
      }
      return null;
    }
  }
}

function valido(n: unknown): n is number {
  return typeof n === "number" && isFinite(n) && n >= 0;
}

function validarEstrutura(d: unknown): { ok: boolean; erros: string[] } {
  const erros: string[] = [];
  if (!d || typeof d !== "object") return { ok: false, erros: ["Resposta vazia."] };
  const o = d as Record<string, unknown>;
  if (o.ambientes !== undefined && o.ambientes !== null && !Array.isArray(o.ambientes)) {
    erros.push("ambientes inválido.");
  }
  return { ok: erros.length === 0, erros };
}

serve(async (req) => {
  console.log("[ANALISE] Função iniciada");
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, apikey, content-type",
      },
    });
  }
  try {
    // Chamada anônima liberada (sem login); valida o token se enviado.
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const authHeader = req.headers.get("Authorization") || "";
    let userId: string | null = null;
    if (authHeader) {
      const sbUser = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userError } = await sbUser.auth.getUser();
      if (userError || !userData?.user) {
        return json({ erro: "Sessão inválida. Faça login novamente." }, 401);
      }
      userId = userData.user.id;
    }
    console.log("[ANALISE] Usuário autenticado: " + (userId ? "SIM" : "NÃO (anônimo)"));

    // ---- Chave do Groq: SÓ do Secret do servidor ----
    const groqApiKey = Deno.env.get("GROQ_API_KEY");
    console.log("[ANALISE] GROQ_API_KEY configurada: " + (groqApiKey ? "SIM" : "NÃO"));
    if (!groqApiKey) {
      return json({ erro: "GROQ_API_KEY não configurada no servidor." }, 500);
    }
    const modelo = Deno.env.get("GROQ_VISION_MODEL") || MODELO_PADRAO;
    console.log("[ANALISE] Modelo: " + modelo);

    // ---- Entrada: base64 (recomendado) ou caminho no Storage ----
    const corpo = await req.json().catch(() => ({}));
    let base64 = corpo.imagem_base64 || "";
    let mime = corpo.mime || "image/png";
    const arquivoPath: string | null = corpo.arquivo_path || null;

    if (!base64 && arquivoPath) {
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
      if (!serviceKey) return json({ erro: "Servidor sem acesso ao Storage." }, 500);
      const sbAdmin = createClient(supabaseUrl, serviceKey);
      const { data: blob, error: dlError } = await sbAdmin.storage
        .from("plantas")
        .download(arquivoPath);
      if (dlError || !blob) return json({ erro: "Arquivo não encontrado no Storage." }, 404);
      const buf = new Uint8Array(await blob.arrayBuffer());
      if (buf.length > 15 * 1024 * 1024) {
        return json({ erro: "Arquivo muito grande (máximo 15 MB)." }, 400);
      }
      let bin = "";
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      base64 = btoa(bin);
      mime = (blob as Blob).type || "image/png";
    }
    if (!base64) return json({ erro: "Nenhuma imagem enviada." }, 400);
    console.log("[ANALISE] Arquivo recebido: SIM");
    console.log("[ANALISE] Tipo: " + mime);
    if (mime === "application/pdf") {
      return json({
        erro: "PDF não suportado pela análise automática. Envie a planta como imagem (PNG/JPG) ou foto.",
      }, 400);
    }

    // ---- Groq: SÓ interpreta a planta ----
    console.log("[ANALISE] Enviando imagem para Groq");
    const ctrl = new AbortController();
    const limite = setTimeout(() => ctrl.abort(), 100000);
    let groqResp: Response;
    try {
      groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + groqApiKey,
        },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: modelo,
          temperature: 0.1,
          max_tokens: 1000,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: PROMPT_SISTEMA },
            {
              role: "user",
              content: [
                { type: "text", text: "Analise esta planta arquitetônica e devolva o JSON." },
                { type: "image_url", image_url: { url: "data:" + mime + ";base64," + base64 } },
              ],
            },
          ],
        }),
      });
    } catch (e) {
      clearTimeout(limite);
      const abortou = e instanceof Error && e.name === "AbortError";
      console.log("[ANALISE] Groq sem resposta (timeout/rede)");
      return json({ erro: abortou ? "A análise demorou demais. Tente uma imagem menor." : "Não foi possível conectar ao serviço de análise." }, 504);
    }
    clearTimeout(limite);
    if (!groqResp.ok) {
      let detalhe = "HTTP " + groqResp.status;
      try {
        const errJson = await groqResp.json();
        const msg = errJson?.error?.message || errJson?.error?.code || "";
        console.log("[ANALISE] Status Groq: " + groqResp.status);
        console.log("[ANALISE] Erro Groq: " + String(msg).slice(0, 300));
        if (msg) detalhe += " — " + String(msg).slice(0, 300);
      } catch {
        console.log("[ANALISE] Status Groq: " + groqResp.status + " (sem corpo legível)");
      }
      if (groqResp.status === 400) {
        return json({ erro: "Não foi possível processar esta imagem.", detalhe }, 502);
      }
      if (groqResp.status === 401) {
        return json({ erro: "Problema de autenticação do serviço de análise.", detalhe }, 502);
      }
      if (groqResp.status === 404) {
        return json({ erro: "Modelo de análise não disponível.", detalhe }, 502);
      }
      if (groqResp.status === 429) {
        return json({ erro: "Limite de uso da IA atingido. Aguarde um minuto e tente novamente.", detalhe }, 502);
      }
      return json({ erro: "Não foi possível conectar ao serviço de análise.", detalhe }, 502);
    }
    console.log("[ANALISE] Status Groq: 200");
    const groqDados = await groqResp.json();
    const texto: string = groqDados?.choices?.[0]?.message?.content || "";
    const analise = extrairJson(texto);
    console.log("[ANALISE] JSON válido: " + (analise ? "SIM" : "NÃO"));
    if (!analise) {
      return json({ erro: "Não conseguimos interpretar os dados da planta. Tente novamente." }, 502);
    }
    const v = validarEstrutura(analise);
    if (!v.ok) {
      return json({ erro: "Resposta da IA inconsistente: " + v.erros.join(" ") }, 502);
    }
    return json({ analise });
  } catch {
    return json({ erro: "Erro interno da análise." }, 500);
  }
});
