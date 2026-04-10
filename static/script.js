/* =========================================================
   CCIH — Sistema de Rastreio de Infecção Hospitalar
   script.js — SPA Controller (v4 — refatoração UX/UI/Performance)
   ========================================================= */

const PROCEDIMENTOS_LIST = [
  'cateter venoso central punção',
  'cateter venoso central dessecação',
  'cateter swan ganz',
  'cateter nutrição parental',
  'dissecação de veia periférica',
  'entubação',
  'respiração artificial',
  'traqueostomia',
  'sonda gástrica',
  'sonda vesical',
  'cateter arterial',
  'dreno cirurgia Neurológica',
  'dreno mediastino',
  'diálise peritoneal',
  'acesso venoso periférico (PVP)',
  'sonda nasoenteral (SNE)',
  'LPP',
  'Outros',
];

const LPP_GRAUS = ['Grau I', 'Grau II', 'Grau III', 'Grau IV', 'Grau não definido'];

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
  pacFilter: 'internado',
  pendingProcId: null,
  pendingAltaPacId: null,
  salvarPacienteLocked: false,
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
  if (dias === null) return '—';
  let cls = 'dias-ok';
  if (dias >= 7 && dias < 14) cls = 'dias-warn';
  if (dias >= 14) cls = 'dias-danger';
  return `<span class="dias-badge ${cls}">⏱ ${dias}d</span>`;
}

