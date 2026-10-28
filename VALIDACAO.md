# Validação — entrega final em 28/10/2026

## Estado confirmado

Site publicado e coleta aberta: https://caue-a11y.github.io/clube-do-livro-paracuru/

Painel privado: https://caue-a11y.github.io/clube-do-livro-paracuru/admin.html

Código na conta solicitada: https://github.com/caue-a11y/clube-do-livro-paracuru

Backend gratuito Supabase wmrrscohfibprfqrprzf, região sa-east-1, função clube-api v2. As duas migrações foram aplicadas. A conta do organizador foi criada por ele no formulário seguro do Supabase, confirmada e autorizada na allowlist. Nenhuma senha, hash de senha, token de sessão ou chave secreta foi consultada, salva no código ou publicada.

Responsável: Cauê Almeida Cabral. Canal público de privacidade: caue@orbbotia.com. Retenção: 90 dias, com exclusão manual, conforme decisão explícita do organizador. Aviso versão privacidade-v1-r2. Configuração final revision 3/open true, com abertura auditada sob a conta autorizada.

## Teste integrado REAL, sem mocks

Evidência estruturada: docs/validacao-integrada-real.json.

1. O organizador entrou no painel com sua própria senha. A sessão autenticada carregou configurações e lista privadas; nenhuma credencial foi lida pelo agente.
2. A coleta foi aberta pelo formulário administrativo usando os dados de privacidade já confirmados. O retorno público da API confirmou open true.
3. O questionário público real foi aberto em frame de mesma origem para preservar a sessão administrativa em memória. Foram percorridas as três etapas e a revisão. O aviso exibiu nome, email e 90 dias antes do envio.
4. Foi enviado pelo botão real Enviar respostas um único registro sintético identificado como Pessoa Teste Técnico 1793218100468, sem autorização de contato. Nenhum mock de API foi usado. O protocolo retornado foi CL-65ee253f47ab445cb73e11516afa8eb4, recebido em 28/10/2026 às 17:08:35, horário de Brasília.
5. Uma consulta separada ao banco confirmou o registro persistido, data do servidor, versão do aviso e snapshot correto. Q13 = nao e nenhum Q14 armazenado.
6. A busca privada pelo nome encontrou uma resposta. Lista e detalhe autenticados responderam 200 e mostraram o mesmo protocolo. Não existe leitura pública por protocolo.
7. A exportação exigiu seleção filtrada e confirmação de cuidado. O CSV autenticado respondeu 200, 1.683 bytes, cabeçalho e uma linha de resposta; continha somente o teste no recorte. Não foi exportada base com participantes reais.
8. O teste foi excluído pelo painel após digitar o protocolo e conferir o alvo. DELETE autenticado respondeu 200. Consulta posterior confirmou ausência da resposta e do histórico vinculado; apenas tombstone restrito com identificadores aleatórios foi mantido. Após a limpeza, a base estava sem respostas. Nenhum outro registro foi alterado.
9. Os filtros foram limpos. Encerrar sessão respondeu 204 no Supabase, limpou o conteúdo privado e devolveu a tela de login. Consulta posterior sem sessão foi negada com 401.
10. O endereço público foi reaberto e mostrou Pesquisa de interesse aberta e o botão Responder ao formulário. A coleta foi mantida aberta; a resposta sintética não ficou na base.

A observação de requisições no navegador registrou apenas método, caminho, status e metadados do CSV sintético. Ela não alterou respostas da API nem inspecionou headers de autenticação, senhas ou tokens.

## Automação e banco isolado

Ambiente de desenvolvimento: Node.js 24.22.1, Python 3.9.25. Interface sem dependências npm/build. Backend Deno, libphonenumber-js 1.13.15/max. SQL testado também em PostgreSQL 17.5 embarcado PGlite 0.3.14, baixado só para testes com integridade SHA-256 conferida e removido depois.

sh tests/backend-check.sh passou com 56 testes, zero falhas e zero ignorados. Registro: docs/testes-automatizados.txt. O conjunto cobre regras do questionário, HTTP com upstreams de teste, biblioteca real de telefone, SQL real temporário, compatibilidade e aviso versionado. npm run check passou nos módulos da interface e análise. O script de probes públicos foi verificado sintaticamente após acrescentar a trava que proíbe POSTs quando a coleta já está aberta.

