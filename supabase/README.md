# Backend do Clube do Livro — operação e evidência

Backend implantado no projeto gratuito wmrrscohfibprfqrprzf em 28/10/2026: migrações 001/002 aplicadas e Edge clube-api versão 2 ativa. A interface está publicada no GitHub Pages em https://caue-a11y.github.io/clube-do-livro-paracuru/; coleta ainda fechada. Não há usuário administrativo nem respostas iniciais; coleta encerrada e dados de privacidade nulos. Evidências consolidadas em ../VALIDACAO.md.

## Arquivos e arquitetura

- `migrations/202610280001_clube.sql`: tabelas privadas, RLS sem policies, grants somente `service_role`, doze funções SQL (RPCs e helpers). Todas são `SECURITY INVOKER` com `search_path` vazio; não há RPC executável por `anon`, `authenticated` ou `PUBLIC`.
- `migrations/202610280002_notice_snapshot.sql`: RPC adicional que vincula a versão do aviso mostrada no cliente ao snapshot salvo e preserva replays de envios já confirmados.
- `functions/clube-api/index.ts`: entrada Deno, biblioteca de telefone mantida `npm:libphonenumber-js@1.13.15/max`, variáveis `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` do ambiente. A URL é pública; a chave service_role nunca deve ir ao frontend ou ao repositório.
- `functions/clube-api/app.mjs`: transporte REST oficial Auth/PostgREST, autorização e todas as rotas do contrato; não depende de SDK nem bundler.
- `functions/clube-api/domain.mjs`: validação pura por IDs/opções do JSON, normalização, hash SHA-256 canônico e CSV.
- `functions/clube-api/questionario.json`: cópia **byte a byte** de `shared/questionario.json` para deploy autocontido. O teste falha se divergir. Ao alterar a fonte, copiar novamente, criar nova versão e preservar interpretadores/validação para versões históricas antes de uma atualização real.
- `config.toml`: `verify_jwt = false` porque a mesma função atende ao formulário público. **Isso não desabilita a autenticação administrativa implementada no servidor.**

### Reprodução do empacotamento em ambiente autorizado

Aplicar as duas migrações em um projeto Supabase persistente dedicado. Publicar a função `clube-api` com os **quatro arquivos da pasta da função**, mantendo os nomes relativos: `index.ts`, `app.mjs`, `domain.mjs`, `questionario.json` (quatro arquivos de runtime; a pasta de migrações e o `config.toml` são separados). Usar `index.ts` como entrada e `verify_jwt=false` na operação `deploy_edge_function`/CLI. Não transmitir somente `index.ts`: os imports locais precisam acompanhar o deploy. Não há imports para fora dessa pasta nem dependências de frontend. A dependência `npm:` é resolvida pelo runtime/build oficial Supabase; uma falha na resolução deve impedir a publicação, nunca ativar parser de telefone improvisado.

A URL resultante será `/functions/v1/clube-api`. O frontend usa apenas a URL pública e a chave publicável; a chave de serviço fica exclusivamente nos secrets gerenciados da função. Não publicar antes de revisar retenção de logs da infraestrutura e backups.

## Autorização

Cada requisição `/admin/*`:

1. Exige `Authorization: Bearer <access_token>`.
2. Consulta **`/auth/v1/user`** no servidor Supabase Auth com esse token; não decodifica JWT para confiar em claims não verificadas.
3. Consulta `admin_users` pelo UUID autenticado, usando a chave de serviço exclusivamente no servidor.
4. As RPCs verificam a allowlist de novo dentro da transação antes de acessar/mutar dados.

A chave publicável não dá acesso a tabelas/RPCs privadas. Não existe busca pública por protocolo. OPTIONS é apenas preflight e não retorna dados administrativos. `401` = sessão ausente/inválida/expirada; `403` = conta fora da allowlist ou origem rejeitada; falha de Auth/banco = `503`, sem falso sucesso.

O primeiro administrador deve ser criado por um operador autorizado no Supabase Auth (email/senha reais ainda pendentes). Depois, por SQL administrativo fora do navegador:

```sql
-- Substituir pelo UUID efetivamente criado no Auth. Não executar o placeholder.
insert into public.admin_users(user_id) values ('<UUID_REAL_DO_AUTH>'::uuid);
```

