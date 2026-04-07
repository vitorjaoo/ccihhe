import os
import libsql_client
from dotenv import load_dotenv
from flask import Flask, render_template, request, jsonify, session
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
from datetime import date

load_dotenv()

app = Flask(__name__)
app.secret_key = 'ccih-secret-key-2024'

TURSO_URL = os.getenv("TURSO_DATABASE_URL", "file:ccih.db")
TURSO_TOKEN = os.getenv("TURSO_AUTH_TOKEN", "")

PROCEDIMENTOS_LISTA = [
    "cateter venoso central punção", "cateter venoso central dessecação",
    "cateter swan ganz", "cateter nutrição parental", "dissecação de veia periférica",
    "entubação", "respiração artificial", "traqueostomia", "sonda gástrica",
    "sonda vesical", "cateter arterial", "dreno cirurgia Neurológica",
    "dreno mediastino", "diálise peritoneal"
]

def get_db():
    if TURSO_URL.startswith("file:"):
        return libsql_client.create_client_sync(url=TURSO_URL)
    return libsql_client.create_client_sync(url=TURSO_URL, auth_token=TURSO_TOKEN)

def query_db(sql, params=()):
    with get_db() as db:
        res = db.execute(sql, params)
        return [dict(zip(res.columns, row)) for row in res.rows]

def execute_db(sql, params=()):
    with get_db() as db:
        return db.execute(sql, params)

def init_db():
    with get_db() as db:
        db.batch([
            "CREATE TABLE IF NOT EXISTS Setores (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT UNIQUE);",
            "CREATE TABLE IF NOT EXISTS Usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, email TEXT UNIQUE, senha TEXT, nivel_acesso TEXT, setor_id INTEGER);",
            "CREATE TABLE IF NOT EXISTS Pacientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, idade INTEGER, leito TEXT, prontuario TEXT, fone TEXT, setor_id_atual INTEGER, status TEXT DEFAULT 'ativo', motivo_saida TEXT);",
            "CREATE TABLE IF NOT EXISTS Registros_Diarios (id INTEGER PRIMARY KEY AUTOINCREMENT, paciente_id INTEGER, data TEXT, temperatura REAL);",
            "CREATE TABLE IF NOT EXISTS Procedimentos (id INTEGER PRIMARY KEY AUTOINCREMENT, paciente_id INTEGER, tipo_procedimento TEXT, data_insercao TEXT, data_remocao TEXT, status TEXT DEFAULT 'ativo');",
            "CREATE TABLE IF NOT EXISTS Infeccoes_Notificadas (id INTEGER PRIMARY KEY AUTOINCREMENT, paciente_id INTEGER, tipo_infeccao TEXT, data_notificacao TEXT);"
        ])
        # Admin Padrão
        if not db.execute("SELECT * FROM Usuarios WHERE email='admin@ccih.com'").rows:
            db.execute("INSERT INTO Usuarios (nome, email, senha, nivel_acesso) VALUES (?,?,?,?)",
                       ('Admin Geral', 'admin@ccih.com', generate_password_hash('admin123'), 'admin'))

# Bloqueio global de escrita para o Espectador
@app.before_request
def check_espectador_permissions():
    if request.method in ['POST', 'PUT', 'DELETE']:
        if session.get('nivel_acesso') == 'espectador' and request.path.startswith('/api/') and request.path not in ['/api/login', '/api/logout']:
            return jsonify({'error': 'Acesso apenas para leitura.'}), 403

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session: return jsonify({'error': 'Não autenticado'}), 401
        return f(*args, **kwargs)
    return decorated

@app.route('/')
def index():
    page = 'app' if 'user_id' in session else 'login'
    return render_template('index.html', page=page, user=session.get('nome',''), nivel=session.get('nivel_acesso',''), setor_id=session.get('setor_id',''))

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    users = query_db("SELECT * FROM Usuarios WHERE email=?", (data.get('email'),))
    if users and check_password_hash(users[0]['senha'], data.get('senha', '')):
        u = users[0]
        session.update({'user_id': u['id'], 'nome': u['nome'], 'nivel_acesso': u['nivel_acesso'], 'setor_id': u['setor_id']})
        return jsonify({'ok': True})
    return jsonify({'error': 'Credenciais inválidas'}), 401

