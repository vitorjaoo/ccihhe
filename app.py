import os
import json
import hashlib
from datetime import datetime, date
from functools import wraps
from flask import Flask, request, jsonify, render_template, session
import libsql_client

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'ccih_secret_2024_xK9mP')

# ---------------------------------------------------------------------------
# DATABASE SETUP (Turso Cloud Database Adapter)
# ---------------------------------------------------------------------------
# As chaves foram colocadas como fallback para garantir que funciona imediatamente.
TURSO_URL = os.environ.get('TURSO_DATABASE_URL', 'libsql://cchi-vitorrastrep.aws-us-east-2.turso.io')
TURSO_TOKEN = os.environ.get('TURSO_AUTH_TOKEN', 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzU1Njk0NTksImlkIjoiMDE5ZDY4MmYtMDAwMS03N2IxLThhYjQtZmEyMGZlOTg4NTg5IiwicmlkIjoiOWNmYzg2YmEtMGRmOC00YzVhLWI3MTQtYzVmYmMzNGYxYWE1In0.C8J9OK0Q3hcWTDdmQIs1EDFnnjVoYlA5rM7npQ7B-coRuOTOI7HWCOnKhQkzd1cNCcrE0uzmjidIfuXbhL84DA')

class TursoCursor:
    def __init__(self, rs=None):
        if rs:
            self.rows = [dict(zip(rs.columns, row)) for row in rs.rows]
            self.tuples = [tuple(row) for row in rs.rows]
            self.lastrowid = rs.last_insert_rowid
        else:
            self.rows = []
            self.tuples = []
            self.lastrowid = None

    def fetchone(self):
        if not self.rows:
            return None
        # Esta classe permite que o código antigo use row['nome'] ou row[0] sem dar erro
        class RowDict(dict):
            def __init__(self, d, t):
                super().__init__(d)
                self.t = t
            def __getitem__(self, key):
                if isinstance(key, int):
                    return self.t[key]
                return super().__getitem__(key)
        return RowDict(self.rows[0], self.tuples[0])

    def fetchall(self):
        return self.rows

class TursoAdapter:
    def __init__(self):
        self.client = libsql_client.create_client_sync(url=TURSO_URL, auth_token=TURSO_TOKEN)

    def cursor(self):
        return self

    def execute(self, sql, params=()):
        if not isinstance(params, (tuple, list)):
            params = (params,)
        rs = self.client.execute(sql, params)
        return TursoCursor(rs)

    def executescript(self, sql_script):
        statements = [s.strip() for s in sql_script.split(';') if s.strip()]
        if statements:
            self.client.batch(statements)

    def commit(self):
        pass # O Turso faz auto-commit na API

    def close(self):
        self.client.close()

def get_db():
    return TursoAdapter()


def hash_password(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()


def init_db():
    try:
        conn = get_db()
        c = conn.cursor()

        c.executescript("""
        CREATE TABLE IF NOT EXISTS setores (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS usuarios (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            nome          TEXT NOT NULL,
            email         TEXT NOT NULL UNIQUE,
            senha         TEXT NOT NULL,
            nivel_acesso  TEXT NOT NULL CHECK(nivel_acesso IN ('admin','estagiario','espectador')),
            setor_id      INTEGER REFERENCES setores(id)
        );

        CREATE TABLE IF NOT EXISTS motivos_saida (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS pacientes (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            nome            TEXT NOT NULL,
            idade           INTEGER,
            leito           TEXT,
            prontuario      TEXT,
            fone            TEXT,
            setor_id_atual  INTEGER REFERENCES setores(id),
            status          TEXT NOT NULL DEFAULT 'internado' CHECK(status IN ('internado','alta')),
            motivo_saida_id INTEGER REFERENCES motivos_saida(id),
            data_internacao TEXT DEFAULT (date('now'))
        );

        CREATE TABLE IF NOT EXISTS registros_diarios (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
            data        TEXT NOT NULL DEFAULT (date('now')),
            temperatura REAL
        );

        CREATE TABLE IF NOT EXISTS procedimentos (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            paciente_id    INTEGER NOT NULL REFERENCES pacientes(id),
            tipo_procedimento TEXT NOT NULL,
            data_insercao  TEXT NOT NULL,
            data_remocao   TEXT,
            status         TEXT NOT NULL DEFAULT 'ativo' CHECK(status IN ('ativo','removido'))
        );

        CREATE TABLE IF NOT EXISTS infeccoes_notificadas (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            paciente_id      INTEGER NOT NULL REFERENCES pacientes(id),
            tipo_infeccao    TEXT NOT NULL,
            data_notificacao TEXT NOT NULL DEFAULT (date('now'))
        );
        """)

        # Seed motivos de saída
        motivos = ['Alta Médica', 'Óbito', 'Transferência para outro hospital']
        for m in motivos:
            c.execute("INSERT OR IGNORE INTO motivos_saida(nome) VALUES(?)", (m,))

        # Seed setor padrão
        c.execute("INSERT OR IGNORE INTO setores(nome) VALUES('UTI Geral')")
        c.execute("INSERT OR IGNORE INTO setores(nome) VALUES('Clínica Cirúrgica')")
        c.execute("INSERT OR IGNORE INTO setores(nome) VALUES('Clínica Médica')")

        # Seed admin padrão
        admin_hash = hash_password('admin123')
        # Verifica se o admin já existe
        admin_check = c.execute("SELECT * FROM usuarios WHERE email='admin@ccih.com'").fetchone()
        if not admin_check:
            c.execute("""
                INSERT INTO usuarios(nome, email, senha, nivel_acesso, setor_id)
                VALUES('Administrador', 'admin@ccih.com', ?, 'admin', NULL)
            """, (admin_hash,))

        conn.commit()
        conn.close()
        print("[CCIH] Banco Turso (Nuvem) inicializado com sucesso.")
    except Exception as e:
        print(f"[CCIH] Erro ao inicializar banco Turso: {e}")


# ---------------------------------------------------------------------------
# AUTH HELPERS
# ---------------------------------------------------------------------------
def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Não autenticado'}), 401
        return f(*args, **kwargs)
    return decorated


def not_readonly(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if session.get('nivel_acesso') == 'espectador':
            return jsonify({'error': 'Acesso somente leitura'}), 403
        return f(*args, **kwargs)
    return decorated


def row_to_dict(row):
    if row is None:
        return None
    return dict(row)


def rows_to_list(rows):
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# ROUTES — AUTH
# ---------------------------------------------------------------------------
@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.json or {}
    email = data.get('email', '').strip().lower()
    senha = data.get('senha', '')
    if not email or not senha:
        return jsonify({'error': 'Campos obrigatórios'}), 400

    conn = get_db()
    user = row_to_dict(conn.execute(
        "SELECT * FROM usuarios WHERE email=?", (email,)
    ).fetchone())
    conn.close()

    if not user or user['senha'] != hash_password(senha):
        return jsonify({'error': 'Credenciais inválidas'}), 401

    session['user_id'] = user['id']
    session['nivel_acesso'] = user['nivel_acesso']
    session['setor_id'] = user['setor_id']
    session['nome'] = user['nome']

    return jsonify({
        'id': user['id'],
        'nome': user['nome'],
        'email': user['email'],
        'nivel_acesso': user['nivel_acesso'],
        'setor_id': user['setor_id']
    })


@app.route('/api/auth/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'ok': True})


@app.route('/api/auth/me', methods=['GET'])
@login_required
def me():
    return jsonify({
        'id': session['user_id'],
        'nome': session['nome'],
        'nivel_acesso': session['nivel_acesso'],
        'setor_id': session['setor_id']
    })


# ---------------------------------------------------------------------------
# ROUTES — SETORES
# ---------------------------------------------------------------------------
@app.route('/api/setores', methods=['GET'])
@login_required
def get_setores():
    conn = get_db()
    rows = rows_to_list(conn.execute("SELECT * FROM setores ORDER BY nome").fetchall())
    conn.close()
    return jsonify(rows)


@app.route('/api/setores', methods=['POST'])
@login_required
@not_readonly
def create_setor():
    if session['nivel_acesso'] != 'admin':
        return jsonify({'error': 'Apenas admin'}), 403
    data = request.json or {}
    nome = data.get('nome', '').strip()
    if not nome:
        return jsonify({'error': 'Nome obrigatório'}), 400
    conn = get_db()
    try:
        conn.execute("INSERT INTO setores(nome) VALUES(?)", (nome,))
        conn.commit()
        setor = row_to_dict(conn.execute("SELECT * FROM setores WHERE nome=?", (nome,)).fetchone())
    except Exception:
        conn.close()
        return jsonify({'error': 'Setor já existe'}), 409
    conn.close()
    return jsonify(setor), 201


@app.route('/api/setores/<int:sid>', methods=['DELETE'])
@login_required
@not_readonly
def delete_setor(sid):
    if session['nivel_acesso'] != 'admin':
        return jsonify({'error': 'Apenas admin'}), 403
    conn = get_db()
    conn.execute("DELETE FROM setores WHERE id=?", (sid,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# ROUTES — USUÁRIOS
# ---------------------------------------------------------------------------
@app.route('/api/usuarios', methods=['GET'])
@login_required
def get_usuarios():
    if session['nivel_acesso'] not in ('admin', 'espectador'):
        return jsonify({'error': 'Sem permissão'}), 403
    conn = get_db()
    rows = rows_to_list(conn.execute("""
        SELECT u.id, u.nome, u.email, u.nivel_acesso, u.setor_id, s.nome as setor_nome
        FROM usuarios u LEFT JOIN setores s ON s.id=u.setor_id
        ORDER BY u.nome
    """).fetchall())
    conn.close()
    return jsonify(rows)


@app.route('/api/usuarios', methods=['POST'])
@login_required
@not_readonly
def create_usuario():
    if session['nivel_acesso'] != 'admin':
        return jsonify({'error': 'Apenas admin'}), 403
    data = request.json or {}
    nome = data.get('nome', '').strip()
    email = data.get('email', '').strip().lower()
    senha = data.get('senha', '').strip()
    nivel = data.get('nivel_acesso', '')
    setor_id = data.get('setor_id') or None

    if not all([nome, email, senha, nivel]):
        return jsonify({'error': 'Campos obrigatórios'}), 400
    if nivel not in ('admin', 'estagiario', 'espectador'):
        return jsonify({'error': 'Nível inválido'}), 400

    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO usuarios(nome,email,senha,nivel_acesso,setor_id) VALUES(?,?,?,?,?)",
            (nome, email, hash_password(senha), nivel, setor_id)
        )
        conn.commit()
        u = row_to_dict(conn.execute("SELECT id,nome,email,nivel_acesso,setor_id FROM usuarios WHERE email=?", (email,)).fetchone())
    except Exception:
        conn.close()
        return jsonify({'error': 'Email já cadastrado'}), 409
    conn.close()
    return jsonify(u), 201


@app.route('/api/usuarios/<int:uid>', methods=['DELETE'])
@login_required
@not_readonly
def delete_usuario(uid):
    if session['nivel_acesso'] != 'admin':
        return jsonify({'error': 'Apenas admin'}), 403
    if uid == session['user_id']:
        return jsonify({'error': 'Não pode excluir a si mesmo'}), 400
    conn = get_db()
    conn.execute("DELETE FROM usuarios WHERE id=?", (uid,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# ROUTES — PACIENTES
# ---------------------------------------------------------------------------
@app.route('/api/pacientes', methods=['GET'])
@login_required
def get_pacientes():
    nivel = session['nivel_acesso']
    setor_id = session['setor_id']
    conn = get_db()

    base_query = """
        SELECT p.*, s.nome as setor_nome
        FROM pacientes p
        LEFT JOIN setores s ON s.id = p.setor_id_atual
    """
    if nivel == 'estagiario' and setor_id:
        rows = rows_to_list(conn.execute(
            base_query + " WHERE p.setor_id_atual=? AND p.status='internado' ORDER BY p.nome",
            (setor_id,)
        ).fetchall())
    else:
        rows = rows_to_list(conn.execute(
            base_query + " WHERE p.status='internado' ORDER BY p.setor_nome, p.nome"
        ).fetchall())

    # CORREÇÃO: Anexar os procedimentos e infeções para o JavaScript não falhar
    for p in rows:
        p['procedimentos'] = rows_to_list(conn.execute(
            "SELECT * FROM procedimentos WHERE paciente_id=? AND status='ativo'", (p['id'],)
        ).fetchall())
        p['infeccoes'] = rows_to_list(conn.execute(
            "SELECT * FROM infeccoes_notificadas WHERE paciente_id=?", (p['id'],)
        ).fetchall())

    conn.close()
    return jsonify(rows)


@app.route('/api/pacientes', methods=['POST'])
@login_required
@not_readonly
def create_paciente():
    nivel = session['nivel_acesso']
    if nivel == 'espectador':
        return jsonify({'error': 'Sem permissão'}), 403

    data = request.json or {}
    nome = data.get('nome', '').strip()
    if not nome:
        return jsonify({'error': 'Nome obrigatório'}), 400

    # CORREÇÃO: Converter campos em branco para NULL para não gerar Erro 500
    setor_id = data.get('setor_id')
    if not setor_id or str(setor_id).strip() == '':
        setor_id = None
        
    idade = data.get('idade')
    if not idade or str(idade).strip() == '':
        idade = None

    if nivel == 'estagiario':
        setor_id = session['setor_id']

    conn = get_db()
    try:
        cursor = conn.execute("""
            INSERT INTO pacientes(nome, idade, leito, prontuario, fone, setor_id_atual, status)
            VALUES(?,?,?,?,?,?,'internado')
        """, (
            nome,
            idade,
            data.get('leito', '').strip(),
            data.get('prontuario', '').strip(),
            data.get('fone', '').strip(),
            setor_id
        ))
        conn.commit()
        pid = cursor.lastrowid
        pac = row_to_dict(conn.execute(
            "SELECT p.*, s.nome as setor_nome FROM pacientes p LEFT JOIN setores s ON s.id=p.setor_id_atual WHERE p.id=?",
            (pid,)
        ).fetchone())
    except Exception as e:
        conn.close()
        return jsonify({'error': f'Falha no banco de dados: {str(e)}'}), 500

    conn.close()
    return jsonify(pac), 201


@app.route('/api/pacientes/<int:pid>', methods=['GET'])
@login_required
def get_paciente(pid):
    conn = get_db()
    pac = row_to_dict(conn.execute(
        "SELECT p.*, s.nome as setor_nome FROM pacientes p LEFT JOIN setores s ON s.id=p.setor_id_atual WHERE p.id=?",
        (pid,)
    ).fetchone())
    if not pac:
        conn.close()
        return jsonify({'error': 'Não encontrado'}), 404

    nivel = session['nivel_acesso']
    if nivel == 'estagiario' and pac['setor_id_atual'] != session['setor_id']:
        conn.close()
        return jsonify({'error': 'Sem permissão'}), 403

    pac['registros'] = rows_to_list(conn.execute(
        "SELECT * FROM registros_diarios WHERE paciente_id=? ORDER BY data DESC",
        (pid,)
    ).fetchall())
    pac['procedimentos'] = rows_to_list(conn.execute(
        "SELECT * FROM procedimentos WHERE paciente_id=? ORDER BY data_insercao DESC",
        (pid,)
    ).fetchall())
    pac['infeccoes'] = rows_to_list(conn.execute(
        "SELECT * FROM infeccoes_notificadas WHERE paciente_id=? ORDER BY data_notificacao DESC",
        (pid,)
    ).fetchall())
    conn.close()
    return jsonify(pac)


@app.route('/api/pacientes/<int:pid>/alta', methods=['POST'])
@login_required
@not_readonly
def dar_alta(pid):
    data = request.json or {}
    motivo_id = data.get('motivo_saida_id')
    if not motivo_id:
        return jsonify({'error': 'Motivo obrigatório'}), 400

    conn = get_db()
    nivel = session['nivel_acesso']
    pac = row_to_dict(conn.execute("SELECT * FROM pacientes WHERE id=?", (pid,)).fetchone())
    if not pac:
        conn.close()
        return jsonify({'error': 'Não encontrado'}), 404
    if nivel == 'estagiario' and pac['setor_id_atual'] != session['setor_id']:
        conn.close()
        return jsonify({'error': 'Sem permissão'}), 403

    conn.execute(
        "UPDATE pacientes SET status='alta', motivo_saida_id=? WHERE id=?",
        (motivo_id, pid)
    )
    # Remover procedimentos ativos
    conn.execute(
        "UPDATE procedimentos SET status='removido', data_remocao=date('now') WHERE paciente_id=? AND status='ativo'",
        (pid,)
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# ROUTES — REGISTROS DIÁRIOS
# ---------------------------------------------------------------------------
@app.route('/api/pacientes/<int:pid>/registros', methods=['POST'])
@login_required
@not_readonly
def add_registro(pid):
    data = request.json or {}
    temperatura = data.get('temperatura')
    data_reg = data.get('data') or date.today().isoformat()

    conn = get_db()
    conn.execute(
        "INSERT INTO registros_diarios(paciente_id, data, temperatura) VALUES(?,?,?)",
        (pid, data_reg, temperatura)
    )
    conn.commit()
    reg = row_to_dict(conn.execute(
        "SELECT * FROM registros_diarios WHERE paciente_id=? ORDER BY id DESC LIMIT 1",
        (pid,)
    ).fetchone())
    conn.close()
    return jsonify(reg), 201


# ---------------------------------------------------------------------------
# ROUTES — PROCEDIMENTOS
# ---------------------------------------------------------------------------
@app.route('/api/pacientes/<int:pid>/procedimentos', methods=['POST'])
@login_required
@not_readonly
def add_procedimento(pid):
    data = request.json or {}
    tipo = data.get('tipo_procedimento', '').strip()
    data_ins = data.get('data_insercao', '').strip()
    if not tipo or not data_ins:
        return jsonify({'error': 'Tipo e data de inserção obrigatórios'}), 400

    conn = get_db()
    conn.execute("""
        INSERT INTO procedimentos(paciente_id, tipo_procedimento, data_insercao, status)
        VALUES(?,?,?,'ativo')
    """, (pid, tipo, data_ins))
    conn.commit()
    proc = row_to_dict(conn.execute(
        "SELECT * FROM procedimentos WHERE paciente_id=? ORDER BY id DESC LIMIT 1",
        (pid,)
    ).fetchone())
    conn.close()
    return jsonify(proc), 201


@app.route('/api/procedimentos/<int:proc_id>/remover', methods=['POST'])
@login_required
@not_readonly
def remover_procedimento(proc_id):
    data = request.json or {}
    data_rem = data.get('data_remocao') or date.today().isoformat()
    conn = get_db()
    conn.execute(
        "UPDATE procedimentos SET status='removido', data_remocao=? WHERE id=?",
        (data_rem, proc_id)
    )
    conn.commit()
    proc = row_to_dict(conn.execute("SELECT * FROM procedimentos WHERE id=?", (proc_id,)).fetchone())
    conn.close()
    return jsonify(proc)


# ---------------------------------------------------------------------------
# ROUTES — INFECÇÕES
# ---------------------------------------------------------------------------
TIPOS_INFECCAO = ['Trato Urinário', 'Sepse', 'Pneumonia', 'Ferida Operatória', 'Outra']


@app.route('/api/pacientes/<int:pid>/infeccoes', methods=['POST'])
@login_required
@not_readonly
def add_infeccao(pid):
    data = request.json or {}
    tipo = data.get('tipo_infeccao', '').strip()
    data_not = data.get('data_notificacao') or date.today().isoformat()

    if tipo not in TIPOS_INFECCAO:
        return jsonify({'error': 'Tipo inválido'}), 400

    conn = get_db()
    conn.execute(
        "INSERT INTO infeccoes_notificadas(paciente_id, tipo_infeccao, data_notificacao) VALUES(?,?,?)",
        (pid, tipo, data_not)
    )
    conn.commit()
    inf = row_to_dict(conn.execute(
        "SELECT * FROM infeccoes_notificadas WHERE paciente_id=? ORDER BY id DESC LIMIT 1",
        (pid,)
    ).fetchone())
    conn.close()
    return jsonify(inf), 201


# ---------------------------------------------------------------------------
# ROUTES — MOTIVOS DE SAÍDA
# ---------------------------------------------------------------------------
@app.route('/api/motivos_saida', methods=['GET'])
@login_required
def get_motivos():
    conn = get_db()
    rows = rows_to_list(conn.execute("SELECT * FROM motivos_saida ORDER BY nome").fetchall())
    conn.close()
    return jsonify(rows)


# ---------------------------------------------------------------------------
# ROUTES — DASHBOARD / RELATÓRIOS
# ---------------------------------------------------------------------------
@app.route('/api/dashboard/relatorios', methods=['GET'])
@login_required
def relatorios():
    nivel = session['nivel_acesso']
    if nivel == 'estagiario':
        return jsonify({'error': 'Sem permissão'}), 403

    mes = request.args.get('mes') or date.today().strftime('%Y-%m')
    ano_mes = mes[:7]

    conn = get_db()

    pac_alta_row = conn.execute("SELECT COUNT(DISTINCT p.id) as total FROM pacientes p WHERE p.status='alta'").fetchone()
    pacientes_alta = pac_alta_row[0] if pac_alta_row else 0

    infeccoes_mes = rows_to_list(conn.execute("SELECT * FROM infeccoes_notificadas WHERE strftime('%Y-%m', data_notificacao)=?", (ano_mes,)).fetchall())
    total_inf = len(infeccoes_mes)

    def count_tipo(tipo):
        return sum(1 for i in infeccoes_mes if i['tipo_infeccao'] == tipo)

    inf_urinario = count_tipo('Trato Urinário')
    inf_sepse = count_tipo('Sepse')
    inf_pneumonia = count_tipo('Pneumonia')
    inf_cirurgica = count_tipo('Ferida Operatória')

    taxa_geral = round((total_inf / pacientes_alta * 100) if pacientes_alta > 0 else 0, 2)
    def taxa_prop(n): return round((n / total_inf * 100) if total_inf > 0 else 0, 2)

    cateteres = ['cateter venoso central punção', 'cateter venoso central dessecação', 'cateter swan ganz']
    pac_cateter_ids = set(row_to_dict(r)['paciente_id'] for r in conn.execute("SELECT DISTINCT paciente_id FROM procedimentos WHERE lower(tipo_procedimento) IN ({})".format(','.join('?' * len(cateteres))), cateteres).fetchall())

    if pac_cateter_ids:
        pac_sepse_cateter_row = conn.execute("SELECT COUNT(DISTINCT i.paciente_id) FROM infeccoes_notificadas i WHERE i.tipo_infeccao='Sepse' AND i.paciente_id IN ({}) AND strftime('%Y-%m', i.data_notificacao)=?".format(','.join('?' * len(pac_cateter_ids))), list(pac_cateter_ids) + [ano_mes]).fetchone()
        pac_sepse_cateter = pac_sepse_cateter_row[0] if pac_sepse_cateter_row else 0
    else:
        pac_sepse_cateter = 0

    taxa_cateter = round((pac_sepse_cateter / len(pac_cateter_ids) * 100) if pac_cateter_ids else 0, 2)

    respiradores = ['respiração artificial', 'entubação']
    pac_resp_ids = set(row_to_dict(r)['paciente_id'] for r in conn.execute("SELECT DISTINCT paciente_id FROM procedimentos WHERE lower(tipo_procedimento) IN (?,?)", respiradores).fetchall())

    if pac_resp_ids:
        pac_pneumonia_resp_row = conn.execute("SELECT COUNT(DISTINCT i.paciente_id) FROM infeccoes_notificadas i WHERE i.tipo_infeccao='Pneumonia' AND i.paciente_id IN ({}) AND strftime('%Y-%m', i.data_notificacao)=?".format(','.join('?' * len(pac_resp_ids))), list(pac_resp_ids) + [ano_mes]).fetchone()
        pac_pneumonia_resp = pac_pneumonia_resp_row[0] if pac_pneumonia_resp_row else 0
    else:
        pac_pneumonia_resp = 0

    taxa_respirador = round((pac_pneumonia_resp / len(pac_resp_ids) * 100) if pac_resp_ids else 0, 2)

    pac_sonda_ids = set(row_to_dict(r)['paciente_id'] for r in conn.execute("SELECT DISTINCT paciente_id FROM procedimentos WHERE lower(tipo_procedimento)='sonda vesical'").fetchall())

    if pac_sonda_ids:
        pac_urinario_sonda_row = conn.execute("SELECT COUNT(DISTINCT i.paciente_id) FROM infeccoes_notificadas i WHERE i.tipo_infeccao='Trato Urinário' AND i.paciente_id IN ({}) AND strftime('%Y-%m', i.data_notificacao)=?".format(','.join('?' * len(pac_sonda_ids))), list(pac_sonda_ids) + [ano_mes]).fetchone()
        pac_urinario_sonda = pac_urinario_sonda_row[0] if pac_urinario_sonda_row else 0
    else:
        pac_urinario_sonda = 0

    taxa_sonda = round((pac_urinario_sonda / len(pac_sonda_ids) * 100) if pac_sonda_ids else 0, 2)

    por_setor = rows_to_list(conn.execute("SELECT s.nome as setor, COUNT(p.id) as total FROM pacientes p JOIN setores s ON s.id=p.setor_id_atual WHERE p.status='internado' GROUP BY s.id ORDER BY s.nome").fetchall())
    por_tipo = rows_to_list(conn.execute("SELECT tipo_infeccao, COUNT(*) as total FROM infeccoes_notificadas WHERE strftime('%Y-%m', data_notificacao)=? GROUP BY tipo_infeccao", (ano_mes,)).fetchall())

    ultimas_inf = rows_to_list(conn.execute("SELECT i.*, p.nome as paciente_nome, s.nome as setor_nome FROM infeccoes_notificadas i JOIN pacientes p ON p.id=i.paciente_id LEFT JOIN setores s ON s.id=p.setor_id_atual ORDER BY i.id DESC LIMIT 10").fetchall())

    conn.close()

    return jsonify({
        'mes': ano_mes,
        'taxas': {
            'geral': taxa_geral,
            'urinario': taxa_prop(inf_urinario),
            'sepse': taxa_prop(inf_sepse),
            'pneumonia': taxa_prop(inf_pneumonia),
            'cirurgica': taxa_prop(inf_cirurgica),
            'cateter': taxa_cateter,
            'respirador': taxa_respirador,
            'sonda_vesical': taxa_sonda,
        },
        'totais': {
            'pacientes_alta': pacientes_alta,
            'infeccoes_mes': total_inf,
            'pacientes_internados': sum(s['total'] for s in por_setor),
        },
        'por_setor': por_setor,
        'por_tipo': por_tipo,
        'ultimas_infeccoes': ultimas_inf,
    })


# ---------------------------------------------------------------------------
# START
# ---------------------------------------------------------------------------
init_db()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_ENV', 'production') == 'development'
    app.run(host='0.0.0.0', port=port, debug=debug)
