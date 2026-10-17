/* =====================================================
   auth.js — CONTA DO MÁRIO (Supabase Auth)
   -----------------------------------------------------
   - Uma conta: entra com Nome + Senha (o e-mail interno
     fica escondido, nunca aparece na tela).
   - Sessão persistente: fechou e abriu, continua dentro.
   - Opções: ver conta, trocar senha, sair.
   ===================================================== */

const MARIO_USUARIO = "mario";
const MARIO_NOME = "Mário";
const MARIO_EMAIL_INTERNO = "mario@mario.local";
let sessaoUsuario = null;
let perfilMario = { nome: MARIO_NOME, email: "" };

function elAuth(id) { return document.getElementById(id); }
function temSessao() { return !!sessaoUsuario; }
function donoIdAtual() { return sessaoUsuario ? sessaoUsuario.id : null; }

function mostrarTelaLogin() {
  document.querySelectorAll(".tela").forEach((el) => el.classList.remove("ativa"));
  const t = elAuth("tela-login");
  if (t) t.classList.add("ativa");
  document.querySelectorAll("[data-ir]").forEach((btn) => btn.classList.remove("ativo"));
  window.scrollTo({ top: 0 });
}

async function AuthPronto() {
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getSession();
    sessaoUsuario = (data && data.session && data.session.user) || null;
  } catch (e) { console.warn("Não consegui ler a sessão salva:", e); sessaoUsuario = null; }
  sb.auth.onAuthStateChange((evt) => {
    if (evt === "SIGNED_OUT") { sessaoUsuario = null; location.reload(); }
  });
  return sessaoUsuario;
}

async function tentarLogin(nomeDigitado, senha) {
  const erroEl = elAuth("login-erro");
  const mostrarErro = (m) => { erroEl.textContent = m; erroEl.hidden = false; };
  erroEl.hidden = true;
  if (!sb) { mostrarErro("Sem conexão. Tente de novo."); return false; }
  if (String(nomeDigitado || "").trim().toLowerCase() !== MARIO_USUARIO) {
    mostrarErro("Usuário não encontrado.");
    return false;
  }
  const { data, error } = await sb.auth.signInWithPassword({
    email: MARIO_EMAIL_INTERNO, password: senha,
  });
  if (error) { mostrarErro("Senha incorreta."); return false; }
  sessaoUsuario = data.user;
  try { localStorage.setItem("mario_nome", MARIO_NOME); } catch (e) {}
  await carregarPerfilAuth();
  location.reload();
  return true;
}

async function carregarPerfilAuth() {
  if (!sb || !sessaoUsuario) return;
  perfilMario = { nome: MARIO_NOME, email: sessaoUsuario.email || "" };
  try {
    await sb.from("profiles").upsert({ id: sessaoUsuario.id, nome: MARIO_NOME, email: sessaoUsuario.email || "" });
  } catch (e) { console.warn("Não atualizei o perfil na nuvem:", e); }
  const n = elAuth("aj-nome");
  if (n) n.textContent = perfilMario.nome;
}

async function fazerLogout() {
  try { if (sb) await sb.auth.signOut(); } catch (e) {}
  sessaoUsuario = null;
  location.reload();
}

function ligarAuthUI() {
  const aoClicar = (id, fn) => {
    const b = elAuth(id);
    if (b && !b.dataset.authLigado) { b.dataset.authLigado = "1"; b.addEventListener("click", fn); }
  };
  const aoEnviar = (id, fn) => {
    const f = elAuth(id);
    if (f && !f.dataset.authLigado) { f.dataset.authLigado = "1"; f.addEventListener("submit", fn); }
  };
  aoEnviar("form-login", async (e) => {
    e.preventDefault();
    const btn = elAuth("btn-entrar");
    btn.disabled = true; btn.textContent = "Entrando...";
    await tentarLogin(elAuth("login-nome").value, elAuth("login-senha").value);
    btn.disabled = false; btn.textContent = "Entrar";
  });
  aoClicar("btn-sair", fazerLogout);
  aoEnviar("form-senha", async (e) => {
    e.preventDefault();
    const atual = elAuth("senha-atual").value;
    const nova = elAuth("senha-nova").value;
    const conf = elAuth("senha-conf").value;
    if (nova !== conf) { mostrarToast("As senhas novas não são iguais.", false); return; }
    if (nova.length < 6) { mostrarToast("A nova senha precisa de 6 letras ou números.", false); return; }
    const chk = await sb.auth.signInWithPassword({ email: MARIO_EMAIL_INTERNO, password: atual });
    if (chk.error) { mostrarToast("Senha atual errada.", false); return; }
    const { error } = await sb.auth.updateUser({ password: nova });
    if (error) { mostrarToast("Erro: " + error.message, false); return; }
    elAuth("form-senha").reset();
    mostrarToast("Senha trocada!");
  });
}
