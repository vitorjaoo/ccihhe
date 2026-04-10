import os
import hashlib
from datetime import datetime, date, timedelta
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
from contextlib import asynccontextmanager
import libsql_client
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# CONFIGURAÇÃO DE BANCO (TURSO)
# ---------------------------------------------------------------------------
TURSO_URL = os.environ.get('TURSO_DATABASE_URL', 'https://ccih-vitorrastrep.aws-us-east-2.turso.io')
# Lembre-se: O token precisa estar no Render (Environment Variables) ou colado aqui!
TURSO_TOKEN = os.environ.get('TURSO_AUTH_TOKEN', '') 

def hash_password(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()

def rows_to_dict(rs):
    if not rs: return []
    return [dict(zip(rs.columns, row)) for row in rs.rows]

def row_to_dict(rs):
    if not rs or not rs.rows: return None
    return dict(zip(rs.columns, rs.rows[0]))

# ---------------------------------------------------------------------------
# INICIALIZAÇÃO DO BANCO (CONEXÃO GLOBAL - Fim do Erro 502)
# ---------------------------------------------------------------------------
db_client = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_client
    print(f"[CCIH] Conectando ao banco Turso (Conexão Global)...")
    
    # Abre a conexão UMA ÚNICA VEZ para o sistema todo
    db_client = libsql_client.create_client(url=TURSO_URL, auth_token=TURSO_TOKEN)
    
    await db_client.batch([
        "CREATE TABLE IF NOT EXISTS setores ( id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL UNIQUE )",
        "CREATE TABLE IF NOT EXISTS usuarios ( id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, email TEXT NOT NULL UNIQUE, senha TEXT NOT NULL, nivel_acesso TEXT NOT NULL CHECK(nivel_acesso IN ('admin','estagiario','espectador')), setor_id INTEGER REFERENCES setores(id) )",
        "CREATE TABLE IF NOT EXISTS motivos_saida ( id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL UNIQUE )",
        "CREATE TABLE IF NOT EXISTS pacientes ( id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, idade INTEGER, leito TEXT, prontuario TEXT, fone TEXT, diagnostico TEXT, setor_id_atual INTEGER REFERENCES setores(id), status TEXT NOT NULL DEFAULT 'internado' CHECK(status IN ('internado','alta','transito')), motivo_saida_id INTEGER REFERENCES motivos_saida(id), data_internacao TEXT DEFAULT (date('now')), setor_destino_id INTEGER REFERENCES setores(id), ultima_atualizacao TEXT )",
        "CREATE TABLE IF NOT EXISTS registros_diarios ( id INTEGER PRIMARY KEY AUTOINCREMENT, paciente_id INTEGER NOT NULL REFERENCES pacientes(id), data TEXT NOT NULL DEFAULT (date('now')), temperatura REAL )",
        "CREATE TABLE IF NOT EXISTS procedimentos ( id INTEGER PRIMARY KEY AUTOINCREMENT, paciente_id INTEGER NOT NULL REFERENCES pacientes(id), tipo_procedimento TEXT NOT NULL, data_insercao TEXT NOT NULL, data_remocao TEXT, status TEXT NOT NULL DEFAULT 'ativo' CHECK(status IN ('ativo','removido')) )",
        """CREATE TABLE IF NOT EXISTS infeccoes_notificadas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
            tipo_infeccao TEXT NOT NULL,
            data_notificacao TEXT NOT NULL DEFAULT (date('now')),
            data_cura TEXT,
            status TEXT NOT NULL DEFAULT 'ativa' CHECK(status IN ('ativa','curada'))
        )"""
    ])

    try:
        await db_client.execute("ALTER TABLE infeccoes_notificadas ADD COLUMN data_cura TEXT")
        await db_client.execute("ALTER TABLE infeccoes_notificadas ADD COLUMN status TEXT NOT NULL DEFAULT 'ativa'")
    except Exception:
        pass

    motivos = ['Alta Médica', 'Óbito', 'Transferência para outro hospital', 'Transferência para setor não rastreável']
    for m in motivos:
        await db_client.execute("INSERT OR IGNORE INTO motivos_saida(nome) VALUES(?)", [m])

    rs_setores = await db_client.execute("SELECT COUNT(*) as total FROM setores")
    if int(row_to_dict(rs_setores)['total']) == 0:
        await db_client.batch([
            "INSERT OR IGNORE INTO setores(nome) VALUES('UTI Geral')",
            "INSERT OR IGNORE INTO setores(nome) VALUES('Clínica Cirúrgica')",
            "INSERT OR IGNORE INTO setores(nome) VALUES('Clínica Médica')"
        ])

    rs_admin = await db_client.execute("SELECT * FROM usuarios WHERE email='admin@ccih.com'")
    if not row_to_dict(rs_admin):
        await db_client.execute(
            "INSERT INTO usuarios(nome, email, senha, nivel_acesso, setor_id) VALUES('Administrador', 'admin@ccih.com', ?, 'admin', NULL)",
            [hash_password('admin123')]
        )
    print("[CCIH] Banco Inicializado com Sucesso.")
    
    yield
    
    # Fecha a conexão quando o servidor desligar
    await db_client.close()

# ---------------------------------------------------------------------------
# APP FASTAPI E MIDDLEWARES
# ---------------------------------------------------------------------------
app = FastAPI(title="CCIH API", lifespan=lifespan)

app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SessionMiddleware, secret_key=os.environ.get('SECRET_KEY', 'ccih_secret_2024_xK9mP'))

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# ---------------------------------------------------------------------------
# DEPENDÊNCIAS
# ---------------------------------------------------------------------------
async def get_db():
    yield db_client

