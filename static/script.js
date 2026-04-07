const U = window.USER;
let currentPacienteId = null;
let auxData = { setores: [], procedimentos: [], usuarios: [] };

document.addEventListener('DOMContentLoaded', () => {
  if(U && U.nivel) init();
});

// Comunicação robusta com tratamento de erros visual
async function api(url, method='GET', body=null) {
  const opt = { method, headers: {'Content-Type': 'application/json'} };
  if(body) opt.body = JSON.stringify(body);
  try {
    const res = await fetch(url, opt);
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Erro desconhecido no servidor.');
    return data;
  } catch (err) {
    showToast(err.message, true);
    throw err;
  }
}

async function init() {
  document.getElementById('nav-user').textContent = `${U.nome} (${U.nivel.toUpperCase()})`;
  
  // Esconde elementos de escrita para a Professora (Espectador)
  if(U.nivel === 'espectador') {
    document.querySelectorAll('.write-only').forEach(el => el.style.display = 'none');
  }

  // Lógica das Abas
  if(U.nivel === 'admin' || U.nivel === 'espectador') {
    document.getElementById('cad-p-setor').classList.remove('hidden');
    mudarAba('dashboard');
  } else {
    document.getElementById('btn-dashboard').style.display = 'none';
    mudarAba('pacientes');
  }

  // Carrega listas suspensas e tabelas admin
  await loadAuxiliares();
}

async function loadAuxiliares() {
  auxData = await api('/api/auxiliares');
  
  // Preenche Selects
  const selSetores = `<option value="">-- Escolha o Setor --</option>` + auxData.setores.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
  document.getElementById('cad-p-setor').innerHTML = selSetores;
  document.getElementById('cad-u-setor').innerHTML = selSetores;

  // Preenche Tabelas Admin
  if(U.nivel === 'admin' || U.nivel === 'espectador') {
    document.getElementById('lista-setores').innerHTML = auxData.setores.map(s => `
      <div class="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100">
        <span class="font-bold text-slate-700">${s.nome}</span>
      </div>`).join('');
      
    document.getElementById('lista-usuarios').innerHTML = auxData.usuarios.map(u => `
      <div class="flex flex-col p-3 bg-slate-50 rounded-xl border border-slate-100">
        <span class="font-bold text-slate-800">${u.nome}</span>
        <div class="flex justify-between mt-1 text-xs text-slate-500 font-medium">
          <span>${u.email}</span>
          <span class="bg-slate-200 px-2 py-0.5 rounded-full">${u.nivel_acesso === 'estagiario' ? u.setor_nome : u.nivel_acesso.toUpperCase()}</span>
        </div>
      </div>`).join('');
  }
}

function mudarAba(aba) {
  document.querySelectorAll('.aba-conteudo').forEach(e => e.classList.add('hidden'));
  document.getElementById('tela-paciente').classList.add('hidden');
  
  document.querySelectorAll('.aba-btn').forEach(e => { 
    e.classList.remove('text-primary','border-b-[3px]','border-primary'); 
    e.classList.add('text-slate-400'); 
  });
  
  document.getElementById(`aba-${aba}`).classList.remove('hidden');
  const btn = document.getElementById(`btn-${aba}`);
  if(btn) btn.classList.add('text-primary','border-b-[3px]','border-primary');
  
  if(aba === 'dashboard') loadRelatorios();
  if(aba === 'pacientes') loadPacientes();
}