Remover a linha revoga a autorização nas próximas requisições; encerrar/revogar sessões pelo Auth conforme a operação. O login/logout/refresh do frontend usa os endpoints oficiais Auth, sem autenticação própria. O frontend estático mantém tokens apenas em memória, decisão que substitui o cookie HttpOnly de uma arquitetura com servidor de páginas. Configurar no fornecedor os limites de login, recuperação de senha e inscrições; **este backend não pode limitar as chamadas diretas que o navegador faz ao serviço Auth**. Não criar credenciais públicas de demonstração.

## Contratos implementados

Todas as respostas, inclusive erros e CSV, usam `Cache-Control: no-store`, `Pragma: no-cache`, `Vary: Origin`; sem cookies. CORS aceita somente `https://caue-a11y.github.io`, `http://localhost:4173`, `http://127.0.0.1:4173`. Mutações públicas exigem Origin permitido. Requisições administrativas sem Origin são aceitas **somente depois da verificação Auth + allowlist**, para clientes servidor/testes. GET público sem Origin é permitido. CORS não é autenticação: um atacante fora do navegador pode forjar Origin, e os controles de abuso continuam necessários.

| Rota | Comportamento |
|---|---|
| `GET /config` | `open`, `privacy` (quatro campos, inicialmente nulos), `form_version` |
| `POST /respostas` | Exige `answers`, versão exata, UUID idempotente e honeypot `website:''`; responde só protocolo e instante UTC confirmados pelo banco |
| `GET /admin/respostas` | Filtros SQL, busca literal por nome sem distinguir maiúsculas, paginação até 100, total do mesmo snapshot, sem Q14/notas |
| `GET /admin/respostas/:id` | Detalhe com respostas originais, privacidade/versionamento, notas e histórico; sem hash/chave idempotente |
| `PATCH /admin/respostas/:id` | CAS por revision, status manual e notas até 1000 caracteres; confirmação explícita para confirmado |
| `DELETE /admin/respostas/:id` | CAS + protocolo exato; exclui contato/resposta/histórico ligado; tombstone restrito sem conteúdo pessoal |
| `GET /admin/exportacao` | CSV BOM/UTF-8 integral do recorte, sem limite arbitrário de registros, sem notas/histórico; contato só autorizado |
| `GET /admin/config` | Configuração completa, campos top-level e `privacy` para conveniência do cliente |
| `PATCH /admin/config` | CAS e auditoria; abrir somente com responsável/canal/retenção completos; versão do aviso gerada a cada alteração dos dados de privacidade |

Erros: `{error, fields?}`; 400 validação, 401/403 autorização, 404 alvo/rota inexistente, 409 conflito/coleta encerrada/exportação alterada, 429 limite, 503 indisponibilidade. Nunca repassar erros SQL internos nem payload ao log. Logs da aplicação contêm somente tipo de erro, status e UUID de correlação, não URL de busca ou corpo/token.

### Regras e concorrência

