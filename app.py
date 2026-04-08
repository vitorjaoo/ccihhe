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

TURSO_URL = os.environ.get('TURSO_URL', 'libsql://ccih-vitorrastrep.aws-us-east-2.turso.io')
TURSO_TOKEN = os.environ.get('TURSO_TOKEN', 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzU2ODUwNTYsImlkIjoiMDE5ZDZhNmUtZTkwMS03YWQ5LTg2YjAtMWJhZWVmYjI1YWFkIiwicmlkIjoiYTlmZTQwZWItYzg1NS00NDRkLWFlMjktZGQzNjkwNzI0ODc0In0.FwEon_QmTAxqSL0RrIUnt6dD4NaT4MONuA4ezgf2i0UcN4s1PJchDobiUyinb_GzFD1-9rQGmRl6B0QMMeRxDQ')

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
        if not self.rows: return None
        return self.rows[0]
    def fetchall(self):
        return self.rows

class TursoAdapter:
    def __init__(self, client):
        self.client = client
    def cursor(self): return self
    def execute(self, sql, params=()):
        if not isinstance(params, (tuple, list)): params = (params,)
        try:
            rs = self.client.execute(sql, params)
            return TursoCursor(rs)
        except Exception as e:
            print(f"[DB ERROR] {e}")
            raise e
    def executescript(self, sql_script):
        for stmt in sql_script.split(';'):
            if stmt.strip(): self.client.execute(stmt)
    def commit(self): pass
    def close(self): pass

def _create_client():
    url = TURSO_URL.replace("libsql://", "https://", 1) if TURSO_URL.startswith("libsql://") else TURSO_URL
    return libsql_client.create_client_sync(url=url, auth_token=TURSO_TOKEN)

_db_client = None
def get_db():
    global _db_client
    if _db_client is None: _db_client = _create_client()
    return TursoAdapter(_db_client)

def hash_password(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.executescript("""
    CREATE TABLE IF NOT EXISTS setores ( id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL UNIQUE );
    CREATE TABLE IF NOT EXISTS usuarios ( id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, email TEXT NOT NULL UNIQUE, senha TEXT NOT NULL, nivel_acesso TEXT NOT NULL CHECK(nivel_acesso IN ('admin','estagiario','espectador')), setor_id INTEGER REFERENCES setores(id) );
    CREATE TABLE IF NOT EXISTS motivos_saida ( id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL UNIQUE );
    CREATE TABLE IF NOT EXISTS pacientes ( id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, idade INTEGER, leito TEXT, prontuario TEXT, fone TEXT, diagnostico TEXT, setor_id_atual INTEGER REFERENCES setores(id), status TEXT NOT NULL DEFAULT 'internado', motivo_saida_id INTEGER REFERENCES motivos_saida(id), data_internacao TEXT DEFAULT (date('now')), setor_id_destino INTEGER REFERENCES setores(id) );
    CREATE TABLE IF NOT EXISTS registros_diarios ( id INTEGER PRIMARY KEY AUTOINCREMENT, paciente_id INTEGER NOT NULL REFERENCES pacientes(id), data TEXT NOT NULL DEFAULT (date('now')), temperatura REAL );
    CREATE TABLE IF NOT EXISTS procedimentos ( id INTEGER PRIMARY KEY AUTOINCREMENT, paciente_id INTEGER NOT NULL REFERENCES pacientes(id), tipo_procedimento TEXT NOT NULL, data_insercao TEXT NOT NULL, data_remocao TEXT, status TEXT NOT NULL DEFAULT 'ativo' );
    CREATE TABLE IF NOT EXISTS infeccoes_notificadas ( id INTEGER PRIMARY KEY AUTOINCREMENT, paciente_id INTEGER NOT NULL REFERENCES pacientes(id), tipo_infeccao TEXT NOT NULL, data_notificacao TEXT NOT NULL DEFAULT (date('now')) )
    """)
    conn.commit()

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session: return jsonify({'error': 'Nao autenticado'}), 401
        return f(*args, **kwargs)
    return decorated

@app.route('/')
def index(): return render_template('index.html')

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.json or {}
    user = get_db().execute("SELECT * FROM usuarios WHERE email=?", (data.get('email','').lower(),)).fetchone()
    if not user or user['senha'] != hash_password(data.get('senha','')):
        return jsonify({'error': 'Credenciais invalidas'}), 401
    session.update({'user_id': user['id'], 'nivel_acesso': user['nivel_acesso'], 'setor_id': user['setor_id'], 'nome': user['nome']})
    return jsonify(user)

@app.route('/api/auth/me')
@login_required
def me(): return jsonify({'id': session['user_id'], 'nome': session['nome'], 'nivel_acesso': session['nivel_acesso'], 'setor_id': session['setor_id']})

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'ok': True})

