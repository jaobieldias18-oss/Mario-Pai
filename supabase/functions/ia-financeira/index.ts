// ============================================================
// MARIO · Edge Function: ia-financeira (Groq)
// Serve os DOIS assistentes do app, escolhidos por `modo`:
//   modo: "financeira" (padrão) → analisa os números reais
//   modo: "obra"               → ajuda no planejamento da obra
// - Totais calculados AQUI no servidor (a IA não soma listas).
// - Exige sessão (JWT). Tudo é lido FILTRADO pelo dono (owner_id).
//   Sem login, nenhum dado é lido nem enviado à IA.
// - Nunca executa SQL vindo do usuário.
// Segredos (só via Secret do Supabase):
//   GROQ_API_KEY      → obrigatória
//   GROQ_FIN_MODEL    → opcional (padrão: openai/gpt-oss-120b)
// Deploy: supabase functions deploy ia-financeira
// ============================================================
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_PERGUNTA = 500;

const REGRAS_COMUNS = `REGRAS DURAS:
1. Nunca invente dimensões, preços, quantidades, custos ou dados históricos. Sem dado = diga "Essa informação ainda não foi cadastrada." e diga o que falta cadastrar.
2. Utilize somente os dados fornecidos (materiais, preços com data, orçamentos, obras, gastos, recebimentos). Diferencie confirmado, estimativa e hipótese.
3. Use o histórico como referência sem copiar valores automaticamente; considere diferenças de projeto e época, e avise que preços podem ter mudado.
4. Diferencie previsto (contratado/orçado) de realizado (recebido/gasto). Nunca chame previsão de lucro.
5. Use os TOTAIS já calculados quando existirem; não resome listas.
6. Explique quantitativos importantes e premissas. Moeda brasileira (R$ 1.250,50).
7. Não confunda área construída com área de paredes, pisos ou cobertura. Não duplique materiais ou custos.
8. Não substitua avaliação de profissionais habilitados em responsabilidade técnica.
9. Se faltar informação para responder, diga exatamente o que cadastrar (ex: "cadastre os gastos da obra") em vez de supor.`;

const PROMPT_FINANCEIRA = `Você é a IA Financeira do Mário, chefe de obra. Sua responsabilidade é analisar os NÚMEROS reais das obras.
Responda SEMPRE de forma extremamente resumida: no máximo 2 frases curtas, só o essencial com os números.
Foque em: quanto entrou, quanto saiu, custos, mão de obra, saldo/resultado, a receber, maiores categorias de despesa e comparação com o previsto.
Nunca diga que um valor foi "conferido com dados reais" se essa consulta não estiver nos dados fornecidos abaixo.
Não responda sobre leitura de plantas nem sobre imagens: esse serviço não existe no sistema.

` + REGRAS_COMUNS;

const PROMPT_OBRA = `Você é a IA da Obra do Mário, chefe de obra. Sua responsabilidade é ajudar na organização, no planejamento e no acompanhamento das obras.
Responda SEMPRE de forma extremamente resumida e prática: no máximo 3 frases curtas, com passos simples.
Ajude a: organizar etapas e tarefas, listas de tarefas e materiais, comparar orçamentos, identificar desperdícios, relatórios de andamento, pendências e fornecedores.
Quando faltar informação para uma tarefa, faça no máximo UMA pergunta curta e objetiva (a mais importante) em vez de supor.
Você pode informar valores quando eles estiverem nos dados fornecidos, mas nunca invente medidas, preços ou quantidades.
Não responda sobre leitura de plantas nem sobre imagens: esse serviço não existe no sistema.

` + REGRAS_COMUNS;

function promptDoModo(modo: string): string {
  return modo === "obra" ? PROMPT_OBRA : PROMPT_FINANCEIRA;
}

