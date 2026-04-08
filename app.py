import os
import json
import hashlib
from datetime import datetime, date
from functools import wraps
from flask import Flask, request, jsonify, render_template, session
import libsql_client
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'ccih_secret_2024_xK9mP')

# ---------------------------------------------------------------------------
# DATABASE SETUP (Turso Cloud Database Adapter)
# ---------------------------------------------------------------------------
TURSO_URL = os.environ.get('TURSO_URL', 'libsql://ccih-vitorrastrep.aws-us-east-2.turso.io')
TURSO_TOKEN = os.environ.get('TURSO_TOKEN', 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzU2ODUwNTYsImlkIjoiMDE5ZDZhNmUtZTkwMS03YWQ5LTg2YjAtMWJhZWVmYjI1YWFkIiwicmlkIjoiYTlmZTQwZWItYzg1NS00NDRkLWFlMjktZGQzNjkwNzI0ODc0In0.FwEon_QmTAxqSL0RrIUnt6dD4NaT4MONuA4ezgf2i0UcN4s1PJchDobiUyinb_GzFD1-9rQGmRl6B0QMMeRxDQ')
print(f"[CCIH] Conectando ao banco: {TURSO_URL}")


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
    def __init__(self, client):
        self.client = client

    def cursor(self):
        return self

    def execute(self, sql, params=()):
        if not isinstance(params, (tuple, list)):
            params = (params,)
        try:
            rs = self.client.execute(sql, params)
            return TursoCursor(rs)
        except Exception as e:
            print(f"[DB] execute error: {e} | SQL: {sql[:80]}")
            # Tenta reconectar uma vez se o cliente caiu
            global _db_client
            try:
                _db_client = _create_client()
                self.client = _db_client
                rs = self.client.execute(sql, params)
                return TursoCursor(rs)
            except Exception as e2:
                print(f"[DB] reconnect failed: {e2}")
                raise e2

    def executescript(self, sql_script):
        statements = [s.strip() for s in sql_script.split(';') if s.strip()]
        for stmt in statements:
            try:
                self.client.execute(stmt)
            except Exception as e:
                print(f"[DB] executescript stmt error (ignored): {e}")

    def commit(self):
        pass

    def close(self):
        pass  # nao fecha — cliente e singleton reutilizado


def _create_client():
    # Converte libsql:// para https:// para evitar WebSocket (bloqueado no Render)
    url = TURSO_URL
    if url.startswith("libsql://"):
        url = url.replace("libsql://", "https://", 1)
    print(f"[DB] Criando cliente Turso — URL={url[:40]}...")
    if url.startswith("file:"):
        return libsql_client.create_client_sync(url=url)
    if not TURSO_TOKEN:
        raise Exception("TURSO_TOKEN nao configurado!")
    return libsql_client.create_client_sync(url=url, auth_token=TURSO_TOKEN)


_db_client = None


def get_db():
    global _db_client
    if _db_client is None:
        _db_client = _create_client()
    return TursoAdapter(_db_client)


def hash_password(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()


def init_db():
    try:
        conn = get_db()
        c = conn.cursor()
        c.executescript("""
        CREATE TABLE IF NOT EXISTS setores ( id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL UNIQUE );
        CREATE TABLE IF NOT EXISTS usuarios ( id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, email TEXT NOT NULL UNIQUE, senha TEXT NOT NULL, nivel_acesso TEXT NOT NULL CHECK(nivel_acesso IN ('admin','estagiario','espectador')), setor_id INTEGER REFERENCES setores(id) );
        CREATE TABLE IF NOT EXISTS motivos_saida ( id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL UNIQUE );
        CREATE TABLE IF NOT EXISTS pacientes ( id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, idade INTEGER, leito TEXT, prontuario TEXT, fone TEXT, diagnostico TEXT, setor_id_atual INTEGER REFERENCES setores(id), status TEXT NOT NULL DEFAULT 'internado' CHECK(status IN ('internado','alta')), motivo_saida_id INTEGER REFERENCES motivos_saida(id), data_internacao TEXT DEFAULT (date('now')) );
        CREATE TABLE IF NOT EXISTS registros_diarios ( id INTEGER PRIMARY KEY AUTOINCREMENT, paciente_id INTEGER NOT NULL REFERENCES pacientes(id), data TEXT NOT NULL DEFAULT (date('now')), temperatura REAL );
        CREATE TABLE IF NOT EXISTS procedimentos ( id INTEGER PRIMARY KEY AUTOINCREMENT, paciente_id INTEGER NOT NULL REFERENCES pacientes(id), tipo_procedimento TEXT NOT NULL, data_insercao TEXT NOT NULL, data_remocao TEXT, status TEXT NOT NULL DEFAULT 'ativo' CHECK(status IN ('ativo','removido')) );
        CREATE TABLE IF NOT EXISTS infeccoes_notificadas ( id INTEGER PRIMARY KEY AUTOINCREMENT, paciente_id INTEGER NOT NULL REFERENCES pacientes(id), tipo_infeccao TEXT NOT NULL, data_notificacao TEXT NOT NULL DEFAULT (date('now')) )
        """)
        # Migracao: adiciona coluna diagnostico se nao existir (banco antigo)
        try:
            c.execute("ALTER TABLE pacientes ADD COLUMN diagnostico TEXT")
        except:
            pass
        try:
            c.execute("ALTER TABLE pacientes ADD COLUMN setor_id_destino INTEGER REFERENCES setores(id)")
        except:
            pass

        motivos = ['Alta Médica', 'Óbito', 'Transferência para outro hospital']
        for m in motivos:
            c.execute("INSERT OR IGNORE INTO motivos_saida(nome) VALUES(?)", (m,))
        c.execute("INSERT OR IGNORE INTO setores(nome) VALUES('UTI Geral')")
        c.execute("INSERT OR IGNORE INTO setores(nome) VALUES('Clínica Cirúrgica')")
        c.execute("INSERT OR IGNORE INTO setores(nome) VALUES('Clínica Médica')")

        admin_check = c.execute("SELECT * FROM usuarios WHERE email='admin@ccih.com'").fetchone()
        if not admin_check:
            c.execute(
                "INSERT INTO usuarios(nome, email, senha, nivel_acesso, setor_id) VALUES('Administrador', 'admin@ccih.com', ?, 'admin', NULL)",
                (hash_password('admin123'),)
            )
        conn.commit()
        conn.close()
        print("[CCIH] Banco Inicializado.")
    except Exception as e:
        print(f"[CCIH] ERRO CRITICO no init_db: {e}")
        raise


# ---------------------------------------------------------------------------
# AUTH HELPERS & ROUTES
# ---------------------------------------------------------------------------
def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Nao autenticado'}), 401
        return f(*args, **kwargs)
    return decorated


def not_readonly(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if session.get('nivel_acesso') == 'espectador':
            return jsonify({'error': 'Acesso somente leitura'}), 403
        return f(*args, **kwargs)
    return decorated


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.json or {}
    email = data.get('email', '').strip().lower()
    senha = data.get('senha', '')
    if not email or not senha:
        return jsonify({'error': 'Campos obrigatorios'}), 400
    try:
        conn = get_db()
        user = conn.execute("SELECT * FROM usuarios WHERE email=?", (email,)).fetchone()
        conn.close()
    except Exception as e:
        print(f"[LOGIN] erro DB: {e}")
        return jsonify({'error': 'Erro de conexao com banco de dados'}), 500
    if not user or user['senha'] != hash_password(senha):
        return jsonify({'error': 'Credenciais invalidas'}), 401
    session['user_id'] = user['id']
    session['nivel_acesso'] = user['nivel_acesso']
    session['setor_id'] = user['setor_id']
    session['nome'] = user['nome']
    return jsonify({'id': user['id'], 'nome': user['nome'], 'nivel_acesso': user['nivel_acesso'], 'setor_id': user['setor_id']})


@app.route('/api/auth/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'ok': True})


@app.route('/api/auth/me', methods=['GET'])
@login_required
def me():
    return jsonify({'id': session['user_id'], 'nome': session['nome'], 'nivel_acesso': session['nivel_acesso'], 'setor_id': session['setor_id']})


@app.route('/api/auth/senha', methods=['PUT'])
@login_required
def change_password():
    data = request.json or {}
    senha_atual = data.get('senha_atual', '')
    nova_senha = data.get('nova_senha', '')
    conn = get_db()
    user = conn.execute("SELECT senha FROM usuarios WHERE id=?", (session['user_id'],)).fetchone()
    if hash_password(senha_atual) != user['senha']:
        conn.close()
        return jsonify({'error': 'A senha atual esta incorreta'}), 401
    if len(nova_senha) < 6:
        conn.close()
        return jsonify({'error': 'A nova senha deve ter no minimo 6 caracteres'}), 400
    conn.execute("UPDATE usuarios SET senha=? WHERE id=?", (hash_password(nova_senha), session['user_id']))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# API ROUTES
# ---------------------------------------------------------------------------
@app.route('/api/setores', methods=['GET'])
@login_required
def get_setores():
    try:
        conn = get_db()
        rows = conn.execute("SELECT * FROM setores ORDER BY nome").fetchall()
        conn.close()
        return jsonify(rows)
    except Exception as e:
        print(f"[SETORES] erro: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/setores', methods=['POST'])
@login_required
@not_readonly
def create_setor():
    if session['nivel_acesso'] != 'admin':
        return jsonify({'error': 'Apenas admin'}), 403
    nome = (request.json or {}).get('nome', '').strip()
    if not nome:
        return jsonify({'error': 'Nome obrigatorio'}), 400
    conn = get_db()
    try:
        conn.execute("INSERT INTO setores(nome) VALUES(?)", (nome,))
        conn.commit()
        setor = conn.execute("SELECT * FROM setores WHERE nome=?", (nome,)).fetchone()
    except:
        conn.close()
        return jsonify({'error': 'Setor ja existe'}), 409
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


@app.route('/api/usuarios', methods=['GET'])
@login_required
def get_usuarios():
    if session['nivel_acesso'] not in ('admin', 'espectador'):
        return jsonify({'error': 'Sem permissao'}), 403
    conn = get_db()
    rows = conn.execute(
        "SELECT u.id, u.nome, u.email, u.nivel_acesso, u.setor_id, s.nome as setor_nome FROM usuarios u LEFT JOIN setores s ON s.id=u.setor_id ORDER BY u.nome"
    ).fetchall()
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
    if not all([nome, email, senha, nivel]) or nivel not in ('admin', 'estagiario', 'espectador'):
        return jsonify({'error': 'Dados invalidos'}), 400
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO usuarios(nome,email,senha,nivel_acesso,setor_id) VALUES(?,?,?,?,?)",
            (nome, email, hash_password(senha), nivel, setor_id)
        )
        conn.commit()
        u = conn.execute("SELECT id,nome,email,nivel_acesso,setor_id FROM usuarios WHERE email=?", (email,)).fetchone()
    except:
        conn.close()
        return jsonify({'error': 'Email ja cadastrado'}), 409
    conn.close()
    return jsonify(u), 201


@app.route('/api/usuarios/<int:uid>', methods=['DELETE'])
@login_required
@not_readonly
def delete_usuario(uid):
    if session['nivel_acesso'] != 'admin':
        return jsonify({'error': 'Apenas admin'}), 403
    if uid == session['user_id']:
        return jsonify({'error': 'Nao pode excluir a si mesmo'}), 400
    conn = get_db()
    conn.execute("DELETE FROM usuarios WHERE id=?", (uid,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/pacientes', methods=['GET'])
@login_required
def get_pacientes():
    nivel = session['nivel_acesso']
    setor_id = session['setor_id']
    conn = get_db()
    try:
        if nivel == 'estagiario' and setor_id:
            rows = conn.execute(
                "SELECT p.*, s.nome as setor_nome FROM pacientes p LEFT JOIN setores s ON s.id = p.setor_id_atual WHERE (p.setor_id_atual=? OR p.setor_id_destino=?) AND p.status='internado' ORDER BY p.leito * 1, p.leito, p.nome",
                (setor_id, setor_id)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT p.*, s.nome as setor_nome FROM pacientes p LEFT JOIN setores s ON s.id = p.setor_id_atual WHERE p.status='internado' ORDER BY s.nome, p.leito * 1, p.leito, p.nome"
            ).fetchall()
        for p in rows:
            p['procedimentos'] = conn.execute(
                "SELECT * FROM procedimentos WHERE paciente_id=? AND status='ativo'", (p['id'],)
            ).fetchall()
            p['infeccoes'] = conn.execute(
                "SELECT * FROM infeccoes_notificadas WHERE paciente_id=?", (p['id'],)
            ).fetchall()
    except Exception as e:
        conn.close()
        return jsonify({'error': str(e)}), 500
    conn.close()
    return jsonify(rows)


@app.route('/api/pacientes', methods=['POST'])
@login_required
@not_readonly
def create_paciente():
    if session['nivel_acesso'] == 'espectador':
        return jsonify({'error': 'Sem permissao'}), 403
    data = request.json or {}
    nome = data.get('nome', '').strip()
    if not nome:
        return jsonify({'error': 'Nome obrigatorio'}), 400
    setor_id = data.get('setor_id')
    idade = data.get('idade')
    diagnostico = data.get('diagnostico', '').strip()
    data_internacao = data.get('data_internacao') or date.today().isoformat()
    if not setor_id or str(setor_id).strip() == '':
        setor_id = None
    if not idade or str(idade).strip() == '':
        idade = None
    if session['nivel_acesso'] == 'estagiario':
        setor_id = session['setor_id']
    conn = get_db()
    try:
        cursor = conn.execute(
            "INSERT INTO pacientes(nome, idade, leito, prontuario, fone, diagnostico, setor_id_atual, status, data_internacao) VALUES(?,?,?,?,?,?,?,'internado',?)",
            (nome, idade, data.get('leito', '').strip(), data.get('prontuario', '').strip(), data.get('fone', '').strip(), diagnostico, setor_id, data_internacao)
        )
        conn.commit()
        pac = conn.execute(
            "SELECT p.*, s.nome as setor_nome FROM pacientes p LEFT JOIN setores s ON s.id=p.setor_id_atual WHERE p.id=?",
            (cursor.lastrowid,)
        ).fetchone()
    except Exception as e:
        conn.close()
        return jsonify({'error': str(e)}), 500
    conn.close()
    return jsonify(pac), 201


@app.route('/api/pacientes/<int:pid>', methods=['GET'])
@login_required
def get_paciente(pid):
    conn = get_db()
    pac = conn.execute(
        "SELECT p.*, s.nome as setor_nome FROM pacientes p LEFT JOIN setores s ON s.id=p.setor_id_atual WHERE p.id=?",
        (pid,)
    ).fetchone()
    if not pac:
        conn.close()
        return jsonify({'error': 'Nao encontrado'}), 404
    if session['nivel_acesso'] == 'estagiario' and pac['setor_id_atual'] != session['setor_id']:
        conn.close()
        return jsonify({'error': 'Sem permissao'}), 403
    pac['registros'] = conn.execute(
        "SELECT * FROM registros_diarios WHERE paciente_id=? ORDER BY data DESC", (pid,)
    ).fetchall()
    pac['procedimentos'] = conn.execute(
        "SELECT * FROM procedimentos WHERE paciente_id=? ORDER BY data_insercao DESC", (pid,)
    ).fetchall()
    pac['infeccoes'] = conn.execute(
        "SELECT * FROM infeccoes_notificadas WHERE paciente_id=? ORDER BY data_notificacao DESC", (pid,)
    ).fetchall()
    conn.close()
    return jsonify(pac)


# NOVO: Editar paciente
@app.route('/api/pacientes/<int:pid>', methods=['PUT'])
@login_required
@not_readonly
def update_paciente(pid):
    conn = get_db()
    pac = conn.execute("SELECT * FROM pacientes WHERE id=?", (pid,)).fetchone()
    if not pac:
        conn.close()
        return jsonify({'error': 'Nao encontrado'}), 404
    if session['nivel_acesso'] == 'estagiario' and pac['setor_id_atual'] != session['setor_id']:
        conn.close()
        return jsonify({'error': 'Sem permissao'}), 403
    data = request.json or {}
    nome = data.get('nome', '').strip()
    if not nome:
        conn.close()
        return jsonify({'error': 'Nome obrigatorio'}), 400
    idade = data.get('idade')
    setor_id = data.get('setor_id')
    diagnostico = data.get('diagnostico', '').strip()
    data_internacao = data.get('data_internacao') or pac['data_internacao']
    if not idade or str(idade).strip() == '':
        idade = None
    if not setor_id or str(setor_id).strip() == '':
        setor_id = None
    if session['nivel_acesso'] == 'estagiario':
        setor_id = pac['setor_id_atual']
    try:
        conn.execute(
            "UPDATE pacientes SET nome=?, idade=?, leito=?, prontuario=?, fone=?, diagnostico=?, setor_id_atual=?, data_internacao=? WHERE id=?",
            (nome, idade, data.get('leito', '').strip(), data.get('prontuario', '').strip(), data.get('fone', '').strip(), diagnostico, setor_id, data_internacao, pid)
        )
        conn.commit()
        pac = conn.execute(
            "SELECT p.*, s.nome as setor_nome FROM pacientes p LEFT JOIN setores s ON s.id=p.setor_id_atual WHERE p.id=?",
            (pid,)
        ).fetchone()
    except Exception as e:
        conn.close()
        return jsonify({'error': str(e)}), 500
    conn.close()
    return jsonify(pac)


@app.route('/api/pacientes/<int:pid>', methods=['DELETE'])
@login_required
def deletar_paciente(pid):
    if session.get('nivel_acesso') != 'admin':
        return jsonify({'error': 'Apenas administradores'}), 403
    conn = get_db()
    try:
        conn.execute("DELETE FROM registros_diarios WHERE paciente_id=?", (pid,))
        conn.execute("DELETE FROM procedimentos WHERE paciente_id=?", (pid,))
        conn.execute("DELETE FROM infeccoes_notificadas WHERE paciente_id=?", (pid,))
        conn.execute("DELETE FROM pacientes WHERE id=?", (pid,))
        conn.commit()
    except Exception as e:
        conn.close()
        return jsonify({'error': str(e)}), 500
    conn.close()
    return jsonify({'ok': True})

@app.route('/api/pacientes/<int:pid>/transferir', methods=['POST'])
@login_required
@not_readonly
def solicitar_transferencia(pid):
    data = request.json or {}
    destino_id = data.get('setor_id_destino')
    if not destino_id:
        return jsonify({'error': 'Setor de destino obrigatorio'}), 400
    conn = get_db()
    conn.execute("UPDATE pacientes SET setor_id_destino=? WHERE id=?", (destino_id, pid))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

@app.route('/api/pacientes/<int:pid>/receber', methods=['POST'])
@login_required
@not_readonly
def confirmar_recebimento(pid):
    conn = get_db()
    conn.execute("UPDATE pacientes SET setor_id_atual = setor_id_destino, setor_id_destino = NULL WHERE id=?", (pid,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/pacientes/<int:pid>/alta', methods=['POST'])
@login_required
@not_readonly
def dar_alta(pid):
    motivo_id = (request.json or {}).get('motivo_saida_id')
    if not motivo_id:
        return jsonify({'error': 'Motivo obrigatorio'}), 400
    conn = get_db()
    pac = conn.execute("SELECT * FROM pacientes WHERE id=?", (pid,)).fetchone()
    if not pac:
        conn.close()
        return jsonify({'error': 'Nao encontrado'}), 404
    if session['nivel_acesso'] == 'estagiario' and pac['setor_id_atual'] != session['setor_id']:
        conn.close()
        return jsonify({'error': 'Sem permissao'}), 403
    conn.execute("UPDATE pacientes SET status='alta', motivo_saida_id=? WHERE id=?", (motivo_id, pid))
    conn.execute("UPDATE procedimentos SET status='removido', data_remocao=date('now') WHERE paciente_id=? AND status='ativo'", (pid,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/pacientes/<int:pid>/registros', methods=['POST'])
@login_required
@not_readonly
def add_registro(pid):
    data = request.json or {}
    conn = get_db()
    conn.execute(
        "INSERT INTO registros_diarios(paciente_id, data, temperatura) VALUES(?,?,?)",
        (pid, data.get('data') or date.today().isoformat(), data.get('temperatura'))
    )
    conn.commit()
    reg = conn.execute(
        "SELECT * FROM registros_diarios WHERE paciente_id=? ORDER BY id DESC LIMIT 1", (pid,)
    ).fetchone()
    conn.close()
    return jsonify(reg), 201


@app.route('/api/pacientes/<int:pid>/procedimentos', methods=['POST'])
@login_required
@not_readonly
def add_procedimento(pid):
    data = request.json or {}
    tipo = data.get('tipo_procedimento', '').strip()
    data_ins = data.get('data_insercao', '').strip()
    if not tipo or not data_ins:
        return jsonify({'error': 'Dados obrigatorios'}), 400
    conn = get_db()
    conn.execute(
        "INSERT INTO procedimentos(paciente_id, tipo_procedimento, data_insercao, status) VALUES(?,?,?,'ativo')",
        (pid, tipo, data_ins)
    )
    conn.commit()
    proc = conn.execute(
        "SELECT * FROM procedimentos WHERE paciente_id=? ORDER BY id DESC LIMIT 1", (pid,)
    ).fetchone()
    conn.close()
    return jsonify(proc), 201


@app.route('/api/procedimentos/<int:proc_id>/remover', methods=['POST'])
@login_required
@not_readonly
def remover_procedimento(proc_id):
    data_rem = (request.json or {}).get('data_remocao') or date.today().isoformat()
    conn = get_db()
    conn.execute("UPDATE procedimentos SET status='removido', data_remocao=? WHERE id=?", (data_rem, proc_id))
    conn.commit()
    proc = conn.execute("SELECT * FROM procedimentos WHERE id=?", (proc_id,)).fetchone()
    conn.close()
    return jsonify(proc)


TIPOS_INFECCAO = ['Trato Urinário', 'Sepse', 'Pneumonia', 'Ferida Operatória', 'Outra']


@app.route('/api/pacientes/<int:pid>/infeccoes', methods=['POST'])
@login_required
@not_readonly
def add_infeccao(pid):
    data = request.json or {}
    tipo = data.get('tipo_infeccao', '').strip()
    if tipo not in TIPOS_INFECCAO:
        return jsonify({'error': 'Tipo invalido'}), 400
    conn = get_db()
    conn.execute(
        "INSERT INTO infeccoes_notificadas(paciente_id, tipo_infeccao, data_notificacao) VALUES(?,?,?)",
        (pid, tipo, data.get('data_notificacao') or date.today().isoformat())
    )
    conn.commit()
    inf = conn.execute(
        "SELECT * FROM infeccoes_notificadas WHERE paciente_id=? ORDER BY id DESC LIMIT 1", (pid,)
    ).fetchone()
    conn.close()
    return jsonify(inf), 201


@app.route('/api/auth/mudar-senha', methods=['POST'])
@login_required
def mudar_senha_alias():
    data = request.json or {}
    senha_atual = data.get('senha_atual', '')
    nova_senha = data.get('senha_nova', '')
    conn = get_db()
    user = conn.execute("SELECT senha FROM usuarios WHERE id=?", (session['user_id'],)).fetchone()
    if hash_password(senha_atual) != user['senha']:
        conn.close()
        return jsonify({'error': 'A senha atual está incorreta'}), 401
    if len(nova_senha) < 6:
        conn.close()
        return jsonify({'error': 'A nova senha deve ter no mínimo 6 caracteres'}), 400
    conn.execute("UPDATE usuarios SET senha=? WHERE id=?", (hash_password(nova_senha), session['user_id']))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/pacientes/<int:pid>/detalhes', methods=['GET'])
@login_required
def get_paciente_detalhes(pid):
    conn = get_db()
    pac = conn.execute(
        "SELECT p.*, s.nome as setor_nome FROM pacientes p LEFT JOIN setores s ON s.id=p.setor_id_atual WHERE p.id=?",
        (pid,)
    ).fetchone()
    if not pac:
        conn.close()
        return jsonify({'error': 'Não encontrado'}), 404
    if session['nivel_acesso'] == 'estagiario' and pac['setor_id_atual'] != session['setor_id']:
        conn.close()
        return jsonify({'error': 'Sem permissão'}), 403
    registros = conn.execute(
        "SELECT * FROM registros_diarios WHERE paciente_id=? ORDER BY data DESC", (pid,)
    ).fetchall()
    procedimentos = conn.execute(
        "SELECT * FROM procedimentos WHERE paciente_id=? ORDER BY data_insercao DESC", (pid,)
    ).fetchall()
    infeccoes = conn.execute(
        "SELECT * FROM infeccoes_notificadas WHERE paciente_id=? ORDER BY data_notificacao DESC", (pid,)
    ).fetchall()
    conn.close()
    return jsonify({'paciente': pac, 'registros': registros, 'procedimentos': procedimentos, 'infeccoes': infeccoes})



@app.route('/api/motivos_saida', methods=['GET'])
@login_required
def get_motivos():
    try:
        conn = get_db()
        rows = conn.execute("SELECT * FROM motivos_saida ORDER BY nome").fetchall()
        conn.close()
        return jsonify(rows)
    except Exception as e:
        print(f"[MOTIVOS] erro: {e}")
        return jsonify({'error': str(e)}), 500


# ---------------------------------------------------------------------------
# DASHBOARD
# ---------------------------------------------------------------------------
@app.route('/api/dashboard/relatorios', methods=['GET'])
@login_required
def relatorios():
    mes = request.args.get('mes') or date.today().strftime('%Y-%m')
    ano_mes = mes[:7]
    nivel = session['nivel_acesso']

    filtro_setor = session.get('setor_id') if nivel == 'estagiario' else None
    wp = " AND p.setor_id_atual = ?" if filtro_setor else ""
    params = [filtro_setor] if filtro_setor else []

    conn = get_db()
    try:
        pac_alta_row = conn.execute(
            f"SELECT COUNT(DISTINCT p.id) as total FROM pacientes p WHERE p.status='alta' {wp}", params
        ).fetchone()
        pacientes_alta = int(pac_alta_row['total']) if pac_alta_row else 0

        inf_mes_row = conn.execute(
            f"SELECT COUNT(i.id) as total FROM infeccoes_notificadas i JOIN pacientes p ON p.id = i.paciente_id WHERE strftime('%Y-%m', i.data_notificacao)=? {wp}",
            [ano_mes] + params
        ).fetchone()
        total_inf = int(inf_mes_row['total']) if inf_mes_row else 0

        por_tipo = conn.execute(
            f"SELECT i.tipo_infeccao, COUNT(i.id) as total FROM infeccoes_notificadas i JOIN pacientes p ON p.id = i.paciente_id WHERE strftime('%Y-%m', i.data_notificacao)=? {wp} GROUP BY i.tipo_infeccao",
            [ano_mes] + params
        ).fetchall()

        def get_inf(tipo):
            for item in por_tipo:
                if item['tipo_infeccao'] == tipo:
                    return int(item['total'])
            return 0

        taxa_geral = round((total_inf / pacientes_alta * 100) if pacientes_alta > 0 else 0, 2)

        def taxa_prop(n):
            return round((n / total_inf * 100) if total_inf > 0 else 0, 2)

        data = {
            'ano_mes': ano_mes,
            'pacientes_alta_geral': pacientes_alta,
            'total_infeccoes_mes': total_inf,
            'taxa_infeccao_geral': taxa_geral,
            'detalhes': {
                'Trato Urinário': {'qtd': get_inf('Trato Urinário'), 'prop': taxa_prop(get_inf('Trato Urinário'))},
                'Sepse': {'qtd': get_inf('Sepse'), 'prop': taxa_prop(get_inf('Sepse'))},
                'Pneumonia': {'qtd': get_inf('Pneumonia'), 'prop': taxa_prop(get_inf('Pneumonia'))},
                'Ferida Operatória': {'qtd': get_inf('Ferida Operatória'), 'prop': taxa_prop(get_inf('Ferida Operatória'))},
                'Outra': {'qtd': get_inf('Outra'), 'prop': taxa_prop(get_inf('Outra'))}
            }
        }
        conn.close()
        return jsonify(data)
    except Exception as e:
        conn.close()
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    init_db()
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