@app.route('/api/logout', methods=['POST'])
def logout(): session.clear(); return jsonify({'ok': True})

@app.route('/api/pacientes', methods=['GET', 'POST'])
@login_required
def handle_pacientes():
    if request.method == 'POST':
        d = request.json
        setor = d.get('setor_id') if session.get('nivel_acesso') == 'admin' else session.get('setor_id')
        execute_db("INSERT INTO Pacientes (nome, idade, leito, prontuario, fone, setor_id_atual) VALUES (?,?,?,?,?,?)",
                   (d['nome'], d.get('idade'), d.get('leito'), d.get('prontuario'), d.get('fone'), setor))
        return jsonify({'ok': True})
    
    # GET: Se for estagiário, vê só o setor. Admin/Espectador veem tudo (para a lista global)
    if session.get('nivel_acesso') == 'estagiario':
        pacs = query_db("SELECT p.*, s.nome as setor_nome FROM Pacientes p LEFT JOIN Setores s ON p.setor_id_atual = s.id WHERE p.setor_id_atual=? AND p.status='ativo' ORDER BY p.leito", (session.get('setor_id'),))
    else:
        pacs = query_db("SELECT p.*, s.nome as setor_nome FROM Pacientes p LEFT JOIN Setores s ON p.setor_id_atual = s.id WHERE p.status='ativo' ORDER BY s.nome, p.leito")
    
    for p in pacs:
        p['procedimentos_ativos'] = query_db("SELECT * FROM Procedimentos WHERE paciente_id=? AND status='ativo'", (p['id'],))
        p['infeccoes'] = query_db("SELECT * FROM Infeccoes_Notificadas WHERE paciente_id=?", (p['id'],))
    return jsonify(pacs)

@app.route('/api/pacientes/<int:pid>/alta', methods=['POST'])
@login_required
def dar_alta(pid):
    execute_db("UPDATE Pacientes SET status='alta', motivo_saida=? WHERE id=?", (request.json.get('motivo'), pid))
    return jsonify({'ok': True})

@app.route('/api/procedimentos', methods=['POST'])
@login_required
def toggle_proc():
    d = request.json
    if d.get('acao') == 'inserir':
        execute_db("INSERT INTO Procedimentos (paciente_id, tipo_procedimento, data_insercao) VALUES (?,?,?)", (d['paciente_id'], d['tipo_procedimento'], d['data']))
    else:
        execute_db("UPDATE Procedimentos SET status='removido', data_remocao=? WHERE paciente_id=? AND tipo_procedimento=? AND status='ativo'", (d['data'], d['paciente_id'], d['tipo_procedimento']))
    return jsonify({'ok': True})

@app.route('/api/infeccoes', methods=['POST'])
@login_required
def notificar_infeccao():
    d = request.json
    execute_db("INSERT INTO Infeccoes_Notificadas (paciente_id, tipo_infeccao, data_notificacao) VALUES (?,?,?)", (d['paciente_id'], d['tipo_infeccao'], d['data']))
    return jsonify({'ok': True})