async def require_auth(request: Request):
    if "user_id" not in request.session:
        raise HTTPException(status_code=401, detail="Não autenticado")
    return request.session

async def require_not_readonly(session: dict = Depends(require_auth)):
    if session.get('nivel_acesso') == 'espectador':
        raise HTTPException(status_code=403, detail="Acesso somente leitura")
    return session

async def update_paciente_historico(db, request: Request, paciente_id: int):
    try:
        nome = request.session.get('nome', 'Usuário')
        agora = (datetime.utcnow() - timedelta(hours=3)).strftime("%d/%m %H:%M")
        log_str = f"Atualizado por {nome} • {agora}"
        await db.execute("UPDATE pacientes SET ultima_atualizacao=? WHERE id=?", [log_str, paciente_id])
    except Exception as e:
        print("[DB] Erro histórico:", e)

# ---------------------------------------------------------------------------
# ROTAS BASE E PWA 
# ---------------------------------------------------------------------------
@app.get('/', response_class=HTMLResponse)
@app.head('/', response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")

@app.get("/manifest.json")
async def serve_manifest():
    return FileResponse("static/manifest.json")

@app.get("/sw.js")
async def serve_sw():
    return FileResponse("static/sw.js")

# ---------------------------------------------------------------------------
# ROTAS DE AUTH
# ---------------------------------------------------------------------------
@app.post('/api/auth/login')
async def login(request: Request, db = Depends(get_db)):
    data = await request.json()
    email = data.get('email', '').strip().lower()
    senha = data.get('senha', '')

    if not email or not senha:
        return JSONResponse(status_code=400, content={'error': 'Campos obrigatórios'})

    rs = await db.execute("SELECT * FROM usuarios WHERE email=?", [email])
    user = row_to_dict(rs)

    if not user or user['senha'] != hash_password(senha):
        return JSONResponse(status_code=401, content={'error': 'Credenciais inválidas'})

    request.session['user_id'] = user['id']
    request.session['nivel_acesso'] = user['nivel_acesso']
    request.session['setor_id'] = user['setor_id']
    request.session['nome'] = user['nome']

    return {'id': user['id'], 'nome': user['nome'], 'nivel_acesso': user['nivel_acesso'], 'setor_id': user['setor_id']}

@app.post('/api/auth/logout')
async def logout(request: Request):
    request.session.clear()
    return {'ok': True}

@app.get('/api/auth/me')
async def me(session: dict = Depends(require_auth)):
    return {'id': session['user_id'], 'nome': session['nome'], 'nivel_acesso': session['nivel_acesso'], 'setor_id': session['setor_id']}

@app.put('/api/auth/senha')
async def change_password(request: Request, session: dict = Depends(require_auth), db = Depends(get_db)):
    data = await request.json()
    senha_atual = data.get('senha_atual', '')
    nova_senha = data.get('nova_senha', '')

    rs = await db.execute("SELECT senha FROM usuarios WHERE id=?", [session['user_id']])
    user = row_to_dict(rs)

    if hash_password(senha_atual) != user['senha']:
        return JSONResponse(status_code=401, content={'error': 'A senha atual está incorreta'})
    if len(nova_senha) < 6:
        return JSONResponse(status_code=400, content={'error': 'A nova senha deve ter no mínimo 6 caracteres'})

    await db.execute("UPDATE usuarios SET senha=? WHERE id=?", [hash_password(nova_senha), session['user_id']])
    return {'ok': True}

# ---------------------------------------------------------------------------
# ROTAS DA API: SETORES E USUÁRIOS
# ---------------------------------------------------------------------------
@app.get('/api/setores')
async def get_setores(session: dict = Depends(require_auth), db = Depends(get_db)):
    rs = await db.execute("SELECT * FROM setores ORDER BY nome")
    return rows_to_dict(rs)

@app.post('/api/setores')
async def create_setor(request: Request, session: dict = Depends(require_not_readonly), db = Depends(get_db)):
    if session['nivel_acesso'] != 'admin':
        return JSONResponse(status_code=403, content={'error': 'Apenas admin'})
    data = await request.json()
    nome = data.get('nome', '').strip()
    if not nome:
        return JSONResponse(status_code=400, content={'error': 'Nome obrigatório'})
    try:
        await db.execute("INSERT INTO setores(nome) VALUES(?)", [nome])
        rs = await db.execute("SELECT * FROM setores WHERE nome=?", [nome])
        return JSONResponse(status_code=201, content=row_to_dict(rs))
    except Exception:
        return JSONResponse(status_code=409, content={'error': 'Setor já existe'})

@app.delete('/api/setores/{sid}')
async def delete_setor(sid: int, session: dict = Depends(require_not_readonly), db = Depends(get_db)):
    if session['nivel_acesso'] != 'admin':
        return JSONResponse(status_code=403, content={'error': 'Apenas admin'})
    await db.execute("DELETE FROM setores WHERE id=?", [sid])
    return {'ok': True}

@app.get('/api/usuarios')
async def get_usuarios(session: dict = Depends(require_auth), db = Depends(get_db)):
    if session['nivel_acesso'] not in ('admin', 'espectador'):
        return JSONResponse(status_code=403, content={'error': 'Sem permissão'})
    rs = await db.execute("SELECT u.id, u.nome, u.email, u.nivel_acesso, u.setor_id, s.nome as setor_nome FROM usuarios u LEFT JOIN setores s ON s.id=u.setor_id ORDER BY u.nome")
    return rows_to_dict(rs)

@app.post('/api/usuarios')
async def create_usuario(request: Request, session: dict = Depends(require_not_readonly), db = Depends(get_db)):
    if session['nivel_acesso'] != 'admin':
        return JSONResponse(status_code=403, content={'error': 'Apenas admin'})
    data = await request.json()
    nome = data.get('nome', '').strip()
    email = data.get('email', '').strip().lower()
    senha = data.get('senha', '').strip()
    nivel = data.get('nivel_acesso', '')
    setor_id = data.get('setor_id') or None

    try:
        await db.execute("INSERT INTO usuarios(nome,email,senha,nivel_acesso,setor_id) VALUES(?,?,?,?,?)", [nome, email, hash_password(senha), nivel, setor_id])
        rs = await db.execute("SELECT id,nome,email,nivel_acesso,setor_id FROM usuarios WHERE email=?", [email])
        return JSONResponse(status_code=201, content=row_to_dict(rs))
    except Exception:
        return JSONResponse(status_code=409, content={'error': 'Email já cadastrado'})

@app.delete('/api/usuarios/{uid}')
async def delete_usuario(uid: int, session: dict = Depends(require_not_readonly), db = Depends(get_db)):
    if session['nivel_acesso'] != 'admin':
        return JSONResponse(status_code=403, content={'error': 'Apenas admin'})
    await db.execute("DELETE FROM usuarios WHERE id=?", [uid])
    return {'ok': True}

# ---------------------------------------------------------------------------
# ROTAS DA API: PACIENTES E MOTIVOS
# ---------------------------------------------------------------------------
@app.get('/api/motivos_saida')
async def get_motivos(session: dict = Depends(require_auth), db = Depends(get_db)):
    rs = await db.execute("SELECT * FROM motivos_saida ORDER BY nome")
    return rows_to_dict(rs)

@app.get('/api/pacientes')
async def get_pacientes(session: dict = Depends(require_auth), db = Depends(get_db)):
    nivel = session['nivel_acesso']
    setor_id = session['setor_id']

    if nivel == 'estagiario' and setor_id:
        rs = await db.execute("SELECT p.*, s.nome as setor_nome, sd.nome as setor_destino_nome FROM pacientes p LEFT JOIN setores s ON s.id = p.setor_id_atual LEFT JOIN setores sd ON sd.id = p.setor_destino_id WHERE p.setor_id_atual=? AND (p.status='internado' OR p.status='transito') ORDER BY p.nome", [setor_id])
    else:
        rs = await db.execute("SELECT p.*, s.nome as setor_nome, sd.nome as setor_destino_nome FROM pacientes p LEFT JOIN setores s ON s.id = p.setor_id_atual LEFT JOIN setores sd ON sd.id = p.setor_destino_id WHERE (p.status='internado' OR p.status='transito') ORDER BY s.nome, p.nome")

    rows = rows_to_dict(rs)
    paciente_ids = [str(p['id']) for p in rows]

    if paciente_ids:
        ids_str = ",".join(paciente_ids)
        procs_rs = await db.execute(f"SELECT * FROM procedimentos WHERE status='ativo' AND paciente_id IN ({ids_str})")
        infs_rs = await db.execute(f"SELECT * FROM infeccoes_notificadas WHERE status='ativa' AND paciente_id IN ({ids_str})")

        procs = rows_to_dict(procs_rs)
        infs = rows_to_dict(infs_rs)

        proc_dict = {pid: [] for pid in paciente_ids}
        for pr in procs: proc_dict[str(pr['paciente_id'])].append(pr)

        inf_dict = {pid: [] for pid in paciente_ids}
        for i in infs: inf_dict[str(i['paciente_id'])].append(i)

        for p in rows:
            p['procedimentos'] = proc_dict[str(p['id'])]
            p['infeccoes'] = inf_dict[str(p['id'])]
    else:
        for p in rows:
            p['procedimentos'] = []
            p['infeccoes'] = []

    return rows

@app.post('/api/pacientes')
async def create_paciente(request: Request, session: dict = Depends(require_not_readonly), db = Depends(get_db)):
    data = await request.json()
    nome = data.get('nome', '').strip()
    prontuario = data.get('prontuario', '').strip()
    
    setor_id = data.get('setor_id') or None
    idade = data.get('idade') or None
    diagnostico = data.get('diagnostico', '').strip()
    data_internacao = data.get('data_internacao') or date.today().isoformat()

    if session.get('nivel_acesso') == 'estagiario':
        setor_id = session.get('setor_id')

    rs_insert = await db.execute(
        "INSERT INTO pacientes(nome, idade, leito, prontuario, fone, diagnostico, setor_id_atual, status, data_internacao) VALUES(?,?,?,?,?,?,?,'internado',?)",
        [nome, idade, data.get('leito', '').strip(), prontuario, data.get('fone', '').strip(), diagnostico, setor_id, data_internacao]
    )
    await update_paciente_historico(db, request, rs_insert.last_insert_rowid)

    rs_pac = await db.execute("SELECT p.*, s.nome as setor_nome FROM pacientes p LEFT JOIN setores s ON s.id=p.setor_id_atual WHERE p.id=?", [rs_insert.last_insert_rowid])
    return JSONResponse(status_code=201, content=row_to_dict(rs_pac))

@app.get('/api/pacientes/{pid}')
async def get_paciente(pid: int, session: dict = Depends(require_auth), db = Depends(get_db)):
    rs_pac = await db.execute("SELECT p.*, s.nome as setor_nome, sd.nome as setor_destino_nome FROM pacientes p LEFT JOIN setores s ON s.id=p.setor_id_atual LEFT JOIN setores sd ON sd.id=p.setor_destino_id WHERE p.id=?", [pid])
    pac = row_to_dict(rs_pac)
    if not pac:
        return JSONResponse(status_code=404, content={'error': 'Não encontrado'})

    rs_reg = await db.execute("SELECT * FROM registros_diarios WHERE paciente_id=? ORDER BY data DESC", [pid])
    rs_proc = await db.execute("SELECT * FROM procedimentos WHERE paciente_id=? ORDER BY data_insercao DESC", [pid])
    rs_inf = await db.execute("SELECT * FROM infeccoes_notificadas WHERE paciente_id=? ORDER BY CASE WHEN status='ativa' THEN 0 ELSE 1 END, data_notificacao DESC", [pid])

    pac['registros'] = rows_to_dict(rs_reg)
    pac['procedimentos'] = rows_to_dict(rs_proc)
    pac['infeccoes'] = rows_to_dict(rs_inf)

    return pac

@app.put('/api/pacientes/{pid}')
async def update_paciente(pid: int, request: Request, session: dict = Depends(require_not_readonly), db = Depends(get_db)):
    data = await request.json()
    rs_pac = await db.execute("SELECT * FROM pacientes WHERE id=?", [pid])
    pac = row_to_dict(rs_pac)
    
    nome = data.get('nome', pac['nome']).strip()
    idade = data.get('idade', pac['idade'])
    leito = data.get('leito', pac['leito'] or '').strip()
    prontuario = data.get('prontuario', pac['prontuario'] or '').strip()
    diagnostico = data.get('diagnostico', pac['diagnostico'] or '').strip()
    setor_id = data.get('setor_id', pac['setor_id_atual'])
    data_internacao = data.get('data_internacao', pac['data_internacao'] or '')

    await db.execute(
        "UPDATE pacientes SET nome=?, idade=?, leito=?, prontuario=?, diagnostico=?, setor_id_atual=?, data_internacao=? WHERE id=?",
        [nome, idade or None, leito, prontuario, diagnostico, setor_id or None, data_internacao, pid]
    )
    await update_paciente_historico(db, request, pid)

    updated = await db.execute("SELECT p.*, s.nome as setor_nome FROM pacientes p LEFT JOIN setores s ON s.id=p.setor_id_atual WHERE p.id=?", [pid])
    return row_to_dict(updated)

@app.delete('/api/pacientes/{pid}')
async def delete_paciente(pid: int, session: dict = Depends(require_not_readonly), db = Depends(get_db)):
    await db.batch([
        f"DELETE FROM infeccoes_notificadas WHERE paciente_id={pid}",
        f"DELETE FROM procedimentos WHERE paciente_id={pid}",
        f"DELETE FROM registros_diarios WHERE paciente_id={pid}",
        f"DELETE FROM pacientes WHERE id={pid}"
    ])
    return {'ok': True}

@app.post('/api/pacientes/{pid}/alta')
async def dar_alta(pid: int, request: Request, session: dict = Depends(require_not_readonly), db = Depends(get_db)):
    data = await request.json()
    motivo_id = data.get('motivo_saida_id')
    if not motivo_id: return JSONResponse(status_code=400, content={'error': 'Motivo obrigatório'})

    await db.batch([
        f"UPDATE pacientes SET status='alta', motivo_saida_id={motivo_id} WHERE id={pid}",
        f"UPDATE procedimentos SET status='removido', data_remocao=date('now') WHERE paciente_id={pid} AND status='ativo'"
    ])
    return {'ok': True}

# --- ROTAS FALTANTES ADICIONADAS AQUI (FIM DO ERRO 404) ---
@app.get('/api/pacientes/{pid}/registros')
async def get_registros(pid: int, session: dict = Depends(require_auth), db = Depends(get_db)):
    rs = await db.execute("SELECT * FROM registros_diarios WHERE paciente_id=? ORDER BY data DESC", [pid])
    return rows_to_dict(rs)

@app.get('/api/pacientes/{pid}/procedimentos')
async def get_procedimentos(pid: int, session: dict = Depends(require_auth), db = Depends(get_db)):
    rs = await db.execute("SELECT * FROM procedimentos WHERE paciente_id=? ORDER BY data_insercao DESC", [pid])
    return rows_to_dict(rs)

@app.get('/api/pacientes/{pid}/infeccoes')
async def get_infeccoes(pid: int, session: dict = Depends(require_auth), db = Depends(get_db)):
    rs = await db.execute("SELECT * FROM infeccoes_notificadas WHERE paciente_id=? ORDER BY data_notificacao DESC", [pid])
    return rows_to_dict(rs)
# ----------------------------------------------------------

@app.post('/api/pacientes/{pid}/solicitar_transferencia')
async def solicitar_transf(pid: int, request: Request, session: dict = Depends(require_not_readonly), db = Depends(get_db)):
    data = await request.json()
    await db.execute("UPDATE pacientes SET status='transito', setor_destino_id=? WHERE id=?", [data['setor_destino_id'], pid])
    return {'ok': True}

@app.post('/api/pacientes/{pid}/confirmar_transferencia')
async def confirmar_transf(pid: int, session: dict = Depends(require_not_readonly), db = Depends(get_db)):
    rs = await db.execute("SELECT setor_destino_id FROM pacientes WHERE id=?", [pid])
    destino = row_to_dict(rs)['setor_destino_id']
    await db.execute("UPDATE pacientes SET status='internado', setor_id_atual=?, setor_destino_id=NULL WHERE id=?", [destino, pid])
    return {'ok': True}

@app.post('/api/procedimentos')
async def add_proc(request: Request, session: dict = Depends(require_not_readonly), db = Depends(get_db)):
    data = await request.json()
    await db.execute("INSERT INTO procedimentos(paciente_id, tipo_procedimento, data_insercao) VALUES(?,?,?)", [data['paciente_id'], data['tipo_procedimento'], data['data_insercao']])
    return {'ok': True}

@app.put('/api/procedimentos/{pid}/remover')
async def rem_proc(pid: int, request: Request, session: dict = Depends(require_not_readonly), db = Depends(get_db)):
    data = await request.json()
    await db.execute("UPDATE procedimentos SET status='removido', data_remocao=? WHERE id=?", [data['data_remocao'], pid])
    return {'ok': True}

@app.post('/api/infeccoes')
async def add_inf(request: Request, session: dict = Depends(require_not_readonly), db = Depends(get_db)):
    data = await request.json()
    await db.execute("INSERT INTO infeccoes_notificadas(paciente_id, tipo_infeccao, data_notificacao, status) VALUES(?,?,?, 'ativa')", [data['paciente_id'], data['tipo_infeccao'], data['data_notificacao']])
    return {'ok': True}

@app.post('/api/infeccoes/{iid}/curar')
async def curar_inf(iid: int, request: Request, session: dict = Depends(require_not_readonly), db = Depends(get_db)):
    data = await request.json()
    await db.execute("UPDATE infeccoes_notificadas SET status='curada', data_cura=? WHERE id=?", [data['data_cura'], iid])
    return {'ok': True}

@app.get('/api/transferencias_pendentes')
async def get_transferencias(session: dict = Depends(require_auth), db = Depends(get_db)):
    rs = await db.execute("SELECT p.*, s.nome as setor_nome, sd.nome as setor_destino_nome FROM pacientes p LEFT JOIN setores s ON s.id=p.setor_id_atual LEFT JOIN setores sd ON sd.id=p.setor_destino_id WHERE p.status='transito' ORDER BY p.nome")
    return rows_to_dict(rs)


# ---------------------------------------------------------------------------
# ROTAS DA API: DASHBOARD E RELATÓRIOS
# ---------------------------------------------------------------------------
@app.get('/api/dashboard/relatorios')
async def relatorios(request: Request, session: dict = Depends(require_auth), db = Depends(get_db)):
    try:
        mes = request.query_params.get('mes') or date.today().strftime('%Y-%m')
        ano_mes = mes[:7]
        nivel = session['nivel_acesso']

        filtro_setor = session.get('setor_id') if nivel == 'estagiario' else None
        wp = " AND p.setor_id_atual = ?" if filtro_setor else ""
        params = [filtro_setor] if filtro_setor else []

        def extrair_total(rs_dict):
            if rs_dict and 'total' in rs_dict and rs_dict['total'] is not None:
                return int(rs_dict['total'])
            return 0

        pac_alta_row = await db.execute(f"SELECT COUNT(DISTINCT p.id) as total FROM pacientes p LEFT JOIN motivos_saida ms ON p.motivo_saida_id = ms.id WHERE p.status='alta' AND (ms.nome IS NULL OR ms.nome != 'Transferência para setor não rastreável') {wp}", params)
        pacientes_alta = extrair_total(row_to_dict(pac_alta_row))

        inf_ativa = """(
            strftime('%Y-%m', i.data_notificacao) = ?
            OR (
                strftime('%Y-%m', i.data_notificacao) < ?
                AND (i.data_cura IS NULL OR strftime('%Y-%m', i.data_cura) >= ?)
            )
        )"""

        inf_mes_row = await db.execute(f"SELECT COUNT(i.id) as total FROM infeccoes_notificadas i JOIN pacientes p ON p.id = i.paciente_id WHERE {inf_ativa} {wp}", [ano_mes, ano_mes, ano_mes] + params)
        total_inf = extrair_total(row_to_dict(inf_mes_row))

        por_tipo = rows_to_dict(await db.execute(f"SELECT i.tipo_infeccao, COUNT(i.id) as total FROM infeccoes_notificadas i JOIN pacientes p ON p.id = i.paciente_id WHERE {inf_ativa} {wp} GROUP BY i.tipo_infeccao", [ano_mes, ano_mes, ano_mes] + params))

        def get_inf(tipo):
            for item in por_tipo:
                if item['tipo_infeccao'] == tipo: return int(item['total'])
            return 0

        taxa_geral = round((total_inf / pacientes_alta * 100) if pacientes_alta > 0 else 0, 2)
        def taxa_prop(n): return round((n / total_inf * 100) if total_inf > 0 else 0, 2)

        cateteres = ('cateter venoso central punção', 'cateter venoso central dessecação', 'cateter swan ganz')
        tot_cat = await db.execute(f"SELECT COUNT(DISTINCT pr.paciente_id) as total FROM procedimentos pr JOIN pacientes p ON p.id = pr.paciente_id WHERE lower(pr.tipo_procedimento) IN (?, ?, ?) {wp}", list(cateteres) + params)
        tot_cateter = extrair_total(row_to_dict(tot_cat))

        sepse_cat = await db.execute(f"SELECT COUNT(DISTINCT i.paciente_id) as total FROM infeccoes_notificadas i JOIN procedimentos pr ON i.paciente_id = pr.paciente_id JOIN pacientes p ON p.id = i.paciente_id WHERE i.tipo_infeccao = 'Sepse' AND lower(pr.tipo_procedimento) IN (?, ?, ?) AND {inf_ativa} {wp}", list(cateteres) + [ano_mes, ano_mes, ano_mes] + params)
        taxa_cateter = round((extrair_total(row_to_dict(sepse_cat)) / tot_cateter * 100) if tot_cateter > 0 else 0, 2)

        resps = ('respiração artificial', 'entubação')
        tot_resp = await db.execute(f"SELECT COUNT(DISTINCT pr.paciente_id) as total FROM procedimentos pr JOIN pacientes p ON p.id = pr.paciente_id WHERE lower(pr.tipo_procedimento) IN (?, ?) {wp}", list(resps) + params)
        tot_resp_int = extrair_total(row_to_dict(tot_resp))

        pneu_resp = await db.execute(f"SELECT COUNT(DISTINCT i.paciente_id) as total FROM infeccoes_notificadas i JOIN procedimentos pr ON i.paciente_id = pr.paciente_id JOIN pacientes p ON p.id = i.paciente_id WHERE i.tipo_infeccao = 'Pneumonia' AND lower(pr.tipo_procedimento) IN (?, ?) AND {inf_ativa} {wp}", list(resps) + [ano_mes, ano_mes, ano_mes] + params)
        taxa_respirador = round((extrair_total(row_to_dict(pneu_resp)) / tot_resp_int * 100) if tot_resp_int > 0 else 0, 2)

        tot_sonda = await db.execute(f"SELECT COUNT(DISTINCT pr.paciente_id) as total FROM procedimentos pr JOIN pacientes p ON p.id = pr.paciente_id WHERE lower(pr.tipo_procedimento) = 'sonda vesical' {wp}", params)
        tot_sonda_int = extrair_total(row_to_dict(tot_sonda))

        uri_sonda = await db.execute(f"SELECT COUNT(DISTINCT i.paciente_id) as total FROM infeccoes_notificadas i JOIN procedimentos pr ON i.paciente_id = pr.paciente_id JOIN pacientes p ON p.id = i.paciente_id WHERE i.tipo_infeccao = 'Trato Urinário' AND lower(pr.tipo_procedimento) = 'sonda vesical' AND {inf_ativa} {wp}", [ano_mes, ano_mes, ano_mes] + params)
        taxa_sonda = round((extrair_total(row_to_dict(uri_sonda)) / tot_sonda_int * 100) if tot_sonda_int > 0 else 0, 2)

        por_setor = rows_to_dict(await db.execute(f"SELECT s.nome as setor, COUNT(p.id) as total FROM pacientes p JOIN setores s ON s.id=p.setor_id_atual WHERE (p.status='internado' OR p.status='transito') {wp} GROUP BY s.id ORDER BY s.nome", params))
        ultimas_inf = rows_to_dict(await db.execute(f"SELECT i.*, p.nome as paciente_nome, s.nome as setor_nome FROM infeccoes_notificadas i JOIN pacientes p ON p.id=i.paciente_id LEFT JOIN setores s ON s.id=p.setor_id_atual WHERE {inf_ativa} {wp} ORDER BY i.id DESC LIMIT 10", [ano_mes, ano_mes, ano_mes] + params))

        return {
            'mes': ano_mes,
            'taxas': {
                'geral': taxa_geral, 'urinario': taxa_prop(get_inf('Trato Urinário')), 'sepse': taxa_prop(get_inf('Sepse')),
                'pneumonia': taxa_prop(get_inf('Pneumonia')), 'cirurgica': taxa_prop(get_inf('Ferida Operatória')),
                'cateter': taxa_cateter, 'respirador': taxa_respirador, 'sonda_vesical': taxa_sonda,
            },
            'totais': {
                'pacientes_alta': pacientes_alta, 'infeccoes_mes': total_inf, 'pacientes_internados': sum(int(s['total']) for s in por_setor),
            },
            'por_setor': por_setor,
            'por_tipo': por_tipo,
            'ultimas_infeccoes': ultimas_inf,
        }
    except Exception as e:
        print(f"[ERRO RELATÓRIO] Falha ao processar dashboard: {e}")
        return JSONResponse(status_code=500, content={"error": f"Erro interno ao gerar relatório: {str(e)}"})