/* Ordenação natural de leitos: "1", "2", "10" em vez de "1", "10", "2" */
function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
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
    document.getElementById('nav-user-initial').textContent = u.nome.charAt(0).toUpperCase();

    if (u.nivel_acesso === 'admin') {
      document.getElementById('nav-admin-group').style.display = 'block';
      document.getElementById('btn-imprimir-relatorio').style.display = 'inline-flex';
    }

    if (u.nivel_acesso === 'espectador') {
      document.getElementById('readonly-badge').style.display = 'flex';
      document.querySelectorAll('.write-only').forEach(el => el.style.display = 'none');
      document.getElementById('nav-admin-group').style.display = 'none';
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

  openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('show');
  },
  closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('show');
  },

  /* ── Alterar Senha (acessível pelo sidebar em qualquer tela, inclusive mobile) ── */
  openModalSenha() {
    document.getElementById('senha-atual').value = '';
    document.getElementById('nova-senha').value = '';
    showModal('modal-senha');
  },

  async salvarSenha() {
    const atual = document.getElementById('senha-atual').value;
    const nova = document.getElementById('nova-senha').value;
    if (!atual || !nova) return toast('Preencha as senhas', 'error');
    if (nova.length < 6) return toast('A nova senha deve ter no mínimo 6 caracteres', 'error');
    try {
      await api('PUT', '/api/auth/senha', { senha_atual: atual, nova_senha: nova });
      toast('Senha atualizada com sucesso!');
      closeModal('modal-senha');
    } catch (e) {
      toast(e.message, 'error');
    }
  },

  navigate(view) {
    if ((view === 'setores' || view === 'usuarios') && State.user && State.user.nivel_acesso !== 'admin') {
      toast('Acesso restrito a administradores.', 'error');
      return;
    }
    this.closeSidebar();
    State.currentView = view;
    const titles = {
      dashboard: 'Dashboard Global',
      pacientes: 'Pacientes',
      'paciente-detail': 'Detalhes do Paciente',
      setores: 'Setores / Alas',
      usuarios: 'Usuários',
    };
    document.getElementById('topbar-title').textContent = titles[view] || view;
    document.querySelectorAll('[id^="view-"]').forEach(v => v.style.display = 'none');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    const el = document.getElementById(`view-${view}`);
    if (el) el.style.display = 'block';
    const navEl = document.querySelector(`[data-view="${view}"]`);
    if (navEl) navEl.classList.add('active');

    if (view === 'dashboard') this.loadDashboard();
    if (view === 'pacientes') this.loadPacientes();
    if (view === 'setores') this.loadSetoresView();
    if (view === 'usuarios') this.loadUsuarios();
  },

  closeModal,

  imprimirRelatorioGeral() {
    const mes = document.getElementById('filtro-mes').value || currentMonth();
    window.open(`/relatorio-impresso?mes=${mes}`, '_blank');
  },

  /* ── Dashboard ── */
  async loadDashboard() {
    const mes = document.getElementById('filtro-mes').value || currentMonth();
    try {
      const data = await api('GET', `/api/dashboard/relatorios?mes=${mes}`);
      this.renderDashboard(data);
    } catch (e) { toast('Erro ao carregar dashboard: ' + e.message, 'error'); }
  },

  renderDashboard(data) {
    const t = data.totais;
    document.getElementById('dash-internados').textContent = t.pacientes_internados;
    document.getElementById('dash-altas').textContent = t.pacientes_alta;
    document.getElementById('dash-infeccoes').textContent = t.infeccoes_mes;

    const taxas = [
      { label: 'IH Geral',        key: 'geral',      icon: '📊', desc: 'Taxa geral de infecções' },
      { label: 'IH Urinário',     key: 'urinario',   icon: '💧', desc: 'Proporção de ITU' },
      { label: 'IH Sangue/Sepse', key: 'sepse',      icon: '🩸', desc: 'Proporção de Sepse' },
      { label: 'IH Pneumonia',    key: 'pneumonia',  icon: '🫁', desc: 'Proporção de Pneumonia' },
      { label: 'IH Cirúrgica',    key: 'cirurgica',  icon: '🔪', desc: 'Proporção de Ferida Op.' },
    ];

    document.getElementById('taxas-grid').innerHTML = taxas.map(tx => {
      const val = data.taxas[tx.key] || 0;
      const color = val > 20 ? '#ef4444' : val > 10 ? '#f59e0b' : '#14b8a6';
      return `
        <div style="background:#f8fafc;border-radius:12px;padding:16px;border:1px solid #e2e8f0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <span style="font-size:20px">${tx.icon}</span>
            <div>
              <div style="font-size:13px;font-weight:700;color:#0f172a">${tx.label}</div>
              <div style="font-size:11px;color:#94a3b8">${tx.desc}</div>
            </div>
          </div>
          <div style="font-size:28px;font-weight:700;color:${color};margin-bottom:8px">${val.toFixed(1)}%</div>
          <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(val, 100).toFixed(0)}%;background:${color}"></div></div>
        </div>`;
    }).join('');

    const disp = [
      { label: 'Septicemia por Cateter', key: 'cateter',       icon: '🩹' },
      { label: 'PAV (Respiradores)',     key: 'respirador',    icon: '💨' },
      { label: 'ITU por Sonda',          key: 'sonda_vesical', icon: '🔵' },
    ];
    document.getElementById('dispositivos-grid').innerHTML = disp.map(d => {
      const val = data.taxas[d.key] || 0;
      const color = val > 20 ? '#ef4444' : val > 10 ? '#f59e0b' : '#14b8a6';
      return `
        <div style="background:#f8fafc;border-radius:12px;padding:16px;border:1px solid #e2e8f0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <span style="font-size:20px">${d.icon}</span>
            <div style="font-size:13px;font-weight:700;color:#0f172a">${d.label}</div>
          </div>
          <div style="font-size:28px;font-weight:700;color:${color}">${val.toFixed(1)}%</div>
          <div class="progress-bar" style="margin-top:8px"><div class="progress-fill" style="width:${Math.min(val, 100).toFixed(0)}%;background:${color}"></div></div>
        </div>`;
    }).join('');

    const maxSetor = Math.max(...(data.por_setor.map(s => s.total)), 1);
    document.getElementById('por-setor-list').innerHTML = data.por_setor.length
      ? data.por_setor.map(s => `
          <div style="margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
              <span style="font-weight:500">${s.setor}</span>
              <span class="badge badge-teal">${s.total}</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width:${(s.total / maxSetor * 100).toFixed(0)}%;background:#14b8a6"></div>
            </div>
          </div>`).join('')
      : '<p style="color:#94a3b8;font-size:13px">Nenhum internado</p>';

    document.getElementById('por-tipo-list').innerHTML = data.por_tipo.length
      ? data.por_tipo.map(t => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9">
            <span style="font-size:13px;font-weight:500">
              <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${INF_COLORS[t.tipo_infeccao] || '#64748b'};margin-right:6px"></span>
              ${t.tipo_infeccao}
            </span>
            <span style="font-weight:700;font-size:13px">${t.total}</span>
          </div>`).join('')
      : '<p style="color:#94a3b8;font-size:13px">Nenhuma infecção no mês</p>';

    document.getElementById('ultimas-inf-body').innerHTML = data.ultimas_infeccoes.length
      ? data.ultimas_infeccoes.map(i => `
          <tr>
            <td style="font-weight:600;color:var(--slate-800)">${i.paciente_nome}</td>
            <td>
              <span class="badge" style="background:${(INF_COLORS[i.tipo_infeccao] || '#000') + '20'};color:${INF_COLORS[i.tipo_infeccao] || '#000'}">
                ${i.tipo_infeccao}
              </span>
            </td>
            <td>${i.setor_nome || '—'}</td>
            <td style="font-size:12px">${formatDate(i.data_notificacao)}</td>
          </tr>`).join('')
      : '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:16px">Nenhum registro recente</td></tr>';
  },

  /* ── Pacientes ── */
  async loadPacientes() {
    try {
      State.pacientes = await api('GET', '/api/pacientes');
      State.pacientes.sort((a, b) => naturalSort(a.leito || '', b.leito || ''));
      this.renderPacientes();
      this.loadTransferenciasPendentes();
    } catch (e) { toast('Erro ao carregar pacientes', 'error'); }
  },

  async loadTransferenciasPendentes() {
    try {
      const pendentes = await api('GET', '/api/transferencias_pendentes');
      const container = document.getElementById('transferencias-pendentes-container');
      if (!pendentes || pendentes.length === 0) {
        container.style.display = 'none';
        return;
      }
      container.style.display = 'block';
      document.getElementById('transferencias-pendentes-list').innerHTML = pendentes.map(p => `
        <div style="display:flex;align-items:center;justify-content:space-between;background:#fffbeb;border:1px solid #fef08a;border-radius:10px;padding:12px 16px;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-weight:700;font-size:14px">${p.nome}</div>
            <div style="font-size:12px;color:#92400e;margin-top:2px">
              📤 <strong>${p.setor_nome || '—'}</strong> → 📥 <strong>${p.setor_destino_nome || '—'}</strong>
            </div>
          </div>
          <button class="btn btn-sm write-only" style="background:#0d9488;color:white" onclick="App.confirmarTransferencia(${p.id})">
            ✅ Confirmar Recebimento
          </button>
        </div>`).join('');
    } catch (e) {
      document.getElementById('transferencias-pendentes-container').style.display = 'none';
    }
  },

  renderPacientes() {
    const term = document.getElementById('pac-search').value.toLowerCase();
    const list = State.pacientes.filter(p => p.nome.toLowerCase().includes(term));
    const html = list.map(p => {
      const hasInf       = p.infeccoes && p.infeccoes.length > 0;
      const isTransito   = p.status === 'transito' || p.setor_destino_id != null;
      const corBorda     = isTransito ? '#f59e0b' : hasInf ? '#ef4444' : '#14b8a6';
      const corFundo     = isTransito ? '#fffbeb' : hasInf ? '#fef2f2' : '#fff';
      const diasInternacao = diffDias(p.data_internacao);

      return `
        <div class="card" style="padding:16px;border-left:4px solid ${corBorda};cursor:pointer;background:${corFundo}" onclick="App.verPaciente(${p.id})">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
            <div style="font-weight:700;font-size:15px;color:var(--slate-800)">${p.nome}</div>
            ${isTransito ? '<span class="badge badge-yellow">🚌 Em Trânsito</span>' : ''}
          </div>
          <div style="font-size:12px;color:var(--slate-500);margin-bottom:12px">
            Prontuário: ${p.prontuario || '—'} · Idade: ${p.idade || '—'}
            ${p.diagnostico ? `<br><span style="color:#64748b;font-style:italic">Dx: ${p.diagnostico}</span>` : ''}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px">
            <span class="badge badge-gray">${p.setor_nome || 'Sem Setor'}</span>
            <span class="badge badge-gray">Leito ${p.leito || '—'}</span>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            ${diasBadge(diasInternacao)}
            ${hasInf ? '<span class="badge badge-red">🦠 Infecção Ativa</span>' : ''}
            ${isTransito ? `<span style="font-size:11px;color:#92400e">→ ${p.setor_destino_nome || ''}</span>` : ''}
          </div>
          ${p.ultima_atualizacao
            ? `<div style="margin-top:10px;padding-top:8px;border-top:1px solid #f1f5f9;font-size:11px;color:#94a3b8;display:flex;align-items:center;gap:4px">🕒 ${p.ultima_atualizacao}</div>`
            : ''}
        </div>`;
    }).join('');
    document.getElementById('pacientes-grid').innerHTML = html
      || '<div style="color:var(--slate-500);text-align:center;padding:32px">Nenhum paciente encontrado.</div>';
  },

  filterPacientes() { this.renderPacientes(); },

  async openModalNovoPaciente() {
    await this.loadSetores();
    document.getElementById('np-nome').value          = '';
    document.getElementById('np-idade').value         = '';
    document.getElementById('np-prontuario').value    = '';
    document.getElementById('np-leito').value         = '';
    document.getElementById('np-diagnostico').value   = '';
    document.getElementById('np-data_internacao').value = today();

    const sel = document.getElementById('np-setor');
    sel.innerHTML = '<option value="">Selecione...</option>'
      + State.setores.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');

    document.getElementById('np-setor-wrap').style.display =
      State.user.nivel_acesso === 'estagiario' ? 'none' : 'block';

    State.salvarPacienteLocked = false;
    const btn = document.getElementById('btn-salvar-paciente');
    if (btn) { btn.disabled = false; btn.textContent = 'Internar'; }
    showModal('modal-paciente');
  },

  async salvarPaciente() {
    if (State.salvarPacienteLocked) return;
    const btn = document.getElementById('btn-salvar-paciente');
    State.salvarPacienteLocked = true;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando...'; }

    const dataInternacao = document.getElementById('np-data_internacao').value;
    if (!dataInternacao) {
      toast('Data de internação é obrigatória', 'error');
      State.salvarPacienteLocked = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Internar'; }
      return;
    }

    const body = {
      nome:            document.getElementById('np-nome').value,
      idade:           document.getElementById('np-idade').value,
      prontuario:      document.getElementById('np-prontuario').value,
      leito:           document.getElementById('np-leito').value,
      diagnostico:     document.getElementById('np-diagnostico').value,
      setor_id:        document.getElementById('np-setor').value,
      data_internacao: dataInternacao,
    };

    try {
      await api('POST', '/api/pacientes', body);
      toast('Paciente internado com sucesso!');
      closeModal('modal-paciente');
      this.loadPacientes();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setTimeout(() => {
        State.salvarPacienteLocked = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Internar'; }
      }, 3000);
    }
  },

  /* ── Editar Paciente ── */
  async openModalEditarPaciente() {
    const p = State.currentPacienteData;
    if (!p) return;
    await this.loadSetores();
    document.getElementById('ep-nome').value            = p.nome            || '';
    document.getElementById('ep-idade').value           = p.idade           || '';
    document.getElementById('ep-prontuario').value      = p.prontuario      || '';
    document.getElementById('ep-leito').value           = p.leito           || '';
    document.getElementById('ep-diagnostico').value     = p.diagnostico     || '';
    document.getElementById('ep-data_internacao').value = p.data_internacao || today();
    const sel = document.getElementById('ep-setor');
    sel.innerHTML = '<option value="">Sem Setor</option>'
      + State.setores.map(s => `<option value="${s.id}" ${s.id == p.setor_id_atual ? 'selected' : ''}>${s.nome}</option>`).join('');
    showModal('modal-editar-paciente');
  },

  async salvarEdicaoPaciente() {
    const pid = State.currentPacienteId;
    const dataInternacao = document.getElementById('ep-data_internacao').value;
    if (!dataInternacao) return toast('Data de internação é obrigatória', 'error');

    const body = {
      nome:            document.getElementById('ep-nome').value,
      idade:           document.getElementById('ep-idade').value,
      prontuario:      document.getElementById('ep-prontuario').value,
      leito:           document.getElementById('ep-leito').value,
      diagnostico:     document.getElementById('ep-diagnostico').value,
      setor_id:        document.getElementById('ep-setor').value,
      data_internacao: dataInternacao,
    };
    try {
      await api('PUT', `/api/pacientes/${pid}`, body);
      toast('Paciente atualizado!');
      closeModal('modal-editar-paciente');
      this.verPaciente(pid);
    } catch (e) {
      toast(e.message, 'error');
    }
  },

  /* ── Deletar Paciente ── */
  async deletarPaciente() {
    if (State.user.nivel_acesso !== 'admin') {
      return toast('Apenas administradores podem excluir pacientes.', 'error');
    }
    const p = State.currentPacienteData;
    if (!p) return;
    const confirma = confirm(
      `⚠️ ATENÇÃO: Isso irá excluir permanentemente o paciente "${p.nome}" e todos os seus registros, procedimentos e infecções.\n\nEsta ação NÃO pode ser desfeita. Confirmar?`
    );
    if (!confirma) return;
    try {
      await api('DELETE', `/api/pacientes/${State.currentPacienteId}`);
      toast('Paciente excluído com sucesso.');
      this.navigate('pacientes');
    } catch (e) {
      toast(e.message, 'error');
    }
  },

  /* ── Transferência ── */
  async openModalTransferencia() {
    const p = State.currentPacienteData;
    if (!p) return;
    await this.loadSetores();
    const sel = document.getElementById('transf-setor-destino');
    sel.innerHTML = '<option value="">Selecione...</option>'
      + State.setores
          .filter(s => s.id != p.setor_id_atual)
          .map(s => `<option value="${s.id}">${s.nome}</option>`)
          .join('');
    showModal('modal-transferencia');
  },

  async solicitarTransferencia() {
    const setor_destino_id = document.getElementById('transf-setor-destino').value;
    if (!setor_destino_id) return toast('Selecione o setor de destino', 'error');
    try {
      await api('POST', `/api/pacientes/${State.currentPacienteId}/solicitar_transferencia`, { setor_destino_id });
      toast('Transferência solicitada! Aguardando confirmação do setor de destino.');
      closeModal('modal-transferencia');
      this.verPaciente(State.currentPacienteId);
    } catch (e) {
      toast(e.message, 'error');
    }
  },

  async confirmarTransferencia(pid) {
    if (!confirm('Confirmar recebimento deste paciente no setor?')) return;
    try {
      await api('POST', `/api/pacientes/${pid}/confirmar_transferencia`);
      toast('Transferência confirmada! Paciente atribuído ao novo setor.');
      this.loadPacientes();
    } catch (e) {
      toast(e.message, 'error');
    }
  },

  /* ── Paciente Detail ── */
  async verPaciente(id) {
    try {
      const data = await api('GET', `/api/pacientes/${id}`);
      State.currentPacienteId   = id;
      State.currentPacienteData = data;
      this.navigate('paciente-detail');
      this.renderPacienteDetail();
    } catch (e) { toast('Erro ao carregar detalhes', 'error'); }
  },

  calcularDiasInternacao(dataInternacao) {
    return diffDias(dataInternacao);
  },

  /* ─────────────────────────────────────────────────────────
     renderPacienteDetail
     Preenche os <tbody> das tabelas de Procedimentos e
     Infecções. Infecções: Ativas primeiro, Curadas abaixo.
     ───────────────────────────────────────────────────────── */
  renderPacienteDetail() {
    const p        = State.currentPacienteData;
    const canWrite = State.user.nivel_acesso !== 'espectador';

    /* ── Card de Identificação (layout tabular) ── */
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '—'; };
    document.getElementById('det-nome').textContent = p.nome || '—';
    setEl('det-leito', p.leito);
    setEl('det-setor', p.setor_nome);
    setEl('det-idade', p.idade ? `${p.idade} anos` : null);
    setEl('det-prontuario', p.prontuario);

    // Diagnóstico com fundo teal-50
    const dxBox = document.getElementById('det-diagnostico-box');
    const dxEl  = document.getElementById('det-diagnostico');
    if (dxBox && dxEl) {
      if (p.diagnostico) {
        dxEl.textContent    = p.diagnostico;
        dxBox.style.display = 'block';
      } else {
        dxBox.style.display = 'none';
      }
    }

    // Badge de dias de internação
    const diasInternacao = this.calcularDiasInternacao(p.data_internacao);
    const diasEl = document.getElementById('det-dias-internacao');
    if (diasEl) {
      diasEl.innerHTML = diasInternacao !== null
        ? `<span class="dias-badge ${diasInternacao >= 14 ? 'dias-danger' : diasInternacao >= 7 ? 'dias-warn' : 'dias-ok'}">🏥 ${diasInternacao} dia(s)</span>`
        : '';
    }

    // Banner de trânsito
    const transfBanner = document.getElementById('transf-banner');
    if (transfBanner) {
      const emTransito = p.status === 'transito' || p.setor_destino_id != null;
      transfBanner.style.display = emTransito ? 'flex' : 'none';
      if (emTransito) {
        document.getElementById('transf-banner-destino').textContent = p.setor_destino_nome || '—';
      }
    }

    // Botão de transferência — oculto se já estiver em trânsito
    const btnTransf = document.getElementById('btn-solicitar-transferencia');
    if (btnTransf) {
      const emTransito = p.status === 'transito' || p.setor_destino_id != null;
      btnTransf.style.display = (!emTransito && canWrite) ? 'inline-flex' : 'none';
    }

    // Botão excluir — apenas admin
    const btnDel = document.getElementById('btn-deletar-paciente');
    if (btnDel) {
      btnDel.style.display = State.user.nivel_acesso === 'admin' ? 'inline-flex' : 'none';
    }

    /* ── Registros de temperatura ── */
    document.getElementById('regs-list').innerHTML = p.registros.length
      ? p.registros.slice(0, 5).map(r =>
          `<span class="badge ${r.temperatura >= 37.8 ? 'badge-red' : 'badge-green'}">${formatDate(r.data)}: ${r.temperatura}°C</span>`
        ).join('')
      : '<span style="font-size:12px;color:var(--slate-400)">Sem registros de temperatura</span>';

    /* ── Tabela de Procedimentos / Dispositivos ──────────────
       Colunas: Dispositivo | Inserção | Dias | Status | Ação
       ─────────────────────────────────────────────────────── */
    const procTbody = document.getElementById('procedimentos-tbody');
    if (p.procedimentos.length) {
      procTbody.innerHTML = p.procedimentos.map(pr => {
        const ativo        = pr.status === 'ativo';
        const dias         = ativo ? this.calcularDiasInternacao(pr.data_insercao) : null;
        const diasHtml     = ativo
          ? diasBadge(dias)
          : (pr.data_remocao
              ? `<span style="font-size:11px;color:var(--slate-400)">Rem: ${formatDate(pr.data_remocao)}</span>`
              : '—');
        const statusBadge  = ativo
          ? `<span class="badge badge-blue">🔵 Ativo</span>`
          : `<span class="badge badge-gray">⚪ Removido</span>`;
        const btnRemover   = (ativo && canWrite)
          ? `<button class="btn btn-ghost btn-sm write-only" style="padding:2px 8px" onclick="App.openModalRemProc(${pr.id})">Remover</button>`
          : '—';
        return `
          <tr>
            <td style="font-weight:600;color:var(--slate-800);font-size:12px">${pr.tipo_procedimento}</td>
            <td style="font-size:12px;color:var(--slate-500)">${formatDate(pr.data_insercao)}</td>
            <td>${diasHtml}</td>
            <td>${statusBadge}</td>
            <td class="write-only">${btnRemover}</td>
          </tr>`;
      }).join('');
    } else {
      procTbody.innerHTML =
        '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:16px;font-size:13px">Nenhum dispositivo registrado.</td></tr>';
    }

    /* ── Tabela de Infecções ─────────────────────────────────
       Ordem: Ativas no topo, Curadas abaixo (backend já ordena assim).
       Colunas: Tipo | Início | Duração (Dias) | Status | Ação
       ─────────────────────────────────────────────────────── */
    const infTbody = document.getElementById('infeccoes-tbody');
    if (p.infeccoes.length) {
      // Garantir: ativas primeiro, curadas depois (client-side fallback)
      const ordenadas = [...p.infeccoes].sort((a, b) => {
        const pa = (a.status === 'ativa' || !a.status) ? 0 : 1;
        const pb = (b.status === 'ativa' || !b.status) ? 0 : 1;
        return pa - pb;
      });

      infTbody.innerHTML = ordenadas.map(i => {
        const isAtiva     = i.status === 'ativa' || !i.status;
        const statusBadge = isAtiva
          ? '<span class="badge badge-red">🦠 Ativa</span>'
          : '<span class="badge badge-gray">✅ Curada</span>';

        // Duração: se ativa → dias desde notificação; se curada → dias notificação→cura
        const dataFim     = isAtiva ? today() : (i.data_cura || today());
        const duracaoDias = diffDias(i.data_notificacao);
        const duracaoHtml = isAtiva
          ? diasBadge(duracaoDias)
          : (i.data_cura
              ? `<span style="font-size:12px;color:var(--slate-500)">${diffDias(i.data_notificacao) - diffDias(i.data_cura)}d</span>`
              : '—');

        const btnCurar = (isAtiva && canWrite)
          ? `<button class="btn btn-ghost btn-sm write-only" style="padding:2px 8px;color:#16a34a;border-color:#16a34a" onclick="App.curarInfeccao(${i.id})">✔ Curar</button>`
          : (i.data_cura ? `<span style="font-size:11px;color:var(--slate-400)">Cura: ${formatDate(i.data_cura)}</span>` : '—');

        return `
          <tr${isAtiva ? '' : ' style="opacity:0.75"'}>
            <td style="font-weight:600;color:var(--slate-800);font-size:12px">${i.tipo_infeccao}</td>
            <td style="font-size:12px;color:var(--slate-500)">${formatDate(i.data_notificacao)}</td>
            <td>${duracaoHtml}</td>
            <td>${statusBadge}</td>
            <td class="write-only">${btnCurar}</td>
          </tr>`;
      }).join('');
    } else {
      infTbody.innerHTML =
        '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:16px;font-size:13px">Nenhuma infecção registrada.</td></tr>';
    }
  },

  /* ── Curar Infecção ── */
  async curarInfeccao(infId) {
    const data_cura = prompt('Data de cura (AAAA-MM-DD):', today());
    if (data_cura === null) return;
    const dataValida = /^\d{4}-\d{2}-\d{2}$/.test(data_cura.trim());
    if (!dataValida) return toast('Data inválida. Use o formato AAAA-MM-DD', 'error');
    try {
      await api('POST', `/api/infeccoes/${infId}/curar`, { data_cura: data_cura.trim() });
      toast('Infecção marcada como curada!');
      this.verPaciente(State.currentPacienteId);
    } catch (e) {
      toast(e.message, 'error');
    }
  },

  /* ── Temperatura ── */
  async addRegistro() {
    const data = document.getElementById('reg-data').value;
    const temp = parseFloat(document.getElementById('reg-temp').value);
    if (!data || !temp) return toast('Preencha os dados', 'error');
    try {
      await api('POST', `/api/pacientes/${State.currentPacienteId}/registros`, { data, temperatura: temp });
      toast('Temperatura registrada!');
      document.getElementById('reg-temp').value = '';
      this.verPaciente(State.currentPacienteId);
    } catch (e) { toast(e.message, 'error'); }
  },

  /* ── Procedimentos ── */
  openModalProc() {
    const sel = document.getElementById('proc-tipo');
    sel.innerHTML = '<option value="">Selecione...</option>'
      + PROCEDIMENTOS_LIST.map(p => `<option value="${p}">${p}</option>`).join('');
    document.getElementById('proc-data').value              = today();
    document.getElementById('proc-outros-wrap').style.display = 'none';
    document.getElementById('proc-outros-texto').value      = '';
    document.getElementById('proc-lpp-wrap').style.display   = 'none';
    document.getElementById('proc-lpp-grau').value          = '';
    showModal('modal-proc');
  },

  onProcTipoChange() {
    const sel      = document.getElementById('proc-tipo');
    const wrapOut  = document.getElementById('proc-outros-wrap');
    const wrapLpp  = document.getElementById('proc-lpp-wrap');
    wrapOut.style.display = sel.value === 'Outros' ? 'block' : 'none';
    wrapLpp.style.display = sel.value === 'LPP'    ? 'block' : 'none';
    if (sel.value !== 'Outros') document.getElementById('proc-outros-texto').value = '';
    if (sel.value !== 'LPP')    document.getElementById('proc-lpp-grau').value    = '';
  },

  async salvarProc() {
    let tipo = document.getElementById('proc-tipo').value;
    if (tipo === 'Outros') {
      const outros = document.getElementById('proc-outros-texto').value.trim();
      if (!outros) return toast('Descreva o dispositivo', 'error');
      tipo = outros;
    } else if (tipo === 'LPP') {
      const grau = document.getElementById('proc-lpp-grau').value;
      if (!grau) return toast('Selecione o grau da LPP', 'error');
      tipo = `LPP - ${grau}`;
    }
    if (!tipo) return toast('Selecione um dispositivo', 'error');
    const data_ins = document.getElementById('proc-data').value;
    try {
      await api('POST', `/api/pacientes/${State.currentPacienteId}/procedimentos`, {
        tipo_procedimento: tipo,
        data_insercao: data_ins,
      });
      toast('Dispositivo inserido!');
      closeModal('modal-proc');
      this.verPaciente(State.currentPacienteId);
    } catch (e) { toast(e.message, 'error'); }
  },

  openModalRemProc(id) {
    State.pendingProcId = id;
    document.getElementById('rem-proc-data').value = today();
    showModal('modal-rem-proc');
  },

  async confirmarRemoverProc() {
    try {
      await api('POST', `/api/procedimentos/${State.pendingProcId}/remover`, {
        data_remocao: document.getElementById('rem-proc-data').value,
      });
      toast('Dispositivo removido!');
      closeModal('modal-rem-proc');
      this.verPaciente(State.currentPacienteId);
    } catch (e) { toast(e.message, 'error'); }
  },

  /* ── Infecções ── */
  openModalInf() { showModal('modal-inf'); },

  async salvarInf() {
    const body = {
      tipo_infeccao:    document.getElementById('inf-tipo').value,
      data_notificacao: document.getElementById('inf-data').value,
    };
    try {
      await api('POST', `/api/pacientes/${State.currentPacienteId}/infeccoes`, body);
      toast('Infecção notificada com sucesso!');
      closeModal('modal-inf');
      this.verPaciente(State.currentPacienteId);
    } catch (e) { toast(e.message, 'error'); }
  },

  /* ── Alta ── */
  async openModalAlta() {
    await this.loadMotivos();
    const sel = document.getElementById('ma-motivo');
    sel.innerHTML = '<option value="">Selecione...</option>'
      + State.motivos.map(m => `<option value="${m.id}">${m.nome}</option>`).join('');
    showModal('modal-alta');
  },

  async confirmarAlta() {
    const motivo_id = document.getElementById('ma-motivo').value;
    if (!motivo_id) return toast('Selecione um motivo', 'error');
    try {
      await api('POST', `/api/pacientes/${State.currentPacienteId}/alta`, { motivo_saida_id: motivo_id });
      toast('Alta registrada!');
      closeModal('modal-alta');
      this.navigate('pacientes');
    } catch (e) { toast(e.message, 'error'); }
  },

  /* ── Setores ── */
  async loadMotivos() {
    State.motivos = await api('GET', '/api/motivos_saida').catch(() => []);
  },
  async loadSetores() {
    State.setores = await api('GET', '/api/setores').catch(() => []);
  },
  async loadSetoresView() {
    await this.loadSetores();
    document.getElementById('setores-tbody').innerHTML = State.setores.length
      ? State.setores.map(s => `
          <tr>
            <td>${s.id}</td>
            <td style="font-weight:600">${s.nome}</td>
            <td class="write-only">
              <button class="btn btn-ghost btn-sm" onclick="App.deleteSetor(${s.id})">Excluir</button>
            </td>
          </tr>`).join('')
      : '<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:16px">Nenhum setor cadastrado.</td></tr>';
  },
  openModalNovoSetor() {
    document.getElementById('ns-nome').value = '';
    showModal('modal-setor');
  },
  async salvarSetor() {
    try {
      await api('POST', '/api/setores', { nome: document.getElementById('ns-nome').value });
      toast('Setor adicionado');
      closeModal('modal-setor');
      this.loadSetoresView();
    } catch (e) { toast(e.message, 'error'); }
  },
  async deleteSetor(id) {
    if (!confirm('Certeza que deseja excluir este setor?')) return;
    try {
      await api('DELETE', `/api/setores/${id}`);
      toast('Setor excluído');
      this.loadSetoresView();
    } catch (e) { toast(e.message, 'error'); }
  },

  /* ── Usuários ── */
  async loadUsuarios() {
    try {
      const users = await api('GET', '/api/usuarios');
      document.getElementById('usuarios-tbody').innerHTML = users.map(u => `
        <tr>
          <td style="font-weight:600">${u.nome}</td>
          <td>${u.email}</td>
          <td><span class="badge badge-gray">${u.nivel_acesso}</span></td>
          <td>${u.setor_nome || '—'}</td>
          <td class="write-only">
            <button class="btn btn-danger btn-sm" onclick="App.deleteUsuario(${u.id})">Excluir</button>
          </td>
        </tr>`).join('');
    } catch (e) { toast('Erro ao carregar usuários', 'error'); }
  },

  async openModalNovoUser() {
    await this.loadSetores();
    document.getElementById('nu-nome').value  = '';
    document.getElementById('nu-email').value = '';
    document.getElementById('nu-senha').value = '';
    document.getElementById('nu-nivel').value = '';
    const sel = document.getElementById('nu-setor');
    sel.innerHTML = '<option value="">Sem restrição</option>'
      + State.setores.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
    this.onNivelChange();
    showModal('modal-user');
  },

  onNivelChange() {
    document.getElementById('nu-setor-wrap').style.display =
      document.getElementById('nu-nivel').value === 'estagiario' ? 'block' : 'none';
  },

  async salvarUsuario() {
    const body = {
      nome:         document.getElementById('nu-nome').value,
      email:        document.getElementById('nu-email').value,
      senha:        document.getElementById('nu-senha').value,
      nivel_acesso: document.getElementById('nu-nivel').value,
      setor_id:     document.getElementById('nu-setor').value,
    };
    try {
      await api('POST', '/api/usuarios', body);
      toast('Usuário cadastrado!');
      closeModal('modal-user');
      this.loadUsuarios();
    } catch (e) { toast(e.message, 'error'); }
  },

  async deleteUsuario(id) {
    if (!confirm('Excluir usuário permanentemente?')) return;
    try {
      await api('DELETE', `/api/usuarios/${id}`);
      toast('Usuário excluído');
      this.loadUsuarios();
    } catch (e) { toast(e.message, 'error'); }
  },
};

document.addEventListener('DOMContentLoaded', () => App.checkSession());