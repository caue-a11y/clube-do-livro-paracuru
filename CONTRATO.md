# Contratos de implementação

Arquitetura: site estático HTML/CSS/ES modules sem build no GitHub Pages; Supabase Edge Function clube-api para validação e autorização; PostgreSQL privado com RLS. Supabase Auth gerenciado para login administrativo por email/senha; token só em memória, sem persistir sessão no navegador. Nenhum segredo no frontend.

Pastas: backend somente supabase/ e tests/backend*. Frontend público somente index.html, src/public.js e src/styles.css. Painel somente admin.html e src/admin.js. Integrador escreve src/api.js, src/config.js, shared/analysis.js, testes de integração e docs. Não tocar em arquivos de outra frente.

Fonte do questionário: shared/questionario.json. Frontend lê por fetch relativo. IDs e opções preservados. answers é objeto: single_choice/string, multiple_choice/array de strings, textos/string, disponibilidade/{mode:'fixa'|'variavel',slots:[{day,period}]}, q14_contato/{channel:'instagram'|'whatsapp',value:string}. Complementos q05_generos_outro_texto e q11_barreiras_outro_texto são chaves irmãs em answers. Nunca persistir rascunho em localStorage. Q14 deve ser eliminado ao retirar contato, no cliente e servidor.

Config frontend src/config.js exporta API_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY. URLs reais serão preenchidas pelo integrador. src/api.js exporta api(path,{method='GET',body,token}={}), devolve JSON em sucesso e lança Error com status e fields opcionais. Escreve fetch seguro com headers apikey e Bearer quando token, nunca registra payload.

Edge URL base /functions/v1/clube-api. Rotas dentro da função:
GET /config -> {open:boolean,privacy:{responsible,channel,retention_days,notice_version},form_version:string}
POST /respostas body {answers,form_version,privacy_notice_version,idempotency_key,website:''} -> {protocol,received_at}; website é honeypot, nunca sucesso falso.
GET /admin/respostas?filters=JSON&page=1&page_size=50 -> {items,total,page,page_size}. Máx 100 por página. Cada item {id,protocol,received_at,answers (sem q14_contato),status,revision}. Filtros {search,from,to,localizacao:[],intencao:[],generos:[],modelo:[],frequencia:[],modalidades:[],slot:'sab:manha' ou 'variavel',autorizacao:[],status:[]}; E entre filtros OU dentro. Date from/to YYYY-MM-DD interpretado America/Sao_Paulo.
GET /admin/respostas/:id -> registro completo com answers q14, notes, history.
PATCH /admin/respostas/:id body {revision,status,notes,confirmed:boolean} -> registro atualizado. Confirmação status confirmado exige confirmed true. Todos exceto novo exigem contato autorizado. Conflito revision 409.
DELETE /admin/respostas/:id body {revision,confirm_protocol} -> {deleted:true}. Confere protocolo. Tombstone sem dados pessoais.
GET /admin/exportacao?filters=JSON -> CSV UTF8 BOM, conjunto completo não paginado; neutraliza fórmulas inclusive controles/espaços. CSV inclui q14 só autorizado, sem notas/histórico.
GET /admin/config -> configurações completas.
PATCH /admin/config body {open,responsible,channel,retention_days,revision} -> configuração atualizada. Abrir apenas com dados de privacidade completos. Nenhuma coleta aberta inicialmente.

Respostas de erro: {error:string,fields?:{id:mensagem}}, HTTP 400 validação, 401 sem token,403 sem allowlist,409 conflito,429 abuso,503 indisponível. Cache-Control no-store. CORS somente origin https://caue-a11y.github.io e http://localhost:4173 e http://127.0.0.1:4173. Usar checagem de origem para mutações origin obrigatório, permitir requests API sem Origin apenas em testes servidor/autenticados? Evitar segredo no navegador e não apresentar CORS como autenticação.

Banco: responses, admin_users (user_id UUID auth.users FK), settings (singleton), admin_history e deletion_log. Tudo RLS sem policies públicas; somente service_role na Edge. RPC transacional para envio com idempotência (replay retorna mesmo protocolo antes de checar coleta), payload_hash e trava para evitar corrida; transacional update revision/histórico e exclusão. Hash de payload deve ser canônico (ordem de chaves estável). Dados sintéticos apenas em testes transacionais com rollback, sem fixtures na base pública.

Login do painel usa Supabase Auth REST /auth/v1/token?grant_type=password, chave pública no header apikey; guardar apenas access_token em memória e renovar via /auth/v1/token?grant_type=refresh_token em memória quando necessário. Logout POST /auth/v1/logout, limpar DOM/cache/token. API verifica token em /auth/v1/user e allowlist no servidor a cada requisição. Não criar autenticação/criptografia própria. Primeiro usuário administrativo e email ainda serão definidos; explicar configuração em docs, nunca criar senha de demonstração pública.

shared/analysis.js será criado pelo integrador: exporta compatible(records,{day,period,modality,frequency,genre='',model=''}) -> {items,regular,contactable,variable}; distribution(records,questionId) -> {counts,answered,missing}. Registros contêm answers. Exportar mais helpers se necessário. Painel pode calcular análise e resumo sobre todas as páginas já filtradas, sem contato na lista; contato completo só no detalhe. Esse token em memória difere de cookie HttpOnly previsto no pacote; registrar decisão de usar fluxo oficial Supabase Auth para frontend estático.

Identidade: arte anexa fundo claro quente, verde sálvia, tipografia legível; estática sem animações; ilustração vetorial própria de livro/conversa, não imagem inteira como formulário. Texto funcional, português Brasil, não prometer evento marcado. Página pública fechada deve oferecer visualizar questionário sem enviar, deixando explícita coleta ainda não aberta. Erro de backend não pode virar sucesso.

Qualidade: responsivo 320/390/768/1440, foco e labels, resumo de erros navegável, perda de rascunho ao recarregar, revisão editável, confirmação só após backend. Não afirmar resultados não testados. Fornecedor humano de privacidade e email admin pendentes: código pode ficar pronto e publicado, coleta permanece encerrada até configuração real.

Integração final: POST também exige privacy_notice_version do GET config. A RPC clube_submit_with_notice verifica o aviso dentro da mesma transação e preserva replay anterior. Um HTTP 409 explícito destrava a tentativa na interface, preserva respostas e recarrega situação da coleta/aviso.