- Todos os 14 IDs são validados pelo esquema versionado; complementos `q05_generos_outro_texto`/`q11_barreiras_outro_texto` são irmãos. Limites, obrigatoriedade, enum, exclusividade de Q11, máximos de Q5/Q8, pares dia/período e coerência localização/modalidade são repetidos no servidor. Horários repetidos são deduplicados; escolhas múltiplas duplicadas são erro.
- Q14 é descartado mesmo se malformado quando Q13 não autoriza; complementos ocultos também são descartados. Não há contato obrigatório para responder sem autorizar. Servidor não verifica propriedade da conta/telefone nem entrega.
- Instagram aceita identificador/@/link direto de perfil, normaliza para identificador minúsculo; rejeita domínio estranho, credenciais/porta, publicação, query/hash, segmentos extras/escapados e conteúdo adicional.
- WhatsApp usa padrões completos `/max` da biblioteca mantida, não regex de plausibilidade. O contexto declarado é este formulário de Paracuru/BR: sem `+`, exigir DDD e 10/11 dígitos brasileiros; **outro país deve vir com `+código`**. Não adivinhar país estrangeiro, não aceitar texto/ramal. Disponibilidade da versão 1.13.15 confirmada no CDN jsDelivr e testada com a biblioteca real, sem npm install.
- Corpo JSON tem limite real de 24.576 bytes durante leitura, além de Content-Length. Chaves desconhecidas são erro. Textos livres permanecem texto, sem renderização HTML no servidor.
- Hash SHA-256 inclui versão e respostas já normalizadas, com chaves ordenadas e conjuntos normalizados. Trava advisory transacional + unicidade da chave impedem duplicação; replay verifica hash **antes** de coleta/limite de novos envios. Timeout depois do commit não muda a chave: reenviar a tentativa retorna mesmo protocolo. Chave reutilizada com conteúdo diferente ou já excluída recebe 409.
- Atualização/exclusão travam linha + CAS; status fora de `novo` exige contato autorizado. Toda correção registra autor, instante, status anterior/posterior, revisão, alteração de nota e declaração de confirmação, sem copiar a nota/contato para histórico.
- Filtros diferentes usam E, valores dentro usam OU. Gênero/modalidade fazem interseção com arrays, slot exige o par exato no mesmo registro; `variavel` fica separado. Datas inclusivas interpretadas em **America/Sao_Paulo**; persistência UTC.
- Exportação usa SQL filtrado e páginas keyset de até 500, não baixa a base inteira como objetos JS. Uma geração global protege o snapshot entre páginas: inserir/editar/excluir durante a exportação invalida a operação com 409; nenhum download parcial com 200. O CSV completo é montado antes de responder, então o tamanho final ainda consome memória proporcional ao **arquivo CSV** e duração proporcional ao recorte. Não há truncamento silencioso em 1.000 linhas. Bases enormes podem exceder recursos Edge e devem usar operação assíncrona futura, não aumentar limites às cegas.
- Todas as células CSV recebem aspas/escape RFC4180; fórmulas iniciadas após espaços, controles ou formatos Unicode são neutralizadas com apóstrofo. Preserva quebras de linha em texto. O arquivo contém dados pessoais e precisa ficar com acesso restrito no dispositivo do administrador.

### Abuso e limites

Sem IP, user agent ou fingerprint nos registros. Contadores SQL agregados por minuto: 60 **novos** envios/minuto e 600 consultas públicas de configuração/minuto. Replay já persistido ignora o contador de novos envios. Honeypot preenchido é 400 explícito, não sucesso inventado. Tentativas inválidas têm disjuntor simples de 120/minuto por instância Edge; contadores SQL válidos são globais entre instâncias. Em abuso mais forte, os limites do fornecedor/gateway precisam ser configurados por operador autorizado; não há promessa de proteção DDoS. Ajustar os números exige revisão/migração. Logs de infraestrutura são independentes destes controles e sua retenção deve ser conhecida antes de publicar.

## Privacidade, encerramento e retenção

Não há dados fictícios para liberar coleta. Antes de abrir, preencher dados reais, retenção e canal que permita pedir exclusão, revisar o texto público fixo de finalidade/dados recebidos/procedimento e o versionamento do aviso. Cada resposta recebe snapshot dos dados de privacidade e versão do aviso vigentes no banco. O fechamento é uma alteração administrativa auditada; novos envios falham, replays confirmados continuam funcionando.

A retenção é configuração e compromisso operacional, **não um job automático instalado**. O responsável deve executar e registrar revisão/expurgo de respostas e backups no prazo informado. Exclusão ativa elimina histórico vinculado; o log mínimo guarda somente UUID aleatório do registro, chave aleatória da tentativa, UUID do operador e instante, para evitar recriação e apoiar restauração. Não guarda protocolo, hash do payload, nomes, contato, notas ou respostas. Identificadores administrativos ainda devem ser tratados como metadados restritos, não publicados.

## Backup/restauração e recuperação

Não executados em fornecedor real. Procedimento a validar antes de abrir:

1. Definir responsáveis, retenção e expurgo de backups, criptografia/acesso e ferramenta suportada pelo plano Supabase (backup gerenciado/PITR ou dump protegido). Nunca salvar backup em pasta pública ou no Git.
2. Manter o conjunto autoritativo de tombstones mais recente protegido e disponível **além** do ponto do backup restaurado, até todos os backups com registros excluídos expirarem. Um backup antigo sozinho não contém as exclusões posteriores; não basta restaurar seu próprio `deletion_log`.
3. Restaurar em **projeto isolado**, sem apontar frontend/coleta para ele. Conservar dump/backup anterior para reversibilidade. Confirmar schema, Auth IDs e allowlist, RLS/grants e funções; fechar a coleta antes de liberar qualquer acesso.
4. Importar/mesclar os tombstones posteriores de fonte administrativa confiável; em transação, reaplicar remoções antes de consultas/exportações:

```sql
begin;
update public.settings set open = false, revision = revision + 1, data_revision = data_revision + 1;
delete from public.responses r using public.deletion_log d
where r.id = d.response_id or r.idempotency_key = d.idempotency_key;
-- ON DELETE CASCADE remove o histórico administrativo vinculado.
commit;
```

5. Conferir ausência dos IDs excluídos, comparar contagens autorizadas, testar login/recorte/CSV e persistência após reinício em base isolada. Não usar dados restaurados como demonstração pública. Registrar evidências e só reabrir por decisão humana, após verificar privacidade e secrets.
6. Testar este procedimento e os limites de expurgo do fornecedor; depois destruir o ambiente restaurado dentro da política.

Não há rollback destrutivo automático para base com dados pessoais. Antes da coleta, reversão pode descartar um **projeto de teste isolado** e reaplicar a migração. Em produção, preferir migração corretiva ou restauração validada com tombstones; apagar tabelas para voltar versão destrói as respostas e não é recuperação segura. Fechar a coleta e interromper o deploy são o retorno operacional inicial para falha.

## Testes executados e reprodução

Testes locais sem instalação npm e sem dados/segredos reais. Node v24.22.1. Depois da construção, a integração final também implantou o backend e executou nove probes públicos e uma transação sintética revertida no projeto real; veja ../VALIDACAO.md.

```sh
# Sintaxe ES modules + testes sem rede/runtime extra (telefone e PostgreSQL ficam skipped):
node --check supabase/functions/clube-api/domain.mjs
node --check supabase/functions/clube-api/app.mjs
node --test tests/backend*.test.mjs

# Suite completa real: baixa WASM PostgreSQL de teste com SHA-256 fixo,
# carrega libphonenumber-js real do CDN e remove o cache ao terminar:
sh tests/backend-check.sh
```

Resultado final observado no conjunto integrado: **56 testes, 56 passaram, 0 falhas, 0 skipped**. O script de reprodução agora inclui também os testes da interface/API comum, análise e versão do aviso. Inclui aplicação da migração em PostgreSQL 17.5 via PGlite WASM, grants/RLS, allowlist SQL, privacidade/CAS, idempotência/coleta fechada, status/histórico/exclusão, datas SP nas bordas, recortes AND/OR, CSV/SQL além de mil registros e conflito de geração. Fixture SQL transacional com rollback e banco WASM efêmero, nunca enviada ao Supabase. Testes HTTP usam upstreams injetados explicitamente de teste; verificam cada rota administrativa sem token/fora da allowlist, payload real, falhas de persistência e erro em página tardia do CSV. Teste de telefone usa a versão real 1.13.15 `/max` (BR/país estrangeiro/invalidade), não stub de aceitação.

Referências consultadas: https://supabase.com/docs/guides/functions/auth e https://supabase.com/docs/reference/javascript/auth-getuser (verificação remota do usuário); versão/export `/max`: https://cdn.jsdelivr.net/npm/libphonenumber-js@1.13.15/package.json.

### Limitações ainda não validadas

- Sem Deno/CLI Supabase/psql local; não rodou deno check/serve. O deploy oficial Supabase foi concluído e a função respondeu aos probes HTTPS. SQL foi exercitado em PostgreSQL WASM e em transação revertida no serviço hospedado. Login do organizador ainda não foi configurado.
- Não houve autenticação email/senha real, endpoint Auth real, teste ponta a ponta navegador→Edge→Supabase, restart do fornecedor, concorrência com duas conexões PostgreSQL reais, backup/PITR ou recuperação real. Travas/CAS foram implementados e seus efeitos sequenciais exercitados; não alegar stress de concorrência multi-instância.
- Não foram feitas coleta real, abertura, criação de administrador, privacidade fictícia, métricas ou ações automáticas de convite. Retenção automática e alerta de contatos duplicados não foram construídos; respostas não são deduplicadas/fundidas por contato, preservando a regra de contar registros, não pessoas únicas.
- O envio público exige privacy_notice_version. A RPC adicional verifica o aviso na transação antes de inserir; mudança durante preenchimento é recusada com 409, preservando as respostas na interface para revisão com o aviso atualizado. Replay já persistido continua devolvendo o protocolo mesmo após mudança do aviso ou fechamento.