// ── FÓRMULAS & DASHBOARD ──
async function loadRelatorios() {
  const r = await api('/api/dashboard/relatorios');
  const html = `
    <div class="card bg-gradient-to-br from-slate-800 to-slate-900 text-white flex flex-col justify-center items-center p-4">
      <p class="text-xs text-slate-300 font-medium uppercase tracking-wider mb-1">Taxa Geral IH</p>
      <h4 class="text-4xl font-bold">${r.taxa_geral}</h4>
    </div>
    <div class="card p-4 flex flex-col justify-center items-center"><p class="text-xs text-slate-500 font-bold uppercase text-center">Urinário</p><h4 class="text-2xl font-bold text-teal-600 mt-2">${r.taxa_urinario}%</h4></div>
    <div class="card p-4 flex flex-col justify-center items-center"><p class="text-xs text-slate-500 font-bold uppercase text-center">Sangue/Sepse</p><h4 class="text-2xl font-bold text-red-500 mt-2">${r.taxa_sepse}%</h4></div>
    <div class="card p-4 flex flex-col justify-center items-center"><p class="text-xs text-slate-500 font-bold uppercase text-center">Pneumonia</p><h4 class="text-2xl font-bold text-amber-500 mt-2">${r.taxa_pneumonia}%</h4></div>
    <div class="card p-4 flex flex-col justify-center items-center"><p class="text-xs text-slate-500 font-bold uppercase text-center">Cirúrgica</p><h4 class="text-2xl font-bold text-primary mt-2">${r.taxa_cirurgica}%</h4></div>
    <div class="card p-4 flex flex-col justify-center items-center"><p class="text-xs text-slate-500 font-bold uppercase text-center">Sepse p/ Cateter</p><h4 class="text-2xl font-bold text-red-600 mt-2">${r.taxa_septicemia_cateter}%</h4></div>
    <div class="card p-4 flex flex-col justify-center items-center"><p class="text-xs text-slate-500 font-bold uppercase text-center">IH Respiradores</p><h4 class="text-2xl font-bold text-amber-600 mt-2">${r.taxa_ih_respiradores}%</h4></div>
    <div class="card p-4 flex flex-col justify-center items-center"><p class="text-xs text-slate-500 font-bold uppercase text-center">IH Sonda Vesical</p><h4 class="text-2xl font-bold text-primary mt-2">${r.taxa_sonda_vesical}%</h4></div>
  `;
  document.getElementById('cards-relatorio').innerHTML = html;
}

// ── PACIENTES ──
async function loadPacientes() {
  const pacs = await api('/api/pacientes');
  const lista = document.getElementById('lista-pacientes');
  if(!pacs.length) { lista.innerHTML = '<div class="text-center py-10 text-slate-400 font-medium">Nenhum paciente ativo neste setor.</div>'; return; }
  
  lista.innerHTML = pacs.map(p => {
    const isInfected = p.infeccoes.length > 0;
    const isRisco = p.procedimentos_ativos.length > 0;
    const border = isInfected ? 'border-red-500' : (isRisco ? 'border-amber-400' : 'border-teal-400');
    
    return `
    <div class="card p-4 flex justify-between items-center cursor-pointer hover:-translate-y-1 hover:shadow-lg border-l-4 ${border}" onclick='abrirPaciente(${JSON.stringify(p).replace(/'/g, "&#39;")})'>
      <div>
        <h4 class="font-bold text-slate-800 text-lg">${p.nome}</h4>
        <div class="text-xs text-slate-500 mt-1 font-medium">
          <span class="bg-slate-100 px-2 py-1 rounded-md mr-2">${U.nivel!=='estagiario' ? p.setor_nome : 'Leito ' + p.leito}</span>
          ${U.nivel!=='estagiario' ? 'Leito ' + p.leito : ''}
        </div>
      </div>
      <div class="flex flex-col items-end gap-1">
        ${isInfected ? `<span class="badge bg-red-100 text-red-700">Infectado</span>` : ''}
        <span class="badge ${isRisco ? 'bg-amber-100 text-amber-700' : 'bg-teal-100 text-teal-700'}">${p.procedimentos_ativos.length} Procs</span>
      </div>
    </div>
  `}).join('');
}

function abrirPaciente(p) {
  currentPacienteId = p.id;
  document.querySelectorAll('.aba-conteudo').forEach(e => e.classList.add('hidden'));
  document.getElementById('tela-paciente').classList.remove('hidden');
  
  document.getElementById('det-nome').textContent = p.nome;
  document.getElementById('det-info').innerHTML = `
    <span class="bg-white/60 text-teal-800 px-3 py-1 rounded-lg text-xs font-bold shadow-sm">${p.idade} anos</span>
    <span class="bg-white/60 text-teal-800 px-3 py-1 rounded-lg text-xs font-bold shadow-sm">Leito ${p.leito}</span>
    <span class="bg-white/60 text-teal-800 px-3 py-1 rounded-lg text-xs font-bold shadow-sm">Prontuário: ${p.prontuario || 'N/A'}</span>
  `;
  
  const hoje = new Date();
  document.getElementById('lista-procedimentos').innerHTML = auxData.procedimentos.map(proc => {
    const ativo = p.procedimentos_ativos.find(x => x.tipo_procedimento === proc);
    let diasStr = '';
    if(ativo) {
      const ms = hoje - new Date(ativo.data_insercao + 'T00:00:00');
      const dias = Math.max(0, Math.floor(ms/86400000));
      diasStr = `<span class="ml-2 text-xs font-bold ${dias >= 7 ? 'text-red-500 bg-red-50 px-2 py-0.5 rounded-full' : 'text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full'}">${dias} dias</span>`;
    }
    const dis = U.nivel === 'espectador' ? 'disabled' : '';
    return `
      <div class="flex justify-between items-center p-4 bg-white border border-slate-100 shadow-sm rounded-xl mb-3">
        <span class="text-sm font-medium ${ativo?'text-teal-700 font-bold':'text-slate-600'} flex items-center">${proc} ${diasStr}</span>
        <label class="toggle"><input type="checkbox" ${ativo?'checked':''} ${dis} onchange="toggleProc('${proc}', this.checked)"><span class="toggle-slider"></span></label>
      </div>
    `;
  }).join('');
}

