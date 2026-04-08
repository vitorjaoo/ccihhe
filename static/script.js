/* =========================================================
   CCIH — Sistema de Rastreio de Infecção Hospitalar · UFAL
   script.js — SPA Controller v3.0
   =========================================================
   Endpoints alinhados com app.py (app__1_.py):
   GET    /api/auth/me
   POST   /api/auth/login
   POST   /api/auth/logout
   PUT    /api/auth/senha
   GET    /api/setores
   POST   /api/setores
   DELETE /api/setores/:id
   GET    /api/usuarios
   POST   /api/usuarios
   DELETE /api/usuarios/:id
   GET    /api/pacientes
   POST   /api/pacientes
   GET    /api/pacientes/:id
   PUT    /api/pacientes/:id
   DELETE /api/pacientes/:id
   POST   /api/pacientes/:id/alta
   POST   /api/pacientes/:id/transferir
   POST   /api/pacientes/:id/receber
   POST   /api/pacientes/:id/registros
   POST   /api/pacientes/:id/procedimentos
   POST   /api/procedimentos/:id/remover
   POST   /api/pacientes/:id/infeccoes
   GET    /api/motivos_saida
   GET    /api/dashboard/relatorios?mes=YYYY-MM
   ========================================================= */

'use strict';

/* ─── CONSTANTS ─────────────────────────────────────────── */
const NIVEL_LABELS = {
  admin:      'Administrador',
  estagiario: 'Estagiário',
  espectador: 'Espectador',
};

const INF_COLORS = {
  'Trato Urinario':   '#2563EB',
  'Sepse':            '#DC2626',
  'Pneumonia':        '#D97706',
  'Ferida Operatoria':'#7C3AED',
  'Outra':            '#64748B',
};

const VIEW_META = {
  dashboard: { title: 'Painel de Controle',   sub: 'Relatórios e métricas do período' },
  pacientes:  { title: 'Gestão de Pacientes',  sub: 'Internações e acompanhamento clínico' },
  setores:    { title: 'Setores e Alas',       sub: 'Gestão de unidades hospitalares' },
  usuarios:   { title: 'Usuários do Sistema',  sub: 'Controle de acesso e permissões' },
};

/* ─── STATE ─────────────────────────────────────────────── */
const State = {
  user: null,
  pacientes: [],
  setores: [],
  motivos: [],
  currentView: 'dashboard',
  currentPacienteId: null,
  currentPacienteData: null,
  editingPacienteId: null,
  pacFilter: 'internado',
  pendingProcId: null,
  pendingAltaPacId: null,
};

/* ─── UTILS ─────────────────────────────────────────────── */
function today()        { return new Date().toISOString().split('T')[0]; }
function currentMonth() { return new Date().toISOString().slice(0, 7); }

function diffDias(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date(); now.setHours(0, 0, 0, 0);
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
  const icon = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  return `<span class="dias-badge ${cls}">${icon} ${dias}d</span>`;
}