@app.route('/api/dashboard/relatorios', methods=['GET'])
@login_required
def relatorios():
    # Coleta de contagens brutas para as fórmulas
    tot_altas = query_db("SELECT COUNT(*) as c FROM Pacientes WHERE status='alta'")[0]['c']
    tot_infec = query_db("SELECT COUNT(*) as c FROM Infeccoes_Notificadas")[0]['c']
    
    inf_uri = query_db("SELECT COUNT(*) as c FROM Infeccoes_Notificadas WHERE tipo_infeccao='Trato Urinário'")[0]['c']
    inf_sepse = query_db("SELECT COUNT(*) as c FROM Infeccoes_Notificadas WHERE tipo_infeccao='Sepse'")[0]['c']
    inf_pneu = query_db("SELECT COUNT(*) as c FROM Infeccoes_Notificadas WHERE tipo_infeccao='Pneumonia'")[0]['c']
    inf_ciru = query_db("SELECT COUNT(*) as c FROM Infeccoes_Notificadas WHERE tipo_infeccao='Ferida Operatória'")[0]['c']

    # Fórmulas complexas (Cruzamentos)
    # Pacientes únicos com Sepse E Cateter Venoso Central
    sepse_cateter = query_db("""
        SELECT COUNT(DISTINCT p.id) as c FROM Pacientes p 
        JOIN Infeccoes_Notificadas i ON p.id = i.paciente_id 
        JOIN Procedimentos pr ON p.id = pr.paciente_id 
        WHERE i.tipo_infeccao='Sepse' AND pr.tipo_procedimento LIKE '%cateter venoso central%'
    """)[0]['c']
    tot_cateter = query_db("SELECT COUNT(DISTINCT paciente_id) as c FROM Procedimentos WHERE tipo_procedimento LIKE '%cateter venoso central%'")[0]['c']

    # Pacientes com Pneumonia E Respirador/Entubação
    pneu_resp = query_db("""
        SELECT COUNT(DISTINCT p.id) as c FROM Pacientes p 
        JOIN Infeccoes_Notificadas i ON p.id = i.paciente_id 
        JOIN Procedimentos pr ON p.id = pr.paciente_id 
        WHERE i.tipo_infeccao='Pneumonia' AND (pr.tipo_procedimento='respiração artificial' OR pr.tipo_procedimento='entubação')
    """)[0]['c']
    tot_resp = query_db("SELECT COUNT(DISTINCT paciente_id) as c FROM Procedimentos WHERE tipo_procedimento IN ('respiração artificial', 'entubação')")[0]['c']

    # Pacientes com Trato Urinário E Sonda Vesical
    uri_sonda = query_db("""
        SELECT COUNT(DISTINCT p.id) as c FROM Pacientes p 
        JOIN Infeccoes_Notificadas i ON p.id = i.paciente_id 
        JOIN Procedimentos pr ON p.id = pr.paciente_id 
        WHERE i.tipo_infeccao='Trato Urinário' AND pr.tipo_procedimento='sonda vesical'
    """)[0]['c']
    tot_sonda = query_db("SELECT COUNT(DISTINCT paciente_id) as c FROM Procedimentos WHERE tipo_procedimento='sonda vesical'")[0]['c']

    # Proteção contra divisão por zero e cálculo (* 100)
    calc = lambda num, den: round((num / den) * 100, 2) if den > 0 else 0

    return jsonify({
        'taxa_geral': round(tot_infec / tot_altas, 4) if tot_altas > 0 else 0, # Geral não é x100 na regra padrão, apenas a razão
        'taxa_urinario': calc(inf_uri, tot_infec),
        'taxa_sepse': calc(inf_sepse, tot_infec),
        'taxa_pneumonia': calc(inf_pneu, tot_infec),
        'taxa_cirurgica': calc(inf_ciru, tot_infec),
        'taxa_septicemia_cateter': calc(sepse_cateter, tot_cateter),
        'taxa_ih_respiradores': calc(pneu_resp, tot_resp),
        'taxa_sonda_vesical': calc(uri_sonda, tot_sonda)
    })

@app.route('/api/auxiliares', methods=['GET'])
@login_required
def get_auxiliares():
    return jsonify({
        'setores': query_db("SELECT * FROM Setores"),
        'usuarios': query_db("SELECT u.nome, u.nivel_acesso, s.nome as setor_nome FROM Usuarios u LEFT JOIN Setores s ON u.setor_id=s.id"),
        'procedimentos': PROCEDIMENTOS_LISTA
    })

@app.route('/api/setores', methods=['POST'])
@login_required
def add_setor():
    if session.get('nivel_acesso') != 'admin': return jsonify({'error': 'Acesso negado'}), 403
    execute_db("INSERT INTO Setores (nome) VALUES (?)", (request.json['nome'],))
    return jsonify({'ok': True})

@app.route('/api/usuarios', methods=['POST'])
@login_required
def add_user():
    if session.get('nivel_acesso') != 'admin': return jsonify({'error': 'Acesso negado'}), 403
    d = request.json
    execute_db("INSERT INTO Usuarios (nome, email, senha, nivel_acesso, setor_id) VALUES (?,?,?,?,?)",
               (d['nome'], d['email'], generate_password_hash(d['senha']), d['nivel_acesso'], d.get('setor_id')))
    return jsonify({'ok': True})

try:
    init_db()
    print("✓ DB Ready")
except Exception as e:
    print(f"Erro DB: {e}")

if __name__ == '__main__':
    app.run(debug=True, port=5000)