@app.route('/api/pacientes', methods=['GET'])
@login_required
def get_pacientes():
    conn = get_db()
    if session['nivel_acesso'] == 'estagiario' and session['setor_id']:
        rows = conn.execute("SELECT p.*, s.nome as setor_nome FROM pacientes p LEFT JOIN setores s ON s.id = p.setor_id_atual WHERE (p.setor_id_atual=? OR p.setor_id_destino=?) AND p.status='internado'", (session['setor_id'], session['setor_id'])).fetchall()
    else:
        rows = conn.execute("SELECT p.*, s.nome as setor_nome FROM pacientes p LEFT JOIN setores s ON s.id = p.setor_id_atual WHERE p.status='internado' ORDER BY p.id DESC").fetchall()
    return jsonify(rows)

@app.route('/api/pacientes', methods=['POST'])
@login_required
def create_paciente():
    data = request.json
    setor = session['setor_id'] if session['nivel_acesso'] == 'estagiario' else data.get('setor_id')
    conn = get_db()
    res = conn.execute("INSERT INTO pacientes(nome, idade, leito, prontuario, fone, diagnostico, setor_id_atual, data_internacao) VALUES(?,?,?,?,?,?,?,?)",
                 (data['nome'], data.get('idade'), data.get('leito'), data.get('prontuario'), data.get('fone'), data.get('diagnostico'), setor, data.get('data_internacao', date.today().isoformat())))
    return jsonify({'id': res.lastrowid}), 201

@app.route('/api/pacientes/<int:pid>/receber', methods=['POST'])
@login_required
def confirmar_recebimento(pid):
    conn = get_db()
    # Correção do Erro 500: Verifica se o registro existe antes de atualizar
    check = conn.execute("SELECT id FROM pacientes WHERE id=? AND setor_id_destino IS NOT NULL", (pid,)).fetchone()
    if not check: return jsonify({'error': 'Sem transferencia pendente'}), 400
    conn.execute("UPDATE pacientes SET setor_id_atual = setor_id_destino, setor_id_destino = NULL WHERE id=?", (pid,))
    return jsonify({'ok': True})

@app.route('/api/pacientes/<int:pid>', methods=['DELETE'])
@login_required
def deletar_paciente(pid):
    if session['nivel_acesso'] != 'admin': return jsonify({'error': 'Acesso negado'}), 403
    conn = get_db()
    conn.execute("DELETE FROM pacientes WHERE id=?", (pid,))
    return jsonify({'ok': True})

@app.route('/api/setores', methods=['GET'])
@login_required
def get_setores():
    return jsonify(get_db().execute("SELECT * FROM setores ORDER BY nome").fetchall())

@app.route('/api/motivos_saida', methods=['GET'])
@login_required
def get_motivos():
    return jsonify(get_db().execute("SELECT * FROM motivos_saida ORDER BY nome").fetchall())

@app.route('/api/dashboard/relatorios', methods=['GET'])
@login_required
def relatorios():
    mes = request.args.get('mes', date.today().strftime('%Y-%m'))
    conn = get_db()
    altas = conn.execute("SELECT COUNT(*) as total FROM pacientes WHERE status='alta'").fetchone()
    infs = conn.execute("SELECT COUNT(*) as total FROM infeccoes_notificadas WHERE strftime('%Y-%m', data_notificacao)=?", (mes,)).fetchone()
    return jsonify({'pacientes_alta_geral': altas['total'], 'total_infeccoes_mes': infs['total'], 'taxa_infeccao_geral': 0, 'detalhes': {}})

@app.route('/api/pacientes/<int:pid>/detalhes', methods=['GET'])
@login_required
def get_paciente_detalhes(pid):
    conn = get_db()
    pac = conn.execute("SELECT p.*, s.nome as setor_nome FROM pacientes p LEFT JOIN setores s ON s.id=p.setor_id_atual WHERE p.id=?", (pid,)).fetchone()
    regs = conn.execute("SELECT * FROM registros_diarios WHERE paciente_id=? ORDER BY data DESC", (pid,)).fetchall()
    procs = conn.execute("SELECT * FROM procedimentos WHERE paciente_id=? ORDER BY data_insercao DESC", (pid,)).fetchall()
    infs = conn.execute("SELECT * FROM infeccoes_notificadas WHERE paciente_id=? ORDER BY data_notificacao DESC", (pid,)).fetchall()
    return jsonify({'paciente': pac, 'registros': regs, 'procedimentos': procs, 'infeccoes': infs})

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