function initials(nome) {
  if (!nome) return '?';
  return nome.split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

function toast(msg, type = 'success') {
  const icons = {
    success: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = (icons[type] || '') + msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

/* ─── API ────────────────────────────────────────────────── */
async function api(method, path, body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

/* ─── MODAL HELPERS ──────────────────────────────────────── */
const App = {
  openModal(id)  { document.getElementById(id)?.classList.add('show'); },
  closeModal(id) { document.getElementById(id)?.classList.remove('show'); },

  /* ─── AUTH ─────────────────────────────────────────────── */
  async login() {
    const email = document.getElementById('login-email').value.trim();
    const senha = document.getElementById('login-senha').value;
    const errEl = document.getElementById('login-error');
    errEl.style.display = 'none';
    if (!email || !senha) {
      errEl.textContent = 'Preencha o e-mail e a senha.';
      errEl.style.display = 'block';
      return;
    }
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
    try { await api('POST', '/api/auth/logout'); } catch {}
    State.user = null;
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-screen').style.display = 'none';
    document.getElementById('login-email').value = '';
    document.getElementById('login-senha').value = '';
  },

  async checkSession() {
    try {
      State.user = await api('GET', '/api/auth/me');
      this.initApp();
    } catch {
      document.getElementById('login-screen').style.display = 'flex';
    }
  },

  async initApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'flex';

    const u = State.user;
    document.getElementById('nav-user-nome').textContent = u.nome;
    document.getElementById('nav-user-nivel').textContent = NIVEL_LABELS[u.nivel_acesso] || u.nivel_acesso;
    document.getElementById('nav-user-avatar').textContent = initials(u.nome);

    if (u.nivel_acesso === 'admin') {
      document.getElementById('nav-admin-group').style.display = 'block';
      document.getElementById('btn-imprimir-relatorio').style.display = 'inline-flex';
    }

    if (u.nivel_acesso === 'espectador') {
      document.getElementById('readonly-badge').style.display = 'flex';
      document.querySelectorAll('.write-only').forEach(el => el.style.display = 'none');
    }

    document.getElementById('filtro-mes').value = currentMonth();

    await this.loadSetores();
    await this.loadMotivos();
    this.navigate('dashboard');
  },

  /* ─── NAVIGATION ─────────────────────────────────────── */
  navigate(view) {
    State.currentView = view;

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const link = document.getElementById(`nav-${view}`);
    if (link) link.classList.add('active');

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const vEl = document.getElementById(`view-${view}`);
    if (vEl) vEl.classList.add('active');

    const meta = VIEW_META[view] || { title: view, sub: '' };
    document.getElementById('topbar-title').textContent = meta.title;
    document.getElementById('topbar-subtitle').textContent = meta.sub;

    if (window.innerWidth < 1024) this.toggleMenu(false);

    if (view === 'pacientes')  this.loadPacientes();
    if (view === 'dashboard')  this.loadDashboard();
    if (view === 'setores')    this.loadSetores();
    if (view === 'usuarios')   this.loadUsuarios();
  },

  toggleMenu(force) {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('mobile-overlay');
    if (force !== undefined) {
      sb.classList.toggle('open', force);
      ov.classList.toggle('show', force);
    } else {
      const open = sb.classList.toggle('open');
      ov.classList.toggle('show', open);
    }
  },

  /* ─── PACIENTES ─────────────────────────────────────── */
  async loadPacientes() {
    const grid = document.getElementById('lista-pacientes');
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>Carregando pacientes...</p></div>`;
    try {
      const todos = await api('GET', '/api/pacientes');

      // Pacientes pendentes de recebimento neste setor
      const pendentes = todos.filter(p => p.setor_id_destino === State.user.setor_id);
      this.renderTransferencias(pendentes);

      // Filtro por status, excluindo os em trânsito para este setor
      let lista = todos.filter(p => p.status === State.pacFilter && !p.setor_id_destino);
      lista.sort((a, b) => (a.leito || '').localeCompare(b.leito || '', undefined, { numeric: true, sensitivity: 'base' }));

      State.pacientes = lista;

      document.getElementById('tab-internados').classList.toggle('active', State.pacFilter === 'internado');
      document.getElementById('tab-altas').classList.toggle('active', State.pacFilter === 'alta');

      this.renderPacientes();
    } catch (e) {
      toast('Erro ao carregar pacientes', 'error');
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>Não foi possível carregar os dados.</p></div>`;
    }
  },

  setPacFilter(status) {
    State.pacFilter = status;
    this.loadPacientes();
  },

  renderPacientes() {
    const grid = document.getElementById('lista-pacientes');
    if (!State.pacientes.length) {
      const msg = State.pacFilter === 'internado' ? 'Nenhum paciente internado.' : 'Nenhuma alta registrada.';
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <h3>${msg}</h3>
          <p>Os pacientes cadastrados aparecerão aqui.</p>
        </div>`;
      return;
    }

    grid.innerHTML = State.pacientes.map(p => {
      const diff = diffDias(p.data_internacao);
      const procs = p.procedimentos || [];
      const infs  = p.infeccoes || [];
      const alertas = [];
      if (infs.length > 0)  alertas.push(`<span class="badge badge-red">${infs.length} infecção${infs.length>1?'es':''}</span>`);
      if (procs.length > 0) alertas.push(`<span class="badge badge-navy">${procs.length} dispositivo${procs.length>1?'s':''}</span>`);
      if (diff !== null && diff >= 14) alertas.push(`<span class="badge badge-amber">Longa internação</span>`);

      const canEdit = State.user.nivel_acesso !== 'espectador';

      return `
      <div class="card card-hover pac-card">
        <div class="pac-card-head">
          <span class="pac-card-leito">Leito ${p.leito || '—'}</span>
          ${p.status === 'internado' ? diasBadge(diff) : '<span class="badge badge-gray">Alta</span>'}
        </div>
        <div class="pac-card-name">${p.nome}</div>
        <div class="pac-card-diag">${p.diagnostico || 'Diagnóstico não informado'}</div>
        ${alertas.length ? `<div class="pac-card-alerts">${alertas.join('')}</div>` : ''}
        <div class="pac-card-meta">
          <div class="pac-meta-item"><span>Setor</span><strong>${p.setor_nome || '—'}</strong></div>
          <div class="pac-meta-item"><span>Prontuário</span><strong>${p.prontuario || '—'}</strong></div>
          <div class="pac-meta-item"><span>Idade</span><strong>${p.idade ? p.idade + ' anos' : '—'}</strong></div>
          <div class="pac-meta-item"><span>Internado há</span><strong>${diff !== null ? diff + ' dias' : '—'}</strong></div>
        </div>
        <div class="pac-card-footer">
          <button class="btn btn-primary btn-sm" style="flex:1" onclick="App.verPaciente(${p.id})">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            Prontuário
          </button>
          ${canEdit ? `<button class="btn btn-ghost btn-sm write-only" title="Editar dados" onclick="App.openEditPaciente(${p.id})">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>` : ''}
        </div>
      </div>`;
    }).join('');
  },

  /* ─── TRANSFERÊNCIAS ─────────────────────────────────── */
  renderTransferencias(lista) {
    const div  = document.getElementById('sessao-transferencia');
    const cont = document.getElementById('lista-transferencia');
    if (!div || !cont) return;
    if (!lista.length) { div.style.display = 'none'; return; }

    div.style.display = 'block';
    cont.innerHTML = lista.map(p => `
      <div class="transfer-item">
        <div>
          <strong>${p.nome}</strong>
          <span style="font-size:11px;color:#92400e;margin-left:8px">Leito ${p.leito || '—'}</span>
        </div>
        <button class="btn btn-sm write-only" style="background:#92400e;color:#fff" onclick="App.confirmarRecebimento(${p.id})">
          ✓ Confirmar Chegada
        </button>
      </div>`
    ).join('');
  },

  async confirmarRecebimento(pid) {
    if (!confirm('Confirma a chegada do paciente neste setor?')) return;
    try {
      await api('POST', `/api/pacientes/${pid}/receber`);
      toast('Paciente recebido com sucesso!');
      this.loadPacientes();
    } catch (e) { toast(e.message, 'error'); }
  },

  openModalTransferencia() {
    const sel = document.getElementById('transf-setor');
    const p = State.currentPacienteData;
    sel.innerHTML = '<option value="">Selecione o destino...</option>' +
      State.setores.filter(s => s.id !== p.setor_id_atual)
        .map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
    this.closeModal('modal-detalhes');
    this.openModal('modal-transferencia');
  },

  async confirmarTransferencia() {
    const dest = document.getElementById('transf-setor').value;
    if (!dest) return toast('Selecione um setor de destino', 'error');
    try {
      await api('POST', `/api/pacientes/${State.currentPacienteId}/transferir`, { setor_id_destino: Number(dest) });
      toast('Transferência solicitada!');
      this.closeModal('modal-transferencia');
      this.loadPacientes();
    } catch (e) { toast(e.message, 'error'); }
  },

  /* ─── CADASTRO/EDIÇÃO PACIENTE ───────────────────────── */
  openModalNovoPaciente() {
    ['pac-nome', 'pac-idade', 'pac-pront', 'pac-leito', 'pac-fone', 'pac-diag'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    const d = document.getElementById('pac-data-int');
    if (d) d.value = today();

    // Setor: esconder para estagiário (setor fixo)
    const setorGrp = document.getElementById('pac-setor-group');
    if (setorGrp) {
      if (State.user.nivel_acesso === 'estagiario') {
        setorGrp.style.display = 'none';
      } else {
        setorGrp.style.display = 'block';
        const sel = document.getElementById('pac-setor');
        sel.innerHTML = '<option value="">Sem setor</option>' + State.setores.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
      }
    }
    this.openModal('modal-novo-pac');
  },

  async salvarPaciente() {
    const nome = document.getElementById('pac-nome').value.trim();
    const idade = document.getElementById('pac-idade').value;
    const prontuario = document.getElementById('pac-pront').value.trim();
    const leito = document.getElementById('pac-leito').value.trim();
    const fone = document.getElementById('pac-fone').value.trim();
    const diagnostico = document.getElementById('pac-diag').value.trim();
    const data_internacao = document.getElementById('pac-data-int').value;
    const setor_id = document.getElementById('pac-setor')?.value || null;

    if (!nome) return toast('Informe o nome do paciente', 'error');
    if (!leito) return toast('Informe o leito', 'error');
    if (!prontuario) return toast('Informe o prontuário', 'error');

    try {
      await api('POST', '/api/pacientes', { nome, idade: idade || null, prontuario, leito, fone, diagnostico, data_internacao, setor_id: setor_id || null });
      toast('Paciente cadastrado com sucesso!');
      this.closeModal('modal-novo-pac');
      this.loadPacientes();
    } catch (e) { toast(e.message, 'error'); }
  },

  openEditPaciente(pid) {
    const p = State.pacientes.find(x => x.id === pid);
    if (!p) return;
    State.editingPacienteId = pid;
    document.getElementById('edit-pac-nome').value  = p.nome || '';
    document.getElementById('edit-pac-idade').value = p.idade || '';
    document.getElementById('edit-pac-pront').value = p.prontuario || '';
    document.getElementById('edit-pac-leito').value = p.leito || '';
    document.getElementById('edit-pac-fone').value  = p.fone || '';
    document.getElementById('edit-pac-diag').value  = p.diagnostico || '';
    document.getElementById('edit-pac-data').value  = p.data_internacao || '';
    this.openModal('modal-edit-pac');
  },

  openEditPacienteFromDetail() {
    const p = State.currentPacienteData;
    if (!p) return;
    State.editingPacienteId = p.id;
    document.getElementById('edit-pac-nome').value  = p.nome || '';
    document.getElementById('edit-pac-idade').value = p.idade || '';
    document.getElementById('edit-pac-pront').value = p.prontuario || '';
    document.getElementById('edit-pac-leito').value = p.leito || '';
    document.getElementById('edit-pac-fone').value  = p.fone || '';
    document.getElementById('edit-pac-diag').value  = p.diagnostico || '';
    document.getElementById('edit-pac-data').value  = p.data_internacao || '';
    this.openModal('modal-edit-pac');
  },

  async salvarEdicaoPaciente() {
    const payload = {
      nome:            document.getElementById('edit-pac-nome').value.trim(),
      idade:           document.getElementById('edit-pac-idade').value || null,
      prontuario:      document.getElementById('edit-pac-pront').value.trim(),
      leito:           document.getElementById('edit-pac-leito').value.trim(),
      fone:            document.getElementById('edit-pac-fone').value.trim(),
      diagnostico:     document.getElementById('edit-pac-diag').value.trim(),
      data_internacao: document.getElementById('edit-pac-data').value,
    };
    if (!payload.nome) return toast('Nome é obrigatório', 'error');
    try {
      await api('PUT', `/api/pacientes/${State.editingPacienteId}`, payload);
      toast('Paciente atualizado!');
      this.closeModal('modal-edit-pac');
      this.loadPacientes();
      // Se prontuário estiver aberto, recarregar
      if (State.currentPacienteId === State.editingPacienteId) {
        this.verPaciente(State.editingPacienteId);
      }
    } catch (e) { toast(e.message, 'error'); }
  },

  async deletarPaciente() {
    if (!confirm('ATENÇÃO: Excluir este paciente apaga todo o histórico permanentemente. Confirmar?')) return;
    try {
      await api('DELETE', `/api/pacientes/${State.currentPacienteId}`);
      toast('Paciente excluído');
      this.closeModal('modal-detalhes');
      this.loadPacientes();
    } catch (e) { toast(e.message, 'error'); }
  },

  /* ─── DETALHES DO PACIENTE ───────────────────────────── */
  async verPaciente(pid) {
    try {
      // Usa GET /api/pacientes/:id (retorna dados completos com registros/procedimentos/infecções)
      const pac = await api('GET', `/api/pacientes/${pid}`);
      State.currentPacienteId  = pid;
      State.currentPacienteData = pac;
      this.renderPacienteDetalhes(pac);
      this.openModal('modal-detalhes');
    } catch (e) { toast(e.message || 'Erro ao carregar prontuário', 'error'); }
  },

  renderPacienteDetalhes(p) {
    document.getElementById('det-nome').textContent = p.nome;
    document.getElementById('det-badge-setor').textContent = p.setor_nome || 'Setor não informado';

    const statusBadge = document.getElementById('det-badge-status');
    statusBadge.textContent = p.status === 'internado' ? 'Internado' : 'Alta';
    statusBadge.className = 'badge ' + (p.status === 'internado' ? 'badge-green' : 'badge-gray');

    const diff = diffDias(p.data_internacao);
    document.getElementById('det-badge-dias').innerHTML = diasBadge(diff);

    document.getElementById('det-info-basica').innerHTML = `
      <div class="det-info-item"><span>Prontuário</span><strong>${p.prontuario || '—'}</strong></div>
      <div class="det-info-item"><span>Idade</span><strong>${p.idade ? p.idade + ' anos' : '—'}</strong></div>
      <div class="det-info-item"><span>Leito</span><strong>${p.leito || '—'}</strong></div>
      <div class="det-info-item"><span>Telefone</span><strong>${p.fone || '—'}</strong></div>
      <div class="det-info-item"><span>Data de Admissão</span><strong>${formatDate(p.data_internacao)}</strong></div>
      <div class="det-info-item"><span>Diagnóstico</span><strong>${p.diagnostico || 'Não informado'}</strong></div>`;

    const btnAlta = document.getElementById('btn-alta-paciente');
    if (btnAlta) btnAlta.style.display = (p.status === 'internado' && State.user.nivel_acesso !== 'espectador') ? 'inline-flex' : 'none';

    const btnDel = document.getElementById('btn-delete-paciente');
    if (btnDel) btnDel.style.display = State.user.nivel_acesso === 'admin' ? 'inline-flex' : 'none';

    const btnTransf = document.getElementById('btn-transferir');
    if (btnTransf) btnTransf.style.display = (p.status === 'internado' && State.user.nivel_acesso !== 'espectador') ? 'inline-flex' : 'none';

    this.renderProcedimentos(p.procedimentos || []);
    this.renderInfeccoes(p.infeccoes || []);
    this.renderRegistros(p.registros || []);
  },

  /* ─── PROCEDIMENTOS ──────────────────────────────────── */
  renderProcedimentos(procs) {
    const c = document.getElementById('det-procedimentos');
    if (!procs.length) {
      c.innerHTML = '<div style="color:var(--ink-3);font-size:13px;padding:8px 0">Nenhum dispositivo registrado.</div>';
      return;
    }
    c.innerHTML = procs.map(pr => {
      const isAtivo = pr.status === 'ativo';
      const diasDisp = diffDias(pr.data_insercao);
      return `
      <div class="proc-item">
        <div>
          <div class="proc-tipo" style="color:${isAtivo ? 'var(--ink)' : 'var(--ink-3)'}">${pr.tipo_procedimento}</div>
          <div class="proc-meta">
            Inserido: ${formatDate(pr.data_insercao)}
            ${!isAtivo ? ` · Removido: ${formatDate(pr.data_remocao)}` : ` · ${diasDisp}d em uso`}
          </div>
        </div>
        ${isAtivo
          ? `<button class="btn btn-ghost btn-xs write-only" style="color:var(--red)" onclick="App.confirmRemoverProc(${pr.id})">Remover</button>`
          : `<span class="badge badge-gray">Removido</span>`
        }
      </div>`;
    }).join('');
  },

  toggleOutrosProcedimento() {
    const val = document.getElementById('proc-tipo').value;
    const box = document.getElementById('proc-outros');
    if (box) box.style.display = (val === 'Outros') ? 'block' : 'none';
  },

  openModalProc() {
    document.getElementById('proc-tipo').value = 'Cateter Venoso Central (CVC)';
    this.toggleOutrosProcedimento();
    document.getElementById('proc-data').value = today();
    this.openModal('modal-proc');
  },

  async salvarProc() {
    let tipo = document.getElementById('proc-tipo').value;
    if (tipo === 'Outros') {
      tipo = document.getElementById('proc-outros-val').value.trim();
      if (!tipo) return toast('Descreva o dispositivo', 'error');
    }
    const data_insercao = document.getElementById('proc-data').value;
    if (!data_insercao) return toast('Informe a data de inserção', 'error');
    try {
      await api('POST', `/api/pacientes/${State.currentPacienteId}/procedimentos`, { tipo_procedimento: tipo, data_insercao });
      toast('Dispositivo registrado!');
      this.closeModal('modal-proc');
      this.verPaciente(State.currentPacienteId);
    } catch (e) { toast(e.message, 'error'); }
  },

  confirmRemoverProc(pid) {
    State.pendingProcId = pid;
    document.getElementById('proc-data-remocao').value = today();
    this.openModal('modal-rm-proc');
  },

  async removerProc() {
    const data_remocao = document.getElementById('proc-data-remocao').value;
    if (!data_remocao) return toast('Informe a data de remoção', 'error');
    try {
      await api('POST', `/api/procedimentos/${State.pendingProcId}/remover`, { data_remocao });
      toast('Dispositivo removido!');
      this.closeModal('modal-rm-proc');
      this.verPaciente(State.currentPacienteId);
    } catch (e) { toast(e.message, 'error'); }
  },

  /* ─── INFECÇÕES ──────────────────────────────────────── */
  renderInfeccoes(infs) {
    const c = document.getElementById('det-infeccoes');
    if (!infs.length) {
      c.innerHTML = '<div style="color:var(--ink-3);font-size:13px;padding:8px 0">Nenhuma infecção notificada.</div>';
      return;
    }
    c.innerHTML = infs.map(i => {
      const color = INF_COLORS[i.tipo_infeccao] || '#64748b';
      return `
      <div class="inf-item">
        <div class="inf-dot" style="background:${color}"></div>
        <div>
          <div style="font-weight:600;font-size:13px">${i.tipo_infeccao}</div>
          <div style="font-size:11px;color:var(--ink-3)">Notificado em ${formatDate(i.data_notificacao)}</div>
        </div>
      </div>`;
    }).join('');
  },

  openModalInf() {
    document.getElementById('inf-tipo').value = 'Trato Urinario';
    document.getElementById('inf-data').value = today();
    this.openModal('modal-inf');
  },

  async salvarInf() {
    const tipo = document.getElementById('inf-tipo').value;
    const data_notificacao = document.getElementById('inf-data').value;
    try {
      await api('POST', `/api/pacientes/${State.currentPacienteId}/infeccoes`, { tipo_infeccao: tipo, data_notificacao });
      toast('Infecção notificada!');
      this.closeModal('modal-inf');
      this.verPaciente(State.currentPacienteId);
    } catch (e) { toast(e.message, 'error'); }
  },

  /* ─── REGISTROS DIÁRIOS ──────────────────────────────── */
  renderRegistros(regs) {
    const c = document.getElementById('det-registros');
    if (!regs.length) {
      c.innerHTML = '<div style="color:var(--ink-3);font-size:13px;padding:8px 0">Nenhum registro diário.</div>';
      return;
    }
    c.innerHTML = regs.map(r => `
      <div class="reg-item">
        <span style="font-weight:600;font-size:12px;color:var(--navy);font-family:\'IBM Plex Mono\',monospace">${formatDate(r.data)}</span>
        <span style="font-size:12px;color:var(--ink-3)">Temp: <strong style="color:${r.temperatura && r.temperatura >= 38 ? 'var(--red)' : 'var(--ink)'}">${r.temperatura ? r.temperatura + '°C' : '—'}</strong></span>
      </div>`).join('');
  },

  openModalReg() {
    document.getElementById('reg-data').value = today();
    document.getElementById('reg-temp').value = '';
    this.openModal('modal-reg');
  },

  async salvarReg() {
    const data = document.getElementById('reg-data').value;
    const temperatura = parseFloat(document.getElementById('reg-temp').value) || null;
    if (!data) return toast('Informe a data', 'error');
    try {
      await api('POST', `/api/pacientes/${State.currentPacienteId}/registros`, { data, temperatura });
      toast('Registro salvo!');
      this.closeModal('modal-reg');
      this.verPaciente(State.currentPacienteId);
    } catch (e) { toast(e.message, 'error'); }
  },

  /* ─── ALTA ───────────────────────────────────────────── */
  openModalAlta() {
    State.pendingAltaPacId = State.currentPacienteId;
    const sel = document.getElementById('alta-motivo');
    sel.innerHTML = State.motivos.map(m => `<option value="${m.id}">${m.nome}</option>`).join('');
    this.openModal('modal-alta');
  },

  async confirmarAlta() {
    const motivo_saida_id = document.getElementById('alta-motivo').value;
    if (!motivo_saida_id) return toast('Selecione o motivo', 'error');
    try {
      // Endpoint correto: POST /api/pacientes/:id/alta  body: { motivo_saida_id }
      await api('POST', `/api/pacientes/${State.pendingAltaPacId}/alta`, { motivo_saida_id: Number(motivo_saida_id) });
      toast('Alta registrada com sucesso!');
      this.closeModal('modal-alta');
      this.closeModal('modal-detalhes');
      this.loadPacientes();
    } catch (e) { toast(e.message, 'error'); }
  },

  /* ─── DASHBOARD ──────────────────────────────────────── */
  async loadDashboard() {
    const mes = document.getElementById('filtro-mes').value;
    try {
      // Endpoint correto: GET /api/dashboard/relatorios?mes=YYYY-MM
      const data = await api('GET', `/api/dashboard/relatorios?mes=${mes}`);

      // Total internados: carregar via pacientes
      let totalInternados = '—';
      try {
        const pacs = await api('GET', '/api/pacientes');
        totalInternados = pacs.filter(p => p.status === 'internado').length;
      } catch {}

      document.getElementById('dash-tot-int').textContent   = totalInternados;
      document.getElementById('dash-altas-mes').textContent = data.pacientes_alta_geral ?? '—';
      document.getElementById('dash-inf-mes').textContent   = data.total_infeccoes_mes ?? '—';
      document.getElementById('dash-taxa').textContent      = (data.taxa_infeccao_geral ?? '—') + '%';

      this.renderDashChart(data.detalhes || {}, data.total_infeccoes_mes || 0);
      this.renderDashResumo(data);
    } catch (e) {
      toast('Erro ao carregar métricas', 'error');
    }
  },

  renderDashChart(detalhes, total) {
    const c = document.getElementById('dash-inf-chart');
    const tipos = Object.keys(detalhes);
    if (!tipos.length || total === 0) {
      c.innerHTML = '<div style="color:var(--ink-3);font-size:13px;text-align:center;padding:20px">Nenhum dado para o período.</div>';
      return;
    }
    const maxQtd = Math.max(...tipos.map(t => detalhes[t]?.qtd || 0), 1);
    c.innerHTML = tipos.map(tipo => {
      const color = INF_COLORS[tipo] || '#64748b';
      const qtd   = detalhes[tipo]?.qtd  || 0;
      const prop  = detalhes[tipo]?.prop || 0;
      const pct   = Math.round((qtd / maxQtd) * 100);
      return `
      <div class="inf-row">
        <div class="inf-dot" style="background:${color}"></div>
        <div class="inf-name">${tipo}</div>
        <div class="inf-bar-wrap"><div class="inf-bar" style="width:${pct}%;background:${color}20;border:1px solid ${color}40;position:relative">
          <div style="position:absolute;inset:0;background:${color};width:${pct}%;border-radius:999px"></div>
        </div></div>
        <div class="inf-count">${qtd}</div>
        <div style="font-size:11px;color:var(--ink-3);min-width:36px;text-align:right">${prop}%</div>
      </div>`;
    }).join('');
  },

  renderDashResumo(data) {
    const c = document.getElementById('dash-resumo');
    const mes = data.ano_mes || '—';
    const itens = [
      { label: 'Período',           val: mes },
      { label: 'Pacientes com alta',val: data.pacientes_alta_geral ?? 0 },
      { label: 'Infecções no mês',  val: data.total_infeccoes_mes ?? 0 },
      { label: 'Taxa de infecção',  val: (data.taxa_infeccao_geral ?? 0) + '%' },
    ];
    c.innerHTML = itens.map(it => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border-l)">
        <span style="font-size:12px;color:var(--ink-3)">${it.label}</span>
        <strong style="font-size:13px;color:var(--ink);font-family:'IBM Plex Mono',monospace">${it.val}</strong>
      </div>`).join('');
  },

  /* ─── SETORES ────────────────────────────────────────── */
  async loadSetores() {
    try {
      const data = await api('GET', '/api/setores');
      State.setores = data;

      const tbody = document.getElementById('lista-setores-tbody');
      if (tbody) {
        tbody.innerHTML = data.length === 0
          ? '<tr><td colspan="3" style="text-align:center;color:var(--ink-3);padding:20px">Nenhum setor cadastrado.</td></tr>'
          : data.map(s => `
            <tr>
              <td><span style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;color:var(--ink-3)">#${s.id}</span></td>
              <td><strong>${s.nome}</strong></td>
              <td style="text-align:right">
                ${State.user?.nivel_acesso === 'admin' ? `<button class="btn btn-ghost btn-xs" style="color:var(--red)" onclick="App.deletarSetor(${s.id},'${s.nome.replace(/'/g,"\\'")}')">Excluir</button>` : ''}
              </td>
            </tr>`).join('');
      }

      // Populate select boxes
      const pac_sel = document.getElementById('pac-setor');
      if (pac_sel) {
        pac_sel.innerHTML = '<option value="">Sem setor</option>' + data.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
      }
    } catch (e) { console.error('Erro setores', e); }
  },

  openModal_setor() { this.openModal('modal-setor'); },

  async salvarSetor() {
    const nome = document.getElementById('setor-nome').value.trim();
    if (!nome) return toast('Informe o nome do setor', 'error');
    try {
      await api('POST', '/api/setores', { nome });
      toast('Setor criado com sucesso!');
      this.closeModal('modal-setor');
      document.getElementById('setor-nome').value = '';
      this.loadSetores();
    } catch (e) { toast(e.message, 'error'); }
  },

  async deletarSetor(id, nome) {
    if (!confirm(`Excluir o setor "${nome}"? Esta ação pode afetar pacientes vinculados.`)) return;
    try {
      await api('DELETE', `/api/setores/${id}`);
      toast('Setor excluído');
      this.loadSetores();
    } catch (e) { toast(e.message, 'error'); }
  },

  /* ─── MOTIVOS ────────────────────────────────────────── */
  async loadMotivos() {
    try {
      // Endpoint correto: GET /api/motivos_saida
      State.motivos = await api('GET', '/api/motivos_saida');
    } catch (e) { console.error('Erro motivos', e); }
  },

  /* ─── USUÁRIOS ───────────────────────────────────────── */
  async loadUsuarios() {
    try {
      const data = await api('GET', '/api/usuarios');
      const tbody = document.getElementById('lista-usuarios');
      tbody.innerHTML = data.length === 0
        ? '<tr><td colspan="5" style="text-align:center;color:var(--ink-3);padding:20px">Nenhum usuário cadastrado.</td></tr>'
        : data.map(u => {
          const nivelBadge = {
            admin: 'badge-red', estagiario: 'badge-navy', espectador: 'badge-gray'
          }[u.nivel_acesso] || 'badge-gray';
          return `
          <tr>
            <td><strong>${u.nome}</strong></td>
            <td style="font-size:12px;color:var(--ink-3)">${u.email}</td>
            <td><span class="badge ${nivelBadge}">${NIVEL_LABELS[u.nivel_acesso] || u.nivel_acesso}</span></td>
            <td style="font-size:12px;color:var(--ink-3)">${u.setor_nome || '—'}</td>
            <td style="text-align:right">
              ${u.id !== State.user?.id ? `<button class="btn btn-ghost btn-xs" style="color:var(--red)" onclick="App.deletarUsuario(${u.id},'${u.nome.replace(/'/g,"\\'")}')">Excluir</button>` : '<span style="font-size:11px;color:var(--ink-3)">Você</span>'}
            </td>
          </tr>`;
        }).join('');

      // Setor select no modal de usuário
      const setorSel = document.getElementById('user-setor');
      if (setorSel) {
        setorSel.innerHTML = '<option value="">Sem setor</option>' + State.setores.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
      }
    } catch (e) { toast('Erro ao carregar usuários', 'error'); }
  },

  async salvarUsuario() {
    const payload = {
      nome:         document.getElementById('user-nome').value.trim(),
      email:        document.getElementById('user-email').value.trim(),
      senha:        document.getElementById('user-senha').value,
      nivel_acesso: document.getElementById('user-nivel').value,
      setor_id:     document.getElementById('user-setor').value || null,
    };
    if (!payload.nome || !payload.email || !payload.senha) return toast('Preencha todos os campos obrigatórios', 'error');
    try {
      await api('POST', '/api/usuarios', payload);
      toast('Usuário criado com sucesso!');
      this.closeModal('modal-user');
      ['user-nome','user-email','user-senha'].forEach(id => document.getElementById(id).value = '');
      this.loadUsuarios();
    } catch (e) { toast(e.message, 'error'); }
  },

  async deletarUsuario(id, nome) {
    if (!confirm(`Excluir o usuário "${nome}"?`)) return;
    try {
      await api('DELETE', `/api/usuarios/${id}`);
      toast('Usuário excluído');
      this.loadUsuarios();
    } catch (e) { toast(e.message, 'error'); }
  },

  /* ─── SENHA ──────────────────────────────────────────── */
  openModalMudarSenha() {
    document.getElementById('senha-atual').value = '';
    document.getElementById('senha-nova').value = '';
    this.openModal('modal-mudar-senha');
  },

  async salvarNovaSenha() {
    const senha_atual = document.getElementById('senha-atual').value;
    const nova_senha  = document.getElementById('senha-nova').value;
    if (!senha_atual || !nova_senha) return toast('Preencha os dois campos', 'error');
    if (nova_senha.length < 6) return toast('A nova senha deve ter no mínimo 6 caracteres', 'error');
    try {
      // Endpoint correto: PUT /api/auth/senha  body: { senha_atual, nova_senha }
      await api('PUT', '/api/auth/senha', { senha_atual, nova_senha });
      toast('Senha alterada com sucesso!');
      this.closeModal('modal-mudar-senha');
    } catch (e) { toast(e.message, 'error'); }
  },
};

/* ─── BOOTSTRAP ──────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  App.checkSession();
});──── */
document.addEventListener('DOMContentLoaded', () => {
  App.checkSession();
});