Coberturas: enums/limites/obrigatoriedade; Q14 descartado sem autorização; Instagram e telefone; exclusividades e coerência local/modalidade; hash canônico e idempotência; replay após coleta fechada; CAS, audit, exclusão e tombstone; RLS/grants; autorização por rota; datas São Paulo; filtros AND/OR; CSV integral com mais de mil registros e proteção contra fórmulas; falhas sem sucesso fictício; snapshot do aviso vinculado à versão mostrada no cliente.

Fixture manual confrontada: presencial sábado/manhã quinzenal A/B/D/F; regulares A/B/F; contatáveis A/B; variável E. Online B/C; alternado B. Distribuição de gêneros usa sete respondentes, não nove marcações. IDs/horários repetidos não inflam os totais.

## Projeto Supabase e probes públicos

Antes da abertura, nove probes reais verificaram configuração fechada, quatro rotas administrativas negadas sem sessão, acesso direto à tabela negado, envio fechado recusado, validação inválida e origem não autorizada. Uma transação sintética BEGIN/ROLLBACK no projeto real confirmou inserção e replay sem deixar fixtures gravadas ou abrir a coleta para outros clientes.

Depois da abertura, os probes passaram a executar somente GETs: sete verificações passaram, e os dois POSTs foram explicitamente omitidos para não inserir testes na produção aberta. Evidência atual: docs/probes-publicos.json. Eles não substituem o teste integrado de envio e exclusão realizado no navegador.

As seis tabelas têm RLS e privilégios de anon/authenticated revogados. O diagnóstico Supabase apresentou somente avisos INFO RLS Enabled No Policy, esperados no desenho deny-all com acesso por service_role exclusivamente no backend. Não adicionar policies públicas para silenciá-los. Referência: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

## Publicação e interface

GitHub Pages usa main, pasta / (root), com .nojekyll. O bloqueio inicial de criar repositório pela integração foi resolvido por login seguro do usuário no navegador; os pushes posteriores funcionaram normalmente. A árvore dos 41 arquivos do primeiro commit de código fbc20a2cfcd9346f3dc904d7fab5d98aa2ca4c1f foi comparada com os hashes locais sem divergências. Documentação e um utilitário de probes foram atualizados depois; a interface e a API não precisaram de alteração para abrir a coleta.

Os recursos public.js, admin.js, styles.css, questionario.json e admin.html retornaram 200 no URL final. CORS foi validado na origem GitHub Pages real. A prévia isolada continua sendo só demonstração sem API/coleta; seu estado fechado não representa o site público atual.

Além do teste real acima, as frentes executaram testes de interface com API simulada: formulário público e 17 checagens do painel com 123 registros sintéticos, incluindo refresh, respostas obsoletas, texto hostil, denominadores, compatibilidade, CAS, exclusão, CSV, privacidade, logout e allowlist. Evidência: docs/painel-testes-simulados.txt. Foram conferidas larguras 320/390/768/1440 sem overflow no formulário, login, painel e detalhe expandido. Isso não comprova acessibilidade completa nem uso em aparelhos físicos.

## Limitações que permanecem

- Não foi feita restauração completa de dump/backup do fornecedor em projeto isolado nem verificado expurgo de backups. Procedimento documentado em docs/OPERACAO.md. CSV é cópia para análise, não backup restaurável completo.
- Não houve reinício deliberado do Supabase, teste de carga ou concorrência simultânea entre duas sessões reais. A persistência foi comprovada em requisições separadas, e CAS/travas foram exercitados em testes SQL isolados.
- Duplo clique/perda de confirmação no navegador foram exercitados com API simulada; replay também foi validado em SQL, mas a rede pública não foi interrompida propositalmente durante o envio real.
- Sem teste em Safari/iPhone físico, navegador do Instagram, leitor de tela ou usabilidade observada com participantes reais.
- Retenção de 90 dias não dispara expurgo automático. O organizador precisa excluir dados vencidos e cópias locais, ou aprovar uma rotina específica. Logs e backups de infraestrutura obedecem também às condições do fornecedor.
- Não há disparo de mensagens, grupos automáticos, rastreamento de visitantes, presença automática, cobrança ou promessa de conformidade legal.