// Origens autorizadas a chamar esta função pelo navegador.
// O app roda em produção no GitHub Pages e, em testes, localmente.
// Se o endereço do site mudar, inclua a nova origem nesta lista.
const ORIGENS_PERMITIDAS = [
  "https://jaobieldias18-oss.github.io",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

// CORS restrito: só devolve "Access-Control-Allow-Origin" quando a origem
// da requisição está na lista. Sem isso, o navegador bloqueia a resposta
// (não liberamos domínio desconhecido).
function corsHeaders(req: Request): Record<string, string> {
  const origem = req.headers.get("Origin") || "";
  const h: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (origem && ORIGENS_PERMITIDAS.includes(origem)) {
    h["Access-Control-Allow-Origin"] = origem;
  }
  return h;
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
    return new Response("ok", { headers: corsHeaders(req) });
  }
  const cors = corsHeaders(req);
  const json = (obj: unknown, status = 200): Response =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { "Content-Type": "application/json", ...cors },
    });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    // Sessão: valida o JWT e extrai o dono. Leitura FILTRADA pelo dono
    // (sem login, sem dados). O service_role nunca vaza: fica no servidor.
    const authHdr = req.headers.get("Authorization") || "";
    const token = authHdr.replace(/^Bearer\s+/i, "");
    let uid: string | null = null;
    if (token && token !== anonKey) {
      try {
        const sbAuth = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: "Bearer " + token } },
        });
        const { data: ud } = await sbAuth.auth.getUser();
        uid = ud?.user?.id || null;
      } catch { uid = null; }
      if (!uid) return json({ erro: "Sessão inválida. Entre de novo.", resposta: null }, 401);
    }
    if (!uid) {
      return json({
        resposta: "Entre na sua conta para eu analisar suas obras.",
        calculos: null,
      });
    }
    const groqApiKey = Deno.env.get("GROQ_API_KEY");
    if (!groqApiKey) return json({ erro: "GROQ_API_KEY não configurada no servidor." }, 500);
    const modelo = Deno.env.get("GROQ_FIN_MODEL") || "openai/gpt-oss-120b";

    const corpo = await req.json().catch(() => ({}));
    const pergunta = String(corpo.pergunta || "").slice(0, MAX_PERGUNTA).trim();
    if (!pergunta) return json({ erro: "Pergunta vazia." }, 400);
    const obraId = typeof corpo.obra_id === "string" && corpo.obra_id ? corpo.obra_id : null;
    const periodo = /^\d{4}-\d{2}$/.test(String(corpo.periodo || "")) ? String(corpo.periodo) : null;
    const modo = corpo.modo === "obra" ? "obra" : "financeira";

    const sb = createClient(supabaseUrl, serviceKey || anonKey, {
      auth: { persistSession: false },
    });

    // ---- Obras do dono (ids vindos do banco, nunca do usuário) ----
    let qObras = sb.from("obras").select("id,nome,cliente,status,valor_contratado,area_m2").eq("owner_id", uid);
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
    const { data: recs } = await sb.from("recebimentos").select("obra_id,valor,data").in("obra_id", ids).eq("owner_id", uid);
    const { data: gastos } = await sb.from("gastos").select("obra_id,valor,data,categoria,descricao,mao_obra_id").in("obra_id", ids).eq("owner_id", uid);
    const { data: equipe } = await sb.from("trabalhadores").select("obra_id,nome,funcao,diaria,dias_trabalhados,data").in("obra_id", ids).eq("owner_id", uid);
    const { data: parcs } = await sb.from("parcelas").select("obra_id,descricao,numero_parcela,total_parcelas,valor,vencimento,data_vencimento,status,data_pagamento").in("obra_id", ids).eq("owner_id", uid);

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

    // ---- Contexto extra do modo "obra" (limitado; se a tabela faltar, segue sem ela) ----
    if (modo === "obra") {
      try {
        const { data: orcs } = await sb.from("orcamentos")
          .select("id,area,total,data").eq("owner_id", uid)
          .order("data", { ascending: false }).limit(3);
        if (orcs && orcs.length) {
          const oids = orcs.map((o) => o.id);
          const { data: itens } = await sb.from("orcamento_itens")
            .select("orcamento_id,nome,quantidade,unidade,preco").in("orcamento_id", oids)
            .eq("owner_id", uid).limit(60);
          for (const o of orcs) {
            const its = (itens || []).filter((it) => it.orcamento_id === o.id);
            ctx += `\nOrçamento (${o.data || "sem data"}, ${num(o.area)} m²): total ${brl(num(o.total))}`;
            ctx += its.length
              ? `. Itens: ${its.map((it) => `${it.nome} ${num(it.quantidade)}${it.unidade || ""} x ${brl(num(it.preco))}`).join("; ")}.`
              : ". Sem itens detalhados.";
          }
        } else {
          ctx += "\nSem orçamentos salvos.";
        }
      } catch { /* tabela ausente: segue sem orçamentos */ }
      try {
        const { data: mats } = await sb.from("materiais")
          .select("nome,unidade,preco,data_preco").eq("owner_id", uid).eq("ativo", true)
          .order("data_preco", { ascending: false }).limit(20);
        if (mats && mats.length) {
          ctx += `\nMateriais com preço: ${mats.map((m) => `${m.nome} ${brl(num(m.preco))}/${m.unidade || "un"} (${m.data_preco || "sem data"})`).join("; ")}.`;
        }
      } catch { /* tabela ausente */ }
      try {
        const { data: cros } = await sb.from("cronogramas")
          .select("etapa,inicio,previsao_fim,status").in("obra_id", ids).eq("owner_id", uid).limit(60);
        if (cros && cros.length) {
          ctx += `\nEtapas (cronograma): ${cros.map((c) => `${c.etapa} (${c.status}${c.previsao_fim ? ", fim " + c.previsao_fim : ""})`).join("; ")}.`;
        }
      } catch { /* tabela ausente */ }
      try {
        const { data: forns } = await sb.from("fornecedores")
          .select("nome,telefone,cidade").eq("owner_id", uid).limit(20);
        if (forns && forns.length) {
          ctx += `\nFornecedores: ${forns.map((f) => `${f.nome}${f.cidade ? " (" + f.cidade + ")" : ""}${f.telefone ? " " + f.telefone : ""}`).join("; ")}.`;
        }
      } catch { /* tabela ausente */ }
    }

    // ---- Groq: só redige com o contexto entregue ----
    let groqResp: Response;
    try {
      groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + groqApiKey },
          body: JSON.stringify({
            model: modelo, temperature: 0.2, max_tokens: 300,
          messages: [
            { role: "system", content: promptDoModo(modo) },
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
