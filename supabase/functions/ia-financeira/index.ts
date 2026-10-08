// ============================================================
// MARIO · Edge Function: ia-financeira (Groq)
// Responde perguntas financeiras com dados REAIS do Supabase.
// - Totais calculados AQUI no servidor (a IA não soma listas).
// - Sem login no app: usa a chave pública e só lê o que o RLS
//   permite. Nunca executa SQL vindo do usuário.
// Segredos (só via Secret do Supabase):
//   GROQ_API_KEY      → obrigatória
//   GROQ_FIN_MODEL    → opcional (padrão abaixo)
// Deploy: supabase functions deploy ia-financeira
// ============================================================
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MODELO_PADRAO = "qwen/qwen3.8-27b";
const MAX_PERGUNTA = 500;

const PROMPT_SISTEMA = `Você é o assistente financeiro do Mário, chefe de obra. Fale simples e curto, como quem explica na obra, sem termos técnicos.
REGRAS DURAS:
1. Use SOMENTE os dados fornecidos. Sem dado = diga "Essa informação ainda não foi cadastrada." e diga o que falta cadastrar.
2. Diferencie previsto (contratado) de realizado (recebido). Nunca chame previsão de lucro.
3. Use os TOTAIS já calculados quando existirem; não resome listas.
4. Moeda brasileira (R$ 1.250,50).
5. Nunca invente preços, datas, nomes, taxas ou materiais.`;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function num(v: unknown): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}
function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, apikey, content-type",
      },
    });
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const groqApiKey = Deno.env.get("GROQ_API_KEY");
    if (!groqApiKey) return json({ erro: "GROQ_API_KEY não configurada no servidor." }, 500);
    const modelo = Deno.env.get("GROQ_FIN_MODEL") || MODELO_PADRAO;

    const corpo = await req.json().catch(() => ({}));
    const pergunta = String(corpo.pergunta || "").slice(0, MAX_PERGUNTA).trim();
    if (!pergunta) return json({ erro: "Pergunta vazia." }, 400);
    const obraId = typeof corpo.obra_id === "string" && corpo.obra_id ? corpo.obra_id : null;
    const periodo = /^\d{4}-\d{2}$/.test(String(corpo.periodo || "")) ? String(corpo.periodo) : null;

    const sb = createClient(supabaseUrl, anonKey);

    // ---- Obras autorizadas (só o que o RLS permite ler) ----
    let qObras = sb.from("obras").select("id,nome,cliente,status,valor_contratado,area_m2");
    if (obraId) qObras = qObras.eq("id", obraId);
    const { data: obras, error: eObras } = await qObras;
    if (eObras) return json({ erro: "Não consegui consultar as obras." }, 502);
    if (obraId && (!obras || !obras.length))
      return json({ erro: "Obra não encontrada ou sem acesso.", resposta: null }, 404);
    const ids = (obras || []).map((o) => o.id);
    if (!ids.length) {
      return json({
        resposta: "Ainda não há obras cadastradas. Cadastre a primeira obra para eu analisar.",
        calculos: null,
      });
    }

    // ---- Consultas por tabela (ids vindos do banco, nunca do usuário) ----
    const { data: recs } = await sb.from("recebimentos").select("obra_id,valor,data").in("obra_id", ids);
    const { data: gastos } = await sb.from("gastos").select("obra_id,valor,data,categoria,descricao,mao_obra_id").in("obra_id", ids);
    const { data: equipe } = await sb.from("trabalhadores").select("obra_id,nome,funcao,diaria,dias_trabalhados,data").in("obra_id", ids);
    const { data: parcs } = await sb.from("parcelas").select("obra_id,descricao,numero_parcela,total_parcelas,valor,vencimento,data_vencimento,status,data_pagamento").in("obra_id", ids);

    const noMes = (d: string | null) => (periodo ? (d || "").slice(0, 7) === periodo : true);

    // ---- Totais no servidor ----
    let ctx = `Escopo: ${obraId ? (obras[0]?.nome || "obra") : "todas as obras autorizadas"} (${obras.length} obra(s)).`;
    if (periodo) ctx += ` Período filtrado: ${periodo}.`;
    const calcGeral = { recebido: 0, gasto: 0, mo: 0 };
    for (const o of obras) {
      const rr = (recs || []).filter((r) => r.obra_id === o.id && (!periodo || (r.data || "").slice(0, 7) === periodo));
      const gg = (gastos || []).filter((g) => g.obra_id === o.id && !g.mao_obra_id && noMes(g.data));
      const eq = (equipe || []).filter((t) => t.obra_id === o.id && noMes(t.data));
      const recebido = rr.reduce((s, r) => s + num(r.valor), 0);
      const gasto = gg.reduce((s, g) => s + num(g.valor), 0);
      const mo = eq.reduce((s, t) => s + num(t.diaria) * num(t.dias_trabalhados), 0);
      const contratado = num(o.valor_contratado);
      const aReceber = contratado - (recs || []).filter((r) => r.obra_id === o.id).reduce((s, r) => s + num(r.valor), 0);
      calcGeral.recebido += recebido; calcGeral.gasto += gasto; calcGeral.mo += mo;
      ctx += `\nObra "${o.nome}" (cliente ${o.cliente}, status ${o.status}): contratado ${brl(contratado)}, ` +
        `recebido${periodo ? " no período" : ""} ${brl(recebido)}, gastos ${brl(gasto)}, mão de obra ${brl(mo)}, ` +
        `a receber (total) ${brl(aReceber)}.`;
      const porCat: Record<string, number> = {};
      for (const g of gg) porCat[g.categoria || "Outros"] = (porCat[g.categoria || "Outros"] || 0) + num(g.valor);
      const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (cats.length) ctx += ` Categorias: ${cats.map(([c, v]) => `${c} ${brl(v)}`).join(", ")}.`;
      if (eq.length) ctx += ` Equipe: ${eq.map((t) => `${t.nome} (${t.funcao})`).join(", ")}.`;
      const pend = (parcs || []).filter((p) => p.obra_id === o.id && p.status !== "pago" && p.status !== "Recebida");
      if (pend.length) {
        const prox = pend.map((p) => p.data_vencimento || p.vencimento || "").filter(Boolean).sort()[0] || "—";
        ctx += ` Parcelas em aberto: ${pend.length} (próximo vencimento ${prox}).`;
      }
    }
    const lucro = calcGeral.recebido - calcGeral.gasto - calcGeral.mo;
    ctx += `\nTotais do escopo: recebido ${brl(calcGeral.recebido)}, gastos ${brl(calcGeral.gasto)}, ` +
      `mão de obra ${brl(calcGeral.mo)}, resultado parcial ${brl(lucro)}.`;
    const calculos = {
      recebido: calcGeral.recebido, gastos: calcGeral.gasto, maoDeObra: calcGeral.mo,
      resultado: lucro, periodo: periodo || "geral",
    };

    // ---- Groq: só redige com o contexto entregue ----
    let groqResp: Response;
    try {
      groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + groqApiKey },
        body: JSON.stringify({
          model: modelo, temperature: 0.2, max_tokens: 800,
          messages: [
            { role: "system", content: PROMPT_SISTEMA },
            { role: "user", content: "DADOS REAIS DO SISTEMA:\n" + ctx + "\n\nPERGUNTA: " + pergunta },
          ],
        }),
      });
    } catch {
      return json({ erro: "Não foi possível conectar ao serviço de análise.", calculos }, 504);
    }
    if (!groqResp.ok) {
      if (groqResp.status === 429)
        return json({ erro: "Limite de uso da IA atingido. Aguarde um minuto e tente novamente.", calculos }, 502);
      return json({ erro: "Não foi possível responder agora.", calculos }, 502);
    }
    const gdados = await groqResp.json();
    const resposta: string = gdados?.choices?.[0]?.message?.content || "";
    if (!resposta.trim()) return json({ erro: "Resposta vazia. Tente de novo.", calculos }, 502);
    return json({ resposta: resposta.trim(), calculos });
  } catch {
    return json({ erro: "Erro interno da análise." }, 500);
  }
});
