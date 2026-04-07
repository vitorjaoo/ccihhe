const State = {
  nivel: window.USER_DATA.nivel,
  setorId: window.USER_DATA.setorId,
  nome: window.USER_DATA.nome,
  setores: []
};

document.addEventListener('DOMContentLoaded', () => {
  if (State.nivel) initApp();
});

async function initApp() {
  document.getElementById('nav-info').textContent = `${State.nome} (${State.nivel})`;
  
  // Carrega setores para os formulários
  const resSet = await fetch('/api/setores');
  State.setores = await resSet.json();
  
  const selUserSetor = document.getElementById('m-usr-setor');
  const selCadSetor = document.getElementById('cad-setor-id');
  const options = State.setores.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
  if(selUserSetor) selUserSetor.innerHTML = options;
  if(selCadSetor) selCadSetor.innerHTML = options;

  if (State.nivel === 'admin') {
    document.getElementById('view-admin').classList.remove('hidden');
    document.getElementById('admin-only-sector').classList.remove('hidden');
    loadDashboardAdmin();
    loadAdminPacientesGerais();
  } else {
    document.getElementById('view-estagiario').classList.remove('hidden');
    loadPacientes();
  }
}

async function doLogin() {
  const email = document.getElementById('login-email').value;
  const senha = document.getElementById('login-senha').value;
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ email, senha })
  });
  const data = await res.json();
  if (data.ok) window.location.reload();
  else {
    const err = document.getElementById('login-error');
    err.textContent = data.error;
    err.classList.remove('hidden');
  }
}

async function loadAdminPacientesGerais() {
  const res = await fetch('/api/admin/pacientes_todos');
  const pacientes = await res.json();
  const div = document.getElementById('lista-admin-pacientes');
  div.innerHTML = pacientes.map(p => `
    <div class="card p-4 flex justify-between items-center border-l-4 ${p.procedimentos_ativos.length > 0 ? 'border-red-400' : 'border-teal-400'}">
      <div>
        <p class="font-bold">${p.nome}</p>
        <p class="text-xs text-slate-500">${p.setor_nome} · Leito ${p.leito}</p>
      </div>
      <span class="badge ${p.procedimentos_ativos.length > 0 ? 'badge-red' : 'badge-green'}">
        ${p.procedimentos_ativos.length} Procs. Ativos
      </span>
    </div>
  `).join('');
}

async function loadDashboardAdmin() {
  const res = await fetch('/api/dashboard');
  const data = await res.json();
  document.getElementById('dash-pacientes').textContent = data.total_pacientes;
  document.getElementById('dash-proc').textContent = data.total_proc_ativos;
  document.getElementById('dash-transf').textContent = data.total_transferencias_pendentes;

  document.getElementById('lista-setores').innerHTML = data.setores.map(s => `
    <div class="p-2 bg-slate-50 rounded-lg flex justify-between text-sm">
      <span>${s.nome}</span> <b>${s.total} pac.</b>
    </div>
  `).join('');

  const resUsr = await fetch('/api/usuarios');
  const usuarios = await resUsr.json();
  document.getElementById('lista-usuarios').innerHTML = usuarios.map(u => `
    <div class="p-2 bg-slate-50 rounded-lg flex justify-between text-sm">
      <span>${u.nome}</span> <span class="text-slate-400 text-xs">${u.setor_nome || 'Admin'}</span>
    </div>
  `).join('');
}

async function cadastrarPaciente() {
  const payload = {
    nome: document.getElementById('cad-nome').value,
    idade: document.getElementById('cad-idade').value,
    leito: document.getElementById('cad-leito').value,
    setor_id: State.nivel === 'admin' ? document.getElementById('cad-setor-id').value : State.setorId
  };
  
  const res = await fetch('/api/pacientes', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  });
  
  if(res.ok) {
    showToast("Paciente cadastrado com sucesso!");
    if(State.nivel === 'admin') loadAdminPacientesGerais();
    else loadPacientes();
    showTab('pacientes');
  }
}

async function criarUsuario() {
  const payload = {
    nome: document.getElementById('m-usr-nome').value,
    email: document.getElementById('m-usr-email').value,
    nivel_acesso: document.getElementById('m-usr-nivel').value,
    senha: document.getElementById('m-usr-senha').value,
    setor_id: document.getElementById('m-usr-nivel').value === 'admin' ? null : document.getElementById('m-usr-setor').value
  };
  const res = await fetch('/api/usuarios', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  });
  if(res.ok) {
    showToast("Novo membro cadastrado!");
    closeModal('modal-usuario');
    loadDashboardAdmin();
  }
}

function showTab(tab) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
  document.getElementById(`tab-${tab}`).classList.remove('hidden');
}

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function doLogout() { fetch('/api/logout', {method:'POST'}).then(() => window.location.reload()); }

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = "#0d9488";
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3000);
}
