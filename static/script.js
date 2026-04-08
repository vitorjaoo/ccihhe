/* =========================================================
   CCIH — Sistema de Rastreio de Infecção Hospitalar
   script.js — SPA Controller
   ========================================================= */

const NIVEL_LABELS = {
  admin: '🔑 Administrador',
  estagiario: '🩺 Estagiário',
  espectador: '👁 Espectador',
};

const INF_COLORS = {
  'Trato Urinário': '#3b82f6',
  'Sepse': '#ef4444',
  'Pneumonia': '#f59e0b',
  'Ferida Operatória': '#8b5cf6',
  'Outra': '#64748b',
};

/* ─── STATE ─────────────────────────────────────────── */
const State = {
  user: null,
  pacientes: [],
  setores: [],
  motivos: [],
  currentView: 'dashboard',
  currentPacienteId: null,
  currentPacienteData: null,
  editingPacienteId: null, // Novo estado para Edição
  pacFilter: 'internado',
  pendingProcId: null,
  pendingAltaPacId: null,
};

/* ─── UTILS ─────────────────────────────────────────── */
function today() { return new Date().toISOString().split('T')[0]; }
function currentMonth() { return new Date().toISOString().slice(0, 7); }

function diffDias(dataStr) {
  if (!dataStr) return null;
  const d = new Date(dataStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor((now - d) / 86400000);
}

function formatDate(str) {
  if (!str) return '—';
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

function diasBadge(dias) {
  if (dias === null) return '';
  let cls = 'dias-ok';
  if (dias >= 7 && dias < 14) cls = 'dias-warn';
  if (dias >= 14) cls = 'dias-danger';
  return `<span class="dias-badge ${cls}">⏱ ${dias}d</span>`;
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function showModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

/* ─── API ────────────────────────────────────────────── */
async function api(method, path, body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro no servidor');
  return data;
}

/* ─── AUTH & APP ─────────────────────────────────────── */
const App = {
  async login() {
    const email = document.getElementById('login-email').value.trim();
    const senha = document.getElementById('login-senha').value;
    const errEl = document.getElementById('login-error');
    errEl.style.display = 'none';
    try {
      const user = await api('POST', '/api/auth/login', { email, senha });
      State.user = user;
      this.initApp();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    }
  },

  async logout() {
    await api('POST', '/api/auth/logout');
    State.user = null;
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-screen').style.display = 'none';
    document.getElementById('login-email').value = '';
    document.getElementById('login-senha').value = '';
  },

  async checkSession() {
    try {
      const user = await api('GET', '/api/auth/me');
      State.user = user;
      this.initApp();
    } catch {
      document.getElementById('login-screen').style.display = 'flex';
    }
  },

  async initApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'block';

    const u = State.user;
    document.getElementById('nav-user-nome').textContent = u.nome;
    document.getElementById('nav-user-nivel').textContent = NIVEL_LABELS[u.nivel_acesso] || u.nivel_acesso;

    if (u.nivel_acesso === 'admin') {
      document.getElementById('nav-admin-group').style.display = 'block';
      document.getElementById('btn-imprimir-relatorio').style.display = 'inline-flex';
    }

    if (u.nivel_acesso === 'espectador') {
      document.getElementById('readonly-badge').style.display = 'flex';
      document.querySelectorAll('.write-only').forEach(el => el.style.display = 'none');
    }

    if (u.nivel_acesso === 'estagiario' && u.setor_id) {
      document.getElementById('topbar-setor').style.display = 'block';
    }

    document.getElementById('filtro-mes').value = currentMonth();
    document.getElementById('reg-data').value = today();
    document.getElementById('inf-data').value = today();

    await this.loadSetores();
    await this.loadMotivos();
    this.navigate('dashboard');
  },

  /* ─── NAVIGATION ───────────────────────────────────── */
  navigate(view) {
    State.currentView = view;
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const link = document.getElementById(`nav-${view}`);
    if (link) link.classList.add('active');

    ['view-dashboard', 'view-pacientes', 'view-setores', 'view-usuarios'].forEach(v => {
      document.getElementById(v).style.display = (v === `view-${view}`) ? 'block' : 'none';
    });

    if (window.innerWidth < 1024) this.toggleMenu(false);

    if (view === 'pacientes') this.loadPacientes();
    if (view === 'dashboard') this.loadDashboard();
    if (view === 'setores') this.loadSetores();
    if (view === 'usuarios') this.loadUsuarios();
  },

  toggleMenu(force) {
    const sb = document.getElementById('sidebar');
    if (force !== undefined) sb.classList.toggle('open', force);
    else sb.classList.toggle('open');
  },

  /* ─── PACIENTES ────────────────────────────────────── */
  async loadPacientes() {
    try {
      const todos = await api('GET', '/api/pacientes');
      
      let filterArr = todos.filter(p => p.status === State.pacFilter && !p.setor_id_destino);
      // NOVO: Ordenação Natural de Leitos
      filterArr.sort((a, b) => (a.leito || '').localeCompare(b.leito || '', undefined, { numeric: true, sensitivity: 'base' }));

      const pendentes = todos.filter(p => p.setor_id_destino == State.user.setor_id);
      this.renderTransferencias(pendentes);
      
      State.pacientes = filterArr;
      
      document.getElementById('tab-internados').classList.toggle('active', State.pacFilter === 'internado');
      document.getElementById('tab-altas').classList.toggle('active', State.pacFilter === 'alta');

      this.renderPacientes();
    } catch (e) {
      toast('Erro ao carregar pacientes', 'error');
    }
  },

  setPacFilter(status) {
    State.pacFilter = status;
    this.loadPacientes();
  },

  renderPacientes() {
    const c = document.getElementById('lista-pacientes');
    if (State.pacientes.length === 0) {
      c.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--slate-500)">Nenhum paciente encontrado.</div>`;
      return;
    }
    c.innerHTML = State.pacientes.map(p => {
      const diff = diffDias(p.data_internacao);
      const badge = (p.status === 'internado') ? diasBadge(diff) : `<span class="badge badge-gray">Alta</span>`;
      const diasTexto = diff !== null ? `${diff} dias` : '?';

      return `
      <div class="card" style="padding:20px;display:flex;flex-direction:column">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span class="badge badge-gray">${p.setor_nome || '—'}</span>
          <span class="badge badge-blue" style="font-size:13px">${p.leito}</span>
        </div>
        <h3 style="font-size:16px;font-weight:700;margin-bottom:6px">${p.nome}</h3>
        ${p.status === 'internado' ? `<div style="margin-bottom:12px">${badge}</div>` : ''}
        
        <div style="font-size:13px;color:var(--slate-500);margin-bottom:16px;line-height:1.6">
          <div style="display:flex;justify-content:space-between"><span>Prontuário:</span> <strong style="color:var(--slate-800)">${p.prontuario}</strong></div>
          <div style="display:flex;justify-content:space-between"><span>Idade:</span> <strong style="color:var(--slate-800)">${p.idade} anos</strong></div>
          <div style="display:flex;justify-content:space-between"><span>Diagnóstico:</span> <strong style="color:var(--slate-800)">${p.diagnostico || '-'}</strong></div>
          <div style="display:flex;justify-content:space-between"><span>Internado há:</span> <strong style="color:var(--slate-800)">${diasTexto}</strong></div>
        </div>
        <div style="display:flex;gap:8px;border-top:1px solid var(--slate-100);padding-top:12px">
          <button class="btn btn-ghost btn-sm" style="flex:1" onclick="App.verPaciente(${p.id})">Abrir Prontuário</button>
          <button class="btn btn-ghost btn-sm write-only" title="Editar" onclick="App.openEditPaciente(${p.id})">✏️</button>
        </div>
      </div>
      `;
    }).join('');
  },

  openModalNovoPaciente() {
    ['pac-nome', 'pac-idade', 'pac-pront', 'pac-leito', 'pac-fone', 'pac-diag'].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.value = '';
    });
    const d = document.getElementById('pac-data-int');
    if(d) d.value = today();
    showModal('modal-novo-pac');
  },

  async salvarPaciente() {
    const nome = document.getElementById('pac-nome').value;
    const idade = document.getElementById('pac-idade').value;
    const prontuario = document.getElementById('pac-pront').value;
    const leito = document.getElementById('pac-leito').value;
    const fone = document.getElementById('pac-fone').value;
    const diagnostico = document.getElementById('pac-diag').value;
    const data_internacao = document.getElementById('pac-data-int').value;

    if (!nome || !idade || !leito || !prontuario) return toast('Preencha os campos obrigatórios', 'error');

    try {
      await api('POST', '/api/pacientes', { nome, idade, prontuario, leito, fone, diagnostico, data_internacao });
      toast('Paciente cadastrado com sucesso!');
      closeModal('modal-novo-pac');
      this.loadPacientes();
    } catch (e) { toast(e.message, 'error'); }
  },

  // --- NOVAS FUNCOES (TRANSFERÊNCIA E EXCLUSÃO) ---
  renderTransferencias(lista) {
    const div = document.getElementById('sessao-transferencia');
    const cont = document.getElementById('lista-transferencia');
    if (!div || !cont) return;
    if (lista.length === 0) { div.style.display = 'none'; return; }
    
    div.style.display = 'block';
    cont.innerHTML = lista.map(p => `
      <div class="card" style="padding:12px; display:flex; justify-content:space-between; align-items:center">
        <span style="font-size:14px"><b>${p.nome}</b> (Leito: ${p.leito})</span>
        <button class="btn btn-sm btn-primary write-only" onclick="App.confirmarRecebimento(${p.id})">Confirmar Entrada</button>
      </div>
    `).join('');
  },

  async confirmarRecebimento(pid) {
    if(!confirm('Confirma a chegada do paciente neste sector?')) return;
    try {
      await api('POST', `/api/pacientes/${pid}/receber`);
      toast('Paciente recebido!');
      this.loadPacientes();
    } catch(e) { toast(e.message, 'error'); }
  },

  openModalTransferencia() {
    const sel = document.getElementById('transf-setor');
    const p = State.currentPacienteData;
    sel.innerHTML = '<option value="">Escolha o destino...</option>' + 
      State.setores.filter(s => s.id != p.setor_id_atual)
      .map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
    
    closeModal('modal-detalhes');
    showModal('modal-transferencia');
  },

  async confirmarTransferencia() {
    const dest = document.getElementById('transf-setor').value;
    if(!dest) return toast('Selecione um sector', 'error');
    try {
      await api('POST', `/api/pacientes/${State.currentPacienteId}/transferir`, { setor_id_destino: dest });
      toast('Transferência solicitada!');
      closeModal('modal-transferencia');
      this.loadPacientes();
    } catch(e) { toast(e.message, 'error'); }
  },

  async deletarPaciente() {
    if (!confirm('ATENÇÃO: Tem a certeza que deseja apagar este paciente e TODO o seu histórico? Esta acção não pode ser desfeita.')) return;
    try {
      await api('DELETE', `/api/pacientes/${State.currentPacienteId}`);
      toast('Paciente apagado com sucesso!');
      closeModal('modal-detalhes');
      this.loadPacientes();
    } catch(e) { toast(e.message, 'error'); }
  },

  openEditPaciente(pid) {
    const p = State.pacientes.find(x => x.id === pid);
    if (!p) return;
    State.editingPacienteId = pid;
    
    document.getElementById('edit-pac-nome').value = p.nome;
    document.getElementById('edit-pac-idade').value = p.idade;
    document.getElementById('edit-pac-pront').value = p.prontuario;
    document.getElementById('edit-pac-leito').value = p.leito;
    document.getElementById('edit-pac-fone').value = p.fone || '';
    document.getElementById('edit-pac-diag').value = p.diagnostico || '';
    document.getElementById('edit-pac-data').value = p.data_internacao || '';
    
    showModal('modal-edit-pac');
  },

  async salvarEdicaoPaciente() {
    const payload = {
      nome: document.getElementById('edit-pac-nome').value,
      idade: document.getElementById('edit-pac-idade').value,
      prontuario: document.getElementById('edit-pac-pront').value,
      leito: document.getElementById('edit-pac-leito').value,
      fone: document.getElementById('edit-pac-fone').value,
      diagnostico: document.getElementById('edit-pac-diag').value,
      data_internacao: document.getElementById('edit-pac-data').value
    };
    try {
      await api('PUT', `/api/pacientes/${State.editingPacienteId}`, payload);
      toast('Paciente actualizado com sucesso!');
      closeModal('modal-edit-pac');
      this.loadPacientes();
    } catch(e) { toast(e.message, 'error'); }
  },

  /* ─── DETALHES DO PACIENTE ─────────────────────────── */
  async verPaciente(pid) {
    try {
      const data = await api('GET', `/api/pacientes/${pid}/detalhes`);
      State.currentPacienteId = pid;
      State.currentPacienteData = data.paciente;
      this.renderPacienteDetalhes(data);
      showModal('modal-detalhes');
    } catch (e) { toast(e.message, 'error'); }
  },

  renderPacienteDetalhes(data) {
    const p = data.paciente;
    document.getElementById('det-nome').textContent = p.nome;
    document.getElementById('det-badge-setor').textContent = p.setor_nome || 'Sector não informado';
    document.getElementById('det-badge-status').textContent = p.status.toUpperCase();
    
    document.getElementById('det-info-basica').innerHTML = `
      <div><span style="color:var(--slate-500)">Prontuário:</span> <b>${p.prontuario}</b></div>
      <div><span style="color:var(--slate-500)">Idade:</span> <b>${p.idade} anos</b></div>
      <div><span style="color:var(--slate-500)">Leito:</span> <b>${p.leito}</b></div>
      <div><span style="color:var(--slate-500)">Telefone:</span> <b>${p.fone || '—'}</b></div>
      <div><span style="color:var(--slate-500)">Admissão:</span> <b>${formatDate(p.data_internacao)}</b></div>
      <div><span style="color:var(--slate-500)">Diagnóstico:</span> <b>${p.diagnostico || 'Não informado'}</b></div>
    `;

    document.getElementById('btn-alta-paciente').style.display = (p.status === 'internado') ? 'inline-flex' : 'none';

    const btnDel = document.getElementById('btn-delete-paciente');
    if (btnDel) {
      btnDel.style.display = (State.user.nivel_acesso === 'admin') ? 'inline-flex' : 'none';
    }

    this.renderProcedimentos(data.procedimentos);
    this.renderInfeccoes(data.infeccoes);
    this.renderRegistros(data.registros);
  },

  /* ─── PROCEDIMENTOS (DISPOSITIVOS) ─────────────────── */
  renderProcedimentos(procs) {
    const c = document.getElementById('det-procedimentos');
    if (!procs.length) { c.innerHTML = '<div style="color:var(--slate-400);font-size:13px">Nenhum dispositivo registado.</div>'; return; }
    
    c.innerHTML = procs.map(pr => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--slate-100)">
        <div>
          <div style="font-weight:600;font-size:13px;color:${pr.status === 'ativo' ? 'var(--slate-800)' : 'var(--slate-400)'}">
            ${pr.tipo_procedimento}
          </div>
          <div style="font-size:11px;color:var(--slate-500)">
            Instalado: ${formatDate(pr.data_insercao)} ${pr.status === 'removido' ? `| Removido: ${formatDate(pr.data_remocao)}` : ''}
          </div>
        </div>
        ${pr.status === 'ativo' ? `
          <button class="btn btn-ghost btn-sm write-only" onclick="App.confirmRemoverProc(${pr.id})">Remover</button>
        ` : `<span class="badge badge-gray" style="font-size:10px">Removido</span>`}
      </div>
    `).join('');
  },

  toggleOutrosProcedimento() {
    const val = document.getElementById('proc-tipo').value;
    const box = document.getElementById('proc-outros');
    if (box) {
      box.style.display = (val === 'Outros') ? 'block' : 'none';
    }
  },

  openModalProc() {
    document.getElementById('proc-tipo').value = 'Cateter Venoso Central (CVC)';
    this.toggleOutrosProcedimento();
    document.getElementById('proc-data').value = today();
    showModal('modal-proc');
  },

  async salvarProc() {
    let tipo = document.getElementById('proc-tipo').value;
    if (tipo === 'Outros') {
      tipo = document.getElementById('proc-outros').value.trim();
      if (!tipo) return toast('Digite o nome do dispositivo', 'error');
    }
    const data_ins = document.getElementById('proc-data').value;
    if (!data_ins) return toast('Informe a data', 'error');

    try {
      await api('POST', `/api/pacientes/${State.currentPacienteId}/procedimentos`, { tipo_procedimento: tipo, data_insercao: data_ins });
      toast('Dispositivo inserido!');
      closeModal('modal-proc');
      this.verPaciente(State.currentPacienteId);
    } catch (e) { toast(e.message, 'error'); }
  },

  confirmRemoverProc(pid) {
    State.pendingProcId = pid;
    document.getElementById('proc-data-remocao').value = today();
    showModal('modal-rm-proc');
  },

  async removerProc() {
    const data_rem = document.getElementById('proc-data-remocao').value;
    try {
      await api('POST', `/api/procedimentos/${State.pendingProcId}/remover`, { data_remocao: data_rem });
      toast('Dispositivo removido!');
      closeModal('modal-rm-proc');
      this.verPaciente(State.currentPacienteId);
    } catch (e) { toast(e.message, 'error'); }
  },

  /* ─── INFECÇÕES ────────────────────────────────────── */
  renderInfeccoes(infs) {
    const c = document.getElementById('det-infeccoes');
    if (!infs.length) { c.innerHTML = '<div style="color:var(--slate-400);font-size:13px">Nenhuma infecção notificada.</div>'; return; }
    
    c.innerHTML = infs.map(i => {
      const color = INF_COLORS[i.tipo_infeccao] || '#64748b';
      return `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--slate-100)">
        <div style="width:10px;height:10px;border-radius:50%;background:${color}"></div>
        <div>
          <div style="font-weight:600;font-size:13px">${i.tipo_infeccao}</div>
          <div style="font-size:11px;color:var(--slate-500)">Notificado em: ${formatDate(i.data_notificacao)}</div>
        </div>
      </div>
      `;
    }).join('');
  },

  openModalInf() {
    document.getElementById('inf-tipo').value = 'Trato Urinário';
    document.getElementById('inf-data').value = today();
    showModal('modal-inf');
  },

  async salvarInf() {
    const tipo = document.getElementById('inf-tipo').value;
    const dt = document.getElementById('inf-data').value;
    try {
      await api('POST', `/api/pacientes/${State.currentPacienteId}/infeccoes`, { tipo_infeccao: tipo, data_notificacao: dt });
      toast('Infecção notificada!');
      closeModal('modal-inf');
      this.verPaciente(State.currentPacienteId);
    } catch (e) { toast(e.message, 'error'); }
  },

  /* ─── REGISTROS DIÁRIOS ────────────────────────────── */
  renderRegistros(regs) {
    const c = document.getElementById('det-registros');
    if (!regs.length) { c.innerHTML = '<div style="color:var(--slate-400);font-size:13px">Nenhum registo diário.</div>'; return; }
    
    c.innerHTML = regs.map(r => `
      <div style="background:var(--slate-50);padding:10px 14px;border-radius:8px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="font-weight:600;font-size:12px;color:var(--teal-600)">${formatDate(r.data)}</span>
          <span style="font-size:12px;color:var(--slate-500)">Temp: ${r.temperatura ? r.temperatura+'°C' : '—'}</span>
        </div>
      </div>
    `).join('');
  },

  openModalReg() {
    document.getElementById('reg-data').value = today();
    document.getElementById('reg-temp').value = '';
    showModal('modal-reg');
  },

  async salvarReg() {
    const data = document.getElementById('reg-data').value;
    const temp = document.getElementById('reg-temp').value;
    try {
      await api('POST', `/api/pacientes/${State.currentPacienteId}/registros`, { data, temperatura: parseFloat(temp) || null });
      toast('Registo salvo!');
      closeModal('modal-reg');
      this.verPaciente(State.currentPacienteId);
    } catch (e) { toast(e.message, 'error'); }
  },

  /* ─── ALTA DE PACIENTE ─────────────────────────────── */
  openModalAlta() {
    State.pendingAltaPacId = State.currentPacienteId;
    const sel = document.getElementById('alta-motivo');
    sel.innerHTML = State.motivos.map(m => `<option value="${m.id}">${m.nome}</option>`).join('');
    showModal('modal-alta');
  },

  async confirmarAlta() {
    const motivo_id = document.getElementById('alta-motivo').value;
    try {
      await api('POST', `/api/pacientes/${State.pendingAltaPacId}/alta`, { motivo_id });
      toast('Alta registada com sucesso!');
      closeModal('modal-alta');
      closeModal('modal-detalhes');
      this.loadPacientes();
    } catch (e) { toast(e.message, 'error'); }
  },

  /* ─── DASHBOARD ────────────────────────────────────── */
  // CORRECÇÃO DAS ROTAS E VARIÁVEIS AQUI:
  async loadDashboard() {
    const mes = document.getElementById('filtro-mes').value;
    try {
      const data = await api('GET', `/api/dashboard/relatorios?mes=${mes}`);
      
      document.getElementById('dash-altas-mes').textContent = data.pacientes_alta_geral || 0;
      document.getElementById('dash-inf-mes').textContent = data.total_infeccoes_mes || 0;
      document.getElementById('dash-taxa-geral').textContent = data.taxa_infeccao_geral || 0;
      
      const d = data.detalhes;
      if (d) {
        document.getElementById('dash-itu-qtd').textContent = d['Trato Urinario']?.qtd || 0;
        document.getElementById('dash-prop-itu').textContent = (d['Trato Urinario']?.prop || 0) + '%';
        
        document.getElementById('dash-sepse-qtd').textContent = d['Sepse']?.qtd || 0;
        document.getElementById('dash-prop-sepse').textContent = (d['Sepse']?.prop || 0) + '%';
        
        document.getElementById('dash-pneumo-qtd').textContent = d['Pneumonia']?.qtd || 0;
        document.getElementById('dash-prop-pneumonia').textContent = (d['Pneumonia']?.prop || 0) + '%';
        
        document.getElementById('dash-cirur-qtd').textContent = d['Ferida Operatoria']?.qtd || 0;
        document.getElementById('dash-prop-cirurgica').textContent = (d['Ferida Operatoria']?.prop || 0) + '%';
      }
    } catch (e) { toast('Erro ao carregar métricas', 'error'); }
  },

  /* ─── CONFIGURAÇÕES & ADMIN ────────────────────────── */
  async loadSetores() {
    try {
      const data = await api('GET', '/api/setores');
      State.setores = data;
      const c = document.getElementById('lista-setores');
      if (c) {
        c.innerHTML = data.map(s => `
          <div class="card" style="padding:15px;display:flex;justify-content:space-between">
            <span style="font-weight:600">${s.nome}</span>
            <span class="badge badge-gray">ID: ${s.id}</span>
          </div>
        `).join('');
      }
      
      const topSel = document.getElementById('topbar-setor-select');
      if (topSel && State.user.nivel_acesso === 'estagiario') {
        topSel.innerHTML = data.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
        if (State.user.setor_id) topSel.value = State.user.setor_id;
      }
    } catch (e) { console.error('Erro sectores', e); }
  },

  async salvarSetor() {
    const nome = document.getElementById('setor-nome').value.trim();
    if (!nome) return;
    try {
      await api('POST', '/api/setores', { nome });
      toast('Sector criado!');
      closeModal('modal-setor');
      document.getElementById('setor-nome').value = '';
      this.loadSetores();
    } catch (e) { toast(e.message, 'error'); }
  },

  // CORRECÇÃO DA ROTA DE MOTIVOS AQUI:
  async loadMotivos() {
    try {
      State.motivos = await api('GET', '/api/motivos_saida');
    } catch (e) { console.error('Erro motivos', e); }
  },

  async loadUsuarios() {
    try {
      const data = await api('GET', '/api/usuarios');
      document.getElementById('lista-usuarios').innerHTML = data.map(u => `
        <div class="card" style="padding:15px;display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-weight:600">${u.nome}</div>
            <div style="font-size:12px;color:var(--slate-500)">${u.email}</div>
          </div>
          <span class="badge badge-blue">${u.nivel_acesso}</span>
        </div>
      `).join('');
      
      const userSetorSel = document.getElementById('user-setor');
      userSetorSel.innerHTML = '<option value="">Sem Sector</option>' + 
        State.setores.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
    } catch (e) { toast('Erro ao carregar utilizadores', 'error'); }
  },

  async salvarUsuario() {
    const payload = {
      nome: document.getElementById('user-nome').value,
      email: document.getElementById('user-email').value,
      senha: document.getElementById('user-senha').value,
      nivel_acesso: document.getElementById('user-nivel').value,
      setor_id: document.getElementById('user-setor').value || null
    };
    if (!payload.nome || !payload.email || !payload.senha) return toast('Preencha os campos obrigatórios', 'error');
    
    try {
      await api('POST', '/api/usuarios', payload);
      toast('Utilizador criado!');
      closeModal('modal-user');
      this.loadUsuarios();
    } catch (e) { toast(e.message, 'error'); }
  },

  openModalMudarSenha() {
    document.getElementById('senha-atual').value = '';
    document.getElementById('senha-nova').value = '';
    showModal('modal-mudar-senha');
  },

  async salvarNovaSenha() {
    const atual = document.getElementById('senha-atual').value;
    const nova = document.getElementById('senha-nova').value;
    if (!atual || !nova) return toast('Preencha os campos', 'error');
    
    try {
      await api('POST', '/api/auth/mudar-senha', { senha_atual: atual, senha_nova: nova });
      toast('Senha alterada com sucesso!');
      closeModal('modal-mudar-senha');
    } catch (e) { toast(e.message, 'error'); }
  }
};

/* ─── INIT BOOTSTRAP ─────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  App.checkSession();
});