async function toggleProc(nomeProc, isChecked) {
  const acao = isChecked ? 'inserir' : 'remover';
  const data = new Date().toISOString().split('T')[0];
  await api('/api/procedimentos', 'POST', { paciente_id: currentPacienteId, tipo_procedimento: nomeProc, acao, data });
  showToast('Controle atualizado com sucesso.');
  loadPacientes(); 
}

async function salvarInfeccao() {
  const tipo = document.getElementById('inf-tipo').value;
  if(!tipo) return showToast('Selecione o tipo de infecção.', true);
  const data = new Date().toISOString().split('T')[0];
  await api('/api/infeccoes', 'POST', { paciente_id: currentPacienteId, tipo_infeccao: tipo, data });
  showToast('Diagnóstico registrado! CCIH notificada.');
  document.getElementById('inf-tipo').value = '';
  loadPacientes();
}

async function salvarAlta() {
  const motivo = document.getElementById('alta-motivo').value;
  await api(`/api/pacientes/${currentPacienteId}/alta`, 'POST', { motivo });
  fecharModal('mod-alta');
  showToast('Internação finalizada com sucesso.');
  mudarAba('pacientes');
}

// ── CRUD ADMIN ──
async function salvarPaciente() {
  const nome = document.getElementById('cad-p-nome').value;
  if(!nome) return showToast('O nome é obrigatório.', true);
  await api('/api/pacientes', 'POST', {
    nome: nome,
    idade: document.getElementById('cad-p-idade').value,
    leito: document.getElementById('cad-p-leito').value,
    setor_id: document.getElementById('cad-p-setor').value
  });
  fecharModal('mod-paciente');
  showToast('Paciente inserido no sistema.');
  loadPacientes();
}

async function salvarUser() {
  const nome = document.getElementById('cad-u-nome').value;
  const email = document.getElementById('cad-u-email').value;
  if(!nome || !email) return showToast('Nome e e-mail são obrigatórios.', true);
  
  await api('/api/usuarios', 'POST', {
    nome: nome,
    email: email,
    senha: document.getElementById('cad-u-senha').value,
    nivel_acesso: document.getElementById('cad-u-nivel').value,
    setor_id: document.getElementById('cad-u-setor').value
  });
  fecharModal('mod-user');
  showToast('Novo membro da equipe criado!');
  loadAuxiliares();
}

async function salvarSetor() {
  const nome = document.getElementById('cad-s-nome').value;
  if(!nome) return showToast('Digite o nome do setor.', true);
  await api('/api/setores', 'POST', { nome });
  fecharModal('mod-setor');
  showToast('Nova Ala Hospitalar registrada!');
  loadAuxiliares();
}

// ── LOGIN E UTILIDADES ──
async function fazerLogin() {
  await api('/api/login', 'POST', { email: document.getElementById('log-email').value, senha: document.getElementById('log-senha').value });
  window.location.reload();
}
async function sair() { await api('/api/logout', 'POST'); window.location.reload(); }

function abrirModal(id) { document.getElementById(id).classList.add('active'); }
function fecharModal(id) { 
  document.getElementById(id).classList.remove('active'); 
  document.querySelectorAll(`#${id} input`).forEach(i => i.value=''); // Limpa inputs
}

let tId;
function showToast(msg, isErr=false) {
  const t = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  document.getElementById('toast-icon').textContent = isErr ? '✕' : '✓';
  t.style.background = isErr ? '#ef4444' : '#1e293b';
  t.classList.remove('hidden', 'opacity-0', 'translate-y-10');
  clearTimeout(tId); 
  tId = setTimeout(() => t.classList.add('opacity-0', 'translate-y-10'), 3000);
}
